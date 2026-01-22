import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { NotificationService } from "./notification.service";
import {
  OzRelayerWebhookDto,
  WebhookResponseDto,
} from "./dto/oz-relayer-webhook.dto";

/**
 * WebhooksService - Webhook Processing Logic
 *
 * SPEC-WEBHOOK-001: E-WEBHOOK-002, E-WEBHOOK-003, NFR-PERF-002
 *
 * Handles incoming webhooks from OZ Relayer:
 * 1. Update MySQL (L2 - permanent storage)
 * 2. Update Redis (L1 - cache) with TTL reset
 * 3. Send notification to client service
 *
 * Write-through pattern: Updates both cache and database simultaneously.
 *
 * OZ Relayer webhook structure:
 * {
 *   "id": "event-uuid",
 *   "event": "transaction_update",
 *   "payload": {
 *     "id": "oz-relayer-tx-id",  // This is relayerTxId in our DB
 *     "hash": "0x...",
 *     "status": "submitted",
 *     "created_at": "...",
 *     "confirmed_at": null,
 *     ...
 *   },
 *   "timestamp": "..."
 * }
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly CACHE_TTL_SECONDS = 600; // 10 minutes

  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Process OZ Relayer webhook
   *
   * Extracts transaction data from nested payload structure and
   * updates transaction status in both Redis and MySQL,
   * then sends notification to client service.
   *
   * @param webhookEvent - OZ Relayer webhook event (with nested payload)
   * @returns WebhookResponseDto acknowledgement
   * @throws NotFoundException if transaction not found in MySQL
   * @throws InternalServerErrorException if MySQL update fails
   */
  async handleWebhook(
    webhookEvent: OzRelayerWebhookDto,
  ): Promise<WebhookResponseDto> {
    // Extract transaction data from nested payload structure
    const txPayload = webhookEvent.payload;
    const relayerTxId = txPayload.id; // OZ Relayer's internal transaction ID
    const status = txPayload.status;
    const transactionHash = txPayload.hash;
    const confirmedAt = txPayload.confirmed_at;

    this.logger.log(
      `Processing webhook for relayerTxId=${relayerTxId}: event=${webhookEvent.event}, status=${status}`,
    );

    try {
      // Step 1: Update MySQL (L2 - permanent storage)
      const updated = await this.updateMysql(
        relayerTxId,
        status,
        transactionHash,
        confirmedAt,
      );

      // Step 2: Update Redis (L1 - cache) with TTL reset
      await this.updateRedisCache(relayerTxId, updated);

      // Step 3: Send notification to client service (non-blocking)
      this.notificationService
        .notify(relayerTxId, status, transactionHash)
        .catch((error) => {
          this.logger.warn(
            `Notification failed for ${relayerTxId}: ${error.message}`,
          );
        });

      this.logger.log(
        `Webhook processed successfully for relayerTxId=${relayerTxId}: status=${status}`,
      );

      return {
        success: true,
        message: "Webhook processed successfully",
        transactionId: relayerTxId,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        `Webhook processing failed for ${relayerTxId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new InternalServerErrorException("Failed to process webhook");
    }
  }

  /**
   * Update transaction in MySQL
   *
   * SPEC-ROUTING-001 FR-003: Webhook Bug Fix
   * - Uses UPDATE (not upsert) to prevent creating incorrect records
   * - Looks up by relayerTxId field (OZ Relayer's transaction ID)
   * - Returns 404 if transaction not found
   *
   * DC-004: Hash Field Separation
   * - Webhook ONLY updates: hash, status, confirmedAt
   * - Consumer ONLY updates: relayerTxId (set during submission)
   */
  private async updateMysql(
    relayerTxId: string,
    status: string,
    transactionHash: string | null | undefined,
    confirmedAt: string | null | undefined,
  ) {
    try {
      // FR-003: Look up by relayerTxId, NOT by id
      // relayerTxId is OZ Relayer's internal ID from webhook payload.id
      const updated = await this.prismaService.transaction.update({
        where: { relayerTxId },
        data: {
          status,
          transactionHash: transactionHash || undefined,
          confirmedAt: confirmedAt ? new Date(confirmedAt) : undefined,
        },
      });

      this.logger.debug(
        `MySQL updated for relayerTxId=${relayerTxId}: status=${status}`,
      );
      return updated;
    } catch (error) {
      // Prisma throws P2025 when record not found
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "P2025"
      ) {
        this.logger.warn(
          `Transaction not found for relayerTxId=${relayerTxId}`,
        );
        throw new NotFoundException(
          `Transaction not found: relayerTxId=${relayerTxId}`,
        );
      }

      this.logger.error(
        `MySQL update failed for relayerTxId=${relayerTxId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw new InternalServerErrorException(
        "Failed to update transaction in database",
      );
    }
  }

  /**
   * Update Redis cache with TTL reset
   *
   * Caches the updated transaction data with fresh TTL.
   * Graceful degradation: logs error but doesn't fail if Redis unavailable.
   */
  private async updateRedisCache(
    relayerTxId: string,
    data: {
      transactionId: string;
      transactionHash: string | null;
      status: string;
      from: string | null;
      to: string | null;
      value: string | null;
      createdAt: Date;
      confirmedAt: Date | null;
    },
  ): Promise<void> {
    // SPEC-ROUTING-001: Use internal transactionId for cache key consistency
    // StatusService looks up with `tx:status:${transactionId}`
    const cacheKey = `tx:status:${data.transactionId}`;
    const cacheData = {
      transactionId: data.transactionId,
      relayerTxId,
      transactionHash: data.transactionHash,
      status: data.status,
      from: data.from,
      to: data.to,
      value: data.value,
      createdAt: data.createdAt.toISOString(),
      confirmedAt: data.confirmedAt?.toISOString(),
    };

    try {
      await this.redisService.set(cacheKey, cacheData, this.CACHE_TTL_SECONDS);
      this.logger.debug(
        `Redis cache updated for transactionId=${data.transactionId} (relayerTxId=${relayerTxId}) with TTL ${this.CACHE_TTL_SECONDS}s`,
      );
    } catch (error) {
      // Graceful degradation: log error but don't fail the webhook
      this.logger.warn(
        `Redis cache update failed for transactionId=${data.transactionId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}

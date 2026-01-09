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
 *     "id": "oz-relayer-tx-id",  // This is ozRelayerTxId in our DB
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
    const ozRelayerTxId = txPayload.id; // OZ Relayer's internal transaction ID
    const status = txPayload.status;
    const hash = txPayload.hash;
    const confirmedAt = txPayload.confirmed_at;

    this.logger.log(
      `Processing webhook for ozRelayerTxId=${ozRelayerTxId}: event=${webhookEvent.event}, status=${status}`,
    );

    try {
      // Step 1: Update MySQL (L2 - permanent storage)
      const updated = await this.updateMysql(
        ozRelayerTxId,
        status,
        hash,
        confirmedAt,
      );

      // Step 2: Update Redis (L1 - cache) with TTL reset
      await this.updateRedisCache(ozRelayerTxId, updated);

      // Step 3: Send notification to client service (non-blocking)
      this.notificationService.notify(ozRelayerTxId, status, hash).catch((error) => {
        this.logger.warn(
          `Notification failed for ${ozRelayerTxId}: ${error.message}`,
        );
      });

      this.logger.log(
        `Webhook processed successfully for ozRelayerTxId=${ozRelayerTxId}: status=${status}`,
      );

      return {
        success: true,
        message: "Webhook processed successfully",
        transactionId: ozRelayerTxId,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        `Webhook processing failed for ${ozRelayerTxId}: ${error instanceof Error ? error.message : "Unknown error"}`,
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
   * - Looks up by ozRelayerTxId field (OZ Relayer's transaction ID)
   * - Returns 404 if transaction not found
   *
   * DC-004: Hash Field Separation
   * - Webhook ONLY updates: hash, status, confirmedAt
   * - Consumer ONLY updates: ozRelayerTxId (set during submission)
   */
  private async updateMysql(
    ozRelayerTxId: string,
    status: string,
    hash: string | null | undefined,
    confirmedAt: string | null | undefined,
  ) {
    try {
      // FR-003: Look up by ozRelayerTxId, NOT by id
      // ozRelayerTxId is OZ Relayer's internal ID from webhook payload.id
      const updated = await this.prismaService.transaction.update({
        where: { ozRelayerTxId },
        data: {
          status,
          hash: hash || undefined,
          confirmedAt: confirmedAt ? new Date(confirmedAt) : undefined,
        },
      });

      this.logger.debug(
        `MySQL updated for ozRelayerTxId=${ozRelayerTxId}: status=${status}`,
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
          `Transaction not found for ozRelayerTxId=${ozRelayerTxId}`,
        );
        throw new NotFoundException(
          `Transaction not found: ozRelayerTxId=${ozRelayerTxId}`,
        );
      }

      this.logger.error(
        `MySQL update failed for ozRelayerTxId=${ozRelayerTxId}: ${error instanceof Error ? error.message : "Unknown error"}`,
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
    ozRelayerTxId: string,
    data: {
      id: string;
      hash: string | null;
      status: string;
      from: string | null;
      to: string | null;
      value: string | null;
      createdAt: Date;
      confirmedAt: Date | null;
    },
  ): Promise<void> {
    // SPEC-ROUTING-001: Use internal txId (data.id) for cache key consistency
    // StatusService looks up with `tx:status:${txId}` where txId is internal ID
    const cacheKey = `tx:status:${data.id}`;
    const cacheData = {
      transactionId: data.id,
      ozRelayerTxId,
      hash: data.hash,
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
        `Redis cache updated for txId=${data.id} (ozRelayerTxId=${ozRelayerTxId}) with TTL ${this.CACHE_TTL_SECONDS}s`,
      );
    } catch (error) {
      // Graceful degradation: log error but don't fail the webhook
      this.logger.warn(
        `Redis cache update failed for txId=${data.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}

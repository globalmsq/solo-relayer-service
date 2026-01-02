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
   * Updates transaction status in both Redis and MySQL,
   * then sends notification to client service.
   *
   * @param payload - OZ Relayer webhook payload
   * @returns WebhookResponseDto acknowledgement
   * @throws NotFoundException if transaction not found in MySQL
   * @throws InternalServerErrorException if MySQL update fails
   */
  async handleWebhook(
    payload: OzRelayerWebhookDto,
  ): Promise<WebhookResponseDto> {
    const { transactionId, status, hash } = payload;

    this.logger.log(
      `Processing webhook for ${transactionId}: status=${status}`,
    );

    try {
      // Step 1: Update MySQL (L2 - permanent storage)
      const updated = await this.updateMysql(payload);

      // Step 2: Update Redis (L1 - cache) with TTL reset
      await this.updateRedisCache(transactionId, updated);

      // Step 3: Send notification to client service (non-blocking)
      this.notificationService
        .notify(transactionId, status, hash)
        .catch((error) => {
          this.logger.warn(
            `Notification failed for ${transactionId}: ${error.message}`,
          );
        });

      this.logger.log(
        `Webhook processed successfully for ${transactionId}: status=${status}`,
      );

      return {
        success: true,
        message: "Webhook processed successfully",
        transactionId,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        `Webhook processing failed for ${transactionId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error.stack : undefined,
      );

      throw new InternalServerErrorException("Failed to process webhook");
    }
  }

  /**
   * Update transaction in MySQL
   *
   * Uses upsert pattern: creates if not exists, updates if exists.
   * This handles the case where webhook arrives before initial storage.
   */
  private async updateMysql(payload: OzRelayerWebhookDto) {
    const {
      transactionId,
      status,
      hash,
      from,
      to,
      value,
      createdAt,
      confirmedAt,
    } = payload;

    try {
      const updated = await this.prismaService.transaction.upsert({
        where: { id: transactionId },
        update: {
          status,
          hash: hash || undefined,
          confirmedAt: confirmedAt ? new Date(confirmedAt) : undefined,
        },
        create: {
          id: transactionId,
          status,
          hash: hash || undefined,
          from: from || undefined,
          to: to || undefined,
          value: value || undefined,
          createdAt: new Date(createdAt),
          confirmedAt: confirmedAt ? new Date(confirmedAt) : undefined,
        },
      });

      this.logger.debug(`MySQL updated for ${transactionId}: status=${status}`);
      return updated;
    } catch (error) {
      this.logger.error(
        `MySQL update failed for ${transactionId}: ${error instanceof Error ? error.message : "Unknown error"}`,
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
    transactionId: string,
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
    const cacheKey = `tx:status:${transactionId}`;
    const cacheData = {
      transactionId: data.id,
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
        `Redis cache updated for ${transactionId} with TTL ${this.CACHE_TTL_SECONDS}s`,
      );
    } catch (error) {
      // Graceful degradation: log error but don't fail the webhook
      this.logger.warn(
        `Redis cache update failed for ${transactionId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}

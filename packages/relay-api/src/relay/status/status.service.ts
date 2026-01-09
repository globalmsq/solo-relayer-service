import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { OzRelayerService } from "../../oz-relayer/oz-relayer.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { TxStatusResponseDto } from "./dto/tx-status-response.dto";
import { Transaction } from "@prisma/client";

/**
 * StatusService - Transaction Status Query with 3-Tier Lookup
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * SPEC-WEBHOOK-001: TX History & Webhook System - 3-Tier Cache Integration
 *
 * 3-Tier Lookup Strategy:
 * - Tier 1: Redis (L1 Cache) - ~1-5ms latency
 * - Tier 2: MySQL (L2 Storage) - ~50ms latency, with Redis backfill
 * - Tier 3: OZ Relayer API - ~200ms latency, with Redis + MySQL storage
 */
@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);
  private readonly CACHE_TTL_SECONDS = 600; // 10 minutes

  // Terminal statuses that don't need refreshing from OZ Relayer
  private readonly TERMINAL_STATUSES = [
    "confirmed",
    "mined",
    "failed",
    "cancelled",
  ];

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly ozRelayerService: OzRelayerService,
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Query transaction status using 3-Tier Lookup
   *
   * Lookup Order:
   * 1. Redis (L1) - Return immediately if found
   * 2. MySQL (L2) - Return and backfill Redis if found
   * 3. OZ Relayer - Return and store in both Redis and MySQL
   *
   * @param txId - Transaction ID (UUID v4 format)
   * @returns TxStatusResponseDto with status, hash, and execution details
   * @throws NotFoundException if transaction not found in all tiers
   * @throws ServiceUnavailableException if OZ Relayer unavailable
   */
  async getTransactionStatus(txId: string): Promise<TxStatusResponseDto> {
    const cacheKey = `tx:status:${txId}`;

    // Tier 1: Redis lookup (~1-5ms) with graceful degradation
    // Only return cached data if status is terminal (confirmed, mined, failed, cancelled)
    // For non-terminal statuses (pending, submitted), continue to OZ Relayer for fresh data
    try {
      const cached = await this.redisService.get<TxStatusResponseDto>(cacheKey);
      if (cached && this.isTerminalStatus(cached.status)) {
        this.logger.debug(
          `Redis cache hit for ${txId} (terminal: ${cached.status})`,
        );
        return cached;
      }
      if (cached) {
        this.logger.debug(
          `Redis cache hit for ${txId} but status is non-terminal (${cached.status}), checking OZ Relayer`,
        );
      }
    } catch (error) {
      // Graceful degradation: log error and continue to MySQL
      this.logger.warn(
        `Redis lookup failed for ${txId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    // Tier 2: MySQL lookup (~50ms) with graceful degradation
    // Only return from MySQL if status is terminal
    let stored: Transaction | null = null;
    try {
      stored = await this.prismaService.transaction.findUnique({
        where: { id: txId },
      });
    } catch (error) {
      // Graceful degradation: log error and continue to OZ Relayer
      this.logger.warn(
        `MySQL lookup failed for ${txId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    if (stored && this.isTerminalStatus(stored.status)) {
      this.logger.debug(`MySQL hit for ${txId} (terminal: ${stored.status})`);
      const dto = this.transformPrismaToDto(stored);

      // Backfill Redis cache
      await this.redisService.set(cacheKey, dto, this.CACHE_TTL_SECONDS);

      return dto;
    }

    if (stored) {
      this.logger.debug(
        `MySQL hit for ${txId} but status is non-terminal (${stored.status}), checking OZ Relayer`,
      );
    }

    // Tier 3: OZ Relayer API fallback (~200ms)
    // SPEC-ROUTING-001: Use ozRelayerTxId and ozRelayerUrl from MySQL for correct relayer lookup
    const ozRelayerTxId = stored?.ozRelayerTxId;
    const ozRelayerUrl = stored?.ozRelayerUrl;

    if (!ozRelayerTxId) {
      this.logger.warn(
        `No ozRelayerTxId found for ${txId}, cannot query OZ Relayer`,
      );
      throw new NotFoundException("Transaction not found");
    }

    this.logger.debug(
      `Fetching from OZ Relayer for ${txId} (ozRelayerTxId: ${ozRelayerTxId}, relayerUrl: ${ozRelayerUrl})`,
    );
    const fresh = await this.fetchFromOzRelayer(txId, ozRelayerTxId, ozRelayerUrl);

    // Update both Redis and MySQL (Write-through)
    // Use upsert for MySQL to handle existing records
    await Promise.all([
      this.redisService.set(cacheKey, fresh, this.CACHE_TTL_SECONDS),
      this.prismaService.transaction.upsert({
        where: { id: fresh.transactionId },
        update: {
          hash: fresh.hash,
          status: fresh.status,
          confirmedAt: fresh.confirmedAt ? new Date(fresh.confirmedAt) : null,
        },
        create: {
          id: fresh.transactionId,
          hash: fresh.hash,
          status: fresh.status,
          from: fresh.from,
          to: fresh.to,
          value: fresh.value,
          createdAt: new Date(fresh.createdAt),
          confirmedAt: fresh.confirmedAt ? new Date(fresh.confirmedAt) : null,
        },
      }),
    ]);

    return fresh;
  }

  /**
   * Check if status is terminal (no further updates expected)
   *
   * @param status - Transaction status string
   * @returns true if status is terminal
   */
  private isTerminalStatus(status: string): boolean {
    return this.TERMINAL_STATUSES.includes(status.toLowerCase());
  }

  /**
   * Fetch transaction status directly from OZ Relayer
   *
   * SPEC-ROUTING-001: Use ozRelayerTxId and ozRelayerUrl for correct relayer lookup
   *
   * @param txId - Internal transaction ID (relay-api UUID)
   * @param ozRelayerTxId - OZ Relayer's transaction ID (required for API lookup)
   * @param ozRelayerUrl - The specific relayer URL that handled this transaction
   * @returns TxStatusResponseDto from OZ Relayer
   * @throws NotFoundException if transaction not found (HTTP 404)
   * @throws ServiceUnavailableException if OZ Relayer unavailable
   */
  private async fetchFromOzRelayer(
    txId: string,
    ozRelayerTxId: string,
    ozRelayerUrl?: string | null,
  ): Promise<TxStatusResponseDto> {
    try {
      // SPEC-ROUTING-001: Use stored ozRelayerUrl if available, otherwise fall back to env
      const relayerUrl =
        ozRelayerUrl ||
        this.configService.get<string>(
          "OZ_RELAYER_URL",
          "http://oz-relayer-lb:8080",
        );
      // SPEC-ROUTING-001 FIX: Get relayer ID from the specific URL
      // Previously used getRelayerId() which always returned default relayer's ID
      // This caused mismatch when querying oz-relayer-2 with oz-relayer-1's ID
      const relayerId = ozRelayerUrl
        ? await this.ozRelayerService.getRelayerIdFromUrl(relayerUrl)
        : await this.ozRelayerService.getRelayerId();
      const apiKey = this.configService.get<string>(
        "OZ_RELAYER_API_KEY",
        "oz-relayer-shared-api-key-local-dev",
      );

      // SPEC-ROUTING-001: Use ozRelayerTxId for OZ Relayer API lookup
      const response = await firstValueFrom(
        this.httpService.get(
          `${relayerUrl}/api/v1/relayers/${relayerId}/transactions/${ozRelayerTxId}`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            timeout: 10000,
          },
        ),
      );

      // Transform OZ Relayer response to standardized DTO
      const data = response.data.data || response.data;

      // SPEC-ROUTING-001: Always use our internal txId in response for consistency
      // data.id is the OZ Relayer's ID (ozRelayerTxId), not our internal ID
      return {
        transactionId: txId,
        hash: data.hash || null,
        status: data.status || "unknown",
        createdAt: data.created_at || new Date().toISOString(),
        confirmedAt: data.confirmed_at,
        from: data.from,
        to: data.to,
        value: data.value,
      };
    } catch (error) {
      if (error.response?.status === 404) {
        throw new NotFoundException("Transaction not found");
      }
      throw new ServiceUnavailableException("OZ Relayer service unavailable");
    }
  }

  /**
   * Transform Prisma Transaction model to TxStatusResponseDto
   *
   * @param tx - Prisma Transaction record
   * @returns TxStatusResponseDto
   */
  private transformPrismaToDto(tx: Transaction): TxStatusResponseDto {
    return {
      transactionId: tx.id,
      hash: tx.hash,
      status: tx.status,
      createdAt: tx.createdAt.toISOString(),
      confirmedAt: tx.confirmedAt?.toISOString(),
      from: tx.from ?? undefined,
      to: tx.to ?? undefined,
      value: tx.value ?? undefined,
    };
  }
}

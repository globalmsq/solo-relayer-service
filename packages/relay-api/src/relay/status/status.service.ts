import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { TxStatusResponseDto } from "./dto/tx-status-response.dto";
import { Transaction } from "@prisma/client";

/**
 * StatusService - Transaction Status Query with 2-Tier Lookup
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * SPEC-DISCOVERY-001: OZ Relayer removed - transactions processed via queue-consumer
 *
 * 2-Tier Lookup Strategy (OZ Relayer direct calls removed):
 * - Tier 1: Redis (L1 Cache) - ~1-5ms latency
 * - Tier 2: MySQL (L2 Storage) - ~50ms latency, with Redis backfill
 *
 * Note: Transaction results are stored by queue-consumer after OZ Relayer processing.
 * Status API no longer queries OZ Relayer directly.
 */
@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);
  private readonly CACHE_TTL_SECONDS = 600; // 10 minutes

  // Terminal statuses that don't need refreshing
  private readonly TERMINAL_STATUSES = [
    "confirmed",
    "mined",
    "failed",
    "cancelled",
  ];

  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Query transaction status using 2-Tier Lookup
   *
   * Lookup Order:
   * 1. Redis (L1) - Return immediately if found with terminal status
   * 2. MySQL (L2) - Return and backfill Redis if found
   *
   * Note: No OZ Relayer fallback - queue-consumer stores results in Redis/MySQL
   *
   * @param txId - Transaction ID (UUID v4 format)
   * @returns TxStatusResponseDto with status, hash, and execution details
   * @throws NotFoundException if transaction not found in all tiers
   */
  async getTransactionStatus(txId: string): Promise<TxStatusResponseDto> {
    const cacheKey = `tx:status:${txId}`;

    // Tier 1: Redis lookup (~1-5ms) with graceful degradation
    try {
      const cached = await this.redisService.get<TxStatusResponseDto>(cacheKey);
      if (cached) {
        this.logger.debug(
          `Redis cache hit for ${txId} (status: ${cached.status})`,
        );
        return cached;
      }
    } catch (error) {
      // Graceful degradation: log error and continue to MySQL
      this.logger.warn(
        `Redis lookup failed for ${txId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    // Tier 2: MySQL lookup (~50ms) with graceful degradation
    let stored: Transaction | null = null;
    try {
      stored = await this.prismaService.transaction.findUnique({
        where: { transactionId: txId },
      });
    } catch (error) {
      // Graceful degradation: log error
      this.logger.warn(
        `MySQL lookup failed for ${txId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    if (stored) {
      this.logger.debug(`MySQL hit for ${txId} (status: ${stored.status})`);
      const dto = this.transformPrismaToDto(stored);

      // Backfill Redis cache
      try {
        await this.redisService.set(cacheKey, dto, this.CACHE_TTL_SECONDS);
      } catch (error) {
        this.logger.warn(
          `Redis backfill failed for ${txId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }

      return dto;
    }

    // Transaction not found in any tier
    this.logger.warn(`Transaction ${txId} not found in Redis or MySQL`);
    throw new NotFoundException("Transaction not found");
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
   * Transform Prisma Transaction model to TxStatusResponseDto
   *
   * @param tx - Prisma Transaction record
   * @returns TxStatusResponseDto
   */
  private transformPrismaToDto(tx: Transaction): TxStatusResponseDto {
    return {
      transactionId: tx.transactionId,
      transactionHash: tx.transactionHash,
      status: tx.status,
      createdAt: tx.createdAt.toISOString(),
      confirmedAt: tx.confirmedAt?.toISOString(),
      from: tx.from ?? undefined,
      to: tx.to ?? undefined,
      value: tx.value ?? undefined,
    };
  }
}

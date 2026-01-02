import { Injectable, Logger } from "@nestjs/common";
import { OzRelayerService } from "../../oz-relayer/oz-relayer.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { DirectTxRequestDto } from "../dto/direct-tx-request.dto";
import { DirectTxResponseDto } from "../dto/direct-tx-response.dto";

/**
 * DirectService - Business logic for Direct Transaction API
 *
 * SPEC-PROXY-001: Direct Transaction API
 * SPEC-WEBHOOK-001: TX History & Webhook System - Write-through caching
 *
 * Handles transformation between API DTOs and OZ Relayer service calls.
 * Stores transaction records in Redis (L1) and MySQL (L2) for status lookup.
 */
@Injectable()
export class DirectService {
  private readonly logger = new Logger(DirectService.name);
  private readonly CACHE_TTL_SECONDS = 600; // 10 minutes

  constructor(
    private readonly ozRelayerService: OzRelayerService,
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Send a direct transaction via OZ Relayer
   *
   * Flow:
   * 1. Receive and validate DirectTxRequestDto
   * 2. Call OzRelayerService.sendTransaction() (delegates to Nginx LB)
   * 3. Store transaction in Redis + MySQL (Write-through)
   * 4. Transform response to DirectTxResponseDto
   * 5. Return 202 Accepted status
   *
   * @param dto - Validated DirectTxRequestDto from controller
   * @returns DirectTxResponseDto with transaction details
   * @throws ServiceUnavailableException if OZ Relayer unavailable
   */
  async sendTransaction(dto: DirectTxRequestDto): Promise<DirectTxResponseDto> {
    const response = await this.ozRelayerService.sendTransaction({
      to: dto.to,
      data: dto.data,
      value: dto.value,
      gasLimit: dto.gasLimit,
      speed: dto.speed,
    });

    const result: DirectTxResponseDto = {
      transactionId: response.transactionId,
      hash: response.hash,
      status: response.status,
      createdAt: response.createdAt,
    };

    // Write-through: Store in both Redis and MySQL
    const cacheKey = `tx:status:${response.transactionId}`;
    const cacheData = {
      transactionId: response.transactionId,
      hash: response.hash,
      status: response.status,
      createdAt: response.createdAt,
      to: dto.to,
      value: dto.value || "0",
    };

    try {
      await Promise.all([
        this.redisService.set(cacheKey, cacheData, this.CACHE_TTL_SECONDS),
        this.prismaService.transaction.create({
          data: {
            id: response.transactionId,
            hash: response.hash,
            status: response.status,
            to: dto.to,
            value: dto.value || "0",
            data: dto.data,
            createdAt: new Date(response.createdAt),
          },
        }),
      ]);

      this.logger.log(
        `Direct transaction stored: txId=${response.transactionId}, to=${dto.to}`,
      );
    } catch (error) {
      // Log but don't fail the request - OZ Relayer already accepted it
      this.logger.error(
        `Failed to store transaction ${response.transactionId}: ${error.message}`,
      );
    }

    return result;
  }
}

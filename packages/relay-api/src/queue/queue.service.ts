import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SqsAdapter } from "./sqs.adapter";
import { DirectTxRequestDto } from "../relay/dto/direct-tx-request.dto";
import { DirectTxResponseDto } from "../relay/dto/direct-tx-response.dto";
import { GaslessTxRequestDto } from "../relay/dto/gasless-tx-request.dto";
import { GaslessTxResponseDto } from "../relay/dto/gasless-tx-response.dto";

/**
 * QueueService - Transaction Queue Producer
 *
 * SPEC-QUEUE-001: AWS SQS Queue System - Producer Service
 *
 * Handles two-phase commit pattern for transaction queuing:
 * 1. Create transaction record with status="queued"
 * 2. Send message to SQS
 * 3. Rollback to status="failed" if SQS send fails
 *
 * Message format (Consumer Contract):
 * - transactionId: UUID from database
 * - type: "direct" | "gasless"
 * - request: Original DTO
 * - forwarderAddress: (gasless only) ERC2771Forwarder contract address
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsAdapter: SqsAdapter,
  ) {}

  /**
   * Queue a direct transaction for processing
   *
   * @param dto - Direct transaction request
   * @returns 202 response with transactionId and status="queued"
   * @throws ServiceUnavailableException if DB or SQS fails
   */
  async sendDirectTransaction(
    dto: DirectTxRequestDto,
  ): Promise<DirectTxResponseDto> {
    let transactionId: string;

    // Phase 1: Create transaction record with status="queued"
    try {
      const transaction = await this.prisma.transaction.create({
        data: {
          status: "queued",
          type: "direct",
          to: dto.to,
          value: dto.value || "0",
          data: dto.data,
          request: dto as any, // Store original request for consumer
          // SPEC-DLQ-001: Store retry strategy (default: false for backward compatibility)
          retryOnFailure: dto.retryOnFailure ?? false,
        },
      });

      transactionId = transaction.transactionId;

      this.logger.log(
        `Direct transaction created: txId=${transactionId}, to=${dto.to}`,
      );

      // Phase 2: Send to SQS
      try {
        await this.sqsAdapter.sendMessage({
          transactionId,
          type: "direct",
          request: dto,
          // SPEC-DLQ-001: Include retry strategy for DLQ Consumer
          retryOnFailure: dto.retryOnFailure ?? false,
        });

        this.logger.log(`Direct transaction queued: txId=${transactionId}`);

        // Return 202 response
        return {
          transactionId,
          transactionHash: null,
          status: "queued",
          createdAt: transaction.createdAt.toISOString(),
        };
      } catch (sqsError: unknown) {
        // Phase 3: Rollback - mark as failed
        const err = sqsError as Error;
        this.logger.error(
          `SQS send failed for txId=${transactionId}: ${err.message}`,
        );

        try {
          await this.prisma.transaction.update({
            where: { transactionId },
            data: {
              status: "failed",
              error_message: err.message,
            },
          });
        } catch (rollbackError: unknown) {
          // Log rollback failure but still throw the original SQS error
          // Transaction will remain in 'queued' state and can be cleaned up later
          const rbErr = rollbackError as Error;
          this.logger.error(
            `Rollback failed for txId=${transactionId}: ${rbErr.message}. ` +
              `Transaction remains in 'queued' state and may require manual cleanup.`,
          );
        }

        throw new ServiceUnavailableException(
          "Failed to queue transaction: SQS unavailable",
        );
      }
    } catch (dbError: unknown) {
      // DB creation failed - no rollback needed
      const err = dbError as Error;

      // If it's already a ServiceUnavailableException (from SQS error), rethrow
      if (dbError instanceof ServiceUnavailableException) {
        throw dbError;
      }

      this.logger.error(`DB creation failed: ${err.message}`);
      throw new ServiceUnavailableException(
        "Failed to create transaction record",
      );
    }
  }

  /**
   * Queue a gasless transaction for processing
   *
   * Pre-validation (signature, nonce, deadline) is done by GaslessService
   * before calling this method. This method only handles queuing.
   *
   * @param dto - Gasless transaction request (already validated)
   * @param forwarderAddress - ERC2771Forwarder contract address
   * @returns 202 response with transactionId and status="queued"
   * @throws ServiceUnavailableException if DB or SQS fails
   */
  async sendGaslessTransaction(
    dto: GaslessTxRequestDto,
    forwarderAddress: string,
  ): Promise<GaslessTxResponseDto> {
    let transactionId: string;

    // Phase 1: Create transaction record with status="queued"
    try {
      const transaction = await this.prisma.transaction.create({
        data: {
          status: "queued",
          type: "gasless",
          from: dto.request.from,
          to: forwarderAddress,
          value: "0", // Gasless transactions don't send value
          data: dto.request.data,
          request: dto as any, // Store original request for consumer
          // SPEC-DLQ-001: Store retry strategy (default: false for backward compatibility)
          retryOnFailure: dto.retryOnFailure ?? false,
        },
      });

      transactionId = transaction.transactionId;

      this.logger.log(
        `Gasless transaction created: txId=${transactionId}, from=${dto.request.from}`,
      );

      // Phase 2: Send to SQS
      try {
        await this.sqsAdapter.sendMessage({
          transactionId,
          type: "gasless",
          request: dto,
          forwarderAddress, // Consumer needs this to build execute() call
          // SPEC-DLQ-001: Include retry strategy for DLQ Consumer
          retryOnFailure: dto.retryOnFailure ?? false,
        });

        this.logger.log(`Gasless transaction queued: txId=${transactionId}`);

        // Return 202 response
        return {
          transactionId,
          transactionHash: null,
          status: "queued",
          createdAt: transaction.createdAt.toISOString(),
        };
      } catch (sqsError: unknown) {
        // Phase 3: Rollback - mark as failed
        const err = sqsError as Error;
        this.logger.error(
          `SQS send failed for txId=${transactionId}: ${err.message}`,
        );

        try {
          await this.prisma.transaction.update({
            where: { transactionId },
            data: {
              status: "failed",
              error_message: err.message,
            },
          });
        } catch (rollbackError: unknown) {
          // Log rollback failure but still throw the original SQS error
          // Transaction will remain in 'queued' state and can be cleaned up later
          const rbErr = rollbackError as Error;
          this.logger.error(
            `Rollback failed for txId=${transactionId}: ${rbErr.message}. ` +
              `Transaction remains in 'queued' state and may require manual cleanup.`,
          );
        }

        throw new ServiceUnavailableException(
          "Failed to queue transaction: SQS unavailable",
        );
      }
    } catch (dbError: unknown) {
      // DB creation failed - no rollback needed
      const err = dbError as Error;

      // If it's already a ServiceUnavailableException (from SQS error), rethrow
      if (dbError instanceof ServiceUnavailableException) {
        throw dbError;
      }

      this.logger.error(`DB creation failed: ${err.message}`);
      throw new ServiceUnavailableException(
        "Failed to create transaction record",
      );
    }
  }
}

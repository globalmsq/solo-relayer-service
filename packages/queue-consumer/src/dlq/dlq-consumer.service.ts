import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SqsAdapter } from "../sqs/sqs.adapter";
import { PrismaService } from "../prisma/prisma.service";

/**
 * DLQ Message Types (same as main consumer)
 */
interface DlqMessage {
  transactionId: string;
  type: "direct" | "gasless";
  request: unknown;
  forwarderAddress?: string;
  // SPEC-DLQ-001: Retry strategy flag
  retryOnFailure?: boolean;
}

/**
 * DlqConsumerService - Dead Letter Queue Processing
 *
 * SPEC-DLQ-001: DLQ Processing and Error Classification System
 *
 * Key Requirements:
 * - E-4: Poll DLQ at 10-second intervals (continuous polling, NOT Cron Job)
 * - E-5: Handle retryOnFailure flag (true: reprocess future, false: mark failed)
 * - E-6: Idempotency - skip already failed transactions
 * - U-2: Always delete DLQ messages after processing
 * - S-1: Main Consumer and DLQ Consumer run together in same process
 * - S-2/S-3: Maintain isRunning state for graceful shutdown
 *
 * Current Implementation:
 * - O-2: retryOnFailure=true is treated same as false (future: reprocessing logic)
 */
@Injectable()
export class DlqConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DlqConsumerService.name);
  private isRunning = false;
  private pollingTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly sqsAdapter: SqsAdapter,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * S-1: Start DLQ Consumer alongside Main Consumer
   */
  async onModuleInit() {
    this.logger.log("DLQ Consumer Service initialized");
    this.startPolling();
  }

  /**
   * S-3: Stop polling loop on module destroy
   */
  async onModuleDestroy() {
    this.logger.log("Received shutdown signal, stopping DLQ polling...");
    this.stopPolling();

    // Wait for any in-flight processing to complete
    await this.waitForInFlightProcessing(5000);
    this.logger.log("DLQ Consumer gracefully shut down");
  }

  /**
   * S-2: Start continuous polling loop
   * E-4: Poll at configurable intervals (default 10 seconds)
   */
  private startPolling(): void {
    this.isRunning = true;
    this.logger.log("Starting DLQ polling loop");
    this.poll();
  }

  /**
   * S-3: Stop polling by setting isRunning to false
   */
  private stopPolling(): void {
    this.isRunning = false;
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
  }

  /**
   * E-4: Continuous polling implementation
   * Uses setTimeout instead of setInterval for better control
   */
  private poll(): void {
    if (!this.isRunning) {
      return;
    }

    this.processDlqMessages()
      .catch((error: unknown) => {
        const err = error as Error;
        this.logger.error(`DLQ polling error: ${err.message}`, err.stack);
      })
      .finally(() => {
        if (this.isRunning) {
          const pollIntervalMs = this.configService.get<number>(
            "dlqConsumer.pollIntervalMs",
            10000,
          );
          this.pollingTimeout = setTimeout(() => this.poll(), pollIntervalMs);
        }
      });
  }

  /**
   * Process messages from DLQ
   *
   * Note: isRunning check is done in poll() method, not here.
   * This allows direct testing of message processing logic.
   * Graceful shutdown during batch processing is handled by poll() not scheduling
   * the next iteration when isRunning becomes false.
   */
  async processDlqMessages(): Promise<void> {
    const dlqUrl = this.configService.get<string>("sqs.dlqUrl");
    const waitTimeSeconds = this.configService.get<number>(
      "dlqConsumer.waitTimeSeconds",
      10,
    );
    const maxNumberOfMessages = this.configService.get<number>(
      "dlqConsumer.maxNumberOfMessages",
      10,
    );

    try {
      const messages = await this.sqsAdapter.receiveMessages(
        waitTimeSeconds,
        maxNumberOfMessages,
        dlqUrl,
      );

      if (!messages || messages.length === 0) {
        return;
      }

      this.logger.log(`Received ${messages.length} messages from DLQ`);

      for (const message of messages) {
        await this.handleDlqMessage(message);
      }
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `DLQ message processing error: ${err.message}`,
        err.stack,
      );
    }
  }

  /**
   * Handle individual DLQ message
   *
   * E-5: Check retryOnFailure flag:
   *   - true: Execute reprocessing logic (future implementation, currently same as false)
   *   - false/null: Mark transaction as 'failed' and delete DLQ message
   *
   * E-6: Idempotency - if transaction already 'failed', just delete message
   * U-2: Always delete DLQ message after processing
   * U-5: Check transaction status before processing for idempotency
   */
  private async handleDlqMessage(message: any): Promise<void> {
    const { MessageId, Body, ReceiptHandle } = message;
    const dlqUrl = this.configService.get<string>("sqs.dlqUrl");

    try {
      const messageBody: DlqMessage = JSON.parse(Body);
      const { transactionId, retryOnFailure } = messageBody;

      this.logger.log(
        `Processing DLQ message: txId=${transactionId}, retryOnFailure=${retryOnFailure ?? false}`,
      );

      // U-5: Check transaction status for idempotency
      const transaction = await this.prisma.transaction.findUnique({
        where: { transactionId },
      });

      // E-6: If transaction already in terminal state, just delete message
      if (transaction && ["confirmed", "failed"].includes(transaction.status)) {
        this.logger.log(
          `[Idempotency] Transaction ${transactionId} already in terminal state: ${transaction.status}, deleting DLQ message`,
        );
        await this.sqsAdapter.deleteMessage(ReceiptHandle, dlqUrl);
        return;
      }

      // E-5: Handle based on retryOnFailure flag
      if (retryOnFailure === true) {
        // O-2: Future implementation - reprocessing logic
        // Currently treated same as failure (as per spec O-2)
        this.logger.log(
          `[DLQ] retryOnFailure=true for ${transactionId} - marking as failed (reprocessing not yet implemented)`,
        );
        await this.markTransactionFailed(
          transactionId,
          "DLQ: Max retries exceeded (retryOnFailure=true, reprocessing not yet implemented)",
        );
      } else {
        // E-5: retryOnFailure=false/null - mark as failed immediately
        this.logger.log(
          `[DLQ] retryOnFailure=false for ${transactionId} - marking as failed`,
        );
        await this.markTransactionFailed(
          transactionId,
          "DLQ: Max retries exceeded",
        );
      }

      // U-2: Always delete DLQ message after processing
      await this.sqsAdapter.deleteMessage(ReceiptHandle, dlqUrl);
      this.logger.log(
        `[DLQ] Message processed and deleted: txId=${transactionId}`,
      );
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to process DLQ message ${MessageId}: ${err.message}`,
        err.stack,
      );

      // Even on error, try to mark transaction as failed and delete message
      // to prevent infinite loop
      try {
        const messageBody: DlqMessage = JSON.parse(Body);
        await this.markTransactionFailed(
          messageBody.transactionId,
          `DLQ processing error: ${err.message}`,
        );
        await this.sqsAdapter.deleteMessage(ReceiptHandle, dlqUrl);
        this.logger.warn(
          `[DLQ] Error recovery: marked as failed and deleted message for ${messageBody.transactionId}`,
        );
      } catch (recoveryError: unknown) {
        const recErr = recoveryError as Error;
        this.logger.error(
          `[DLQ] Error recovery failed: ${recErr.message}`,
          recErr.stack,
        );
        // UN-2: MUST NOT leave DLQ messages - attempt delete even if update failed
        try {
          await this.sqsAdapter.deleteMessage(ReceiptHandle, dlqUrl);
        } catch {
          // Last resort: log and let SQS visibility timeout handle it
          this.logger.error(
            `[DLQ] CRITICAL: Failed to delete message ${MessageId}, will retry after visibility timeout`,
          );
        }
      }
    }
  }

  /**
   * Mark transaction as failed in database
   */
  private async markTransactionFailed(
    transactionId: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.prisma.transaction.update({
        where: { transactionId },
        data: {
          status: "failed",
          error_message: errorMessage,
        },
      });
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to mark transaction ${transactionId} as failed: ${err.message}`,
      );
      throw error;
    }
  }

  /**
   * Wait for in-flight processing to complete
   */
  private async waitForInFlightProcessing(timeout: number): Promise<void> {
    // Simple implementation: just wait a short period
    // In a more complex implementation, we'd track active processing
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(timeout, 1000)),
    );
  }

  /**
   * Getter for testing purposes
   */
  get running(): boolean {
    return this.isRunning;
  }
}

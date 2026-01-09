import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqsAdapter } from './sqs/sqs.adapter';
import { OzRelayerClient } from './relay/oz-relayer.client';
import { RelayerRouterService } from './relay/relayer-router.service';
import { PrismaService } from './prisma/prisma.service';

/**
 * Queue Message Types
 */
interface DirectMessage {
  transactionId: string;
  type: 'direct';
  request: {
    to: string;
    data: string;
    value?: string;
    gasLimit?: string;
    speed?: string;
  };
}

interface GaslessMessage {
  transactionId: string;
  type: 'gasless';
  request: {
    request: {
      from: string;
      to: string;
      value: string;
      gas: string;
      nonce: string;
      deadline: string;
      data: string;
    };
    signature: string;
  };
  forwarderAddress: string;
}

type QueueMessage = DirectMessage | GaslessMessage;

/**
 * ConsumerService - SQS Message Processing with Fire-and-Forget Pattern
 *
 * SPEC-ROUTING-001: Smart Routing + Fire-and-Forget Implementation
 *
 * Key Changes from SPEC-QUEUE-001:
 * - FR-001: Smart Routing - Uses RelayerRouterService to select least busy relayer
 * - FR-002: Fire-and-Forget - No polling, immediate SQS delete after submission
 * - DC-004: Hash Field Separation - Consumer sets ozRelayerTxId only, NOT hash
 *
 * Flow:
 * 1. Receive SQS message
 * 2. Check idempotency (already processed or submitted)
 * 3. Smart Route to least busy relayer (via RelayerRouterService)
 * 4. Submit TX (Fire-and-Forget, no polling)
 * 5. Save ozRelayerTxId + ozRelayerUrl to DB
 * 6. Delete SQS message immediately
 * 7. Webhook handles status update (hash, confirmedAt)
 */
@Injectable()
export class ConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsumerService.name);
  private isShuttingDown = false;
  private processingTimeout: NodeJS.Timeout | null = null;

  constructor(
    private sqsAdapter: SqsAdapter,
    private relayerClient: OzRelayerClient,
    private relayerRouter: RelayerRouterService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    this.logger.log('Consumer Service initialized');
    this.startProcessing();
  }

  async onModuleDestroy() {
    this.logger.log('Received shutdown signal, stopping message processing...');
    this.isShuttingDown = true;

    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
    }

    // Wait for in-flight messages to complete (max 30 seconds)
    await this.waitForInFlightMessages(30000);
    this.logger.log('Consumer gracefully shut down');
  }

  private async waitForInFlightMessages(timeout: number): Promise<void> {
    // Placeholder: In full implementation, track in-flight messages
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  private startProcessing() {
    if (!this.isShuttingDown) {
      this.processMessages().catch((error: unknown) => {
        const err = error as Error;
        this.logger.error(
          `Error in message processing: ${err.message}`,
          err.stack,
        );
      });

      // Schedule next processing cycle after waiting
      this.processingTimeout = setTimeout(() => this.startProcessing(), 1000);
    }
  }

  async processMessages(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    try {
      const config = this.configService.get('consumer');
      const messages = await this.sqsAdapter.receiveMessages(
        config.waitTimeSeconds,
        config.maxNumberOfMessages,
      );

      if (!messages || messages.length === 0) {
        return;
      }

      for (const message of messages) {
        if (this.isShuttingDown) {
          this.logger.warn('Shutdown requested, stopping message processing');
          break;
        }

        await this.handleMessage(message);
      }
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Message processing error: ${err.message}`, err.stack);
    }
  }

  /**
   * Handle individual SQS message with Fire-and-Forget pattern
   *
   * SPEC-ROUTING-001 Implementation:
   * - FR-001: Smart Routing via RelayerRouterService
   * - FR-002: Fire-and-Forget (no polling)
   * - FR-004: Idempotency (check ozRelayerTxId)
   * - DC-004: Hash Field Separation (Consumer sets ozRelayerTxId only)
   */
  private async handleMessage(message: any): Promise<void> {
    const { MessageId, Body, ReceiptHandle } = message;

    try {
      const messageBody: QueueMessage = JSON.parse(Body);
      const { transactionId, type } = messageBody;

      this.logger.log(`Processing message: ${transactionId} (${type})`);

      // Check if transaction already processed (idempotent)
      const transaction = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
      });

      if (transaction && ['confirmed', 'failed'].includes(transaction.status)) {
        this.logger.log(
          `Transaction already in terminal state: ${transaction.status}, deleting message`,
        );
        await this.sqsAdapter.deleteMessage(ReceiptHandle);
        return;
      }

      // FR-004: Idempotency - Check if TX was already submitted to OZ Relayer
      // If ozRelayerTxId exists, TX was submitted but SQS delete failed
      // Fire-and-Forget: Just delete SQS message, Webhook will handle status update
      if (transaction?.ozRelayerTxId) {
        this.logger.log(
          `[Fire-and-Forget] Transaction ${transactionId} already submitted (${transaction.ozRelayerTxId}), deleting SQS message`,
        );
        await this.sqsAdapter.deleteMessage(ReceiptHandle);
        return;
      }

      // Mark as processing to prevent race conditions
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'processing' },
      });

      // FR-001: Smart Routing - Get least busy relayer
      const { url: relayerUrl, relayerId } =
        await this.relayerRouter.getAvailableRelayer();
      this.logger.log(`[Smart Routing] Selected relayer: ${relayerUrl}`);

      // FR-002: Fire-and-Forget - Send TX and return immediately
      let result: { transactionId: string; relayerUrl: string };

      if (type === 'direct') {
        const directMessage = messageBody as DirectMessage;
        result = await this.relayerClient.sendDirectTransactionAsync(
          directMessage.request,
          relayerUrl,
          relayerId, // Optimization: Pass relayerId to avoid redundant API call
        );
      } else if (type === 'gasless') {
        const gaslessMessage = messageBody as GaslessMessage;
        result = await this.relayerClient.sendGaslessTransactionAsync(
          gaslessMessage.request,
          gaslessMessage.forwarderAddress,
          relayerUrl,
          relayerId, // Optimization: Pass relayerId to avoid redundant API call
        );
      } else {
        throw new Error(`Unknown transaction type: ${type}`);
      }

      // DC-004: Hash Field Separation
      // Consumer ONLY sets: ozRelayerTxId, ozRelayerUrl, status='submitted'
      // Consumer does NOT set: hash (Webhook will set this)
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: 'submitted', // NOT 'confirmed' - Webhook will update to confirmed
          ozRelayerTxId: result.transactionId,
          ozRelayerUrl: result.relayerUrl, // DC-005: Track which relayer handled TX
          // hash: undefined - DO NOT set hash here, Webhook is source of truth
        },
      });

      // FR-002: Delete SQS message immediately (Fire-and-Forget)
      await this.sqsAdapter.deleteMessage(ReceiptHandle);

      this.logger.log(
        `[Fire-and-Forget] Message processed: ${transactionId} -> ${result.transactionId} (Webhook will update status)`,
      );
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to process message ${MessageId}: ${err.message}`,
        err.stack,
      );

      // Message will be automatically returned to queue due to visibility timeout
      // SQS will retry up to maxReceiveCount times before moving to DLQ
    }
  }
}

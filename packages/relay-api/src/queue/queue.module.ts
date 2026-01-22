import { Module } from "@nestjs/common";
import { QueueService } from "./queue.service";
import { SqsAdapter } from "./sqs.adapter";
import { PrismaModule } from "../prisma/prisma.module";

/**
 * QueueModule - Transaction Queue Producer Module
 *
 * SPEC-QUEUE-001: AWS SQS Queue System
 *
 * Provides QueueService for DirectService and GaslessService
 * to queue transactions for async processing by queue-consumer.
 */
@Module({
  imports: [PrismaModule],
  providers: [QueueService, SqsAdapter],
  exports: [QueueService],
})
export class QueueModule {}

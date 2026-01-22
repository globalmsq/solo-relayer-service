import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DlqConsumerService } from "./dlq-consumer.service";
import { SqsAdapter } from "../sqs/sqs.adapter";
import { PrismaService } from "../prisma/prisma.service";

/**
 * DLQ Consumer Module
 *
 * SPEC-DLQ-001: Dead Letter Queue Processing Module
 *
 * S-1: This module runs alongside the main ConsumerModule in the same process.
 * It provides DLQ processing capabilities with continuous polling.
 *
 * Dependencies:
 * - SqsAdapter: Shared SQS client for receiving/deleting DLQ messages
 * - PrismaService: Database access for transaction status updates
 * - ConfigModule: Configuration for DLQ polling settings
 */
@Module({
  imports: [ConfigModule],
  providers: [DlqConsumerService, SqsAdapter, PrismaService],
  exports: [DlqConsumerService],
})
export class DlqConsumerModule {}

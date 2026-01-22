import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ConsumerService } from './consumer.service';
import { SqsAdapter } from './sqs/sqs.adapter';
import { OzRelayerClient } from './relay/oz-relayer.client';
import { RelayerRouterService } from './relay/relayer-router.service';
import { PrismaService } from './prisma/prisma.service';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { ErrorClassifierService } from './errors';
import { DlqConsumerService } from './dlq';
import configuration from './config/configuration';

/**
 * Consumer Module
 *
 * SPEC-DLQ-001 S-1: Main Consumer and DLQ Consumer run together in same process.
 * Both services are registered as providers and start on module initialization.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
    HttpModule,
    HealthModule,
    RedisModule, // SPEC-DISCOVERY-001 Phase 2: Redis for active relayer discovery
  ],
  providers: [
    ConsumerService,
    SqsAdapter,
    OzRelayerClient,
    RelayerRouterService,
    PrismaService,
    ErrorClassifierService,
    // SPEC-DLQ-001 S-1: DLQ Consumer runs alongside Main Consumer
    DlqConsumerService,
  ],
})
export class ConsumerModule {}

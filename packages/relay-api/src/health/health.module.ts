import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller";
import { RedisHealthIndicator, SqsHealthIndicator } from "./indicators";

/**
 * HealthModule - Health check endpoints
 *
 * SPEC-DISCOVERY-001: OzRelayerHealthIndicator and HealthService removed
 * Health checks now only monitor Redis and SQS (queue-based architecture)
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, SqsHealthIndicator],
  exports: [RedisHealthIndicator, SqsHealthIndicator],
})
export class HealthModule {}

import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller";
import { OzRelayerHealthIndicator, RedisHealthIndicator } from "./indicators";

@Module({
  imports: [HttpModule, TerminusModule],
  controllers: [HealthController],
  providers: [OzRelayerHealthIndicator, RedisHealthIndicator],
  exports: [OzRelayerHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}

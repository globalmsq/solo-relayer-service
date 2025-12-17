import { Injectable } from "@nestjs/common";
import { HealthIndicator, HealthIndicatorResult } from "@nestjs/terminus";

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  /**
   * Check Redis health
   * Phase 1: Placeholder - always returns healthy
   * Phase 2+: Will integrate actual Redis client connectivity check (PING command)
   *
   * @param key - Health indicator key (e.g., 'redis')
   * @returns HealthIndicatorResult with healthy status
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const isHealthy = true;

    return this.getStatus(key, isHealthy, {
      status: "healthy",
      message: "Phase 1: Redis connectivity not implemented",
    });
  }
}

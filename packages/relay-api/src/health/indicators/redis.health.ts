import { Injectable } from "@nestjs/common";
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from "@nestjs/terminus";
import { RedisService } from "../../redis/redis.service";

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  /**
   * Check Redis health by performing actual PING command
   *
   * @param key - Health indicator key (e.g., 'redis')
   * @returns HealthIndicatorResult with actual Redis connectivity status
   * @throws HealthCheckError when Redis is not reachable
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const isHealthy = await this.redisService.healthCheck();

      if (isHealthy) {
        return this.getStatus(key, true, { status: "up" });
      }

      throw new HealthCheckError(
        "Redis health check failed",
        this.getStatus(key, false, { status: "down" }),
      );
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      throw new HealthCheckError(
        `Redis health check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        this.getStatus(key, false, { status: "down" }),
      );
    }
  }
}

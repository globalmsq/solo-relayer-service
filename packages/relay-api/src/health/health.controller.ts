import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { Public } from "../auth/decorators/public.decorator";
import {
  OzRelayerHealthIndicator,
  RedisHealthIndicator,
  SqsHealthIndicator,
} from "./indicators";

@Controller()
@ApiTags("Health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly ozRelayerHealth: OzRelayerHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly sqsHealth: SqsHealthIndicator,
  ) {}

  /**
   * Get system health status
   * Returns health status using @nestjs/terminus standard pattern
   * Checks OZ Relayer Pool (3 instances) and Redis
   *
   * @returns Health check result with status and service details
   */
  @Get("health")
  @Public()
  @HealthCheck()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get system health status",
    description:
      "Returns the health status of OZ Relayer Pool (3 instances) and Redis using @nestjs/terminus standard pattern.",
  })
  @ApiResponse({
    status: 200,
    description: "Health check successful - all services healthy",
    schema: {
      example: {
        status: "ok",
        info: {
          "oz-relayer-pool": {
            status: "healthy",
            healthyCount: 3,
            totalCount: 3,
            relayers: [
              {
                id: "oz-relayer-0",
                url: "http://oz-relayer-0:8080/api/v1/health",
                status: "healthy",
                responseTime: 45,
              },
              {
                id: "oz-relayer-1",
                url: "http://oz-relayer-1:8080/api/v1/health",
                status: "healthy",
                responseTime: 52,
              },
              {
                id: "oz-relayer-2",
                url: "http://oz-relayer-2:8080/api/v1/health",
                status: "healthy",
                responseTime: 48,
              },
            ],
          },
          redis: {
            status: "healthy",
            message: "Phase 1: Redis connectivity not implemented",
          },
        },
        error: {},
        details: {
          "oz-relayer-pool": {
            status: "healthy",
            healthyCount: 3,
            totalCount: 3,
            relayers: [
              {
                id: "oz-relayer-0",
                url: "http://oz-relayer-0:8080/api/v1/health",
                status: "healthy",
                responseTime: 45,
              },
              {
                id: "oz-relayer-1",
                url: "http://oz-relayer-1:8080/api/v1/health",
                status: "healthy",
                responseTime: 52,
              },
              {
                id: "oz-relayer-2",
                url: "http://oz-relayer-2:8080/api/v1/health",
                status: "healthy",
                responseTime: 48,
              },
            ],
          },
          redis: {
            status: "healthy",
            message: "Phase 1: Redis connectivity not implemented",
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: "Service unavailable - critical services down",
  })
  async check() {
    return this.health.check([
      () => this.ozRelayerHealth.isHealthy("oz-relayer-pool"),
      () => this.redisHealth.isHealthy("redis"),
      () => this.sqsHealth.isHealthy("sqs"),
    ]);
  }

  /**
   * Get Relayer Pool status (Optional detailed endpoint)
   * Returns detailed health and status of OZ Relayer Pool (3 instances)
   * Provides granular debugging information beyond standard health check
   *
   * @returns Relayer pool health status with detailed information
   */
  @Get("relay/pool-status")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get Relayer Pool status",
    description:
      "Returns detailed health and status of OZ Relayer Pool (3 instances). Provides granular debugging information.",
  })
  @ApiResponse({
    status: 200,
    description: "Relayer pool status retrieved successfully",
  })
  async getRelayerPoolStatus() {
    const result = await this.ozRelayerHealth
      .isHealthy("oz-relayer-pool")
      .catch((error) => {
        return error.causes;
      });

    // Handle both successful and error results
    const poolData = result["oz-relayer-pool"] || result;

    return {
      success: true,
      data: poolData,
      timestamp: new Date().toISOString(),
    };
  }
}

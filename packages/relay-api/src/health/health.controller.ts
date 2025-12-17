import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/decorators/public.decorator";
import { HealthService } from "./health.service";

@Controller()
@ApiTags("Health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Get system health status
   * Returns health of API Gateway, OZ Relayer Pool, and Redis
   *
   * @returns Health status object with service details
   */
  @Get("health")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get system health status",
    description:
      "Returns the health status of API Gateway, OZ Relayer Pool (3 instances), and Redis. " +
      "Overall status is: healthy (all services healthy), " +
      "degraded (some services unhealthy), or " +
      "unhealthy (critical services down).",
  })
  @ApiResponse({
    status: 200,
    description: "Health status retrieved successfully",
    schema: {
      example: {
        status: "healthy",
        timestamp: "2025-12-16T10:30:00.000Z",
        services: {
          "relay-api": "healthy",
          "oz-relayer-pool": {
            status: "healthy",
            healthyCount: 3,
            totalCount: 3,
            relayers: [
              {
                id: "oz-relayer-1",
                url: "http://oz-relayer-1:8080/api/v1/health",
                status: "healthy",
                responseTime: 45,
              },
              {
                id: "oz-relayer-2",
                url: "http://oz-relayer-2:8080/api/v1/health",
                status: "healthy",
                responseTime: 52,
              },
              {
                id: "oz-relayer-3",
                url: "http://oz-relayer-3:8080/api/v1/health",
                status: "healthy",
                responseTime: 48,
              },
            ],
          },
          redis: "healthy",
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: "Service unavailable - critical services down",
  })
  async getHealth() {
    const health = await this.healthService.getSystemHealth();

    // Return appropriate status code based on health status
    if (health.status === "unhealthy") {
      // Return 503 for unhealthy status
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        ...health,
      };
    }

    return health;
  }

  /**
   * Get Relayer Pool status
   * Returns detailed status of each relayer in the pool
   *
   * @returns Relayer pool health status
   */
  @Get("relay/pool-status")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get Relayer Pool status",
    description:
      "Returns detailed health and status of OZ Relayer Pool (3 instances)",
  })
  @ApiResponse({
    status: 200,
    description: "Relayer pool status retrieved successfully",
  })
  async getRelayerPoolStatus() {
    const poolStatus = await this.healthService.checkRelayerPoolHealth();
    return {
      success: true,
      data: poolStatus,
      timestamp: new Date().toISOString(),
    };
  }
}

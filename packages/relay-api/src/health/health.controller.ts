import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { Public } from "../auth/decorators/public.decorator";
import { RedisHealthIndicator, SqsHealthIndicator } from "./indicators";

/**
 * HealthController - System health check endpoints
 *
 * SPEC-DISCOVERY-001: OZ Relayer health check removed
 * Health checks now monitor Redis and SQS only (queue-based architecture)
 */
@Controller()
@ApiTags("Health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly sqsHealth: SqsHealthIndicator,
  ) {}

  /**
   * Get system health status
   * Returns health status using @nestjs/terminus standard pattern
   * Checks Redis and SQS connectivity
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
      "Returns the health status of Redis and SQS using @nestjs/terminus standard pattern.",
  })
  @ApiResponse({
    status: 200,
    description: "Health check successful - all services healthy",
    schema: {
      example: {
        status: "ok",
        info: {
          redis: {
            status: "up",
          },
          sqs: {
            status: "up",
            queueUrl: "http://localstack:4566/000000000000/relay-transactions",
            approximateMessages: 0,
          },
        },
        error: {},
        details: {
          redis: {
            status: "up",
          },
          sqs: {
            status: "up",
            queueUrl: "http://localstack:4566/000000000000/relay-transactions",
            approximateMessages: 0,
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
      () => this.redisHealth.isHealthy("redis"),
      () => this.sqsHealth.isHealthy("sqs"),
    ]);
  }
}

import { Controller, Get } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from "@nestjs/terminus";

/**
 * Health Controller for Queue Consumer Service
 *
 * SPEC-QUEUE-001: Basic health endpoint for Docker HEALTHCHECK
 * - Returns 200 OK when service is running
 * - Checks memory heap usage to ensure service is responsive
 */
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  /**
   * Health check endpoint
   * Docker HEALTHCHECK calls: curl -f http://localhost:3001/health
   */
  @Get("health")
  @HealthCheck()
  check() {
    return this.health.check([
      // Check heap memory usage (threshold: 512MB)
      () => this.memory.checkHeap("memory_heap", 512 * 1024 * 1024),
    ]);
  }
}

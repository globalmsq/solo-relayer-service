import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from "@nestjs/terminus";
import { firstValueFrom, timeout, catchError } from "rxjs";

export interface RelayerHealth {
  id: string;
  url: string;
  status: "healthy" | "unhealthy";
  responseTime?: number;
  error?: string;
}

export interface PoolHealthDetail {
  status: "healthy" | "degraded" | "unhealthy";
  healthyCount: number;
  totalCount: number;
  relayers: RelayerHealth[];
}

@Injectable()
export class OzRelayerHealthIndicator extends HealthIndicator {
  private readonly relayerEndpoints = [
    {
      id: "oz-relayer-1",
      url: "http://oz-relayer-1:8080/api/v1/health",
      apiKey:
        process.env.OZ_RELAYER_1_API_KEY ||
        "test-api-key-relayer-1-local-dev-32ch",
    },
    {
      id: "oz-relayer-2",
      url: "http://oz-relayer-2:8080/api/v1/health",
      apiKey:
        process.env.OZ_RELAYER_2_API_KEY ||
        "test-api-key-relayer-2-local-dev-32ch",
    },
    {
      id: "oz-relayer-3",
      url: "http://oz-relayer-3:8080/api/v1/health",
      apiKey:
        process.env.OZ_RELAYER_3_API_KEY ||
        "test-api-key-relayer-3-local-dev-32ch",
    },
  ];

  constructor(private readonly httpService: HttpService) {
    super();
  }

  /**
   * Check OZ Relayer Pool health
   * Returns aggregated status of all 3 relayer instances
   * Throws HealthCheckError if pool is degraded or unhealthy
   *
   * @param key - Health indicator key (e.g., 'oz-relayer-pool')
   * @returns HealthIndicatorResult with pool status
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const results = await Promise.all(
      this.relayerEndpoints.map((endpoint) =>
        this.checkSingleRelayer(endpoint),
      ),
    );

    const healthyCount = results.filter((r) => r.status === "healthy").length;
    const totalCount = results.length;
    const status = this.aggregateStatus(healthyCount, totalCount);
    const isHealthy = status === "healthy";

    const poolDetail: PoolHealthDetail = {
      status,
      healthyCount,
      totalCount,
      relayers: results,
    };

    const result = this.getStatus(key, isHealthy, poolDetail);

    if (!isHealthy) {
      throw new HealthCheckError("OZ Relayer Pool health check failed", result);
    }

    return result;
  }

  /**
   * Check single relayer instance health
   * Includes 5-second timeout and response time measurement
   *
   * @param endpoint - Relayer endpoint configuration
   * @returns RelayerHealth with status and timing information
   */
  private async checkSingleRelayer(endpoint: {
    id: string;
    url: string;
    apiKey: string;
  }): Promise<RelayerHealth> {
    const startTime = Date.now();

    try {
      await firstValueFrom(
        this.httpService
          .get(endpoint.url, {
            headers: {
              Authorization: `Bearer ${endpoint.apiKey}`,
            },
          })
          .pipe(
            timeout(5000), // 5-second timeout per relayer
            catchError((err) => {
              throw err;
            }),
          ),
      );

      return {
        id: endpoint.id,
        url: endpoint.url,
        status: "healthy",
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        id: endpoint.id,
        url: endpoint.url,
        status: "unhealthy",
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Aggregate pool status based on healthy relayer count
   * - healthy: all relayers responding
   * - degraded: some relayers responding
   * - unhealthy: no relayers responding
   *
   * @param healthyCount - Number of healthy relayers
   * @param totalCount - Total number of relayers
   * @returns Aggregated pool status
   */
  private aggregateStatus(
    healthyCount: number,
    totalCount: number,
  ): "healthy" | "degraded" | "unhealthy" {
    if (healthyCount === totalCount) return "healthy";
    if (healthyCount > 0) return "degraded";
    return "unhealthy";
  }
}

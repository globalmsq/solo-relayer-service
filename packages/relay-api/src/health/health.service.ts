import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom, timeout, catchError } from "rxjs";

export interface RelayerHealth {
  id: string;
  url: string;
  status: "healthy" | "unhealthy";
  responseTime?: number;
  error?: string;
}

export interface PoolHealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  healthyCount: number;
  totalCount: number;
  relayers: RelayerHealth[];
}

export interface HealthCheckResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  services: {
    "relay-api": string;
    "oz-relayer-pool": PoolHealthStatus | string;
    redis: string;
  };
}

@Injectable()
export class HealthService {
  private readonly relayerEndpoints = [
    {
      id: "oz-relayer-1",
      url: "http://oz-relayer-1:8080/api/v1/health",
      apiKey: "test-api-key-relayer-1-local-dev-32ch",
    },
    {
      id: "oz-relayer-2",
      url: "http://oz-relayer-2:8080/api/v1/health",
      apiKey: "test-api-key-relayer-2-local-dev-32ch",
    },
    {
      id: "oz-relayer-3",
      url: "http://oz-relayer-3:8080/api/v1/health",
      apiKey: "test-api-key-relayer-3-local-dev-32ch",
    },
  ];

  // Redis endpoint (will use constructor injection in production)
  private readonly redisHost = process.env.REDIS_HOST || "redis";
  private readonly redisPort = parseInt(process.env.REDIS_PORT || "6379", 10);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Check health of Relayer Pool (3 instances)
   * Returns aggregated status:
   * - healthy: all relayers healthy
   * - degraded: some relayers healthy
   * - unhealthy: no relayers healthy
   */
  async checkRelayerPoolHealth(): Promise<PoolHealthStatus> {
    const results = await Promise.all(
      this.relayerEndpoints.map((endpoint) =>
        this.checkSingleRelayer(endpoint),
      ),
    );

    const healthyCount = results.filter((r) => r.status === "healthy").length;
    const totalCount = results.length;

    return {
      status: this.aggregateStatus(healthyCount, totalCount),
      healthyCount,
      totalCount,
      relayers: results,
    };
  }

  /**
   * Check single Relayer health
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
            timeout(5000), // 5 second timeout
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
   * Aggregate pool status based on healthy count
   */
  private aggregateStatus(
    healthyCount: number,
    totalCount: number,
  ): "healthy" | "degraded" | "unhealthy" {
    if (healthyCount === totalCount) return "healthy";
    if (healthyCount > 0) return "degraded";
    return "unhealthy";
  }

  /**
   * Check Redis health (basic connectivity)
   */
  async checkRedisHealth(): Promise<string> {
    try {
      // This is a placeholder - in production, use actual Redis client
      // For now, we assume Redis is healthy if reachable via compose network
      return "healthy";
    } catch (error) {
      return "unhealthy";
    }
  }

  /**
   * Get overall system health status
   */
  async getSystemHealth(): Promise<HealthCheckResponse> {
    const [relayerPool, redis] = await Promise.all([
      this.checkRelayerPoolHealth(),
      this.checkRedisHealth(),
    ]);

    // Determine overall status
    let overallStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (relayerPool.status === "unhealthy" || redis === "unhealthy") {
      overallStatus = "unhealthy";
    } else if (relayerPool.status === "degraded" || redis === "degraded") {
      overallStatus = "degraded";
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        "relay-api": "healthy",
        "oz-relayer-pool": relayerPool,
        redis: redis,
      },
    };
  }
}

import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from "@nestjs/terminus";
import { firstValueFrom } from "rxjs";

/**
 * OzRelayerHealthIndicator - Health check for OZ Relayer connectivity
 *
 * SPEC-PROXY-001: OZ Relayer Health Check
 * - Supports both direct relayer connection and Nginx LB
 * - Uses /api/v1/relayers endpoint with Bearer token authentication
 * - Works with single relayer (oz-relayer-1) or load balancer (oz-relayer-lb)
 *
 * Health Check Strategy:
 * - Direct Relayer: GET /api/v1/relayers with Authorization header
 * - Nginx LB: GET /health (no auth required)
 */
@Injectable()
export class OzRelayerHealthIndicator extends HealthIndicator {
  private readonly relayerUrl: string;
  private readonly relayerApiKey: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.relayerUrl = this.configService.get<string>(
      "OZ_RELAYER_URL",
      "http://oz-relayer-lb:8080",
    );
    this.relayerApiKey = this.configService.get<string>(
      "OZ_RELAYER_API_KEY",
      "oz-relayer-shared-api-key-local-dev",
    );
  }

  /**
   * Check OZ Relayer health using /api/v1/relayers endpoint
   *
   * This endpoint works for both:
   * - Direct relayer connection (requires Bearer token)
   * - Nginx LB (forwards with proper auth)
   *
   * @param key - Health indicator key (e.g., 'oz-relayer-pool')
   * @returns HealthIndicatorResult with relayer status
   * @throws HealthCheckError if relayer is unavailable
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.relayerUrl}/api/v1/relayers`, {
          headers: {
            Authorization: `Bearer ${this.relayerApiKey}`,
          },
          timeout: 5000,
        }),
      );

      if (response.status === 200 && response.data?.success) {
        const relayerCount = response.data.data?.length || 0;
        return this.getStatus(key, true, {
          url: this.relayerUrl,
          responseTime: Date.now() - startTime,
          relayerCount,
        });
      }

      // Handle non-200 or unsuccessful responses
      return this.getStatus(key, false, {
        url: this.relayerUrl,
        responseTime: Date.now() - startTime,
        error: `Unexpected response: ${response.status}`,
      });
    } catch (error) {
      throw new HealthCheckError(
        "OZ Relayer health check failed",
        this.getStatus(key, false, {
          url: this.relayerUrl,
          responseTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
  }
}

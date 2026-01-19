import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { RedisService } from "./redis.service";
import { StatusResponse } from "../dto/status-response.dto";
import { firstValueFrom } from "rxjs";

@Injectable()
export class DiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryService.name);
  private interval: NodeJS.Timeout | null = null;
  private lastCheckTimestamps: Map<string, string> = new Map();

  private readonly relayerCount: number;
  private readonly healthCheckInterval: number;
  private readonly healthCheckTimeout: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.relayerCount = this.configService.get<number>(
      "discovery.relayerCount",
    )!;
    this.healthCheckInterval = this.configService.get<number>(
      "discovery.healthCheckInterval",
    )!;
    this.healthCheckTimeout = this.configService.get<number>(
      "discovery.healthCheckTimeout",
    )!;
  }

  async onModuleInit(): Promise<void> {
    this.logger.log("Initializing DiscoveryService");
    await this.startHealthCheckLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log("Shutting down DiscoveryService");
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async startHealthCheckLoop(): Promise<void> {
    // Run immediately on startup
    await this.performHealthChecks();

    // Schedule periodic checks
    this.interval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.healthCheckInterval);
  }

  private async performHealthChecks(): Promise<void> {
    const relayerIds = this.generateRelayerIds();

    const results = await Promise.allSettled(
      relayerIds.map((id) => this.checkRelayerHealth(id)),
    );

    for (let i = 0; i < relayerIds.length; i++) {
      const relayerId = relayerIds[i];
      const result = results[i];

      // Update timestamp regardless of health status
      this.lastCheckTimestamps.set(relayerId, new Date().toISOString());

      if (result.status === "fulfilled" && result.value === true) {
        await this.addActiveRelayer(relayerId);
      } else {
        await this.removeActiveRelayer(relayerId);
      }
    }
  }

  private async checkRelayerHealth(relayerId: string): Promise<boolean> {
    const url = this.constructHealthUrl(relayerId);

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: this.healthCheckTimeout,
        }),
      );

      const isHealthy = response.status === 200;

      if (isHealthy) {
        this.logger.debug(`Health check passed for ${relayerId}`);
      } else {
        this.logger.warn(
          `Health check failed for ${relayerId}: HTTP ${response.status}`,
        );
      }

      return isHealthy;
    } catch (error: any) {
      this.logger.warn(
        `Health check failed for ${relayerId}: ${error.message || error.code || "unknown error"}`,
      );
      return false;
    }
  }

  private async addActiveRelayer(relayerId: string): Promise<void> {
    const result = await this.redisService.sadd("relayer:active", relayerId);

    if (result === 1) {
      this.logger.log(`Added ${relayerId} to active list`);
    }
  }

  private async removeActiveRelayer(relayerId: string): Promise<void> {
    const result = await this.redisService.srem("relayer:active", relayerId);

    if (result === 1) {
      this.logger.warn(`Removed ${relayerId} from active list`);
    }
  }

  async getStatus(): Promise<StatusResponse> {
    const activeRelayerIds = await this.redisService.smembers("relayer:active");
    const totalActive = activeRelayerIds.length;

    return {
      service: "relayer-discovery",
      status: this.determineOverallStatus(totalActive),
      timestamp: new Date().toISOString(),
      activeRelayers: activeRelayerIds.map((id) => ({
        id,
        status: "healthy",
        lastCheckTimestamp: this.lastCheckTimestamps.get(id) || null,
        url: this.constructHealthUrl(id).replace("/health", ""),
      })),
      totalConfigured: this.relayerCount,
      totalActive,
      healthCheckInterval: this.healthCheckInterval,
    };
  }

  private generateRelayerIds(): string[] {
    return Array.from(
      { length: this.relayerCount },
      (_, i) => `oz-relayer-${i}`,
    );
  }

  private constructHealthUrl(relayerId: string): string {
    return `http://${relayerId}:3000/health`;
  }

  private determineOverallStatus(
    totalActive: number,
  ): "healthy" | "degraded" | "unhealthy" {
    if (totalActive >= this.relayerCount) {
      return "healthy";
    } else if (totalActive > 0) {
      return "degraded";
    } else {
      return "unhealthy";
    }
  }
}

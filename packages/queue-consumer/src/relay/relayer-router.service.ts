import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosError } from "axios";
import { RedisService } from "../redis/redis.service";

/**
 * Relayer health and load information
 */
interface RelayerInfo {
  url: string;
  relayerId: string | null;
  numberOfPendingTransactions: number;
  healthy: boolean;
  lastChecked: number;
}

/**
 * RelayerRouterService - Smart Routing for Multi-Relayer Pool
 *
 * SPEC-ROUTING-001 FR-001: Smart Routing - Relayer Selection
 * - Query all OZ Relayers for pending transaction count
 * - Select the relayer with the lowest numberOfPendingTransactions
 * - Fall back to round-robin if health check fails for any relayer
 * - Skip unhealthy relayers (health check failure)
 *
 * SPEC-DISCOVERY-001 Phase 2: Dynamic Relayer Discovery
 * - Query Redis 'relayer:active' Set for active relayer list
 * - Dynamically construct relayer URLs from Redis data
 * - Fall back to environment config if Redis unavailable
 *
 * NFR-001: Smart Router Performance
 * - Complete relayer selection within 100ms
 * - Cache relayer health status for 10 seconds
 * - Fail fast (skip) if relayer health check takes >500ms
 */
@Injectable()
export class RelayerRouterService implements OnModuleInit {
  private readonly logger = new Logger(RelayerRouterService.name);
  private readonly apiKey: string;

  // Fallback relayer URLs from environment config
  private readonly fallbackRelayerUrls: string[];

  // SPEC-DISCOVERY-001: Redis key for active relayer list
  private readonly REDIS_ACTIVE_RELAYERS_KEY = "relayer:active";

  // SPEC-DISCOVERY-001: Relayer port for URL construction
  private readonly RELAYER_PORT = 8080;

  // NFR-001: Health check caching (10 second TTL)
  private readonly CACHE_TTL_MS = 10000;
  private readonly HEALTH_CHECK_TIMEOUT_MS = 500;

  // SPEC-DISCOVERY-001: Active relayers cache TTL (2 second)
  private readonly ACTIVE_RELAYERS_CACHE_TTL_MS = 2000;

  // Relayer cache: url -> RelayerInfo
  private relayerCache: Map<string, RelayerInfo> = new Map();

  // Round-robin index for fallback mode
  private roundRobinIndex = 0;

  // Current active relayer URLs (from Redis or fallback)
  private currentRelayerUrls: string[] = [];

  // SPEC-DISCOVERY-001: Cache timestamp for active relayers list
  private activeRelayersCacheTime: number = 0;

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
  ) {
    const urlsConfig = this.configService.get<string>("relayer.urls") || "";
    const singleUrl =
      this.configService.get<string>("relayer.url") || "http://localhost:8081";

    // Parse comma-separated URLs as fallback when Redis is unavailable
    this.fallbackRelayerUrls = urlsConfig
      ? urlsConfig.split(",").map((url) => url.trim())
      : [singleUrl];

    this.apiKey =
      this.configService.get<string>("relayer.apiKey") ||
      "oz-relayer-shared-api-key-local-dev";

    // Initialize with fallback URLs until Redis is available
    this.currentRelayerUrls = [...this.fallbackRelayerUrls];

    this.logger.log(
      `RelayerRouterService initialized with fallback relayers: ${this.fallbackRelayerUrls.join(", ")}`,
    );
  }

  async onModuleInit(): Promise<void> {
    // Try to refresh relayer URLs from Redis on startup
    await this.refreshRelayerUrlsFromRedis();
  }

  /**
   * SPEC-DISCOVERY-001 Phase 2: Refresh relayer URLs from Redis
   *
   * Queries Redis 'relayer:active' Set for active relayer hostnames
   * and constructs URLs. Falls back to environment config if Redis unavailable.
   *
   * Uses 2-second in-memory cache to reduce Redis calls at high TPS.
   * At 100 TPS, this reduces Redis calls from 1000/10s to ~5/10s.
   */
  private async refreshRelayerUrlsFromRedis(): Promise<void> {
    const now = Date.now();

    // Return early if cache is still valid and we have URLs
    if (
      now - this.activeRelayersCacheTime < this.ACTIVE_RELAYERS_CACHE_TTL_MS &&
      this.currentRelayerUrls.length > 0
    ) {
      return;
    }

    try {
      // Query Redis for active relayers
      const activeRelayers = await this.redisService.smembers(
        this.REDIS_ACTIVE_RELAYERS_KEY,
      );

      if (activeRelayers.length > 0) {
        // Construct URLs from Redis hostnames (e.g., oz-relayer-0 -> http://oz-relayer-0:8080)
        this.currentRelayerUrls = activeRelayers
          .sort() // Sort for consistent ordering
          .map((hostname) => `http://${hostname}:${this.RELAYER_PORT}`);

        // Update cache timestamp on success
        this.activeRelayersCacheTime = now;

        this.logger.log(
          `Refreshed relayer URLs from Redis: ${this.currentRelayerUrls.join(", ")}`,
        );
      } else {
        // No active relayers in Redis, use fallback
        this.logger.warn(
          "No active relayers found in Redis, using fallback URLs",
        );
        this.currentRelayerUrls = [...this.fallbackRelayerUrls];
      }
    } catch (error) {
      this.logger.error(
        `Failed to refresh relayer URLs from Redis: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // Keep using current URLs (fallback if first time, or last known good state)
      if (this.currentRelayerUrls.length === 0) {
        this.currentRelayerUrls = [...this.fallbackRelayerUrls];
      }
    }
  }

  /**
   * Get the available relayer with the lowest pending transaction count
   *
   * FR-001: Smart Routing - Relayer Selection
   * - Query all OZ Relayers for pending transaction count
   * - Select the relayer with the lowest numberOfPendingTransactions
   * - Fall back to round-robin if health check fails
   *
   * SPEC-DISCOVERY-001 Phase 2: Dynamic Relayer Discovery
   * - Refresh relayer URLs from Redis before selection
   * - Use active relayers discovered by relayer-discovery service
   *
   * @returns The URL and relayer ID of the least busy relayer
   */
  async getAvailableRelayer(): Promise<{
    url: string;
    relayerId: string;
  }> {
    const startTime = Date.now();

    // SPEC-DISCOVERY-001: Refresh relayer URLs from Redis
    await this.refreshRelayerUrlsFromRedis();

    try {
      // Query all relayers in parallel
      const relayerInfos = await Promise.all(
        this.currentRelayerUrls.map((url) => this.getRelayerInfo(url)),
      );

      // Filter healthy relayers
      const healthyRelayers = relayerInfos.filter((info) => info.healthy);

      if (healthyRelayers.length === 0) {
        // FR-001: Fall back to round-robin if all health checks fail
        this.logger.warn(
          "No healthy relayers found, falling back to round-robin",
        );
        return this.roundRobinFallback();
      }

      // Select relayer with lowest pending transaction count
      // FR-001.1: When multiple relayers have equal pending counts, use round-robin
      const minPending = Math.min(
        ...healthyRelayers.map((r) => r.numberOfPendingTransactions),
      );
      const leastBusyRelayers = healthyRelayers.filter(
        (r) => r.numberOfPendingTransactions === minPending,
      );

      // Round-robin among relayers with equal (minimum) pending count
      const selectedIndex = this.roundRobinIndex % leastBusyRelayers.length;
      const leastBusy = leastBusyRelayers[selectedIndex];
      this.roundRobinIndex = (this.roundRobinIndex + 1) % 1000; // Prevent overflow

      const elapsedMs = Date.now() - startTime;
      this.logger.log(
        `Selected ${this.extractRelayerName(leastBusy.url)} with ${leastBusy.numberOfPendingTransactions} pending TXs (${elapsedMs}ms)`,
      );

      return {
        url: leastBusy.url,
        relayerId: leastBusy.relayerId!,
      };
    } catch (error) {
      this.logger.error(
        `Smart routing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return this.roundRobinFallback();
    }
  }

  /**
   * Get relayer information with caching
   *
   * NFR-001: Cache relayer health status for 10 seconds
   * - Check cache first
   * - If cache miss or expired, fetch from relayer
   * - Timeout after 500ms (fail fast)
   */
  private async getRelayerInfo(url: string): Promise<RelayerInfo> {
    const cached = this.relayerCache.get(url);
    const now = Date.now();

    // Check if cache is valid
    if (cached && now - cached.lastChecked < this.CACHE_TTL_MS) {
      return cached;
    }

    // Fetch fresh info from relayer
    try {
      const info = await this.fetchRelayerInfo(url);
      this.relayerCache.set(url, info);
      return info;
    } catch (error) {
      // Mark as unhealthy on error
      const unhealthyInfo: RelayerInfo = {
        url,
        relayerId: null,
        numberOfPendingTransactions: Infinity,
        healthy: false,
        lastChecked: now,
      };
      this.relayerCache.set(url, unhealthyInfo);
      return unhealthyInfo;
    }
  }

  /**
   * Fetch relayer info from OZ Relayer API
   *
   * Uses GET /api/v1/relayers to get relayer ID and pending TX count
   * NFR-001: Timeout after 500ms
   */
  private async fetchRelayerInfo(url: string): Promise<RelayerInfo> {
    const now = Date.now();

    try {
      // Get relayer list (contains pending TX count)
      const response = await axios.get<{
        data: Array<{
          id: string;
          pending_transactions?: number;
          status?: string;
        }>;
      }>(`${url}/api/v1/relayers`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: this.HEALTH_CHECK_TIMEOUT_MS,
      });

      const relayerData = response.data?.data?.[0];

      if (!relayerData) {
        throw new Error("No relayer data in response");
      }

      const info: RelayerInfo = {
        url,
        relayerId: relayerData.id,
        numberOfPendingTransactions: relayerData.pending_transactions ?? 0,
        healthy: relayerData.status !== "paused",
        lastChecked: now,
      };

      this.logger.debug(
        `${this.extractRelayerName(url)}: relayerId=${info.relayerId}, pending=${info.numberOfPendingTransactions}, healthy=${info.healthy}`,
      );

      return info;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.warn(
        `Health check failed for ${this.extractRelayerName(url)}: ${axiosError.message}`,
      );
      throw error;
    }
  }

  /**
   * Round-robin fallback when smart routing fails
   *
   * FR-001: Fall back to round-robin if health check fails for any relayer
   */
  private async roundRobinFallback(): Promise<{
    url: string;
    relayerId: string;
  }> {
    const urls = this.currentRelayerUrls;
    const url = urls[this.roundRobinIndex % urls.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % urls.length;

    // Try to get relayer ID (may fail, but we proceed anyway)
    try {
      const info = await this.fetchRelayerInfo(url);
      this.logger.log(
        `Round-robin selected: ${this.extractRelayerName(url)} (fallback mode)`,
      );
      return {
        url,
        relayerId: info.relayerId || "default-relayer",
      };
    } catch (error) {
      // Even if health check fails, return the URL for best-effort attempt
      this.logger.warn(
        `Round-robin fallback for ${this.extractRelayerName(url)} (health check failed)`,
      );
      return {
        url,
        relayerId: "default-relayer",
      };
    }
  }

  /**
   * Extract relayer name from URL for logging
   * e.g., "http://oz-relayer-1:8080" -> "oz-relayer-1"
   */
  private extractRelayerName(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return url;
    }
  }

  /**
   * Invalidate cache for a specific relayer
   * Called when a relayer returns errors
   */
  invalidateCache(url: string): void {
    this.relayerCache.delete(url);
    this.logger.debug(`Cache invalidated for ${this.extractRelayerName(url)}`);
  }

  /**
   * Get all current relayer URLs
   * Used for monitoring and debugging
   *
   * SPEC-DISCOVERY-001: Returns URLs from Redis if available, otherwise fallback
   */
  getRelayerUrls(): string[] {
    return [...this.currentRelayerUrls];
  }

  /**
   * Get fallback relayer URLs from environment config
   * Used for monitoring and debugging
   */
  getFallbackRelayerUrls(): string[] {
    return [...this.fallbackRelayerUrls];
  }

  /**
   * Check if using Redis-discovered relayers
   */
  isUsingRedisDiscovery(): boolean {
    return this.redisService.isAvailable();
  }

  /**
   * Get current cache state for monitoring
   */
  getCacheState(): Map<string, RelayerInfo> {
    return new Map(this.relayerCache);
  }
}

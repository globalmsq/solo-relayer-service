import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';

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
 * NFR-001: Smart Router Performance
 * - Complete relayer selection within 100ms
 * - Cache relayer health status for 10 seconds
 * - Fail fast (skip) if relayer health check takes >500ms
 */
@Injectable()
export class RelayerRouterService {
  private readonly logger = new Logger(RelayerRouterService.name);
  private readonly apiKey: string;

  // FR-005: Multi-relayer configuration from comma-separated URLs
  private readonly relayerUrls: string[];

  // NFR-001: Health check caching (10 second TTL)
  private readonly CACHE_TTL_MS = 10000;
  private readonly HEALTH_CHECK_TIMEOUT_MS = 500;

  // Relayer cache: url -> RelayerInfo
  private relayerCache: Map<string, RelayerInfo> = new Map();

  // Round-robin index for fallback mode
  private roundRobinIndex = 0;

  constructor(private configService: ConfigService) {
    const urlsConfig = this.configService.get<string>('relayer.urls') || '';
    const singleUrl =
      this.configService.get<string>('relayer.url') ||
      'http://localhost:8081';

    // Parse comma-separated URLs or use single URL as fallback
    this.relayerUrls = urlsConfig
      ? urlsConfig.split(',').map((url) => url.trim())
      : [singleUrl];

    this.apiKey =
      this.configService.get<string>('relayer.apiKey') ||
      'oz-relayer-shared-api-key-local-dev';

    this.logger.log(
      `RelayerRouterService initialized with ${this.relayerUrls.length} relayers: ${this.relayerUrls.join(', ')}`,
    );
  }

  /**
   * Get the available relayer with the lowest pending transaction count
   *
   * FR-001: Smart Routing - Relayer Selection
   * - Query all OZ Relayers for pending transaction count
   * - Select the relayer with the lowest numberOfPendingTransactions
   * - Fall back to round-robin if health check fails
   *
   * @returns The URL and relayer ID of the least busy relayer
   */
  async getAvailableRelayer(): Promise<{
    url: string;
    relayerId: string;
  }> {
    const startTime = Date.now();

    try {
      // Query all relayers in parallel
      const relayerInfos = await Promise.all(
        this.relayerUrls.map((url) => this.getRelayerInfo(url)),
      );

      // Filter healthy relayers
      const healthyRelayers = relayerInfos.filter((info) => info.healthy);

      if (healthyRelayers.length === 0) {
        // FR-001: Fall back to round-robin if all health checks fail
        this.logger.warn(
          'No healthy relayers found, falling back to round-robin',
        );
        return this.roundRobinFallback();
      }

      // Select relayer with lowest pending transaction count
      const leastBusy = healthyRelayers.reduce((prev, curr) =>
        prev.numberOfPendingTransactions <= curr.numberOfPendingTransactions
          ? prev
          : curr,
      );

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
        `Smart routing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
        throw new Error('No relayer data in response');
      }

      const info: RelayerInfo = {
        url,
        relayerId: relayerData.id,
        numberOfPendingTransactions: relayerData.pending_transactions ?? 0,
        healthy: relayerData.status !== 'paused',
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
    const url = this.relayerUrls[this.roundRobinIndex];
    this.roundRobinIndex =
      (this.roundRobinIndex + 1) % this.relayerUrls.length;

    // Try to get relayer ID (may fail, but we proceed anyway)
    try {
      const info = await this.fetchRelayerInfo(url);
      this.logger.log(
        `Round-robin selected: ${this.extractRelayerName(url)} (fallback mode)`,
      );
      return {
        url,
        relayerId: info.relayerId || 'default-relayer',
      };
    } catch (error) {
      // Even if health check fails, return the URL for best-effort attempt
      this.logger.warn(
        `Round-robin fallback for ${this.extractRelayerName(url)} (health check failed)`,
      );
      return {
        url,
        relayerId: 'default-relayer',
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
   * Get all configured relayer URLs
   * Used for monitoring and debugging
   */
  getRelayerUrls(): string[] {
    return [...this.relayerUrls];
  }

  /**
   * Get current cache state for monitoring
   */
  getCacheState(): Map<string, RelayerInfo> {
    return new Map(this.relayerCache);
  }
}

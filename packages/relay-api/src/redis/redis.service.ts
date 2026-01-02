import { Injectable, Inject, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

/**
 * RedisService
 * Wrapper around ioredis client with utility methods for 3-Tier cache operations.
 * Used for L1 cache (Transaction status, webhook data, etc).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject("REDIS_CLIENT") private readonly client: Redis) {}

  /**
   * Get a value from Redis
   * Attempts to parse as JSON, falls back to string if parsing fails
   */
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      // If JSON parsing fails, return raw string value
      return value as T;
    }
  }

  /**
   * Set a value in Redis with optional TTL
   * @param key Redis key
   * @param value Value to store (will be JSON stringified)
   * @param ttl Optional TTL in seconds
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    if (ttl) {
      await this.client.set(key, serialized, "EX", ttl);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /**
   * Delete a key from Redis
   */
  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  /**
   * Check if a key exists in Redis
   */
  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  /**
   * Get TTL of a key in seconds
   * Returns -1 if key exists without TTL
   * Returns -2 if key does not exist
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Clear all keys from Redis (dangerous, use with caution)
   */
  async flushAll(): Promise<void> {
    await this.client.flushall();
  }

  /**
   * Get Redis client for advanced operations
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Health check for Redis connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      this.logger.error(`Redis health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Clean up Redis connection on module destroy
   */
  async onModuleDestroy() {
    try {
      await this.client.quit();
      this.logger.log("Redis client disconnected");
    } catch (error) {
      this.logger.warn(`Error disconnecting Redis: ${error.message}`);
    }
  }
}

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * SPEC-DISCOVERY-001 Phase 2: Redis Service for Queue Consumer
 *
 * This service connects to Redis to retrieve active relayer list
 * managed by the relayer-discovery service.
 *
 * Key used:
 * - relayer:active (Set) - Contains active relayer hostnames (e.g., oz-relayer-0)
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl =
      this.configService.get<string>('redis.url') || 'redis://localhost:6379';

    this.logger.log(`Initializing Redis connection to ${redisUrl}`);

    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          const delay = Math.min(times * 100, 3000);
          return delay;
        },
        lazyConnect: false,
        enableReadyCheck: true,
        connectTimeout: 5000,
      });

      this.client.on('error', (error) => {
        this.logger.error(`Redis connection error: ${error.message}`);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        this.logger.log('Redis connected successfully');
        this.isConnected = true;
      });

      this.client.on('close', () => {
        this.logger.warn('Redis connection closed');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        this.logger.log('Redis reconnecting...');
      });

      // Wait for initial connection
      await this.client.ping();
      this.isConnected = true;
    } catch (error) {
      this.logger.error(
        `Failed to connect to Redis: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      this.isConnected = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      this.logger.log('Closing Redis connection');
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }

  /**
   * Get all members from Redis set
   *
   * SPEC-DISCOVERY-001: Used to retrieve active relayer list
   *
   * @param key Redis key (e.g., 'relayer:active')
   * @returns Array of members or empty array if unavailable
   */
  async smembers(key: string): Promise<string[]> {
    if (!this.client || !this.isConnected) {
      this.logger.warn(
        `Redis not available, cannot get members for key: ${key}`,
      );
      return [];
    }

    try {
      return await this.client.smembers(key);
    } catch (error) {
      this.logger.error(
        `Failed to get members for key ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Get count of members in Redis set
   *
   * @param key Redis key
   * @returns Number of members or 0 if unavailable
   */
  async scard(key: string): Promise<number> {
    if (!this.client || !this.isConnected) {
      return 0;
    }

    try {
      return await this.client.scard(key);
    } catch (error) {
      this.logger.error(
        `Failed to get cardinality for key ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return 0;
    }
  }

  /**
   * Check if Redis is connected and available
   */
  isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Ping Redis to check connectivity
   *
   * @returns true if ping succeeds, false otherwise
   */
  async ping(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }
}

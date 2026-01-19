import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const host = this.configService.get<string>("discovery.redis.host");
    const port = this.configService.get<number>("discovery.redis.port");

    this.logger.log(`Initializing Redis connection to ${host}:${port}`);

    this.client = new Redis({
      host,
      port,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: false,
    });

    this.client.on("error", (error) => {
      this.logger.error(`Redis connection error: ${error.message}`);
    });

    this.client.on("connect", () => {
      this.logger.log("Redis connected successfully");
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      this.logger.log("Closing Redis connection");
      await this.client.quit();
      this.client = null;
    }
  }

  /**
   * Add member to Redis set
   * @param key Redis key
   * @param member Member to add
   * @returns Number of elements added (1 if new, 0 if already exists)
   */
  async sadd(key: string, member: string): Promise<number> {
    this.ensureClientInitialized();
    return this.client!.sadd(key, member);
  }

  /**
   * Remove member from Redis set
   * @param key Redis key
   * @param member Member to remove
   * @returns Number of elements removed (1 if existed, 0 if not found)
   */
  async srem(key: string, member: string): Promise<number> {
    this.ensureClientInitialized();
    return this.client!.srem(key, member);
  }

  /**
   * Get all members from Redis set
   * @param key Redis key
   * @returns Array of members
   */
  async smembers(key: string): Promise<string[]> {
    this.ensureClientInitialized();
    return this.client!.smembers(key);
  }

  /**
   * Get number of members in Redis set
   * @param key Redis key
   * @returns Number of members
   */
  async scard(key: string): Promise<number> {
    this.ensureClientInitialized();
    return this.client!.scard(key);
  }

  /**
   * Ensure Redis client is initialized before operations
   * @throws Error if client is not initialized
   */
  private ensureClientInitialized(): void {
    if (!this.client) {
      throw new Error(
        "Redis client not initialized. Call onModuleInit() first.",
      );
    }
  }
}

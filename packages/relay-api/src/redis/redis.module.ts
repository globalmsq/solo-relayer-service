import { Module, Global, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { RedisService } from "./redis.service";

/**
 * RedisModule
 * Global module that provides Redis client and RedisService to entire application.
 * Uses ioredis for NestJS ecosystem compatibility.
 * Shares the existing OZ Relayer Redis instance (no new container needed).
 */
@Global()
@Module({
  providers: [
    {
      provide: "REDIS_CLIENT",
      useFactory: (configService: ConfigService) => {
        const logger = new Logger("RedisModule");
        const redisUrl = configService.get<string>(
          "REDIS_URL",
          "redis://localhost:6379",
        );
        const client = new Redis(redisUrl);

        client.on("error", (err) => {
          logger.error(`Redis Client Error: ${err.message}`);
        });

        client.on("connect", () => {
          logger.log("Redis Client Connected");
        });

        return client;
      },
      inject: [ConfigService],
    },
    RedisService,
  ],
  exports: ["REDIS_CLIENT", RedisService],
})
export class RedisModule {}

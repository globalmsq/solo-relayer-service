import { Test, TestingModule } from "@nestjs/testing";
import { HealthCheckError } from "@nestjs/terminus";
import { RedisHealthIndicator } from "./redis.health";
import { RedisService } from "../../redis/redis.service";

describe("RedisHealthIndicator", () => {
  let indicator: RedisHealthIndicator;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    const mockRedisService = {
      healthCheck: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    indicator = module.get<RedisHealthIndicator>(RedisHealthIndicator);
    redisService = module.get(RedisService);
  });

  describe("isHealthy", () => {
    it("should return healthy status when Redis is connected", async () => {
      redisService.healthCheck.mockResolvedValue(true);

      const result = await indicator.isHealthy("redis");

      expect(result["redis"].status).toBe("up");
      expect(redisService.healthCheck).toHaveBeenCalledTimes(1);
    });

    it("should throw HealthCheckError when Redis healthCheck returns false", async () => {
      redisService.healthCheck.mockResolvedValue(false);

      await expect(indicator.isHealthy("redis")).rejects.toThrow(
        HealthCheckError,
      );
    });

    it("should throw HealthCheckError when Redis throws error", async () => {
      redisService.healthCheck.mockRejectedValue(
        new Error("Connection refused"),
      );

      await expect(indicator.isHealthy("redis")).rejects.toThrow(
        HealthCheckError,
      );
    });

    it("should include error message in HealthCheckError", async () => {
      redisService.healthCheck.mockRejectedValue(
        new Error("Connection refused"),
      );

      try {
        await indicator.isHealthy("redis");
        fail("Expected HealthCheckError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect(error.message).toContain("Connection refused");
      }
    });

    it("should return down status in error causes", async () => {
      redisService.healthCheck.mockResolvedValue(false);

      try {
        await indicator.isHealthy("redis");
        fail("Expected HealthCheckError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect(error.causes).toHaveProperty("redis");
        expect(error.causes["redis"].status).toBe("down");
      }
    });
  });

  describe("Integration", () => {
    it("should be injectable with RedisService dependency", () => {
      expect(indicator).toBeDefined();
      expect(indicator).toBeInstanceOf(RedisHealthIndicator);
    });

    it("should inherit from HealthIndicator", () => {
      expect(indicator).toHaveProperty("getStatus");
    });

    it("should respond quickly when Redis is healthy", async () => {
      redisService.healthCheck.mockResolvedValue(true);

      const start = Date.now();
      await indicator.isHealthy("redis");
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });
});

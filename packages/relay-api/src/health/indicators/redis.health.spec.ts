import { Test, TestingModule } from "@nestjs/testing";
import { RedisHealthIndicator } from "./redis.health";

describe("RedisHealthIndicator", () => {
  let indicator: RedisHealthIndicator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RedisHealthIndicator],
    }).compile();

    indicator = module.get<RedisHealthIndicator>(RedisHealthIndicator);
  });

  describe("isHealthy", () => {
    // AC-006: Redis placeholder always returns healthy
    it("should return healthy status", async () => {
      const result = await indicator.isHealthy("redis");

      expect(result["redis"].status).toBe("healthy");
    });

    it("should include placeholder message", async () => {
      const result = await indicator.isHealthy("redis");

      expect(result["redis"].message).toContain("Phase 1");
      expect(result["redis"].message).toContain("not implemented");
    });

    it("should not throw HealthCheckError", async () => {
      await expect(indicator.isHealthy("redis")).resolves.not.toThrow();
    });

    it("should always return healthy regardless of any state", async () => {
      // Call multiple times to verify consistent behavior
      const result1 = await indicator.isHealthy("redis");
      const result2 = await indicator.isHealthy("redis");
      const result3 = await indicator.isHealthy("redis");

      expect(result1["redis"].status).toBe("healthy");
      expect(result2["redis"].status).toBe("healthy");
      expect(result3["redis"].status).toBe("healthy");
    });

    it("should return expected structure", async () => {
      const result = await indicator.isHealthy("redis");

      expect(result).toHaveProperty("redis");
      expect(result["redis"]).toHaveProperty("status");
      expect(result["redis"]).toHaveProperty("message");
    });
  });

  describe("Integration", () => {
    it("should be injectable as a provider", () => {
      expect(indicator).toBeDefined();
      expect(indicator).toBeInstanceOf(RedisHealthIndicator);
    });

    it("should inherit from HealthIndicator", () => {
      expect(indicator).toHaveProperty("getStatus");
    });

    it("should respond synchronously", async () => {
      const start = Date.now();
      await indicator.isHealthy("redis");
      const duration = Date.now() - start;

      // Should respond very quickly (< 50ms) since it's just returning a value
      expect(duration).toBeLessThan(50);
    });
  });
});

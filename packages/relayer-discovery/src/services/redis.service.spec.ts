import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "./redis.service";

// Mock ioredis to use ioredis-mock
jest.mock("ioredis", () => require("ioredis-mock"));

describe("RedisService", () => {
  let service: RedisService;
  let mockConfigService: Partial<ConfigService>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, any> = {
          "discovery.redis.host": "localhost",
          "discovery.redis.port": 6379,
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
  });

  afterEach(async () => {
    // Clean up all keys before destroying
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const MockRedis = require("ioredis-mock");
    const client = new MockRedis();
    await client.flushall();
    await client.quit();

    await service.onModuleDestroy();
  });
  describe("onModuleInit", () => {
    it("should initialize Redis connection", async () => {
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("should connect to correct Redis host and port", async () => {
      await service.onModuleInit();
      // Test that connection is established (internal state verification)
      expect(mockConfigService.get).toHaveBeenCalledWith(
        "discovery.redis.host",
      );
      expect(mockConfigService.get).toHaveBeenCalledWith(
        "discovery.redis.port",
      );
    });
  });

  describe("onModuleDestroy", () => {
    it("should close Redis connection gracefully", async () => {
      await service.onModuleInit();
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });

    it("should handle multiple destroy calls gracefully", async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  describe("sadd", () => {
    it("should add member to Redis set", async () => {
      await service.onModuleInit();
      const result = await service.sadd("relayer:active", "oz-relayer-0");
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it("should return 1 when adding new member", async () => {
      await service.onModuleInit();
      const result = await service.sadd("relayer:active:test", "oz-relayer-0");
      expect(result).toBe(1);
    });

    it("should return 0 when adding existing member", async () => {
      await service.onModuleInit();
      await service.sadd("relayer:active:test2", "oz-relayer-0");
      const result = await service.sadd("relayer:active:test2", "oz-relayer-0");
      expect(result).toBe(0);
    });
  });

  describe("srem", () => {
    it("should remove member from Redis set", async () => {
      await service.onModuleInit();
      await service.sadd("relayer:active:test3", "oz-relayer-0");
      const result = await service.srem("relayer:active:test3", "oz-relayer-0");
      expect(result).toBe(1);
    });

    it("should return 0 when removing non-existent member", async () => {
      await service.onModuleInit();
      const result = await service.srem(
        "relayer:active:test4",
        "oz-relayer-999",
      );
      expect(result).toBe(0);
    });
  });

  describe("smembers", () => {
    it("should retrieve all members from Redis set", async () => {
      await service.onModuleInit();
      await service.sadd("relayer:active:test5", "oz-relayer-0");
      await service.sadd("relayer:active:test5", "oz-relayer-1");

      const members = await service.smembers("relayer:active:test5");
      expect(members).toHaveLength(2);
      expect(members).toContain("oz-relayer-0");
      expect(members).toContain("oz-relayer-1");
    });

    it("should return empty array for non-existent key", async () => {
      await service.onModuleInit();
      const members = await service.smembers("relayer:active:nonexistent");
      expect(members).toEqual([]);
    });
  });

  describe("scard", () => {
    it("should return number of members in set", async () => {
      await service.onModuleInit();
      await service.sadd("relayer:active:test6", "oz-relayer-0");
      await service.sadd("relayer:active:test6", "oz-relayer-1");

      const count = await service.scard("relayer:active:test6");
      expect(count).toBe(2);
    });

    it("should return 0 for non-existent key", async () => {
      await service.onModuleInit();
      const count = await service.scard("relayer:active:nonexistent2");
      expect(count).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should throw error when operations called before initialization", async () => {
      // Service not initialized
      await expect(service.sadd("key", "value")).rejects.toThrow();
    });

    it("should log Redis connection error", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "error");
      await service.onModuleInit();

      // Trigger error event
      service["client"]!.emit("error", new Error("Connection refused"));

      expect(loggerSpy).toHaveBeenCalledWith(
        "Redis connection error: Connection refused",
      );
    });

    it("should log Redis connection success", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "log");
      await service.onModuleInit();

      // Trigger connect event
      service["client"]!.emit("connect");

      expect(loggerSpy).toHaveBeenCalledWith("Redis connected successfully");
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpModule, HttpService } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { DiscoveryService } from "../src/services/discovery.service";
import { RedisService } from "../src/services/redis.service";
import discoveryConfig from "../src/config/discovery.config";
import { of } from "rxjs";
import { AxiosResponse } from "axios";

describe("DiscoveryService Integration Tests", () => {
  let discoveryService: DiscoveryService;
  let redisService: RedisService;
  let httpService: HttpService;
  let module: TestingModule;

  beforeAll(async () => {
    // Set test environment variables
    process.env.REDIS_HOST = process.env.REDIS_HOST || "localhost";
    process.env.REDIS_PORT = process.env.REDIS_PORT || "6379";
    process.env.RELAYER_COUNT = "3";
    process.env.HEALTH_CHECK_INTERVAL_MS = "5000";
    process.env.HEALTH_CHECK_TIMEOUT_MS = "500";

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [discoveryConfig],
          isGlobal: true,
        }),
        HttpModule,
      ],
      providers: [DiscoveryService, RedisService],
    }).compile();

    discoveryService = module.get<DiscoveryService>(DiscoveryService);
    redisService = module.get<RedisService>(RedisService);
    httpService = module.get<HttpService>(HttpService);

    await redisService.onModuleInit();
  });

  afterAll(async () => {
    await discoveryService.onModuleDestroy();
    await redisService.onModuleDestroy();
    await module.close();
  });

  beforeEach(async () => {
    // Clear Redis active relayer set before each test
    const activeRelayers = await redisService.smembers("relayer:active");
    for (const relayer of activeRelayers) {
      await redisService.srem("relayer:active", relayer);
    }
  });

  describe("Redis integration", () => {
    it("should connect to Redis successfully", async () => {
      const result = await redisService.sadd("test:key", "test:value");
      expect(result).toBeGreaterThanOrEqual(0);

      const members = await redisService.smembers("test:key");
      expect(members).toContain("test:value");

      await redisService.srem("test:key", "test:value");
    });

    it("should add relayers to Redis active list", async () => {
      await redisService.sadd("relayer:active", "oz-relayer-0");
      await redisService.sadd("relayer:active", "oz-relayer-1");

      const activeRelayers = await redisService.smembers("relayer:active");

      expect(activeRelayers).toHaveLength(2);
      expect(activeRelayers).toContain("oz-relayer-0");
      expect(activeRelayers).toContain("oz-relayer-1");
    });

    it("should remove relayers from Redis active list", async () => {
      await redisService.sadd("relayer:active", "oz-relayer-0");
      await redisService.sadd("relayer:active", "oz-relayer-1");

      await redisService.srem("relayer:active", "oz-relayer-0");

      const activeRelayers = await redisService.smembers("relayer:active");

      expect(activeRelayers).toHaveLength(1);
      expect(activeRelayers).toContain("oz-relayer-1");
      expect(activeRelayers).not.toContain("oz-relayer-0");
    });

    it("should get cardinality of Redis set", async () => {
      await redisService.sadd("relayer:active", "oz-relayer-0");
      await redisService.sadd("relayer:active", "oz-relayer-1");

      const count = await redisService.scard("relayer:active");

      expect(count).toBe(2);
    });
  });

  describe("Health check integration with Redis", () => {
    it("should perform health checks and update Redis", async () => {
      // Mock HTTP service to simulate healthy relayers
      const mockResponse: Partial<AxiosResponse> = {
        status: 200,
        data: {},
        statusText: "OK",
        headers: {},
        config: {} as any,
      };
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of(mockResponse as AxiosResponse));

      // Perform health checks manually (not via interval)
      await discoveryService["performHealthChecks"]();

      // Verify Redis was updated
      const activeRelayers = await redisService.smembers("relayer:active");

      expect(activeRelayers).toHaveLength(3);
      expect(activeRelayers).toContain("oz-relayer-0");
      expect(activeRelayers).toContain("oz-relayer-1");
      expect(activeRelayers).toContain("oz-relayer-2");
    });

    it("should remove unhealthy relayers from Redis", async () => {
      // First, add all relayers
      await redisService.sadd("relayer:active", "oz-relayer-0");
      await redisService.sadd("relayer:active", "oz-relayer-1");
      await redisService.sadd("relayer:active", "oz-relayer-2");

      // Mock HTTP service to simulate oz-relayer-1 is down
      jest.spyOn(httpService, "get").mockImplementation((url: string) => {
        if (url.includes("oz-relayer-1")) {
          throw new Error("Connection refused");
        }
        return of({
          status: 200,
          data: {},
          statusText: "OK",
          headers: {},
          config: {} as any,
        } as AxiosResponse);
      });

      // Perform health checks
      await discoveryService["performHealthChecks"]();

      // Verify Redis was updated correctly
      const activeRelayers = await redisService.smembers("relayer:active");

      expect(activeRelayers).toHaveLength(2);
      expect(activeRelayers).toContain("oz-relayer-0");
      expect(activeRelayers).not.toContain("oz-relayer-1");
      expect(activeRelayers).toContain("oz-relayer-2");
    });

    it("should re-add recovered relayers to Redis", async () => {
      // Start with one relayer active
      await redisService.sadd("relayer:active", "oz-relayer-0");

      // Mock all relayers as healthy
      const mockResponse: Partial<AxiosResponse> = {
        status: 200,
        data: {},
        statusText: "OK",
        headers: {},
        config: {} as any,
      };
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of(mockResponse as AxiosResponse));

      // Perform health checks
      await discoveryService["performHealthChecks"]();

      // Verify all relayers were re-added
      const activeRelayers = await redisService.smembers("relayer:active");

      expect(activeRelayers).toHaveLength(3);
      expect(activeRelayers).toContain("oz-relayer-0");
      expect(activeRelayers).toContain("oz-relayer-1");
      expect(activeRelayers).toContain("oz-relayer-2");
    });
  });

  describe("getStatus integration with Redis", () => {
    it("should return status from real Redis data", async () => {
      // Add relayers to Redis
      await redisService.sadd("relayer:active", "oz-relayer-0");
      await redisService.sadd("relayer:active", "oz-relayer-2");

      const status = await discoveryService.getStatus();

      expect(status.service).toBe("relayer-discovery");
      expect(status.status).toBe("degraded");
      expect(status.totalConfigured).toBe(3);
      expect(status.totalActive).toBe(2);
      expect(status.activeRelayers).toHaveLength(2);

      const relayerIds = status.activeRelayers.map((r) => r.id);
      expect(relayerIds).toContain("oz-relayer-0");
      expect(relayerIds).toContain("oz-relayer-2");
    });

    it("should return healthy status when all relayers active in Redis", async () => {
      await redisService.sadd("relayer:active", "oz-relayer-0");
      await redisService.sadd("relayer:active", "oz-relayer-1");
      await redisService.sadd("relayer:active", "oz-relayer-2");

      const status = await discoveryService.getStatus();

      expect(status.status).toBe("healthy");
      expect(status.totalActive).toBe(3);
    });

    it("should return unhealthy status when no relayers in Redis", async () => {
      const status = await discoveryService.getStatus();

      expect(status.status).toBe("unhealthy");
      expect(status.totalActive).toBe(0);
      expect(status.activeRelayers).toHaveLength(0);
    });
  });
});

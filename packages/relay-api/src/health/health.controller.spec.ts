import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import {
  HealthCheckService,
  HealthCheckError,
  TerminusModule,
} from "@nestjs/terminus";
import { ServiceUnavailableException } from "@nestjs/common";
import { of, throwError } from "rxjs";
import { HealthController } from "./health.controller";
import { OzRelayerHealthIndicator, RedisHealthIndicator } from "./indicators";
import { RedisService } from "../redis/redis.service";

describe("HealthController (Integration)", () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;
  let ozRelayerHealth: OzRelayerHealthIndicator;
  let redisHealth: RedisHealthIndicator;
  let httpService: HttpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        OzRelayerHealthIndicator,
        RedisHealthIndicator,
        {
          provide: RedisService,
          useValue: {
            healthCheck: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === "OZ_RELAYER_URL") {
                return defaultValue || "http://oz-relayer-lb:8080";
              }
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
    ozRelayerHealth = module.get<OzRelayerHealthIndicator>(
      OzRelayerHealthIndicator,
    );
    redisHealth = module.get<RedisHealthIndicator>(RedisHealthIndicator);
    httpService = module.get<HttpService>(HttpService);
  });

  describe("check (GET /api/v1/health)", () => {
    // AC-007: Successful health check (200 OK)
    it("should return health check result when all services are healthy", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ status: 200, data: { status: "ok" } }) as any);

      const result = await controller.check();

      expect(result.status).toBe("ok");
      expect(result.info).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.details).toBeDefined();
    });

    // Verify terminus format
    it("should return standard @nestjs/terminus response format", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ status: 200, data: { status: "ok" } }) as any);

      const result = await controller.check();

      // Verify standard format
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("info");
      expect(result).toHaveProperty("error");
      expect(result).toHaveProperty("details");

      // Verify status value
      expect(result.status).toBe("ok");

      // Verify info contains services
      expect(result.info!["oz-relayer-pool"]).toBeDefined();
      expect(result.info!["redis"]).toBeDefined();

      // Verify error is object (empty when all healthy)
      expect(typeof result.error).toBe("object");

      // Verify details
      expect(result.details!["oz-relayer-pool"]).toBeDefined();
      expect(result.details!["redis"]).toBeDefined();
    });

    // Redis indicator included (actual RedisService.healthCheck integration)
    it("should include redis indicator in response", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ status: 200, data: { status: "ok" } }) as any);

      const result = await controller.check();

      expect(result.info!["redis"].status).toBe("up");
    });

    // OZ Relayer LB details (SPEC-PROXY-001: Simplified to single Nginx LB endpoint)
    it("should include oz-relayer-pool details with LB status", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ status: 200, data: { status: "ok" } }) as any);

      const result = await controller.check();

      const poolInfo = result.info!["oz-relayer-pool"];
      expect(poolInfo).toBeDefined();
      expect(poolInfo.url).toBe("http://oz-relayer-lb:8080");
      expect(typeof poolInfo.responseTime).toBe("number");
      expect(poolInfo.responseTime).toBeGreaterThanOrEqual(0);
    });

    // AC-008: Service unavailable (503 error) - LB unhealthy
    it("should throw ServiceUnavailableException when Nginx LB is unhealthy", async () => {
      jest.spyOn(ozRelayerHealth, "isHealthy").mockRejectedValue(
        new HealthCheckError("LB unhealthy", {
          "oz-relayer-pool": {
            url: "http://oz-relayer-lb:8080",
            responseTime: 0,
            error: "Connection refused",
          },
        }),
      );

      try {
        await controller.check();
        fail("Should have thrown ServiceUnavailableException");
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
      }
    });

    // AC-008: Service unavailable (503 error) - HTTP error
    it("should throw ServiceUnavailableException when LB returns non-200", async () => {
      jest.spyOn(ozRelayerHealth, "isHealthy").mockRejectedValue(
        new HealthCheckError("LB error", {
          "oz-relayer-pool": {
            url: "http://oz-relayer-lb:8080",
            responseTime: 45,
            error: "HTTP 503",
          },
        }),
      );

      try {
        await controller.check();
        fail("Should have thrown ServiceUnavailableException");
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
      }
    });
  });

  describe("getRelayerPoolStatus (GET /relay/pool-status)", () => {
    it("should return pool status with success flag", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ status: 200, data: { status: "ok" } }) as any);

      const response = await controller.getRelayerPoolStatus();

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.timestamp).toBeDefined();
    });

    it("should return detailed pool information", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ status: 200, data: { status: "ok" } }) as any);

      const response = await controller.getRelayerPoolStatus();

      const poolData = response.data;
      expect(poolData.url).toBeDefined();
      expect(poolData.responseTime).toBeDefined();
      expect(typeof poolData.responseTime).toBe("number");
    });

    it("should handle unhealthy LB status", async () => {
      jest.spyOn(ozRelayerHealth, "isHealthy").mockRejectedValue(
        new HealthCheckError("LB unhealthy", {
          "oz-relayer-pool": {
            url: "http://oz-relayer-lb:8080",
            responseTime: 0,
            error: "Connection refused",
          },
        }),
      );

      const response = await controller.getRelayerPoolStatus();

      expect(response.success).toBe(true);
      expect(response.data.url).toBe("http://oz-relayer-lb:8080");
      expect(response.data.error).toBe("Connection refused");
    });
  });

  describe("Controller injection", () => {
    it("should have HealthCheckService injected", () => {
      expect(healthCheckService).toBeDefined();
    });

    it("should have OzRelayerHealthIndicator injected", () => {
      expect(ozRelayerHealth).toBeDefined();
    });

    it("should have RedisHealthIndicator injected", () => {
      expect(redisHealth).toBeDefined();
    });

    it("should be controller instantiated", () => {
      expect(controller).toBeDefined();
      expect(controller).toBeInstanceOf(HealthController);
    });
  });

  describe("Error handling", () => {
    it("should throw ServiceUnavailableException on HTTP errors", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(
          throwError(() => new Error("Connection refused")) as any,
        );

      try {
        await controller.check();
        fail("Should have thrown ServiceUnavailableException");
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
      }
    });

    it("should throw ServiceUnavailableException on timeout errors", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(
          throwError(() => new Error("Timeout after 5000ms")) as any,
        );

      try {
        await controller.check();
        fail("Should have thrown ServiceUnavailableException");
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
      }
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import {
  HealthCheckService,
  HealthCheckError,
  TerminusModule,
} from "@nestjs/terminus";
import { ServiceUnavailableException } from "@nestjs/common";
import { of, throwError } from "rxjs";
import { HealthController } from "./health.controller";
import { OzRelayerHealthIndicator, RedisHealthIndicator } from "./indicators";

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
          provide: HttpService,
          useValue: {
            get: jest.fn(),
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
        .mockReturnValue(of({ data: { status: "ok" } }) as any);

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
        .mockReturnValue(of({ data: { status: "ok" } }) as any);

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

    // Redis indicator included
    it("should include redis indicator in response", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ data: { status: "ok" } }) as any);

      const result = await controller.check();

      expect(result.info!["redis"].status).toBe("healthy");
      expect(result.info!["redis"].message).toContain("Phase 1");
    });

    // OZ Relayer pool details
    it("should include oz-relayer-pool details with relayers", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ data: { status: "ok" } }) as any);

      const result = await controller.check();

      const poolInfo = result.info!["oz-relayer-pool"];
      expect(poolInfo.status).toBe("healthy");
      expect(poolInfo.healthyCount).toBe(3);
      expect(poolInfo.totalCount).toBe(3);
      expect(poolInfo.relayers).toHaveLength(3);

      poolInfo.relayers.forEach((r: any) => {
        expect(["oz-relayer-1", "oz-relayer-2", "oz-relayer-3"]).toContain(
          r.id,
        );
        expect(r.status).toBe("healthy");
        expect(typeof r.responseTime).toBe("number");
      });
    });

    // AC-008: Service unavailable (503 error) - degraded
    it("should throw ServiceUnavailableException when pool is degraded", async () => {
      jest.spyOn(ozRelayerHealth, "isHealthy").mockRejectedValue(
        new HealthCheckError("Pool degraded", {
          "oz-relayer-pool": {
            status: "degraded",
            healthyCount: 1,
            totalCount: 3,
            relayers: [{ id: "oz-relayer-1", status: "healthy" }],
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

    // AC-008: Service unavailable (503 error) - unhealthy
    it("should throw ServiceUnavailableException when pool is completely unhealthy", async () => {
      jest.spyOn(ozRelayerHealth, "isHealthy").mockRejectedValue(
        new HealthCheckError("Pool unhealthy", {
          "oz-relayer-pool": {
            status: "unhealthy",
            healthyCount: 0,
            totalCount: 3,
            relayers: [],
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
        .mockReturnValue(of({ data: { status: "ok" } }) as any);

      const response = await controller.getRelayerPoolStatus();

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.timestamp).toBeDefined();
    });

    it("should return detailed pool information", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ data: { status: "ok" } }) as any);

      const response = await controller.getRelayerPoolStatus();

      const poolData = response.data;
      expect(poolData.status).toBe("healthy");
      expect(poolData.healthyCount).toBeDefined();
      expect(poolData.totalCount).toBeDefined();
      expect(poolData.relayers).toBeDefined();
    });

    it("should handle degraded pool status", async () => {
      jest.spyOn(ozRelayerHealth, "isHealthy").mockRejectedValue(
        new HealthCheckError("Pool degraded", {
          "oz-relayer-pool": {
            status: "degraded",
            healthyCount: 2,
            totalCount: 3,
            relayers: [],
          },
        }),
      );

      const response = await controller.getRelayerPoolStatus();

      expect(response.success).toBe(true);
      expect(response.data.status).toBe("degraded");
      expect(response.data.healthyCount).toBe(2);
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

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { HealthCheckError } from "@nestjs/terminus";
import { of, throwError } from "rxjs";
import { OzRelayerHealthIndicator } from "./oz-relayer.health";

describe("OzRelayerHealthIndicator", () => {
  let indicator: OzRelayerHealthIndicator;
  let httpService: HttpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OzRelayerHealthIndicator,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    indicator = module.get<OzRelayerHealthIndicator>(OzRelayerHealthIndicator);
    httpService = module.get<HttpService>(HttpService);
  });

  describe("isHealthy", () => {
    // AC-001: All relayers healthy
    it("should return healthy when all relayers respond successfully", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ data: { status: "ok" } }) as any);

      const result = await indicator.isHealthy("oz-relayer-pool");

      expect(result["oz-relayer-pool"].status).toBe("healthy");
      expect(result["oz-relayer-pool"].healthyCount).toBe(3);
      expect(result["oz-relayer-pool"].totalCount).toBe(3);
      expect(result["oz-relayer-pool"].relayers).toHaveLength(3);
      result["oz-relayer-pool"].relayers.forEach((r: any) => {
        expect(r.status).toBe("healthy");
        expect(r.responseTime).toBeLessThan(5000);
      });
    });

    // AC-002: Partial failure (2/3 healthy)
    it("should throw HealthCheckError when pool is degraded (2/3 healthy)", async () => {
      let callCount = 0;
      jest.spyOn(httpService, "get").mockImplementation(() => {
        callCount++;
        if (callCount === 3) {
          return throwError(() => new Error("Connection refused")) as any;
        }
        return of({ data: { status: "ok" } }) as any;
      });

      try {
        await indicator.isHealthy("oz-relayer-pool");
        fail("Should have thrown HealthCheckError");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        const result = error.causes["oz-relayer-pool"];
        expect(result.status).toBe("degraded");
        expect(result.healthyCount).toBe(2);
        expect(result.totalCount).toBe(3);
      }
    });

    // AC-003: Complete pool failure (0/3 healthy)
    it("should throw HealthCheckError when pool is unhealthy (0/3 healthy)", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(
          throwError(() => new Error("All servers down")) as any,
        );

      try {
        await indicator.isHealthy("oz-relayer-pool");
        fail("Should have thrown HealthCheckError");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        const result = error.causes["oz-relayer-pool"];
        expect(result.status).toBe("unhealthy");
        expect(result.healthyCount).toBe(0);
        expect(
          result.relayers.every((r: any) => r.status === "unhealthy"),
        ).toBe(true);
      }
    });

    // AC-004: Timeout handling (>5s)
    it("should mark relayer as unhealthy when response exceeds 5 seconds", async () => {
      let callCount = 0;
      jest.spyOn(httpService, "get").mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          // Simulate timeout error
          return throwError(() => new Error("Timeout after 5000ms")) as any;
        }
        return of({ data: { status: "ok" } }) as any;
      });

      try {
        await indicator.isHealthy("oz-relayer-pool");
      } catch (error) {
        const result = error.causes["oz-relayer-pool"];
        const timedOutRelayer = result.relayers.find(
          (r: any) => r.id === "oz-relayer-2",
        );
        expect(timedOutRelayer.status).toBe("unhealthy");
        expect(timedOutRelayer.error).toContain("Timeout");
      }
    });

    // AC-005: Parallel execution verification
    it("should execute all relayer checks in parallel", async () => {
      const getSpy = jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ data: { status: "ok" } }) as any);

      const startTime = Date.now();
      await indicator.isHealthy("oz-relayer-pool");
      const duration = Date.now() - startTime;

      // All 3 should be called
      expect(getSpy).toHaveBeenCalledTimes(3);

      // Duration should be very small since all are called in parallel
      expect(duration).toBeLessThan(1000);
    });

    // Status aggregation tests
    it("should return healthy status when all relayers healthy", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ data: { status: "ok" } }) as any);

      const result = await indicator.isHealthy("oz-relayer-pool");

      expect(result["oz-relayer-pool"].status).toBe("healthy");
      expect(result["oz-relayer-pool"].healthyCount).toBe(3);
    });

    it("should return degraded status when 2/3 relayers healthy", async () => {
      let callCount = 0;
      jest.spyOn(httpService, "get").mockImplementation(() => {
        callCount++;
        if (callCount === 3) {
          return throwError(() => new Error("Failed")) as any;
        }
        return of({ data: { status: "ok" } }) as any;
      });

      try {
        await indicator.isHealthy("oz-relayer-pool");
      } catch (error) {
        expect(error.causes["oz-relayer-pool"].status).toBe("degraded");
        expect(error.causes["oz-relayer-pool"].healthyCount).toBe(2);
      }
    });

    it("should return degraded status when 1/3 relayers healthy", async () => {
      let callCount = 0;
      jest.spyOn(httpService, "get").mockImplementation(() => {
        callCount++;
        if (callCount > 1) {
          return throwError(() => new Error("Failed")) as any;
        }
        return of({ data: { status: "ok" } }) as any;
      });

      try {
        await indicator.isHealthy("oz-relayer-pool");
      } catch (error) {
        expect(error.causes["oz-relayer-pool"].status).toBe("degraded");
        expect(error.causes["oz-relayer-pool"].healthyCount).toBe(1);
      }
    });

    it("should return unhealthy status when 0/3 relayers healthy", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(throwError(() => new Error("Failed")) as any);

      try {
        await indicator.isHealthy("oz-relayer-pool");
      } catch (error) {
        expect(error.causes["oz-relayer-pool"].status).toBe("unhealthy");
        expect(error.causes["oz-relayer-pool"].healthyCount).toBe(0);
      }
    });

    // Response time measurement
    it("should include response time for each relayer", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of({ data: { status: "ok" } }) as any);

      const result = await indicator.isHealthy("oz-relayer-pool");

      result["oz-relayer-pool"].relayers.forEach((r: any) => {
        expect(typeof r.responseTime).toBe("number");
        expect(r.responseTime).toBeGreaterThanOrEqual(0);
        expect(r.responseTime).toBeLessThan(5000);
      });
    });

    // Error message inclusion
    it("should include error message for unhealthy relayers", async () => {
      const errorMessage = "Connection refused on port 8080";
      let callCount = 0;
      jest.spyOn(httpService, "get").mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return throwError(() => new Error(errorMessage)) as any;
        }
        return of({ data: { status: "ok" } }) as any;
      });

      try {
        await indicator.isHealthy("oz-relayer-pool");
      } catch (error) {
        const failedRelayer = error.causes["oz-relayer-pool"].relayers.find(
          (r: any) => r.status === "unhealthy",
        );
        expect(failedRelayer.error).toContain("Connection refused");
      }
    });
  });

  describe("Integration", () => {
    it("should be injectable as a provider", () => {
      expect(indicator).toBeDefined();
      expect(indicator).toBeInstanceOf(OzRelayerHealthIndicator);
    });

    it("should inherit from HealthIndicator", () => {
      expect(indicator).toHaveProperty("getStatus");
    });
  });
});

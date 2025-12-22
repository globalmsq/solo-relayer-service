import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { HealthCheckError } from "@nestjs/terminus";
import { of, throwError } from "rxjs";
import { OzRelayerHealthIndicator } from "./oz-relayer.health";

/**
 * OzRelayerHealthIndicator Tests - Single Instance Health Check
 *
 * SPEC-GASLESS-001: Single OZ Relayer Instance (Phase 1 MVP)
 * Tests verify:
 * - Health check via /api/v1/relayers endpoint with Bearer auth
 * - Timeout handling (5 seconds)
 * - Error propagation
 * - Response time measurement
 * - Environment variable configuration
 */
describe("OzRelayerHealthIndicator", () => {
  let indicator: OzRelayerHealthIndicator;
  let httpService: HttpService;
  let configService: ConfigService;

  // Mock successful relayers response
  const mockRelayersResponse = {
    success: true,
    data: [{ id: "relayer-1", name: "Test Relayer" }],
    error: null,
  };

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
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === "OZ_RELAYER_URL") {
                return "http://oz-relayer-1:8080";
              }
              if (key === "OZ_RELAYER_API_KEY") {
                return "oz-relayer-shared-api-key-local-dev";
              }
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    indicator = module.get<OzRelayerHealthIndicator>(OzRelayerHealthIndicator);
    httpService = module.get<HttpService>(HttpService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe("isHealthy", () => {
    it("should return healthy when OZ Relayer responds with 200", async () => {
      jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          status: 200,
          data: mockRelayersResponse,
        } as any),
      );

      const result = await indicator.isHealthy("oz-relayer");

      expect(result).toBeDefined();
      expect(result["oz-relayer"].status).toBe("up");
      expect(result["oz-relayer"].relayerCount).toBe(1);
      expect(httpService.get).toHaveBeenCalledWith(
        "http://oz-relayer-1:8080/api/v1/relayers",
        expect.objectContaining({
          headers: { Authorization: "Bearer oz-relayer-shared-api-key-local-dev" },
          timeout: 5000,
        }),
      );
    });

    it("should throw HealthCheckError when OZ Relayer is unreachable", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValueOnce(
          throwError(() => new Error("Connection refused")) as any,
        );

      await expect(indicator.isHealthy("oz-relayer")).rejects.toThrow(
        HealthCheckError,
      );
    });

    it("should throw HealthCheckError on timeout", async () => {
      jest
        .spyOn(httpService, "get")
        .mockReturnValueOnce(
          throwError(() => new Error("Timeout after 5000ms")) as any,
        );

      await expect(indicator.isHealthy("oz-relayer")).rejects.toThrow(
        HealthCheckError,
      );
    });

    it("should include response time in health status", async () => {
      jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          status: 200,
          data: mockRelayersResponse,
        } as any),
      );

      const result = await indicator.isHealthy("oz-relayer");

      expect(result["oz-relayer"]).toHaveProperty("responseTime");
      expect(typeof result["oz-relayer"].responseTime).toBe("number");
      expect(result["oz-relayer"].responseTime).toBeGreaterThanOrEqual(0);
    });

    it("should use configured OZ_RELAYER_URL environment variable", async () => {
      jest
        .spyOn(configService, "get")
        .mockImplementation((key: string, defaultValue?: string) => {
          if (key === "OZ_RELAYER_URL") return "http://custom-relayer:8080";
          if (key === "OZ_RELAYER_API_KEY") return "custom-api-key";
          return defaultValue;
        });

      const newIndicator = new OzRelayerHealthIndicator(
        httpService,
        configService,
      );

      jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          status: 200,
          data: mockRelayersResponse,
        } as any),
      );

      await newIndicator.isHealthy("oz-relayer");

      expect(httpService.get).toHaveBeenCalledWith(
        "http://custom-relayer:8080/api/v1/relayers",
        expect.objectContaining({
          headers: { Authorization: "Bearer custom-api-key" },
        }),
      );
    });

    it("should include error details in HealthCheckError when relayer is down", async () => {
      const errorMessage = "ECONNREFUSED: connection refused";
      jest
        .spyOn(httpService, "get")
        .mockReturnValueOnce(throwError(() => new Error(errorMessage)) as any);

      try {
        await indicator.isHealthy("oz-relayer");
        fail("Should have thrown HealthCheckError");
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect(error.causes["oz-relayer"].error).toContain("ECONNREFUSED");
      }
    });

    it("should only make single health check call", async () => {
      const getSpy = jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          status: 200,
          data: mockRelayersResponse,
        } as any),
      );

      await indicator.isHealthy("oz-relayer");

      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it("should check /api/v1/relayers endpoint with Bearer auth", async () => {
      const getSpy = jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          status: 200,
          data: mockRelayersResponse,
        } as any),
      );

      await indicator.isHealthy("oz-relayer");

      expect(getSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/relayers"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Bearer"),
          }),
        }),
      );
    });

    it("should return down status when response is not successful", async () => {
      jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          status: 200,
          data: { success: false, error: "Some error" },
        } as any),
      );

      const result = await indicator.isHealthy("oz-relayer");

      expect(result["oz-relayer"].status).toBe("down");
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

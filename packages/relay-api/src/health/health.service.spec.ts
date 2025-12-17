import { Test, TestingModule } from "@nestjs/testing";
import { HttpModule, HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { HealthService } from "./health.service";

describe("HealthService", () => {
  let service: HealthService;
  let httpService: HttpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [HealthService],
    }).compile();

    service = module.get<HealthService>(HealthService);
    httpService = module.get<HttpService>(HttpService);
  });

  describe("checkRelayerPoolHealth", () => {
    it("should return healthy status when all relayers are healthy", async () => {
      // Mock all relayers as healthy
      jest.spyOn(httpService, "get").mockReturnValue(
        of({
          data: { status: "healthy" },
          status: 200,
          statusText: "OK",
          headers: {},
          config: { url: "" },
        } as any),
      );

      const result = await service.checkRelayerPoolHealth();

      expect(result.status).toBe("healthy");
      expect(result.healthyCount).toBe(3);
      expect(result.totalCount).toBe(3);
      expect(result.relayers).toHaveLength(3);
      expect(result.relayers.every((r) => r.status === "healthy")).toBe(true);
    });

    it("should return degraded status when some relayers are unhealthy", async () => {
      // Mock: 1st call healthy, 2nd call healthy, 3rd call unhealthy
      const mockGet = jest.spyOn(httpService, "get");
      mockGet
        .mockReturnValueOnce(
          of({
            data: { status: "healthy" },
            status: 200,
            statusText: "OK",
            headers: {},
            config: { url: "" },
          } as any),
        )
        .mockReturnValueOnce(
          of({
            data: { status: "healthy" },
            status: 200,
            statusText: "OK",
            headers: {},
            config: { url: "" },
          } as any),
        )
        .mockReturnValueOnce(throwError(() => new Error("Connection refused")));

      const result = await service.checkRelayerPoolHealth();

      expect(result.status).toBe("degraded");
      expect(result.healthyCount).toBe(2);
      expect(result.totalCount).toBe(3);
    });

    it("should return unhealthy status when all relayers are unhealthy", async () => {
      // Mock all relayers as unhealthy
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(throwError(() => new Error("Connection timeout")));

      const result = await service.checkRelayerPoolHealth();

      expect(result.status).toBe("unhealthy");
      expect(result.healthyCount).toBe(0);
      expect(result.totalCount).toBe(3);
      expect(result.relayers.every((r) => r.status === "unhealthy")).toBe(true);
    });

    it("should include response time in relayer health check", async () => {
      jest.spyOn(httpService, "get").mockReturnValue(
        of({
          data: { status: "healthy" },
          status: 200,
          statusText: "OK",
          headers: {},
          config: { url: "" },
        } as any),
      );

      const result = await service.checkRelayerPoolHealth();

      expect(result.relayers[0].responseTime).toBeDefined();
      expect(result.relayers[0].responseTime).toBeGreaterThanOrEqual(0);
    });

    it("should include error information when relayer is unhealthy", async () => {
      const errorMessage = "Connection refused";
      jest
        .spyOn(httpService, "get")
        .mockReturnValueOnce(
          of({
            data: { status: "healthy" },
            status: 200,
            statusText: "OK",
            headers: {},
            config: { url: "" },
          } as any),
        )
        .mockReturnValueOnce(
          of({
            data: { status: "healthy" },
            status: 200,
            statusText: "OK",
            headers: {},
            config: { url: "" },
          } as any),
        )
        .mockReturnValueOnce(throwError(() => new Error(errorMessage)));

      const result = await service.checkRelayerPoolHealth();

      expect(result.relayers[2].error).toBe(errorMessage);
    });
  });

  describe("getSystemHealth", () => {
    it("should return overall healthy status", async () => {
      jest.spyOn(httpService, "get").mockReturnValue(
        of({
          data: { status: "healthy" },
          status: 200,
          statusText: "OK",
          headers: {},
          config: { url: "" },
        } as any),
      );

      const result = await service.getSystemHealth();

      expect(result.status).toBe("healthy");
      expect(result.services["relay-api"]).toBe("healthy");
      expect(result.services.redis).toBe("healthy");
      expect(result.timestamp).toBeDefined();
    });

    it("should include all required fields in response", async () => {
      jest.spyOn(httpService, "get").mockReturnValue(
        of({
          data: { status: "healthy" },
          status: 200,
          statusText: "OK",
          headers: {},
          config: { url: "" },
        } as any),
      );

      const result = await service.getSystemHealth();

      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("services");
      expect(result.services).toHaveProperty("relay-api");
      expect(result.services).toHaveProperty("oz-relayer-pool");
      expect(result.services).toHaveProperty("redis");
    });

    it("should set timestamp to ISO format", async () => {
      jest.spyOn(httpService, "get").mockReturnValue(
        of({
          data: { status: "healthy" },
          status: 200,
          statusText: "OK",
          headers: {},
          config: { url: "" },
        } as any),
      );

      const result = await service.getSystemHealth();
      const timestamp = new Date(result.timestamp);

      expect(timestamp.getTime()).toBeGreaterThan(0);
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("checkRedisHealth", () => {
    it("should return healthy for Redis", async () => {
      const result = await service.checkRedisHealth();

      expect(result).toBe("healthy");
    });
  });
});

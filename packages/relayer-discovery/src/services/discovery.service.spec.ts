import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { DiscoveryService } from "./discovery.service";
import { RedisService } from "./redis.service";
import { of, throwError } from "rxjs";
import { AxiosResponse } from "axios";

describe("DiscoveryService", () => {
  let service: DiscoveryService;
  let redisService: RedisService;
  let httpService: HttpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        {
          provide: RedisService,
          useValue: {
            sadd: jest.fn(),
            srem: jest.fn(),
            smembers: jest.fn(),
            scard: jest.fn(),
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
            get: jest.fn((key: string) => {
              const config: Record<string, any> = {
                "discovery.relayerCount": 3,
                "discovery.healthCheckInterval": 10000,
                "discovery.healthCheckTimeout": 500,
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<DiscoveryService>(DiscoveryService);
    redisService = module.get<RedisService>(RedisService);
    httpService = module.get<HttpService>(HttpService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe("onModuleInit", () => {
    it("should start health check loop", async () => {
      jest
        .spyOn(service as any, "performHealthChecks")
        .mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(service["performHealthChecks"]).toHaveBeenCalled();
    });

    it("should schedule periodic health checks", async () => {
      jest.useFakeTimers();
      jest
        .spyOn(service as any, "performHealthChecks")
        .mockResolvedValue(undefined);

      await service.onModuleInit();

      jest.advanceTimersByTime(10000);
      expect(service["performHealthChecks"]).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(10000);
      expect(service["performHealthChecks"]).toHaveBeenCalledTimes(3);

      jest.useRealTimers();
    });
  });

  describe("onModuleDestroy", () => {
    it("should stop health check interval", async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(service["interval"]).toBeNull();
    });
  });

  describe("performHealthChecks", () => {
    it("should check health of all configured relayers", async () => {
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

      await service["performHealthChecks"]();

      expect(httpService.get).toHaveBeenCalledTimes(3); // relayerCount = 3
      expect(httpService.get).toHaveBeenCalledWith(
        "http://oz-relayer-0:3000/health",
        { timeout: 500 },
      );
      expect(httpService.get).toHaveBeenCalledWith(
        "http://oz-relayer-0:3000/health",
        { timeout: 500 },
      );
      expect(httpService.get).toHaveBeenCalledWith(
        "http://oz-relayer-1:3000/health",
        { timeout: 500 },
      );
    });

    it("should add healthy relayers to Redis active list", async () => {
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

      await service["performHealthChecks"]();

      expect(redisService.sadd).toHaveBeenCalledWith(
        "relayer:active",
        "oz-relayer-0",
      );
      expect(redisService.sadd).toHaveBeenCalledWith(
        "relayer:active",
        "oz-relayer-0",
      );
      expect(redisService.sadd).toHaveBeenCalledWith(
        "relayer:active",
        "oz-relayer-1",
      );
    });

    it("should remove unhealthy relayers from Redis active list", async () => {
      jest.spyOn(httpService, "get").mockImplementation((url: string) => {
        if (url.includes("oz-relayer-0")) {
          return throwError(() => new Error("Connection refused"));
        }
        return of({
          status: 200,
          data: {},
          statusText: "OK",
          headers: {},
          config: {} as any,
        } as AxiosResponse);
      });

      await service["performHealthChecks"]();

      expect(redisService.srem).toHaveBeenCalledWith(
        "relayer:active",
        "oz-relayer-0",
      );
      expect(redisService.sadd).toHaveBeenCalledWith(
        "relayer:active",
        "oz-relayer-1",
      );
      expect(redisService.sadd).toHaveBeenCalledWith(
        "relayer:active",
        "oz-relayer-2",
      );
    });

    it("should handle non-200 HTTP status as unhealthy", async () => {
      jest.spyOn(httpService, "get").mockImplementation((url: string) => {
        if (url.includes("oz-relayer-0")) {
          return of({
            status: 500,
            data: {},
            statusText: "Internal Server Error",
            headers: {},
            config: {} as any,
          } as AxiosResponse);
        }
        return of({
          status: 200,
          data: {},
          statusText: "OK",
          headers: {},
          config: {} as any,
        } as AxiosResponse);
      });

      await service["performHealthChecks"]();

      expect(redisService.srem).toHaveBeenCalledWith(
        "relayer:active",
        "oz-relayer-0",
      );
    });

    it("should handle timeout as unhealthy", async () => {
      jest.spyOn(httpService, "get").mockImplementation((url: string) => {
        if (url.includes("oz-relayer-0")) {
          return throwError(() => ({
            code: "ECONNABORTED",
            message: "timeout",
          }));
        }
        return of({
          status: 200,
          data: {},
          statusText: "OK",
          headers: {},
          config: {} as any,
        } as AxiosResponse);
      });

      await service["performHealthChecks"]();

      expect(redisService.srem).toHaveBeenCalledWith(
        "relayer:active",
        "oz-relayer-0",
      );
    });

    it("should update lastCheckTimestamps for all relayers", async () => {
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

      await service["performHealthChecks"]();

      expect(service["lastCheckTimestamps"].size).toBe(3);
      expect(service["lastCheckTimestamps"].has("oz-relayer-0")).toBe(true);
      expect(service["lastCheckTimestamps"].has("oz-relayer-0")).toBe(true);
      expect(service["lastCheckTimestamps"].has("oz-relayer-1")).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("should return service status with active relayers", async () => {
      jest
        .spyOn(redisService, "smembers")
        .mockResolvedValue(["oz-relayer-0", "oz-relayer-1"]);

      const status = await service.getStatus();

      expect(status.service).toBe("relayer-discovery");
      expect(status.totalConfigured).toBe(3);
      expect(status.totalActive).toBe(2);
      expect(status.activeRelayers).toHaveLength(2);
      expect(status.healthCheckInterval).toBe(10000);
    });

    it("should determine status as healthy when all relayers active", async () => {
      jest
        .spyOn(redisService, "smembers")
        .mockResolvedValue(["oz-relayer-0", "oz-relayer-0", "oz-relayer-1"]);

      const status = await service.getStatus();

      expect(status.status).toBe("healthy");
      expect(status.totalActive).toBe(3);
    });

    it("should determine status as degraded when some relayers active", async () => {
      jest
        .spyOn(redisService, "smembers")
        .mockResolvedValue(["oz-relayer-0", "oz-relayer-1"]);

      const status = await service.getStatus();

      expect(status.status).toBe("degraded");
      expect(status.totalActive).toBe(2);
    });

    it("should determine status as unhealthy when no relayers active", async () => {
      jest.spyOn(redisService, "smembers").mockResolvedValue([]);

      const status = await service.getStatus();

      expect(status.status).toBe("unhealthy");
      expect(status.totalActive).toBe(0);
    });

    it("should include last check timestamps for active relayers", async () => {
      jest.spyOn(redisService, "smembers").mockResolvedValue(["oz-relayer-0"]);
      const timestamp = "2026-01-19T12:30:00.000Z";
      service["lastCheckTimestamps"].set("oz-relayer-0", timestamp);

      const status = await service.getStatus();

      expect(status.activeRelayers[0].lastCheckTimestamp).toBe(timestamp);
    });

    it("should set lastCheckTimestamp to null for relayers without timestamp", async () => {
      jest.spyOn(redisService, "smembers").mockResolvedValue(["oz-relayer-0"]);

      const status = await service.getStatus();

      expect(status.activeRelayers[0].lastCheckTimestamp).toBeNull();
    });

    it("should construct correct relayer URLs", async () => {
      jest
        .spyOn(redisService, "smembers")
        .mockResolvedValue(["oz-relayer-0", "oz-relayer-0"]);

      const status = await service.getStatus();

      expect(status.activeRelayers[0].url).toBe("http://oz-relayer-0:3000");
      expect(status.activeRelayers[1].url).toBe("http://oz-relayer-0:3000");
    });
  });

  describe("generateRelayerIds", () => {
    it("should generate relayer IDs based on configured count", () => {
      const ids = service["generateRelayerIds"]();

      expect(ids).toHaveLength(3);
      expect(ids).toEqual(["oz-relayer-0", "oz-relayer-1", "oz-relayer-2"]);
    });
  });

  describe("constructHealthUrl", () => {
    it("should construct correct health check URL", () => {
      const url = service["constructHealthUrl"]("oz-relayer-0");

      expect(url).toBe("http://oz-relayer-0:3000/health");
    });
  });

  describe("determineOverallStatus", () => {
    it("should return healthy when all relayers active", () => {
      const status = service["determineOverallStatus"](3);

      expect(status).toBe("healthy");
    });

    it("should return healthy when more than configured relayers active", () => {
      const status = service["determineOverallStatus"](5);

      expect(status).toBe("healthy");
    });

    it("should return degraded when some relayers active", () => {
      const status = service["determineOverallStatus"](2);

      expect(status).toBe("degraded");
    });

    it("should return degraded when only one relayer active", () => {
      const status = service["determineOverallStatus"](1);

      expect(status).toBe("degraded");
    });

    it("should return unhealthy when no relayers active", () => {
      const status = service["determineOverallStatus"](0);

      expect(status).toBe("unhealthy");
    });
  });

  describe("logging and error handling", () => {
    it("should log debug message for successful health check", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "debug");
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

      await service["checkRelayerHealth"]("oz-relayer-0");

      expect(loggerSpy).toHaveBeenCalledWith(
        "Health check passed for oz-relayer-0",
      );
    });

    it("should log warning for non-200 status code", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "warn");
      const mockResponse: Partial<AxiosResponse> = {
        status: 500,
        data: {},
        statusText: "Internal Server Error",
        headers: {},
        config: {} as any,
      };
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(of(mockResponse as AxiosResponse));

      await service["checkRelayerHealth"]("oz-relayer-0");

      expect(loggerSpy).toHaveBeenCalledWith(
        "Health check failed for oz-relayer-0: HTTP 500",
      );
    });

    it("should log warning for exception with error code", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "warn");
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(throwError(() => ({ code: "ECONNREFUSED" })));

      await service["checkRelayerHealth"]("oz-relayer-0");

      expect(loggerSpy).toHaveBeenCalledWith(
        "Health check failed for oz-relayer-0: ECONNREFUSED",
      );
    });

    it("should log warning for unknown error", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "warn");
      jest.spyOn(httpService, "get").mockReturnValue(throwError(() => ({})));

      await service["checkRelayerHealth"]("oz-relayer-0");

      expect(loggerSpy).toHaveBeenCalledWith(
        "Health check failed for oz-relayer-0: unknown error",
      );
    });

    it("should log when relayer is added to active list", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "log");
      jest.spyOn(redisService, "sadd").mockResolvedValue(1);

      await service["addActiveRelayer"]("oz-relayer-0");

      expect(loggerSpy).toHaveBeenCalledWith(
        "Added oz-relayer-0 to active list",
      );
    });

    it("should not log when relayer already in active list", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "log");
      jest.spyOn(redisService, "sadd").mockResolvedValue(0);

      await service["addActiveRelayer"]("oz-relayer-0");

      expect(loggerSpy).not.toHaveBeenCalledWith(
        "Added oz-relayer-0 to active list",
      );
    });

    it("should log when relayer is removed from active list", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "warn");
      jest.spyOn(redisService, "srem").mockResolvedValue(1);

      await service["removeActiveRelayer"]("oz-relayer-0");

      expect(loggerSpy).toHaveBeenCalledWith(
        "Removed oz-relayer-0 from active list",
      );
    });

    it("should not log when relayer was not in active list", async () => {
      const loggerSpy = jest.spyOn(service["logger"], "warn");
      jest.spyOn(redisService, "srem").mockResolvedValue(0);

      await service["removeActiveRelayer"]("oz-relayer-0");

      expect(loggerSpy).not.toHaveBeenCalledWith(
        "Removed oz-relayer-0 from active list",
      );
    });
  });
});

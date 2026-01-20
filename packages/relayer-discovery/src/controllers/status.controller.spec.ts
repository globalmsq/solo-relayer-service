import { Test, TestingModule } from "@nestjs/testing";
import { StatusController } from "./status.controller";
import { DiscoveryService } from "../services/discovery.service";
import { StatusResponse } from "../dto/status-response.dto";

describe("StatusController", () => {
  let controller: StatusController;
  let discoveryService: DiscoveryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatusController],
      providers: [
        {
          provide: DiscoveryService,
          useValue: {
            getStatus: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<StatusController>(StatusController);
    discoveryService = module.get<DiscoveryService>(DiscoveryService);
  });

  describe("getStatus", () => {
    it("should return status response from DiscoveryService", async () => {
      const mockStatus: StatusResponse = {
        service: "relayer-discovery",
        status: "healthy",
        timestamp: "2026-01-19T12:30:00.000Z",
        activeRelayers: [
          {
            id: "oz-relayer-0",
            status: "healthy",
            lastCheckTimestamp: "2026-01-19T12:29:55.000Z",
            url: "http://oz-relayer-0:3000",
          },
          {
            id: "oz-relayer-0",
            status: "healthy",
            lastCheckTimestamp: "2026-01-19T12:29:55.000Z",
            url: "http://oz-relayer-0:3000",
          },
        ],
        totalConfigured: 3,
        totalActive: 2,
        healthCheckInterval: 10000,
      };

      jest.spyOn(discoveryService, "getStatus").mockResolvedValue(mockStatus);

      const result = await controller.getStatus();

      expect(result).toEqual(mockStatus);
      expect(discoveryService.getStatus).toHaveBeenCalled();
    });

    it("should return degraded status when some relayers down", async () => {
      const mockStatus: StatusResponse = {
        service: "relayer-discovery",
        status: "degraded",
        timestamp: "2026-01-19T12:30:00.000Z",
        activeRelayers: [
          {
            id: "oz-relayer-0",
            status: "healthy",
            lastCheckTimestamp: "2026-01-19T12:29:55.000Z",
            url: "http://oz-relayer-0:3000",
          },
        ],
        totalConfigured: 3,
        totalActive: 1,
        healthCheckInterval: 10000,
      };

      jest.spyOn(discoveryService, "getStatus").mockResolvedValue(mockStatus);

      const result = await controller.getStatus();

      expect(result.status).toBe("degraded");
      expect(result.totalActive).toBe(1);
    });

    it("should return unhealthy status when no relayers active", async () => {
      const mockStatus: StatusResponse = {
        service: "relayer-discovery",
        status: "unhealthy",
        timestamp: "2026-01-19T12:30:00.000Z",
        activeRelayers: [],
        totalConfigured: 3,
        totalActive: 0,
        healthCheckInterval: 10000,
      };

      jest.spyOn(discoveryService, "getStatus").mockResolvedValue(mockStatus);

      const result = await controller.getStatus();

      expect(result.status).toBe("unhealthy");
      expect(result.activeRelayers).toHaveLength(0);
    });
  });
});

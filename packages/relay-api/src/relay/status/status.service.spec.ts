import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { of, throwError } from "rxjs";
import { StatusService } from "./status.service";
import { OzRelayerService } from "../../oz-relayer/oz-relayer.service";

/**
 * StatusService Unit Tests
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * Tests for StatusService.getTransactionStatus() method with direct HTTP calls
 */
describe("StatusService", () => {
  let service: StatusService;
  let httpService: HttpService;
  let configService: ConfigService;
  let ozRelayerService: OzRelayerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatusService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: string) => defaultValue),
          },
        },
        {
          provide: OzRelayerService,
          useValue: {
            getRelayerId: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<StatusService>(StatusService);
    httpService = module.get<HttpService>(HttpService);
    configService = module.get<ConfigService>(ConfigService);
    ozRelayerService = module.get<OzRelayerService>(OzRelayerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getTransactionStatus", () => {
    const validTxId = "123e4567-e89b-12d3-a456-426614174000";
    const relayerId = "test-relayer-id";
    const relayerUrl = "http://oz-relayer-lb:8080";
    const apiKey = "test-api-key";

    /**
     * Test 1: Valid transaction ID returns status
     */
    it("should return transaction status for valid transaction ID", async () => {
      const mockResponse = {
        data: {
          data: {
            id: validTxId,
            hash: "0x123456789...",
            status: "confirmed",
            created_at: "2025-12-22T10:00:00.000Z",
            confirmed_at: "2025-12-22T10:05:00.000Z",
            from: "0xUser123...",
            to: "0xContract456...",
            value: "1000000000000000000",
          },
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      jest.spyOn(ozRelayerService, "getRelayerId").mockResolvedValue(relayerId);
      jest.spyOn(configService, "get").mockImplementation((key: string) => {
        if (key === "OZ_RELAYER_URL") return relayerUrl;
        if (key === "OZ_RELAYER_API_KEY") return apiKey;
        return undefined;
      });
      jest.spyOn(httpService, "get").mockReturnValue(of(mockResponse as any));

      const result = await service.getTransactionStatus(validTxId);

      expect(result).toEqual({
        transactionId: validTxId,
        hash: "0x123456789...",
        status: "confirmed",
        createdAt: "2025-12-22T10:00:00.000Z",
        confirmedAt: "2025-12-22T10:05:00.000Z",
        from: "0xUser123...",
        to: "0xContract456...",
        value: "1000000000000000000",
      });

      expect(ozRelayerService.getRelayerId).toHaveBeenCalledTimes(1);
      expect(httpService.get).toHaveBeenCalledWith(
        `${relayerUrl}/api/v1/relayers/${relayerId}/transactions/${validTxId}`,
        expect.objectContaining({
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 10000,
        }),
      );
    });

    /**
     * Test 2: Transaction not found (404) throws NotFoundException
     */
    it("should throw NotFoundException when transaction not found (404)", async () => {
      const notFoundError = {
        response: {
          status: 404,
          data: { message: "Not found" },
        },
      };

      jest.spyOn(ozRelayerService, "getRelayerId").mockResolvedValue(relayerId);
      jest.spyOn(configService, "get").mockImplementation((key: string) => {
        if (key === "OZ_RELAYER_URL") return relayerUrl;
        if (key === "OZ_RELAYER_API_KEY") return apiKey;
        return undefined;
      });
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(throwError(() => notFoundError));

      await expect(service.getTransactionStatus(validTxId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getTransactionStatus(validTxId)).rejects.toThrow(
        "Transaction not found",
      );
    });

    /**
     * Test 3: OZ Relayer unavailable throws ServiceUnavailableException
     */
    it("should throw ServiceUnavailableException when OZ Relayer unavailable", async () => {
      const networkError = new Error("ECONNREFUSED");

      jest.spyOn(ozRelayerService, "getRelayerId").mockResolvedValue(relayerId);
      jest.spyOn(configService, "get").mockImplementation((key: string) => {
        if (key === "OZ_RELAYER_URL") return relayerUrl;
        if (key === "OZ_RELAYER_API_KEY") return apiKey;
        return undefined;
      });
      jest
        .spyOn(httpService, "get")
        .mockReturnValue(throwError(() => networkError));

      await expect(service.getTransactionStatus(validTxId)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(service.getTransactionStatus(validTxId)).rejects.toThrow(
        "OZ Relayer service unavailable",
      );
    });

    /**
     * Test 4: Response transformation correctness
     */
    it("should correctly transform OZ Relayer response to DTO", async () => {
      const mockResponse = {
        data: {
          data: {
            id: validTxId,
            hash: null,
            status: "pending",
            created_at: "2025-12-22T10:00:00.000Z",
            // confirmed_at, from, to, value are optional and omitted
          },
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      jest.spyOn(ozRelayerService, "getRelayerId").mockResolvedValue(relayerId);
      jest.spyOn(configService, "get").mockImplementation((key: string) => {
        if (key === "OZ_RELAYER_URL") return relayerUrl;
        if (key === "OZ_RELAYER_API_KEY") return apiKey;
        return undefined;
      });
      jest.spyOn(httpService, "get").mockReturnValue(of(mockResponse as any));

      const result = await service.getTransactionStatus(validTxId);

      // Verify required fields are present
      expect(result).toHaveProperty("transactionId");
      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("createdAt");

      // Verify types
      expect(typeof result.transactionId).toBe("string");
      expect(result.hash === null || typeof result.hash === "string").toBe(
        true,
      );
      expect(typeof result.status).toBe("string");
      expect(typeof result.createdAt).toBe("string");

      // Verify optional fields handling
      expect(result.confirmedAt).toBeUndefined();
      expect(result.from).toBeUndefined();
      expect(result.to).toBeUndefined();
      expect(result.value).toBeUndefined();
    });
  });
});

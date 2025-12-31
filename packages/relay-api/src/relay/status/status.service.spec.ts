import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { of, throwError } from "rxjs";
import { StatusService } from "./status.service";
import { OzRelayerService } from "../../oz-relayer/oz-relayer.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";

/**
 * StatusService Unit Tests
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * SPEC-WEBHOOK-001: TX History & Webhook System - 3-Tier Cache Integration
 *
 * Tests for StatusService.getTransactionStatus() method with 3-Tier Lookup
 */
describe("StatusService", () => {
  let service: StatusService;
  let httpService: HttpService;
  let configService: ConfigService;
  let ozRelayerService: OzRelayerService;
  let prismaService: PrismaService;
  let redisService: RedisService;

  const validTxId = "123e4567-e89b-12d3-a456-426614174000";
  const relayerId = "test-relayer-id";
  const relayerUrl = "http://oz-relayer-lb:8080";
  const apiKey = "test-api-key";

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
        {
          provide: PrismaService,
          useValue: {
            transaction: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue({}),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<StatusService>(StatusService);
    httpService = module.get<HttpService>(HttpService);
    configService = module.get<ConfigService>(ConfigService);
    ozRelayerService = module.get<OzRelayerService>(OzRelayerService);
    prismaService = module.get<PrismaService>(PrismaService);
    redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getTransactionStatus - 3-Tier Lookup", () => {
    /**
     * Test Tier 1: Redis cache hit
     */
    it("should return cached data from Redis (Tier 1)", async () => {
      const cachedData = {
        transactionId: validTxId,
        hash: "0x123456789...",
        status: "confirmed",
        createdAt: "2025-12-22T10:00:00.000Z",
        confirmedAt: "2025-12-22T10:05:00.000Z",
      };

      jest.spyOn(redisService, "get").mockResolvedValueOnce(cachedData);

      const result = await service.getTransactionStatus(validTxId);

      expect(result).toEqual(cachedData);
      expect(redisService.get).toHaveBeenCalledWith(`tx:status:${validTxId}`);
      // Should NOT hit MySQL or OZ Relayer
      expect(prismaService.transaction.findUnique).not.toHaveBeenCalled();
      expect(httpService.get).not.toHaveBeenCalled();
    });

    /**
     * Test Tier 2: MySQL hit with Redis backfill
     */
    it("should return data from MySQL and backfill Redis (Tier 2)", async () => {
      const storedData = {
        id: validTxId,
        hash: "0x123456789...",
        status: "confirmed",
        createdAt: new Date("2025-12-22T10:00:00.000Z"),
        updatedAt: new Date(),
        confirmedAt: new Date("2025-12-22T10:05:00.000Z"),
        from: "0xUser123...",
        to: "0xContract456...",
        value: "1000000000000000000",
        data: null,
      };

      jest.spyOn(redisService, "get").mockResolvedValueOnce(null);
      jest
        .spyOn(prismaService.transaction, "findUnique")
        .mockResolvedValueOnce(storedData);

      const result = await service.getTransactionStatus(validTxId);

      expect(result.transactionId).toEqual(validTxId);
      expect(result.status).toEqual("confirmed");
      expect(prismaService.transaction.findUnique).toHaveBeenCalledWith({
        where: { id: validTxId },
      });
      // Should backfill Redis
      expect(redisService.set).toHaveBeenCalledWith(
        `tx:status:${validTxId}`,
        expect.objectContaining({ transactionId: validTxId }),
        600,
      );
      // Should NOT hit OZ Relayer
      expect(httpService.get).not.toHaveBeenCalled();
    });

    /**
     * Test Tier 3: OZ Relayer fetch and storage
     */
    it("should fetch from OZ Relayer and store in Redis + MySQL (Tier 3)", async () => {
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

      jest.spyOn(redisService, "get").mockResolvedValueOnce(null);
      jest
        .spyOn(prismaService.transaction, "findUnique")
        .mockResolvedValueOnce(null);
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

      // Should store in both Redis and MySQL
      expect(redisService.set).toHaveBeenCalled();
      expect(prismaService.transaction.create).toHaveBeenCalled();
    });

    /**
     * Test: Transaction not found (404) throws NotFoundException
     */
    it("should throw NotFoundException when transaction not found (404)", async () => {
      const notFoundError = {
        response: {
          status: 404,
          data: { message: "Not found" },
        },
      };

      jest.spyOn(redisService, "get").mockResolvedValueOnce(null);
      jest
        .spyOn(prismaService.transaction, "findUnique")
        .mockResolvedValueOnce(null);
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
     * Test: OZ Relayer unavailable throws ServiceUnavailableException
     */
    it("should throw ServiceUnavailableException when OZ Relayer unavailable", async () => {
      const networkError = new Error("ECONNREFUSED");

      jest.spyOn(redisService, "get").mockResolvedValueOnce(null);
      jest
        .spyOn(prismaService.transaction, "findUnique")
        .mockResolvedValueOnce(null);
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
     * Test: Response transformation correctness
     */
    it("should correctly transform OZ Relayer response to DTO", async () => {
      const mockResponse = {
        data: {
          data: {
            id: validTxId,
            hash: null,
            status: "pending",
            created_at: "2025-12-22T10:00:00.000Z",
          },
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      jest.spyOn(redisService, "get").mockResolvedValueOnce(null);
      jest
        .spyOn(prismaService.transaction, "findUnique")
        .mockResolvedValueOnce(null);
      jest.spyOn(ozRelayerService, "getRelayerId").mockResolvedValue(relayerId);
      jest.spyOn(configService, "get").mockImplementation((key: string) => {
        if (key === "OZ_RELAYER_URL") return relayerUrl;
        if (key === "OZ_RELAYER_API_KEY") return apiKey;
        return undefined;
      });
      jest.spyOn(httpService, "get").mockReturnValue(of(mockResponse as any));

      const result = await service.getTransactionStatus(validTxId);

      expect(result).toHaveProperty("transactionId");
      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("createdAt");
      expect(typeof result.transactionId).toBe("string");
      expect(result.hash === null || typeof result.hash === "string").toBe(
        true,
      );
      expect(typeof result.status).toBe("string");
      expect(typeof result.createdAt).toBe("string");
      expect(result.confirmedAt).toBeUndefined();
      expect(result.from).toBeUndefined();
      expect(result.to).toBeUndefined();
      expect(result.value).toBeUndefined();
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { StatusService } from "./status.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";

/**
 * StatusService Unit Tests
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * SPEC-DISCOVERY-001: OZ Relayer removed - 2-Tier Lookup Only
 *
 * Tests for StatusService.getTransactionStatus() method with 2-Tier Lookup
 * (Redis + MySQL only, OZ Relayer direct calls removed)
 */
describe("StatusService", () => {
  let service: StatusService;
  let prismaService: PrismaService;
  let redisService: RedisService;

  const validTxId = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatusService,
        {
          provide: PrismaService,
          useValue: {
            transaction: {
              findUnique: jest.fn().mockResolvedValue(null),
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
    prismaService = module.get<PrismaService>(PrismaService);
    redisService = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getTransactionStatus - 2-Tier Lookup", () => {
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
      // Should NOT hit MySQL
      expect(prismaService.transaction.findUnique).not.toHaveBeenCalled();
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
        type: "direct",
        request: null,
        result: null,
        error_message: null,
        ozRelayerTxId: null,
        ozRelayerUrl: null,
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
    });

    /**
     * Test: Transaction not found throws NotFoundException
     * SPEC-DISCOVERY-001: No OZ Relayer fallback - returns 404 directly
     */
    it("should throw NotFoundException when transaction not found in Redis and MySQL", async () => {
      jest.spyOn(redisService, "get").mockResolvedValueOnce(null);
      jest
        .spyOn(prismaService.transaction, "findUnique")
        .mockResolvedValueOnce(null);

      await expect(service.getTransactionStatus(validTxId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getTransactionStatus(validTxId)).rejects.toThrow(
        "Transaction not found",
      );
    });

    /**
     * Test: Response transformation correctness
     */
    it("should correctly transform Prisma record to DTO", async () => {
      const storedData = {
        id: validTxId,
        hash: "0x123456789abcdef",
        status: "pending",
        createdAt: new Date("2025-12-22T10:00:00.000Z"),
        updatedAt: new Date(),
        confirmedAt: null,
        from: "0xUser123...",
        to: "0xContract456...",
        value: "1000000000000000000",
        data: null,
        type: "direct",
        request: null,
        result: null,
        error_message: null,
        ozRelayerTxId: null,
        ozRelayerUrl: null,
      };

      jest.spyOn(redisService, "get").mockResolvedValueOnce(null);
      jest
        .spyOn(prismaService.transaction, "findUnique")
        .mockResolvedValueOnce(storedData);

      const result = await service.getTransactionStatus(validTxId);

      expect(result).toHaveProperty("transactionId");
      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("createdAt");
      expect(typeof result.transactionId).toBe("string");
      expect(typeof result.hash).toBe("string");
      expect(typeof result.status).toBe("string");
      expect(typeof result.createdAt).toBe("string");
      expect(result.confirmedAt).toBeUndefined();
      expect(result.from).toBe("0xUser123...");
      expect(result.to).toBe("0xContract456...");
      expect(result.value).toBe("1000000000000000000");
    });

    /**
     * Test: Graceful degradation when Redis fails
     */
    it("should gracefully degrade to MySQL when Redis fails", async () => {
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
        type: "direct",
        request: null,
        result: null,
        error_message: null,
        ozRelayerTxId: null,
        ozRelayerUrl: null,
      };

      // Redis throws error
      jest
        .spyOn(redisService, "get")
        .mockRejectedValueOnce(new Error("Redis connection failed"));
      jest
        .spyOn(prismaService.transaction, "findUnique")
        .mockResolvedValueOnce(storedData);

      const result = await service.getTransactionStatus(validTxId);

      // Should still return data from MySQL
      expect(result.transactionId).toEqual(validTxId);
      expect(result.status).toEqual("confirmed");
      expect(prismaService.transaction.findUnique).toHaveBeenCalled();
    });

    /**
     * Test: Graceful degradation when Redis backfill fails
     */
    it("should still return result when Redis backfill fails", async () => {
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
        type: "direct",
        request: null,
        result: null,
        error_message: null,
        ozRelayerTxId: null,
        ozRelayerUrl: null,
      };

      jest.spyOn(redisService, "get").mockResolvedValueOnce(null);
      jest
        .spyOn(prismaService.transaction, "findUnique")
        .mockResolvedValueOnce(storedData);
      // Redis set (backfill) throws error
      jest
        .spyOn(redisService, "set")
        .mockRejectedValueOnce(new Error("Redis backfill failed"));

      const result = await service.getTransactionStatus(validTxId);

      // Should still return data from MySQL despite backfill failure
      expect(result.transactionId).toEqual(validTxId);
      expect(result.status).toEqual("confirmed");
    });
  });
});

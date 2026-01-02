import { Test, TestingModule } from "@nestjs/testing";
import { DirectService } from "./direct.service";
import {
  OzRelayerService,
  DirectTxResponse,
} from "../../oz-relayer/oz-relayer.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { DirectTxRequestDto } from "../dto/direct-tx-request.dto";

describe("DirectService", () => {
  let service: DirectService;
  let ozRelayerService: OzRelayerService;
  let prismaService: PrismaService;
  let redisService: RedisService;

  const mockDirectTxResponse: DirectTxResponse = {
    transactionId: "tx_abc123def456",
    hash: "0xabc123def456789abc123def456789abc123def456789abc123def456789abc1",
    status: "pending",
    createdAt: "2025-12-19T10:30:00.000Z",
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DirectService,
        {
          provide: OzRelayerService,
          useValue: {
            sendTransaction: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            transaction: {
              create: jest.fn().mockResolvedValue({}),
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

    service = module.get<DirectService>(DirectService);
    ozRelayerService = module.get<OzRelayerService>(OzRelayerService);
    prismaService = module.get<PrismaService>(PrismaService);
    redisService = module.get<RedisService>(RedisService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("sendTransaction", () => {
    it("should send transaction and return response", async () => {
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
        value: "1000000000000000000",
        gasLimit: "21000",
        speed: "fast",
      };

      jest
        .spyOn(ozRelayerService, "sendTransaction")
        .mockResolvedValueOnce(mockDirectTxResponse);

      const result = await service.sendTransaction(requestDto);

      expect(result.transactionId).toEqual(mockDirectTxResponse.transactionId);
      expect(result.hash).toEqual(mockDirectTxResponse.hash);
      expect(result.status).toEqual(mockDirectTxResponse.status);
      expect(result.createdAt).toEqual(mockDirectTxResponse.createdAt);
      expect(ozRelayerService.sendTransaction).toHaveBeenCalledWith({
        to: requestDto.to,
        data: requestDto.data,
        value: requestDto.value,
        gasLimit: requestDto.gasLimit,
        speed: requestDto.speed,
      });
    });

    it("should store transaction in Redis and MySQL after send", async () => {
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
        value: "1000000000000000000",
        gasLimit: "21000",
        speed: "fast",
      };

      jest
        .spyOn(ozRelayerService, "sendTransaction")
        .mockResolvedValueOnce(mockDirectTxResponse);

      await service.sendTransaction(requestDto);

      expect(redisService.set).toHaveBeenCalledWith(
        `tx:status:${mockDirectTxResponse.transactionId}`,
        expect.objectContaining({
          transactionId: mockDirectTxResponse.transactionId,
          status: mockDirectTxResponse.status,
        }),
        600,
      );

      expect(prismaService.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: mockDirectTxResponse.transactionId,
          status: mockDirectTxResponse.status,
          to: requestDto.to,
        }),
      });
    });

    it("should handle missing optional fields", async () => {
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      jest
        .spyOn(ozRelayerService, "sendTransaction")
        .mockResolvedValueOnce(mockDirectTxResponse);

      const result = await service.sendTransaction(requestDto);

      expect(result.transactionId).toEqual(mockDirectTxResponse.transactionId);
      expect(ozRelayerService.sendTransaction).toHaveBeenCalledWith({
        to: requestDto.to,
        data: requestDto.data,
        value: undefined,
        gasLimit: undefined,
        speed: undefined,
      });
    });

    it("should propagate OzRelayerService errors", async () => {
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      const error = new Error("OZ Relayer service unavailable");
      jest
        .spyOn(ozRelayerService, "sendTransaction")
        .mockRejectedValueOnce(error);

      await expect(service.sendTransaction(requestDto)).rejects.toThrow(error);
    });

    it("should not fail if storage fails but OZ Relayer succeeds", async () => {
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      jest
        .spyOn(ozRelayerService, "sendTransaction")
        .mockResolvedValueOnce(mockDirectTxResponse);
      jest
        .spyOn(prismaService.transaction, "create")
        .mockRejectedValueOnce(new Error("DB Error"));

      const result = await service.sendTransaction(requestDto);

      // Should still return the response even if storage failed
      expect(result.transactionId).toEqual(mockDirectTxResponse.transactionId);
    });
  });
});

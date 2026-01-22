import { Test, TestingModule } from "@nestjs/testing";
import { ServiceUnavailableException } from "@nestjs/common";
import { QueueService } from "./queue.service";
import { SqsAdapter } from "./sqs.adapter";
import { PrismaService } from "../prisma/prisma.service";
import { DirectTxRequestDto } from "../relay/dto/direct-tx-request.dto";
import { GaslessTxRequestDto } from "../relay/dto/gasless-tx-request.dto";

/**
 * QueueService Unit Tests
 *
 * SPEC-QUEUE-001: AWS SQS Queue System - Producer Service
 *
 * Tests for QueueService two-phase commit pattern:
 * 1. Create transaction record with status="queued"
 * 2. Send message to SQS
 * 3. Rollback to status="failed" if SQS send fails
 */
describe("QueueService", () => {
  let service: QueueService;
  let sqsAdapter: SqsAdapter;
  let prismaService: PrismaService;

  const mockTransactionId = "550e8400-e29b-12d3-a456-426614174000";
  const mockCreatedAt = new Date("2025-01-05T10:00:00.000Z");

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: SqsAdapter,
          useValue: {
            sendMessage: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            transaction: {
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    sqsAdapter = module.get<SqsAdapter>(SqsAdapter);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("sendDirectTransaction", () => {
    const directDto: DirectTxRequestDto = {
      to: "0x742d35Cc6634C0532925a3b844Bc9e7595f1e123",
      data: "0x",
      value: "1000000000000000000",
      gasLimit: "21000",
      speed: "fast",
    };

    it("should create transaction and send to SQS successfully", async () => {
      // Arrange
      const mockTransaction = {
        transactionId: mockTransactionId,
        status: "queued",
        type: "direct",
        createdAt: mockCreatedAt,
        to: directDto.to,
        value: directDto.value,
        data: directDto.data,
      };

      jest
        .spyOn(prismaService.transaction, "create")
        .mockResolvedValueOnce(mockTransaction as any);
      jest.spyOn(sqsAdapter, "sendMessage").mockResolvedValueOnce(undefined);

      // Act
      const result = await service.sendDirectTransaction(directDto);

      // Assert
      expect(result).toEqual({
        transactionId: mockTransactionId,
        transactionHash: null,
        status: "queued",
        createdAt: mockCreatedAt.toISOString(),
      });

      // Verify DB creation with correct data
      expect(prismaService.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: "queued",
          type: "direct",
          to: directDto.to,
          value: directDto.value,
          data: directDto.data,
          request: directDto,
        }),
      });

      // Verify SQS message format
      // SPEC-DLQ-001: retryOnFailure defaults to false
      expect(sqsAdapter.sendMessage).toHaveBeenCalledWith({
        transactionId: mockTransactionId,
        type: "direct",
        request: directDto,
        retryOnFailure: false,
      });
    });

    it("should rollback transaction to failed status when SQS send fails", async () => {
      // Arrange
      const mockTransaction = {
        transactionId: mockTransactionId,
        status: "queued",
        type: "direct",
        createdAt: mockCreatedAt,
      };

      const sqsError = new Error("SQS service unavailable");

      jest
        .spyOn(prismaService.transaction, "create")
        .mockResolvedValueOnce(mockTransaction as any);
      jest.spyOn(sqsAdapter, "sendMessage").mockRejectedValueOnce(sqsError);
      jest
        .spyOn(prismaService.transaction, "update")
        .mockResolvedValueOnce({} as any);

      // Act & Assert
      await expect(service.sendDirectTransaction(directDto)).rejects.toThrow(
        ServiceUnavailableException,
      );

      // Verify rollback was performed
      expect(prismaService.transaction.update).toHaveBeenCalledWith({
        where: { transactionId: mockTransactionId },
        data: {
          status: "failed",
          error_message: "SQS service unavailable",
        },
      });
    });

    it('should use default value "0" when value is not provided', async () => {
      // Arrange
      const dtoWithoutValue: DirectTxRequestDto = {
        to: "0x742d35Cc6634C0532925a3b844Bc9e7595f1e123",
        data: "0x",
      };

      const mockTransaction = {
        transactionId: mockTransactionId,
        status: "queued",
        type: "direct",
        createdAt: mockCreatedAt,
      };

      jest
        .spyOn(prismaService.transaction, "create")
        .mockResolvedValueOnce(mockTransaction as any);
      jest.spyOn(sqsAdapter, "sendMessage").mockResolvedValueOnce(undefined);

      // Act
      await service.sendDirectTransaction(dtoWithoutValue);

      // Assert
      expect(prismaService.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          value: "0",
        }),
      });
    });

    it("should throw ServiceUnavailableException when DB creation fails", async () => {
      // Arrange
      const dbError = new Error("Database connection failed");
      jest
        .spyOn(prismaService.transaction, "create")
        .mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(service.sendDirectTransaction(directDto)).rejects.toThrow(
        ServiceUnavailableException,
      );

      // SQS should not be called
      expect(sqsAdapter.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("sendGaslessTransaction", () => {
    const gaslessDto: GaslessTxRequestDto = {
      request: {
        from: "0x742d35Cc6634C0532925a3b844Bc9e7595f1e123",
        to: "0x1234567890123456789012345678901234567890",
        value: "0",
        gas: "200000",
        nonce: "0",
        deadline: String(Math.floor(Date.now() / 1000) + 3600),
        data: "0x",
      },
      signature: "0x1234567890abcdef",
    };

    const forwarderAddress = "0xForwarder1234567890123456789012345678901";

    it("should create transaction and send to SQS successfully", async () => {
      // Arrange
      const mockTransaction = {
        transactionId: mockTransactionId,
        status: "queued",
        type: "gasless",
        createdAt: mockCreatedAt,
        from: gaslessDto.request.from,
        to: forwarderAddress,
      };

      jest
        .spyOn(prismaService.transaction, "create")
        .mockResolvedValueOnce(mockTransaction as any);
      jest.spyOn(sqsAdapter, "sendMessage").mockResolvedValueOnce(undefined);

      // Act
      const result = await service.sendGaslessTransaction(
        gaslessDto,
        forwarderAddress,
      );

      // Assert
      expect(result).toEqual({
        transactionId: mockTransactionId,
        transactionHash: null,
        status: "queued",
        createdAt: mockCreatedAt.toISOString(),
      });

      // Verify DB creation with correct data
      expect(prismaService.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: "queued",
          type: "gasless",
          from: gaslessDto.request.from,
          to: forwarderAddress,
          value: "0",
          data: gaslessDto.request.data,
          request: gaslessDto,
        }),
      });

      // Verify SQS message format includes forwarderAddress
      // SPEC-DLQ-001: retryOnFailure defaults to false
      expect(sqsAdapter.sendMessage).toHaveBeenCalledWith({
        transactionId: mockTransactionId,
        type: "gasless",
        request: gaslessDto,
        forwarderAddress,
        retryOnFailure: false,
      });
    });

    it("should rollback transaction to failed status when SQS send fails", async () => {
      // Arrange
      const mockTransaction = {
        transactionId: mockTransactionId,
        status: "queued",
        type: "gasless",
        createdAt: mockCreatedAt,
      };

      const sqsError = new Error("Network timeout");

      jest
        .spyOn(prismaService.transaction, "create")
        .mockResolvedValueOnce(mockTransaction as any);
      jest.spyOn(sqsAdapter, "sendMessage").mockRejectedValueOnce(sqsError);
      jest
        .spyOn(prismaService.transaction, "update")
        .mockResolvedValueOnce({} as any);

      // Act & Assert
      await expect(
        service.sendGaslessTransaction(gaslessDto, forwarderAddress),
      ).rejects.toThrow(ServiceUnavailableException);

      // Verify rollback was performed
      expect(prismaService.transaction.update).toHaveBeenCalledWith({
        where: { transactionId: mockTransactionId },
        data: {
          status: "failed",
          error_message: "Network timeout",
        },
      });
    });
  });
});

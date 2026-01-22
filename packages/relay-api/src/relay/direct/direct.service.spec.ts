import { Test, TestingModule } from "@nestjs/testing";
import { DirectService } from "./direct.service";
import { QueueService } from "../../queue/queue.service";
import { DirectTxRequestDto } from "../dto/direct-tx-request.dto";

/**
 * DirectService Unit Tests
 *
 * SPEC-PROXY-001: Direct Transaction API
 * SPEC-QUEUE-001: AWS SQS Queue System - Async Processing
 *
 * Tests for DirectService delegation to QueueService
 */
describe("DirectService", () => {
  let service: DirectService;
  let queueService: QueueService;

  const mockQueuedResponse = {
    transactionId: "550e8400-e29b-12d3-a456-426614174000",
    transactionHash: null,
    status: "queued",
    createdAt: "2025-01-05T10:30:00.000Z",
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DirectService,
        {
          provide: QueueService,
          useValue: {
            sendDirectTransaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DirectService>(DirectService);
    queueService = module.get<QueueService>(QueueService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("sendTransaction", () => {
    it("should delegate to QueueService and return queued response", async () => {
      // Arrange
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
        value: "1000000000000000000",
        gasLimit: "21000",
        speed: "fast",
      };

      jest
        .spyOn(queueService, "sendDirectTransaction")
        .mockResolvedValueOnce(mockQueuedResponse);

      // Act
      const result = await service.sendTransaction(requestDto);

      // Assert
      expect(result.transactionId).toEqual(mockQueuedResponse.transactionId);
      expect(result.transactionHash).toBeNull();
      expect(result.status).toEqual("queued");
      expect(result.createdAt).toEqual(mockQueuedResponse.createdAt);
      expect(queueService.sendDirectTransaction).toHaveBeenCalledWith(
        requestDto,
      );
    });

    it("should handle missing optional fields", async () => {
      // Arrange
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      jest
        .spyOn(queueService, "sendDirectTransaction")
        .mockResolvedValueOnce(mockQueuedResponse);

      // Act
      const result = await service.sendTransaction(requestDto);

      // Assert
      expect(result.transactionId).toEqual(mockQueuedResponse.transactionId);
      expect(queueService.sendDirectTransaction).toHaveBeenCalledWith(
        requestDto,
      );
    });

    it("should propagate QueueService errors", async () => {
      // Arrange
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      const error = new Error("Queue service unavailable");
      jest
        .spyOn(queueService, "sendDirectTransaction")
        .mockRejectedValueOnce(error);

      // Act & Assert
      await expect(service.sendTransaction(requestDto)).rejects.toThrow(error);
    });
  });
});

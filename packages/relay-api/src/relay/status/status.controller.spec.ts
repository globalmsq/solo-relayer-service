import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { StatusController } from "./status.controller";
import { StatusService } from "./status.service";
import { TxStatusResponseDto } from "./dto/tx-status-response.dto";

/**
 * StatusController Unit Tests
 *
 * SPEC-STATUS-001: Transaction Status Polling API - Phase 1
 * Tests for StatusController.getTransactionStatus() endpoint
 */
describe("StatusController", () => {
  let controller: StatusController;
  let statusService: StatusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatusController],
      providers: [
        {
          provide: StatusService,
          useValue: {
            getTransactionStatus: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<StatusController>(StatusController);
    statusService = module.get<StatusService>(StatusService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getTransactionStatus", () => {
    const validTxId = "123e4567-e89b-12d3-a456-426614174000";

    /**
     * Test 1: GET /status/:txId with valid ID returns 200 OK
     */
    it("should return 200 OK with transaction status for valid transaction ID", async () => {
      const mockResponse: TxStatusResponseDto = {
        transactionId: validTxId,
        transactionHash: "0x123456789...",
        status: "confirmed",
        createdAt: "2025-12-22T10:00:00.000Z",
        confirmedAt: "2025-12-22T10:05:00.000Z",
        from: "0xUser123...",
        to: "0xContract456...",
        value: "1000000000000000000",
      };

      jest
        .spyOn(statusService, "getTransactionStatus")
        .mockResolvedValue(mockResponse);

      const result = await controller.getTransactionStatus(validTxId);

      expect(result).toEqual(mockResponse);
      expect(statusService.getTransactionStatus).toHaveBeenCalledWith(
        validTxId,
      );
    });

    /**
     * Test 2: GET /status/:txId with invalid UUID returns 400 Bad Request
     */
    it("should return 400 Bad Request for invalid UUID format", async () => {
      const invalidTxId = "not-a-valid-uuid";

      await expect(
        controller.getTransactionStatus(invalidTxId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.getTransactionStatus(invalidTxId),
      ).rejects.toThrow("Invalid transaction ID format");

      // Service should not be called for invalid input
      expect(statusService.getTransactionStatus).not.toHaveBeenCalled();
    });

    /**
     * Test 3: GET /status/:txId not found returns 404 Not Found
     */
    it("should return 404 when transaction not found", async () => {
      const mockError = new NotFoundException("Transaction not found");

      jest
        .spyOn(statusService, "getTransactionStatus")
        .mockRejectedValue(mockError);

      await expect(controller.getTransactionStatus(validTxId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(controller.getTransactionStatus(validTxId)).rejects.toThrow(
        "Transaction not found",
      );

      expect(statusService.getTransactionStatus).toHaveBeenCalledWith(
        validTxId,
      );
    });

    /**
     * Test 4: GET /status/:txId OZ Relayer unavailable returns 503 Service Unavailable
     */
    it("should return 503 when OZ Relayer unavailable", async () => {
      const mockError = new ServiceUnavailableException(
        "OZ Relayer service unavailable",
      );

      jest
        .spyOn(statusService, "getTransactionStatus")
        .mockRejectedValue(mockError);

      await expect(controller.getTransactionStatus(validTxId)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(controller.getTransactionStatus(validTxId)).rejects.toThrow(
        "OZ Relayer service unavailable",
      );

      expect(statusService.getTransactionStatus).toHaveBeenCalledWith(
        validTxId,
      );
    });

    /**
     * Test 5: Response format matches TxStatusResponseDto schema
     */
    it("should return response matching TxStatusResponseDto schema", async () => {
      const mockResponse: TxStatusResponseDto = {
        transactionId: validTxId,
        transactionHash: null,
        status: "pending",
        createdAt: "2025-12-22T10:00:00.000Z",
      };

      jest
        .spyOn(statusService, "getTransactionStatus")
        .mockResolvedValue(mockResponse);

      const result = await controller.getTransactionStatus(validTxId);

      // Required fields
      expect(result).toHaveProperty("transactionId");
      expect(result).toHaveProperty("transactionHash");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("createdAt");

      // Field types
      expect(typeof result.transactionId).toBe("string");
      expect(
        result.transactionHash === null ||
          typeof result.transactionHash === "string",
      ).toBe(true);
      expect(typeof result.status).toBe("string");
      expect(typeof result.createdAt).toBe("string");

      // Optional fields can be undefined
      if (result.confirmedAt !== undefined) {
        expect(typeof result.confirmedAt).toBe("string");
      }
      if (result.from !== undefined) {
        expect(typeof result.from).toBe("string");
      }
      if (result.to !== undefined) {
        expect(typeof result.to).toBe("string");
      }
      if (result.value !== undefined) {
        expect(typeof result.value).toBe("string");
      }
    });
  });
});

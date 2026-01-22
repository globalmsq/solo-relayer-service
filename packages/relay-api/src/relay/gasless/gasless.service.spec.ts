import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { GaslessService } from "./gasless.service";
import { SignatureVerifierService } from "./signature-verifier.service";
import { QueueService } from "../../queue/queue.service";
import { GaslessTxRequestDto } from "../dto/gasless-tx-request.dto";

/**
 * GaslessService Unit Tests
 *
 * SPEC-GASLESS-001: Gasless Transaction API
 * SPEC-QUEUE-001: AWS SQS Queue System - Async Processing
 *
 * Tests for pre-validation (deadline, nonce, signature) and queue delegation
 */
describe("GaslessService", () => {
  let service: GaslessService;
  let signatureVerifier: SignatureVerifierService;
  let queueService: QueueService;
  let configService: ConfigService;
  let httpService: HttpService;

  const testForwarderAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const testRpcUrl = "http://localhost:8545";
  const testAddress = "0x1234567890123456789012345678901234567890";

  const mockQueuedResponse = {
    transactionId: "550e8400-e29b-12d3-a456-426614174000",
    transactionHash: null,
    status: "queued",
    createdAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GaslessService,
        {
          provide: SignatureVerifierService,
          useValue: {
            verifySignature: jest.fn().mockReturnValue(true),
            validateDeadline: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: QueueService,
          useValue: {
            sendGaslessTransaction: jest
              .fn()
              .mockResolvedValue(mockQueuedResponse),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === "FORWARDER_ADDRESS") return testForwarderAddress;
              if (key === "RPC_URL") return testRpcUrl;
              if (key === "CHAIN_ID") return 31337;
              return null;
            },
          },
        },
        {
          provide: HttpService,
          useValue: {
            axiosRef: {
              post: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<GaslessService>(GaslessService);
    signatureVerifier = module.get<SignatureVerifierService>(
      SignatureVerifierService,
    );
    queueService = module.get<QueueService>(QueueService);
    configService = module.get<ConfigService>(ConfigService);
    httpService = module.get<HttpService>(HttpService);
  });

  describe("sendGaslessTransaction", () => {
    const createValidRequest = (): GaslessTxRequestDto => ({
      request: {
        from: testAddress,
        to: "0xffff567890123456789012345678901234567890",
        value: "0",
        gas: "100000",
        nonce: "0",
        deadline: String(Math.floor(Date.now() / 1000) + 3600),
        data: "0xabcdef",
      },
      signature: "0x" + "12".repeat(65),
    });

    it("TC-008: Valid request should queue transaction successfully", async () => {
      // Arrange
      const request = createValidRequest();
      jest.spyOn(httpService.axiosRef, "post").mockResolvedValueOnce({
        data: { result: "0x0" }, // Nonce = 0
      });

      // Act
      const result = await service.sendGaslessTransaction(request);

      // Assert
      expect(result).toBeDefined();
      expect(result.transactionId).toBe(mockQueuedResponse.transactionId);
      expect(result.status).toBe("queued");
      expect(queueService.sendGaslessTransaction).toHaveBeenCalledWith(
        request,
        testForwarderAddress,
      );
    });

    it("TC-009: Expired deadline should throw BadRequestException", async () => {
      // Arrange
      const request = createValidRequest();
      request.request.deadline = String(Math.floor(Date.now() / 1000) - 1); // Expired

      jest
        .spyOn(signatureVerifier, "validateDeadline")
        .mockReturnValueOnce(false);

      // Act & Assert
      await expect(service.sendGaslessTransaction(request)).rejects.toThrow(
        BadRequestException,
      );
      expect(queueService.sendGaslessTransaction).not.toHaveBeenCalled();
    });

    it("TC-010: Nonce mismatch should throw BadRequestException with detailed message", async () => {
      // Arrange
      const request = createValidRequest();
      request.request.nonce = "5"; // Wrong nonce

      jest.spyOn(httpService.axiosRef, "post").mockResolvedValue({
        data: { result: "0x0" }, // Expected nonce = 0
      });

      // Act & Assert
      try {
        await service.sendGaslessTransaction(request);
        fail("Should have thrown BadRequestException");
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual({
          statusCode: 400,
          message: "Invalid nonce: expected 0, got 5",
          error: "Bad Request",
        });
      }
      expect(queueService.sendGaslessTransaction).not.toHaveBeenCalled();
    });

    it("TC-011: Invalid signature should throw UnauthorizedException", async () => {
      // Arrange
      const request = createValidRequest();
      jest.spyOn(httpService.axiosRef, "post").mockResolvedValueOnce({
        data: { result: "0x0" },
      });
      jest
        .spyOn(signatureVerifier, "verifySignature")
        .mockReturnValueOnce(false);

      // Act & Assert
      await expect(service.sendGaslessTransaction(request)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(queueService.sendGaslessTransaction).not.toHaveBeenCalled();
    });

    it("TC-012: Queue service unavailable should throw ServiceUnavailableException", async () => {
      // Arrange
      const request = createValidRequest();
      jest.spyOn(httpService.axiosRef, "post").mockResolvedValueOnce({
        data: { result: "0x0" },
      });
      jest
        .spyOn(queueService, "sendGaslessTransaction")
        .mockRejectedValueOnce(
          new ServiceUnavailableException("Queue unavailable"),
        );

      // Act & Assert
      await expect(service.sendGaslessTransaction(request)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe("getNonceFromForwarder", () => {
    it("TC-013: Valid address should return nonce from Forwarder", async () => {
      // Arrange
      jest.spyOn(httpService.axiosRef, "post").mockResolvedValueOnce({
        data: { result: "0x0" }, // Nonce = 0
      });

      // Act
      const nonce = await service.getNonceFromForwarder(testAddress);

      // Assert
      expect(nonce).toBe("0");
      expect(httpService.axiosRef.post).toHaveBeenCalledWith(
        testRpcUrl,
        expect.objectContaining({
          method: "eth_call",
        }),
      );
    });

    it("TC-014: RPC failure should throw ServiceUnavailableException", async () => {
      // Arrange
      jest
        .spyOn(httpService.axiosRef, "post")
        .mockRejectedValueOnce(new Error("Connection timeout"));

      // Act & Assert
      await expect(service.getNonceFromForwarder(testAddress)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("TC-015: Missing RPC_URL should throw ServiceUnavailableException", async () => {
      // Arrange
      jest.spyOn(configService, "get").mockReturnValueOnce(null);

      // Act & Assert
      await expect(service.getNonceFromForwarder(testAddress)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe("Response transformation", () => {
    it("TC-017: Should return queued response with null hash", async () => {
      // Arrange
      const request = {
        from: testAddress,
        to: "0xffff567890123456789012345678901234567890",
        value: "0",
        gas: "100000",
        nonce: "0",
        deadline: String(Math.floor(Date.now() / 1000) + 3600),
        data: "0xabcdef",
      };

      const dto: GaslessTxRequestDto = {
        request,
        signature: "0x" + "12".repeat(65),
      };

      jest.spyOn(httpService.axiosRef, "post").mockResolvedValueOnce({
        data: { result: "0x0" },
      });

      // Act
      const result = await service.sendGaslessTransaction(dto);

      // Assert
      expect(result).toBeInstanceOf(Object);
      expect(result.transactionId).toBe(mockQueuedResponse.transactionId);
      expect(result.transactionHash).toBeNull();
      expect(result.status).toBe("queued");
      expect(result.createdAt).toBeDefined();
    });

    it("TC-018: Should handle null transactionHash in queued response", async () => {
      // Arrange
      const request = {
        from: testAddress,
        to: "0xffff567890123456789012345678901234567890",
        value: "0",
        gas: "100000",
        nonce: "0",
        deadline: String(Math.floor(Date.now() / 1000) + 3600),
        data: "0xabcdef",
      };

      const dto: GaslessTxRequestDto = {
        request,
        signature: "0x" + "12".repeat(65),
      };

      jest.spyOn(httpService.axiosRef, "post").mockResolvedValueOnce({
        data: { result: "0x0" },
      });

      // Act
      const result = await service.sendGaslessTransaction(dto);

      // Assert
      expect(result.transactionHash).toBeNull();
      expect(result.status).toBe("queued");
    });
  });
});

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
import { OzRelayerService } from "../../oz-relayer/oz-relayer.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { GaslessTxRequestDto } from "../dto/gasless-tx-request.dto";

describe("GaslessService", () => {
  let service: GaslessService;
  let signatureVerifier: SignatureVerifierService;
  let ozRelayerService: OzRelayerService;
  let configService: ConfigService;
  let httpService: HttpService;

  const testForwarderAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const testRpcUrl = "http://localhost:8545";
  const testAddress = "0x1234567890123456789012345678901234567890";

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
          provide: OzRelayerService,
          useValue: {
            sendTransaction: jest.fn().mockResolvedValue({
              transactionId: "tx_test123",
              hash: null,
              status: "pending",
              createdAt: new Date().toISOString(),
            }),
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

    service = module.get<GaslessService>(GaslessService);
    signatureVerifier = module.get<SignatureVerifierService>(
      SignatureVerifierService,
    );
    ozRelayerService = module.get<OzRelayerService>(OzRelayerService);
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

    it("TC-008: Valid request should submit transaction successfully", async () => {
      // Arrange
      const request = createValidRequest();
      jest.spyOn(httpService.axiosRef, "post").mockResolvedValueOnce({
        data: { result: "0x0" }, // Nonce = 0
      });

      // Act
      const result = await service.sendGaslessTransaction(request);

      // Assert
      expect(result).toBeDefined();
      expect(result.transactionId).toBe("tx_test123");
      expect(result.status).toBe("pending");
      expect(ozRelayerService.sendTransaction).toHaveBeenCalled();
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
    });

    it("TC-012: OZ Relayer unavailable should throw ServiceUnavailableException", async () => {
      // Arrange
      const request = createValidRequest();
      jest.spyOn(httpService.axiosRef, "post").mockResolvedValueOnce({
        data: { result: "0x0" },
      });
      jest
        .spyOn(ozRelayerService, "sendTransaction")
        .mockRejectedValueOnce(new Error("Connection refused"));

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

  describe("buildForwarderExecuteTx", () => {
    it("TC-016: Should encode Forwarder.execute() call correctly", async () => {
      // Arrange
      const request: GaslessTxRequestDto = {
        request: {
          from: testAddress,
          to: "0xffff567890123456789012345678901234567890",
          value: "1000000000000000000", // 1 ETH
          gas: "100000",
          nonce: "1",
          deadline: String(Math.floor(Date.now() / 1000) + 3600),
          data: "0xabcdef1234",
        },
        signature: "0x" + "ab".repeat(65),
      };

      jest.spyOn(httpService.axiosRef, "post").mockResolvedValueOnce({
        data: { result: "0x1" },
      });

      // Act
      const result = await service.sendGaslessTransaction(request);

      // Assert
      expect(result).toBeDefined();
      expect(result.transactionId).toBe("tx_test123");
      // Verify OZ Relayer received the Forwarder address as 'to'
      const callArgs = (ozRelayerService.sendTransaction as jest.Mock).mock
        .calls[0][0];
      expect(callArgs.to).toBe(testForwarderAddress);
      expect(callArgs.data).toBeDefined();
      expect(callArgs.data.startsWith("0x")).toBe(true);
    });
  });

  describe("Response transformation", () => {
    it("TC-017: Should transform OZ Relayer response to GaslessTxResponseDto", async () => {
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

      const createdAtTime = new Date().toISOString();
      jest.spyOn(httpService.axiosRef, "post").mockResolvedValueOnce({
        data: { result: "0x0" },
      });
      jest.spyOn(ozRelayerService, "sendTransaction").mockResolvedValueOnce({
        transactionId: "tx_unique_id_123",
        hash: null,
        status: "pending",
        createdAt: createdAtTime,
      });

      // Act
      const result = await service.sendGaslessTransaction(dto);

      // Assert
      expect(result).toBeInstanceOf(Object);
      expect(result.transactionId).toBe("tx_unique_id_123");
      expect(result.hash).toBeNull();
      expect(result.status).toBe("pending");
      expect(result.createdAt).toBe(createdAtTime);
    });

    it("TC-018: Should handle null hash in response", async () => {
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
      jest.spyOn(ozRelayerService, "sendTransaction").mockResolvedValueOnce({
        transactionId: "tx_pending",
        hash: null,
        status: "pending",
        createdAt: new Date().toISOString(),
      });

      // Act
      const result = await service.sendGaslessTransaction(dto);

      // Assert
      expect(result.hash).toBeNull();
      expect(result.status).toBe("pending");
    });
  });
});

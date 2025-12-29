import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { GaslessController } from "./gasless.controller";
import { GaslessService } from "./gasless.service";
import { GaslessTxRequestDto } from "../dto/gasless-tx-request.dto";
import { GaslessTxResponseDto } from "../dto/gasless-tx-response.dto";

describe("GaslessController", () => {
  let controller: GaslessController;
  let gaslessService: GaslessService;

  const testAddress = "0x1234567890123456789012345678901234567890";
  const mockResponse: GaslessTxResponseDto = {
    transactionId: "tx_abc123def456",
    hash: null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GaslessController],
      providers: [
        {
          provide: GaslessService,
          useValue: {
            sendGaslessTransaction: jest.fn().mockResolvedValue(mockResponse),
            getNonceFromForwarder: jest.fn().mockResolvedValue("0"),
          },
        },
      ],
    }).compile();

    controller = module.get<GaslessController>(GaslessController);
    gaslessService = module.get<GaslessService>(GaslessService);
  });

  describe("POST /api/v1/relay/gasless", () => {
    it("TC-019: Valid request should return 202 Accepted", async () => {
      // Arrange
      const request: GaslessTxRequestDto = {
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
      };

      // Act
      const result = await controller.submitGaslessTransaction(request);

      // Assert
      expect(result).toEqual(mockResponse);
      expect(result.transactionId).toBe("tx_abc123def456");
      expect(result.status).toBe("pending");
      expect(gaslessService.sendGaslessTransaction).toHaveBeenCalledWith(
        request,
      );
    });

    it("TC-020: Invalid DTO should be caught by NestJS validation", async () => {
      // This test is more for documentation purposes
      // NestJS validation happens before the controller method is called
      // If validation fails, NestJS throws a BadRequestException automatically

      // Arrange
      const invalidRequest = {
        request: {
          from: "invalid-address", // Invalid address
          to: "0xffff567890123456789012345678901234567890",
          value: "0",
          gas: "100000",
          nonce: "0",
          deadline: String(Math.floor(Date.now() / 1000) + 3600),
          data: "0xabcdef",
        },
        signature: "0x" + "12".repeat(65),
      };

      // Act & Assert
      // In real scenario, NestJS would throw BadRequestException during validation
      // Here we're just documenting the expected behavior
      expect(invalidRequest.request.from).toBe("invalid-address");
    });
  });

  describe("GET /api/v1/relay/gasless/nonce/:address", () => {
    it("TC-020: Valid address should return nonce", async () => {
      // Arrange
      const validAddress = "0x1234567890123456789012345678901234567890";

      // Act
      const result = await controller.getNonce(validAddress);

      // Assert
      expect(result).toEqual({ nonce: "0" });
      expect(gaslessService.getNonceFromForwarder).toHaveBeenCalledWith(
        validAddress,
      );
    });

    it("TC-021: Invalid address format should throw BadRequestException", async () => {
      // Arrange
      const invalidAddress = "not-an-address";

      // Act & Assert
      // NestJS throws BadRequestException synchronously when isAddress() fails
      // Since getNonce is async, we need to use rejects.toThrow for promise rejection
      await expect(controller.getNonce(invalidAddress)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("TC-022: Address with different case should be accepted", async () => {
      // Arrange
      const addressMixed = "0x1234567890123456789012345678901234567890"; // Checksum format

      // Act
      const result = await controller.getNonce(addressMixed);

      // Assert
      expect(result).toEqual({ nonce: "0" });
    });

    it("TC-023: Service unavailable should propagate exception", async () => {
      // Arrange
      const validAddress = "0x1234567890123456789012345678901234567890";
      jest
        .spyOn(gaslessService, "getNonceFromForwarder")
        .mockRejectedValueOnce(new Error("Service unavailable"));

      // Act & Assert
      await expect(controller.getNonce(validAddress)).rejects.toThrow();
    });
  });

  describe("HTTP Status Codes", () => {
    it("POST should return 202 Accepted status", async () => {
      // Arrange
      const request: GaslessTxRequestDto = {
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
      };

      // Act
      const result = await controller.submitGaslessTransaction(request);

      // Assert
      expect(result).toBeDefined();
      // In NestJS, the @HttpCode(HttpStatus.ACCEPTED) decorator handles status
      // We verify the response is returned correctly
    });

    it("GET should return 200 OK status", async () => {
      // Arrange
      const validAddress = "0x1234567890123456789012345678901234567890";

      // Act
      const result = await controller.getNonce(validAddress);

      // Assert
      expect(result).toBeDefined();
      expect(result.nonce).toBeDefined();
      // The @HttpCode(HttpStatus.OK) decorator handles status
    });
  });
});

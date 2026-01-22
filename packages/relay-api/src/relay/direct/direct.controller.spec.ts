import { Test, TestingModule } from "@nestjs/testing";
import { DirectController } from "./direct.controller";
import { DirectService } from "./direct.service";
import { DirectTxRequestDto } from "../dto/direct-tx-request.dto";
import { DirectTxResponseDto } from "../dto/direct-tx-response.dto";

describe("DirectController", () => {
  let controller: DirectController;
  let service: DirectService;

  const mockDirectTxResponse: DirectTxResponseDto = {
    transactionId: "tx_abc123def456",
    transactionHash:
      "0xabc123def456789abc123def456789abc123def456789abc123def456789abc1",
    status: "pending",
    createdAt: "2025-12-19T10:30:00.000Z",
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DirectController],
      providers: [
        {
          provide: DirectService,
          useValue: {
            sendTransaction: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<DirectController>(DirectController);
    service = module.get<DirectService>(DirectService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("sendDirectTransaction", () => {
    it("should return 202 Accepted with transaction response", async () => {
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
        value: "1000000000000000000",
        gasLimit: "21000",
        speed: "fast",
      };

      jest
        .spyOn(service, "sendTransaction")
        .mockResolvedValueOnce(mockDirectTxResponse);

      const result = await controller.sendDirectTransaction(requestDto);

      expect(result).toEqual(mockDirectTxResponse);
      expect(result.transactionId).toBe("tx_abc123def456");
      expect(result.status).toBe("pending");
      expect(service.sendTransaction).toHaveBeenCalledWith(requestDto);
    });

    it("should handle request with minimal fields", async () => {
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      jest
        .spyOn(service, "sendTransaction")
        .mockResolvedValueOnce(mockDirectTxResponse);

      const result = await controller.sendDirectTransaction(requestDto);

      expect(result).toEqual(mockDirectTxResponse);
      expect(service.sendTransaction).toHaveBeenCalledWith(requestDto);
    });

    it("should propagate service errors", async () => {
      const requestDto: DirectTxRequestDto = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      const error = new Error("Service unavailable");
      jest.spyOn(service, "sendTransaction").mockRejectedValueOnce(error);

      await expect(
        controller.sendDirectTransaction(requestDto),
      ).rejects.toThrow(error);
    });
  });
});

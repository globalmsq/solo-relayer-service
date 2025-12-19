import { Test, TestingModule } from "@nestjs/testing";
import { ServiceUnavailableException } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import {
  OzRelayerService,
  DirectTxRequest,
  DirectTxResponse,
} from "./oz-relayer.service";

describe("OzRelayerService", () => {
  let service: OzRelayerService;
  let httpService: HttpService;
  let configService: ConfigService;

  const mockDirectTxResponse: DirectTxResponse = {
    transactionId: "tx_abc123def456",
    hash: "0xabc123def456789abc123def456789abc123def456789abc123def456789abc1",
    status: "pending",
    createdAt: "2025-12-19T10:30:00.000Z",
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OzRelayerService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
            get: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === "OZ_RELAYER_URL") {
                return defaultValue || "http://oz-relayer-lb:8080";
              }
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<OzRelayerService>(OzRelayerService);
    httpService = module.get<HttpService>(HttpService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("sendTransaction", () => {
    it("should send transaction successfully", async () => {
      const request: DirectTxRequest = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
        value: "1000000000000000000",
        gasLimit: "21000",
        speed: "fast",
      };

      jest.spyOn(httpService, "post").mockReturnValueOnce(
        of({
          data: mockDirectTxResponse,
          status: 200,
        } as any),
      );

      const result = await service.sendTransaction(request);

      expect(result).toEqual(mockDirectTxResponse);
      expect(httpService.post).toHaveBeenCalledWith(
        "http://oz-relayer-lb:8080/api/v1/transactions",
        request,
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        }),
      );
    });

    it("should throw ServiceUnavailableException on error", async () => {
      const request: DirectTxRequest = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      jest
        .spyOn(httpService, "post")
        .mockReturnValueOnce(throwError(() => new Error("Connection refused")));

      await expect(service.sendTransaction(request)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("should use configured OZ_RELAYER_URL environment variable", async () => {
      jest
        .spyOn(configService, "get")
        .mockReturnValueOnce("http://custom-lb:8080");

      const newService = new OzRelayerService(httpService, configService);

      const request: DirectTxRequest = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      jest.spyOn(httpService, "post").mockReturnValueOnce(
        of({
          data: mockDirectTxResponse,
          status: 200,
        } as any),
      );

      await newService.sendTransaction(request);

      expect(httpService.post).toHaveBeenCalledWith(
        "http://custom-lb:8080/api/v1/transactions",
        request,
        expect.any(Object),
      );
    });
  });

  describe("getTransactionStatus", () => {
    it("should get transaction status successfully", async () => {
      const txId = "tx_abc123def456";
      const expectedStatus = { ...mockDirectTxResponse, status: "confirmed" };

      jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          data: expectedStatus,
          status: 200,
        } as any),
      );

      const result = await service.getTransactionStatus(txId);

      expect(result).toEqual(expectedStatus);
      expect(httpService.get).toHaveBeenCalledWith(
        `http://oz-relayer-lb:8080/api/v1/transactions/${txId}`,
        expect.objectContaining({ timeout: 10000 }),
      );
    });

    it("should throw ServiceUnavailableException on error", async () => {
      const txId = "tx_abc123def456";

      jest
        .spyOn(httpService, "get")
        .mockReturnValueOnce(throwError(() => new Error("Connection timeout")));

      await expect(service.getTransactionStatus(txId)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});

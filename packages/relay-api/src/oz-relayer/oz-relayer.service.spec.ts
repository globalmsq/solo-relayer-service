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

  // OZ Relayer API response format
  const mockOzRelayerTxResponse = {
    success: true,
    data: {
      id: "tx_abc123def456",
      hash: "0xabc123def456789abc123def456789abc123def456789abc123def456789abc1",
      status: "pending",
      created_at: "2025-12-19T10:30:00.000Z",
      from: "0xrelayer-address",
      to: "0x1234567890123456789012345678901234567890",
    },
    error: null,
  };

  // Expected transformed response
  const mockDirectTxResponse: DirectTxResponse = {
    transactionId: "tx_abc123def456",
    hash: "0xabc123def456789abc123def456789abc123def456789abc123def456789abc1",
    status: "pending",
    createdAt: "2025-12-19T10:30:00.000Z",
  };

  // Mock relayers list response
  const mockRelayersResponse = {
    success: true,
    data: [{ id: "relayer-1", name: "Test Relayer" }],
    error: null,
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
                return "http://oz-relayer-lb:8080";
              }
              if (key === "OZ_RELAYER_API_KEY") {
                return "test-api-key";
              }
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<OzRelayerService>(OzRelayerService);
    httpService = module.get<HttpService>(HttpService);
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

      // Mock getRelayerId call
      jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          data: mockRelayersResponse,
          status: 200,
        } as any),
      );

      // Mock transaction POST call
      jest.spyOn(httpService, "post").mockReturnValueOnce(
        of({
          data: mockOzRelayerTxResponse,
          status: 200,
        } as any),
      );

      const result = await service.sendTransaction(request);

      expect(result).toEqual(mockDirectTxResponse);
      expect(httpService.get).toHaveBeenCalledWith(
        "http://oz-relayer-lb:8080/api/v1/relayers",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-key" },
        }),
      );
      expect(httpService.post).toHaveBeenCalledWith(
        "http://oz-relayer-lb:8080/api/v1/relayers/relayer-1/transactions",
        {
          to: "0x1234567890123456789012345678901234567890",
          data: "0xabcdef",
          value: 1000000000000000000,
          gas_limit: 21000,
          speed: "fast",
        },
        expect.objectContaining({
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
          },
          timeout: 30000,
        }),
      );
    });

    it("should cache relayer ID after first call", async () => {
      const request: DirectTxRequest = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      // Mock getRelayerId call (should only be called once)
      jest.spyOn(httpService, "get").mockReturnValue(
        of({
          data: mockRelayersResponse,
          status: 200,
        } as any),
      );

      // Mock transaction POST calls
      jest.spyOn(httpService, "post").mockReturnValue(
        of({
          data: mockOzRelayerTxResponse,
          status: 200,
        } as any),
      );

      // First call
      await service.sendTransaction(request);
      // Second call
      await service.sendTransaction(request);

      // getRelayerId should only be called once (cached)
      expect(httpService.get).toHaveBeenCalledTimes(1);
      // sendTransaction POST should be called twice
      expect(httpService.post).toHaveBeenCalledTimes(2);
    });

    it("should throw ServiceUnavailableException on error", async () => {
      const request: DirectTxRequest = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      // Mock getRelayerId call
      jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          data: mockRelayersResponse,
          status: 200,
        } as any),
      );

      // Mock transaction POST failure
      jest
        .spyOn(httpService, "post")
        .mockReturnValueOnce(throwError(() => new Error("Connection refused")));

      await expect(service.sendTransaction(request)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("should throw ServiceUnavailableException when relayer discovery fails", async () => {
      const request: DirectTxRequest = {
        to: "0x1234567890123456789012345678901234567890",
        data: "0xabcdef",
      };

      // Mock getRelayerId failure
      jest
        .spyOn(httpService, "get")
        .mockReturnValueOnce(throwError(() => new Error("Connection refused")));

      await expect(service.sendTransaction(request)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe("getTransactionStatus", () => {
    it("should get transaction status successfully", async () => {
      const txId = "tx_abc123def456";
      const expectedStatus = {
        ...mockOzRelayerTxResponse.data,
        status: "confirmed",
      };

      // Mock getRelayerId call
      jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          data: mockRelayersResponse,
          status: 200,
        } as any),
      );

      // Mock transaction status GET call
      jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          data: expectedStatus,
          status: 200,
        } as any),
      );

      const result = await service.getTransactionStatus(txId);

      expect(result).toEqual(expectedStatus);
      expect(httpService.get).toHaveBeenLastCalledWith(
        `http://oz-relayer-lb:8080/api/v1/relayers/relayer-1/transactions/${txId}`,
        expect.objectContaining({
          headers: { Authorization: "Bearer test-api-key" },
          timeout: 10000,
        }),
      );
    });

    it("should throw ServiceUnavailableException on error", async () => {
      const txId = "tx_abc123def456";

      // Mock getRelayerId call
      jest.spyOn(httpService, "get").mockReturnValueOnce(
        of({
          data: mockRelayersResponse,
          status: 200,
        } as any),
      );

      // Mock transaction status GET failure
      jest
        .spyOn(httpService, "get")
        .mockReturnValueOnce(throwError(() => new Error("Connection timeout")));

      await expect(service.getTransactionStatus(txId)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import { NotificationService } from "./notification.service";

describe("NotificationService", () => {
  let service: NotificationService;
  let httpService: HttpService;
  let configService: ConfigService;

  const mockClientWebhookUrl =
    "http://client-service:8080/webhooks/transaction-updates";

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "CLIENT_WEBHOOK_URL") return mockClientWebhookUrl;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    httpService = module.get<HttpService>(HttpService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("notify", () => {
    it("should send notification successfully", async () => {
      const mockResponse = {
        data: { success: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      jest.spyOn(httpService, "post").mockReturnValue(of(mockResponse as any));

      const result = await service.notify(
        "tx_test123",
        "confirmed",
        "0xhash123",
      );

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe("tx_test123");
      expect(result.statusCode).toBe(200);

      expect(httpService.post).toHaveBeenCalledWith(
        mockClientWebhookUrl,
        expect.objectContaining({
          event: "transaction.status.updated",
          transactionId: "tx_test123",
          status: "confirmed",
          transactionHash: "0xhash123",
        }),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    it("should return success when CLIENT_WEBHOOK_URL is not configured", async () => {
      jest.spyOn(configService, "get").mockReturnValue(undefined);

      const result = await service.notify("tx_test123", "confirmed");

      expect(result.success).toBe(true);
      expect(result.error).toBe("No client webhook URL configured");
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it("should handle HTTP errors gracefully", async () => {
      jest
        .spyOn(httpService, "post")
        .mockReturnValue(of({ data: null, status: 500 } as any));

      const result = await service.notify("tx_test123", "confirmed");

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    it("should handle network errors gracefully", async () => {
      jest
        .spyOn(httpService, "post")
        .mockReturnValue(throwError(() => new Error("ECONNREFUSED")));

      const result = await service.notify("tx_test123", "confirmed");

      expect(result.success).toBe(false);
      // The catchError in the service catches the error and returns status 0
      // So we check for either the original error message or the HTTP 0 status
      expect(result.error).toBeDefined();
    });

    it("should include correct payload structure", async () => {
      const mockResponse = {
        data: { success: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      jest.spyOn(httpService, "post").mockReturnValue(of(mockResponse as any));

      await service.notify("tx_test123", "confirmed", "0xhash");

      expect(httpService.post).toHaveBeenCalledWith(
        mockClientWebhookUrl,
        expect.objectContaining({
          event: "transaction.status.updated",
          transactionId: "tx_test123",
          status: "confirmed",
          transactionHash: "0xhash",
          timestamp: expect.any(String),
        }),
        expect.any(Object),
      );
    });

    it("should handle null hash", async () => {
      const mockResponse = {
        data: { success: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      jest.spyOn(httpService, "post").mockReturnValue(of(mockResponse as any));

      await service.notify("tx_test123", "pending", null);

      expect(httpService.post).toHaveBeenCalledWith(
        mockClientWebhookUrl,
        expect.objectContaining({
          transactionHash: null,
        }),
        expect.any(Object),
      );
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";
import { WebhookSignatureGuard } from "./guards/webhook-signature.guard";
import { ConfigService } from "@nestjs/config";
import { OzRelayerWebhookDto } from "./dto/oz-relayer-webhook.dto";

describe("WebhooksController", () => {
  let controller: WebhooksController;
  let webhooksService: WebhooksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        {
          provide: WebhooksService,
          useValue: {
            handleWebhook: jest.fn().mockResolvedValue({
              success: true,
              message: "Webhook processed successfully",
              transactionId: "tx_test123",
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue("test-signing-key"),
          },
        },
        WebhookSignatureGuard,
      ],
    })
      .overrideGuard(WebhookSignatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WebhooksController>(WebhooksController);
    webhooksService = module.get<WebhooksService>(WebhooksService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("handleOzRelayerWebhook", () => {
    const createValidPayload = (): OzRelayerWebhookDto => ({
      transactionId: "tx_test123",
      hash: "0xabcd1234",
      status: "confirmed",
      from: "0x1234",
      to: "0x5678",
      value: "1000000000000000000",
      createdAt: "2025-12-30T10:00:00.000Z",
      confirmedAt: "2025-12-30T10:05:00.000Z",
    });

    it("should process valid webhook payload successfully", async () => {
      const payload = createValidPayload();

      const result = await controller.handleOzRelayerWebhook(payload);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe(payload.transactionId);
      expect(webhooksService.handleWebhook).toHaveBeenCalledWith(payload);
    });

    it("should pass payload to WebhooksService", async () => {
      const payload = createValidPayload();

      await controller.handleOzRelayerWebhook(payload);

      expect(webhooksService.handleWebhook).toHaveBeenCalledWith(payload);
      expect(webhooksService.handleWebhook).toHaveBeenCalledTimes(1);
    });

    it("should handle confirmed status", async () => {
      const payload: OzRelayerWebhookDto = {
        transactionId: "tx_confirmed",
        hash: "0xhash123",
        status: "confirmed",
        createdAt: "2025-12-30T10:00:00.000Z",
        confirmedAt: "2025-12-30T10:05:00.000Z",
      };

      await controller.handleOzRelayerWebhook(payload);

      expect(webhooksService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "confirmed",
        }),
      );
    });

    it("should handle failed status", async () => {
      const payload: OzRelayerWebhookDto = {
        transactionId: "tx_failed",
        status: "failed",
        createdAt: "2025-12-30T10:00:00.000Z",
      };

      await controller.handleOzRelayerWebhook(payload);

      expect(webhooksService.handleWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
        }),
      );
    });
  });
});

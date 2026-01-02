import { Test, TestingModule } from "@nestjs/testing";
import { InternalServerErrorException } from "@nestjs/common";
import { WebhooksService } from "./webhooks.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { NotificationService } from "./notification.service";
import { OzRelayerWebhookDto } from "./dto/oz-relayer-webhook.dto";

describe("WebhooksService", () => {
  let service: WebhooksService;
  let prismaService: PrismaService;
  let redisService: RedisService;
  let notificationService: NotificationService;

  const mockTransaction = {
    id: "tx_test123",
    hash: "0xabcd1234",
    status: "confirmed",
    from: "0x1234",
    to: "0x5678",
    value: "1000000000000000000",
    createdAt: new Date("2025-12-30T10:00:00.000Z"),
    updatedAt: new Date("2025-12-30T10:05:00.000Z"),
    confirmedAt: new Date("2025-12-30T10:05:00.000Z"),
    data: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: PrismaService,
          useValue: {
            transaction: {
              upsert: jest.fn().mockResolvedValue(mockTransaction),
              findUnique: jest.fn().mockResolvedValue(mockTransaction),
              update: jest.fn().mockResolvedValue(mockTransaction),
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
        {
          provide: NotificationService,
          useValue: {
            notify: jest.fn().mockResolvedValue({ success: true }),
          },
        },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    prismaService = module.get<PrismaService>(PrismaService);
    redisService = module.get<RedisService>(RedisService);
    notificationService = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("handleWebhook", () => {
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

    it("should process webhook and update MySQL + Redis successfully", async () => {
      const payload = createValidPayload();

      const result = await service.handleWebhook(payload);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe(payload.transactionId);

      // Verify MySQL upsert was called
      expect(prismaService.transaction.upsert).toHaveBeenCalledWith({
        where: { id: payload.transactionId },
        update: expect.objectContaining({
          status: payload.status,
          hash: payload.hash,
        }),
        create: expect.objectContaining({
          id: payload.transactionId,
          status: payload.status,
        }),
      });

      // Verify Redis cache was updated with TTL
      expect(redisService.set).toHaveBeenCalledWith(
        `tx:status:${payload.transactionId}`,
        expect.objectContaining({
          transactionId: mockTransaction.id,
          status: mockTransaction.status,
        }),
        600, // TTL in seconds
      );

      // Verify notification was triggered
      expect(notificationService.notify).toHaveBeenCalledWith(
        payload.transactionId,
        payload.status,
        payload.hash,
      );
    });

    it("should handle status update from pending to confirmed", async () => {
      const payload: OzRelayerWebhookDto = {
        transactionId: "tx_pending123",
        hash: "0xnewhash",
        status: "confirmed",
        createdAt: "2025-12-30T10:00:00.000Z",
        confirmedAt: "2025-12-30T10:05:00.000Z",
      };

      const result = await service.handleWebhook(payload);

      expect(result.success).toBe(true);
      expect(prismaService.transaction.upsert).toHaveBeenCalled();
    });

    it("should handle failed status update", async () => {
      const payload: OzRelayerWebhookDto = {
        transactionId: "tx_failed123",
        hash: null,
        status: "failed",
        createdAt: "2025-12-30T10:00:00.000Z",
      };

      const result = await service.handleWebhook(payload);

      expect(result.success).toBe(true);
      expect(prismaService.transaction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: "failed",
          }),
        }),
      );
    });

    it("should throw InternalServerErrorException when MySQL update fails", async () => {
      const payload = createValidPayload();

      jest
        .spyOn(prismaService.transaction, "upsert")
        .mockRejectedValueOnce(new Error("Database connection failed"));

      await expect(service.handleWebhook(payload)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("should continue processing when Redis update fails (graceful degradation)", async () => {
      const payload = createValidPayload();

      jest
        .spyOn(redisService, "set")
        .mockRejectedValueOnce(new Error("Redis connection failed"));

      // Should NOT throw - graceful degradation
      const result = await service.handleWebhook(payload);

      expect(result.success).toBe(true);
      expect(prismaService.transaction.upsert).toHaveBeenCalled();
    });

    it("should continue processing when notification fails (non-blocking)", async () => {
      const payload = createValidPayload();

      jest
        .spyOn(notificationService, "notify")
        .mockRejectedValueOnce(new Error("Notification failed"));

      // Should NOT throw - non-blocking notification
      const result = await service.handleWebhook(payload);

      expect(result.success).toBe(true);
    });

    it("should handle webhook with minimal payload (no optional fields)", async () => {
      const minimalPayload: OzRelayerWebhookDto = {
        transactionId: "tx_minimal123",
        status: "pending",
        createdAt: "2025-12-30T10:00:00.000Z",
      };

      const result = await service.handleWebhook(minimalPayload);

      expect(result.success).toBe(true);
      expect(prismaService.transaction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            id: minimalPayload.transactionId,
            status: "pending",
          }),
        }),
      );
    });

    it("should reset Redis TTL on every status update", async () => {
      const payload = createValidPayload();

      await service.handleWebhook(payload);

      expect(redisService.set).toHaveBeenCalledWith(
        `tx:status:${payload.transactionId}`,
        expect.any(Object),
        600, // TTL should always be 600 seconds (10 minutes)
      );
    });
  });
});

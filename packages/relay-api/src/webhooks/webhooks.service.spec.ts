import { Test, TestingModule } from "@nestjs/testing";
import {
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
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

  // SPEC-ROUTING-001: mockTransaction now includes ozRelayerTxId
  // payload.id in webhook maps to ozRelayerTxId, NOT to id
  const mockTransaction = {
    id: "our-internal-uuid-123", // Our DB primary key
    ozRelayerTxId: "oz-tx-123", // OZ Relayer's transaction ID (from webhook)
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
    // SPEC-ROUTING-001 FR-003: OZ Relayer webhook has nested structure
    // { id: event-id, event: "transaction_update", payload: { id: oz-tx-id, ... }, timestamp: "..." }
    const createValidPayload = (): OzRelayerWebhookDto => ({
      id: "event-uuid-123", // Webhook event ID (NOT transaction ID)
      event: "transaction_update",
      payload: {
        payload_type: "transaction",
        id: "oz-tx-123", // This is OZ Relayer's transaction ID (maps to ozRelayerTxId)
        hash: "0xabcd1234",
        status: "confirmed",
        from: "0x1234",
        to: "0x5678",
        value: "1000000000000000000",
        created_at: "2025-12-30T10:00:00.000Z",
        confirmed_at: "2025-12-30T10:05:00.000Z",
      },
      timestamp: "2025-12-30T10:05:00.000Z",
    });

    it("should process webhook and update MySQL + Redis successfully", async () => {
      const payload = createValidPayload();

      const result = await service.handleWebhook(payload);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe(payload.payload.id);

      // SPEC-ROUTING-001 FR-003: Verify MySQL UPDATE (not upsert) was called
      // with ozRelayerTxId lookup (not id lookup)
      expect(prismaService.transaction.update).toHaveBeenCalledWith({
        where: { ozRelayerTxId: payload.payload.id },
        data: expect.objectContaining({
          status: payload.payload.status,
          hash: payload.payload.hash,
        }),
      });

      // SPEC-ROUTING-001: Verify Redis cache was updated with TTL
      // Cache key uses internal txId (mockTransaction.id), NOT ozRelayerTxId
      expect(redisService.set).toHaveBeenCalledWith(
        `tx:status:${mockTransaction.id}`,
        expect.objectContaining({
          transactionId: mockTransaction.id,
          ozRelayerTxId: payload.payload.id,
          status: mockTransaction.status,
        }),
        600, // TTL in seconds
      );

      // Verify notification was triggered
      expect(notificationService.notify).toHaveBeenCalledWith(
        payload.payload.id,
        payload.payload.status,
        payload.payload.hash,
      );
    });

    it("should handle status update from pending to confirmed", async () => {
      const payload: OzRelayerWebhookDto = {
        id: "event-uuid-456",
        event: "transaction_update",
        payload: {
          payload_type: "transaction",
          id: "oz-tx-pending-123", // OZ Relayer's transaction ID
          hash: "0xnewhash",
          status: "confirmed",
          created_at: "2025-12-30T10:00:00.000Z",
          confirmed_at: "2025-12-30T10:05:00.000Z",
        },
        timestamp: "2025-12-30T10:05:00.000Z",
      };

      const result = await service.handleWebhook(payload);

      expect(result.success).toBe(true);
      // SPEC-ROUTING-001 FR-003: Uses update, not upsert
      expect(prismaService.transaction.update).toHaveBeenCalled();
    });

    it("should handle failed status update", async () => {
      const payload: OzRelayerWebhookDto = {
        id: "event-uuid-789",
        event: "transaction_update",
        payload: {
          payload_type: "transaction",
          id: "oz-tx-failed-123", // OZ Relayer's transaction ID
          hash: null,
          status: "failed",
          created_at: "2025-12-30T10:00:00.000Z",
        },
        timestamp: "2025-12-30T10:00:00.000Z",
      };

      const result = await service.handleWebhook(payload);

      expect(result.success).toBe(true);
      // SPEC-ROUTING-001 FR-003: Uses update with ozRelayerTxId lookup
      expect(prismaService.transaction.update).toHaveBeenCalledWith({
        where: { ozRelayerTxId: payload.payload.id },
        data: expect.objectContaining({
          status: "failed",
        }),
      });
    });

    // SPEC-ROUTING-001 FR-003: New test for 404 when transaction not found
    it("should throw NotFoundException when transaction not found (AC-3.2)", async () => {
      const payload: OzRelayerWebhookDto = {
        id: "event-uuid-999",
        event: "transaction_update",
        payload: {
          payload_type: "transaction",
          id: "oz-nonexistent-123", // OZ Relayer's transaction ID that doesn't exist
          hash: "0xdef",
          status: "confirmed",
          created_at: "2025-12-30T10:00:00.000Z",
        },
        timestamp: "2025-12-30T10:00:00.000Z",
      };

      // Prisma throws P2025 when record not found
      const prismaError = new Error("Record not found") as Error & {
        code: string;
      };
      prismaError.code = "P2025";

      jest
        .spyOn(prismaService.transaction, "update")
        .mockRejectedValueOnce(prismaError);

      await expect(service.handleWebhook(payload)).rejects.toThrow(
        NotFoundException,
      );

      // Verify NO new transaction record is created (no upsert/create)
      expect(prismaService.transaction.update).toHaveBeenCalledWith({
        where: { ozRelayerTxId: payload.payload.id },
        data: expect.any(Object),
      });
    });

    it("should throw InternalServerErrorException when MySQL update fails", async () => {
      const payload = createValidPayload();

      jest
        .spyOn(prismaService.transaction, "update")
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
      // SPEC-ROUTING-001 FR-003: Uses update, not upsert
      expect(prismaService.transaction.update).toHaveBeenCalled();
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
        id: "event-uuid-minimal",
        event: "transaction_update",
        payload: {
          payload_type: "transaction",
          id: "oz-tx-minimal-123", // OZ Relayer's transaction ID
          status: "pending",
          created_at: "2025-12-30T10:00:00.000Z",
        },
        timestamp: "2025-12-30T10:00:00.000Z",
      };

      const result = await service.handleWebhook(minimalPayload);

      expect(result.success).toBe(true);
      // SPEC-ROUTING-001 FR-003: Uses update with ozRelayerTxId lookup
      expect(prismaService.transaction.update).toHaveBeenCalledWith({
        where: { ozRelayerTxId: minimalPayload.payload.id },
        data: expect.objectContaining({
          status: "pending",
        }),
      });
    });

    it("should reset Redis TTL on every status update", async () => {
      const payload = createValidPayload();

      await service.handleWebhook(payload);

      // SPEC-ROUTING-001: Cache key uses internal txId, NOT ozRelayerTxId
      expect(redisService.set).toHaveBeenCalledWith(
        `tx:status:${mockTransaction.id}`,
        expect.any(Object),
        600, // TTL should always be 600 seconds (10 minutes)
      );
    });
  });
});

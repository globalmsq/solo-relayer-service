import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { randomUUID } from "crypto";
import * as crypto from "crypto";
import {
  createTestApp,
  resetMocks,
  defaultPrismaMock,
  defaultRedisMock,
  defaultHttpServiceMock,
} from "../utils/test-app.factory";
import { TEST_CONFIG } from "../fixtures/test-config";

describe("Webhooks E2E Tests", () => {
  let app: INestApplication;

  /**
   * Generate HMAC-SHA256 signature for webhook payload
   * OZ Relayer sends Base64 encoded HMAC-SHA256 signature
   */
  const generateSignature = (body: object): string => {
    const payload = JSON.stringify(body);
    return crypto
      .createHmac("sha256", TEST_CONFIG.webhook.signing_key)
      .update(payload)
      .digest("base64");
  };

  /**
   * Create OZ Relayer webhook event structure
   *
   * OZ Relayer webhook has nested structure:
   * {
   *   id: "event-uuid",
   *   event: "transaction_update",
   *   payload: { id: "oz-tx-id", status, hash, created_at, ... },
   *   timestamp: "ISO8601"
   * }
   */
  const createWebhookPayload = (
    payloadOverrides: object = {},
    eventOverrides: object = {},
  ) => ({
    id: randomUUID(), // Webhook event ID
    event: "transaction_update",
    payload: {
      payload_type: "transaction",
      id: randomUUID(), // OZ Relayer's transaction ID (ozRelayerTxId in our DB)
      hash: "0x" + "1".repeat(64),
      status: "confirmed",
      status_reason: null,
      from: "0x" + "a".repeat(40),
      to: "0x" + "b".repeat(40),
      value: "0x38d7ea4c68000",
      gas_price: "1000000000",
      gas_limit: 21000,
      nonce: 0,
      relayer_id: "relayer-1",
      created_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
      ...payloadOverrides,
    },
    timestamp: new Date().toISOString(),
    ...eventOverrides,
  });

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMocks(app);
    jest.clearAllMocks();
  });

  describe("POST /api/v1/webhooks/oz-relayer", () => {
    describe("Signature Verification", () => {
      it("TC-E2E-W001: should accept webhook with valid HMAC-SHA256 signature", async () => {
        // Given: Valid webhook payload with correct signature
        const payload = createWebhookPayload();
        const signature = generateSignature(payload);

        // When: POST to /webhooks/oz-relayer with valid signature
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should return 200 OK
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("success", true);
        expect(response.body).toHaveProperty(
          "transactionId",
          payload.payload.id, // OZ Relayer's transaction ID from nested payload
        );
      });

      it("TC-E2E-W002: should reject webhook without signature header", async () => {
        // Given: Valid payload but no signature header
        const payload = createWebhookPayload();

        // When: POST without x-oz-signature header
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .send(payload);

        // Then: Should return 401 Unauthorized
        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty("message");
        expect(response.body.message).toContain("Missing webhook signature");
      });

      it("TC-E2E-W003: should reject webhook with invalid signature", async () => {
        // Given: Valid payload with wrong signature
        const payload = createWebhookPayload();
        const invalidSignature = "invalid-signature-hash-value";

        // When: POST with invalid signature
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", invalidSignature)
          .send(payload);

        // Then: Should return 401 Unauthorized
        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty("message");
        expect(response.body.message).toContain("Invalid webhook signature");
      });

      it("TC-E2E-W004: should reject tampered payload", async () => {
        // Given: Original payload and signature
        const originalPayload = createWebhookPayload({ status: "confirmed" });
        const signature = generateSignature(originalPayload);

        // Tamper the payload after signing
        const tamperedPayload = {
          ...originalPayload,
          payload: { ...originalPayload.payload, status: "failed" },
        };

        // When: POST with original signature but tampered payload
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(tamperedPayload);

        // Then: Should return 401 Unauthorized (signature mismatch)
        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty("message");
      });
    });

    describe("Payload Validation", () => {
      it("TC-E2E-W005: should accept minimal valid payload", async () => {
        // Given: Minimal required fields only
        const payload = {
          id: randomUUID(),
          event: "transaction_update",
          payload: {
            payload_type: "transaction",
            id: randomUUID(),
            status: "pending",
            created_at: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        };
        const signature = generateSignature(payload);

        // When: POST with minimal payload
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should return 200 OK
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("success", true);
      });

      it("TC-E2E-W006: should reject payload without nested payload.id (ozRelayerTxId)", async () => {
        // Given: Missing required payload.id
        const payload = {
          id: randomUUID(),
          event: "transaction_update",
          payload: {
            payload_type: "transaction",
            status: "confirmed",
            created_at: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        };
        const signature = generateSignature(payload);

        // When: POST without payload.id
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should return 400 Bad Request
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("message");
      });

      it("TC-E2E-W007: should reject payload with invalid status", async () => {
        // Given: Invalid status value
        const payload = {
          id: randomUUID(),
          event: "transaction_update",
          payload: {
            payload_type: "transaction",
            id: randomUUID(),
            status: "invalid-status",
            created_at: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        };
        const signature = generateSignature(payload);

        // When: POST with invalid status
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should return 400 Bad Request
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty("message");
      });

      it("TC-E2E-W008: should accept all valid status values", async () => {
        const validStatuses = [
          "pending",
          "sent",
          "submitted",
          "inmempool",
          "mined",
          "confirmed",
          "failed",
        ];

        for (const status of validStatuses) {
          const payload = {
            id: randomUUID(),
            event: "transaction_update",
            payload: {
              payload_type: "transaction",
              id: randomUUID(),
              status,
              created_at: new Date().toISOString(),
            },
            timestamp: new Date().toISOString(),
          };
          const signature = generateSignature(payload);

          const response = await request(app.getHttpServer())
            .post("/api/v1/webhooks/oz-relayer")
            .set("x-oz-signature", signature)
            .send(payload);

          expect(response.status).toBe(200);
          expect(response.body).toHaveProperty("success", true);
        }
      });
    });

    describe("Database Integration", () => {
      it("TC-E2E-W009: should update MySQL on webhook receipt", async () => {
        // Given: Valid webhook payload
        const payload = createWebhookPayload();
        const signature = generateSignature(payload);

        // When: POST webhook
        await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: MySQL update should be called (FR-003: update, not upsert)
        // Uses ozRelayerTxId for lookup (payload.id is OZ Relayer's internal ID)
        expect(defaultPrismaMock.transaction.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { ozRelayerTxId: payload.payload.id },
            data: expect.objectContaining({
              status: payload.payload.status,
            }),
          }),
        );
      });

      it("TC-E2E-W010: should update Redis cache on webhook receipt", async () => {
        // Given: Valid webhook payload with known internal transaction ID
        const ozRelayerTxId = randomUUID();
        const internalTxId = "our-internal-uuid-w010"; // Internal DB transaction ID
        const payload = createWebhookPayload({ id: ozRelayerTxId });
        const signature = generateSignature(payload);

        // SPEC-ROUTING-001: Mock update to return transaction with internal ID
        defaultPrismaMock.transaction.update.mockResolvedValueOnce({
          id: internalTxId, // Our internal DB ID
          ozRelayerTxId,
          hash: payload.payload.hash,
          status: payload.payload.status,
          from: payload.payload.from,
          to: payload.payload.to,
          value: payload.payload.value,
          createdAt: new Date(),
          updatedAt: new Date(),
          confirmedAt: new Date(),
        });

        // When: POST webhook
        await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Redis set should be called with internal txId (not ozRelayerTxId)
        // SPEC-ROUTING-001: Cache key uses internal txId for consistency with StatusService
        expect(defaultRedisMock.set).toHaveBeenCalledWith(
          `tx:status:${internalTxId}`,
          expect.objectContaining({
            transactionId: internalTxId,
            ozRelayerTxId,
          }),
          600, // TTL in seconds
        );
      });

      it("TC-E2E-W011: should continue processing when Redis fails", async () => {
        // Given: Redis will fail
        defaultRedisMock.set.mockRejectedValueOnce(
          new Error("Redis connection failed"),
        );

        const payload = createWebhookPayload();
        const signature = generateSignature(payload);

        // When: POST webhook
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should still return success (graceful degradation)
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("success", true);

        // And MySQL should still be updated (using update, not upsert - FR-003)
        expect(defaultPrismaMock.transaction.update).toHaveBeenCalled();
      });
    });

    describe("Client Notification", () => {
      it("TC-E2E-W012: should trigger client notification on status update", async () => {
        // Given: Valid webhook payload
        const payload = createWebhookPayload();
        const signature = generateSignature(payload);

        // When: POST webhook
        await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: HTTP POST should be called to client webhook URL
        expect(defaultHttpServiceMock.post).toHaveBeenCalledWith(
          TEST_CONFIG.webhook.client_url,
          expect.objectContaining({
            event: "transaction.status.updated",
            transactionId: payload.payload.id, // Uses OZ Relayer's transaction ID
            status: payload.payload.status,
          }),
          expect.any(Object),
        );
      });

      it("TC-E2E-W013: should continue processing when notification fails", async () => {
        // Given: Notification will fail
        defaultHttpServiceMock.post.mockReturnValueOnce({
          toPromise: () => Promise.reject(new Error("Notification failed")),
          pipe: () => ({
            toPromise: () => Promise.reject(new Error("Notification failed")),
          }),
          subscribe: (callbacks: { error?: (err: Error) => void }) => {
            if (callbacks?.error) {
              callbacks.error(new Error("Notification failed"));
            }
            return { unsubscribe: () => {} };
          },
        });

        const payload = createWebhookPayload();
        const signature = generateSignature(payload);

        // When: POST webhook
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should still return success (non-blocking notification)
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("success", true);
      });
    });

    describe("Status Transitions", () => {
      it("TC-E2E-W014: should handle pending to confirmed transition", async () => {
        // Given: Transaction confirmed with hash
        const payload = createWebhookPayload({
          status: "confirmed",
          hash: "0x" + "c".repeat(64),
          confirmed_at: new Date().toISOString(),
        });
        const signature = generateSignature(payload);

        // When: POST webhook
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should succeed
        expect(response.status).toBe(200);
        // FR-003: Uses update, not upsert - looks up by ozRelayerTxId
        expect(defaultPrismaMock.transaction.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { ozRelayerTxId: payload.payload.id },
            data: expect.objectContaining({
              status: "confirmed",
              hash: payload.payload.hash,
            }),
          }),
        );
      });

      it("TC-E2E-W015: should handle failed status", async () => {
        // Given: Transaction failed (no hash)
        const payload = createWebhookPayload({
          status: "failed",
          hash: null,
          confirmed_at: null,
        });
        const signature = generateSignature(payload);

        // When: POST webhook
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should succeed
        expect(response.status).toBe(200);
        // FR-003: Uses update, not upsert - looks up by ozRelayerTxId
        expect(defaultPrismaMock.transaction.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { ozRelayerTxId: payload.payload.id },
            data: expect.objectContaining({
              status: "failed",
            }),
          }),
        );
      });
    });

    describe("Error Handling", () => {
      it("TC-E2E-W016: should return 500 when MySQL fails", async () => {
        // Given: MySQL will fail (update, not upsert - FR-003)
        defaultPrismaMock.transaction.update.mockRejectedValueOnce(
          new Error("Database connection failed"),
        );

        const payload = createWebhookPayload();
        const signature = generateSignature(payload);

        // When: POST webhook
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should return 500 Internal Server Error
        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty("message");
      });
    });
  });
});

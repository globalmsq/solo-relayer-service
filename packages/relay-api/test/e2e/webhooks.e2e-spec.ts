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

  const generateSignature = (body: object): string => {
    const payload = JSON.stringify(body);
    return crypto
      .createHmac("sha256", TEST_CONFIG.webhook.signing_key)
      .update(payload)
      .digest("hex");
  };

  const createWebhookPayload = (overrides: object = {}) => ({
    transactionId: randomUUID(),
    hash: "0x" + "1".repeat(64),
    status: "confirmed",
    from: "0x" + "a".repeat(40),
    to: "0x" + "b".repeat(40),
    value: "1000000000000000000",
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    ...overrides,
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
          payload.transactionId,
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
        const tamperedPayload = { ...originalPayload, status: "failed" };

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
          transactionId: randomUUID(),
          status: "pending",
          createdAt: new Date().toISOString(),
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

      it("TC-E2E-W006: should reject payload without transactionId", async () => {
        // Given: Missing required transactionId
        const payload = {
          status: "confirmed",
          createdAt: new Date().toISOString(),
        };
        const signature = generateSignature(payload);

        // When: POST without transactionId
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
          transactionId: randomUUID(),
          status: "invalid-status",
          createdAt: new Date().toISOString(),
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
            transactionId: randomUUID(),
            status,
            createdAt: new Date().toISOString(),
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

        // Then: MySQL upsert should be called
        expect(defaultPrismaMock.transaction.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: payload.transactionId },
            update: expect.objectContaining({
              status: payload.status,
            }),
            create: expect.objectContaining({
              id: payload.transactionId,
              status: payload.status,
            }),
          }),
        );
      });

      it("TC-E2E-W010: should update Redis cache on webhook receipt", async () => {
        // Given: Valid webhook payload
        const payload = createWebhookPayload();
        const signature = generateSignature(payload);

        // When: POST webhook
        await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Redis set should be called with TTL
        expect(defaultRedisMock.set).toHaveBeenCalledWith(
          `tx:status:${payload.transactionId}`,
          expect.any(Object),
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

        // And MySQL should still be updated
        expect(defaultPrismaMock.transaction.upsert).toHaveBeenCalled();
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
            transactionId: payload.transactionId,
            status: payload.status,
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
          confirmedAt: new Date().toISOString(),
        });
        const signature = generateSignature(payload);

        // When: POST webhook
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should succeed
        expect(response.status).toBe(200);
        expect(defaultPrismaMock.transaction.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              status: "confirmed",
              hash: payload.hash,
            }),
          }),
        );
      });

      it("TC-E2E-W015: should handle failed status", async () => {
        // Given: Transaction failed (no hash)
        const payload = createWebhookPayload({
          status: "failed",
          hash: null,
          confirmedAt: undefined,
        });
        delete (payload as any).confirmedAt;
        const signature = generateSignature(payload);

        // When: POST webhook
        const response = await request(app.getHttpServer())
          .post("/api/v1/webhooks/oz-relayer")
          .set("x-oz-signature", signature)
          .send(payload);

        // Then: Should succeed
        expect(response.status).toBe(200);
        expect(defaultPrismaMock.transaction.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              status: "failed",
            }),
          }),
        );
      });
    });

    describe("Error Handling", () => {
      it("TC-E2E-W016: should return 500 when MySQL fails", async () => {
        // Given: MySQL will fail
        defaultPrismaMock.transaction.upsert.mockRejectedValueOnce(
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

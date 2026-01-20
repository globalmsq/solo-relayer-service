import request from "supertest";
import { INestApplication } from "@nestjs/common";
import {
  createTestApp,
  resetMocks,
  defaultPrismaMock,
} from "../utils/test-app.factory";
import { TEST_WALLETS, TEST_ADDRESSES } from "../fixtures/test-wallets";
import {
  signForwardRequest,
  createForwardRequest,
} from "../utils/eip712-signer";

describe("Payment Integration E2E Tests", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMocks(app);
  });

  describe("Complete Payment Flows", () => {
    it("TC-E2E-P001: batch token transfer with multiple Direct TX requests", async () => {
      // Given: Multiple Direct TX requests for batch token transfer
      const transactionIds: string[] = [];
      const recipients = [
        TEST_ADDRESSES.merchant,
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
      ];

      // When: Submit multiple Direct TX requests in parallel
      const responses = await Promise.all(
        recipients.map((recipient) => {
          const payload = {
            to: recipient,
            data: "0x00",
            speed: "fast",
          };
          return request(app.getHttpServer())
            .post("/api/v1/relay/direct")
            .set("x-api-key", "test-api-key")
            .send(payload);
        }),
      );

      // Then: Each request should return 202 Accepted
      for (const response of responses) {
        expect(response.status).toBe(202);
        expect(response.body).toHaveProperty("transactionId");
        transactionIds.push(response.body.transactionId);
      }

      // Verify: All 3 requests completed successfully
      expect(transactionIds.length).toBe(3);
      // Verify all transactionIds are unique UUIDs
      const uniqueTransactionIds = new Set(transactionIds);
      expect(uniqueTransactionIds.size).toBe(3);
    });

    it("TC-E2E-P002: complete gasless payment flow with all 4 steps", async () => {
      // Given: User address
      const userAddress = TEST_ADDRESSES.user;
      const recipientAddress = TEST_ADDRESSES.merchant;

      // Step 1: Query nonce
      const nonceResponse = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${userAddress}`)
        .set("x-api-key", "test-api-key");

      // Then: Nonce query should return 200 with nonce
      expect(nonceResponse.status).toBe(200);
      expect(nonceResponse.body).toHaveProperty("nonce");
      expect(nonceResponse.body.nonce).toBe("0");

      // Step 2: Create and sign ForwardRequest
      const forwardRequest = createForwardRequest(
        userAddress,
        recipientAddress,
        { nonce: 0 },
      );
      const signature = await signForwardRequest(
        TEST_WALLETS.user,
        forwardRequest,
      );

      // Then: Signature should be valid EIP-712 signature (132 chars: 0x + 130 hex)
      expect(signature).toBeTruthy();
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);

      // Step 3: Submit Gasless TX
      const submitResponse = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature });

      // Then: Gasless TX should return 202 Accepted with transactionId
      expect(submitResponse.status).toBe(202);
      expect(submitResponse.body).toHaveProperty("transactionId");
      const transactionId = submitResponse.body.transactionId;

      // Step 4: Query status
      // SPEC-DISCOVERY-001: 2-tier lookup (Redis → MySQL), no OZ Relayer lookup
      // Status updates come from queue-consumer via webhooks

      // Mock MySQL to return pending status (transaction just submitted)
      defaultPrismaMock.transaction.findUnique.mockResolvedValueOnce({
        id: transactionId,
        ozRelayerTxId: "oz-relayer-tx-" + transactionId.substring(0, 8),
        ozRelayerUrl: "http://oz-relayer-1:8080",
        hash: null,
        status: "pending", // Initial status after submission
        from: userAddress,
        to: recipientAddress,
        value: "0",
        data: forwardRequest.data,
        createdAt: new Date(),
        updatedAt: new Date(),
        confirmedAt: null,
      });

      const statusResponse = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${transactionId}`)
        .set("x-api-key", "test-api-key");

      // Then: Status should return 200 with pending status from MySQL
      // Note: Status transitions to confirmed via queue-consumer webhook processing
      expect(statusResponse.status).toBe(200);
      expect(statusResponse.body).toHaveProperty("status", "pending");
      expect(statusResponse.body).toHaveProperty("transactionId");
    });
  });
});

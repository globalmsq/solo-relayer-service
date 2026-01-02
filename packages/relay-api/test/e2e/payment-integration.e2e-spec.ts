import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { of } from "rxjs";
import {
  createTestApp,
  getHttpServiceMock,
  resetMocks,
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
      // Setup HttpService.get() mock for confirmed status
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        of({
          data: {
            id: transactionId,
            hash: "0x" + "1".repeat(64),
            status: "confirmed",
            created_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
          },
          status: 200,
        }),
      );

      const statusResponse = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${transactionId}`)
        .set("x-api-key", "test-api-key");

      // Then: Status should return 200 with confirmed status
      expect(statusResponse.status).toBe(200);
      expect(statusResponse.body).toHaveProperty("status", "confirmed");
      expect(statusResponse.body).toHaveProperty("hash");
    });
  });
});

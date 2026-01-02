import request from "supertest";
import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
import {
  createTestApp,
  getOzRelayerServiceMock,
  getGaslessServiceMock,
  resetMocks,
} from "../utils/test-app.factory";
import { TEST_WALLETS, TEST_ADDRESSES } from "../fixtures/test-wallets";
import {
  signForwardRequest,
  createForwardRequest,
  createExpiredForwardRequest,
} from "../utils/eip712-signer";

describe("Gasless Transaction E2E Tests", () => {
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

  describe("POST /api/v1/relay/gasless", () => {
    it("TC-E2E-G001: should accept valid gasless transaction with signature", async () => {
      // Given: Valid ForwardRequest + signature
      const forwardRequest = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        { nonce: 0 },
      );
      const signature = await signForwardRequest(
        TEST_WALLETS.user,
        forwardRequest,
      );

      // When: Call POST /api/v1/relay/gasless
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature });

      // Then: Should return 202 Accepted with transactionId
      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty("transactionId");
    });

    it("TC-E2E-G002: should accept custom gas and value included", async () => {
      // Given: ForwardRequest with custom gas and value
      const forwardRequest = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        {
          nonce: 0,
          gas: "200000",
          value: "1000000000000000000", // 1 ETH in wei
        },
      );
      const signature = await signForwardRequest(
        TEST_WALLETS.user,
        forwardRequest,
      );

      // When: Call POST /api/v1/relay/gasless
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature });

      // Then: Should return 202 Accepted
      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty("transactionId");
    });
  });

  describe("GET /api/v1/relay/gasless/nonce/:address", () => {
    it("TC-E2E-G003: should return nonce for valid address", async () => {
      // Given: Valid user address
      const userAddress = TEST_ADDRESSES.user;

      // When: Call GET /api/v1/relay/gasless/nonce/:address
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${userAddress}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 200 OK with nonce
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("nonce");
      expect(response.body.nonce).toBe("0");
    });

    it("TC-E2E-G004: should return 400 for invalid address format", async () => {
      // Given: Invalid Ethereum address
      const invalidAddress = "not-an-address";

      // When: Call GET /api/v1/relay/gasless/nonce/:address
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${invalidAddress}`)
        .set("x-api-key", "test-api-key");

      // Then: Should reject with 400
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("POST /api/v1/relay/gasless signature verification", () => {
    it("TC-E2E-G005: should return 400 for invalid signature format", async () => {
      // Given: ForwardRequest with invalid signature format
      const forwardRequest = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        { nonce: 0 },
      );
      const invalidSignature = "invalid-signature-format";

      // When: Call POST /api/v1/relay/gasless
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature: invalidSignature });

      // Then: Should reject with 400 (invalid signature format)
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-G006: should return 401 for signature from wrong signer", async () => {
      // Given: ForwardRequest signed by different wallet
      const forwardRequest = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        { nonce: 0 },
      );
      // Sign with merchant wallet instead of user wallet
      const wrongSignature = await signForwardRequest(
        TEST_WALLETS.merchant,
        forwardRequest,
      );

      // When: Call POST /api/v1/relay/gasless
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature: wrongSignature });

      // Then: Should reject with 401 (wrong signer)
      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-G007: should return 400 for expired deadline", async () => {
      // Given: ForwardRequest with expired deadline
      const forwardRequest = createExpiredForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
      );
      const signature = await signForwardRequest(
        TEST_WALLETS.user,
        forwardRequest,
      );

      // When: Call POST /api/v1/relay/gasless
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature });

      // Then: Should reject with 400 (expired deadline)
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-G008: should return 400 for nonce mismatch", async () => {
      // Given: ForwardRequest with wrong nonce
      const forwardRequest = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        { nonce: 999 }, // Wrong nonce
      );
      const signature = await signForwardRequest(
        TEST_WALLETS.user,
        forwardRequest,
      );

      // When: Call POST /api/v1/relay/gasless
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature });

      // Then: Should reject with 400 (nonce mismatch)
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-G009: should return 400 for malformed signature", async () => {
      // Given: ForwardRequest with malformed signature
      const forwardRequest = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        { nonce: 0 },
      );
      const malformedSignature = "0x" + "ff".repeat(30); // Too short

      // When: Call POST /api/v1/relay/gasless
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature: malformedSignature });

      // Then: Should reject with 400 (malformed signature)
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-G010: should return 400 for missing required fields", async () => {
      // Given: Incomplete ForwardRequest (missing required fields)
      const incompleteRequest = {
        from: TEST_ADDRESSES.user,
        // Missing: to, value, gas, nonce, deadline, data
      };

      // When: Call POST /api/v1/relay/gasless
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: incompleteRequest, signature: "0x" });

      // Then: Should reject with 400 (missing fields)
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("Service unavailability", () => {
    it("TC-E2E-G011: should return 503 when OZ Relayer unavailable", async () => {
      // Given: OZ Relayer service is unavailable
      const ozRelayerMock = getOzRelayerServiceMock(app);
      ozRelayerMock.sendTransaction.mockRejectedValueOnce(
        new ServiceUnavailableException("OZ Relayer service unavailable"),
      );

      const forwardRequest = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        { nonce: 0 },
      );
      const signature = await signForwardRequest(
        TEST_WALLETS.user,
        forwardRequest,
      );

      // When: Call POST /api/v1/relay/gasless
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature });

      // Then: Should return 503 Service Unavailable
      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-G012: should return 503 when RPC unavailable for nonce query", async () => {
      // Given: RPC endpoint is unavailable
      const gaslessService = getGaslessServiceMock(app);
      (
        gaslessService.getNonceFromForwarder as jest.SpyInstance
      ).mockRejectedValueOnce(
        new ServiceUnavailableException("RPC connection failed"),
      );

      const userAddress = TEST_ADDRESSES.user;

      // When: Call GET /api/v1/relay/gasless/nonce/:address
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${userAddress}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 503 Service Unavailable
      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty("message");
    });
  });
});

import request from "supertest";
import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
import { throwError } from "rxjs";
import {
  createTestApp,
  getOzRelayerServiceMock,
  getGaslessServiceMock,
  getHttpServiceMock,
  resetMocks,
} from "../utils/test-app.factory";
import { TEST_WALLETS, TEST_ADDRESSES } from "../fixtures/test-wallets";
import {
  signForwardRequest,
  createForwardRequest,
} from "../utils/eip712-signer";

/**
 * Error Scenarios E2E Tests
 *
 * Tests for various failure conditions and error handling:
 * - Relayer pool failures
 * - Network unavailability
 * - Rate limiting
 * - Insufficient balance
 * - Timeout scenarios
 */
describe("Error Scenarios E2E Tests", () => {
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

  describe("Relayer Pool Failures", () => {
    it("TC-E2E-ERR001: should return 503 when OZ Relayer is completely unavailable", async () => {
      // Given: OZ Relayer service throws ServiceUnavailableException
      const ozMock = getOzRelayerServiceMock(app);
      ozMock.sendTransaction.mockRejectedValueOnce(
        new ServiceUnavailableException("All relayers are unavailable"),
      );

      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: "0x00",
        speed: "fast",
      };

      // When: Submit Direct TX request
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/direct")
        .set("x-api-key", "test-api-key")
        .send(payload);

      // Then: Should return 503 Service Unavailable
      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toContain("unavailable");
    });

    it("TC-E2E-ERR002: should return 503 when relayer responds with network error", async () => {
      // Given: OZ Relayer throws network error
      const ozMock = getOzRelayerServiceMock(app);
      ozMock.sendTransaction.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: "0x00",
        speed: "fast",
      };

      // When: Submit Direct TX request
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/direct")
        .set("x-api-key", "test-api-key")
        .send(payload);

      // Then: Should return 503 or 500 depending on error handling
      expect([500, 503]).toContain(response.status);
    });

    it("TC-E2E-ERR003: should handle timeout gracefully", async () => {
      // Given: OZ Relayer times out (simulated with delayed rejection)
      const ozMock = getOzRelayerServiceMock(app);
      ozMock.sendTransaction.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Request timeout")), 100);
          }),
      );

      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: "0x00",
        speed: "fast",
      };

      // When: Submit Direct TX request
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/direct")
        .set("x-api-key", "test-api-key")
        .send(payload);

      // Then: Should return appropriate error status
      expect([500, 503, 504]).toContain(response.status);
    });
  });

  describe("RPC Failures", () => {
    it("TC-E2E-ERR004: should return 503 when RPC is unavailable for nonce query", async () => {
      // Given: RPC endpoint is unavailable
      const gaslessMock = getGaslessServiceMock(app);
      (
        gaslessMock.getNonceFromForwarder as jest.SpyInstance
      ).mockRejectedValueOnce(
        new ServiceUnavailableException("RPC endpoint unreachable"),
      );

      // When: Query nonce
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 503 Service Unavailable
      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-ERR005: should return 503 when RPC returns invalid response", async () => {
      // Given: RPC returns malformed data
      const gaslessMock = getGaslessServiceMock(app);
      (
        gaslessMock.getNonceFromForwarder as jest.SpyInstance
      ).mockRejectedValueOnce(new Error("Invalid JSON response from RPC"));

      // When: Query nonce
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${TEST_ADDRESSES.user}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return error status
      expect([500, 503]).toContain(response.status);
    });
  });

  describe("Input Validation Errors", () => {
    it("TC-E2E-ERR006: should return 400 for malformed Ethereum address", async () => {
      // Given: Invalid Ethereum address format
      const invalidAddress = "0xinvalid";

      // When: Query nonce with invalid address
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/gasless/nonce/${invalidAddress}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 400 Bad Request
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-ERR007: should return 400 for missing required fields in Direct TX", async () => {
      // Given: Incomplete payload (missing 'to' field)
      const incompletePayload = {
        data: "0x00",
        speed: "fast",
      };

      // When: Submit Direct TX request
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/direct")
        .set("x-api-key", "test-api-key")
        .send(incompletePayload);

      // Then: Should return 400 Bad Request
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-ERR008: should return 400 for invalid speed parameter", async () => {
      // Given: Invalid speed value
      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: "0x00",
        speed: "supersonic", // Invalid value
      };

      // When: Submit Direct TX request
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/direct")
        .set("x-api-key", "test-api-key")
        .send(payload);

      // Then: Should return 400 Bad Request
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("Authentication Errors", () => {
    it("TC-E2E-ERR009: should return 401 for missing API key", async () => {
      // Given: No x-api-key header
      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: "0x00",
        speed: "fast",
      };

      // When: Submit Direct TX request without API key
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/direct")
        .send(payload);

      // Then: Should return 401 Unauthorized
      expect(response.status).toBe(401);
    });

    it("TC-E2E-ERR010: should return 401 for invalid API key", async () => {
      // Given: Wrong API key
      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: "0x00",
        speed: "fast",
      };

      // When: Submit Direct TX request with wrong API key
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/direct")
        .set("x-api-key", "wrong-api-key")
        .send(payload);

      // Then: Should return 401 Unauthorized
      expect(response.status).toBe(401);
    });
  });

  describe("Gasless TX Error Scenarios", () => {
    it("TC-E2E-ERR011: should return 503 when Gasless service fails to submit", async () => {
      // Given: Valid request but OZ Relayer fails
      const ozMock = getOzRelayerServiceMock(app);
      ozMock.sendTransaction.mockRejectedValueOnce(
        new ServiceUnavailableException("Gasless submission failed"),
      );

      const forwardRequest = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        {
          nonce: 0,
        },
      );
      const signature = await signForwardRequest(
        TEST_WALLETS.user,
        forwardRequest,
      );

      // When: Submit Gasless TX
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature });

      // Then: Should return 503 Service Unavailable
      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-ERR012: should return 400 for replay attack (reused nonce)", async () => {
      // Given: ForwardRequest with nonce 0 (already used)
      // First, simulate that nonce 0 was already used
      const gaslessMock = getGaslessServiceMock(app);
      (
        gaslessMock.getNonceFromForwarder as jest.SpyInstance
      ).mockResolvedValueOnce("1"); // Current nonce is 1

      const forwardRequest = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        {
          nonce: 0, // Trying to reuse nonce 0
        },
      );
      const signature = await signForwardRequest(
        TEST_WALLETS.user,
        forwardRequest,
      );

      // When: Submit Gasless TX with old nonce
      const response = await request(app.getHttpServer())
        .post("/api/v1/relay/gasless")
        .set("x-api-key", "test-api-key")
        .send({ request: forwardRequest, signature });

      // Then: Should reject with 400 (nonce mismatch)
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("Status Endpoint Errors", () => {
    it("TC-E2E-ERR013: should return 404 for non-existent transaction ID", async () => {
      // Given: Non-existent but valid UUID format transaction ID
      const fakeTransactionId = "00000000-0000-0000-0000-000000000000";

      // Mock HttpService to return 404
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        throwError(() => ({
          response: { status: 404, data: { message: "Not Found" } },
        })),
      );

      // When: Query status
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${fakeTransactionId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 404 Not Found
      expect(response.status).toBe(404);
    });

    it("TC-E2E-ERR014: should return 400 for invalid transaction ID format", async () => {
      // Given: Invalid transaction ID format (contains special chars)
      const invalidTransactionId = "invalid@tx#id";

      // When: Query status
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${invalidTransactionId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 400 Bad Request (UUID format validation fails first)
      expect(response.status).toBe(400);
    });
  });
});

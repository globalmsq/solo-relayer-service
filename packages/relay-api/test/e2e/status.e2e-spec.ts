import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  createTestApp,
  resetMocks,
  defaultRedisMock,
  defaultPrismaMock,
} from "../utils/test-app.factory";

describe("Status Polling E2E Tests", () => {
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

  describe("GET /api/v1/relay/status/:txId", () => {
    it("TC-E2E-S001: should query pending status", async () => {
      // Given: Valid UUID txId with pending status in MySQL
      // SPEC-DISCOVERY-001: 2-tier lookup (Redis → MySQL), no OZ Relayer
      const txId = randomUUID();
      const ozRelayerTxId = randomUUID();

      // Mock MySQL to return non-terminal status
      defaultPrismaMock.transaction.findUnique.mockResolvedValueOnce({
        id: 1,
        transactionId: txId,
        relayerTxId: ozRelayerTxId,
        relayerUrl: "http://oz-relayer-1:8080",
        transactionHash: null,
        status: "pending",
        from: "0x" + "a".repeat(40),
        to: "0x" + "b".repeat(40),
        value: "1000000000000000000",
        data: null,
        type: null,
        request: null,
        result: null,
        error_message: null,
        retryOnFailure: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        confirmedAt: null,
      });

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 200 with pending status from MySQL
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "pending");
      expect(response.body).toHaveProperty("transactionId");
    });

    it("TC-E2E-S002: should query confirmed status with hash", async () => {
      // Given: Valid UUID txId with confirmed status in MySQL (terminal status)
      // SPEC-ROUTING-001: For terminal status (confirmed), return directly from MySQL
      const txId = randomUUID();
      const hash = "0x" + "1".repeat(64);
      const confirmedAt = new Date();

      // Mock MySQL to return terminal status (confirmed) - no OZ Relayer call needed
      defaultPrismaMock.transaction.findUnique.mockResolvedValueOnce({
        id: 1,
        transactionId: txId,
        relayerTxId: randomUUID(),
        relayerUrl: "http://oz-relayer-1:8080",
        transactionHash: hash,
        status: "confirmed",
        from: "0x" + "a".repeat(40),
        to: "0x" + "b".repeat(40),
        value: "1000000000000000000",
        data: null,
        type: null,
        request: null,
        result: null,
        error_message: null,
        retryOnFailure: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        confirmedAt,
      });

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 200 with confirmed status and hash
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "confirmed");
      expect(response.body).toHaveProperty("transactionHash", hash);
      expect(response.body).toHaveProperty("confirmedAt");
    });

    it("TC-E2E-S003: should query failed status", async () => {
      // Given: Valid UUID txId with failed status in MySQL (terminal status)
      // SPEC-ROUTING-001: For terminal status (failed), return directly from MySQL
      const txId = randomUUID();

      // Mock MySQL to return terminal status (failed) - no OZ Relayer call needed
      defaultPrismaMock.transaction.findUnique.mockResolvedValueOnce({
        id: 1,
        transactionId: txId,
        relayerTxId: randomUUID(),
        relayerUrl: "http://oz-relayer-1:8080",
        transactionHash: null,
        status: "failed",
        from: "0x" + "a".repeat(40),
        to: "0x" + "b".repeat(40),
        value: "1000000000000000000",
        data: null,
        type: null,
        request: null,
        result: null,
        error_message: null,
        retryOnFailure: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        confirmedAt: null,
      });

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 200 with failed status
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "failed");
    });

    it("TC-E2E-S004: should return 400 for invalid UUID format", async () => {
      // Given: Invalid UUID format
      const invalidUuid = "not-a-uuid";

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${invalidUuid}`)
        .set("x-api-key", "test-api-key");

      // Then: Should reject with 400
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-S005: should return pending status from MySQL (no OZ Relayer lookup)", async () => {
      // Given: MySQL has non-terminal status
      // SPEC-DISCOVERY-001: 2-tier lookup (Redis → MySQL), no OZ Relayer lookup
      // relay-api returns current MySQL data for non-terminal status
      // Status updates come from queue-consumer via webhooks
      const txId = randomUUID();
      const ozRelayerTxId = randomUUID();

      // Mock MySQL to return non-terminal status (pending)
      defaultPrismaMock.transaction.findUnique.mockResolvedValueOnce({
        id: 1,
        transactionId: txId,
        relayerTxId: ozRelayerTxId,
        relayerUrl: "http://oz-relayer-1:8080",
        transactionHash: null,
        status: "pending",
        from: "0x" + "a".repeat(40),
        to: "0x" + "b".repeat(40),
        value: "1000000000000000000",
        data: null,
        type: null,
        request: null,
        result: null,
        error_message: null,
        retryOnFailure: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        confirmedAt: null,
      });

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return MySQL data with pending status (no OZ Relayer lookup)
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "pending");
      expect(response.body).toHaveProperty("transactionId");
    });

    it("TC-E2E-S006: should return 404 for non-existent txId", async () => {
      // Given: Valid UUID but transaction not found in MySQL
      // SPEC-DISCOVERY-001: 2-tier lookup (Redis → MySQL), 404 if not found
      const txId = randomUUID();

      // Redis miss
      defaultRedisMock.get.mockResolvedValueOnce(null);
      // MySQL miss
      defaultPrismaMock.transaction.findUnique.mockResolvedValueOnce(null);

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 404 Not Found
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("message");
    });
  });

  // SPEC-DISCOVERY-001: Changed from 3-tier to 2-tier lookup (Redis → MySQL)
  describe("2-Tier Lookup Integration", () => {
    beforeEach(() => {
      // Reset mock call counts for 3-tier tests
      jest.clearAllMocks();
    });

    it("TC-E2E-S007: Tier 1 - should return cached status from Redis", async () => {
      // Given: Status cached in Redis
      const txId = randomUUID();
      const cachedData = {
        transactionId: txId,
        hash: "0x" + "a".repeat(64),
        status: "confirmed",
        createdAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
      };
      defaultRedisMock.get.mockResolvedValueOnce(cachedData);

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return cached data
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "confirmed");
      expect(response.body).toHaveProperty("transactionId", txId);

      // Verify Redis was called first
      expect(defaultRedisMock.get).toHaveBeenCalledWith(`tx:status:${txId}`);
    });

    it("TC-E2E-S008: Tier 2 - should return from MySQL and backfill Redis", async () => {
      // Given: Not in Redis but exists in MySQL
      const txId = randomUUID();
      defaultRedisMock.get.mockResolvedValueOnce(null); // Redis miss

      const mysqlData = {
        id: 1,
        transactionId: txId,
        transactionHash: "0x" + "b".repeat(64),
        status: "confirmed",
        from: "0x" + "c".repeat(40),
        to: "0x" + "d".repeat(40),
        value: "1000000000000000000",
        data: null,
        type: null,
        request: null,
        result: null,
        error_message: null,
        relayerTxId: null,
        relayerUrl: null,
        retryOnFailure: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        confirmedAt: new Date(),
      };
      defaultPrismaMock.transaction.findUnique.mockResolvedValueOnce(mysqlData);

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return MySQL data
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "confirmed");
      expect(response.body).toHaveProperty("transactionId", txId);

      // And Redis should be backfilled
      expect(defaultRedisMock.set).toHaveBeenCalledWith(
        `tx:status:${txId}`,
        expect.any(Object),
        600, // TTL
      );
    });

    it("TC-E2E-S009: MySQL non-terminal status - should return current data and backfill Redis", async () => {
      // Given: Not in Redis, MySQL has non-terminal status
      // SPEC-DISCOVERY-001: 2-tier lookup (Redis → MySQL), no OZ Relayer
      // Non-terminal status returns current MySQL data and backfills Redis
      const txId = randomUUID();
      const ozRelayerTxId = randomUUID();
      defaultRedisMock.get.mockResolvedValueOnce(null); // Redis miss

      // Mock MySQL to return non-terminal status
      defaultPrismaMock.transaction.findUnique.mockResolvedValueOnce({
        id: 1,
        transactionId: txId,
        relayerTxId: ozRelayerTxId,
        relayerUrl: "http://oz-relayer-1:8080",
        transactionHash: null,
        status: "pending", // Non-terminal status
        from: "0x" + "f".repeat(40),
        to: "0x" + "1".repeat(40),
        value: "1000000000000000000",
        data: null,
        type: null,
        request: null,
        result: null,
        error_message: null,
        retryOnFailure: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        confirmedAt: null,
      });

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return MySQL data (no OZ Relayer lookup)
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "pending");
      expect(response.body).toHaveProperty("transactionId", txId);

      // And should backfill Redis
      expect(defaultRedisMock.set).toHaveBeenCalledWith(
        `tx:status:${txId}`,
        expect.any(Object),
        600,
      );
    });

    it("TC-E2E-S010: should gracefully degrade when Redis unavailable", async () => {
      // Given: Redis fails, MySQL has data
      const txId = randomUUID();
      defaultRedisMock.get.mockRejectedValueOnce(
        new Error("Redis connection failed"),
      );

      const mysqlData = {
        id: 1,
        transactionId: txId,
        transactionHash: "0x" + "g".repeat(64),
        status: "mined",
        from: null,
        to: null,
        value: null,
        data: null,
        type: null,
        request: null,
        result: null,
        error_message: null,
        relayerTxId: null,
        relayerUrl: null,
        retryOnFailure: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        confirmedAt: null,
      };
      defaultPrismaMock.transaction.findUnique.mockResolvedValueOnce(mysqlData);

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should still return MySQL data (graceful degradation)
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "mined");
    });
  });
});

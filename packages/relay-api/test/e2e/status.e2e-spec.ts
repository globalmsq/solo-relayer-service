import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { randomUUID } from "crypto";
import { of, throwError } from "rxjs";
import {
  createTestApp,
  getHttpServiceMock,
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
      // Given: Valid UUID txId with pending status mock
      const txId = randomUUID();
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        of({
          data: {
            id: txId,
            hash: null,
            status: "pending",
            created_at: new Date().toISOString(),
          },
          status: 200,
        }),
      );

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 200 with pending status
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "pending");
      expect(response.body).toHaveProperty("transactionId");
    });

    it("TC-E2E-S002: should query confirmed status with hash", async () => {
      // Given: Valid UUID txId with confirmed status mock
      const txId = randomUUID();
      const hash = "0x" + "1".repeat(64);
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        of({
          data: {
            id: txId,
            hash,
            status: "confirmed",
            created_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
          },
          status: 200,
        }),
      );

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 200 with confirmed status and hash
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "confirmed");
      expect(response.body).toHaveProperty("hash", hash);
      expect(response.body).toHaveProperty("confirmedAt");
    });

    it("TC-E2E-S003: should query failed status", async () => {
      // Given: Valid UUID txId with failed status mock
      const txId = randomUUID();
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        of({
          data: {
            id: txId,
            hash: null,
            status: "failed",
            created_at: new Date().toISOString(),
          },
          status: 200,
        }),
      );

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

    it("TC-E2E-S005: should return 503 when OZ Relayer unavailable", async () => {
      // Given: OZ Relayer service is unavailable
      const txId = randomUUID();
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        throwError(() => ({
          response: { status: 500, data: { message: "Internal Server Error" } },
        })),
      );

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 503 Service Unavailable
      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty("message");
    });

    it("TC-E2E-S006: should return 404 for non-existent txId", async () => {
      // Given: Valid UUID but transaction not found
      const txId = randomUUID();
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        throwError(() => ({
          response: { status: 404, data: { message: "Not Found" } },
        })),
      );

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return 404 Not Found
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty("message");
    });
  });

  describe("3-Tier Lookup Integration", () => {
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
        id: txId,
        hash: "0x" + "b".repeat(64),
        status: "confirmed",
        from: "0x" + "c".repeat(40),
        to: "0x" + "d".repeat(40),
        value: "1000000000000000000",
        data: null,
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

    it("TC-E2E-S009: Tier 3 - should fetch from OZ Relayer and write-through", async () => {
      // Given: Not in Redis, not in MySQL
      const txId = randomUUID();
      const hash = "0x" + "e".repeat(64);
      defaultRedisMock.get.mockResolvedValueOnce(null); // Redis miss
      defaultPrismaMock.transaction.findUnique.mockResolvedValueOnce(null); // MySQL miss

      // Mock OZ Relayer response
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        of({
          data: {
            id: txId,
            hash,
            status: "confirmed",
            created_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
            from: "0x" + "f".repeat(40),
            to: "0x" + "1".repeat(40),
            value: "1000000000000000000",
          },
          status: 200,
        }),
      );

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set("x-api-key", "test-api-key");

      // Then: Should return OZ Relayer data
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "confirmed");
      expect(response.body).toHaveProperty("hash", hash);

      // And should write-through to both Redis and MySQL
      expect(defaultRedisMock.set).toHaveBeenCalledWith(
        `tx:status:${txId}`,
        expect.any(Object),
        600,
      );
      expect(defaultPrismaMock.transaction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: txId },
          create: expect.objectContaining({
            id: txId,
            status: "confirmed",
          }),
        }),
      );
    });

    it("TC-E2E-S010: should gracefully degrade when Redis unavailable", async () => {
      // Given: Redis fails, MySQL has data
      const txId = randomUUID();
      defaultRedisMock.get.mockRejectedValueOnce(
        new Error("Redis connection failed"),
      );

      const mysqlData = {
        id: txId,
        hash: "0x" + "g".repeat(64),
        status: "mined",
        from: null,
        to: null,
        value: null,
        data: null,
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

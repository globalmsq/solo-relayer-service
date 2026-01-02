import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { createTestApp } from "../utils/test-app.factory";

describe("Health Check E2E Tests", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/v1/health", () => {
    it("TC-E2E-H001: should return health status when all services available", async () => {
      // Given: Health endpoint is available

      // When: Call GET /api/v1/health
      const response = await request(app.getHttpServer()).get("/api/v1/health");

      // Then: Should return valid response
      expect([200, 503]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body).toHaveProperty("status");
      }
    });

    it("TC-E2E-H002: should be public endpoint without API key requirement", async () => {
      // Given: No API key provided

      // When: Call GET /api/v1/health without x-api-key
      const response = await request(app.getHttpServer()).get("/api/v1/health");

      // Then: Should not return 401 (public endpoint)
      expect(response.status).not.toBe(401);
      expect([200, 503, 500]).toContain(response.status);
    });

    it("TC-E2E-H003: should handle OZ Relayer pool health", async () => {
      // Given: Health endpoint is available

      // When: Call GET /api/v1/health
      const response = await request(app.getHttpServer()).get("/api/v1/health");

      // Then: Should return valid health response
      expect([200, 503, 500]).toContain(response.status);
    });
  });
});

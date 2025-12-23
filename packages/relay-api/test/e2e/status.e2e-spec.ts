import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { of, throwError } from 'rxjs';
import { createTestApp, getHttpServiceMock, resetMocks } from '../utils/test-app.factory';

describe('Status Polling E2E Tests', () => {
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

  describe('GET /api/v1/relay/status/:txId', () => {
    it('TC-E2E-S001: should query pending status', async () => {
      // Given: Valid UUID txId with pending status mock
      const txId = randomUUID();
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        of({
          data: {
            id: txId,
            hash: null,
            status: 'pending',
            created_at: new Date().toISOString(),
          },
          status: 200,
        }),
      );

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set('x-api-key', 'test-api-key');

      // Then: Should return 200 with pending status
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'pending');
      expect(response.body).toHaveProperty('transactionId');
    });

    it('TC-E2E-S002: should query confirmed status with hash', async () => {
      // Given: Valid UUID txId with confirmed status mock
      const txId = randomUUID();
      const hash = '0x' + '1'.repeat(64);
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        of({
          data: {
            id: txId,
            hash,
            status: 'confirmed',
            created_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
          },
          status: 200,
        }),
      );

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set('x-api-key', 'test-api-key');

      // Then: Should return 200 with confirmed status and hash
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'confirmed');
      expect(response.body).toHaveProperty('hash', hash);
      expect(response.body).toHaveProperty('confirmedAt');
    });

    it('TC-E2E-S003: should query failed status', async () => {
      // Given: Valid UUID txId with failed status mock
      const txId = randomUUID();
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        of({
          data: {
            id: txId,
            hash: null,
            status: 'failed',
            created_at: new Date().toISOString(),
          },
          status: 200,
        }),
      );

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set('x-api-key', 'test-api-key');

      // Then: Should return 200 with failed status
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'failed');
    });

    it('TC-E2E-S004: should return 400 for invalid UUID format', async () => {
      // Given: Invalid UUID format
      const invalidUuid = 'not-a-uuid';

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${invalidUuid}`)
        .set('x-api-key', 'test-api-key');

      // Then: Should reject with 400
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('message');
    });

    it('TC-E2E-S005: should return 503 when OZ Relayer unavailable', async () => {
      // Given: OZ Relayer service is unavailable
      const txId = randomUUID();
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        throwError(() => ({
          response: { status: 500, data: { message: 'Internal Server Error' } },
        })),
      );

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set('x-api-key', 'test-api-key');

      // Then: Should return 503 Service Unavailable
      expect(response.status).toBe(503);
      expect(response.body).toHaveProperty('message');
    });

    it('TC-E2E-S006: should return 404 for non-existent txId', async () => {
      // Given: Valid UUID but transaction not found
      const txId = randomUUID();
      const httpMock = getHttpServiceMock(app);
      httpMock.get.mockReturnValueOnce(
        throwError(() => ({
          response: { status: 404, data: { message: 'Not Found' } },
        })),
      );

      // When: Call GET /api/v1/relay/status/:txId
      const response = await request(app.getHttpServer())
        .get(`/api/v1/relay/status/${txId}`)
        .set('x-api-key', 'test-api-key');

      // Then: Should return 404 Not Found
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('message');
    });
  });
});

---
id: SPEC-WEBHOOK-001
title: TX History & Webhook System - Acceptance Criteria (Redis L1 + MySQL L2)
version: 1.2.0
status: complete
created: 2025-12-30
updated: 2026-01-02
---

# Acceptance Criteria: SPEC-WEBHOOK-001

## Overview

**Purpose**: Define acceptance criteria for SPEC-WEBHOOK-001 in Given-When-Then format

**Scope**: Redis L1 cache + MySQL L2 persistent storage, OZ Relayer Webhook processing, 3-Tier status lookup, client notification

**Test Strategy**: Unit Tests (24) + E2E Tests (9) ≥ 85% coverage

---

## AC-1: Redis L1 + MySQL L2 Transaction Storage

### AC-1.1: Redis + MySQL Storage on Direct Transaction Creation

**Given**: When a client submits a Direct Transaction
**When**: POST /api/v1/relay/direct request is successfully processed
**Then**:
- Cached in Redis with key `tx:status:{txId}` (TTL: 600 seconds)
- New record created in MySQL `transactions` table
- Fields saved: `id`, `status`, `to`, `value`, `data`, `createdAt`
- `status` is `pending`
- Response returns `transactionId`

**Verification Method**:
```typescript
// E2E Test
const response = await request(app.getHttpServer())
  .post('/api/v1/relay/direct')
  .set('X-API-Key', 'test-api-key')
  .send({
    to: '0x1234567890123456789012345678901234567890',
    data: '0x',
    value: '0'
  })
  .expect(202);

const txId = response.body.transactionId;

// Verify Redis (L1) cache
const cached = await redis.get(`tx:status:${txId}`);
expect(cached).toBeDefined();
const cachedData = JSON.parse(cached);
expect(cachedData.status).toBe('pending');

// Verify MySQL (L2) storage
const stored = await prisma.transaction.findUnique({ where: { id: txId } });
expect(stored).toBeDefined();
expect(stored.status).toBe('pending');
expect(stored.to).toBe('0x1234567890123456789012345678901234567890');
```

---

### AC-1.2: Redis + MySQL Storage on Gasless Transaction Creation

**Given**: When a client submits a Gasless Transaction
**When**: POST /api/v1/relay/gasless request is successfully processed
**Then**:
- Cached in Redis with key `tx:status:{txId}` (TTL: 600 seconds)
- New record created in MySQL `transactions` table
- `to` field is `FORWARDER_ADDRESS` (ERC2771Forwarder address)
- `value` field is `0` (Gasless characteristic)
- `data` field is ABI-encoded Forward Request
- Response returns `transactionId`

**Verification Method**:
```typescript
// E2E Test
const response = await request(app.getHttpServer())
  .post('/api/v1/relay/gasless')
  .set('X-API-Key', 'test-api-key')
  .send(gaslessTxDto)
  .expect(202);

const txId = response.body.transactionId;

// Verify Redis (L1) cache
const cached = await redis.get(`tx:status:${txId}`);
expect(cached).toBeDefined();

// Verify MySQL (L2) storage
const stored = await prisma.transaction.findUnique({ where: { id: txId } });
expect(stored).toBeDefined();
expect(stored.status).toBe('pending');
expect(stored.to).toBe(process.env.FORWARDER_ADDRESS);
expect(stored.value).toBe('0');
```

---

### AC-1.3: Error Handling on MySQL Connection Failure

**Given**: When MySQL database is not responding
**When**: A transaction creation request is received
**Then**:
- HTTP 500 Internal Server Error returned
- Transaction not submitted to OZ Relayer (rollback)
- Error response message: "Failed to save transaction"

**Verification Method**:
```typescript
// Unit Test
it('should throw InternalServerErrorException if MySQL fails', async () => {
  jest.spyOn(prisma.transaction, 'create').mockRejectedValue(new Error('DB connection failed'));

  await expect(
    directService.sendTransaction(directTxDto)
  ).rejects.toThrow(InternalServerErrorException);
});
```

---

## AC-2: OZ Relayer Webhook Reception and Processing

### AC-2.1: Webhook Reception with Valid HMAC Signature

**Given**: When OZ Relayer sends a transaction status change webhook
**When**: POST /api/v1/webhooks/oz-relayer request includes valid HMAC-SHA256 signature
**Then**:
- HTTP 200 OK returned
- Redis `tx:status:{txId}` key updated with TTL reset (600 seconds)
- Corresponding record in MySQL `transactions` table updated
- Fields updated: `status`, `hash`, `confirmedAt`
- `updatedAt` field updated to current time
- Notification Service called (client notification sent)

**Verification Method**:
```typescript
// E2E Test
const webhookPayload = {
  transactionId: txId,
  status: 'confirmed',
  hash: '0xabcd1234...',
  confirmedAt: '2025-12-30T10:00:00Z'
};

const signature = crypto
  .createHmac('sha256', process.env.WEBHOOK_SIGNING_KEY)
  .update(JSON.stringify(webhookPayload))
  .digest('hex');

await request(app.getHttpServer())
  .post('/api/v1/webhooks/oz-relayer')
  .set('X-OZ-Signature', signature)
  .send(webhookPayload)
  .expect(200);

// Verify Redis (L1) updated with TTL reset
const cached = JSON.parse(await redis.get(`tx:status:${txId}`));
expect(cached.status).toBe('confirmed');
const ttl = await redis.ttl(`tx:status:${txId}`);
expect(ttl).toBeGreaterThan(595); // Close to 600 (just set)

// Verify MySQL (L2) updated
const updated = await prisma.transaction.findUnique({ where: { id: txId } });
expect(updated.status).toBe('confirmed');
expect(updated.hash).toBe('0xabcd1234...');
expect(updated.confirmedAt).toEqual(new Date('2025-12-30T10:00:00Z'));
```

---

### AC-2.2: Invalid HMAC Signature Rejection

**Given**: When OZ Relayer sends a webhook
**When**: POST /api/v1/webhooks/oz-relayer request includes invalid HMAC signature
**Then**:
- HTTP 401 Unauthorized returned
- No Redis data modification (security guaranteed)
- No MySQL data modification (security guaranteed)
- Error response message: "Invalid webhook signature"

**Verification Method**:
```typescript
// E2E Test
await request(app.getHttpServer())
  .post('/api/v1/webhooks/oz-relayer')
  .set('X-OZ-Signature', 'invalid-signature-12345')
  .send(webhookPayload)
  .expect(401);

// Verify Redis (L1) not updated
const cached = await redis.get(`tx:status:${txId}`);
// If exists, status should not match webhook payload

// Verify MySQL (L2) not updated
const tx = await prisma.transaction.findUnique({ where: { id: txId } });
expect(tx.status).not.toBe(webhookPayload.status); // Unchanged
```

---

### AC-2.3: HMAC Signature Header Missing Rejection

**Given**: When OZ Relayer sends a webhook
**When**: POST /api/v1/webhooks/oz-relayer request missing `X-OZ-Signature` header
**Then**:
- HTTP 401 Unauthorized returned
- Error response message: "Missing webhook signature"

**Verification Method**:
```typescript
// E2E Test
await request(app.getHttpServer())
  .post('/api/v1/webhooks/oz-relayer')
  .send(webhookPayload)
  .expect(401);
```

---

### AC-2.4: Webhook Payload Validation (DTO Validation)

**Given**: When OZ Relayer sends a webhook
**When**: Payload missing required fields or invalid format
**Then**:
- HTTP 400 Bad Request returned
- Error response message: Validation error details

**Verification Method**:
```typescript
// E2E Test
const invalidPayload = {
  transactionId: 'not-a-uuid', // Invalid UUID
  status: 'confirmed',
  createdAt: 'not-a-date' // Invalid date format
};

const signature = generateHmac(invalidPayload);

await request(app.getHttpServer())
  .post('/api/v1/webhooks/oz-relayer')
  .set('X-OZ-Signature', signature)
  .send(invalidPayload)
  .expect(400);
```

---

### AC-2.5: Idempotency Guarantee (Duplicate Webhook Handling)

**Given**: When the same webhook is received multiple times
**When**: Duplicate webhooks sent with same `transactionId` and `status`
**Then**:
- HTTP 200 OK returned (for all requests)
- MySQL `transactions` table updated only once (Prisma upsert)
- Notification sent only on first request (duplicate prevention logic)

**Verification Method**:
```typescript
// E2E Test
const signature = generateHmac(webhookPayload);

// First request
await request(app.getHttpServer())
  .post('/api/v1/webhooks/oz-relayer')
  .set('X-OZ-Signature', signature)
  .send(webhookPayload)
  .expect(200);

// Duplicate request (same payload)
await request(app.getHttpServer())
  .post('/api/v1/webhooks/oz-relayer')
  .set('X-OZ-Signature', signature)
  .send(webhookPayload)
  .expect(200);

// Verify MySQL updated only once
const tx = await prisma.transaction.findUnique({ where: { id: webhookPayload.transactionId } });
expect(tx.updatedAt).toBeDefined(); // Same updatedAt value
```

---

## AC-3: Client Notification Delivery

### AC-3.1: Client Notification After Webhook Reception

**Given**: When OZ Relayer webhook is validly received
**When**: MySQL transaction status is updated
**Then**:
- HTTP POST request sent to `CLIENT_WEBHOOK_URL`
- Payload includes `event`, `transactionId`, `status`, `timestamp`
- Timeout 5 seconds
- Client response awaited (async processing, prevents blocking webhook processing)

**Verification Method**:
```typescript
// E2E Test (with Mock Client Service)
const mockClient = startMockServer(); // Mock HTTP server at CLIENT_WEBHOOK_URL

const signature = generateHmac(webhookPayload);
await request(app.getHttpServer())
  .post('/api/v1/webhooks/oz-relayer')
  .set('X-OZ-Signature', signature)
  .send(webhookPayload)
  .expect(200);

// Verify notification received by mock client
const notifications = mockClient.getReceivedRequests();
expect(notifications).toHaveLength(1);
expect(notifications[0].body).toMatchObject({
  event: 'transaction.status.updated',
  transactionId: webhookPayload.transactionId,
  status: 'confirmed'
});
```

---

### AC-3.2: Skip Notification When CLIENT_WEBHOOK_URL Not Set

**Given**: When environment variable `CLIENT_WEBHOOK_URL` is not configured
**When**: Transaction status is updated by webhook reception
**Then**:
- Notification delivery skipped (no HTTP request)
- Warning log output: "CLIENT_WEBHOOK_URL not configured, skipping notification"
- Webhook processing completes normally (200 OK)

**Verification Method**:
```typescript
// Unit Test
it('should skip notification if CLIENT_WEBHOOK_URL not configured', async () => {
  jest.spyOn(configService, 'get').mockReturnValue(undefined); // No URL
  const loggerSpy = jest.spyOn(logger, 'warn');

  await notificationService.notifyClients(notificationDto);

  expect(loggerSpy).toHaveBeenCalledWith('CLIENT_WEBHOOK_URL not configured, skipping notification');
  expect(httpService.post).not.toHaveBeenCalled();
});
```

---

### AC-3.3: Error Logging on Client Response Failure (Non-blocking)

**Given**: When client service is not responding or returns an error
**When**: Notification delivery fails
**Then**:
- Error log output: "Failed to send notification: [error message]"
- Exception not thrown (webhook processing completes normally)
- MySQL update already completed and retained

**Verification Method**:
```typescript
// Unit Test
it('should log error if client service fails', async () => {
  jest.spyOn(httpService, 'post').mockReturnValue(throwError(() => new Error('Network error')));
  const loggerSpy = jest.spyOn(logger, 'error');

  await notificationService.notifyClients(notificationDto);

  expect(loggerSpy).toHaveBeenCalledWith('Failed to send notification: Network error');
});
```

---

## AC-4: 3-Tier Status Lookup (Redis L1 → MySQL L2 → OZ Relayer)

### AC-4.1: Redis Cache Hit (L1 Cache Hit)

**Given**: When transaction data is cached in Redis
**When**: GET /api/v1/relay/status/:txId request is received
**Then**:
- Data returned from Redis (no MySQL, OZ Relayer API calls)
- Response includes `transactionId`, `status`, `hash`, `createdAt`, `confirmedAt`
- Response time < 5ms (Redis cache hit)

**Verification Method**:
```typescript
// E2E Test: Redis Cache Hit
const txId = 'test-tx-id';
const statusData = {
  status: 'confirmed',
  hash: '0xabcd...',
  createdAt: '2025-12-30T10:00:00Z',
  confirmedAt: '2025-12-30T10:05:00Z'
};

// Pre-populate Redis cache
await redis.setex(`tx:status:${txId}`, 600, JSON.stringify(statusData));

const start = Date.now();
const response = await request(app.getHttpServer())
  .get(`/api/v1/relay/status/${txId}`)
  .expect(200);
const duration = Date.now() - start;

expect(response.body.status).toBe('confirmed');
expect(response.body.hash).toBe('0xabcd...');
expect(duration).toBeLessThan(5); // < 5ms for Redis hit
```

---

### AC-4.2: Redis Miss, MySQL Hit (L1 Miss, L2 Hit)

**Given**: When Redis has no data and MySQL has transaction data stored
**When**: GET /api/v1/relay/status/:txId request is received
**Then**:
- Redis lookup fails (cache miss)
- Data retrieved from MySQL
- Data backfilled to Redis (TTL: 600 seconds)
- Response returns MySQL data
- Response time < 50ms (MySQL lookup)

**Verification Method**:
```typescript
// E2E Test: Redis Miss, MySQL Hit with Backfill
const txId = 'test-tx-id';

// Ensure Redis cache is empty
await redis.del(`tx:status:${txId}`);

// MySQL has the data
const tx = await prisma.transaction.create({
  data: {
    id: txId,
    status: 'confirmed',
    hash: '0xabcd...',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
});

const start = Date.now();
const response = await request(app.getHttpServer())
  .get(`/api/v1/relay/status/${txId}`)
  .expect(200);
const duration = Date.now() - start;

expect(response.body.status).toBe('confirmed');
expect(duration).toBeLessThan(50); // < 50ms for MySQL hit

// Verify Redis backfill
const cached = await redis.get(`tx:status:${txId}`);
expect(cached).toBeDefined();
const cachedData = JSON.parse(cached);
expect(cachedData.status).toBe('confirmed');

const ttl = await redis.ttl(`tx:status:${txId}`);
expect(ttl).toBeGreaterThan(595); // Close to 600 (just backfilled)
```

---

### AC-4.3: Redis + MySQL Miss → OZ Relayer Lookup with Dual Storage

**Given**: When both Redis and MySQL have no data for the transaction
**When**: GET /api/v1/relay/status/:txId request is received
**Then**:
- Redis lookup fails (cache miss)
- MySQL lookup fails (cache miss)
- OZ Relayer API called to retrieve data
- Cached in Redis (TTL: 600 seconds)
- New record created in MySQL
- OZ Relayer data returned in response
- Response time < 200ms (OZ Relayer API call)

**Verification Method**:
```typescript
// E2E Test: Full 3-Tier Miss → OZ Relayer Fallback
const txId = 'new-tx-id';

// Ensure Redis and MySQL are empty
await redis.del(`tx:status:${txId}`);
await prisma.transaction.deleteMany({ where: { id: txId } });

// Mock OZ Relayer response
mockOzRelayerApi({
  transactionId: txId,
  status: 'confirmed',
  hash: '0xabcd...',
  createdAt: '2025-12-30T10:00:00Z',
  confirmedAt: '2025-12-30T10:05:00Z'
});

const start = Date.now();
const response = await request(app.getHttpServer())
  .get(`/api/v1/relay/status/${txId}`)
  .expect(200);
const duration = Date.now() - start;

expect(response.body.status).toBe('confirmed');
expect(duration).toBeLessThan(200); // < 200ms for OZ Relayer

// Verify Redis cached
const cached = await redis.get(`tx:status:${txId}`);
expect(cached).toBeDefined();
expect(JSON.parse(cached).status).toBe('confirmed');

// Verify MySQL stored
const stored = await prisma.transaction.findUnique({ where: { id: txId } });
expect(stored).toBeDefined();
expect(stored.status).toBe('confirmed');
```

---

### AC-4.4: Redis TTL Reset on Webhook Reception

**Given**: When OZ Relayer webhook is received
**When**: POST /api/v1/webhooks/oz-relayer request is processed
**Then**:
- Redis `tx:status:{txId}` key updated
- Redis TTL reset (600 seconds)
- MySQL updated
- Response 200 OK

**Verification Method**:
```typescript
// E2E Test: Webhook Updates Redis with TTL Reset
const txId = 'test-tx-id';

// Create initial transaction
await redis.setex(`tx:status:${txId}`, 600, JSON.stringify({ status: 'pending' }));
await prisma.transaction.create({
  data: { id: txId, status: 'pending', createdAt: new Date() }
});

// Wait 5 seconds to reduce TTL
await new Promise(resolve => setTimeout(resolve, 5000));

// Check TTL before webhook
const ttlBefore = await redis.ttl(`tx:status:${txId}`);
expect(ttlBefore).toBeLessThan(596); // Less than initial

// Send webhook
const webhookPayload = {
  transactionId: txId,
  status: 'confirmed',
  hash: '0xabcd...',
  confirmedAt: '2025-12-30T10:05:00Z'
};
const signature = generateHmac(webhookPayload);

await request(app.getHttpServer())
  .post('/api/v1/webhooks/oz-relayer')
  .set('X-OZ-Signature', signature)
  .send(webhookPayload)
  .expect(200);

// Verify Redis updated and TTL reset
const cached = JSON.parse(await redis.get(`tx:status:${txId}`));
expect(cached.status).toBe('confirmed');

const ttlAfter = await redis.ttl(`tx:status:${txId}`);
expect(ttlAfter).toBeGreaterThan(595); // Reset to ~600 seconds
```

---

### AC-4.5: Degraded Mode - MySQL Fallback on Redis Failure

**Given**: When Redis service is not responding
**When**: GET /api/v1/relay/status/:txId request is received
**Then**:
- Redis lookup fails (connection error)
- Data retrieved from MySQL (L2 fallback)
- Warning log output: "Redis unavailable, falling back to MySQL"
- Response returns MySQL data

**Verification Method**:
```typescript
// E2E Test: Redis Failure → MySQL Fallback
const txId = 'test-tx-id';

// MySQL has the data
await prisma.transaction.create({
  data: {
    id: txId,
    status: 'confirmed',
    hash: '0xabcd...',
    createdAt: new Date(),
  }
});

// Simulate Redis failure
jest.spyOn(redis, 'get').mockRejectedValue(new Error('Redis connection refused'));
const loggerSpy = jest.spyOn(logger, 'warn');

const response = await request(app.getHttpServer())
  .get(`/api/v1/relay/status/${txId}`)
  .expect(200);

expect(response.body.status).toBe('confirmed');
expect(loggerSpy).toHaveBeenCalledWith('Redis unavailable, falling back to MySQL');
```

---

### AC-4.6: Degraded Mode - OZ Relayer Fallback on Redis + MySQL Failure

**Given**: When both Redis and MySQL are not responding
**When**: GET /api/v1/relay/status/:txId request is received
**Then**:
- Redis lookup fails (connection error)
- MySQL lookup fails (connection error)
- OZ Relayer API called to retrieve data
- Warning log output: "Redis and MySQL unavailable, falling back to OZ Relayer"
- Response returns OZ Relayer data

**Verification Method**:
```typescript
// E2E Test: Redis + MySQL Failure → OZ Relayer Fallback
const txId = 'test-tx-id';

// Simulate Redis failure
jest.spyOn(redis, 'get').mockRejectedValue(new Error('Redis connection refused'));

// Simulate MySQL failure
jest.spyOn(prisma.transaction, 'findUnique').mockRejectedValue(new Error('MySQL connection refused'));

// Mock OZ Relayer response
mockOzRelayerApi({ status: 'confirmed', hash: '0xabcd...' });

const loggerSpy = jest.spyOn(logger, 'warn');

const response = await request(app.getHttpServer())
  .get(`/api/v1/relay/status/${txId}`)
  .expect(200);

expect(response.body.status).toBe('confirmed');
expect(loggerSpy).toHaveBeenCalledWith('Redis and MySQL unavailable, falling back to OZ Relayer');
```

---

### AC-4.7: Complete Failure (Redis + MySQL + OZ Relayer All Failed)

**Given**: When Redis, MySQL, and OZ Relayer API are all not responding
**When**: GET /api/v1/relay/status/:txId request is received
**Then**:
- HTTP 503 Service Unavailable returned
- Error response message: "All status lookup services unavailable"

**Verification Method**:
```typescript
// E2E Test: Complete Failure
const txId = 'non-existent-tx-id';

// Simulate Redis failure
jest.spyOn(redis, 'get').mockRejectedValue(new Error('Redis connection refused'));

// Ensure MySQL has no data
await prisma.transaction.deleteMany({ where: { id: txId } });

// Mock OZ Relayer failure
mockOzRelayerApi({ error: true });

await request(app.getHttpServer())
  .get(`/api/v1/relay/status/${txId}`)
  .expect(503);
```

---

## AC-5: Infrastructure & Configuration

### AC-5.1: MySQL Service Running Normally (Docker Compose)

**Given**: When MySQL service is defined in Docker Compose file
**When**: `docker compose --profile phase2 up -d` command is executed
**Then**:
- MySQL 8.0 container runs normally
- Port 3306 binding successful
- Health check passes (mysqladmin ping)
- Volume mount successful (data persistence)

**Verification Method**:
```bash
# Execute Docker Compose
docker compose --profile phase2 up -d mysql

# Verify health check
docker compose ps
# Expected: mysql (healthy)

# MySQL connection test
docker exec -it msq-relayer-mysql mysql -u relayer_user -p -e "SELECT 1;"
```

---

### AC-5.2: Prisma Migration Applied

**Given**: When Prisma schema.prisma file is defined
**When**: `pnpm prisma migrate dev --name init` command is executed
**Then**:
- Migration SQL files generated (prisma/migrations/)
- MySQL `transactions` table created
- Indexes created (status, hash, createdAt)
- Prisma Client automatically generated

**Verification Method**:
```bash
# Execute migration
pnpm prisma migrate dev --name init

# Verify tables
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer -e "SHOW TABLES;"
# Expected: transactions

# Verify schema
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer -e "DESCRIBE transactions;"
```

---

### AC-5.3: Environment Variables Setup and Verification

**Given**: When required environment variables are defined in `.env.example` file
**When**: `.env` file is created and values are set
**Then**:
- `DATABASE_URL` value valid (MySQL connection possible)
- `REDIS_URL` value valid (Redis connection possible, default: `redis://localhost:6379`)
- `REDIS_STATUS_TTL_SECONDS` value valid (default: 600)
- `WEBHOOK_SIGNING_KEY` 32+ characters
- `CLIENT_WEBHOOK_URL` valid URL format
- Environment variables load successfully on NestJS application start

**Verification Method**:
```bash
# Create .env file
cp .env.example .env
# Edit .env with actual values

# Verify environment variables
pnpm --filter relay-api start:dev
# Expected: No configuration errors

# Verify Redis connection
docker exec -it oz-relayer-redis redis-cli ping
# Expected: PONG
```

---

### AC-5.4: Redis Connection Normal (Reusing Existing OZ Relayer Redis)

**Given**: When OZ Relayer's Redis service is running
**When**: NestJS application starts
**Then**:
- Redis connection successful (reusing existing OZ Relayer Redis)
- No new Redis container created
- Health check shows Redis status "up"

**Verification Method**:
```bash
# Verify existing Redis
docker ps | grep redis
# Expected: oz-relayer-redis (or similar)

# Verify health check
curl http://localhost:8080/api/v1/health
# Expected: {"status":"ok","info":{"mysql":{"status":"up"},"redis":{"status":"up"}}}
```

---

## AC-6: Test Coverage and Quality

### AC-6.1: Unit Test Coverage ≥ 85%

**Given**: When all Services, Controllers, Guards are implemented
**When**: `pnpm test:cov` command is executed
**Then**:
- WebhooksService coverage ≥ 85%
- WebhooksController coverage ≥ 85%
- NotificationService coverage ≥ 85%
- StatusService coverage ≥ 85%
- WebhookSignatureGuard coverage 100%

**Verification Method**:
```bash
pnpm --filter relay-api test:cov

# Expected output:
# WebhooksService: 90%+ coverage
# WebhooksController: 95%+ coverage
# NotificationService: 85%+ coverage
# StatusService: 90%+ coverage
# WebhookSignatureGuard: 100% coverage
```

---

### AC-6.2: E2E Test Scenarios Passed

**Given**: When E2E test scenarios are written
**When**: `pnpm test:e2e` command is executed
**Then**:
- All 9 E2E scenarios pass
- Total execution time < 45 seconds
- Test isolation (each test runs independently)

**Scenario List**:
1. Transaction creation → Redis + MySQL storage (write-through)
2. Webhook reception → Redis TTL reset + MySQL update
3. Invalid HMAC signature → 401 Unauthorized (Redis/MySQL untouched)
4. Redis cache hit → Fast response (<5ms)
5. Redis miss, MySQL hit → MySQL data + Redis backfill
6. Full miss → OZ Relayer fallback + Redis/MySQL storage
7. Redis failure → MySQL fallback (degraded mode)
8. Redis + MySQL failure → OZ Relayer fallback (degraded mode)
9. Client notification sent after webhook

**Verification Method**:
```bash
pnpm --filter relay-api test:e2e

# Expected output:
# ✓ Scenario 1: Transaction creation → Redis + MySQL storage
# ✓ Scenario 2: Webhook reception → Redis TTL reset + MySQL update
# ✓ Scenario 3: Invalid HMAC signature → 401 Unauthorized
# ✓ Scenario 4: Redis cache hit → Fast response (<5ms)
# ✓ Scenario 5: Redis miss, MySQL hit → Redis backfill
# ✓ Scenario 6: Full miss → OZ Relayer fallback
# ✓ Scenario 7: Redis failure → MySQL fallback
# ✓ Scenario 8: Redis + MySQL failure → OZ Relayer fallback
# ✓ Scenario 9: Client notification sent after webhook
# Test Suites: 1 passed, 1 total
# Tests: 9 passed, 9 total
```

---

### AC-6.3: Linting and Format Rules Compliance

**Given**: When ESLint and Prettier configurations are complete
**When**: `pnpm lint` command is executed
**Then**:
- 0 ESLint errors
- 0 Prettier format errors
- All files comply with project coding style

**Verification Method**:
```bash
pnpm --filter relay-api lint

# Expected output:
# ✓ 0 errors, 0 warnings
```

---

## AC-7: Deployment and Operations

### AC-7.1: Production Deployment Success

**Given**: When all tests pass and build is successful
**When**: Deployed to production environment (Docker Compose)
**Then**:
- MySQL service runs normally
- relay-api service runs normally
- Health check endpoint responds normally (200 OK)
- Swagger documentation accessible (/api)

**Verification Method**:
```bash
# Production deployment
docker compose --profile phase2 up -d

# Health check
curl http://localhost:8080/api/v1/health
# Expected: {"status":"ok","info":{"mysql":{"status":"up"},"redis":{"status":"up"}}}

# Swagger UI
curl http://localhost:8080/api
# Expected: HTML page with Swagger UI
```

---

### AC-7.2: Webhook Endpoint Production Verification

**Given**: When deployed to production environment
**When**: Actual OZ Relayer sends webhook
**Then**:
- POST /api/v1/webhooks/oz-relayer endpoint responds normally
- HMAC signature verification successful
- MySQL transaction status updated
- Client notification delivery successful

**Verification Method**:
```bash
# OZ Relayer Webhook simulation (using production environment variables)
curl -X POST http://localhost:8080/api/v1/webhooks/oz-relayer \
  -H "Content-Type: application/json" \
  -H "X-OZ-Signature: $(generate_hmac)" \
  -d '{
    "transactionId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "confirmed",
    "hash": "0xabcd1234...",
    "createdAt": "2025-12-30T10:00:00Z",
    "confirmedAt": "2025-12-30T10:05:00Z"
  }'

# Expected: 200 OK

# Verify MySQL data
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer \
  -e "SELECT * FROM transactions WHERE id='550e8400-e29b-41d4-a716-446655440000';"
```

---

### AC-7.3: Monitoring and Log Verification

**Given**: When operating in production environment
**When**: Transaction creation, webhook reception, status lookup events occur
**Then**:
- All events recorded in logs
- Warning/Error logs output correctly
- MySQL query performance metrics collectible

**Verification Method**:
```bash
# View logs
docker compose --profile phase2 logs -f relay-api

# Expected log entries:
# [WebhooksService] Webhook received: transaction 550e8400...
# [NotificationService] Notification sent for transaction 550e8400...
# [StatusService] Cache hit for transaction 550e8400...
```

---

## Final Acceptance Criteria Checklist

### Infrastructure
- [x] MySQL service running normally (Docker Compose)
- [x] Redis connection normal (reusing existing OZ Relayer Redis)
- [x] Prisma Migration applied
- [x] RedisModule created with DI configuration
- [x] Environment variables setup and verification complete (including REDIS_URL, REDIS_STATUS_TTL_SECONDS)

### API Endpoints
- [x] POST /api/v1/relay/direct → Redis + MySQL storage verified (write-through)
- [x] POST /api/v1/relay/gasless → Redis + MySQL storage verified (write-through)
- [x] POST /api/v1/webhooks/oz-relayer → Webhook reception + Redis TTL reset
- [x] GET /api/v1/relay/status/:txId → 3-Tier lookup (Redis → MySQL → OZ Relayer)

### Security
- [x] HMAC-SHA256 signature verification working
- [x] Invalid signature rejection (401 Unauthorized, Redis/MySQL unchanged)
- [x] Missing signature header rejection (401 Unauthorized)

### Functionality - 3-Tier Cache
- [x] Redis cache hit (L1) → Response time < 5ms
- [x] Redis miss, MySQL hit (L2) → Redis backfill + Response time < 50ms
- [x] Full miss → OZ Relayer lookup + Redis/MySQL storage
- [x] Webhook reception → Redis TTL reset (600 seconds) + MySQL update

### Functionality - Degraded Mode
- [x] MySQL Fallback on Redis failure (L2)
- [x] OZ Relayer Fallback on Redis + MySQL failure
- [x] 503 Service Unavailable on complete failure

### Functionality - Notification
- [x] Client Notification delivery successful
- [x] Non-blocking handling on Notification failure

### Quality
- [x] Unit Test Coverage ≥ 85%
- [x] All 9 E2E Test scenarios passed
- [x] 0 ESLint errors
- [x] Prettier format rules compliance

### Documentation
- [x] Swagger/OpenAPI documentation complete
- [x] README.md updated (Phase 2 + Redis guide)
- [x] .env.example updated (including REDIS_URL, REDIS_STATUS_TTL_SECONDS)

### Deployment
- [x] Production deployment successful
- [x] Health check endpoint responding normally (MySQL + Redis status "up")
- [x] Webhook endpoint production verified
- [x] Logging and monitoring working normally

---

**Version**: 1.2.0
**Status**: Complete
**Last Updated**: 2026-01-02
**Change**: Added Redis L1 cache layer (3-Tier architecture)

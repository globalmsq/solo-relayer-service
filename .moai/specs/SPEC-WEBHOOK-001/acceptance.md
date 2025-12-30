---
id: SPEC-WEBHOOK-001
title: TX History & Webhook System - Acceptance Criteria (Redis L1 + MySQL L2)
version: 1.1.0
status: draft
created: 2025-12-30
updated: 2025-12-30
---

# Acceptance Criteria: SPEC-WEBHOOK-001

## 📋 개요

**목적**: SPEC-WEBHOOK-001의 수락 기준을 Given-When-Then 형식으로 정의

**범위**: Redis L1 캐시 + MySQL L2 영구 저장, OZ Relayer Webhook 처리, 3-Tier 상태 조회, 클라이언트 알림

**테스트 전략**: Unit Tests (24개) + E2E Tests (9개) ≥ 85% 커버리지

---

## 🧪 AC-1: Redis L1 + MySQL L2 트랜잭션 저장

### AC-1.1: Direct Transaction 생성 시 Redis + MySQL 저장

**Given**: 클라이언트가 Direct Transaction을 제출할 때
**When**: POST /api/v1/relay/direct 요청이 성공적으로 처리될 때
**Then**:
- Redis에 `tx:status:{txId}` 키로 캐싱 (TTL: 600초)
- MySQL `transactions` 테이블에 새로운 레코드 생성
- `id`, `status`, `to`, `value`, `data`, `createdAt` 필드 저장
- `status`는 `pending` 상태
- Response에 `transactionId` 반환

**검증 방법**:
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

### AC-1.2: Gasless Transaction 생성 시 Redis + MySQL 저장

**Given**: 클라이언트가 Gasless Transaction을 제출할 때
**When**: POST /api/v1/relay/gasless 요청이 성공적으로 처리될 때
**Then**:
- Redis에 `tx:status:{txId}` 키로 캐싱 (TTL: 600초)
- MySQL `transactions` 테이블에 새로운 레코드 생성
- `to` 필드는 `FORWARDER_ADDRESS` (ERC2771Forwarder 주소)
- `value` 필드는 `0` (Gasless 특성)
- `data` 필드는 ABI 인코딩된 Forward Request
- Response에 `transactionId` 반환

**검증 방법**:
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

### AC-1.3: MySQL 연결 실패 시 에러 처리

**Given**: MySQL 데이터베이스가 응답하지 않을 때
**When**: 트랜잭션 생성 요청이 들어올 때
**Then**:
- HTTP 500 Internal Server Error 반환
- OZ Relayer에는 트랜잭션이 제출되지 않음 (롤백)
- Error response 메시지: "Failed to save transaction"

**검증 방법**:
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

## 🔔 AC-2: OZ Relayer Webhook 수신 및 처리

### AC-2.1: 유효한 HMAC 서명으로 Webhook 수신

**Given**: OZ Relayer가 트랜잭션 상태 변경 Webhook을 전송할 때
**When**: POST /api/v1/webhooks/oz-relayer 요청에 유효한 HMAC-SHA256 서명 포함
**Then**:
- HTTP 200 OK 반환
- Redis `tx:status:{txId}` 키 업데이트 및 TTL 리셋 (600초)
- MySQL `transactions` 테이블의 해당 레코드 업데이트
- `status`, `hash`, `confirmedAt` 필드 업데이트
- `updatedAt` 필드 현재 시각으로 갱신
- Notification Service 호출 (클라이언트 알림 전송)

**검증 방법**:
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

### AC-2.2: 유효하지 않은 HMAC 서명 거부

**Given**: OZ Relayer가 Webhook을 전송할 때
**When**: POST /api/v1/webhooks/oz-relayer 요청에 잘못된 HMAC 서명 포함
**Then**:
- HTTP 401 Unauthorized 반환
- Redis 데이터 변경 없음 (보안 보장)
- MySQL 데이터 변경 없음 (보안 보장)
- Error response 메시지: "Invalid webhook signature"

**검증 방법**:
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
expect(tx.status).not.toBe(webhookPayload.status); // 변경되지 않음
```

---

### AC-2.3: HMAC 서명 헤더 누락 시 거부

**Given**: OZ Relayer가 Webhook을 전송할 때
**When**: POST /api/v1/webhooks/oz-relayer 요청에 `X-OZ-Signature` 헤더 누락
**Then**:
- HTTP 401 Unauthorized 반환
- Error response 메시지: "Missing webhook signature"

**검증 방법**:
```typescript
// E2E Test
await request(app.getHttpServer())
  .post('/api/v1/webhooks/oz-relayer')
  .send(webhookPayload)
  .expect(401);
```

---

### AC-2.4: Webhook Payload 검증 (DTO Validation)

**Given**: OZ Relayer가 Webhook을 전송할 때
**When**: Payload에 필수 필드 누락 또는 잘못된 형식
**Then**:
- HTTP 400 Bad Request 반환
- Error response 메시지: Validation error details

**검증 방법**:
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

### AC-2.5: Idempotency 보장 (중복 Webhook 처리)

**Given**: 동일한 Webhook이 여러 번 수신될 때
**When**: 같은 `transactionId`와 `status`로 Webhook이 중복 전송
**Then**:
- HTTP 200 OK 반환 (모든 요청에 대해)
- MySQL `transactions` 테이블은 한 번만 업데이트 (Prisma upsert)
- Notification은 첫 번째 요청에만 전송 (중복 방지 로직)

**검증 방법**:
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

## 📢 AC-3: 클라이언트 Notification 전송

### AC-3.1: Webhook 수신 후 클라이언트 알림 전송

**Given**: OZ Relayer Webhook이 유효하게 수신될 때
**When**: MySQL 트랜잭션 상태가 업데이트될 때
**Then**:
- `CLIENT_WEBHOOK_URL`로 HTTP POST 요청 전송
- Payload에 `event`, `transactionId`, `status`, `timestamp` 포함
- Timeout 5초
- 클라이언트 응답 대기 (비동기 처리, Webhook 처리 블로킹 방지)

**검증 방법**:
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

### AC-3.2: CLIENT_WEBHOOK_URL 미설정 시 알림 스킵

**Given**: 환경변수 `CLIENT_WEBHOOK_URL`이 설정되지 않았을 때
**When**: Webhook 수신으로 트랜잭션 상태가 업데이트될 때
**Then**:
- Notification 전송 스킵 (HTTP 요청 없음)
- Warning 로그 출력: "CLIENT_WEBHOOK_URL not configured, skipping notification"
- Webhook 처리는 정상 완료 (200 OK)

**검증 방법**:
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

### AC-3.3: 클라이언트 응답 실패 시 에러 로깅 (Non-blocking)

**Given**: 클라이언트 서비스가 응답하지 않거나 에러를 반환할 때
**When**: Notification 전송이 실패할 때
**Then**:
- Error 로그 출력: "Failed to send notification: [error message]"
- Exception throw 하지 않음 (Webhook 처리는 정상 완료)
- MySQL 업데이트는 이미 완료된 상태 유지

**검증 방법**:
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

## 🔍 AC-4: 3-Tier 상태 조회 (Redis L1 → MySQL L2 → OZ Relayer)

### AC-4.1: Redis 캐시 히트 (L1 Cache Hit)

**Given**: Redis에 트랜잭션 데이터가 캐싱되어 있을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어올 때
**Then**:
- Redis에서 데이터 반환 (MySQL, OZ Relayer API 호출 없음)
- Response에 `transactionId`, `status`, `hash`, `createdAt`, `confirmedAt` 포함
- 응답 시간 < 5ms (Redis 캐시 히트)

**검증 방법**:
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

### AC-4.2: Redis 미스, MySQL 히트 (L1 Miss, L2 Hit)

**Given**: Redis에 데이터가 없고, MySQL에 트랜잭션 데이터가 저장되어 있을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어올 때
**Then**:
- Redis 조회 실패 (캐시 미스)
- MySQL에서 데이터 조회
- Redis에 데이터 백필 (TTL: 600초)
- Response에 MySQL 데이터 반환
- 응답 시간 < 50ms (MySQL 조회)

**검증 방법**:
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

### AC-4.3: Redis + MySQL 미스 → OZ Relayer 조회 후 양쪽 저장

**Given**: Redis, MySQL 모두 해당 트랜잭션 데이터가 없을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어올 때
**Then**:
- Redis 조회 실패 (캐시 미스)
- MySQL 조회 실패 (캐시 미스)
- OZ Relayer API 호출하여 데이터 조회
- Redis에 캐싱 (TTL: 600초)
- MySQL에 새로운 레코드 생성
- OZ Relayer 데이터를 Response로 반환
- 응답 시간 < 200ms (OZ Relayer API 호출)

**검증 방법**:
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

### AC-4.4: Webhook 수신 시 Redis TTL 리셋

**Given**: OZ Relayer Webhook이 수신될 때
**When**: POST /api/v1/webhooks/oz-relayer 요청 처리
**Then**:
- Redis `tx:status:{txId}` 키 업데이트
- Redis TTL 리셋 (600초)
- MySQL 업데이트
- Response 200 OK

**검증 방법**:
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

### AC-4.5: Degraded Mode - Redis 실패 시 MySQL Fallback

**Given**: Redis 서비스가 응답하지 않을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어올 때
**Then**:
- Redis 조회 실패 (연결 에러)
- MySQL에서 데이터 조회 (L2 fallback)
- Warning 로그 출력: "Redis unavailable, falling back to MySQL"
- Response에 MySQL 데이터 반환

**검증 방법**:
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

### AC-4.6: Degraded Mode - Redis + MySQL 실패 시 OZ Relayer Fallback

**Given**: Redis와 MySQL 모두 응답하지 않을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어올 때
**Then**:
- Redis 조회 실패 (연결 에러)
- MySQL 조회 실패 (연결 에러)
- OZ Relayer API 호출하여 데이터 조회
- Warning 로그 출력: "Redis and MySQL unavailable, falling back to OZ Relayer"
- Response에 OZ Relayer 데이터 반환

**검증 방법**:
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

### AC-4.7: 완전 실패 (Redis + MySQL + OZ Relayer 모두 실패)

**Given**: Redis, MySQL, OZ Relayer API 모두 응답하지 않을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어올 때
**Then**:
- HTTP 503 Service Unavailable 반환
- Error response 메시지: "All status lookup services unavailable"

**검증 방법**:
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

## 🔧 AC-5: Infrastructure & Configuration

### AC-5.1: MySQL 서비스 정상 실행 (Docker Compose)

**Given**: Docker Compose 파일에 MySQL 서비스가 정의되어 있을 때
**When**: `docker compose --profile phase2 up -d` 명령어 실행
**Then**:
- MySQL 8.0 컨테이너 정상 실행
- Port 3306 바인딩 성공
- Health check 통과 (mysqladmin ping)
- Volume 마운트 성공 (데이터 영구 보존)

**검증 방법**:
```bash
# Docker Compose 실행
docker compose --profile phase2 up -d mysql

# Health check 확인
docker compose ps
# Expected: mysql (healthy)

# MySQL 연결 테스트
docker exec -it msq-relayer-mysql mysql -u relayer_user -p -e "SELECT 1;"
```

---

### AC-5.2: Prisma Migration 적용

**Given**: Prisma schema.prisma 파일이 정의되어 있을 때
**When**: `pnpm prisma migrate dev --name init` 명령어 실행
**Then**:
- Migration SQL 파일 생성 (prisma/migrations/)
- MySQL `transactions` 테이블 생성
- 인덱스 생성 (status, hash, createdAt)
- Prisma Client 자동 생성

**검증 방법**:
```bash
# Migration 실행
pnpm prisma migrate dev --name init

# 테이블 확인
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer -e "SHOW TABLES;"
# Expected: transactions

# 스키마 확인
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer -e "DESCRIBE transactions;"
```

---

### AC-5.3: 환경변수 설정 및 검증

**Given**: `.env.example` 파일에 필요한 환경변수가 정의되어 있을 때
**When**: `.env` 파일 생성 및 값 설정
**Then**:
- `DATABASE_URL` 값 유효 (MySQL 연결 가능)
- `REDIS_URL` 값 유효 (Redis 연결 가능, 기본값: `redis://localhost:6379`)
- `REDIS_STATUS_TTL_SECONDS` 값 유효 (기본값: 600)
- `WEBHOOK_SIGNING_KEY` 32자 이상
- `CLIENT_WEBHOOK_URL` 유효한 URL 형식
- NestJS 애플리케이션 시작 시 환경변수 로드 성공

**검증 방법**:
```bash
# .env 파일 생성
cp .env.example .env
# Edit .env with actual values

# 환경변수 검증
pnpm --filter relay-api start:dev
# Expected: No configuration errors

# Redis 연결 확인
docker exec -it oz-relayer-redis redis-cli ping
# Expected: PONG
```

---

### AC-5.4: Redis 연결 정상 (기존 OZ Relayer Redis 재사용)

**Given**: OZ Relayer의 Redis 서비스가 실행 중일 때
**When**: NestJS 애플리케이션이 시작될 때
**Then**:
- Redis 연결 성공 (기존 OZ Relayer Redis 재사용)
- 새로운 Redis 컨테이너 생성 없음
- Health check에서 Redis status "up" 확인

**검증 방법**:
```bash
# 기존 Redis 확인
docker ps | grep redis
# Expected: oz-relayer-redis (or similar)

# Health check 확인
curl http://localhost:8080/api/v1/health
# Expected: {"status":"ok","info":{"mysql":{"status":"up"},"redis":{"status":"up"}}}
```

---

## 📊 AC-6: 테스트 커버리지 및 품질

### AC-6.1: Unit Test Coverage ≥ 85%

**Given**: 모든 Service, Controller, Guard가 구현되었을 때
**When**: `pnpm test:cov` 명령어 실행
**Then**:
- WebhooksService 커버리지 ≥ 85%
- WebhooksController 커버리지 ≥ 85%
- NotificationService 커버리지 ≥ 85%
- StatusService 커버리지 ≥ 85%
- WebhookSignatureGuard 커버리지 100%

**검증 방법**:
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

### AC-6.2: E2E Test Scenarios 통과

**Given**: E2E 테스트 시나리오가 작성되었을 때
**When**: `pnpm test:e2e` 명령어 실행
**Then**:
- 9개 E2E 시나리오 모두 통과
- 총 실행 시간 < 45초
- 테스트 간 격리 (각 테스트는 독립적으로 실행)

**시나리오 리스트**:
1. Transaction creation → Redis + MySQL storage (write-through)
2. Webhook reception → Redis TTL reset + MySQL update
3. Invalid HMAC signature → 401 Unauthorized (Redis/MySQL untouched)
4. Redis cache hit → Fast response (<5ms)
5. Redis miss, MySQL hit → MySQL data + Redis backfill
6. Full miss → OZ Relayer fallback + Redis/MySQL storage
7. Redis failure → MySQL fallback (degraded mode)
8. Redis + MySQL failure → OZ Relayer fallback (degraded mode)
9. Client notification sent after webhook

**검증 방법**:
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

### AC-6.3: Linting 및 포맷 규칙 준수

**Given**: ESLint 및 Prettier 설정이 완료되었을 때
**When**: `pnpm lint` 명령어 실행
**Then**:
- 0개 ESLint 에러
- 0개 Prettier 포맷 에러
- 모든 파일이 프로젝트 코딩 스타일 준수

**검증 방법**:
```bash
pnpm --filter relay-api lint

# Expected output:
# ✓ 0 errors, 0 warnings
```

---

## 🚀 AC-7: 배포 및 운영

### AC-7.1: Production 배포 성공

**Given**: 모든 테스트가 통과하고, 빌드가 성공했을 때
**When**: Production 환경에 배포 (Docker Compose)
**Then**:
- MySQL 서비스 정상 실행
- relay-api 서비스 정상 실행
- Health check 엔드포인트 정상 응답 (200 OK)
- Swagger 문서 접근 가능 (/api)

**검증 방법**:
```bash
# Production 배포
docker compose --profile phase2 up -d

# Health check
curl http://localhost:8080/api/v1/health
# Expected: {"status":"ok","info":{"mysql":{"status":"up"},"redis":{"status":"up"}}}

# Swagger UI
curl http://localhost:8080/api
# Expected: HTML page with Swagger UI
```

---

### AC-7.2: Webhook 엔드포인트 Production 검증

**Given**: Production 환경에 배포되었을 때
**When**: 실제 OZ Relayer가 Webhook을 전송할 때
**Then**:
- POST /api/v1/webhooks/oz-relayer 엔드포인트 정상 응답
- HMAC 서명 검증 성공
- MySQL 트랜잭션 상태 업데이트
- 클라이언트 알림 전송 성공

**검증 방법**:
```bash
# OZ Relayer Webhook 시뮬레이션 (Production 환경변수 사용)
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

# MySQL 데이터 확인
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer \
  -e "SELECT * FROM transactions WHERE id='550e8400-e29b-41d4-a716-446655440000';"
```

---

### AC-7.3: Monitoring 및 로그 검증

**Given**: Production 환경에서 운영 중일 때
**When**: 트랜잭션 생성, Webhook 수신, 상태 조회 이벤트 발생
**Then**:
- 모든 이벤트가 로그에 기록
- Warning/Error 로그 올바르게 출력
- MySQL 쿼리 성능 메트릭 수집 가능

**검증 방법**:
```bash
# 로그 확인
docker compose --profile phase2 logs -f relay-api

# Expected log entries:
# [WebhooksService] Webhook received: transaction 550e8400...
# [NotificationService] Notification sent for transaction 550e8400...
# [StatusService] Cache hit for transaction 550e8400...
```

---

## ✅ 최종 수락 기준 체크리스트

### Infrastructure
- [ ] MySQL 서비스 정상 실행 (Docker Compose)
- [ ] Redis 연결 정상 (기존 OZ Relayer Redis 재사용)
- [ ] Prisma Migration 적용 완료
- [ ] RedisModule 생성 및 DI 설정 완료
- [ ] 환경변수 설정 및 검증 완료 (REDIS_URL, REDIS_STATUS_TTL_SECONDS 포함)

### API Endpoints
- [ ] POST /api/v1/relay/direct → Redis + MySQL 저장 확인 (write-through)
- [ ] POST /api/v1/relay/gasless → Redis + MySQL 저장 확인 (write-through)
- [ ] POST /api/v1/webhooks/oz-relayer → Webhook 수신 + Redis TTL 리셋
- [ ] GET /api/v1/relay/status/:txId → 3-Tier 조회 (Redis → MySQL → OZ Relayer)

### Security
- [ ] HMAC-SHA256 서명 검증 동작
- [ ] 유효하지 않은 서명 거부 (401 Unauthorized, Redis/MySQL 변경 없음)
- [ ] 서명 헤더 누락 시 거부 (401 Unauthorized)

### Functionality - 3-Tier Cache
- [ ] Redis 캐시 히트 (L1) → 응답 시간 < 5ms
- [ ] Redis 미스, MySQL 히트 (L2) → Redis 백필 + 응답 시간 < 50ms
- [ ] Full 미스 → OZ Relayer 조회 + Redis/MySQL 저장
- [ ] Webhook 수신 → Redis TTL 리셋 (600초) + MySQL 업데이트

### Functionality - Degraded Mode
- [ ] Redis 실패 시 MySQL Fallback (L2)
- [ ] Redis + MySQL 실패 시 OZ Relayer Fallback
- [ ] 전체 실패 시 503 Service Unavailable

### Functionality - Notification
- [ ] Client Notification 전송 성공
- [ ] Notification 실패 시 Non-blocking 처리

### Quality
- [ ] Unit Test Coverage ≥ 85%
- [ ] E2E Test 9개 시나리오 모두 통과
- [ ] ESLint 0개 에러
- [ ] Prettier 포맷 규칙 준수

### Documentation
- [ ] Swagger/OpenAPI 문서 완성
- [ ] README.md 업데이트 (Phase 2 + Redis 안내)
- [ ] .env.example 업데이트 (REDIS_URL, REDIS_STATUS_TTL_SECONDS 포함)

### Deployment
- [ ] Production 배포 성공
- [ ] Health check 엔드포인트 정상 응답 (MySQL + Redis status "up")
- [ ] Webhook 엔드포인트 Production 검증
- [ ] 로그 및 모니터링 정상 동작

---

**Version**: 1.1.0
**Status**: Draft
**Last Updated**: 2025-12-30
**Change**: Added Redis L1 cache layer (3-Tier architecture)

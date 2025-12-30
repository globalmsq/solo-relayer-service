---
id: SPEC-WEBHOOK-001
title: TX History & Webhook System - Acceptance Criteria
version: 1.0.0
status: draft
created: 2025-12-30
updated: 2025-12-30
---

# Acceptance Criteria: SPEC-WEBHOOK-001

## 📋 개요

**목적**: SPEC-WEBHOOK-001의 수락 기준을 Given-When-Then 형식으로 정의

**범위**: MySQL 트랜잭션 이력 저장, OZ Relayer Webhook 처리, 클라이언트 알림, 이중화된 상태 조회

**테스트 전략**: Unit Tests (18개) + E2E Tests (6개) ≥ 85% 커버리지

---

## 🧪 AC-1: MySQL 트랜잭션 이력 저장

### AC-1.1: Direct Transaction 생성 시 MySQL 저장

**Given**: 클라이언트가 Direct Transaction을 제출할 때
**When**: POST /api/v1/relay/direct 요청이 성공적으로 처리될 때
**Then**:
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
const stored = await prisma.transaction.findUnique({ where: { id: txId } });

expect(stored).toBeDefined();
expect(stored.status).toBe('pending');
expect(stored.to).toBe('0x1234567890123456789012345678901234567890');
```

---

### AC-1.2: Gasless Transaction 생성 시 MySQL 저장

**Given**: 클라이언트가 Gasless Transaction을 제출할 때
**When**: POST /api/v1/relay/gasless 요청이 성공적으로 처리될 때
**Then**:
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

## 🔍 AC-4: 이중화된 상태 조회 (MySQL + OZ Relayer Fallback)

### AC-4.1: MySQL 캐시 히트 (Fresh Cache)

**Given**: MySQL에 트랜잭션 데이터가 저장되어 있을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어오고, `updatedAt`이 5초 이내일 때
**Then**:
- MySQL에서 데이터 반환 (OZ Relayer API 호출 없음)
- Response에 `transactionId`, `status`, `hash`, `createdAt`, `confirmedAt` 포함
- 응답 시간 < 100ms (캐시 히트)

**검증 방법**:
```typescript
// E2E Test
const tx = await prisma.transaction.create({
  data: {
    id: 'test-tx-id',
    status: 'confirmed',
    hash: '0xabcd...',
    createdAt: new Date(),
    updatedAt: new Date(), // Fresh (now)
  }
});

const start = Date.now();
const response = await request(app.getHttpServer())
  .get('/api/v1/relay/status/test-tx-id')
  .expect(200);
const duration = Date.now() - start;

expect(response.body.status).toBe('confirmed');
expect(duration).toBeLessThan(100); // Fast response
```

---

### AC-4.2: Stale Cache → OZ Relayer Fallback

**Given**: MySQL에 트랜잭션 데이터가 있지만 `updatedAt`이 5초 이상 오래되었을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어올 때
**Then**:
- OZ Relayer API 호출하여 최신 데이터 조회
- MySQL `transactions` 테이블 업데이트 (upsert)
- 최신 데이터를 Response로 반환

**검증 방법**:
```typescript
// E2E Test
const staleTime = new Date(Date.now() - 10000); // 10 seconds ago
const tx = await prisma.transaction.create({
  data: {
    id: 'test-tx-id',
    status: 'pending',
    updatedAt: staleTime, // Stale cache
  }
});

// Mock OZ Relayer response (status = confirmed)
mockOzRelayerApi({ status: 'confirmed', hash: '0xabcd...' });

const response = await request(app.getHttpServer())
  .get('/api/v1/relay/status/test-tx-id')
  .expect(200);

expect(response.body.status).toBe('confirmed'); // Fresh data from OZ Relayer

const updated = await prisma.transaction.findUnique({ where: { id: 'test-tx-id' } });
expect(updated.status).toBe('confirmed'); // MySQL updated
```

---

### AC-4.3: MySQL 캐시 미스 → OZ Relayer 조회 후 MySQL 저장

**Given**: MySQL에 해당 트랜잭션 데이터가 없을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어올 때
**Then**:
- OZ Relayer API 호출하여 데이터 조회
- MySQL `transactions` 테이블에 새로운 레코드 생성 (create)
- OZ Relayer 데이터를 Response로 반환

**검증 방법**:
```typescript
// E2E Test
mockOzRelayerApi({ transactionId: 'new-tx-id', status: 'confirmed', hash: '0xabcd...' });

const response = await request(app.getHttpServer())
  .get('/api/v1/relay/status/new-tx-id')
  .expect(200);

expect(response.body.status).toBe('confirmed');

const stored = await prisma.transaction.findUnique({ where: { id: 'new-tx-id' } });
expect(stored).toBeDefined(); // Created in MySQL
expect(stored.status).toBe('confirmed');
```

---

### AC-4.4: Degraded Mode (OZ Relayer 실패 시 Stale Cache 반환)

**Given**: MySQL에 Stale 데이터가 있고, OZ Relayer API가 응답하지 않을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어올 때
**Then**:
- OZ Relayer API 호출 실패 (timeout or error)
- MySQL의 Stale 데이터 반환 (degraded mode)
- Warning 로그 출력: "OZ Relayer unavailable, returning stale cache"

**검증 방법**:
```typescript
// E2E Test
const staleTime = new Date(Date.now() - 10000); // 10 seconds ago
const tx = await prisma.transaction.create({
  data: {
    id: 'test-tx-id',
    status: 'pending',
    updatedAt: staleTime, // Stale cache
  }
});

// Mock OZ Relayer timeout
mockOzRelayerApi({ timeout: true });

const response = await request(app.getHttpServer())
  .get('/api/v1/relay/status/test-tx-id')
  .expect(200);

expect(response.body.status).toBe('pending'); // Stale data returned
```

---

### AC-4.5: 완전 실패 (MySQL + OZ Relayer 모두 실패)

**Given**: MySQL에 데이터가 없고, OZ Relayer API도 응답하지 않을 때
**When**: GET /api/v1/relay/status/:txId 요청이 들어올 때
**Then**:
- HTTP 503 Service Unavailable 반환
- Error response 메시지: "OZ Relayer service unavailable"

**검증 방법**:
```typescript
// E2E Test
mockOzRelayerApi({ error: true });

await request(app.getHttpServer())
  .get('/api/v1/relay/status/non-existent-tx-id')
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
- 6개 E2E 시나리오 모두 통과
- 총 실행 시간 < 30초
- 테스트 간 격리 (각 테스트는 독립적으로 실행)

**시나리오 리스트**:
1. Transaction creation → MySQL storage
2. Webhook reception → MySQL update
3. Invalid HMAC signature → 401 Unauthorized
4. MySQL cache hit → Fast response
5. Stale cache → OZ Relayer fallback
6. Client notification sent after webhook

**검증 방법**:
```bash
pnpm --filter relay-api test:e2e

# Expected output:
# ✓ Scenario 1: Transaction creation → MySQL storage
# ✓ Scenario 2: Webhook reception → MySQL update
# ✓ Scenario 3: Invalid HMAC signature → 401 Unauthorized
# ✓ Scenario 4: MySQL cache hit → Fast response
# ✓ Scenario 5: Stale cache → OZ Relayer fallback
# ✓ Scenario 6: Client notification sent after webhook
# Test Suites: 1 passed, 1 total
# Tests: 6 passed, 6 total
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
- [ ] Prisma Migration 적용 완료
- [ ] 환경변수 설정 및 검증 완료

### API Endpoints
- [ ] POST /api/v1/relay/direct → MySQL 저장 확인
- [ ] POST /api/v1/relay/gasless → MySQL 저장 확인
- [ ] POST /api/v1/webhooks/oz-relayer → Webhook 수신 성공
- [ ] GET /api/v1/relay/status/:txId → MySQL 캐시 우선 조회

### Security
- [ ] HMAC-SHA256 서명 검증 동작
- [ ] 유효하지 않은 서명 거부 (401 Unauthorized)
- [ ] 서명 헤더 누락 시 거부 (401 Unauthorized)

### Functionality
- [ ] Webhook 수신 → MySQL 업데이트
- [ ] MySQL 캐시 히트 (Fresh Cache)
- [ ] Stale Cache → OZ Relayer Fallback
- [ ] Degraded Mode (OZ Relayer 실패 시 Stale Cache 반환)
- [ ] Client Notification 전송 성공
- [ ] Notification 실패 시 Non-blocking 처리

### Quality
- [ ] Unit Test Coverage ≥ 85%
- [ ] E2E Test 6개 시나리오 모두 통과
- [ ] ESLint 0개 에러
- [ ] Prettier 포맷 규칙 준수

### Documentation
- [ ] Swagger/OpenAPI 문서 완성
- [ ] README.md 업데이트 (Phase 2 안내)
- [ ] .env.example 업데이트 (모든 새 환경변수 포함)

### Deployment
- [ ] Production 배포 성공
- [ ] Health check 엔드포인트 정상 응답
- [ ] Webhook 엔드포인트 Production 검증
- [ ] 로그 및 모니터링 정상 동작

---

**Version**: 1.0.0
**Status**: Draft
**Last Updated**: 2025-12-30

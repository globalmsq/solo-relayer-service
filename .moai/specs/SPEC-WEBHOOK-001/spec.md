---
id: SPEC-WEBHOOK-001
title: TX History & Webhook System - Redis L1 + MySQL L2 + OZ Relayer Webhook
version: 1.1.0
status: draft
author: "@user"
created: 2025-12-30
updated: 2025-12-30
priority: high
dependencies:
  - SPEC-TEST-001
related_tasks:
  - task-14
tags:
  - webhook
  - mysql
  - prisma
  - transaction-history
  - phase-2
---

# SPEC-WEBHOOK-001: TX History & Webhook System

## HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-30 | @user | Initial SPEC creation - MySQL + Webhook architecture |
| 1.1.0 | 2025-12-30 | @user | Redis L1 cache addition - 3-Tier architecture (Redis -> MySQL -> OZ Relayer), env var REDIS_STATUS_TTL_SECONDS, performance optimization (cache hit response time <5ms) |

## Overview

| Field | Value |
|-------|-------|
| **SPEC ID** | SPEC-WEBHOOK-001 |
| **Title** | TX History & Webhook System - Redis L1 + MySQL L2 + OZ Relayer Webhook |
| **Status** | Draft |
| **Created** | 2025-12-30 |
| **Updated** | 2025-12-30 |
| **Dependencies** | SPEC-TEST-001 (Task #11) |
| **Related Tasks** | Task #14 |

## 문제 정의

Phase 1에서는 트랜잭션 상태를 OZ Relayer API를 통해 폴링 방식으로 조회했습니다. Phase 2에서는 다음과 같은 요구사항이 추가됩니다:

1. **트랜잭션 이력 저장**: 모든 트랜잭션을 MySQL 데이터베이스에 저장하여 영구 보관
2. **Webhook 콜백**: OZ Relayer가 트랜잭션 상태 변경 시 우리 서비스에 알림 전송
3. **클라이언트 알림**: 상태 변경 시 클라이언트 서비스에 실시간 알림 전송
4. **이중화된 상태 조회**: MySQL 우선 조회, 실패 시 OZ Relayer API fallback

**핵심 문제**:
- Phase 1 폴링 방식은 실시간성 부족 및 API 호출 비용 증가
- 트랜잭션 이력이 OZ Relayer에만 존재하여 서비스 종속성 증가
- 클라이언트가 상태 변경을 감지하기 위해 지속적인 폴링 필요

## 솔루션

### 핵심 아키텍처 (3-Tier Cache)

```
┌─────────────┐    webhook     ┌──────────────────────┐
│ OZ Relayer  │ ─────────────► │ WebhookController    │
└─────────────┘                └──────────┬───────────┘
                                          │
                               ┌──────────┴───────────┐
                               │  WebhookService      │
                               └──────────┬───────────┘
                                          │
                      ┌───────────────────┼───────────────────┐
                      ▼                   ▼                   ▼
           ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
           │   Redis (L1)    │ │   MySQL (L2)    │ │  Notification   │
           │  10min TTL      │ │  Permanent      │ │  Service        │
           └────────┬────────┘ └─────────────────┘ └─────────────────┘
                    │
           ┌────────┴────────┐
           │  StatusService  │ ◄── 3-Tier Lookup
           │  Redis→MySQL→OZ │
           └─────────────────┘
```

**Data Flow**:
```
StatusService → Redis (10min TTL, L1) → MySQL (L2, Permanent) → OZ Relayer API (Fallback)
```

### 주요 컴포넌트

**1. Redis (L1 Cache)**
- 빠른 상태 조회 (응답시간 <5ms)
- 10분 TTL (환경변수로 설정 가능)
- Key pattern: `tx:status:{txId}`
- 기존 OZ Relayer용 Redis 인스턴스 공유

**2. MySQL + Prisma ORM (L2 Persistent Storage)**
- 트랜잭션 이력 영구 저장
- 트랜잭션 상태 변경 추적
- 검색 및 분석을 위한 인덱스 최적화

**3. Webhook Module**
- OZ Relayer로부터 상태 변경 수신
- HMAC-SHA256 서명 검증 (보안)
- Redis + MySQL 동시 업데이트
- TTL 리셋 on every status update

**4. Notification Service**
- 상태 변경 이벤트를 클라이언트 서비스에 전달
- 비동기 알림 처리 (Phase 2: HTTP, Phase 3+: Queue)

**5. StatusService 확장 (3-Tier Lookup)**
- Tier 1: Redis 조회 (L1 Cache, ~1-5ms)
- Tier 2: MySQL 조회 (L2 Persistent, ~50ms)
- Tier 3: OZ Relayer API fallback (~200ms)

## 기능 요구사항 (EARS Format)

### U-WEBHOOK-001: 트랜잭션 이력 저장 (Ubiquitous)
**조건**: 모든 트랜잭션이 `/api/v1/relay/direct` 또는 `/api/v1/relay/gasless`를 통해 제출될 때
**시스템은**: 트랜잭션 메타데이터(ID, hash, status, from, to, value, createdAt)를 MySQL에 저장해야 한다

### E-WEBHOOK-002: Webhook 수신 (Event-driven)
**조건**: OZ Relayer가 트랜잭션 상태 변경 시 webhook을 전송할 때
**시스템은**: HMAC-SHA256 서명을 검증하고, 유효한 경우 MySQL의 트랜잭션 상태를 업데이트해야 한다

### E-WEBHOOK-003: 클라이언트 알림 (Event-driven)
**조건**: MySQL의 트랜잭션 상태가 업데이트될 때
**시스템은**: 등록된 클라이언트 서비스에 상태 변경 알림을 전송해야 한다

### S-WEBHOOK-004: 상태 조회 3-Tier Lookup (State-driven)
**조건**: StatusService가 트랜잭션 상태 조회 요청을 받을 때
**시스템은**: Redis(L1)를 우선 조회하고, 캐시 미스 시 MySQL(L2)을 조회하며, MySQL에도 없는 경우 OZ Relayer API로 fallback해야 한다

### NFR-PERF-001: Redis L1 Cache Performance (Non-Functional)
**조건**: Redis 캐시 히트 시
**시스템은**: 응답 시간 5ms 미만으로 트랜잭션 상태를 반환해야 한다
- Redis TTL: 600초 (10분, 환경변수 `REDIS_STATUS_TTL_SECONDS`로 설정 가능)
- Expected cache hit rate: hot window 내 95% 이상
- Key pattern: `tx:status:{txId}`

### NFR-PERF-002: Cache Write-Through (Non-Functional)
**조건**: Webhook을 통해 상태 업데이트가 수신될 때
**시스템은**: Redis(L1)와 MySQL(L2)을 동시에 업데이트하고, Redis TTL을 리셋해야 한다

### U-WEBHOOK-005: HMAC 서명 검증 (Unwanted)
**조건**: Webhook 요청이 수신될 때
**시스템은**: HMAC-SHA256 서명이 검증되지 않은 요청을 절대 처리하지 않아야 한다

## 기술 요구사항

### T-WEBHOOK-001: MySQL + Prisma 스택
- **MySQL 8.0**: Docker Compose 서비스
- **Prisma ORM 5.x**: TypeScript 타입 안전성
- **Schema 설계**:
  ```prisma
  model Transaction {
    id            String    @id @default(uuid())
    hash          String?   @unique
    status        String    // pending, sent, submitted, inmempool, mined, confirmed, failed
    from          String?
    to            String?
    value         String?
    data          String?   @db.Text
    createdAt     DateTime  @default(now())
    updatedAt     DateTime  @updatedAt
    confirmedAt   DateTime?

    @@index([status])
    @@index([hash])
    @@index([createdAt])
  }
  ```

### T-WEBHOOK-002: Webhook 엔드포인트
- **경로**: `POST /api/v1/webhooks/oz-relayer`
- **인증**: HMAC-SHA256 서명 검증
- **Payload 구조**:
  ```typescript
  interface OzRelayerWebhookPayload {
    transactionId: string;
    hash: string | null;
    status: string;
    from?: string;
    to?: string;
    value?: string;
    createdAt: string;
    confirmedAt?: string;
  }
  ```
- **서명 검증 알고리즘**:
  ```typescript
  // Option B: OZ Relayer signs, we verify
  const signature = request.headers['x-oz-signature'];
  const payload = JSON.stringify(request.body);
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SIGNING_KEY)
    .update(payload)
    .digest('hex');

  if (signature !== expectedSignature) {
    throw new UnauthorizedException('Invalid webhook signature');
  }
  ```

### T-WEBHOOK-003: WebhookSignatureGuard 구현
- **타입**: NestJS Guard
- **위치**: `src/webhooks/guards/webhook-signature.guard.ts`
- **코드 길이**: 약 3줄 (핵심 검증 로직)
- **기능**: HMAC-SHA256 서명 검증 자동화

### T-WEBHOOK-004: Notification Service
- **Phase 2**: HTTP POST 방식 알림
- **Phase 3+**: BullMQ/SQS Queue 기반 (확장성 고려)
- **알림 대상**: 환경변수 `CLIENT_WEBHOOK_URL`로 구성
- **Payload**:
  ```typescript
  interface NotificationPayload {
    event: 'transaction.status.updated';
    transactionId: string;
    status: string;
    timestamp: string;
  }
  ```

### T-WEBHOOK-005: StatusService 확장 (3-Tier Lookup)
**기존 동작** (Phase 1):
```typescript
// Direct HTTP call to OZ Relayer
const response = await this.httpService.get(ozRelayerUrl);
return response.data;
```

**새로운 동작** (Phase 2 - 3-Tier Lookup):
```typescript
async getTransactionStatus(txId: string): Promise<TxStatusResponseDto> {
  // Tier 1: Redis (L1) - ~1-5ms
  const cached = await this.redis.get(`tx:status:${txId}`);
  if (cached) {
    return JSON.parse(cached);
  }

  // Tier 2: MySQL (L2) - ~50ms
  const stored = await this.prisma.transaction.findUnique({ where: { id: txId } });
  if (stored) {
    await this.cacheToRedis(txId, stored);
    return this.transformToDto(stored);
  }

  // Tier 3: OZ Relayer API - ~200ms
  const fresh = await this.fetchFromOzRelayer(txId);

  // Save to both L1 (Redis) and L2 (MySQL)
  await Promise.all([
    this.cacheToRedis(txId, fresh),
    this.prisma.transaction.create({ data: fresh })
  ]);

  return fresh;
}

private async cacheToRedis(txId: string, data: any): Promise<void> {
  const ttl = this.configService.get('REDIS_STATUS_TTL_SECONDS', 600);
  await this.redis.setex(`tx:status:${txId}`, ttl, JSON.stringify(data));
}
```

### T-WEBHOOK-005a: Webhook Handler Redis Update
**WebhookService의 handleWebhook 메서드**:
```typescript
async handleWebhook(event: WebhookEvent): Promise<void> {
  const { txId, status, hash } = event;

  // Update MySQL (L2 - permanent)
  const updated = await this.prisma.transaction.update({
    where: { id: txId },
    data: { status, hash, updatedAt: new Date() },
  });

  // Update Redis (L1 - cache) with TTL reset
  await this.cacheToRedis(txId, updated);

  // Notify clients
  await this.notificationService.notify(txId, status);
}
```

### T-WEBHOOK-006: Docker Compose 구성
**새로운 서비스 추가**:
```yaml
services:
  mysql:
    image: mysql:8.0
    profiles: ["phase2"]
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: msq_relayer
      MYSQL_USER: relayer_user
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    volumes:
      - msq-relayer-mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - msq-relayer-network

volumes:
  msq-relayer-mysql-data:
    driver: local
```

### T-WEBHOOK-007: 환경변수 설정
```bash
# MySQL 연결
DATABASE_URL="mysql://relayer_user:${MYSQL_PASSWORD}@mysql:3306/msq_relayer"
MYSQL_ROOT_PASSWORD=secure-root-password
MYSQL_PASSWORD=secure-user-password

# Redis L1 Cache
REDIS_URL=redis://redis:6379
REDIS_STATUS_TTL_SECONDS=600

# Webhook 서명 검증
WEBHOOK_SIGNING_KEY=your-secure-signing-key-32-characters-long

# 클라이언트 알림 (Phase 2)
CLIENT_WEBHOOK_URL=http://client-service:8080/webhooks/transaction-updates
```

### T-WEBHOOK-008: Redis Module Configuration
**relay-api에 RedisModule 설정**:
```typescript
// src/redis/redis.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        return new Redis(configService.get('REDIS_URL', 'redis://localhost:6379'));
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
```

**Note**: 기존 OZ Relayer용 Redis 인스턴스를 공유하므로 새로운 Redis 컨테이너는 필요하지 않습니다.

## 아키텍처 설계

### 모듈 구조
```
packages/relay-api/src/
├── redis/
│   └── redis.module.ts                    # Redis (L1) Module
├── webhooks/
│   ├── dto/
│   │   ├── oz-relayer-webhook.dto.ts      # Webhook payload DTO
│   │   └── notification.dto.ts            # 클라이언트 알림 DTO
│   ├── guards/
│   │   └── webhook-signature.guard.ts     # HMAC 서명 검증 Guard
│   ├── webhooks.controller.ts             # POST /webhooks/oz-relayer
│   ├── webhooks.service.ts                # Webhook 처리 로직 + Redis 업데이트
│   ├── notification.service.ts            # 클라이언트 알림 전송
│   ├── webhooks.module.ts                 # Webhook 모듈
│   ├── webhooks.controller.spec.ts        # Controller 테스트
│   ├── webhooks.service.spec.ts           # Service 테스트
│   └── notification.service.spec.ts       # Notification 테스트
├── prisma/
│   ├── schema.prisma                      # Prisma 스키마
│   └── migrations/                        # Prisma 마이그레이션
├── relay/
│   ├── status/
│   │   └── status.service.ts              # 3-Tier Lookup (Redis → MySQL → OZ Relayer)
│   ├── direct/
│   │   └── direct.service.ts              # 트랜잭션 생성 시 Redis + MySQL 저장
│   └── gasless/
│       └── gasless.service.ts             # 트랜잭션 생성 시 Redis + MySQL 저장
```

### API 엔드포인트 변경사항

**새로운 엔드포인트**:
- `POST /api/v1/webhooks/oz-relayer` - OZ Relayer webhook 수신

**기존 엔드포인트 동작 변경**:
- `POST /api/v1/relay/direct` - Redis(L1) + MySQL(L2)에 트랜잭션 저장
- `POST /api/v1/relay/gasless` - Redis(L1) + MySQL(L2)에 트랜잭션 저장
- `GET /api/v1/relay/status/:txId` - 3-Tier Lookup (Redis → MySQL → OZ Relayer)

### 데이터 흐름

**트랜잭션 생성 흐름**:
```
1. Client → POST /api/v1/relay/direct
2. DirectService → OZ Relayer API (트랜잭션 제출)
3. DirectService → Redis (L1 캐시 저장, 10분 TTL)
4. DirectService → MySQL (L2 영구 저장)
5. Client ← Response (transactionId, status: pending)
```

**Webhook 수신 흐름**:
```
1. OZ Relayer → POST /api/v1/webhooks/oz-relayer (HMAC 서명 포함)
2. WebhookSignatureGuard → 서명 검증
3. WebhooksService → MySQL 업데이트 (status, hash, confirmedAt)
4. WebhooksService → Redis 업데이트 (TTL 리셋)
5. NotificationService → Client Service webhook (상태 변경 알림)
```

**상태 조회 흐름 (3-Tier Lookup)**:
```
1. Client → GET /api/v1/relay/status/:txId
2. StatusService → Redis 조회 (L1, ~1-5ms)
3. If Redis hit → Return from Redis (fast path)
4. If Redis miss → MySQL 조회 (L2, ~50ms)
5. If MySQL hit → Cache to Redis → Return
6. If MySQL miss → OZ Relayer API (fallback, ~200ms) → Save to Redis + MySQL → Return
```

## 테스트 전략

### Unit Tests (약 24개 테스트)

**webhooks.service.spec.ts** (8 tests):
- Webhook payload 처리 → Redis + MySQL 업데이트 성공
- 유효하지 않은 서명 → UnauthorizedException
- 존재하지 않는 트랜잭션 → NotFoundException
- 중복 webhook 수신 → Idempotency 보장
- MySQL 연결 실패 → InternalServerErrorException
- Redis 업데이트 성공 (TTL 리셋 확인)
- Redis 연결 실패 → MySQL만 업데이트 (graceful degradation)
- Notification 전송 성공

**webhooks.controller.spec.ts** (4 tests):
- POST /webhooks/oz-relayer with valid signature → 200 OK
- POST /webhooks/oz-relayer with invalid signature → 401 Unauthorized
- POST /webhooks/oz-relayer with malformed payload → 400 Bad Request
- WebhookSignatureGuard 동작 검증

**notification.service.spec.ts** (3 tests):
- HTTP POST 알림 전송 성공
- 클라이언트 서비스 응답 실패 → 재시도 로직
- 알림 payload 구조 검증

**status.service.spec.ts** (Updated, 9 tests - 3-Tier Lookup):
- Redis 캐시 히트 → MySQL/OZ Relayer 호출 없이 반환 (<5ms)
- Redis 캐시 미스 → MySQL 조회 → Redis 캐싱
- Redis + MySQL 미스 → OZ Relayer fallback → Redis + MySQL 저장
- Redis 실패 → MySQL fallback (graceful degradation)
- MySQL 실패 → OZ Relayer fallback
- OZ Relayer 실패 → MySQL 데이터 반환 (degraded mode)
- Redis + MySQL + OZ Relayer 모두 실패 → ServiceUnavailableException
- Redis TTL 설정 검증 (600초 기본값)
- Redis key pattern 검증 (`tx:status:{txId}`)

### Integration Tests (E2E, 약 9개 시나리오)

**시나리오 1: 트랜잭션 생성 및 Webhook 수신**
```typescript
// 1. 트랜잭션 제출
const tx = await POST('/api/v1/relay/direct', directTxDto);

// 2. Redis + MySQL 저장 확인
const redisCached = await redis.get(`tx:status:${tx.transactionId}`);
expect(redisCached).toBeDefined();

const stored = await prisma.transaction.findUnique({ where: { id: tx.transactionId } });
expect(stored.status).toBe('pending');

// 3. Webhook 시뮬레이션 (OZ Relayer가 confirmed 전송)
await POST('/api/v1/webhooks/oz-relayer', {
  transactionId: tx.transactionId,
  status: 'confirmed',
  hash: '0xabcd...',
}, { headers: { 'x-oz-signature': validSignature } });

// 4. Redis + MySQL 업데이트 확인
const redisUpdated = JSON.parse(await redis.get(`tx:status:${tx.transactionId}`));
expect(redisUpdated.status).toBe('confirmed');

const updated = await prisma.transaction.findUnique({ where: { id: tx.transactionId } });
expect(updated.status).toBe('confirmed');
expect(updated.hash).toBe('0xabcd...');
```

**시나리오 2: Redis 캐시 히트 (Fast Path)**
```typescript
// Given: txId exists in Redis with valid TTL
const txId = 'test-tx-id';
await redis.setex(`tx:status:${txId}`, 600, JSON.stringify({ status: 'confirmed', hash: '0xabcd...' }));

// When: GET /api/v1/relay/status/{txId}
const start = Date.now();
const status = await GET('/api/v1/relay/status/' + txId);
const responseTime = Date.now() - start;

// Then: Response from Redis in <5ms
expect(status.status).toBe('confirmed');
expect(responseTime).toBeLessThan(5);
// MySQL NOT queried (verify with spy)
```

**시나리오 3: Redis 미스, MySQL 히트**
```typescript
// Given: txId NOT in Redis but EXISTS in MySQL
await redis.del(`tx:status:${txId}`);
await prisma.transaction.create({ data: { id: txId, status: 'confirmed', hash: '0xabcd...' } });

// When: GET /api/v1/relay/status/{txId}
const start = Date.now();
const status = await GET('/api/v1/relay/status/' + txId);
const responseTime = Date.now() - start;

// Then: Response from MySQL in <50ms
expect(status.status).toBe('confirmed');
expect(responseTime).toBeLessThan(50);

// And: Result cached to Redis with TTL
const cached = await redis.get(`tx:status:${txId}`);
expect(cached).toBeDefined();
const ttl = await redis.ttl(`tx:status:${txId}`);
expect(ttl).toBeGreaterThan(0);
expect(ttl).toBeLessThanOrEqual(600);
```

**시나리오 4: Webhook이 Redis TTL 리셋**
```typescript
// Given: Webhook received with status change
// When: WebhookService processes event
// Then: Redis updated with new status
// And: Redis TTL reset to configured value
// And: MySQL updated for permanent storage

await POST('/api/v1/webhooks/oz-relayer', {
  transactionId: txId,
  status: 'confirmed',
  hash: '0xnew...',
}, { headers: { 'x-oz-signature': validSignature } });

// Verify TTL was reset
const ttl = await redis.ttl(`tx:status:${txId}`);
expect(ttl).toBeGreaterThan(595); // Close to 600 (just set)
```

**시나리오 5: HMAC 서명 검증**
```typescript
// 1. 유효하지 않은 서명으로 Webhook 전송
const response = await POST('/api/v1/webhooks/oz-relayer', payload, {
  headers: { 'x-oz-signature': 'invalid-signature' }
});

// 2. 401 Unauthorized 반환
expect(response.status).toBe(401);

// 3. Redis + MySQL 업데이트 안 됨 (보안 보장)
const tx = await prisma.transaction.findUnique({ where: { id: payload.transactionId } });
expect(tx.status).not.toBe(payload.status); // 변경되지 않음
```

### Performance Tests (Optional, Artillery)
- Webhook 동시 수신 처리 (100 TPS)
- Redis 캐시 히트율 측정 (목표: 95% 이상)
- Redis 캐시 히트 응답 시간 (목표: <5ms)
- MySQL 쿼리 성능 (인덱스 효과 검증)
- 3-Tier Lookup 전체 흐름 성능 측정

## 구현 단계

### Phase 0: Dependency Update ⚠️
**목표**: Task #15 종속성 제거 (BullMQ 제거)
- Task #14는 Task #11 (Integration Tests)만 의존
- Phase 2는 HTTP 기반 Notification Service 사용
- Phase 3+에서 BullMQ/SQS 추가 (선택적 확장)

### Phase 1: Infrastructure Setup (MySQL + Prisma)
**파일**: 약 5개
- `prisma/schema.prisma` - Transaction model 정의
- `prisma/migrations/` - 초기 마이그레이션
- `docker/docker-compose.yaml` - MySQL 서비스 추가 (profile: phase2)
- `.env.example` - DATABASE_URL, MYSQL_PASSWORD 추가
- `packages/relay-api/package.json` - Prisma 의존성 추가

**검증**:
```bash
docker compose --profile phase2 up -d mysql
pnpm prisma migrate dev --name init
pnpm prisma generate
```

### Phase 2: Webhook Module Implementation
**파일**: 약 8개
- `src/webhooks/dto/oz-relayer-webhook.dto.ts`
- `src/webhooks/dto/notification.dto.ts`
- `src/webhooks/guards/webhook-signature.guard.ts`
- `src/webhooks/webhooks.controller.ts`
- `src/webhooks/webhooks.service.ts`
- `src/webhooks/notification.service.ts`
- `src/webhooks/webhooks.module.ts`
- `src/app.module.ts` - WebhooksModule import

**검증**:
```bash
# Webhook 수신 테스트 (Mock OZ Relayer)
curl -X POST http://localhost:8080/api/v1/webhooks/oz-relayer \
  -H "Content-Type: application/json" \
  -H "X-OZ-Signature: $(generate_hmac)" \
  -d '{"transactionId": "...", "status": "confirmed"}'
```

### Phase 3: Notification Service (HTTP 방식)
**파일**: 약 3개
- `src/webhooks/notification.service.ts` - HTTP POST 알림
- `src/webhooks/notification.service.spec.ts` - 테스트
- `.env.example` - CLIENT_WEBHOOK_URL 추가

**검증**:
```bash
# Mock Client Service 실행
docker run -p 9000:9000 mockserver/mockserver
# Notification 전송 테스트
```

### Phase 4: StatusService + DirectService + GaslessService 통합
**파일**: 약 3개 수정
- `src/relay/status/status.service.ts` - MySQL 우선 조회 로직 추가
- `src/relay/direct/direct.service.ts` - MySQL 저장 로직 추가
- `src/relay/gasless/gasless.service.ts` - MySQL 저장 로직 추가

**검증**:
```bash
# E2E 테스트 실행
pnpm --filter relay-api test:e2e
```

### Phase 5: Testing (Unit + E2E)
**파일**: 약 5개
- `src/webhooks/webhooks.controller.spec.ts`
- `src/webhooks/webhooks.service.spec.ts`
- `src/webhooks/notification.service.spec.ts`
- `src/relay/status/status.service.spec.ts` (Updated)
- `test/webhooks.e2e-spec.ts`

**목표 커버리지**: ≥85%

**검증**:
```bash
pnpm --filter relay-api test:cov
```

## 수락 기준

✅ **Redis 연결**: 기존 Redis 인스턴스에 relay-api 연결 성공
✅ **MySQL 연결**: Docker Compose로 MySQL 서비스 실행 성공
✅ **Prisma Migration**: Transaction 모델 생성 및 마이그레이션 적용
✅ **Webhook 수신**: POST /webhooks/oz-relayer 엔드포인트 동작
✅ **HMAC 검증**: 유효하지 않은 서명 요청 거부 (401 Unauthorized)
✅ **Redis + MySQL 저장**: 트랜잭션 생성 시 Redis(L1) + MySQL(L2) 동시 저장 확인
✅ **Redis + MySQL 업데이트**: Webhook 수신 시 Redis + MySQL 상태 업데이트 및 TTL 리셋 확인
✅ **Notification 전송**: 클라이언트 서비스 알림 전송 성공
✅ **3-Tier Lookup**: Redis → MySQL → OZ Relayer 순서로 조회 확인
✅ **Redis Cache Hit Performance**: 캐시 히트 시 응답 시간 <5ms 확인
✅ **Test Coverage**: Unit + E2E 테스트 ≥85% 커버리지
✅ **Documentation**: Swagger/OpenAPI 문서 업데이트

## 보안 고려사항

### HMAC-SHA256 서명 검증
- **알고리즘**: HMAC-SHA256
- **키 관리**: `WEBHOOK_SIGNING_KEY` 환경변수 (최소 32자)
- **서명 헤더**: `X-OZ-Signature`
- **검증 실패**: 401 Unauthorized 반환, 요청 거부

### 환경변수 보안
- `.env` 파일 Git 제외 (`.gitignore` 포함)
- `.env.example` 템플릿만 커밋
- Production 환경: AWS Secrets Manager / HashiCorp Vault 권장

### MySQL 접근 제어
- Root 계정 외부 노출 금지
- 애플리케이션용 전용 사용자 계정 (`relayer_user`)
- 최소 권한 부여 (SELECT, INSERT, UPDATE)

## 종속성

- **SPEC-TEST-001** (Task #11): Integration Tests ✅ Completed
- **Task #15 제거**: BullMQ 종속성 제거 (Phase 3+로 연기)

## 예상 작업량

- **파일**: 27개 (20 new, 7 modified)
- **코드 라인**: ~950 LOC
- **테스트 케이스**: ~33 tests (24 unit + 9 E2E)
- **구현 시간**: 5-7 hours

## Phase 3+ 향후 작업 (Out of Scope)

**Phase 3: Queue 기반 Notification**
- SPEC-QUEUE-001: BullMQ/SQS 통합
- Notification 재시도 로직 강화
- 대량 알림 처리 성능 최적화

**Phase 4: Transaction Analytics**
- SPEC-ANALYTICS-001: 트랜잭션 분석 대시보드
- 통계 집계 (성공률, 평균 확인 시간)
- Grafana + Prometheus 통합

## 참조

- OZ Relayer Webhook API: https://docs.openzeppelin.com/defender/relay#webhooks
- Prisma ORM: https://www.prisma.io/docs
- NestJS Guards: https://docs.nestjs.com/guards
- HMAC-SHA256: https://nodejs.org/api/crypto.html#crypto_crypto_createhmac_algorithm_key_options
- MySQL 8.0 Docker: https://hub.docker.com/_/mysql

---

**Version**: 1.1.0
**Status**: Draft
**Last Updated**: 2025-12-30

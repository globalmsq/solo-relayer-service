---
id: SPEC-WEBHOOK-001
title: TX History & Webhook System - Redis L1 + MySQL L2 + OZ Relayer Webhook
version: 1.1.0
status: complete
author: "@user"
created: 2025-12-30
updated: 2026-01-02
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
| 1.2.0 | 2026-01-02 | @user | Document converted to English, status updated to complete |

## Overview

| Field | Value |
|-------|-------|
| **SPEC ID** | SPEC-WEBHOOK-001 |
| **Title** | TX History & Webhook System - Redis L1 + MySQL L2 + OZ Relayer Webhook |
| **Status** | Complete |
| **Created** | 2025-12-30 |
| **Updated** | 2026-01-02 |
| **Dependencies** | SPEC-TEST-001 (Task #11) |
| **Related Tasks** | Task #14 |

## Problem Definition

In Phase 1, transaction status was queried via polling through the OZ Relayer API. Phase 2 adds the following requirements:

1. **Transaction History Storage**: Store all transactions permanently in MySQL database
2. **Webhook Callback**: OZ Relayer sends notifications when transaction status changes
3. **Client Notification**: Send real-time notifications to client services on status changes
4. **Redundant Status Query**: Query MySQL first, fallback to OZ Relayer API on failure

**Core Problems**:
- Phase 1 polling approach lacks real-time capability and increases API call costs
- Transaction history exists only in OZ Relayer, increasing service dependency
- Clients need continuous polling to detect status changes

## Solution

### Core Architecture (3-Tier Cache)

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

### Key Components

**1. Redis (L1 Cache)**
- Fast status lookup (response time <5ms)
- 10 minute TTL (configurable via environment variable)
- Key pattern: `tx:status:{txId}`
- Shares existing OZ Relayer Redis instance

**2. MySQL + Prisma ORM (L2 Persistent Storage)**
- Permanent transaction history storage
- Transaction status change tracking
- Index optimization for search and analysis

**3. Webhook Module**
- Receives status changes from OZ Relayer
- HMAC-SHA256 signature verification (security)
- Simultaneous Redis + MySQL update
- TTL reset on every status update

**4. Notification Service**
- Delivers status change events to client services
- Asynchronous notification processing (Phase 2: HTTP, Phase 3+: Queue)

**5. StatusService Extension (3-Tier Lookup)**
- Tier 1: Redis lookup (L1 Cache, ~1-5ms)
- Tier 2: MySQL lookup (L2 Persistent, ~50ms)
- Tier 3: OZ Relayer API fallback (~200ms)

## Functional Requirements (EARS Format)

### U-WEBHOOK-001: Transaction History Storage (Ubiquitous)
**When**: All transactions are submitted via `/api/v1/relay/direct` or `/api/v1/relay/gasless`
**The system shall**: Store transaction metadata (ID, hash, status, from, to, value, createdAt) in MySQL

### E-WEBHOOK-002: Webhook Reception (Event-driven)
**When**: OZ Relayer sends a webhook on transaction status change
**The system shall**: Verify HMAC-SHA256 signature and, if valid, update transaction status in MySQL

### E-WEBHOOK-003: Client Notification (Event-driven)
**When**: Transaction status is updated in MySQL
**The system shall**: Send status change notification to registered client services

### S-WEBHOOK-004: Status Query 3-Tier Lookup (State-driven)
**When**: StatusService receives a transaction status query request
**The system shall**: Query Redis(L1) first, MySQL(L2) on cache miss, and fallback to OZ Relayer API if not in MySQL

### NFR-PERF-001: Redis L1 Cache Performance (Non-Functional)
**When**: Redis cache hit occurs
**The system shall**: Return transaction status in under 5ms response time
- Redis TTL: 600 seconds (10 minutes, configurable via `REDIS_STATUS_TTL_SECONDS` env var)
- Expected cache hit rate: 95%+ within hot window
- Key pattern: `tx:status:{txId}`

### NFR-PERF-002: Cache Write-Through (Non-Functional)
**When**: Status update is received via webhook
**The system shall**: Update Redis(L1) and MySQL(L2) simultaneously and reset Redis TTL

### U-WEBHOOK-005: HMAC Signature Verification (Unwanted)
**When**: Webhook request is received
**The system shall**: Never process requests with unverified HMAC-SHA256 signatures

## Technical Requirements

### T-WEBHOOK-001: MySQL + Prisma Stack
- **MySQL 8.0**: Docker Compose service
- **Prisma ORM 5.x**: TypeScript type safety
- **Schema Design**:
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

### T-WEBHOOK-002: Webhook Endpoint
- **Path**: `POST /api/v1/webhooks/oz-relayer`
- **Authentication**: HMAC-SHA256 signature verification
- **Payload Structure**:
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
- **Signature Verification Algorithm**:
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

### T-WEBHOOK-003: WebhookSignatureGuard Implementation
- **Type**: NestJS Guard
- **Location**: `src/webhooks/guards/webhook-signature.guard.ts`
- **Code Length**: ~3 lines (core verification logic)
- **Function**: Automated HMAC-SHA256 signature verification

### T-WEBHOOK-004: Notification Service
- **Phase 2**: HTTP POST notification method
- **Phase 3+**: BullMQ/SQS Queue based (for scalability)
- **Notification Target**: Configured via `CLIENT_WEBHOOK_URL` environment variable
- **Payload**:
  ```typescript
  interface NotificationPayload {
    event: 'transaction.status.updated';
    transactionId: string;
    status: string;
    timestamp: string;
  }
  ```

### T-WEBHOOK-005: StatusService Extension (3-Tier Lookup)
**Previous Behavior** (Phase 1):
```typescript
// Direct HTTP call to OZ Relayer
const response = await this.httpService.get(ozRelayerUrl);
return response.data;
```

**New Behavior** (Phase 2 - 3-Tier Lookup):
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
**WebhookService handleWebhook method**:
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

### T-WEBHOOK-006: Docker Compose Configuration
**New Service Addition**:
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

### T-WEBHOOK-007: Environment Variable Configuration
```bash
# MySQL Connection
DATABASE_URL="mysql://relayer_user:${MYSQL_PASSWORD}@mysql:3306/msq_relayer"
MYSQL_ROOT_PASSWORD=secure-root-password
MYSQL_PASSWORD=secure-user-password

# Redis L1 Cache
REDIS_URL=redis://redis:6379
REDIS_STATUS_TTL_SECONDS=600

# Webhook Signature Verification
WEBHOOK_SIGNING_KEY=your-secure-signing-key-32-characters-long

# Client Notification (Phase 2)
CLIENT_WEBHOOK_URL=http://client-service:8080/webhooks/transaction-updates
```

### T-WEBHOOK-008: Redis Module Configuration
**RedisModule setup in relay-api**:
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

**Note**: Shares existing OZ Relayer Redis instance, so no new Redis container is needed.

## Architecture Design

### Module Structure
```
packages/relay-api/src/
├── redis/
│   └── redis.module.ts                    # Redis (L1) Module
├── webhooks/
│   ├── dto/
│   │   ├── oz-relayer-webhook.dto.ts      # Webhook payload DTO
│   │   └── notification.dto.ts            # Client notification DTO
│   ├── guards/
│   │   └── webhook-signature.guard.ts     # HMAC signature verification Guard
│   ├── webhooks.controller.ts             # POST /webhooks/oz-relayer
│   ├── webhooks.service.ts                # Webhook processing logic + Redis update
│   ├── notification.service.ts            # Client notification sending
│   ├── webhooks.module.ts                 # Webhook module
│   ├── webhooks.controller.spec.ts        # Controller tests
│   ├── webhooks.service.spec.ts           # Service tests
│   └── notification.service.spec.ts       # Notification tests
├── prisma/
│   ├── schema.prisma                      # Prisma schema
│   └── migrations/                        # Prisma migrations
├── relay/
│   ├── status/
│   │   └── status.service.ts              # 3-Tier Lookup (Redis → MySQL → OZ Relayer)
│   ├── direct/
│   │   └── direct.service.ts              # Redis + MySQL storage on transaction creation
│   └── gasless/
│       └── gasless.service.ts             # Redis + MySQL storage on transaction creation
```

### API Endpoint Changes

**New Endpoint**:
- `POST /api/v1/webhooks/oz-relayer` - OZ Relayer webhook reception

**Existing Endpoint Behavior Changes**:
- `POST /api/v1/relay/direct` - Store transaction in Redis(L1) + MySQL(L2)
- `POST /api/v1/relay/gasless` - Store transaction in Redis(L1) + MySQL(L2)
- `GET /api/v1/relay/status/:txId` - 3-Tier Lookup (Redis → MySQL → OZ Relayer)

### Data Flow

**Transaction Creation Flow**:
```
1. Client → POST /api/v1/relay/direct
2. DirectService → OZ Relayer API (submit transaction)
3. DirectService → Redis (L1 cache storage, 10min TTL)
4. DirectService → MySQL (L2 permanent storage)
5. Client ← Response (transactionId, status: pending)
```

**Webhook Reception Flow**:
```
1. OZ Relayer → POST /api/v1/webhooks/oz-relayer (with HMAC signature)
2. WebhookSignatureGuard → Signature verification
3. WebhooksService → MySQL update (status, hash, confirmedAt)
4. WebhooksService → Redis update (TTL reset)
5. NotificationService → Client Service webhook (status change notification)
```

**Status Query Flow (3-Tier Lookup)**:
```
1. Client → GET /api/v1/relay/status/:txId
2. StatusService → Redis lookup (L1, ~1-5ms)
3. If Redis hit → Return from Redis (fast path)
4. If Redis miss → MySQL lookup (L2, ~50ms)
5. If MySQL hit → Cache to Redis → Return
6. If MySQL miss → OZ Relayer API (fallback, ~200ms) → Save to Redis + MySQL → Return
```

## Test Strategy

### Unit Tests (~24 tests)

**webhooks.service.spec.ts** (8 tests):
- Webhook payload processing → Redis + MySQL update success
- Invalid signature → UnauthorizedException
- Non-existent transaction → NotFoundException
- Duplicate webhook reception → Idempotency guaranteed
- MySQL connection failure → InternalServerErrorException
- Redis update success (TTL reset verification)
- Redis connection failure → MySQL only update (graceful degradation)
- Notification sending success

**webhooks.controller.spec.ts** (4 tests):
- POST /webhooks/oz-relayer with valid signature → 200 OK
- POST /webhooks/oz-relayer with invalid signature → 401 Unauthorized
- POST /webhooks/oz-relayer with malformed payload → 400 Bad Request
- WebhookSignatureGuard behavior verification

**notification.service.spec.ts** (3 tests):
- HTTP POST notification sending success
- Client service response failure → Retry logic
- Notification payload structure verification

**status.service.spec.ts** (Updated, 9 tests - 3-Tier Lookup):
- Redis cache hit → Return without MySQL/OZ Relayer call (<5ms)
- Redis cache miss → MySQL lookup → Redis caching
- Redis + MySQL miss → OZ Relayer fallback → Redis + MySQL storage
- Redis failure → MySQL fallback (graceful degradation)
- MySQL failure → OZ Relayer fallback
- OZ Relayer failure → Return MySQL data (degraded mode)
- Redis + MySQL + OZ Relayer all fail → ServiceUnavailableException
- Redis TTL configuration verification (600 seconds default)
- Redis key pattern verification (`tx:status:{txId}`)

### Integration Tests (E2E, ~9 scenarios)

**Scenario 1: Transaction Creation and Webhook Reception**
```typescript
// 1. Submit transaction
const tx = await POST('/api/v1/relay/direct', directTxDto);

// 2. Verify Redis + MySQL storage
const redisCached = await redis.get(`tx:status:${tx.transactionId}`);
expect(redisCached).toBeDefined();

const stored = await prisma.transaction.findUnique({ where: { id: tx.transactionId } });
expect(stored.status).toBe('pending');

// 3. Simulate webhook (OZ Relayer sends confirmed)
await POST('/api/v1/webhooks/oz-relayer', {
  transactionId: tx.transactionId,
  status: 'confirmed',
  hash: '0xabcd...',
}, { headers: { 'x-oz-signature': validSignature } });

// 4. Verify Redis + MySQL update
const redisUpdated = JSON.parse(await redis.get(`tx:status:${tx.transactionId}`));
expect(redisUpdated.status).toBe('confirmed');

const updated = await prisma.transaction.findUnique({ where: { id: tx.transactionId } });
expect(updated.status).toBe('confirmed');
expect(updated.hash).toBe('0xabcd...');
```

**Scenario 2: Redis Cache Hit (Fast Path)**
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

## Acceptance Criteria

- [x] **Redis Connection**: Successfully connect relay-api to existing Redis instance
- [x] **MySQL Connection**: Successfully run MySQL service via Docker Compose
- [x] **Prisma Migration**: Create Transaction model and apply migration
- [x] **Webhook Reception**: POST /webhooks/oz-relayer endpoint working
- [x] **HMAC Verification**: Reject invalid signature requests (401 Unauthorized)
- [x] **Redis + MySQL Storage**: Verify Redis(L1) + MySQL(L2) simultaneous storage on transaction creation
- [x] **Redis + MySQL Update**: Verify Redis + MySQL status update and TTL reset on webhook reception
- [x] **Notification Sending**: Successful client service notification sending
- [x] **3-Tier Lookup**: Verify Redis → MySQL → OZ Relayer query order
- [x] **Redis Cache Hit Performance**: Verify <5ms response time on cache hit
- [x] **Test Coverage**: Unit + E2E tests ≥85% coverage
- [x] **Documentation**: Swagger/OpenAPI documentation updated

## Security Considerations

### HMAC-SHA256 Signature Verification
- **Algorithm**: HMAC-SHA256
- **Key Management**: `WEBHOOK_SIGNING_KEY` environment variable (minimum 32 characters)
- **Signature Header**: `X-OZ-Signature`
- **Verification Failure**: Return 401 Unauthorized, reject request

### Environment Variable Security
- `.env` file excluded from Git (`.gitignore` included)
- Only `.env.example` template committed
- Production environment: AWS Secrets Manager / HashiCorp Vault recommended

### MySQL Access Control
- No external exposure of root account
- Dedicated application user account (`relayer_user`)
- Minimum privilege grant (SELECT, INSERT, UPDATE)

## Dependencies

- **SPEC-TEST-001** (Task #11): Integration Tests - Completed
- **Task #15 Removed**: BullMQ dependency removed (deferred to Phase 3+)

## Estimated Effort

- **Files**: 27 (20 new, 7 modified)
- **Lines of Code**: ~950 LOC
- **Test Cases**: ~33 tests (24 unit + 9 E2E)
- **Implementation Time**: 5-7 hours

## Phase 3+ Future Work (Out of Scope)

**Phase 3: Queue-based Notification**
- SPEC-QUEUE-001: BullMQ/SQS Integration
- Enhanced notification retry logic
- High-volume notification performance optimization

**Phase 4: Transaction Analytics**
- SPEC-ANALYTICS-001: Transaction analysis dashboard
- Statistics aggregation (success rate, average confirmation time)
- Grafana + Prometheus integration

## References

- OZ Relayer Webhook API: https://docs.openzeppelin.com/defender/relay#webhooks
- Prisma ORM: https://www.prisma.io/docs
- NestJS Guards: https://docs.nestjs.com/guards
- HMAC-SHA256: https://nodejs.org/api/crypto.html#crypto_crypto_createhmac_algorithm_key_options
- MySQL 8.0 Docker: https://hub.docker.com/_/mysql

---

**Version**: 1.2.0
**Status**: Complete
**Last Updated**: 2026-01-02

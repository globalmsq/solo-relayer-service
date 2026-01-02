---
id: SPEC-WEBHOOK-001
title: TX History & Webhook System - Implementation Plan (Redis L1 + MySQL L2)
version: 1.2.0
status: complete
created: 2025-12-30
updated: 2026-01-02
---

# Implementation Plan: SPEC-WEBHOOK-001

## Overview

**Goal**: Implement transaction history management and OZ Relayer Webhook system based on Redis L1 cache + MySQL L2 persistent storage

**Scope**: Phase 2 - 3-Tier Cache (Redis → MySQL → OZ Relayer), Webhook reception, HTTP-based Notification

**Estimated Time**: 5-7 hours (27 files, ~950 LOC)

---

## Technical Approach

### Core Design Principles

**Principle 1: 3-Tier Cache Architecture**
- Redis (L1): Ultra-fast cache (response time <5ms, 10-minute TTL)
- MySQL (L2): Persistent storage (permanent retention, searchable)
- OZ Relayer API: Original data source (fallback only)

**Principle 2: Write-Through Caching**
- Simultaneous Redis + MySQL update on webhook reception
- Simultaneous Redis + MySQL save on transaction creation
- TTL reset to maintain hot data in cache

**Principle 3: HMAC Signature-Based Security**
- Option B: OZ Relayer signs → we verify
- HMAC-SHA256 algorithm (implementable in 3 lines of code)
- Utilizing NestJS Guard pattern

**Principle 4: Gradual Scalability**
- Phase 2: HTTP-based Notification (simple, fast)
- Phase 3+: BullMQ/SQS Queue (scalability, retry)

### Key Design Decisions

**Decision 1: Redis L1 Cache Introduction**
- Share existing Redis instance used by OZ Relayer (no new container needed)
- Using ioredis library (compatible with NestJS ecosystem)
- Key pattern: `tx:status:{txId}`
- TTL: 600 seconds (configurable via `REDIS_STATUS_TTL_SECONDS` environment variable)

**Decision 2: Prisma ORM Selection**
- TypeScript type safety guaranteed
- Automatic migration management
- NestJS officially recommended ORM

**Decision 3: Docker Compose Profile Strategy**
- `profile: phase2` → MySQL service selective execution
- Phase 1 maintained (works without MySQL)
- Phase 2+ activation (`--profile phase2` option)

**Decision 4: StatusService 3-Tier Lookup Strategy**
- Tier 1: Redis lookup (~1-5ms)
- Tier 2: MySQL lookup (~50ms) + Redis caching
- Tier 3: OZ Relayer API fallback (~200ms) + Redis + MySQL save
- Graceful degradation: fallback to lower tier on upper tier failure

---

## Phase 0: Dependency Update (30 min)

### Goal
Remove Task #15 (BullMQ) dependency and clarify Task #14 scope

### Tasks
1. **Task #14 Dependency Update**
   - Remove: Task #15 (Queue System)
   - Keep: Task #11 (Integration Tests)

2. **Phase 2 Scope Definition**
   - Use HTTP-based Notification Service
   - Implementable without BullMQ

3. **Phase 3+ Plan**
   - Add BullMQ/SQS (optional extension)
   - Strengthen Notification retry logic

### Verification
```bash
# Check Task #14 description
cat .taskmaster/tasks/task-14.txt

# Verify dependencies (only Task #11 should exist)
grep -r "dependencies" .taskmaster/tasks/task-14.txt
```

---

## Phase 1: Infrastructure Setup (1-1.5 hours)

### 1.1 Prisma + Redis Dependency Installation

**File**: `packages/relay-api/package.json`

**Additional Dependencies**:
```json
{
  "dependencies": {
    "@prisma/client": "^5.21.1",
    "ioredis": "^5.4.1"
  },
  "devDependencies": {
    "prisma": "^5.21.1",
    "@types/ioredis": "^5.0.0"
  }
}
```

**Execution**:
```bash
cd packages/relay-api
pnpm add @prisma/client ioredis
pnpm add -D prisma @types/ioredis
```

---

### 1.2 Prisma Schema Definition

**File**: `packages/relay-api/prisma/schema.prisma` (New)

**Contents**:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

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
  @@map("transactions")
}
```

**Design Points**:
- `id`: UUID v4 (same as OZ Relayer transaction ID)
- `hash`: Unique constraint (prevent duplicates)
- `status`: Index (fast status queries)
- `data`: TEXT type (store ABI-encoded data)

---

### 1.3 Docker Compose Update

**File**: `docker/docker-compose.yaml` (Modified)

**Additional Service**:
```yaml
services:
  # === MySQL Database (Phase 2+ only) ===
  mysql:
    image: mysql:8.0
    profiles: ["phase2"]
    container_name: msq-relayer-mysql
    ports:
      - "3306:3306"
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-secure-root-password}
      MYSQL_DATABASE: msq_relayer
      MYSQL_USER: relayer_user
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:-secure-user-password}
    volumes:
      - msq-relayer-mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p${MYSQL_ROOT_PASSWORD:-secure-root-password}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - msq-relayer-network

  # === Relay API (Updated for MySQL dependency) ===
  relay-api:
    # ... (existing config)
    profiles: ["phase2"]  # Phase 2+ requires MySQL
    depends_on:
      redis:
        condition: service_healthy
      mysql:  # NEW DEPENDENCY
        condition: service_healthy
      oz-relayer-1:
        condition: service_healthy
    environment:
      # ... (existing env vars)
      DATABASE_URL: ${DATABASE_URL:-mysql://relayer_user:secure-user-password@mysql:3306/msq_relayer}
      WEBHOOK_SIGNING_KEY: ${WEBHOOK_SIGNING_KEY:-local-dev-webhook-signing-key-32ch}
      CLIENT_WEBHOOK_URL: ${CLIENT_WEBHOOK_URL:-http://host.docker.internal:9000/webhooks/transaction-updates}

volumes:
  msq-relayer-mysql-data:
    driver: local
```

**Changes**:
- MySQL service added (`profiles: ["phase2"]`)
- MySQL added to relay-api dependencies
- Volume added (data persistence)

---

### 1.4 Environment Variables Setup

**File**: `.env.example` (Modified)

**Additional Variables**:
```bash
# === Phase 2: MySQL Database ===
DATABASE_URL="mysql://relayer_user:secure-user-password@localhost:3306/msq_relayer"
MYSQL_ROOT_PASSWORD=secure-root-password
MYSQL_PASSWORD=secure-user-password

# === Phase 2: Redis L1 Cache ===
REDIS_URL=redis://localhost:6379
REDIS_STATUS_TTL_SECONDS=600

# === Phase 2: Webhook Security ===
WEBHOOK_SIGNING_KEY=your-secure-signing-key-must-be-32-characters-long

# === Phase 2: Client Notification ===
CLIENT_WEBHOOK_URL=http://localhost:9000/webhooks/transaction-updates
```

**File**: `.env` (Create locally, not in Git)
```bash
cp .env.example .env
# Edit .env with actual values
```

---

### 1.5 Redis Module Creation

**File**: `packages/relay-api/src/redis/redis.module.ts` (New)

```typescript
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get('REDIS_URL', 'redis://localhost:6379');
        return new Redis(redisUrl);
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
```

**Note**: Sharing the existing Redis instance used by OZ Relayer, so no new Redis container is needed.

---

### 1.6 Prisma Migration Execution

**Commands**:
```bash
# Start MySQL service (phase2 profile)
docker compose --profile phase2 up -d mysql

# Prisma initial migration
cd packages/relay-api
pnpm prisma migrate dev --name init

# Generate Prisma Client
pnpm prisma generate
```

**Verification**:
```bash
# Verify MySQL connection
docker exec -it msq-relayer-mysql mysql -u relayer_user -p -e "SHOW DATABASES;"

# Verify tables
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer -e "SHOW TABLES;"

# Verify schema
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer -e "DESCRIBE transactions;"
```

---

### Phase 1 Checklist

- [ ] Prisma + ioredis dependencies installed
- [ ] `schema.prisma` file created with Transaction model definition
- [ ] MySQL service added to Docker Compose (profile: phase2)
- [ ] `.env.example` updated (DATABASE_URL, MYSQL_PASSWORD, REDIS_URL, REDIS_STATUS_TTL_SECONDS)
- [ ] `.env` file created (local development environment)
- [ ] RedisModule created (`src/redis/redis.module.ts`)
- [ ] MySQL service started successfully
- [ ] Prisma migration applied (`pnpm prisma migrate dev`)
- [ ] Prisma Client generated (`pnpm prisma generate`)
- [ ] MySQL table creation verified (`transactions` table exists)
- [ ] Redis connection verified (sharing existing Redis instance)

---

## Phase 2: Webhook Module Implementation (1.5-2 hours)

### 2.1 DTO Definitions

**File 1**: `packages/relay-api/src/webhooks/dto/oz-relayer-webhook.dto.ts` (New)

```typescript
import { IsString, IsOptional, IsISO8601, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * OZ Relayer Webhook Payload DTO
 * Received when transaction status changes
 */
export class OzRelayerWebhookDto {
  @ApiProperty({ description: 'Transaction ID (UUID v4)' })
  @IsUUID('4')
  transactionId: string;

  @ApiPropertyOptional({ description: 'Transaction hash (null if pending)' })
  @IsOptional()
  @IsString()
  hash?: string | null;

  @ApiProperty({ description: 'Transaction status', enum: ['pending', 'sent', 'submitted', 'inmempool', 'mined', 'confirmed', 'failed'] })
  @IsString()
  status: string;

  @ApiPropertyOptional({ description: 'From address' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'To address' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Transaction value (wei)' })
  @IsOptional()
  @IsString()
  value?: string;

  @ApiProperty({ description: 'Created timestamp (ISO 8601)' })
  @IsISO8601()
  createdAt: string;

  @ApiPropertyOptional({ description: 'Confirmed timestamp (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  confirmedAt?: string;
}
```

**File 2**: `packages/relay-api/src/webhooks/dto/notification.dto.ts` (New)

```typescript
import { ApiProperty } from '@nestjs/swagger';

/**
 * Client Notification Payload
 * Sent to client services when transaction status changes
 */
export class NotificationDto {
  @ApiProperty({ description: 'Event type', example: 'transaction.status.updated' })
  event: string;

  @ApiProperty({ description: 'Transaction ID' })
  transactionId: string;

  @ApiProperty({ description: 'New status' })
  status: string;

  @ApiProperty({ description: 'Event timestamp (ISO 8601)' })
  timestamp: string;
}
```

---

### 2.2 HMAC Signature Guard

**File**: `packages/relay-api/src/webhooks/guards/webhook-signature.guard.ts` (New)

```typescript
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * WebhookSignatureGuard
 * Validates HMAC-SHA256 signature from OZ Relayer webhook requests
 *
 * SPEC-WEBHOOK-001: Option B - OZ Relayer signs, we verify
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    // Extract signature from header
    const receivedSignature = request.headers['x-oz-signature'];
    if (!receivedSignature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Compute expected signature (HMAC-SHA256)
    const signingKey = this.configService.get<string>('WEBHOOK_SIGNING_KEY');
    const payload = JSON.stringify(request.body);
    const expectedSignature = crypto
      .createHmac('sha256', signingKey)
      .update(payload)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature))) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
```

**Core Code** (3 lines):
```typescript
const expectedSignature = crypto
  .createHmac('sha256', signingKey)
  .update(payload)
  .digest('hex');
```

---

### 2.3 Webhooks Service

**File**: `packages/relay-api/src/webhooks/webhooks.service.ts` (New)

```typescript
import { Injectable, Inject, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { OzRelayerWebhookDto } from './dto/oz-relayer-webhook.dto';
import { NotificationService } from './notification.service';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * WebhooksService
 * Handles OZ Relayer webhook requests and updates Redis (L1) + MySQL (L2)
 *
 * SPEC-WEBHOOK-001 v1.1: Webhook processing with 3-Tier cache (write-through pattern)
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Process OZ Relayer webhook and update transaction status
   * Updates both Redis (L1) and MySQL (L2) with write-through pattern
   *
   * @param dto - Webhook payload from OZ Relayer
   * @throws NotFoundException if transaction does not exist
   * @throws InternalServerErrorException if database update fails
   */
  async handleWebhook(dto: OzRelayerWebhookDto): Promise<void> {
    try {
      // Upsert transaction in MySQL (L2 - permanent storage)
      const updated = await this.prisma.transaction.upsert({
        where: { id: dto.transactionId },
        update: {
          hash: dto.hash,
          status: dto.status,
          from: dto.from,
          to: dto.to,
          value: dto.value,
          confirmedAt: dto.confirmedAt ? new Date(dto.confirmedAt) : null,
          updatedAt: new Date(),
        },
        create: {
          id: dto.transactionId,
          hash: dto.hash,
          status: dto.status,
          from: dto.from,
          to: dto.to,
          value: dto.value,
          createdAt: new Date(dto.createdAt),
          confirmedAt: dto.confirmedAt ? new Date(dto.confirmedAt) : null,
        },
      });

      // Update Redis (L1 - cache) with TTL reset
      await this.cacheToRedis(dto.transactionId, updated);

      // Send notification to client services
      await this.notificationService.notifyClients({
        event: 'transaction.status.updated',
        transactionId: updated.id,
        status: updated.status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error.code === 'P2025') {
        // Prisma error: Record not found
        throw new NotFoundException(`Transaction ${dto.transactionId} not found`);
      }
      throw new InternalServerErrorException('Failed to update transaction');
    }
  }

  /**
   * Cache transaction status to Redis (L1) with configurable TTL
   * Key pattern: tx:status:{txId}
   * Default TTL: 600 seconds (10 minutes)
   */
  private async cacheToRedis(txId: string, data: any): Promise<void> {
    try {
      const ttl = this.configService.get<number>('REDIS_STATUS_TTL_SECONDS', 600);
      await this.redis.setex(`tx:status:${txId}`, ttl, JSON.stringify(data));
      this.logger.debug(`Cached transaction ${txId} to Redis with TTL ${ttl}s`);
    } catch (error) {
      // Log error but don't throw - MySQL is the source of truth
      this.logger.warn(`Failed to cache to Redis: ${error.message}`);
    }
  }
}
```

---

### 2.4 Notification Service (HTTP Method)

**File**: `packages/relay-api/src/webhooks/notification.service.ts` (New)

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { NotificationDto } from './dto/notification.dto';

/**
 * NotificationService
 * Sends transaction status change notifications to client services
 *
 * SPEC-WEBHOOK-001: Phase 2 - HTTP POST based notification
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Send notification to client webhook URL
   *
   * @param notification - Notification payload
   * @returns Promise<void>
   */
  async notifyClients(notification: NotificationDto): Promise<void> {
    const webhookUrl = this.configService.get<string>('CLIENT_WEBHOOK_URL');

    if (!webhookUrl) {
      this.logger.warn('CLIENT_WEBHOOK_URL not configured, skipping notification');
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(webhookUrl, notification, {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      this.logger.log(`Notification sent for transaction ${notification.transactionId}`);
    } catch (error) {
      // Log error but don't throw (notification failure should not block webhook processing)
      this.logger.error(`Failed to send notification: ${error.message}`);
    }
  }
}
```

**Features**:
- Asynchronous notification (prevents blocking webhook processing)
- Only logs errors on failure (retry logic added in Phase 3+)
- 5-second timeout (fail fast)

---

### 2.5 Webhooks Controller

**File**: `packages/relay-api/src/webhooks/webhooks.controller.ts` (New)

```typescript
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { OzRelayerWebhookDto } from './dto/oz-relayer-webhook.dto';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';

/**
 * WebhooksController
 * Receives transaction status update webhooks from OZ Relayer
 *
 * SPEC-WEBHOOK-001: Webhook endpoint with HMAC signature verification
 */
@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('oz-relayer')
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive OZ Relayer webhook (transaction status update)' })
  @ApiHeader({ name: 'X-OZ-Signature', description: 'HMAC-SHA256 signature', required: true })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid webhook signature' })
  @ApiResponse({ status: 400, description: 'Invalid webhook payload' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  async handleOzRelayerWebhook(@Body() dto: OzRelayerWebhookDto): Promise<void> {
    await this.webhooksService.handleWebhook(dto);
  }
}
```

**Security Layers**:
- `@UseGuards(WebhookSignatureGuard)` - Automatic HMAC signature verification
- Returns 401 Unauthorized automatically on signature verification failure
- Controller/Service only handles pure business logic since Guard handles verification

---

### 2.6 Webhooks Module

**File**: `packages/relay-api/src/webhooks/webhooks.module.ts` (New)

```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { NotificationService } from './notification.service';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';

@Module({
  imports: [HttpModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, NotificationService, WebhookSignatureGuard],
  exports: [WebhooksService, NotificationService],
})
export class WebhooksModule {}
```

---

### 2.7 App Module Update

**File**: `packages/relay-api/src/app.module.ts` (Modified)

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// ... (existing imports)
import { WebhooksModule } from './webhooks/webhooks.module'; // ADD THIS

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // ... (existing modules)
    WebhooksModule,  // ADD THIS
  ],
  // ... (existing config)
})
export class AppModule {}
```

---

### Phase 2 Checklist

- [ ] `OzRelayerWebhookDto` defined (with Validation)
- [ ] `NotificationDto` defined
- [ ] `WebhookSignatureGuard` implemented (HMAC verification)
- [ ] `WebhooksService` implemented (MySQL upsert)
- [ ] `NotificationService` implemented (HTTP POST)
- [ ] `WebhooksController` implemented (POST /webhooks/oz-relayer)
- [ ] `WebhooksModule` created
- [ ] `AppModule` updated (WebhooksModule import)
- [ ] Build successful (`pnpm build`)
- [ ] Linting passed (`pnpm lint`)

---

## Phase 3: Notification Service (HTTP Method) (30 min)

Already implemented in Phase 2 (`notification.service.ts`)

### Additional Task: Mock Client Service Setup (for testing)

**Docker Compose Addition** (Optional, for E2E testing):
```yaml
services:
  mock-client:
    image: mockserver/mockserver:latest
    profiles: ["testing"]
    ports:
      - "9000:1080"
    environment:
      MOCKSERVER_INITIALIZATION_JSON_PATH: /config/initializerJson.json
    volumes:
      - ./test/mockserver-config.json:/config/initializerJson.json
    networks:
      - msq-relayer-network
```

**Mock Config**: `test/mockserver-config.json` (New)
```json
[
  {
    "httpRequest": {
      "method": "POST",
      "path": "/webhooks/transaction-updates"
    },
    "httpResponse": {
      "statusCode": 200,
      "body": {
        "message": "Notification received"
      }
    }
  }
]
```

---

## Phase 4: StatusService + DirectService + GaslessService Integration (1.5-2 hours)

### 4.1 StatusService Extension (3-Tier Lookup: Redis → MySQL → OZ Relayer)

**File**: `packages/relay-api/src/relay/status/status.service.ts` (Modified)

**Before Change** (Phase 1):
```typescript
async getTransactionStatus(txId: string): Promise<TxStatusResponseDto> {
  // Direct HTTP call to OZ Relayer
  const response = await firstValueFrom(this.httpService.get(ozRelayerUrl));
  return this.transformToDto(response.data);
}
```

**After Change** (Phase 2 - 3-Tier Lookup):
```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { firstValueFrom } from 'rxjs';
import { REDIS_CLIENT } from '../../redis/redis.module';

@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly ozRelayerService: OzRelayerService,
  ) {}

  /**
   * Query transaction status with 3-Tier lookup
   * Tier 1: Redis (L1) - ~1-5ms
   * Tier 2: MySQL (L2) - ~50ms
   * Tier 3: OZ Relayer API - ~200ms
   *
   * SPEC-WEBHOOK-001 v1.1: 3-Tier cache architecture
   */
  async getTransactionStatus(txId: string): Promise<TxStatusResponseDto> {
    // Tier 1: Redis (L1 Cache) - ~1-5ms
    try {
      const cached = await this.redis.get(`tx:status:${txId}`);
      if (cached) {
        this.logger.debug(`Redis cache hit for transaction ${txId}`);
        return JSON.parse(cached);
      }
    } catch (error) {
      this.logger.warn(`Redis lookup failed: ${error.message}`);
      // Continue to Tier 2
    }

    // Tier 2: MySQL (L2 Persistent) - ~50ms
    const stored = await this.prisma.transaction.findUnique({
      where: { id: txId },
    });

    if (stored) {
      this.logger.debug(`MySQL cache hit for transaction ${txId}`);
      const dto = this.transformPrismaToDto(stored);
      // Backfill Redis cache
      await this.cacheToRedis(txId, dto);
      return dto;
    }

    // Tier 3: OZ Relayer API fallback - ~200ms
    this.logger.debug(`Fetching transaction ${txId} from OZ Relayer`);
    try {
      const fresh = await this.fetchFromOzRelayer(txId);

      // Save to both L1 (Redis) and L2 (MySQL)
      await Promise.all([
        this.cacheToRedis(txId, fresh),
        this.prisma.transaction.create({
          data: {
            id: fresh.transactionId,
            hash: fresh.hash,
            status: fresh.status,
            from: fresh.from,
            to: fresh.to,
            value: fresh.value,
            createdAt: new Date(fresh.createdAt),
            confirmedAt: fresh.confirmedAt ? new Date(fresh.confirmedAt) : null,
          },
        }),
      ]);

      return fresh;
    } catch (error) {
      this.logger.error(`All tiers failed for transaction ${txId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cache transaction status to Redis (L1) with configurable TTL
   * Key pattern: tx:status:{txId}
   * Default TTL: 600 seconds (10 minutes)
   */
  private async cacheToRedis(txId: string, data: any): Promise<void> {
    try {
      const ttl = this.configService.get<number>('REDIS_STATUS_TTL_SECONDS', 600);
      await this.redis.setex(`tx:status:${txId}`, ttl, JSON.stringify(data));
    } catch (error) {
      this.logger.warn(`Failed to cache to Redis: ${error.message}`);
    }
  }

  /**
   * Fetch transaction status from OZ Relayer API
   */
  private async fetchFromOzRelayer(txId: string): Promise<TxStatusResponseDto> {
    const relayerId = await this.ozRelayerService.getRelayerId();
    const relayerUrl = this.configService.get<string>('OZ_RELAYER_URL');
    const apiKey = this.configService.get<string>('OZ_RELAYER_API_KEY');

    const response = await firstValueFrom(
      this.httpService.get(
        `${relayerUrl}/api/v1/relayers/${relayerId}/transactions/${txId}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000,
        },
      ),
    );

    return this.transformOzRelayerToDto(response.data);
  }

  /**
   * Transform Prisma Transaction to DTO
   */
  private transformPrismaToDto(tx: any): TxStatusResponseDto {
    return {
      transactionId: tx.id,
      hash: tx.hash,
      status: tx.status,
      createdAt: tx.createdAt.toISOString(),
      confirmedAt: tx.confirmedAt?.toISOString(),
      from: tx.from,
      to: tx.to,
      value: tx.value,
    };
  }

  /**
   * Transform OZ Relayer response to DTO
   */
  private transformOzRelayerToDto(data: any): TxStatusResponseDto {
    return {
      transactionId: data.data?.id || data.id,
      hash: data.data?.hash || data.hash,
      status: data.data?.status || data.status,
      createdAt: data.data?.created_at || data.created_at,
      confirmedAt: data.data?.confirmed_at,
      from: data.data?.from,
      to: data.data?.to,
      value: data.data?.value,
    };
  }
}
```

**Core Logic (3-Tier Lookup)**:
1. **Tier 1 (Redis)**: Ultra-fast lookup (~1-5ms), immediate return on cache hit
2. **Tier 2 (MySQL)**: Persistent storage lookup (~50ms), backfill to Redis on hit
3. **Tier 3 (OZ Relayer)**: Original source fallback (~200ms), save result to Redis + MySQL
4. **Graceful Degradation**: Automatic fallback to lower tier on upper tier failure

---

### 4.2 DirectService Extension (Redis + MySQL Storage)

**File**: `packages/relay-api/src/relay/direct/direct.service.ts` (Modified)

**Additional Code** (sendTransaction method modification):
```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

@Injectable()
export class DirectService {
  private readonly logger = new Logger(DirectService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
    // ... (existing dependencies)
  ) {}

  async sendTransaction(dto: DirectTxDto): Promise<DirectTxResponseDto> {
    // 1. Send transaction to OZ Relayer (existing logic)
    const ozResponse = await firstValueFrom(
      this.httpService.post(ozRelayerUrl, payload, config),
    );

    const transactionId = ozResponse.data.data?.id || ozResponse.data.id;

    const txData = {
      transactionId,
      hash: ozResponse.data.data?.hash || null,
      status: 'pending',
      to: dto.to,
      value: dto.value,
      createdAt: new Date().toISOString(),
    };

    // 2. Save to both Redis (L1) and MySQL (L2) - Write-through pattern
    await Promise.all([
      this.cacheToRedis(transactionId, txData),
      this.prisma.transaction.create({
        data: {
          id: transactionId,
          status: 'pending',
          to: dto.to,
          value: dto.value,
          data: dto.data,
          createdAt: new Date(),
        },
      }),
    ]);

    // 3. Return response (existing)
    return txData;
  }

  /**
   * Cache transaction to Redis (L1) with TTL
   */
  private async cacheToRedis(txId: string, data: any): Promise<void> {
    try {
      const ttl = this.configService.get<number>('REDIS_STATUS_TTL_SECONDS', 600);
      await this.redis.setex(`tx:status:${txId}`, ttl, JSON.stringify(data));
    } catch (error) {
      this.logger.warn(`Failed to cache to Redis: ${error.message}`);
    }
  }
}
```

---

### 4.3 GaslessService Extension (Redis + MySQL Storage)

**File**: `packages/relay-api/src/relay/gasless/gasless.service.ts` (Modified)

**Additional Code** (same pattern):
```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

@Injectable()
export class GaslessService {
  private readonly logger = new Logger(GaslessService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
    // ... (existing dependencies)
  ) {}

  async sendGaslessTransaction(dto: GaslessTxDto): Promise<GaslessTxResponseDto> {
    // 1. Forward to ERC2771 (existing logic)
    const ozResponse = await firstValueFrom(
      this.httpService.post(ozRelayerUrl, payload, config),
    );

    const transactionId = ozResponse.data.data?.id || ozResponse.data.id;

    const txData = {
      transactionId,
      hash: ozResponse.data.data?.hash || null,
      status: 'pending',
      to: this.configService.get<string>('FORWARDER_ADDRESS'),
      value: '0',
      createdAt: new Date().toISOString(),
    };

    // 2. Save to both Redis (L1) and MySQL (L2) - Write-through pattern
    await Promise.all([
      this.cacheToRedis(transactionId, txData),
      this.prisma.transaction.create({
        data: {
          id: transactionId,
          status: 'pending',
          to: this.configService.get<string>('FORWARDER_ADDRESS'),
          value: '0',
          data: dto.data,
          createdAt: new Date(),
        },
      }),
    ]);

    // 3. Return response (existing)
    return txData;
  }

  /**
   * Cache transaction to Redis (L1) with TTL
   */
  private async cacheToRedis(txId: string, data: any): Promise<void> {
    try {
      const ttl = this.configService.get<number>('REDIS_STATUS_TTL_SECONDS', 600);
      await this.redis.setex(`tx:status:${txId}`, ttl, JSON.stringify(data));
    } catch (error) {
      this.logger.warn(`Failed to cache to Redis: ${error.message}`);
    }
  }
}
```

---

### Phase 4 Checklist

- [ ] `StatusService` 3-Tier Lookup logic added (Redis → MySQL → OZ Relayer)
- [ ] `DirectService` Redis + MySQL storage logic added
- [ ] `GaslessService` Redis + MySQL storage logic added
- [ ] Redis import added (`ioredis`, `REDIS_CLIENT`)
- [ ] Prisma import added (`@prisma/client`)
- [ ] Redis TTL configuration verified (`REDIS_STATUS_TTL_SECONDS`)
- [ ] Build successful (`pnpm build`)
- [ ] Existing tests passing (regression prevention)

---

## Phase 5: Testing (Unit + E2E) (1.5-2 hours)

### 5.1 Webhooks Service Unit Tests

**File**: `packages/relay-api/src/webhooks/webhooks.service.spec.ts` (New)

**Test Cases** (6 tests):
```typescript
describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: PrismaClient;
  let notificationService: NotificationService;

  beforeEach(async () => {
    // Setup mocks
  });

  it('should update transaction status in MySQL', async () => {
    // Mock Prisma upsert
    // Call handleWebhook
    // Verify upsert called with correct data
  });

  it('should send notification after MySQL update', async () => {
    // Mock Prisma and NotificationService
    // Call handleWebhook
    // Verify notificationService.notifyClients called
  });

  it('should throw NotFoundException if transaction not found', async () => {
    // Mock Prisma error (P2025)
    // Expect NotFoundException
  });

  it('should handle idempotent webhook requests', async () => {
    // Send same webhook twice
    // Verify MySQL updated only once (upsert behavior)
  });

  it('should throw InternalServerErrorException on database error', async () => {
    // Mock Prisma connection error
    // Expect InternalServerErrorException
  });

  it('should not throw if notification fails', async () => {
    // Mock NotificationService error
    // Verify handleWebhook completes successfully (notification is non-blocking)
  });
});
```

---

### 5.2 Webhooks Controller Unit Tests

**File**: `packages/relay-api/src/webhooks/webhooks.controller.spec.ts` (New)

**Test Cases** (4 tests):
```typescript
describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: WebhooksService;

  beforeEach(async () => {
    // Setup mocks
  });

  it('POST /webhooks/oz-relayer with valid signature should return 200', async () => {
    // Mock WebhookSignatureGuard (pass)
    // Mock WebhooksService
    // Verify 200 OK
  });

  it('POST /webhooks/oz-relayer with invalid signature should return 401', async () => {
    // Mock WebhookSignatureGuard (fail)
    // Expect 401 Unauthorized
  });

  it('POST /webhooks/oz-relayer with malformed payload should return 400', async () => {
    // Send invalid DTO (missing required fields)
    // Expect 400 Bad Request
  });

  it('WebhookSignatureGuard should validate HMAC signature', async () => {
    // Test guard logic directly
    // Verify signature validation
  });
});
```

---

### 5.3 Notification Service Unit Tests

**File**: `packages/relay-api/src/webhooks/notification.service.spec.ts` (New)

**Test Cases** (3 tests):
```typescript
describe('NotificationService', () => {
  let service: NotificationService;
  let httpService: HttpService;

  beforeEach(async () => {
    // Setup mocks
  });

  it('should send HTTP POST notification successfully', async () => {
    // Mock HttpService.post
    // Call notifyClients
    // Verify POST called with correct payload
  });

  it('should log error if client service fails', async () => {
    // Mock HttpService.post to throw error
    // Call notifyClients
    // Verify error logged (no exception thrown)
  });

  it('should skip notification if CLIENT_WEBHOOK_URL not configured', async () => {
    // Mock ConfigService (no URL)
    // Call notifyClients
    // Verify HttpService not called
  });
});
```

---

### 5.4 StatusService Unit Tests (Updated)

**File**: `packages/relay-api/src/relay/status/status.service.spec.ts` (Modified)

**Additional Test Cases** (5 new tests):
```typescript
describe('StatusService - Phase 2', () => {
  // Existing tests (Phase 1) ...

  // NEW: Phase 2 tests
  it('should return from MySQL cache if fresh (< 5 seconds)', async () => {
    // Mock Prisma findUnique (updatedAt = now)
    // Call getTransactionStatus
    // Verify HttpService NOT called (cache hit)
  });

  it('should fetch from OZ Relayer if cache is stale (> 5 seconds)', async () => {
    // Mock Prisma findUnique (updatedAt = 10 seconds ago)
    // Mock HttpService.get
    // Verify HttpService called (cache miss)
  });

  it('should update MySQL after OZ Relayer fetch', async () => {
    // Mock HttpService.get
    // Mock Prisma upsert
    // Verify upsert called with fresh data
  });

  it('should return stale cache if OZ Relayer fails (degraded mode)', async () => {
    // Mock Prisma findUnique (stale data)
    // Mock HttpService.get to throw error
    // Verify stale data returned (not exception)
  });

  it('should throw ServiceUnavailableException if both MySQL and OZ Relayer fail', async () => {
    // Mock Prisma findUnique to return null
    // Mock HttpService.get to throw error
    // Expect ServiceUnavailableException
  });
});
```

---

### 5.5 E2E Tests

**File**: `packages/relay-api/test/webhooks.e2e-spec.ts` (New)

**Scenarios** (6 tests):
```typescript
describe('Webhooks E2E (SPEC-WEBHOOK-001)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Initialize app with MySQL
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('Scenario 1: Transaction creation → MySQL storage', async () => {
    const tx = await request(app.getHttpServer())
      .post('/api/v1/relay/direct')
      .send(directTxDto)
      .expect(202);

    const stored = await prisma.transaction.findUnique({ where: { id: tx.body.transactionId } });
    expect(stored).toBeDefined();
    expect(stored.status).toBe('pending');
  });

  it('Scenario 2: Webhook reception → MySQL update', async () => {
    // Create transaction first
    const tx = await createTransaction();

    // Send webhook (simulate OZ Relayer)
    const signature = generateHmac(webhookPayload);
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/oz-relayer')
      .set('X-OZ-Signature', signature)
      .send({ transactionId: tx.id, status: 'confirmed', hash: '0xabcd...' })
      .expect(200);

    // Verify MySQL updated
    const updated = await prisma.transaction.findUnique({ where: { id: tx.id } });
    expect(updated.status).toBe('confirmed');
    expect(updated.hash).toBe('0xabcd...');
  });

  it('Scenario 3: Invalid HMAC signature → 401 Unauthorized', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/oz-relayer')
      .set('X-OZ-Signature', 'invalid-signature')
      .send(webhookPayload)
      .expect(401);
  });

  it('Scenario 4: MySQL cache hit → Fast response', async () => {
    // Create and update transaction
    const tx = await createAndConfirmTransaction();

    // Query status (should hit MySQL cache)
    const start = Date.now();
    const response = await request(app.getHttpServer())
      .get(`/api/v1/relay/status/${tx.id}`)
      .expect(200);
    const duration = Date.now() - start;

    expect(response.body.status).toBe('confirmed');
    expect(duration).toBeLessThan(100); // < 100ms (cache hit)
  });

  it('Scenario 5: Stale cache → OZ Relayer fallback', async () => {
    // Create transaction with stale updatedAt (10 seconds ago)
    const tx = await createStaleTransaction();

    // Query status (should trigger fallback)
    const response = await request(app.getHttpServer())
      .get(`/api/v1/relay/status/${tx.id}`)
      .expect(200);

    // Verify fresh data fetched
    expect(response.body.status).toBe('confirmed');
  });

  it('Scenario 6: Client notification sent after webhook', async () => {
    // Start mock client service
    const mockClient = startMockServer();

    // Send webhook
    const signature = generateHmac(webhookPayload);
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/oz-relayer')
      .set('X-OZ-Signature', signature)
      .send(webhookPayload)
      .expect(200);

    // Verify client received notification
    const notifications = mockClient.getReceivedRequests();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body.event).toBe('transaction.status.updated');
  });
});
```

---

### Phase 5 Checklist

- [ ] WebhooksService tests written (6 tests)
- [ ] WebhooksController tests written (4 tests)
- [ ] NotificationService tests written (3 tests)
- [ ] StatusService tests updated (5 new tests)
- [ ] E2E tests written (6 scenarios)
- [ ] All Unit tests passing (`pnpm test`)
- [ ] All E2E tests passing (`pnpm test:e2e`)
- [ ] Test coverage ≥85% (`pnpm test:cov`)

---

## Deployment and Verification

### Pre-deployment Checklist

- [ ] All tests passing (`pnpm test && pnpm test:e2e`)
- [ ] Linting passed (`pnpm lint`)
- [ ] Build successful (`pnpm build`)
- [ ] Prisma migration files committed
- [ ] `.env.example` update completed
- [ ] Swagger documentation accessible (`/api`)

### Deployment Process (Phase 2)

**1. Docker Compose Execution**:
```bash
# Start all services with Phase 2 profile
docker compose --profile phase2 up -d

# Wait for MySQL health check
docker compose ps
```

**2. Prisma Migration (Production)**:
```bash
# Apply migration in production environment
cd packages/relay-api
pnpm prisma migrate deploy
```

**3. Service Verification**:
```bash
# Health Check
curl http://localhost:8080/api/v1/health

# Webhook endpoint verification
curl -X POST http://localhost:8080/api/v1/webhooks/oz-relayer \
  -H "Content-Type: application/json" \
  -H "X-OZ-Signature: test-signature" \
  -d '{"transactionId": "test", "status": "pending", "createdAt": "2025-12-30T00:00:00Z"}'
# Expected: 401 Unauthorized (invalid signature)
```

**4. MySQL Data Verification**:
```bash
# Connect to MySQL
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer

# Query transactions
SELECT * FROM transactions LIMIT 10;
```

---

## Success Criteria

### Technical Verification

- [ ] Redis connection successful (sharing existing Redis instance)
- [ ] MySQL service running normally (Docker Compose)
- [ ] Prisma migration applied
- [ ] Webhook endpoint responding normally (POST /webhooks/oz-relayer)
- [ ] HMAC signature verification working (valid signature: 200, invalid: 401)
- [ ] DirectService → Redis + MySQL storage verified
- [ ] GaslessService → Redis + MySQL storage verified
- [ ] StatusService Redis cache hit verified (<5ms)
- [ ] StatusService 3-Tier Lookup verified (Redis → MySQL → OZ Relayer)
- [ ] Webhook → Redis + MySQL update and TTL reset verified
- [ ] Notification delivery verified (Mock Client)

### Functional Verification

- [ ] Transaction creation → Redis (L1) + MySQL (L2) storage
- [ ] Webhook reception → Redis + MySQL update
- [ ] Status query → Redis cache priority lookup (Tier 1)
- [ ] Redis miss → MySQL lookup (Tier 2) + Redis backfill
- [ ] MySQL miss → OZ Relayer API fallback (Tier 3)
- [ ] Client notification delivery (on status change)

### Code Quality

- [ ] Test coverage ≥85% (Unit + E2E)
- [ ] ESLint rules compliance
- [ ] Prettier format applied
- [ ] JSDoc comments written
- [ ] Swagger documentation completeness

---

## Phase 3+ Migration Path

### Phase 3: Queue-Based Notification (Optional)

**SPEC-QUEUE-001** (Separate SPEC):
- BullMQ/SQS integration
- Notification retry logic (exponential backoff)
- Dead Letter Queue (DLQ) handling
- Batch notification processing

### Phase 4: Transaction Analytics (Optional)

**SPEC-ANALYTICS-001** (Separate SPEC):
- Transaction statistics aggregation (success rate, average confirmation time)
- Grafana dashboard
- Prometheus metrics collection
- Alert functionality (Slack/Discord)

---

## Code Review Checklist

### Before PR Submission

- [ ] HMAC signature verification logic accuracy
- [ ] Redis TTL configuration accuracy (REDIS_STATUS_TTL_SECONDS)
- [ ] Redis key pattern consistency (`tx:status:{txId}`)
- [ ] Prisma schema index optimization
- [ ] MySQL query performance verification (EXPLAIN)
- [ ] Notification failure handling (non-blocking)
- [ ] StatusService cache TTL appropriateness (5 seconds)
- [ ] Environment variable security (WEBHOOK_SIGNING_KEY 32+ characters)
- [ ] Docker Compose profile strategy accuracy
- [ ] Test coverage ≥85%
- [ ] Swagger documentation completeness

### Reviewer Focus Areas

- [ ] HMAC algorithm implementation accuracy (crypto.timingSafeEqual)
- [ ] Redis 3-Tier Lookup logic accuracy
- [ ] Redis TTL reset behavior (on Webhook reception)
- [ ] Prisma upsert logic (idempotency guarantee)
- [ ] StatusService 3-Tier fallback strategy
- [ ] MySQL index effectiveness verification
- [ ] Notification async processing (Promise management)

---

## References

### Internal Documents

- SPEC-STATUS-001: Transaction Status Polling API
- SPEC-TEST-001: Integration Tests
- SPEC-PROXY-001: Nginx Load Balancer

### External Documents

- Prisma ORM: https://www.prisma.io/docs
- NestJS Guards: https://docs.nestjs.com/guards
- HMAC-SHA256: https://nodejs.org/api/crypto.html#crypto_crypto_createhmac_algorithm_key_options
- MySQL 8.0: https://dev.mysql.com/doc/refman/8.0/en/
- OZ Relayer Webhooks: https://docs.openzeppelin.com/defender/relay#webhooks
- ioredis: https://github.com/redis/ioredis

---

**Version**: 1.2.0
**Status**: Complete
**Last Updated**: 2026-01-02

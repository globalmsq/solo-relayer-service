---
id: SPEC-WEBHOOK-001
title: TX History & Webhook System - Implementation Plan
version: 1.0.0
status: draft
created: 2025-12-30
updated: 2025-12-30
---

# Implementation Plan: SPEC-WEBHOOK-001

## 📋 개요

**목표**: MySQL + Prisma 기반 트랜잭션 이력 저장 및 OZ Relayer Webhook 시스템 구현

**범위**: Phase 2 - MySQL 저장, Webhook 수신, HTTP 기반 Notification

**예상 시간**: 4-6시간 (24개 파일, ~800 LOC)

---

## 🎯 기술적 접근

### 핵심 설계 원칙

**원칙 1: 이중화된 상태 관리**
- MySQL: 1차 데이터 소스 (빠른 조회, 영구 저장)
- OZ Relayer API: 2차 fallback (데이터 일관성 보장)

**원칙 2: HMAC 서명 기반 보안**
- Option B: OZ Relayer가 서명 → 우리가 검증
- HMAC-SHA256 알고리즘 (3줄 코드 구현 가능)
- NestJS Guard 패턴 활용

**원칙 3: 단계적 확장성**
- Phase 2: HTTP 기반 Notification (간단, 빠름)
- Phase 3+: BullMQ/SQS Queue (확장성, 재시도)

### 주요 설계 결정사항

**결정 1: Prisma ORM 선택**
- TypeScript 타입 안전성 보장
- 자동 마이그레이션 관리
- NestJS 공식 권장 ORM

**결정 2: Docker Compose Profile 전략**
- `profile: phase2` → MySQL 서비스 선택적 실행
- Phase 1 유지 (MySQL 없이도 동작)
- Phase 2+ 활성화 (`--profile phase2` 옵션)

**결정 3: StatusService 확장 전략**
- 기존 코드 최소 수정
- MySQL 캐시 레이어 추가
- 5초 캐시 TTL (실시간성 유지)

---

## 🔴 Phase 0: Dependency Update (30분)

### 목표
Task #15 (BullMQ) 종속성 제거 및 Task #14 범위 명확화

### 작업 내역
1. **Task #14 종속성 업데이트**
   - 제거: Task #15 (Queue System)
   - 유지: Task #11 (Integration Tests)

2. **Phase 2 범위 정의**
   - HTTP 기반 Notification Service 사용
   - BullMQ 없이 구현 가능

3. **Phase 3+ 계획**
   - BullMQ/SQS 추가 (선택적 확장)
   - Notification 재시도 로직 강화

### 검증
```bash
# Task #14 설명 확인
cat .taskmaster/tasks/task-14.txt

# 종속성 확인 (Task #11만 존재)
grep -r "dependencies" .taskmaster/tasks/task-14.txt
```

---

## 📂 Phase 1: Infrastructure Setup (1-1.5시간)

### 1.1 Prisma 의존성 설치

**파일**: `packages/relay-api/package.json`

**추가 의존성**:
```json
{
  "dependencies": {
    "@prisma/client": "^5.21.1"
  },
  "devDependencies": {
    "prisma": "^5.21.1"
  }
}
```

**실행**:
```bash
cd packages/relay-api
pnpm add @prisma/client
pnpm add -D prisma
```

---

### 1.2 Prisma Schema 정의

**파일**: `packages/relay-api/prisma/schema.prisma` (New)

**내용**:
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

**설계 포인트**:
- `id`: UUID v4 (OZ Relayer 트랜잭션 ID와 동일)
- `hash`: Unique 제약 (중복 방지)
- `status`: 인덱스 (빠른 상태 조회)
- `data`: TEXT 타입 (ABI 인코딩된 데이터 저장)

---

### 1.3 Docker Compose 업데이트

**파일**: `docker/docker-compose.yaml` (Modified)

**추가 서비스**:
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

**변경 사항**:
- MySQL 서비스 추가 (`profiles: ["phase2"]`)
- relay-api 의존성에 MySQL 추가
- Volume 추가 (데이터 영구 보존)

---

### 1.4 환경변수 설정

**파일**: `.env.example` (Modified)

**추가 변수**:
```bash
# === Phase 2: MySQL Database ===
DATABASE_URL="mysql://relayer_user:secure-user-password@localhost:3306/msq_relayer"
MYSQL_ROOT_PASSWORD=secure-root-password
MYSQL_PASSWORD=secure-user-password

# === Phase 2: Webhook Security ===
WEBHOOK_SIGNING_KEY=your-secure-signing-key-must-be-32-characters-long

# === Phase 2: Client Notification ===
CLIENT_WEBHOOK_URL=http://localhost:9000/webhooks/transaction-updates
```

**파일**: `.env` (Create locally, not in Git)
```bash
cp .env.example .env
# Edit .env with actual values
```

---

### 1.5 Prisma Migration 실행

**명령어**:
```bash
# MySQL 서비스 시작 (phase2 profile)
docker compose --profile phase2 up -d mysql

# Prisma 초기 마이그레이션
cd packages/relay-api
pnpm prisma migrate dev --name init

# Prisma Client 생성
pnpm prisma generate
```

**검증**:
```bash
# MySQL 연결 확인
docker exec -it msq-relayer-mysql mysql -u relayer_user -p -e "SHOW DATABASES;"

# 테이블 확인
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer -e "SHOW TABLES;"

# 스키마 확인
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer -e "DESCRIBE transactions;"
```

---

### Phase 1 체크리스트

- [ ] Prisma 의존성 설치 완료 (`@prisma/client`, `prisma`)
- [ ] `schema.prisma` 파일 생성 및 Transaction 모델 정의
- [ ] Docker Compose에 MySQL 서비스 추가 (profile: phase2)
- [ ] `.env.example` 업데이트 (DATABASE_URL, MYSQL_PASSWORD)
- [ ] `.env` 파일 생성 (로컬 개발 환경)
- [ ] MySQL 서비스 실행 성공
- [ ] Prisma 마이그레이션 적용 (`pnpm prisma migrate dev`)
- [ ] Prisma Client 생성 (`pnpm prisma generate`)
- [ ] MySQL 테이블 생성 확인 (`transactions` 테이블 존재)

---

## 🔨 Phase 2: Webhook Module Implementation (1.5-2시간)

### 2.1 DTO 정의

**파일 1**: `packages/relay-api/src/webhooks/dto/oz-relayer-webhook.dto.ts` (New)

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

**파일 2**: `packages/relay-api/src/webhooks/dto/notification.dto.ts` (New)

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

**파일**: `packages/relay-api/src/webhooks/guards/webhook-signature.guard.ts` (New)

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

**핵심 코드** (3줄):
```typescript
const expectedSignature = crypto
  .createHmac('sha256', signingKey)
  .update(payload)
  .digest('hex');
```

---

### 2.3 Webhooks Service

**파일**: `packages/relay-api/src/webhooks/webhooks.service.ts` (New)

```typescript
import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { OzRelayerWebhookDto } from './dto/oz-relayer-webhook.dto';
import { NotificationService } from './notification.service';

/**
 * WebhooksService
 * Handles OZ Relayer webhook requests and updates MySQL
 *
 * SPEC-WEBHOOK-001: Webhook processing with MySQL upsert
 */
@Injectable()
export class WebhooksService {
  private readonly prisma = new PrismaClient();

  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Process OZ Relayer webhook and update transaction status
   *
   * @param dto - Webhook payload from OZ Relayer
   * @throws NotFoundException if transaction does not exist
   * @throws InternalServerErrorException if database update fails
   */
  async handleWebhook(dto: OzRelayerWebhookDto): Promise<void> {
    try {
      // Upsert transaction in MySQL (create if not exists, update otherwise)
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
}
```

---

### 2.4 Notification Service (HTTP 방식)

**파일**: `packages/relay-api/src/webhooks/notification.service.ts` (New)

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

**특징**:
- 비동기 알림 (Webhook 처리 블로킹 방지)
- 실패 시 로그만 기록 (Phase 3+에서 재시도 로직 추가)
- 타임아웃 5초 (빠른 실패)

---

### 2.5 Webhooks Controller

**파일**: `packages/relay-api/src/webhooks/webhooks.controller.ts` (New)

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

**보안 레이어**:
- `@UseGuards(WebhookSignatureGuard)` - HMAC 서명 자동 검증
- 서명 검증 실패 시 401 Unauthorized 자동 반환
- Guard에서 검증되므로 Controller/Service는 순수 비즈니스 로직만 처리

---

### 2.6 Webhooks Module

**파일**: `packages/relay-api/src/webhooks/webhooks.module.ts` (New)

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

### 2.7 App Module 업데이트

**파일**: `packages/relay-api/src/app.module.ts` (Modified)

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

### Phase 2 체크리스트

- [ ] `OzRelayerWebhookDto` 정의 (Validation 포함)
- [ ] `NotificationDto` 정의
- [ ] `WebhookSignatureGuard` 구현 (HMAC 검증)
- [ ] `WebhooksService` 구현 (MySQL upsert)
- [ ] `NotificationService` 구현 (HTTP POST)
- [ ] `WebhooksController` 구현 (POST /webhooks/oz-relayer)
- [ ] `WebhooksModule` 생성
- [ ] `AppModule` 업데이트 (WebhooksModule import)
- [ ] 빌드 성공 (`pnpm build`)
- [ ] Linting 통과 (`pnpm lint`)

---

## 🔗 Phase 3: Notification Service (HTTP 방식) (30분)

이미 Phase 2에서 구현 완료 (`notification.service.ts`)

### 추가 작업: Mock Client Service 설정 (테스트용)

**Docker Compose 추가** (Optional, for E2E testing):
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

## 🔄 Phase 4: StatusService + DirectService + GaslessService 통합 (1-1.5시간)

### 4.1 StatusService 확장 (MySQL 캐시 추가)

**파일**: `packages/relay-api/src/relay/status/status.service.ts` (Modified)

**변경 전** (Phase 1):
```typescript
async getTransactionStatus(txId: string): Promise<TxStatusResponseDto> {
  // Direct HTTP call to OZ Relayer
  const response = await firstValueFrom(this.httpService.get(ozRelayerUrl));
  return this.transformToDto(response.data);
}
```

**변경 후** (Phase 2):
```typescript
import { PrismaClient } from '@prisma/client';

@Injectable()
export class StatusService {
  private readonly prisma = new PrismaClient();
  private readonly CACHE_TTL_MS = 5000; // 5초 캐시

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly ozRelayerService: OzRelayerService,
  ) {}

  /**
   * Query transaction status with MySQL cache + OZ Relayer fallback
   *
   * SPEC-WEBHOOK-001: MySQL first, OZ Relayer fallback
   */
  async getTransactionStatus(txId: string): Promise<TxStatusResponseDto> {
    // 1. Try MySQL cache first
    const cached = await this.prisma.transaction.findUnique({
      where: { id: txId },
    });

    // 2. If cache is fresh (updated within 5 seconds), return immediately
    if (cached && (Date.now() - cached.updatedAt.getTime() < this.CACHE_TTL_MS)) {
      return this.transformPrismaToDto(cached);
    }

    // 3. Cache miss or stale → Fetch from OZ Relayer
    try {
      const fresh = await this.fetchFromOzRelayer(txId);

      // 4. Update MySQL cache
      await this.prisma.transaction.upsert({
        where: { id: txId },
        update: {
          hash: fresh.hash,
          status: fresh.status,
          from: fresh.from,
          to: fresh.to,
          value: fresh.value,
          confirmedAt: fresh.confirmedAt ? new Date(fresh.confirmedAt) : null,
          updatedAt: new Date(),
        },
        create: {
          id: fresh.transactionId,
          hash: fresh.hash,
          status: fresh.status,
          from: fresh.from,
          to: fresh.to,
          value: fresh.value,
          createdAt: new Date(fresh.createdAt),
          confirmedAt: fresh.confirmedAt ? new Date(fresh.confirmedAt) : null,
        },
      });

      return fresh;
    } catch (error) {
      // 5. OZ Relayer failed → Return stale cache if available (degraded mode)
      if (cached) {
        return this.transformPrismaToDto(cached);
      }
      throw error; // Both MySQL and OZ Relayer failed
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

**핵심 로직**:
1. MySQL 우선 조회 (빠름)
2. 5초 TTL 검증 (최신성 보장)
3. Stale 시 OZ Relayer fallback
4. OZ Relayer 응답으로 MySQL 업데이트
5. 둘 다 실패 시 stale cache 반환 (degraded mode)

---

### 4.2 DirectService 확장 (MySQL 저장 추가)

**파일**: `packages/relay-api/src/relay/direct/direct.service.ts` (Modified)

**추가 코드** (sendTransaction 메서드 수정):
```typescript
import { PrismaClient } from '@prisma/client';

@Injectable()
export class DirectService {
  private readonly prisma = new PrismaClient();

  // ... (existing code)

  async sendTransaction(dto: DirectTxDto): Promise<DirectTxResponseDto> {
    // 1. Send transaction to OZ Relayer (existing logic)
    const ozResponse = await firstValueFrom(
      this.httpService.post(ozRelayerUrl, payload, config),
    );

    const transactionId = ozResponse.data.data?.id || ozResponse.data.id;

    // 2. Save to MySQL (NEW)
    await this.prisma.transaction.create({
      data: {
        id: transactionId,
        status: 'pending',
        to: dto.to,
        value: dto.value,
        data: dto.data,
        createdAt: new Date(),
      },
    });

    // 3. Return response (existing)
    return {
      transactionId,
      hash: ozResponse.data.data?.hash || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }
}
```

---

### 4.3 GaslessService 확장 (MySQL 저장 추가)

**파일**: `packages/relay-api/src/relay/gasless/gasless.service.ts` (Modified)

**추가 코드** (동일한 패턴):
```typescript
import { PrismaClient } from '@prisma/client';

@Injectable()
export class GaslessService {
  private readonly prisma = new PrismaClient();

  // ... (existing code)

  async sendGaslessTransaction(dto: GaslessTxDto): Promise<GaslessTxResponseDto> {
    // 1. Forward to ERC2771 (existing logic)
    const ozResponse = await firstValueFrom(
      this.httpService.post(ozRelayerUrl, payload, config),
    );

    const transactionId = ozResponse.data.data?.id || ozResponse.data.id;

    // 2. Save to MySQL (NEW)
    await this.prisma.transaction.create({
      data: {
        id: transactionId,
        status: 'pending',
        to: this.configService.get<string>('FORWARDER_ADDRESS'), // Forwarder address
        value: '0', // Gasless transactions have value=0
        data: dto.data, // ABI-encoded forward request
        createdAt: new Date(),
      },
    });

    // 3. Return response (existing)
    return {
      transactionId,
      hash: ozResponse.data.data?.hash || null,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }
}
```

---

### Phase 4 체크리스트

- [ ] `StatusService` MySQL 캐시 로직 추가
- [ ] `DirectService` MySQL 저장 로직 추가
- [ ] `GaslessService` MySQL 저장 로직 추가
- [ ] Prisma import 추가 (`@prisma/client`)
- [ ] 빌드 성공 (`pnpm build`)
- [ ] 기존 테스트 통과 (regression 방지)

---

## 🧪 Phase 5: Testing (Unit + E2E) (1.5-2시간)

### 5.1 Webhooks Service Unit Tests

**파일**: `packages/relay-api/src/webhooks/webhooks.service.spec.ts` (New)

**테스트 케이스** (6 tests):
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

**파일**: `packages/relay-api/src/webhooks/webhooks.controller.spec.ts` (New)

**테스트 케이스** (4 tests):
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

**파일**: `packages/relay-api/src/webhooks/notification.service.spec.ts` (New)

**테스트 케이스** (3 tests):
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

**파일**: `packages/relay-api/src/relay/status/status.service.spec.ts` (Modified)

**추가 테스트 케이스** (5 new tests):
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

**파일**: `packages/relay-api/test/webhooks.e2e-spec.ts` (New)

**시나리오** (6 tests):
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

### Phase 5 체크리스트

- [ ] WebhooksService 테스트 작성 (6 tests)
- [ ] WebhooksController 테스트 작성 (4 tests)
- [ ] NotificationService 테스트 작성 (3 tests)
- [ ] StatusService 테스트 업데이트 (5 new tests)
- [ ] E2E 테스트 작성 (6 scenarios)
- [ ] 모든 Unit 테스트 통과 (`pnpm test`)
- [ ] 모든 E2E 테스트 통과 (`pnpm test:e2e`)
- [ ] 테스트 커버리지 ≥85% (`pnpm test:cov`)

---

## 🚀 배포 및 검증

### Pre-deployment Checklist

- [ ] 모든 테스트 통과 (`pnpm test && pnpm test:e2e`)
- [ ] Linting 통과 (`pnpm lint`)
- [ ] 빌드 성공 (`pnpm build`)
- [ ] Prisma 마이그레이션 파일 커밋
- [ ] `.env.example` 업데이트 완료
- [ ] Swagger 문서 접근 가능 (`/api`)

### Deployment Process (Phase 2)

**1. Docker Compose 실행**:
```bash
# Phase 2 프로파일로 모든 서비스 시작
docker compose --profile phase2 up -d

# MySQL 헬스체크 대기
docker compose ps
```

**2. Prisma Migration (Production)**:
```bash
# Production 환경에서 마이그레이션 적용
cd packages/relay-api
pnpm prisma migrate deploy
```

**3. 서비스 검증**:
```bash
# Health Check
curl http://localhost:8080/api/v1/health

# Webhook 엔드포인트 확인
curl -X POST http://localhost:8080/api/v1/webhooks/oz-relayer \
  -H "Content-Type: application/json" \
  -H "X-OZ-Signature: test-signature" \
  -d '{"transactionId": "test", "status": "pending", "createdAt": "2025-12-30T00:00:00Z"}'
# Expected: 401 Unauthorized (invalid signature)
```

**4. MySQL 데이터 확인**:
```bash
# MySQL 접속
docker exec -it msq-relayer-mysql mysql -u relayer_user -p msq_relayer

# 트랜잭션 조회
SELECT * FROM transactions LIMIT 10;
```

---

## 📊 성공 기준

### 기술적 검증

- [ ] MySQL 서비스 정상 실행 (Docker Compose)
- [ ] Prisma 마이그레이션 적용 완료
- [ ] Webhook 엔드포인트 정상 응답 (POST /webhooks/oz-relayer)
- [ ] HMAC 서명 검증 동작 (유효한 서명: 200, 무효: 401)
- [ ] DirectService → MySQL 저장 확인
- [ ] GaslessService → MySQL 저장 확인
- [ ] StatusService MySQL 캐시 히트 확인
- [ ] StatusService OZ Relayer fallback 확인
- [ ] Notification 전송 확인 (Mock Client)

### 기능적 검증

- [ ] 트랜잭션 생성 → MySQL 저장
- [ ] Webhook 수신 → MySQL 업데이트
- [ ] 상태 조회 → MySQL 캐시 우선 조회
- [ ] Stale 캐시 → OZ Relayer API fallback
- [ ] Client 알림 전송 (상태 변경 시)

### 코드 품질

- [ ] 테스트 커버리지 ≥85% (Unit + E2E)
- [ ] ESLint 규칙 준수
- [ ] Prettier 포맷 적용
- [ ] JSDoc 주석 작성
- [ ] Swagger 문서 완성도

---

## 🔄 Phase 3+ Migration Path

### Phase 3: Queue 기반 Notification (Optional)

**SPEC-QUEUE-001** (별도 SPEC):
- BullMQ/SQS 통합
- Notification 재시도 로직 (exponential backoff)
- Dead Letter Queue (DLQ) 처리
- 대량 알림 배치 처리

### Phase 4: Transaction Analytics (Optional)

**SPEC-ANALYTICS-001** (별도 SPEC):
- 트랜잭션 통계 집계 (성공률, 평균 확인 시간)
- Grafana 대시보드
- Prometheus 메트릭 수집
- 알림 기능 (Slack/Discord)

---

## 📝 코드 리뷰 체크리스트

### Before PR Submission

- [ ] HMAC 서명 검증 로직 정확성
- [ ] Prisma schema 인덱스 최적화
- [ ] MySQL 쿼리 성능 검증 (EXPLAIN)
- [ ] Notification 실패 처리 (non-blocking)
- [ ] StatusService 캐시 TTL 적절성 (5초)
- [ ] 환경변수 보안 (WEBHOOK_SIGNING_KEY 32자 이상)
- [ ] Docker Compose profile 전략 정확성
- [ ] 테스트 커버리지 ≥85%
- [ ] Swagger 문서 완성도

### Reviewer Focus Areas

- [ ] HMAC 알고리즘 구현 정확성 (crypto.timingSafeEqual)
- [ ] Prisma upsert 로직 (idempotency 보장)
- [ ] StatusService fallback 전략 (degraded mode)
- [ ] MySQL 인덱스 효과 검증
- [ ] Notification 비동기 처리 (Promise 관리)

---

## 📚 참고 자료

### 내부 문서

- SPEC-STATUS-001: Transaction Status Polling API
- SPEC-TEST-001: Integration Tests
- SPEC-PROXY-001: Nginx Load Balancer

### 외부 문서

- Prisma ORM: https://www.prisma.io/docs
- NestJS Guards: https://docs.nestjs.com/guards
- HMAC-SHA256: https://nodejs.org/api/crypto.html#crypto_crypto_createhmac_algorithm_key_options
- MySQL 8.0: https://dev.mysql.com/doc/refman/8.0/en/
- OZ Relayer Webhooks: https://docs.openzeppelin.com/defender/relay#webhooks

---

**Version**: 1.0.0
**Status**: Draft
**Last Updated**: 2025-12-30

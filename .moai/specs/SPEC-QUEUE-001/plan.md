---
id: SPEC-QUEUE-001
title: "Implementation Plan - AWS SQS Queue System"
version: "1.0.0"
created: "2026-01-04"
updated: "2026-01-04"
---

# Implementation Plan: AWS SQS 비동기 트랜잭션 큐 시스템

## 구현 개요

AWS SQS Standard Queue 기반 비동기 트랜잭션 큐 시스템을 8개 Phase로 구현합니다. Producer (relay-api)와 Consumer (queue-consumer)를 독립 서비스로 분리하여 확장성과 가용성을 확보합니다.

**⚠️ Breaking Change**: 이 구현은 기존 동기 API를 비동기로 전환합니다. 클라이언트 마이그레이션이 필요합니다.

---

## Phase 0: Prerequisites (Prisma Schema Migration)

### 목표
SQS Queue 시스템에 필요한 4개 필드를 Transaction 모델에 추가합니다.

### 구현 단계

#### 0.1 Prisma 스키마 수정

**파일**: `packages/relay-api/prisma/schema.prisma`

**작업**:
- Transaction 모델에 4개 필드 추가: type, request, result, error_message
- 인덱스 추가: status, type, createdAt

```prisma
model Transaction {
  id            String    @id @default(uuid())
  hash          String?   @unique
  status        String    // pending, sent, submitted, inmempool, mined, confirmed, failed
  from          String?
  to            String?
  value         String?
  data          String?   @db.Text

  // ▼ 새로 추가할 필드 (SPEC-QUEUE-001)
  type          String?   // 'direct' | 'gasless'
  request       Json?     // 원본 DirectTxRequestDto JSON
  result        Json?     // OZ Relayer 응답 { hash, transactionId }
  error_message String?   @db.Text // 실패 시 에러 메시지
  // ▲ 새로 추가할 필드

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  confirmedAt   DateTime?

  // 인덱싱 추가 (성능 최적화)
  @@index([status])
  @@index([type])
  @@index([createdAt])
}
```

#### 0.2 마이그레이션 실행

**명령어**:
```bash
# 스키마 변경 적용
npx prisma migrate dev --name add-queue-fields

# 타입 생성 및 클라이언트 재생성
npx prisma generate
```

### 검증

- [ ] Migration 파일 생성: `prisma/migrations/add-queue-fields/`
- [ ] DB에 4개 새 컬럼 생성 확인
- [ ] Prisma Client 타입 업데이트 확인
- [ ] 기존 테스트 통과 확인

---

## Phase 1: Docker Infrastructure (LocalStack)

### 목표
LocalStack 서비스를 Docker Compose에 추가하고 SQS 큐를 자동 생성합니다.

### 구현 단계

#### 1.1 LocalStack 서비스 추가

**파일**: `docker/docker-compose.yaml`

**작업**:
- mysql 서비스 뒤에 localstack 서비스 추가 (~line 117)
- LocalStack 3.0 이미지 사용
- Port 4566 노출 (Web UI + API)
- SQS만 활성화 (SERVICES=sqs)
- Health Check 설정

**환경변수** (하드코딩):
```yaml
environment:
  SERVICES: sqs
  DEBUG: "0"
  AWS_DEFAULT_REGION: ap-northeast-2
  AWS_ACCESS_KEY_ID: test
  AWS_SECRET_ACCESS_KEY: test
  SQS_ENDPOINT_URL: http://localhost:4566
```

**Health Check**:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 15s
```

#### 1.2 relay-api 의존성 및 환경변수 추가

**작업**:
- relay-api의 `depends_on`에 localstack 추가
- SQS 관련 환경변수 하드코딩

**환경변수** (하드코딩):
```yaml
environment:
  AWS_REGION: ap-northeast-2
  AWS_ACCESS_KEY_ID: test
  AWS_SECRET_ACCESS_KEY: test
  SQS_ENDPOINT_URL: http://localstack:4566
  SQS_QUEUE_URL: http://localstack:4566/000000000000/relay-transactions
  SQS_DLQ_URL: http://localstack:4566/000000000000/relay-transactions-dlq
```

#### 1.3 queue-consumer 서비스 추가

**작업**:
- 새로운 queue-consumer 서비스 정의
- relay-api와 동일한 네트워크 사용
- LocalStack, MySQL, OZ Relayer 의존성 설정

**환경변수** (하드코딩):
```yaml
environment:
  NODE_ENV: development
  AWS_REGION: ap-northeast-2
  AWS_ACCESS_KEY_ID: test
  AWS_SECRET_ACCESS_KEY: test
  SQS_ENDPOINT_URL: http://localstack:4566
  SQS_QUEUE_URL: http://localstack:4566/000000000000/relay-transactions
  SQS_DLQ_URL: http://localstack:4566/000000000000/relay-transactions-dlq
  DATABASE_URL: mysql://root:pass@mysql:3306/msq_relayer
  REDIS_URL: redis://redis:6379
  OZ_RELAYER_URL: http://oz-relayer-1:8080
  OZ_RELAYER_API_KEY: oz-relayer-shared-api-key-local-dev
```

#### 1.4 LocalStack Volume 추가

**작업**:
- `volumes` 섹션에 `localstack-data` 추가

```yaml
volumes:
  localstack-data:
    driver: local
```

#### 1.5 LocalStack Init Script 작성

**파일**: `docker/scripts/init-localstack.sh` (신규)

**작업**:
1. DLQ 큐 생성: `relay-transactions-dlq`
2. DLQ ARN 조회
3. Main Queue 생성: `relay-transactions` (DLQ redrive 정책 포함)
4. Redrive Policy: maxReceiveCount=3

**스크립트**:
```bash
#!/bin/bash
set -e

echo "Initializing SQS queues for LocalStack..."
export AWS_DEFAULT_REGION=ap-northeast-2

# Create DLQ
echo "Creating DLQ: relay-transactions-dlq"
awslocal sqs create-queue --queue-name relay-transactions-dlq

# Get DLQ ARN
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/relay-transactions-dlq \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

echo "DLQ ARN: $DLQ_ARN"

# Create main queue with DLQ redrive policy
echo "Creating main queue: relay-transactions"
awslocal sqs create-queue --queue-name relay-transactions \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"

echo "SQS queues created successfully!"
awslocal sqs list-queues
```

#### 1.6 Dockerfile.packages 수정

**파일**: `docker/Dockerfile.packages`

**작업**:
- queue-consumer 빌드 타겟 추가

```dockerfile
# === Queue Consumer ===
FROM base AS queue-consumer
WORKDIR /app/packages/queue-consumer
CMD ["pnpm", "run", "start"]
```

### 검증

- [ ] `docker-compose up localstack` 성공
- [ ] LocalStack Web UI 접속: `http://localhost:4566`
- [ ] SQS 큐 2개 생성 확인: `relay-transactions`, `relay-transactions-dlq`
- [ ] Health Check 통과

---

## Phase 2: Package Structure (queue-consumer 패키지 생성)

### 목표
queue-consumer를 독립 패키지로 생성하고 기본 구조를 설정합니다.

### 구현 단계

#### 2.1 패키지 초기화

**디렉토리**: `packages/queue-consumer/`

**파일 생성**:
1. `package.json` - NestJS 의존성 포함
2. `tsconfig.json` - TypeScript 설정
3. `src/main.ts` - Entry point
4. `src/consumer.module.ts` - NestJS module
5. `src/config/configuration.ts` - 환경변수 설정

**package.json**:
```json
{
  "name": "@msq-relayer/queue-consumer",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "nest start",
    "start:dev": "nest start --watch",
    "build": "nest build",
    "test": "jest"
  },
  "dependencies": {
    "@nestjs/common": "^10.x",
    "@nestjs/core": "^10.x",
    "@nestjs/config": "^3.x",
    "@aws-sdk/client-sqs": "^3.700.0",
    "axios": "^1.x"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.x",
    "aws-sdk-client-mock": "^3.0.0",
    "jest": "^29.x"
  }
}
```

#### 2.2 디렉토리 구조

```
packages/queue-consumer/
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts               # Entry point
│   ├── consumer.module.ts    # NestJS module
│   ├── consumer.service.ts   # SQS Long-polling Consumer
│   ├── sqs/
│   │   └── sqs.adapter.ts    # AWS SDK wrapper
│   ├── relay/
│   │   └── oz-relayer.client.ts  # OZ Relayer HTTP client
│   └── config/
│       └── configuration.ts
└── test/
    └── consumer.service.spec.ts
```

### 검증

- [ ] `pnpm install` 성공
- [ ] `pnpm run build` 성공
- [ ] TypeScript 컴파일 오류 없음

---

## Phase 3: relay-api Queue Producer

### 목표
relay-api에 Queue Producer 모듈을 추가하여 SQS에 메시지를 전송합니다.

### 구현 단계

#### 3.1 의존성 추가

**파일**: `packages/relay-api/package.json`

**작업**:
```json
{
  "dependencies": {
    "@aws-sdk/client-sqs": "^3.700.0"
  },
  "devDependencies": {
    "aws-sdk-client-mock": "^3.0.0"
  }
}
```

#### 3.2 Queue 모듈 생성

**디렉토리**: `packages/relay-api/src/queue/`

**파일 생성**:
1. `queue.module.ts` - NestJS module
2. `queue.service.ts` - Enqueue 서비스
3. `sqs/sqs.adapter.ts` - AWS SDK wrapper
4. `sqs/sqs.health.ts` - Health indicator
5. `interfaces/queue-message.interface.ts` - 타입 정의
6. `dto/queue-message.dto.ts` - DTO

**queue.service.ts 핵심 로직**:
```typescript
async enqueueTransaction(message: QueueMessageDto): Promise<void> {
  const command = new SendMessageCommand({
    QueueUrl: this.configService.get('SQS_QUEUE_URL'),
    MessageBody: JSON.stringify(message),
  });

  await this.sqsAdapter.send(command);
}
```

**sqs.adapter.ts 핵심 로직** (Dual Credentials):
```typescript
const endpoint = this.configService.get('SQS_ENDPOINT_URL');
const region = this.configService.get('AWS_REGION', 'ap-northeast-2');
const isLocal = !!endpoint;

this.client = new SQSClient(
  isLocal
    ? {
        endpoint,
        region,
        credentials: {
          accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID', 'test'),
          secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY', 'test'),
        },
      }
    : {
        region,
        // Production: IAM Instance Role credentials 자동 로드
      }
);
```

#### 3.3 Configuration 수정

**파일**: `packages/relay-api/src/config/configuration.ts`

**작업**:
```typescript
export default () => ({
  // ... existing
  queue: {
    sqs: {
      endpoint: process.env.SQS_ENDPOINT_URL,
      queueUrl: process.env.SQS_QUEUE_URL,
      dlqUrl: process.env.SQS_DLQ_URL,
      region: process.env.AWS_REGION || 'ap-northeast-2',
    },
  },
});
```

#### 3.4 App Module 수정

**파일**: `packages/relay-api/src/app.module.ts`

**작업**:
- QueueModule import 추가

```typescript
@Module({
  imports: [
    // ... existing
    QueueModule,
  ],
})
export class AppModule {}
```

#### 3.5 .env.example 수정

**파일**: `packages/relay-api/.env.example`

**작업**:
```bash
# ===========================================
# SQS Configuration (로컬 개발용 - LocalStack)
# ===========================================
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_ENDPOINT_URL=http://localhost:4566
SQS_QUEUE_URL=http://localhost:4566/000000000000/relay-transactions
SQS_DLQ_URL=http://localhost:4566/000000000000/relay-transactions-dlq

# ===========================================
# SQS Configuration (Production - IAM Role)
# ===========================================
# AWS_REGION=ap-northeast-2
# SQS_QUEUE_URL=https://sqs.ap-northeast-2.amazonaws.com/123456789012/relay-transactions
# SQS_DLQ_URL=https://sqs.ap-northeast-2.amazonaws.com/123456789012/relay-transactions-dlq
# Note: SQS_ENDPOINT_URL 설정 안함 → IAM Role 사용
```

### 검증

- [ ] Unit Test: `queue.service.spec.ts` (aws-sdk-client-mock 사용)
- [ ] SQS 메시지 전송 성공
- [ ] LocalStack Web UI에서 메시지 확인

---

## Phase 4: queue-consumer Service 구현

### 목표
queue-consumer의 핵심 로직 (SQS Long-polling + OZ Relayer 전송)을 구현합니다.

### MySQL 접근 전략

**방식**: 직접 Prisma 연결 (relay-api와 독립적인 별도 Prisma Client 인스턴스)

**장점**:
- API 호출 오버헤드 없음
- 높은 처리량 보장
- 트랜잭션 상태 즉시 업데이트 가능

**주의사항**:
- 동일한 Prisma 스키마 참조 (packages/relay-api/prisma/schema.prisma)
- 두 프로세스가 동시에 같은 트랜잭션을 수정하지 않도록 설계
- Connection Pool 크기 조정 필요 (relay-api + consumer)

```typescript
// packages/queue-consumer/src/prisma/prisma.service.ts
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

### 구현 단계

#### 4.1 Consumer Service 구현

**파일**: `packages/queue-consumer/src/consumer.service.ts`

**핵심 로직**:
1. SQS Long-polling (20초)
2. 메시지 수신 → OZ Relayer 전송
3. 성공 시 메시지 삭제
4. 실패 시 SQS에 반환 (재시도)

```typescript
async processMessages(): Promise<void> {
  const command = new ReceiveMessageCommand({
    QueueUrl: this.configService.get('SQS_QUEUE_URL'),
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20, // Long-polling
  });

  const response = await this.sqsAdapter.send(command);

  for (const message of response.Messages || []) {
    try {
      const body = JSON.parse(message.Body);
      await this.relayClient.sendToOzRelayer(body);

      // 성공 시 메시지 삭제
      await this.deleteMessage(message.ReceiptHandle);
      await this.updateTransactionStatus(body.transactionId, 'success');
    } catch (error) {
      // 실패 시 SQS에 반환 (재시도)
      this.logger.error(`Failed to process message: ${error.message}`);
      await this.updateTransactionStatus(body.transactionId, 'failed', error.message);
    }
  }
}
```

#### 4.2 SQS Adapter 구현

**파일**: `packages/queue-consumer/src/sqs/sqs.adapter.ts`

**작업**:
- relay-api의 sqs.adapter.ts와 동일한 Dual Credentials 패턴 사용

#### 4.3 OZ Relayer Client 구현

**파일**: `packages/queue-consumer/src/relay/oz-relayer.client.ts`

**핵심 로직**:
```typescript
async sendToOzRelayer(body: any): Promise<void> {
  const url = this.configService.get('OZ_RELAYER_URL');
  const apiKey = this.configService.get('OZ_RELAYER_API_KEY');

  await axios.post(`${url}/relay`, body, {
    headers: { 'x-api-key': apiKey },
  });
}
```

#### 4.4 Configuration 구현

**파일**: `packages/queue-consumer/src/config/configuration.ts`

**작업**:
```typescript
export default () => ({
  sqs: {
    endpoint: process.env.SQS_ENDPOINT_URL,
    queueUrl: process.env.SQS_QUEUE_URL,
    dlqUrl: process.env.SQS_DLQ_URL,
    region: process.env.AWS_REGION || 'ap-northeast-2',
  },
  relayer: {
    url: process.env.OZ_RELAYER_URL,
    apiKey: process.env.OZ_RELAYER_API_KEY,
  },
  database: {
    url: process.env.DATABASE_URL,
  },
});
```

#### 4.5 Graceful Shutdown 처리

**파일**: `packages/queue-consumer/src/consumer.service.ts`

**SIGTERM 신호 처리**:
```typescript
@Injectable()
export class ConsumerService implements OnModuleDestroy {
  private isShuttingDown = false;

  async onModuleDestroy() {
    this.logger.log('Received shutdown signal, stopping message processing...');
    this.isShuttingDown = true;

    // 현재 처리 중인 메시지가 완료될 때까지 대기 (최대 30초)
    await this.waitForInFlightMessages(30000);

    this.logger.log('Consumer gracefully shut down');
  }

  async processMessages(): Promise<void> {
    while (!this.isShuttingDown) {
      try {
        const messages = await this.receiveMessages();
        for (const message of messages) {
          if (this.isShuttingDown) {
            this.logger.warn('Shutdown requested, returning message to queue');
            break;
          }
          await this.handleMessage(message);
        }
      } catch (error) {
        this.logger.error(`Message processing error: ${error.message}`);
      }
    }
  }
}
```

**Docker Compose 설정**:
```yaml
queue-consumer:
  stop_grace_period: 30s  # SIGTERM 후 30초 대기
```

### 검증

- [ ] Unit Test: `consumer.service.spec.ts`
- [ ] Mock OZ Relayer로 메시지 처리 성공
- [ ] 재시도 로직 테스트 (3회 실패 → DLQ)
- [ ] Graceful Shutdown 테스트 (SIGTERM 신호 처리)

---

## Phase 5: Controller/Service 연동

### 목표
DirectController와 GaslessController를 비동기 처리로 변경합니다.

### 구현 단계

#### 5.1 DirectController 수정

**파일**: `packages/relay-api/src/relay/direct/direct.controller.ts`

**변경 전**:
```typescript
@Post()
async sendDirectTransaction(@Body() dto: DirectTxRequestDto) {
  return this.directService.relayTransaction(dto);
}
```

**변경 후**:
```typescript
@Post()
@HttpCode(HttpStatus.ACCEPTED)
async sendDirectTransaction(@Body() dto: DirectTxRequestDto) {
  // 1. MySQL에 pending 상태로 저장
  const transaction = await this.directService.createPendingTransaction(dto);

  // 2. SQS Queue에 메시지 전송
  await this.queueService.enqueueTransaction({
    transactionId: transaction.id,
    type: 'direct',
    request: dto,
  });

  // 3. 202 Accepted + transactionId 반환
  return {
    transactionId: transaction.id,
    status: 'pending',
    message: 'Transaction queued for processing',
  };
}
```

#### 5.2 DirectService 수정

**파일**: `packages/relay-api/src/relay/direct/direct.service.ts`

**작업**:
- `createPendingTransaction()`: MySQL에 pending 상태로 저장
- `processTransaction()`: Consumer에서 호출, OZ Relayer 전송 후 상태 업데이트

```typescript
async createPendingTransaction(dto: DirectTxRequestDto): Promise<Transaction> {
  return this.transactionRepository.save({
    status: 'pending',
    type: 'direct',
    request: dto,
  });
}

async processTransaction(transactionId: string): Promise<void> {
  const transaction = await this.transactionRepository.findOne({ id: transactionId });

  // OZ Relayer 전송 (기존 로직)
  const result = await this.relayToOzRelayer(transaction.request);

  // 상태 업데이트
  await this.transactionRepository.update(transactionId, {
    status: 'success',
    result,
  });
}
```

#### 5.3 GaslessController/Service 동일 패턴 적용

**작업**:
- DirectController와 동일한 패턴으로 수정

### 검증

- [ ] `POST /relay/direct` → 202 Accepted + transactionId
- [ ] SQS에 메시지 전송 확인
- [ ] Consumer가 메시지 처리 후 상태 업데이트
- [ ] `GET /relay/status/:transactionId` → `success` 확인

---

## Phase 6: Health Check

### 목표
SQS Health Indicator를 추가하여 SQS 연결 상태를 모니터링합니다.

### 구현 단계

#### 6.1 SQS Health Indicator 구현

**파일**: `packages/relay-api/src/queue/sqs/sqs.health.ts`

**핵심 로직**:
```typescript
@Injectable()
export class SqsHealthIndicator extends HealthIndicator {
  constructor(private sqsAdapter: SqsAdapter) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const command = new GetQueueAttributesCommand({
        QueueUrl: this.configService.get('SQS_QUEUE_URL'),
        AttributeNames: ['ApproximateNumberOfMessages'],
      });

      await this.sqsAdapter.send(command);

      return this.getStatus(key, true);
    } catch (error) {
      return this.getStatus(key, false, { message: error.message });
    }
  }
}
```

#### 6.2 Health Controller 수정

**파일**: `packages/relay-api/src/health/health.controller.ts`

**작업**:
- SqsHealthIndicator 추가

```typescript
@Get()
@HealthCheck()
check() {
  return this.health.check([
    // ... existing
    () => this.sqsHealth.isHealthy('sqs'),
  ]);
}
```

### 검증

- [ ] `GET /health` → SQS health check 포함
- [ ] LocalStack 중지 시 SQS health check 실패

---

## Phase 7: Testing

### 목표
Unit Test와 Integration Test를 작성하여 전체 플로우를 검증합니다.

### 구현 단계

#### 7.1 Unit Tests

**파일**:
1. `packages/relay-api/src/queue/sqs/sqs.adapter.spec.ts`
2. `packages/relay-api/src/queue/queue.service.spec.ts`
3. `packages/queue-consumer/src/consumer.service.spec.ts`

**테스트 항목**:
- SQS Adapter: `sendMessage`, `receiveMessages`, `deleteMessage`
- Queue Service: `enqueueTransaction`
- Consumer Service: 메시지 처리, 재시도, DLQ 이동

**Mock 사용**:
```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsMock = mockClient(SQSClient);

describe('QueueService', () => {
  it('should send message to SQS', async () => {
    sqsMock.on(SendMessageCommand).resolves({
      MessageId: 'test-message-id',
    });

    await service.enqueueTransaction({
      transactionId: '123',
      type: 'direct',
    });

    expect(sqsMock).toHaveReceivedCommandWith(SendMessageCommand, {
      QueueUrl: expect.stringContaining('relay-transactions'),
    });
  });
});
```

#### 7.2 Integration Tests

**파일**: `packages/relay-api/test/e2e/queue.e2e-spec.ts`

**테스트 시나리오**:
1. POST /relay/direct → 202 Accepted
2. SQS에 메시지 전송 확인
3. Consumer가 메시지 처리
4. GET /relay/status/:transactionId → success

**Docker Compose 활용**:
```typescript
beforeAll(async () => {
  // docker-compose up -d
  await exec('docker-compose up -d');
  await sleep(10000); // Wait for services to start
});

afterAll(async () => {
  // docker-compose down
  await exec('docker-compose down');
});
```

### 검증

- [ ] 모든 Unit Test 통과
- [ ] Integration Test 통과
- [ ] 테스트 커버리지 ≥90%

---

## 기술 스택 및 버전

| 라이브러리 | 버전 | 용도 |
|-----------|------|------|
| @aws-sdk/client-sqs | ^3.700.0 | AWS SQS 클라이언트 |
| localstack/localstack | 3.0 | 로컬 AWS 에뮬레이션 |
| NestJS | 기존 프로젝트 버전 | 프레임워크 |
| pnpm | 기존 프로젝트 설정 | 패키지 매니저 |
| axios | ^1.x | HTTP 클라이언트 |
| aws-sdk-client-mock | ^3.0.0 | Unit test mock |

---

## 파일 생성/수정 목록

### 신규 파일 - relay-api Queue Producer (7개)

| 경로 | 용도 |
|------|------|
| `packages/relay-api/src/queue/queue.module.ts` | Queue Producer 모듈 |
| `packages/relay-api/src/queue/queue.service.ts` | Enqueue 서비스 |
| `packages/relay-api/src/queue/sqs/sqs.adapter.ts` | AWS SDK wrapper |
| `packages/relay-api/src/queue/sqs/sqs.health.ts` | Health indicator |
| `packages/relay-api/src/queue/interfaces/queue-message.interface.ts` | 타입 정의 |
| `packages/relay-api/src/queue/dto/queue-message.dto.ts` | DTO |
| `packages/relay-api/.env.example` | SQS 환경변수 예시 |

### 신규 파일 - queue-consumer 패키지 (9개)

| 경로 | 용도 |
|------|------|
| `packages/queue-consumer/package.json` | 패키지 정의 |
| `packages/queue-consumer/tsconfig.json` | TypeScript 설정 |
| `packages/queue-consumer/src/main.ts` | Entry point |
| `packages/queue-consumer/src/consumer.module.ts` | NestJS module |
| `packages/queue-consumer/src/consumer.service.ts` | SQS Long-polling Consumer |
| `packages/queue-consumer/src/sqs/sqs.adapter.ts` | AWS SDK wrapper |
| `packages/queue-consumer/src/relay/oz-relayer.client.ts` | OZ Relayer HTTP client |
| `packages/queue-consumer/src/config/configuration.ts` | Configuration |
| `packages/queue-consumer/test/consumer.service.spec.ts` | Unit test |

### 신규 파일 - Docker 인프라 (1개)

| 경로 | 용도 |
|------|------|
| `docker/scripts/init-localstack.sh` | SQS 큐 자동 생성 스크립트 |

### 수정 파일 (8개)

| 경로 | 변경 내용 |
|------|----------|
| `docker/docker-compose.yaml` | LocalStack + queue-consumer 서비스 추가 |
| `docker/Dockerfile.packages` | queue-consumer 빌드 타겟 추가 |
| `packages/relay-api/package.json` | AWS SDK 의존성 추가 |
| `packages/relay-api/src/config/configuration.ts` | Queue 설정 추가 |
| `packages/relay-api/src/app.module.ts` | QueueModule import |
| `packages/relay-api/src/relay/direct/direct.controller.ts` | 비동기 처리로 변경 |
| `packages/relay-api/src/relay/direct/direct.service.ts` | 메서드 분리 |
| `packages/relay-api/src/health/health.controller.ts` | SQS health 추가 |

**총 파일 수**: 신규 17개 + 수정 8개 = 25개

---

## 구현 순서

0. **Phase 0**: Prerequisites → Prisma Schema Migration
   - `packages/relay-api/prisma/schema.prisma`: Add 4 fields (type, request, result, error_message)
   - Run `npx prisma migrate dev --name add-queue-fields`
   - Run `npx prisma generate` to update types
   - ✅ Subsequent phases can utilize new fields

1. **Phase 1**: Docker Infrastructure → LocalStack 서비스 추가 및 SQS 큐 생성
2. **Phase 2**: Package Structure → queue-consumer 패키지 초기화
3. **Phase 3**: relay-api Producer → Queue 모듈 및 SQS Adapter 구현
4. **Phase 4**: queue-consumer Service → Consumer 로직 및 OZ Relayer Client 구현
5. **Phase 5**: Controller/Service 연동 → 비동기 처리로 변경
6. **Phase 6**: Health Check → SQS Health Indicator 추가
7. **Phase 7**: Testing → Unit Test 및 Integration Test 작성

---

## 리스크 및 완화 전략

### 리스크 1: LocalStack SQS 동작 불안정

**완화 전략**:
- LocalStack 3.0 stable 버전 사용
- Health Check로 서비스 준비 상태 확인
- Init Script로 큐 자동 생성 보장

### 리스크 2: Consumer 메시지 처리 실패

**완화 전략**:
- DLQ (Dead Letter Queue)로 실패 메시지 격리
- maxReceiveCount=3으로 재시도 횟수 제한
- MySQL에 에러 메시지 기록

### 리스크 3: OZ Relayer 연동 실패

**완화 전략**:
- Axios retry 설정 추가
- Consumer에서 재시도 로직 구현
- Health Check로 OZ Relayer 상태 모니터링

### 리스크 4: Producer와 Consumer 간 메시지 형식 불일치

**완화 전략**:
- TypeScript 인터페이스로 메시지 형식 정의
- DTO 검증으로 메시지 무결성 보장
- Unit Test로 형식 일치성 검증

---

## 예상 일정

| Phase | 예상 시간 |
|-------|----------|
| Phase 0: Prerequisites (Prisma) | 0.5일 |
| Phase 1: Docker Infrastructure | 1일 |
| Phase 2: Package Structure | 0.5일 |
| Phase 3: relay-api Producer | 1일 |
| Phase 4: queue-consumer Service | 1일 |
| Phase 5: Controller/Service 연동 | 0.5일 |
| Phase 6: Health Check | 0.5일 |
| Phase 7: Testing | 1일 |
| **총계** | **5.5일** |

---

## 완료 기준

- [ ] LocalStack SQS 큐 자동 생성
- [ ] relay-api POST /relay/direct → 202 Accepted
- [ ] queue-consumer SQS Long-polling 동작
- [ ] OZ Relayer 전송 성공
- [ ] 트랜잭션 상태 업데이트 (pending → success)
- [ ] 3회 재시도 후 DLQ 이동
- [ ] Health Check SQS 상태 확인
- [ ] Unit Test 커버리지 ≥90%
- [ ] Integration Test 통과
- [ ] LocalStack Web UI에서 큐 및 메시지 확인

---

## 참고 자료

- AWS SQS SDK: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/
- LocalStack: https://docs.localstack.cloud/user-guide/aws/sqs/
- NestJS Config: https://docs.nestjs.com/techniques/configuration
- Docker Compose: https://docs.docker.com/compose/

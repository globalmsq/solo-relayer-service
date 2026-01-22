# SPEC-DLQ-001 Implementation Plan

## Overview

Implementation plan for Dead Letter Queue (DLQ) handling and error classification system in msq-relayer-service.

**Estimated Files**: ~20 files (5 new, 15 modified)
**Estimated Time**: 3-5 hours
**Test Coverage Target**: ≥90%

---

## Part 1: Error Classification System

### 1.1 Create Error Types and Constants

**File**: `packages/queue-consumer/src/errors/relay-errors.ts`

```typescript
export enum ErrorCategory {
  RETRYABLE = 'RETRYABLE',
  NON_RETRYABLE = 'NON_RETRYABLE',
}

export class RelayError extends Error {
  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

export const NON_RETRYABLE_PATTERNS = [
  // Balance/Gas issues
  /insufficient funds/i,
  /insufficient balance/i,
  /gas required exceeds allowance/i,
  /intrinsic gas too low/i,
  /out of gas/i,

  // Nonce issues
  /nonce too low/i,
  /nonce already used/i,

  // Execution failures
  /execution reverted/i,
  /transaction would revert/i,
];

export const NON_RETRYABLE_HTTP_CODES = [400, 401, 403, 422];

export const RETRYABLE_PATTERNS = [
  /network timeout/i,
  /connection refused/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
];

export const RETRYABLE_HTTP_CODES = [408, 429, 500, 502, 503, 504];
```

### 1.2 Implement Error Classifier Service

**File**: `packages/queue-consumer/src/errors/error-classifier.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorCategory,
  NON_RETRYABLE_PATTERNS,
  NON_RETRYABLE_HTTP_CODES,
  RETRYABLE_PATTERNS,
  RETRYABLE_HTTP_CODES,
} from './relay-errors';

@Injectable()
export class ErrorClassifierService {
  private readonly logger = new Logger(ErrorClassifierService.name);

  classify(error: Error | any): ErrorCategory {
    const errorMessage = error.message || String(error);
    const httpCode = error.response?.status || error.statusCode;

    // Check non-retryable patterns
    if (this.matchesPatterns(errorMessage, NON_RETRYABLE_PATTERNS)) {
      this.logger.warn(`[NON_RETRYABLE] Pattern match: ${errorMessage}`);
      return ErrorCategory.NON_RETRYABLE;
    }

    // Check non-retryable HTTP codes
    if (httpCode && NON_RETRYABLE_HTTP_CODES.includes(httpCode)) {
      this.logger.warn(`[NON_RETRYABLE] HTTP ${httpCode}: ${errorMessage}`);
      return ErrorCategory.NON_RETRYABLE;
    }

    // Check retryable patterns
    if (this.matchesPatterns(errorMessage, RETRYABLE_PATTERNS)) {
      this.logger.log(`[RETRYABLE] Pattern match: ${errorMessage}`);
      return ErrorCategory.RETRYABLE;
    }

    // Check retryable HTTP codes
    if (httpCode && RETRYABLE_HTTP_CODES.includes(httpCode)) {
      this.logger.log(`[RETRYABLE] HTTP ${httpCode}: ${errorMessage}`);
      return ErrorCategory.RETRYABLE;
    }

    // Default to retryable (conservative approach)
    this.logger.log(`[RETRYABLE] Default classification: ${errorMessage}`);
    return ErrorCategory.RETRYABLE;
  }

  private matchesPatterns(message: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(message));
  }
}
```

### 1.3 Create Barrel Export

**File**: `packages/queue-consumer/src/errors/index.ts`

```typescript
export * from './relay-errors';
export * from './error-classifier.service';
```

### 1.4 Update Consumer Service

**File**: `packages/queue-consumer/src/consumer.service.ts`

**Changes**:
- Inject `ErrorClassifierService`
- Modify catch block to classify errors
- Handle NON_RETRYABLE errors immediately (update DB + delete message)
- Let RETRYABLE errors use SQS retry mechanism

```typescript
// In catch block
} catch (error) {
  const category = this.errorClassifier.classify(error);

  if (category === ErrorCategory.NON_RETRYABLE) {
    // Immediate failure - no retry
    this.logger.error(`[NON_RETRYABLE] Immediate failure for ${transactionId}`, error.stack);

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'failed',
        error_message: `[NON_RETRYABLE] ${error.message}`,
      },
    });

    // Delete message from SQS (no retry)
    await this.sqsAdapter.deleteMessage(this.queueUrl, receiptHandle);
    return;
  }

  // RETRYABLE errors: let SQS handle retry (throw error)
  this.logger.error(`[RETRYABLE] Error for ${transactionId}, will retry`, error.stack);
  throw error; // SQS will retry up to maxReceiveCount
}
```

### 1.5 Register Service in Module

**File**: `packages/queue-consumer/src/consumer.module.ts`

```typescript
import { ErrorClassifierService } from './errors';

@Module({
  providers: [
    ConsumerService,
    ErrorClassifierService, // Add this
    // ... other providers
  ],
})
```

### 1.6 Unit Tests

**File**: `packages/queue-consumer/src/errors/error-classifier.service.spec.ts`

Test cases:
- ✅ Classifies "insufficient funds" as NON_RETRYABLE
- ✅ Classifies HTTP 400 as NON_RETRYABLE
- ✅ Classifies "network timeout" as RETRYABLE
- ✅ Classifies HTTP 503 as RETRYABLE
- ✅ Defaults to RETRYABLE for unknown errors

---

## Part 2: retryOnFailure Field

### 2.1 Update Prisma Schema

**File**: `packages/relay-api/prisma/schema.prisma`

```prisma
model Transaction {
  // ... existing fields
  retryOnFailure  Boolean?  @default(false)
  // ... rest of fields
}
```

**Migration**:
```bash
pnpm --filter @msq-relayer/relay-api prisma migrate dev --name add-retry-on-failure
```

**Backfill Strategy** (in migration SQL):
```sql
-- Set default value for existing records
UPDATE Transaction
SET retryOnFailure = false
WHERE retryOnFailure IS NULL;
```

### 2.2 Update DTOs

**Files**:
- `packages/relay-api/src/relay/dto/direct-tx-request.dto.ts`
- `packages/relay-api/src/relay/dto/gasless-tx-request.dto.ts`

```typescript
import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DirectTxRequestDto {
  // ... existing fields

  @ApiPropertyOptional({
    description: 'Whether to retry this transaction if it reaches DLQ',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  retryOnFailure?: boolean;
}
```

### 2.3 Update Queue Service

**File**: `packages/relay-api/src/queue/queue.service.ts`

Include `retryOnFailure` in SQS message payload:

```typescript
const messageBody = {
  transactionId: transaction.id,
  retryOnFailure: transaction.retryOnFailure ?? false, // Include in message
  // ... other fields
};
```

### 2.4 Update Consumer Service

**File**: `packages/queue-consumer/src/consumer.service.ts`

Extract `retryOnFailure` from message and store in DB:

```typescript
const { transactionId, retryOnFailure } = JSON.parse(message.Body);

// When creating transaction record (if not exists)
await this.prisma.transaction.upsert({
  where: { id: transactionId },
  create: {
    id: transactionId,
    retryOnFailure: retryOnFailure ?? false, // Store in DB
    // ... other fields
  },
  update: {},
});
```

---

## Part 3: Code Restructuring

### 3.1 Create Shared Module

**Directory Structure**:
```
packages/queue-consumer/src/shared/
├── shared.module.ts
├── sqs/
│   └── sqs.adapter.ts (move from root)
├── errors/
│   ├── relay-errors.ts (move from root)
│   └── error-classifier.service.ts (move from root)
└── prisma/
    └── prisma.service.ts (move from root)
```

**File**: `packages/queue-consumer/src/shared/shared.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { SqsAdapter } from './sqs/sqs.adapter';
import { ErrorClassifierService } from './errors/error-classifier.service';

@Module({
  imports: [ConfigModule],
  providers: [PrismaService, SqsAdapter, ErrorClassifierService],
  exports: [PrismaService, SqsAdapter, ErrorClassifierService],
})
export class SharedModule {}
```

### 3.2 Create Main Consumer Module

**File**: `packages/queue-consumer/src/main-consumer/main-consumer.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { MainConsumerService } from './main-consumer.service';

@Module({
  imports: [SharedModule],
  providers: [MainConsumerService],
})
export class MainConsumerModule {}
```

**File**: `packages/queue-consumer/src/main-consumer/main-consumer.service.ts`

Move existing `consumer.service.ts` logic here.

### 3.3 Update Root Consumer Module

**File**: `packages/queue-consumer/src/consumer.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MainConsumerModule } from './main-consumer/main-consumer.module';
import { DlqConsumerModule } from './dlq-consumer/dlq-consumer.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
    MainConsumerModule,
    DlqConsumerModule,
  ],
})
export class ConsumerModule {}
```

### 3.4 Update Main Entry Point

**File**: `packages/queue-consumer/src/main.ts`

```typescript
import { NestFactory } from '@nestjs/core';
import { ConsumerModule } from './consumer.module';

async function bootstrap() {
  const app = await NestFactory.create(ConsumerModule);

  console.log('Starting Main Consumer and DLQ Consumer together');

  // Both consumers always start together
  await app.init();
}

bootstrap();
```

---

## Part 4: DLQ Consumer Implementation

### 4.1 Create DLQ Consumer Service

**File**: `packages/queue-consumer/src/dlq-consumer/dlq-consumer.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqsAdapter } from '../shared/sqs/sqs.adapter';
import { PrismaService } from '../shared/prisma/prisma.service';

@Injectable()
export class DlqConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DlqConsumerService.name);
  private isRunning = false;
  private readonly pollIntervalMs: number;
  private readonly dlqUrl: string;

  constructor(
    private readonly sqsAdapter: SqsAdapter,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.pollIntervalMs = this.configService.get<number>('dlq.pollIntervalMs', 10000);
    this.dlqUrl = this.configService.get<string>('aws.dlqUrl');
  }

  async onModuleInit() {
    this.isRunning = true;
    this.logger.log(`DLQ Consumer started (poll interval: ${this.pollIntervalMs}ms)`);
    this.startPolling();
  }

  async onModuleDestroy() {
    this.isRunning = false;
    this.logger.log('DLQ Consumer stopped');
  }

  private async startPolling() {
    while (this.isRunning) {
      try {
        await this.processDlqBatch();
      } catch (error) {
        this.logger.error('DLQ polling error', error.stack);
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async processDlqBatch() {
    const messages = await this.sqsAdapter.receiveMessages(this.dlqUrl, 10, {
      waitTimeSeconds: 10,
    });

    if (messages.length === 0) {
      return;
    }

    this.logger.log(`Received ${messages.length} DLQ messages`);

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: any) {
    const { transactionId } = JSON.parse(message.Body);

    try {
      const transaction = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        this.logger.warn(`Transaction not found: ${transactionId}, deleting DLQ message`);
        await this.sqsAdapter.deleteMessage(this.dlqUrl, message.ReceiptHandle);
        return;
      }

      // Idempotency check: if already failed, just delete message
      if (transaction.status === 'failed') {
        this.logger.log(`Transaction already failed: ${transactionId}, deleting duplicate DLQ message`);
        await this.sqsAdapter.deleteMessage(this.dlqUrl, message.ReceiptHandle);
        return;
      }

      if (transaction.retryOnFailure === true) {
        // Future: Implement retry logic
        this.logger.warn(`Retry requested but not implemented: ${transactionId}`);
        // For now, treat same as failure
      }

      // Mark as failed (default behavior)
      await this.markAsFailed(transaction, 'Message moved to DLQ after 3 retries');

      // Delete from DLQ
      await this.sqsAdapter.deleteMessage(this.dlqUrl, message.ReceiptHandle);

      this.logger.log(`DLQ message processed: ${transactionId} -> failed`);
    } catch (error) {
      this.logger.error(`Failed to process DLQ message for ${transactionId}`, error.stack);
      // Don't delete message on error - will be retried
    }
  }

  private async markAsFailed(transaction: any, reason: string) {
    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'failed',
        error_message: `[DLQ] ${reason}`,
      },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 4.2 Create DLQ Consumer Module

**File**: `packages/queue-consumer/src/dlq-consumer/dlq-consumer.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { DlqConsumerService } from './dlq-consumer.service';

@Module({
  imports: [SharedModule],
  providers: [DlqConsumerService],
})
export class DlqConsumerModule {}
```

### 4.3 Add Infrastructure Configuration

**File**: `docker/scripts/init-localstack.sh`

Add SQS RedrivePolicy configuration:

```bash
# Create DLQ first
awslocal sqs create-queue \
  --queue-name relay-transactions-dlq

# Get DLQ ARN
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/relay-transactions-dlq \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

# Create main queue with RedrivePolicy
awslocal sqs create-queue \
  --queue-name relay-transactions \
  --attributes "{\"RedrivePolicy\":\"{\\\"maxReceiveCount\\\":\\\"3\\\",\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\"}\"}"
```

### 4.4 Unit Tests

**File**: `packages/queue-consumer/src/dlq-consumer/dlq-consumer.service.spec.ts`

Test cases:
- ✅ Starts polling automatically when module initializes
- ✅ Processes message and marks transaction as failed
- ✅ Deletes DLQ message after processing
- ✅ Handles retryOnFailure=true (logs warning)
- ✅ Handles missing transaction (deletes message)
- ✅ Handles duplicate messages (idempotency check)
- ✅ Stops polling on module destroy

---

## Part 5: Configuration

### 5.1 Create Configuration File

**File**: `packages/queue-consumer/src/config/configuration.ts`

```typescript
export default () => ({
  aws: {
    queueUrl: process.env.SQS_QUEUE_URL,
    dlqUrl: process.env.SQS_DLQ_URL,
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT,
  },
  dlq: {
    pollIntervalMs: parseInt(process.env.DLQ_POLL_INTERVAL_MS, 10) || 10000,
    batchSize: 10,
  },
});
```

### 5.2 Update Environment Variables

**File**: `packages/queue-consumer/.env.example`

```bash
# SQS Configuration
SQS_QUEUE_URL=http://localhost:4566/000000000000/relay-transactions
SQS_DLQ_URL=http://localhost:4566/000000000000/relay-transactions-dlq
AWS_REGION=us-east-1
AWS_ENDPOINT=http://localhost:4566

# DLQ Polling
DLQ_POLL_INTERVAL_MS=10000
```

---

## Part 6: Testing Strategy

### 6.1 Unit Tests

**Files to test**:
- `error-classifier.service.spec.ts`: Error pattern matching
- `dlq-consumer.service.spec.ts`: DLQ message processing
- `main-consumer.service.spec.ts`: Main queue processing with error classification

**Target Coverage**: ≥90% for all services

### 6.2 Integration Tests

**File**: `packages/queue-consumer/test/integration/dlq-flow.spec.ts`

Test scenarios:
1. **Non-retryable error flow**:
   - Send transaction with "insufficient funds" error
   - Verify immediate failure (no retry)
   - Verify no DLQ message

2. **Retryable error flow**:
   - Send transaction that fails 3 times
   - Verify SQS retries (3 attempts)
   - Verify DLQ message created

3. **DLQ Consumer flow**:
   - Create DLQ message
   - Verify DLQ Consumer picks it up
   - Verify transaction marked as failed
   - Verify DLQ message deleted

### 6.3 E2E Tests (LocalStack)

**File**: `packages/queue-consumer/test/e2e/dlq-e2e.spec.ts`

Full end-to-end scenario:
1. Start LocalStack SQS
2. Send retryable error transaction
3. Verify 3 retries occur
4. Verify DLQ message created
5. Verify DLQ Consumer processes message
6. Verify DB updated correctly
7. Verify DLQ message deleted

---

## Implementation Order

### Sprint 1: Error Classification (2 hours)
1. Create `errors/relay-errors.ts`
2. Implement `error-classifier.service.ts`
3. Update `consumer.service.ts` catch block
4. Write unit tests
5. Verify with integration tests

### Sprint 2: retryOnFailure Field (1 hour)
1. Update Prisma schema + migration
2. Update DTOs (direct, gasless)
3. Update queue service (include in message)
4. Update consumer service (save to DB)
5. Test backwards compatibility

### Sprint 3: Code Restructuring (1 hour)
1. Create `shared/` module
2. Move common services (SQS, Prisma, ErrorClassifier)
3. Create `main-consumer/` module
4. Create `dlq-consumer/` module skeleton
5. Update imports and module structure

### Sprint 4: DLQ Consumer (1.5 hours)
1. Implement `dlq-consumer.service.ts`
2. Implement continuous polling logic
3. Implement message processing and deletion
4. Write unit tests
5. Write integration tests
6. E2E tests with LocalStack

---

## Rollout Plan

### Phase 1: Development
- Implement all code changes
- Pass all unit tests (≥90% coverage)
- Pass all integration tests
- Pass E2E tests with LocalStack

### Phase 2: Staging
- Deploy to staging (both consumers start together)
- Monitor DLQ processing logs
- Verify error classification is working
- Test retryOnFailure field behavior

### Phase 3: Production
- Deploy both consumers together (Main + DLQ Consumer run as single process)
- Monitor error classification and DLQ processing logs
- Verify DLQ messages are being processed and deleted
- Monitor CloudWatch metrics and alarms

---

## Rollback Plan

If issues occur:
1. **Revert deployment**: Roll back to previous version (DLQ Consumer will not start)
2. **Revert schema migration**: Prisma migrate rollback
3. **Revert consumer.service.ts**: Remove error classification logic
4. **Monitor**: Ensure system returns to previous behavior

---

## Success Metrics

- ✅ Error classification accuracy: 100% for known patterns
- ✅ DLQ message processing rate: 100% within 10 seconds
- ✅ DLQ message deletion rate: 100%
- ✅ Test coverage: ≥90%
- ✅ Zero backwards compatibility breaks
- ✅ Zero DLQ message accumulation

---

## File Checklist

### New Files (5)
- [ ] `packages/queue-consumer/src/errors/relay-errors.ts`
- [ ] `packages/queue-consumer/src/errors/error-classifier.service.ts`
- [ ] `packages/queue-consumer/src/errors/error-classifier.service.spec.ts`
- [ ] `packages/queue-consumer/src/dlq-consumer/dlq-consumer.service.ts`
- [ ] `packages/queue-consumer/src/dlq-consumer/dlq-consumer.service.spec.ts`

### Modified Files (15)
- [ ] `packages/queue-consumer/src/consumer.service.ts`
- [ ] `packages/queue-consumer/src/consumer.module.ts`
- [ ] `packages/queue-consumer/src/main.ts`
- [ ] `packages/queue-consumer/src/config/configuration.ts`
- [ ] `packages/relay-api/prisma/schema.prisma`
- [ ] `packages/relay-api/src/relay/dto/direct-tx-request.dto.ts`
- [ ] `packages/relay-api/src/relay/dto/gasless-tx-request.dto.ts`
- [ ] `packages/relay-api/src/queue/queue.service.ts`
- [ ] `packages/queue-consumer/.env.example`
- [ ] `packages/queue-consumer/test/integration/dlq-flow.spec.ts`
- [ ] `packages/queue-consumer/test/e2e/dlq-e2e.spec.ts`
- [ ] Shared module files (moved, not new)
- [ ] Main consumer module files (moved, not new)
- [ ] DLQ consumer module files

**Total**: ~20 files

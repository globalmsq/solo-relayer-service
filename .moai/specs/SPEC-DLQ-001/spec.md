---
id: SPEC-DLQ-001
version: 1.0.2
status: draft
created: 2026-01-20
updated: 2026-01-22
author: @user
priority: high
---

## HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.2 | 2026-01-22 | @user | Unified 10-second polling interval across all documents; Fixed SQS long polling waitTimeSeconds to 10; Fixed rollout plan to align with "always run together" requirement; Removed mode-based test cases; Corrected LocalStack script path |
| 1.0.1 | 2026-01-22 | @user | Changed DLQ polling interval from 5 seconds to 10 seconds |
| 1.0.0 | 2026-01-20 | @user | Initial specification created |

# SPEC-DLQ-001: Dead Letter Queue Processing and Error Classification System

## Overview

Implement SQS Dead Letter Queue (DLQ) processing mechanism for MSQ Relayer Service. Build a system that classifies errors into retryable/non-retryable categories and systematically processes messages moved to DLQ.

## Goals

1. **Error Classification System**: Automatically classify retryable/non-retryable errors to prevent unnecessary retries
2. **DLQ Consumer Implementation**: Process DLQ messages via continuous polling (K8s compatible)
3. **Flexible Retry Policy**: Control retry strategy per Transaction using `retryOnFailure` field
4. **Scalable Architecture**: Structure enabling future separate deployment of DLQ Consumer

## EARS Requirements

### Ubiquitous (System-wide)

**U-1**: The system MUST classify all errors into `ErrorCategory` (RETRYABLE, NON_RETRYABLE).

**U-2**: The system MUST delete messages from SQS after processing DLQ messages.

**U-3**: The system MUST be compatible with existing transactions lacking `retryOnFailure` field (default: false).

**U-4**: The system MUST write all technical documentation and code in English.

**U-5**: The system MUST check transaction status before processing DLQ messages to ensure idempotency.

### Event-driven (Event-based)

**E-1**: WHEN Consumer detects an error, it MUST call `ErrorClassifierService` to classify the error category.

**E-2**: WHEN an error is classified as `NON_RETRYABLE`, the system MUST immediately update Transaction status to 'failed' and delete the SQS message.

**E-3**: WHEN an error is classified as `RETRYABLE`, the system MUST utilize SQS automatic retry mechanism (maxReceiveCount: 3).

**E-4**: WHEN a message is moved to DLQ, DLQ Consumer MUST poll and process the message at 10-second intervals.

**E-5**: WHEN DLQ Consumer processes a message:
- `retryOnFailure === true`: Execute reprocessing logic (to be implemented later, currently same as failure handling)
- `retryOnFailure === false | null`: Mark Transaction as 'failed' and delete DLQ message

**E-6**: WHEN DLQ Consumer encounters a duplicate message (transaction already 'failed'), it MUST delete the message without reprocessing.

### State-driven (State-based)

**S-1**: Main Consumer and DLQ Consumer MUST always run together in the same process.

**S-2**: WHEN DLQ Consumer is running, it MUST maintain `isRunning=true` state and continuously poll.

**S-3**: WHEN DLQ Consumer is terminating, it MUST set `isRunning=false` to stop the polling loop.

### Unwanted (Prohibited)

**UN-1**: The system MUST NOT resend NON_RETRYABLE errors to SQS.

**UN-2**: The system MUST NOT leave DLQ messages after processing without deletion.

**UN-3**: The system MUST NOT implement DLQ Consumer as Kubernetes Cron Job (use continuous polling).

**UN-4**: The system MUST NOT break compatibility with existing clients (retryOnFailure field is optional).

**UN-5**: The system MUST NOT write technical documentation or code in Korean.

### Optional (Optional)

**O-1**: DLQ Consumer MAY be separated and deployed as independent service in the future (currently integrated in queue-consumer, requiring architectural refactoring).

**O-2**: Reprocessing logic for messages with `retryOnFailure=true` MAY be implemented in the future (currently treated as failure).

**O-3**: Error patterns MAY be added/modified in the future (ErrorClassifierService is extensible).

## Error Classification Criteria

### Non-Retryable Errors

| Error Pattern | Description | HTTP Status |
|--------------|-------------|-------------|
| `insufficient funds` | Insufficient balance | - |
| `insufficient balance` | Insufficient balance | - |
| `gas required exceeds allowance` | Gas limit exceeded | - |
| `intrinsic gas too low` | Insufficient gas | - |
| `out of gas` | Gas depleted | - |
| `nonce too low` | Already used nonce | - |
| `nonce already used` | Already used nonce | - |
| `execution reverted` | Contract execution failed | - |
| `transaction would revert` | Simulation failed | - |
| Client errors | Client request errors | 400, 401, 403, 422 |

### Retryable Errors

| Error Pattern | Description | HTTP Status |
|--------------|-------------|-------------|
| Network timeout | Network timeout | - |
| Connection refused | Connection refused | - |
| Request timeout | Request timeout | 408 |
| Rate limit | Rate limit exceeded | 429 |
| Server errors | Server internal errors | 500, 502, 503, 504 |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Overall System Flow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Main Consumer - Error Classification]                        │
│      ↓                                                          │
│  ├─ Non-Retryable (insufficient funds, revert, etc.)           │
│  │   → Immediate failure (DB update + message deletion)        │
│  │   → Does NOT move to DLQ                                    │
│  │                                                              │
│  └─ Retryable (network, timeout, etc.)                         │
│      → SQS retry (maxReceiveCount: 3)                          │
│      → Auto-move to DLQ after 3 failures                       │
│          ↓                                                      │
│      [DLQ Consumer - Continuous Polling]                       │
│          ↓                                                      │
│      ├─ Check transaction status (idempotency)                 │
│      ├─ retryOnFailure=true → Reprocess (future)              │
│      └─ retryOnFailure=false/null → Immediate failure         │
│          → DB update (status='failed')                         │
│          → DLQ message deletion                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Model

### Transaction Schema Changes

```prisma
model Transaction {
  // Existing fields...
  retryOnFailure  Boolean?  @default(false)  // NEW: DLQ retry strategy
}
```

### ErrorCategory Enum

```typescript
export enum ErrorCategory {
  RETRYABLE = 'RETRYABLE',
  NON_RETRYABLE = 'NON_RETRYABLE',
}
```

## Infrastructure Requirements

### SQS Configuration

**Main Queue** (`relay-transactions`):
- RedrivePolicy MUST be configured with:
  - `maxReceiveCount`: 3 (retry limit)
  - `deadLetterTargetArn`: DLQ ARN

**DLQ** (`relay-transactions-dlq`):
- Standard SQS queue
- No RedrivePolicy (terminal queue)

**Example Configuration**:
```json
{
  "QueueName": "relay-transactions",
  "Attributes": {
    "RedrivePolicy": "{\"maxReceiveCount\":\"3\",\"deadLetterTargetArn\":\"arn:aws:sqs:region:account:relay-transactions-dlq\"}"
  }
}
```

## Implementation Priority

### Phase 1: Error Classification (Priority: High)
- Create `errors/relay-errors.ts`
- Implement `errors/error-classifier.service.ts`
- Modify `consumer.service.ts` catch block

### Phase 2: retryOnFailure Field (Priority: High)
- Modify Prisma schema + migration
- Backfill existing records: `UPDATE Transaction SET retryOnFailure = false WHERE retryOnFailure IS NULL`
- Modify DTOs (DirectTxRequestDto, GaslessTxRequestDto)
- Modify queue service message payload
- Add consumer service DB save logic

### Phase 3: Code Restructuring (Priority: Medium)
- Create `shared/` module (separate common code)
- Create `main-consumer/` module
- Create `dlq-consumer/` module
- Integrate `consumer.module.ts`

### Phase 4: DLQ Consumer Implementation (Priority: High)
- Implement `dlq-consumer.service.ts` with idempotency check
- Implement continuous polling logic (10-second intervals)
- Implement message processing and deletion logic
- Add permanent failure handling policy (CloudWatch alarms)

## Environment Variables

```bash
# Existing
SQS_QUEUE_URL=http://localhost:4566/000000000000/relay-transactions
SQS_DLQ_URL=http://localhost:4566/000000000000/relay-transactions-dlq

# New
DLQ_POLL_INTERVAL_MS=10000  # DLQ polling interval (default 10 seconds)
```

## Test Strategy

### Unit Tests
- ErrorClassifierService: Error pattern matching tests
- DlqConsumerService: Message processing logic tests

### Integration Tests
- Non-retryable error → Immediate failure, no DLQ movement
- Retryable error → SQS retry → DLQ movement
- DLQ Consumer → DB update + message deletion

### E2E Tests (LocalStack)
1. Send message that fails 3 times intentionally
2. Verify automatic movement to DLQ
3. Verify DLQ Consumer processing
4. Verify DB status='failed'
5. Verify DLQ message deletion

## Success Criteria

1. ✅ Non-retryable errors are immediately failed and do NOT move to DLQ
2. ✅ Retryable errors retry 3 times in SQS then move to DLQ
3. ✅ DLQ Consumer continuously polls at 10-second intervals
4. ✅ DLQ messages are always deleted after processing
5. ✅ Compatible with existing clients lacking `retryOnFailure` field
6. ✅ Main Consumer and DLQ Consumer run together in same process
7. ✅ Test coverage ≥90%
8. ✅ Idempotent DLQ message handling (no duplicate processing)
9. ✅ Permanent failure policy defined (CloudWatch alarms + metrics)

## Operational Policy

### Permanent Failure Handling

**When messages reach DLQ**:
- CloudWatch alarm triggers for DLQ message count > 0
- On-call engineer reviews failure reasons
- Manual intervention for business-critical transactions

**Monitoring Requirements**:
- DLQ message count metric
- DLQ processing latency metric
- Error classification distribution metric

## References

- AWS SQS Dead Letter Queue: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
- NestJS Modules: https://docs.nestjs.com/modules
- Prisma Migrations: https://www.prisma.io/docs/concepts/components/prisma-migrate

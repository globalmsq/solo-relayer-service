# Implementation Plan: SPEC-ROUTING-001

**TAG**: SPEC-ROUTING-001 (Multi Relayer Smart Routing + Fire-and-Forget Pattern)

---

## Overview

This implementation plan details the step-by-step execution for adding multi-relayer smart routing and fire-and-forget pattern to the existing SQS queue architecture.

**Total Estimated Effort**: 6-8 hours
**Implementation Phases**: 5 phases
**Priority**: HIGH

---

## Phase 1: Webhook Bug Fix (CRITICAL)

**Duration**: 30-45 minutes
**Objective**: Fix ozRelayerTxId lookup in WebhooksService - MUST be done before Fire-and-Forget

> **Rationale**: Fire-and-Forget pattern relies entirely on webhooks for status updates.
> The webhook bug must be fixed first to ensure proper transaction status tracking.

### Tasks

#### 1.1 Fix WebhooksService updateMysql Method

**File**: `packages/relay-api/src/webhooks/webhooks.service.ts`

**Change Line 116**:
```typescript
// BEFORE (BUG):
const updated = await this.prismaService.transaction.upsert({
  where: { id: transactionId },  // BUG: transactionId is OZ Relayer's ID, not our DB PK
  update: { status, hash, confirmedAt },
  create: { id: transactionId, status, hash, ... }  // Creates wrong records
});

// AFTER (FIXED):
const updated = await this.prismaService.transaction.update({
  where: { ozRelayerTxId: transactionId },  // FIXED: Use ozRelayerTxId field
  data: {
    status,
    hash: hash || undefined,
    confirmedAt: confirmedAt ? new Date(confirmedAt) : undefined,
  },
});
```

**Full Method**:
```typescript
private async updateMysql(payload: OzRelayerWebhookDto) {
  const {
    transactionId,  // This is OZ Relayer's TX ID, NOT our DB primary key
    status,
    hash,
    confirmedAt,
  } = payload;

  try {
    const updated = await this.prismaService.transaction.update({
      where: { ozRelayerTxId: transactionId },  // FIXED
      data: {
        status,
        hash: hash || undefined,
        confirmedAt: confirmedAt ? new Date(confirmedAt) : undefined,
      },
    });

    this.logger.debug(`MySQL updated for ozRelayerTxId=${transactionId}: status=${status}`);
    return updated;
  } catch (error) {
    if (error.code === 'P2025') {
      // Prisma "Record not found" error
      this.logger.error(`Transaction not found for ozRelayerTxId=${transactionId}`);
      throw new NotFoundException(`Transaction not found: ${transactionId}`);
    }

    this.logger.error(
      `MySQL update failed for ozRelayerTxId=${transactionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    throw new InternalServerErrorException('Failed to update transaction in database');
  }
}
```

---

#### 1.2 Update Unit Tests

**File**: `packages/relay-api/src/webhooks/webhooks.service.spec.ts`

Update tests to use `ozRelayerTxId` field:
```typescript
it('should update transaction using ozRelayerTxId', async () => {
  const payload: OzRelayerWebhookDto = {
    transactionId: 'oz-123',  // OZ Relayer's TX ID
    status: 'confirmed',
    hash: '0xabc',
    // ... other fields
  };

  prismaService.transaction.update.mockResolvedValue({
    id: 'our-uuid',
    ozRelayerTxId: 'oz-123',
    status: 'confirmed',
    hash: '0xabc',
  });

  await service.handleWebhook(payload);

  expect(prismaService.transaction.update).toHaveBeenCalledWith({
    where: { ozRelayerTxId: 'oz-123' },  // FIXED
    data: expect.objectContaining({ status: 'confirmed', hash: '0xabc' }),
  });
});

it('should throw NotFoundException when transaction not found', async () => {
  const payload: OzRelayerWebhookDto = {
    transactionId: 'oz-nonexistent',
    status: 'confirmed',
    hash: '0xabc',
  };

  prismaService.transaction.update.mockRejectedValue({ code: 'P2025' });

  await expect(service.handleWebhook(payload)).rejects.toThrow(NotFoundException);
});
```

---

## Phase 2: Docker Infrastructure - Multi Relayer Setup

**Duration**: 30-45 minutes
**Objective**: Add oz-relayer-2 and oz-relayer-3 to Docker Compose

### Pre-existing Resources (No Action Needed)

The following resources **already exist** from SPEC-INFRA-001:

| Resource | Path | Status |
|----------|------|--------|
| Relayer 2 Config | `docker/config/oz-relayer/relayer-2.json` | ✅ EXISTS (with webhook config) |
| Relayer 3 Config | `docker/config/oz-relayer/relayer-3.json` | ✅ EXISTS (with webhook config) |
| Relayer 2 Keystore | `docker/keys/relayer-2/keystore.json` | ✅ EXISTS |
| Relayer 3 Keystore | `docker/keys/relayer-3/keystore.json` | ✅ EXISTS |

### Tasks

#### 2.1 Add oz-relayer-2 and oz-relayer-3 Services

**File**: `docker/docker-compose.yaml`

**Implementation** (add after oz-relayer-1 service):
```yaml
oz-relayer-2:
  <<: *relayer-common
  ports:
    - "8082:8080"
    - "8092:8081"
  volumes:
    - ./config/oz-relayer/relayer-2.json:/app/config/config.json:ro
    - ./keys/relayer-2:/app/config/keys:ro
  environment:
    <<: *relayer-env
    API_KEY: ${OZ_RELAYER_API_KEY:-oz-relayer-shared-api-key-local-dev}

oz-relayer-3:
  <<: *relayer-common
  ports:
    - "8083:8080"
    - "8093:8081"
  volumes:
    - ./config/oz-relayer/relayer-3.json:/app/config/config.json:ro
    - ./keys/relayer-3:/app/config/keys:ro
  environment:
    <<: *relayer-env
    API_KEY: ${OZ_RELAYER_API_KEY:-oz-relayer-shared-api-key-local-dev}
```

**Verification**:
```bash
docker compose up oz-relayer-1 oz-relayer-2 oz-relayer-3 -d
docker compose ps | grep oz-relayer
# Should show 3 relayers with healthy status
```

---

#### 2.2 Update relay-api Dependencies

**File**: `docker/docker-compose.yaml`

Update `relay-api.depends_on` to include all relayers:
```yaml
relay-api:
  depends_on:
    redis:
      condition: service_healthy
    mysql:
      condition: service_healthy
    oz-relayer-1:
      condition: service_healthy
    oz-relayer-2:
      condition: service_healthy
    oz-relayer-3:
      condition: service_healthy
```

---

## Phase 3: Smart Routing Service Implementation

**Duration**: 2-3 hours
**Objective**: Create RelayerRouterService with intelligent relayer selection

### Tasks

#### 3.1 Create RelayerRouterService

**File**: `packages/queue-consumer/src/relay/relayer-router.service.ts`

**Implementation**:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

interface RelayerInfo {
  url: string;
  relayerId: string;
  numberOfPendingTransactions: number;
  healthy: boolean;
}

@Injectable()
export class RelayerRouterService {
  private readonly logger = new Logger(RelayerRouterService.name);
  private readonly relayers: { url: string; relayerId: string }[];
  private readonly httpClient: AxiosInstance;
  private healthCache = new Map<string, { healthy: boolean; timestamp: number }>();
  private readonly HEALTH_CACHE_TTL = 10000; // 10 seconds

  constructor(private readonly configService: ConfigService) {
    const urlsString = this.configService.get<string>('OZ_RELAYER_URLS');
    if (!urlsString) {
      throw new Error('OZ_RELAYER_URLS environment variable not set');
    }

    this.relayers = urlsString.split(',').map((url, index) => ({
      url: url.trim(),
      relayerId: `relayer-${index + 1}`,
    }));

    this.httpClient = axios.create({
      timeout: 500, // 500ms timeout for health checks
      headers: {
        Authorization: `Bearer ${this.configService.get('OZ_RELAYER_API_KEY')}`,
      },
    });

    this.logger.log(`Initialized with ${this.relayers.length} relayers: ${this.relayers.map(r => r.url).join(', ')}`);
  }

  /**
   * Select available relayer with lowest pending TX count
   *
   * Algorithm:
   * 1. Query all relayers for pending TX count
   * 2. Filter out unhealthy relayers (cached health status)
   * 3. Select relayer with lowest numberOfPendingTransactions
   * 4. Fall back to round-robin if all health checks fail
   */
  async getAvailableRelayer(): Promise<string> {
    const relayerInfos = await Promise.allSettled(
      this.relayers.map(async (relayer) => {
        const healthy = await this.isHealthy(relayer.url);
        if (!healthy) {
          return null;
        }

        try {
          const response = await this.httpClient.get(`${relayer.url}/relayers/${relayer.relayerId}`);
          return {
            url: relayer.url,
            relayerId: relayer.relayerId,
            numberOfPendingTransactions: response.data.numberOfPendingTransactions || 0,
            healthy: true,
          } as RelayerInfo;
        } catch (error) {
          this.logger.warn(`Failed to fetch pending TX count from ${relayer.url}: ${error.message}`);
          return null;
        }
      })
    );

    const healthyRelayers = relayerInfos
      .filter((result) => result.status === 'fulfilled' && result.value !== null)
      .map((result) => (result as PromiseFulfilledResult<RelayerInfo | null>).value)
      .filter((info): info is RelayerInfo => info !== null);

    if (healthyRelayers.length === 0) {
      this.logger.warn('No healthy relayers found, falling back to round-robin');
      return this.roundRobinFallback();
    }

    // Select relayer with lowest pending TX count
    const selected = healthyRelayers.reduce((min, current) =>
      current.numberOfPendingTransactions < min.numberOfPendingTransactions ? current : min
    );

    this.logger.log(
      `Selected ${selected.relayerId} (${selected.url}) with ${selected.numberOfPendingTransactions} pending TXs`
    );

    return selected.url;
  }

  /**
   * Check relayer health with 10-second cache
   */
  private async isHealthy(url: string): Promise<boolean> {
    const cached = this.healthCache.get(url);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.HEALTH_CACHE_TTL) {
      return cached.healthy;
    }

    try {
      await this.httpClient.get(`${url}/health`, { timeout: 500 });
      this.healthCache.set(url, { healthy: true, timestamp: now });
      return true;
    } catch (error) {
      this.logger.warn(`Health check failed for ${url}: ${error.message}`);
      this.healthCache.set(url, { healthy: false, timestamp: now });
      return false;
    }
  }

  /**
   * Round-robin fallback when all health checks fail
   */
  private roundRobinIndex = 0;
  private roundRobinFallback(): string {
    const selected = this.relayers[this.roundRobinIndex];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % this.relayers.length;
    this.logger.log(`Round-robin fallback: ${selected.url}`);
    return selected.url;
  }
}
```

**Unit Tests**: `packages/queue-consumer/src/relay/relayer-router.service.spec.ts`

---

#### 3.2 Update ConsumerModule

**File**: `packages/queue-consumer/src/consumer.module.ts`

Add RelayerRouterService to providers:
```typescript
import { RelayerRouterService } from './relay/relayer-router.service';

@Module({
  providers: [
    ConsumerService,
    SqsAdapter,
    OzRelayerClient,
    PrismaService,
    RelayerRouterService,  // Add this
    // ... existing providers
  ],
})
export class ConsumerModule {}
```

---

#### 3.3 Update queue-consumer Environment Variables

**File**: `docker/docker-compose.yaml`

Update queue-consumer service:
```yaml
queue-consumer:
  environment:
    # ... existing env vars
    OZ_RELAYER_URLS: http://oz-relayer-1:8080,http://oz-relayer-2:8080,http://oz-relayer-3:8080
    OZ_RELAYER_API_KEY: ${OZ_RELAYER_API_KEY:-oz-relayer-shared-api-key-local-dev}
```

---

## Phase 4: Fire-and-Forget Pattern Implementation

**Duration**: 2-3 hours
**Objective**: Remove blocking polling, rely on webhooks for status updates

### Tasks

#### 4.1 Add Async Methods to OzRelayerClient

**File**: `packages/queue-consumer/src/relay/oz-relayer.client.ts`

Add new methods:
```typescript
/**
 * Send Direct Transaction (Fire-and-Forget)
 *
 * Does NOT poll for confirmation.
 * Returns immediately after OZ Relayer accepts TX.
 */
async sendDirectTransactionAsync(
  request: DirectTxRequest,
  relayerUrl: string
): Promise<{ transactionId: string; status: string }> {
  this.logger.log(`Sending direct TX to ${relayerUrl} (fire-and-forget)`);

  const response = await this.httpClient.post(`${relayerUrl}/transactions`, {
    to: request.to,
    data: request.data,
    value: request.value || '0',
    gasLimit: request.gasLimit,
    speed: request.speed || 'fast',
  });

  this.logger.log(`TX submitted: ${response.data.transactionId} (status: ${response.data.status})`);

  return {
    transactionId: response.data.transactionId,
    status: response.data.status || 'pending',
  };
}

/**
 * Send Gasless Transaction (Fire-and-Forget)
 */
async sendGaslessTransactionAsync(
  request: GaslessTxRequest,
  forwarderAddress: string,
  relayerUrl: string
): Promise<{ transactionId: string; status: string }> {
  this.logger.log(`Sending gasless TX to ${relayerUrl} (fire-and-forget)`);

  const response = await this.httpClient.post(`${relayerUrl}/transactions`, {
    to: forwarderAddress,
    data: this.encodeGaslessRequest(request),
    gasLimit: request.request.gas,
    speed: 'fast',
  });

  this.logger.log(`TX submitted: ${response.data.transactionId} (status: ${response.data.status})`);

  return {
    transactionId: response.data.transactionId,
    status: response.data.status || 'pending',
  };
}

/**
 * Poll existing transaction (for idempotency)
 */
async pollExistingTransaction(ozRelayerTxId: string, relayerUrl: string): Promise<any> {
  this.logger.log(`Polling existing TX: ${ozRelayerTxId} at ${relayerUrl}`);

  const response = await this.httpClient.get(`${relayerUrl}/transactions/${ozRelayerTxId}`);

  return response.data;
}
```

---

#### 4.2 Update ConsumerService to Use Fire-and-Forget

**File**: `packages/queue-consumer/src/consumer.service.ts`

**Changes**:
1. Inject `RelayerRouterService`
2. Remove `pollForConfirmation()` calls
3. Save `ozRelayerTxId` immediately
4. Delete SQS message immediately
5. **Do NOT update hash field** (Webhook is the single source of truth for hash)

**Modified handleMessage method**:
```typescript
private async handleMessage(message: any): Promise<void> {
  const { MessageId, Body, ReceiptHandle } = message;

  try {
    const messageBody: QueueMessage = JSON.parse(Body);
    const { transactionId, type } = messageBody;

    this.logger.log(`Processing message: ${transactionId} (${type})`);

    // Check if transaction already processed (idempotent)
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (transaction && ['confirmed', 'failed'].includes(transaction.status)) {
      this.logger.log(
        `Transaction already in terminal state: ${transaction.status}, deleting message`,
      );
      await this.sqsAdapter.deleteMessage(ReceiptHandle);
      return;
    }

    // CRITICAL: Check if OZ Relayer TX was already submitted (race condition prevention)
    if (transaction?.ozRelayerTxId) {
      this.logger.log(
        `Transaction ${transactionId} already submitted (${transaction.ozRelayerTxId}), skipping`,
      );
      // Do NOT poll - just delete message and let webhook handle status update
      await this.sqsAdapter.deleteMessage(ReceiptHandle);
      this.logger.log(`Message deleted (already submitted): ${transactionId}`);
      return;
    }

    // Mark as processing to prevent race conditions
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'processing' },
    });

    // Smart Routing: Select least busy relayer
    const relayerUrl = await this.relayerRouter.getAvailableRelayer();
    this.logger.log(`Selected relayer: ${relayerUrl}`);

    // Fire-and-Forget: Send TX without polling
    let result: { transactionId: string; status: string };

    if (type === 'direct') {
      const directMessage = messageBody as DirectMessage;
      result = await this.relayerClient.sendDirectTransactionAsync(
        directMessage.request,
        relayerUrl,
      );
    } else if (type === 'gasless') {
      const gaslessMessage = messageBody as GaslessMessage;
      result = await this.relayerClient.sendGaslessTransactionAsync(
        gaslessMessage.request,
        gaslessMessage.forwarderAddress,
        relayerUrl,
      );
    } else {
      throw new Error(`Unknown transaction type: ${type}`);
    }

    // Save ozRelayerTxId and ozRelayerUrl immediately
    // NOTE: Do NOT set hash here - Webhook is the single source of truth for hash
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'submitted',  // NOT 'confirmed'
        ozRelayerTxId: result.transactionId,
        ozRelayerUrl: relayerUrl,  // Track which relayer handled this TX
        // hash is NOT set here - only Webhook updates hash (prevents race condition)
        result,
      },
    });

    // Delete message immediately (fire-and-forget)
    await this.sqsAdapter.deleteMessage(ReceiptHandle);

    this.logger.log(`Message processed successfully (fire-and-forget): ${transactionId}`);
  } catch (error: unknown) {
    const err = error as Error;
    this.logger.error(
      `Failed to process message ${MessageId}: ${err.message}`,
      err.stack,
    );

    // Message will be automatically returned to queue due to visibility timeout
    // SQS will retry up to maxReceiveCount times before moving to DLQ
  }
}
```

---

#### 4.3 Add ozRelayerUrl Field to Schema

**File**: `packages/relay-api/prisma/schema.prisma`

**Add field to Transaction model**:
```prisma
model Transaction {
  // ... existing fields
  ozRelayerTxId String?   @unique @map("oz_relayer_tx_id")
  ozRelayerUrl  String?   @map("oz_relayer_url")  // NEW: Track which relayer handled this TX
  // ... rest of fields
}
```

**Migration**:
```bash
pnpm exec prisma migrate dev --name add_oz_relayer_url
```

---

## Phase 5: Hash Field Race Condition Prevention

**Duration**: Included in Phase 4
**Objective**: Ensure only Webhook updates hash field to prevent race condition

### Problem Analysis

```
Consumer (polling)     → stores result.txHash in hash field
Webhook (async)        → stores payload.hash in hash field
                        ↓
                   Race Condition!
```

### Solution: Webhook is Single Source of Truth

**Rationale**: Fire-and-Forget pattern means Consumer no longer polls, so Webhook is the ONLY source for hash updates.

| Component | Sets `ozRelayerTxId` | Sets `hash` | Sets `status` |
|-----------|---------------------|-------------|---------------|
| Consumer | ✅ YES | ❌ NO | `submitted` |
| Webhook | ❌ NO | ✅ YES | `confirmed`/`failed` |

### Result
- No race condition - only Webhook updates hash
- Consumer only tracks submission (ozRelayerTxId)
- Clean separation of responsibilities

---

## Testing Strategy

### Unit Tests (≥90% Coverage)

**Files to Test**:
1. `relayer-router.service.spec.ts` (12 tests)
   - Smart routing selects least busy relayer
   - Health check caching (10s TTL)
   - Round-robin fallback when all unhealthy
   - Error handling for API failures

2. `consumer.service.spec.ts` (Update existing, +8 tests)
   - Fire-and-Forget TX submission
   - Immediate SQS message deletion
   - ozRelayerTxId idempotency check
   - Smart router integration
   - Does NOT update hash field

3. `webhooks.service.spec.ts` (Update existing, +3 tests)
   - ozRelayerTxId lookup (FIXED)
   - NotFoundException when TX not found
   - Status update from OZ Relayer webhook

4. `oz-relayer.client.spec.ts` (Update existing, +6 tests)
   - sendDirectTransactionAsync (no polling)
   - sendGaslessTransactionAsync (no polling)
   - pollExistingTransaction (idempotency)

### Integration Tests (E2E)

**Scenario 1: Smart Routing with Load Balancing**
```typescript
// Given: 3 OZ Relayers with pending TXs: R1=10, R2=5, R3=20
// When: Consumer receives TX from SQS
// Then: Smart Router selects R2 (lowest pending count)
// And: TX is submitted to R2
// And: SQS message deleted within 1 second
```

**Scenario 2: Fire-and-Forget Pattern**
```typescript
// Given: Consumer submits TX to OZ Relayer
// When: OZ Relayer returns {transactionId: "oz-123"}
// Then: Consumer saves ozRelayerTxId="oz-123", status="submitted"
// And: Consumer does NOT save hash (Webhook will set this)
// And: Consumer deletes SQS message immediately (no polling)
```

**Scenario 3: Webhook Updates TX Status**
```typescript
// Given: Transaction exists with ozRelayerTxId="oz-123", status="submitted", hash=null
// When: Webhook receives {transactionId: "oz-123", status: "confirmed", hash: "0xabc"}
// Then: WebhooksService queries WHERE ozRelayerTxId="oz-123"
// And: Transaction status updated to "confirmed", hash="0xabc"
// And: Webhook returns 200 OK
```

**Scenario 4: Idempotent TX Processing**
```typescript
// Given: TX already submitted with ozRelayerTxId="oz-123"
// When: Consumer receives duplicate SQS message
// Then: Consumer detects ozRelayerTxId exists
// And: Consumer deletes SQS message (does NOT re-submit)
// And: Webhook handles status update
```

---

## Rollout Plan

### Step 1: Webhook Bug Fix (Day 1, First)
1. Fix WebhooksService to use ozRelayerTxId lookup
2. Add unit tests for NotFoundException
3. Verify webhook processing works correctly

### Step 2: Infrastructure (Day 1)
1. Add oz-relayer-2 and oz-relayer-3 to docker-compose.yaml
2. Verify all 3 relayers connect to shared Redis
3. Test webhook delivery to all relayers

### Step 3: Smart Routing (Day 2)
1. Implement RelayerRouterService
2. Add unit tests (≥90% coverage)
3. Update ConsumerService to use smart router
4. Test with LocalStack SQS

### Step 4: Fire-and-Forget (Day 3)
1. Add async methods to OzRelayerClient
2. Update ConsumerService to remove polling
3. Ensure Consumer does NOT update hash field
4. Run E2E tests

### Step 5: Validation (Day 4)
1. Full integration test suite
2. Load testing with 100 TXs/second
3. Verify webhook processing <200ms
4. Verify SQS message retention reduced by 95%

---

## Success Metrics

- [ ] **Webhook Bug Fix**: Uses ozRelayerTxId lookup, throws NotFoundException
- [ ] **Smart Routing**: Relayer selection <100ms
- [ ] **Fire-and-Forget**: SQS message deleted within 1 second
- [ ] **Hash Separation**: Only Webhook updates hash field
- [ ] **Relayer Tracking**: ozRelayerUrl saved with transaction for debugging
- [ ] **Webhook Processing**: <200ms (MySQL + Redis update)
- [ ] **Test Coverage**: ≥90% for all new code
- [ ] **Load Test**: 100 TXs/second with 3 relayers
- [ ] **Idempotency**: Duplicate SQS messages handled correctly

---

**Version**: 1.1.0
**Last Updated**: 2026-01-08
**Changes from 1.0.0**:
- Moved Webhook Bug Fix to Phase 1 (CRITICAL priority)
- Added Phase 5: Hash Race Condition Prevention
- Noted pre-existing config files and keystores
- Updated Consumer to NOT update hash field
- Added DC-005: ozRelayerUrl field for relayer tracking
- Added Phase 4.3: Schema migration for ozRelayerUrl

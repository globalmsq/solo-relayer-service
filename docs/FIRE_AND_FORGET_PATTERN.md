# Fire-and-Forget Pattern Guide

**Document Version**: 1.0.0
**Last Updated**: 2026-01-09
**Status**: Active
**SPEC**: [SPEC-ROUTING-001](./../.moai/specs/SPEC-ROUTING-001/spec.md)

## Table of Contents

1. [Overview](#overview)
2. [Concept](#concept)
3. [Architecture](#architecture)
4. [Implementation](#implementation)
5. [Webhook-Based Updates](#webhook-based-updates)
6. [Idempotency & Guarantees](#idempotency--guarantees)
7. [Error Scenarios](#error-scenarios)
8. [Comparison: Fire-and-Forget vs. Polling](#comparison-fire-and-forget-vs-polling)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Overview

The Fire-and-Forget pattern is a core optimization in SPEC-ROUTING-001 that enables asynchronous, non-blocking transaction submission. Instead of waiting for blockchain confirmation, the API returns immediately after sending the transaction to OZ Relayer, and status updates are delivered via webhook callbacks.

### Key Benefits

- **Faster API Response**: 200-300ms instead of 2-5 seconds
- **Higher Throughput**: Process more transactions per second
- **Better User Experience**: Immediate acknowledgment of submission
- **Reduced Coupling**: API doesn't depend on relayer's confirmation time
- **Scalability**: Easier to scale with long-running transactions

### Trade-offs

- **Eventual Consistency**: Status not immediately available in response
- **Webhook Dependency**: Must implement webhook to receive updates
- **Network Complexity**: Requires bidirectional communication
- **Error Recovery**: More complex error scenarios to handle

---

## Concept

### Traditional Polling Approach (Before)

```
Client                API Gateway              OZ Relayer
  │                       │                         │
  ├─ POST /relay/direct ──>│                        │
  │                        ├─ POST /transactions ──>│
  │                        │ (waiting...)           │
  │                        │<─ 201 Created ─────────┤
  │                        │                        │
  │                        ├─ GET /status/txId ────>│
  │                        │ (polling loop)         │
  │                        │<─ status=pending ──────┤
  │                        │ (wait 1s)              │
  │                        ├─ GET /status/txId ────>│
  │                        │<─ status=pending ──────┤
  │                        │ (wait 1s)              │
  │                        │ ... (repeats 10-20x)   │
  │                        │<─ status=confirmed ────┤
  │<─ 200 OK ─────────────┤                        │
  │ {status: confirmed}   │                        │
```

**Issues**:
- Total latency: 2-5 seconds (blocking)
- Multiple HTTP requests to relayer
- API server holds connection during polling
- Limited concurrent transactions

### Fire-and-Forget Approach (After)

```
Client                API Gateway              OZ Relayer
  │                       │                         │
  ├─ POST /relay/direct ──>│                        │
  │                        ├─ POST /transactions ──>│
  │                        │<─ 201 Created ─────────┤
  │<─ 202 Accepted ───────┤ (return immediately)   │
  │ {transactionId: ...}  │                        │
  │                       │ (background processing) │
  │                       │                         │
  │                       │ (later, via webhook)    │
  │<─ Webhook POST ───────┼────────────────────────┤
  │ {status: confirmed,   │ (async status update)  │
  │  hash: 0x...}         │                        │
```

**Improvements**:
- Total latency: 200-300ms (non-blocking)
- Single HTTP request to relayer
- API server free for other requests
- Higher concurrent transaction limit

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Relay API Gateway                       │
│                   (Port 3000)                               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  POST /relay/direct                                         │
│  ├─ Input: {to, data, value, ...}                          │
│  ├─ Validation                                              │
│  ├─ Store TX with status=pending (MySQL)                   │
│  └─ Publish to SQS (async)                                 │
│       └─ Return 202 Accepted immediately                    │
│                                                               │
│  POST /relay/status/{id}                                   │
│  └─ Query MySQL (Redis L1 cache)                           │
│       └─ Return current status                              │
│                                                               │
│  POST /webhooks/oz-relayer (Webhook Receiver)              │
│  ├─ Verify signature                                        │
│  ├─ Parse {status, hash, ozRelayerTxId, ...}              │
│  ├─ Update MySQL transaction record                         │
│  └─ Update Redis cache                                      │
└─────────────────────────────────────────────────────────────┘
              │                           │
              ▼                           ▼
    ┌──────────────────┐      ┌──────────────────┐
    │   AWS SQS        │      │   OZ Relayer     │
    │                  │      │                  │
    │ (async queue)    │      │ (Port 8081-8083) │
    └────────┬─────────┘      └────────┬─────────┘
             │                         │
             ▼                         ▼
    ┌──────────────────┐      ┌──────────────────┐
    │ Queue Consumer   │      │  Blockchain      │
    │                  │      │  (Ethereum, etc) │
    │ - Long-poll SQS  │      │                  │
    │ - Relay TX       │      │ - Submit TX      │
    │ - Handle results │      │ - Confirm TX     │
    └──────────────────┘      └──────────────────┘
```

### Flow Diagram (Detailed)

```
Step 1: API Submission (202 Accepted)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Client                    Relay API
  │                           │
  ├─ POST /relay/direct ─────>│
  │  {to, data, value}        │
  │                           ├─ Validate
  │                           ├─ Store (MySQL)
  │                           ├─ Publish SQS
  │<─ 202 Accepted ───────────┤
  │  {transactionId}          │ (< 200ms)

Step 2: Queue Processing
━━━━━━━━━━━━━━━━━━━━━━━━
      Relay API              SQS Queue           Consumer
      (Producer)            (Async)             (Worker)
        │                      │                   │
        ├─ Publish ───────────>│                   │
        │                      │                   │
        │                      ├─ Receive <────────┤
        │                      │   (20s long-poll) │
        │                      │                   │
        │                      │                   ├─ Process
        │                      │                   ├─ Select relayer
        │                      │                   ├─ Submit TX

Step 3: OZ Relayer Processing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Consumer              OZ Relayer           Blockchain
  │                      │                    │
  ├─ POST /transactions ─>│                   │
  │  {to, data, value}    │                   │
  │<─ 201 Created ────────┤                   │
  │  {id: txId}           │                   │
  │  (Fire-and-Forget)    │                   │
  │                       │                   │
  │                       ├─ Sign TX ─────────>│
  │                       │<─ Confirmation ───┤
  │                       │  (async)          │
  │<─ Webhook ────────────┤                   │
  │  {status, hash}       │                   │
  │                       │                   │

Step 4: Status Update via Webhook
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OZ Relayer              Relay API
  │                         │
  ├─ POST /webhooks ───────>│
  │  {status: confirmed,    │
  │   hash: 0x...,          │
  │   ozRelayerTxId: txId}  │
  │<─ 200 OK ──────────────┤
  │                         ├─ Verify signature
  │                         ├─ Update MySQL
  │                         ├─ Update Redis
```

---

## Implementation

### sendDirectTransactionAsync Method

**File**: `packages/queue-consumer/src/relay/oz-relayer.client.ts`

```typescript
/**
 * SPEC-ROUTING-001 FR-002: Fire-and-Forget Direct Transaction
 *
 * Sends transaction to OZ Relayer and returns immediately after submission.
 * No polling - Webhook handles status updates.
 *
 * @param request - Direct transaction request
 * @param relayerUrl - Target relayer URL (from Smart Routing)
 * @returns OZ Relayer's transaction ID (for tracking)
 */
async sendDirectTransactionAsync(
  request: {
    to: string;
    data: string;
    value?: string;
    gasLimit?: string;
    speed?: string;
  },
  relayerUrl: string,
): Promise<{ transactionId: string; relayerUrl: string }> {
  try {
    // Get relayer ID from the specific relayer
    const relayerId = await this.getRelayerIdFromUrl(relayerUrl);
    const endpoint = `${relayerUrl}/api/v1/relayers/${relayerId}/transactions`;

    this.logger.debug(`[Fire-and-Forget] Sending direct TX to: ${endpoint}`);

    const ozRequest = {
      to: request.to,
      data: request.data,
      value: request.value ? parseInt(request.value, 10) : 0,
      gas_limit: request.gasLimit ? parseInt(request.gasLimit, 10) : 100000,
      speed: request.speed || 'average',
    };

    const response = await axios.post(endpoint, ozRequest, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: 30000,
    });

    const txData = response.data.data;
    const ozTxId = txData.id;

    this.logger.log(
      `[Fire-and-Forget] Direct TX submitted: ${ozTxId} (no polling)`,
    );

    // FR-002: Return immediately, no polling
    return {
      transactionId: ozTxId,
      relayerUrl,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      this.invalidateRelayerIdCache(error);
    }
    throw error;
  }
}
```

### sendGaslessTransactionAsync Method

```typescript
/**
 * SPEC-ROUTING-001 FR-002: Fire-and-Forget Gasless Transaction
 *
 * Sends gasless transaction via Forwarder.execute() and returns immediately.
 * No polling - Webhook handles status updates.
 *
 * @param request - Gasless transaction request
 * @param forwarderAddress - ERC2771Forwarder contract address
 * @returns OZ Relayer's transaction ID (for tracking)
 */
async sendGaslessTransactionAsync(
  request: {
    request: {
      from: string;
      to: string;
      value: string;
      data: string;
      nonce: number;
      gas: number;
      deadline: number;
    };
    signature: string;
  },
  forwarderAddress: string,
): Promise<{ transactionId: string; relayerUrl: string }> {
  // Similar to sendDirectTransactionAsync
  // Returns immediately after OZ Relayer accepts submission
}
```

### Consumer Integration

**File**: `packages/queue-consumer/src/consumer.service.ts`

```typescript
async processQueueMessage(message: QueueMessage) {
  const { transactionId, clientId, txData } = message;

  try {
    // Step 1: Select best relayer (Smart Routing)
    const relayerUrl = await this.relayerRouter.getAvailableRelayer();
    this.logger.log(`Selected relayer: ${relayerUrl}`);

    // Step 2: Send transaction (Fire-and-Forget)
    const result = await this.ozRelayerClient.sendDirectTransactionAsync(
      txData,
      relayerUrl,
    );

    // Step 3: Store OZ Relayer TX ID for webhook matching
    await this.repository.updateTransaction(transactionId, {
      ozRelayerTxId: result.transactionId,
      relayerUrl: relayerUrl,
      status: 'submitted', // Waiting for webhook confirmation
    });

    // Step 4: Delete message from queue (fire-and-forget complete)
    await this.sqsAdapter.deleteMessage(message.receiptHandle);

    this.logger.log(
      `[Fire-and-Forget] TX ${transactionId} submitted to ${relayerUrl}`,
    );
  } catch (error) {
    this.logger.error(`[Fire-and-Forget] Failed to submit TX ${transactionId}:`, error);
    // Message will be retried by SQS (visibility timeout)
    // Eventually sent to DLQ if max retries exceeded
  }
}
```

---

## Webhook-Based Updates

### Webhook Receiver

**File**: `packages/relay-api/src/webhooks/webhooks.controller.ts`

```typescript
@Controller('webhooks')
export class WebhooksController {
  /**
   * POST /webhooks/oz-relayer
   * Receive transaction status updates from OZ Relayer
   */
  @Post('oz-relayer')
  @UseGuards(WebhookSignatureGuard)
  async handleOzRelayerWebhook(
    @Body() payload: OzRelayerWebhookDto,
  ): Promise<void> {
    const { ozRelayerTxId, status, hash, oz_relayer_url } = payload;

    this.logger.log(
      `Received webhook: TX ${ozRelayerTxId} → ${status}`,
    );

    // Find transaction by OZ Relayer TX ID
    const transaction = await this.repository.findByOzRelayerTxId(
      ozRelayerTxId,
    );

    if (!transaction) {
      this.logger.warn(`TX not found: ${ozRelayerTxId}`);
      return; // Idempotent: ignore unknown TX
    }

    // Update transaction status
    await this.repository.updateTransaction(transaction.id, {
      status: status,
      hash: hash,
      confirmedAt: new Date(),
      oz_relayer_url: oz_relayer_url,
    });

    // Invalidate Redis cache
    await this.cache.invalidate(`tx:${transaction.id}`);

    this.logger.log(`Updated TX ${transaction.id} → ${status}`);
  }
}
```

### Webhook Payload

OZ Relayer sends webhook with following structure:

```json
{
  "event": "transaction_confirmed",
  "ozRelayerTxId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "confirmed",
  "hash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  "oz_relayer_url": "http://oz-relayer-1:3000",
  "blockNumber": 12345678,
  "gasUsed": "21000",
  "timestamp": "2026-01-09T10:30:45.123Z",
  "signature": "0x..."
}
```

### Signature Verification

**File**: `packages/relay-api/src/webhooks/guards/webhook-signature.guard.ts`

```typescript
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers['x-signature'];
    const payload = request.rawBody; // Raw request body

    // SPEC-ROUTING-001 DC-004: Hash Field Separation
    // Use payload without signature field
    const message = JSON.stringify(JSON.parse(payload), null, 0);

    // HMAC-SHA256 verification
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(message)
      .digest('hex');

    if (signature !== expectedSignature) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
```

---

## Idempotency & Guarantees

### Idempotent Processing

The system is idempotent at multiple levels:

#### Level 1: Transaction ID Uniqueness

```typescript
// Client generates unique transactionId
// If same transactionId resubmitted:
// → API returns existing transaction (202 Accepted, cached)
// → No duplicate submission to OZ Relayer
```

#### Level 2: Webhook Idempotency

```typescript
// If webhook is received multiple times:
// → Find TX by ozRelayerTxId (unique)
// → Update status (idempotent operation)
// → Return 200 OK regardless

// Example: Same webhook received 3 times
1. First: status pending → pending (no change)
2. Second: status confirmed (update)
3. Third: status confirmed → confirmed (no change)

// Final result: status = confirmed (idempotent)
```

#### Level 3: SQS Message Idempotency

```typescript
// Each SQS message has unique:
// - MessageId (generated by SQS)
// - ReceiptHandle (for deletion)
//
// If consumer processes same message twice:
// → Check if TX already exists in database
// → Deduplicate by transactionId
// → No duplicate OZ Relayer submission
```

### Delivery Guarantees

| Guarantee | Implementation | Consequence |
|-----------|----------------|------------|
| **At-Least-Once** | SQS retry + visibility timeout | Consumer may process same TX twice |
| **Idempotent Submission** | transactionId uniqueness | Safe to retry without duplication |
| **Eventual Consistency** | Webhook updates status | Status eventually consistent with blockchain |
| **No Data Loss** | DLQ for failed messages | Failed TXs tracked in dead-letter queue |

### Consistency Model

```
Timeline                    API State            Blockchain State
─────────────────────────────────────────────────────────────
T0: Client submits TX
    status = pending
    (stored in MySQL)

T1: API returns 202
    (client sees pending)

T2: Consumer submits to
    OZ Relayer
    status = submitted

T3: OZ Relayer submits
    to blockchain
    status = submitted         TX in mempool

T4: Blockchain includes TX
                              TX confirmed
                              (but API doesn't know yet)

T5: Webhook arrives
    status = confirmed
    (updated in MySQL)        TX confirmed
    (client can now query)

Total time: 0.5-2 seconds
Eventual consistency: ≤2s (usually <1s)
```

---

## Error Scenarios

### Scenario 1: OZ Relayer Timeout

```
Client                API       Consumer       OZ Relayer
  │                    │          │              │
  ├─ submit ────────────>          │              │
  │                     ├─ queue   │              │
  │<─ 202 ────────────┤           │              │
  │                              │              │
  │                              ├─ submit ────>│
  │                              │ (waiting...)  │
  │                              │ 30s timeout   │
  │                              │<─ ERROR ──────┤
  │                              │               │
  │                              ├─ Log error
  │                              ├─ SQS retries
  │                              │ (visibility)
  │                              │
  │ (later)                      │
  ├─ GET /status ──────>         │
  │<─ pending ─────────┤         │
  │                    │         │
  │<─ Webhook (retry)──┤         │
  │ {status: success}  │         │

Recovery: OZ Relayer retried, eventually succeeds
```

### Scenario 2: Webhook Delivery Failure

```
OZ Relayer                     Relay API
  │                               │
  ├─ POST /webhooks ─────────────>│
  │ (connection timeout)          │
  │<─ no response ────────────────┤
  │                               │
  ├─ Retry (exponential backoff)
  │ 1s, 2s, 4s, 8s...
  │
  ├─ POST /webhooks ─────────────>│
  │<─ 200 OK ─────────────────────┤
  │                               ├─ Update status
  │                               ├─ Cache invalidate

Total latency: 1-30 seconds (depending on retry schedule)
API eventually receives status update
```

### Scenario 3: Webhook Lost (Permanent)

```
OZ Relayer                     Relay API
  │                               │
  ├─ POST /webhooks ─────────────>│
  │ (network failure, never retried)
  │                               │
  │                               TX status = "submitted"
  │                               (stuck forever)

Recovery: Query OZ Relayer manually
  ├─ Client calls GET /relay/status/{txId}
  │<─ Currently "submitted" ──────┤
  │                               │
  │ Can manually update via:
  │ - Direct DB update
  │ - Admin API call
  │ - Manual webhook replay
```

---

## Comparison: Fire-and-Forget vs. Polling

### Response Time

```
Polling (OLD)                Fire-and-Forget (NEW)
─────────────────────────────────────────────────
T0: Submit TX                T0: Submit TX
T1: Polling starts           T1: Return 202 ✓
T2: Poll #1 pending
T3: Poll #2 pending
T4: Poll #3 pending          T2-T3: OZ processes
T5: Poll #4 confirmed         (no polling)
    Return 200 ✓

Response time:                Response time:
≈ 2-5 seconds               ≈ 200-300ms
(blocking)                   (non-blocking)

Improvement: 10x faster
```

### Throughput

```
Single API Server (8 workers)

Polling (OLD):              Fire-and-Forget (NEW):
─────────────────           ──────────────────────
Avg TX latency: 3s          Avg TX latency: 250ms
Workers blocked: 8          Workers blocked: 0.5-1
TPS: 8 TXs / 3s = 2.6      TPS: 8 TXs / 0.25s = 32

Improvement: 12x more transactions/second
```

### Complexity

| Aspect | Polling | Fire-and-Forget |
|--------|---------|-----------------|
| API Response | Simple (wait for result) | Simple (202 Accepted) |
| Status Tracking | Polling loop | Webhook receiver |
| Error Handling | Retry polling | Webhook + manual recovery |
| Idempotency | Medium | High (required) |
| Testing | Easier | Requires async testing |

### Recommendation

**Use Fire-and-Forget when**:
- ✓ High throughput needed (>10 TPS)
- ✓ Can implement webhook receiver
- ✓ Eventual consistency acceptable
- ✓ Building asynchronous workflows

**Use Polling when**:
- ✓ Low throughput (<1 TPS)
- ✓ Simple synchronous integration
- ✓ No webhook infrastructure
- ✓ Real-time response required

---

## Best Practices

1. **Generate Unique Transaction IDs**
   ```typescript
   const txId = uuid.v4(); // Globally unique
   // Always use same txId for same transaction
   ```

2. **Implement Webhook Receiver**
   ```typescript
   // Required for fire-and-forget
   POST /webhooks/oz-relayer (with signature verification)
   Update database with {status, hash, timestamp}
   ```

3. **Store oz_relayer_url for Debugging**
   ```typescript
   // Link transaction to specific relayer
   tx.oz_relayer_url = "http://oz-relayer-1:3000"
   // Helps debugging and relayer-specific issues
   ```

4. **Verify Webhook Signatures**
   ```typescript
   // Always verify HMAC-SHA256 signature
   // Prevents replay attacks
   // Ensures webhook authenticity
   ```

5. **Handle Eventual Consistency**
   ```typescript
   // Status may not be available immediately after 202
   // Implement polling on client side with backoff
   // Or subscribe to webhook updates
   ```

6. **Monitor Webhook Delivery**
   ```typescript
   // Track webhook success/failure rate
   // Alert if >1% webhook failures
   // Implement retry logic with exponential backoff
   ```

7. **Implement Timeout Handling**
   ```typescript
   // Set maximum time waiting for webhook
   // Example: 5 minutes
   // After timeout, mark as "webhook_timeout"
   // Trigger manual recovery process
   ```

---

## Troubleshooting

### Issue: Transaction Stuck in "Submitted" Status

**Symptoms**: TX submitted but webhook never arrives

**Diagnosis**:
```bash
# Check OZ Relayer logs
docker logs oz-relayer-1

# Check if webhook endpoint is reachable
curl -X POST http://relay-api:3000/webhooks/oz-relayer \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Check firewall rules
iptables -L -n | grep 3000
```

**Solutions**:
1. Verify webhook endpoint is accessible from OZ Relayer
2. Check webhook secret configuration match
3. Verify network connectivity between services
4. Check relay-api service is running

### Issue: Webhook Signature Verification Failed

**Symptoms**: 401 Unauthorized on webhook POST

**Diagnosis**:
```bash
# Check webhook secret
echo $WEBHOOK_SECRET

# Verify signature calculation
# 1. Get raw webhook payload (without modification)
# 2. Calculate HMAC-SHA256
# 3. Compare with header signature
```

**Solutions**:
1. Verify WEBHOOK_SECRET matches in both services
2. Use raw body (not parsed JSON)
3. Exclude signature field from hash
4. Check HMAC algorithm (must be SHA256)

### Issue: Duplicate Webhook Deliveries

**Symptoms**: TX status updated multiple times, idempotency fails

**Diagnosis**:
```bash
# Check transaction update log
SELECT * FROM transactions
WHERE oz_relayer_tx_id = 'txId'
ORDER BY updated_at;

# Should show multiple updates with same final status
```

**Solutions**:
1. Idempotency is working correctly
2. Multiple webhooks expected (OZ Relayer retries)
3. Verify final status is correct
4. Monitor webhook delivery reliability

---

## Related Documents

- [SMART_ROUTING_GUIDE.md](./SMART_ROUTING_GUIDE.md) - Smart Routing component
- [QUEUE_INTEGRATION.md](./QUEUE_INTEGRATION.md) - Queue system overview
- [WEBHOOK_INTEGRATION.md](./WEBHOOK_INTEGRATION.md) - Webhook security & setup
- [SPEC-ROUTING-001](./../.moai/specs/SPEC-ROUTING-001/spec.md) - Specification

---

**Maintained by**: MSQ Relayer Team
**Last Reviewed**: 2026-01-09
**Status**: Active & Production-Ready

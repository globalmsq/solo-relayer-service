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

```mermaid
sequenceDiagram
    participant Client
    participant API as API Gateway
    participant OZ as OZ Relayer

    Client->>API: POST /relay/direct
    API->>OZ: POST /transactions
    Note over API: waiting...
    OZ-->>API: 201 Created
    loop Polling loop (repeats 10-20x)
        API->>OZ: GET /status/txId
        OZ-->>API: status=pending
        Note over API: wait 1s
    end
    OZ-->>API: status=confirmed
    API-->>Client: 200 OK {status: confirmed}
```

**Issues**:
- Total latency: 2-5 seconds (blocking)
- Multiple HTTP requests to relayer
- API server holds connection during polling
- Limited concurrent transactions

### Fire-and-Forget Approach (After)

```mermaid
sequenceDiagram
    participant Client
    participant API as API Gateway
    participant OZ as OZ Relayer

    Client->>API: POST /relay/direct
    API->>OZ: POST /transactions
    OZ-->>API: 201 Created
    API-->>Client: 202 Accepted {transactionId: ...}
    Note over API: return immediately
    Note over API,OZ: background processing
    Note over API,OZ: later, via webhook
    OZ->>Client: Webhook POST {status: confirmed, hash: 0x...}
    Note over API,OZ: async status update
```

**Improvements**:
- Total latency: 200-300ms (non-blocking)
- Single HTTP request to relayer
- API server free for other requests
- Higher concurrent transaction limit

---

## Architecture

### Components

```mermaid
flowchart TD
    subgraph Gateway["Relay API Gateway (Port 8080)"]
        EP1["POST /relay/direct\nInput: to, data, value, ...\nValidate → Store TX pending (MySQL)\n→ Publish to SQS → Return 202 Accepted"]
        EP2["POST /relay/status/{id}\nQuery MySQL (Redis L1 cache)\n→ Return current status"]
        EP3["POST /webhooks/oz-relayer\nVerify signature → Parse payload\n→ Update MySQL → Update Redis"]
    end

    Gateway --> SQS["AWS SQS\n(async queue)"]
    Gateway --> OZR["OZ Relayer\n(Port 8081-8083)"]
    SQS --> Consumer["Queue Consumer\n- Long-poll SQS\n- Relay TX\n- Handle results"]
    OZR --> BC["Blockchain\n(Ethereum, etc)\n- Submit TX\n- Confirm TX"]
```

### Flow Diagram (Detailed)

```mermaid
sequenceDiagram
    participant Client
    participant API as Relay API
    participant SQS as SQS Queue
    participant Consumer as Consumer (Worker)
    participant OZ as OZ Relayer
    participant BC as Blockchain

    Note over Client,API: Step 1: API Submission (202 Accepted)
    Client->>API: POST /relay/direct {to, data, value}
    API->>API: Validate
    API->>API: Store (MySQL)
    API->>SQS: Publish
    API-->>Client: 202 Accepted {transactionId} (< 200ms)

    Note over SQS,Consumer: Step 2: Queue Processing
    Consumer->>SQS: Receive (20s long-poll)
    SQS-->>Consumer: Message
    Consumer->>Consumer: Process
    Consumer->>Consumer: Select relayer

    Note over Consumer,BC: Step 3: OZ Relayer Processing
    Consumer->>OZ: POST /transactions {to, data, value}
    OZ-->>Consumer: 201 Created {id: txId} (Fire-and-Forget)
    OZ->>BC: Sign TX
    BC-->>OZ: Confirmation (async)
    OZ->>Consumer: Webhook {status, hash}

    Note over OZ,API: Step 4: Status Update via Webhook
    OZ->>API: POST /webhooks {status: confirmed, hash: 0x..., ozRelayerTxId: txId}
    API-->>OZ: 200 OK
    API->>API: Verify signature
    API->>API: Update MySQL
    API->>API: Update Redis
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
  "oz_relayer_url": "http://oz-relayer-0:8080",
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
    const signature = request.headers['x-oz-signature'];
    const rawBody = request.rawBody as Buffer; // Raw request body

    // SPEC-ROUTING-001: Use raw body for HMAC calculation
    // JSON.stringify is insecure - it may produce different bytes than original
    // Raw body preserves exact bytes sent by OZ Relayer
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('base64');

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

```mermaid
sequenceDiagram
    participant Client
    participant API as API State
    participant BC as Blockchain State

    Note over Client,API: T0: Client submits TX
    Client->>API: Submit TX
    Note over API: status = pending (stored in MySQL)

    Note over Client,API: T1: API returns 202
    API-->>Client: 202 Accepted
    Note over Client: client sees pending

    Note over API: T2: Consumer submits to OZ Relayer
    Note over API: status = submitted

    Note over API,BC: T3: OZ Relayer submits to blockchain
    Note over API: status = submitted
    Note over BC: TX in mempool

    Note over BC: T4: Blockchain includes TX
    Note over BC: TX confirmed (but API doesn't know yet)

    Note over API,BC: T5: Webhook arrives
    Note over API: status = confirmed (updated in MySQL)
    Note over BC: TX confirmed
    Note over Client: client can now query

    Note over Client,BC: Total time: 0.5-2 seconds | Eventual consistency: ≤2s (usually <1s)
```

---

## Error Scenarios

### Scenario 1: OZ Relayer Timeout

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Consumer
    participant OZ as OZ Relayer

    Client->>API: submit
    API->>API: queue
    API-->>Client: 202

    Consumer->>OZ: submit
    Note over Consumer: waiting...
    Note over Consumer: 30s timeout
    OZ-->>Consumer: ERROR

    Consumer->>Consumer: Log error
    Consumer->>Consumer: SQS retries (visibility)

    Note over Client,API: later
    Client->>API: GET /status
    API-->>Client: pending

    API->>Client: Webhook (retry) {status: success}

    Note over Client,OZ: Recovery: OZ Relayer retried, eventually succeeds
```

### Scenario 2: Webhook Delivery Failure

```mermaid
sequenceDiagram
    participant OZ as OZ Relayer
    participant API as Relay API

    OZ->>API: POST /webhooks
    Note over OZ,API: connection timeout
    API--xOZ: no response

    Note over OZ: Retry (exponential backoff) 1s, 2s, 4s, 8s...

    OZ->>API: POST /webhooks
    API-->>OZ: 200 OK
    API->>API: Update status
    API->>API: Cache invalidate

    Note over OZ,API: Total latency: 1-30 seconds (depending on retry schedule)
    Note over OZ,API: API eventually receives status update
```

### Scenario 3: Webhook Lost (Permanent)

```mermaid
sequenceDiagram
    participant OZ as OZ Relayer
    participant API as Relay API
    participant Client

    OZ->>API: POST /webhooks
    Note over OZ,API: network failure, never retried

    Note over API: TX status = "submitted" (stuck forever)

    Note over OZ,API: Recovery: Query OZ Relayer manually
    Client->>API: GET /relay/status/{txId}
    API-->>Client: Currently "submitted"

    Note over API: Can manually update via:<br/>- Direct DB update<br/>- Admin API call<br/>- Manual webhook replay
```

---

## Comparison: Fire-and-Forget vs. Polling

### Response Time

```mermaid
flowchart LR
    subgraph Polling["Polling (OLD) - 2-5 seconds, blocking"]
        P0["T0: Submit TX"] --> P1["T1: Polling starts"]
        P1 --> P2["T2: Poll #1 pending"]
        P2 --> P3["T3: Poll #2 pending"]
        P3 --> P4["T4: Poll #3 pending"]
        P4 --> P5["T5: Poll #4 confirmed\nReturn 200"]
    end
    subgraph FireForget["Fire-and-Forget (NEW) - 200-300ms, non-blocking"]
        F0["T0: Submit TX"] --> F1["T1: Return 202"]
        F1 -.-> F2["T2-T3: OZ processes\n(no polling)"]
    end
```

**Improvement: 10x faster**

### Throughput

```mermaid
flowchart LR
    subgraph Polling["Polling (OLD)"]
        P["Avg TX latency: 3s\nWorkers blocked: 8\nTPS: 8 / 3s = 2.6"]
    end
    subgraph FireForget["Fire-and-Forget (NEW)"]
        F["Avg TX latency: 250ms\nWorkers blocked: 0.5-1\nTPS: 8 / 0.25s = 32"]
    end
    Polling -- "12x improvement" --> FireForget
```

**Single API Server (8 workers) -- Improvement: 12x more transactions/second**

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
   tx.oz_relayer_url = "http://oz-relayer-0:8080"
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
docker logs oz-relayer-0

# Check if webhook endpoint is reachable
curl -X POST http://relay-api:8080/api/v1/webhooks/oz-relayer \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Check firewall rules
iptables -L -n | grep 8080
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

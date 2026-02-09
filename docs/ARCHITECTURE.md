# Queue System Architecture

**Document Version**: 1.0.0
**Last Updated**: 2026-01-06
**Status**: Complete
**SPEC**: [SPEC-QUEUE-001](./../.moai/specs/SPEC-QUEUE-001/spec.md)

## Table of Contents

1. [Overview](#overview)
2. [Architecture Layers](#architecture-layers)
3. [Message Flow](#message-flow)
4. [Component Responsibilities](#component-responsibilities)
5. [Data Models](#data-models)
6. [Resilience Patterns](#resilience-patterns)
7. [Deployment Topology](#deployment-topology)

---

## Overview

SPEC-QUEUE-001 transforms the MSQ Relayer from a synchronous request-response system to an asynchronous, scalable queue-based architecture using AWS SQS (with LocalStack for local development).

### Key Architectural Changes

**Before (Synchronous)**:
- Client sends transaction request → API waits for response → OZ Relayer processes synchronously
- Throughput limited by response time (~200ms)
- Tight coupling between API Gateway and OZ Relayer

**After (Asynchronous)**:
- Client sends transaction request → API returns 202 Accepted immediately
- Transaction queued in SQS for background processing
- Decoupled producer (relay-api) and consumer (queue-consumer)
- Independent scaling for API and background workers

### Architecture Principles

1. **Decoupling**: Producer and Consumer are independent services
2. **Resilience**: SQS provides built-in retry and dead letter queue mechanisms
3. **Scalability**: Horizontal scaling by adding consumer instances
4. **Observability**: Transaction status tracked at each stage
5. **Idempotency**: Duplicate message handling via transaction status checks

---

## Architecture Layers

```mermaid
flowchart TD
    APP["<b>Application Layer</b><br/>Client Services: Payment, Airdrop, NFT, DeFi, Game"]
    API["<b>API Gateway Layer (relay-api)</b><br/>Authentication (X-API-Key)<br/>Transaction validation<br/>MySQL persistence (pending status)<br/>SQS message publishing<br/>202 Accepted response"]
    MQ["<b>Message Queue Layer (AWS SQS)</b><br/>Queue: relay-transactions<br/>DLQ: relay-transactions-dlq<br/>Visibility Timeout: 60s | Retention: 4 days<br/>Long-poll: 20s | Max Receive Count: 3"]
    CON["<b>Consumer Layer (queue-consumer)</b><br/>Long-poll SQS (20s wait)<br/>Message deserialization<br/>Idempotency check (MySQL)<br/>Transaction processing | Result handling"]
    EXE["<b>Transaction Execution Layer</b><br/>OZ Relayer (HTTP POST)<br/>Blockchain submission<br/>Status updates (MySQL + Redis)"]

    APP --> API --> MQ --> CON --> EXE
```

### Layer Responsibilities

| Layer | Component | Responsibility |
|-------|-----------|---|
| **API Gateway** | relay-api | Accept requests, store pending TX, publish to SQS |
| **Message Queue** | AWS SQS | Reliable message delivery, retry handling, DLQ |
| **Consumer** | queue-consumer | Long-poll SQS, orchestrate OZ Relayer calls |
| **Execution** | OZ Relayer | Sign and submit transactions to blockchain |
| **Storage** | MySQL + Redis | Transaction history and caching |

---

## Message Flow

### 1. Producer Flow (relay-api)

```mermaid
flowchart TD
    S1["1. Client: POST /api/v1/relay/direct<br/>Payload: to, data, value, gas, speed"]
    S2["2. relay-api: Request Validation<br/>Schema validation (X-API-Key, request body)"]
    S3["3. relay-api: Database Write<br/>Create transaction record<br/>Status: pending<br/>Store: request payload, type (direct/gasless)"]
    S4["4. relay-api: SQS Publishing<br/>Create message: messageId, transactionId,<br/>type, request, timestamp<br/>Send to relay-transactions queue"]
    S5["5. relay-api: Response<br/>HTTP 202 Accepted<br/>Body: transactionId, status: pending, createdAt"]
    S6["6. Client: Polling/Webhook<br/>GET /api/v1/relay/status/{transactionId}<br/>Or wait for webhook notification"]

    S1 --> S2 --> S3 --> S4 --> S5 --> S6
```

### 2. Queue Flow (AWS SQS)

```mermaid
flowchart TD
    Q1["1. Message Arrival<br/>Stored in relay-transactions queue<br/>Visibility Timeout: 60s | Retention: 4 days"]
    Q2["2. Message Reception by Consumer<br/>Long-poll (20s wait time)<br/>Batch receive (up to 10 messages)<br/>Message becomes invisible to other consumers"]
    Q3["3. Message Processing<br/>Consumer processes message"]
    Q3D{Success?}
    Q3Y["Delete message from queue"]
    Q3N["DO NOT DELETE<br/>Message becomes visible again<br/>Retry count increments"]
    Q4["4. Retry Handling<br/>ApproximateReceiveCount tracks retries<br/>Max retries: 3"]
    Q5["5. Dead Letter Queue<br/>Queue: relay-transactions-dlq<br/>Messages stuck after 3 retries<br/>Manual intervention required"]

    Q1 --> Q2 --> Q3 --> Q3D
    Q3D -- Yes --> Q3Y
    Q3D -- No --> Q3N --> Q4
    Q4 -- "After 3 failures" --> Q5
```

### 3. Consumer Flow (queue-consumer)

```mermaid
flowchart TD
    C1["1. Initialize Consumer<br/>Connect to SQS, MySQL, OZ Relayer<br/>Start long-polling loop"]
    C2["2. Receive Messages<br/>Long-poll SQS (20s)<br/>Receive batch (max 10)"]
    C3["3. Per-Message Processing<br/>Parse message<br/>Extract: transactionId, type, request"]
    C4["4. Idempotency Check<br/>Query MySQL: SELECT * FROM transactions WHERE id = ?"]
    C4D{Status?}
    C4Skip["Skip (already processed)"]
    C5["5. OZ Relayer Call<br/>POST /api/v1/relay/{type}<br/>Headers: X-API-Key<br/>Timeout: 30 seconds"]
    C6D{Response?}
    C6OK["Success (200 OK)<br/>Extract: hash, transactionId<br/>Update MySQL: status = success<br/>Update Redis: Cache result (TTL: 600s)<br/>Delete message from SQS"]
    C6Fail["Failure (4xx/5xx)<br/>Log error<br/>Update MySQL: error_message<br/>DO NOT DELETE message (retry)<br/>If retry count = 3: status = failed"]

    C1 --> C2 --> C3 --> C4 --> C4D
    C4D -- "success or failed" --> C4Skip
    C4D -- "pending" --> C5 --> C6D
    C6D -- "200 OK" --> C6OK
    C6D -- "4xx/5xx" --> C6Fail
```

### 4. Status Query Flow

```mermaid
flowchart TD
    Client["Client: GET /api/v1/relay/status/:transactionId"]
    T1["Tier 1: Redis (L1 Cache)<br/>Key: tx:{transactionId}"]
    T1D{Cache Hit?}
    T1Hit["Return cached result<br/>(~1-5ms)"]
    T2["Tier 2: MySQL (L2 Storage)<br/>SELECT * FROM transactions WHERE id = ?"]
    T2D{Found?}
    T2Hit["Backfill Redis cache<br/>Return (~50ms)"]
    T3["Tier 3: OZ Relayer (L3 External)<br/>GET /api/v1/txs/{transactionId}"]
    T3D{Found?}
    T3Hit["Store in MySQL<br/>Cache in Redis<br/>Return (~200ms)"]
    T3Miss["Return Not Found (404)"]

    Client --> T1 --> T1D
    T1D -- Hit --> T1Hit
    T1D -- Miss --> T2 --> T2D
    T2D -- Found --> T2Hit
    T2D -- "Not Found" --> T3 --> T3D
    T3D -- Found --> T3Hit
    T3D -- "Not Found" --> T3Miss
```

---

## Component Responsibilities

### relay-api (Producer)

**Responsibilities**:
- Accept transaction requests from clients
- Validate request schema and authentication
- Store transaction record in MySQL with `pending` status
- Publish message to SQS queue
- Return 202 Accepted response immediately
- Provide status query endpoint (3-tier lookup)

**Key Modules**:
- `relay/direct.controller.ts` - Direct TX endpoint
- `relay/gasless.controller.ts` - Gasless TX endpoint
- `relay/status.controller.ts` - Status query endpoint
- `queue/queue.service.ts` - SQS publishing
- `prisma/prisma.service.ts` - MySQL persistence

### queue-consumer (Consumer)

**Responsibilities**:
- Connect to SQS queue
- Long-poll messages (20s wait time)
- Deserialize message payload
- Check transaction status (idempotency)
- Submit transaction to OZ Relayer
- Update transaction status in MySQL
- Handle failures and DLQ
- Graceful shutdown

**Key Modules**:
- `consumer.service.ts` - Main consumer logic
- `sqs/sqs.adapter.ts` - SQS client wrapper
- `relay/oz-relayer.client.ts` - OZ Relayer HTTP client
- `config/configuration.ts` - Environment configuration

### AWS SQS

**Responsibilities**:
- Store transaction messages durably
- Guarantee message delivery (at-least-once)
- Automatic retry via visibility timeout
- Dead Letter Queue for failed messages
- Message retention for audit trail

**Configuration**:
- Queue Name: `relay-transactions`
- DLQ Name: `relay-transactions-dlq`
- Visibility Timeout: 60 seconds
- Message Retention: 4 days
- Long-poll Wait Time: 20 seconds
- Max Receive Count: 3

---

## Data Models

### SQS Message Format

```json
{
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "transactionId": "550e8400-e29b-41d4-a716-446655440001",
  "type": "direct|gasless",
  "request": {
    "to": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "data": "0x",
    "value": "0",
    "gas": "21000",
    "speed": "fast"
  },
  "timestamp": "2026-01-06T12:34:56.789Z"
}
```

### MySQL Transaction Record

```sql
CREATE TABLE transactions (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(20),                      -- 'direct' | 'gasless'
  status VARCHAR(20),                    -- 'pending' | 'success' | 'failed'
  request JSON,                          -- Original request payload
  result JSON,                           -- OZ Relayer response (hash, transactionId)
  error_message TEXT,                    -- Failure reason
  hash VARCHAR(66),                      -- Blockchain transaction hash
  createdAt DATETIME,
  confirmedAt DATETIME,
  updatedAt DATETIME,

  INDEX(status),
  INDEX(type),
  INDEX(createdAt)
);
```

### Redis Cache Format

```
Key: tx:{transactionId}
Value: {
  "transactionId": "UUID",
  "status": "success|pending|failed",
  "hash": "0x...",
  "confirmedAt": "ISO8601",
  "result": { ... }
}
TTL: 600 seconds (10 minutes)
```

---

## Resilience Patterns

### 1. Message Durability

**Pattern**: At-Least-Once Delivery

```mermaid
flowchart LR
    A["Message"] --> B["SQS<br/>(Durable Storage)"]
    B --> C["Consumer picks up message"]
    C --> D["Visibility Timeout: 60s<br/>(Message hidden from others)"]
    D --> E["Consumer processes"]
    E --> F["Consumer deletes message<br/>(or message expires)"]
```

**Implication**: Consumer MUST be idempotent

### 2. Idempotency

**Pattern**: Idempotent Message Processing

```mermaid
flowchart TD
    MSG["Message: transactionId X, request payload"]
    CHK["1. Check MySQL<br/>SELECT status FROM transactions WHERE id = X"]
    DEC{Status?}
    SKIP["Already processed<br/>Skip processing<br/>Delete message from SQS"]
    PROC["Process message<br/>Update status"]

    MSG --> CHK --> DEC
    DEC -- "success or failed" --> SKIP
    DEC -- "pending" --> PROC
```

### 3. Retry Strategy

**Pattern**: Exponential Backoff via Visibility Timeout

```mermaid
flowchart TD
    A1["Attempt 1: Visibility Timeout = 60s"]
    A1F["Processing fails<br/>Message returned to queue"]
    A2["Attempt 2: Wait 60s, try again"]
    A2F["Processing fails<br/>Message returned to queue"]
    A3["Attempt 3: Wait 60s, try again"]
    A3F["Processing fails<br/>ApproximateReceiveCount = 3"]
    A4["Attempt 4: Message moved to DLQ<br/>No more automatic retries<br/>Manual intervention required"]

    A1 --> A1F --> A2 --> A2F --> A3 --> A3F --> A4
```

### 4. Dead Letter Queue

**Pattern**: Failure Isolation

```mermaid
flowchart TD
    FAIL["Message Processing Failures"]
    NET["Network error"] --> RETRY1["Retry (automatic)"]
    OZ["OZ Relayer error"] --> RETRY2["Retry (automatic)"]
    SIG["Invalid signature"] --> DLQ1["DLQ (no retry)"]
    CON["Invalid contract"] --> DLQ2["DLQ (no retry)"]

    FAIL --> NET
    FAIL --> OZ
    FAIL --> SIG
    FAIL --> CON

    DLQ["DLQ Messages"]
    DLQ --> AUD["Stored for audit"]
    DLQ --> INV["Require manual investigation"]
    DLQ --> REP["Can be replayed after fixing"]
```

### 5. Circuit Breaker (Optional)

**Pattern**: Prevent Cascading Failures

```mermaid
flowchart TD
    A["OZ Relayer health checks fail repeatedly"]
    B["Stop sending messages<br/>(circuit open)"]
    C["Log alerts to monitoring"]
    D["Wait for recovery"]
    E["Resume when health returns"]

    A --> B --> C --> D --> E
```

---

## Deployment Topology

### Local Development (Docker)

```mermaid
flowchart TD
    subgraph Docker["Docker Compose (docker-compose.yaml)"]
        subgraph AppServices["Application Services"]
            RA["relay-api<br/>:3000"]
            QC["queue-consumer"]
            LS["localstack<br/>(SQS, DynamoDB)<br/>:4566, :8080"]
        end
        subgraph Infrastructure["Infrastructure"]
            MY["MySQL<br/>:3307"]
            RD["Redis<br/>:6379"]
            HH["Hardhat<br/>:8545 (Blockchain)"]
        end
        RA --> MY
        RA --> RD
        RA --> LS
        QC --> MY
        QC --> LS
        QC --> HH
    end
```

### Production (AWS ECS/EKS)

```mermaid
flowchart TD
    subgraph AWS["AWS ECS/EKS Cluster"]
        API_SVC["ECS Service (relay-api)<br/>Desired Count: 2+<br/>Load Balancer (ALB)<br/>Auto-scaling: CPU/Memory based"]
        SQS["AWS SQS Queue<br/>relay-transactions (Standard Queue)<br/>relay-transactions-dlq (Dead Letter Queue)<br/>Visibility Timeout: 60s"]
        CON_SVC["ECS Service (queue-consumer)<br/>Desired Count: 2+<br/>Auto-scaling: Queue depth based<br/>Graceful shutdown: 120s timeout"]
        OZ["OZ Relayer (Private Subnet)<br/>3x instances for HA and load distribution"]
        DB["AWS RDS (MySQL) + ElastiCache (Redis)<br/>Multi-AZ for high availability<br/>Automated backup and encryption"]

        API_SVC --> SQS --> CON_SVC --> OZ --> DB
    end
```

### Scaling Considerations

**relay-api (Producer)**:
- Scales based on request rate
- Lightweight operation (save to DB + SQS publish)
- Auto-scaling: 2-10 instances based on CPU/request count

**queue-consumer (Consumer)**:
- Scales based on queue depth
- Can process ~10-100 messages/sec per instance
- Auto-scaling: 1-20 instances based on SQS queue depth
- CloudWatch metric: ApproximateNumberOfMessagesVisible

**SQS Queue**:
- Unlimited throughput (AWS manages)
- Message retention: 4 days
- Cost: Pay per million requests

**OZ Relayer**:
- Fixed pool (3 instances for HA)
- Load balancing via Nginx
- Health checks every 30 seconds

---

## Monitoring & Observability

### Key Metrics

| Metric | Source | Alert Threshold |
|--------|--------|---|
| SQS Queue Depth | CloudWatch | > 1000 messages |
| Consumer Lag | CloudWatch | > 5 minutes |
| Message Processing Time | App Logs | > 10 seconds |
| DLQ Message Count | CloudWatch | > 10 messages |
| OZ Relayer Error Rate | App Logs | > 5% |
| Transaction Status - Pending | MySQL | > 1 hour |

### Logging Strategy

```
Consumer Log Format:
{
  "timestamp": "ISO8601",
  "level": "info|warn|error",
  "transactionId": "UUID",
  "messageId": "UUID",
  "action": "message_received|processing|success|failure",
  "duration_ms": 1234,
  "error": "error description (if any)",
  "oz_relayer_response": {...}
}
```

---

## Summary

SPEC-QUEUE-001 implements a robust, scalable async queue-based architecture that:

1. ✅ Decouples producer and consumer
2. ✅ Provides at-least-once message delivery
3. ✅ Ensures idempotent message processing
4. ✅ Enables independent scaling
5. ✅ Improves response time (202 vs 200 with hash)
6. ✅ Handles failures gracefully (DLQ)
7. ✅ Maintains audit trail (MySQL history)
8. ✅ Optimizes for local development (LocalStack)

See [SPEC-QUEUE-001](./../.moai/specs/SPEC-QUEUE-001/spec.md) for complete technical specifications.

# Acceptance Criteria: SPEC-ROUTING-001

**TAG**: SPEC-ROUTING-001 (Multi Relayer Smart Routing + Fire-and-Forget Pattern)

---

## Overview

This document defines detailed acceptance criteria using Given-When-Then format for validating the implementation of smart routing, fire-and-forget pattern, and webhook bug fix.

**Related Files**:
- `spec.md` - EARS Requirements
- `plan.md` - Implementation Plan

---

## Scenario 1: Smart Routing Selects Least Busy Relayer

**Requirement**: FR-001 (Smart Routing - Relayer Selection)

### AC-1.1: Select Relayer with Lowest Pending TX Count

```gherkin
Given 3 OZ Relayers are available:
  | Relayer    | URL                    | Pending TXs |
  | relayer-1  | http://oz-relayer-1    | 10          |
  | relayer-2  | http://oz-relayer-2    | 5           |
  | relayer-3  | http://oz-relayer-3    | 20          |
And all relayers respond to health check within 500ms
When RelayerRouterService.getAvailableRelayer() is called
Then the service returns "http://oz-relayer-2"
And logs "Selected relayer-2 with 5 pending TXs"
```

### AC-1.2: Skip Unhealthy Relayer

```gherkin
Given 3 OZ Relayers with health status:
  | Relayer    | Healthy | Pending TXs |
  | relayer-1  | true    | 10          |
  | relayer-2  | false   | 5           |
  | relayer-3  | true    | 8           |
When RelayerRouterService.getAvailableRelayer() is called
Then relayer-2 is NOT considered for selection
And the service returns "http://oz-relayer-3" (lowest among healthy)
```

### AC-1.3: Round-Robin Fallback When All Health Checks Fail

```gherkin
Given 3 OZ Relayers all failing health check:
  | Relayer    | Health Check Response |
  | relayer-1  | Timeout (>500ms)      |
  | relayer-2  | HTTP 500              |
  | relayer-3  | Connection refused    |
When RelayerRouterService.getAvailableRelayer() is called
Then the service logs "No healthy relayers found, falling back to round-robin"
And returns relayers in order: relayer-1, relayer-2, relayer-3, relayer-1...
```

### AC-1.4: Health Check Caching (10 Second TTL)

```gherkin
Given relayer-1 health check was cached 5 seconds ago as "healthy"
When RelayerRouterService.getAvailableRelayer() is called
Then NO new HTTP request is made to relayer-1 /health endpoint
And cached health status "healthy" is used

Given relayer-1 health check was cached 15 seconds ago
When RelayerRouterService.getAvailableRelayer() is called
Then a new HTTP request is made to relayer-1 /health endpoint
And cache is updated with new result
```

### AC-1.5: Performance - Selection Under 100ms

```gherkin
Given 3 OZ Relayers responding within 50ms each
When RelayerRouterService.getAvailableRelayer() is called 100 times
Then 95th percentile response time is under 100ms
And average response time is under 50ms
```

---

## Scenario 2: Fire-and-Forget Pattern Prevents Blocking

**Requirement**: FR-002 (Fire-and-Forget Pattern)

### AC-2.1: Immediate Message Deletion After TX Submission

```gherkin
Given a transaction message in SQS queue:
  | transactionId | type   |
  | tx-uuid-123   | direct |
And transaction status in MySQL is "pending"
When ConsumerService.handleMessage() processes the message
Then OzRelayerClient.sendDirectTransactionAsync() is called
And OZ Relayer returns { transactionId: "oz-456" }
And MySQL transaction is updated:
  | status    | ozRelayerTxId |
  | submitted | oz-456        |
And SQS message is deleted within 1 second
And pollForConfirmation() is NOT called
```

### AC-2.2: No Blocking During TX Submission

```gherkin
Given Consumer receives 10 messages from SQS simultaneously
When all 10 messages are processed with fire-and-forget pattern
Then total processing time is under 5 seconds (parallel)
And NOT 60+ seconds (if sequential with polling)
```

### AC-2.3: Status Remains "submitted" After Fire-and-Forget

```gherkin
Given ConsumerService submits TX to OZ Relayer
When OZ Relayer returns { transactionId: "oz-789", status: "pending" }
Then MySQL transaction status is "submitted"
And NOT "confirmed" (confirmation comes via webhook only)
```

### AC-2.4: SQS Message Retention Time Reduced by 95%

```gherkin
Given SQS message is received at T=0
When fire-and-forget pattern completes TX submission
Then SQS message is deleted at T < 3 seconds
And NOT T = 60 seconds (previous polling pattern)
```

---

## Scenario 3: Webhook Updates TX Correctly via ozRelayerTxId

**Requirement**: FR-003 (Webhook Bug Fix)

### AC-3.1: Correct Field Lookup (ozRelayerTxId)

```gherkin
Given transaction exists in MySQL:
  | id        | ozRelayerTxId | status    |
  | our-uuid  | oz-123        | submitted |
When webhook receives POST /api/v1/webhooks/oz-relayer:
  {
    "transactionId": "oz-123",
    "status": "confirmed",
    "hash": "0xabc..."
  }
Then WebhooksService queries: WHERE ozRelayerTxId = "oz-123"
And NOT: WHERE id = "oz-123"
And transaction is updated:
  | status    | hash      |
  | confirmed | 0xabc...  |
And webhook returns HTTP 200
```

### AC-3.2: 404 When Transaction Not Found

```gherkin
Given no transaction exists with ozRelayerTxId = "oz-nonexistent"
When webhook receives POST /api/v1/webhooks/oz-relayer:
  {
    "transactionId": "oz-nonexistent",
    "status": "confirmed",
    "hash": "0xdef..."
  }
Then WebhooksService throws NotFoundException
And webhook returns HTTP 404
And NO new transaction record is created
```

### AC-3.3: No Upsert - Update Only

```gherkin
Given transaction with ozRelayerTxId = "oz-123" does NOT exist
When webhook receives payload with transactionId = "oz-123"
Then the system does NOT create a new transaction record
And returns HTTP 404 (Not Found)
```

### AC-3.4: Webhook Processing Under 200ms

```gherkin
Given 100 concurrent webhook requests
When all webhooks are processed
Then 95th percentile response time is under 200ms
And MySQL update completes within 150ms
```

---

## Scenario 4: Multiple Relayers Share Redis Without Nonce Collision

**Requirement**: DC-001 (Relayer Private Key Isolation)

### AC-4.1: Independent Nonce Tracking Per Signer

```gherkin
Given 3 OZ Relayers with different signer addresses:
  | Relayer    | Signer Address |
  | relayer-1  | 0xaaa...       |
  | relayer-2  | 0xbbb...       |
  | relayer-3  | 0xccc...       |
And all relayers share Redis at redis://redis:6379
When each relayer submits 10 transactions
Then Redis keys are isolated:
  | Key                      | Value |
  | relayer:nonce:0xaaa      | 10    |
  | relayer:nonce:0xbbb      | 10    |
  | relayer:nonce:0xccc      | 10    |
And NO nonce collisions occur
```

### AC-4.2: Concurrent TX Submission Without Race Condition

```gherkin
Given 3 OZ Relayers processing transactions simultaneously
When 30 transactions are submitted (10 per relayer)
Then all 30 transactions succeed
And NO "nonce too low" errors occur
And Redis nonce increments are atomic
```

---

## Scenario 5: Idempotent TX Processing (SQS At-Least-Once)

**Requirement**: FR-004 (Idempotent TX Processing)

### AC-5.1: Skip Re-submission When ozRelayerTxId Exists

```gherkin
Given transaction in MySQL:
  | id        | ozRelayerTxId | status    |
  | tx-uuid-1 | oz-123        | submitted |
When Consumer receives duplicate SQS message for tx-uuid-1
Then Consumer checks transaction.ozRelayerTxId
And finds "oz-123" already exists
And Consumer detects ozRelayerTxId already exists (do NOT re-submit)
And Consumer deletes SQS message immediately (no polling)
And Webhook handles status update asynchronously (Fire-and-Forget pattern)
```

### AC-5.2: Handle Already Confirmed Transaction

```gherkin
Given transaction in MySQL:
  | id        | ozRelayerTxId | status    |
  | tx-uuid-1 | oz-123        | confirmed |
When Consumer receives duplicate SQS message for tx-uuid-1
Then Consumer detects terminal status "confirmed"
And Consumer deletes SQS message immediately
And NO API calls are made to OZ Relayer
```

---

## Scenario 6: Multi-Environment Configuration

**Requirement**: FR-005 (Multi-Environment Configuration)

### AC-6.1: Parse Comma-Separated OZ_RELAYER_URLS

```gherkin
Given environment variable:
  OZ_RELAYER_URLS=http://oz-relayer-1:8080,http://oz-relayer-2:8080,http://oz-relayer-3:8080
When RelayerRouterService is initialized
Then 3 relayers are registered:
  | URL                        | Relayer ID |
  | http://oz-relayer-1:8080   | relayer-1  |
  | http://oz-relayer-2:8080   | relayer-2  |
  | http://oz-relayer-3:8080   | relayer-3  |
```

### AC-6.2: Localhost Environment Configuration

```gherkin
Given Docker Compose environment:
  OZ_RELAYER_URLS=http://oz-relayer-1:8080,http://oz-relayer-2:8080,http://oz-relayer-3:8080
  REDIS_URL=redis://redis:6379
  RPC_URL=http://hardhat-node:8545
  CHAIN_ID=31337
When all services start with docker compose up
Then relay-api connects to all 3 relayers
And queue-consumer uses smart routing across all relayers
And all relayers share single Redis instance
```

### AC-6.3: Amoy Testnet Environment Configuration

```gherkin
Given Amoy testnet environment:
  OZ_RELAYER_URLS=https://relayer-1.amoy.example.com,https://relayer-2.amoy.example.com,https://relayer-3.amoy.example.com
  REDIS_URL=redis://redis.amoy.example.com:6379
  RPC_URL=https://rpc-amoy.polygon.technology
  CHAIN_ID=80002
When RelayerRouterService initializes
Then all 3 external relayer URLs are registered
And HTTPS connections are used
```

---

## Definition of Done

### Code Quality Gates

- [ ] **Test Coverage**: Unit tests >= 90% for all new/modified files
- [ ] **Linting**: ESLint passes with no errors
- [ ] **Type Safety**: TypeScript compilation passes with strict mode
- [ ] **Documentation**: JSDoc comments on all public methods

### Functionality Gates

- [ ] **Smart Routing**: Selects least busy relayer (AC-1.1)
- [ ] **Fire-and-Forget**: No polling, immediate SQS deletion (AC-2.1)
- [ ] **Webhook Fix**: Uses ozRelayerTxId for lookup (AC-3.1)
- [ ] **Idempotency**: Handles duplicate SQS messages (AC-5.1)
- [ ] **Multi-Environment**: Supports comma-separated URLs (AC-6.1)

### Performance Gates

- [ ] **Relayer Selection**: < 100ms (AC-1.5)
- [ ] **SQS Message Deletion**: < 1 second after TX submission (AC-2.1)
- [ ] **Webhook Processing**: < 200ms (AC-3.4)
- [ ] **Load Test**: 100 TXs/second with 3 relayers

### Infrastructure Gates

- [ ] **Docker Compose**: 3 relayers start healthy
- [ ] **Redis Sharing**: No nonce collisions (AC-4.1)
- [ ] **Webhook URLs**: Configured in all relayer-{1,2,3}.json files

---

## Test Matrix

| Scenario | AC | Unit Test | Integration Test | E2E Test |
|----------|-----|-----------|-----------------|----------|
| Smart Routing | AC-1.1 | relayer-router.service.spec.ts | - | e2e/smart-routing.spec.ts |
| Health Caching | AC-1.4 | relayer-router.service.spec.ts | - | - |
| Round-Robin | AC-1.3 | relayer-router.service.spec.ts | - | - |
| Fire-and-Forget | AC-2.1 | consumer.service.spec.ts | - | e2e/fire-and-forget.spec.ts |
| No Blocking | AC-2.2 | - | - | e2e/performance.spec.ts |
| Webhook Fix | AC-3.1 | webhooks.service.spec.ts | - | e2e/webhook.spec.ts |
| 404 Not Found | AC-3.2 | webhooks.service.spec.ts | - | - |
| Nonce Isolation | AC-4.1 | - | - | e2e/nonce-isolation.spec.ts |
| Idempotency | AC-5.1 | consumer.service.spec.ts | - | e2e/idempotency.spec.ts |
| Multi-Env Config | AC-6.1 | relayer-router.service.spec.ts | - | - |

---

## Verification Commands

### Unit Tests
```bash
# Run all unit tests with coverage
pnpm --filter @msq-relayer/queue-consumer test:cov
pnpm --filter @msq-relayer/relay-api test:cov

# Run specific test files
pnpm --filter @msq-relayer/queue-consumer test relayer-router.service.spec.ts
pnpm --filter @msq-relayer/relay-api test webhooks.service.spec.ts
```

### Integration Tests
```bash
# Start all services
docker compose up -d

# Verify 3 relayers are healthy
docker compose ps | grep oz-relayer

# Check relayer health endpoints
curl http://localhost:8081/health
curl http://localhost:8082/health
curl http://localhost:8083/health
```

### E2E Tests
```bash
# Run E2E test suite
pnpm test:e2e

# Test smart routing manually
curl -X POST http://localhost:8080/api/v1/direct \
  -H "Content-Type: application/json" \
  -d '{"to": "0x...", "data": "0x...", "gasLimit": "100000"}'
```

---

**Version**: 1.1.0
**Last Updated**: 2026-01-08

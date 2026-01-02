# Testing Guide

**Version**: 1.2.0
**Last Updated**: 2026-01-02
**Status**: Complete with Integration, Load Tests, and Phase 2 (3-Tier Lookup, Webhooks)

---

## Overview

This document covers the testing infrastructure for MSQ Relayer Service, including unit tests, E2E tests, integration tests, and load tests.

| Test Type | Purpose | Scope | Command |
|-----------|---------|-------|---------|
| **Unit Tests** | Function and component verification | Individual services, utilities | `pnpm test` |
| **E2E Tests** | Integration and API endpoint verification | HTTP endpoints, complete flows (Mock) | `pnpm test:e2e` |
| **Integration Tests** | Real blockchain verification | Actual RPC calls, network agnostic | `pnpm test:integration` |
| **Load Tests** | Performance and stress testing | API throughput, response times | `pnpm test:load` |

---

## Unit Tests

### Running Unit Tests

```bash
# Run all unit tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run tests for specific file
pnpm test -- direct.service

# Run tests with coverage report
pnpm test --coverage
```

### Unit Test Coverage

**Target**: 90% coverage
**Current**: 187 unit tests passing

```bash
# View coverage report
pnpm test --coverage

# Expected output: 90%+ coverage across:
# - src/relay/direct/
# - src/relay/gasless/
# - src/relay/status/
# - src/redis/
# - src/prisma/
# - src/webhooks/
# - src/auth/
```

### Unit Test Files

All unit tests use the pattern `*.spec.ts`:

```
packages/relay-api/src/
├── relay/
│   ├── direct/
│   │   └── direct.service.spec.ts
│   ├── gasless/
│   │   └── gasless.service.spec.ts
│   └── status/
│       └── status.service.spec.ts        # 3-Tier Lookup tests
├── redis/
│   └── redis.service.spec.ts             # L1 Cache tests
├── prisma/
│   └── prisma.service.spec.ts            # L2 Storage tests
├── webhooks/
│   ├── guards/
│   │   └── webhook-signature.guard.spec.ts  # HMAC verification
│   ├── webhooks.controller.spec.ts
│   └── webhooks.service.spec.ts
├── auth/
│   └── api-key.guard.spec.ts
└── app.service.spec.ts
```

---

## E2E Tests (SPEC-E2E-001)

### Quick Start

E2E tests verify complete API flows end-to-end using Mock OZ Relayer responses (no actual blockchain calls).

```bash
# Run all E2E tests
pnpm test:e2e

# Expected output: 74/74 tests passing (Phase 2 update)
# PASS packages/relay-api/test/e2e/direct.e2e-spec.ts (8 tests)
# PASS packages/relay-api/test/e2e/gasless.e2e-spec.ts (10 tests)
# PASS packages/relay-api/test/e2e/status.e2e-spec.ts (12 tests)      # 3-Tier Lookup
# PASS packages/relay-api/test/e2e/webhooks.e2e-spec.ts (15 tests)    # Webhook Handler
# PASS packages/relay-api/test/e2e/health.e2e-spec.ts (3 tests)
# PASS packages/relay-api/test/e2e/payment-integration.e2e-spec.ts (2 tests)
# Test Suites: 6+ passed
# Tests: 74 passed, 74 total
```

### E2E Test Files

```
packages/relay-api/test/
├── e2e/                                    # E2E test suite
│   ├── direct.e2e-spec.ts                 # Direct TX tests (8 tests)
│   ├── gasless.e2e-spec.ts                # Gasless TX tests (10 tests)
│   ├── status.e2e-spec.ts                 # Status Polling tests (12 tests) - 3-Tier Lookup
│   ├── webhooks.e2e-spec.ts               # Webhook Handler tests (15 tests) - Phase 2
│   ├── health.e2e-spec.ts                 # Health Check tests (3 tests)
│   └── payment-integration.e2e-spec.ts    # Payment Flow tests (2 tests)
├── fixtures/                               # Test data
│   ├── test-wallets.ts                    # Hardhat accounts #0~#2
│   ├── test-config.ts                     # Test environment settings
│   └── mock-responses.ts                  # OZ Relayer Mock responses
├── utils/                                  # Test utilities
│   ├── eip712-signer.ts                   # EIP-712 signature utility
│   ├── encoding.ts                        # ERC-20 encoding
│   └── test-app.factory.ts                # NestJS app factory
└── jest-e2e.json                          # Jest E2E configuration
```

### E2E Test Suite Overview

#### Direct Transaction Tests (8 tests)

**File**: `test/e2e/direct.e2e-spec.ts`

Tests the `/api/v1/relay/direct` endpoint with various inputs and error conditions.

**Test Cases**:
1. **TC-E2E-D001**: Valid Direct TX → 202 Accepted
2. **TC-E2E-D002**: Minimal fields only → 202 Accepted
3. **TC-E2E-D003**: Invalid Ethereum address → 400 Bad Request
4. **TC-E2E-D004**: Invalid hexadecimal data → 400 Bad Request
5. **TC-E2E-D005**: Invalid speed enum → 400 Bad Request
6. **TC-E2E-D006**: Missing API key → 401 Unauthorized
7. **TC-E2E-D007**: Invalid API key → 401 Unauthorized
8. **TC-E2E-D008**: OZ Relayer unavailable → 503 Service Unavailable

**Pattern**: Given-When-Then comments in code

```typescript
// Given: NestJS app with mocked OZ Relayer
// When: POST /api/v1/relay/direct with valid request
// Then: HTTP 202 Accepted with txId
it('should return 202 with valid direct transaction request', async () => {
  // Test implementation
});
```

#### Gasless Transaction Tests (10 tests)

**File**: `test/e2e/gasless.e2e-spec.ts`

Tests the `/api/v1/relay/gasless` endpoint with EIP-712 signature verification.

**Test Cases**:
1. **TC-E2E-G001**: Valid signed Gasless TX → 202 Accepted
2. **TC-E2E-G002**: Custom gas and value included → 202 Accepted
3. **TC-E2E-G003**: Nonce query → 200 OK + current nonce
4. **TC-E2E-G004**: Nonce query with invalid address → 400 Bad Request
5. **TC-E2E-G005**: Invalid signature format → 401 Unauthorized
6. **TC-E2E-G006**: Signature from wrong signer → 401 Unauthorized
7. **TC-E2E-G007**: Expired deadline → 400 Bad Request
8. **TC-E2E-G008**: Nonce mismatch → 400 Bad Request
9. **TC-E2E-G009**: Malformed signature → 400 Bad Request
10. **TC-E2E-G010**: Missing required fields → 400 Bad Request

**Signature Verification Flow**:

```
Step 1: Query Nonce
  GET /api/v1/relay/gasless/nonce/{address}
  → Returns: { nonce: 0 }

Step 2: Create ForwardRequest
  {
    from: userAddress,
    to: merchantAddress,
    value: "0",
    gas: "100000",
    nonce: 0,
    deadline: now + 3600,
    data: "0x"
  }

Step 3: Sign with EIP-712
  signature = await signForwardRequest(wallet, forwardRequest)
  → Returns 132-char hex string (0x + 130 hex chars)

Step 4: Submit Gasless TX
  POST /api/v1/relay/gasless
  { request: {...}, signature: "0x..." }
  → Returns: { txId: "uuid-v4" }
```

#### Status Polling Tests - 3-Tier Lookup (12 tests)

**File**: `test/e2e/status.e2e-spec.ts`

Tests the `/api/v1/relay/status/:txId` endpoint with 3-Tier Lookup (Phase 2).

**Test Cases (Basic)**:
1. **TC-E2E-S001**: Query pending status → 200 + status: pending
2. **TC-E2E-S002**: Query confirmed status → 200 + hash + confirmedAt
3. **TC-E2E-S003**: Query failed status → 200 + status: failed
4. **TC-E2E-S004**: Invalid UUID format → 400 Bad Request
5. **TC-E2E-S005**: OZ Relayer unavailable → 503 Service Unavailable
6. **TC-E2E-S006**: Non-existent txId → 404 Not Found

**Test Cases (3-Tier Lookup - Phase 2)**:
7. **TC-E2E-S007**: Redis L1 hit (terminal status) → Fast response (~1-5ms)
8. **TC-E2E-S008**: MySQL L2 hit with Redis backfill → ~50ms response
9. **TC-E2E-S009**: OZ Relayer L3 fallback → ~200ms response
10. **TC-E2E-S010**: Non-terminal status always fetches fresh from L3
11. **TC-E2E-S011**: Redis failure gracefully degrades to L2/L3
12. **TC-E2E-S012**: Write-through caching verification

**3-Tier Lookup Test Flow**:
```
Tier 1: Redis (L1 Cache)
  └─ Check if terminal status (confirmed/mined/failed/cancelled)
  └─ Return immediately if terminal

Tier 2: MySQL (L2 Storage)
  └─ Query if Redis miss
  └─ Backfill Redis if found

Tier 3: OZ Relayer API
  └─ Fallback for non-cached transactions
  └─ Store in both Redis + MySQL (write-through)
```

#### Webhook Handler Tests (15 tests)

**File**: `test/e2e/webhooks.e2e-spec.ts`

Tests the `/api/v1/webhooks/oz-relayer` endpoint (Phase 2).

**Test Cases (Signature Verification)**:
1. **TC-E2E-W001**: Valid HMAC-SHA256 signature → 200 OK
2. **TC-E2E-W002**: Missing X-OZ-Signature header → 401 Unauthorized
3. **TC-E2E-W003**: Invalid signature format → 401 Unauthorized
4. **TC-E2E-W004**: Wrong signing key → 401 Unauthorized
5. **TC-E2E-W005**: Tampered payload → 401 Unauthorized

**Test Cases (Payload Processing)**:
6. **TC-E2E-W006**: Valid webhook payload → Database + Cache updated
7. **TC-E2E-W007**: Missing transactionId → 400 Bad Request
8. **TC-E2E-W008**: Invalid status value → 400 Bad Request
9. **TC-E2E-W009**: Malformed JSON → 400 Bad Request
10. **TC-E2E-W010**: Duplicate webhook (idempotent) → 200 OK

**Test Cases (Storage Updates)**:
11. **TC-E2E-W011**: MySQL L2 updated on webhook
12. **TC-E2E-W012**: Redis L1 updated with TTL reset
13. **TC-E2E-W013**: Client notification triggered (non-blocking)
14. **TC-E2E-W014**: Database failure → 500 Internal Server Error
15. **TC-E2E-W015**: Redis failure → Graceful degradation (MySQL only)

**Webhook Test Pattern**:
```typescript
// Generate valid HMAC-SHA256 signature
const payload = { transactionId: 'uuid', status: 'confirmed', ... };
const signature = crypto
  .createHmac('sha256', WEBHOOK_SIGNING_KEY)
  .update(JSON.stringify(payload))
  .digest('hex');

// Send with signature header
POST /api/v1/webhooks/oz-relayer
  -H "X-OZ-Signature: sha256={signature}"
  -d '{payload}'
```

#### Health Check Tests (3 tests)

**File**: `test/e2e/health.e2e-spec.ts`

Tests the `/api/v1/health` endpoint (public, no API key required).

**Test Cases**:
1. **TC-E2E-H001**: All services healthy → 200 + status: ok
2. **TC-E2E-H002**: Public endpoint (API key not required) → 200 OK
3. **TC-E2E-H003**: OZ Relayer pool unhealthy → 503 Service Unavailable

#### Payment Integration Tests (2 tests)

**File**: `test/e2e/payment-integration.e2e-spec.ts`

Tests complete payment flows combining multiple API endpoints.

**Test Cases**:
1. **TC-E2E-P001**: Batch token transfer (Direct TX) → Multiple 202 responses
   - Given: 3 ERC-20 token transfer requests
   - When: All requests sent in parallel
   - Then: All requests return 202 with unique txId

2. **TC-E2E-P002**: Complete Gasless payment flow → 4 steps completed
   - Step 1: Query nonce → 200 OK
   - Step 2: Generate EIP-712 signature → success
   - Step 3: Submit Gasless TX → 202 Accepted
   - Step 4: Query status → 200 OK with transaction details

### Test Fixtures and Utilities

#### Test Wallets (`test/fixtures/test-wallets.ts`)

Uses Hardhat default test accounts:

```typescript
export const TEST_WALLETS = {
  relayer: {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  },
  user: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  },
  merchant: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
  }
};
```

#### Test Configuration (`test/fixtures/test-config.ts`)

```typescript
export const TEST_CONFIG = {
  API_KEY: 'test-api-key',
  OZ_RELAYER_URL: 'http://localhost:8080',
  FORWARDER_ADDRESS: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  CHAIN_ID: 31337,
  EIP712_VERSION: '1'
};
```

#### Mock OZ Relayer (`test/fixtures/mock-responses.ts`)

Mock responses for OZ Relayer API calls:

```typescript
export const MOCK_OZ_RESPONSES = {
  directTransaction: {
    transactionId: '550e8400-e29b-41d4-a716-446655440000',
    hash: null,
    status: 'pending',
    createdAt: new Date().toISOString()
  },
  confirmedTransaction: {
    transactionId: '550e8400-e29b-41d4-a716-446655440001',
    hash: '0xabcdef123456...',
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    from: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
  }
};
```

#### EIP-712 Signer (`test/utils/eip712-signer.ts`)

Utility for generating and verifying EIP-712 signatures:

```typescript
export async function signForwardRequest(wallet, request) {
  // Generate EIP-712 signature for ForwardRequest
  // Returns: 132-char hex string (0x + 130 hex chars)
}

export function createForwardRequest(from, to, options = {}) {
  // Build ForwardRequest object with nonce, deadline, etc.
}

export function createExpiredForwardRequest(from, to) {
  // Build ForwardRequest with expired deadline (for testing)
}
```

### Running E2E Tests with Options

```bash
# Run E2E tests with coverage
pnpm test:e2e:cov

# Run specific E2E test file
pnpm test:e2e -- direct.e2e-spec

# Run E2E tests in watch mode
pnpm test:e2e --watch

# Run E2E tests with verbose output
pnpm test:e2e --verbose
```

### E2E Test Execution Flow

```
1. Initialize NestJS Test Module
   └─ Load all modules (relayModule, authModule)
   └─ Mock OZ Relayer HTTP calls with Jest Spy

2. Execute Test Suite (5 files, 29 tests)
   ├─ Direct TX tests (8)
   ├─ Gasless TX tests (10)
   ├─ Status Polling tests (6)
   ├─ Health Check tests (3)
   └─ Payment Integration tests (2)

3. Verify Results
   └─ All 29 tests pass
   └─ No unit test regression
   └─ No external API calls made (Mock only)
   └─ Execution time < 30 seconds

4. Generate Report (optional)
   └─ Test results summary
   └─ Coverage metrics
```

---

## Integration Tests (Network Agnostic)

Integration tests verify API behavior against real blockchain networks. The tests are **network agnostic** - the same code works on Hardhat, Polygon Amoy, or Mainnet.

### Network Agnostic Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    RPC_URL Environment Variable              │
├─────────────────────────────────────────────────────────────┤
│ Hardhat:  http://localhost:8545           (fast, free)      │
│ Amoy:     https://rpc-amoy.polygon.technology (testnet)     │
│ Mainnet:  https://polygon-mainnet.infura.io/v3/... (prod)   │
└─────────────────────────────────────────────────────────────┘
                              ↓
              Same test code runs on all networks
```

### Running Integration Tests

```bash
# Option 1: Local Hardhat Node (Recommended for development)
npx hardhat node &                                    # Start local node
RPC_URL=http://localhost:8545 pnpm test:integration   # Run tests

# Option 2: Polygon Amoy Testnet
RPC_URL=https://rpc-amoy.polygon.technology pnpm test:integration

# Option 3: With all environment variables
RPC_URL=http://localhost:8545 \
CHAIN_ID=31337 \
FORWARDER_ADDRESS=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 \
pnpm test:integration
```

### Integration Test Files

```
packages/relay-api/test/integration/
├── blockchain.integration-spec.ts   # Main integration tests (8 tests)
├── utils/
│   ├── network-helpers.ts           # RPC connection utilities
│   └── token-helpers.ts             # Token encoding utilities
└── jest-integration.json            # Jest config (60s timeout)
```

### Integration Test Cases

| Test ID | Description | Verifies |
|---------|-------------|----------|
| TC-INT-001 | Connect to RPC endpoint | Network connectivity |
| TC-INT-002 | Verify chain ID | Network configuration |
| TC-INT-003 | Query real balance | Blockchain data access |
| TC-INT-004 | Direct TX API acceptance | API layer integration |
| TC-INT-005 | Query Forwarder nonce | Contract interaction |
| TC-INT-006 | EIP-712 signature generation | Crypto utilities |
| TC-INT-007 | Gasless nonce endpoint | End-to-end nonce flow |
| TC-INT-008 | Health endpoint | Service availability |

### Benefits of Network Agnostic Design

- **No Code Duplication**: Single test file for all networks
- **Easy Environment Switching**: Just change `RPC_URL`
- **CI/CD Friendly**: Use Hardhat node in CI, testnet for staging
- **Production Validation**: Same tests can verify mainnet (read-only)

---

## Transaction Lifecycle Tests (SPEC-TEST-001)

Real transaction lifecycle verification on live blockchain (not mocked). Tests the complete flow: Submit → OZ Relayer → Blockchain → Mining → Confirmation.

### Overview

| Feature | Description |
|---------|-------------|
| Purpose | End-to-end transaction verification |
| Scope | Submit → OZ Relayer → Blockchain → Mining → Confirmation |
| Network | Hardhat local node (Docker Compose) |
| TC Prefix | TC-TXL-xxx |
| Package | `@msq-relayer/integration-tests` |

### Test Cases

| ID | Category | Description |
|----|----------|-------------|
| TC-TXL-001 | Contract | ERC2771Forwarder deployment verification |
| TC-TXL-002 | Contract | SampleToken trustedForwarder validation |
| TC-TXL-003 | Contract | SampleNFT trustedForwarder validation |
| TC-TXL-004 | Contract | EIP-712 domain configuration |
| TC-TXL-100 | Direct TX | Submit → Poll → Confirm flow |
| TC-TXL-101 | Direct TX | ERC20 transfer via direct TX |
| TC-TXL-200 | Gasless TX | Nonce query from API |
| TC-TXL-201 | Gasless TX | EIP-712 signature generation |
| TC-TXL-202 | Gasless TX | Full gasless TX flow (nonce → sign → submit → confirm) |

### Running Lifecycle Tests

```bash
# Prerequisites: Docker Compose stack running
docker compose -f docker/docker-compose.yaml up -d

# Run lifecycle tests only
pnpm --filter @msq-relayer/integration-tests test:lifecycle

# Run all integration tests
pnpm --filter @msq-relayer/integration-tests test
```

### Test Files

```
packages/integration-tests/
├── src/helpers/
│   ├── polling.ts       # Exponential backoff polling
│   └── contracts.ts     # Contract verification utilities
└── tests/
    └── transaction-lifecycle.integration-spec.ts  # 9 test cases
```

### Helper Utilities

| File | Purpose |
|------|---------|
| `polling.ts` | Exponential backoff polling with HARDHAT_POLLING_CONFIG (10 attempts, 200ms initial, 1.2x multiplier) |
| `contracts.ts` | Contract verification, ABI definitions (Forwarder, Token, NFT), encoding utilities |

### Environment Variables

```env
FORWARDER_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
SAMPLE_TOKEN_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
SAMPLE_NFT_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

### Difference from Other Tests

| Test Type | Blockchain | OZ Relayer | Purpose |
|-----------|------------|------------|---------|
| Unit Tests | Mock | Mock | Function logic |
| E2E Tests | Mock | Mock | API layer validation |
| Integration Tests (TC-INT) | Real (read-only) | Mock | Network connectivity |
| **Lifecycle Tests (TC-TXL)** | **Real (write)** | **Real** | **Transaction execution** |

---

## Load Tests (Artillery)

Load tests verify API performance under various traffic patterns using Artillery.

### Running Load Tests

```bash
# Prerequisites
pnpm add -D artillery   # Already added in devDependencies

# Run load tests against local server
pnpm dev &              # Start the API server
pnpm test:load          # Run Artillery

# Run against custom endpoint
API_URL=https://api.example.com API_KEY=your-key pnpm test:load
```

### Load Test Configuration

**File**: `test/load/artillery.yml`

```yaml
config:
  target: "{{ $processEnvironment.API_URL || 'http://localhost:3000' }}"
  phases:
    - duration: 10, arrivalRate: 2    # Warm up
    - duration: 30, arrivalRate: 5-15 # Ramp up
    - duration: 60, arrivalRate: 15   # Sustained load
    - duration: 10, arrivalRate: 30   # Spike test
```

### Load Test Scenarios

| Scenario | Weight | Flow |
|----------|--------|------|
| Health Check | 10% | GET /api/v1/health |
| Direct TX Submission | 40% | POST /api/v1/relay/direct → GET /status |
| Gasless Nonce Query | 30% | GET /api/v1/relay/gasless/nonce/:address |
| Status Polling | 20% | GET /api/v1/relay/status/:txId |

### Performance Thresholds

| Metric | Target |
|--------|--------|
| p95 Response Time | < 500ms |
| p99 Response Time | < 1000ms |
| Error Rate | < 5% |

---

## Error Scenarios E2E

Additional E2E tests focusing on failure conditions and error handling.

**File**: `test/e2e/error-scenarios.e2e-spec.ts`

### Error Test Categories

| Category | Test Count | Covers |
|----------|------------|--------|
| Relayer Pool Failures | 3 | 503, network errors, timeouts |
| RPC Failures | 2 | Nonce query failures, invalid responses |
| Input Validation | 3 | Malformed addresses, missing fields, invalid enums |
| Authentication | 2 | Missing/invalid API keys |
| Gasless TX Errors | 2 | Service failures, replay attacks |
| Status Endpoint | 2 | Non-existent IDs, invalid formats |

### Running Error Scenario Tests

```bash
# Run all E2E tests (includes error scenarios)
pnpm test:e2e

# Run only error scenarios
pnpm test:e2e -- error-scenarios
```

---

## Mock OZ Relayer Strategy

E2E tests **do not call actual OZ Relayer API or RPC endpoints**. Instead, they use service-level mocking:

### Architecture

```
E2E Test
  ↓
NestJS App (with mocked services)
  ↓
OzRelayerService Mock (no HTTP calls)
GaslessService Spy (no RPC calls)
HttpService Mock (for status polling)
  ↓
Returns Mock Response (configured in mock-responses.ts)
  ↓
E2E Test verifies response
```

### Mocking Strategy

**1. OzRelayerService Mock** (Direct/Gasless TX submission):

```typescript
// In test-app.factory.ts - Service-level mock
.overrideProvider(OzRelayerService)
.useValue({
  sendTransaction: jest.fn().mockResolvedValue(createMockOzRelayerResponse()),
  getTransactionStatus: jest.fn().mockResolvedValue(createMockConfirmedResponse()),
  getRelayerId: jest.fn().mockResolvedValue('test-relayer-id'),
})
```

**2. GaslessService Spy** (RPC nonce queries):

```typescript
// Spy on getNonceFromForwarder to avoid real RPC calls
const gaslessService = moduleFixture.get(GaslessService);
jest.spyOn(gaslessService, 'getNonceFromForwarder').mockResolvedValue('0');
```

**3. HttpService Mock** (Status polling):

```typescript
// Mock HttpService.get for status endpoint
const httpMock = getHttpServiceMock(app);
httpMock.get.mockReturnValueOnce(of({
  data: { id: txId, status: 'confirmed', hash: '0x...' },
  status: 200,
}));
```

**4. Test-specific error scenarios**:

```typescript
// Simulate OZ Relayer unavailability
const ozRelayerMock = getOzRelayerServiceMock(app);
ozRelayerMock.sendTransaction.mockRejectedValueOnce(
  new ServiceUnavailableException('OZ Relayer service unavailable')
);
```

### Benefits

- **Fast**: No network latency (no HTTP/RPC calls)
- **Reliable**: No dependency on external services
- **Isolated**: Tests only verify API layer logic
- **Repeatable**: Deterministic mock responses every time
- **Controllable**: Easy to simulate error scenarios (503, timeouts)

---

## Test Quality Metrics

### Test Coverage

**Unit Tests**: 90%+ coverage target

```bash
pnpm test --coverage

# Sample output:
# ────────────────────────────────────────
# File                          Statements
# ────────────────────────────────────────
# All files                           90.5%
# relay/direct/                       92.3%
# relay/gasless/                      91.8%
# relay/status/                       89.5%
# auth/                               95.0%
# ────────────────────────────────────────
```

### Test Execution Time

**E2E Tests**: < 30 seconds total

```bash
pnpm test:e2e

# Sample output:
# Test Suites: 5 passed, 5 total
# Tests:       29 passed, 29 total
# Snapshots:   0 total
# Time:        12.5s
```

### No Regression

All existing unit tests must continue to pass:

```bash
pnpm test
pnpm test:e2e

# Expected: All tests pass (0 failures)
```

---

## Troubleshooting

### Issue: E2E tests timeout (> 30 seconds)

**Cause**: Mock response not configured correctly

**Solution**:
```bash
# Check jest-e2e.json testTimeout setting
cat packages/relay-api/test/jest-e2e.json

# Increase timeout if needed
"testTimeout": 60000  # 60 seconds

# Or in test file:
jest.setTimeout(60000);
```

### Issue: "Cannot find module" errors

**Cause**: TypeScript paths not resolved

**Solution**:
```bash
# Clear Jest cache
pnpm test:e2e --clearCache

# Rebuild TypeScript
pnpm build
```

### Issue: Signature verification fails (401 Unauthorized)

**Cause**: EIP-712 signature mismatch

**Solution**:
```typescript
// Verify EIP712_DOMAIN in test/utils/eip712-signer.ts
const EIP712_DOMAIN = {
  name: 'ERC2771Forwarder',
  version: '1',
  chainId: 31337,
  verifyingContract: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9'
};

// Verify this matches ForwarderService config
```

### Issue: Mock response not being used

**Cause**: Jest spy not intercepting calls

**Solution**:
```bash
# Run tests with debug output
pnpm test:e2e -- --detectOpenHandles

# Check if httpClient is being mocked in test setup
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  unit-and-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm test              # Unit tests
      - run: pnpm test:e2e          # E2E tests (mock-based)
      - run: pnpm test --coverage   # Coverage report

  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install
      - run: npx hardhat node &     # Start local Hardhat node
      - run: sleep 5                # Wait for node to start
      - run: RPC_URL=http://localhost:8545 pnpm test:integration

  load:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'  # Only on main branch
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm dev &             # Start API server
      - run: sleep 10               # Wait for server to start
      - run: pnpm test:load         # Run load tests
```

---

## Related Documents

- **[SPEC-E2E-001](../.moai/specs/SPEC-E2E-001/spec.md)** - E2E Test Infrastructure Specification
- **[SPEC-E2E-001 Acceptance](../.moai/specs/SPEC-E2E-001/acceptance.md)** - Acceptance Criteria
- **[tech.md - Section 7: E2E Test Infrastructure](./tech.md#7-e2e-test-infrastructure-spec-e2e-001)** - Technical details
- **[README.md](../README.md)** - Quick start guide

---

**Last Updated**: 2026-01-02
**Version**: 1.2.0
**Author**: Harry
**Status**: Complete (includes Integration, Load Tests, and Phase 2: 3-Tier Lookup + Webhooks)

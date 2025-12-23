# Testing Guide

**Version**: 1.0.0
**Last Updated**: 2025-12-23
**Status**: E2E Test Infrastructure Complete

---

## Overview

This document covers the testing infrastructure for MSQ Relayer Service, including unit tests and E2E (End-to-End) tests.

| Test Type | Purpose | Scope | Command |
|-----------|---------|-------|---------|
| **Unit Tests** | Function and component verification | Individual services, utilities | `pnpm test` |
| **E2E Tests** | Integration and API endpoint verification | HTTP endpoints, complete flows | `pnpm test:e2e` |

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

```bash
# View coverage report
pnpm test --coverage

# Expected output: 90%+ coverage across:
# - src/relay/direct/
# - src/relay/gasless/
# - src/relay/status/
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
│       └── status.service.spec.ts
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

# Expected output: 29/29 tests passing
# PASS packages/relay-api/test/e2e/direct.e2e-spec.ts (5 tests)
# PASS packages/relay-api/test/e2e/gasless.e2e-spec.ts (10 tests)
# PASS packages/relay-api/test/e2e/status.e2e-spec.ts (6 tests)
# PASS packages/relay-api/test/e2e/health.e2e-spec.ts (3 tests)
# PASS packages/relay-api/test/e2e/payment-integration.e2e-spec.ts (2 tests)
# Test Suites: 5 passed, 5 total
# Tests: 29 passed, 29 total
```

### E2E Test Files

```
packages/relay-api/test/
├── e2e/                                    # E2E test suite
│   ├── direct.e2e-spec.ts                 # Direct TX tests (8 tests)
│   ├── gasless.e2e-spec.ts                # Gasless TX tests (10 tests)
│   ├── status.e2e-spec.ts                 # Status Polling tests (6 tests)
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

#### Status Polling Tests (6 tests)

**File**: `test/e2e/status.e2e-spec.ts`

Tests the `/api/v1/relay/status/:txId` endpoint.

**Test Cases**:
1. **TC-E2E-S001**: Query pending status → 200 + status: pending
2. **TC-E2E-S002**: Query confirmed status → 200 + hash + confirmedAt
3. **TC-E2E-S003**: Query failed status → 200 + status: failed
4. **TC-E2E-S004**: Invalid UUID format → 400 Bad Request
5. **TC-E2E-S005**: OZ Relayer unavailable → 503 Service Unavailable
6. **TC-E2E-S006**: Non-existent txId → 404 Not Found

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
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02d45d5f60bc123'
  },
  user: {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  },
  merchant: {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103db1fb50a4e6f4fbfb9821a2b32f5a0e6e4c1f3f'
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

## Mock OZ Relayer Strategy

E2E tests **do not call actual OZ Relayer API**. Instead, they use Jest Spy to mock HTTP responses:

### Architecture

```
E2E Test
  ↓
NestJS App (with mocked HttpClient)
  ↓
Jest Spy intercepts HTTP calls
  ↓
Returns Mock Response (configured in mock-responses.ts)
  ↓
E2E Test verifies response
```

### Mocking Strategy

```typescript
// In E2E test setup
const ozRelayerMock = jest.spyOn(httpClient, 'post')
  .mockResolvedValue(MOCK_OZ_RESPONSES.directTransaction);

// During test
const response = await request(app.getHttpServer())
  .post('/api/v1/relay/direct')
  .set('x-api-key', 'test-api-key')
  .send({ to, data, speed });

// Verify mock was called
expect(ozRelayerMock).toHaveBeenCalledWith(
  expect.stringContaining('/api/v1/transactions'),
  expect.any(Object)
);
```

### Benefits

- **Fast**: No network latency
- **Reliable**: No dependency on external services
- **Isolated**: Tests only verify API layer
- **Repeatable**: Same mock response every time

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
  test:
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
      - run: pnpm test:e2e          # E2E tests
      - run: pnpm test --coverage   # Coverage report
```

---

## Related Documents

- **[SPEC-E2E-001](../.moai/specs/SPEC-E2E-001/spec.md)** - E2E Test Infrastructure Specification
- **[SPEC-E2E-001 Acceptance](../.moai/specs/SPEC-E2E-001/acceptance.md)** - Acceptance Criteria
- **[tech.md - Section 7: E2E Test Infrastructure](./tech.md#7-e2e-test-infrastructure-spec-e2e-001)** - Technical details
- **[README.md](../README.md)** - Quick start guide

---

**Last Updated**: 2025-12-23
**Version**: 1.0.0
**Author**: Harry
**Status**: Complete ✅

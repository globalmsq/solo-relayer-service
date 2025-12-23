# SPEC-E2E-001 Implementation Plan

## Overview

| Item | Content |
|------|---------|
| **SPEC ID** | SPEC-E2E-001 |
| **Title** | E2E Test Infrastructure and Payment System Integration Verification |
| **Total Estimated Time** | ~4 hours (4 Phases) |
| **File Changes** | 12 new, 1 modified |
| **Test Cases** | 29 (5 categories) |

---

## Tech Stack

| Library | Version | Purpose | Installation Status |
|---------|---------|---------|---------------------|
| **supertest** | ^7.0.0 | HTTP endpoint testing | ❌ Installation required |
| **@types/supertest** | ^6.0.0 | TypeScript type definitions | ❌ Installation required |
| **ethers.js** | (existing) | EIP-712 signature generation | ✅ Already installed |
| **@nestjs/testing** | (existing) | NestJS test utilities | ✅ Already installed |
| **jest** | (existing) | Test framework | ✅ Already installed |

---

## Phase 1: E2E Test Infrastructure Setup (30 minutes)

### Goal
- Install supertest and related packages
- Create Jest E2E configuration file
- Add npm scripts

### Tasks

#### 1.1 Install Dependencies

**File**: `packages/relay-api/package.json` (modified)

**Changes**:
```json
{
  "devDependencies": {
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0"
  }
}
```

**Execution**:
```bash
cd packages/relay-api
pnpm add -D supertest@^7.0.0 @types/supertest@^6.0.0
```

#### 1.2 Create Jest E2E Configuration File

**File**: `packages/relay-api/test/jest-e2e.json` (new)

**Content**:
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "moduleNameMapper": { "^src/(.*)$": "<rootDir>/src/$1" },
  "testTimeout": 30000
}
```

**Explanation**:
- `testRegex`: Run only `.e2e-spec.ts` files
- `testTimeout`: 30 seconds (considering external API mock time)
- `moduleNameMapper`: src path alias

#### 1.3 Add npm Scripts

**File**: `packages/relay-api/package.json` (modified)

**Additional Scripts**:
```json
{
  "scripts": {
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "test:e2e:cov": "jest --config ./test/jest-e2e.json --coverage"
  }
}
```

### Deliverables
- ✅ supertest ^7.0.0 installed
- ✅ @types/supertest ^6.0.0 installed
- ✅ jest-e2e.json configuration file created
- ✅ test:e2e, test:e2e:cov scripts added

### Verification
```bash
# Verify dependencies
pnpm list supertest @types/supertest

# Verify scripts are executable (no error even without test files)
pnpm test:e2e

# Expected output: "No tests found..."
```

---

## Phase 2: Test Utilities and Fixtures (45 minutes)

### Goal
- Implement EIP-712 signature utilities
- Create Test Wallets and Config Fixtures
- Create Mock OZ Relayer response factory
- Implement NestJS Test App Factory

### Tasks

#### 2.1 Create Directory Structure

```bash
mkdir -p packages/relay-api/test/e2e
mkdir -p packages/relay-api/test/fixtures
mkdir -p packages/relay-api/test/utils
```

#### 2.2 Test Wallets Fixture

**File**: `packages/relay-api/test/fixtures/test-wallets.ts` (new)

**Content**:
```typescript
import { Wallet } from 'ethers';

// Hardhat default accounts #0~#2 (well-known test wallets)
export const TEST_WALLETS = {
  relayer: new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),  // Account #0
  user: new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'),     // Account #1
  merchant: new Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'), // Account #2
};

export const TEST_ADDRESSES = {
  relayer: TEST_WALLETS.relayer.address,    // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  user: TEST_WALLETS.user.address,          // 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  merchant: TEST_WALLETS.merchant.address,  // 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
};
```

**Explanation**:
- Account #0: Relayer (transaction submitter)
- Account #1: User (Gasless TX signer)
- Account #2: Merchant (token receiver)

#### 2.3 Test Config Fixture

**File**: `packages/relay-api/test/fixtures/test-config.ts` (new)

**Content**:
```typescript
export const TEST_CONFIG = {
  oz_relayer: {
    url: 'https://api.defender.openzeppelin.com',
    api_key: 'test-oz-api-key',
    relayer_id: 'test-relayer-id',
  },
  forwarder: {
    address: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', // Hardhat default Forwarder
    chain_id: 31337, // Hardhat local network
  },
  api: {
    key: 'test-api-key',
  },
};
```

#### 2.4 Mock OZ Relayer Response Factory

**File**: `packages/relay-api/test/fixtures/mock-responses.ts` (new)

**Content**:
```typescript
import { randomUUID } from 'crypto';

export const createMockOzRelayerResponse = (overrides?: Partial<any>) => ({
  transactionId: randomUUID(),
  hash: null,
  status: 'pending',
  createdAt: new Date().toISOString(),
  ...overrides,
});

export const createMockConfirmedResponse = (overrides?: Partial<any>) => ({
  transactionId: randomUUID(),
  hash: '0x' + '1'.repeat(64),
  status: 'confirmed',
  createdAt: new Date().toISOString(),
  confirmedAt: new Date().toISOString(),
  ...overrides,
});

export const createMockFailedResponse = (overrides?: Partial<any>) => ({
  transactionId: randomUUID(),
  hash: null,
  status: 'failed',
  createdAt: new Date().toISOString(),
  failedAt: new Date().toISOString(),
  error: 'Transaction reverted',
  ...overrides,
});
```

#### 2.5 EIP-712 Signature Utilities

**File**: `packages/relay-api/test/utils/eip712-signer.ts` (new)

**Content**:
```typescript
import { Wallet } from 'ethers';
import { TEST_CONFIG } from '../fixtures/test-config';

const EIP712_DOMAIN = {
  name: 'ERC2771Forwarder',
  version: '1',
  chainId: TEST_CONFIG.forwarder.chain_id,
  verifyingContract: TEST_CONFIG.forwarder.address,
};

const FORWARD_REQUEST_TYPE = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
};

export interface ForwardRequest {
  from: string;
  to: string;
  value: string;
  gas: string;
  nonce: number;
  deadline: number;
  data: string;
}

export async function signForwardRequest(
  wallet: Wallet,
  request: ForwardRequest,
): Promise<string> {
  return wallet.signTypedData(EIP712_DOMAIN, FORWARD_REQUEST_TYPE, request);
}

export function createForwardRequest(
  from: string,
  to: string,
  options: Partial<ForwardRequest> = {},
): ForwardRequest {
  return {
    from,
    to,
    value: '0',
    gas: '100000',
    nonce: 0,
    deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour later
    data: '0x',
    ...options,
  };
}

export function createExpiredForwardRequest(
  from: string,
  to: string,
): ForwardRequest {
  return createForwardRequest(from, to, {
    deadline: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago (expired)
  });
}
```

**Reference**: `packages/relay-api/scripts/test-gasless.ts` pattern reuse

#### 2.6 ERC-20 Encoding Utilities

**File**: `packages/relay-api/test/utils/encoding.ts` (new)

**Content**:
```typescript
import { Interface } from 'ethers';

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) public returns (bool)',
];

export function encodeERC20Transfer(to: string, amount: string): string {
  const iface = new Interface(ERC20_ABI);
  return iface.encodeFunctionData('transfer', [to, amount]);
}
```

#### 2.7 NestJS Test App Factory

**File**: `packages/relay-api/test/utils/test-app.factory.ts` (new)

**Content**:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../src/app.module';
import { TEST_CONFIG } from '../fixtures/test-config';

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          'OZ_RELAYER_URL': TEST_CONFIG.oz_relayer.url,
          'OZ_RELAYER_API_KEY': TEST_CONFIG.oz_relayer.api_key,
          'FORWARDER_ADDRESS': TEST_CONFIG.forwarder.address,
          'CHAIN_ID': TEST_CONFIG.forwarder.chain_id,
          'API_KEY': TEST_CONFIG.api.key,
        };
        return config[key] ?? defaultValue;
      }),
      getOrThrow: jest.fn((key: string) => {
        const config: Record<string, any> = {
          'OZ_RELAYER_URL': TEST_CONFIG.oz_relayer.url,
          'OZ_RELAYER_API_KEY': TEST_CONFIG.oz_relayer.api_key,
          'FORWARDER_ADDRESS': TEST_CONFIG.forwarder.address,
          'CHAIN_ID': TEST_CONFIG.forwarder.chain_id,
          'API_KEY': TEST_CONFIG.api.key,
        };
        const value = config[key];
        if (value === undefined) throw new Error(`Config key ${key} not found`);
        return value;
      }),
    })
    .compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  return app;
}
```

#### 2.8 Nonce Mock Strategy

**Problem**: `GET /api/v1/relay/gasless/nonce/:address` performs actual RPC call (Forwarder contract)

**Solution**: Mock GaslessService.getNonce method with Jest Spy

**Implementation** (add to test-app.factory.ts):
```typescript
// Option 1: GaslessService Mock
const gaslessService = app.get(GaslessService);
jest.spyOn(gaslessService, 'getNonce').mockResolvedValue(0n);

// Option 2: HttpService Mock (block RPC calls)
const httpService = app.get(HttpService);
jest.spyOn(httpService, 'post').mockImplementation((url) => {
  if (url.includes('nonces')) {
    return of({ data: { result: '0x0' } } as AxiosResponse);
  }
  return originalPost(url);
});
```

**Applicable Test Cases**:
- TC-E2E-G003: Nonce query → 200 OK + nonce: 0
- TC-E2E-G008: Nonce mismatch → 400 Bad Request

### Deliverables
- ✅ `test-wallets.ts` - Hardhat accounts #0~#2
- ✅ `test-config.ts` - Test environment configuration
- ✅ `mock-responses.ts` - OZ Relayer Mock response factory (using crypto.randomUUID())
- ✅ `eip712-signer.ts` - EIP-712 signature utilities (3 functions)
- ✅ `encoding.ts` - ERC-20 transfer encoding
- ✅ `test-app.factory.ts` - NestJS test app factory (including ConfigService.getOrThrow)

### Verification
```bash
# Verify TypeScript compilation
npx tsc --noEmit

# Test utility function imports (simple script)
node -e "const { TEST_WALLETS } = require('./test/fixtures/test-wallets'); console.log(TEST_WALLETS.relayer.address);"
```

---

## Phase 3: E2E Test Suite Implementation (2.5 hours)

### Goal
- Write 5 E2E test files (29 test cases)
- Configure Mock OZ Relayer responses
- Include Given-When-Then format comments

### Tasks

#### 3.1 Direct Transaction E2E Tests

**File**: `packages/relay-api/test/e2e/direct.e2e-spec.ts` (new)

**Test Cases** (8):
1. TC-E2E-D001: Valid Direct TX → 202 Accepted
2. TC-E2E-D002: Minimum fields only → 202 Accepted
3. TC-E2E-D003: Invalid Ethereum address → 400 Bad Request
4. TC-E2E-D004: Invalid hexadecimal data → 400 Bad Request
5. TC-E2E-D005: Invalid speed enum → 400 Bad Request
6. TC-E2E-D006: Missing API key → 401 Unauthorized
7. TC-E2E-D007: Invalid API key → 401 Unauthorized
8. TC-E2E-D008: OZ Relayer unavailable → 503 Service Unavailable

**Structure**:
```typescript
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app.factory';
import { TEST_ADDRESSES } from '../fixtures/test-wallets';
import { createMockOzRelayerResponse } from '../fixtures/mock-responses';

describe('Direct Transaction E2E Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/relay/direct', () => {
    it('TC-E2E-D001: should accept valid direct transaction', async () => {
      // Given: Valid Direct TX request
      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: '0x',
        speed: 'fast',
      };

      // When: Call POST /api/v1/relay/direct
      const response = await request(app.getHttpServer())
        .post('/api/v1/relay/direct')
        .set('x-api-key', 'test-api-key')
        .send(payload);

      // Then: 202 Accepted + txId included
      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('txId');
      expect(response.body.txId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    // ... 7 more test cases
  });
});
```

#### 3.2 Gasless Transaction E2E Tests

**File**: `packages/relay-api/test/e2e/gasless.e2e-spec.ts` (new)

**Test Cases** (10):
1. TC-E2E-G001: Valid Gasless TX with signature → 202 Accepted
2. TC-E2E-G002: Custom gas and value included → 202 Accepted
3. TC-E2E-G003: Nonce query → 200 OK + current nonce
4. TC-E2E-G004: Nonce query with invalid address → 400 Bad Request
5. TC-E2E-G005: Invalid signature format → 401 Unauthorized
6. TC-E2E-G006: Wrong signer signature → 401 Unauthorized
7. TC-E2E-G007: Expired deadline → 400 Bad Request
8. TC-E2E-G008: Nonce mismatch → 400 Bad Request
9. TC-E2E-G009: Invalid format signature → 400 Bad Request
10. TC-E2E-G010: Required fields missing → 400 Bad Request

**Structure**:
```typescript
import { signForwardRequest, createForwardRequest } from '../utils/eip712-signer';
import { TEST_WALLETS, TEST_ADDRESSES } from '../fixtures/test-wallets';

describe('Gasless Transaction E2E Tests', () => {
  describe('POST /api/v1/relay/gasless', () => {
    it('TC-E2E-G001: should accept valid gasless transaction with signature', async () => {
      // Given: Valid ForwardRequest + signature
      const request = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        { data: '0x', nonce: 0 }
      );
      const signature = await signForwardRequest(TEST_WALLETS.user, request);

      // When: Call POST /api/v1/relay/gasless
      const response = await request(app.getHttpServer())
        .post('/api/v1/relay/gasless')
        .set('x-api-key', 'test-api-key')
        .send({ request, signature });

      // Then: 202 Accepted + txId included
      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('txId');
    });

    // ... 9 more test cases
  });
});
```

#### 3.3 Status Polling E2E Tests

**File**: `packages/relay-api/test/e2e/status.e2e-spec.ts` (new)

**Test Cases** (6):
1. TC-E2E-S001: Query pending status → 200 + status: pending
2. TC-E2E-S002: Query confirmed status → 200 + hash + confirmedAt
3. TC-E2E-S003: Query failed status → 200 + status: failed
4. TC-E2E-S004: Invalid UUID format → 400 Bad Request
5. TC-E2E-S005: OZ Relayer unavailable → 503 Service Unavailable
6. TC-E2E-S006: Non-existent txId → 404 Not Found

#### 3.4 Health Check E2E Tests

**File**: `packages/relay-api/test/e2e/health.e2e-spec.ts` (new)

**Test Cases** (3):
1. TC-E2E-H001: All services healthy → 200 + status: ok
2. TC-E2E-H002: Public endpoint (no API key required) → 200 OK
3. TC-E2E-H003: OZ Relayer pool unhealthy → 503 Service Unavailable

#### 3.5 Payment Integration E2E Tests

**File**: `packages/relay-api/test/e2e/payment-integration.e2e-spec.ts` (new)

**Test Cases** (2):
1. TC-E2E-P001: Batch token transfer (Direct TX) → Multiple 202 responses
2. TC-E2E-P002: Full Gasless payment flow → 4 steps complete

**Structure**:
```typescript
describe('Payment Integration E2E Tests', () => {
  it('TC-E2E-P002: should complete full gasless payment flow', async () => {
    // Given: User address
    const userAddress = TEST_ADDRESSES.user;

    // Step 1: Query nonce
    const nonceResponse = await request(app.getHttpServer())
      .get(`/api/v1/relay/gasless/nonce/${userAddress}`)
      .set('x-api-key', 'test-api-key');

    expect(nonceResponse.status).toBe(200);
    const nonce = nonceResponse.body.nonce;

    // Step 2: Create and sign ForwardRequest
    const forwardRequest = createForwardRequest(
      userAddress,
      TEST_ADDRESSES.merchant,
      { nonce, data: '0x' }
    );
    const signature = await signForwardRequest(TEST_WALLETS.user, forwardRequest);

    // Step 3: Submit Gasless TX
    const submitResponse = await request(app.getHttpServer())
      .post('/api/v1/relay/gasless')
      .set('x-api-key', 'test-api-key')
      .send({ request: forwardRequest, signature });

    expect(submitResponse.status).toBe(202);
    const txId = submitResponse.body.txId;

    // Step 4: Query status
    const statusResponse = await request(app.getHttpServer())
      .get(`/api/v1/relay/status/${txId}`)
      .set('x-api-key', 'test-api-key');

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.transactionId).toBe(txId);
  });
});
```

### Deliverables
- ✅ `direct.e2e-spec.ts` - 8 test cases
- ✅ `gasless.e2e-spec.ts` - 10 test cases
- ✅ `status.e2e-spec.ts` - 6 test cases
- ✅ `health.e2e-spec.ts` - 3 test cases
- ✅ `payment-integration.e2e-spec.ts` - 2 test cases

### Verification
```bash
# Run E2E tests
pnpm --filter @msq-relayer/relay-api test:e2e

# Expected output: 29 tests passed
```

---

## Phase 4: Execution and Verification (15 minutes)

### Goal
- Verify all unit tests pass
- Verify all E2E tests pass
- Check test coverage
- Update TaskMaster Task #11 status to done

### Tasks

#### 4.1 Run Unit Tests

```bash
# Run unit tests (regression check)
pnpm --filter @msq-relayer/relay-api test

# Expected output: All tests passed
```

#### 4.2 Run E2E Tests

```bash
# Run E2E tests
pnpm --filter @msq-relayer/relay-api test:e2e

# Expected output: 29 tests passed
```

#### 4.3 E2E Test Coverage

```bash
# E2E test coverage (optional)
pnpm --filter @msq-relayer/relay-api test:e2e:cov

# Note: E2E coverage is managed separately from 90% goal
```

#### 4.4 Update TaskMaster

```bash
# Mark Task #11 as done
task-master set-status --id=11 --status=done
```

### Deliverables
- ✅ All unit tests pass (no regression)
- ✅ 29 E2E test cases pass
- ✅ TaskMaster Task #11 status: done

### Verification
- ✅ `pnpm test` succeeds (no unit test regression)
- ✅ `pnpm test:e2e` succeeds (29 tests pass)
- ✅ TaskMaster status: Task #11 → done

---

## Git Workflow Strategy

### Personal Mode Branch Strategy

```bash
# 1. Create Feature Branch
git checkout -b feature/SPEC-E2E-001

# 2. Commit Strategy per Phase
# Phase 1 complete
git add packages/relay-api/package.json packages/relay-api/test/jest-e2e.json
git commit -m "feat(e2e): setup E2E test infrastructure with supertest"

# Phase 2 complete
git add packages/relay-api/test/fixtures/ packages/relay-api/test/utils/
git commit -m "feat(e2e): add test utilities and fixtures for E2E tests"

# Phase 3 complete
git add packages/relay-api/test/e2e/
git commit -m "feat(e2e): implement 29 E2E test cases across 5 endpoints"

# Phase 4 complete
git add .
git commit -m "test(e2e): verify all E2E tests pass with coverage"

# 3. Branch Merge (Personal mode: merge directly to main)
git checkout main
git merge feature/SPEC-E2E-001
```

### Commit Message Conventions (Conventional Commits)

- `feat(e2e):` - E2E test infrastructure and utilities added
- `test(e2e):` - Test case implementation
- `docs(e2e):` - E2E test documentation

---

## File Changes List

### New Files (12)

| Path | Purpose | Phase |
|------|---------|-------|
| `test/jest-e2e.json` | Jest E2E configuration | Phase 1 |
| `test/fixtures/test-wallets.ts` | Hardhat test accounts | Phase 2 |
| `test/fixtures/test-config.ts` | Test environment configuration | Phase 2 |
| `test/fixtures/mock-responses.ts` | OZ Relayer Mock responses | Phase 2 |
| `test/utils/eip712-signer.ts` | EIP-712 signature utilities | Phase 2 |
| `test/utils/encoding.ts` | ERC-20 encoding | Phase 2 |
| `test/utils/test-app.factory.ts` | NestJS app factory | Phase 2 |
| `test/e2e/direct.e2e-spec.ts` | Direct TX E2E | Phase 3 |
| `test/e2e/gasless.e2e-spec.ts` | Gasless TX E2E | Phase 3 |
| `test/e2e/status.e2e-spec.ts` | Status Polling E2E | Phase 3 |
| `test/e2e/health.e2e-spec.ts` | Health Check E2E | Phase 3 |
| `test/e2e/payment-integration.e2e-spec.ts` | Payment Integration E2E | Phase 3 |

### Modified Files (1)

| Path | Changes | Phase |
|------|---------|-------|
| `packages/relay-api/package.json` | supertest deps + test:e2e scripts | Phase 1 |

---

## Important Warnings

### E2E-WARN-001: Prevent Unit Test Interference
- E2E tests located only in `test/e2e/` directory
- Separate Jest configuration files (`jest-e2e.json` vs default Jest)
- Separate test execution commands (`test:e2e` vs `test`)

### E2E-WARN-002: Maintain Mock Response Consistency
- Update `mock-responses.ts` when OZ Relayer API response format changes
- Regularly verify consistency between actual API and Mocks

### E2E-WARN-003: Test Timeout Configuration
- Default timeout 30 seconds (jest-e2e.json)
- Individual timeout can be set for slow test cases (`jest.setTimeout()`)

### E2E-WARN-004: Exclude Real Integration Tests
- Task #11 covers only Mock-based E2E tests
- Task #13 (Docker-based real integration tests) requires separate SPEC

---

## Success Criteria

### Functional Verification
✅ 8 Direct Transaction API tests pass
✅ 10 Gasless Transaction API tests pass
✅ 6 Status Polling API tests pass
✅ 3 Health Check API tests pass
✅ 2 Payment Integration scenarios pass

### Quality Verification
✅ No regression in existing unit tests
✅ E2E test execution time within 30 seconds
✅ External dependencies removed using Mock responses
✅ EIP-712 signature utilities verification pass

### Documentation
✅ Given-When-Then comments included in each test file
✅ TESTING.md updated (E2E test execution instructions)

---

## Reference Files (Read-Only)

| Path | Purpose |
|------|---------|
| `packages/relay-api/scripts/test-gasless.ts` | EIP-712 signature pattern reference |
| `packages/relay-api/src/relay/gasless/gasless.service.ts` | Gasless TX workflow reference |
| `packages/relay-api/src/relay/gasless/signature-verifier.service.ts` | Signature verification logic |
| `packages/relay-api/src/relay/direct/direct.controller.ts` | Direct TX endpoint reference |
| `packages/relay-api/src/relay/status/status.controller.ts` | Status endpoint reference |

---

## Next Steps (Phase 2+)

### SPEC-E2E-002: Docker-Based Real Integration Tests (Task #13)
- Run Hardhat local node with Docker Compose
- Use actual OZ Relayer instance
- Verify actual blockchain transactions

### SPEC-LOAD-001: Artillery Load Testing (Optional)
- Verify concurrent request handling
- Measure throughput
- Identify bottlenecks

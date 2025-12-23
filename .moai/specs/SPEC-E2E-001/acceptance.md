# SPEC-E2E-001 Acceptance Criteria

## Overview

This document defines the acceptance criteria for SPEC-E2E-001 (E2E Test Infrastructure and Payment System Integration Verification).

---

## Scenario 1: Direct Transaction E2E Complete Flow

### Given (Prerequisites)
- NestJS app running with supertest
- OZ Relayer API mocked with Jest Spy
- Valid API Key included in header (`x-api-key`)
- Mock OZ Relayer configured to return 202 response and UUID txId

### When (Execution Conditions)
**Step 1**: Send POST /api/v1/relay/direct request

**Request Body**:
```json
{
  "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "data": "0x",
  "speed": "fast"
}
```

**Request Headers**:
```
x-api-key: test-api-key
Content-Type: application/json
```

**Step 2**: OZ Relayer Mock returns response

**Mock Response**:
```json
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "hash": null,
  "status": "pending",
  "createdAt": "2025-12-23T10:00:00Z"
}
```

### Then (Expected Results)

✅ **HTTP Response**:
- Status Code: 202 Accepted
- Response Body:
  ```json
  {
    "txId": "550e8400-e29b-41d4-a716-446655440000"
  }
  ```

✅ **Verification Items**:
- `txId` is UUID v4 format (`^[0-9a-f-]{36}$`)
- OZ Relayer API called once (Jest spy verification)
- Response time < 1 second (Mock-based)

✅ **Error Handling Verification** (Additional test cases):
- Missing API Key → 401 Unauthorized
- Invalid Ethereum address → 400 Bad Request
- OZ Relayer Mock failure → 503 Service Unavailable

---

## Scenario 2: Gasless Transaction Signature Verification

### Given (Prerequisites)
- EIP-712 signing utility (`eip712-signer.ts`) ready
- Hardhat test account #1 (User) used
  - Private Key: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
  - Address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- Forwarder address: `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` (Hardhat)
- Chain ID: 31337 (Hardhat local network)
- Forwarder nonce at 0 (Mock)

### When (Execution Conditions)

**Step 1**: Query nonce
```http
GET /api/v1/relay/gasless/nonce/0x70997970C51812dc3A010C7d01b50e0d17dc79C8
x-api-key: test-api-key
```

**Expected Response**:
```json
{
  "nonce": 0
}
```

**Step 2**: Generate EIP-712 signature

```typescript
const forwardRequest = {
  from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  to: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  value: "0",
  gas: "100000",
  nonce: 0,
  deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour later
  data: "0x"
};

const signature = await signForwardRequest(TEST_WALLETS.user, forwardRequest);
```

**Expected Signature Format**: `0x` + 130 hexadecimal characters (65 bytes)

**Step 3**: Submit Gasless TX
```http
POST /api/v1/relay/gasless
x-api-key: test-api-key
Content-Type: application/json

{
  "request": {
    "from": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "to": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "value": "0",
    "gas": "100000",
    "nonce": 0,
    "deadline": 1735900800,
    "data": "0x"
  },
  "signature": "0x1234...abcd" // actual signature
}
```

**Step 4**: Query status
```http
GET /api/v1/relay/status/{txId}
x-api-key: test-api-key
```

### Then (Expected Results)

✅ **Step 1 (Nonce Query)**:
- Status Code: 200 OK
- Response Body: `{ "nonce": 0 }`

✅ **Step 2 (Signature Generation)**:
- Signature length: 132 characters (0x + 130 hex)
- Signature format: `^0x[0-9a-f]{130}$`
- EIP-712 domain verification:
  - name: "ERC2771Forwarder"
  - version: "1"
  - chainId: 31337
  - verifyingContract: `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`

✅ **Step 3 (Gasless TX Submission)**:
- Status Code: 202 Accepted
- Response Body: `{ "txId": "uuid-v4" }`
- SignatureVerifierService signature verification passed

✅ **Step 4 (Status Query)**:
- Status Code: 200 OK
- Response Body:
  ```json
  {
    "transactionId": "uuid-v4",
    "hash": null,
    "status": "pending",
    "createdAt": "2025-12-23T10:00:00Z"
  }
  ```

✅ **Error Handling Verification** (Additional test cases):
- Invalid signature → 401 Unauthorized (signature verification failed)
- Expired deadline → 400 Bad Request
- Nonce mismatch → 400 Bad Request
- Invalid signature format → 400 Bad Request

---

## Scenario 3: Payment Integration - Batch Token Transfer

### Given (Prerequisites)
- 3 ERC-20 token transfer requests prepared
- Each request is an independent Direct TX
- Using same API Key

### When (Execution Conditions)

**Batch Request**:
```typescript
const transfers = [
  { to: tokenAddress, data: encodeERC20Transfer(merchant1, '1000000000000000000') }, // 1 token
  { to: tokenAddress, data: encodeERC20Transfer(merchant2, '2000000000000000000') }, // 2 tokens
  { to: tokenAddress, data: encodeERC20Transfer(merchant3, '3000000000000000000') }, // 3 tokens
];

const responses = await Promise.all(
  transfers.map(tx =>
    request(app.getHttpServer())
      .post('/api/v1/relay/direct')
      .set('x-api-key', 'test-api-key')
      .send({ ...tx, speed: 'fast' })
  )
);
```

### Then (Expected Results)

✅ **All Requests Successful**:
- All 3 requests return 202 Accepted
- Each request returns unique txId
- Response time: Within 3 seconds (Mock-based, parallel processing)

✅ **Response Verification**:
```json
[
  { "txId": "uuid-1" },
  { "txId": "uuid-2" },
  { "txId": "uuid-3" }
]
```

✅ **OZ Relayer Call Verification**:
- OZ Relayer API called 3 times (Jest spy)
- Each call's `data` field is correct ERC-20 transfer encoding

---

## Scenario 4: Payment Integration - Complete Gasless Payment Flow

### Given (Prerequisites)
- User address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- Merchant address: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- EIP-712 signing utility ready
- Mock OZ Relayer response configured

### When (Execution Conditions)

**Complete Flow (4 Steps)**:

**Step 1**: Query nonce
```http
GET /api/v1/relay/gasless/nonce/0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

**Step 2**: Create ForwardRequest and sign
```typescript
const request = createForwardRequest(userAddress, merchantAddress, { nonce });
const signature = await signForwardRequest(TEST_WALLETS.user, request);
```

**Step 3**: Submit Gasless TX
```http
POST /api/v1/relay/gasless
{ request, signature }
```

**Step 4**: Query status
```http
GET /api/v1/relay/status/{txId}
```

### Then (Expected Results)

✅ **Step 1 Result**:
- Status: 200 OK
- Body: `{ "nonce": 0 }`

✅ **Step 2 Result**:
- Signature generation successful (132 char hex string)
- EIP-712 typed data verification passed

✅ **Step 3 Result**:
- Status: 202 Accepted
- Body: `{ "txId": "uuid-v4" }`
- Signature verification passed (SignatureVerifierService)

✅ **Step 4 Result**:
- Status: 200 OK
- Body:
  ```json
  {
    "transactionId": "uuid-v4",
    "hash": null,
    "status": "pending",
    "createdAt": "2025-12-23T10:00:00Z",
    "from": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "to": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9" // Forwarder
  }
  ```

✅ **Complete Flow Verification**:
- All 4 steps completed successfully
- Total execution time: Within 5 seconds
- Data consistency verification (nonce, txId, from/to addresses)

---

## Additional Verification Criteria

### AC-E2E-001: Direct Transaction API Verification
- ✅ All 8 test cases passed
- ✅ Validation, authentication, error handling covered

### AC-E2E-002: Gasless Transaction API Verification
- ✅ All 10 test cases passed
- ✅ Signature verification, Nonce, error handling covered

### AC-E2E-003: Status Polling API Verification
- ✅ All 6 test cases passed
- ✅ Status query, 404/503 errors covered

### AC-E2E-004: Health Check API Verification
- ✅ All 3 test cases passed
- ✅ Service status, public endpoint covered

### AC-E2E-005: Payment Integration Verification
- ✅ 2 scenario tests passed
- ✅ Batch transfer, complete Gasless flow covered

---

## Quality Gates

### Test Pass Criteria
- ✅ **All 29 E2E test cases passed** (Pass rate: 100%)
- ✅ **No unit test regression** (`pnpm test` successful)
- ✅ **E2E test execution time within 30 seconds** (Mock-based, fast feedback)

### Code Quality
- ✅ **TypeScript strict mode passed** (`npx tsc --noEmit` successful)
- ✅ **ESLint rules compliant** (no warnings)
- ✅ **Mock response consistency** (matches actual OZ Relayer API format)

### Documentation
- ✅ **Given-When-Then comments included in each test file**
- ✅ **TESTING.md updated** (E2E test execution instructions documented)
- ✅ **README.md updated** (E2E tests added to test section)

### External Dependency Elimination
- ✅ **No actual OZ Relayer API calls** (Mocked with Jest Spy)
- ✅ **No actual blockchain RPC calls**
- ✅ **Using only Hardhat test accounts** (no real wallet signing)

---

## Execution Verification Checklist

### Phase 1: Infrastructure Setup
- [ ] `pnpm list supertest` → confirm supertest ^7.0.0
- [ ] `pnpm list @types/supertest` → confirm @types/supertest ^6.0.0
- [ ] `test/jest-e2e.json` file exists
- [ ] `pnpm test:e2e` command executable

### Phase 2: Utilities and Fixtures
- [ ] `test/fixtures/test-wallets.ts` created
- [ ] `test/fixtures/test-config.ts` created
- [ ] `test/fixtures/mock-responses.ts` created
- [ ] `test/utils/eip712-signer.ts` created (3 functions)
- [ ] `test/utils/encoding.ts` created
- [ ] `test/utils/test-app.factory.ts` created
- [ ] `npx tsc --noEmit` successful (no TypeScript compilation errors)

### Phase 3: E2E Test Suite
- [ ] `test/e2e/direct.e2e-spec.ts` created (8 tests)
- [ ] `test/e2e/gasless.e2e-spec.ts` created (10 tests)
- [ ] `test/e2e/status.e2e-spec.ts` created (6 tests)
- [ ] `test/e2e/health.e2e-spec.ts` created (3 tests)
- [ ] `test/e2e/payment-integration.e2e-spec.ts` created (2 tests)
- [ ] `pnpm test:e2e` → 29 tests passed

### Phase 4: Final Verification
- [ ] `pnpm test` → All tests passed (no unit test regression)
- [ ] `pnpm test:e2e` → 29/29 tests passed
- [ ] E2E test execution time < 30 seconds
- [ ] `task-master set-status --id=11 --status=done` executed

---

## Success Metrics

| Metric | Target | Actual |
|--------|------|------|
| **E2E Test Pass Rate** | 100% (29/29) | [Record after implementation] |
| **Unit Test Regression** | 0 cases | [Record after implementation] |
| **E2E Execution Time** | < 30 seconds | [Record after implementation] |
| **TypeScript Errors** | 0 cases | [Record after implementation] |
| **ESLint Warnings** | 0 cases | [Record after implementation] |
| **Lines of Code** | ~800 LOC | [Record after implementation] |

---

## Failure Scenarios and Responses

### Scenario F1: E2E Test Failure (Signature Verification)
**Symptom**: TC-E2E-G001 failed (401 Unauthorized)
**Cause**: EIP-712 signature format mismatch
**Response**:
1. Verify EIP712_DOMAIN in `eip712-signer.ts`
2. Check `SignatureVerifierService` logic
3. Compare with `test-gasless.ts` reference pattern

### Scenario F2: Mock Response Mismatch
**Symptom**: TC-E2E-S002 failed (response format error)
**Cause**: OZ Relayer API response format changed
**Response**:
1. Update `mock-responses.ts`
2. Check actual OZ Relayer API documentation
3. Verify StatusService DTO

### Scenario F3: Unit Test Regression
**Symptom**: Existing unit tests failed
**Cause**: E2E test configuration affecting unit tests
**Response**:
1. Verify `jest-e2e.json` configuration (rootDir, testRegex)
2. Confirm unit test and E2E test isolation
3. Delete Jest cache and re-run

---

## Approval Criteria

This SPEC is approved when **all** of the following conditions are met:

✅ **Functional Verification**: All 29 E2E test cases passed
✅ **Quality Verification**: No unit test regression, no TypeScript errors
✅ **Documentation**: Given-When-Then comments, TESTING.md updated
✅ **Execution Time**: E2E tests completed within 30 seconds
✅ **External Dependencies**: Mock-based execution, no actual API calls

---

## Next Steps (Phase 2+)

### SPEC-E2E-002: Docker-based Actual Integration Testing (Task #13)
- ✅ Proceed after Mock-based E2E tests completed
- ✅ Use Hardhat local node
- ✅ Verify actual blockchain transactions

### SPEC-LOAD-001: Artillery Load Testing (Optional)
- ✅ Proceed after E2E test stabilization
- ✅ Verify concurrent request processing performance
- ✅ Identify and optimize bottlenecks

---

**Document Version**: 1.0.1
**Created**: 2025-12-23
**Author**: Harry
**SPEC ID**: SPEC-E2E-001

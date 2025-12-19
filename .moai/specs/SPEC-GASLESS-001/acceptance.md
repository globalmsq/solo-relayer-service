# SPEC-GASLESS-001 Acceptance Criteria

## Overview

| Field | Value |
|-------|-------|
| **SPEC ID** | SPEC-GASLESS-001 |
| **Feature** | Gasless Transaction API with EIP-712 Signature Verification |
| **Validation Method** | Automated Tests + Manual Testing |
| **Coverage Target** | ≥90% |

---

## Functional Acceptance Criteria

### AC-1: EIP-712 Signature Verification
**Given** a user submits a ForwardRequest with a valid EIP-712 signature
**When** the API receives the request at `POST /api/v1/relay/gasless`
**Then** the system shall:
- ✅ Verify the signature using ethers.js v6 `verifyTypedData()`
- ✅ Extract the signer address from the signature
- ✅ Compare signer address with `request.from` field
- ✅ Return 401 Unauthorized if signature is invalid or signer mismatch

**Test Cases**:
- Valid signature from correct signer → Accept
- Valid signature from wrong signer → Reject with 401
- Invalid signature format → Reject with 401
- Malformed signature → Reject with 401

---

### AC-2: Deadline Validation
**Given** a ForwardRequest contains a `deadline` field
**When** the signature verification succeeds
**Then** the system shall:
- ✅ Compare `block.timestamp` with `deadline`
- ✅ Reject requests where `block.timestamp > deadline` with 400 Bad Request
- ✅ Accept requests where `block.timestamp <= deadline`

**Test Cases**:
- Deadline in future → Accept
- Deadline exactly now → Accept
- Deadline in past → Reject with 400
- Missing deadline field → Reject with 400

---

### AC-3: Nonce Management
**Given** users need to track nonce values
**When** a GET request is made to `/api/v1/relay/gasless/nonce/:address`
**Then** the system shall:
- ✅ Query `ERC2771Forwarder.nonces(address)` via JSON-RPC
- ✅ Return HTTP 200 with `{ nonce: string }` response
- ✅ Return 400 for invalid Ethereum addresses
- ✅ Return 503 if RPC call fails

**Test Cases**:
- Valid address → Returns current nonce
- Invalid address format → Reject with 400
- RPC unavailable → Return 503
- Address with no prior nonces → Returns "0"

---

### AC-4: Forwarder Transaction Build
**Given** a valid and verified ForwardRequest
**When** all validations pass (signature + deadline)
**Then** the system shall:
- ✅ Encode `ERC2771Forwarder.execute(request, signature)` using ethers.js Interface
- ✅ Build DirectTxRequest with encoded data
- ✅ Submit to OzRelayerService
- ✅ Handle OZ Relayer errors with 503 Service Unavailable

**Test Cases**:
- Valid request → TX submitted successfully
- OZ Relayer unavailable → Return 503
- ABI encoding correct → Verify encoded data format
- Forwarder address correct → Verify `to` field matches FORWARDER_ADDRESS

---

### AC-5: Response Format
**Given** a successful transaction submission to OZ Relayer
**When** OZ Relayer accepts the transaction
**Then** the API shall:
- ✅ Return HTTP 202 Accepted
- ✅ Include `transactionId` (from OZ Relayer response)
- ✅ Include `hash` (null when pending, populated when mined)
- ✅ Include `status` (e.g., "pending", "confirmed")
- ✅ Include `createdAt` (ISO 8601 timestamp)

**Response Schema**:
```typescript
{
  transactionId: string;   // e.g., "tx_abc123def456"
  hash: string | null;     // e.g., "0xabc123..." or null
  status: string;          // e.g., "pending"
  createdAt: string;       // e.g., "2025-12-19T10:30:00.000Z"
}
```

**Test Cases**:
- Successful submission → Returns 202 with all fields
- TransactionId format valid → Matches OZ Relayer format
- CreatedAt format valid → ISO 8601 timestamp
- Hash nullable → Verify null handling for pending TXs

---

### AC-6: Error Handling
**Given** various error scenarios
**When** the request cannot be processed
**Then** the API shall return appropriate HTTP status codes and error messages:

| Error Scenario | Status Code | Error Message |
|----------------|-------------|---------------|
| Invalid signature | 401 Unauthorized | "Invalid EIP-712 signature" |
| Deadline expired | 400 Bad Request | "Transaction deadline expired" |
| OZ Relayer unavailable | 503 Service Unavailable | "OZ Relayer service unavailable" |
| Invalid DTO format | 400 Bad Request | Validation error details |
| Invalid Ethereum address | 400 Bad Request | "Invalid Ethereum address format" |
| Missing required fields | 400 Bad Request | Field validation errors |

**Test Cases**:
- Each error scenario → Correct status code and message
- Error response format → Consistent with NestJS HttpException
- Stack traces → Not exposed to users in production

---

## Technical Acceptance Criteria

### AC-7: Test Coverage
**Requirement**: ≥90% code coverage for all gasless module files

**Coverage Targets**:
- ✅ signature-verifier.service.ts: 100%
- ✅ gasless.service.ts: ≥90%
- ✅ gasless.controller.ts: ≥90%
- ✅ DTOs: 100% (validation coverage)

**Validation Command**:
```bash
pnpm run test:coverage
```

**Expected Output**:
```
File                                  | % Stmts | % Branch | % Funcs | % Lines
--------------------------------------|---------|----------|---------|--------
gasless/                              |   92.5  |   90.3   |  95.2   |  91.8
  signature-verifier.service.ts       |   100   |   100    |  100    |  100
  gasless.service.ts                  |   91.2  |   88.5   |  93.7   |  90.5
  gasless.controller.ts               |   90.8  |   87.2   |  94.1   |  89.9
```

---

### AC-8: Build Success
**Requirement**: TypeScript compilation must succeed without errors

**Validation Command**:
```bash
pnpm run build
```

**Expected Output**:
```
✓ TypeScript compilation successful
✓ No type errors
✓ Build artifacts generated in dist/
```

**Verification**:
- ✅ No TypeScript errors
- ✅ No ESLint warnings (critical)
- ✅ Build output contains gasless module files

---

### AC-9: API Documentation
**Requirement**: OpenAPI/Swagger documentation must be complete

**Endpoints to Document**:
- ✅ POST /api/v1/relay/gasless
  - Request body schema (GaslessTxRequestDto)
  - Response schema (GaslessTxResponseDto)
  - Error responses (400, 401, 503)

- ✅ GET /api/v1/relay/gasless/nonce/:address
  - Path parameter (address)
  - Response schema ({ nonce: string })
  - Error responses (400, 503)

**Validation**:
```bash
# Start dev server
pnpm run start:dev

# Access Swagger UI
open http://localhost:3000/api
```

**Expected Output**:
- ✅ Both endpoints visible in Swagger UI
- ✅ Request/response schemas documented
- ✅ Example values provided
- ✅ Error responses documented

---

### AC-10: Environment Configuration
**Requirement**: Required environment variables must be documented and validated

**Required Variables**:
```bash
CHAIN_ID=31337                                    # Network chain ID
FORWARDER_ADDRESS=0x...                           # ERC2771Forwarder contract address
RPC_URL=http://hardhat-node:8545                  # Already exists
```

**Validation**:
- ✅ `.env.example` contains all required variables
- ✅ ConfigService validates presence of CHAIN_ID
- ✅ ConfigService validates presence of FORWARDER_ADDRESS
- ✅ Application fails gracefully if variables missing

---

## Integration Testing

### IT-1: End-to-End Gasless Flow
**Test Scenario**: Complete gasless transaction flow from signature to execution

**Steps**:
1. Generate EIP-712 signature using ethers.js Wallet
2. Submit POST /api/v1/relay/gasless with signed request
3. Verify 202 Accepted response with transactionId
4. Query GET /api/v1/relay/gasless/nonce/:address
5. Verify nonce incremented after successful TX

**Expected Results**:
- ✅ Signature verification succeeds
- ✅ TX submitted to OZ Relayer
- ✅ TransactionId returned
- ✅ Nonce incremented by 1

**Test Implementation**:
```bash
# E2E test file
packages/relay-api/test/gasless.e2e-spec.ts
```

---

### IT-2: Nonce Synchronization
**Test Scenario**: Verify nonce values match Forwarder contract state

**Steps**:
1. Query GET /nonce/:address before any transactions
2. Submit gasless transaction
3. Query GET /nonce/:address after transaction
4. Verify nonce increased by exactly 1

**Expected Results**:
- ✅ Initial nonce = 0 for new address
- ✅ Nonce = 1 after first transaction
- ✅ Nonce = 2 after second transaction
- ✅ No nonce skipping or duplication

---

### IT-3: Deadline Edge Cases
**Test Scenario**: Test deadline validation at exact expiry time

**Steps**:
1. Create ForwardRequest with deadline = current timestamp + 1 second
2. Wait 2 seconds
3. Submit request
4. Verify rejection with 400 Bad Request

**Expected Results**:
- ✅ Expired deadline detected
- ✅ 400 status code returned
- ✅ Error message: "Transaction deadline expired"

---

## Security Validation

### SEC-1: Replay Attack Prevention
**Test Scenario**: Verify nonce prevents replay attacks

**Steps**:
1. Submit valid gasless transaction (nonce = 0)
2. Attempt to resubmit same signed request
3. Verify second request fails

**Expected Results**:
- ✅ First submission succeeds
- ✅ Second submission rejected (nonce already used)
- ✅ Nonce increments only once

---

### SEC-2: Signature Tampering Detection
**Test Scenario**: Verify signature tampering is detected

**Steps**:
1. Generate valid EIP-712 signature
2. Modify `request.to` field after signing
3. Submit tampered request
4. Verify rejection with 401 Unauthorized

**Expected Results**:
- ✅ Signature verification fails
- ✅ 401 status code returned
- ✅ Transaction not submitted to OZ Relayer

---

### SEC-3: Address Spoofing Prevention
**Test Scenario**: Verify `from` address matches signer

**Steps**:
1. Generate signature with Wallet A
2. Set `request.from` to address of Wallet B
3. Submit request
4. Verify rejection with 401 Unauthorized

**Expected Results**:
- ✅ Signer address mismatch detected
- ✅ 401 status code returned
- ✅ Transaction not submitted

---

## Performance Criteria

### PERF-1: Response Time
**Requirement**: P95 response time < 1 second for successful requests

**Validation**:
```bash
# Load test with 100 concurrent requests
ab -n 1000 -c 100 -T application/json -p request.json \
   http://localhost:3000/api/v1/relay/gasless
```

**Expected Results**:
- ✅ P50 < 300ms
- ✅ P95 < 1000ms
- ✅ P99 < 2000ms

---

### PERF-2: Nonce Query Performance
**Requirement**: Nonce queries < 200ms P95

**Validation**:
```bash
# Benchmark nonce endpoint
ab -n 1000 -c 50 http://localhost:3000/api/v1/relay/gasless/nonce/0x1234...
```

**Expected Results**:
- ✅ P50 < 100ms
- ✅ P95 < 200ms

---

## Final Acceptance Checklist

### Code Quality
- [ ] All unit tests pass (20 test cases)
- [ ] Test coverage ≥90%
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Code follows NestJS best practices

### Functionality
- [ ] POST /gasless endpoint functional
- [ ] GET /nonce/:address endpoint functional
- [ ] Signature verification working
- [ ] Deadline validation working
- [ ] Forwarder TX encoding correct

### Documentation
- [ ] OpenAPI/Swagger complete
- [ ] .env.example updated
- [ ] README.md updated (if needed)
- [ ] SPEC-GASLESS-001 approved

### Integration
- [ ] E2E tests pass
- [ ] OZ Relayer integration working
- [ ] Forwarder contract integration working
- [ ] RPC queries working

### Security
- [ ] Replay attack prevention verified
- [ ] Signature tampering detection verified
- [ ] Address spoofing prevention verified
- [ ] No sensitive data logged

---

**Acceptance Status**: Pending Implementation
**Next Step**: Execute `/moai:2-run SPEC-GASLESS-001` to begin TDD implementation
**Approval Required**: Yes (after all criteria met)

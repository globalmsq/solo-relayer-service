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

### AC-1: EIP-712 Signature Verification with Nonce Validation
**Given** a user submits a ForwardRequest with a valid EIP-712 signature and nonce
**When** the API receives the request at `POST /api/v1/relay/gasless`
**Then** the system shall:
- ✅ Query expected nonce from Forwarder contract via `nonces(from)`
- ✅ Validate that `request.nonce == expectedNonce`
- ✅ Return 400 Bad Request if nonce mismatch with error "Invalid nonce: expected X, got Y"
- ✅ Build EIP-712 TypedData with nonce from request
- ✅ Verify the signature using ethers.js v6 `verifyTypedData()`
- ✅ Extract the signer address from the signature
- ✅ Compare signer address with `request.from` field
- ✅ Return 401 Unauthorized if signature is invalid or signer mismatch

**Signature Verification Flow** (UPDATED):
```typescript
// EIP-712 Domain (from configuration)
const domain = {
  name: "ERC2771Forwarder",
  version: "1",
  chainId: configService.get('CHAIN_ID'),
  verifyingContract: configService.get('FORWARDER_ADDRESS')
};

// 1. Query expected nonce from Forwarder
const expectedNonce = await getNonceFromForwarder(request.from);

// 2. Validate nonce match
if (request.nonce !== expectedNonce) {
  throw new BadRequestException(`Invalid nonce: expected ${expectedNonce}, got ${request.nonce}`);
}

// 3. Build EIP-712 TypedData with nonce from request
const message = {
  from: request.from,
  to: request.to,
  value: request.value,
  gas: request.gas,
  nonce: request.nonce,  // ← Client-provided nonce
  deadline: request.deadline,
  data: request.data
};

// 4. Verify signature
const recoveredAddress = verifyTypedData(domain, types, message, signature);
if (recoveredAddress !== request.from) {
  throw new UnauthorizedException('Invalid EIP-712 signature');
}
```

**Test Cases**:
- Valid signature with correct nonce → Accept
- Valid signature with wrong nonce → Reject with 400 "Invalid nonce"
- Valid signature from wrong signer → Reject with 401
- Invalid signature format → Reject with 401
- Malformed signature → Reject with 401
- Nonce query fails → Return 503

---

### AC-2: Deadline Validation
**Given** a ForwardRequest contains a `deadline` field
**When** the signature verification succeeds
**Then** the system shall:
- ✅ Compare server time (Date.now() / 1000) with `deadline`
- ✅ Reject requests where `currentTime > deadline` with 400 Bad Request
- ✅ Accept requests where `currentTime <= deadline`

**Note**: relay-api validates deadline using server time for pre-check optimization. Final on-chain validation uses `block.timestamp <= deadline` in the Forwarder contract.

**Test Cases**:
- Deadline in future → Accept
- Deadline exactly now → Accept
- Deadline in past → Reject with 400
- Missing deadline field → Reject with 400

---

### AC-3: Nonce 조회 API
**Given** users need to query nonce values for EIP-712 signature creation
**When** a GET request is made to `/api/v1/relay/gasless/nonce/:address`
**Then** the system shall:
- ✅ Query `ERC2771Forwarder.nonces(address)` via JSON-RPC
- ✅ Return HTTP 200 with `{ nonce: string }` response
- ✅ Return 400 for invalid Ethereum addresses
- ✅ Return 503 if RPC call fails

**Important**: relay-api provides **query API only**. Nonce is automatically managed by the ERC2771Forwarder contract - relay-api does NOT manage nonces.

**Nonce Types Clarification**:

| Nonce Type | Managed By | relay-api Role |
|------------|-----------|----------------|
| **OZ Relayer Blockchain Nonce** | OZ Relayer (automatic) | None |
| **Forwarder User Nonce** | ERC2771Forwarder Contract (automatic) | **Query API only** |

**Test Cases**:
- Valid address → Returns current nonce from Forwarder contract
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
| **Nonce mismatch** | **400 Bad Request** | **"Invalid nonce: expected X, got Y"** |
| Deadline expired | 400 Bad Request | "Transaction deadline expired" |
| OZ Relayer unavailable | 503 Service Unavailable | "OZ Relayer service unavailable" |
| **RPC query fails** | **503 Service Unavailable** | **"Failed to query nonce from Forwarder contract"** |
| Invalid DTO format | 400 Bad Request | Validation error details |
| Invalid Ethereum address | 400 Bad Request | "Invalid Ethereum address format" |
| Missing required fields | 400 Bad Request | Field validation errors |

**Test Cases**:
- Each error scenario → Correct status code and message
- **Nonce mismatch → 400 with specific expected/actual values**
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

**Request DTO Schema Documentation**:
```typescript
// GaslessTxRequestDto - Full API request structure
export class GaslessTxRequestDto {
  @ValidateNested() @Type(() => ForwardRequestDto)
  request: ForwardRequestDto;

  @IsHexadecimal() signature: string;  // EIP-712 signature
}

// ForwardRequestDto - EIP-712 ForwardRequest structure
export class ForwardRequestDto {
  @IsEthereumAddress() from: string;       // Signer address
  @IsEthereumAddress() to: string;         // Target contract
  @IsNumberString() value: string;         // ETH value (wei)
  @IsNumberString() gas: string;           // Gas limit
  @IsNumberString() nonce: string;         // ← REQUIRED: User nonce from Forwarder
  @IsNumber() deadline: number;            // Unix timestamp (uint48)
  @IsHexadecimal() data: string;           // Encoded call data
}
```

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

**Steps** (UPDATED ORDER):
1. Query initial nonce: GET /api/v1/relay/gasless/nonce/:address → nonce = 0
2. Generate EIP-712 signature using ethers.js Wallet with nonce = 0
3. Submit POST /api/v1/relay/gasless with signed request (nonce = 0)
4. Verify 202 Accepted response with transactionId
5. **Wait for TX to be mined** (poll status or wait for confirmation)
6. Query final nonce: GET /api/v1/relay/gasless/nonce/:address → nonce = 1
7. Verify nonce incremented after TX mined

**Expected Results**:
- ✅ Initial nonce query succeeds
- ✅ Signature verification succeeds (nonce validation passes)
- ✅ TX submitted to OZ Relayer (202 Accepted)
- ✅ TransactionId returned
- ✅ **TX mined successfully** (status changes to "confirmed")
- ✅ Final nonce incremented by 1 (only after TX mined)

**Important**: Nonce increments **only after TX is mined**, not immediately after 202 Accepted.

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
2. Submit gasless transaction (202 Accepted)
3. **Wait for TX to be mined**
4. Query GET /nonce/:address after TX mined
5. Verify nonce increased by exactly 1

**Important**: Nonce increments **only after TX is mined**, not immediately after 202 Accepted.

**Expected Results**:
- ✅ Initial nonce = 0 for new address
- ✅ Nonce = 1 after first transaction mined
- ✅ Nonce = 2 after second transaction mined
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

### SEC-1: Replay Attack Prevention (Two-Layer Validation)
**Test Scenario**: Verify nonce prevents replay attacks

**Steps**:
1. Submit valid gasless transaction (nonce = 0)
2. Wait for TX to be mined (nonce increments to 1)
3. Attempt to resubmit same signed request (still has nonce = 0)
4. Verify second request fails at relay-api layer

**Expected Results**:
- ✅ First submission succeeds (nonce validation passes)
- ✅ Second submission rejected at **Layer 1 (relay-api)** with 400 "Invalid nonce: expected 1, got 0"
- ✅ TX never reaches **Layer 2 (Contract)** due to pre-check
- ✅ Nonce increments only once

**Security Layers**:
- **Layer 1 (relay-api)**: Pre-check optimization - validates request.nonce matches contract state
- **Layer 2 (Contract)**: Final security guarantee - ERC2771Forwarder validates nonce on-chain

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

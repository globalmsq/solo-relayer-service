# SPEC-GASLESS-001: Gasless Transaction API with EIP-712 Signature Verification

## Overview

| Field | Value |
|-------|-------|
| **SPEC ID** | SPEC-GASLESS-001 |
| **Title** | Gasless Transaction API with EIP-712 Signature Verification |
| **Status** | Draft |
| **Created** | 2025-12-19 |
| **Dependencies** | SPEC-PROXY-001 ✅, SPEC-CONTRACTS-001 ✅, SPEC-INFRA-001 ✅ |
| **Related Tasks** | Task #8 |

## Problem Statement

Users must pay gas fees to submit blockchain transactions, creating friction in Web3 UX. The MSQ Relayer Service needs a meta-transaction API that allows users to submit signed transaction requests without holding native tokens for gas.

## Solution

Implement a Gasless Transaction API (`POST /api/v1/relay/gasless`) that:

1. Accepts EIP-712 typed data signatures from users
2. Verifies signature validity using ethers.js v6 `verifyTypedData()`
3. Validates deadline and queries nonce from ERC2771Forwarder contract
4. Builds and submits `ERC2771Forwarder.execute()` transactions via OZ Relayer
5. Returns transaction ID and status to user

**Architecture**:
```
Frontend → Backend API → relay-api → OZ Relayer → Blockchain
                          ↑
                    Nonce 조회 제공
```

**Call Flow**: Backend service calls relay-api (Frontend does NOT call relay-api directly)

## Functional Requirements

### U-GASLESS-001: EIP-712 Signature Verification
**Given** a user submits a ForwardRequest with EIP-712 signature
**When** the API receives the request at `POST /api/v1/relay/gasless`
**Then** the system shall verify the signature using ethers.js v6 `verifyTypedData()` against the EIP-712 domain and ForwardRequest type

### U-GASLESS-002: Deadline Validation
**Given** a ForwardRequest contains a `deadline` field
**When** the signature verification succeeds
**Then** the system shall validate that `block.timestamp <= deadline` before proceeding

### U-GASLESS-003: Nonce 조회 API
**Given** users need to query nonce values for EIP-712 signature creation
**When** a GET request is made to `/api/v1/relay/gasless/nonce/:address`
**Then** the system shall query `ERC2771Forwarder.nonces(from)` via JSON-RPC and return the current nonce value

**Note**: Nonce is automatically managed by the ERC2771Forwarder contract. relay-api provides a **query API only** - it does NOT manage nonces.

### U-GASLESS-004: Forwarder Transaction Build
**Given** a valid and verified ForwardRequest
**When** all validations pass
**Then** the system shall encode `ERC2771Forwarder.execute(request, signature)` and submit via OzRelayerService

### U-GASLESS-005: Response Format
**Given** a successful transaction submission
**When** OZ Relayer accepts the transaction
**Then** the API shall return HTTP 202 Accepted with `{ transactionId, hash, status, createdAt }`

### U-GASLESS-006: Error Handling
**Given** signature verification fails OR deadline expired OR OZ Relayer unavailable
**When** the request cannot be processed
**Then** the API shall return appropriate HTTP status codes:
- 401 Unauthorized (invalid signature)
- 400 Bad Request (deadline expired)
- 503 Service Unavailable (OZ Relayer down)

## Technical Requirements

### T-GASLESS-001: ethers.js v6 Integration
- Install `ethers@^6.13.0` in relay-api package
- Use `verifyTypedData()` for EIP-712 signature verification

### T-GASLESS-002: EIP-712 Domain and Type Structure
```typescript
const domain: TypedDataDomain = {
  name: 'ERC2771Forwarder',
  version: '1',
  chainId: configService.get('CHAIN_ID'),
  verifyingContract: configService.get('FORWARDER_ADDRESS'),
};

// TypeHash includes nonce for signature verification
const types = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },    // ← Required for signature verification
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
};
```

**Important Nonce Handling**:
- **API Request DTO**: Does NOT include nonce field (managed by Forwarder)
- **EIP-712 TypeHash**: INCLUDES nonce field (required for signature verification)
- **Verification Process**: relay-api queries nonce from Forwarder, builds TypedData with nonce, then verifies signature

### T-GASLESS-003: DTO Validation
```typescript
// ForwardRequestDto - API request structure (NO nonce field)
export class ForwardRequestDto {
  @IsEthereumAddress() from: string;
  @IsEthereumAddress() to: string;
  @IsNumberString() value: string;
  @IsNumberString() gas: string;
  @IsNumber() deadline: number;       // uint48
  @IsHexadecimal() data: string;
  // ⚠️ NO nonce field - managed by Forwarder contract
}

// GaslessTxRequestDto - Full API request
export class GaslessTxRequestDto {
  @ValidateNested() @Type(() => ForwardRequestDto)
  request: ForwardRequestDto;

  @IsHexadecimal() signature: string;  // ← Separate field
}
```

### T-GASLESS-004: Environment Variables
- `CHAIN_ID`: Network chain ID (default: 31337 for Hardhat)
- `FORWARDER_ADDRESS`: ERC2771Forwarder contract address

### T-GASLESS-005: Nonce Types and Management
**Two Types of Nonces**:

| Nonce Type | Managed By | relay-api Role |
|------------|-----------|----------------|
| **OZ Relayer Blockchain Nonce** | OZ Relayer (automatic) | None |
| **Forwarder User Nonce** | ERC2771Forwarder Contract (automatic) | **Query API only** |

**Nonce Query Flow**:
```
Backend → GET /nonce/:address → GaslessService.getNonceFromForwarder()
        → RPC eth_call → Forwarder.nonces(address) → nonce 반환
```

### T-GASLESS-006: RPC Integration
- Query Forwarder nonce via JSON-RPC: `eth_call` to `nonces(address)`
- Use existing `RPC_URL` from environment

## Architecture

### Module Structure
```
packages/relay-api/src/relay/gasless/
├── dto/
│   ├── forward-request.dto.ts        # EIP-712 ForwardRequest structure
│   ├── gasless-tx-request.dto.ts     # API request DTO
│   └── gasless-tx-response.dto.ts    # API response DTO
├── gasless.controller.ts              # Endpoints
├── gasless.service.ts                 # Business logic
├── gasless.module.ts                  # NestJS module
├── signature-verifier.service.ts      # EIP-712 verification
└── *.spec.ts (3 files)                # Unit tests
```

### API Endpoints

**POST /api/v1/relay/gasless**
- Request Body: `GaslessTxRequestDto`
- Response: `202 Accepted` with `GaslessTxResponseDto`
- Errors: `400`, `401`, `503`

**GET /api/v1/relay/gasless/nonce/:address**
- Path Param: `address` (Ethereum address)
- Response: `200 OK` with `{ nonce: string }`
- Errors: `400`, `503`

## Testing Strategy

### Unit Tests (~20 test cases)

**signature-verifier.service.spec.ts** (7 tests):
- Valid EIP-712 signature → verification succeeds
- Invalid signature → verification fails
- Wrong signer address → verification fails
- Deadline expired → validation fails
- Deadline valid → validation succeeds
- Missing required fields → validation fails
- Malformed signature → verification fails

**gasless.service.spec.ts** (8 tests):
- Valid request → TX sent successfully
- Signature verification fails → UnauthorizedException
- Deadline expired → BadRequestException
- OZ Relayer unavailable → ServiceUnavailableException
- Nonce query succeeds → returns current nonce
- Nonce query fails → ServiceUnavailableException
- Forwarder TX encoding correct
- Response transformation correct

**gasless.controller.spec.ts** (5 tests):
- POST /gasless → 202 Accepted
- POST /gasless with invalid DTO → 400 Bad Request
- POST /gasless with invalid signature → 401 Unauthorized
- GET /nonce/:address → 200 OK with nonce
- GET /nonce/:address invalid address → 400 Bad Request

### Integration Tests (E2E)
- Full gasless flow: sign → submit → verify → execute
- Nonce increment verification
- Deadline edge cases (exact expiry timestamp)

## Implementation Phases

### Phase 1: DTO Definitions (3 files)
- ForwardRequestDto
- GaslessTxRequestDto
- GaslessTxResponseDto

### Phase 2: Signature Verifier Service (1 file)
- EIP-712 domain setup
- verifySignature() method
- validateDeadline() method

### Phase 3: Gasless Service (1 file)
- getNonceFromForwarder() - RPC call
- buildForwarderExecuteTx() - ABI encoding
- sendGaslessTransaction() - orchestration

### Phase 4: Controller (1 file)
- POST /gasless endpoint
- GET /nonce/:address endpoint

### Phase 5: Module Registration (2 files)
- GaslessModule
- RelayModule update

### Phase 6: Testing (3 files)
- Unit tests for all services and controller

### Phase 7: Environment Configuration (2 files)
- package.json (add ethers)
- .env.example (add CHAIN_ID, FORWARDER_ADDRESS)

## Acceptance Criteria

✅ **Signature Verification**: Valid EIP-712 signatures are accepted, invalid signatures are rejected with 401
✅ **Deadline Validation**: Expired deadlines are rejected with 400 Bad Request
✅ **Nonce API**: GET /nonce/:address returns current nonce from Forwarder contract
✅ **Transaction Submission**: Valid requests result in 202 Accepted with transactionId
✅ **Error Handling**: Appropriate HTTP status codes for all error scenarios
✅ **Test Coverage**: ≥90% test coverage for all services and controller
✅ **Documentation**: OpenAPI/Swagger annotations for all endpoints

## Security Considerations

- **Replay Protection**: Nonce management prevents replay attacks
- **Expiration**: Deadline validation prevents stale transaction execution
- **Signature Validation**: EIP-712 ensures typed data integrity
- **Address Verification**: Signature must match `from` address in ForwardRequest

## Dependencies

- SPEC-PROXY-001: OzRelayerService for transaction submission ✅
- SPEC-CONTRACTS-001: ERC2771Forwarder contract deployment ✅
- SPEC-INFRA-001: RPC endpoint configuration ✅

## Estimated Effort

- **Files**: 13 total (10 new, 3 modified)
- **Lines of Code**: ~500 LOC
- **Test Cases**: ~20 test cases
- **Implementation Time**: 2-3 hours

## References

- OpenZeppelin ERC2771Forwarder: https://docs.openzeppelin.com/contracts/5.x/api/metatx
- EIP-712: https://eips.ethereum.org/EIPS/eip-712
- ethers.js v6 verifyTypedData: https://docs.ethers.org/v6/api/hashing/#TypedDataEncoder
- Direct Transaction API (reference pattern): `packages/relay-api/src/relay/direct/`

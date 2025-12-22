# SPEC-GASLESS-001 Implementation Plan

## Overview

| Field | Value |
|-------|-------|
| **SPEC ID** | SPEC-GASLESS-001 |
| **Implementation Strategy** | TDD (Test-Driven Development) |
| **Total Phases** | 7 |
| **Estimated LOC** | ~500 |
| **Test Cases** | ~20 |

## Architecture

```
Frontend → Backend API → relay-api → OZ Relayer → Blockchain
                          ↑
                    Nonce 조회 제공
```

**Call Flow**: Backend service calls relay-api (Frontend does NOT call relay-api directly)

## Nonce Handling

| Nonce Type | Managed By | relay-api Role |
|------------|-----------|----------------|
| **OZ Relayer Blockchain Nonce** | OZ Relayer (automatic) | None |
| **Forwarder User Nonce** | ERC2771Forwarder Contract (automatic) | **Query API only** |

**Important**: relay-api provides **nonce query API** via `GET /nonce/:address`. Nonce is automatically managed by the Forwarder contract - relay-api does NOT manage it.

## Phase Breakdown

### Phase 1: DTO Definitions (5 files)
**Goal**: Define API request/response structures with validation

**Files to Create**:
1. `packages/relay-api/src/relay/gasless/dto/forward-request.dto.ts`
2. `packages/relay-api/src/relay/gasless/dto/gasless-tx-request.dto.ts`
3. `packages/relay-api/src/relay/gasless/dto/gasless-tx-response.dto.ts`

**Implementation Details**:
```typescript
// ForwardRequestDto (API request structure - INCLUDES nonce field)
export class ForwardRequestDto {
  @IsEthereumAddress() from: string;
  @IsEthereumAddress() to: string;
  @IsNumberString() value: string;
  @IsNumberString() gas: string;
  @IsNumberString() nonce: string;     // ← ADDED: Client must provide nonce
  @IsNumber() deadline: number;        // uint48
  @IsHexadecimal() data: string;
}

// GaslessTxRequestDto (Full API request)
export class GaslessTxRequestDto {
  @ValidateNested() @Type(() => ForwardRequestDto)
  request: ForwardRequestDto;

  @IsHexadecimal() signature: string;  // ← Separate field
}
```

- Use `class-validator` decorators for validation
- Follow Direct TX API DTO pattern as reference
- Include OpenAPI/Swagger annotations

**Expected LOC**: ~100 lines

---

### Phase 2: Signature Verifier Service (1 file)
**Goal**: Implement EIP-712 signature verification logic

**Files to Create**:
1. `packages/relay-api/src/relay/gasless/signature-verifier.service.ts`

**Key Methods**:
```typescript
class SignatureVerifierService {
  verifySignature(request: ForwardRequestDto, signature: string): boolean
  validateDeadline(deadline: number): boolean
  private buildEIP712Domain(): TypedDataDomain
  private buildEIP712Types(): Record<string, Array<TypedDataField>>
}
```

**Implementation Details**:
- Use ethers.js v6 `verifyTypedData()`
- EIP-712 domain: name='ERC2771Forwarder', version='1'
- Inject ConfigService for chainId and verifyingContract
- Deadline validation: `currentTime <= deadline` using server time (Date.now() / 1000)

**Signature Verification Logic** (핵심):
```typescript
// 1. Build EIP-712 TypedData with nonce from request
const message = {
  from: request.from,
  to: request.to,
  value: request.value,
  gas: request.gas,
  nonce: request.nonce,  // ← Client-provided nonce
  deadline: request.deadline,
  data: request.data
};

// 2. Verify signature
const recoveredAddress = verifyTypedData(domain, types, message, signature);
return recoveredAddress.toLowerCase() === request.from.toLowerCase();
```

**EIP-712 Types** (TypeHash INCLUDES nonce):
```typescript
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

**Expected LOC**: ~80 lines

---

### Phase 3: Gasless Service (1 file)
**Goal**: Orchestrate gasless transaction workflow

**Files to Create**:
1. `packages/relay-api/src/relay/gasless/gasless.service.ts`

**Key Methods**:
```typescript
class GaslessService {
  async sendGaslessTransaction(dto: GaslessTxRequestDto): Promise<GaslessTxResponseDto>
  async getNonceFromForwarder(address: string): Promise<string>
  private validateNonceMatch(requestNonce: string, expectedNonce: string): void  // ← ADDED
  private buildForwarderExecuteTx(dto: GaslessTxRequestDto): DirectTxRequest
}
```

**Implementation Details**:
- Inject: SignatureVerifierService, OzRelayerService, ConfigService
- **NEW FLOW**: Validate deadline → Query expected nonce → Validate request.nonce == expected → Verify signature → Build TX → Send via OZ Relayer
- Use ethers.js `Interface` to encode `execute(request, signature)`
- Query nonce via JSON-RPC `eth_call` to Forwarder contract

**Nonce Query Flow**:
```
Backend → GET /nonce/:address → GaslessService.getNonceFromForwarder()
        → RPC eth_call → Forwarder.nonces(address) → returns nonce
```

**Nonce Validation Logic** (ADDED):
```typescript
private validateNonceMatch(requestNonce: string, expectedNonce: string): void {
  if (requestNonce !== expectedNonce) {
    throw new BadRequestException(
      `Invalid nonce: expected ${expectedNonce}, got ${requestNonce}`
    );
  }
}
```

**Forwarder TX Build** (ForwardRequestData structure):
```typescript
// API request: { request: { from, to, value, gas, deadline, data }, signature }
// Forwarder.execute() expects: ForwardRequestData structure

const forwardRequestData = {
  from: dto.request.from,
  to: dto.request.to,
  value: dto.request.value,
  gas: dto.request.gas,
  deadline: dto.request.deadline,
  data: dto.request.data,
  signature: dto.signature,  // ← Combined structure
};

const calldata = forwarderInterface.encodeFunctionData('execute', [forwardRequestData]);
```

**Expected LOC**: ~150 lines

---

### Phase 4: Controller (1 file)
**Goal**: Expose REST API endpoints

**Files to Create**:
1. `packages/relay-api/src/relay/gasless/gasless.controller.ts`

**Endpoints**:
```typescript
@Controller('api/v1/relay/gasless')
class GaslessController {
  @Post()
  async submitGaslessTransaction(@Body() dto: GaslessTxRequestDto): Promise<GaslessTxResponseDto>

  @Get('nonce/:address')
  async getNonce(@Param('address') address: string): Promise<{ nonce: string }>
}
```

**Implementation Details**:
- Inject GaslessService
- Return 202 Accepted for successful submission
- Error handling: 400, 401, 503 status codes
- OpenAPI/Swagger decorators

**Expected LOC**: ~60 lines

---

### Phase 5: Module Registration (2 files)
**Goal**: Register NestJS modules and dependencies

**Files to Create**:
1. `packages/relay-api/src/relay/gasless/gasless.module.ts`

**Files to Modify**:
1. `packages/relay-api/src/relay/relay.module.ts`

**Implementation Details**:
- GaslessModule providers: SignatureVerifierService, GaslessService
- GaslessModule controller: GaslessController
- Import HttpModule, ConfigModule, OzRelayerModule
- Add GaslessModule to RelayModule imports

**Expected LOC**: ~40 lines

---

### Phase 6: Testing (3 files)
**Goal**: Achieve ≥90% test coverage

**Files to Create**:
1. `packages/relay-api/src/relay/gasless/signature-verifier.service.spec.ts`
2. `packages/relay-api/src/relay/gasless/gasless.service.spec.ts`
3. `packages/relay-api/src/relay/gasless/gasless.controller.spec.ts`

**Test Cases** (~20 total):

**signature-verifier.service.spec.ts** (7 tests):
- ✅ Valid signature → returns true
- ✅ Invalid signature → returns false
- ✅ Wrong signer → returns false
- ✅ Deadline valid → returns true
- ✅ Deadline expired → returns false
- ✅ Missing fields → throws validation error
- ✅ Malformed signature → returns false

**gasless.service.spec.ts** (8 tests):
- ✅ Valid request → TX submitted successfully
- ✅ Signature fails → UnauthorizedException
- ✅ Deadline expired → BadRequestException
- ✅ OZ Relayer down → ServiceUnavailableException
- ✅ Nonce query success → returns nonce
- ✅ Nonce query fail → ServiceUnavailableException
- ✅ Forwarder TX encoding correct
- ✅ Response transformation correct

**gasless.controller.spec.ts** (5 tests):
- ✅ POST /gasless → 202 Accepted
- ✅ POST invalid DTO → 400 Bad Request
- ✅ POST invalid signature → 401 Unauthorized
- ✅ GET /nonce/:address → 200 OK
- ✅ GET invalid address → 400 Bad Request

**Expected LOC**: ~300 lines

---

### Phase 7: Environment Configuration (2 files)
**Goal**: Add dependencies and environment variables

**Files to Modify**:
1. `packages/relay-api/package.json`
2. `packages/relay-api/.env.example`

**package.json Changes**:
```json
{
  "dependencies": {
    "ethers": "^6.13.0"
  }
}
```

**Run**: `pnpm install` after modification

**.env.example Additions**:
```bash
# EIP-712 Configuration
CHAIN_ID=31337
FORWARDER_ADDRESS=0x...
```

**Expected LOC**: ~10 lines

---

## Implementation Order (TDD Cycle)

### Cycle 1: DTOs
1. Write DTO tests (validation tests)
2. Implement DTOs with decorators
3. Verify tests pass

### Cycle 2: Signature Verifier
1. Write signature verifier tests
2. Implement verifySignature() and validateDeadline()
3. Verify tests pass

### Cycle 3: Gasless Service
1. Write service tests (mock OzRelayerService)
2. Implement sendGaslessTransaction() and getNonceFromForwarder()
3. Verify tests pass

### Cycle 4: Controller
1. Write controller tests (mock GaslessService)
2. Implement endpoints
3. Verify tests pass

### Cycle 5: Module Registration
1. Register modules
2. Run integration tests
3. Verify end-to-end flow

### Cycle 6: Environment Setup
1. Add ethers dependency
2. Update .env.example
3. Verify build and tests pass

---

## Key Implementation Patterns

### EIP-712 Domain Setup
```typescript
const domain: TypedDataDomain = {
  name: 'ERC2771Forwarder',
  version: '1',
  chainId: this.configService.get<number>('CHAIN_ID'),
  verifyingContract: this.configService.get<string>('FORWARDER_ADDRESS'),
};
```

### ForwardRequest Type
```typescript
const types = {
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
```

### Signature Verification
```typescript
const recoveredAddress = verifyTypedData(domain, types, request, signature);
return recoveredAddress.toLowerCase() === request.from.toLowerCase();
```

### Forwarder ABI Encoding
```typescript
const forwarderInterface = new Interface([
  'function execute((address,address,uint256,uint256,uint256,uint48,bytes) request, bytes signature) returns (bool, bytes)',
]);

const data = forwarderInterface.encodeFunctionData('execute', [
  [request.from, request.to, request.value, request.gas, request.nonce, request.deadline, request.data],
  signature,
]);
```

---

## Dependencies & References

**Existing Code to Reference**:
- `packages/relay-api/src/relay/direct/` - DTO and controller patterns
- `packages/relay-api/src/oz-relayer/oz-relayer.service.ts` - OZ Relayer integration
- `packages/contracts/artifacts/contracts/ERC2771Forwarder.sol/ERC2771Forwarder.json` - Forwarder ABI

**External Libraries**:
- ethers.js v6: https://docs.ethers.org/v6/
- class-validator: https://github.com/typestack/class-validator
- NestJS: https://docs.nestjs.com/

**Specifications**:
- EIP-712: https://eips.ethereum.org/EIPS/eip-712
- ERC-2771: https://eips.ethereum.org/EIPS/eip-2771

---

## Success Criteria

✅ All 20 test cases pass
✅ Test coverage ≥90%
✅ `pnpm run build` succeeds
✅ `pnpm run test` succeeds
✅ OpenAPI/Swagger documentation generated
✅ No TypeScript errors
✅ No ESLint warnings

---

## Risk Mitigation

**Risk 1**: ethers.js v6 API changes
- **Mitigation**: Pin version to `^6.13.0`, reference official docs

**Risk 2**: EIP-712 domain mismatch with Forwarder contract
- **Mitigation**: Verify domain parameters match deployed contract

**Risk 3**: Nonce synchronization issues
- **Mitigation**: Always query nonce from Forwarder contract, never cache

**Risk 4**: Deadline validation edge cases
- **Mitigation**: Use `block.timestamp` comparison, add buffer for clock drift

---

**Plan Status**: Ready for TDD Implementation ✅
**Next Step**: Execute `/moai:2-run SPEC-GASLESS-001` to begin RED-GREEN-REFACTOR cycle

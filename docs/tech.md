# MSQ Relayer Service - Technical Document

## Document Information
- **Version**: 12.6
- **Last Updated**: 2025-12-23
- **Status**: Phase 1 Complete (Direct + Gasless + Multi-Relayer Proxy + Nginx LB + Transaction Status Polling + API Key Authentication)

> **Note**: This document covers technical implementation details (HOW).
> - Business requirements (WHAT/WHY): [product.md](./product.md)
> - System architecture (WHERE): [structure.md](./structure.md)

> **Note**: MSQ Relayer Service is a **B2B Infrastructure**. All API usage patterns in this document are written based on Client Services (Payment system, Airdrop system, NFT service, etc.) calling the Relayer API. API documentation is available at Swagger UI (`/api/docs`).

### Related Documents
- [Product Requirements](./product.md) - WHAT/WHY
  - [Section 3.1: Functional Requirements](./product.md#31-phase-1-direct-tx--gasless-tx--payment-system-integration) - Smart contracts requirements
  - [Section 6: Milestones](./product.md#6-milestones) - Week 3 completion status
- [System Architecture](./structure.md) - WHERE
  - [Section 4.4: packages/contracts](./structure.md#44-packagescontracts) - Contracts directory structure
- [Docker Setup Guide](./DOCKER_SETUP.md) - Docker configuration and execution
  - [Hardhat Node Section](./DOCKER_SETUP.md#hardhat-node) - Running Hardhat independently
- [Task Master PRD](../.taskmaster/docs/prd.txt)
- **[SPEC-CONTRACTS-001](../.moai/specs/SPEC-CONTRACTS-001/spec.md)** - Smart Contracts Specification
  - [Acceptance Criteria](../.moai/specs/SPEC-CONTRACTS-001/acceptance.md)
  - [Implementation Plan](../.moai/specs/SPEC-CONTRACTS-001/plan.md)
- **[SPEC-PROXY-001](../.moai/specs/SPEC-PROXY-001/spec.md)** - Nginx Load Balancer Architecture
  - [Direct Transaction API](../.moai/specs/SPEC-PROXY-001/spec.md#4-direct-transaction-controller) - HTTP 202 endpoint

---

## Technical Stack Overview

Defines the technical stack and implementation specifications for the Blockchain Transaction Relayer System.

**v3.0 Key Changes**: 50% development time reduction by leveraging OZ open-source (Relayer v1.3.0, Monitor v1.1.0) as core components

### Implementation Scope

| Phase | Technical Scope | Status |
|-------|-----------------|--------|
| **Phase 1** | OZ Relayer (3x instances), Redis, Nginx Load Balancer, NestJS (Auth, Direct TX API, Gasless TX, EIP-712 Verification, Health, Status Polling), ERC2771Forwarder | **Complete** ✅ |
| **Phase 2+** | TX History (MySQL), Webhook Handler, Queue System (Redis/SQS), OZ Monitor, Policy Engine | Planned |

---

## 1. Core Services Technical Stack (OZ Open Source)

### 1.1 OZ Relayer v1.3.0

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Language | Rust | - | High performance, memory safety |
| Container | Docker | - | ghcr.io/openzeppelin/openzeppelin-relayer:v1.3.0 |
| License | AGPL-3.0 | - | Source disclosure required for modifications |
| Queue | Redis | 7.x | OZ Relayer native support |
| Key Management | Local keystore / AWS KMS | - | Local: docker/keys/, Prod: AWS KMS |

**Built-in Features**:
- Transaction relay and signing
- Automatic Nonce management
- Gas estimation and adjustment
- Retry logic
- Webhook notifications

### 1.2 OZ Monitor v1.1.0 (Phase 2+)

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Language | Rust | - | High performance, memory safety |
| Container | Docker | - | ghcr.io/openzeppelin/openzeppelin-monitor:v1.1.0 |
| License | AGPL-3.0 | - | Source disclosure required for modifications |

**Built-in Features**:
- Blockchain event detection
- Balance monitoring
- Slack/Discord/Telegram/Webhook notifications
- Custom trigger scripts (Python/JS/Bash)

### 1.3 Nginx Load Balancer

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Load Balancer | Nginx | alpine | Lightweight, high-performance, container-ready |
| Strategy | ip_hash | - | Session persistence based on client IP |
| Health Checks | Built-in | - | Automatic failover (max_fails=3, fail_timeout=30s) |
| Logging | Access + Error logs | - | Debugging and monitoring |
| Proxy Mode | HTTP Reverse Proxy | - | Transparent proxying with header preservation |

**Architecture**:
- **Upstream**: 3 OZ Relayer instances (oz-relayer-1:8081, oz-relayer-2:8082, oz-relayer-3:8083)
- **Load Balancing**: ip_hash strategy for session persistence
- **Health Endpoint**: `/health` (returns 200 if Nginx is running)
- **Proxy Pass**: All requests to healthy relayers via round-robin
- **Headers**: Maintains X-Real-IP and X-Forwarded-For for client identification

**Features**:
- Automatic failover when relayer becomes unhealthy
- Session persistence per client IP
- Access logging for request tracking
- Error logging for troubleshooting
- Configurable timeout and retry settings

---

## 2. API Gateway Technical Stack (Custom Development)

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Runtime | Node.js | 20 LTS | Extensive Web3 library support |
| Framework | NestJS | 10.x | Modularization, DI, type safety |
| Language | TypeScript | 5.x | Type safety, developer experience |
| Blockchain | ethers.js | 6.x | EIP-712 signature verification |
| ORM | Prisma (Phase 2+) | 5.x | Type-safe DB access |
| Validation | class-validator | 0.14.x | DTO validation |
| Documentation | Swagger/OpenAPI | 3.x | API documentation |

---

## 3. Authentication & Security (SPEC-AUTH-001)

### 3.1 API Key Authentication Guard (Phase 1)

**Overview**: All API requests to protected endpoints require authentication via the `x-api-key` header. The authentication is enforced by a NestJS Global Guard with fail-fast startup validation.

**Implementation**:
- File: `packages/relay-api/src/auth/guards/api-key.guard.ts`
- Type: NestJS `CanActivate` Guard registered as `APP_GUARD`
- Scope: Global (applies to all routes except those decorated with `@Public()`)

### 3.2 Authentication Mechanism

**Header-based API Key Validation**:

```
x-api-key: {RELAY_API_KEY}
```

| Requirement | Specification |
|-------------|----------------|
| **Header Name** | `x-api-key` (case-insensitive header name, case-sensitive value) |
| **Header Value** | Must exactly match `RELAY_API_KEY` environment variable |
| **Validation** | Strict equality (`===`) - whitespace and case-sensitive |
| **Source** | Only from HTTP headers (not query parameters or body) |
| **Failure Response** | HTTP 401 Unauthorized: `{ "message": "Invalid API key", "statusCode": 401 }` |

### 3.3 Public Endpoints (Bypass Authentication)

Certain endpoints bypass API Key authentication via the `@Public()` decorator:

```typescript
@Public()
@Get('health')
getHealth() { ... }
```

**Current Public Endpoints**:
- `GET /api/v1/health` - Health check endpoint
- `GET /relay/pool-status` - OZ Relayer pool status

### 3.4 Constructor Validation (Fail-Fast at Startup)

The API Key Guard validates the `RELAY_API_KEY` environment variable during constructor execution (NestJS DI initialization):

**Validation Rule**:
- If `RELAY_API_KEY` is not configured or empty, the Guard constructor throws an Error
- Error message: `"RELAY_API_KEY environment variable is required"`
- Result: Application fails to start, no downtime in production

```typescript
constructor(
  private reflector: Reflector,
  private configService: ConfigService,
) {
  const apiKey = this.configService.get<string>("apiKey");
  if (!apiKey) {
    throw new Error("RELAY_API_KEY environment variable is required");
  }
}
```

### 3.5 Security Constraints

| Constraint | Implementation | Rationale |
|------------|----------------|-----------|
| **Strict Equality** | Uses `===` operator for comparison | Prevents type coercion vulnerabilities |
| **Case Sensitivity** | API key values are case-sensitive | Ensures full entropy of the secret |
| **No Key Logging** | API key values never logged to console or logs | Prevents accidental key exposure in logs |
| **Generic Error Messages** | Returns "Invalid API key" for all failures | Prevents leaking whether key exists |
| **No Query Parameter Support** | API key only via x-api-key header | Reduces log exposure (query params often logged) |

### 3.6 Testing

**Test Coverage**: 6 comprehensive unit test scenarios covering all authentication paths:

- ✅ `@Public()` decorated endpoints bypass authentication without API key
- ✅ Valid API key allows access to protected endpoints
- ✅ Invalid API key returns 401 Unauthorized
- ✅ Missing API key header returns 401 Unauthorized
- ✅ Constructor throws error when RELAY_API_KEY not configured
- ✅ API key validation is case-sensitive

**Test File**: `packages/relay-api/src/auth/guards/api-key.guard.spec.ts`
**Coverage Target**: ≥90%
**Framework**: Jest

### 3.7 Environment Configuration

**Required Environment Variable**:

```bash
# .env
RELAY_API_KEY=your-secure-api-key-here
```

**Configuration Source**: `@nestjs/config` via `configService.get("apiKey")`

### 3.8 Related Specifications

For detailed requirements and acceptance criteria, see:
- **SPEC Document**: `.moai/specs/SPEC-AUTH-001/spec.md`
- **Acceptance Criteria**: `.moai/specs/SPEC-AUTH-001/acceptance.md`
- **Implementation Plan**: `.moai/specs/SPEC-AUTH-001/plan.md`

---

## 4. Smart Contracts Technical Stack

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Library | OpenZeppelin Contracts | 5.3.0 | Proven security, community standard |
| Framework | Hardhat | 2.22.0+ | Development/Testing/Deployment integration |
| Language | Solidity | ^0.8.27 | OZ v5 compatible |
| Testing | Hardhat Toolbox | 4.x | Testing utilities |
| Package Manager | pnpm | Latest | Workspace monorepo support |

### 4.1 Project Structure (SPEC-CONTRACTS-001)

```
packages/contracts/
├── contracts/
│   ├── forwarder/
│   │   └── (Uses @openzeppelin/contracts/metatx/ERC2771Forwarder.sol directly)
│   └── samples/
│       ├── SampleToken.sol       # ERC20 + ERC2771Context
│       └── SampleNFT.sol         # ERC721 + ERC2771Context
├── scripts/
│   ├── deploy-forwarder.ts       # ERC2771Forwarder deployment
│   └── deploy-samples.ts         # Sample contracts deployment (localhost only)
├── test/
│   ├── forwarder.test.ts         # ERC2771Forwarder unit tests
│   ├── sample-token.test.ts      # Sample token tests
│   └── sample-nft.test.ts        # Sample NFT tests
├── deployments/
│   ├── localhost/
│   │   ├── forwarder.json        # Forwarder deployment artifacts
│   │   ├── sample-token.json     # Sample token artifacts
│   │   └── sample-nft.json       # Sample NFT artifacts
│   └── amoy/
│       └── forwarder.json        # Polygon Amoy forwarder artifacts
├── hardhat.config.ts
└── package.json
```

### 4.2 OpenZeppelin Contract Usage

**Principle**: Minimize custom contracts, maximize usage of OpenZeppelin verified code

| Category | Contract to Use | Source | Status |
|----------|-----------------|--------|--------|
| **Forwarder** | `ERC2771Forwarder` | @openzeppelin/contracts v5.3.0 | ✅ Deployed |
| **Forwarder Context** | `ERC2771Context` | @openzeppelin/contracts v5.3.0 | ✅ Integrated |
| **ERC20 Implementation** | `ERC20` | @openzeppelin/contracts v5.3.0 | ✅ Sample |
| **ERC721 Implementation** | `ERC721` | @openzeppelin/contracts v5.3.0 | ✅ Sample |
| **Security Control** | Policy Engine | NestJS API Gateway (custom) | Phase 2+ |

### 4.3 ERC2771Forwarder Deployment Details

**Deployment Approach**: OpenZeppelin ERC2771Forwarder is deployed as-is without modifications.

**Deployment Networks**:
- **Hardhat Node** (localhost, Chain ID: 31337): Auto-deployed by `deploy-forwarder.ts`
- **Polygon Amoy** (Chain ID: 80002): Manual deployment with network detection

**Deployed Contract Features**:
- EIP-712 signature verification
- Nonce management (Per-account nonce tracking)
- Deadline verification (Validity period checking)
- `execute()` - Single forward request execution
- `executeBatch()` - Batch forward request execution
- `verify()` - Signature verification without execution
- `nonces(address)` - Query current user nonce

### 4.4 ForwardRequest Structure

```solidity
struct ForwardRequest {
    address from;       // Original user address (signer)
    address to;         // Target contract address
    uint256 value;      // ETH transfer amount
    uint256 gas;        // Gas limit for execution
    uint256 nonce;      // User nonce (incremented per request)
    uint48 deadline;    // Validity period (Unix timestamp)
    bytes data;         // Encoded function call data
}
```

**EIP-712 Signature Domain**:
```solidity
Domain {
    name: "Relayer-Forwarder-{network}",  // e.g., "Relayer-Forwarder-polygon"
    version: "1",
    chainId: {network_chain_id},
    verifyingContract: 0x{forwarder_address}
}
```

### 4.5 Sample Contracts (Localhost Only)

**Sample Contracts Implementation** (Only deployed to Hardhat Node):

#### SampleToken.sol (ERC20 + ERC2771Context)

```solidity
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract SampleToken is ERC20, ERC2771Context {
    constructor(address forwarder) ERC20("Sample Token", "SAMPLE") ERC2771Context(forwarder) {
        _mint(msg.sender, 1000000 * 10 ** 18);
    }

    function _msgSender() internal view override(ERC20, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _contextSuffixLength() internal view override(ERC20, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
```

**Purpose**: Demonstrates gasless token transfer pattern with meta-transaction support.

#### SampleNFT.sol (ERC721 + ERC2771Context)

```solidity
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract SampleNFT is ERC721, ERC2771Context {
    constructor(address forwarder) ERC721("Sample NFT", "SAMPLE") ERC2771Context(forwarder) {
        // Constructor implementation
    }

    function _msgSender() internal view override(ERC721, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _contextSuffixLength() internal view override(ERC721, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
```

**Purpose**: Demonstrates gasless NFT minting pattern with meta-transaction support.

### 4.6 Deployment Script: deploy-forwarder.ts

**Network Detection Logic**:

```typescript
// Network detection
const chainId = await ethers.provider.getNetwork().then(n => n.chainId);

if (chainId === 31337) {
  // Hardhat Node (localhost)
  console.log('Deploying to Hardhat Node (localhost)');
  forwarderName = 'Relayer-Forwarder-localhost';
} else if (chainId === 80002) {
  // Polygon Amoy
  console.log('Deploying to Polygon Amoy');
  forwarderName = 'Relayer-Forwarder-polygon-amoy';
} else {
  throw new Error(`Unsupported network: ${chainId}`);
}
```

**Deployment Output** (Saved to `deployments/{network}/forwarder.json`):

```json
{
  "address": "0x...",
  "deployer": "0x...",
  "network": "localhost",
  "chainId": 31337,
  "transactionHash": "0x...",
  "blockNumber": 1,
  "timestamp": "2025-12-18T00:00:00Z",
  "name": "Relayer-Forwarder-localhost",
  "version": "1",
  "abi": [...]
}
```

### 4.7 Sample Deployment Script: deploy-samples.ts

**Deployment Logic**:

```typescript
// Only deploy to localhost (Hardhat Node)
const chainId = await ethers.provider.getNetwork().then(n => n.chainId);

if (chainId !== 31337) {
  console.warn('Skipping sample contract deployment (only supported on localhost)');
  return;
}

// Deploy SampleToken and SampleNFT to localhost
const forwarderAddress = require('./deployments/localhost/forwarder.json').address;
```

**Deployed Artifacts** (Saved to `deployments/localhost/`):

```json
{
  "sampleToken": {
    "address": "0x...",
    "deploymentTransaction": "0x...",
    "blockNumber": 2,
    "abi": [...]
  },
  "sampleNFT": {
    "address": "0x...",
    "deploymentTransaction": "0x...",
    "blockNumber": 3,
    "abi": [...]
  }
}
```

### 4.8 Test Suite Coverage

**Test Categories**:

| Test File | Test Cases | Coverage |
|-----------|-----------|----------|
| `forwarder.test.ts` | Deployment, EIP-712 verification, signature validation, nonce management | High |
| `sample-token.test.ts` | Gasless transfer, context integration, _msgSender() verification | High |
| `sample-nft.test.ts` | Gasless minting, context integration, _msgSender() verification | High |

**Example Test**:

```typescript
describe('ERC2771Forwarder', () => {
  it('should verify valid EIP-712 signature', async () => {
    const forwardRequest = {
      from: userAddress,
      to: tokenAddress,
      value: 0,
      gas: 100000,
      nonce: 0,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      data: encodedFunctionCall
    };

    const signature = await signForwardRequest(forwardRequest, userPrivateKey);
    const isValid = await forwarder.verify(forwardRequest, signature);
    expect(isValid).to.be.true;
  });
});
```

### 4.9 Deployment Verification Process

**For Polygon Amoy**:

1. Deploy contract using `hardhat run scripts/deploy-forwarder.ts --network amoy`
2. Wait for transaction confirmation
3. Verify on Block Explorer (Polygonscan)
4. Save deployment artifact to `deployments/amoy/forwarder.json`

**Verification Command**:

```bash
npx hardhat verify --network amoy <CONTRACT_ADDRESS> --constructor-args scripts/args.js
```

### 4.10 Related Specifications

For detailed requirements and acceptance criteria, see:
- **SPEC Document**: `.moai/specs/SPEC-CONTRACTS-001/spec.md`
- **Acceptance Criteria**: `.moai/specs/SPEC-CONTRACTS-001/acceptance.md`
- **Implementation Plan**: `.moai/specs/SPEC-CONTRACTS-001/plan.md`

---

## 5. Infrastructure Technical Stack

| Category | Local | Production |
|----------|-------|------------|
| Container | Docker Compose | AWS EKS |
| Container Runtime | Docker | containerd |
| Orchestration | - | Kubernetes |
| Database | MySQL Container (Phase 2+) | AWS RDS MySQL (Multi-AZ) |
| Cache/Queue | Redis Container | AWS ElastiCache Cluster |
| Secrets | .env / K8s Secret | AWS Secrets Manager |
| Load Balancer | - | AWS ALB / Nginx Ingress |
| Monitoring | Prometheus + Grafana | Prometheus + Grafana |
| Logging | Console | CloudWatch / Loki |

---

## 6. API Specifications

> **API Response Format Standard**: All success responses follow the standard format below. For error response format, refer to Section 6.6.
>
> ```json
> {
>   "success": true,
>   "data": { /* Response data per endpoint */ },
>   "timestamp": "2025-12-15T00:00:00.000Z"
> }
> ```

### 5.1 Direct Transaction API

```yaml
POST /api/v1/relay/direct
Content-Type: application/json
X-API-Key: {api_key}

Request:
{
  "to": "0x...",           # Target contract address
  "data": "0x...",         # Encoded function call
  "value": "0",            # ETH transfer amount (wei)
  "gasLimit": "200000",    # Optional: Gas limit
  "speed": "average",      # Optional: safeLow|average|fast|fastest
  "metadata": {            # Optional: Tracking metadata
    "jobId": "airdrop-001",
    "batchIndex": 1
  }
}

Response (202 Accepted):
{
  "success": true,
  "data": {
    "txId": "tx_abc123def456",       # Internal transaction ID
    "status": "pending",             # pending|submitted|confirmed|failed
    "relayerId": "oz-relayer-1",     # Assigned Relayer ID
    "createdAt": "2025-12-15T00:00:00.000Z"
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

### 5.2 Gasless Transaction API (SPEC-GASLESS-001)

**Overview**: Gasless Transaction API enables users to submit meta-transactions signed with EIP-712 signatures. The relay-api validates signatures, nonces, and deadlines, then submits the transaction to the ERC2771Forwarder contract via OZ Relayer.

#### 5.2.1 Architecture and Data Flow

```
Client Backend Service
    │
    ├─→ GET /api/v1/relay/gasless/nonce/:address  (Query nonce)
    │       │
    │       └─→ GaslessService.getNonceFromForwarder()
    │           └─→ RPC eth_call → ERC2771Forwarder.nonces(address)
    │
    └─→ POST /api/v1/relay/gasless  (Submit gasless transaction)
            │
            ├─→ GaslessController.submitGaslessTransaction()
            │   ├─→ NestJS DTO Validation (class-validator)
            │   └─→ GaslessService.sendGaslessTransaction()
            │
            └─→ 7-Step Validation & Execution
                1. Validate deadline is in future (server time)
                2. Query expected nonce from Forwarder (Layer 1 pre-check)
                3. Validate request.nonce == expected nonce
                4. Verify EIP-712 signature using ethers.js verifyTypedData()
                5. Build ERC2771Forwarder.execute() transaction
                6. Submit to OZ Relayer via OzRelayerService
                7. Return 202 Accepted with transaction details
```

#### 5.2.2 Module Structure

```
packages/relay-api/src/relay/gasless/
├── dto/
│   ├── forward-request.dto.ts        # EIP-712 ForwardRequest structure
│   ├── gasless-tx-request.dto.ts     # API request DTO
│   └── gasless-tx-response.dto.ts    # API response DTO
├── gasless.controller.ts              # REST endpoints
├── gasless.service.ts                 # Business logic & orchestration
├── gasless.module.ts                  # NestJS module registration
├── signature-verifier.service.ts      # EIP-712 signature verification
├── gasless.controller.spec.ts         # Controller unit tests
├── gasless.service.spec.ts            # Service unit tests
└── signature-verifier.service.spec.ts # Signature verifier tests
```

#### 5.2.3 Request/Response Specifications

**Endpoint 1: POST /api/v1/relay/gasless**

```yaml
POST /api/v1/relay/gasless
Content-Type: application/json
X-API-Key: {api_key}

Request Body (GaslessTxRequestDto):
{
  "request": {
    "from": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",  # Signer address (user)
    "to": "0x5FbDB2315678afecb367f032d93F642f64180aa3",    # Forwarder address
    "value": "0",                                           # ETH transfer (wei, usually "0")
    "gas": "200000",                                        # Gas limit for inner tx
    "nonce": "0",                                           # From GET /nonce endpoint
    "deadline": 1702656000,                                 # Unix timestamp (uint48)
    "data": "0x"                                            # Encoded function call
  },
  "signature": "0x1234...abcd"                              # EIP-712 signature (130 hex chars)
}

Response (202 Accepted):
{
  "transactionId": "tx_xyz789ghi012",        # Internal transaction ID
  "hash": null,                              # null when pending, populated when mined
  "status": "pending",                       # pending|confirmed|failed
  "createdAt": "2025-12-22T10:00:00.000Z"   # ISO 8601 timestamp
}

Error Responses:
- 400 Bad Request: Invalid DTO, expired deadline, nonce mismatch, missing fields
- 401 Unauthorized: Invalid EIP-712 signature, signer mismatch
- 503 Service Unavailable: OZ Relayer or RPC endpoint unavailable
```

**Endpoint 2: GET /api/v1/relay/gasless/nonce/:address**

```yaml
GET /api/v1/relay/gasless/nonce/0x70997970C51812dc3A010C7d01b50e0d17dc79C8
X-API-Key: {api_key}

Response (200 OK):
{
  "nonce": "0"  # Current nonce value as string
}

Error Responses:
- 400 Bad Request: Invalid Ethereum address format
- 503 Service Unavailable: RPC endpoint unavailable
```

#### 5.2.4 EIP-712 Signature Verification Implementation

**Domain Structure** (from configuration):
```typescript
const domain: TypedDataDomain = {
  name: this.configService.get<string>("FORWARDER_NAME") || "MSQForwarder",
  version: "1",
  chainId: this.configService.get<number>("CHAIN_ID") || 31337,
  verifyingContract: this.configService.get<string>("FORWARDER_ADDRESS"),
};
```

**Type Structure** (7 fields matching ERC2771Forwarder):
```typescript
const types = {
  ForwardRequest: [
    { name: "from", type: "address" },       // Signer address
    { name: "to", type: "address" },         // Target contract
    { name: "value", type: "uint256" },      // ETH value in wei
    { name: "gas", type: "uint256" },        // Gas limit
    { name: "nonce", type: "uint256" },      // User nonce (REQUIRED for signature)
    { name: "deadline", type: "uint48" },    // Expiry timestamp
    { name: "data", type: "bytes" },         // Encoded call data
  ],
};
```

**Verification Flow** (SignatureVerifierService):
```
Input: ForwardRequestDto + signature (hex string)

1. Build EIP-712 domain from configuration
2. Build EIP-712 types (7 fields)
3. Create message object with all fields including nonce
4. Call ethers.verifyTypedData(domain, types, message, signature)
5. Compare recovered address with request.from (case-insensitive)
6. Return boolean: true if match, false otherwise

On Failure: Logs warning with recovered vs expected address
```

#### 5.2.5 Nonce Management (Two-Layer Validation)

**Layer 1 (relay-api Pre-check Optimization)**:
```
GaslessService.sendGaslessTransaction()
  ├─→ Query expected nonce from Forwarder: getNonceFromForwarder(from)
  │   └─→ RPC eth_call to Forwarder.nonces(address)
  │
  ├─→ Validate request.nonce == expectedNonce
  │   └─→ If mismatch: throw BadRequestException (400)
  │       Error message: "Invalid nonce: expected ${expected}, got ${request.nonce}"
  │
  └─→ Continue with signature verification if nonce valid
```

**Layer 2 (Smart Contract Final Validation)**:
```
ERC2771Forwarder.execute(request, signature)
  ├─→ Verify signature on-chain
  └─→ Validate nonce == current nonce (increments after execution)
```

**Nonce Query Mechanism** (JSON-RPC eth_call):
```typescript
// Function selector for nonces(address)
const noncesFunctionSelector = "0x7ecebe00";
const paddedAddress = address.toLowerCase().replace("0x", "").padStart(64, "0");
const callData = noncesFunctionSelector + paddedAddress;

// RPC call
POST /json-rpc
{
  "jsonrpc": "2.0",
  "method": "eth_call",
  "params": [
    {
      "to": forwarderAddress,
      "data": callData
    },
    "latest"
  ]
}

// Response: "0x{32-byte-nonce}" → converted to BigInt then string
```

#### 5.2.6 Deadline Validation

**Pre-check at relay-api** (using server time):
```typescript
validateDeadline(deadline: number): boolean {
  const currentTime = Math.floor(Date.now() / 1000);  // Server time in seconds
  return currentTime <= deadline;  // true if not expired
}
```

**Final validation at contract** (using block.timestamp):
```solidity
// In ERC2771Forwarder.execute()
require(block.timestamp <= request.deadline, "ERC2771Forwarder: signature expired");
```

**Important**: Server time pre-check (relay-api) ≠ block.timestamp (contract). There may be a small gap between relay-api validation and on-chain execution.

#### 5.2.7 Forwarder Transaction Building

**Function Encoding** (ethers.js Interface):
```typescript
private forwarderInterface = new Interface([
  "function execute((address from, address to, uint256 value, uint256 gas, uint48 deadline, bytes data, bytes signature) request)",
]);
```

**ForwardRequestData Structure** (for execute() call):
```typescript
const forwardRequestData = [
  dto.request.from,      // Signer address
  dto.request.to,        // Target contract
  dto.request.value,     // ETH value
  dto.request.gas,       // Gas limit
  dto.request.deadline,  // Expiry time
  dto.request.data,      // Call data
  dto.signature,         // EIP-712 signature
];

// IMPORTANT: nonce is NOT in the struct (only used for EIP-712 signing)
```

**Encoded Calldata**:
```typescript
const callData = this.forwarderInterface.encodeFunctionData("execute", [forwardRequestData]);

// Returns: "0x{4-byte-selector}{encoded-params}"
// Selector: 0xd087bde4 (execute function ID)
```

**Gas Configuration**:
```typescript
const gasLimit = this.configService.get<string>("FORWARDER_GAS_LIMIT", "200000");

// Default: 200000 wei (covers typical Forwarder.execute() overhead)
// Actual gas depends on inner transaction complexity
```

#### 5.2.8 Error Handling

| Error Scenario | Exception Type | HTTP Status | Message | DTO Validation |
|---|---|---|---|---|
| Invalid DTO format | BadRequestException | 400 | Field validation error | class-validator |
| Missing required fields | BadRequestException | 400 | Validation error details | class-validator |
| Invalid Ethereum address | BadRequestException | 400 | "Invalid Ethereum address format" | isAddress() check |
| Deadline expired | BadRequestException | 400 | "Transaction deadline expired" | validateDeadline() |
| Nonce mismatch | BadRequestException | 400 | "Invalid nonce: expected X, got Y" | validateNonceMatch() |
| Invalid signature | UnauthorizedException | 401 | "Invalid EIP-712 signature" | verifySignature() |
| RPC unavailable | ServiceUnavailableException | 503 | "Failed to query nonce from Forwarder contract" | getNonceFromForwarder() |
| OZ Relayer unavailable | ServiceUnavailableException | 503 | "OZ Relayer service unavailable" | sendTransaction() catch |

#### 5.2.9 Integration with OZ Relayer

**OzRelayerService Call**:
```typescript
// GaslessService builds DirectTxRequestDto
const forwarderTx: DirectTxRequestDto = {
  to: forwarderAddress,          // ERC2771Forwarder contract
  data: callData,                // Encoded execute() call
  value: "0",                    // No value sent to Forwarder
  gasLimit: "200000",
  speed: "fast"
};

// Submit to OZ Relayer
const response = await this.ozRelayerService.sendTransaction(forwarderTx);

// Response contains: { transactionId, hash, status, createdAt }
```

#### 5.2.10 Testing Strategy

**Unit Test Coverage** (~20 test cases):

**signature-verifier.service.spec.ts** (7 tests):
- Valid EIP-712 signature → verification succeeds
- Invalid signature → verification fails
- Wrong signer address → verification fails
- Deadline valid (future) → validation succeeds
- Deadline expired (past) → validation fails
- Missing required fields → validation fails
- Malformed signature → verification fails

**gasless.service.spec.ts** (8 tests):
- Valid request → TX submitted successfully with 202
- Signature verification fails → UnauthorizedException (401)
- Deadline expired → BadRequestException (400)
- Nonce mismatch → BadRequestException (400)
- Nonce query succeeds → returns current nonce
- Nonce query fails → ServiceUnavailableException (503)
- Forwarder TX encoding correct → verifies calldata format
- Response transformation correct → verifies DTO mapping

**gasless.controller.spec.ts** (5 tests):
- POST /gasless with valid request → 202 Accepted
- POST /gasless with invalid DTO → 400 Bad Request
- POST /gasless with invalid signature → 401 Unauthorized
- GET /nonce/:address with valid address → 200 OK with nonce
- GET /nonce/:address with invalid address → 400 Bad Request

**E2E Test Script** (`packages/relay-api/scripts/test-gasless.ts`):
```
Scenario 1: Nonce Query API
Scenario 2: Valid Gasless Transaction
Scenario 3: Invalid Signature Detection
Scenario 4: Expired Deadline Detection
Scenario 5: Invalid Address Format
```

#### 5.2.11 Implementation Files

**DTOs** (Request/Response structures):
- `packages/relay-api/src/relay/dto/forward-request.dto.ts` - ForwardRequest DTO with class-validator decorators
- `packages/relay-api/src/relay/dto/gasless-tx-request.dto.ts` - API request DTO (request + signature)
- `packages/relay-api/src/relay/dto/gasless-tx-response.dto.ts` - API response DTO

**Service Files**:
- `packages/relay-api/src/relay/gasless/signature-verifier.service.ts` - EIP-712 verification logic (~140 lines)
- `packages/relay-api/src/relay/gasless/gasless.service.ts` - Orchestration & nonce management (~250 lines)
- `packages/relay-api/src/relay/gasless/gasless.controller.ts` - REST endpoints (~140 lines)
- `packages/relay-api/src/relay/gasless/gasless.module.ts` - NestJS module registration (~50 lines)

**Test Files** (~300 lines total):
- `packages/relay-api/src/relay/gasless/signature-verifier.service.spec.ts` - 7 test cases
- `packages/relay-api/src/relay/gasless/gasless.service.spec.ts` - 8 test cases
- `packages/relay-api/src/relay/gasless/gasless.controller.spec.ts` - 5 test cases

**E2E Test Script**:
- `packages/relay-api/scripts/test-gasless.ts` - Manual E2E testing (~220 lines)

### 5.3 Nonce Query API

```yaml
GET /api/v1/relay/nonce/{userAddress}?network=polygon

Response (200 OK):
{
  "success": true,
  "data": {
    "address": "0x...",             # User address
    "nonce": "5",                   # Current Forwarder nonce
    "network": "polygon",           # Network name
    "forwarder": "0x..."            # Forwarder contract address
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

### 5.4 Transaction Status Polling API (SPEC-STATUS-001)

**Overview**: Transaction Status Polling API enables clients to query the status of submitted transactions. This is a Phase 1 polling-based approach with plans for webhook notifications in Phase 2+.

#### 5.4.1 Architecture and Data Flow

```
Client Service
    │
    └─→ GET /api/v1/relay/status/:txId  (Query status)
            │
            └─→ StatusService.getTransactionStatus()
                └─→ Direct HTTP call → OZ Relayer
                    └─→ Transform → TxStatusResponseDto
```

**Design Principle**: Thin API gateway with proper error handling (404 vs 503 differentiation).

#### 5.4.2 Module Structure

```
packages/relay-api/src/relay/status/
├── dto/
│   └── tx-status-response.dto.ts    # Response DTO with Swagger annotations
├── status.controller.ts              # GET /status/{txId} endpoint
├── status.service.ts                 # OzRelayerService wrapper
├── status.module.ts                  # Module definition
├── status.controller.spec.ts        # Controller tests (5 tests)
└── status.service.spec.ts           # Service tests (4 tests)
```

#### 5.4.3 Request/Response Specification

**Endpoint: GET /api/v1/relay/status/:txId**

```yaml
GET /api/v1/relay/status/550e8400-e29b-41d4-a716-446655440000
X-API-Key: {api_key}

Response (200 OK):
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",  # UUID v4 format
  "hash": "0xabcd1234...",                                   # Blockchain tx hash
  "status": "confirmed",                                     # pending|confirmed|failed
  "createdAt": "2025-12-19T10:00:00Z",                      # ISO 8601 timestamp
  "confirmedAt": "2025-12-19T10:05:00Z",                    # Optional: Confirmation time
  "from": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",    # Relayer address
  "to": "0x5FbDB2315678afecb367f032d93F642f64180aa3",      # Target contract or Forwarder
  "value": "0"                                               # ETH transfer amount (wei)
}

Error Responses:
- 400 Bad Request: Invalid transaction ID format (not UUID v4)
  {
    "statusCode": 400,
    "message": "Invalid transaction ID format",
    "error": "Bad Request"
  }

- 404 Not Found: Transaction ID does not exist in OZ Relayer
  {
    "statusCode": 404,
    "message": "Transaction not found",
    "error": "Not Found"
  }

- 503 Service Unavailable: OZ Relayer unavailable or timeout
  {
    "statusCode": 503,
    "message": "OZ Relayer service unavailable",
    "error": "Service Unavailable"
  }
```

#### 5.4.4 Status Values

Status values from OZ Relayer are simplified for client clarity:

| OZ Relayer Status | API Response | Description |
|------------------|--------------|-------------|
| `pending` | `pending` | Awaiting processing |
| `sent` | `pending` | Submitted to blockchain |
| `submitted` | `pending` | In mempool |
| `inmempool` | `pending` | In transaction mempool |
| `mined` | `pending` | Included in block (unconfirmed) |
| `confirmed` | `confirmed` | Confirmed (terminal state) |
| `failed` | `failed` | Transaction failed (terminal state) |

#### 5.4.5 Direct vs Gasless Transaction Response

| Type | `to` Field | Description |
|------|-----------|-------------|
| Direct | Target contract address | User-specified destination |
| Gasless | ERC2771Forwarder address | Meta-transaction forwarder |

Both transaction types use the same status query endpoint.

#### 5.4.6 Technical Implementation Details

**Transaction ID Validation**:
- Must be valid UUID v4 format
- Validation before OZ Relayer query prevents unnecessary network calls
- Returns 400 Bad Request for invalid format

**Direct HTTP Integration**:
- StatusService makes direct HTTP calls to OZ Relayer
- Timeout: 10 seconds (consistent with existing services)
- Proper 404/503 error differentiation enables accurate client error handling

**Response Transformation**:
- OZ Relayer response → TxStatusResponseDto
- Consistent with Direct and Gasless transaction responses
- Swagger/OpenAPI annotations for API documentation

### 5.5 Health Check API

Health check endpoints follow the **@nestjs/terminus standard pattern** with custom HealthIndicator implementations for OZ Relayer Pool and Redis.

#### Endpoint: GET /api/v1/health

```yaml
GET /api/v1/health

Response (200 OK - @nestjs/terminus Standard Format):
{
  "status": "ok",
  "info": {
    "oz-relayer-pool": {
      "status": "up",
      "healthyCount": 3,
      "totalCount": 3,
      "relayers": [
        {
          "id": "oz-relayer-1",
          "url": "http://oz-relayer-1:8080/api/v1/health",
          "status": "healthy",
          "responseTime": 45
        },
        {
          "id": "oz-relayer-2",
          "url": "http://oz-relayer-2:8080/api/v1/health",
          "status": "healthy",
          "responseTime": 52
        },
        {
          "id": "oz-relayer-3",
          "url": "http://oz-relayer-3:8080/api/v1/health",
          "status": "healthy",
          "responseTime": 48
        }
      ]
    },
    "redis": {
      "status": "up",
      "message": "Phase 1: Redis connectivity not implemented"
    }
  },
  "error": {},
  "details": {
    "oz-relayer-pool": {
      "status": "up",
      "healthyCount": 3,
      "totalCount": 3,
      "relayers": [...]
    },
    "redis": {
      "status": "up",
      "message": "Phase 1: Redis connectivity not implemented"
    }
  }
}
```

#### Endpoint: GET /api/v1/relay/pool-status

Detailed relayer pool status endpoint for debugging:

```yaml
GET /api/v1/relay/pool-status

Response (200 OK):
{
  "success": true,
  "data": {
    "status": "healthy",
    "healthyCount": 3,
    "totalCount": 3,
    "relayers": [
      {
        "id": "oz-relayer-1",
        "url": "http://oz-relayer-1:8080/api/v1/health",
        "status": "healthy",
        "responseTime": 45
      },
      {
        "id": "oz-relayer-2",
        "url": "http://oz-relayer-2:8080/api/v1/health",
        "status": "healthy",
        "responseTime": 52
      },
      {
        "id": "oz-relayer-3",
        "url": "http://oz-relayer-3:8080/api/v1/health",
        "status": "healthy",
        "responseTime": 48
      }
    ]
  },
  "timestamp": "2025-12-17T00:00:00.000Z"
}
```

#### Implementation: @nestjs/terminus HealthIndicators (Phase 1)

The health check system uses **@nestjs/terminus** with custom HealthIndicator implementations:

**Architecture**:
```
packages/relay-api/src/health/
├── health.controller.ts          # @HealthCheck() endpoint, @Public() bypass
├── health.module.ts              # TerminusModule + HealthIndicators DI
└── indicators/
    ├── oz-relayer.health.ts      # OzRelayerHealthIndicator extends HealthIndicator
    ├── redis.health.ts           # RedisHealthIndicator extends HealthIndicator
    └── index.ts                  # Barrel export
```

**OzRelayerHealthIndicator Implementation**:

```typescript
// packages/relay-api/src/health/indicators/oz-relayer.health.ts

import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { firstValueFrom, timeout, catchError } from 'rxjs';

export interface RelayerHealth {
  id: string;
  url: string;
  status: 'healthy' | 'unhealthy';
  responseTime?: number;
  error?: string;
}

export interface PoolHealthDetail {
  status: 'healthy' | 'degraded' | 'unhealthy';
  healthyCount: number;
  totalCount: number;
  relayers: RelayerHealth[];
}

@Injectable()
export class OzRelayerHealthIndicator extends HealthIndicator {
  private readonly relayerEndpoints = [
    {
      id: 'oz-relayer-1',
      url: 'http://oz-relayer-1:8080/api/v1/health',
      apiKey: process.env.OZ_RELAYER_1_API_KEY || 'test-api-key-relayer-1-local-dev-32ch',
    },
    {
      id: 'oz-relayer-2',
      url: 'http://oz-relayer-2:8080/api/v1/health',
      apiKey: process.env.OZ_RELAYER_2_API_KEY || 'test-api-key-relayer-2-local-dev-32ch',
    },
    {
      id: 'oz-relayer-3',
      url: 'http://oz-relayer-3:8080/api/v1/health',
      apiKey: process.env.OZ_RELAYER_3_API_KEY || 'test-api-key-relayer-3-local-dev-32ch',
    },
  ];

  constructor(private readonly httpService: HttpService) {
    super();
  }

  /**
   * Check OZ Relayer Pool health
   * Returns aggregated status of all 3 relayer instances
   * Parallel checking with 5-second timeout per relayer
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const results = await Promise.all(
      this.relayerEndpoints.map((endpoint) =>
        this.checkSingleRelayer(endpoint),
      ),
    );

    const healthyCount = results.filter((r) => r.status === 'healthy').length;
    const totalCount = results.length;
    const status = this.aggregateStatus(healthyCount, totalCount);
    const isHealthy = status === 'healthy';

    const poolDetail: PoolHealthDetail = {
      status,
      healthyCount,
      totalCount,
      relayers: results,
    };

    const result = this.getStatus(key, isHealthy, poolDetail);

    if (!isHealthy) {
      throw new HealthCheckError('OZ Relayer Pool health check failed', result);
    }

    return result;
  }

  /**
   * Check single relayer instance health
   * 5-second timeout per relayer with response time measurement
   */
  private async checkSingleRelayer(endpoint: {
    id: string;
    url: string;
    apiKey: string;
  }): Promise<RelayerHealth> {
    const startTime = Date.now();

    try {
      await firstValueFrom(
        this.httpService
          .get(endpoint.url, {
            headers: {
              Authorization: `Bearer ${endpoint.apiKey}`,
            },
          })
          .pipe(
            timeout(5000), // 5-second timeout per relayer
            catchError((err) => {
              throw err;
            }),
          ),
      );

      return {
        id: endpoint.id,
        url: endpoint.url,
        status: 'healthy',
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        id: endpoint.id,
        url: endpoint.url,
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Aggregate pool status based on healthy count
   * - healthy: all relayers responding
   * - degraded: some relayers responding (at least 1 healthy)
   * - unhealthy: all relayers unavailable
   */
  private aggregateStatus(
    healthyCount: number,
    totalCount: number,
  ): 'healthy' | 'degraded' | 'unhealthy' {
    if (healthyCount === totalCount) return 'healthy';
    if (healthyCount > 0) return 'degraded';
    return 'unhealthy';
  }
}
```

**RedisHealthIndicator Implementation**:

```typescript
// packages/relay-api/src/health/indicators/redis.health.ts

import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    // Phase 1: Placeholder - always returns healthy
    // Phase 2+: Implement actual Redis connectivity check using ioredis
    const isHealthy = true;

    return this.getStatus(key, isHealthy, {
      status: 'healthy',
      message: 'Phase 1: Redis connectivity not implemented',
    });
  }
}
```

**HealthController Implementation**:

```typescript
// packages/relay-api/src/health/health.controller.ts

import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
} from '@nestjs/terminus';
import { Public } from '../auth/decorators/public.decorator';
import {
  OzRelayerHealthIndicator,
  RedisHealthIndicator,
} from './indicators';

@Controller()
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private ozRelayerHealth: OzRelayerHealthIndicator,
    private redisHealth: RedisHealthIndicator,
  ) {}

  @Get('health')
  @Public()
  @HealthCheck()
  @HttpCode(HttpStatus.OK)
  async check() {
    return this.health.check([
      () => this.ozRelayerHealth.isHealthy('oz-relayer-pool'),
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }

  @Get('relay/pool-status')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getRelayerPoolStatus() {
    // Detailed relayer pool status for debugging
    const result = await this.ozRelayerHealth
      .isHealthy('oz-relayer-pool')
      .catch((error) => {
        return error.causes;
      });

    const poolData = result['oz-relayer-pool'] || result;

    return {
      success: true,
      data: poolData,
      timestamp: new Date().toISOString(),
    };
  }
}
```

**HealthModule Configuration**:

```typescript
// packages/relay-api/src/health/health.module.ts

import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';
import {
  OzRelayerHealthIndicator,
  RedisHealthIndicator,
} from './indicators';

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
  providers: [OzRelayerHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
```

#### Degraded Status Example

When some relayers are unhealthy:

```json
{
  "status": "ok",
  "info": {
    "oz-relayer-pool": {
      "status": "degraded",
      "healthyCount": 2,
      "totalCount": 3,
      "relayers": [
        {
          "id": "oz-relayer-1",
          "url": "http://oz-relayer-1:8080/api/v1/health",
          "status": "healthy",
          "responseTime": 45
        },
        {
          "id": "oz-relayer-2",
          "url": "http://oz-relayer-2:8080/api/v1/health",
          "status": "healthy",
          "responseTime": 52
        },
        {
          "id": "oz-relayer-3",
          "url": "http://oz-relayer-3:8080/api/v1/health",
          "status": "unhealthy",
          "error": "Connection timeout"
        }
      ]
    },
    "redis": {
      "status": "up",
      "message": "Phase 1: Redis connectivity not implemented"
    }
  },
  "error": {
    "oz-relayer-pool": {
      "message": "OZ Relayer Pool health check failed",
      "status": "degraded",
      "healthyCount": 2,
      "totalCount": 3
    }
  },
  "details": {
    "oz-relayer-pool": {
      "status": "degraded",
      "healthyCount": 2,
      "totalCount": 3,
      "relayers": [...]
    },
    "redis": {
      "status": "up",
      "message": "Phase 1: Redis connectivity not implemented"
    }
  }
}
```

#### Status Determination Logic

| Condition | Status | Notes |
|-----------|--------|-------|
| 3/3 relayers healthy | `healthy` | All relayers responding normally |
| 1-2/3 relayers healthy | `degraded` | Pool operating but with reduced capacity |
| 0/3 relayers healthy | `unhealthy` | Complete service outage |

**Phase 2+ Extension**:

When Phase 2+ is implemented with actual Redis connectivity:

```typescript
// Future RedisHealthIndicator implementation
async isHealthy(key: string): Promise<HealthIndicatorResult> {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  });

  try {
    const ping = await redis.ping();
    return this.getStatus(key, ping === 'PONG', {
      status: 'healthy',
      responseTime: Date.now() - startTime,
    });
  } catch (error) {
    return this.getStatus(key, false, {
      status: 'unhealthy',
      error: error.message,
    });
  }
}
```

### 5.6 Error Response Format

All API endpoints use a standardized error response format.

**Standard Error Response**:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

**HTTP Status Code Mapping**:

| Status | Code | Description |
|--------|------|-------------|
| 400 | `BAD_REQUEST` | Invalid request parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | API key valid but action not permitted |
| 404 | `NOT_FOUND` | Resource not found (tx, nonce) |
| 422 | `VALIDATION_ERROR` | Request validation failed |
| 429 | `RATE_LIMITED` | Too many requests (Phase 2+) |
| 500 | `INTERNAL_ERROR` | Server error |
| 502 | `RELAYER_ERROR` | OZ Relayer communication error |
| 503 | `SERVICE_UNAVAILABLE` | Service temporarily unavailable |

**Error Response Examples**:

```json
// 400 Bad Request - Invalid Parameters
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request body",
    "details": {
      "field": "to",
      "reason": "Invalid Ethereum address format"
    }
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}

// 401 Unauthorized - Missing API Key
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid API key",
    "details": {}
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}

// 404 Not Found - Transaction Not Found
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Transaction not found",
    "details": {
      "txId": "tx_abc123def456"
    }
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}

// 502 Relayer Error - OZ Relayer Communication Failed
{
  "success": false,
  "error": {
    "code": "RELAYER_ERROR",
    "message": "Failed to communicate with OZ Relayer",
    "details": {
      "relayerId": "oz-relayer-1",
      "reason": "Connection timeout"
    }
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

### 5.7 Rate Limiting (Phase 2+ Reserved)

> **Note**: Rate Limiting is not applied in Phase 1. The specifications below are reserved for Phase 2+ implementation.

**Rate Limit Response Headers**:

```
X-RateLimit-Limit: 1000        # Requests per window
X-RateLimit-Remaining: 999     # Remaining requests
X-RateLimit-Reset: 1702656000  # Unix timestamp of reset
X-RateLimit-Window: 3600       # Window size in seconds
```

**Rate Limit Exceeded Response (429)**:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": {
      "limit": 1000,
      "window": 3600,
      "retryAfter": 1702656000
    }
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

**Phase 1 Note**: Even though rate limiting is disabled, headers may be included with placeholder values.

### 5.8 Request/Response Examples (JSON Format)

Detailed request/response examples for each API endpoint.

#### 5.8.1 Direct TX (POST /api/v1/relay/direct)

**Request**:

```json
{
  "to": "0x1234567890123456789012345678901234567890",
  "data": "0xa9059cbb0000000000000000000000001234567890123456789012345678901234567890000000000000000000000000000000000000000000000000016345785d8a0000",
  "value": "0",
  "gasLimit": "100000",
  "chainId": 80002
}
```

**Success Response (202 Accepted)**:

```json
{
  "success": true,
  "data": {
    "txId": "tx_abc123def456",
    "status": "pending",
    "relayerId": "oz-relayer-1",
    "createdAt": "2025-12-15T00:00:00.000Z"
  }
}
```

#### 5.8.2 Gasless TX (POST /api/v1/relay/gasless)

**Request (EIP-712 Meta Transaction)**:

```json
{
  "request": {
    "from": "0xUserAddress1234567890123456789012345678901234",
    "to": "0xContractAddress12345678901234567890123456",
    "value": "0",
    "gas": "100000",
    "nonce": "0",
    "deadline": 1702656000,
    "data": "0xa9059cbb0000000000000000000000001234567890123456789012345678901234567890000000000000000000000000000000000000000000000000016345785d8a0000"
  },
  "signature": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12",
  "chainId": 80002
}
```

**Success Response (202 Accepted)**:

```json
{
  "success": true,
  "data": {
    "txId": "tx_xyz789ghi012",
    "status": "pending",
    "forwarder": "0xERC2771ForwarderAddress1234567890123456",
    "originalSender": "0xUserAddress1234567890123456789012345678901234",
    "relayerId": "oz-relayer-2"
  }
}
```

#### 5.8.3 Status Query (GET /api/v1/relay/status/{txId})

**Success Response (Transaction Confirmed)**:

```json
{
  "success": true,
  "data": {
    "txId": "tx_abc123def456",
    "status": "confirmed",
    "txHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
    "blockNumber": 12345678,
    "gasUsed": "21000",
    "effectiveGasPrice": "30000000000",
    "confirmedAt": "2025-12-15T00:01:00.000Z"
  }
}
```

**Status Values**:

| Status | Description |
|--------|-------------|
| `pending` | Transaction received, waiting for submission |
| `submitted` | Transaction submitted to blockchain |
| `confirmed` | Transaction confirmed on blockchain |
| `failed` | Transaction failed |

### 5.9 Pagination (Phase 2+ Reserved)

> **Note**: Phase 1 Status API returns single items. Pagination is reserved for Phase 2+ TX History API.

**Pagination Query Parameters**:

```
GET /api/v1/relay/history?page=1&limit=20&sort=createdAt&order=desc
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (1-indexed) |
| `limit` | number | 20 | Items per page (max: 100) |
| `sort` | string | createdAt | Sort field |
| `order` | string | desc | Sort order (asc/desc) |

**Paginated Response Format**:

```json
{
  "success": true,
  "data": [
    {
      "txId": "tx_abc123",
      "status": "confirmed",
      "txHash": "0x...",
      "createdAt": "2025-12-15T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

## 7. EIP-712 TypedData Structure

```typescript
// OZ ERC2771Forwarder EIP-712 Domain and Types
const EIP712_DOMAIN = {
  name: "Relayer-Forwarder-polygon",  // Name set during Forwarder deployment
  version: "1",
  chainId: 137,
  verifyingContract: "0x..."     // Forwarder address
};

const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" }
  ]
};
```

---

## 8. Policy Configuration (Phase 2+)

### 7.1 Policy Configuration File Structure (NestJS API Gateway)

```yaml
# config/policies.yaml
policies:
  - id: "default-policy"
    name: "Default Gasless Policy"
    enabled: true

    # Allowed contracts/methods (verified by NestJS Policy Engine)
    targets:
      contracts:
        - address: "0x...ERC20_TOKEN"
          methods: ["transfer", "approve", "transferFrom"]
        - address: "0x...ANOTHER_ERC20"
          methods: ["transfer", "approve"]
        - address: "0x...ERC721_NFT"
          methods: ["mint", "safeTransferFrom"]

    # User restrictions (verified by NestJS)
    users:
      whitelist: []        # Empty means all allowed
      blacklist:
        - "0x...blocked_address"

    # Gas limits (verified by NestJS)
    gas:
      maxGasLimit: "500000"
      maxPriorityFeePerGas: "50000000000"  # 50 gwei
      maxFeePerGas: "200000000000"         # 200 gwei

    # Networks
    networks: ["polygon", "amoy"]
```

---

## 9. Smart Contract vs Backend vs OZ Role Distribution

| Security Feature | OZ Forwarder (On-chain) | NestJS API Gateway | OZ Relayer |
|------------------|-------------------------|-------------------|------------|
| EIP-712 Signature Verification | Final verification | Pre-validation | - |
| Nonce Management | On-chain management (User) | Query only | Built-in (Relayer) |
| Deadline Verification | On-chain verification | Pre-validation | - |
| **Contract Whitelist** | - | Policy Engine | - |
| **Method Whitelist** | - | Policy Engine | - |
| **User Blacklist** | - | Policy Engine | - |
| **Gas Limit Cap** | - | Policy Engine | - |
| **Gas Estimation** | - | - | Built-in |
| **TX Signing/Submission** | - | - | Built-in |
| **Retry Logic** | - | - | Built-in |

---

## 10. Security Requirements

| Item | Requirement | Implementation Location |
|------|-------------|------------------------|
| Private Key Management | Local keystore / AWS KMS | OZ Relayer signer config |
| API Authentication | API Key | NestJS API Gateway |
| Network Security | VPC Private Subnet, Security Group | Infrastructure |
| Contract Whitelist | Allow only permitted contracts | NestJS Policy Engine |
| Method Whitelist | Allow only permitted methods | NestJS Policy Engine |
| User Blacklist | Reject blocked users | NestJS Policy Engine |
| EIP-712 Verification | Signature pre-validation | NestJS + OZ Forwarder |
| Nonce Verification | Replay attack prevention | OZ Forwarder (on-chain) |
| Deadline Verification | Reject expired requests | NestJS + OZ Forwarder |
| Webhook Security | WEBHOOK_SIGNING_KEY (Phase 2+) | OZ Relayer |

### 9.1 API Key Authentication (Phase 1)

**Authentication Method**:
- API Key management via single environment variable `RELAY_API_KEY`
- Header: `X-API-Key: {api_key}`
- Verification by matching with environment variable value

```
Client Service → [X-API-Key header] → API Gateway → [Environment variable comparison] → Pass/Reject
```

**Docker Compose Environment Variable**:
```yaml
relay-api:
  environment:
    RELAY_API_KEY: "msq-dev-api-key-12345"  # Development
```

**NestJS Module Structure**:
```
packages/relay-api/src/auth/
├── auth.module.ts              # Global Guard registration
├── guards/
│   └── api-key.guard.ts        # X-API-Key verification
└── decorators/
    └── public.decorator.ts     # @Public() (exceptions like Health Check)
```

**Phase 2+ Extension Plan**:
- Multiple Client Service support
- API Key management system (generation/revocation/rotation)
- DB-based storage
- Per-client permission management

---

## 11. Package Dependencies

### 10.1 API Gateway (NestJS)

```json
{
  "name": "@msq/relay-api",
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/swagger": "^7.0.0",
    "ethers": "^6.0.0",
    "@prisma/client": "^5.0.0",
    "class-validator": "^0.14.0",
    "class-transformer": "^0.5.0",
    "ioredis": "^5.0.0"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.0.0",
    "jest": "^29.0.0",
    "typescript": "^5.0.0",
    "prisma": "^5.0.0"
  }
}
```

### 10.2 Smart Contracts

```json
{
  "name": "@msq/relayer-contracts",
  "dependencies": {
    "@openzeppelin/contracts": "^5.3.0"
  },
  "devDependencies": {
    "@nomicfoundation/hardhat-toolbox": "^4.0.0",
    "hardhat": "^2.19.0",
    "typescript": "^5.0.0"
  }
}
```

---

## 12. OZ Relayer Configuration

### 11.1 config.json Example

```json
{
  "relayers": [{
    "id": "polygon-mainnet-relayer",
    "name": "Polygon Mainnet Relayer",
    "network": "polygon",
    "signer": {
      "type": "local",
      "keystore": "/app/config/keys/local-signer.json"
    },
    "rpc": {
      "url": "${POLYGON_RPC_URL}",
      "timeout": 30000
    },
    "policies": {
      "gas_price_cap": "500000000000",
      "min_balance": "100000000000000000",
      "max_pending_txs": 10
    },
    "notifications": [{
      "type": "webhook",
      "url": "http://relay-api:3000/api/v1/webhook/relayer",
      "signing_key": "${WEBHOOK_SIGNING_KEY}"
    }]
  }]
}
```

### 11.2 Network Configuration

| Network | Chain ID | RPC URL Environment Variable |
|---------|----------|------------------------------|
| Polygon Mainnet | 137 | `POLYGON_RPC_URL` |
| Polygon Amoy | 80002 | `AMOY_RPC_URL` |
| Ethereum Mainnet | 1 | `ETHEREUM_RPC_URL` |
| Ethereum Sepolia | 11155111 | `SEPOLIA_RPC_URL` |

### 11.3 Multi-Relayer Pool Configuration

**Relayer Pool Method**: Each Relayer holds an independent Private Key for parallel processing without Nonce collision

#### Pool Configuration Example

```
docker/config/oz-relayer/
├── relayer-1.json       # Relayer #1 config (Hardhat Account #10)
├── relayer-2.json       # Relayer #2 config (Hardhat Account #11)
└── relayer-3.json       # Relayer #3 config (Hardhat Account #12)
```

> **Note**: OZ Relayer expects a single config.json file. Docker volume mount maps each flat file to `/app/config/config.json`.
> Example: `./config/oz-relayer/relayer-1.json:/app/config/config.json:ro`

#### Individual Relayer config.json Example

```json
{
  "relayers": [{
    "id": "polygon-relayer-1",
    "name": "Polygon Mainnet Relayer #1",
    "network": "polygon",
    "signer": {
      "type": "local",
      "keystore": "/app/config/keys/relayer-1.json"
    },
    "rpc": {
      "url": "${POLYGON_RPC_URL}",
      "timeout": 30000
    },
    "policies": {
      "gas_price_cap": "500000000000",
      "min_balance": "100000000000000000",
      "max_pending_txs": 10
    },
    "notifications": [{
      "type": "webhook",
      "url": "http://relay-api:3000/api/v1/webhook/relayer",
      "signing_key": "${WEBHOOK_SIGNING_KEY}"
    }]
  }]
}
```

#### API Gateway Relayer Pool Configuration

```yaml
# config/relayer-pool.yaml (loaded by NestJS)
relayer_pool:
  strategy: "round_robin"  # round_robin | least_load
  health_check:
    interval_ms: 10000
    timeout_ms: 5000
    unhealthy_threshold: 3
  relayers:
    - id: "relayer-1"
      url: "http://oz-relayer-1:8080"
      api_key: "${OZ_RELAYER_1_API_KEY}"
      priority: 1
    - id: "relayer-2"
      url: "http://oz-relayer-2:8080"
      api_key: "${OZ_RELAYER_2_API_KEY}"
      priority: 1
    - id: "relayer-n"
      url: "http://oz-relayer-n:8080"
      api_key: "${OZ_RELAYER_N_API_KEY}"
      priority: 2  # Standby (lower priority)
```

#### Load Balancing Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **Round Robin** | Select Relayers sequentially | When even load distribution needed |
| **Least Load** | Select Relayer with fewest pending TXs | When response time optimization needed |

#### Scaling Policies

| Phase | Method | Description |
|-------|--------|-------------|
| **Phase 1** | Manual | Add/remove Relayer services in Docker Compose |
| **Phase 2+** | Auto | Kubernetes HPA or Queue Depth-based auto-scaling |

---

## 13. OZ Monitor Configuration (Phase 2+)

### 12.1 Network Configuration Example

```json
// config/oz-monitor/networks/polygon.json
{
  "id": "polygon-mainnet",
  "rpc_url": "${POLYGON_RPC_URL}",
  "chain_id": 137,
  "block_time": 2
}
```

### 12.2 Monitor Configuration Example

```json
// config/oz-monitor/monitors/relayer-balance.json
{
  "name": "Relayer Balance Monitor",
  "network": "polygon-mainnet",
  "addresses": ["${RELAYER_ADDRESS}"],
  "conditions": [{
    "type": "balance_threshold",
    "threshold": "100000000000000000",
    "comparison": "lt"
  }],
  "triggers": ["slack-alert", "discord-alert"]
}
```

### 12.3 Trigger Configuration Example

```json
// config/oz-monitor/triggers/slack.json
{
  "id": "slack-alert",
  "type": "slack",
  "webhook_url": "${SLACK_WEBHOOK_URL}",
  "template": "Relayer balance low: {{balance}} wei"
}
```

---

## 14. Docker Compose Configuration (v5.0 - SPEC-INFRA-001)

> **Docker Build Strategy**: Multi-stage build approach (docker/ directory consolidation)
> - Location: `docker/docker-compose.yaml` (local development, includes Hardhat Node)
> - Location: `docker/docker-compose-amoy.yaml` (Polygon Amoy Testnet)
> - Dockerfile: `docker/Dockerfile.packages` (multi-stage build, select package via target)
> - Environment Variables: Specified directly in docker-compose.yaml (no .env file)

**File Locations**:
```
docker/
├── docker-compose.yaml          # Main configuration (includes Hardhat Node)
├── docker-compose-amoy.yaml     # Polygon Amoy Testnet configuration
├── Dockerfile.packages          # Multi-stage build
├── config/
│   └── oz-relayer/
│       ├── relayer-1.json       # Relayer #1 config (flat file)
│       ├── relayer-2.json       # Relayer #2 config
│       └── relayer-3.json       # Relayer #3 config
├── keys-example/                # Sample keystores (included in Git)
│   ├── relayer-1/keystore.json  # Hardhat Account #10
│   ├── relayer-2/keystore.json  # Hardhat Account #11
│   └── relayer-3/keystore.json  # Hardhat Account #12
└── keys/                        # Actual keystores (.gitignore)
```

**Execution Commands**:
```bash
# Local development (Hardhat Node)
docker compose -f docker/docker-compose.yaml up -d

# Polygon Amoy Testnet
docker compose -f docker/docker-compose-amoy.yaml up -d
```

```yaml
# docker/docker-compose.yaml (Hardhat Node local development)
version: '3.8'

# === Top-level anchors (defined outside services) ===
# Note: YAML Anchors must be defined at top-level outside the services: block.
# Individual services are defined instead of deploy.replicas.
# Reason: Each Relayer needs a unique Private Key (to prevent Nonce collision)
# YAML Anchors reuse common configuration to minimize duplication.

x-relayer-common: &relayer-common
  image: ghcr.io/openzeppelin/openzeppelin-relayer:v1.3.0
  environment: &relayer-env
    RUST_LOG: info
    KEYSTORE_PASSPHRASE: ${KEYSTORE_PASSPHRASE:-hardhat-test-passphrase}
    RPC_URL: http://hardhat-node:8545
    REDIS_HOST: redis
    REDIS_PORT: 6379
  depends_on:
    redis:
      condition: service_healthy
    hardhat-node:
      condition: service_healthy
  restart: unless-stopped
  networks:
    - msq-relayer-network

# === Services block (after anchors definition) ===
services:
  # === Local Blockchain (Phase 1 Required) ===
  hardhat-node:
    build:
      context: ..
      dockerfile: docker/Dockerfile.packages
      target: hardhat-node
    ports: ["8545:8545"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8545"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - msq-relayer-network

  redis:
    image: redis:8.0-alpine
    ports: ["6379:6379"]
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    volumes:
      - msq-relayer-redis-data:/data
    networks:
      - msq-relayer-network

  # === API Gateway ===
  relay-api:
    build:
      context: ..
      dockerfile: docker/Dockerfile.packages
      target: relay-api
    ports: ["3000:3000"]
    depends_on:
      hardhat-node:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      NODE_ENV: development
      RELAYER_POOL_CONFIG: /app/config/relayer-pool.yaml
      REDIS_URL: redis://redis:6379
      RPC_URL: http://hardhat-node:8545
    volumes:
      - ../packages/relay-api/config:/app/config
    networks:
      - msq-relayer-network

  oz-relayer-1:
    <<: *relayer-common
    container_name: oz-relayer-1
    ports:
      - "8081:8080"
      - "8091:8081"
    volumes:
      - ./config/oz-relayer/relayer-1.json:/app/config/config.json:ro
      - ./keys/relayer-1:/app/config/keys:ro
    environment:
      <<: *relayer-env
      API_KEY: ${RELAYER_1_API_KEY:-test-api-key-relayer-1}

  oz-relayer-2:
    <<: *relayer-common
    container_name: oz-relayer-2
    ports:
      - "8082:8080"
      - "8092:8081"
    volumes:
      - ./config/oz-relayer/relayer-2.json:/app/config/config.json:ro
      - ./keys/relayer-2:/app/config/keys:ro
    environment:
      <<: *relayer-env
      API_KEY: ${RELAYER_2_API_KEY:-test-api-key-relayer-2}

  oz-relayer-3:
    <<: *relayer-common
    container_name: oz-relayer-3
    ports:
      - "8083:8080"
      - "8093:8081"
    volumes:
      - ./config/oz-relayer/relayer-3.json:/app/config/config.json:ro
      - ./keys/relayer-3:/app/config/keys:ro
    environment:
      <<: *relayer-env
      API_KEY: ${RELAYER_3_API_KEY:-test-api-key-relayer-3}

  # === Phase 2+: OZ Monitor ===
  # oz-monitor:
  #   image: ghcr.io/openzeppelin/openzeppelin-monitor:v1.1.0
  #   profiles: ["phase2"]

  # Phase 2+: Prometheus/Grafana
  # prometheus:
  #   image: prom/prometheus:v2.47.0
  #   profiles: ["phase2"]
  # grafana:
  #   image: grafana/grafana:10.2.0
  #   profiles: ["phase2"]

networks:
  msq-relayer-network:
    driver: bridge

volumes:
  msq-relayer-redis-data:
```

**Environment Variable Strategy**:
- ~~.env file usage~~ (removed in SPEC-INFRA-001)
- Environment variables specified directly in docker-compose.yaml
- Separate configuration files per network (docker-compose.yaml, docker-compose-amoy.yaml)

---

## 15. Hardhat Configuration

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    localhost: {
      chainId: 31337
    },
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : []
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      chainId: 137,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : []
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      chainId: 11155111,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : []
    },
    mainnet: {
      url: process.env.ETHEREUM_RPC_URL || "https://eth.llamarpc.com",
      chainId: 1,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : []
    }
  }
};

export default config;
```

---

## 16. Queue System (Phase 2+)

> **QUEUE_PROVIDER Pattern**: Selectively use Redis+BullMQ or AWS SQS depending on environment.

### 15.1 Queue Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NestJS API Gateway                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   Queue Adapter                        │  │
│  │  ┌─────────────────┐    ┌─────────────────────────┐   │  │
│  │  │ QUEUE_PROVIDER  │────│ Redis+BullMQ (default)  │   │  │
│  │  │ env variable    │    │ AWS SQS (production)    │   │  │
│  │  └─────────────────┘    └─────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 15.2 Provider Comparison

| Item | Redis + BullMQ | AWS SQS |
|------|----------------|---------|
| Environment | Local/Dev/Test | Production |
| Configuration Complexity | Low | Medium |
| Cost | Infrastructure only | Per-request billing |
| Scalability | Requires horizontal scaling | Auto-scaling |
| Message Retention | Volatile (configurable) | 4-day default retention |
| Latency | Very low | Low |

### 15.3 Environment Configuration

```bash
# .env file
# Redis (default)
QUEUE_PROVIDER=redis
REDIS_URL=redis://localhost:6379

# AWS SQS (production)
QUEUE_PROVIDER=sqs
AWS_REGION=ap-northeast-2
AWS_SQS_QUEUE_URL=https://sqs.ap-northeast-2.amazonaws.com/123456789012/relayer-queue
```

### 15.4 Queue Adapter Interface

```typescript
// packages/relay-api/src/queue/queue-adapter.interface.ts
interface QueueAdapter {
  enqueue(job: RelayJob): Promise<string>;  // returns jobId
  getJob(jobId: string): Promise<JobStatus>;
  cancelJob(jobId: string): Promise<boolean>;
}

interface RelayJob {
  type: 'direct' | 'gasless';
  payload: DirectTxRequest | GaslessTxRequest;
  priority?: 'high' | 'normal' | 'low';
  metadata?: Record<string, string>;
}

interface JobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  txHash?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### 15.5 API Changes (Queue Mode)

API responses change when Queue system is enabled:

```yaml
# Queue disabled (Phase 1 - immediate processing)
POST /api/v1/relay/direct
Response (200 OK):
{
  "txId": "uuid",
  "txHash": "0x...",
  "status": "submitted"
}

# Queue enabled (Phase 2+ - async processing)
POST /api/v1/relay/direct
Response (202 Accepted):
{
  "jobId": "uuid",
  "status": "queued",
  "estimatedWait": "5s"
}

# Job status query
GET /api/v1/relay/job/{jobId}
Response:
{
  "jobId": "uuid",
  "status": "completed",
  "txHash": "0x...",
  "txId": "uuid"
}
```

### 15.6 Redis + BullMQ Configuration

```typescript
// packages/relay-api/src/queue/redis-queue.adapter.ts
import { Queue, Worker } from 'bullmq';

const relayQueue = new Queue('relay-jobs', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  }
});
```

### 15.7 AWS SQS Configuration

```typescript
// packages/relay-api/src/queue/sqs-queue.adapter.ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'ap-northeast-2'
});

const queueUrl = process.env.AWS_SQS_QUEUE_URL;
```

---

## 17. License Considerations

### 16.1 OZ Relayer / OZ Monitor: AGPL-3.0

| Usage Scenario | Obligations |
|----------------|-------------|
| Internal use | No restrictions |
| Use without modifications | No restrictions |
| Service provision after modifications | Source disclosure of changes required |
| SaaS provision | Source disclosure obligation when providing service over network |

### 16.2 OZ Contracts: MIT

- Commercial use allowed
- Free modification and distribution
- No source disclosure obligation

---

## Related Document References

| Document | Description | Path |
|----------|-------------|------|
| Product Requirements | Business requirements, milestones, success metrics | `./product.md` |
| System Architecture | Architecture, directory structure, data flow | `./structure.md` |
| Task Master PRD | PRD for task management | `.taskmaster/docs/prd.txt` |

---

## HISTORY

| Version | Date | Changes |
|---------|------|---------|
| 12.4 | 2025-12-19 | Section 4 Smart Contracts expansion - Replaced basic overview with comprehensive SPEC-CONTRACTS-001 integration (Section 4.1-4.10): project structure, OpenZeppelin usage, ERC2771Forwarder deployment, sample contracts, deployment scripts, test coverage, verification process, related specifications |
| 12.3 | 2025-12-16 | Phase 1 completion - Updated version and status to reflect Phase 1 complete, added Docker Setup Guide cross-reference |
| 12.2 | 2025-12-15 | Section 5.5 Health Check API expansion - Added Relayer Pool Status Aggregation NestJS implementation example (HealthService, checkRelayerPoolHealth, aggregateStatus), Added Detailed Health Response JSON example (including degraded status) |
| 12.1 | 2025-12-15 | API response format standardization - Unified Section 5.1-5.4 responses to Section 5.8 standard format (success/data/timestamp wrapper applied), Added standard response format guide at Section 5 start |
| 12.0 | 2025-12-15 | Document version sync - Complete document structure cleanup, duplicate removal, cross-reference system establishment |
| 11.7 | 2025-12-15 | Document role clarification - Added document role (HOW) and cross-references to header |
| 11.6 | 2025-12-15 | Section 5 API spec expansion - 5.6 Error Response Format (standard error response, HTTP Status Code Mapping, error examples), 5.7 Rate Limiting (Phase 2+ Reserved, header spec), 5.8 Request/Response Examples (Direct TX, Gasless TX, Status Query JSON examples), 5.9 Pagination (Phase 2+ Reserved, Query Parameters, paging response format) |
| 11.5 | 2025-12-15 | Section 13 Docker Compose YAML Anchors structure fix - Moved x-relayer-common to top-level outside services block, added healthcheck/networks, applied correct YAML Anchors syntax |
| 11.4 | 2025-12-15 | Section 5.5 Health Check API response schema fix - Phase 1 services only (relay-api, oz-relayer-pool, redis), Phase 2+ extended schema separation (oz-monitor, mysql added), oz-relayer-pool status aggregation logic description added |
| 11.3 | 2025-12-15 | Section 11.3 OZ Relayer config file path fix - Changed nested directory structure to flat file structure (prd.txt, Docker Compose consistency), added Docker volume mount note |
| 11.2 | 2025-12-15 | Docker Compose YAML Anchors pattern applied - Multi-Relayer Pool config duplication minimized, deploy.replicas non-usage reason explained (individual Private Key required) |
| 11.1 | 2025-12-15 | Section 9.1 API Key authentication added - Phase 1 single environment variable method (RELAY_API_KEY), Phase 2+ extension plan specified |
| 11.0 | 2025-12-15 | SPEC-INFRA-001 Docker structure sync - Consolidated to docker/ directory, multi-stage build (Dockerfile.packages), .env removed, Hardhat Node included, Redis 8.0-alpine (AOF), Named Volume (msq-relayer-redis-data), OZ Relayer RPC_URL/REDIS_HOST/REDIS_PORT env vars, Read-only volume mount (:ro), Section 13 v5.0 |
| 10.0 | 2025-12-15 | MySQL/Prisma moved to Phase 2+ - Phase 1 uses OZ Relayer + Redis only, no DB, mysql removed from Docker Compose |
| 9.0 | 2025-12-15 | TX History, Webhook Handler moved to Phase 2+ - Phase 1 uses status polling method, MySQL/Webhook implemented in Phase 2+ |
| 8.0 | 2025-12-15 | Rate Limiting, Quota Manager completely removed - Phase 1 keeps Auth + Relay features only |
| 7.0 | 2025-12-15 | Phase 2 redesign - SDK removed (replaced with API documentation), Queue System added (QUEUE_PROVIDER pattern: Redis/BullMQ, AWS SQS) |
| 6.2 | 2025-12-15 | Docker Build strategy finalized - Per-package Dockerfile approach adopted, Docker Compose build context/dockerfile config specified |
| 6.1 | 2025-12-15 | Multi-Relayer Pool config added - Section 11.3 (Pool configuration, Load Balancing, Scaling), Docker Compose v4.0 (Multi-Relayer Profile support) |
| 6.0 | 2025-12-15 | Gasless TX included in Phase 1 - Gasless API/SDK moved to Phase 1, EIP-712 verification Phase 1, OZ Monitor/Policy/Quota remains Phase 2+ |
| 5.0 | 2025-12-14 | Reorganized around Phase 1 - Implementation scope table added, OZ Monitor/Gasless/Policy marked as Phase 2+ |
| 4.0 | 2025-12-13 | Complete rewrite from B2B Infrastructure perspective - SDK examples changed to Client Service backend integration patterns, Gasless TX flow changed to Server-to-Server |
| 3.0 | 2025-12-13 | Complete redesign based on OZ open-source (Relayer v1.3.0, Monitor v1.1.0), BullMQ → Redis (OZ native), OZ configuration guide added |
| 2.3 | 2025-12-12 | Document consistency improvements, related document references added |
| 2.2 | 2025-12-12 | Examples Package section added |
| 2.1 | 2025-12-12 | Client SDK reorganized to OZ Defender SDK compatible pattern |
| 2.0 | 2025-12-12 | Initial tech.md creation |

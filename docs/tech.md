# Solo Relayer Service - Technical Document

## Document Information
- **Version**: 12.8
- **Last Updated**: 2026-01-02
- **Status**: Phase 2 Complete (Phase 1 + TX History + 3-Tier Lookup + Webhook Handler + Redis L1 Cache + MySQL L2 Storage)

> **Note**: This document covers technical implementation details (HOW).
> - Business requirements (WHAT/WHY): [product.md](./product.md)
> - System architecture (WHERE): [structure.md](./structure.md)

> **Note**: Solo Relayer Service is a **B2B Infrastructure**. All API usage patterns in this document are written based on Client Services (Payment system, Airdrop system, NFT service, etc.) calling the Relayer API. API documentation is available at Swagger UI (`/api/docs`).

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
| **Phase 1** | OZ Relayer (3x instances), Redis, Nginx Load Balancer, NestJS (Auth, Direct TX API, Gasless TX, EIP-712 Verification, Health, Status Polling), ERC2771Forwarder | **Complete** |
| **Phase 2** | TX History (MySQL), Webhook Handler, 3-Tier Lookup, Redis L1 Cache, MySQL L2 Storage, Client Notifications | **Complete** |
| **Phase 3+** | Queue System (AWS SQS + LocalStack), OZ Monitor, Policy Engine | Planned |

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
pragma solidity 0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract SampleToken is ERC20, ERC20Burnable, ERC20Pausable, Ownable, ERC2771Context {
    constructor(address forwarder)
        ERC20("Sample Token", "SMPL")
        Ownable(msg.sender)
        ERC2771Context(forwarder)
    {
        uint256 initialSupply = 1000000 * 10 ** decimals();
        _mint(msg.sender, initialSupply);
    }

    // ERC2771Context overrides - CRITICAL for meta-transaction support
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }

    // ERC20Pausable override
    function _update(address from, address to, uint256 amount) internal override(ERC20, ERC20Pausable) {
        super._update(from, to, amount);
    }

    // Owner functions
    function pause() public onlyOwner { _pause(); }
    function unpause() public onlyOwner { _unpause(); }
    function mint(address to, uint256 amount) public onlyOwner { _mint(to, amount); }
}
```

**Purpose**: Demonstrates gasless token transfer pattern with meta-transaction support.

**Key Implementation Notes**:
- Overrides must specify `Context` (not `ERC20`) and `ERC2771Context` for proper diamond inheritance
- `_msgData()` override is required in addition to `_msgSender()` for complete ERC2771 support
- The contract includes ERC20Burnable, ERC20Pausable, and Ownable for production-ready features

#### SampleNFT.sol (ERC721 + ERC2771Context)

```solidity
pragma solidity 0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract SampleNFT is ERC721, ERC721Burnable, ERC721Enumerable, Ownable, ERC2771Context {
    uint256 private _nextTokenId;

    constructor(address forwarder)
        ERC721("Sample NFT", "SNFT")
        Ownable(msg.sender)
        ERC2771Context(forwarder)
    {
        _nextTokenId = 1;
    }

    function mint(address to) public onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        return tokenId;
    }

    // ERC2771Context overrides
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }

    // ERC721Enumerable overrides
    function _update(address to, uint256 tokenId, address auth)
        internal override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 amount)
        internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, amount);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
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
pnpm verify --contract <CONTRACT_PATH> <CONTRACT_ADDRESS> "<CONSTRUCTOR_ARGS>"
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
| Database | MySQL 8.0 Container (Phase 2) | AWS RDS MySQL (Multi-AZ) |
| Cache/Queue | Redis 8.0 Container | AWS ElastiCache Cluster |
| Secrets | .env / K8s Secret | AWS Secrets Manager |
| Load Balancer | - | AWS ALB / Nginx Ingress |
| Monitoring | Prometheus + Grafana | Prometheus + Grafana |
| Logging | Console | CloudWatch / Loki |

### 5.1 Redis Module (L1 Cache - Phase 2)

**Purpose**: Transaction status caching with 3-Tier Lookup integration.

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Client | ioredis | 5.x | Production-ready Redis client for Node.js |
| Container | Redis | 8.0-alpine | Official Redis image, lightweight |
| TTL Strategy | 600 seconds | - | 10-minute cache for transaction status |

**Module Structure**:
```
packages/relay-api/src/redis/
├── redis.module.ts      # NestJS module with ioredis provider
├── redis.service.ts     # Cache operations (get/set/del/exists)
└── redis.service.spec.ts # Unit tests
```

**Key Features**:
- Generic `get<T>()` / `set<T>()` with JSON serialization
- TTL support for automatic cache expiration
- Health check integration (`healthCheck()`)
- Graceful connection handling (`OnModuleDestroy`)

**Environment Variables**:
```bash
REDIS_URL=redis://localhost:6379  # Redis connection URL
```

### 5.2 MySQL Module (L2 Storage - Phase 2)

**Purpose**: Persistent transaction history storage with Prisma ORM.

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| ORM | Prisma | 5.x | Type-safe database access, migrations |
| Database | MySQL | 8.0 | Production-ready, ACID compliant |
| Container Port | 3307:3306 | - | External 3307, internal 3306 |

**Module Structure**:
```
packages/relay-api/src/prisma/
├── prisma.module.ts     # Global module export
├── prisma.service.ts    # PrismaClient extension with lifecycle hooks
└── prisma.service.spec.ts # Unit tests
```

**Schema** (`packages/relay-api/prisma/schema.prisma`):
```prisma
model Transaction {
  id          String    @id @default(uuid())
  hash        String?   @unique
  status      String    // pending, sent, submitted, inmempool, mined, confirmed, failed
  from        String?
  to          String?
  value       String?
  data        String?   @db.Text
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  confirmedAt DateTime?

  @@index([status])
  @@index([hash])
  @@index([createdAt])
  @@map("transactions")
}
```

**Environment Variables**:
```bash
DATABASE_URL=mysql://root:pass@localhost:3307/solo_relayer  # MySQL connection string
```

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
  name: this.configService.get<string>("FORWARDER_NAME") || "SoloForwarder",
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

### 5.4 Transaction Status Polling API (SPEC-STATUS-001, SPEC-WEBHOOK-001)

**Overview**: Transaction Status Polling API enables clients to query the status of submitted transactions. Phase 2 implements a 3-Tier Lookup system with Redis L1 cache and MySQL L2 storage for optimized performance.

#### 5.4.1 3-Tier Lookup Architecture (Phase 2)

```
Client Service
    │
    └─→ GET /api/v1/relay/status/:txId  (Query status)
            │
            └─→ StatusService.getTransactionStatus()
                │
                ├─→ Tier 1: Redis (L1 Cache) ~1-5ms
                │   └─→ Return if terminal status (confirmed/mined/failed/cancelled)
                │
                ├─→ Tier 2: MySQL (L2 Storage) ~50ms
                │   └─→ Return if terminal status, backfill Redis
                │
                └─→ Tier 3: OZ Relayer API ~200ms
                    └─→ Return and store in both Redis + MySQL (Write-through)
```

**Design Principles**:
- **Terminal Status Optimization**: Only return cached data for terminal statuses (confirmed, mined, failed, cancelled)
- **Non-terminal Status Refresh**: Always fetch fresh data from OZ Relayer for pending/submitted statuses
- **Write-through Caching**: Updates propagate to both Redis and MySQL simultaneously
- **Graceful Degradation**: Redis failures don't break the lookup chain

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

### 5.5 Webhook Handler (SPEC-WEBHOOK-001 - Phase 2)

**Overview**: Webhook Handler receives transaction status updates from OZ Relayer and updates both Redis (L1) and MySQL (L2) storage.

#### 5.5.1 Module Structure

```
packages/relay-api/src/webhooks/
├── guards/
│   ├── webhook-signature.guard.ts      # HMAC-SHA256 signature verification
│   └── webhook-signature.guard.spec.ts # Guard unit tests
├── dto/
│   └── oz-relayer-webhook.dto.ts       # Webhook payload DTOs
├── webhooks.controller.ts               # POST /webhooks/oz-relayer endpoint
├── webhooks.service.ts                  # Webhook processing logic
├── notification.service.ts              # Client notification service
├── webhooks.module.ts                   # NestJS module registration
├── webhooks.controller.spec.ts          # Controller tests
└── webhooks.service.spec.ts             # Service tests
```

#### 5.5.2 Webhook Endpoint

```yaml
POST /api/v1/webhooks/oz-relayer
Content-Type: application/json
X-OZ-Signature: sha256={HMAC-SHA256 signature}

Request Body:
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "confirmed",
  "hash": "0xabcd1234...",
  "from": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "to": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "value": "0",
  "createdAt": "2025-12-19T10:00:00Z",
  "confirmedAt": "2025-12-19T10:05:00Z"
}

Response (200 OK):
{
  "success": true,
  "message": "Webhook processed successfully",
  "transactionId": "550e8400-e29b-41d4-a716-446655440000"
}

Error Responses:
- 400 Bad Request: Invalid payload format
- 401 Unauthorized: Invalid or missing X-OZ-Signature header
- 500 Internal Server Error: Database update failure
```

#### 5.5.3 Webhook Processing Flow

```
OZ Relayer → POST /api/v1/webhooks/oz-relayer
    │
    ├─→ WebhookSignatureGuard (HMAC-SHA256 verification)
    │
    └─→ WebhooksService.handleWebhook()
        │
        ├─→ Step 1: Update MySQL (L2 - permanent storage)
        │   └─→ Upsert transaction record
        │
        ├─→ Step 2: Update Redis (L1 - cache) with TTL reset
        │   └─→ Set with 600s TTL (graceful degradation)
        │
        └─→ Step 3: Send notification to client (non-blocking)
            └─→ NotificationService.notify() - fire and forget
```

#### 5.5.4 Signature Verification

**HMAC-SHA256 Guard**:
```typescript
// X-OZ-Signature header format: sha256={signature}
// Signature computed: HMAC-SHA256(request body, WEBHOOK_SIGNING_KEY)

const expectedSignature = crypto
  .createHmac('sha256', signingKey)
  .update(JSON.stringify(body))
  .digest('hex');
```

**Environment Variables**:
```bash
WEBHOOK_SIGNING_KEY=your-secret-signing-key  # HMAC-SHA256 signing key
CLIENT_WEBHOOK_URL=https://client.example.com/webhooks  # Client notification endpoint
```

#### 5.5.5 Write-Through Caching Pattern

The webhook handler implements write-through caching:

1. **Direct Service / Gasless Service**: Stores transaction in Redis + MySQL after OZ Relayer submission
2. **Webhook Handler**: Updates both Redis + MySQL when OZ Relayer sends status updates
3. **Status Service**: Reads from 3-tier lookup, backfills Redis when reading from MySQL

This ensures data consistency across all storage layers.

### 5.6 Health Check API

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
    - solo-relayer-network

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
      - solo-relayer-network

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
      - solo-relayer-redis-data:/data
    networks:
      - solo-relayer-network

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
      - solo-relayer-network

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
  solo-relayer-network:
    driver: bridge

volumes:
  solo-relayer-redis-data:
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

> **Architecture**: AWS SQS Standard Queue with LocalStack for local development. No QUEUE_PROVIDER pattern - SQS is the unified queue solution across all environments.

### 16.1 Queue Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NestJS API Gateway                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                      Queue Module                              │  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐   │  │
│  │  │ QueueService│────│ SqsAdapter  │────│ AWS SQS         │   │  │
│  │  └─────────────┘    └─────────────┘    │ (LocalStack Dev)│   │  │
│  │                                         └─────────────────┘   │  │
│  │  ┌─────────────┐    ┌─────────────┐                          │  │
│  │  │ JobService  │────│ JobController│ GET /relay/job/:jobId   │  │
│  │  └─────────────┘    └─────────────┘                          │  │
│  │                                                               │  │
│  │  ┌───────────────────────────────────────────────────────┐   │  │
│  │  │                  QueueConsumer                         │   │  │
│  │  │  Long-polling (20s) → Process → Delete                 │   │  │
│  │  └───────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Nginx Load Balancer                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  upstream oz-relayers { least_conn; }                        │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │   │
│  │  │ oz-relayer-1│ │ oz-relayer-2│ │ oz-relayer-3│            │   │
│  │  │ (Port 8081) │ │ (Port 8082) │ │ (Port 8083) │            │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 16.2 Environment Comparison

| Config | Local Dev | Staging | Production |
|--------|-----------|---------|------------|
| Queue Service | LocalStack SQS | AWS SQS | AWS SQS |
| Load Balancer | Nginx Container | Nginx/ALB | AWS ALB |
| Relayers | 3x Docker | 3-5x K8s | Auto-scale K8s |
| Endpoint | `http://localstack:4566` | AWS endpoint | AWS endpoint |

### 16.3 SQS Queue Design

| Item | Value | Rationale |
|------|-------|-----------|
| Queue Type | Standard Queue | High throughput, transaction order-independent |
| DLQ | relay-tx-dlq | Failed message isolation |
| Max Receive Count | 3 | Retry limit before DLQ |
| Visibility Timeout | 30 seconds | Processing time allowance |
| Long Polling | 20 seconds | Reduce empty responses |
| AWS Region | ap-northeast-2 | Match production environment |

### 16.4 Environment Configuration

```bash
# .env file

# Queue Feature Flag
QUEUE_ENABLED=true

# AWS Configuration
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=test                    # LocalStack default
AWS_SECRET_ACCESS_KEY=test                # LocalStack default

# SQS Queue URLs
SQS_QUEUE_URL=http://localstack:4566/000000000000/relay-tx-queue
SQS_DLQ_URL=http://localstack:4566/000000000000/relay-tx-dlq

# LocalStack Endpoint (local dev only)
LOCALSTACK_ENDPOINT=http://localstack:4566

# Consumer Settings
SQS_VISIBILITY_TIMEOUT=30
SQS_WAIT_TIME_SECONDS=20
SQS_MAX_RETRIES=3

# OZ Relayer URL (via Nginx LB)
OZ_RELAYER_URL=http://oz-relayer-lb:80
```

### 16.5 Queue Module Structure

```
packages/relay-api/src/
└── queue/                              # Queue Module
    ├── queue.module.ts                 # NestJS DynamicModule
    ├── queue.service.ts                # Enqueue operations
    ├── queue.consumer.ts               # Long-polling consumer
    ├── sqs/
    │   ├── sqs.adapter.ts              # AWS SDK SQS wrapper
    │   ├── sqs.config.ts               # Configuration types
    │   └── sqs.health.ts               # Health indicator
    ├── job/
    │   ├── job.controller.ts           # GET /api/v1/relay/job/:jobId
    │   └── job.service.ts              # In-memory job tracking
    ├── dto/
    │   ├── queue-job.dto.ts            # Job status response
    │   └── enqueue-response.dto.ts     # Enqueue response
    └── interfaces/
        ├── queue-message.interface.ts  # Message types
        └── queue-job.interface.ts      # Job status types
```

### 16.6 Queue Interfaces

```typescript
// packages/relay-api/src/queue/interfaces/queue-message.interface.ts
export interface QueueMessage {
  jobId: string;
  type: 'direct' | 'gasless';
  payload: DirectTxRequest | GaslessTxRequest;
  priority?: 'high' | 'normal' | 'low';
  metadata?: Record<string, string>;
  createdAt: string;
}

// packages/relay-api/src/queue/interfaces/queue-job.interface.ts
export interface QueueJob {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  txId?: string;
  txHash?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
```

### 16.7 SQS Adapter Implementation

```typescript
// packages/relay-api/src/queue/sqs/sqs.adapter.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { QueueMessage } from '../interfaces/queue-message.interface';

@Injectable()
export class SqsAdapter {
  private client: SQSClient;

  constructor(private configService: ConfigService) {
    this.client = new SQSClient({
      region: this.configService.get('AWS_REGION', 'ap-northeast-2'),
      endpoint: this.configService.get('LOCALSTACK_ENDPOINT'), // undefined in prod
      credentials: {
        accessKeyId: this.configService.get('AWS_ACCESS_KEY_ID', 'test'),
        secretAccessKey: this.configService.get('AWS_SECRET_ACCESS_KEY', 'test'),
      },
    });
  }

  async sendMessage(queueUrl: string, message: QueueMessage): Promise<string> {
    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        jobId: { DataType: 'String', StringValue: message.jobId },
        type: { DataType: 'String', StringValue: message.type },
      },
    });
    const result = await this.client.send(command);
    return result.MessageId!;
  }

  async receiveMessages(queueUrl: string, maxMessages = 10): Promise<Message[]> {
    const command = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: this.configService.get('SQS_WAIT_TIME_SECONDS', 20),
      VisibilityTimeout: this.configService.get('SQS_VISIBILITY_TIMEOUT', 30),
      MessageAttributeNames: ['All'],
    });
    const result = await this.client.send(command);
    return result.Messages || [];
  }

  async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    });
    await this.client.send(command);
  }
}
```

### 16.8 API Changes (Queue Mode)

API responses change when Queue system is enabled (`QUEUE_ENABLED=true`):

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
  "status": "queued"
}

# Job status query
GET /api/v1/relay/job/{jobId}
Response:
{
  "jobId": "uuid",
  "status": "completed",
  "txId": "uuid",
  "txHash": "0x..."
}

# Queue disabled response
GET /api/v1/relay/job/{jobId}
Response (503 Service Unavailable):
{
  "error": "Queue system is not enabled"
}
```

### 16.9 Docker Compose Integration

```yaml
# docker/docker-compose.yaml

services:
  localstack:
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      SERVICES: sqs
      AWS_DEFAULT_REGION: ap-northeast-2
    volumes:
      - ./scripts/init-localstack.sh:/etc/localstack/init/ready.d/init-sqs.sh:ro
      - localstack-data:/var/lib/localstack
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - solo-relayer-network

  relay-api:
    depends_on:
      localstack:
        condition: service_healthy
      oz-relayer-lb:
        condition: service_healthy
    environment:
      QUEUE_ENABLED: "true"
      AWS_REGION: ap-northeast-2
      SQS_QUEUE_URL: http://localstack:4566/000000000000/relay-tx-queue
      SQS_DLQ_URL: http://localstack:4566/000000000000/relay-tx-dlq
      LOCALSTACK_ENDPOINT: http://localstack:4566
      OZ_RELAYER_URL: http://oz-relayer-lb:80

volumes:
  localstack-data:
```

### 16.10 LocalStack Initialization Script

```bash
#!/bin/bash
# docker/scripts/init-localstack.sh

# Create main queue with DLQ redrive policy
awslocal sqs create-queue --queue-name relay-tx-dlq

awslocal sqs create-queue \
  --queue-name relay-tx-queue \
  --attributes '{
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:ap-northeast-2:000000000000:relay-tx-dlq\",\"maxReceiveCount\":\"3\"}"
  }'

echo "SQS queues created successfully"
awslocal sqs list-queues
```

### 16.11 Backward Compatibility

| QUEUE_ENABLED | Behavior |
|---------------|----------|
| `false` (default) | Phase 1 behavior - immediate processing, 200 OK response |
| `true` | Queue mode - async processing, 202 Accepted + jobId response |

Queue disabled state maintains full Phase 1 API compatibility. No breaking changes for existing clients.

### 16.12 Dependencies

```json
// packages/relay-api/package.json
{
  "dependencies": {
    "@aws-sdk/client-sqs": "^3.700.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/uuid": "^10.0.0"
  }
}
```

> **Note**: Redis is retained for OZ Relayer internal queue only. Application-level queue uses AWS SQS exclusively.

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

## 8. E2E Test Infrastructure (SPEC-E2E-001)

### 8.1 Overview

**Status**: Phase 1 Complete (29 E2E tests implemented)

E2E (End-to-End) tests verify complete API flows using Mock OZ Relayer responses (no actual blockchain calls). This ensures all API endpoints function correctly in integrated scenarios.

**Key Features**:
- 29 test cases across 5 test suites
- Mock OZ Relayer HTTP responses (Jest Spy)
- EIP-712 signature generation and verification
- Complete payment flow testing
- < 30 seconds execution time

### 8.2 Test Architecture

```
E2E Test Suite
├── supertest (HTTP endpoint testing)
├── @nestjs/testing (NestJS Test Module)
├── ethers.js (EIP-712 signature utility)
└── Jest Spy (OZ Relayer Mock responses)
```

**Test Execution Flow**:

```
1. Initialize NestJS Test Module
   └─ Load all modules (RelayModule, AuthModule)
   └─ Mock OZ Relayer HTTP client with Jest Spy

2. Execute 5 Test Suites (29 tests total)
   ├─ direct.e2e-spec.ts (8 tests)
   │  └─ Valid/invalid requests, authentication, error handling
   ├─ gasless.e2e-spec.ts (10 tests)
   │  └─ EIP-712 signature verification, nonce management
   ├─ status.e2e-spec.ts (6 tests)
   │  └─ Status query, error conditions
   ├─ health.e2e-spec.ts (3 tests)
   │  └─ Service health status, public endpoint
   └─ payment-integration.e2e-spec.ts (2 tests)
       └─ Complete payment flows (batch, gasless)

3. Verify Results
   └─ All 29 tests pass
   └─ No unit test regression
   └─ No external API calls made (Mock only)
```

### 8.3 Test Suite Details

#### 8.3.1 Direct Transaction Tests (8 tests)

**Endpoint**: `POST /api/v1/relay/direct`

| Test Case | Condition | Expected Result |
|-----------|-----------|-----------------|
| TC-E2E-D001 | Valid request | 202 Accepted |
| TC-E2E-D002 | Minimal fields | 202 Accepted |
| TC-E2E-D003 | Invalid address | 400 Bad Request |
| TC-E2E-D004 | Invalid hex data | 400 Bad Request |
| TC-E2E-D005 | Invalid speed enum | 400 Bad Request |
| TC-E2E-D006 | Missing API key | 401 Unauthorized |
| TC-E2E-D007 | Invalid API key | 401 Unauthorized |
| TC-E2E-D008 | OZ Relayer down | 503 Service Unavailable |

#### 8.3.2 Gasless Transaction Tests (10 tests)

**Endpoints**:
- `GET /api/v1/relay/gasless/nonce/{address}`
- `POST /api/v1/relay/gasless`

**Signature Verification Flow**:
1. Query nonce (GET /api/v1/relay/gasless/nonce/{address})
2. Create ForwardRequest with nonce
3. Sign with EIP-712 using ethers.js
4. Submit Gasless TX (POST /api/v1/relay/gasless)
5. Verify signature with SignatureVerifierService

**EIP-712 Domain**:
```typescript
const EIP712_DOMAIN = {
  name: 'ERC2771Forwarder',
  version: '1',
  chainId: 31337,
  verifyingContract: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9'
};
```

#### 8.3.3 Status Polling Tests (6 tests)

**Endpoint**: `GET /api/v1/relay/status/{txId}`

| Test Case | Query | Expected Response |
|-----------|-------|-------------------|
| TC-E2E-S001 | pending txId | 200 + status: pending |
| TC-E2E-S002 | confirmed txId | 200 + hash + confirmedAt |
| TC-E2E-S003 | failed txId | 200 + status: failed |
| TC-E2E-S004 | invalid UUID | 400 Bad Request |
| TC-E2E-S005 | OZ Relayer down | 503 Service Unavailable |
| TC-E2E-S006 | non-existent txId | 404 Not Found |

#### 8.3.4 Health Check Tests (3 tests)

**Endpoint**: `GET /api/v1/health` (Public, no API key required)

| Test Case | Condition | Expected Result |
|-----------|-----------|-----------------|
| TC-E2E-H001 | All services healthy | 200 + status: ok |
| TC-E2E-H002 | Public endpoint | 200 (no API key) |
| TC-E2E-H003 | Relayer pool down | 503 Service Unavailable |

#### 8.3.5 Payment Integration Tests (2 tests)

**Test 1**: Batch token transfer (3 Direct TXs in parallel)
**Test 2**: Complete gasless payment flow (4 steps)

### 8.4 Test Files and Utilities

#### Directory Structure

```
packages/relay-api/test/
├── e2e/                             # E2E test suite
│   ├── direct.e2e-spec.ts          # Direct TX tests (8)
│   ├── gasless.e2e-spec.ts         # Gasless TX tests (10)
│   ├── status.e2e-spec.ts          # Status Polling tests (6)
│   ├── health.e2e-spec.ts          # Health Check tests (3)
│   └── payment-integration.e2e-spec.ts  # Payment Flow tests (2)
├── fixtures/                        # Test data
│   ├── test-wallets.ts             # Hardhat accounts
│   ├── test-config.ts              # Test configuration
│   └── mock-responses.ts           # OZ Relayer mock responses
├── utils/                           # Test utilities
│   ├── eip712-signer.ts            # EIP-712 signature utility
│   ├── encoding.ts                 # ERC-20 encoding
│   └── test-app.factory.ts         # NestJS app factory
└── jest-e2e.json                    # Jest E2E configuration
```

### 8.5 Running E2E Tests

```bash
# Run all E2E tests
pnpm --filter relay-api test:e2e

# Expected output: 29/29 tests passing (~12 seconds)

# Run with coverage
pnpm --filter relay-api test:e2e:cov

# Run specific test suite
pnpm --filter relay-api test:e2e -- direct.e2e-spec

# Run in watch mode
pnpm --filter relay-api test:e2e --watch
```

**Test Results**:
```
Test Suites: 5 passed, 5 total
Tests:       29 passed, 29 total
Time:        ~12.5 seconds
```

### 8.6 Mock OZ Relayer Strategy

E2E tests use Jest Spy to mock OZ Relayer HTTP responses (no actual blockchain calls):
- Fast execution (no network latency)
- Reliable (no external service dependency)
- Isolated (API layer only)
- Repeatable (same response every time)

### 8.7 Quality Metrics

**Test Coverage**:
- 29 test cases covering all 5 API endpoints
- 100% pass rate (0 failures)
- Execution time: < 30 seconds

**Quality Gates**:
- All 29 E2E tests pass
- No unit test regression
- No TypeScript errors
- No ESLint warnings

### 8.8 Related Specifications

| Document | Purpose |
|----------|---------|
| [SPEC-E2E-001](../.moai/specs/SPEC-E2E-001/spec.md) | E2E Test Infrastructure Specification |
| [SPEC-E2E-001 Acceptance](../.moai/specs/SPEC-E2E-001/acceptance.md) | Acceptance Criteria and Test Scenarios |
| [docs/TESTING.md](./TESTING.md) | Comprehensive Testing Guide |

### 8.9 Transaction Lifecycle Tests (SPEC-TEST-001)

Real blockchain transaction verification tests that execute actual transactions through the complete flow.

#### 8.9.1 Architecture

```
API Gateway → OZ Relayer Pool → Hardhat Node
     ↓              ↓              ↓
  Submit TX    Relay to Chain   Mine Block
     ↓              ↓              ↓
  Poll Status   Return Hash    Confirm TX
```

#### 8.9.2 Key Components

| Component | File | Purpose |
|-----------|------|---------|
| Polling | `packages/integration-tests/src/helpers/polling.ts` | Exponential backoff with HARDHAT_POLLING_CONFIG |
| Contracts | `packages/integration-tests/src/helpers/contracts.ts` | ABI definitions, verification utilities |
| Tests | `packages/integration-tests/tests/transaction-lifecycle.integration-spec.ts` | 9 test cases |

#### 8.9.3 Test Categories

| Category | Test IDs | Description |
|----------|----------|-------------|
| Contract Verification | TC-TXL-001~004 | Deployment and configuration checks |
| Direct Transaction | TC-TXL-100~101 | Standard TX lifecycle |
| Gasless Transaction | TC-TXL-200~202 | EIP-712 meta-transaction flow |

#### 8.9.4 Environment Variables

```env
FORWARDER_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
SAMPLE_TOKEN_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
SAMPLE_NFT_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

#### 8.9.5 Execution

```bash
# Prerequisites: Docker Compose stack running
docker compose -f docker/docker-compose.yaml up -d

# Run lifecycle tests only
pnpm --filter @solo-relayer/integration-tests test:lifecycle
```

#### 8.9.6 Difference from E2E Tests

| Aspect | E2E Tests (SPEC-E2E-001) | Lifecycle Tests (SPEC-TEST-001) |
|--------|--------------------------|----------------------------------|
| Blockchain | Mock | Real (Hardhat) |
| OZ Relayer | Mock | Real |
| Transaction | Simulated | Actually mined |
| Purpose | API validation | Transaction verification |

---

## Related Document References

| Document | Description | Path |
|----------|-------------|------|
| Product Requirements | Business requirements, milestones, success metrics | `./product.md` |
| System Architecture | Architecture, directory structure, data flow | `./structure.md` |
| Task Master PRD | PRD for task management | `.taskmaster/docs/prd.txt` |
| Testing Guide | Unit and E2E testing documentation | `./TESTING.md` |

---

## HISTORY

| Version | Date | Changes |
|---------|------|---------|
| 12.8 | 2026-01-02 | SPEC-WEBHOOK-001 Phase 2 Complete - Added Section 5.1 Redis Module (L1 Cache), Section 5.2 MySQL Module (L2 Storage with Prisma), Section 5.5 Webhook Handler, Updated Section 5.4 with 3-Tier Lookup architecture, Updated Implementation Scope table, Added environment variables (DATABASE_URL, REDIS_URL, WEBHOOK_SIGNING_KEY, CLIENT_WEBHOOK_URL) |
| 12.7 | 2025-12-30 | Queue System architecture update - Complete Section 16 rewrite: changed from QUEUE_PROVIDER pattern (Redis+BullMQ/SQS) to AWS SQS-only with LocalStack for local dev, added Nginx LB multi-relayer architecture diagram, updated environment configuration, added SQS adapter implementation, LocalStack init script, Docker Compose integration |
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
| 11.0 | 2025-12-15 | SPEC-INFRA-001 Docker structure sync - Consolidated to docker/ directory, multi-stage build (Dockerfile.packages), .env removed, Hardhat Node included, Redis 8.0-alpine (AOF), Named Volume (solo-relayer-redis-data), OZ Relayer RPC_URL/REDIS_HOST/REDIS_PORT env vars, Read-only volume mount (:ro), Section 13 v5.0 |
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

---

## 5. Relayer Discovery Service (SPEC-DISCOVERY-001)

### 5.1 Architecture & Design

**목적**: OZ Relayer 상태를 동적으로 모니터링하고, 활성 Relayer 목록을 Redis에서 관리하는 마이크로서비스.

**핵심 기능**:
- 주기적 헬스 체크 (10초 간격, 설정 가능)
- Bearer 토큰 인증 (OZ Relayer API Key)
- Redis Set을 통한 활성 Relayer 관리 (`relayer:active`)
- REST API를 통한 상태 조회
- Queue Consumer 동적 Relayer 선택

**아키텍처**:
```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Relayer          │     │ Relayer          │     │ Relayer          │
│ Discovery        │────▶│ Discovery        │────▶│ Discovery        │
│ Service          │     │ Service          │     │ Service          │
└──────────────────┘     └──────────────────┘     └──────────────────┘
       │                         │                         │
       └─────────────┬───────────┴─────────────┬───────────┘
                     ▼
          ┌──────────────────────┐
          │ Health Check         │
          │ (Bearer Token Auth)  │
          │ /api/v1/relayers     │
          └──────────────────────┘
                     │
       ┌─────────────┴──────────────┐
       ▼                            ▼
   ┌────────────┐            ┌──────────────┐
   │ Redis Set  │            │ Webhook      │
   │ active     │            │ (oz-relayer) │
   │ relayers   │            └──────────────┘
   └────────────┘
       │
       └──▶ Queue Consumer (동적 Relayer 선택)
```

### 5.2 Health Check 구현

**Health Check 흐름**:
```typescript
// 1. 모든 Relayer ID 생성
const relayerIds = generateRelayerIds(); // oz-relayer-0, oz-relayer-1, oz-relayer-2

// 2. 병렬 헬스 체크
const results = await Promise.allSettled(
  relayerIds.map(id => checkRelayerHealth(id))
);

// 3. 결과 처리
for (const relayerId of relayerIds) {
  if (healthy) {
    await redisService.sadd("relayer:active", relayerId);
  } else {
    await redisService.srem("relayer:active", relayerId);
  }
}
```

**헬스 체크 엔드포인트**:
- URL: `http://{relayerId}:8080/api/v1/relayers`
- Method: GET
- Headers: `Authorization: Bearer {OZ_RELAYER_API_KEY}`
- Timeout: 500ms (설정 가능)
- Success: HTTP 200
- Failure: Timeout, Connection refused, HTTP !200

### 5.3 Redis 통합

**Key 구조**:
```
relayer:active = Set {
  "oz-relayer-0",
  "oz-relayer-1",
  "oz-relayer-2"
}
```

**Queue Consumer 사용**:
```typescript
// Queue Consumer는 Redis에서 활성 Relayer 조회
const activeRelayers = await redisService.smembers("relayer:active");
// ['oz-relayer-0', 'oz-relayer-1', 'oz-relayer-2']

// 동적 Relayer 선택 (라운드로빈 또는 부하 분산)
const selectedRelayer = selectRelayer(activeRelayers);
```

**Fallback 메커니즘**:
- Redis 이용 불가 시: `OZ_RELAYER_URLS` 환경변수 사용
- `OZ_RELAYER_URL` (단일 Relayer, 레거시)

### 5.4 API 엔드포인트

**GET /status**

상태 조회 및 활성 Relayer 목록 반환.

```bash
curl http://localhost:3001/status
```

**응답**:
```json
{
  "service": "relayer-discovery",
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2026-01-20T04:25:38.876Z",
  "activeRelayers": [
    {
      "id": "oz-relayer-0",
      "status": "healthy",
      "lastCheckTimestamp": "2026-01-20T04:25:30.951Z",
      "url": "http://oz-relayer-0:8080"
    }
  ],
  "totalConfigured": 3,
  "totalActive": 3,
  "healthCheckInterval": 10000
}
```

**상태 해석**:
- `healthy`: 모든 Relayer 정상 (totalActive >= totalConfigured)
- `degraded`: 일부 Relayer 정상 (totalActive > 0)
- `unhealthy`: 모든 Relayer 다운 (totalActive === 0)

### 5.5 설정 & 배포

**환경 변수**:

| 변수 | 기본값 | 설명 |
|------|-------|------|
| `PORT` | `3001` | 서비스 포트 |
| `RELAYER_COUNT` | `3` | 모니터링할 Relayer 수 |
| `RELAYER_PORT` | `8080` | Relayer HTTP 포트 |
| `OZ_RELAYER_API_KEY` | - | Bearer 토큰 (헬스 체크 인증) |
| `HEALTH_CHECK_INTERVAL_MS` | `10000` | 헬스 체크 간격 (ms) |
| `HEALTH_CHECK_TIMEOUT_MS` | `500` | 헬스 체크 타임아웃 (ms) |
| `REDIS_HOST` | `redis` | Redis 호스트명 |
| `REDIS_PORT` | `6379` | Redis 포트 |

**Docker Compose 설정**:

```yaml
relayer-discovery:
  build:
    context: ..
    dockerfile: docker/Dockerfile.packages
    target: relayer-discovery
  ports:
    - "3001:3001"
  depends_on:
    - redis
    - oz-relayer-0
    - oz-relayer-1
    - oz-relayer-2
  environment:
    RELAYER_COUNT: 3
    RELAYER_PORT: 8080
    OZ_RELAYER_API_KEY: ${OZ_RELAYER_API_KEY}
    HEALTH_CHECK_INTERVAL_MS: 10000
    REDIS_HOST: redis
    REDIS_PORT: 6379
```

### 5.6 운영 & 문제 해결

**활성 Relayer 확인**:

```bash
# Redis에서 직접 확인
docker compose exec redis redis-cli SMEMBERS relayer:active

# Status API로 확인
curl http://localhost:3001/status | jq '.activeRelayers'
```

**문제 해결**:

| 증상 | 원인 | 해결 방법 |
|------|------|---------|
| `/status` 응답 없음 | 서비스 미실행 | `docker compose logs relayer-discovery` |
| `totalActive: 0` | 헬스 체크 실패 | Relayer 연결 확인, API Key 확인 |
| Timeout 오류 | 네트워크 지연 | `HEALTH_CHECK_TIMEOUT_MS` 증가 |
| Redis 연결 실패 | Redis 미실행 | `docker compose restart redis` |

**모니터링**:

```bash
# 주기적 상태 모니터링
watch -n 5 'curl -s http://localhost:3001/status | jq'

# 로그 모니터링 (실패 사항만)
docker compose logs -f relayer-discovery | grep -i "failed\|error"
```

---

# MSQ Relayer Service - Product Document

## Project Overview

### Project Name
**Blockchain Transaction Relayer System (MSQ Relayer Service)**

### Document Version
- **Version**: 12.5
- **Last Updated**: 2026-01-02
- **Status**: Phase 2 Complete (Phase 1 + TX History + 3-Tier Lookup + Webhook Handler)

### Related Documents
- [Technical Stack and API Spec](./tech.md)
  - [Section 4: Smart Contracts Technical Stack](./tech.md#4-smart-contracts-technical-stack) - Smart contracts specification
  - [Section 5.4: Transaction Status Polling API](./tech.md#54-transaction-status-polling-api-spec-status-001) - Status query endpoint specification
- [System Architecture](./structure.md)
  - [Section 4.4: packages/contracts](./structure.md#44-packagescontracts) - Contracts directory structure
- [Task Master PRD](../.taskmaster/docs/prd.txt)
- [SPEC-CONTRACTS-001](../.moai/specs/SPEC-CONTRACTS-001/spec.md) - Smart Contracts Specification (ERC2771Forwarder, Sample Contracts)
- [SPEC-PROXY-001](../.moai/specs/SPEC-PROXY-001/spec.md) - Nginx Load Balancer and Direct Transaction API
- [SPEC-STATUS-001](../.moai/specs/SPEC-STATUS-001/spec.md) - Transaction Status Polling API

---

## 1. Executive Summary

### 1.1 Background

As OpenZeppelin Defender service will be discontinued in July 2026, we are building a self-hosted **Blockchain Transaction Relayer System** using **OZ open-source (Relayer + Monitor)**.

### 1.2 Core Strategy

| Component | Version | Role |
|-----------|---------|------|
| **OZ Relayer** | v1.3.0 (Rust, Docker) | Transaction relay, Nonce management, Gas estimation, Retry logic |
| **OZ Monitor** | v1.1.0 (Rust, Docker) | Blockchain event monitoring, Balance alerts |
| **NestJS API Gateway** | 10.x | Authentication, Policy engine, API documentation (Swagger/OpenAPI) |

### 1.3 Core Features

**Phase 1**: ✅ Complete
| Feature | Description | Implementation |
|---------|-------------|----------------|
| **Direct Transaction** | Automated transaction execution | Using OZ Relayer |
| **Gasless Transaction** | User gas fee sponsorship (Payment system) | OZ Relayer + ERC2771Forwarder |
| **EIP-712 Signature Verification** | Type-safe signature verification | ethers.js v6 implementation |
| **Nonce Management** | User nonce query API | ERC2771Forwarder contract integration |
| **Multi-Relayer Pool** | Parallel transaction processing | Single OZ Relayer with Health monitoring |

**Phase 2+**:
| Feature | Description | Implementation |
|---------|-------------|----------------|
| **Queue System** | Async transaction processing with DLQ | AWS SQS + LocalStack (Local Dev) |
| **Policy Engine** | Contract/Method Whitelist, Blacklist | NestJS Policy Module |
| **Monitor Service** | Blockchain event monitoring | Using OZ Monitor |

### 1.4 Phase 1 Goals

**First Integration Target: Payment System**
- Token transfer/settlement processing via Direct TX
- User gas fee sponsorship payment via Gasless TX
- ERC2771Forwarder deployment and EIP-712 signature verification
- Production-level API Gateway implementation

### 1.5 Core Value Proposition

1. **Proven Code**: OZ open-source + OpenZeppelin Contracts
2. **Simplified Service Integration**: Abstracting blockchain complexity for easy internal service integration
3. **Scalability**: Container-based horizontal scaling for high-volume transaction processing

---

## 2. Target Users

> **Note**: MSQ Relayer Service is a **B2B Infrastructure**. End users do not use it directly; internal services call the Relayer API to process blockchain transactions.

### 2.1 Primary Users (Client Services)

| Client Service | Description | Primary Usage Pattern |
|----------------|-------------|----------------------|
| **Payment System** | Token-based payment processing | Direct TX - Bulk token transfers, Settlement |
| **Airdrop System** | Token mass distribution service | Direct TX - Batch processing, Scheduling |
| **NFT Service** | NFT minting/issuance platform | Gasless TX - End user gas fee sponsorship |
| **DeFi Service** | Oracle, Keeper Bot | Direct TX - Automated transactions |
| **Game Service** | In-game token/NFT processing | Gasless TX - Seamless UX |

### 2.2 Internal Users (Operations/Development)

| User Group | Description | Primary Needs |
|------------|-------------|---------------|
| **Service Development Team** | Client service developers | SDK integration, API call patterns |
| **Infrastructure Team** | Relayer system operations | Monitoring, Scaling, Incident response |
| **Security Team** | System security management | Policy configuration, Audit logs |

---

## 3. Functional Requirements

### 3.1 Phase 1: Direct TX + Gasless TX + Payment System Integration

**Infrastructure**:
| Feature | Description |
|---------|-------------|
| Docker Compose | OZ Relayer + Redis |
| OZ Relayer Configuration | config.json (Polygon Amoy/Mainnet) |
| Local Development Environment | Development/Test environment setup |

**Smart Contracts** (SPEC-CONTRACTS-001 Complete):
| Feature | Description | Status |
|---------|-------------|--------|
| ERC2771Forwarder | OpenZeppelin Forwarder deployment | ✅ Deployed |
| Sample Contracts | ERC20/ERC721 + ERC2771Context examples | ✅ Implemented |
| Deployment Scripts | Hardhat TypeScript-based deployment | ✅ Ready |
| Test Suite | Comprehensive unit tests | ✅ Complete |

**Meta-Transaction Use Cases**:

| Use Case | Description | Implementation | Benefit |
|----------|-------------|-----------------|---------|
| **NFT Minting (Gasless)** | Users mint NFTs without ETH | ERC2771Context + ERC721 | Seamless UX, User acquisition driver |
| **Token Transfer (Gasless)** | Sponsored token transfers | ERC2771Context + ERC20 | Airdrop distribution, Onboarding |
| **In-Game Rewards (Gasless)** | Game token rewards without gas cost | ERC2771Context + Custom ERC20 | Retention, Engagement |
| **Payment Settlement (Direct)** | Merchant settlement via token transfer | Direct TX, Relayer-signed | High throughput, Native wallet support |
| **Subscription Payment (Gasless)** | Recurring token payment via meta-TX | ERC2771Context + Scheduled execute | UX-first payments, User control |

**Technical Flow**:
1. End User signs EIP-712 message with their private key (no gas cost)
2. Frontend/Backend submits signature to Relayer API
3. Relayer verifies EIP-712 signature and executes via ERC2771Forwarder
4. ERC2771Forwarder extracts original user address and calls target contract
5. Target contract receives `_msgSender() = End User address` (not relayer)

**API Gateway (Production Level)**:
| Feature | Description | Status |
|---------|-------------|--------|
| NestJS Project | Production scaffold | ✅ Complete |
| API Key Authentication | Single environment variable (`RELAY_API_KEY`), Header: `X-API-Key` | ✅ Complete |
| Health Check | `/api/v1/health` | ✅ Complete |
| Direct TX Endpoint | `/api/v1/relay/direct` | ✅ Complete (SPEC-PROXY-001) |
| Gasless TX Endpoint | `/api/v1/relay/gasless` | ✅ Complete (SPEC-GASLESS-001) |
| Nonce Query | `/api/v1/relay/gasless/nonce/{address}` | ✅ Complete |
| Transaction Status Polling | `GET /api/v1/relay/status/{txId}` (Phase 1) | ✅ Complete (SPEC-STATUS-001) |
| EIP-712 Signature Verification | Gasless TX pre-validation | ✅ Complete |

**Phase 1 Use Case**: Payment System Integration
- Direct TX: Token transfer to multiple users during settlement
- Gasless TX: End user gas fee sponsorship payment processing
- End User signs EIP-712 → Payment System → Relayer API

---

### 3.2 Phase 2: TX History & Webhook (SPEC-WEBHOOK-001) - Complete

**3-Tier Lookup System**:
| Tier | Storage | Latency | Purpose |
|------|---------|---------|---------|
| L1 | Redis Cache | ~1-5ms | Fast lookup for terminal statuses |
| L2 | MySQL (Prisma) | ~50ms | Persistent transaction history |
| L3 | OZ Relayer API | ~200ms | Real-time status from source |

**Key Features**:
| Feature | Description | Status |
|---------|-------------|--------|
| Redis L1 Cache | Transaction status caching with ioredis | Complete |
| MySQL L2 Storage | Prisma ORM with transactions table | Complete |
| Webhook Handler | POST /webhooks/oz-relayer endpoint | Complete |
| HMAC-SHA256 Verification | X-OZ-Signature header validation | Complete |
| Client Notifications | Non-blocking webhook forwarding | Complete |
| Write-Through Caching | Automatic cache population on writes | Complete |

**Environment Variables**:
```bash
DATABASE_URL=mysql://root:pass@localhost:3307/msq_relayer
REDIS_URL=redis://localhost:6379
WEBHOOK_SIGNING_KEY=your-secret-signing-key
CLIENT_WEBHOOK_URL=https://client.example.com/webhooks
```

### 3.3 Phase 3+: Future Implementation

**Queue System (P1)**:
- AWS SQS Standard Queue for async transaction processing
- LocalStack for local development (AWS SQS emulation)
- Nginx Load Balancer for multi-relayer routing
- Dead Letter Queue (DLQ) with 3 retry limit
- Job status tracking API (`GET /api/v1/relay/job/:jobId`)

**Policy Engine (P1)**:
- Contract Whitelist verification
- User Blacklist

**Monitor Service (P2)**:
- OZ Monitor configuration
- Relayer balance monitoring
- Slack/Discord notifications

**Infrastructure Enhancement (P2)**:
- Kubernetes manifests
- CI/CD pipeline

---

## 4. Transaction Type Comparison

| Category | Direct Transaction | Gasless (Meta-TX) |
|----------|-------------------|-------------------|
| **Caller** | Client Service (Server-to-Server) | Client Service (End User signature forwarding) |
| **Signer** | Relayer Private Key | End User Private Key (EIP-712) |
| **msg.sender** | Relayer address | End User address (_msgSender) |
| **Gas Fee Payer** | Relayer (Service cost) | Relayer (Service sponsors) |
| **Primary Clients** | Payment/Airdrop/Oracle systems | NFT/Game/Token services |

---

## 5. Supported Blockchain Networks

| Network | Chain ID | Type | Forwarder Deployment | Priority |
|---------|----------|------|---------------------|----------|
| Hardhat Node | 31337 | Local Dev | Auto-deploy | P0 |
| Polygon Amoy | 80002 | Testnet | Pre-deployed | P0 |
| Polygon Mainnet | 137 | Mainnet | Pre-deployed | P0 |
| Ethereum Mainnet | 1 | Mainnet | Pre-deployed | P1 |
| Ethereum Sepolia | 11155111 | Testnet | Pre-deployed | P1 |
| BNB Smart Chain | 56 | Mainnet | Pre-deployed | P2 |
| BNB Testnet | 97 | Testnet | Pre-deployed | P2 |

---

## 6. Milestones

> See [Task Master PRD](../.taskmaster/docs/prd.txt) for detailed milestones

### Phase 1: Payment System Integration (Direct + Gasless)

| Week | Key Objectives | Status |
|------|---|---|
| **Week 1** | Infrastructure + API Gateway basic setup | ✅ Complete |
| **Week 2** | Direct TX API + OZ Relayer proxy | ✅ Complete |
| **Week 3** | ERC2771Forwarder deployment + Gasless TX API | ✅ Complete |
| **Week 4** | EIP-712 signature verification + Payment system integration | ✅ Complete |
| **Week 5** | Production stabilization + Documentation | ✅ Complete |

**Week 3 Completion**: Smart contracts package initialized with Hardhat, ERC2771Forwarder deployed, Sample ERC20/ERC721 contracts implemented with ERC2771Context integration. See [SPEC-CONTRACTS-001](../docs/tech.md#smart-contracts-technical-stack) for technical details.

### Phase 2: TX History & Webhook (SPEC-WEBHOOK-001) - Complete

| Week | Key Objectives | Status |
|------|---|---|
| **Week 6** | Redis L1 Cache + MySQL L2 Storage setup | Complete |
| **Week 7** | 3-Tier Lookup implementation + Webhook Handler | Complete |
| **Week 8** | Write-through caching + Client notifications | Complete |

### Phase 3+: Future Expansion (TBD)

- Queue System (AWS SQS + LocalStack)
- Policy Engine (Contract/Method Whitelist)
- OZ Monitor integration
- Kubernetes / CI/CD

---

## 7. Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| RPC Node Failure | High | Multi-RPC, Circuit Breaker |
| Private Key Leak | Critical | AWS KMS (Production), Key Rotation |
| Nonce Collision | High | OZ Relayer built-in Nonce management |
| Gas Price Spike | Medium | Gas Price Cap (Backend), Auto-pause |
| Gasless Abuse | Medium | Policy Engine, Blacklist (Backend) |
| Relayer Balance Depletion | High | OZ Monitor balance monitoring, Auto-alerts |
| OZ Vulnerability Discovery | Medium | OZ update monitoring, Rapid patching |
| AGPL-3.0 License | Medium | Prepare for modification source disclosure |

---

## 8. Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Transaction Success Rate | >= 99.5% | Monitoring dashboard |
| Response Time (P95) | < 3 seconds | API metrics |
| System Availability | >= 99.9% | Uptime monitoring |
| Gasless Daily Throughput | >= 10,000 TX | Analytics dashboard |
| OZ Service Stability | >= 99.9% uptime | OZ Monitor metrics |

---

## Related Documents

- System Architecture (WHERE) -> [structure.md](./structure.md)
- Technical Implementation Details (HOW) -> [tech.md](./tech.md)
- Requirements (For Task Master) -> [prd.txt](../.taskmaster/docs/prd.txt)

---

## HISTORY

| Version | Date | Changes |
|---------|------|---------|
| 12.5 | 2026-01-02 | SPEC-WEBHOOK-001 Phase 2 Complete - Added Section 3.2 with 3-Tier Lookup system, Redis L1 Cache, MySQL L2 Storage, Webhook Handler features, Updated milestones with Phase 2 weeks 6-8, Renumbered Phase 3+ sections |
| 12.4 | 2025-12-30 | Queue System architecture update - Changed from Redis+BullMQ to AWS SQS+LocalStack, Added Nginx LB for multi-relayer routing, Added DLQ with 3 retry limit, Updated Section 1.3 and 3.2 Queue System descriptions |
| 12.3 | 2025-12-23 | Transaction Status Polling API - Added SPEC-STATUS-001 reference |
| 12.2 | 2025-12-22 | Phase 1 MVP Completion - Updated version status from 12.1 to 12.2, Marked all Week 4 and Week 5 objectives as Complete, Added EIP-712 Verification, Nonce Management, and Multi-Relayer Pool to Phase 1 Core Features, Updated milestones table with all phases complete |
| 12.1 | 2025-12-19 | SPEC-CONTRACTS-001 integration - Updated Section 3.1 with contract deployment status, Updated Section 6 milestones with Week 3 completion, Added SPEC links and cross-references |
| 12.0 | 2025-12-15 | Document version sync - Complete document structure cleanup, Remove duplicates, Establish cross-reference system |
| 11.3 | 2025-12-15 | Document role clarification - Add related documents section (cross-references) |
| 11.2 | 2025-12-15 | Document version sync - Apply Docker Compose YAML Anchors pattern (see tech.md, prd.txt) |
| 11.1 | 2025-12-15 | Add API Key authentication spec - Phase 1 single environment variable method (RELAY_API_KEY) |
| 11.0 | 2025-12-15 | SPEC-INFRA-001 Docker structure sync - Consolidate to docker/ directory, Update related docs (structure.md, tech.md) |
| 10.0 | 2025-12-15 | Move MySQL/Prisma to Phase 2+ - Phase 1 uses OZ Relayer + Redis only, No DB |
| 9.0 | 2025-12-15 | Move TX History, Webhook Handler to Phase 2+ - Phase 1 uses status polling method |
| 8.0 | 2025-12-15 | Remove Rate Limiting, Quota Manager completely - Phase 1 keeps Auth + Relay features only |
| 7.0 | 2025-12-15 | Phase 2 redesign - Add Queue System, Remove SDK and replace with API documentation |
| 6.0 | 2025-12-15 | Include Gasless TX in Phase 1 - Support payment system Gasless payments, Move ERC2771Forwarder/EIP-712 verification to Phase 1, Keep Policy/Quota in Phase 2 |
| 5.0 | 2025-12-14 | Reorganize around Phase 1 - Change MVP terminology to Phase 1, Payment system integration goal |
| 5.0 | 2025-12-13 | Simplify around Phase 1 - Payment system integration goal, Separate Gasless/Monitor to Phase 2+ |
| 4.0 | 2025-12-13 | Complete rewrite from B2B Infrastructure perspective - Change target users to Client Services |
| 3.0 | 2025-12-13 | Complete architecture redesign based on OZ open-source (Relayer v1.3.0, Monitor v1.1.0) |

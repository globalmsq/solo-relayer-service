# MSQ Relayer Service - Product Document

## Project Overview

### Project Name
**Blockchain Transaction Relayer System (MSQ Relayer Service)**

### Document Version
- **Version**: 12.0
- **Last Updated**: 2025-12-15
- **Status**: Phase 1 Implementation (Direct + Gasless)

### Related Documents
- [Technical Stack and API Spec](./tech.md)
- [System Architecture](./structure.md)
- [Task Master PRD](../.taskmaster/docs/prd.txt)

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

**Phase 1**:
| Feature | Description | Implementation |
|---------|-------------|----------------|
| **Direct Transaction** | Automated transaction execution | Using OZ Relayer |
| **Gasless Transaction** | User gas fee sponsorship (Payment system) | OZ Relayer + ERC2771Forwarder |

**Phase 2+**:
| Feature | Description | Implementation |
|---------|-------------|----------------|
| **Queue System** | Transaction queuing and sequential processing | Redis(BullMQ) / AWS SQS (QUEUE_PROVIDER) |
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

**Smart Contracts**:
| Feature | Description |
|---------|-------------|
| ERC2771Forwarder | OpenZeppelin Forwarder deployment |
| Sample Contracts | ERC20/ERC721 + ERC2771Context examples |

**API Gateway (Production Level)**:
| Feature | Description |
|---------|-------------|
| NestJS Project | Production scaffold |
| API Key Authentication | Single environment variable (`RELAY_API_KEY`), Header: `X-API-Key` |
| Health Check | `/api/v1/health` |
| Direct TX Endpoint | `/api/v1/relay/direct` |
| Gasless TX Endpoint | `/api/v1/relay/gasless` |
| Nonce Query | `/api/v1/relay/nonce/{address}` |
| Status Query | `/api/v1/relay/status/{txId}` (Polling method) |
| EIP-712 Signature Verification | Gasless TX pre-validation |

**Phase 1 Use Case**: Payment System Integration
- Direct TX: Token transfer to multiple users during settlement
- Gasless TX: End user gas fee sponsorship payment processing
- End User signs EIP-712 → Payment System → Relayer API

---

### 3.2 Phase 2+: Future Implementation

**TX History & Webhook (P1)**:
- MySQL (Transaction History storage)
- Webhook Handler (OZ Relayer status notification processing)
- Status change push notifications

**Queue System (P1)**:
- Queue Adapter pattern (QUEUE_PROVIDER configuration)
- Redis + BullMQ implementation (Default)
- AWS SQS implementation (Optional)
- Job status tracking API

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

| Week | Key Objectives |
|------|----------------|
| **Week 1** | Infrastructure + API Gateway basic setup |
| **Week 2** | Direct TX API + OZ Relayer proxy |
| **Week 3** | ERC2771Forwarder deployment + Gasless TX API |
| **Week 4** | EIP-712 signature verification + Payment system integration |
| **Week 5** | Production stabilization + Documentation |

### Phase 2+: Future Expansion (TBD)

- TX History (MySQL) + Webhook Handler
- Queue System (Redis/BullMQ or AWS SQS)
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

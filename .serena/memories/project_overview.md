# MSQ Relayer Service - Project Overview

## Purpose
Blockchain Transaction Relayer System - B2B Infrastructure for self-hosted blockchain transaction relay, replacing OpenZeppelin Defender service (sunset July 2026).

## Core Components
| Component | Version | Role |
|-----------|---------|------|
| **OZ Relayer** | v1.3.0 (Rust, Docker) | TX relay, Nonce/Gas management, retry logic |
| **OZ Monitor** | v1.1.0 (Rust, Docker) | Blockchain event monitoring, balance alerts |
| **NestJS API Gateway** | 10.x | Auth, policy engine |

## Key Features
- **Direct Transaction**: Automated TX execution (payments, airdrops, Oracle)
- **Gasless Transaction**: End User gas sponsorship (Payment system gasless payments)
- **Monitor Service**: Blockchain event and balance monitoring

## Implementation Phases
| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | OZ Relayer Pool (Multi-Key), Direct TX, Gasless TX, ERC2771Forwarder, EIP-712 verification, Load Balancing, Manual Scaling, Status Polling, Payment system integration | 🔄 In Progress |
| **Phase 2+** | TX History (MySQL), Webhook Handler, OZ Monitor, Policy Engine, Queue System, Auto Scaling, Kubernetes | 📋 Planned |

## Multi-Relayer Pool Architecture (Phase 1)
- **Relayer Pool (Multi-Key)**: Each Relayer has independent Private Key to avoid Nonce collisions
- **Load Balancing**: Round Robin / Least Load routing strategy
- **Manual Scaling**: Start with 1 Relayer, expandable via Docker Compose profiles
- **Auto Scaling**: Kubernetes HPA based (Phase 2+)

## Phase 1 Use Cases (Payment System)
- **Direct TX**: Batch token transfers for settlements
- **Gasless TX**: End User gas-sponsored payments
- **Flow**: End User EIP-712 signature → Payment System → Relayer API

## Target Users (B2B)
- Payment System: Token transfers, settlements
- Airdrop System: Batch token distribution
- NFT Service: Gasless NFT minting
- DeFi Service: Oracle, Keeper Bot automation
- Game Service: In-game token/NFT processing

## Supported Networks
| Network | Chain ID | Priority |
|---------|----------|----------|
| Hardhat Node | 31337 | P0 (Dev) |
| Polygon Amoy | 80002 | P0 (Testnet) |
| Polygon Mainnet | 137 | P0 |
| Ethereum Mainnet | 1 | P1 |
| Ethereum Sepolia | 11155111 | P1 |
| BNB Smart Chain | 56 | P2 |

## License Considerations
- OZ Relayer/Monitor: AGPL-3.0 (source disclosure required if modified)
- OZ Contracts: MIT (free to use)

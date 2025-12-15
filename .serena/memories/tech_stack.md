# MSQ Relayer Service - Tech Stack

## Core Services (OZ Open Source)
### OZ Relayer v1.3.0
- Language: Rust
- Container: `ghcr.io/openzeppelin/openzeppelin-relayer:v1.3.0`
- Queue: Redis 7.x
- Key Management: Local keystore (dev) / AWS KMS (prod)
- Built-in: TX relay, Nonce management, Gas estimation, Retry logic, Webhook

### OZ Monitor v1.1.0 (Phase 2+)
- Language: Rust
- Container: `ghcr.io/openzeppelin/openzeppelin-monitor:v1.1.0`
- Built-in: Event detection, Balance monitoring, Slack/Discord alerts

## API Gateway (Custom Development)
| Category | Technology | Version |
|----------|------------|---------|
| Runtime | Node.js | 20 LTS |
| Framework | NestJS | 10.x |
| Language | TypeScript | 5.x |
| Blockchain | ethers.js | 6.x |
| ORM | Prisma | 5.x |
| Validation | class-validator | 0.14.x |
| Documentation | Swagger/OpenAPI | 3.x |

## Smart Contracts
| Category | Technology | Version |
|----------|------------|---------|
| Library | OpenZeppelin Contracts | 5.3.0 |
| Framework | Hardhat | 2.x |
| Language | Solidity | 0.8.20 |
| Testing | Hardhat Toolbox | 4.x |

## Infrastructure
| Category | Local | Production |
|----------|-------|------------|
| Container | Docker Compose | AWS EKS |
| Database | MySQL Container | AWS RDS MySQL |
| Cache/Queue | Redis Container | AWS ElastiCache |
| Secrets | .env | AWS Secrets Manager |
| Monitoring | Prometheus + Grafana | Prometheus + Grafana |

## Multi-Relayer Pool Architecture (Phase 1)
- **Relayer Pool (Multi-Key)**: Each Relayer has independent Private Key
- **Load Balancing**: Round Robin / Least Load routing strategy
- **Health Check**: Per-Relayer status monitoring
- **Manual Scaling**: Docker Compose profiles for scale out

## Directory Structure
```
msq-relayer-service/
├── docker-compose.yml
├── config/
│   ├── oz-relayer/
│   │   ├── relayer-1/config.json    # Relayer #1 (Key: 0xAAA...)
│   │   ├── relayer-2/config.json    # Relayer #2 (Key: 0xBBB...)
│   │   └── relayer-n/config.json    # Relayer #N
│   ├── relayer-pool.yaml            # Pool config (Load Balancing)
│   └── oz-monitor/
├── keys/
│   ├── relayer-1/                   # Relayer #1 keystore
│   ├── relayer-2/                   # Relayer #2 keystore
│   └── relayer-n/                   # Relayer #N keystore
├── packages/
│   ├── api-gateway/          # NestJS API Gateway (Load Balancer)
│   ├── sdk/                  # Client SDK (OZ Defender compatible)
│   ├── contracts/            # Smart Contracts
│   └── examples/             # Integration examples
├── k8s/
└── docs/
```

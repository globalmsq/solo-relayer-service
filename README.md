# MSQ Relayer Service

**Blockchain Transaction Relayer System** - B2B Infrastructure for internal services

A self-hosted blockchain transaction relay system built on OZ Relayer (Rust) with NestJS API Gateway.

## Features

- **Direct Transaction**: Automated blockchain transaction relay
- **Gasless Transaction**: EIP-712 meta-transaction with gas sponsorship
- **Smart Routing**: Intelligent multi-relayer selection based on health & load (SPEC-ROUTING-001)
- **Fire-and-Forget Pattern**: Non-blocking transaction submission with webhook updates (SPEC-ROUTING-001)
- **3-Tier Lookup**: Redis L1 → MySQL L2 → OZ Relayer L3 for fast status queries
- **Multi-Relayer Pool**: 3 OZ Relayers with intelligent load balancing
- **Async Queue System**: AWS SQS with LocalStack support for asynchronous processing
- **Health Check Caching**: 10-second TTL caching for < 100ms routing performance

## Quick Start

### Prerequisites

- Docker Engine 24.0.0+ (or Docker Desktop)
- Docker Compose 2.20.0+
- pnpm 8.0+ (for local development without Docker)

### Run Services

```bash
# 1. Copy keystore files for local development
cp -R docker/keys-example docker/keys

# 2. Start all services
docker compose -f docker/docker-compose.yaml up -d

# 3. Health check
curl http://localhost:3000/api/v1/health

# View logs
docker compose -f docker/docker-compose.yaml logs -f relay-api

# Stop
docker compose -f docker/docker-compose.yaml down
```

### Services

| Service | URL | Purpose |
|---------|-----|---------|
| API Gateway | http://localhost:3000 | REST API, Swagger UI |
| Swagger Docs | http://localhost:3000/api/docs | Interactive API documentation |
| Hardhat Node | http://localhost:8545 | Local blockchain |
| LocalStack | http://localhost:4566 | AWS SQS emulation |
| Redis | localhost:6379 | Cache & Queue |
| MySQL | localhost:3307 | Transaction storage |

### API Example

```bash
# Direct Transaction
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-dev-api-key" \
  -d '{"to": "0x5FbDB2315678afecb367f032d93F642f64180aa3", "data": "0x", "value": "0"}'

# Expected Response (202 Accepted)
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "createdAt": "2026-01-05T12:34:56.789Z"
}

# Query Status
curl http://localhost:3000/api/v1/relay/status/550e8400-e29b-41d4-a716-446655440000 \
  -H "X-API-Key: local-dev-api-key"

# Expected Response
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "hash": "0x1234...",
  "confirmedAt": "2026-01-05T12:35:10.123Z"
}
```

## Documentation Index

### Core Architecture & Design

| Document | Description | SPEC |
|----------|-------------|------|
| [docs/product.md](./docs/product.md) | Business requirements, goals, user stories | WHAT/WHY |
| [docs/structure.md](./docs/structure.md) | System architecture, directory structure, module organization | WHERE |
| [docs/tech.md](./docs/tech.md) | Technical specifications, API details, implementation guide | HOW |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Queue system architecture, integration patterns, message flows | SPEC-QUEUE-001 |

### SPEC-ROUTING-001 Documentation (Smart Routing & Fire-and-Forget)

| Document | Description | Topic |
|----------|-------------|-------|
| [docs/SMART_ROUTING_GUIDE.md](./docs/SMART_ROUTING_GUIDE.md) | Smart routing implementation, health checks, load balancing | Smart Routing (FR-001~FR-004) |
| [docs/FIRE_AND_FORGET_PATTERN.md](./docs/FIRE_AND_FORGET_PATTERN.md) | Fire-and-forget pattern, non-blocking submission, webhook updates | Fire-and-Forget (FR-002) |
| [docs/SPEC_ROUTING_001_IMPLEMENTATION.md](./docs/SPEC_ROUTING_001_IMPLEMENTATION.md) | Implementation-to-spec mapping, test coverage, validation checklist | Traceability |

### Queue System & Integration

| Document | Description | Topic |
|----------|-------------|-------|
| [docs/QUEUE_INTEGRATION.md](./docs/QUEUE_INTEGRATION.md) | Queue integration guide, SQS adapter usage, fire-and-forget flow | Queue System |
| [docs/SQS_SETUP.md](./docs/SQS_SETUP.md) | SQS/LocalStack setup, queue configuration, queue management | Infrastructure Setup |
| [docs/WEBHOOK_INTEGRATION.md](./docs/WEBHOOK_INTEGRATION.md) | Webhook signature verification, security, oz_relayer_url tracking | Webhooks |

### Deployment & Operations

| Document | Description | Purpose |
|----------|-------------|---------|
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Docker Compose setup, multi-relayer config, environment variables | Deployment |
| [docs/TESTING.md](./docs/TESTING.md) | Testing guide (unit, E2E, integration), 74 test cases | Quality Assurance |
| [docs/DOCKER_SETUP.md](./docs/DOCKER_SETUP.md) | Docker installation, configuration, 3-relayer setup, troubleshooting | Docker Guide |
| [docs/CONTRACTS_GUIDE.md](./docs/CONTRACTS_GUIDE.md) | Smart contract integration, ERC2771Forwarder, meta-transactions | Smart Contracts |
| [docs/operations.md](./docs/operations.md) | Monitoring, metrics, alerting, operational runbooks | Operations |

### Service Documentation

| Document | Description | Service |
|----------|-------------|---------|
| [packages/relay-api/README.md](./packages/relay-api/README.md) | Relay API service documentation, endpoints, architecture | Producer Service |
| [packages/queue-consumer/README.md](./packages/queue-consumer/README.md) | Queue Consumer service documentation, async processing | Consumer Service |
| [packages/relayer-discovery/README.md](./packages/relayer-discovery/README.md) | Relayer Discovery service, health checks, active list management | Discovery Service |

### Specifications

| Document | Status | Version |
|----------|--------|---------|
| [.moai/specs/SPEC-ROUTING-001/spec.md](./.moai/specs/SPEC-ROUTING-001/spec.md) | Complete ✓ | 1.1.0 |
| [.moai/specs/SPEC-QUEUE-001/spec.md](./.moai/specs/SPEC-QUEUE-001/spec.md) | Complete ✓ | 1.0.0 |
| [.moai/specs/SPEC-WEBHOOK-001/spec.md](./.moai/specs/SPEC-WEBHOOK-001/spec.md) | Complete ✓ | 1.0.0 |
| [.moai/specs/SPEC-DISCOVERY-001/spec.md](./.moai/specs/SPEC-DISCOVERY-001/spec.md) | Complete ✓ | 1.0.1 |

## Project Structure

```
msq-relayer-service/
├── docker/                       # Docker Compose files
│   ├── Dockerfile.packages       # Multi-stage build
│   ├── docker-compose.yaml       # Main config
│   ├── config/                   # Service configs
│   └── keys/                     # Keystores
├── packages/
│   ├── relay-api/                # NestJS API Gateway (Producer)
│   ├── queue-consumer/           # Queue Consumer Service
│   ├── relayer-discovery/        # Relayer Discovery Service (SPEC-DISCOVERY-001)
│   ├── contracts/                # Smart Contracts (Hardhat)
│   └── examples/                 # Integration examples
├── docs/                         # Documentation
│   ├── product.md
│   ├── structure.md
│   ├── tech.md
│   ├── ARCHITECTURE.md
│   ├── QUEUE_INTEGRATION.md
│   ├── SQS_SETUP.md
│   ├── DEPLOYMENT.md
│   └── TESTING.md
├── .moai/specs/                  # SPEC documents
│   ├── SPEC-QUEUE-001/spec.md
│   └── SPEC-DISCOVERY-001/spec.md
└── README.md                     # This file
```

## Architecture Overview

### System Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                    Client Services (B2B)                          │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌────────────────┐   │
│  │ Payment   │ │ Airdrop   │ │ NFT       │ │ DeFi/Game      │   │
│  │ System    │ │ System    │ │ Service   │ │ Service        │   │
│  └───────────┘ └───────────┘ └───────────┘ └────────────────┘   │
└──────────────────┬─────────────────────────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                  NestJS API Gateway (relay-api)                   │
│  Producer - Accepts requests, saves to MySQL, sends to SQS       │
└──────────────────┬──────────────────────────────────────────────┬─┘
                   │                                              │
                   ▼                                              ▼
        ┌──────────────────┐                          ┌──────────────────┐
        │  AWS SQS Queue   │                          │ Queue Consumer   │
        │  (LocalStack)    │                          │ (Background      │
        │                  │                          │  Worker)         │
        │ Message Format:  │                          │                  │
        │ {                │                          │ Long-poll: 20s   │
        │   txId,          │                          │ Retry: 3x        │
        │   request,       │ ◄──────────────────────► │ DLQ: Dead Letter │
        │   type           │                          │ Queue            │
        │ }                │                          │                  │
        └──────────────────┘                          └────────┬─────────┘
                                                               │
                                                               ▼
                                                   ┌──────────────────┐
                                                   │  OZ Relayer      │
                                                   │  (TX Signing)    │
                                                   │                  │
                                                   │ • Nonce Mgmt     │
                                                   │ • Gas Est        │
                                                   │ • Signing        │
                                                   │ • Submission     │
                                                   └────────┬─────────┘
                                                           │
                                                           ▼
                                        ┌──────────────────────────────┐
                                        │   Blockchain Network         │
                                        │   • Polygon                  │
                                        │   • Ethereum                 │
                                        │   • BNB Chain                │
                                        └──────────────────────────────┘
```

### Phase Implementation

| Phase | Components | Status |
|-------|-----------|--------|
| **Phase 1** | Direct TX, Gasless TX, Multi-Relayer Pool, Redis L1 Cache | ✅ Complete |
| **Phase 2** | TX History (MySQL), Webhook Handler, 3-Tier Lookup | ✅ Complete |
| **Phase 3** | Async Queue System (SQS + LocalStack) | ✅ Complete |
| **Phase 4+** | OZ Monitor, Policy Engine, Kubernetes | Planned |

## Key Features

### 1. Async Transaction Processing

**Before SPEC-QUEUE-001** (Synchronous):
```
Client → API Gateway → OZ Relayer → Blockchain → Response (hash)
         [Blocking, ~200ms]
```

**After SPEC-QUEUE-001** (Asynchronous):
```
Client → API Gateway → SQS Queue → Background Worker → OZ Relayer → Blockchain
         [202 Accepted, ~10ms]                      [Async processing]
```

### 2. Dual Credentials Strategy

**Local Development** (LocalStack):
```bash
SQS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

**Production** (AWS):
```bash
# No SQS_ENDPOINT_URL
# Automatic use of IAM Instance Role (ECS/EKS)
```

### 3. Message Processing Flow

1. **Producer (relay-api)**
   - Receive POST /relay/direct or /relay/gasless
   - Save transaction to MySQL with `pending` status
   - Send message to SQS queue
   - Return 202 Accepted with `transactionId`

2. **Queue (AWS SQS)**
   - Long-poll: 20 seconds wait time
   - Visibility timeout: 60 seconds
   - Max retries: 3 attempts
   - Dead Letter Queue: Failed messages after 3 retries

3. **Consumer (queue-consumer)**
   - Receive message from SQS
   - Check idempotency (MySQL status)
   - Send to OZ Relayer
   - Update MySQL with result
   - Delete message from queue (on success)
   - Move to DLQ (on failure after retries)

4. **Client Status Query**
   - GET /relay/status/:transactionId
   - 3-Tier Lookup:
     - **L1**: Redis Cache (~1-5ms)
     - **L2**: MySQL Storage (~50ms)
     - **L3**: OZ Relayer API (~200ms)

## Development Setup

### Local Development with Docker

```bash
# 1. Start all services
docker compose -f docker/docker-compose.yaml up -d

# 2. Run migrations
pnpm --filter @msq-relayer/relay-api run prisma:migrate:dev

# 3. Start API in development mode
pnpm --filter @msq-relayer/relay-api run start:dev

# 4. Start Consumer in development mode
pnpm --filter @msq-relayer/queue-consumer run start:dev

# 5. Test API
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-dev-api-key" \
  -d '{"to":"0x5FbDB2315678afecb367f032d93F642f64180aa3","data":"0x"}'
```

### Running Tests

```bash
# Unit tests
pnpm --filter @msq-relayer/relay-api test
pnpm --filter @msq-relayer/queue-consumer test

# E2E tests
pnpm --filter @msq-relayer/relay-api test:e2e

# Coverage report
pnpm --filter @msq-relayer/relay-api test:cov
```

## Deployment

### Local Development

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed deployment procedures.

### Production Deployment (AWS)

```bash
# 1. Build images
docker compose build

# 2. Push to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin <ECR_REPO>
docker tag relay-api:latest <ECR_REPO>/relay-api:latest
docker push <ECR_REPO>/relay-api:latest

# 3. Deploy to ECS/EKS
# See .moai/specs/SPEC-QUEUE-001/spec.md for IAM configuration
```

## Environment Variables

### Core Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API Gateway port |
| `RELAY_API_KEY` | `local-dev-api-key` | API authentication key |
| `NODE_ENV` | `development` | Node environment |
| `DATABASE_URL` | `mysql://root:password@localhost:3306/msq_relayer` | MySQL connection |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |

### Queue Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_REGION` | `ap-northeast-2` | AWS region |
| `SQS_QUEUE_URL` | `http://localhost:4566/000000000000/relay-transactions` | Queue URL |
| `SQS_DLQ_URL` | `http://localhost:4566/000000000000/relay-transactions-dlq` | Dead Letter Queue URL |
| `SQS_ENDPOINT_URL` | `http://localhost:4566` | LocalStack endpoint (omit for production) |
| `SQS_VISIBILITY_TIMEOUT` | `60` | Message visibility timeout (seconds) |
| `SQS_WAIT_TIME_SECONDS` | `20` | Long-poll wait time (seconds) |
| `SQS_MAX_RECEIVE_COUNT` | `3` | Max retries before DLQ |

### OZ Relayer Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OZ_RELAYER_URL` | `http://localhost:8081` | OZ Relayer endpoint |
| `OZ_RELAYER_API_KEY` | `your-api-key` | OZ Relayer API key |

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for complete configuration.

## API Reference

### Direct Transaction

```bash
POST /api/v1/relay/direct
X-API-Key: {api-key}

{
  "to": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "data": "0x",
  "value": "0",
  "gasLimit": "21000",
  "speed": "fast"
}

# Response (202 Accepted)
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "createdAt": "2026-01-05T12:34:56.789Z"
}
```

### Gasless Transaction

```bash
POST /api/v1/relay/gasless
X-API-Key: {api-key}

{
  "request": {
    "from": "0x...",
    "to": "0x...",
    "value": "0",
    "gas": "50000",
    "nonce": "0",
    "deadline": "1735123456",
    "data": "0x..."
  },
  "signature": "0x..."
}

# Response (202 Accepted)
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "createdAt": "2026-01-05T12:34:56.789Z"
}
```

### Transaction Status

```bash
GET /api/v1/relay/status/:transactionId
X-API-Key: {api-key}

# Response (200 OK)
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "hash": "0x1234...",
  "confirmedAt": "2026-01-05T12:35:10.123Z"
}
```

### Health Check

```bash
GET /api/v1/health

# Response
{
  "status": "ok",
  "info": {
    "sqs": { "status": "up" },
    "redis": { "status": "up" },
    "oz-relayer-pool": { "status": "up" },
    "mysql": { "status": "up" }
  }
}
```

## Monitoring & Operations

### Health Checks

```bash
# API Gateway
curl http://localhost:3000/api/v1/health

# OZ Relayer Health
curl http://localhost:8081/api/v1/health
curl http://localhost:8082/api/v1/health
curl http://localhost:8083/api/v1/health

# Redis
docker compose exec redis redis-cli ping

# MySQL
docker compose exec mysql mysql -u root -p -e "SELECT 1"

# LocalStack SQS
docker compose exec localstack awslocal sqs list-queues
```

### Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f relay-api
docker compose logs -f queue-consumer
docker compose logs -f oz-relayer-0
```

### Metrics

Monitor queue depth and consumer lag:

```bash
# Queue depth
docker compose exec localstack awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/relay-transactions \
  --attribute-names ApproximateNumberOfMessages

# Consumer lag monitoring
# See monitoring/prometheus.yml for Prometheus configuration
```

## Troubleshooting

### Common Issues

**SQS Connection Failed**
```bash
# Check LocalStack is running
docker compose exec localstack awslocal sqs list-queues

# Restart LocalStack
docker compose restart localstack
```

**Consumer Not Processing Messages**
```bash
# Check consumer logs
docker compose logs queue-consumer

# Check SQS queue URL format
echo $SQS_QUEUE_URL

# Check queue visibility
docker compose exec localstack awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/relay-transactions \
  --attribute-names All
```

**Message in DLQ**
```bash
# Check DLQ messages
docker compose exec localstack awslocal sqs receive-message \
  --queue-url http://localhost:4566/000000000000/relay-transactions-dlq

# Check MySQL for failed transactions
docker compose exec mysql mysql -u root -p \
  -e "SELECT * FROM transactions WHERE status='failed' LIMIT 5"
```

See [docs/DOCKER_SETUP.md](./docs/DOCKER_SETUP.md) for detailed troubleshooting.

## Related Specifications

- [SPEC-QUEUE-001](./moai/specs/SPEC-QUEUE-001/spec.md) - Queue system specification
- [SPEC-PROXY-001](./.moai/specs/SPEC-PROXY-001/spec.md) - Nginx load balancer
- [SPEC-CONTRACTS-001](./.moai/specs/SPEC-CONTRACTS-001/spec.md) - Smart contracts
- [SPEC-WEBHOOK-001](./.moai/specs/SPEC-WEBHOOK-001/spec.md) - Webhook system
- [SPEC-INFRA-001](./.moai/specs/SPEC-INFRA-001/spec.md) - Infrastructure

## Support

For issues or questions:

1. Check [docs/TESTING.md](./docs/TESTING.md) for testing guide
2. Review [docs/DOCKER_SETUP.md](./docs/DOCKER_SETUP.md) for Docker troubleshooting
3. See [docs/QUEUE_INTEGRATION.md](./docs/QUEUE_INTEGRATION.md) for queue integration questions
4. Consult [SPEC-QUEUE-001](./.moai/specs/SPEC-QUEUE-001/spec.md) for technical specifications

## License

AGPL-3.0 (OZ Relayer components)

MIT (Custom components)

---

**Last Updated**: 2026-01-06
**Version**: 2.0.0 (Queue System Integration)
**Status**: Phase 3 Complete (Queue System Implemented)

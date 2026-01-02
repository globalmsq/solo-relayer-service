# MSQ Relayer Service

**Blockchain Transaction Relayer System** - B2B Infrastructure for internal services

A self-hosted blockchain transaction relay system built on OZ Relayer (Rust) with NestJS API Gateway.

## Features

- **Direct Transaction**: Automated blockchain transaction relay
- **Gasless Transaction**: EIP-712 meta-transaction with gas sponsorship
- **3-Tier Lookup**: Redis L1 → MySQL L2 → OZ Relayer L3 for fast status queries
- **Multi-Relayer Pool**: 3 OZ Relayers with Nginx load balancing

## Quick Start

### Prerequisites

- Docker Engine 24.0.0+ (or Docker Desktop)
- Docker Compose 2.20.0+

### Run Services

```bash
# Start all services
docker compose -f docker/docker-compose.yaml up -d

# Health check
curl http://localhost:3000/api/v1/health

# View logs
docker compose -f docker/docker-compose.yaml logs -f relay-api

# Stop
docker compose -f docker/docker-compose.yaml down
```

### Services

| Service | URL |
|---------|-----|
| API Gateway | http://localhost:3000 |
| Swagger Docs | http://localhost:3000/api/docs |
| Hardhat Node | http://localhost:8545 |
| Redis | localhost:6379 |
| MySQL | localhost:3307 |

### API Example

```bash
# Direct Transaction
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-dev-api-key" \
  -d '{"to": "0x1234...", "data": "0x", "value": "0"}'

# Query Status
curl http://localhost:3000/api/v1/relay/status/{txId} \
  -H "X-API-Key: local-dev-api-key"
```

## Documentation

| Document | Description |
|----------|-------------|
| [product.md](./docs/product.md) | Business requirements, goals, user stories |
| [structure.md](./docs/structure.md) | System architecture, directory structure |
| [tech.md](./docs/tech.md) | Technical specifications, API details |
| [TESTING.md](./docs/TESTING.md) | Testing guide (unit, E2E, integration) |
| [operations.md](./docs/operations.md) | Operations, troubleshooting, deployment |

## Project Structure

```
msq-relayer-service/
├── docker/                 # Docker Compose files
├── packages/
│   ├── relay-api/          # NestJS API Gateway
│   └── contracts/          # Smart Contracts (Hardhat)
└── docs/                   # Documentation
```

## License

AGPL-3.0 (OZ Relayer components)

# MSQ Relayer Service

**Blockchain Transaction Relayer System** - B2B Infrastructure

A self-hosted blockchain transaction relay system in preparation for OpenZeppelin Defender service discontinuation (July 2026).

## Quick Start

### Prerequisites
- Docker Engine 24.0.0+ or Docker Desktop
- Docker Compose 2.20.0+
- 4GB RAM minimum for local development

### Local Development Setup (Hardhat Node)

```bash
# Start all services (API Gateway, Relayers, Redis, Hardhat Node)
docker compose -f docker/docker-compose.yaml up -d

# Verify Installation
curl http://localhost:3000/api/v1/health

# View logs
docker compose -f docker/docker-compose.yaml logs -f relay-api

# Stop all services
docker compose -f docker/docker-compose.yaml down
```

**Available Services**:
- API Gateway: `http://localhost:3000`
- Swagger Docs: `http://localhost:3000/api/docs`
- Hardhat Node: `http://localhost:8545`
- Relayer-1: `http://localhost:8081/api/v1/health`
- Relayer-2: `http://localhost:8082/api/v1/health`
- Relayer-3: `http://localhost:8083/api/v1/health`
- Redis: `localhost:6379`

### Polygon Amoy Testnet Setup

```bash
# Start services connected to Polygon Amoy
docker compose -f docker/docker-compose-amoy.yaml up -d

# Health Check
curl http://localhost:3000/api/v1/health
```

### Sample API Requests

```bash
# Direct Transaction Relay
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-dev-api-key" \
  -d '{
    "to": "0x1234567890123456789012345678901234567890",
    "data": "0x",
    "value": "0"
  }'

# Get Nonce
curl http://localhost:3000/api/v1/relay/nonce/0x1234567890123456789012345678901234567890

# Get Transaction Status
curl http://localhost:3000/api/v1/relay/status/tx_123456
```

### Troubleshooting

**Port already in use**:
```bash
# Find process using port
lsof -i :3000

# Use different compose file or kill process
```

**Docker permission denied**:
```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

**Services not starting**:
```bash
# Check logs
docker compose -f docker/docker-compose.yaml logs

# Restart docker daemon
sudo systemctl restart docker
```

## Documentation

For detailed documentation, see the [docs/](./docs/) directory:

| Document | Role | Question Type |
|----------|------|---------------|
| [product.md](./docs/product.md) | **WHAT/WHY** | "What are we building?", "Why is it needed?" |
| [structure.md](./docs/structure.md) | **WHERE** | "Where is it located?", "How is it organized?" |
| [tech.md](./docs/tech.md) | **HOW** | "How do we implement it?", "What are the API specs?" |

## Project Structure

```
msq-relayer-service/
├── docker/                     # Docker files consolidated directory
├── packages/
│   ├── relay-api/              # NestJS Relay API Gateway
│   ├── contracts/              # Smart Contracts (Hardhat)
│   └── examples/               # Usage examples
├── docs/                       # Documentation
└── README.md
```

## Status

**Phase 1 Complete** (Direct + Gasless + Multi-Relayer Pool)

---

**Version**: 12.1
**Last Updated**: 2025-12-16

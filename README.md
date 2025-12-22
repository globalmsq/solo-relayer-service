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

#### Direct Transaction API (HTTP 202 Accepted)

```bash
# Direct Transaction Relay via Nginx Load Balancer
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-dev-api-key" \
  -d '{
    "to": "0x1234567890123456789012345678901234567890",
    "data": "0x",
    "value": "0"
  }'

# Expected Response (HTTP 202)
# {
#   "transactionId": "tx_12345",
#   "hash": "0xabcd...",
#   "status": "pending",
#   "createdAt": "2025-12-19T10:00:00Z"
# }
```

#### Testing Direct Transaction API

```bash
# Run unit tests for Direct Transaction
pnpm --filter relay-api test -- direct

# Run integration tests with Nginx Load Balancer
docker compose -f docker/docker-compose.yaml up -d
sleep 5

# Verify Nginx Load Balancer health
curl http://localhost:8080/health

# Test Direct Transaction with load balancer
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-dev-api-key" \
  -d '{
    "to": "0x1234567890123456789012345678901234567890",
    "data": "0x",
    "value": "0"
  }'
```

#### Transaction Status Query API

```bash
# Query transaction status (Polling method)
curl http://localhost:3000/api/v1/relay/status/550e8400-e29b-41d4-a716-446655440000

# Expected Response (HTTP 200)
# {
#   "transactionId": "550e8400-e29b-41d4-a716-446655440000",
#   "hash": "0xabcd...",
#   "status": "confirmed",
#   "createdAt": "2025-12-19T10:00:00Z",
#   "confirmedAt": "2025-12-19T10:05:00Z",
#   "from": "0x...",
#   "to": "0x...",
#   "value": "0"
# }
```

#### Other Relay Endpoints

```bash
# Get Nonce
curl http://localhost:3000/api/v1/relay/nonce/0x1234567890123456789012345678901234567890

# Health Check (includes Nginx LB status)
curl http://localhost:3000/api/v1/health
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

## Smart Contracts

The `packages/contracts/` directory contains Hardhat-based smart contracts for ERC2771 meta-transaction support and sample token/NFT contracts demonstrating gasless transaction patterns.

### Contract Components

| Component | Purpose | Status |
|-----------|---------|--------|
| **ERC2771Forwarder** | OpenZeppelin meta-transaction forwarder | ✅ Deployed |
| **SampleToken.sol** | ERC20 token with ERC2771Context integration | ✅ Implemented |
| **SampleNFT.sol** | ERC721 NFT with ERC2771Context integration | ✅ Implemented |

### Key Features

- **EIP-712 Signature Support**: Gasless transactions using user signatures
- **Nonce Management**: Replay attack prevention with per-user nonce tracking
- **Deadline Verification**: Transaction validity period enforcement
- **Flexible Recipient**: Support for any ERC20/ERC721 contract with ERC2771Context

### Deployment

**Local Development (Hardhat Node)**:
```bash
npx hardhat run scripts/deploy-forwarder.ts --network localhost
npx hardhat run scripts/deploy-samples.ts --network localhost
```

**Polygon Amoy Testnet**:
```bash
npx hardhat run scripts/deploy-forwarder.ts --network amoy
```

### Contract Details

For comprehensive technical specifications, see:
- **[tech.md - Section 4: Smart Contracts Technical Stack](./docs/tech.md#4-smart-contracts-technical-stack)** - Full technical specification
- **[SPEC-CONTRACTS-001](./moai/specs/SPEC-CONTRACTS-001/spec.md)** - Smart Contracts Specification with acceptance criteria
- **[CONTRACTS_GUIDE.md](./docs/CONTRACTS_GUIDE.md)** - Integration guide and usage patterns

---

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

## Load Balancer Architecture

### Nginx Load Balancer (SPEC-PROXY-001)

MSQ Relayer Service uses **Nginx Load Balancer** for distributing requests to OZ Relayer Pool:

**Architecture**:
```
API Gateway (Port 3000)
          ↓
Direct Transaction API (/api/v1/relay/direct)
          ↓
Nginx Load Balancer (Port 8080) - ip_hash strategy
          ↓
    ┌─────┼─────┐
    ↓     ↓     ↓
 OZ-1  OZ-2  OZ-3 (Ports 8081-8083)
```

**Features**:
- **Load Balancing**: ip_hash strategy for session persistence
- **Health Checks**: Automatic failover (max_fails=3, fail_timeout=30s)
- **Transparent Proxy**: Maintains X-Real-IP and X-Forwarded-For headers
- **Access Logging**: Nginx logs all transactions for debugging

See [SPEC-PROXY-001](./docs/SPEC-PROXY-001.md) for detailed architecture.

---

## Status

**Phase 1 Complete** (Direct + Gasless + Multi-Relayer Pool + Smart Contracts + Nginx Proxy + Transaction Status Polling)

### Test Results
- ✅ All 147 tests passing (smart contracts)
- ✅ Direct Transaction API tested and validated
- ✅ Gasless Transaction API (EIP-712) tested and validated
- ✅ Transaction Status Polling API implemented and tested (9/9 tests passing, 80.95% coverage)
- ✅ Nginx Load Balancer integrated with 3+ relayers
- ✅ Health check endpoint functional
- ✅ API Key authentication enforced

---

**Version**: 12.4
**Last Updated**: 2025-12-23

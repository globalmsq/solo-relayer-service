# Integration Tests

Blockchain integration tests for MSQ Relayer Service.

## Prerequisites

- Docker & Docker Compose
- pnpm (for local development)

## Quick Start

### 1. Start Local Environment (Hardhat)

```bash
cd docker

# Start all services (Hardhat node, Redis, OZ Relayer, Relay API)
docker compose up -d

# Wait for services to be healthy
docker compose ps
```

### 2. Run Integration Tests

**Option A: Via Docker Compose (Recommended)**

```bash
# Run tests in container (auto-remove after completion)
docker compose run --rm integration-tests
```

**Option B: Local Development**

```bash
cd packages/integration-tests

# Copy environment file
cp .env.example .env

# Run tests
pnpm test
```

## Environment Configurations

### Hardhat (Local)

Default configuration for local development:

| Variable | Value |
|----------|-------|
| RPC_URL | http://localhost:8545 |
| CHAIN_ID | 31337 |
| FORWARDER_ADDRESS | 0x5FbDB2315678afecb367f032d93F642f64180aa3 |

```bash
# Use Hardhat environment
cp .env.example .env
```

### Polygon Amoy (Testnet)

Configuration for Polygon Amoy testnet:

| Variable | Value |
|----------|-------|
| RPC_URL | https://rpc-amoy.polygon.technology |
| CHAIN_ID | 80002 |
| FORWARDER_ADDRESS | 0xF034a404241707F347A952Cd4095f9035AF877Bf |

**Option A: Via Docker Compose**

```bash
cd docker

# Start Amoy environment (Redis, OZ Relayer, Relay API)
docker compose -f docker-compose-amoy.yaml up -d

# Wait for services to be healthy
docker compose -f docker-compose-amoy.yaml ps

# Run integration tests (auto-remove after completion)
docker compose -f docker-compose-amoy.yaml run --rm integration-tests
```

**Option B: Local Development**

```bash
cd packages/integration-tests

# Use Amoy environment
cp .env.amoy .env

# Run tests
pnpm test
```

> **Note**: Amoy environment does not include Hardhat node since it connects to the public Polygon Amoy RPC.

## Test Cases

| Test ID | Description |
|---------|-------------|
| TC-INT-001 | Connect to configured RPC endpoint |
| TC-INT-002 | Verify chain ID matches configuration |
| TC-INT-003 | Query real balance from blockchain |
| TC-INT-004 | Accept Direct TX request (API level) |
| TC-INT-005 | Query real nonce from Forwarder contract |
| TC-INT-006 | Verify EIP-712 signature generation |
| TC-INT-007 | Accept Gasless TX request via nonce endpoint |
| TC-INT-008 | Return health status |

## Troubleshooting

### Tests fail with "Network unavailable"

Ensure the blockchain node is running:

```bash
# Check Hardhat node
curl http://localhost:8545 -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Or check Docker services
docker compose ps
```

### Missing environment variables

```
Error: Missing required environment variables: RPC_URL, CHAIN_ID...
```

Copy the appropriate `.env` file:

```bash
cp .env.example .env  # For Hardhat
cp .env.amoy .env     # For Amoy
```

### Docker build is slow (playwright)

The `.npmrc` file with `optional=false` should skip playwright installation. If still slow, rebuild without cache:

```bash
docker compose build --no-cache relay-api
```

## Project Structure

```
packages/integration-tests/
├── src/
│   ├── setup.ts           # Jest setup & env validation
│   └── helpers/
│       ├── network.ts     # RPC provider utilities
│       └── token.ts       # ABI encoding utilities
├── tests/
│   └── blockchain.integration-spec.ts
├── .env.example           # Hardhat config template
├── .env.amoy              # Amoy testnet config
├── jest.config.js
└── package.json
```

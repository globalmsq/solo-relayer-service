---
id: SPEC-INFRA-001
title: Docker Compose Based OZ Relayer Pool and Redis Infrastructure Setup
domain: INFRA
status: completed
priority: high
created_at: 2025-12-15
updated_at: 2025-12-16
completed_at: 2025-12-16
version: 1.9.0
---

# SPEC-INFRA-001: Docker Compose Based OZ Relayer Pool and Redis Infrastructure Setup

## Overview

Build Docker Compose-based infrastructure for MSQ Relayer Service's local development and production environments. This includes OZ Relayer v1.3.0 Pool (3+ relayers), Redis 8.0-alpine, Hardhat Node (local blockchain), and Key Management structure.

**Phase Separation Strategy**: Phase 1 includes only core development environment (Hardhat Node, API Gateway, OZ Relayers, Redis). MySQL and Monitoring will be added as Docker Compose profiles in Phase 2+.

## Objectives

1. **Local Development Environment Setup**: One-command development environment execution via Docker Compose
2. **Multi-Relayer Pool**: Parallel transaction processing infrastructure based on independent Private Keys
3. **Redis Integration**: Nonce management and transaction queue caching
4. **Hardhat Node Integration**: Local blockchain environment provision
5. **Secure Key Management**: Safe Private Key management and gitignore handling (sample keystore provided)
6. **Multi-Network Support**: Support for Hardhat Node (local) and Polygon Amoy Testnet
7. **Health Check**: Status monitoring endpoints for each service

---

## EARS Requirements

### Ubiquitous Requirements (System-wide)

**U-INFRA-001**: The system shall manage all services through Docker Compose.

**U-INFRA-002**: The system shall manage network configuration by explicitly specifying environment variables in the docker-compose.yaml file (.env file usage prohibited). A single environment variable RELAY_API_KEY shall be used for API Gateway access.

**U-INFRA-003**: The system shall provide Hardhat Node as the default local blockchain.

**U-INFRA-004**: The system shall place Docker-related files in the `docker/` directory.

**U-INFRA-006**: The system shall use Docker Compose internal Named Volumes for data management (external directory sharing prohibited).

**U-INFRA-007**: The system shall add `msq-relayer-` prefix to all volume names to prevent conflicts with other projects.

**U-INFRA-005**: The system shall separate package-specific targets through multi-stage builds.

**U-INFRA-008**: The system shall utilize YAML Anchors pattern to reuse repetitive environment variable configurations.

**U-INFRA-009**: The system shall standardize Health Check endpoints to `/api/v1/health` path.

### Event-driven Requirements

**E-INFRA-001**: When `docker-compose up` command is executed, the system shall automatically start all services (OZ Relayer Pool, Redis).

**E-INFRA-002**: When Relayer service starts, the system shall verify Redis connection and retry on failure.

**E-INFRA-003**: When Hardhat Node container starts, the system shall automatically generate 10 or more test accounts.

**E-INFRA-003-B**: Sample keystore files shall be provided in `keys/` directory and shall use Hardhat Node default accounts (#10, #11, #12).

**E-INFRA-004**: When health check endpoint is called, the system shall return status of all services in JSON format.

### State-driven Requirements

**S-INFRA-001**: While Redis is not running, OZ Relayer shall execute connection retry logic.

**S-INFRA-002**: When running in development mode (`NODE_ENV=development`), the system shall enable hot-reload.

### Unwanted Behavior

**UW-INFRA-001**: Private Keys shall never be committed to the Git repository.

**UW-INFRA-002**: Development environment variables (e.g., `DEV_MODE=true`) shall not be used in production environments.

**UW-INFRA-003**: Health check shall not be accessible without external authentication (internal network only).

### Optional Requirements

**O-INFRA-001**: If possible, Docker image build caching shall be utilized to reduce build time.

**O-INFRA-002**: If possible, Docker healthcheck shall be used to automatically monitor container status.

---

## Technical Specifications

### Docker Directory Structure

**Directory Structure**:
```
docker/
├── Dockerfile.packages          # Multi-stage build (relay-api, sdk targets)
├── docker-compose.yaml          # Main configuration (includes Hardhat Node)
├── docker-compose-amoy.yaml     # Polygon Amoy Testnet configuration
├── config/
│   └── oz-relayer/
│       ├── relayer-1.json       # Relayer 1 configuration (local signer)
│       ├── relayer-2.json       # Relayer 2 configuration
│       └── relayer-3.json       # Relayer 3 configuration
├── keys-example/                # Sample keystore (Git included, Hardhat #10,11,12)
│   ├── relayer-1/
│   │   └── keystore.json
│   ├── relayer-2/
│   │   └── keystore.json
│   └── relayer-3/
│       └── keystore.json
└── keys/                        # Actual keystore (.gitignore)
    ├── relayer-1/
    │   └── keystore.json
    ├── relayer-2/
    │   └── keystore.json
    └── relayer-3/
        └── keystore.json
```

**Volume Strategy**:
- Use Docker Compose internal volumes (external directory sharing prohibited)
- Add `msq-relayer-` prefix to volume names to prevent conflicts
- Example: `msq-relayer-redis-data` (Named volume)

### Dockerfile.packages Build

**Base Stage**:
```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci
```

**API Gateway Target**:
```dockerfile
FROM base AS relay-api
COPY packages/relay-api ./packages/relay-api
WORKDIR /app/packages/relay-api
RUN npm install tsx
EXPOSE 3000
CMD ["npx", "tsx", "src/main.ts"]
```

**Docker Compose Build Target Usage**:
```yaml
services:
  relay-api:
    build:
      context: ..
      dockerfile: docker/Dockerfile.packages
      target: relay-api
    ports:
      - "3000:3000"
```

### API Documentation Requirements

**Swagger/OpenAPI Integration**:
- API Gateway shall automatically generate API documentation via Swagger UI
- OpenAPI 3.0 spec compliant
- Endpoints: `/api/docs` (Swagger UI), `/api/docs-json` (OpenAPI JSON)

**Documentation Items**:
- All API endpoint descriptions
- Request/Response schema definitions
- Authentication method (API Key) description
- Error codes and message definitions
- Example requests/responses

### Docker Compose Configuration

**Phase 1 Service Configuration** (Default execution):
1. **hardhat-node**: Hardhat Node (local blockchain)
2. **relay-api**: API Gateway (NestJS, includes Swagger documentation)
3. **oz-relayer-1**: OZ Relayer v1.3.0 (Primary)
4. **oz-relayer-2**: OZ Relayer v1.3.0 (Secondary)
5. **oz-relayer-3**: OZ Relayer v1.3.0 (Tertiary)
6. **redis**: Redis 8.0-alpine

**Phase 2+ Service Configuration** (Selectively enabled via profiles):
- **mysql**: MySQL 8.0 (for Transaction History storage) - `--profile=mysql`
- **oz-monitor**: OZ Relayer Monitor - `--profile=monitoring`
- **prometheus**: Metrics collection - `--profile=monitoring`
- **grafana**: Dashboard - `--profile=monitoring`

**Phase Separation Execution Strategy**:
```bash
# Phase 1 (Default): Run development environment only
docker-compose up

# Phase 2+: Run with MySQL included
docker-compose --profile=mysql up

# Phase 2+: Run with Monitoring included
docker-compose --profile=monitoring up

# Phase 2+: Run all services
docker-compose --profile=mysql --profile=monitoring up
```

### Hardhat Node Configuration

**Image**: `ethereum/client-go:latest` or Hardhat custom image

**Environment Variables** (directly specified in docker-compose.yaml):
- `CHAIN_ID`: 31337 (Hardhat default chain ID)
- `NETWORK_ID`: 31337
- `ACCOUNTS_TO_CREATE`: 20 (default number of accounts to create)

**Port**: `8545:8545` (JSON-RPC)

**Healthcheck**:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8545"]
  interval: 5s
  timeout: 3s
  retries: 5
  start_period: 10s
```

### OZ Relayer Configuration

**Image**: `ghcr.io/openzeppelin/openzeppelin-relayer:v1.3.0`

**Environment Variables** (directly specified in docker-compose.yaml):
- `RUST_LOG`: info
- `RELAY_API_KEY`: local-dev-api-key (single key for API Gateway access)
- `KEYSTORE_PASSPHRASE`: hardhat-test-passphrase
- `RPC_URL`: http://hardhat-node:8545 (local) or Polygon Amoy RPC (Amoy config file)

**YAML Anchors Pattern** (reuse repetitive environment variables):
```yaml
x-common-env: &common-env
  RUST_LOG: info
  RELAY_API_KEY: local-dev-api-key
  KEYSTORE_PASSPHRASE: hardhat-test-passphrase
  REDIS_HOST: redis
  REDIS_PORT: 6379

services:
  oz-relayer-1:
    environment:
      <<: *common-env
      RPC_URL: http://hardhat-node:8545

  oz-relayer-2:
    environment:
      <<: *common-env
      RPC_URL: http://hardhat-node:8545
```

**Volume Mounts**:
```yaml
volumes:
  - ./config/oz-relayer/relayer-1.json:/app/config/config.json:ro
  - ./keys/relayer-1:/app/config/keys/relayer-1:ro  # Read-only keystore
```

**Healthcheck** (standardized path):
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/api/v1/health"]
  interval: 10s
  timeout: 5s
  retries: 3
  start_period: 30s
```

### Redis Configuration

**Image**: `redis:8.0-alpine` or `redis:8-alpine` (latest 8.x stable)

**Port**: `6379:6379`

**Persistence**:
```yaml
volumes:
  - msq-relayer-redis-data:/data  # Named volume (prefix for conflict prevention)
command: redis-server --appendonly yes

# Docker Compose volume declaration example
volumes:
  msq-relayer-redis-data:
    driver: local
```

**Healthcheck**:
```yaml
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
  interval: 5s
  timeout: 3s
  retries: 5
```

### MySQL Configuration (Phase 2+ - Transaction History)

**Phase Separation Strategy**: MySQL is selectively enabled with `--profile=mysql` in Phase 2+

**Image**: `mysql:8.0`

**Purpose**: API Gateway's Transaction History storage (Phase 2+)
- Direct/Gasless TX request and status recording
- Webhook event logging
- Transaction query API support

**Port**: `3306:3306`

**Profile Configuration**:
```yaml
services:
  mysql:
    profiles: ["mysql"]  # Only enabled in Phase 2+
    image: mysql:8.0
    # ... rest of configuration
```

**Environment Variables** (directly specified in docker-compose.yaml):
- `MYSQL_ROOT_PASSWORD`: root-password (development use)
- `MYSQL_DATABASE`: msq_relayer
- `MYSQL_USER`: relayer
- `MYSQL_PASSWORD`: relayer-password

**Volume Mounts**:
```yaml
volumes:
  - msq-relayer-mysql-data:/var/lib/mysql  # Named volume (prefix for conflict prevention)

# Docker Compose volume declaration example
volumes:
  msq-relayer-mysql-data:
    driver: local
```

**Healthcheck**:
```yaml
healthcheck:
  test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 30s
```

**Execution Method**:
```bash
# Run with MySQL (Phase 2+)
docker-compose --profile=mysql up

# Run without MySQL (Phase 1, default)
docker-compose up
```

### Key Management Structure

**Directory Structure**:
```
docker/
├── keys-example/                # Git included (sample - Hardhat #10,11,12)
│   ├── relayer-1/keystore.json
│   ├── relayer-2/keystore.json
│   └── relayer-3/keystore.json
└── keys/                        # .gitignore (actual keys)
    ├── relayer-1/keystore.json
    ├── relayer-2/keystore.json
    └── relayer-3/keystore.json

scripts/
└── create-keystore.js           # Keystore generation script (ethers.js)
```

**Environment-specific Key Management Strategy**:

| Environment | Signer Type | Key Location | Description |
|-------------|-------------|--------------|-------------|
| Local (Hardhat) | local | docker/keys-example/ | Sample keystore (Git included) |
| Amoy Testnet | local | docker/keys/ | User-generated keystore (.gitignore) |
| Production | aws_kms | AWS KMS | Keystore files not required |

**Sample Keystore Format** (Hardhat Account #10):
```json
{
  "address": "0x...",
  "crypto": {
    "cipher": "aes-128-ctr",
    "ciphertext": "...",
    "cipherparams": {"iv": "..."},
    "kdf": "scrypt",
    "kdfparams": {...},
    "mac": "..."
  },
  "id": "...",
  "version": 3
}
```

**OZ Relayer Local Signer Configuration** (config/oz-relayer/relayer-1.json):
```json
{
  "relayers": [{
    "id": "relayer-1",
    "name": "MSQ Relayer 1",
    "network": "hardhat",
    "signer": {
      "id": "relayer-1-signer",
      "type": "local",
      "config": {
        "path": "/app/config/keys/relayer-1/keystore.json",
        "passphrase": {
          "type": "env",
          "value": "KEYSTORE_PASSPHRASE"
        }
      }
    }
  }]
}
```

**OZ Relayer AWS KMS Signer Configuration** (Production):
```json
{
  "relayers": [{
    "id": "relayer-1",
    "name": "MSQ Relayer 1 (Production)",
    "network": "polygon",
    "signer": {
      "id": "relayer-1-signer",
      "type": "aws_kms",
      "config": {
        "region": "ap-northeast-2",
        "key_arn": {
          "type": "env",
          "value": "AWS_KMS_KEY_ARN"
        }
      }
    }
  }]
}
```

**Docker Compose Volume Mounts** (docker-compose.yaml):
```yaml
services:
  oz-relayer-1:
    image: ghcr.io/openzeppelin/openzeppelin-relayer:v1.3.0
    volumes:
      - ./keys/relayer-1:/app/config/keys/relayer-1:ro
      - ./config/oz-relayer/relayer-1.json:/app/config/config.json:ro
    environment:
      - KEYSTORE_PASSPHRASE=hardhat-test-passphrase
```

**Keystore Generation Script** (scripts/create-keystore.js):
```javascript
const { Wallet } = require('ethers');
const fs = require('fs');
const readline = require('readline');

async function createKeystore() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (q) => new Promise(resolve => rl.question(q, resolve));

  const privateKey = await question('Private Key (including 0x): ');
  const password = await question('Keystore Password: ');
  const outputPath = await question('Output path (e.g., docker/keys/relayer-1/keystore.json): ');

  const wallet = new Wallet(privateKey);
  const keystore = await wallet.encrypt(password);

  fs.mkdirSync(require('path').dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, keystore);

  console.log(`Keystore created: ${outputPath}`);
  console.log(`Address: ${wallet.address}`);

  rl.close();
}

createKeystore();
```

**.gitignore Configuration**:
```gitignore
# Private Keys (CRITICAL)
docker/keys/

# Sample keys included in Git (for development)
!docker/keys-example/
```

---

## Environment

### Development Environment
- **OS**: macOS / Linux / Windows (Docker Desktop)
- **Docker**: 24.0.0+
- **Docker Compose**: 2.20.0+
- **Network**:
  - Hardhat Node (local blockchain, default)
  - Polygon Amoy Testnet RPC (optional, docker-compose-amoy.yaml)

### Production Environment
- **Container Orchestration**: Kubernetes (EKS) planned (Phase 2+)
- **Network**: Polygon Mainnet RPC accessible
- **Key Management**: AWS KMS (used in Production environment)

---

## Assumptions

1. **Local Development**: Uses Hardhat Node as default blockchain; external RPC endpoint not required.
2. **Sample Keys**: Sample keystore files for local testing are included in Git (using Hardhat default accounts).
3. **Amoy Testing**: When using Polygon Amoy Testnet, docker-compose-amoy.yaml is executed separately.
4. **Docker Permissions**: Docker Desktop or Docker Engine is installed with execution permissions.

---

## Constraints

### Technical Constraints
- **OZ Relayer**: Fixed at v1.3.0 (PRD specification)
- **Redis**: 8.0-alpine (or redis:8-alpine, latest 8.x stable)
- **Docker Compose**: v2.x or higher (v3.x syntax)
- **Phase Separation**: Phase 1 includes core development environment only; Phase 2+ activates additional services via profiles

### Security Constraints
- **Private Key**: Actual production keys must never be committed to Git repository (sample keys are exception)
- **Environment Variables**: Directly specified in docker-compose.yaml (.env file usage prohibited)
- **Health Check**: Internal network access only

### File Location Constraints
- **Docker Files**: All Docker-related files located in `docker/` directory
- **Dockerfile**: `docker/Dockerfile.packages` multi-stage build required
- **Docker Compose**: `docker/docker-compose.yaml`, `docker/docker-compose-amoy.yaml`

### Operational Constraints
- **Minimum Relayers**: 3 or more (guarantee parallel processing)
- **Redis Availability**: 99.9% uptime target
- **Resources**: Minimum 4GB RAM for local development environment

---

## Dependencies

### Technical Dependencies
- **Hardhat Node**: Latest (local blockchain)
- **OZ Relayer**: v1.3.0 (ghcr.io/openzeppelin/openzeppelin-relayer)
- **Redis**: 8.0-alpine (or redis:8-alpine, Docker Hub official image)
- **MySQL**: 8.0 (Phase 2+ only, Docker Hub official image)
- **Docker**: 24.0.0+
- **Docker Compose**: 2.20.0+

### Network Dependencies
- **Hardhat Node**: Local (default, no external RPC required)
- **Polygon Amoy RPC**: Alchemy / Polygon official RPC (optional, docker-compose-amoy.yaml)

### Environment Dependencies
- **Environment Variables**: Directly specified in docker-compose.yaml file
- **Keystore**: `keys/` directory and sample keystore.json files (included in Git)

---

## Non-Functional Requirements

### Performance
- **Container Start Time**: < 30 seconds (cold start)
- **Health Check Response Time**: < 500ms

### Availability
- **Redis Uptime**: >= 99.9%
- **Relayer Uptime**: >= 99.9%

### Security
- **Key Encryption**: Keystore passphrase required
- **Network Isolation**: Use Docker network
- **Environment Variable Isolation**: `.env` file excluded from Git

### Maintainability
- **Configuration Files**: YAML format with comments
- **Environment Variable Template**: `.env.example` provided
- **Documentation**: Installation and execution guide included in README.md

---

## Traceability

### Task Master Integration
- **Task ID**: `1` (Infrastructure Setup)
- **Subtasks**:
  - `1.1`: Write Docker Compose configuration files
  - `1.2`: Generate OZ Relayer configuration files
  - `1.3`: Redis configuration and integration
  - `1.4`: Build Key Management structure
  - `1.5`: Implement Health Check endpoints

### PRD Reference
- **PRD Section 3.1**: Phase 1 Infrastructure requirements
- **PRD Section 7**: Project structure (keys/, config/)
- **PRD Section 9.3**: Docker Compose configuration examples

### Related Documents
- `.taskmaster/docs/prd.txt` (PRD v12.0)
- `README.md` (Project overview)

---

## Completion Checklist

- [x] Docker Compose configuration files implemented (docker-compose.yaml, docker-compose-amoy.yaml)
- [x] Multi-stage Dockerfile.packages for relay-api target
- [x] OZ Relayer v1.3.0 pool configuration (3 relayers with independent keys)
- [x] Redis 8.0-alpine with persistence (AOF) and healthcheck
- [x] Hardhat Node local blockchain integration
- [x] Named volumes with msq-relayer- prefix
- [x] YAML Anchors pattern for configuration reuse
- [x] Key management structure (keys/, keys-example/)
- [x] Health Check endpoints (/api/v1/health) standardized
- [x] API Gateway with Swagger/OpenAPI documentation
- [x] All EARS requirements satisfied:
  - [x] U-INFRA-001 to U-INFRA-009: Ubiquitous requirements
  - [x] E-INFRA-001 to E-INFRA-004: Event-driven requirements
  - [x] S-INFRA-001 to S-INFRA-002: State-driven requirements
  - [x] UW-INFRA-001 to UW-INFRA-003: Unwanted behavior controls
  - [x] O-INFRA-001 to O-INFRA-002: Optional enhancements

## Version Information

- **SPEC Version**: 1.9.0
- **Created**: 2025-12-15
- **Last Updated**: 2025-12-16
- **Completed**: 2025-12-16
- **Status**: Completed

---

## Change History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2025-12-15 | Initial draft (Docker Compose, OZ Relayer Pool, Redis) | manager-spec |
| 1.1.0 | 2025-12-15 | Remove .env, add Hardhat Node, Amoy testnet support, add sample keys | manager-spec |
| 1.2.0 | 2025-12-15 | Add Docker directory structure, add multi-stage Dockerfile.packages, specify file location constraints | manager-spec |
| 1.3.0 | 2025-12-15 | Change volume strategy (remove volumes/ directory, use Named Volume, add prefix), apply relay-api tsx execution method | manager-spec |
| 1.4.0 | 2025-12-15 | Move keys directory under docker/ (keys-example/, keys/), add OZ Relayer local/aws_kms signer configuration, add create-keystore.js script, add environment-specific Key Management strategy table | manager-spec |
| 1.5.0 | 2025-12-15 | Remove SDK target (unnecessary), add API documentation requirements (Swagger/OpenAPI) | manager-spec |
| 1.6.0 | 2025-12-15 | Remove Vault reference (Key Management: local keystore to AWS KMS), add MySQL (for Transaction History) | user |
| 1.7.0 | 2025-12-15 | **Apply Phase separation strategy**: Move MySQL to Phase 2+ (profile activation), apply RELAY_API_KEY single environment variable, add YAML Anchors pattern, standardize Health Check path (/api/v1/health), change Redis version to 8.0-alpine, specify Phase 1 services (hardhat-node, relay-api, oz-relayer 1~3, redis) | manager-spec |
| 1.8.0 | 2025-12-15 | Update related document PRD version reference (v6.1 -> v12.0) | user |
| 1.9.0 | 2025-12-16 | **Mark SPEC as completed** - Phase 1 infrastructure implementation complete with all EARS requirements satisfied, add completion checklist | manager-docs |

---
spec_id: SPEC-INFRA-001
title: Docker Compose Based OZ Relayer Pool and Redis Infrastructure Setup - Implementation Plan
created_at: 2025-12-15
updated_at: 2025-12-15
version: 1.8.0
---

# Implementation Plan: SPEC-INFRA-001

## Overall Overview

Build Docker Compose-based Multi-Relayer Pool, Redis, and Hardhat Node infrastructure to establish the foundation for local development and future production environments. Environment variables are directly specified in docker-compose.yaml instead of .env files, and Hardhat Node is used as the local blockchain.

**Phase Separation Strategy**: Phase 1 includes only core development environment (Hardhat Node, API Gateway, OZ Relayers, Redis). MySQL and Monitoring are selectively enabled via Docker Compose profiles in Phase 2+.

---

## Milestones

### Milestone 1: Project Base Structure and Hardhat Node Creation (Primary Goal)

**Objective**: Initialize Docker directory structure, Docker Compose, Hardhat Node, multi-stage Dockerfile

**Deliverables**:
- Create `docker/` directory
- `docker/Dockerfile.packages` (multi-stage build - relay-api tsx execution, sdk target)
- `docker/docker-compose.yaml` (main configuration, includes Hardhat Node, Named Volume settings)
- `docker/docker-compose-amoy.yaml` (Polygon Amoy Testnet configuration)
- Docker Compose volume declaration (`msq-relayer-redis-data` Named Volume)
- `.gitignore` update (exclude actual key files)
- `config/` directory structure
- `keys/` directory structure (includes sample keystore)
- Hardhat Node container configuration (local blockchain)
- Create sample keystore files (Hardhat accounts #10, #11, #12)

**Dependencies**: None (initial work)

---

### Milestone 2: Redis Service Configuration (Primary Goal - Phase 1 Priority)

**Objective**: Redis 8.0-alpine container setup and persistence configuration (Phase 1 core service)

**Deliverables**:
- Redis service definition (docker-compose.yml)
- Use Redis 8.0-alpine (or redis:8-alpine) image
- Redis data volume setup (Named Volume: msq-relayer-redis-data)
- Redis healthcheck configuration
- Redis connection test script

**Dependencies**: Milestone 1 complete

---

### Milestone 3: OZ Relayer Pool Configuration (Primary Goal)

**Objective**: Setup 3 independent OZ Relayer v1.3.0 services (Hardhat Node connection)

**Deliverables**:
- OZ Relayer service definitions (oz-relayer-1, 2, 3)
- Configuration files for each Relayer (`config/oz-relayer/relayer-{1,2,3}.json`)
- Hardhat Node connection settings (`RPC_URL: http://hardhat-node:8545`)
- **Apply YAML Anchors pattern** (reuse repetitive environment variables)
- Environment variables directly specified in docker-compose.yaml
  - RUST_LOG=info
  - **RELAY_API_KEY**=local-dev-api-key (single environment variable)
  - KEYSTORE_PASSPHRASE=hardhat-test-passphrase
  - RPC_URL=http://hardhat-node:8545
- Relayer healthcheck configuration (**standardized path**: `/api/v1/health`)
- Write docker-compose-amoy.yaml for Amoy configuration (using Polygon Amoy RPC)

**YAML Anchors Example**:
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
```

**Dependencies**: Milestones 1, 2 complete

---

### Milestone 4: Network and Volume Configuration (Secondary Goal)

**Objective**: Docker network and data persistence setup

**Deliverables**:
- Docker network definition (bridge network)
- Named volumes definition (redis-data)
- Inter-service communication setup
- Network isolation verification

**Dependencies**: Milestones 2, 3 complete

---

### Milestone 5: Health Check and Integration Testing (Final Goal)

**Objective**: Complete infrastructure integration verification and Health Check endpoint implementation

**Deliverables**:
- Health check script (`scripts/health-check.sh`)
  - **Standardized Health Check path**: use `/api/v1/health`
- Integration test script (`scripts/test-infra.sh`)
- README.md update (installation and execution guide)
- Troubleshooting guide

**Dependencies**: Milestones 1-4 complete

---

### Phase 2+ Milestone: MySQL and Monitoring Addition (Future Work)

**Objective**: Configure additional services to be selectively enabled in Phase 2+

**Deliverables**:
- MySQL service definition (profile: `mysql`)
  - For Transaction History storage
  - Enabled with `docker-compose --profile=mysql up` command
- Monitoring stack (profile: `monitoring`)
  - OZ Monitor, Prometheus, Grafana
  - Enabled with `docker-compose --profile=monitoring up` command
- Profile-specific execution guide documentation

**Phase Separation Strategy**:
- Phase 1 default execution: `docker-compose up` (MySQL/Monitoring excluded)
- Phase 2+ with MySQL: `docker-compose --profile=mysql up`
- Phase 2+ full: `docker-compose --profile=mysql --profile=monitoring up`

**Dependencies**: Phase 1 Milestones 1-5 complete

---

## Technical Approach

### Docker Directory Structure Strategy

**Directory Structure**:
```
msq-relayer-service/
├── docker/                          # Docker-related files only directory
│   ├── Dockerfile.packages          # Multi-stage build (relay-api tsx, sdk targets)
│   ├── docker-compose.yaml          # Main configuration (includes Hardhat Node)
│   ├── docker-compose-amoy.yaml     # Polygon Amoy Testnet configuration
│   ├── config/
│   │   └── oz-relayer/              # OZ Relayer configuration files
│   │       ├── relayer-1.json
│   │       ├── relayer-2.json
│   │       └── relayer-3.json
│   ├── keys-example/                # Sample keystore (Git included, Hardhat #10,11,12)
│   │   ├── relayer-1/keystore.json
│   │   ├── relayer-2/keystore.json
│   │   └── relayer-3/keystore.json
│   └── keys/                        # Actual keystore (.gitignore)
│       ├── relayer-1/keystore.json
│       ├── relayer-2/keystore.json
│       └── relayer-3/keystore.json
├── scripts/
│   └── create-keystore.js           # Keystore generation script (ethers.js)
└── packages/
    ├── relay-api/                 # NestJS API Gateway
    └── sdk/                         # Client SDK
```

**Volume Strategy**:
- Use Docker Compose internal Named Volume
- Volume name: `msq-relayer-redis-data` (prefix for conflict prevention)
- Do not use external `volumes/` directory

**Dockerfile Structure**:
```dockerfile
# Base stage (common layer)
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

# API Gateway target (tsx execution)
FROM base AS relay-api
COPY packages/relay-api ./packages/relay-api
WORKDIR /app/packages/relay-api
RUN npm install tsx
EXPOSE 3000
CMD ["npx", "tsx", "src/main.ts"]
```

**API Documentation (Swagger/OpenAPI)**:
- NestJS Swagger module integration
- Endpoint: `/api/docs` (Swagger UI)
- Auto-generate OpenAPI 3.0 spec

**Target Specification in Docker Compose**:
```yaml
services:
  relay-api:
    build:
      context: ..                      # Project root
      dockerfile: docker/Dockerfile.packages
      target: relay-api              # Target specification
    ports:
      - "3000:3000"
```

### Docker Compose Configuration Strategy

**Network-specific Configuration Files**:
1. `docker/docker-compose.yaml`: Use Hardhat Node local blockchain (default)
2. `docker/docker-compose-amoy.yaml`: Use Polygon Amoy Testnet

**Execution Method**:
```bash
# Hardhat Node (local development environment)
cd docker && docker-compose up

# Polygon Amoy Testnet
cd docker && docker-compose -f docker-compose-amoy.yaml up
```

**Environment Variable Management**:
- .env file usage prohibited
- All environment variables directly specified in docker-compose.yaml file environment section

### OZ Relayer Configuration File Structure

Each Relayer has an independent configuration file:

**File Location**: `config/oz-relayer/relayer-{N}/config.json`

**Configuration Example**:
```json
{
  "relayers": [{
    "id": "polygon-mainnet-relayer-1",
    "name": "Polygon Mainnet Relayer 1",
    "network": "polygon",
    "signer": {
      "type": "local",
      "keystore": "/app/keys/keystore.json"
    },
    "policies": {
      "gas_price_cap": "500000000000",
      "min_balance": "100000000000000000"
    },
    "notifications": [{
      "type": "webhook",
      "url": "http://relay-api:3000/api/v1/webhook/relayer"
    }]
  }]
}
```

### Redis Configuration Strategy

**Persistence Mode**: AOF (Append-Only File)
- Prevent data loss for transaction queue and nonce management
- Enable `appendonly yes` option

**Memory Policy**: `maxmemory-policy allkeys-lru`
- Remove old keys using LRU algorithm when memory is insufficient

### Hardhat Node Configuration

**Hardhat Node Container**:
- Image: `ethereum/client-go:latest` or Hardhat custom image
- Port: `8545:8545`
- Default account creation: 20 (Hardhat standard)

**Hardhat Default Account Utilization**:
- OZ Relayer 1: Hardhat Account #10
- OZ Relayer 2: Hardhat Account #11
- OZ Relayer 3: Hardhat Account #12

### Key Management Security Strategy

**Environment-specific Strategy**:
| Environment | Signer Type | Key Location | Description |
|-------------|-------------|--------------|-------------|
| Local (Hardhat) | local | docker/keys-example/ | Sample keystore (Git included) |
| Amoy Testnet | local | docker/keys/ | User-generated keystore |
| Production | aws_kms | AWS KMS | Keystore files not required |

**Sample Keystore Generation**:
- Use Hardhat Node default accounts #10, #11, #12
- Include in Git in `docker/keys-example/` directory
- `docker/keys/` directory is .gitignore processed

**OZ Relayer Local Signer Configuration**:
```json
{
  "signer": {
    "id": "relayer-1-signer",
    "type": "local",
    "config": {
      "path": "/app/config/keys/relayer-1/keystore.json",
      "passphrase": { "type": "env", "value": "KEYSTORE_PASSPHRASE" }
    }
  }
}
```

**OZ Relayer AWS KMS Signer Configuration** (Production):
```json
{
  "signer": {
    "id": "relayer-1-signer",
    "type": "aws_kms",
    "config": {
      "region": "ap-northeast-2",
      "key_arn": { "type": "env", "value": "AWS_KMS_KEY_ARN" }
    }
  }
}
```

**File Permissions**:
```bash
chmod 600 docker/keys/relayer-{1,2,3}/keystore.json
chmod 600 docker/keys-example/relayer-{1,2,3}/keystore.json
```

**Docker Volume Mount**: Read-only mode
```yaml
volumes:
  - ./keys/relayer-1:/app/config/keys/relayer-1:ro
  - ./config/oz-relayer/relayer-1.json:/app/config/config.json:ro
```

**Keystore Generation Script** (scripts/create-keystore.js):
```bash
node scripts/create-keystore.js
# Enter Private Key -> Enter Passphrase -> Enter Output path -> keystore.json created
```

**.gitignore Configuration**:
```gitignore
# Private Keys (CRITICAL)
docker/keys/

# Sample keys included in Git (for development)
!docker/keys-example/
```

---

## Architecture Design

### Container Configuration Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                     Docker Network (bridge)                         │
│                                                                     │
│  ┌─────────────────┐                                               │
│  │  Hardhat Node   │  <- Local blockchain (Chain ID: 31337)        │
│  │    (8545)       │                                               │
│  └────────┬────────┘                                               │
│           │                                                         │
│  ┌────────┴────────┬──────────────┬──────────────┐                │
│  │                 │              │              │                 │
│  ▼                 ▼              ▼              ▼                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ oz-relayer-1 │  │ oz-relayer-2 │  │ oz-relayer-3 │            │
│  │   (8081)     │  │   (8082)     │  │   (8083)     │            │
│  │ Account #10  │  │ Account #11  │  │ Account #12  │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│         │                 │                  │                     │
│         └─────────────────┼──────────────────┘                     │
│                           │                                        │
│                  ┌────────▼────────┐                               │
│                  │   Redis (6379)  │                               │
│                  │   (alpine 8.4)  │                               │
│                  └────────┬────────┘                               │
│                           │                                        │
│                  ┌────────▼────────────────────┐                  │
│                  │ msq-relayer-redis-data      │                  │
│                  │ (Named Volume - internal)   │                  │
│                  └─────────────────────────────┘                  │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### Multi-stage Build Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│              Dockerfile.packages (Multi-Stage Build)             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Base Stage (node:20-alpine)                           │    │
│  │  - WORKDIR /app                                        │    │
│  │  - COPY package*.json                                  │    │
│  │  - RUN npm ci                                          │    │
│  └─────────────┬──────────────────────────────────────────┘    │
│                │                                                │
│         ┌──────┴───────┐                                        │
│         │              │                                        │
│  ┌──────▼─────┐  ┌────▼─────────┐                              │
│  │ relay-api │  │     sdk      │                              │
│  │   Target    │  │   Target     │                              │
│  │             │  │              │                              │
│  │ - Build     │  │ - Build      │                              │
│  │ - EXPOSE    │  │ - Publish    │                              │
│  │   3000      │  │   Config     │                              │
│  │ - CMD       │  │ - CMD        │                              │
│  └─────────────┘  └──────────────┘                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Docker Compose usage example:
  relay-api:
    build:
      context: ..
      dockerfile: docker/Dockerfile.packages
      target: relay-api  <- Target specification
```

### Data Flow

1. **Hardhat Node**: Run local blockchain (Chain ID: 31337)
2. **Relayer -> Hardhat Node**: Send transactions (RPC: http://hardhat-node:8545)
3. **Relayer -> Redis**: Query and update Nonce
4. **Redis -> Volume**: AOF file persistence
5. **Health Check -> Relayer/Redis/Hardhat**: Status verification

---

## Risks & Mitigation

### Risk 1: Private Key Exposure

**Likelihood**: Medium
**Impact**: Critical

**Mitigation**:
- Explicitly add `keys/` to `.gitignore`
- Block key file commits with Git pre-commit hook
- Commit only `.env.example`, exclude `.env`
- Specify security warning in README.md

---

### Risk 2: Redis Data Loss

**Likelihood**: Low
**Impact**: High

**Mitigation**:
- Enable AOF (Append-Only File) persistence
- Ensure data persistence through Named volume
- Write regular backup script (Phase 2+)

---

### Risk 3: OZ Relayer Configuration Error

**Likelihood**: Medium
**Impact**: High

**Mitigation**:
- Configuration file JSON Schema validation
- Reference OZ Relayer official documentation
- Test sufficiently in development environment before production deployment
- Automatic failure detection through Health check

---

### Risk 4: Network Connection Failure

**Likelihood**: Medium
**Impact**: High

**Mitigation**:
- Ensure Redis runs first with Relayer's `depends_on` setting
- Utilize Relayer's Redis connection retry logic
- Auto-detect service status with Health check
- Docker Compose restart policy setting (`restart: unless-stopped`)

---

## Testing Strategy

### Unit Tests

**Target**: Verify individual service startup

**Test Items**:
- Redis standalone execution (`docker-compose up redis`)
- OZ Relayer standalone execution (`docker-compose up oz-relayer-1`)
- Health check endpoint response verification

**Tools**: `curl`, `redis-cli`

---

### Integration Tests

**Target**: Complete service integration execution

**Test Items**:
- Simultaneous execution of all services (`docker-compose up`)
- Relayer -> Redis connection verification
- Relayer -> Polygon RPC connection verification
- Complete health check status verification

**Script**: `scripts/test-infra.sh`

---

### Performance Tests

**Target**: Resource usage and response time

**Test Items**:
- Container start time measurement (< 30 seconds)
- Health check response time measurement (< 500ms)
- Redis memory usage monitoring
- Relayer CPU/memory usage monitoring

**Tools**: `docker stats`, `time`, `curl`

---

## Environment Variable Management

### Direct Environment Variable Specification (.env file usage prohibited)

**docker-compose.yaml** (Hardhat Node):

```yaml
services:
  hardhat-node:
    environment:
      - CHAIN_ID=31337
      - NETWORK_ID=31337
      - ACCOUNTS_TO_CREATE=20

  oz-relayer-1:
    environment:
      - RUST_LOG=info
      - RELAY_API_KEY=local-dev-api-key
      - KEYSTORE_PASSPHRASE=hardhat-test-passphrase
      - RPC_URL=http://hardhat-node:8545
      - REDIS_HOST=redis
      - REDIS_PORT=6379

  oz-relayer-2:
    environment:
      - RUST_LOG=info
      - RELAY_API_KEY=local-dev-api-key
      - KEYSTORE_PASSPHRASE=hardhat-test-passphrase
      - RPC_URL=http://hardhat-node:8545
      - REDIS_HOST=redis
      - REDIS_PORT=6379

  oz-relayer-3:
    environment:
      - RUST_LOG=info
      - RELAY_API_KEY=local-dev-api-key
      - KEYSTORE_PASSPHRASE=hardhat-test-passphrase
      - RPC_URL=http://hardhat-node:8545
      - REDIS_HOST=redis
      - REDIS_PORT=6379
```

**docker-compose-amoy.yaml** (Polygon Amoy Testnet):

```yaml
services:
  oz-relayer-1:
    environment:
      - RUST_LOG=info
      - RELAY_API_KEY=local-dev-api-key
      - KEYSTORE_PASSPHRASE=amoy-test-passphrase
      - RPC_URL=https://polygon-amoy.g.alchemy.com/v2/YOUR_API_KEY
      - REDIS_HOST=redis
      - REDIS_PORT=6379
```

---

## Deliverables Checklist

### Configuration Files
- [ ] Create `docker/` directory
- [ ] `docker/Dockerfile.packages` (multi-stage build - relay-api tsx, sdk targets)
- [ ] `docker/docker-compose.yaml` (main configuration, includes Hardhat Node, Named Volume settings)
- [ ] `docker/docker-compose-amoy.yaml` (Polygon Amoy Testnet)
- [ ] Docker Compose volume declaration (`msq-relayer-redis-data`)
- [ ] `.gitignore` update (exclude actual key files only)

### OZ Relayer Configuration
- [ ] `config/oz-relayer/relayer-1/config.json`
- [ ] `config/oz-relayer/relayer-2/config.json`
- [ ] `config/oz-relayer/relayer-3/config.json`

### Hardhat Node Configuration
- [ ] Hardhat Node container configuration
- [ ] Port exposure (8545:8545)
- [ ] Default account creation (20)

### Key Management
- [ ] Create `docker/keys-example/` directory (Git included)
- [ ] `docker/keys-example/relayer-1/keystore.json` (Hardhat Account #10 sample)
- [ ] `docker/keys-example/relayer-2/keystore.json` (Hardhat Account #11 sample)
- [ ] `docker/keys-example/relayer-3/keystore.json` (Hardhat Account #12 sample)
- [ ] Create `docker/keys/` directory (.gitignore)
- [ ] `docker/keys/README.md` (keystore generation guide)

### OZ Relayer Configuration
- [ ] `docker/config/oz-relayer/relayer-1.json` (local signer configuration)
- [ ] `docker/config/oz-relayer/relayer-2.json` (local signer configuration)
- [ ] `docker/config/oz-relayer/relayer-3.json` (local signer configuration)

### Scripts
- [ ] `scripts/health-check.sh` (Health check script)
- [ ] `scripts/test-infra.sh` (Integration test script)
- [ ] `scripts/create-keystore.js` (ethers.js based keystore generation script)

### Documentation
- [ ] `README.md` update (installation and execution guide)
- [ ] `docs/INFRASTRUCTURE.md` (detailed infrastructure documentation)
- [ ] `docs/TROUBLESHOOTING.md` (troubleshooting guide)

---

## Next Steps

### Immediate Execution
1. Execute `/moai:2-run SPEC-INFRA-001` after SPEC approval
2. Write Health Check script first with TDD cycle
3. Write and test Docker Compose files

### Phase 1 Follow-up Work
1. Add API Gateway service (SPEC-BACKEND-001)
2. Smart Contracts deployment (SPEC-CONTRACTS-001)
3. Complete integration testing

### Phase 2+ Planning
1. Write Kubernetes manifests
2. HashiCorp Vault integration
3. Prometheus + Grafana monitoring

---

## References

### Official Documentation
- [OZ Relayer Documentation](https://github.com/OpenZeppelin/openzeppelin-relayer)
- [Redis Documentation](https://redis.io/docs/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)

### Internal Documentation
- `.taskmaster/docs/prd.txt` (PRD v12.0)
- `README.md` (Project overview)

---

**Plan Version**: 1.8.0
**Created**: 2025-12-15
**Last Updated**: 2025-12-15

---

## Change History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.8.0 | 2025-12-15 | Unify environment variable naming - API_KEY to RELAY_API_KEY (consistency with tech.md, spec.md), update PRD reference version (v6.1 to v12.0) | manager-spec |
| 1.7.0 | 2025-12-15 | Document version sync - align with prd.txt v12.0, docs v12.0 | manager-spec |
| 1.0.0 | 2025-12-15 | Initial draft | manager-spec |
| 1.1.0 | 2025-12-15 | Remove .env, add Hardhat Node, separate Amoy configuration, add sample keys | manager-spec |
| 1.2.0 | 2025-12-15 | Add Docker directory structure, add multi-stage Dockerfile.packages, update architecture diagram | manager-spec |
| 1.3.0 | 2025-12-15 | Change volume strategy (remove volumes/, use Named Volume), apply relay-api tsx execution method, update architecture diagram | manager-spec |
| 1.4.0 | 2025-12-15 | Move keys directory under docker/, add OZ Relayer local/aws_kms signer configuration, add create-keystore.js script, add environment-specific Key Management strategy table | manager-spec |
| 1.5.0 | 2025-12-15 | Remove SDK target, add API documentation requirements (Swagger/OpenAPI) | manager-spec |
| 1.6.0 | 2025-12-15 | **Reflect Phase separation strategy**: Emphasize Redis Phase 1 priority in Milestone 2, add YAML Anchors pattern and RELAY_API_KEY single environment variable in Milestone 3, standardize Health Check path (/api/v1/health), add Phase 2+ Milestone (MySQL/Monitoring profile activation) | manager-spec |

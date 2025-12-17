---
spec_id: SPEC-INFRA-001
title: Docker Compose Based OZ Relayer Pool and Redis Infrastructure Setup - Acceptance Criteria
created_at: 2025-12-15
updated_at: 2025-12-15
version: 1.8.0
---

# Acceptance Criteria: SPEC-INFRA-001

## Overview

This document defines the completion criteria for Docker Compose-based OZ Relayer Pool, Redis, and Hardhat Node infrastructure setup. All scenarios are written in Given-When-Then format.

**Phase Separation Strategy**: Phase 1 verifies only core development environment (Hardhat Node, API Gateway, OZ Relayers, Redis). MySQL and Monitoring-related tests will be conducted in a separate SPEC in Phase 2+.

---

## Acceptance Test Scenarios

### Scenario 0A: Docker Directory Structure Verification

**Purpose**: Verify that Docker-related files are properly located in the `docker/` directory

#### Given-When-Then

**Given**:
- Project root directory exists

**When**:
```bash
ls -la docker/
```

**Then**:
- `docker/` directory must exist
- `docker/Dockerfile.packages` file must exist
- `docker/docker-compose.yaml` file must exist
- `docker/docker-compose-amoy.yaml` file must exist
- `docker/config/oz-relayer/` directory must exist
- `docker/keys-example/` directory must exist (sample keys)
- `docker/keys/` directory must exist (actual keys)
- `docker/volumes/` directory must NOT exist (using Named Volumes)

**Verification Method**:
```bash
# Check directory structure
tree docker/
# Expected output:
# docker/
# ├── Dockerfile.packages
# ├── docker-compose.yaml
# ├── docker-compose-amoy.yaml
# ├── config/
# │   └── oz-relayer/
# │       ├── relayer-1.json
# │       ├── relayer-2.json
# │       └── relayer-3.json
# ├── keys-example/
# │   ├── relayer-1/keystore.json
# │   ├── relayer-2/keystore.json
# │   └── relayer-3/keystore.json
# └── keys/
#     └── (actual keystore files - .gitignore)

# Check file existence
test -f docker/Dockerfile.packages && echo "✓ Dockerfile.packages exists"
test -f docker/docker-compose.yaml && echo "✓ docker-compose.yaml exists"
test -f docker/docker-compose-amoy.yaml && echo "✓ docker-compose-amoy.yaml exists"
test -d docker/config/oz-relayer && echo "✓ config/oz-relayer/ directory exists"
test -d docker/keys-example && echo "✓ keys-example/ directory exists"
test -d docker/keys && echo "✓ keys/ directory exists"
test ! -d docker/volumes && echo "✓ volumes/ directory does not exist (using Named Volumes)"
```

---

### Scenario 0B: Dockerfile Target Verification

**Purpose**: Verify that Dockerfile.packages is written with relay-api target

#### Given-When-Then

**Given**:
- `docker/Dockerfile.packages` file exists

**When**:
```bash
grep -E "^FROM .* AS (base|relay-api)" docker/Dockerfile.packages
```

**Then**:
- `FROM node:20-alpine AS base` stage must exist
- `FROM base AS relay-api` target must exist

**Verification Method**:
```bash
# Check Base stage
grep "FROM node:20-alpine AS base" docker/Dockerfile.packages
# Expected output: FROM node:20-alpine AS base

# Check API Gateway target
grep "FROM base AS relay-api" docker/Dockerfile.packages
# Expected output: FROM base AS relay-api
```

---

### Scenario 0C: relay-api Target Build Success (tsx execution)

**Purpose**: Verify that relay-api target builds successfully with tsx

#### Given-When-Then

**Given**:
- `docker/Dockerfile.packages` file exists
- `packages/relay-api/` directory exists

**When**:
```bash
cd docker
docker build -f Dockerfile.packages --target relay-api -t msq-relay-api:test ..
```

**Then**:
- Build must succeed without errors
- `msq-relay-api:test` image must be created
- Port 3000 must be EXPOSEd in the image
- CMD must be set to `["npx", "tsx", "src/main.ts"]`

**Verification Method**:
```bash
# Check image creation
docker images | grep "msq-relay-api"
# Expected output: msq-relay-api  test  <IMAGE_ID>  <CREATED>  <SIZE>

# Check port exposure
docker inspect msq-relay-api:test | grep -i "exposedports" -A 3
# Expected output: "ExposedPorts": { "3000/tcp": {} }

# Check CMD
docker inspect msq-relay-api:test | grep -i "cmd" -A 5
# Expected output: "Cmd": ["npx", "tsx", "src/main.ts"]
```

---

### Scenario 0: Hardhat Node Basic Execution

**Purpose**: Verify that Hardhat Node starts properly and default accounts are generated

#### Given-When-Then

**Given**:
- Docker Desktop or Docker Engine is running
- docker-compose.yaml file is prepared

**When**:
```bash
cd docker
docker-compose up hardhat-node -d
```

**Then**:
- Hardhat Node container must be in `running` state
- Port 8545 must be properly exposed
- 20 test accounts must be automatically generated
- Chain ID must be 31337

**Verification Method**:
```bash
# Check container status
docker-compose ps hardhat-node

# Check Chain ID
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
# Response: {"result":"0x7a69"} (31337)

# Check account list
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}'
# 20 account addresses should be returned
```

---

### Scenario 1: Docker Compose Basic Execution (Phase 1 - Hardhat Node)

**Purpose**: Verify that only core development environment services run properly with Phase 1 default Docker Compose command

#### Given-When-Then

**Given**:
- Docker Desktop or Docker Engine is running
- Sample keystore files exist in `keys/` directory
- Environment variables are directly specified in docker-compose.yaml (YAML Anchors pattern applied)

**When**:
```bash
cd docker
docker-compose up -d
```

**Then**:
- **Only Phase 1 core services run**: hardhat-node, relay-api, oz-relayer-1, oz-relayer-2, oz-relayer-3, redis
- **MySQL/Monitoring services not running**: mysql, oz-monitor, prometheus, grafana must not be running
- All Phase 1 containers must be running within 30 seconds
- Hardhat Node must run with Chain ID 31337
- No error logs

**Verification Method**:
```bash
docker-compose ps
# Verify Phase 1 services (hardhat-node, relay-api, oz-relayer-1~3, redis) are "Up"
# MySQL/Monitoring services should not be in the list

docker-compose logs hardhat-node
# Verify Hardhat Node started normally

docker-compose logs
# Verify no error logs

# Check Phase 1 service count (6)
docker-compose ps | grep "Up" | wc -l
# Expected output: 6 (hardhat-node, relay-api, oz-relayer-1, oz-relayer-2, oz-relayer-3, redis)
```

---

### Scenario 2: Redis Connection Verification

**Purpose**: Verify that OZ Relayer connects properly to Redis

#### Given-When-Then

**Given**:
- All services are running via Docker Compose
- Redis container is in `running` state

**When**:
```bash
docker-compose exec redis redis-cli ping
```

**Then**:
- `PONG` response must be returned
- OZ Relayer logs must show Redis connection success message

**Verification Method**:
```bash
docker-compose logs oz-relayer-1 | grep -i "redis"
# Check for "Connected to Redis" or similar message
```

---

### Scenario 3: Health Check Endpoint Response (Standardized Path)

**Purpose**: Verify that each OZ Relayer's Health Check endpoint responds properly at standardized path (`/api/v1/health`)

#### Given-When-Then

**Given**:
- All services are running via Docker Compose
- OZ Relayer containers are in `healthy` state

**When**:
```bash
curl -f http://localhost:8081/api/v1/health
curl -f http://localhost:8082/api/v1/health
curl -f http://localhost:8083/api/v1/health
```

**Then**:
- Each endpoint must return HTTP 200 response
- Response time must be less than 500ms
- JSON format status information must be returned

**Expected Response**:
```json
{
  "status": "ok",
  "relayer_id": "polygon-mainnet-relayer-1",
  "redis_connected": true,
  "network_connected": true
}
```

---

### Scenario 4: Multi-Relayer Pool Independence

**Purpose**: Verify that each Relayer uses independent configuration and Private Key

#### Given-When-Then

**Given**:
- All Relayer services are running via Docker Compose
- Each Relayer has separate configuration file and keystore

**When**:
```bash
docker-compose exec oz-relayer-1 cat /app/config/config.json
docker-compose exec oz-relayer-2 cat /app/config/config.json
docker-compose exec oz-relayer-3 cat /app/config/config.json
```

**Then**:
- Each configuration file's `relayer.id` value must be different
- Each Relayer's keystore path must be independent
- All 3 Relayers must be in running state

**Verification Method**:
```bash
docker-compose ps | grep "oz-relayer" | wc -l
# Output: 3 (3 Relayers are running)
```

---

### Scenario 5: Private Key Security (Git Exclusion)

**Purpose**: Verify that actual Private Key files are not committed to Git repository, and sample keys are included

#### Given-When-Then

**Given**:
- Actual keystore.json files exist in `docker/keys/` directory
- Sample keystore.json files exist in `docker/keys-example/` directory
- `docker/keys/` path is added to `.gitignore`

**When**:
```bash
git status --ignored
```

**Then**:
- `docker/keys/` directory must appear in `Ignored files` section
- `docker/keys-example/` directory must be tracked in Git (included)
- `.env` file must also be ignored

**Verification Method**:
```bash
# Check actual keys directory is ignored
git status --ignored | grep "docker/keys/"
# "docker/keys/" path should be in Ignored list

# Check sample keys directory is tracked
git ls-files docker/keys-example/
# Sample keystore files should appear in the list

git add docker/keys/
# "The following paths are ignored by one of your .gitignore files" warning should appear
```

---

### Scenario 6: Redis Data Persistence (Named Volume)

**Purpose**: Verify that Redis data persists after container restart via Named Volume

#### Given-When-Then

**Given**:
- Redis is running via Docker Compose
- `msq-relayer-redis-data` Named Volume is created
- Test data is stored in Redis

**When**:
```bash
# Store data
docker-compose exec redis redis-cli SET test-key "test-value"

# Restart Redis container
docker-compose restart redis

# Query data
docker-compose exec redis redis-cli GET test-key
```

**Then**:
- `test-value` must be retrieved properly after restart
- `msq-relayer-redis-data` Named Volume must exist
- AOF file must be stored in Named Volume

**Verification Method**:
```bash
# Check Named Volume
docker volume ls | grep "msq-relayer-redis-data"
# Expected output: msq-relayer-redis-data

# Check Volume details
docker volume inspect msq-relayer-redis-data
# Check Mountpoint path

# Check AOF file existence
ls -la $(docker volume inspect msq-relayer-redis-data -f '{{.Mountpoint}}')
# appendonly.aof file should exist
```

---

### Scenario 6B: Named Volume Prefix Verification

**Purpose**: Verify that volume names have `msq-relayer-` prefix applied to prevent conflicts with other projects

#### Given-When-Then

**Given**:
- All services are running via Docker Compose

**When**:
```bash
docker volume ls
```

**Then**:
- All volume names must start with `msq-relayer-` prefix
- `msq-relayer-redis-data` volume must exist

**Verification Method**:
```bash
# Check volume list
docker volume ls | grep "msq-relayer"
# Expected output: msq-relayer-redis-data

# Verify no volumes without prefix
docker volume ls | grep -v "msq-relayer" | grep -v "DRIVER"
# Expected output: (Empty or volumes from other projects)
```

---

### Scenario 7: Hardhat Node Connection Verification

**Purpose**: Verify that OZ Relayer connects properly to Hardhat Node

#### Given-When-Then

**Given**:
- All services are running via Docker Compose
- Hardhat Node container is in `running` state

**When**:
```bash
# Verify Hardhat Node JSON-RPC connection
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

**Then**:
- Chain ID `0x7a69` (31337) must be returned
- OZ Relayer logs must show Hardhat Node connection success message

**Expected Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x7a69"
}
```

**Verification Method**:
```bash
docker-compose logs oz-relayer-1 | grep -i "connected"
# Check for "Connected to RPC" or similar message
```

---

### Scenario 8: Service Restart Policy

**Purpose**: Verify that automatic restart works on container failure

#### Given-When-Then

**Given**:
- All services are running via Docker Compose
- `restart: unless-stopped` policy is applied

**When**:
```bash
# Force terminate oz-relayer-1 container
docker-compose kill oz-relayer-1

# Wait 10 seconds
sleep 10

# Check status
docker-compose ps oz-relayer-1
```

**Then**:
- oz-relayer-1 container must automatically restart within 10 seconds
- Container must recover to `running` state
- Restart message must be logged

**Verification Method**:
```bash
docker-compose logs oz-relayer-1 --tail=20
# Check for "Starting relayer..." message
```

---

### Scenario 9: Health Check Script Execution

**Purpose**: Verify that integrated Health Check script checks status of all services

#### Given-When-Then

**Given**:
- All services are running via Docker Compose
- `scripts/health-check.sh` script exists

**When**:
```bash
chmod +x scripts/health-check.sh
./scripts/health-check.sh
```

**Then**:
- Script must exit with code 0
- Status of each service must be output:
  - Redis: OK
  - oz-relayer-1: OK
  - oz-relayer-2: OK
  - oz-relayer-3: OK

**Expected Output**:
```
Checking service health...
✓ Redis: OK
✓ oz-relayer-1: OK
✓ oz-relayer-2: OK
✓ oz-relayer-3: OK
All services are healthy.
```

---

### Scenario 10: Amoy Testnet Connection Verification

**Purpose**: Verify connection to Polygon Amoy Testnet using docker-compose-amoy.yaml

#### Given-When-Then

**Given**:
- Docker Desktop or Docker Engine is running
- docker-compose-amoy.yaml file is prepared
- Polygon Amoy RPC URL is configured

**When**:
```bash
cd docker
docker-compose -f docker-compose-amoy.yaml up -d
```

**Then**:
- OZ Relayers must connect to Polygon Amoy RPC
- Health Check endpoint must respond properly
- Amoy Testnet Chain ID (80002) must be verified

**Verification Method**:
```bash
# Check Relayer logs
docker-compose -f docker-compose-amoy.yaml logs oz-relayer-1 | grep -i "amoy"

# Check Health Check
curl -f http://localhost:8081/api/v1/health
```

---

### Scenario 11: Sample Keystore Usage Verification

**Purpose**: Verify that sample keystore files are used properly

#### Given-When-Then

**Given**:
- `docker/keys-example/relayer-1/keystore.json` sample file exists
- Hardhat Account #10's key is stored in keystore
- `docker/config/oz-relayer/relayer-1.json` has local signer configuration

**When**:
```bash
cd docker
# For local testing: symbolic link or copy keys-example
cp -r keys-example/* keys/
docker-compose up oz-relayer-1 -d
```

**Then**:
- oz-relayer-1 must successfully load keystore
- Hardhat Account #10 address must be used by Relayer
- Must start without errors

**Verification Method**:
```bash
docker-compose logs oz-relayer-1 | grep -i "keystore"
# Check for "Loaded keystore" or similar message

docker-compose logs oz-relayer-1 | grep -i "address"
# Check Hardhat Account #10 address
```

---

### Scenario 11B: Keystore Generation Script Verification

**Purpose**: Verify that `scripts/create-keystore.js` script works properly

#### Given-When-Then

**Given**:
- `scripts/create-keystore.js` script exists
- `ethers` package is installed

**When**:
```bash
# Test Hardhat Account #10 private key
echo "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
test-password
docker/keys/relayer-test/keystore.json" | node scripts/create-keystore.js
```

**Then**:
- `docker/keys/relayer-test/keystore.json` file must be created
- File format must be Ethereum keystore v3 JSON
- Must be decryptable with passphrase

**Verification Method**:
```bash
# Check file existence
test -f docker/keys/relayer-test/keystore.json && echo "✓ Keystore created"

# Check JSON format
cat docker/keys/relayer-test/keystore.json | jq '.version'
# Expected output: 3

# Check Address
cat docker/keys/relayer-test/keystore.json | jq '.address'
# Check Hardhat Account #10 address
```

---

### Scenario 11C: YAML Anchors Pattern Verification

**Purpose**: Verify that YAML Anchors pattern is applied to docker-compose.yaml to reuse repetitive environment variables

#### Given-When-Then

**Given**:
- `docker/docker-compose.yaml` file exists

**When**:
```bash
grep -A 10 "x-common-env:" docker/docker-compose.yaml
```

**Then**:
- `x-common-env: &common-env` anchor must be defined
- `RUST_LOG`, `RELAY_API_KEY`, `KEYSTORE_PASSPHRASE`, `REDIS_HOST`, `REDIS_PORT` environment variables must be included
- oz-relayer services must reuse common environment variables with `<<: *common-env` pattern

**Verification Method**:
```bash
# Check Anchor definition
grep "x-common-env: &common-env" docker/docker-compose.yaml
# Expected output: x-common-env: &common-env

# Check Anchor reference
grep "<<: \*common-env" docker/docker-compose.yaml
# Expected output: Referenced from oz-relayer-1, oz-relayer-2, oz-relayer-3 services

# Check RELAY_API_KEY environment variable
grep "RELAY_API_KEY" docker/docker-compose.yaml
# Expected output: RELAY_API_KEY: local-dev-api-key (single environment variable)
```

---

### Scenario 11D: Phase 2+ Profile Verification

**Purpose**: Verify that Phase 2+ services are defined as profiles and disabled in default execution

#### Given-When-Then

**Given**:
- `docker/docker-compose.yaml` file exists

**When**:
```bash
grep -A 5 "profiles:" docker/docker-compose.yaml
```

**Then**:
- `mysql` service must have `profiles: ["mysql"]` configuration
- `oz-monitor`, `prometheus`, `grafana` services must have `profiles: ["monitoring"]` configuration
- Profile services must not start with default `docker-compose up` execution

**Verification Method**:
```bash
# Default execution (exclude profile services)
docker-compose config --services
# Expected output: hardhat-node, relay-api, oz-relayer-1, oz-relayer-2, oz-relayer-3, redis (mysql/monitoring excluded)

# MySQL profile execution
docker-compose --profile=mysql config --services
# Expected output: above services + mysql

# Monitoring profile execution
docker-compose --profile=monitoring config --services
# Expected output: above services + oz-monitor, prometheus, grafana
```

---

### Scenario 12: Integration Test Script Execution (Phase 1 Focused)

**Purpose**: Verify that Phase 1 core infrastructure integration tests complete successfully

#### Given-When-Then

**Given**:
- All services are running via Docker Compose
- `scripts/test-infra.sh` script exists

**When**:
```bash
chmod +x scripts/test-infra.sh
./scripts/test-infra.sh
```

**Then**:
- Script must exit with code 0
- Following **Phase 1 tests** must all pass:
  - Docker Compose Phase 1 service execution verification (6 services)
  - Hardhat Node connection test
  - Redis connection test
  - OZ Relayer Health Check (standardized path: `/api/v1/health`)
  - Inter-service network communication test
  - YAML Anchors pattern application verification
  - Phase 2+ profile services not running verification

**Expected Output**:
```
Running infrastructure tests (Phase 1)...
✓ Docker Compose Phase 1 services are running (6/6)
✓ Hardhat Node connection test passed (Chain ID: 31337)
✓ Redis connection test passed
✓ OZ Relayer-1 health check passed (/api/v1/health)
✓ OZ Relayer-2 health check passed (/api/v1/health)
✓ OZ Relayer-3 health check passed (/api/v1/health)
✓ Network connectivity test passed
✓ YAML Anchors pattern validated
✓ Phase 2+ services not running (mysql, monitoring)
All Phase 1 tests passed successfully.
```

---

## Quality Gates

### TRUST 5 Framework Criteria

#### Test-first
- [ ] All Health Check endpoints must respond properly at standardized path (`/api/v1/health`)
- [ ] Phase 1 integration test script must succeed (6 services)
- [ ] Redis connection and persistence tests must pass
- [ ] YAML Anchors pattern must be applied to remove environment variable duplication
- [ ] Phase 2+ profile services must be disabled in default execution

#### Readable
- [ ] Docker Compose files must include comments
- [ ] `.env.example` must have descriptions for all environment variables
- [ ] README.md must include installation and execution guide

#### Unified
- [ ] All Relayer configuration files must follow same structure
- [ ] Naming conventions must be consistent (relayer-1, relayer-2, relayer-3)
- [ ] Volume and network naming must follow project rules

#### Secured
- [ ] Actual production key files (`keystore-prod.json`) must be included in `.gitignore`
- [ ] Sample key files (`keystore.json`) must be included in Git for documentation
- [ ] .env files must not be used; environment variables must be directly specified in docker-compose.yaml
- [ ] Keystore files must be mounted in read-only mode
- [ ] Health Check endpoints must be accessible only from internal network (production)

#### Trackable
- [ ] All Relayer logs must be recorded according to `RUST_LOG` level
- [ ] Redis AOF file must be stored in named volume
- [ ] Health Check response must include relayer_id

---

## Performance Criteria

### Response Time
- [ ] Container start time: < 30 seconds (cold start)
- [ ] Hardhat Node start time: < 10 seconds
- [ ] Health Check response time: < 500ms
- [ ] Redis ping response time: < 10ms
- [ ] Hardhat Node JSON-RPC response time: < 100ms

### Resource Usage
- [ ] Redis memory usage: < 500MB (development environment)
- [ ] OZ Relayer CPU usage: < 10% (idle state)
- [ ] Docker volume disk usage: < 1GB (initial state)

### Availability
- [ ] Redis uptime: >= 99.9% (including restarts)
- [ ] OZ Relayer uptime: >= 99.9% (including restarts)
- [ ] Service restart time: < 10 seconds

---

## Definition of Done

### Mandatory Conditions
1. ✅ All Given-When-Then scenarios must pass
2. ✅ All TRUST 5 Framework criteria must be met
3. ✅ All performance criteria must be satisfied
4. ✅ Integration test script must succeed

### Documentation Conditions
1. ✅ README.md must include installation and execution guide
2. ✅ `docs/INFRASTRUCTURE.md` must include architecture diagrams
3. ✅ `docs/TROUBLESHOOTING.md` must include troubleshooting guide

### Security Conditions
1. ✅ Actual production Private Key files must be excluded from Git
2. ✅ Sample keystore files must be included in Git (using Hardhat default accounts)
3. ✅ .env files must not be used; environment variables must be directly specified in docker-compose.yaml

---

## Verification Methods

### Automated Verification
```bash
# 1. Run integration tests
./scripts/test-infra.sh

# 2. Run Health Check
./scripts/health-check.sh

# 3. Verify Hardhat Node connection
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

# 4. Git security verification
git status --ignored | grep "keystore-prod.json"
```

### Manual Verification
1. Docker Compose execution verification (including Hardhat Node)
2. Hardhat Node Chain ID verification (31337)
3. Redis data persistence verification
4. OZ Relayer log verification (Hardhat Node connection)
5. Direct Health Check endpoint call
6. Amoy testnet connection verification (docker-compose-amoy.yaml)

---

## Regression Tests

### Re-verification Items for Future Changes
- [ ] Docker Compose file changes: Re-run all scenarios
- [ ] Environment variable additions: Update and verify YAML Anchors pattern
- [ ] Hardhat Node version upgrade: Verify Chain ID and account generation
- [ ] OZ Relayer version upgrade: Test Health Check (`/api/v1/health`) and Hardhat Node connection
- [ ] Redis version upgrade: Test persistence
- [ ] Phase 2+ profile additions: Verify profile separation and default execution impact

---

**Acceptance Criteria Version**: 1.8.0
**Created**: 2025-12-15
**Last Updated**: 2025-12-15

---

## Change History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.8.0 | 2025-12-15 | Modify Scenario 10 Health Check endpoint (/health to /api/v1/health) - ensure document-wide consistency | manager-spec |
| 1.7.0 | 2025-12-15 | Document version sync - align with prd.txt v12.0, docs v12.0 | manager-spec |
| 1.0.0 | 2025-12-15 | Initial draft | manager-spec |
| 1.1.0 | 2025-12-15 | Add Hardhat Node scenario, Amoy testnet scenario, sample key verification | manager-spec |
| 1.2.0 | 2025-12-15 | Add Docker directory structure scenario, multi-stage build verification, reflect docker/ path | manager-spec |
| 1.3.0 | 2025-12-15 | Remove volumes/ directory, add Named Volume verification, add relay-api tsx execution verification, add volume prefix verification scenario | manager-spec |
| 1.4.0 | 2025-12-15 | Move keys directory under docker/ (keys-example/, keys/), OZ Relayer local signer configuration verification, add create-keystore.js script scenario | manager-spec |
| 1.5.0 | 2025-12-15 | Remove SDK target verification, API documentation verification will be conducted in separate SPEC | manager-spec |
| 1.6.0 | 2025-12-15 | **Reflect Phase separation strategy**: Add Phase 1 services only execution verification in Scenario 1, standardize Health Check path (/api/v1/health) in Scenario 3, add YAML Anchors pattern verification in Scenario 11C, add Phase 2+ profile verification in Scenario 11D, modify Scenario 12 integration test to Phase 1 focused, add Phase separation checklist in Quality Gates | manager-spec |

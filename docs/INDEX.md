# Documentation Index

**Version**: 1.1.0
**Last Updated**: 2026-01-02
**Status**: Phase 2 Complete

This index helps you navigate MSQ Relayer Service documentation efficiently.

---

## Quick Navigation

### For Project Overview
- **[product.md](./product.md)** - What are we building? Business requirements, milestones, success metrics
- **[README.md](../README.md)** - Project overview, quick start, API examples

### For System Architecture
- **[structure.md](./structure.md)** - Where is everything? Directory structure, module organization, architecture diagrams

### For Technical Implementation
- **[tech.md](./tech.md)** - How do we implement it? Technical specifications, API details
  - [Section 1: Core Services](./tech.md#1-core-services-technical-stack-oz-open-source) - OZ Relayer, Monitor, Nginx
  - [Section 2: API Gateway](./tech.md#2-api-gateway-technical-stack-custom-development) - NestJS, ethers.js
  - [Section 3: Authentication](./tech.md#3-authentication--security-spec-auth-001) - API Key, security
  - [Section 4: Smart Contracts](./tech.md#4-smart-contracts-technical-stack-spec-contracts-001) - ERC2771, deployment
  - [Section 5: Phase 2 Modules](./tech.md#5-phase-2-modules-spec-webhook-001) - Redis, MySQL, Webhooks (NEW)
  - [Section 6: API Specifications](./tech.md#6-api-specifications) - Endpoint details, responses
  - [Section 8: E2E Tests](./tech.md#8-e2e-test-infrastructure-spec-e2e-001) - Test architecture

### For Testing
- **[TESTING.md](./TESTING.md)** - Complete testing guide (Unit + E2E)
  - [Unit Tests](./TESTING.md#unit-tests) - How to run unit tests
  - [E2E Tests](./TESTING.md#e2e-tests-spec-e2e-001) - E2E test suite overview
  - [3-Tier Lookup Tests](./TESTING.md#3-tier-lookup-tests-phase-2) - Redis/MySQL/OZ Relayer tests (NEW)
  - [Webhook Tests](./TESTING.md#webhook-handler-tests-phase-2) - HMAC verification tests (NEW)
  - [Test Files](./TESTING.md#e2e-test-files) - Directory structure and utilities
  - [Running Tests](./TESTING.md#running-e2e-tests-with-options) - Command reference
  - [Troubleshooting](./TESTING.md#troubleshooting) - Common issues and solutions

### For Smart Contracts
- **[CONTRACTS_GUIDE.md](./CONTRACTS_GUIDE.md)** - Contract integration and usage patterns
- **[tech.md - Section 4](./tech.md#4-smart-contracts-technical-stack-spec-contracts-001)** - Technical specifications

### For Docker and Deployment
- **[DOCKER_SETUP.md](./DOCKER_SETUP.md)** - Docker configuration, container setup, local development

### For Operations (Phase 2)
- **[operations.md](./operations.md)** - Operations guide with Phase 2 additions
  - [Database Operations](./operations.md#5-database-operations-phase-2) - MySQL, Prisma management (NEW)
  - [Redis Management](./operations.md#6-redis-management-phase-2) - Cache operations (NEW)
  - [Webhook Configuration](./operations.md#7-webhook-configuration-phase-2) - Setup and testing (NEW)

---

## By Use Case

### I want to...

#### Set up the project locally
1. Read: [README.md - Quick Start](../README.md#quick-start)
2. Read: [DOCKER_SETUP.md](./DOCKER_SETUP.md)
3. Run: `docker compose -f docker/docker-compose.yaml up -d`

#### Understand the system architecture
1. Read: [product.md](./product.md) - Business overview
2. Read: [structure.md](./structure.md) - Directory structure and architecture diagrams

#### Implement a new API endpoint
1. Read: [tech.md - Section 6](./tech.md#6-api-specifications) - API spec format
2. Read: [tech.md - Section 2](./tech.md#2-api-gateway-technical-stack-custom-development) - Implementation patterns
3. Review: Existing endpoints in [tech.md - Section 5](./tech.md#5-api-examples-and-responses) for examples

#### Write tests
1. Read: [TESTING.md - Unit Tests](./TESTING.md#unit-tests) - For unit tests
2. Read: [TESTING.md - E2E Tests](./TESTING.md#e2e-tests-spec-e2e-001) - For E2E tests
3. Reference: [TESTING.md - Test Fixtures](./TESTING.md#test-fixtures-and-utilities) - For utilities

#### Deploy to production
1. Read: [DOCKER_SETUP.md](./DOCKER_SETUP.md) - Container setup
2. Read: [tech.md - Section 1](./tech.md#1-core-services-technical-stack-oz-open-source) - Service configuration
3. Review: [tech.md - Section 11](./tech.md#11-docker-compose-configuration) - Compose configuration

#### Integrate smart contracts
1. Read: [CONTRACTS_GUIDE.md](./CONTRACTS_GUIDE.md) - Integration guide
2. Read: [tech.md - Section 4](./tech.md#4-smart-contracts-technical-stack-spec-contracts-001) - Technical specs
3. Reference: [README.md - Smart Contracts](../README.md#smart-contracts) - Quick start

#### Troubleshoot issues
1. Check: [README.md - Troubleshooting](../README.md#troubleshooting)
2. Check: [TESTING.md - Troubleshooting](./TESTING.md#troubleshooting)
3. Read: Relevant technical section in [tech.md](./tech.md)

#### Work with Phase 2 features (3-Tier Lookup, Webhooks)
1. Read: [tech.md - Section 5](./tech.md#5-phase-2-modules-spec-webhook-001) - Phase 2 module specs
2. Read: [structure.md - Section 5.3, 5.4](./structure.md#53-3-tier-lookup-flow-phase-2) - Phase 2 architecture diagrams
3. Read: [operations.md](./operations.md#5-database-operations-phase-2) - Database and Redis operations
4. Test: [TESTING.md](./TESTING.md#3-tier-lookup-tests-phase-2) - Phase 2 test cases

---

## By Role

### Project Manager / Product Owner
- **[product.md](./product.md)** - Requirements, milestones, success metrics
- **[README.md](../README.md)** - Project overview and status
- **[DOCKER_SETUP.md](./DOCKER_SETUP.md)** - Deployment guide

### Backend Developer
- **[tech.md - Section 2](./tech.md#2-api-gateway-technical-stack-custom-development)** - API Gateway implementation
- **[tech.md - Section 5](./tech.md#5-phase-2-modules-spec-webhook-001)** - Phase 2 modules (Redis, MySQL, Webhooks)
- **[tech.md - Section 6](./tech.md#6-api-specifications)** - API specifications
- **[TESTING.md](./TESTING.md)** - Testing guide (unit + E2E)
- **[operations.md](./operations.md)** - Database and Redis operations
- **[CONTRACTS_GUIDE.md](./CONTRACTS_GUIDE.md)** - Contract integration

### DevOps / Infrastructure
- **[DOCKER_SETUP.md](./DOCKER_SETUP.md)** - Docker configuration
- **[tech.md - Section 1](./tech.md#1-core-services-technical-stack-oz-open-source)** - Service architecture
- **[tech.md - Section 11](./tech.md#11-docker-compose-configuration)** - Compose configuration
- **[operations.md](./operations.md)** - Operations guide (MySQL, Redis, Webhooks)

### QA / Test Engineer
- **[TESTING.md](./TESTING.md)** - Comprehensive testing guide
- **[tech.md - Section 8](./tech.md#8-e2e-test-infrastructure-spec-e2e-001)** - E2E test architecture
- **[README.md - Testing](../README.md#unit-and-e2e-tests)** - Test execution

### Smart Contract Developer
- **[CONTRACTS_GUIDE.md](./CONTRACTS_GUIDE.md)** - Integration guide
- **[tech.md - Section 4](./tech.md#4-smart-contracts-technical-stack-spec-contracts-001)** - Technical specs
- **[README.md - Smart Contracts](../README.md#smart-contracts)** - Quick start

---

## Document Details

### product.md
**Purpose**: WHAT/WHY - Business requirements and goals
**Audience**: Project managers, stakeholders
**Key Sections**:
- Project overview
- Functional requirements (Direct TX, Gasless TX, Status polling)
- Non-functional requirements
- Milestones and timeline
- Success metrics

### structure.md
**Purpose**: WHERE - System organization and directory structure
**Audience**: All developers
**Key Sections**:
- Directory structure
- Package organization
- Module relationships
- Data flow

### tech.md
**Purpose**: HOW - Technical implementation details
**Audience**: Backend developers, architects
**Key Sections** (13 sections):
1. Core Services (OZ Relayer, Monitor, Nginx)
2. API Gateway (NestJS, ethers.js)
3. Authentication & Security
4. Smart Contracts
5. Phase 2 Modules (Redis, MySQL, Webhooks) - NEW
6. API Specifications
7. API Examples
8. EIP-712 TypedData Structure
9. E2E Test Infrastructure
10. Rate Limiting & Quota
11. Authorization & Policy
12. Docker Compose Configuration
13. Licensing

### TESTING.md
**Purpose**: How to test (unit + E2E)
**Audience**: QA engineers, developers
**Key Sections**:
- Unit tests overview (187 tests)
- E2E tests comprehensive guide (74 tests)
- 3-Tier Lookup tests (Phase 2) - NEW
- Webhook Handler tests (Phase 2) - NEW
- Test fixtures and utilities
- Mock OZ Relayer strategy
- Quality metrics
- Troubleshooting
- CI/CD integration

### CONTRACTS_GUIDE.md
**Purpose**: Smart contract integration
**Audience**: Smart contract developers, backend engineers
**Key Sections**:
- Contract deployment
- Integration patterns
- Usage examples
- Verification

### DOCKER_SETUP.md
**Purpose**: Docker configuration and deployment
**Audience**: DevOps, infrastructure engineers
**Key Sections**:
- Docker Compose setup
- Local development
- Testnet deployment
- Troubleshooting

---

## Quick Command Reference

### Local Development

```bash
# Start all services (API, Relayers, Redis, Hardhat)
docker compose -f docker/docker-compose.yaml up -d

# View logs
docker compose logs -f relay-api

# Stop services
docker compose down

# Run tests
pnpm --filter relay-api test              # Unit tests (187 tests)
pnpm --filter relay-api test:e2e          # E2E tests (74 tests)
pnpm --filter relay-api test --coverage   # Coverage report
```

### API Testing

```bash
# Health check
curl http://localhost:3000/api/v1/health

# Direct transaction
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "x-api-key: local-dev-api-key" \
  -H "Content-Type: application/json" \
  -d '{"to": "0x...", "data": "0x", "speed": "fast"}'

# Query status
curl http://localhost:3000/api/v1/relay/status/{txId} \
  -H "x-api-key: local-dev-api-key"

# Swagger API docs
curl http://localhost:3000/api/docs
```

---

## Related Resources

### Specifications (in .moai/specs/)
- **SPEC-E2E-001**: E2E Test Infrastructure
  - [Specification](../.moai/specs/SPEC-E2E-001/spec.md)
  - [Acceptance Criteria](../.moai/specs/SPEC-E2E-001/acceptance.md)
  - [Implementation Plan](../.moai/specs/SPEC-E2E-001/plan.md)

- **SPEC-PROXY-001**: Nginx Load Balancer Architecture
- **SPEC-GASLESS-001**: Gasless Transaction Implementation
- **SPEC-STATUS-001**: Status Polling API
- **SPEC-CONTRACTS-001**: Smart Contracts
- **SPEC-WEBHOOK-001**: TX History & Webhook Handler (Phase 2) - NEW

### Reports (in .moai/reports/)
- [Sync Report SPEC-E2E-001](../.moai/reports/sync-report-SPEC-E2E-001-20251223.md)
- [Sync Summary E2E](../.moai/reports/SYNC-SUMMARY-E2E-001.md)

---

## Version History

| Document | Version | Last Updated | Status |
|----------|---------|--------------|--------|
| README.md | 12.6 | 2026-01-02 | Phase 2 Complete |
| product.md | 12.5 | 2026-01-02 | Phase 2 Complete |
| structure.md | 12.4 | 2026-01-02 | Phase 2 Complete |
| tech.md | 12.8 | 2026-01-02 | Phase 2 Complete |
| TESTING.md | 1.2.0 | 2026-01-02 | Phase 2 Complete |
| operations.md | 1.1.0 | 2026-01-02 | Phase 2 Complete |
| CONTRACTS_GUIDE.md | 1.0 | 2025-12-19 | Current |
| DOCKER_SETUP.md | 1.0 | 2025-12-19 | Current |
| INDEX.md | 1.1.0 | 2026-01-02 | Phase 2 Complete |

---

## How to Use This Index

1. **Quick lookup**: Use the table of contents at the top to jump to relevant section
2. **By use case**: Find "I want to..." section for your specific need
3. **By role**: Find your role to see priority documents
4. **Deep dive**: Click links to specific documentation sections
5. **Cross-reference**: See "Related Resources" for specifications and reports

---

## Feedback and Updates

If you find documentation that needs updates:
1. Create an issue in the project
2. Propose changes in a pull request
3. Update this index when adding new documentation

---

**Documentation Index**
- Version: 1.1.0
- Last Updated: 2026-01-02
- Maintained by: Manager-Docs Agent

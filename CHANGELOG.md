# Changelog

All notable changes to the Solo Relayer Service project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- SPEC-DISCOVERY-001: Relayer Discovery Service (v1.0.0)
  - Centralized health check system for OZ Relayers
  - Redis-based active relayer list management
  - HTTP health checks with configurable intervals
  - Monitoring API endpoint (GET /status)
  - Zero-based naming convention migration (oz-relayer-0, 1, 2)
  - Graceful shutdown support
  - 98.29% unit test coverage, 80%+ integration test coverage

### Changed
- **BREAKING**: Migrated to zero-based relayer naming convention
  - Old: oz-relayer-1, oz-relayer-2, oz-relayer-3
  - New: oz-relayer-0, oz-relayer-1, oz-relayer-2
  - Keystore filenames: relayer-0.json, relayer-1.json, relayer-2.json
  - Redis key prefixes: oz-relayer-0, oz-relayer-1, oz-relayer-2
  - Docker service names updated in docker-compose.yaml

### Migration Guide
See [packages/relayer-discovery/README.md](./packages/relayer-discovery/README.md#zero-based-naming-convention) for migration steps.

---

## [2.0.0] - 2026-01-06 (Queue System Integration)

### Added
- SPEC-QUEUE-001: Async queue system with AWS SQS and LocalStack
  - Non-blocking transaction submission (fire-and-forget pattern)
  - SQS message queue with Dead Letter Queue (DLQ)
  - Long-polling support (20-second wait time)
  - Retry logic with 3 attempts before DLQ
  - Dual credentials strategy (LocalStack for dev, AWS for prod)
  - queue-consumer service for async transaction processing
  - Idempotency checks to prevent duplicate processing
  - Comprehensive queue integration documentation

### Changed
- relay-api: Updated to async transaction submission pattern
  - POST /relay/direct returns 202 Accepted immediately
  - POST /relay/gasless returns 202 Accepted immediately
  - Transaction ID returned for status queries
- 3-Tier lookup system: Redis L1 → MySQL L2 → OZ Relayer L3
- Enhanced webhook handling with oz_relayer_url tracking

### Documentation
- Added QUEUE_INTEGRATION.md
- Added SQS_SETUP.md
- Added ARCHITECTURE.md (queue system flows)
- Updated DEPLOYMENT.md for queue configuration

---

## [1.1.0] - 2025-12-15 (Smart Routing & Fire-and-Forget)

### Added
- SPEC-ROUTING-001: Smart routing and fire-and-forget pattern
  - Multi-relayer health checks with 10-second TTL caching
  - Intelligent load balancing across 3 OZ Relayers
  - Health check caching for < 100ms routing performance
  - Webhook integration for transaction updates
  - Fire-and-forget pattern documentation

### Documentation
- Added SMART_ROUTING_GUIDE.md
- Added FIRE_AND_FORGET_PATTERN.md
- Added SPEC_ROUTING_001_IMPLEMENTATION.md
- Added WEBHOOK_INTEGRATION.md

---

## [1.0.0] - 2025-11-01 (Initial Release)

### Added
- NestJS API Gateway (relay-api)
  - Direct transaction API (POST /relay/direct)
  - Gasless transaction API (POST /relay/gasless)
  - Transaction status query (GET /relay/status/:id)
  - API key authentication
  - Swagger documentation
- OZ Relayer integration
  - 3-relayer pool setup
  - Docker Compose configuration
  - Keystore management
- Redis caching layer
  - Transaction status caching
  - 10-second TTL for health checks
- MySQL transaction storage
  - Prisma ORM integration
  - Transaction history tracking
- Smart contract support
  - ERC2771Forwarder integration
  - Meta-transaction support
  - Hardhat deployment scripts
- Docker infrastructure
  - Multi-stage builds
  - LocalStack for AWS services
  - Hardhat local blockchain
  - Redis and MySQL containers
- Comprehensive testing
  - Unit tests with Jest
  - E2E tests with Supertest
  - Integration tests for OZ Relayer
- Documentation
  - Product requirements (product.md)
  - System architecture (structure.md)
  - Technical specifications (tech.md)
  - Docker setup guide (DOCKER_SETUP.md)
  - Testing guide (TESTING.md)
  - Contracts guide (CONTRACTS_GUIDE.md)

---

## Version History Summary

| Version | Release Date | Key Features | Breaking Changes |
|---------|--------------|--------------|------------------|
| Unreleased | TBD | Relayer Discovery Service | Zero-based naming |
| 2.0.0 | 2026-01-06 | Queue System Integration | None |
| 1.1.0 | 2025-12-15 | Smart Routing & Fire-and-Forget | None |
| 1.0.0 | 2025-11-01 | Initial Release | N/A |

---

## Breaking Changes Guide

### Zero-Based Naming (Unreleased → Next Release)

**Impact**: Docker service names, keystore files, Redis keys

**Migration Steps**:
1. Stop all services: `docker compose down`
2. Rename keystore files:
   - `docker/keys/relayer-1.json` → `docker/keys/relayer-0.json`
   - `docker/keys/relayer-2.json` → `docker/keys/relayer-1.json`
   - `docker/keys/relayer-3.json` → `docker/keys/relayer-2.json`
3. Update docker-compose.yaml service names:
   - `oz-relayer-1` → `oz-relayer-0`
   - `oz-relayer-2` → `oz-relayer-1`
   - `oz-relayer-3` → `oz-relayer-2`
4. Update environment variables for OZ Relayers:
   - `REDIS_KEY_PREFIX=oz-relayer-0` (was oz-relayer-1)
   - `REDIS_KEY_PREFIX=oz-relayer-1` (was oz-relayer-2)
   - `REDIS_KEY_PREFIX=oz-relayer-2` (was oz-relayer-3)
5. Clear Redis state: `redis-cli FLUSHDB`
6. Restart services: `docker compose up -d`
7. Verify: `redis-cli SMEMBERS relayer:active`

**Rollback Procedure**:
1. Stop services: `docker compose down`
2. Revert keystore filenames and docker-compose.yaml
3. Clear Redis: `redis-cli FLUSHDB`
4. Restart: `docker compose up -d`

---

## Contributing

When adding changes to this CHANGELOG:
1. Add entries under `[Unreleased]` section
2. Follow [Keep a Changelog](https://keepachangelog.com/) format
3. Group changes by type: Added, Changed, Deprecated, Removed, Fixed, Security
4. Include SPEC references for major features
5. Document breaking changes with migration guides
6. Update version history table

---

**Last Updated**: 2026-01-19
**Maintained by**: MSQ Relayer Service Team

# Relayer Discovery Service

**Centralized health check and active relayer management for Solo Relayer Service**

Part of the Solo Relayer Service monorepo - A self-hosted blockchain transaction relay system.

## Overview

The Relayer Discovery Service performs active health checks on all configured OpenZeppelin (OZ) Relayers and maintains a centralized active relayer list in Redis. This enables the queue-consumer service to dynamically discover healthy relayers without hardcoded configuration.

### Key Features

- **Active Health Checks**: HTTP health checks every 10 seconds (configurable)
- **Redis-Based State Management**: Centralized active relayer list in Redis Set
- **Configuration-Based Scaling**: Add/remove relayers via environment variables (restart required)
- **Zero-Based Naming Convention**: Consistent with Kubernetes StatefulSet patterns (oz-relayer-0, oz-relayer-1, oz-relayer-2)
- **Monitoring API**: GET /status endpoint for operational visibility
- **Graceful Shutdown**: Clean termination with proper Redis connection cleanup
- **High Test Coverage**: 98.29% unit tests, 80%+ integration tests

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────┐
│         Relayer Discovery Service                   │
│                                                      │
│  ┌──────────────┐    ┌──────────────┐              │
│  │   HTTP       │    │   Redis      │              │
│  │   Health     │───▶│   State      │              │
│  │   Checker    │    │   Manager    │              │
│  └──────────────┘    └──────────────┘              │
│         │                    │                      │
└─────────┼────────────────────┼──────────────────────┘
          │                    │
          ▼                    ▼
  ┌─────────────┐      ┌─────────────┐
  │ OZ Relayers │      │    Redis    │
  │  (Health)   │      │  relayer:   │
  │             │      │   active    │
  └─────────────┘      └─────────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │    Queue    │
                       │  Consumer   │
                       └─────────────┘
```

### Health Check Flow

```
1. Discovery Service starts
   ↓
2. Read RELAYER_COUNT from environment
   ↓
3. For each relayer (oz-relayer-0 to oz-relayer-{N-1}):
   ├─ Send HTTP GET to http://oz-relayer-{N}:3000/health
   ├─ Timeout: 500ms (configurable via HEALTH_CHECK_TIMEOUT_MS)
   │
   ├─ Success (HTTP 200)
   │  └─▶ SADD relayer:active oz-relayer-{N}
   │
   └─ Failure (timeout/error)
      └─▶ SREM relayer:active oz-relayer-{N}
   ↓
4. Wait HEALTH_CHECK_INTERVAL_MS
   ↓
5. Repeat from step 3
```

### Redis Key Schema

| Key | Type | Description | Example Value |
|-----|------|-------------|---------------|
| `relayer:active` | Set | Active relayer identifiers | `["oz-relayer-0", "oz-relayer-1"]` |

**Note**: Future Phase 2 may introduce `relayer:status:{N}` (Redis Hash) for detailed status tracking (last check time, error count, etc.).

## Configuration

### Environment Variables

| Variable | Type | Default | Range | Description |
|----------|------|---------|-------|-------------|
| `RELAYER_COUNT` | Integer | `3` | 1-10 | Number of relayers to monitor |
| `HEALTH_CHECK_INTERVAL_MS` | Integer | `10000` | 1000-60000 | Health check frequency (milliseconds) |
| `HEALTH_CHECK_TIMEOUT_MS` | Integer | `500` | 100-5000 | HTTP request timeout (milliseconds) |
| `REDIS_HOST` | String | `localhost` | - | Redis server hostname |
| `REDIS_PORT` | Integer | `6379` | - | Redis server port |
| `PORT` | Integer | `3001` | - | HTTP server port for /status endpoint |

### Example Configuration

```bash
# docker-compose.yaml
services:
  relayer-discovery:
    image: relayer-discovery:latest
    environment:
      RELAYER_COUNT: 3
      HEALTH_CHECK_INTERVAL_MS: 10000
      HEALTH_CHECK_TIMEOUT_MS: 500
      REDIS_HOST: redis
      REDIS_PORT: 6379
      PORT: 3001
    ports:
      - "3001:3001"
    depends_on:
      - redis
      - oz-relayer-0
      - oz-relayer-1
      - oz-relayer-2
```

## API Reference

### GET /status

Retrieve current discovery service status and active relayer list.

**Endpoint**: `GET /status`

**Response** (200 OK):
```json
{
  "service": "relayer-discovery",
  "status": "healthy",
  "timestamp": "2026-01-19T10:30:00.000Z",
  "activeRelayers": [
    {
      "id": "oz-relayer-0",
      "status": "healthy",
      "lastCheckTimestamp": "2026-01-19T10:29:55.000Z",
      "url": "http://oz-relayer-0:3000"
    },
    {
      "id": "oz-relayer-1",
      "status": "healthy",
      "lastCheckTimestamp": "2026-01-19T10:29:55.000Z",
      "url": "http://oz-relayer-1:3000"
    }
  ],
  "totalConfigured": 3,
  "totalActive": 2,
  "healthCheckInterval": 10000
}
```

**Status Determination**:
- `healthy`: totalActive >= totalConfigured (all relayers active)
- `degraded`: 0 < totalActive < totalConfigured (some relayers down)
- `unhealthy`: totalActive = 0 (no active relayers available)

**Example Usage**:
```bash
curl http://localhost:3001/status | jq
```

## Development Guide

### Prerequisites

- Node.js 20.x+
- pnpm 8.0+
- Redis 7.x+
- Docker (for integration tests)

### Local Setup

```bash
# Navigate to package directory
cd packages/relayer-discovery

# Install dependencies
pnpm install

# Build TypeScript
pnpm run build

# Start in development mode
pnpm run start:dev
```

### Running Tests

```bash
# Unit tests (98.29% coverage)
pnpm run test

# Integration tests (80%+ coverage)
pnpm run test:integration

# Test coverage report
pnpm run test:cov

# Watch mode
pnpm run test:watch
```

### Code Quality

```bash
# Lint and fix
pnpm run lint

# Type checking
pnpm run build
```

## Docker Deployment

### Build Image

```bash
# From project root
docker build -f packages/relayer-discovery/Dockerfile -t relayer-discovery:latest .
```

### Run Container

```bash
docker run -d \
  --name relayer-discovery \
  -e RELAYER_COUNT=3 \
  -e HEALTH_CHECK_INTERVAL_MS=10000 \
  -e HEALTH_CHECK_TIMEOUT_MS=500 \
  -e REDIS_HOST=redis \
  -e REDIS_PORT=6379 \
  -e PORT=3001 \
  -p 3001:3001 \
  relayer-discovery:latest
```

### Docker Compose Integration

See `docker/docker-compose.yaml` in the project root for complete multi-service setup.

```bash
# Start all services (including relayer-discovery)
docker compose -f docker/docker-compose.yaml up -d

# View logs
docker compose -f docker/docker-compose.yaml logs -f relayer-discovery

# Stop services
docker compose -f docker/docker-compose.yaml down
```

## Operational Guide

### Monitoring

**Health Check Endpoint**:
```bash
curl http://localhost:3001/status
```

**Redis State Verification**:
```bash
# Check active relayers
redis-cli SMEMBERS relayer:active

# Expected output:
# 1) "oz-relayer-0"
# 2) "oz-relayer-1"
# 3) "oz-relayer-2"
```

**Logs Monitoring**:
```bash
# View real-time logs
docker compose logs -f relayer-discovery

# Filter health check logs
docker compose logs relayer-discovery | grep "Health check"
```

### Scaling Relayers

**To add relayers**:
1. Update `RELAYER_COUNT` environment variable (e.g., from 3 to 5)
2. Deploy additional OZ Relayer instances (oz-relayer-3, oz-relayer-4)
3. Restart relayer-discovery service
4. Verify: `redis-cli SMEMBERS relayer:active`

**To remove relayers**:
1. Update `RELAYER_COUNT` environment variable (e.g., from 5 to 3)
2. Restart relayer-discovery service
3. Remove unused OZ Relayer instances
4. Verify: `redis-cli SMEMBERS relayer:active`

**Note**: Configuration changes require service restart. No runtime auto-scaling is supported.

### Troubleshooting

**Issue: Relayer not appearing in active list**

```bash
# 1. Check relayer health endpoint directly
curl http://oz-relayer-0:3000/health

# 2. Check relayer-discovery logs for errors
docker compose logs relayer-discovery | grep "oz-relayer-0"

# 3. Verify RELAYER_COUNT configuration
docker compose exec relayer-discovery env | grep RELAYER_COUNT
```

**Issue: Redis connection failures**

```bash
# 1. Verify Redis is running
docker compose ps redis

# 2. Check Redis connectivity
redis-cli ping

# 3. Check relayer-discovery logs
docker compose logs relayer-discovery | grep "Redis"
```

**Issue: Health checks timing out**

```bash
# 1. Increase timeout (edit docker-compose.yaml)
HEALTH_CHECK_TIMEOUT_MS: 1000  # Increase from 500ms to 1000ms

# 2. Restart service
docker compose restart relayer-discovery

# 3. Monitor health check duration
docker compose logs relayer-discovery | grep "Health check completed"
```

### Graceful Shutdown

The service supports graceful shutdown via SIGTERM:

```bash
# Send SIGTERM signal
docker compose stop relayer-discovery

# Logs show:
# - "Shutting down discovery service..."
# - "Closing Redis connection..."
# - "Discovery service stopped"
```

## Integration with Queue Consumer

The queue-consumer service queries Redis for active relayers:

```typescript
// queue-consumer/src/services/relayer-router.service.ts
const activeRelayers = await redis.smembers('relayer:active');
// Returns: ["oz-relayer-0", "oz-relayer-1", "oz-relayer-2"]

const relayerUrls = activeRelayers.map(id => `http://${id}:3000`);
// Returns: ["http://oz-relayer-0:3000", "http://oz-relayer-1:3000", ...]
```

**Migration Path**:
- **Before**: queue-consumer reads `OZ_RELAYER_URLS` from environment variables
- **After**: queue-consumer reads `relayer:active` from Redis dynamically

See [SPEC-DISCOVERY-001](../../.moai/specs/SPEC-DISCOVERY-001/spec.md) for complete integration requirements.

## Zero-Based Naming Convention

This service adopts zero-based naming for consistency with Kubernetes StatefulSet patterns:

| Old Naming (1-based) | New Naming (0-based) |
|----------------------|----------------------|
| oz-relayer-1 | oz-relayer-0 |
| oz-relayer-2 | oz-relayer-1 |
| oz-relayer-3 | oz-relayer-2 |

**Keystore Filenames**: `relayer-0.json`, `relayer-1.json`, `relayer-2.json`

**Docker Service Names**: `oz-relayer-0`, `oz-relayer-1`, `oz-relayer-2`

**Redis Prefixes**: `oz-relayer-0`, `oz-relayer-1`, `oz-relayer-2`

**Note**: This migration is part of SPEC-DISCOVERY-001. See migration guide in project documentation.

## Performance Metrics

### Health Check Latency

| Metric | Target | Actual |
|--------|--------|--------|
| Average | < 200ms | ~120ms |
| P95 | < 400ms | ~180ms |
| P99 | < 500ms | ~250ms |

### Redis Update Latency

| Metric | Target | Actual |
|--------|--------|--------|
| SADD/SREM | < 100ms | ~5ms |
| SMEMBERS | < 50ms | ~2ms |

### Monitoring Endpoint

| Metric | Target | Actual |
|--------|--------|--------|
| /status response | < 100ms | ~30ms |

## Test Coverage

```bash
# Unit Tests
- discovery.service.spec.ts: 98.29% coverage
- redis.service.spec.ts: 100% coverage
- status.controller.spec.ts: 100% coverage
- discovery.config.spec.ts: 100% coverage

# Integration Tests
- discovery.integration.spec.ts: 80%+ coverage
```

**Coverage Thresholds** (enforced in package.json):
- Branches: 90%
- Functions: 90%
- Lines: 90%
- Statements: 90%

## Related Documentation

- **SPEC**: [SPEC-DISCOVERY-001](../../.moai/specs/SPEC-DISCOVERY-001/spec.md) - Complete specification
- **Acceptance Criteria**: [acceptance.md](../../.moai/specs/SPEC-DISCOVERY-001/acceptance.md) - Test scenarios
- **Project README**: [../../README.md](../../README.md) - Project overview
- **Architecture**: [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) - System architecture

## Technology Stack

- **Framework**: NestJS 10.4.0
- **Language**: TypeScript 5.6.3
- **Redis Client**: ioredis 5.8.2
- **HTTP Client**: @nestjs/axios 3.0.0 (Axios wrapper)
- **Testing**: Jest 29.7.0
- **Runtime**: Node.js 20.x

## Contributing

This package follows the project-wide development standards:

1. Write tests first (TDD approach)
2. Maintain >= 90% test coverage
3. Follow TypeScript and ESLint conventions
4. Update documentation with code changes
5. Add acceptance criteria for new features

## License

Part of Solo Relayer Service (AGPL-3.0 + MIT dual license)

---

**Version**: 1.0.0
**Last Updated**: 2026-01-19
**Status**: Production Ready (SPEC-DISCOVERY-001 Complete)

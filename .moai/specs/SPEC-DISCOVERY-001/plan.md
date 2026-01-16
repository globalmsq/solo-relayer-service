# SPEC-DISCOVERY-001: Implementation Plan

## Executive Summary

### Problem Statement

The current msq-relayer-service architecture has the following limitations:

1. **In-memory health checks**: The `queue-consumer` package maintains health check state with 10-second TTL, limiting observability and coordination
2. **Manual scaling**: Adding or removing relayers requires code changes and redeployment
3. **1-based naming**: Current naming convention (oz-relayer-1,2,3) is inconsistent with zero-indexing standards
4. **No operational visibility**: Lack of centralized monitoring for relayer health status

### Solution Approach

Implement a **Relayer Discovery Service** with the following architecture:

- **Centralized health checking**: New `relayer-discovery` service performs active HTTP health checks
- **Redis-based state**: Active relayer list stored in Redis for shared access across services
- **0-based naming**: Migrate to oz-relayer-0,1,2 convention
- **Monitoring API**: Expose GET /status endpoint for operational visibility
- **Config-based scaling**: Scale by updating `RELAYER_COUNT` and restarting services (no runtime auto-scaling)

### Expected Benefits

| Benefit | Impact |
|---------|--------|
| **Centralized visibility** | Single source of truth for relayer health status |
| **Simplified scaling** | Configuration-based scaling without code changes |
| **Improved failover** | Faster detection and response to relayer failures |
| **Operational monitoring** | Real-time visibility into active relayer pool |
| **Standards alignment** | 0-based naming prepares for Kubernetes migration |

---

## Technical Architecture

### System Diagram (Textual Description)

```
┌─────────────────────────────────────────────────────────────┐
│                    External Systems                          │
│                  (AWS SQS, Blockchain)                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   queue-consumer                             │
│  - Polls SQS for relay requests                              │
│  - Queries Redis for active relayer list                     │
│  - Routes requests to healthy relayers                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ SMEMBERS relayer:active
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                        Redis                                 │
│  Key: relayer:active (Set)                                   │
│  Values: ["oz-relayer-0", "oz-relayer-1", "oz-relayer-2"]   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ SADD/SREM updates
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  relayer-discovery                           │
│  - Reads RELAYER_COUNT from env                              │
│  - Performs HTTP health checks every 10s                     │
│  - Updates Redis active list                                 │
│  - Exposes GET /status for monitoring                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTP GET /health
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              OZ Relayers (0-based naming)                    │
│  - oz-relayer-0 (http://oz-relayer-0:3000)                   │
│  - oz-relayer-1 (http://oz-relayer-1:3000)                   │
│  - oz-relayer-2 (http://oz-relayer-2:3000)                   │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### 1. relayer-discovery Service (NEW)

**Responsibilities:**
- Read `RELAYER_COUNT` and `HEALTH_CHECK_INTERVAL_MS` from environment
- Construct relayer URLs: `http://oz-relayer-{0..N-1}:3000/health`
- Execute HTTP health checks with 500ms timeout
- Update Redis `relayer:active` set (SADD for healthy, SREM for unhealthy)
- Expose GET /status endpoint for monitoring
- Log health check results and emit metrics

**Technology:**
- Framework: NestJS 10.4.0
- Redis: ioredis 5.8.2
- HTTP: axios
- Port: 3001 (internal)

#### 2. queue-consumer Service (MODIFIED)

**Responsibilities:**
- Query Redis `relayer:active` for current active relayer list
- Remove dependency on `OZ_RELAYER_URLS` environment variable
- Construct relayer URLs dynamically based on active list
- Route relay requests to healthy relayers with round-robin + failover

**Changes:**
- Modify `RelayerRouterService` to read from Redis
- Add Redis connection and query logic
- Remove hardcoded relayer URL list

#### 3. Redis (EXISTING)

**Responsibilities:**
- Store active relayer list in `relayer:active` key (Redis Set)
- Provide atomic SADD/SREM/SMEMBERS operations
- Enable shared state between relayer-discovery and queue-consumer

**Schema:**
```
Key: relayer:active
Type: Set
Values: ["oz-relayer-0", "oz-relayer-1", "oz-relayer-2"]
TTL: None (persistent)
```

#### 4. OZ Relayers (MODIFIED - Naming Only)

**Responsibilities:**
- Expose GET /health endpoint (already exists)
- Process relay requests (no changes)

**Changes:**
- Rename from oz-relayer-1,2,3 to oz-relayer-0,1,2
- Update `REDIS_KEY_PREFIX` environment variable
- Update keystore file paths

### Data Flow

#### Health Check Flow

1. **relayer-discovery** reads `RELAYER_COUNT=3` from environment
2. **relayer-discovery** constructs URLs: `["http://oz-relayer-0:3000/health", "http://oz-relayer-1:3000/health", "http://oz-relayer-2:3000/health"]`
3. **relayer-discovery** sends parallel HTTP GET requests with 500ms timeout
4. For each successful response (HTTP 200):
   - Execute `SADD relayer:active oz-relayer-{N}`
   - Log: `"oz-relayer-{N} is healthy"`
5. For each failed response (timeout or non-200):
   - Execute `SREM relayer:active oz-relayer-{N}`
   - Log: `"oz-relayer-{N} is unhealthy, removed from active list"`
6. Wait for `HEALTH_CHECK_INTERVAL_MS` (default 10000ms)
7. Repeat from step 3

#### Relay Request Routing Flow

1. **queue-consumer** receives relay request from SQS
2. **queue-consumer** executes `SMEMBERS relayer:active` to get current active list
3. **queue-consumer** receives: `["oz-relayer-0", "oz-relayer-2"]` (oz-relayer-1 is down)
4. **queue-consumer** selects next relayer using round-robin algorithm
5. **queue-consumer** sends relay request to selected relayer
6. If relay fails, **queue-consumer** retries with next relayer in active list

#### Monitoring Flow

1. Operator executes `curl http://relayer-discovery:3001/status`
2. **relayer-discovery** executes `SMEMBERS relayer:active`
3. **relayer-discovery** retrieves last health check timestamps from memory
4. **relayer-discovery** constructs JSON response (see IR-005 in spec.md)
5. Operator receives active relayer list with status and timestamps

---

## Implementation Phases

### Phase 1: relayer-discovery Service Creation

**Objective:** Create new NestJS service with health check and Redis integration.

**Scope:**
- New package: `packages/relayer-discovery`
- Core service logic: Health check loop, Redis updates
- Configuration: Environment variables
- Testing: Unit tests for health check and Redis operations

**Duration:** 2-3 hours

### Phase 2: queue-consumer Integration

**Objective:** Modify queue-consumer to read from Redis instead of environment variables.

**Scope:**
- Modify `RelayerRouterService` to query Redis
- Remove `OZ_RELAYER_URLS` dependency
- Integration testing: Verify relayer-discovery ↔ queue-consumer interaction

**Duration:** 1-2 hours

### Phase 3: Docker Compose Migration

**Objective:** Migrate Docker Compose to 0-based naming and integrate relayer-discovery service.

**Scope:**
- Rename services: oz-relayer-1,2,3 → oz-relayer-0,1,2
- Update environment variables: `REDIS_KEY_PREFIX`, keystore paths
- Add relayer-discovery service definition
- Update documentation and operational guides

**Duration:** 1 hour

### Phase 4: Kubernetes Preparation (Future SPEC)

**Objective:** Design Kubernetes manifests for StatefulSet-based deployment.

**Scope (Out of Scope for SPEC-DISCOVERY-001):**
- StatefulSet manifest for oz-relayer pods
- Init Container for keystore/KMS selection
- ConfigMap/Secret structure
- Horizontal Pod Autoscaler (optional)

**Duration:** TBD (separate SPEC-DISCOVERY-002)

---

## Detailed Implementation Steps

### Phase 1: relayer-discovery Service

#### Step 1.1: Create Package Structure

```bash
# Create directory structure
mkdir -p packages/relayer-discovery/src/{config,services}
mkdir -p packages/relayer-discovery/test

# Create package.json
cd packages/relayer-discovery
pnpm init
```

**Files to create:**
- `packages/relayer-discovery/package.json`
- `packages/relayer-discovery/tsconfig.json`
- `packages/relayer-discovery/nest-cli.json`

#### Step 1.2: Implement Configuration Module

**File:** `packages/relayer-discovery/src/config/discovery.config.ts`

```typescript
import { registerAs } from '@nestjs/config';

export default registerAs('discovery', () => ({
  relayerCount: parseInt(process.env.RELAYER_COUNT || '3', 10),
  healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '10000', 10),
  healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '500', 10),
  relayerUrlTemplate: process.env.RELAYER_URL_TEMPLATE || 'http://oz-relayer-{N}:3000',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
}));
```

**Validation:**
- `relayerCount`: 1 <= value <= 10
- `healthCheckInterval`: 1000 <= value <= 60000
- `healthCheckTimeout`: 100 <= value <= 5000

#### Step 1.3: Implement DiscoveryService

**File:** `packages/relayer-discovery/src/services/discovery.service.ts`

**Key Methods:**

```typescript
export class DiscoveryService {
  private interval: NodeJS.Timeout | null = null;

  async onModuleInit(): Promise<void> {
    // Start health check loop
    await this.startHealthCheckLoop();
  }

  async onModuleDestroy(): Promise<void> {
    // Graceful shutdown
    if (this.interval) clearInterval(this.interval);
    await this.redis.quit();
  }

  private async startHealthCheckLoop(): Promise<void> {
    // Run immediately on startup
    await this.performHealthChecks();

    // Schedule periodic checks
    this.interval = setInterval(
      async () => await this.performHealthChecks(),
      this.config.healthCheckInterval
    );
  }

  private async performHealthChecks(): Promise<void> {
    const relayerIds = this.generateRelayerIds();
    const results = await Promise.allSettled(
      relayerIds.map(id => this.checkRelayerHealth(id))
    );

    for (let i = 0; i < relayerIds.length; i++) {
      const relayerId = relayerIds[i];
      const result = results[i];

      if (result.status === 'fulfilled' && result.value === true) {
        await this.addActiveRelayer(relayerId);
      } else {
        await this.removeActiveRelayer(relayerId);
      }
    }
  }

  private async checkRelayerHealth(relayerId: string): Promise<boolean> {
    const url = this.constructHealthUrl(relayerId);
    try {
      const response = await axios.get(url, {
        timeout: this.config.healthCheckTimeout,
      });
      return response.status === 200;
    } catch (error) {
      this.logger.warn(`Health check failed for ${relayerId}: ${error.message}`);
      return false;
    }
  }

  private async addActiveRelayer(relayerId: string): Promise<void> {
    await this.redis.sadd('relayer:active', relayerId);
    this.logger.log(`Added ${relayerId} to active list`);
  }

  private async removeActiveRelayer(relayerId: string): Promise<void> {
    await this.redis.srem('relayer:active', relayerId);
    this.logger.warn(`Removed ${relayerId} from active list`);
  }

  async getStatus(): Promise<StatusResponse> {
    const activeRelayers = await this.redis.smembers('relayer:active');
    return {
      service: 'relayer-discovery',
      status: this.determineOverallStatus(activeRelayers.length),
      timestamp: new Date().toISOString(),
      activeRelayers: activeRelayers.map(id => ({
        id,
        status: 'healthy',
        lastCheckTimestamp: this.lastCheckTimestamps.get(id) || null,
        url: this.constructHealthUrl(id),
      })),
      totalConfigured: this.config.relayerCount,
      totalActive: activeRelayers.length,
      healthCheckInterval: this.config.healthCheckInterval,
    };
  }
}
```

#### Step 1.4: Implement Status Controller

**File:** `packages/relayer-discovery/src/controllers/status.controller.ts`

```typescript
@Controller()
export class StatusController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get('/status')
  async getStatus(): Promise<StatusResponse> {
    return this.discoveryService.getStatus();
  }
}
```

#### Step 1.5: Implement Module and Main Entry Point

**File:** `packages/relayer-discovery/src/discovery.module.ts`

```typescript
@Module({
  imports: [ConfigModule.forRoot({ load: [discoveryConfig] })],
  controllers: [StatusController],
  providers: [DiscoveryService],
})
export class DiscoveryModule {}
```

**File:** `packages/relayer-discovery/src/main.ts`

```typescript
async function bootstrap() {
  const app = await NestFactory.create(DiscoveryModule);
  await app.listen(3001);
  console.log('relayer-discovery service running on port 3001');
}
bootstrap();
```

#### Step 1.6: Write Unit Tests

**File:** `packages/relayer-discovery/test/discovery.service.spec.ts`

**Test Cases:**
- Health check success: Relayer added to active list
- Health check failure: Relayer removed from active list
- Health check timeout: Treated as failure
- Redis connection failure: Retry with exponential backoff
- Configuration validation: Invalid `RELAYER_COUNT` or `HEALTH_CHECK_INTERVAL_MS` throws error
- Status endpoint: Returns correct JSON structure

**Target Coverage:** 90%+

---

### Phase 2: queue-consumer Integration

#### Step 2.1: Modify RelayerRouterService

**File:** `packages/queue-consumer/src/relay/relayer-router.service.ts`

**Changes:**

1. **Add Redis dependency:**
```typescript
constructor(
  private readonly redis: Redis,
  private readonly logger: Logger,
) {}
```

2. **Replace `getAvailableRelayers()` method:**
```typescript
async getAvailableRelayers(): Promise<string[]> {
  // Old implementation: Read from OZ_RELAYER_URLS environment variable
  // New implementation: Read from Redis

  const activeRelayerIds = await this.redis.smembers('relayer:active');

  if (activeRelayerIds.length === 0) {
    throw new Error('No active relayers available');
  }

  // Construct URLs: oz-relayer-0 -> http://oz-relayer-0:3000
  return activeRelayerIds.map(id => `http://${id}:3000`);
}
```

3. **Update error handling:**
```typescript
async selectRelayer(): Promise<string> {
  const availableRelayers = await this.getAvailableRelayers();

  if (availableRelayers.length === 0) {
    this.logger.error('No active relayers in Redis');
    throw new Error('No active relayers available');
  }

  // Existing round-robin logic remains the same
  const selectedUrl = availableRelayers[this.currentIndex % availableRelayers.length];
  this.currentIndex++;
  return selectedUrl;
}
```

#### Step 2.2: Remove OZ_RELAYER_URLS Environment Variable

**Files to modify:**
- `docker/docker-compose.yml`: Remove `OZ_RELAYER_URLS` from queue-consumer service
- Documentation: Update configuration guides

#### Step 2.3: Write Integration Tests

**File:** `packages/queue-consumer/test/relayer-router.integration.spec.ts`

**Test Cases:**
- Query Redis for active relayers: Returns correct list
- No active relayers: Throws error
- Redis connection failure: Retry logic works
- Relayer failover: Selects next relayer from active list

---

### Phase 3: Docker Compose Migration

#### Step 3.1: Rename OZ Relayer Services

**File:** `docker/docker-compose.yml`

**Changes:**

```yaml
# OLD (1-based naming)
services:
  oz-relayer-1:
    image: openzeppelin/defender-relay-client:latest
    environment:
      - REDIS_KEY_PREFIX=oz-relayer-1
    volumes:
      - ./keystore/relayer-1.json:/app/keystore.json

  oz-relayer-2:
    # Similar...

  oz-relayer-3:
    # Similar...

# NEW (0-based naming)
services:
  oz-relayer-0:
    image: openzeppelin/defender-relay-client:latest
    environment:
      - REDIS_KEY_PREFIX=oz-relayer-0
    volumes:
      - ./keystore/relayer-0.json:/app/keystore.json

  oz-relayer-1:
    image: openzeppelin/defender-relay-client:latest
    environment:
      - REDIS_KEY_PREFIX=oz-relayer-1
    volumes:
      - ./keystore/relayer-1.json:/app/keystore.json

  oz-relayer-2:
    image: openzeppelin/defender-relay-client:latest
    environment:
      - REDIS_KEY_PREFIX=oz-relayer-2
    volumes:
      - ./keystore/relayer-2.json:/app/keystore.json
```

#### Step 3.2: Add relayer-discovery Service

**File:** `docker/docker-compose.yml`

```yaml
services:
  relayer-discovery:
    build:
      context: .
      dockerfile: packages/relayer-discovery/Dockerfile
    environment:
      - RELAYER_COUNT=3
      - HEALTH_CHECK_INTERVAL_MS=10000
      - HEALTH_CHECK_TIMEOUT_MS=500
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    ports:
      - "3001:3001"
    depends_on:
      - redis
      - oz-relayer-0
      - oz-relayer-1
      - oz-relayer-2
    restart: unless-stopped
```

#### Step 3.3: Rename Keystore Files

**Commands:**
```bash
cd docker/keystore
mv relayer-1.json relayer-0.json
mv relayer-2.json relayer-1.json
mv relayer-3.json relayer-2.json
```

**Note:** Ensure keystore contents (private keys) remain unchanged.

#### Step 3.4: Update Documentation

**Files to update:**
- `README.md`: Update architecture diagram and configuration examples
- `docker/README.md`: Update service descriptions and naming conventions
- `.moai/specs/SPEC-INFRA-*/`: Update infrastructure SPECs to reference 0-based naming

---

## Testing Strategy

### Unit Tests

**Scope:**
- `DiscoveryService`: Health check logic, Redis operations, configuration validation
- `StatusController`: Endpoint response format
- `RelayerRouterService`: Redis query logic, relayer selection

**Tools:**
- Jest
- Mock Redis client (ioredis-mock)
- Mock HTTP client (axios-mock-adapter)

**Coverage Target:** 90%+

### Integration Tests

**Scope:**
- relayer-discovery ↔ Redis: Health check updates reflected in Redis
- queue-consumer ↔ Redis: Active relayer list retrieved correctly
- relayer-discovery ↔ OZ Relayers: HTTP health checks work end-to-end

**Tools:**
- Docker Compose test environment
- Real Redis instance
- Mock OZ Relayers (simple HTTP server returning 200)

**Test Cases:**
- Initial discovery: All relayers discovered on startup
- Failover: Unhealthy relayer removed from active list
- Recovery: Recovered relayer re-added to active list
- Configuration changes: `RELAYER_COUNT` update enforced after restart

### E2E Tests

**Scope:**
- Full relay request flow: SQS → queue-consumer → oz-relayer
- Health check integration: Failed relayer excluded from routing
- Monitoring: GET /status returns accurate data

**Tools:**
- LocalStack (SQS emulation)
- Docker Compose full stack
- Jest E2E test suite

**Test Cases:**
- Relay request with all relayers healthy
- Relay request with one relayer down (failover)
- Relay request with no relayers available (error handling)
- Monitoring endpoint returns correct active relayer count

---

## Deployment Plan

### Migration Steps (1-based → 0-based)

#### Step 1: Pre-Migration Validation

1. **Backup keystore files:**
   ```bash
   cp -r docker/keystore docker/keystore.backup
   ```

2. **Document current state:**
   ```bash
   docker-compose ps > pre-migration-state.txt
   redis-cli KEYS "oz-relayer-*" > pre-migration-redis.txt
   ```

3. **Run existing tests:**
   ```bash
   pnpm test:integration
   ```

#### Step 2: Stop Existing Services

```bash
docker-compose down
```

#### Step 3: Rename Keystore Files

```bash
cd docker/keystore
mv relayer-1.json relayer-0.json
mv relayer-2.json relayer-1.json
mv relayer-3.json relayer-2.json
```

#### Step 4: Update docker-compose.yml

Apply changes from Phase 3 (see above).

#### Step 5: Clear Redis State (Optional)

```bash
docker-compose up -d redis
redis-cli FLUSHDB
```

**Note:** Only flush if you want a clean state. Existing keys will be replaced by new 0-based keys.

#### Step 6: Start New Services

```bash
docker-compose up -d
```

**Order:**
1. Redis
2. oz-relayer-0, oz-relayer-1, oz-relayer-2
3. relayer-discovery
4. queue-consumer, relay-api

#### Step 7: Verify Health

```bash
# Check relayer-discovery logs
docker-compose logs relayer-discovery | grep "healthy"

# Query Redis
redis-cli SMEMBERS relayer:active
# Expected: oz-relayer-0, oz-relayer-1, oz-relayer-2

# Query monitoring endpoint
curl http://localhost:3001/status | jq
```

#### Step 8: Run Post-Migration Tests

```bash
pnpm test:integration
pnpm test:e2e
```

#### Step 9: Monitor for 24 Hours

- Check logs for errors
- Verify relay requests processed successfully
- Monitor Redis key usage

### Rollback Strategy

If migration fails or issues are detected:

#### Step 1: Stop New Services

```bash
docker-compose down
```

#### Step 2: Restore Keystore Files

```bash
cd docker/keystore
mv relayer-0.json relayer-1.json
mv relayer-1.json relayer-2.json
mv relayer-2.json relayer-3.json
```

#### Step 3: Revert docker-compose.yml

```bash
git checkout HEAD -- docker/docker-compose.yml
```

#### Step 4: Restart Old Services

```bash
docker-compose up -d
```

#### Step 5: Verify Rollback

```bash
docker-compose ps
redis-cli KEYS "oz-relayer-*"
```

### Monitoring and Validation

#### Key Metrics to Monitor

1. **Health Check Success Rate:**
   - Metric: `discovery.health_check.success_rate`
   - Alert: < 90% for 5 minutes

2. **Active Relayer Count:**
   - Metric: `discovery.active_relayers.count`
   - Alert: < 2 (minimum required for redundancy)

3. **Health Check Duration:**
   - Metric: `discovery.health_check.duration_ms`
   - Alert: > 500ms (exceeds fail-fast threshold)

4. **Redis Connection Errors:**
   - Metric: `discovery.redis.errors`
   - Alert: > 5 errors in 1 minute

#### Validation Checklist

- [ ] relayer-discovery service is running
- [ ] Redis key `relayer:active` contains expected relayer IDs
- [ ] queue-consumer queries Redis successfully
- [ ] Relay requests routed to active relayers only
- [ ] Monitoring endpoint returns accurate data
- [ ] Logs show no errors or warnings
- [ ] All integration tests pass
- [ ] All E2E tests pass

---

## Risk Mitigation

### Technical Risks

#### Risk 1: Health Check False Positives

**Risk:** Health checks may incorrectly mark healthy relayers as unhealthy.

**Mitigation:**
- Use 500ms timeout (fail-fast, but reasonable)
- Log health check failures with detailed error messages
- Implement retry logic with exponential backoff (future enhancement)
- Monitor health check success rate metric

#### Risk 2: Redis Single Point of Failure

**Risk:** Redis failure prevents health check updates and relayer discovery.

**Mitigation:**
- Accepted risk (existing architecture limitation)
- Implement Redis connection retry logic
- Log Redis errors prominently
- Monitor Redis uptime and connection health
- Document Redis backup and recovery procedures

#### Risk 3: Naming Migration Breaking Existing Deployments

**Risk:** 0-based naming change may break existing references or scripts.

**Mitigation:**
- Comprehensive pre-migration testing in dev/staging
- Detailed migration guide with rollback steps
- Gradual rollout (dev → staging → production)
- Backup keystore files before migration
- Document all naming changes in release notes

#### Risk 4: Race Conditions in Concurrent Health Checks

**Risk:** Concurrent health checks may cause inconsistent Redis state.

**Mitigation:**
- Use atomic Redis operations (SADD/SREM)
- Avoid multi-step update sequences
- Test concurrency with stress tests (100+ concurrent health checks)
- Monitor Redis operation errors

### Operational Risks

#### Risk 1: Configuration Drift

**Risk:** `RELAYER_COUNT` does not match actual number of deployed relayers.

**Mitigation:**
- Validate configuration on startup
- Log warning if `RELAYER_COUNT` mismatches deployed relayers
- Document configuration requirements clearly
- Use infrastructure-as-code (Docker Compose, Kubernetes) to enforce consistency

#### Risk 2: Inadequate Monitoring

**Risk:** Health check failures not detected or alerted promptly.

**Mitigation:**
- Implement comprehensive logging and metrics
- Set up alerts for critical metrics (active relayer count, health check failures)
- Use monitoring endpoint for operational dashboards
- Document monitoring and alerting procedures

---

## Appendix

### Environment Variables Reference

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `RELAYER_COUNT` | relayer-discovery | 3 | Number of relayers to monitor |
| `HEALTH_CHECK_INTERVAL_MS` | relayer-discovery | 10000 | Health check interval (ms) |
| `HEALTH_CHECK_TIMEOUT_MS` | relayer-discovery | 500 | Health check timeout (ms) |
| `REDIS_HOST` | relayer-discovery, queue-consumer | localhost | Redis host |
| `REDIS_PORT` | relayer-discovery, queue-consumer | 6379 | Redis port |
| `REDIS_KEY_PREFIX` | oz-relayer-* | oz-relayer-{N} | Redis key prefix for relayer state |

### Redis Key Schema

| Key | Type | Description | Example Values |
|-----|------|-------------|----------------|
| `relayer:active` | Set | Active relayer IDs | `["oz-relayer-0", "oz-relayer-1"]` |
| `relayer:status:{N}` | Hash (optional) | Detailed relayer status | `{"lastCheck": "2026-01-17T10:30:00Z", "status": "healthy"}` |

### File Structure

```
packages/relayer-discovery/
├── src/
│   ├── config/
│   │   └── discovery.config.ts
│   ├── services/
│   │   └── discovery.service.ts
│   ├── controllers/
│   │   └── status.controller.ts
│   ├── discovery.module.ts
│   └── main.ts
├── test/
│   ├── discovery.service.spec.ts
│   └── status.controller.spec.ts
├── package.json
├── tsconfig.json
├── nest-cli.json
└── Dockerfile

packages/queue-consumer/
├── src/
│   └── relay/
│       └── relayer-router.service.ts (MODIFIED)
└── test/
    └── relayer-router.integration.spec.ts (NEW)

docker/
├── docker-compose.yml (MODIFIED)
└── keystore/
    ├── relayer-0.json (RENAMED from relayer-1.json)
    ├── relayer-1.json (RENAMED from relayer-2.json)
    └── relayer-2.json (RENAMED from relayer-3.json)
```

---

**Implementation Plan Version:** 1.0.0
**Last Updated:** 2026-01-17
**Estimated Total Duration:** 4-6 hours

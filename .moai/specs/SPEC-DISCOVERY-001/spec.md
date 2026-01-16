---
id: SPEC-DISCOVERY-001
version: "1.0.0"
status: "draft"
created: "2026-01-17"
updated: "2026-01-17"
author: "MoAI-ADK"
priority: "high"
---

## HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-17 | MoAI-ADK | Initial SPEC creation for Relayer Discovery Service |

# SPEC-DISCOVERY-001: Relayer Discovery Service

## 1. Overview

### 1.1 Background

The current msq-relayer-service architecture uses an in-memory health check mechanism in the `queue-consumer` package with a 10-second TTL. This approach has several limitations:

- **No centralized state**: Each consumer instance maintains its own health check state
- **Manual scaling**: Adding or removing relayers requires code changes and redeployment
- **No visibility**: Lack of operational monitoring for relayer health status
- **1-based naming**: Current naming convention (oz-relayer-1,2,3) is inconsistent with zero-indexing standards

### 1.2 Objectives

This specification defines the architecture and implementation of a centralized Relayer Discovery Service that:

1. Performs active health checks on all configured OZ Relayers
2. Maintains a centralized active relayer list in Redis
3. Provides operational monitoring through a REST API
4. Migrates to 0-based naming convention (oz-relayer-0,1,2)
5. Enables configuration-based scaling (restart-required, no runtime auto-scaling)

### 1.3 Scope

**In Scope (Phase 1-3):**
- New `relayer-discovery` service package
- Redis-based state management
- HTTP health check implementation
- `queue-consumer` integration
- Docker Compose migration to 0-based naming
- Monitoring API endpoint

**Out of Scope:**
- Kubernetes StatefulSet implementation (future SPEC-DISCOVERY-002)
- Runtime auto-scaling capabilities
- Advanced service mesh integration
- Multi-region discovery

### 1.4 Related SPECs

- SPEC-INFRA-* (Infrastructure configuration)
- SPEC-ROUTING-* (Relayer routing logic)
- SPEC-HEALTH-* (Health check patterns)
- SPEC-QUEUE-* (Queue consumer architecture)

---

## 2. Functional Requirements (FR - MUST)

### FR-001: Active Health Check Execution

The relayer-discovery service MUST perform HTTP health checks on all configured OZ Relayers.

**Details:**
- Health check target: `http://oz-relayer-{N}:3000/health` endpoint
- Health check frequency: Configurable via `HEALTH_CHECK_INTERVAL_MS` (default: 10000ms)
- Health check method: HTTP GET request
- Success criteria: HTTP 200 response status

### FR-002: Redis Active Relayer List Management

The relayer-discovery service MUST maintain an active relayer list in Redis using the key `relayer:active`.

**Details:**
- Data structure: Redis Set (SADD/SREM operations)
- Key format: `relayer:active`
- Value format: Relayer identifiers (e.g., "oz-relayer-0", "oz-relayer-1")
- Atomic operations: All Redis updates MUST be atomic

### FR-003: Queue Consumer Redis Integration

The queue-consumer service MUST query Redis for the active relayer list instead of using environment variables.

**Details:**
- Remove dependency on `OZ_RELAYER_URLS` environment variable
- Read from Redis key `relayer:active` using `SMEMBERS` command
- Construct relayer URLs dynamically based on active list
- Fallback behavior: If Redis is unavailable, log error and retry

### FR-004: Configurable Health Check Interval

The health check interval MUST be configurable via environment variable.

**Details:**
- Environment variable: `HEALTH_CHECK_INTERVAL_MS`
- Default value: 10000 (10 seconds)
- Minimum value: 1000 (1 second)
- Maximum value: 60000 (60 seconds)
- Validation: Service MUST validate range on startup

### FR-005: Zero-Based Naming Convention

All relayer naming MUST follow zero-based indexing convention.

**Details:**
- Docker service names: `oz-relayer-0`, `oz-relayer-1`, `oz-relayer-2`
- Redis key prefixes: `oz-relayer-0`, `oz-relayer-1`, `oz-relayer-2`
- Keystore filenames: `relayer-0.json`, `relayer-1.json`, `relayer-2.json`
- Migration: 1-based names (oz-relayer-1,2,3) MUST be deprecated

### FR-006: Unhealthy Relayer Removal

The relayer-discovery service MUST remove unhealthy relayers from the active list.

**Details:**
- Removal trigger: Health check failure (non-200 status or timeout)
- Redis operation: `SREM relayer:active {relayer-id}`
- Logging: Log relayer removal with timestamp and reason
- Metrics: Emit metric for relayer removal event

### FR-007: Recovered Relayer Re-addition

The relayer-discovery service MUST re-add recovered relayers to the active list.

**Details:**
- Re-addition trigger: Health check success after previous failure
- Redis operation: `SADD relayer:active {relayer-id}`
- Logging: Log relayer recovery with timestamp
- Metrics: Emit metric for relayer recovery event

### FR-008: Monitoring API Endpoint

The relayer-discovery service MUST expose a GET /status endpoint for operational monitoring.

**Details:**
- Endpoint: `GET /status`
- Response format: JSON (see IR-005)
- Authentication: None (internal network access only)
- Response time: < 100ms
- Purpose: Operational visibility for active relayers and health check status

---

## 3. Non-Functional Requirements (NFR - SHOULD)

### NFR-001: Fast Health Check Execution

Health checks SHOULD complete within 500ms to enable fail-fast behavior.

**Rationale:**
- Minimize detection time for failed relayers
- Prevent cascading delays in discovery loop
- Improve overall system responsiveness

**Implementation:**
- HTTP request timeout: 500ms
- Connection timeout: 200ms
- No retry logic in individual health checks

### NFR-002: Atomic Redis Operations

All Redis state updates SHOULD be atomic to prevent race conditions.

**Rationale:**
- Ensure consistency in active relayer list
- Prevent concurrent modification issues
- Enable safe multi-instance deployment (future)

**Implementation:**
- Use Redis Set operations (SADD/SREM are atomic)
- Avoid multi-step update sequences
- Use Redis transactions if multi-key updates are needed

### NFR-003: Graceful Shutdown Support

The relayer-discovery service SHOULD support graceful shutdown.

**Rationale:**
- Allow in-flight health checks to complete
- Clean up Redis connections properly
- Enable zero-downtime deployments

**Implementation:**
- Handle SIGTERM signal
- Complete current health check cycle
- Close Redis connections
- Exit with status code 0

### NFR-004: Configuration-Based Restart Required

Configuration changes SHOULD require service restart (no runtime auto-scaling).

**Rationale:**
- Simplify implementation (no dynamic configuration reloading)
- Predictable scaling behavior
- Align with Config-based Restart architecture principle

**Implementation:**
- Read `RELAYER_COUNT` and `HEALTH_CHECK_INTERVAL_MS` at startup only
- Document restart requirement in operational guides
- Use container orchestration for restart automation

### NFR-005: Comprehensive Logging and Metrics

Health check failures SHOULD be logged and metrics SHOULD be collected.

**Rationale:**
- Enable troubleshooting and root cause analysis
- Provide operational visibility
- Support alerting and monitoring integrations

**Implementation:**
- Log health check failures with relayer ID, timestamp, and error reason
- Emit metrics for health check success/failure rates
- Use structured logging format (JSON)
- Integrate with existing logging infrastructure

---

## 4. Interface Requirements (IR - SHALL)

### IR-001: RELAYER_COUNT Environment Variable

The relayer-discovery service SHALL read the `RELAYER_COUNT` environment variable to determine the number of relayers to monitor.

**Details:**
- Variable name: `RELAYER_COUNT`
- Type: Integer
- Default: 3
- Range: 1-10
- Behavior: Service monitors relayers from `oz-relayer-0` to `oz-relayer-{RELAYER_COUNT-1}`

### IR-002: OZ Relayer Health Endpoint

OZ Relayer instances SHALL expose a `/health` endpoint for health checks.

**Details:**
- Endpoint: `GET /health`
- Port: 3000 (existing)
- Response: HTTP 200 with JSON body (existing implementation)
- No changes required (endpoint already exists)

### IR-003: Redis Key Schema

Redis SHALL use a predictable key schema for relayer discovery.

**Details:**
- Active list key: `relayer:active` (Redis Set)
- Status key pattern: `relayer:status:{N}` (Redis Hash, optional for detailed status)
- TTL: No expiration (persistent state)
- Namespace: Consider using `REDIS_KEY_PREFIX` for multi-tenancy (optional)

### IR-004: Health Check Interval Configuration

The relayer-discovery service SHALL read the `HEALTH_CHECK_INTERVAL_MS` environment variable for health check interval configuration.

**Details:**
- Variable name: `HEALTH_CHECK_INTERVAL_MS`
- Type: Integer
- Default: 10000 (10 seconds)
- Unit: Milliseconds
- Validation: 1000 <= value <= 60000

### IR-005: Monitoring Endpoint Response Format

The monitoring endpoint SHALL return JSON format with the following structure:

```json
{
  "service": "relayer-discovery",
  "status": "healthy",
  "timestamp": "2026-01-17T10:30:00.000Z",
  "activeRelayers": [
    {
      "id": "oz-relayer-0",
      "status": "healthy",
      "lastCheckTimestamp": "2026-01-17T10:29:55.000Z",
      "url": "http://oz-relayer-0:3000"
    },
    {
      "id": "oz-relayer-1",
      "status": "healthy",
      "lastCheckTimestamp": "2026-01-17T10:29:55.000Z",
      "url": "http://oz-relayer-1:3000"
    }
  ],
  "totalConfigured": 3,
  "totalActive": 2,
  "healthCheckInterval": 10000
}
```

**Fields:**
- `service`: Service identifier (always "relayer-discovery")
- `status`: Overall service health ("healthy" | "degraded" | "unhealthy")
- `timestamp`: Current server timestamp (ISO 8601)
- `activeRelayers`: Array of active relayer objects
- `totalConfigured`: Value of `RELAYER_COUNT`
- `totalActive`: Number of relayers in `relayer:active` Redis set
- `healthCheckInterval`: Value of `HEALTH_CHECK_INTERVAL_MS`

---

## 5. Design Constraints (DC - MUST)

### DC-001: Use Existing Redis Infrastructure

The implementation MUST use the existing Redis infrastructure without requiring additional Redis instances.

**Rationale:**
- Minimize infrastructure complexity
- Reuse existing Redis connection patterns
- Leverage existing Redis monitoring and backup

### DC-002: NestJS Framework Consistency

The relayer-discovery service MUST be implemented using the NestJS framework.

**Rationale:**
- Consistency with other packages (relay-api, queue-consumer)
- Reuse existing patterns and conventions
- Leverage NestJS dependency injection and modularity

### DC-003: No Runtime Auto-Scaling Complexity

The implementation MUST NOT introduce runtime auto-scaling capabilities.

**Rationale:**
- Align with Config-based Restart architecture principle
- Simplify implementation and testing
- Avoid complexity of dynamic relayer registration/deregistration

### DC-004: Docker Zero-Based Naming

Docker service names MUST follow the pattern `oz-relayer-{0..N-1}`.

**Rationale:**
- Align with zero-indexing conventions
- Consistent with Kubernetes Pod naming (future)
- Simplify programmatic relayer URL construction

### DC-005: Kubernetes StatefulSet Requirement

Kubernetes deployments MUST use StatefulSet for stable Pod names.

**Rationale:**
- Predictable Pod names (oz-relayer-0, oz-relayer-1, etc.)
- Stable network identities
- Align with stateful service patterns

**Note:** Kubernetes implementation is out of scope for this SPEC (future SPEC-DISCOVERY-002).

### DC-006: Backward Compatibility with Existing SPECs

The implementation MUST maintain compatibility with existing 14 SPECs.

**Rationale:**
- Avoid breaking changes in existing functionality
- Ensure smooth integration with AUTH, CONTRACTS, QUEUE, ROUTING, etc.
- Minimize regression risk

**Verification:**
- Run all existing integration tests
- Verify no breaking changes in queue-consumer API
- Ensure existing health check patterns still work

---

## 6. Acceptance Criteria (AC - GIVEN/WHEN/THEN)

### AC-001: Initial Discovery of All Relayers

**Given** 3 OZ Relayers (oz-relayer-0, oz-relayer-1, oz-relayer-2) are running and healthy
**When** the relayer-discovery service starts
**Then** the Redis key `relayer:active` SHALL contain all 3 relayer IDs within 15 seconds

**Verification:**
```bash
redis-cli SMEMBERS relayer:active
# Expected output: oz-relayer-0, oz-relayer-1, oz-relayer-2
```

### AC-002: Fast Health Check Completion

**Given** all OZ Relayers are healthy
**When** a health check cycle executes
**Then** all health checks SHALL complete within 500ms per relayer

**Verification:**
- Monitor health check duration logs
- Assert: `healthCheckDuration <= 500ms` for each relayer

### AC-003: Unhealthy Relayer Removal

**Given** oz-relayer-1 crashes or becomes unresponsive
**When** the next health check cycle executes
**Then** oz-relayer-1 SHALL be removed from `relayer:active` within 1 health check interval

**Verification:**
```bash
# Stop oz-relayer-1
docker-compose stop oz-relayer-1

# Wait for health check interval + 1 second
sleep 11

# Verify removal
redis-cli SMEMBERS relayer:active
# Expected output: oz-relayer-0, oz-relayer-2 (oz-relayer-1 removed)
```

### AC-004: Recovered Relayer Re-addition

**Given** oz-relayer-1 was previously removed due to failure
**When** oz-relayer-1 recovers and responds to health checks
**Then** oz-relayer-1 SHALL be re-added to `relayer:active` within 1 health check interval

**Verification:**
```bash
# Restart oz-relayer-1
docker-compose start oz-relayer-1

# Wait for health check interval + 1 second
sleep 11

# Verify re-addition
redis-cli SMEMBERS relayer:active
# Expected output: oz-relayer-0, oz-relayer-1, oz-relayer-2
```

### AC-005: RELAYER_COUNT Configuration Enforcement

**Given** `RELAYER_COUNT=2` is set in environment
**When** the relayer-discovery service starts
**Then** only oz-relayer-0 and oz-relayer-1 SHALL be monitored (oz-relayer-2 ignored)

**Verification:**
```bash
# Set RELAYER_COUNT=2 in docker-compose.yml
# Restart relayer-discovery
docker-compose restart relayer-discovery

# Verify only 2 relayers monitored
redis-cli SMEMBERS relayer:active
# Expected output: oz-relayer-0, oz-relayer-1 (max 2 entries)
```

### AC-006: Custom Health Check Interval

**Given** `HEALTH_CHECK_INTERVAL_MS=5000` is set in environment
**When** the service runs
**Then** health checks SHALL execute every 5 seconds (not default 10 seconds)

**Verification:**
- Monitor health check logs with timestamps
- Assert: Time difference between consecutive health checks ≈ 5000ms ± 100ms

### AC-007: Redis State Consistency Under Concurrent Updates

**Given** multiple health checks execute concurrently (e.g., 3 relayers checked in parallel)
**When** Redis updates occur simultaneously
**Then** no race conditions SHALL occur, and `relayer:active` SHALL be consistent

**Verification:**
- Run 100 concurrent health check cycles
- Verify `relayer:active` set size matches expected active relayer count
- Assert: No duplicate entries, no missing entries

### AC-008: Redis Connection Failure Handling

**Given** Redis connection is unavailable or fails during operation
**When** the relayer-discovery service attempts to update state
**Then** the service SHALL log the error, retry with exponential backoff, and continue health checks

**Verification:**
```bash
# Stop Redis
docker-compose stop redis

# Verify relayer-discovery logs show retry attempts
docker-compose logs relayer-discovery | grep "Redis connection failed"

# Restart Redis
docker-compose start redis

# Verify service recovers and resumes updates
```

### AC-009: Monitoring Endpoint Returns Active Relayer List

**Given** the relayer-discovery service is running with 2 active relayers
**When** a GET request is made to `/status`
**Then** the response SHALL return JSON with active relayer list, timestamps, and health check configuration

**Verification:**
```bash
curl http://localhost:3001/status | jq

# Expected response structure (see IR-005):
# {
#   "service": "relayer-discovery",
#   "status": "healthy",
#   "timestamp": "...",
#   "activeRelayers": [
#     {"id": "oz-relayer-0", "status": "healthy", ...},
#     {"id": "oz-relayer-1", "status": "healthy", ...}
#   ],
#   "totalConfigured": 3,
#   "totalActive": 2,
#   "healthCheckInterval": 10000
# }
```

---

## 7. References

### 7.1 Related Documentation

- Architecture Design Document (provided in initial requirements)
- Docker Compose Configuration: `docker/docker-compose.yml`
- Existing Health Check Implementation: `packages/queue-consumer/src/relay/relayer-router.service.ts`

### 7.2 Technology Stack

- **Framework**: NestJS 10.4.0
- **Redis Client**: ioredis 5.8.2
- **HTTP Client**: axios (latest)
- **Testing**: Jest (latest)
- **TypeScript**: 5.6.3

### 7.3 Key Decisions

| Decision | Rationale |
|----------|-----------|
| Config-based Restart (no runtime scaling) | Simplifies implementation, aligns with architecture principle |
| 0-based naming convention | Aligns with zero-indexing standards, prepares for Kubernetes |
| Redis Set for active list | Atomic operations, simple membership checks |
| 500ms health check timeout | Fail-fast behavior, prevents cascading delays |
| Separate relayer-discovery service | Single responsibility, independent scaling, clear separation of concerns |

---

## 8. Glossary

- **OZ Relayer**: OpenZeppelin Relayer instance responsible for submitting transactions
- **Health Check**: HTTP request to `/health` endpoint to verify relayer availability
- **Active Relayer**: Relayer that passed the most recent health check
- **Discovery Service**: The relayer-discovery service defined in this SPEC
- **Config-based Restart**: Architecture pattern requiring service restart for configuration changes
- **0-based naming**: Naming convention starting from index 0 (oz-relayer-0, oz-relayer-1, ...)

---

## 9. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Requirements Analyst | MoAI-ADK | - | 2026-01-17 |
| Technical Lead | TBD | - | - |
| Product Owner | TBD | - | - |

---

**Document Status**: Draft
**Next Review Date**: TBD
**Implementation Target**: Q1 2026

# SPEC-DISCOVERY-001: Acceptance Criteria

## Overview

### Purpose of Acceptance Testing

This document defines the acceptance criteria for the Relayer Discovery Service (SPEC-DISCOVERY-001). All scenarios must pass before the implementation can be considered complete and ready for production deployment.

**Acceptance Testing Goals:**
1. Verify all functional requirements (FR-001 through FR-008)
2. Validate non-functional requirements (performance, reliability)
3. Confirm integration with existing services (queue-consumer, oz-relayer)
4. Ensure edge cases and failure scenarios are handled correctly
5. Validate 0-based naming convention migration

### Test Environment Setup

**Prerequisites:**
- Docker and Docker Compose installed
- Redis instance running (via docker-compose)
- 3 OZ Relayer instances (oz-relayer-0, oz-relayer-1, oz-relayer-2)
- relayer-discovery service running
- queue-consumer service running

**Environment Variables:**
```bash
# relayer-discovery
RELAYER_COUNT=3
HEALTH_CHECK_INTERVAL_MS=10000
HEALTH_CHECK_TIMEOUT_MS=500
REDIS_HOST=redis
REDIS_PORT=6379

# oz-relayer-0
REDIS_KEY_PREFIX=oz-relayer-0
KEYSTORE_PATH=/app/keystore.json  # ← Updated: Consistent with docker-compose mount

# oz-relayer-1
REDIS_KEY_PREFIX=oz-relayer-1
KEYSTORE_PATH=/app/keystore.json  # ← Updated

# oz-relayer-2
REDIS_KEY_PREFIX=oz-relayer-2
KEYSTORE_PATH=/app/keystore.json  # ← Updated
```

**Setup Commands:**
```bash
# Start all services
docker-compose up -d

# Verify services are running
docker-compose ps

# Clear Redis state (for clean test start)
redis-cli FLUSHDB
```

---

## Acceptance Scenarios (Given/When/Then)

### Category 1: Health Check Discovery

#### AC-001: Initial Discovery of All Relayers

**Priority:** HIGH
**Related Requirements:**
- [FR-001 (Active Health Check)](./spec.md#fr-001-active-health-check-execution)
- [FR-002 (Redis Management)](./spec.md#fr-002-redis-active-relayer-list-management)
- [FR-005 (Zero-Based Naming)](./spec.md#fr-005-zero-based-naming-convention)

**Given:**
- 3 OZ Relayers (oz-relayer-0, oz-relayer-1, oz-relayer-2) are running
- All relayers are healthy (responding with HTTP 200 to GET /health)
- Redis key `relayer:active` is empty or does not exist

**When:**
- The relayer-discovery service starts

**Then:**
- Within 15 seconds, the Redis key `relayer:active` SHALL contain all 3 relayer IDs
- Expected Redis state: `SMEMBERS relayer:active` returns `["oz-relayer-0", "oz-relayer-1", "oz-relayer-2"]`
- Logs SHALL show: "Added oz-relayer-0 to active list", "Added oz-relayer-1 to active list", "Added oz-relayer-2 to active list"

**Verification Steps:**
```bash
# 1. Start relayer-discovery
docker-compose up -d relayer-discovery

# 2. Wait 15 seconds
sleep 15

# 3. Query Redis
redis-cli SMEMBERS relayer:active

# Expected output:
# 1) "oz-relayer-0"
# 2) "oz-relayer-1"
# 3) "oz-relayer-2"

# 4. Check logs
docker-compose logs relayer-discovery | grep "Added .* to active list"
```

**Success Criteria:**
- [ ] All 3 relayers present in `relayer:active` within 15 seconds
- [ ] Logs confirm addition of each relayer
- [ ] No errors in relayer-discovery logs

---

#### AC-002: Fast Health Check Completion

**Priority:** MEDIUM
**Related Requirements:**
- [NFR-001 (Fast Health Check Execution)](./spec.md#nfr-001-fast-health-check-execution)

**Given:**
- All OZ Relayers are healthy
- relayer-discovery service is running

**When:**
- A health check cycle executes

**Then:**
- All health checks SHALL complete within 500ms per relayer
- Logs SHALL include health check duration metrics

**Verification Steps:**
```bash
# 1. Enable debug logging
# Set LOG_LEVEL=debug in docker-compose.yml

# 2. Monitor logs with timestamps
docker-compose logs -f relayer-discovery | grep "Health check completed"

# Expected log format:
# [timestamp] Health check completed for oz-relayer-0 in 120ms
# [timestamp] Health check completed for oz-relayer-1 in 135ms
# [timestamp] Health check completed for oz-relayer-2 in 110ms
```

**Success Criteria:**
- [ ] Each health check completes in <= 500ms
- [ ] No timeout errors in logs

---

### Category 2: Failover Scenarios

#### AC-003: Unhealthy Relayer Removal

**Priority:** HIGH
**Related Requirements:**
- [FR-006 (Unhealthy Relayer Removal)](./spec.md#fr-006-unhealthy-relayer-removal)

**Given:**
- All 3 relayers are initially in `relayer:active`
- oz-relayer-1 crashes or becomes unresponsive

**When:**
- The next health check cycle executes (within `HEALTH_CHECK_INTERVAL_MS`)

**Then:**
- oz-relayer-1 SHALL be removed from `relayer:active` within 1 health check interval
- Expected Redis state: `SMEMBERS relayer:active` returns `["oz-relayer-0", "oz-relayer-2"]`
- Logs SHALL show: "Removed oz-relayer-1 from active list"
- Logs SHALL include failure reason (timeout, connection refused, etc.)

**Verification Steps:**
```bash
# 1. Verify initial state
redis-cli SMEMBERS relayer:active
# Expected: 3 relayers

# 2. Stop oz-relayer-1
docker-compose stop oz-relayer-1

# 3. Wait for health check interval + 1 second
sleep 11

# 4. Verify removal
redis-cli SMEMBERS relayer:active
# Expected: oz-relayer-0, oz-relayer-2 (oz-relayer-1 removed)

# 5. Check logs
docker-compose logs relayer-discovery | grep "Removed oz-relayer-1"
```

**Success Criteria:**
- [ ] oz-relayer-1 removed from active list within 11 seconds
- [ ] Only oz-relayer-0 and oz-relayer-2 remain in active list
- [ ] Logs confirm removal with reason
- [ ] No errors for oz-relayer-0 and oz-relayer-2

---

#### AC-004: Recovered Relayer Re-addition

**Priority:** HIGH
**Related Requirements:**
- [FR-007 (Recovered Relayer Re-addition)](./spec.md#fr-007-recovered-relayer-re-addition)

**Given:**
- oz-relayer-1 was previously removed due to failure
- `relayer:active` contains only `["oz-relayer-0", "oz-relayer-2"]`

**When:**
- oz-relayer-1 recovers and responds to health checks with HTTP 200

**Then:**
- oz-relayer-1 SHALL be re-added to `relayer:active` within 1 health check interval
- Expected Redis state: `SMEMBERS relayer:active` returns `["oz-relayer-0", "oz-relayer-1", "oz-relayer-2"]`
- Logs SHALL show: "Added oz-relayer-1 to active list" (recovery event)

**Verification Steps:**
```bash
# 1. Verify current state (oz-relayer-1 not in active list)
redis-cli SMEMBERS relayer:active
# Expected: oz-relayer-0, oz-relayer-2

# 2. Restart oz-relayer-1
docker-compose start oz-relayer-1

# 3. Wait for oz-relayer-1 to be ready (5 seconds)
sleep 5

# 4. Wait for health check interval + 1 second
sleep 11

# 5. Verify re-addition
redis-cli SMEMBERS relayer:active
# Expected: oz-relayer-0, oz-relayer-1, oz-relayer-2

# 6. Check logs
docker-compose logs relayer-discovery | grep "Added oz-relayer-1 to active list"
```

**Success Criteria:**
- [ ] oz-relayer-1 re-added to active list within 11 seconds after becoming healthy
- [ ] All 3 relayers present in active list
- [ ] Logs confirm re-addition
- [ ] No errors in subsequent health checks

---

### Category 3: Configuration Changes

#### AC-005: RELAYER_COUNT Configuration Enforcement

**Priority:** MEDIUM
**Related Requirements:**
- [FR-004 (Configurable Health Check Interval)](./spec.md#fr-004-configurable-health-check-interval)
- [IR-001 (RELAYER_COUNT Environment Variable)](./spec.md#ir-001-relayer_count-environment-variable)

**Given:**
- 3 OZ Relayers are running (oz-relayer-0, oz-relayer-1, oz-relayer-2)
- `RELAYER_COUNT=2` is set in environment

**When:**
- The relayer-discovery service starts

**Then:**
- Only oz-relayer-0 and oz-relayer-1 SHALL be monitored
- oz-relayer-2 SHALL be ignored (not added to active list)
- Expected Redis state: `SMEMBERS relayer:active` returns `["oz-relayer-0", "oz-relayer-1"]` (maximum 2 entries)
- Logs SHALL show: "Monitoring 2 relayers (oz-relayer-0 to oz-relayer-1)"

**Verification Steps:**
```bash
# 1. Update docker-compose.yml
# Set RELAYER_COUNT=2 for relayer-discovery service

# 2. Restart relayer-discovery
docker-compose restart relayer-discovery

# 3. Wait 15 seconds
sleep 15

# 4. Verify only 2 relayers monitored
redis-cli SMEMBERS relayer:active
# Expected: oz-relayer-0, oz-relayer-1 (oz-relayer-2 NOT present)

# 5. Check logs
docker-compose logs relayer-discovery | grep "Monitoring"
```

**Success Criteria:**
- [ ] Only 2 relayers in active list (oz-relayer-0, oz-relayer-1)
- [ ] oz-relayer-2 not monitored (no health checks, no logs)
- [ ] Logs confirm monitoring count: "Monitoring 2 relayers"

---

#### AC-006: Custom Health Check Interval

**Priority:** LOW
**Related Requirements:**
- [FR-004 (Configurable Health Check Interval)](./spec.md#fr-004-configurable-health-check-interval)
- [IR-004 (Health Check Interval Configuration)](./spec.md#ir-004-health-check-interval-configuration)

**Given:**
- `HEALTH_CHECK_INTERVAL_MS=5000` is set in environment (5 seconds instead of default 10 seconds)
- relayer-discovery service is running

**When:**
- The service executes health checks

**Then:**
- Health checks SHALL execute every 5 seconds (not default 10 seconds)
- Time difference between consecutive health checks SHALL be approximately 5000ms ± 100ms
- Logs SHALL include timestamps confirming 5-second interval

**Verification Steps:**
```bash
# 1. Update docker-compose.yml
# Set HEALTH_CHECK_INTERVAL_MS=5000

# 2. Restart relayer-discovery
docker-compose restart relayer-discovery

# 3. Monitor logs with timestamps
docker-compose logs -f relayer-discovery | grep "Health check completed"

# Expected log output (timestamps approximately 5 seconds apart):
# [10:00:00] Health check completed for oz-relayer-0 in 450ms
# [10:00:05] Health check completed for oz-relayer-0 in 430ms
# [10:00:10] Health check completed for oz-relayer-0 in 460ms
```

**Success Criteria:**
- [ ] Health checks execute every ~5 seconds (not 10 seconds)
- [ ] Time difference between consecutive checks: 5000ms ± 100ms
- [ ] Logs confirm custom interval

---

### Category 4: Redis State Consistency

#### AC-007: Redis State Consistency Under Concurrent Updates

**Priority:** MEDIUM
**Related Requirements:**
- [NFR-002 (Atomic Redis Operations)](./spec.md#nfr-002-atomic-redis-operations)

**Given:**
- Multiple health checks execute concurrently (3 relayers checked in parallel)
- Health check results may arrive simultaneously

**When:**
- Redis updates occur concurrently (SADD/SREM operations from parallel health checks)

**Then:**
- No race conditions SHALL occur
- `relayer:active` set size SHALL match expected active relayer count
- No duplicate entries SHALL exist in `relayer:active`
- No missing entries SHALL occur (all healthy relayers present)

**Verification Steps:**
```bash
# 1. Run stress test: 100 health check cycles
# (Requires custom test script or modification to health check interval)

# 2. After 100 cycles, verify Redis consistency
redis-cli SMEMBERS relayer:active
# Expected: Consistent set of healthy relayers (no duplicates, no missing entries)

# 3. Check for Redis operation errors
docker-compose logs relayer-discovery | grep "Redis error"
# Expected: No errors

# 4. Verify set size matches expected count
redis-cli SCARD relayer:active
# Expected: 3 (if all relayers healthy)
```

**Success Criteria:**
- [ ] No race condition errors after 100+ health check cycles
- [ ] `relayer:active` set size matches expected active count
- [ ] No duplicate entries in Redis set
- [ ] No missing healthy relayers

---

#### AC-008: Redis Connection Failure Handling

**Priority:** HIGH
**Related Requirements:**
- [NFR-002 (Atomic Redis Operations)](./spec.md#nfr-002-atomic-redis-operations)
- [FR-003 (Queue Consumer Redis Integration)](./spec.md#fr-003-queue-consumer-redis-integration)

**Given:**
- Redis connection is unavailable or fails during operation

**When:**
- The relayer-discovery service attempts to update `relayer:active`

**Then:**
- The service SHALL log the error with details
- The service SHALL retry with exponential backoff
- The service SHALL continue performing health checks (not crash)
- Once Redis recovers, the service SHALL resume updates successfully

**Verification Steps:**
```bash
# 1. Verify initial state
redis-cli SMEMBERS relayer:active
# Expected: 3 relayers

# 2. Stop Redis
docker-compose stop redis

# 3. Verify relayer-discovery logs show retry attempts
docker-compose logs relayer-discovery | grep "Redis connection failed"
# Expected: Error logs with retry messages

# 4. Verify service continues running (not crashed)
docker-compose ps relayer-discovery
# Expected: Status = Up

# 5. Restart Redis
docker-compose start redis

# 6. Wait 15 seconds
sleep 15

# 7. Verify service recovers and resumes updates
redis-cli SMEMBERS relayer:active
# Expected: Active relayers restored

# 8. Check logs for recovery message
docker-compose logs relayer-discovery | grep "Redis connection restored"
```

**Success Criteria:**
- [ ] Error logs show Redis connection failures
- [ ] Service does not crash during Redis outage
- [ ] Retry logic executes (exponential backoff visible in logs)
- [ ] Service recovers automatically when Redis restarts
- [ ] Active relayer list restored after recovery

---

### Category 5: Monitoring API

#### AC-009: Monitoring Endpoint Returns Active Relayer List

**Priority:** MEDIUM
**Related Requirements:**
- [FR-008 (Monitoring API Endpoint)](./spec.md#fr-008-monitoring-api-endpoint)
- [IR-005 (Monitoring Endpoint Response Format)](./spec.md#ir-005-monitoring-endpoint-response-format)

**Given:**
- The relayer-discovery service is running
- 2 relayers are active (oz-relayer-0, oz-relayer-1)
- oz-relayer-2 is down (not in active list)

**When:**
- A GET request is made to `http://relayer-discovery:3001/status`

**Then:**
- The response SHALL return HTTP 200
- The response SHALL be valid JSON matching the schema defined in IR-005
- The `activeRelayers` array SHALL contain 2 entries (oz-relayer-0, oz-relayer-1)
- The `totalConfigured` field SHALL be 3
- The `totalActive` field SHALL be 2
- Each relayer object SHALL include: id, status, lastCheckTimestamp, url

**Verification Steps:**
```bash
# 1. Stop oz-relayer-2
docker-compose stop oz-relayer-2

# 2. Wait for health check to remove oz-relayer-2
sleep 11

# 3. Query monitoring endpoint
curl -s http://relayer-discovery:3001/status | jq

# Expected response:
# {
#   "service": "relayer-discovery",
#   "status": "healthy",
#   "timestamp": "2026-01-17T10:30:00.000Z",
#   "activeRelayers": [
#     {
#       "id": "oz-relayer-0",
#       "status": "healthy",
#       "lastCheckTimestamp": "2026-01-17T10:29:55.000Z",
#       "url": "http://oz-relayer-0:3000"
#     },
#     {
#       "id": "oz-relayer-1",
#       "status": "healthy",
#       "lastCheckTimestamp": "2026-01-17T10:29:55.000Z",
#       "url": "http://oz-relayer-1:3000"
#     }
#   ],
#   "totalConfigured": 3,
#   "totalActive": 2,
#   "healthCheckInterval": 10000
# }

# 4. Verify JSON schema
curl -s http://relayer-discovery:3001/status | jq '.activeRelayers | length'
# Expected: 2
```

**Success Criteria:**
- [ ] HTTP 200 response
- [ ] Valid JSON response
- [ ] Response matches IR-005 schema
- [ ] `totalConfigured` = 3
- [ ] `totalActive` = 2
- [ ] Active relayers array contains oz-relayer-0 and oz-relayer-1 only
- [ ] Each relayer has id, status, lastCheckTimestamp, url fields

---

### AC-010: queue-consumer Redis Connection Failure Handling

**Priority:** HIGH
**Related Requirements:**
- [FR-003 (Queue Consumer Redis Integration)](./spec.md#fr-003-queue-consumer-redis-integration)

**Given:**
- queue-consumer is running
- Redis connection becomes unavailable during operation

**When:**
- queue-consumer attempts to query `relayer:active` via `SMEMBERS`

**Then:**
- Service SHALL log error with timestamp and error details
- Service SHALL retry with exponential backoff (1s, 2s, 4s, max 10s)
- Service SHALL NOT crash (continues running)
- Relay requests SHALL fail gracefully with "No active relayers" error
- Once Redis recovers, service SHALL resume normal operation

**Verification Steps:**
```bash
# 1. Verify queue-consumer is running
docker-compose ps queue-consumer
# Expected: Status = Up

# 2. Stop Redis
docker-compose stop redis

# 3. Monitor queue-consumer logs
docker-compose logs -f queue-consumer | grep "Redis"
# Expected: Error logs with retry attempts

# 4. Verify service continues running
docker-compose ps queue-consumer
# Expected: Status still Up (not crashed)

# 5. Restart Redis
docker-compose start redis

# 6. Wait 15 seconds
sleep 15

# 7. Verify service recovers
docker-compose logs queue-consumer | grep "Redis connection restored"
```

**Success Criteria:**
- [ ] Error logs show Redis connection failures
- [ ] Service does not crash during Redis outage
- [ ] Retry logic executes (exponential backoff visible in logs)
- [ ] Relay requests fail with appropriate error message
- [ ] Service recovers automatically when Redis restarts

---

## Edge Cases

### Edge Case 1: All Relayers Down

**Scenario:**
- All 3 OZ Relayers are down or unresponsive

**Expected Behavior:**
- `relayer:active` becomes empty
- queue-consumer receives empty list from Redis
- queue-consumer logs error: "No active relayers available"
- Relay requests fail with appropriate error message
- relayer-discovery continues health checks (attempts recovery)

**Verification:**
```bash
# Stop all relayers
docker-compose stop oz-relayer-0 oz-relayer-1 oz-relayer-2

# Verify Redis state
redis-cli SMEMBERS relayer:active
# Expected: (empty list)

# Verify queue-consumer error handling
docker-compose logs queue-consumer | grep "No active relayers"
```

---

### Edge Case 2: Redis Connection Failure During Startup

**Scenario:**
- relayer-discovery starts before Redis is available

**Expected Behavior:**
- Service logs error: "Redis connection unavailable"
- Service retries connection with exponential backoff
- Service does not crash (continues retrying)
- Once Redis becomes available, service connects and starts health checks

**Verification:**
```bash
# Stop Redis
docker-compose stop redis

# Start relayer-discovery
docker-compose up -d relayer-discovery

# Verify retry logs
docker-compose logs relayer-discovery | grep "Redis connection retry"

# Start Redis
docker-compose start redis

# Verify successful connection
docker-compose logs relayer-discovery | grep "Redis connection established"
```

---

### Edge Case 3: Partial Network Failure

**Scenario:**
- oz-relayer-1 is healthy but network communication is intermittently failing

**Expected Behavior:**
- Health check may fail intermittently (timeout or connection error)
- relayer-discovery removes oz-relayer-1 when health check fails
- relayer-discovery re-adds oz-relayer-1 when health check succeeds
- Logs show flapping behavior (removal and re-addition)
- queue-consumer adapts to changing active list

**Mitigation (Future Enhancement):**
- Implement health check retry logic (3 failures before removal)
- Add debouncing to prevent flapping

**Verification:**
```bash
# Simulate network flapping using iptables (advanced)
# OR manually stop/start oz-relayer-1 repeatedly

# Monitor Redis state changes
watch -n 1 'redis-cli SMEMBERS relayer:active'

# Verify logs show flapping
docker-compose logs relayer-discovery | grep -E "(Added|Removed) oz-relayer-1"
```

---

### Edge Case 4: Health Endpoint Returns Non-200 Status

**Scenario:**
- oz-relayer-1 returns HTTP 503 (Service Unavailable) instead of 200

**Expected Behavior:**
- Health check treats 503 as failure
- oz-relayer-1 removed from active list
- Logs show: "Health check failed for oz-relayer-1: HTTP 503"

**Verification:**
```bash
# Modify oz-relayer-1 to return 503 (requires custom test setup or mock server)

# Verify removal
redis-cli SMEMBERS relayer:active
# Expected: oz-relayer-0, oz-relayer-2 (oz-relayer-1 removed)

# Check logs
docker-compose logs relayer-discovery | grep "HTTP 503"
```

---

### Edge Case 5: RELAYER_COUNT Exceeds Deployed Relayers

**Scenario:**
- `RELAYER_COUNT=5` but only 3 relayers deployed (oz-relayer-0, 1, 2)

**Expected Behavior:**
- Health checks for oz-relayer-3 and oz-relayer-4 fail (connection refused)
- Only oz-relayer-0, 1, 2 added to active list
- Logs show warnings: "oz-relayer-3 not reachable", "oz-relayer-4 not reachable"
- Service continues monitoring available relayers

**Verification:**
```bash
# Set RELAYER_COUNT=5
# Restart relayer-discovery

# Verify only 3 relayers in active list
redis-cli SMEMBERS relayer:active
# Expected: oz-relayer-0, oz-relayer-1, oz-relayer-2 (max 3)

# Check logs for warnings
docker-compose logs relayer-discovery | grep "not reachable"
```

---

## Performance Criteria

### Performance Test 1: Health Check Latency

**Requirement:** Health checks SHALL complete within 500ms per relayer (NFR-001)

**Test Procedure:**
1. Run 100 health check cycles
2. Measure duration for each health check
3. Calculate average, p95, p99 latencies

**Success Criteria:**
- Average latency: < 200ms
- P95 latency: < 400ms
- P99 latency: < 500ms

**Verification:**
```bash
# Enable performance logging
# Analyze logs to extract health check durations

docker-compose logs relayer-discovery | grep "Health check completed" | awk '{print $NF}' | sort -n | tail -n 5
# Expected: All values < 500ms
```

---

### Performance Test 2: Redis Update Latency

**Requirement:** Redis state updates SHALL complete within 100ms

**Test Procedure:**
1. Measure time for SADD/SREM operations
2. Run 1000 Redis operations
3. Calculate average latency

**Success Criteria:**
- Average latency: < 50ms
- P99 latency: < 100ms

**Verification:**
```bash
# Use Redis SLOWLOG to monitor slow queries
redis-cli SLOWLOG GET 10

# Expected: No SADD/SREM operations > 100ms
```

---

### Performance Test 3: Monitoring Endpoint Response Time

**Requirement:** GET /status endpoint SHALL respond within 100ms (FR-008)

**Test Procedure:**
1. Send 100 requests to GET /status
2. Measure response time for each request
3. Calculate average, p95, p99 latencies

**Success Criteria:**
- Average latency: < 50ms
- P95 latency: < 80ms
- P99 latency: < 100ms

**Verification:**
```bash
# Use Apache Bench or curl with timing
for i in {1..100}; do
  curl -o /dev/null -s -w "%{time_total}\n" http://relayer-discovery:3001/status
done | sort -n | tail -n 5

# Expected: All values < 0.100 (100ms)
```

---

## Success Criteria Summary

### Minimum Requirements for Acceptance

The implementation SHALL be considered complete and ready for production when:

1. **All AC scenarios pass (AC-001 through AC-009):** 9/9 scenarios passing
2. **All edge cases handled correctly:** 5/5 edge cases verified
3. **Performance criteria met:** 3/3 performance tests passing
4. **Test coverage >= 80%:** Unit tests, integration tests
5. **No regressions:** All existing integration tests pass
6. **Documentation complete:** README, operational guides updated
7. **Code review approved:** Technical lead sign-off

### Acceptance Checklist

- [ ] AC-001: Initial discovery of all relayers
- [ ] AC-002: Fast health check completion
- [ ] AC-003: Unhealthy relayer removal
- [ ] AC-004: Recovered relayer re-addition
- [ ] AC-005: RELAYER_COUNT configuration enforcement
- [ ] AC-006: Custom health check interval
- [ ] AC-007: Redis state consistency under concurrent updates
- [ ] AC-008: Redis connection failure handling
- [ ] AC-009: Monitoring endpoint returns active relayer list
- [ ] AC-010: queue-consumer Redis connection failure handling
- [ ] Edge Case 1: All relayers down
- [ ] Edge Case 2: Redis connection failure during startup
- [ ] Edge Case 3: Partial network failure
- [ ] Edge Case 4: Health endpoint returns non-200 status
- [ ] Edge Case 5: RELAYER_COUNT exceeds deployed relayers
- [ ] Performance Test 1: Health check latency < 500ms
- [ ] Performance Test 2: Redis update latency < 100ms
- [ ] Performance Test 3: Monitoring endpoint response < 100ms
- [ ] Unit test coverage >= 80%
- [ ] Integration test coverage >= 80%
- [ ] No regressions in existing tests
- [ ] Documentation updated
- [ ] Code review approved

---

## Test Execution Report Template

### Test Summary

| Category | Total | Passed | Failed | Blocked |
|----------|-------|--------|--------|---------|
| Health Check Discovery | 2 | - | - | - |
| Failover Scenarios | 2 | - | - | - |
| Configuration Changes | 2 | - | - | - |
| Redis State Consistency | 3 | - | - | - |
| Monitoring API | 1 | - | - | - |
| Edge Cases | 5 | - | - | - |
| Performance Tests | 3 | - | - | - |
| **Total** | **18** | **-** | **-** | **-** |

### Test Environment Details

- Docker Compose Version: ___________
- Redis Version: ___________
- NestJS Version: ___________
- Test Execution Date: ___________
- Test Executor: ___________

### Known Issues

_(List any known issues or deviations from expected behavior)_

### Recommendations

_(List any recommendations for improvements or follow-up work)_

---

**Acceptance Criteria Version:** 1.0.0
**Last Updated:** 2026-01-17
**Approval Status:** Pending Testing

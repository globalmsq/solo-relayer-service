# SPEC-HEALTH-001 Acceptance Criteria

This document defines the acceptance criteria for the Health Check Endpoint Implementation using Given/When/Then scenarios. All scenarios must pass for the SPEC to be considered complete.

---

## Overview

**Test Coverage Target**: ≥90%
**Test Framework**: Jest
**Test Types**: Unit, Integration, E2E
**Total Scenarios**: 12

---

## Scenario 1: OzRelayerHealthIndicator - All Relayers Healthy

### AC-001: Successful Pool Health Check

**Priority**: P0 (Critical)
**Test Type**: Unit Test
**File**: `oz-relayer.health.spec.ts`

#### Given
- All 3 OZ Relayer instances (`oz-relayer-1`, `oz-relayer-2`, `oz-relayer-3`) are running
- Each relayer responds to `/api/v1/health` within 5 seconds
- HTTP status 200 returned from all relayers

#### When
- `OzRelayerHealthIndicator.isHealthy('oz-relayer-pool')` is invoked

#### Then
- Method returns `HealthIndicatorResult` (does not throw)
- Result contains:
  ```typescript
  {
    'oz-relayer-pool': {
      status: 'healthy',
      healthyCount: 3,
      totalCount: 3,
      relayers: [
        { id: 'oz-relayer-1', url: '...', status: 'healthy', responseTime: <number> },
        { id: 'oz-relayer-2', url: '...', status: 'healthy', responseTime: <number> },
        { id: 'oz-relayer-3', url: '...', status: 'healthy', responseTime: <number> },
      ]
    }
  }
  ```
- Response time for each relayer is < 5000ms
- No `HealthCheckError` is thrown

#### Validation
```typescript
const result = await indicator.isHealthy('oz-relayer-pool');
expect(result['oz-relayer-pool'].status).toBe('healthy');
expect(result['oz-relayer-pool'].healthyCount).toBe(3);
expect(result['oz-relayer-pool'].totalCount).toBe(3);
expect(result['oz-relayer-pool'].relayers).toHaveLength(3);
result['oz-relayer-pool'].relayers.forEach(r => {
  expect(r.status).toBe('healthy');
  expect(r.responseTime).toBeLessThan(5000);
});
```

---

## Scenario 2: OzRelayerHealthIndicator - Partial Relayer Failure

### AC-002: Degraded Pool Status (2/3 Relayers Healthy)

**Priority**: P0 (Critical)
**Test Type**: Unit Test
**File**: `oz-relayer.health.spec.ts`

#### Given
- 2 OZ Relayer instances are healthy (`oz-relayer-1`, `oz-relayer-2`)
- 1 OZ Relayer instance is unhealthy (`oz-relayer-3` returns HTTP 500 or timeout)

#### When
- `OzRelayerHealthIndicator.isHealthy('oz-relayer-pool')` is invoked

#### Then
- Method throws `HealthCheckError`
- Error result contains:
  ```typescript
  {
    'oz-relayer-pool': {
      status: 'degraded',
      healthyCount: 2,
      totalCount: 3,
      relayers: [
        { id: 'oz-relayer-1', status: 'healthy', responseTime: <number> },
        { id: 'oz-relayer-2', status: 'healthy', responseTime: <number> },
        { id: 'oz-relayer-3', status: 'unhealthy', responseTime: <number>, error: '...' },
      ]
    }
  }
  ```
- Unhealthy relayer includes error message
- Error message is `'OZ Relayer Pool health check failed'`

#### Validation
```typescript
try {
  await indicator.isHealthy('oz-relayer-pool');
  fail('Should have thrown HealthCheckError');
} catch (error) {
  expect(error).toBeInstanceOf(HealthCheckError);
  const result = error.causes['oz-relayer-pool'];
  expect(result.status).toBe('degraded');
  expect(result.healthyCount).toBe(2);
  expect(result.totalCount).toBe(3);
}
```

---

## Scenario 3: OzRelayerHealthIndicator - Complete Pool Failure

### AC-003: Unhealthy Pool Status (0/3 Relayers Healthy)

**Priority**: P0 (Critical)
**Test Type**: Unit Test
**File**: `oz-relayer.health.spec.ts`

#### Given
- All 3 OZ Relayer instances are unreachable or returning errors
- HTTP requests fail with connection timeout, 500 errors, or network errors

#### When
- `OzRelayerHealthIndicator.isHealthy('oz-relayer-pool')` is invoked

#### Then
- Method throws `HealthCheckError`
- Error result contains:
  ```typescript
  {
    'oz-relayer-pool': {
      status: 'unhealthy',
      healthyCount: 0,
      totalCount: 3,
      relayers: [
        { id: 'oz-relayer-1', status: 'unhealthy', error: '...' },
        { id: 'oz-relayer-2', status: 'unhealthy', error: '...' },
        { id: 'oz-relayer-3', status: 'unhealthy', error: '...' },
      ]
    }
  }
  ```
- Each unhealthy relayer includes specific error message
- Error message is `'OZ Relayer Pool health check failed'`

#### Validation
```typescript
try {
  await indicator.isHealthy('oz-relayer-pool');
  fail('Should have thrown HealthCheckError');
} catch (error) {
  expect(error).toBeInstanceOf(HealthCheckError);
  const result = error.causes['oz-relayer-pool'];
  expect(result.status).toBe('unhealthy');
  expect(result.healthyCount).toBe(0);
  expect(result.relayers.every(r => r.status === 'unhealthy')).toBe(true);
}
```

---

## Scenario 4: OzRelayerHealthIndicator - Timeout Handling

### AC-004: Relayer Response Timeout (>5 seconds)

**Priority**: P1 (High)
**Test Type**: Unit Test
**File**: `oz-relayer.health.spec.ts`

#### Given
- `oz-relayer-1` responds within 5 seconds
- `oz-relayer-2` does not respond within 5 seconds (simulated delay)
- `oz-relayer-3` responds within 5 seconds

#### When
- `OzRelayerHealthIndicator.isHealthy('oz-relayer-pool')` is invoked

#### Then
- Method throws `HealthCheckError` (due to timeout)
- Error result contains:
  ```typescript
  {
    'oz-relayer-pool': {
      status: 'degraded',
      healthyCount: 2,
      totalCount: 3,
      relayers: [
        { id: 'oz-relayer-1', status: 'healthy', responseTime: <number> },
        { id: 'oz-relayer-2', status: 'unhealthy', error: 'Timeout', responseTime: ~5000 },
        { id: 'oz-relayer-3', status: 'healthy', responseTime: <number> },
      ]
    }
  }
  ```
- Timeout error message contains "Timeout" or "timeout exceeded"
- Response time for timed-out relayer is approximately 5000ms

#### Validation
```typescript
// Mock oz-relayer-2 with 6-second delay
jest.spyOn(httpService, 'get').mockImplementation((url) => {
  if (url.includes('oz-relayer-2')) {
    return new Observable((subscriber) => {
      setTimeout(() => subscriber.next({ data: {} }), 6000);
    });
  }
  return of({ data: {} });
});

try {
  await indicator.isHealthy('oz-relayer-pool');
} catch (error) {
  const result = error.causes['oz-relayer-pool'];
  const timedOutRelayer = result.relayers.find(r => r.id === 'oz-relayer-2');
  expect(timedOutRelayer.status).toBe('unhealthy');
  expect(timedOutRelayer.error).toContain('timeout');
}
```

---

## Scenario 5: OzRelayerHealthIndicator - Parallel Execution

### AC-005: Concurrent Relayer Health Checks

**Priority**: P1 (High)
**Test Type**: Unit Test
**File**: `oz-relayer.health.spec.ts`

#### Given
- All 3 OZ Relayer instances are healthy
- HTTP request duration is 2 seconds per relayer (simulated)

#### When
- `OzRelayerHealthIndicator.isHealthy('oz-relayer-pool')` is invoked

#### Then
- Total execution time is approximately 2 seconds (not 6 seconds)
- All 3 HTTP requests are initiated concurrently (verified via spy)
- Method completes before 3-second timeout (proves parallel execution)

#### Validation
```typescript
const httpGetSpy = jest.spyOn(httpService, 'get').mockReturnValue(
  // Simulate 2-second response delay
  new Observable((subscriber) => {
    setTimeout(() => subscriber.next({ data: {} }), 2000);
  })
);

const startTime = Date.now();
await indicator.isHealthy('oz-relayer-pool');
const duration = Date.now() - startTime;

expect(httpGetSpy).toHaveBeenCalledTimes(3); // All 3 called
expect(duration).toBeLessThan(3000); // < 3s proves parallel
expect(duration).toBeGreaterThan(2000); // > 2s proves delay worked
```

---

## Scenario 6: RedisHealthIndicator - Placeholder Behavior

### AC-006: Phase 1 Redis Placeholder Returns Healthy

**Priority**: P0 (Critical)
**Test Type**: Unit Test
**File**: `redis.health.spec.ts`

#### Given
- Phase 1 scope (no actual Redis connectivity testing)
- RedisHealthIndicator is instantiated

#### When
- `RedisHealthIndicator.isHealthy('redis')` is invoked

#### Then
- Method returns `HealthIndicatorResult` (does not throw)
- Result contains:
  ```typescript
  {
    'redis': {
      status: 'healthy',
      message: 'Phase 1: Redis connectivity not implemented'
    }
  }
  ```
- Always returns healthy status regardless of actual Redis state
- No Redis client connection is attempted

#### Validation
```typescript
const indicator = new RedisHealthIndicator();
const result = await indicator.isHealthy('redis');

expect(result['redis'].status).toBe('healthy');
expect(result['redis'].message).toContain('Phase 1');
expect(result['redis'].message).toContain('not implemented');
```

---

## Scenario 7: HealthController - Successful Health Check

### AC-007: Standard Terminus Response Format (200 OK)

**Priority**: P0 (Critical)
**Test Type**: Integration Test
**File**: `health.controller.spec.ts`

#### Given
- OzRelayerHealthIndicator returns healthy status
- RedisHealthIndicator returns healthy status
- HealthCheckService is properly configured

#### When
- `GET /api/v1/health` is requested

#### Then
- HTTP status code is 200
- Response body matches @nestjs/terminus standard format:
  ```typescript
  {
    status: 'ok',
    info: {
      'oz-relayer-pool': {
        status: 'healthy',
        healthyCount: 3,
        totalCount: 3,
        relayers: [...]
      },
      'redis': {
        status: 'healthy',
        message: 'Phase 1: Redis connectivity not implemented'
      }
    },
    error: {},
    details: {
      'oz-relayer-pool': {...},
      'redis': {...}
    }
  }
  ```
- `status` field is `'ok'`
- `info` field contains both services
- `error` field is empty object
- `details` field contains all service details

#### Validation
```typescript
const response = await request(app.getHttpServer())
  .get('/api/v1/health')
  .expect(200);

expect(response.body.status).toBe('ok');
expect(response.body.info['oz-relayer-pool']).toBeDefined();
expect(response.body.info['redis']).toBeDefined();
expect(response.body.error).toEqual({});
expect(response.body.details['oz-relayer-pool']).toBeDefined();
```

---

## Scenario 8: HealthController - Service Unavailable

### AC-008: Standard Error Response Format (503 Service Unavailable)

**Priority**: P0 (Critical)
**Test Type**: Integration Test
**File**: `health.controller.spec.ts`

#### Given
- OzRelayerHealthIndicator throws HealthCheckError (degraded pool)
- RedisHealthIndicator returns healthy status

#### When
- `GET /api/v1/health` is requested

#### Then
- HTTP status code is 503
- Response body matches @nestjs/terminus error format:
  ```typescript
  {
    status: 'error',
    info: {
      'redis': {
        status: 'healthy',
        message: '...'
      }
    },
    error: {
      'oz-relayer-pool': {
        status: 'degraded',
        healthyCount: 1,
        totalCount: 3,
        relayers: [...]
      }
    },
    details: {
      'oz-relayer-pool': {...},
      'redis': {...}
    }
  }
  ```
- `status` field is `'error'`
- `info` field contains healthy services (redis)
- `error` field contains unhealthy services (oz-relayer-pool)
- `details` field contains all service details

#### Validation
```typescript
// Mock OzRelayerHealthIndicator to throw HealthCheckError
jest.spyOn(ozRelayerHealth, 'isHealthy').mockRejectedValue(
  new HealthCheckError('Pool degraded', {
    'oz-relayer-pool': { status: 'degraded', healthyCount: 1, totalCount: 3 }
  })
);

const response = await request(app.getHttpServer())
  .get('/api/v1/health')
  .expect(503);

expect(response.body.status).toBe('error');
expect(response.body.info['redis']).toBeDefined();
expect(response.body.error['oz-relayer-pool']).toBeDefined();
expect(response.body.error['oz-relayer-pool'].status).toBe('degraded');
```

---

## Scenario 9: HealthController - Public Endpoint Access

### AC-009: Unauthenticated Access Allowed

**Priority**: P1 (High)
**Test Type**: Integration Test
**File**: `health.controller.spec.ts`

#### Given
- API Gateway has authentication enabled globally
- `/api/v1/health` endpoint is decorated with `@Public()`

#### When
- `GET /api/v1/health` is requested without Authorization header

#### Then
- HTTP status code is 200 or 503 (based on service health)
- No 401 Unauthorized response
- No authentication error
- Health check executes successfully

#### Validation
```typescript
const response = await request(app.getHttpServer())
  .get('/api/v1/health')
  // No Authorization header
  .expect((res) => {
    expect(res.status).not.toBe(401);
    expect(res.body.status).toMatch(/ok|error/);
  });
```

---

## Scenario 10: E2E Test - Docker Compose Environment

### AC-010: Real-World Health Check in Docker Compose

**Priority**: P0 (Critical)
**Test Type**: E2E Test
**File**: `health.e2e-spec.ts`

#### Given
- Docker Compose environment is running
- All 3 OZ Relayer containers are healthy
- Redis container is running
- API Gateway is accessible at `http://localhost:3000`

#### When
- `GET http://localhost:3000/api/v1/health` is requested

#### Then
- HTTP status code is 200
- Response body contains:
  - `status: 'ok'`
  - `info['oz-relayer-pool'].healthyCount: 3`
  - `info['redis'].status: 'healthy'`
- Response time is < 6 seconds
- No MySQL connection attempts are logged

#### Validation
```typescript
const startTime = Date.now();
const response = await request('http://localhost:3000')
  .get('/api/v1/health')
  .expect(200);
const duration = Date.now() - startTime;

expect(response.body.status).toBe('ok');
expect(response.body.info['oz-relayer-pool'].healthyCount).toBe(3);
expect(response.body.info['redis'].status).toBe('healthy');
expect(duration).toBeLessThan(6000);

// Verify no Prisma/MySQL logs
const logs = await execAsync('docker logs relay-api | grep -i prisma');
expect(logs.stdout).toBe('');
```

---

## Scenario 11: E2E Test - Degraded State Simulation

### AC-011: Partial Service Failure Handling

**Priority**: P1 (High)
**Test Type**: E2E Test
**File**: `health.e2e-spec.ts`

#### Given
- Docker Compose environment is running
- 2 OZ Relayer containers are healthy (`oz-relayer-1`, `oz-relayer-2`)
- 1 OZ Relayer container is stopped (`oz-relayer-3`)

#### When
- `GET http://localhost:3000/api/v1/health` is requested

#### Then
- HTTP status code is 503
- Response body contains:
  - `status: 'error'`
  - `error['oz-relayer-pool'].status: 'degraded'`
  - `error['oz-relayer-pool'].healthyCount: 2`
  - `info['redis'].status: 'healthy'`
- Unhealthy relayer details include error message

#### Validation
```typescript
// Stop oz-relayer-3 container
await execAsync('docker stop oz-relayer-3');

const response = await request('http://localhost:3000')
  .get('/api/v1/health')
  .expect(503);

expect(response.body.status).toBe('error');
expect(response.body.error['oz-relayer-pool'].status).toBe('degraded');
expect(response.body.error['oz-relayer-pool'].healthyCount).toBe(2);

// Restart container
await execAsync('docker start oz-relayer-3');
```

---

## Scenario 12: Swagger Documentation Validation

### AC-012: API Documentation Completeness

**Priority**: P2 (Medium)
**Test Type**: Manual Test
**File**: N/A (manual verification)

#### Given
- API Gateway Swagger UI is accessible at `/api/docs`
- Health endpoints are documented

#### When
- Swagger UI is opened in browser
- `/api/v1/health` endpoint is inspected

#### Then
- Endpoint is visible in "Health" tag group
- Operation summary is "Get system health status"
- Description mentions @nestjs/terminus pattern
- Response examples are provided:
  - 200 OK example (all services healthy)
  - 503 Service Unavailable example (degraded/unhealthy)
- Request parameters are documented (none for GET /health)
- Response schema includes `status`, `info`, `error`, `details` fields

#### Validation
- Manual verification via Swagger UI
- Screenshot of documentation page
- Verified by code reviewer

---

## Summary Table

| Scenario | Priority | Test Type | File | Status |
|----------|----------|-----------|------|--------|
| AC-001: All Relayers Healthy | P0 | Unit | oz-relayer.health.spec.ts | ⏳ Pending |
| AC-002: Partial Relayer Failure | P0 | Unit | oz-relayer.health.spec.ts | ⏳ Pending |
| AC-003: Complete Pool Failure | P0 | Unit | oz-relayer.health.spec.ts | ⏳ Pending |
| AC-004: Timeout Handling | P1 | Unit | oz-relayer.health.spec.ts | ⏳ Pending |
| AC-005: Parallel Execution | P1 | Unit | oz-relayer.health.spec.ts | ⏳ Pending |
| AC-006: Redis Placeholder | P0 | Unit | redis.health.spec.ts | ⏳ Pending |
| AC-007: Successful Health Check | P0 | Integration | health.controller.spec.ts | ⏳ Pending |
| AC-008: Service Unavailable | P0 | Integration | health.controller.spec.ts | ⏳ Pending |
| AC-009: Public Endpoint Access | P1 | Integration | health.controller.spec.ts | ⏳ Pending |
| AC-010: Docker Compose E2E | P0 | E2E | health.e2e-spec.ts | ⏳ Pending |
| AC-011: Degraded State E2E | P1 | E2E | health.e2e-spec.ts | ⏳ Pending |
| AC-012: Swagger Documentation | P2 | Manual | N/A | ⏳ Pending |

---

## Definition of Done

SPEC-HEALTH-001 is considered **complete** when:

1. ✅ All P0 acceptance criteria pass (8 scenarios)
2. ✅ All P1 acceptance criteria pass (4 scenarios)
3. ✅ Test coverage ≥ 90%
4. ✅ ESLint passes with 0 errors
5. ✅ TypeScript compiles with 0 errors
6. ✅ Prettier formatting applied
7. ✅ E2E tests pass in Docker Compose environment
8. ✅ Swagger documentation verified
9. ✅ Code review approved
10. ✅ PR merged to main branch

---

**Acceptance Criteria Version**: 1.0.0
**Last Updated**: 2025-12-17
**Total Scenarios**: 12 (8 P0, 4 P1, 1 P2)

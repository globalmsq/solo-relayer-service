# SPEC-HEALTH-001: Health Check Endpoint Implementation with @nestjs/terminus Pattern

## TAG BLOCK

```yaml
id: SPEC-HEALTH-001
title: Health Check Endpoint Implementation with @nestjs/terminus Pattern
status: completed
priority: high
created: 2025-12-17
updated: 2025-12-17
assignee: @user
tags:
  - health-check
  - nestjs
  - terminus
  - api-gateway
  - oz-relayer
  - redis
dependencies:
  - SPEC-MODULE-001
related_tasks:
  - task-master-task-4
version: 1.0.0
```

---

## Overview

This SPEC defines the migration of the existing custom health check implementation to the standard @nestjs/terminus pattern. The implementation provides health monitoring for OZ Relayer Pool (3 instances) and Redis service, following NestJS best practices and industry-standard health check patterns.

### Goals

1. **Standardization**: Migrate from custom pattern to @nestjs/terminus standard
2. **Reusability**: Leverage existing validated OZ Relayer check logic
3. **Extensibility**: Enable easy addition of new health indicators in future phases
4. **Observability**: Provide clear health status for monitoring systems

### Non-Goals (Phase 1)

- MySQL/Prisma health check (deferred to Phase 2+)
- Actual Redis connectivity testing (placeholder implementation only)
- Advanced metrics collection (Prometheus, Grafana integration)
- Health check caching or rate limiting

---

## EARS Requirements

### Ubiquitous Requirements (Always Apply)

**UBIQ-001: HealthIndicator Inheritance**
- **Requirement**: All health indicator classes SHALL extend `@nestjs/terminus`'s `HealthIndicator` base class
- **Rationale**: Ensures consistency with NestJS ecosystem and enables framework-level features
- **Validation**: TypeScript compiler check for `extends HealthIndicator`

**UBIQ-002: HealthCheckService Integration**
- **Requirement**: The `HealthController` SHALL use `HealthCheckService.check()` for all health check operations
- **Rationale**: Standardizes health check execution and response formatting
- **Validation**: Controller method uses `@HealthCheck()` decorator and calls `this.health.check()`

**UBIQ-003: Standard Response Format**
- **Requirement**: All health check responses SHALL follow @nestjs/terminus standard format with `status`, `info`, `error`, and `details` fields
- **Rationale**: Ensures compatibility with monitoring tools and consistent API contracts
- **Validation**: Response schema validation in integration tests

**UBIQ-004: Phase 1 Scope Constraint**
- **Requirement**: Phase 1 implementation SHALL NOT include MySQL/Prisma health checks
- **Rationale**: Focuses on migrating existing functionality first, database checks added later
- **Validation**: No Prisma client usage in health check code

---

### Event-driven Requirements (Triggered by Events)

**EVENT-001: Parallel Relayer Pool Check**
- **Event**: WHEN `OzRelayerHealthIndicator.isHealthy()` is invoked
- **Action**: The system SHALL check all 3 OZ Relayer instances in parallel using `Promise.all()`
- **Rationale**: Minimizes total health check duration, enables 5-second timeout compliance
- **Validation**: Test verifies concurrent HTTP requests (max 3 simultaneous connections)

**EVENT-002: Relayer Timeout Handling**
- **Event**: WHEN an individual OZ Relayer response exceeds 5 seconds
- **Action**: The system SHALL mark that relayer as `unhealthy` and include timeout error details
- **Rationale**: Prevents hung health checks from blocking the entire system
- **Validation**: Mock slow relayer responses in unit tests, verify timeout behavior

**EVENT-003: Pool Status Aggregation Error**
- **Event**: WHEN OZ Relayer Pool status is `unhealthy` or `degraded`
- **Action**: The system SHALL throw `HealthCheckError` with detailed pool status
- **Rationale**: Enables @nestjs/terminus to generate proper 503 Service Unavailable response
- **Validation**: Integration test verifies HealthCheckError thrown and caught by framework

**EVENT-004: Unhealthy Service Response**
- **Event**: WHEN any health indicator throws `HealthCheckError`
- **Action**: The `/health` endpoint SHALL return HTTP 503 with error details in response body
- **Rationale**: Standard HTTP semantics for service unavailability
- **Validation**: E2E test simulates service failure, verifies 503 status code

---

### State-driven Requirements (Based on System State)

**STATE-001: All Relayers Healthy**
- **State**: WHILE all 3 OZ Relayer instances return successful health responses
- **Behavior**: Pool status SHALL be `healthy` with `healthyCount: 3, totalCount: 3`
- **Rationale**: Clear indication that all backend services are operational
- **Validation**: Mock all relayers healthy, verify pool status aggregation

**STATE-002: Partial Relayer Availability**
- **State**: WHILE 1-2 OZ Relayer instances return successful health responses
- **Behavior**: Pool status SHALL be `degraded` with accurate `healthyCount`
- **Rationale**: System is operational but with reduced capacity
- **Validation**: Mock 2/3 relayers healthy, verify degraded status

**STATE-003: Complete Relayer Failure**
- **State**: WHILE 0 OZ Relayer instances return successful health responses
- **Behavior**: Pool status SHALL be `unhealthy` with `healthyCount: 0, totalCount: 3`
- **Rationale**: Critical failure state requiring immediate attention
- **Validation**: Mock all relayers down, verify unhealthy status

**STATE-004: Redis Placeholder Behavior**
- **State**: WHILE in Phase 1 scope
- **Behavior**: `RedisHealthIndicator` SHALL always return `healthy` status with placeholder message
- **Rationale**: Reserves integration point for Phase 2+ actual Redis connectivity check
- **Validation**: Verify placeholder message in response

---

### Unwanted Behaviors (Prohibited Actions)

**UNWANTED-001: Custom Response Format**
- **Prohibition**: The system SHALL NOT use custom health check response formats outside @nestjs/terminus standard
- **Reason**: Breaks compatibility with monitoring tools expecting standard format
- **Detection**: Response schema validation in tests

**UNWANTED-002: Phase 1 Database Access**
- **Prohibition**: The system SHALL NOT attempt MySQL/Prisma connectivity checks in Phase 1
- **Reason**: Out of scope for initial implementation, prevents scope creep
- **Detection**: Static analysis for Prisma client imports in health module

**UNWANTED-003: Non-Standard HealthIndicator Classes**
- **Prohibition**: The system SHALL NOT create health indicator classes that do not extend `HealthIndicator`
- **Reason**: Bypasses framework integration and type safety
- **Detection**: TypeScript compiler error if inheritance is missing

**UNWANTED-004: Direct Indicator Invocation**
- **Prohibition**: Controllers SHALL NOT call health indicator methods directly without `HealthCheckService`
- **Reason**: Breaks standard execution flow and error handling
- **Detection**: Code review and linting rule

---

### Optional Requirements (Nice-to-Have)

**OPTIONAL-001: Detailed Pool Status Endpoint**
- **Feature**: The system MAY preserve the existing `/relay/pool-status` endpoint for detailed OZ Relayer information
- **Benefit**: Provides granular debugging information beyond standard health check
- **Trade-off**: Additional endpoint to maintain

**OPTIONAL-002: Response Time Measurement**
- **Feature**: Health check results MAY include `responseTime` field for each relayer
- **Benefit**: Enables performance trend analysis
- **Trade-off**: Minimal overhead for `Date.now()` calls

**OPTIONAL-003: Enhanced Swagger Documentation**
- **Feature**: API documentation MAY include detailed examples for healthy, degraded, and unhealthy states
- **Benefit**: Improves developer experience
- **Trade-off**: Additional documentation maintenance

---

## Technical Specifications

### Architecture Overview

```
HealthModule (updated)
├── TerminusModule (imported)
├── HttpModule (existing)
├── OzRelayerHealthIndicator (new)
│   └── checks 3 OZ Relayer instances
├── RedisHealthIndicator (new)
│   └── placeholder (Phase 1)
└── HealthController (updated)
    ├── GET /api/v1/health (@HealthCheck)
    └── GET /relay/pool-status (optional)
```

### File Structure

```
packages/relay-api/src/health/
├── indicators/
│   ├── oz-relayer.health.ts       (new - 120 LOC)
│   ├── redis.health.ts             (new - 30 LOC)
│   ├── index.ts                    (new - 5 LOC)
│   ├── oz-relayer.health.spec.ts   (new - 180 LOC)
│   └── redis.health.spec.ts        (new - 60 LOC)
├── health.controller.ts            (modified - 80 LOC)
├── health.controller.spec.ts       (modified - 150 LOC)
├── health.module.ts                (modified - 25 LOC)
└── health.service.ts               (deprecated - keep for reference)
```

### Data Models

#### OzRelayerHealthIndicator Response

```typescript
interface RelayerHealth {
  id: string;                        // "oz-relayer-1", "oz-relayer-2", "oz-relayer-3"
  url: string;                       // "http://oz-relayer-1:8080/api/v1/health"
  status: 'healthy' | 'unhealthy';
  responseTime?: number;             // milliseconds
  error?: string;                    // error message if unhealthy
}

interface PoolHealthDetail {
  status: 'healthy' | 'degraded' | 'unhealthy';
  healthyCount: number;              // 0-3
  totalCount: number;                // always 3 in Phase 1
  relayers: RelayerHealth[];
}
```

#### @nestjs/terminus Standard Response

```typescript
interface HealthCheckResult {
  status: 'ok' | 'error';
  info: Record<string, any>;         // healthy services details
  error: Record<string, any>;        // unhealthy services details
  details: Record<string, any>;      // all services details
}
```

### Configuration

**Environment Variables** (existing):
```bash
# OZ Relayer API Keys (already configured)
OZ_RELAYER_1_API_KEY=test-api-key-relayer-1-local-dev-32ch
OZ_RELAYER_2_API_KEY=test-api-key-relayer-2-local-dev-32ch
OZ_RELAYER_3_API_KEY=test-api-key-relayer-3-local-dev-32ch

# Redis (used in placeholder)
REDIS_HOST=redis
REDIS_PORT=6379
```

**Dependencies** (already installed):
```json
{
  "@nestjs/terminus": "^10.2.0",
  "@nestjs/axios": "^3.0.0"
}
```

---

## Quality Gates

### Test Coverage

- **Target**: ≥90% (per project constitution)
- **Critical Paths**: All health indicator methods, controller endpoints, error handling

### Test Categories

1. **Unit Tests**:
   - `oz-relayer.health.spec.ts`: OzRelayerHealthIndicator logic
   - `redis.health.spec.ts`: RedisHealthIndicator placeholder

2. **Integration Tests**:
   - `health.controller.spec.ts`: HealthCheckService integration

3. **E2E Tests**:
   - `health.e2e-spec.ts`: Full health check flow in Docker Compose environment

### Linting & Formatting

- **ESLint**: Pass all rules
- **Prettier**: Auto-format on save
- **TypeScript**: Strict mode enabled, no `any` types

---

## Security Considerations

1. **No Sensitive Data Exposure**: Health check responses SHALL NOT include API keys, secrets, or internal IPs
2. **Public Endpoint**: `/health` is intentionally public (`@Public()` decorator) for load balancer health checks
3. **Rate Limiting**: Not implemented in Phase 1, consider for Phase 2+ if abuse detected

---

## Migration Strategy

### Backward Compatibility

- **Breaking Change**: Response format changes from custom to @nestjs/terminus standard
- **Mitigation**: Old format was not documented in public API, internal clients can adapt
- **Optional Endpoint**: `/relay/pool-status` preserved for detailed debugging

### Rollback Plan

- **If Migration Fails**: Revert to `health.service.ts` custom implementation
- **Git Strategy**: Feature branch with proper rollback commits
- **Testing**: All E2E tests must pass before merge

---

## Future Enhancements (Phase 2+)

1. **MySQL Health Check**: Add `DatabaseHealthIndicator` using Prisma
2. **Redis Connectivity**: Implement actual Redis PING check
3. **Metrics Export**: Prometheus metrics endpoint
4. **Health Check History**: Track uptime/downtime patterns
5. **Circuit Breaker**: Skip health checks for services in known failure state

---

## References

- [@nestjs/terminus Documentation](https://docs.nestjs.com/recipes/terminus)
- [Health Check API Standard (RFC Draft)](https://inadarei.github.io/rfc-healthcheck/)
- [Existing Implementation](packages/relay-api/src/health/health.service.ts)
- [Task Master Task #4](/.taskmaster/tasks/task-4.md)

---

## Acceptance Criteria

See [acceptance.md](./acceptance.md) for detailed Given/When/Then test scenarios.

---

**SPEC Version**: 1.0.0
**Last Updated**: 2025-12-17
**Status**: Pending Approval

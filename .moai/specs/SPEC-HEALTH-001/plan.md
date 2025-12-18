# SPEC-HEALTH-001 Implementation Plan

## Overview

This document outlines the detailed implementation plan for migrating the health check system from a custom pattern to the standard @nestjs/terminus pattern. The implementation is divided into 6 phases with clear deliverables and validation criteria.

---

## Phases Summary

| Phase | Description | Estimated Time | Files Changed |
|-------|-------------|----------------|---------------|
| **1** | Directory structure and scaffolding | 15 minutes | 3 new files |
| **2** | OzRelayerHealthIndicator implementation | 45 minutes | 1 new file |
| **3** | RedisHealthIndicator placeholder | 15 minutes | 1 new file |
| **4** | HealthController migration | 30 minutes | 1 modified file |
| **5** | HealthModule integration | 20 minutes | 1 modified file |
| **6** | Test implementation | 90 minutes | 4 new test files |
| **Total** | **6 phases** | **~3.5 hours** | **8 files** |

---

## Phase 1: Directory Structure and Scaffolding

### Objectives

- Create `indicators/` directory under `packages/relay-api/src/health/`
- Set up barrel export pattern for indicators
- Prepare TypeScript module structure

### Tasks

**1.1 Create Directory**

```bash
mkdir -p packages/relay-api/src/health/indicators
```

**1.2 Create Barrel Export File**

File: `packages/relay-api/src/health/indicators/index.ts`

```typescript
export * from './oz-relayer.health';
export * from './redis.health';
```

**1.3 Create Placeholder Files**

- `oz-relayer.health.ts` (empty class skeleton)
- `redis.health.ts` (empty class skeleton)

### Validation

- [x] Directory structure exists: `src/health/indicators/`
- [x] Barrel export file compiles without errors
- [x] No TypeScript compilation errors

### Estimated Time: 15 minutes

---

## Phase 2: OzRelayerHealthIndicator Implementation

### Objectives

- Migrate existing OZ Relayer check logic from `health.service.ts`
- Implement `HealthIndicator` interface with `isHealthy()` method
- Add 3-Relayer parallel check with timeout handling
- Implement status aggregation logic

### Tasks

**2.1 Create OzRelayerHealthIndicator Class**

File: `packages/relay-api/src/health/indicators/oz-relayer.health.ts`

**Key Components**:

1. **Class Declaration**:
   ```typescript
   @Injectable()
   export class OzRelayerHealthIndicator extends HealthIndicator {
     constructor(private readonly httpService: HttpService) {
       super();
     }
   }
   ```

2. **Relayer Configuration** (migrate from `health.service.ts`):
   ```typescript
   private readonly relayerEndpoints = [
     {
       id: 'oz-relayer-1',
       url: 'http://oz-relayer-1:8080/api/v1/health',
       apiKey: process.env.OZ_RELAYER_1_API_KEY || 'test-api-key-relayer-1-local-dev-32ch',
     },
     // ... oz-relayer-2, oz-relayer-3
   ];
   ```

3. **Main Health Check Method**:
   ```typescript
   async isHealthy(key: string): Promise<HealthIndicatorResult> {
     const results = await Promise.all(
       this.relayerEndpoints.map((endpoint) => this.checkSingleRelayer(endpoint))
     );

     const healthyCount = results.filter((r) => r.status === 'healthy').length;
     const totalCount = results.length;
     const status = this.aggregateStatus(healthyCount, totalCount);
     const isHealthy = status === 'healthy';

     const result = this.getStatus(key, isHealthy, {
       status,
       healthyCount,
       totalCount,
       relayers: results,
     });

     if (!isHealthy) {
       throw new HealthCheckError('OZ Relayer Pool health check failed', result);
     }

     return result;
   }
   ```

4. **Single Relayer Check** (migrate from `health.service.ts`):
   ```typescript
   private async checkSingleRelayer(endpoint: {
     id: string;
     url: string;
     apiKey: string;
   }): Promise<RelayerHealth> {
     const startTime = Date.now();

     try {
       await firstValueFrom(
         this.httpService
           .get(endpoint.url, {
             headers: { Authorization: `Bearer ${endpoint.apiKey}` },
           })
           .pipe(
             timeout(5000), // 5-second timeout
             catchError((err) => { throw err; })
           )
       );

       return {
         id: endpoint.id,
         url: endpoint.url,
         status: 'healthy',
         responseTime: Date.now() - startTime,
       };
     } catch (error) {
       return {
         id: endpoint.id,
         url: endpoint.url,
         status: 'unhealthy',
         responseTime: Date.now() - startTime,
         error: error instanceof Error ? error.message : 'Unknown error',
       };
     }
   }
   ```

5. **Status Aggregation**:
   ```typescript
   private aggregateStatus(
     healthyCount: number,
     totalCount: number
   ): 'healthy' | 'degraded' | 'unhealthy' {
     if (healthyCount === totalCount) return 'healthy';
     if (healthyCount > 0) return 'degraded';
     return 'unhealthy';
   }
   ```

### Validation

- [x] OzRelayerHealthIndicator extends HealthIndicator
- [x] Constructor injects HttpService
- [x] isHealthy() returns HealthIndicatorResult
- [x] Throws HealthCheckError when pool is degraded/unhealthy
- [x] Parallel execution of 3 relayer checks
- [x] 5-second timeout per relayer
- [x] Response time measurement included

### Estimated Time: 45 minutes

---

## Phase 3: RedisHealthIndicator Placeholder Implementation

### Objectives

- Create minimal placeholder for Redis health check
- Reserve integration point for Phase 2+
- Always return healthy status with placeholder message

### Tasks

**3.1 Create RedisHealthIndicator Class**

File: `packages/relay-api/src/health/indicators/redis.health.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  /**
   * Check Redis health
   * Phase 1: Placeholder - always returns healthy
   * Phase 2+: Will integrate actual Redis client connectivity check
   *
   * @param key - Health check key (e.g., 'redis')
   * @returns HealthIndicatorResult
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    // Phase 1: placeholder (always healthy)
    const isHealthy = true;

    return this.getStatus(key, isHealthy, {
      status: 'healthy',
      message: 'Phase 1: Redis connectivity not implemented',
    });
  }
}
```

### Validation

- [x] RedisHealthIndicator extends HealthIndicator
- [x] isHealthy() returns HealthIndicatorResult
- [x] Always returns healthy status
- [x] Includes placeholder message

### Estimated Time: 15 minutes

---

## Phase 4: HealthController Migration

### Objectives

- Update controller to use `HealthCheckService`
- Apply `@HealthCheck()` decorator
- Update Swagger documentation
- Preserve optional `/relay/pool-status` endpoint

### Tasks

**4.1 Update HealthController**

File: `packages/relay-api/src/health/health.controller.ts`

**Key Changes**:

1. **Imports**:
   ```typescript
   import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
   import { OzRelayerHealthIndicator, RedisHealthIndicator } from './indicators';
   ```

2. **Constructor**:
   ```typescript
   constructor(
     private readonly health: HealthCheckService,
     private readonly ozRelayerHealth: OzRelayerHealthIndicator,
     private readonly redisHealth: RedisHealthIndicator,
   ) {}
   ```

3. **Main Health Endpoint**:
   ```typescript
   @Get('api/v1/health')
   @Public()
   @HealthCheck()
   @ApiOperation({
     summary: 'Get system health status',
     description: 'Returns health status using @nestjs/terminus standard pattern',
   })
   @ApiResponse({
     status: 200,
     description: 'Health check successful',
     schema: {
       example: {
         status: 'ok',
         info: {
           'oz-relayer-pool': {
             status: 'healthy',
             healthyCount: 3,
             totalCount: 3,
             relayers: [/* ... */],
           },
           redis: {
             status: 'healthy',
             message: 'Phase 1: Redis connectivity not implemented',
           },
         },
         error: {},
         details: {/* ... */},
       },
     },
   })
   @ApiResponse({
     status: 503,
     description: 'Service unavailable',
   })
   async check() {
     return this.health.check([
       () => this.ozRelayerHealth.isHealthy('oz-relayer-pool'),
       () => this.redisHealth.isHealthy('redis'),
     ]);
   }
   ```

4. **Optional Detailed Endpoint** (preserve existing):
   ```typescript
   @Get('relay/pool-status')
   @Public()
   @ApiOperation({
     summary: 'Get detailed Relayer Pool status',
     description: 'Provides granular debugging information',
   })
   async getRelayerPoolStatus() {
     // Delegate to OzRelayerHealthIndicator for detailed info
     const result = await this.ozRelayerHealth.isHealthy('oz-relayer-pool');
     return {
       success: true,
       data: result['oz-relayer-pool'],
       timestamp: new Date().toISOString(),
     };
   }
   ```

### Validation

- [x] HealthCheckService injected in constructor
- [x] @HealthCheck() decorator applied
- [x] health.check() receives array of indicator functions
- [x] Swagger documentation updated
- [x] /relay/pool-status endpoint preserved (optional)

### Estimated Time: 30 minutes

---

## Phase 5: HealthModule Integration

### Objectives

- Import `TerminusModule`
- Register new health indicators as providers
- Export indicators for potential reuse

### Tasks

**5.1 Update HealthModule**

File: `packages/relay-api/src/health/health.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { OzRelayerHealthIndicator, RedisHealthIndicator } from './indicators';

@Module({
  imports: [
    HttpModule,        // Existing (for OZ Relayer HTTP calls)
    TerminusModule,    // NEW: @nestjs/terminus integration
  ],
  controllers: [HealthController],
  providers: [
    OzRelayerHealthIndicator,
    RedisHealthIndicator,
  ],
  exports: [
    OzRelayerHealthIndicator,
    RedisHealthIndicator,
  ],
})
export class HealthModule {}
```

### Validation

- [x] TerminusModule imported
- [x] OzRelayerHealthIndicator in providers
- [x] RedisHealthIndicator in providers
- [x] HttpModule preserved for OZ Relayer checks
- [x] Indicators exported for potential reuse

### Estimated Time: 20 minutes

---

## Phase 6: Test Implementation

### Objectives

- Write comprehensive unit tests for indicators
- Write integration tests for HealthController
- Write E2E tests for full health check flow
- Achieve ≥90% test coverage

### Tasks

**6.1 OzRelayerHealthIndicator Unit Tests**

File: `packages/relay-api/src/health/indicators/oz-relayer.health.spec.ts`

**Test Cases**:

1. ✅ All relayers healthy → `isHealthy()` succeeds
2. ✅ Partial failure (2/3 healthy) → HealthCheckError with degraded status
3. ✅ Complete failure (0/3 healthy) → HealthCheckError with unhealthy status
4. ✅ Timeout handling → Relayer marked unhealthy after 5 seconds
5. ✅ Parallel execution → 3 HTTP calls made concurrently
6. ✅ Response time measurement → Accurate timing in results
7. ✅ Status aggregation logic:
   - 3/3 healthy → 'healthy'
   - 2/3 healthy → 'degraded'
   - 1/3 healthy → 'degraded'
   - 0/3 healthy → 'unhealthy'

**Example Test Structure**:

```typescript
describe('OzRelayerHealthIndicator', () => {
  let indicator: OzRelayerHealthIndicator;
  let httpService: HttpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OzRelayerHealthIndicator,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    indicator = module.get<OzRelayerHealthIndicator>(OzRelayerHealthIndicator);
    httpService = module.get<HttpService>(HttpService);
  });

  describe('isHealthy', () => {
    it('should return healthy when all relayers respond successfully', async () => {
      // Mock 3 successful HTTP responses
      jest.spyOn(httpService, 'get').mockReturnValue(
        of({ data: { status: 'ok' } }) as any
      );

      const result = await indicator.isHealthy('oz-relayer-pool');

      expect(result['oz-relayer-pool'].status).toBe('healthy');
      expect(result['oz-relayer-pool'].healthyCount).toBe(3);
      expect(result['oz-relayer-pool'].totalCount).toBe(3);
    });

    it('should throw HealthCheckError when pool is degraded', async () => {
      // Mock 2 successful, 1 failed response
      // ... test implementation
    });
  });
});
```

**6.2 RedisHealthIndicator Unit Tests**

File: `packages/relay-api/src/health/indicators/redis.health.spec.ts`

**Test Cases**:

1. ✅ Phase 1: Always returns healthy
2. ✅ Placeholder message included
3. ✅ HealthIndicator interface compliance

**6.3 HealthController Integration Tests**

File: `packages/relay-api/src/health/health.controller.spec.ts`

**Test Cases**:

1. ✅ `GET /api/v1/health` returns 200 when all services healthy
2. ✅ `GET /api/v1/health` returns 503 when pool degraded
3. ✅ `GET /api/v1/health` returns 503 when pool unhealthy
4. ✅ @Public() decorator allows unauthenticated access
5. ✅ @HealthCheck() decorator applied
6. ✅ HealthCheckService.check() invoked correctly
7. ✅ Response format matches @nestjs/terminus standard:
   - `status: 'ok' | 'error'`
   - `info: { ... }`
   - `error: { ... }`
   - `details: { ... }`

**6.4 E2E Tests**

File: `packages/relay-api/test/health.e2e-spec.ts`

**Test Cases**:

1. ✅ Real Docker Compose environment health check succeeds
2. ✅ Degraded state when 1 relayer is down
3. ✅ 503 response when all relayers are down
4. ✅ Redis placeholder returns healthy
5. ✅ Response time < 6 seconds (5s timeout + overhead)
6. ✅ No MySQL connection attempts (Phase 1 constraint)
7. ✅ Response format validation:
   - `info` field contains healthy services
   - `error` field contains unhealthy services
   - `details` field contains all service details

**Example E2E Test**:

```typescript
describe('Health Check (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/api/v1/health (GET) - all services healthy', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.info['oz-relayer-pool']).toBeDefined();
        expect(res.body.info['redis']).toBeDefined();
      });
  });

  it('/api/v1/health (GET) - degraded when 1 relayer down', async () => {
    // Stop oz-relayer-1 container
    // ... test implementation
  });
});
```

### Validation

- [x] All unit tests pass
- [x] All integration tests pass
- [x] All E2E tests pass
- [x] Test coverage ≥90%
- [x] No TypeScript compilation errors
- [x] ESLint passes

### Estimated Time: 90 minutes

---

## Implementation Checklist

### Pre-Implementation

- [ ] Review existing `health.service.ts` logic
- [ ] Verify @nestjs/terminus@10.2.0 is installed
- [ ] Verify @nestjs/axios@3.0.0 is installed
- [ ] Check Docker Compose OZ Relayer endpoints are reachable

### During Implementation

- [ ] **Phase 1**: Directory structure created
- [ ] **Phase 2**: OzRelayerHealthIndicator implemented
- [ ] **Phase 3**: RedisHealthIndicator placeholder created
- [ ] **Phase 4**: HealthController updated
- [ ] **Phase 5**: HealthModule updated
- [ ] **Phase 6**: All tests written and passing

### Post-Implementation

- [ ] Run full test suite: `pnpm test`
- [ ] Check coverage: `pnpm test:cov`
- [ ] Run linter: `pnpm lint`
- [ ] Format code: `pnpm format`
- [ ] Test in Docker Compose environment
- [ ] Verify Swagger documentation: `GET /api/docs`
- [ ] Create Git commit with descriptive message
- [ ] Open PR for code review

---

## Risk Management

### Identified Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| OZ Relayer timeout > 5s | Health check takes too long | Parallel execution + timeout handling |
| Breaking change in response format | Client compatibility | Preserve /relay/pool-status for detailed info |
| Test environment instability | Flaky E2E tests | Use mocks in unit/integration tests |
| Phase 1 scope creep (MySQL) | Timeline delay | Strict adherence to UNWANTED-002 requirement |

---

## Dependencies

### Code Dependencies

- `@nestjs/terminus@10.2.0` (installed)
- `@nestjs/axios@3.0.0` (installed)
- `@nestjs/common@^10.0.0`
- `rxjs@^7.0.0`

### Environment Dependencies

- Docker Compose with `oz-relayer-1`, `oz-relayer-2`, `oz-relayer-3` services
- Redis service (for placeholder only, no actual connection)
- OZ Relayer API keys in environment variables

---

## Success Criteria

1. **Functional**:
   - `/api/v1/health` returns standard @nestjs/terminus format
   - All 3 OZ Relayers checked in parallel
   - Correct status aggregation (healthy/degraded/unhealthy)
   - 503 response on service failure

2. **Quality**:
   - ≥90% test coverage
   - All tests passing
   - ESLint clean
   - TypeScript strict mode compliant

3. **Performance**:
   - Health check completes in < 6 seconds
   - No memory leaks on repeated calls

4. **Documentation**:
   - Swagger documentation updated
   - Code comments for complex logic
   - SPEC acceptance criteria met

---

## Timeline

**Estimated Total Time**: 3.5 hours (single developer)

**Recommended Schedule**:

- **Day 1 (2 hours)**: Phases 1-5 (implementation)
- **Day 2 (1.5 hours)**: Phase 6 (testing)
- **Day 2 (0.5 hours)**: Code review and integration

---

## Next Steps

After SPEC-HEALTH-001 completion:

1. **Phase 2**: Implement actual Redis health check
2. **Phase 3**: Add MySQL/Prisma health check
3. **Phase 4**: Prometheus metrics integration
4. **Phase 5**: Health check history and alerting

---

**Plan Version**: 1.0.0
**Last Updated**: 2025-12-17
**Estimated Completion**: 2025-12-18

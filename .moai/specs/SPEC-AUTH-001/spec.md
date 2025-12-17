---
id: SPEC-AUTH-001
version: "1.0.0"
status: "completed"
created: "2025-12-17"
updated: "2025-12-17"
author: "@user"
priority: "high"
dependencies:
  - SPEC-MODULE-001
---

# SPEC-AUTH-001: API Key Authentication Guard (Phase 2)

## Overview

Upgrade the ApiKeyGuard from Phase 1 stub implementation to production-ready authentication with full test coverage and strict validation. Remove development convenience code that allows unauthorized access when RELAY_API_KEY is not configured.

**Phase 1 Problem**: Current stub implementation allows all requests if RELAY_API_KEY is not set, creating a security vulnerability in production environments.

**Phase 2 Goal**: Enforce strict API Key authentication with fail-fast startup validation and comprehensive test coverage (≥90%).

## Objectives

1. **Remove Phase 1 Stub**: Delete lines 32-35 that allow unauthorized access
2. **Add Constructor Validation**: Fail-fast at startup if RELAY_API_KEY is not configured
3. **Create Test Coverage**: Implement 6 comprehensive test scenarios
4. **Documentation**: Add JSDoc comments for API clarity

---

## HISTORY

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2025-12-17 | Initial SPEC creation: API Key Guard Phase 2 upgrade | manager-spec |

---

## EARS Requirements

### Ubiquitous Requirements (System-wide)

**U-AUTH-001**: All requests MUST include valid `x-api-key` header matching RELAY_API_KEY environment variable.

**U-AUTH-002**: Endpoints decorated with `@Public()` MUST bypass API Key authentication.

**U-AUTH-003**: Invalid or missing API Key MUST return HTTP 401 Unauthorized with message "Invalid API key".

**U-AUTH-004**: RELAY_API_KEY environment variable MUST be configured at application startup.

**U-AUTH-005**: API Key validation MUST use strict equality (===) and be case-sensitive.

### Event-driven Requirements (Specific events)

**E-AUTH-001**: When server starts without RELAY_API_KEY configured, application MUST throw Error("RELAY_API_KEY environment variable is required") and fail to start.

**E-AUTH-002**: When request includes valid API Key, Guard MUST return true and allow request to proceed.

**E-AUTH-003**: When request includes invalid API Key, Guard MUST throw UnauthorizedException("Invalid API key").

**E-AUTH-004**: When request is to @Public() endpoint, Guard MUST return true without API Key validation.

**E-AUTH-005**: When request is missing x-api-key header, Guard MUST throw UnauthorizedException("Invalid API key").

### State-driven Requirements (Specific states)

**S-AUTH-001**: During development mode (NODE_ENV=development), Health Check endpoint (/api/v1/health) MUST be accessible without API Key via @Public() decorator.

**S-AUTH-002**: During production mode, all non-@Public() endpoints MUST require valid API Key.

**S-AUTH-003**: When Guard is registered as APP_GUARD, API Key validation MUST apply globally to all routes except @Public() endpoints.

### Unwanted Behaviors (Prohibited actions)

**UW-AUTH-001**: Guard MUST NOT allow requests without API Key validation (Phase 1 stub behavior).

**UW-AUTH-002**: Guard MUST NOT log API Key values to console or logs.

**UW-AUTH-003**: Guard MUST NOT accept API Keys via query parameters or request body (only x-api-key header).

**UW-AUTH-004**: Constructor MUST NOT fail silently if RELAY_API_KEY is missing (must throw explicit error).

### Optional Requirements

**O-AUTH-001**: Guard MAY support additional authentication methods (JWT, OAuth) in future phases.

**O-AUTH-002**: Guard MAY track failed authentication attempts for rate limiting in future phases.

---

## Technical Specifications

### Files to Modify (1 file)

**`packages/relay-api/src/auth/guards/api-key.guard.ts`**

**Current Implementation** (Lines 12-40):
```typescript
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>("isPublic", [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers["x-api-key"];
    const configuredApiKey = this.configService.get<string>("apiKey");

    // Phase 1: Stub implementation - allow all requests if no API key is configured
    if (!configuredApiKey) {
      return true;  // ← SECURITY ISSUE: Remove this
    }

    // Phase 2+: Validate API key
    if (!apiKey || apiKey !== configuredApiKey) {
      throw new UnauthorizedException("Invalid API key");
    }

    return true;
  }
}
```

**Required Changes**:

1. **Add Constructor Validation** (after line 15):
```typescript
constructor(
  private reflector: Reflector,
  private configService: ConfigService,
) {
  const apiKey = this.configService.get<string>('apiKey');
  if (!apiKey) {
    throw new Error('RELAY_API_KEY environment variable is required');
  }
}
```

2. **Remove Phase 1 Stub** (delete lines 32-35):
```typescript
// DELETE THESE LINES:
// Phase 1: Stub implementation - allow all requests if no API key is configured
if (!configuredApiKey) {
  return true;
}
```

3. **Update Comment** (line 37):
```typescript
// Before: // Phase 2+: Validate API key
// After:  // Validate API key
```

4. **Add JSDoc Documentation**:
```typescript
/**
 * API Key Authentication Guard
 *
 * Validates x-api-key header against RELAY_API_KEY environment variable.
 * Endpoints decorated with @Public() bypass authentication.
 *
 * @throws {Error} If RELAY_API_KEY is not configured at startup
 * @throws {UnauthorizedException} If API key is missing or invalid
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
```

### Files to Create (1 file)

**`packages/relay-api/src/auth/guards/api-key.guard.spec.ts`**

**Test Scenarios** (6 comprehensive tests):

1. **@Public() Bypass**: Public endpoints should not require API key
2. **Valid Key Success**: Valid API key allows access
3. **Invalid Key Rejection**: Wrong API key returns 401
4. **Missing Key Rejection**: No API key returns 401
5. **Constructor Validation**: Missing RELAY_API_KEY throws error at startup
6. **Case Sensitivity**: Different case API key is rejected

**Test Structure** (following `health.service.spec.ts` pattern):
```typescript
describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let reflector: Reflector;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);
    reflector = module.get<Reflector>(Reflector);
    configService = module.get<ConfigService>(ConfigService);
  });

  // 6 test cases here
});
```

---

## Environment

### Development Environment
- **OS**: macOS / Linux / Windows (Docker Desktop)
- **Node.js**: 20.x LTS
- **NestJS**: 10.x
- **TypeScript**: 5.x
- **Package Manager**: pnpm

### Runtime Environment
- **Docker Compose**: SPEC-INFRA-001 complete
- **Redis**: redis:8.0-alpine (Port 6379)
- **Hardhat Node**: Local blockchain (Port 8545)

---

## Assumptions

1. **SPEC-MODULE-001 Complete**: Auth module already scaffolded with Guard registration
2. **Health Endpoints**: Already use @Public() decorator
3. **Configuration**: RELAY_API_KEY configuration in place via @nestjs/config
4. **Test Pattern**: Follow existing test patterns from health.service.spec.ts

---

## Constraints

### Technical Constraints
- **NestJS**: 10.x version fixed
- **TypeScript**: 5.x version
- **Testing Framework**: Jest (existing project standard)

### Security Constraints
- **API Key Storage**: Must use environment variables (no hardcoding)
- **Error Messages**: Generic messages only (no key leakage)
- **Validation**: Strict equality (===) and case-sensitive

### Testing Constraints
- **Coverage Target**: ≥90% for Guard
- **Test Pattern**: Follow existing NestJS test patterns
- **Mock Strategy**: Mock Reflector and ConfigService

---

## Dependencies

### Technical Dependencies
- **@nestjs/common**: 10.x (for Guard, UnauthorizedException)
- **@nestjs/core**: 10.x (for Reflector, APP_GUARD)
- **@nestjs/config**: 3.x (for ConfigService)
- **@nestjs/testing**: 10.x (for Test module)
- **jest**: Testing framework

### Module Dependencies
- **SPEC-MODULE-001**: Auth module scaffolding complete
- **config/**: RELAY_API_KEY configuration in place
- **@Public() decorator**: Already implemented

---

## Non-Functional Requirements

### Security
- **Fail-Fast Validation**: Constructor validates RELAY_API_KEY at startup
- **No Key Logging**: API Key values never logged
- **Generic Errors**: Error messages don't leak key information

### Performance
- **Guard Overhead**: Minimal (metadata lookup + string comparison)
- **No Async Operations**: Synchronous validation only
- **No Database Calls**: In-memory comparison only

### Maintainability
- **Test Coverage**: ≥90%
- **Clear Documentation**: JSDoc for API clarity
- **Follow Patterns**: Consistent with existing NestJS Guards

---

## Traceability

### Task Master Integration
- **Task ID**: `3` (API Key 인증 모듈 및 Guard 구현)
- **Status**: in-progress
- **Dependencies**: Task `2` (SPEC-MODULE-001) complete

### PRD References
- **PRD Section 3.1**: Phase 1 requirements (single API Key)
- **PRD Section 4**: Security and authentication requirements

### Related Documents
- `.taskmaster/tasks/tasks.json` (Task #3)
- `SPEC-MODULE-001` (Auth module scaffolding)
- Plan file: `/Users/harry/.claude/plans/iridescent-stargazing-cake.md`

---

## Acceptance Criteria (Given/When/Then)

See `acceptance.md` for detailed test scenarios.

### Summary Scenarios

**Scenario 1**: Valid API Key → Request proceeds (200 OK)
**Scenario 2**: Invalid API Key → HTTP 401 "Invalid API key"
**Scenario 3**: Public Endpoint → 200 OK without API Key (@Public())
**Scenario 4**: Missing API Key → HTTP 401 Unauthorized
**Scenario 5**: Startup Validation → Fails if RELAY_API_KEY not set
**Scenario 6**: Health Endpoints → Accessible without API Key

---

## Completion Checklist

- [ ] Constructor validation added to api-key.guard.ts
- [ ] Phase 1 stub removed (lines 32-35 deleted)
- [ ] JSDoc documentation added
- [ ] api-key.guard.spec.ts created with 6 tests
- [ ] All tests pass (GREEN phase)
- [ ] Coverage ≥90%
- [ ] `pnpm run lint` passes
- [ ] `pnpm run build` succeeds
- [ ] Health endpoints accessible without auth (manual test)
- [ ] Protected endpoints require valid key (manual test)

---

## Version Information

- **SPEC Version**: 1.0.0
- **Created**: 2025-12-17
- **Last Updated**: 2025-12-17
- **Status**: draft
- **Priority**: high

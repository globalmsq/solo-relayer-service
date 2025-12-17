# SPEC-AUTH-001 Implementation Plan

## Overview

**SPEC ID**: SPEC-AUTH-001
**Title**: API Key Authentication Guard (Phase 2)
**Priority**: High
**Complexity**: Low (1 file modify, 1 file create)
**Dependencies**: SPEC-MODULE-001 (completed)

---

## Current State Analysis

### Existing Infrastructure (SPEC-MODULE-001)

✅ **Already Complete**:
- Auth module at `packages/relay-api/src/auth/`
- ApiKeyGuard registered as APP_GUARD
- @Public() decorator functional
- Health endpoints use @Public()
- RELAY_API_KEY configuration in place

### Phase 1 Stub Problem

**File**: `packages/relay-api/src/auth/guards/api-key.guard.ts`

**Lines 32-35 (SECURITY ISSUE)**:
```typescript
// Phase 1: Stub implementation - allow all requests if no API key is configured
if (!configuredApiKey) {
  return true;  // ← Allows unauthorized access in production!
}
```

**Problem**: If RELAY_API_KEY is not set, all requests are allowed without authentication.

### Test Coverage Gap

❌ **Missing**: `api-key.guard.spec.ts`
- No unit tests for Guard
- Project targets 90% coverage

---

## TDD Implementation Workflow

### RED Phase: Write Failing Tests

**Create**: `packages/relay-api/src/auth/guards/api-key.guard.spec.ts`

**Test Scenarios** (6 comprehensive tests):

1. **@Public() Bypass**: Public endpoints should not require API key
2. **Valid Key Success**: Valid API key allows access
3. **Invalid Key Rejection**: Wrong API key returns 401
4. **Missing Key Rejection**: No API key returns 401
5. **Constructor Validation**: Missing RELAY_API_KEY throws error at startup
6. **Case Sensitivity**: Different case API key is rejected

**Test Structure**:
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

  it('should allow access to @Public() endpoints', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    const context = createMockExecutionContext();
    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should allow access with valid API key', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jest.spyOn(configService, 'get').mockReturnValue('secret-key-123');

    const context = createMockExecutionContext({
      headers: { 'x-api-key': 'secret-key-123' }
    });

    const result = guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should reject request with invalid API key', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jest.spyOn(configService, 'get').mockReturnValue('secret-key-123');

    const context = createMockExecutionContext({
      headers: { 'x-api-key': 'wrong-key' }
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should reject request with missing API key', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jest.spyOn(configService, 'get').mockReturnValue('secret-key-123');

    const context = createMockExecutionContext({ headers: {} });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw error if RELAY_API_KEY is not configured', () => {
    const createGuard = () => {
      new ApiKeyGuard(reflector, configService);
    };

    jest.spyOn(configService, 'get').mockReturnValue(undefined);

    expect(createGuard).toThrow('RELAY_API_KEY environment variable is required');
  });

  it('should reject API key with different case', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jest.spyOn(configService, 'get').mockReturnValue('secret-key-123');

    const context = createMockExecutionContext({
      headers: { 'x-api-key': 'SECRET-KEY-123' }
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});

function createMockExecutionContext(request: any = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: request.headers || {},
        ...request,
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;
}
```

**Run Tests** (Expected: All fail):
```bash
pnpm --filter @msq-relayer/relay-api run test api-key.guard
```

---

### GREEN Phase: Make Tests Pass

**Modify**: `packages/relay-api/src/auth/guards/api-key.guard.ts`

**Change 1: Add Constructor Validation** (after line 15):
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

**Change 2: Remove Phase 1 Stub** (delete lines 32-35):
```typescript
// DELETE THESE LINES:
// Phase 1: Stub implementation - allow all requests if no API key is configured
if (!configuredApiKey) {
  return true;
}
```

**Change 3: Keep Existing Validation** (lines 37-40 remain):
```typescript
// Phase 2+: Validate API key
if (!apiKey || apiKey !== configuredApiKey) {
  throw new UnauthorizedException("Invalid API key");
}

return true;
```

**Final Guard Logic** (simplified):
```typescript
canActivate(context: ExecutionContext): boolean {
  // Check @Public()
  const isPublic = this.reflector.getAllAndOverride<boolean>("isPublic", [
    context.getHandler(),
    context.getClass(),
  ]);

  if (isPublic) return true;

  // Validate API key (no stub bypass)
  const request = context.switchToHttp().getRequest();
  const apiKey = request.headers["x-api-key"];
  const configuredApiKey = this.configService.get<string>("apiKey");

  if (!apiKey || apiKey !== configuredApiKey) {
    throw new UnauthorizedException("Invalid API key");
  }

  return true;
}
```

**Run Tests** (Expected: All pass):
```bash
pnpm --filter @msq-relayer/relay-api run test api-key.guard
```

---

### REFACTOR Phase: Clean Code

**1. Remove Phase 1 Comments** (line 37):
```typescript
// Before: // Phase 2+: Validate API key
// After:  // Validate API key
```

**2. Add JSDoc Documentation**:
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

**3. Run Quality Checks**:
```bash
pnpm --filter @msq-relayer/relay-api run test
pnpm --filter @msq-relayer/relay-api run lint
pnpm --filter @msq-relayer/relay-api run build
```

---

## Critical Files

### Files to Modify (1)

**`packages/relay-api/src/auth/guards/api-key.guard.ts`**
- Lines to change: 12-15 (add constructor), 32-35 (delete stub), 37 (remove comment)
- Purpose: Remove stub logic, add constructor validation

### Files to Create (1)

**`packages/relay-api/src/auth/guards/api-key.guard.spec.ts`**
- Lines: ~150 lines (6 tests + setup + mock helper)
- Purpose: Comprehensive unit test coverage

### Reference Files (Read-Only)

- `packages/relay-api/src/health/health.service.spec.ts` - Test pattern reference
- `packages/relay-api/src/auth/decorators/public.decorator.ts` - @Public() implementation
- `packages/relay-api/src/config/configuration.ts` - RELAY_API_KEY config

---

## Git Strategy

**Branch**: `feature/SPEC-AUTH-001`

**Commits**:
1. `test(auth): add ApiKeyGuard unit tests (RED)`
2. `feat(auth): enforce RELAY_API_KEY and remove Phase 1 stub`
3. `docs(auth): add JSDoc to ApiKeyGuard`

---

## Risk Analysis

### Risk 1: Breaking Health Endpoints
- **Likelihood**: Low
- **Impact**: High
- **Mitigation**: Health endpoints already use @Public()
- **Validation**: Manual test `curl http://localhost:3000/api/v1/health`

### Risk 2: Missing Config in CI/CD
- **Likelihood**: Medium
- **Impact**: High
- **Mitigation**: Constructor validation fails fast at startup
- **Validation**: Test server start without RELAY_API_KEY

### Risk 3: Test Coverage Below 90%
- **Likelihood**: Low
- **Impact**: Medium
- **Mitigation**: 6 comprehensive test scenarios
- **Validation**: Run `pnpm run test:cov`

---

## Definition of Done

**Checklist**:
- [ ] api-key.guard.spec.ts created with 6 tests
- [ ] All tests pass (GREEN)
- [ ] Phase 1 stub removed (lines 32-35 deleted)
- [ ] Constructor validates RELAY_API_KEY
- [ ] JSDoc added to ApiKeyGuard
- [ ] Health endpoints accessible without auth (manual test)
- [ ] Protected endpoints require valid key (manual test)
- [ ] Coverage ≥90%
- [ ] `pnpm run lint` passes
- [ ] `pnpm run build` succeeds
- [ ] Git commit created on feature/SPEC-AUTH-001 branch

---

## Next Steps After Implementation

1. **Merge to main**: Create PR from feature/SPEC-AUTH-001
2. **Update documentation**: Add API Key authentication to API docs
3. **Deploy**: Set RELAY_API_KEY in production environment
4. **Monitor**: Check logs for 401 errors after deployment

---

## Technical Notes

### Security Considerations
- ✅ Strict equality comparison (===)
- ✅ Case-sensitive validation
- ✅ No API key logging
- ✅ Generic error messages (no key leakage)
- ✅ Fail-fast at startup

### Performance
- Guard runs on every request
- Minimal overhead (metadata lookup + string comparison)
- No async operations needed
- No database calls

### Testing Philosophy
- Follow existing pattern from health.service.spec.ts
- Mock Reflector and ConfigService
- Cover happy path + all error cases
- Descriptive test names for documentation

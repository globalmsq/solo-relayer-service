# SPEC-AUTH-001 Acceptance Criteria

## Overview

This document defines the acceptance criteria for SPEC-AUTH-001: API Key Authentication Guard (Phase 2). All scenarios must pass for the implementation to be considered complete.

---

## Scenario 1: Valid API Key Authentication

### Given
- RELAY_API_KEY=secret-key-123 configured in environment
- Server is running

### When
- Request is sent to `/api/v1/protected-endpoint`
- Request includes header: `x-api-key: secret-key-123`

### Then
- Request proceeds to route handler
- HTTP 200 OK response received
- API Key Guard does not throw exception

### Test Method
```bash
curl -H "x-api-key: secret-key-123" http://localhost:3000/api/v1/protected-endpoint
```

**Expected Response**: 200 OK

---

## Scenario 2: Invalid API Key Rejection

### Given
- RELAY_API_KEY=secret-key-123 configured in environment
- Server is running

### When
- Request is sent to `/api/v1/protected-endpoint`
- Request includes header: `x-api-key: wrong-key`

### Then
- Request is rejected by Guard
- HTTP 401 Unauthorized response
- Response body: `{ "message": "Invalid API key", "statusCode": 401 }`

### Test Method
```bash
curl -H "x-api-key: wrong-key" http://localhost:3000/api/v1/protected-endpoint
```

**Expected Response**: 401 Unauthorized

---

## Scenario 3: Public Endpoint Bypass

### Given
- RELAY_API_KEY=secret-key-123 configured in environment
- Server is running
- `/api/v1/health` endpoint decorated with @Public()

### When
- Request is sent to `/api/v1/health`
- Request does NOT include x-api-key header

### Then
- Request proceeds to route handler
- HTTP 200 OK response received
- @Public() decorator bypasses API Key validation

### Test Method
```bash
curl http://localhost:3000/api/v1/health
```

**Expected Response**: 200 OK with health status JSON

---

## Scenario 4: Missing API Key Rejection

### Given
- RELAY_API_KEY=secret-key-123 configured in environment
- Server is running

### When
- Request is sent to `/api/v1/protected-endpoint`
- Request does NOT include x-api-key header

### Then
- Request is rejected by Guard
- HTTP 401 Unauthorized response
- Response body: `{ "message": "Invalid API key", "statusCode": 401 }`

### Test Method
```bash
curl http://localhost:3000/api/v1/protected-endpoint
```

**Expected Response**: 401 Unauthorized

---

## Scenario 5: Startup Validation

### Given
- RELAY_API_KEY is NOT set in environment
- Docker Compose or npm start command executed

### When
- Server attempts to start
- ApiKeyGuard constructor is invoked during DI container initialization

### Then
- Server fails to start
- Error thrown: `Error: RELAY_API_KEY environment variable is required`
- Application does not reach "listening on port 3000" state

### Test Method
```bash
# Remove RELAY_API_KEY from .env
unset RELAY_API_KEY

# Attempt to start server
pnpm --filter @msq-relayer/relay-api run start:dev
```

**Expected Response**: Error message and process exit

---

## Scenario 6: Health Endpoints Remain Accessible

### Given
- RELAY_API_KEY=secret-key-123 configured in environment
- Server is running
- Both health endpoints decorated with @Public():
  - `/api/v1/health`
  - `/relay/pool-status`

### When
- Requests are sent to both health endpoints
- Requests do NOT include x-api-key header

### Then
- Both requests proceed to route handlers
- Both return HTTP 200 OK
- @Public() decorator bypasses authentication for both

### Test Method
```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/relay/pool-status
```

**Expected Response**: 200 OK for both endpoints

---

## Scenario 7: Case Sensitivity Validation

### Given
- RELAY_API_KEY=secret-key-123 configured in environment (lowercase)
- Server is running

### When
- Request is sent to `/api/v1/protected-endpoint`
- Request includes header: `x-api-key: SECRET-KEY-123` (uppercase)

### Then
- Request is rejected by Guard (strict equality check)
- HTTP 401 Unauthorized response
- Response body: `{ "message": "Invalid API key", "statusCode": 401 }`

### Test Method
```bash
curl -H "x-api-key: SECRET-KEY-123" http://localhost:3000/api/v1/protected-endpoint
```

**Expected Response**: 401 Unauthorized

---

## Test Coverage Requirements

### Unit Tests (api-key.guard.spec.ts)

**Required Test Cases** (6 minimum):
1. ✅ @Public() decorated endpoints bypass authentication
2. ✅ Valid API key allows access
3. ✅ Invalid API key returns 401 Unauthorized
4. ✅ Missing API key returns 401 Unauthorized
5. ✅ Constructor throws error if RELAY_API_KEY not configured
6. ✅ API key validation is case-sensitive

**Coverage Target**: ≥90% for ApiKeyGuard

### Integration Tests (Optional)

- Health endpoint accessible without auth
- Protected endpoint requires auth
- Multiple concurrent requests handled correctly

---

## Manual Verification Checklist

### Pre-Implementation Checks
- [ ] SPEC-MODULE-001 completed (auth module exists)
- [ ] @Public() decorator already implemented
- [ ] RELAY_API_KEY configuration in place

### Post-Implementation Checks
- [ ] All 6 unit tests pass
- [ ] Coverage ≥90% for ApiKeyGuard
- [ ] `pnpm run lint` passes (0 errors)
- [ ] `pnpm run build` succeeds
- [ ] Server starts successfully with RELAY_API_KEY set
- [ ] Server fails to start without RELAY_API_KEY
- [ ] Health endpoints accessible without auth
- [ ] Protected endpoints require valid API key
- [ ] Invalid API key returns 401
- [ ] Missing API key returns 401

---

## Rollback Criteria

If any of the following occur, implementation should be rolled back:

1. **Health Endpoints Break**: `/api/v1/health` requires authentication
2. **Server Won't Start**: With valid RELAY_API_KEY configured
3. **Coverage Drop**: Test coverage falls below 90%
4. **Build Failure**: `pnpm run build` fails
5. **Lint Errors**: ESLint reports errors

---

## Success Metrics

### Functional Metrics
- All 7 acceptance scenarios pass ✅
- All 6 unit tests pass ✅
- Zero manual intervention required for authentication ✅

### Quality Metrics
- Test coverage ≥90% ✅
- Zero ESLint errors ✅
- Build succeeds ✅

### Security Metrics
- Phase 1 stub removed (no unauthorized bypass) ✅
- Fail-fast validation at startup ✅
- No API key values logged ✅

---

## Sign-Off Checklist

- [ ] All acceptance criteria scenarios pass
- [ ] All unit tests pass
- [ ] Test coverage ≥90%
- [ ] Lint and build succeed
- [ ] Manual testing completed
- [ ] No rollback criteria triggered
- [ ] Documentation updated (JSDoc added)
- [ ] Git commit created on feature branch

---

**Document Version**: 1.0.0
**Last Updated**: 2025-12-17
**Status**: Ready for Implementation

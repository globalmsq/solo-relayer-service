---
id: SPEC-PROXY-001
title: Acceptance Criteria - Nginx Load Balancer-based OZ Relayer Proxy and Direct Transaction API
version: 1.0.0
created_at: 2025-12-19
updated_at: 2025-12-19
---

# Acceptance Criteria: SPEC-PROXY-001

## Overview

This document defines the acceptance criteria for SPEC-PROXY-001 using Given/When/Then format. All scenarios must pass before the SPEC can be marked as complete.

---

## Test Scenarios

### Scenario 1: Nginx Load Balancer Configuration

**Given**: SPEC-INFRA-001 complete with 3 OZ Relayers running
**When**: Docker Compose stack is started with `oz-relayer-lb` service
**Then**:
1. ✅ Nginx container starts successfully
2. ✅ Nginx configuration validation passes: `docker exec oz-relayer-lb nginx -t`
3. ✅ Nginx health endpoint returns 200 OK: `curl http://localhost:8080/health`
4. ✅ Nginx access log exists: `/var/log/nginx/oz-relayer-access.log`
5. ✅ Nginx error log exists: `/var/log/nginx/oz-relayer-error.log`

**Validation Commands**:
```bash
# Start Docker Compose
docker-compose up -d

# Check Nginx container status
docker ps | grep oz-relayer-lb

# Validate Nginx configuration
docker exec oz-relayer-lb nginx -t
# Expected output: "nginx: configuration file /etc/nginx/nginx.conf test is successful"

# Test health endpoint
curl http://localhost:8080/health
# Expected output: "healthy" with 200 OK
```

---

### Scenario 2: Nginx Load Balancing Distribution

**Given**: All 3 OZ Relayers are healthy and running
**When**: Multiple requests are sent to Nginx LB
**Then**:
1. ✅ Requests are distributed across all 3 relayers (round-robin)
2. ✅ Each relayer receives approximately equal number of requests
3. ✅ Nginx access log shows requests to different upstream servers

**Validation Commands**:
```bash
# Send 10 requests and observe distribution
for i in {1..10}; do
  curl -s http://localhost:8080/api/v1/health
done

# Check Nginx access log for distribution
docker exec oz-relayer-lb cat /var/log/nginx/oz-relayer-access.log | tail -10
# Expected: Requests distributed to oz-relayer-1, oz-relayer-2, oz-relayer-3
```

---

### Scenario 3: Automatic Failover When Relayer Fails

**Given**: All 3 OZ Relayers are healthy
**When**: One relayer (oz-relayer-1) is stopped
**Then**:
1. ✅ Nginx detects failure after `max_fails=3` attempts
2. ✅ Nginx stops routing requests to failed relayer
3. ✅ Requests are distributed only to healthy relayers (oz-relayer-2, oz-relayer-3)
4. ✅ API Gateway health check still returns 200 OK (degraded mode)

**Validation Commands**:
```bash
# Stop one relayer
docker stop oz-relayer-1

# Send 10 requests (should succeed with 2 healthy relayers)
for i in {1..10}; do
  curl -s http://localhost:8080/api/v1/health
done

# Check API Gateway health
curl http://localhost:3000/api/v1/health
# Expected: 200 OK (pool is degraded but functional)

# Restart relayer
docker start oz-relayer-1
```

---

### Scenario 4: Automatic Recovery When Relayer Rejoins

**Given**: One relayer (oz-relayer-1) is stopped and Nginx is routing to 2 healthy relayers
**When**: The failed relayer is restarted and becomes healthy
**Then**:
1. ✅ Nginx waits `fail_timeout=30s` before retrying
2. ✅ Nginx detects relayer is healthy again
3. ✅ Nginx includes relayer back in the pool
4. ✅ Requests are distributed to all 3 relayers again

**Validation Commands**:
```bash
# Restart stopped relayer
docker start oz-relayer-1

# Wait for fail_timeout (30 seconds)
sleep 35

# Send 10 requests (should distribute to all 3 relayers)
for i in {1..10}; do
  curl -s http://localhost:8080/api/v1/health
done

# Check Nginx access log for distribution
docker exec oz-relayer-lb cat /var/log/nginx/oz-relayer-access.log | tail -10
# Expected: Requests distributed to all 3 relayers
```

---

### Scenario 5: All Relayers Down (Graceful Degradation)

**Given**: All 3 OZ Relayers are healthy
**When**: All relayers are stopped simultaneously
**Then**:
1. ✅ Nginx returns 502 Bad Gateway for OZ Relayer API calls
2. ✅ API Gateway health check returns 503 Service Unavailable
3. ✅ Nginx error log shows upstream connection errors
4. ✅ Nginx `/health` endpoint still returns 200 OK (Nginx itself is healthy)

**Validation Commands**:
```bash
# Stop all relayers
docker stop oz-relayer-1 oz-relayer-2 oz-relayer-3

# Test Nginx health (Nginx is still running)
curl http://localhost:8080/health
# Expected: 200 OK "healthy"

# Test API Gateway health
curl http://localhost:3000/api/v1/health
# Expected: 503 Service Unavailable (OZ Relayer pool is down)

# Restart all relayers
docker start oz-relayer-1 oz-relayer-2 oz-relayer-3
```

---

### Scenario 6: Direct Transaction API - Valid Request

**Given**: API Gateway is running with OZ Relayer Pool healthy
**When**: A valid Direct Transaction request is submitted
**Then**:
1. ✅ HTTP Status: 202 Accepted
2. ✅ Response contains `transactionId`, `hash`, `status`, `createdAt`
3. ✅ Request is forwarded to Nginx LB
4. ✅ Nginx distributes request to one of the healthy relayers

**Validation Commands**:
```bash
# Valid Direct Transaction request
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${RELAY_API_KEY}" \
  -d '{
    "to": "0x1234567890123456789012345678901234567890",
    "data": "0xabcdef",
    "value": "1000000000000000000",
    "gasLimit": "21000",
    "speed": "fast"
  }'

# Expected Response (202 Accepted):
# {
#   "transactionId": "tx_...",
#   "hash": "0x...",
#   "status": "pending",
#   "createdAt": "2025-12-19T10:30:00.000Z"
# }
```

---

### Scenario 7: Direct Transaction API - Invalid Ethereum Address

**Given**: API Gateway is running
**When**: A Direct Transaction request with invalid `to` address is submitted
**Then**:
1. ✅ HTTP Status: 400 Bad Request
2. ✅ Response contains validation error message
3. ✅ Error message: "to must be an Ethereum address"
4. ✅ Request does not reach OZ Relayer

**Validation Commands**:
```bash
# Invalid Ethereum address
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${RELAY_API_KEY}" \
  -d '{
    "to": "invalid-address",
    "data": "0xabcdef"
  }'

# Expected Response (400 Bad Request):
# {
#   "statusCode": 400,
#   "message": ["to must be an Ethereum address"],
#   "error": "Bad Request"
# }
```

---

### Scenario 8: Direct Transaction API - Missing Required Field

**Given**: API Gateway is running
**When**: A Direct Transaction request without `data` field is submitted
**Then**:
1. ✅ HTTP Status: 400 Bad Request
2. ✅ Response contains validation error message
3. ✅ Error message: "data should not be empty"
4. ✅ Request does not reach OZ Relayer

**Validation Commands**:
```bash
# Missing required field "data"
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${RELAY_API_KEY}" \
  -d '{
    "to": "0x1234567890123456789012345678901234567890"
  }'

# Expected Response (400 Bad Request):
# {
#   "statusCode": 400,
#   "message": ["data should not be empty", "data must be a hexadecimal number"],
#   "error": "Bad Request"
# }
```

---

### Scenario 9: Direct Transaction API - Invalid Hexadecimal Data

**Given**: API Gateway is running
**When**: A Direct Transaction request with non-hexadecimal `data` is submitted
**Then**:
1. ✅ HTTP Status: 400 Bad Request
2. ✅ Response contains validation error message
3. ✅ Error message: "data must be a hexadecimal number"
4. ✅ Request does not reach OZ Relayer

**Validation Commands**:
```bash
# Invalid hexadecimal data
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${RELAY_API_KEY}" \
  -d '{
    "to": "0x1234567890123456789012345678901234567890",
    "data": "not-hex"
  }'

# Expected Response (400 Bad Request):
# {
#   "statusCode": 400,
#   "message": ["data must be a hexadecimal number"],
#   "error": "Bad Request"
# }
```

---

### Scenario 10: Direct Transaction API - Missing API Key

**Given**: API Gateway is running with API Key authentication enabled
**When**: A Direct Transaction request without `X-API-Key` header is submitted
**Then**:
1. ✅ HTTP Status: 401 Unauthorized
2. ✅ Response contains authentication error message
3. ✅ Request does not reach OZ Relayer

**Validation Commands**:
```bash
# Request without API Key header
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -d '{
    "to": "0x1234567890123456789012345678901234567890",
    "data": "0xabcdef"
  }'

# Expected Response (401 Unauthorized):
# {
#   "statusCode": 401,
#   "message": "Unauthorized",
#   "error": "Unauthorized"
# }
```

---

### Scenario 11: Direct Transaction API - OZ Relayer Service Unavailable

**Given**: All OZ Relayers are stopped
**When**: A valid Direct Transaction request is submitted
**Then**:
1. ✅ HTTP Status: 503 Service Unavailable
2. ✅ Response contains error message: "OZ Relayer service unavailable"
3. ✅ Nginx logs show upstream connection errors

**Validation Commands**:
```bash
# Stop all OZ Relayers
docker stop oz-relayer-1 oz-relayer-2 oz-relayer-3

# Valid Direct Transaction request
curl -X POST http://localhost:3000/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${RELAY_API_KEY}" \
  -d '{
    "to": "0x1234567890123456789012345678901234567890",
    "data": "0xabcdef"
  }'

# Expected Response (503 Service Unavailable):
# {
#   "statusCode": 503,
#   "message": "OZ Relayer service unavailable",
#   "error": "Service Unavailable"
# }

# Restart OZ Relayers
docker start oz-relayer-1 oz-relayer-2 oz-relayer-3
```

---

### Scenario 12: Health Check Endpoint - All Relayers Healthy

**Given**: All 3 OZ Relayers are healthy
**When**: Health Check endpoint is called
**Then**:
1. ✅ HTTP Status: 200 OK
2. ✅ Response contains `status: "ok"`
3. ✅ Response contains `oz-relayer-lb` indicator with `status: "up"`

**Validation Commands**:
```bash
# Call Health Check endpoint
curl http://localhost:3000/api/v1/health

# Expected Response (200 OK):
# {
#   "status": "ok",
#   "info": {
#     "oz-relayer-lb": {
#       "status": "up",
#       "url": "http://oz-relayer-lb:8080",
#       "status": "healthy"
#     }
#   }
# }
```

---

### Scenario 13: Health Check Endpoint - All Relayers Down

**Given**: All 3 OZ Relayers are stopped
**When**: Health Check endpoint is called
**Then**:
1. ✅ HTTP Status: 503 Service Unavailable
2. ✅ Response contains `status: "error"`
3. ✅ Response contains `oz-relayer-lb` indicator with `status: "down"`
4. ✅ Response contains error message

**Validation Commands**:
```bash
# Stop all OZ Relayers
docker stop oz-relayer-1 oz-relayer-2 oz-relayer-3

# Call Health Check endpoint
curl http://localhost:3000/api/v1/health

# Expected Response (503 Service Unavailable):
# {
#   "status": "error",
#   "error": {
#     "oz-relayer-lb": {
#       "status": "down",
#       "url": "http://oz-relayer-lb:8080",
#       "error": "Connection refused"
#     }
#   }
# }

# Restart OZ Relayers
docker start oz-relayer-1 oz-relayer-2 oz-relayer-3
```

---

### Scenario 14: OzRelayerService Simplification

**Given**: OzRelayerService code before SPEC-PROXY-001
**When**: Code is simplified to use single Nginx LB endpoint
**Then**:
1. ✅ `relayerEndpoints` array is removed (3 relayers)
2. ✅ Custom pool management logic is removed
3. ✅ Single `relayerUrl` from environment variable (`OZ_RELAYER_URL`)
4. ✅ `sendTransaction()` calls Nginx LB endpoint
5. ✅ `getTransactionStatus()` calls Nginx LB endpoint
6. ✅ Code complexity reduced by ~50 LOC

**Validation**:
```bash
# Check simplified OzRelayerService code
cat packages/relay-api/src/oz-relayer/oz-relayer.service.ts | wc -l
# Expected: ~50-60 LOC (down from ~100-110 LOC)

# Verify no pool management logic
grep -i "pool" packages/relay-api/src/oz-relayer/oz-relayer.service.ts
# Expected: No results (pool logic removed)

# Verify single relayerUrl
grep "relayerUrl" packages/relay-api/src/oz-relayer/oz-relayer.service.ts
# Expected: 1 result (single endpoint)
```

---

### Scenario 15: OzRelayerHealthIndicator Simplification

**Given**: OzRelayerHealthIndicator code before SPEC-PROXY-001
**When**: Code is simplified to check Nginx LB only
**Then**:
1. ✅ `relayerEndpoints` array is removed (3 relayers)
2. ✅ `checkSingleRelayer()` method is removed
3. ✅ `aggregateStatus()` method is removed
4. ✅ Single `relayerUrl` from environment variable
5. ✅ `isHealthy()` checks Nginx LB `/health` endpoint
6. ✅ Code complexity reduced by ~80 LOC

**Validation**:
```bash
# Check simplified OzRelayerHealthIndicator code
cat packages/relay-api/src/health/indicators/oz-relayer.health.ts | wc -l
# Expected: ~30-40 LOC (down from ~110-120 LOC)

# Verify no individual relayer checks
grep -i "checkSingleRelayer" packages/relay-api/src/health/indicators/oz-relayer.health.ts
# Expected: No results (method removed)

# Verify single relayerUrl
grep "relayerUrl" packages/relay-api/src/health/indicators/oz-relayer.health.ts
# Expected: 1 result (single endpoint)
```

---

## Unit Test Requirements

### DirectService Unit Tests

**Test Suite**: `packages/relay-api/src/relay/direct/direct.service.spec.ts`

**Test Cases**:
1. ✅ **sendTransaction - Valid Request**
   - Given: Valid DirectTxRequestDto
   - When: `sendTransaction()` is called
   - Then: OzRelayerService is called with correct parameters
   - Then: DirectTxResponseDto is returned with transaction details

2. ✅ **sendTransaction - OzRelayerService Error**
   - Given: OzRelayerService throws ServiceUnavailableException
   - When: `sendTransaction()` is called
   - Then: Exception is propagated to controller

3. ✅ **sendTransaction - Response Mapping**
   - Given: OzRelayerService returns transaction response
   - When: `sendTransaction()` is called
   - Then: Response is correctly mapped to DirectTxResponseDto

---

### DirectController Unit Tests

**Test Suite**: `packages/relay-api/src/relay/direct/direct.controller.spec.ts`

**Test Cases**:
1. ✅ **POST /relay/direct - Valid Request**
   - Given: Valid DirectTxRequestDto
   - When: `sendDirectTransaction()` is called
   - Then: HTTP Status 202 Accepted
   - Then: DirectService is called

2. ✅ **POST /relay/direct - DTO Validation Error**
   - Given: Invalid DirectTxRequestDto (missing `to`)
   - When: `sendDirectTransaction()` is called
   - Then: HTTP Status 400 Bad Request
   - Then: Validation error message returned

---

### OzRelayerService Unit Tests

**Test Suite**: `packages/relay-api/src/oz-relayer/oz-relayer.service.spec.ts`

**Test Cases**:
1. ✅ **sendTransaction - Success**
   - Given: Valid DirectTxRequest
   - When: `sendTransaction()` is called
   - Then: HttpService.post is called with correct URL and payload
   - Then: Transaction response is returned

2. ✅ **sendTransaction - Timeout**
   - Given: HttpService.post times out after 30 seconds
   - When: `sendTransaction()` is called
   - Then: ServiceUnavailableException is thrown

3. ✅ **sendTransaction - HTTP Error**
   - Given: HttpService.post returns 502 Bad Gateway
   - When: `sendTransaction()` is called
   - Then: ServiceUnavailableException is thrown

4. ✅ **getTransactionStatus - Success**
   - Given: Valid transaction ID
   - When: `getTransactionStatus()` is called
   - Then: HttpService.get is called with correct URL
   - Then: Transaction status is returned

---

### OzRelayerHealthIndicator Unit Tests

**Test Suite**: `packages/relay-api/src/health/indicators/oz-relayer.health.spec.ts`

**Test Cases**:
1. ✅ **isHealthy - LB Healthy**
   - Given: Nginx LB `/health` endpoint returns 200 OK
   - When: `isHealthy()` is called
   - Then: Health status is `true`
   - Then: Response contains `status: "healthy"`

2. ✅ **isHealthy - LB Unhealthy**
   - Given: Nginx LB `/health` endpoint returns connection error
   - When: `isHealthy()` is called
   - Then: HealthCheckError is thrown
   - Then: Response contains error message

3. ✅ **isHealthy - Timeout**
   - Given: Nginx LB `/health` endpoint times out after 5 seconds
   - When: `isHealthy()` is called
   - Then: HealthCheckError is thrown
   - Then: Response contains timeout error

---

## Integration Test Requirements

### E2E Test Scenario: Complete Direct Transaction Flow

**Test Suite**: `packages/relay-api/test/relay-direct.e2e-spec.ts`

**Setup**:
1. Start Docker Compose stack with all services
2. Wait for all services to be healthy

**Test Steps**:
1. ✅ Submit valid Direct Transaction request
2. ✅ Verify API Gateway returns 202 Accepted
3. ✅ Verify transaction response contains `transactionId`, `hash`, `status`
4. ✅ Verify Nginx access log shows request to one of the relayers
5. ✅ Query transaction status with `transactionId`
6. ✅ Verify transaction status is `pending` or `confirmed`

**Teardown**:
1. Stop Docker Compose stack

---

## Performance Test Requirements

### Load Test: Nginx Load Balancing Distribution

**Objective**: Verify Nginx distributes 100 requests evenly across 3 relayers.

**Test Steps**:
1. Send 100 Direct Transaction requests to API Gateway
2. Monitor Nginx access logs
3. Count requests to each relayer

**Expected Results**:
- ✅ oz-relayer-1: ~33 requests (±5)
- ✅ oz-relayer-2: ~33 requests (±5)
- ✅ oz-relayer-3: ~33 requests (±5)
- ✅ Total: 100 requests

**Validation Script**:
```bash
# Send 100 requests
for i in {1..100}; do
  curl -s -X POST http://localhost:3000/api/v1/relay/direct \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${RELAY_API_KEY}" \
    -d '{
      "to": "0x1234567890123456789012345678901234567890",
      "data": "0xabcdef"
    }' &
done
wait

# Count requests to each relayer in Nginx access log
docker exec oz-relayer-lb grep "oz-relayer-1" /var/log/nginx/oz-relayer-access.log | wc -l
docker exec oz-relayer-lb grep "oz-relayer-2" /var/log/nginx/oz-relayer-access.log | wc -l
docker exec oz-relayer-lb grep "oz-relayer-3" /var/log/nginx/oz-relayer-access.log | wc -l
```

---

## Quality Gates

### Code Coverage
- ✅ Overall: ≥ 90%
- ✅ DirectService: ≥ 90%
- ✅ DirectController: ≥ 90%
- ✅ OzRelayerService: ≥ 90%
- ✅ OzRelayerHealthIndicator: ≥ 90%

### Linting
- ✅ ESLint: 0 errors, 0 warnings
- ✅ Prettier: All files formatted

### Type Safety
- ✅ TypeScript: 0 compilation errors
- ✅ All DTOs have proper type definitions
- ✅ No `any` types (except in catch blocks)

### Documentation
- ✅ All API endpoints documented in Swagger
- ✅ All DTOs have `@ApiProperty` decorators
- ✅ All complex methods have JSDoc comments
- ✅ README.md updated with Direct Transaction API usage

---

## Definition of Done

SPEC-PROXY-001 is considered **complete** when:

- ✅ All 15 test scenarios pass
- ✅ All unit tests pass with ≥90% coverage
- ✅ All integration tests pass
- ✅ Performance test shows even distribution (±5%)
- ✅ All quality gates pass (linting, type safety, coverage)
- ✅ Documentation complete (Swagger, README.md)
- ✅ No regression in existing functionality
- ✅ Code review approved
- ✅ Task Master Task #5 marked as `done`

---

**Version**: 1.0.0
**Last Updated**: 2025-12-19
**Status**: draft

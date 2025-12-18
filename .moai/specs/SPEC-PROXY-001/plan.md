---
id: SPEC-PROXY-001
title: Implementation Plan - Nginx Load Balancer-based OZ Relayer Proxy and Direct Transaction API
version: 1.0.0
created_at: 2025-12-19
updated_at: 2025-12-19
---

# Implementation Plan: SPEC-PROXY-001

## Executive Summary

This plan outlines the implementation of an Nginx-based Load Balancer to proxy OZ Relayer Pool requests and create Direct Transaction API endpoints. The architecture reduces code complexity from ~300 LOC to ~100 LOC by delegating load balancing, health checking, and failover to Nginx's native capabilities.

**Estimated Complexity**: Medium (8 files to modify/create)

**Core Benefits**:
- ✅ 60% code reduction (Nginx replaces custom pool management)
- ✅ Production-ready failover and health checks
- ✅ Environment variable-based configuration for external LB transition
- ✅ Proven Nginx performance and reliability

---

## Implementation Phases

### Phase 1: Nginx Load Balancer Setup

**Objective**: Configure Nginx to proxy requests to OZ Relayer Pool with automatic failover.

**Steps**:

1. **Create Nginx Configuration**
   - **File**: `docker/nginx/nginx.conf`
   - **Content**:
     - `upstream oz_relayer_pool` with 3 relayer instances
     - Round-robin load balancing (default)
     - Health check parameters: `max_fails=3`, `fail_timeout=30s`
     - Proxy configuration with timeouts
     - Health check endpoint `/health`
     - Access and error logging

2. **Update Docker Compose**
   - **File**: `docker/docker-compose.yaml`
   - **Add Service**: `oz-relayer-lb`
     - Image: `nginx:alpine`
     - Port: `8080:8080`
     - Volume mount: `./nginx/nginx.conf:/etc/nginx/nginx.conf:ro`
     - Dependencies: `oz-relayer-1`, `oz-relayer-2`, `oz-relayer-3`
     - Health check: `curl -f http://localhost:8080/health`

3. **Verify Nginx Setup**
   - Start Docker Compose stack
   - Check Nginx container logs
   - Verify health endpoint: `curl http://localhost:8080/health`
   - Test upstream connectivity to relayers

**Deliverables**:
- ✅ `docker/nginx/nginx.conf` created
- ✅ `oz-relayer-lb` service in `docker-compose.yaml`
- ✅ Nginx container running and healthy

---

### Phase 2: Simplify OzRelayerService

**Objective**: Replace multi-relayer pool logic with single Nginx LB endpoint.

**Steps**:

1. **Update OzRelayerService**
   - **File**: `packages/relay-api/src/oz-relayer/oz-relayer.service.ts`
   - **Changes**:
     - Remove: `relayerEndpoints` array (3 relayers)
     - Remove: Custom pool management logic
     - Add: Single `relayerUrl` from environment variable
     - Update: `sendTransaction()` to call Nginx LB endpoint
     - Update: `getTransactionStatus()` to call Nginx LB endpoint
     - Add: `DirectTxRequest` and `DirectTxResponse` interfaces

2. **Update Environment Configuration**
   - **File**: `packages/relay-api/src/config/configuration.ts` (if needed)
   - **Add**: `OZ_RELAYER_URL` environment variable (default: `http://oz-relayer-lb:8080`)

3. **Remove Obsolete Code**
   - Delete: Custom round-robin logic
   - Delete: Relayer pool state management
   - Delete: Periodic health check scheduler (if exists)

**Deliverables**:
- ✅ Simplified `oz-relayer.service.ts` (~50 LOC reduction)
- ✅ Environment variable `OZ_RELAYER_URL` configured
- ✅ Obsolete pool management code removed

---

### Phase 3: Implement Direct Transaction API

**Objective**: Create REST API endpoints for direct blockchain transaction submission.

**Steps**:

1. **Create Direct Transaction DTOs**
   - **File**: `packages/relay-api/src/relay/dto/direct-tx-request.dto.ts`
     - Fields: `to`, `data`, `value?`, `gasLimit?`, `speed?`
     - Validators: `@IsEthereumAddress`, `@IsHexadecimal`, `@IsNumberString`, `@IsEnum`
     - Swagger decorators: `@ApiProperty`, `@ApiPropertyOptional`

   - **File**: `packages/relay-api/src/relay/dto/direct-tx-response.dto.ts`
     - Fields: `transactionId`, `hash`, `status`, `createdAt`
     - Swagger decorators: `@ApiProperty`

2. **Create Direct Transaction Service**
   - **File**: `packages/relay-api/src/relay/direct/direct.service.ts`
   - **Methods**:
     - `sendTransaction(dto: DirectTxRequestDto): Promise<DirectTxResponseDto>`
     - Inject: `OzRelayerService`
     - Transform: DTO → OZ Relayer API request
     - Return: Transaction ID, hash, status

3. **Create Direct Transaction Controller**
   - **File**: `packages/relay-api/src/relay/direct/direct.controller.ts`
   - **Endpoints**:
     - `POST /relay/direct` → Send Direct Transaction
     - HTTP Status: 202 Accepted
     - Swagger: `@ApiTags`, `@ApiOperation`, `@ApiResponse`
   - **Validation**: Use `DirectTxRequestDto`

4. **Update Relay Module**
   - **File**: `packages/relay-api/src/relay/relay.module.ts`
   - **Add Imports**: `HttpModule`, `OzRelayerModule`
   - **Add Controllers**: `DirectController`
   - **Add Providers**: `DirectService`

**Deliverables**:
- ✅ `direct-tx-request.dto.ts` and `direct-tx-response.dto.ts` created
- ✅ `direct.service.ts` implemented
- ✅ `direct.controller.ts` with `/relay/direct` endpoint
- ✅ `relay.module.ts` updated with Direct components

---

### Phase 4: Update Health Check Indicators

**Objective**: Replace pool health check with Nginx LB health check.

**Steps**:

1. **Simplify OzRelayerHealthIndicator**
   - **File**: `packages/relay-api/src/health/indicators/oz-relayer.health.ts`
   - **Changes**:
     - Remove: `relayerEndpoints` array (3 relayers)
     - Remove: `checkSingleRelayer()` method
     - Remove: `aggregateStatus()` method
     - Add: Single `relayerUrl` from environment variable
     - Update: `isHealthy()` to check Nginx LB `/health` endpoint
     - Return: Simplified health status (healthy/unhealthy)

2. **Update Health Check Response**
   - **Before**: Pool health with individual relayer status
   - **After**: Nginx LB health (Nginx handles underlying pool)

**Deliverables**:
- ✅ Simplified `oz-relayer.health.ts` (~80 LOC reduction)
- ✅ Health Check endpoint returns Nginx LB status

---

### Phase 5: Integration Testing

**Objective**: Verify end-to-end functionality of Nginx LB and Direct Transaction API.

**Steps**:

1. **Nginx Load Balancer Tests**
   - Verify Nginx configuration: `docker exec oz-relayer-lb nginx -t`
   - Test load balancing: Send 10 requests, observe distribution in Nginx logs
   - Test failover: Stop one relayer, verify requests still succeed
   - Test recovery: Start stopped relayer, verify it rejoins pool

2. **Direct Transaction API Tests**
   - Valid request: `POST /relay/direct` with valid DTO → 202 Accepted
   - Invalid address: `POST /relay/direct` with invalid `to` → 400 Bad Request
   - Missing field: `POST /relay/direct` without `data` → 400 Bad Request
   - Authentication: Request without `X-API-Key` → 401 Unauthorized

3. **Health Check Tests**
   - All relayers healthy: `GET /api/v1/health` → 200 OK
   - One relayer down: `GET /api/v1/health` → 200 OK (Nginx handles failover)
   - All relayers down: `GET /api/v1/health` → 503 Service Unavailable

4. **End-to-End Scenario**
   - Start full Docker Compose stack
   - Submit Direct Transaction via API Gateway
   - Verify request reaches Nginx LB
   - Verify Nginx distributes to healthy relayer
   - Verify transaction response (transaction ID, hash, status)

**Deliverables**:
- ✅ All Nginx LB tests passing
- ✅ All Direct Transaction API tests passing
- ✅ All Health Check tests passing
- ✅ E2E scenario validated

---

## File Modifications Summary

| File | Action | Description |
|------|--------|-------------|
| `docker/nginx/nginx.conf` | **CREATE** | Nginx Load Balancer configuration |
| `docker/docker-compose.yaml` | **MODIFY** | Add `oz-relayer-lb` service |
| `packages/relay-api/src/oz-relayer/oz-relayer.service.ts` | **MODIFY** | Simplify to single LB endpoint |
| `packages/relay-api/src/health/indicators/oz-relayer.health.ts` | **MODIFY** | Simplify to check Nginx LB |
| `packages/relay-api/src/relay/direct/direct.controller.ts` | **CREATE** | Direct Transaction REST API |
| `packages/relay-api/src/relay/direct/direct.service.ts` | **CREATE** | Direct Transaction business logic |
| `packages/relay-api/src/relay/dto/direct-tx-request.dto.ts` | **CREATE** | Request DTO with validation |
| `packages/relay-api/src/relay/dto/direct-tx-response.dto.ts` | **CREATE** | Response DTO |
| `packages/relay-api/src/relay/relay.module.ts` | **MODIFY** | Register Direct components |

**Total**: 9 files (4 CREATE, 5 MODIFY)

---

## Technical Approach

### Nginx Load Balancing Strategy

**Default Strategy**: Round-robin (Nginx default)
- Distributes requests evenly across all healthy relayers
- Simple and effective for stateless transaction submission

**Alternative Strategy**: `least_conn` (optional)
- Sends requests to relayer with fewest active connections
- Better for long-running requests or uneven load

**Configuration**:
```nginx
upstream oz_relayer_pool {
    # Round-robin (default)
    server oz-relayer-1:8080 max_fails=3 fail_timeout=30s;
    server oz-relayer-2:8080 max_fails=3 fail_timeout=30s;
    server oz-relayer-3:8080 max_fails=3 fail_timeout=30s;
}

# Alternative: least_conn
# upstream oz_relayer_pool {
#     least_conn;
#     server oz-relayer-1:8080 max_fails=3 fail_timeout=30s;
#     ...
# }
```

### Health Check and Failover

**Nginx Passive Health Check**:
- `max_fails=3`: Mark relayer as unhealthy after 3 consecutive failures
- `fail_timeout=30s`: Wait 30 seconds before retrying failed relayer
- Automatic: No application code required

**Health Check Endpoint**:
- Nginx `/health`: Returns 200 if Nginx is running
- OZ Relayer `/api/v1/health`: Returns relayer-specific status
- API Gateway `/api/v1/health`: Aggregates Nginx LB status

### Environment-Based Configuration

**Development (Docker Compose)**:
```bash
OZ_RELAYER_URL=http://oz-relayer-lb:8080
```

**Production (External Load Balancer)**:
```bash
OZ_RELAYER_URL=https://oz-relayer.production.example.com
```

**Benefits**:
- Zero code changes for production deployment
- Seamless transition to AWS ALB, Google Cloud LB, etc.
- Environment-specific configuration via environment variables

---

## Architecture Design Decisions

### Decision 1: Nginx Over Custom Load Balancer

**Rationale**:
- **Proven Reliability**: Nginx is battle-tested for high-traffic load balancing
- **Code Simplification**: ~300 LOC → ~100 LOC (60% reduction)
- **Native Features**: Health checks, failover, logging built-in
- **Performance**: Nginx native load balancing faster than application-level logic

**Trade-offs**:
- **Dependency**: Adds Nginx container to stack
- **Configuration**: Requires Nginx configuration knowledge (minimal)

**Conclusion**: Benefits outweigh trade-offs for production readiness.

---

### Decision 2: Single LB Endpoint Over Direct Pool Access

**Rationale**:
- **Simplified Service**: OzRelayerService only knows one endpoint
- **Environment Portability**: Easy to switch to external LB in production
- **Centralized Failover**: Nginx handles all pool management logic

**Trade-offs**:
- **Debugging**: Cannot target specific relayers directly (Nginx logs help)

**Conclusion**: Abstraction improves maintainability and production readiness.

---

### Decision 3: Round-Robin Over Weighted Distribution

**Rationale**:
- **Simplicity**: All relayers have equal capacity in Phase 1
- **Predictability**: Even distribution for testing and debugging
- **Future Flexibility**: Can switch to `least_conn` or weighted if needed

**Trade-offs**:
- **Uneven Load**: If relayers have different capacities (not the case here)

**Conclusion**: Round-robin is optimal for Phase 1 with uniform relayers.

---

## Risks and Mitigation

### Risk 1: Nginx Configuration Errors

**Risk**: Syntax errors or misconfiguration in `nginx.conf` prevents container startup.

**Mitigation**:
- **Validation**: Run `nginx -t` to validate configuration before deployment
- **Testing**: Test Nginx config in local Docker Compose first
- **Fallback**: Keep backup of working configuration

---

### Risk 2: All Relayers Fail Simultaneously

**Risk**: If all 3 relayers are unhealthy, Nginx returns 502 Bad Gateway.

**Mitigation**:
- **Health Check**: API Gateway returns 503 Service Unavailable
- **Monitoring**: Set up alerts for relayer pool health
- **Graceful Degradation**: Return clear error messages to API clients

---

### Risk 3: Environment Variable Misconfiguration

**Risk**: Wrong `OZ_RELAYER_URL` points to incorrect endpoint.

**Mitigation**:
- **Defaults**: Provide sensible default (`http://oz-relayer-lb:8080`)
- **Validation**: Log `OZ_RELAYER_URL` on service startup
- **Documentation**: Clear instructions in README.md

---

## Dependencies and Prerequisites

### Required Tools and Versions
- **Docker**: 24.0.0+
- **Docker Compose**: 2.20.0+
- **Node.js**: 20.x LTS
- **NestJS**: 10.x
- **pnpm**: Latest

### Required Services
- **SPEC-INFRA-001**: Docker Compose infrastructure running
- **SPEC-MODULE-001**: NestJS modules scaffolded
- **OZ Relayer Pool**: 3 instances (oz-relayer-1, oz-relayer-2, oz-relayer-3) running

### Environment Variables
- `RELAY_API_KEY`: API Key for authentication
- `OZ_RELAYER_URL`: Nginx LB endpoint (default: `http://oz-relayer-lb:8080`)

---

## Success Criteria

### Functional Requirements
- ✅ Nginx LB distributes requests to OZ Relayer Pool
- ✅ Direct Transaction API accepts valid requests (202 Accepted)
- ✅ Direct Transaction API rejects invalid requests (400 Bad Request)
- ✅ Health Check endpoint returns Nginx LB status
- ✅ Automatic failover when relayers fail

### Non-Functional Requirements
- ✅ Code complexity reduced by 60% (~200 LOC reduction)
- ✅ Nginx LB overhead < 5ms
- ✅ Health Check response time < 500ms
- ✅ All tests passing (unit, integration, E2E)

---

## Rollout Strategy

### Development Environment
1. Update `docker-compose.yaml` with `oz-relayer-lb` service
2. Create `docker/nginx/nginx.conf`
3. Start full stack: `docker-compose up`
4. Verify Nginx LB: `curl http://localhost:8080/health`
5. Test Direct Transaction API: `POST http://localhost:3000/api/v1/relay/direct`

### Testing Environment
1. Deploy updated Docker Compose stack
2. Run integration tests
3. Run E2E tests
4. Validate failover scenarios

### Production Environment (Future)
1. Update `OZ_RELAYER_URL` to external LB endpoint (e.g., AWS ALB)
2. Remove `oz-relayer-lb` service from Docker Compose
3. Deploy API Gateway with updated environment variable
4. Monitor logs and metrics

---

## Monitoring and Observability

### Nginx Access Logs
- **Path**: `/var/log/nginx/oz-relayer-access.log`
- **Content**: Request distribution, response times, status codes
- **Usage**: Verify round-robin distribution, debug 502 errors

### Nginx Error Logs
- **Path**: `/var/log/nginx/oz-relayer-error.log`
- **Content**: Upstream failures, health check failures
- **Usage**: Diagnose relayer connectivity issues

### Health Check Endpoint
- **Endpoint**: `GET http://localhost:8080/health`
- **Response**: `200 OK` with `healthy` message
- **Usage**: External monitoring tools (Prometheus, Grafana)

### API Gateway Logs
- **OzRelayerService**: Log `OZ_RELAYER_URL` on startup
- **DirectService**: Log transaction submissions and responses
- **Health Indicator**: Log LB health check results

---

## Timeline Estimates

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| **Phase 1** | Nginx LB setup | 1-2 hours |
| **Phase 2** | Simplify OzRelayerService | 1 hour |
| **Phase 3** | Implement Direct Transaction API | 2-3 hours |
| **Phase 4** | Update Health Check | 1 hour |
| **Phase 5** | Integration Testing | 2-3 hours |
| **Total** | All phases | **7-10 hours** |

**Note**: Estimates assume SPEC-INFRA-001 and SPEC-MODULE-001 are complete.

---

## Next Steps After Completion

1. **SPEC-PROXY-001 Complete**
   - Mark SPEC status as `completed`
   - Update Task Master: `task-master set-status --id=5 --status=done`

2. **Documentation**
   - Run `/moai:3-sync SPEC-PROXY-001` to generate docs
   - Update README.md with Direct Transaction API usage

3. **Future Enhancements**
   - **Phase 2+**: Implement Gasless Transaction API
   - **Phase 2+**: Add Transaction Status query endpoint
   - **Phase 2+**: Integrate MySQL for transaction history

---

## References

- **SPEC-INFRA-001**: Docker Compose infrastructure
- **SPEC-MODULE-001**: NestJS module scaffolding
- **Task Master Task #5**: OZ Relayer Proxy Service implementation
- **Nginx Documentation**: [http://nginx.org/en/docs/](http://nginx.org/en/docs/)
- **NestJS Documentation**: [https://docs.nestjs.com/](https://docs.nestjs.com/)

---

**Version**: 1.0.0
**Last Updated**: 2025-12-19
**Status**: draft

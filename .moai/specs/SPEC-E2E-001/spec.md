---
id: SPEC-E2E-001
version: "1.0.2"
status: "final"
created: "2025-12-23"
updated: "2025-12-23"
author: "Harry"
priority: "high"
---

# SPEC-E2E-001: E2E Test Infrastructure and Payment System Integration Verification

## HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-23 | Harry | Initial draft - E2E test infrastructure setup and payment system verification |
| 1.0.1 | 2025-12-23 | Harry | Review feedback incorporated - Added TC-E2E-S006, updated test count to 29, supplemented Nonce Mock strategy and ConfigService.getOrThrow |
| 1.0.2 | 2025-12-23 | Harry | Implementation complete - All 29 E2E tests passed, documentation synchronized (TESTING.md created, tech.md updated, README.md updated), SPEC finalized |

## Overview

| Item | Content |
|------|------|
| **SPEC ID** | SPEC-E2E-001 |
| **Title** | E2E Test Infrastructure and Payment System Integration Verification |
| **Status** | draft |
| **Created** | 2025-12-23 |
| **Updated** | 2025-12-23 |
| **Priority** | high |
| **Dependencies** | SPEC-PROXY-001, SPEC-GASLESS-001, SPEC-STATUS-001 |
| **Related Task** | Task #11 (Integration Tests and Payment System Verification) |

## Problem Definition

MSQ Relayer Service provides Direct Transaction, Gasless Transaction, Status Polling, and Health Check APIs, but currently lacks E2E test infrastructure, making full flow verification impossible.

**Problems to Solve**:
1. No integration tests at HTTP endpoint level
2. No test coverage for EIP-712 signature verification flow
3. Unable to verify payment system integration scenarios
4. No mock strategy for external services (OZ Relayer, RPC)

**Phase 1 Scope**: Mock-based E2E testing (excluding actual blockchain calls)
**Phase 2+ Scope** (separate SPEC): Docker-based real integration tests (Task #13)

## Solution

Build E2E test infrastructure using supertest, NestJS Testing Module, and ethers.js to:

1. Verify complete flow of 5 API endpoints
2. Provide EIP-712 signature generation and verification utilities
3. Remove external dependencies through Mock OZ Relayer responses
4. Verify payment system integration scenarios (Nonce → Signature → Submit → Status Check)

**Architecture**:
```
E2E Test Suite
├── supertest → HTTP endpoint testing
├── @nestjs/testing → NestJS app factory
├── ethers.js → EIP-712 signature generation
└── Jest Spy → OZ Relayer Mock responses
```

**Design Principles**: Remove external service dependencies, fast feedback, unit test isolation

---

## Environment (Environmental Requirements)

### ENV-E2E-001: NestJS Testing Module
**Condition**: Install supertest ^7.0.0, @types/supertest ^6.0.0
**Description**: supertest library required for HTTP endpoint testing
**Verification**: Verify with `pnpm list supertest` command

### ENV-E2E-002: Jest E2E Configuration
**Condition**: jest-e2e.json configuration file must exist
**Description**: Jest configuration for separate execution of E2E and unit tests
**Content**:
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "moduleNameMapper": { "^src/(.*)$": "<rootDir>/src/$1" },
  "testTimeout": 30000
}
```

### ENV-E2E-003: EIP-712 Signature Utility
**Condition**: ethers.js library (already installed)
**Description**: Generate and verify Gasless transaction signatures
**Reference**: Reuse pattern from `packages/relay-api/scripts/test-gasless.ts`

### ENV-E2E-004: Test Environment Isolation
**Condition**: Mock external services (OZ Relayer, RPC)
**Description**: Execute E2E tests without actual blockchain calls
**Method**: Mock OZ Relayer HTTP calls using Jest Spy

---

## Assumptions

### A-E2E-001: Unit Tests Completed
**Assumption**: All unit tests pass before starting E2E tests
**Impact**: If E2E fails, it's not a unit test level bug
**Verification**: Run unit tests first with `pnpm test` command

### A-E2E-002: OZ Relayer API Spec Stability
**Assumption**: OZ Relayer API response format does not change
**Impact**: Reliability of Mock response format
**Response**: Update `mock-responses.ts` when OZ Relayer API changes

### A-E2E-003: Test Coverage Goal
**Assumption**: E2E tests not included in 90% coverage goal
**Impact**: 90% unit test coverage + E2E tests managed separately
**Rationale**: E2E tests are for integration verification, not code coverage

### A-E2E-004: Hardhat Account Stability
**Assumption**: Use Hardhat default accounts #0~#2
**Impact**: Test wallet address and signature consistency
**Account Roles**:
- Account #0: Relayer (transaction submission)
- Account #1: User (Gasless TX signer)
- Account #2: Merchant (recipient)

---

## Requirements

### U-E2E-001: Direct Transaction E2E Test (Ubiquitous - Required)
**WHEN** the system provides `/api/v1/relay/direct` endpoint
**THEN** the system MUST return 202 Accepted for valid requests
**AND** return appropriate error codes (400/401/503) for invalid requests

**Test Cases**:
- TC-E2E-D001: Valid Direct TX → 202 Accepted
- TC-E2E-D002: Minimal fields only → 202 Accepted
- TC-E2E-D003: Invalid Ethereum address → 400 Bad Request
- TC-E2E-D004: Invalid hexadecimal data → 400 Bad Request
- TC-E2E-D005: Invalid speed enum → 400 Bad Request
- TC-E2E-D006: Missing API key → 401 Unauthorized
- TC-E2E-D007: Invalid API key → 401 Unauthorized
- TC-E2E-D008: OZ Relayer unavailable → 503 Service Unavailable

### U-E2E-002: Gasless Transaction E2E Test (Ubiquitous - Required)
**WHEN** the system provides `/api/v1/relay/gasless` endpoint
**THEN** the system MUST return 202 Accepted for valid requests with EIP-712 signature
**AND** return 401 Unauthorized when signature verification fails

**Test Cases**:
- TC-E2E-G001: Valid signed Gasless TX → 202 Accepted
- TC-E2E-G002: Custom gas and value included → 202 Accepted
- TC-E2E-G003: Nonce query → 200 OK + current nonce
- TC-E2E-G004: Nonce query with invalid address → 400 Bad Request
- TC-E2E-G005: Invalid signature format → 401 Unauthorized
- TC-E2E-G006: Signature from wrong signer → 401 Unauthorized
- TC-E2E-G007: Expired deadline → 400 Bad Request
- TC-E2E-G008: Nonce mismatch → 400 Bad Request
- TC-E2E-G009: Malformed signature → 400 Bad Request
- TC-E2E-G010: Missing required fields → 400 Bad Request

### U-E2E-003: Status Polling E2E Test (Ubiquitous - Required)
**WHEN** the system provides `/api/v1/relay/status/:txId` endpoint
**THEN** the system MUST return transaction status for valid UUID
**AND** return 404 Not Found for non-existent txId

**Test Cases**:
- TC-E2E-S001: Query pending status → 200 + status: pending
- TC-E2E-S002: Query confirmed status → 200 + hash + confirmedAt
- TC-E2E-S003: Query failed status → 200 + status: failed
- TC-E2E-S004: Invalid UUID format → 400 Bad Request
- TC-E2E-S005: OZ Relayer unavailable → 503 Service Unavailable
- TC-E2E-S006: Non-existent txId → 404 Not Found

### U-E2E-004: Health Check E2E Test (Ubiquitous - Required)
**WHEN** the system provides `/api/v1/health` endpoint
**THEN** the system MUST return 200 OK without API Key
**AND** return `status: "ok"` when all services are healthy

**Test Cases**:
- TC-E2E-H001: All services healthy → 200 + status: ok
- TC-E2E-H002: Public endpoint (API key not required) → 200 OK
- TC-E2E-H003: OZ Relayer pool unhealthy → 503 Service Unavailable

### E-E2E-001: Payment Integration Scenario (Event-driven)
**WHEN** user requests in sequence: Nonce query → Signature → Gasless TX submit → Status check
**THEN** the system MUST operate consistently throughout the entire flow

**Test Cases**:
- TC-E2E-P001: Batch token transfer (Direct TX) → Multiple 202 responses
- TC-E2E-P002: Complete Gasless payment flow → 4 steps completed

### U-E2E-005: EIP-712 Signature Utility (Ubiquitous - Required)
**WHEN** tests generate Gasless transaction signatures
**THEN** the system MUST use `signForwardRequest()` function from `test/utils/eip712-signer.ts`
**AND** signed ForwardRequest MUST pass GaslessService validation

**Utility Functions**:
- `signForwardRequest(wallet, request)` - Generate EIP-712 signature
- `createForwardRequest(from, to, options)` - Build ForwardRequest
- `createExpiredForwardRequest()` - For deadline validation testing

### U-E2E-006: Mock OZ Relayer Response (Unwanted - Prohibited)
**WHEN** executing E2E tests
**THEN** the system MUST NOT call actual OZ Relayer API (Unwanted)
**AND** MUST return Mock responses using Jest Spy

**Prohibited**:
- ❌ Actual OZ Relayer API calls
- ❌ Actual blockchain RPC calls
- ❌ Real wallet signatures (use Hardhat test accounts only)

---

## Specifications

### S-E2E-001: Jest E2E Configuration File

**File**: `packages/relay-api/test/jest-e2e.json`

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "moduleNameMapper": { "^src/(.*)$": "<rootDir>/src/$1" },
  "testTimeout": 30000
}
```

**Description**:
- `testRegex`: Execute only `.e2e-spec.ts` files
- `testTimeout`: 30 seconds (considering external API Mock time)
- `moduleNameMapper`: src path alias

### S-E2E-002: npm Script Addition

**File**: `packages/relay-api/package.json`

```json
{
  "scripts": {
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "test:e2e:cov": "jest --config ./test/jest-e2e.json --coverage"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0"
  }
}
```

### S-E2E-003: Directory Structure

```
packages/relay-api/test/
├── e2e/                             # E2E test suite
│   ├── direct.e2e-spec.ts          # Direct TX (8 tests)
│   ├── gasless.e2e-spec.ts         # Gasless TX (10 tests)
│   ├── status.e2e-spec.ts          # Status Polling (6 tests)
│   ├── health.e2e-spec.ts          # Health Check (3 tests)
│   └── payment-integration.e2e-spec.ts  # Payment Flow (2 tests)
├── fixtures/                        # Test data
│   ├── test-wallets.ts             # Hardhat accounts #0~#2
│   ├── test-config.ts              # Test environment settings
│   └── mock-responses.ts           # OZ Relayer Mock responses
├── utils/                           # Test utilities
│   ├── eip712-signer.ts            # EIP-712 signature utility
│   ├── encoding.ts                 # ERC-20 encoding
│   └── test-app.factory.ts         # NestJS app factory
└── jest-e2e.json                    # Jest E2E configuration
```

**File Count**: 12 new, 1 modified (package.json)

### S-E2E-004: Test Case Classification

| Category | Test File | Test Count | Main Verification |
|---------|------------|---------|---------|
| Direct TX | direct.e2e-spec.ts | 8 | Validation, authentication, error handling |
| Gasless TX | gasless.e2e-spec.ts | 10 | Signature verification, Nonce, error handling |
| Status | status.e2e-spec.ts | 6 | Status query, 404/503 errors |
| Health | health.e2e-spec.ts | 3 | Service status, public endpoint |
| Payment | payment-integration.e2e-spec.ts | 2 | Complete flow, integration scenarios |
| **Total** | **5 files** | **29 tests** | **Comprehensive verification** |

---

## Technical Constraints

### Technology Stack

| Library | Version | Purpose | Installation Status |
|-----------|------|------|---------|
| supertest | ^7.0.0 | HTTP endpoint testing | ❌ Installation required |
| @types/supertest | ^6.0.0 | TypeScript type definitions | ❌ Installation required |
| ethers.js | (existing) | EIP-712 signature generation | ✅ Already installed |
| @nestjs/testing | (existing) | NestJS test utilities | ✅ Already installed |
| jest | (existing) | Test framework | ✅ Already installed |

### Warnings

**E2E-WARN-001**: Prevent Unit Test Interference
- E2E tests located only in `test/e2e/` directory
- Separate Jest configuration files (`jest-e2e.json` vs default Jest)
- Separate test execution commands (`test:e2e` vs `test`)

**E2E-WARN-002**: Maintain Mock Response Consistency
- Update `mock-responses.ts` when OZ Relayer API response format changes
- Periodically verify consistency between actual API and Mock

**E2E-WARN-003**: Test Timeout Configuration
- Default timeout 30 seconds (jest-e2e.json)
- Slow test cases can set individual timeout (`jest.setTimeout()`)

**E2E-WARN-004**: Exclude Real Integration Tests
- Task #11 covers only Mock-based E2E tests
- Task #13 (Docker-based real integration tests) requires separate SPEC

---

## Acceptance Criteria

### Functional Verification

✅ **AC-E2E-001**: All 8 Direct Transaction API test cases pass
✅ **AC-E2E-002**: All 10 Gasless Transaction API test cases pass
✅ **AC-E2E-003**: All 6 Status Polling API test cases pass
✅ **AC-E2E-004**: All 3 Health Check API test cases pass
✅ **AC-E2E-005**: 2 Payment Integration scenario tests pass

### Quality Verification

✅ **AC-E2E-006**: No regression in existing unit tests (all unit tests pass)
✅ **AC-E2E-007**: E2E test execution time within 30 seconds (timeout configuration compliance)
✅ **AC-E2E-008**: External service dependencies removed using Mock responses
✅ **AC-E2E-009**: EIP-712 signature utility passes actual GaslessService validation

### Documentation

✅ **AC-E2E-010**: Each test file includes Given-When-Then comments
✅ **AC-E2E-011**: E2E test execution method documented in README or TESTING.md

---

## Security Considerations

- **Authentication**: Use existing API Key authentication middleware
- **Input Validation**: UUID, Ethereum address, hexadecimal validation
- **Rate Limiting**: Inherit existing rate limiting configuration
- **No Data Storage**: Phase 1 is pure proxy to OZ Relayer (no data storage)

---

## Dependencies

**Prerequisites** (completed):
- ✅ SPEC-PROXY-001: OZ Relayer integration
- ✅ SPEC-GASLESS-001: Gasless transaction API
- ✅ SPEC-STATUS-001: Status Polling API

**Follow-up** (separate SPEC required):
- ⏭️ SPEC-E2E-002: Docker-based real integration tests (Task #13)
- ⏭️ SPEC-LOAD-001: Artillery load testing (optional)

---

## Estimated Effort

- **Files**: 12 new, 1 modified
- **Lines of Code**: ~800 LOC (including tests)
- **Test Cases**: 29
- **Implementation Time**: ~4 hours (4 Phases)

---

## Phase 2+ Future Work (Out of Scope)

**Phase 2: Real Integration Tests**
- SPEC-E2E-002: Docker Compose-based integration tests
- Use actual Hardhat local node
- Use actual OZ Relayer instance
- Verify actual blockchain transactions

**Phase 3: Load Testing**
- SPEC-LOAD-001: Artillery-based load testing
- Verify concurrent request handling
- Measure throughput

---

## References

- OZ Relayer API: `GET /api/v1/relayers/{relayerId}/transactions/{txId}`
- DirectService implementation: `packages/relay-api/src/relay/direct/direct.service.ts`
- GaslessService implementation: `packages/relay-api/src/relay/gasless/gasless.service.ts`
- StatusService implementation: `packages/relay-api/src/relay/status/status.service.ts`
- EIP-712 signature pattern: `packages/relay-api/scripts/test-gasless.ts`

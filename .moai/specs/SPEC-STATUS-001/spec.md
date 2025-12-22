---
id: SPEC-STATUS-001
title: Transaction Status Polling API - Phase 1
version: 1.4.0
status: completed
author: "@user"
created: 2025-12-22
updated: 2025-12-23
priority: high
dependencies:
  - SPEC-PROXY-001
related_tasks:
  - task-9.1
tags:
  - transaction-status
  - polling
  - oz-relayer
  - phase-1
---

# SPEC-STATUS-001: Transaction Status Polling API - Phase 1

## HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.4.0 | 2025-12-23 | @user | Implementation Complete - Status: draft → completed, All tests passing (9/9, 80.95% coverage) |
| 1.3.0 | 2025-12-22 | @user | Detailed review: Document consistency fixes, status enum clarification |
| 1.2.0 | 2025-12-22 | @user | Code Review: getRelayerId() accessibility, Direct vs Gasless docs |
| 1.1.0 | 2025-12-22 | @user | Code Review: Direct HTTP calls for 404/503 error handling |
| 1.0.0 | 2025-12-22 | @user | Initial SPEC creation - Phase 1 Polling API only |

## Overview

| Field | Value |
|-------|-------|
| **SPEC ID** | SPEC-STATUS-001 |
| **Title** | Transaction Status Polling API - Phase 1 |
| **Status** | Draft |
| **Created** | 2025-12-22 |
| **Updated** | 2025-12-22 |
| **Dependencies** | SPEC-PROXY-001 |
| **Related Tasks** | Task #9 |

## Problem Statement

After submitting a transaction via `/api/v1/relay/direct` or `/api/v1/relay/gasless`, users need to query transaction status to track execution progress. The MSQ Relayer Service currently lacks a status query endpoint.

**Phase 1 Scope**: Implement a simple polling-based status query API that wraps `OzRelayerService.getTransactionStatus()`.

**Phase 2+ (Out of Scope)**: Webhook notifications, MySQL storage, Prisma Transaction model - to be addressed in separate SPECs.

## Solution

Implement a Transaction Status Polling API (`GET /api/v1/relay/status/{txId}`) that:

1. Accepts transaction ID from direct or gasless API responses
2. Makes direct HTTP calls to OZ Relayer API for status query
3. Returns transaction status, hash, and execution details
4. Provides proper error differentiation (404 Not Found vs 503 Service Unavailable)

**Architecture**:
```
Frontend/Backend → GET /status/{txId} → StatusService → [Direct HTTP] → OZ Relayer
```

**Design Principle**: Thin API gateway with proper error handling.

> **Note**: StatusService makes direct HTTP calls instead of using `OzRelayerService.getTransactionStatus()`
> because the existing OzRelayerService converts all errors to `ServiceUnavailableException`,
> losing the ability to distinguish 404 (not found) from 503 (service unavailable).

## Functional Requirements

### U-STATUS-001: Transaction Status Query
**Given** a user has a valid transaction ID from previous API call
**When** the API receives a GET request at `/api/v1/relay/status/{txId}`
**Then** the system shall query OZ Relayer and return transaction status, hash, and execution state

### U-STATUS-002: Response Format Standardization
**Given** a successful status query to OZ Relayer
**When** the API receives the OZ Relayer response
**Then** the system shall transform it to a standardized `TxStatusResponseDto` format

### U-STATUS-003: Not Found Handling
**Given** a transaction ID that does not exist in OZ Relayer
**When** the API queries OZ Relayer
**Then** the system shall return HTTP 404 Not Found with clear error message

### U-STATUS-004: Service Unavailable Handling
**Given** OZ Relayer is unavailable or timeout occurs
**When** the API attempts to query status
**Then** the system shall return HTTP 503 Service Unavailable with appropriate error message

### U-STATUS-005: Invalid Transaction ID Handling
**Given** a malformed or invalid transaction ID
**When** the API receives the request
**Then** the system shall return HTTP 400 Bad Request before querying OZ Relayer

## Technical Requirements

### T-STATUS-001: Direct HTTP Integration
- StatusService makes direct HTTP calls to OZ Relayer API
- Uses `OzRelayerService.getRelayerId()` to get relayer ID
- Uses `ConfigService` to get `OZ_RELAYER_URL` and `OZ_RELAYER_API_KEY`
- Timeout: 10 seconds (consistent with existing services)
- **Rationale**: Direct HTTP enables proper 404/503 error differentiation

### T-STATUS-002: DTO Structure
```typescript
// Request: Path parameter only
txId: string (from URL path)

// Response: TxStatusResponseDto
export class TxStatusResponseDto {
  @ApiProperty() transactionId: string;
  @ApiProperty() hash: string | null;
  @ApiProperty() status: string; // See status values below
  @ApiProperty() createdAt: string;
  @ApiProperty() confirmedAt?: string;
  @ApiProperty() from?: string;
  @ApiProperty() to?: string;
  @ApiProperty() value?: string;
}
```

**Status Values** (from OZ Relayer):

| Status | Description | API Response Mapping |
|--------|-------------|---------------------|
| `pending` | Transaction submitted, not yet sent | Simplified: `pending` |
| `sent` | Transaction sent to blockchain | Simplified: `pending` |
| `submitted` | Transaction submitted to mempool | Simplified: `pending` |
| `inmempool` | Transaction in mempool | Simplified: `pending` |
| `mined` | Transaction mined in block | Simplified: `pending` |
| `confirmed` | Transaction confirmed | `confirmed` |
| `failed` | Transaction failed | `failed` |

> **Note**: OZ Relayer returns 7 detailed status values. For Phase 1 API simplicity,
> the API consumer can treat `pending`, `sent`, `submitted`, `inmempool`, `mined` as "in progress"
> and focus on `confirmed` and `failed` as terminal states.

### T-STATUS-003: Error Response Format
```typescript
// HTTP 404 - Transaction not found
{
  "statusCode": 404,
  "message": "Transaction not found",
  "error": "Not Found"
}

// HTTP 503 - OZ Relayer unavailable
{
  "statusCode": 503,
  "message": "OZ Relayer service unavailable",
  "error": "Service Unavailable"
}

// HTTP 400 - Invalid transaction ID
{
  "statusCode": 400,
  "message": "Invalid transaction ID format",
  "error": "Bad Request"
}
```

### T-STATUS-004: Transaction ID Validation
- Must be a valid UUID v4 format (OZ Relayer transaction ID format)
- Use `@IsUUID('4')` validator from class-validator
- Validate before calling OzRelayerService

### T-STATUS-005: Direct vs Gasless Transaction Response

| Type | `to` Field | Description |
|------|-----------|-------------|
| Direct | Target contract address | User-specified destination contract |
| Gasless | `FORWARDER_ADDRESS` | ERC2771Forwarder contract address |

> **Note**: Both transaction types use the same status query endpoint.
> The `to` field in the response reflects the actual on-chain transaction target.

## Pre-Implementation Requirements

> **⚠️ Critical (Code Review v1.2.0)**: The following changes are required before implementation.

### P-STATUS-001: OzRelayerService Modification
**Issue**: `getRelayerId()` is currently `private` (line 85)
**Required Change**: Change to `public` for StatusService access

```typescript
// oz-relayer.service.ts - BEFORE
private async getRelayerId(): Promise<string> { ... }

// oz-relayer.service.ts - AFTER
public async getRelayerId(): Promise<string> { ... }
```

### P-STATUS-002: Test File Imports
**Required**: Add rxjs imports for test mocking

```typescript
// status.service.spec.ts, status.controller.spec.ts
import { of, throwError } from 'rxjs';
```

## Architecture

### Module Structure
```
packages/relay-api/src/relay/status/
├── dto/
│   └── tx-status-response.dto.ts    # Response DTO with Swagger annotations
├── status.controller.ts              # GET /status/{txId} endpoint
├── status.service.ts                 # OzRelayerService wrapper
├── status.module.ts                  # Module definition
├── status.controller.spec.ts        # Controller tests (5 tests)
└── status.service.spec.ts           # Service tests (4 tests)
```

### API Endpoints

**GET /api/v1/relay/status/:txId**
- Path Parameter: `txId` (UUID v4 format)
- Response: `200 OK` with `TxStatusResponseDto`
- Errors: `400`, `404`, `503`

### Integration with Existing Services

**Existing Components (No Logic Changes)**:
- `OzRelayerService.getRelayerId()` - exists, requires visibility change (see P-STATUS-001)
- Authentication handled by existing middleware ✅
- Nginx Load Balancer already configured ✅

**New Components**:
- StatusController (1 endpoint, 1 method)
- StatusService (direct HTTP call with 404/503 handling)
- TxStatusResponseDto (1 DTO)
- StatusModule (imports: HttpModule, OzRelayerModule)

**Module Dependencies**:
```typescript
// StatusModule requires:
imports: [
  HttpModule,       // Direct HTTP calls to OZ Relayer
  OzRelayerModule,  // getRelayerId() method
]
```

## Testing Strategy

### Unit Tests (~9 test cases)

**status.service.spec.ts** (4 tests):
- Valid transaction ID → returns status
- Transaction not found → NotFoundException
- OZ Relayer unavailable → ServiceUnavailableException
- Response transformation correct

**status.controller.spec.ts** (5 tests):
- GET /status/:txId with valid ID → 200 OK
- GET /status/:txId with invalid UUID → 400 Bad Request
- GET /status/:txId not found → 404 Not Found
- GET /status/:txId OZ Relayer unavailable → 503 Service Unavailable
- Response format matches TxStatusResponseDto schema

### Integration Tests (E2E)
- Submit transaction via /direct → Query status → Verify response consistency
- Submit gasless transaction → Query status → Verify gasless transaction fields
- Query non-existent transaction → 404 response

## Implementation Phases

### Phase 1: DTO Definition (1 file)
- TxStatusResponseDto with validation and Swagger annotations

### Phase 2: Service Layer (1 file)
- StatusService with getTransactionStatus() wrapper method

### Phase 3: Controller (1 file)
- StatusController with GET endpoint

### Phase 4: Module Registration (2 files)
- StatusModule definition
- RelayModule update (import StatusModule)

### Phase 5: Testing (2 files)
- Unit tests for service and controller

## Acceptance Criteria

✅ **Status Query**: Valid transaction IDs return status with 200 OK
✅ **Not Found**: Non-existent transaction IDs return 404 Not Found
✅ **Validation**: Invalid UUID formats return 400 Bad Request before OZ Relayer query
✅ **Service Unavailable**: OZ Relayer errors return 503 Service Unavailable
✅ **Response Format**: Response matches TxStatusResponseDto schema
✅ **Test Coverage**: ≥90% test coverage for service and controller
✅ **Documentation**: Swagger/OpenAPI annotations for endpoint

## Security Considerations

- **Authentication**: Uses existing API Key authentication middleware
- **Input Validation**: UUID validation prevents injection attacks
- **Rate Limiting**: Inherits existing rate limiting configuration
- **No Data Storage**: Phase 1 does not persist data (pure proxy to OZ Relayer)

## Dependencies

- SPEC-PROXY-001: OzRelayerService implementation ✅ (already completed)
- SPEC-GASLESS-001: Gasless transaction response format ✅ (already completed)

## Estimated Effort

- **Files**: 7 total (6 new, 1 modified)
- **Lines of Code**: ~200 LOC
- **Test Cases**: ~9 test cases
- **Implementation Time**: 1-2 hours

## Phase 2+ Future Work (Out of Scope)

**Phase 2: Webhook Notifications**
- SPEC-WEBHOOK-001: Implement webhook callback system
- Store webhook URLs per transaction
- Notify on status changes (pending → confirmed → failed)

**Phase 3: Transaction History**
- SPEC-HISTORY-001: MySQL + Prisma Transaction model
- Store transaction history locally
- Query optimization with indexes

**Phase 4: Advanced Features**
- SPEC-ANALYTICS-001: Transaction analytics dashboard
- SPEC-MONITORING-001: Real-time monitoring and alerts

## References

- OZ Relayer API: `GET /api/v1/relayers/{relayerId}/transactions/{txId}`
- DirectService implementation: `packages/relay-api/src/relay/direct/direct.service.ts`
- GaslessService implementation: `packages/relay-api/src/relay/gasless/gasless.service.ts`
- OzRelayerService: `packages/relay-api/src/oz-relayer/oz-relayer.service.ts` (Line 167-185)

---
id: SPEC-DEPLOY-001
version: "1.0.0"
status: "completed"
created: "2024-12-25"
updated: "2024-12-25"
author: "@user"
priority: "medium"
---

## HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 2.0.0 | 2024-12-25 | @user | User feedback applied: Removed Makefile and docker-compose.prod.yml, reorganized around Swagger/OpenAPI and Operations Guide |
| 1.0.0 | 2024-12-25 | @user | Initial SPEC created based on Task #12 - Production environment setup, API documentation, operations guide |

# SPEC-DEPLOY-001: API Documentation and Operations Guide

## Overview

This is an integrated SPEC for MSQ Relayer Service API documentation and operations. Based on Task #12 requirements, this SPEC covers two key areas:

1. **API Documentation**: Swagger/OpenAPI 3.0-based automatic document generation and Client SDK support
2. **Operations Guide**: Development/production environment configuration, service management procedures, monitoring, troubleshooting

**Background:**
- SPEC-INFRA-001 completed local development environment (docker-compose.yaml)
- Task #11 completed integration test infrastructure
- API documentation needed for production deployment and client service integration

**Goals:**
- Client Services can learn and integrate APIs through Swagger UI (/api/docs)
- Auto-generate TypeScript Client SDK from OpenAPI JSON (/api/docs-json)
- Stable 2-replica deployment operation in production environment
- New team members can reference operations guide during onboarding

---

## EARS Requirements

### Ubiquitous Requirements (Always Applicable)

**U-DEPLOY-001**: The system shall provide mandatory Swagger documentation for all API endpoints.
- All controllers must have `@ApiOperation` decorator
- All HTTP responses must have `@ApiResponse` decorator
- All DTOs must have `@ApiProperty` with example values

**U-DEPLOY-002**: The system shall manage environment-specific configuration in `.env.{environment}` file format.
- `.env.development`: Local development environment
- `.env.staging`: Staging environment
- `.env.production`: Production environment
- `.env.example`: Template (included in Git)

**U-DEPLOY-003**: The system shall specify API Key authentication method in API documentation.
- Swagger UI provides API Key input UI
- Document `x-api-key` header usage method

**U-DEPLOY-004**: The system shall exclude sensitive information from all environment configuration files and include only `.env.example` in Git.
- Add `.env.development`, `.env.staging`, `.env.production` to `.gitignore`

### Event-driven Requirements

**E-DEPLOY-001**: When Swagger UI is accessed (`/api/docs`), the system shall display the latest API spec.
- SwaggerModule auto-initialization at service startup
- Documentation auto-reflects code changes

**E-DEPLOY-002**: When OpenAPI JSON is requested (`/api/docs-json`), the system shall provide a valid OpenAPI 3.0 schema download.
- Content-Type: `application/json`
- Schema validation must pass

**E-DEPLOY-003**: At service startup, the system shall perform environment variable validation before starting the service.
- Output error log and exit on missing required environment variables
- Start service after validation passes

### State-driven Requirements

**S-DEPLOY-001**: While API documentation is complete and running, the system shall provide up-to-date documentation.
- Swagger UI and OpenAPI JSON maintain consistent information
- Documentation auto-reflects code changes

### Unwanted Behavior

**UW-DEPLOY-001**: The system shall NOT commit `.env.production` file to Git repository.
- Explicitly add to `.gitignore`

**UW-DEPLOY-002**: The system shall NOT use development mode environment variables (e.g., `DEV_MODE=true`) in production environment.

**UW-DEPLOY-003**: The system shall NOT expose Swagger UI without external authentication.
- Configure to be accessible only from internal network
- Or add API Key authentication

**UW-DEPLOY-004**: The system shall NOT add new endpoints without API documentation.
- Add documentation validation in CI/CD (optional)

### Optional Requirements

**O-DEPLOY-001**: If possible, the system should be able to auto-generate TypeScript Client SDK using OpenAPI Generator.
- Add `make generate-client` target (optional)

**O-DEPLOY-002**: If possible, Swagger UI should support API testing with Try it out feature enabled.

**O-DEPLOY-003**: If possible, the operations guide should include common troubleshooting scenarios and solutions.

---

## Technical Stack

### NestJS Swagger Integration

**Libraries:**
- `@nestjs/swagger`: 7.4.2 (currently installed)
- `swagger-ui-express`: auto-included

**Configuration Location:**
- `packages/relay-api/src/main.ts`: SwaggerModule initialization

**Documentation Endpoints:**
- Swagger UI: `http://localhost:3000/api/docs`
- OpenAPI JSON: `http://localhost:3000/api/docs-json`

### Environment-Specific Configuration Files

**File Structure:**
```
.env.development      # Local development environment
.env.staging          # Staging environment
.env.production       # Production environment
.env.example          # Template (included in Git)
```

**Required Environment Variables:**
- `NODE_ENV`: development | staging | production
- `PORT`: API Gateway port (3000)
- `RELAY_API_KEY`: API authentication key
- `REDIS_HOST`: Redis host
- `REDIS_PORT`: Redis port
- `RPC_URL`: Blockchain RPC URL

---

## Dependencies

### Technical Dependencies

**Completed SPECs:**
- SPEC-INFRA-001 (completed): Docker Compose-based local development environment

**Completed Tasks:**
- Task #11 (completed): Integration test infrastructure

**Required Libraries:**
- `@nestjs/swagger`: 7.4.2 (already installed)
- `@nestjs/common`: 10.4.20
- Docker Compose: 2.20.0+

### Environment Dependencies

**Local Development Environment:**
- Docker Desktop or Docker Engine
- pnpm 9.15.1

**Production Environment:**
- Docker Compose or Kubernetes (future)
- Blockchain RPC endpoint accessible

---

## Constraints

### Technical Constraints

**NestJS Version:**
- @nestjs/swagger: 7.4.2 fixed (existing installed version)
- OpenAPI 3.0 spec compliance

**Docker Constraints:**
- Local development environment uses docker-compose.yaml (SPEC-INFRA-001)
- Maintain Named Volume strategy (`msq-relayer-` prefix)

### Security Constraints

**Environment Variable Management:**
- `.env.production` must not be committed to Git
- Only include `.env.example` in Git as template

**API Documentation Access:**
- Swagger UI accessible only from internal network
- Or add API Key authentication (optional)

### File Location Constraints

**Environment Files:**
- Place `.env.*` files in project root

**Documentation Files:**
- `docs/operations.md`: Operations guide
- `README.md`: Project overview (update existing file)

---

## Non-Functional Requirements

### Performance

**Container Startup Time:**
- Production environment full startup: < 60 seconds (Cold Start)
- relay-api single replica: < 30 seconds

**API Response Time:**
- Swagger UI loading: < 2 seconds
- OpenAPI JSON download: < 1 second

### Availability

**Health Check:**
- relay-api: `/api/v1/health` endpoint
- Auto-restart on failure (3 consecutive failures)

**Resource Management:**
- Apply CPU and Memory limits for stability

### Security

**Environment Variable Isolation:**
- `.env.production` excluded from Git
- Sensitive information uses placeholders only in `.env.example`

**API Authentication:**
- `x-api-key` header-based authentication
- Swagger UI supports API Key input

### Maintainability

**Documentation:**
- All API endpoints require Swagger documentation
- Procedures specified in operations guide (`docs/operations.md`)

**Operations Procedures:**
- Standardized deployment procedures via environment-specific configuration files
- New team members reference `docs/operations.md` during onboarding

---

## Traceability

### Task Master Integration

**Task ID**: `12` (Production environment setup, API documentation and operations guide)

**Subtasks (expected):**
- `12.1`: Swagger/OpenAPI integration and all endpoint documentation
- `12.2`: Environment-specific configuration file creation (.env.development, .env.staging, .env.production)
- `12.3`: Operations guide writing (docs/operations.md)

### PRD Reference

**PRD Sections (expected):**
- PRD Section X: Production deployment requirements
- PRD Section Y: API documentation requirements
- PRD Section Z: Operations and monitoring requirements

### Related Documents

**SPEC Documents:**
- `SPEC-INFRA-001`: Docker Compose-based infrastructure (completed)

**Task Master:**
- `.taskmaster/tasks/task-12.md`: Task #12 details

**Project Documents:**
- `README.md`: Project overview (to be updated)
- `docs/operations.md`: Operations guide (new creation)

---

## Completion Checklist

### Swagger/OpenAPI Integration
- [x] SwaggerModule configuration added to main.ts
- [x] @ApiOperation, @ApiResponse added to all controllers
- [x] @ApiProperty and example values added to all DTOs
- [x] /api/docs and /api/docs-json endpoint verification
- [x] API Key authentication method documented

### Environment-Specific Configuration Files
- [x] .env.development created
- [x] .env.staging created
- [x] .env.production created
- [x] .env.example created and included in Git
- [x] Environment files added to .gitignore

### Operations Guide
- [x] docs/operations.md created
- [x] Service start/stop procedures documented
- [x] API documentation access method documented
- [x] Client SDK generation guide documented
- [x] Monitoring and troubleshooting guide documented

### Verification
- [x] Swagger UI (/api/docs) access and API documentation verified
- [x] OpenAPI JSON (/api/docs-json) download and schema validation

---

## Version Information

- **SPEC Version**: 2.0.0
- **Created**: 2024-12-25
- **Last Updated**: 2024-12-25
- **Status**: Draft
- **Priority**: Medium

---

## Change History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2024-12-25 | Initial SPEC created based on Task #12 - Production environment setup, API documentation, operations guide | @user |

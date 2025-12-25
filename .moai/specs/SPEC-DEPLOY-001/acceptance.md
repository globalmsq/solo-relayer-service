# SPEC-DEPLOY-001 Acceptance Criteria

## Overview

This document defines the acceptance criteria for verifying completion of SPEC-DEPLOY-001 (API Documentation and Operations Guide).

**Verification Method:** Scenario-based testing in Given-When-Then format

**Verification Environment:**
- Local development environment (Docker Desktop)
- Production-like environment (docker-compose.prod.yml)

---

## Scenario 1: Swagger UI Access and API Documentation Verification

### Given (Preconditions)
- relay-api service is running normally
- Port 3000 (development) or 3001/3002 (production) is open

### When (Actions)
1. Access `http://localhost:3000/api/docs` in web browser (development environment)
2. Or access `http://localhost:3001/api/docs` (production environment)

### Then (Expected Results)
1. **Swagger UI displays normally**
   - Page title: "MSQ Relayer Service API"
   - Version info: "1.0.0"

2. **All API endpoints are documented**
   - `/api/v1/health` (Health Check)
   - `/api/v1/relay` (Direct TX)
   - `/api/v1/gasless` (Gasless TX)
   - `/api/v1/status/{txId}` (TX Status)
   - All other implemented endpoints

3. **Each endpoint contains the following information**
   - Summary
   - Description (detailed explanation)
   - Request Body Schema
   - Response Schema
   - Example Values

4. **API Key authentication UI is enabled**
   - "Authorize" button displayed at top of Swagger UI
   - `x-api-key` input field displayed when clicked

### Verification Commands
```bash
# Check Swagger UI accessibility
curl -I http://localhost:3000/api/docs

# Expected result: HTTP/1.1 200 OK
```

---

## Scenario 2: OpenAPI JSON Download and Schema Validation

### Given (Preconditions)
- relay-api service is running normally
- Swagger UI is working correctly

### When (Actions)
1. Access `http://localhost:3000/api/docs-json`
2. Or download directly with curl: `curl http://localhost:3000/api/docs-json > openapi.json`

### Then (Expected Results)
1. **OpenAPI JSON is downloaded**
   - Content-Type: `application/json`
   - File size: > 0 bytes

2. **Valid OpenAPI 3.0 schema**
   - `openapi: "3.0.0"` field exists
   - `info.title: "MSQ Relayer Service API"` exists
   - `info.version: "1.0.0"` exists
   - All endpoints defined in `paths` object

3. **Schema validation passes**
   - OpenAPI 3.0 spec compliant
   - All required fields present
   - Schema structure validity verified

### Verification Commands
```bash
# Download OpenAPI JSON
curl -o openapi.json http://localhost:3000/api/docs-json

# Validate JSON file
jq . openapi.json > /dev/null && echo "Valid JSON" || echo "Invalid JSON"

# Check OpenAPI version
jq '.openapi' openapi.json
# Expected result: "3.0.0"

# Check API title
jq '.info.title' openapi.json
# Expected result: "MSQ Relayer Service API"

# Check endpoint list
jq '.paths | keys' openapi.json
# Expected result: ["/api/v1/health", "/api/v1/relay", ...]
```

---

## Scenario 3: Environment-Specific Configuration File Verification

### Given (Preconditions)
- Environment-specific configuration files are created
  - `.env.development`
  - `.env.staging`
  - `.env.production`
  - `.env.example`

### When (Actions)
1. Copy `.env.example` file to `.env.production`
2. Set required environment variable values
3. Verify environment variable settings are correctly applied

### Then (Expected Results)
1. **`.env.example` is included in Git**
   - `git ls-files .env.example` → File exists

2. **Sensitive information files are excluded from Git**
   - `git ls-files .env.production` → No file
   - `.env.production` added to `.gitignore`

3. **Environment variables are correctly loaded**
   - `NODE_ENV=production`
   - `RELAY_API_KEY` is set
   - `RPC_URL` is set

4. **Service startup fails on missing required environment variables**
   - Error log output when `RELAY_API_KEY` is missing
   - Service does not start

### Verification Commands
```bash
# Check if .env.example is included in Git
git ls-files .env.example
# Expected result: .env.example

# Check if .env.production is excluded from Git
git ls-files .env.production
# Expected result: (no output)

# Check .gitignore
grep ".env.production" .gitignore
# Expected result: .env.production

# Check environment variable loading (while service is running)
docker exec msq-relay-api-1 printenv NODE_ENV
# Expected result: production

docker exec msq-relay-api-1 printenv RELAY_API_KEY
# Expected result: (set API Key value)

# Verify startup failure on missing required environment variable (test)
# 1. Remove RELAY_API_KEY from .env.production
# 2. Run make prod-up
# 3. Check error logs
# Expected result: "RELAY_API_KEY is required" error output
```

---

## Scenario 4: Operations Guide Document Accessibility Verification

### Given (Preconditions)
- `docs/operations.md` file is created
- Assume new team members will reference the document for service operations

### When (Actions)
1. Open `docs/operations.md` file
2. Start service following documented procedures
3. Access API documentation following documented procedures
4. Perform troubleshooting following documented procedures

### Then (Expected Results)
1. **Service start/stop procedures are clearly documented**
   - `make prod-up` command specified
   - Or `docker-compose -f docker-compose.prod.yml up -d` specified
   - Expected results and verification methods documented

2. **API documentation access method is clearly documented**
   - Swagger UI URL: `http://localhost:3001/api/docs`
   - OpenAPI JSON URL: `http://localhost:3001/api/docs-json`
   - API Key authentication method documented

3. **Client SDK generation guide is included**
   - `make api-docs` command specified
   - `make generate-client` command specified (optional)
   - Generated SDK usage example code included

4. **Troubleshooting scenarios are included**
   - Scenario 1: Health Check failure
   - Scenario 2: Missing environment variables
   - Scenario 3: Port conflict
   - Each scenario includes symptom, cause, and solution

### Verification Commands
```bash
# Verify operations.md file exists
ls -lh docs/operations.md
# Expected result: File exists

# Check document content
cat docs/operations.md | grep "Service Start"
# Expected result: Service start procedure section exists

cat docs/operations.md | grep "API Documentation"
# Expected result: API documentation access method section exists

cat docs/operations.md | grep "Client SDK"
# Expected result: Client SDK generation guide section exists

cat docs/operations.md | grep "Troubleshooting"
# Expected result: Troubleshooting scenario section exists

# New team member onboarding simulation (manual verification)
# 1. Can start service using only operations.md document
# 2. Can access API documentation using only operations.md document
# 3. Can perform troubleshooting using only operations.md document
```

---

## Scenario 5: TypeScript Client SDK Generation Verification (Optional)

### Given (Preconditions)
- `openapi.json` file is generated (`make api-docs` execution completed)
- OpenAPI Generator CLI installable

### When (Actions)
1. Execute `make generate-client`

### Then (Expected Results)
1. **TypeScript Client SDK is generated**
   - Output directory: `./generated/client`
   - Generated files: `api.ts`, `base.ts`, `configuration.ts`, etc.

2. **Generated SDK is usable**
   - TypeScript compilation passes
   - API call code can be written

### Verification Commands
```bash
# Generate Client SDK
make generate-client
# Expected output:
# Generating TypeScript Client SDK...
# Client SDK generated in ./generated/client

# Check generated files
ls -lh ./generated/client
# Expected result: api.ts, base.ts, configuration.ts etc. files exist

# TypeScript compilation check (optional)
cd ./generated/client
npm install
npx tsc --noEmit
# Expected result: No compilation errors
```

---

## Complete Acceptance Checklist

### Swagger/OpenAPI Integration
- [x] Swagger UI accessible (`http://localhost:3000/api/docs`)
- [x] All API endpoints documented
- [x] OpenAPI JSON downloadable (`http://localhost:3000/api/docs-json`)
- [x] OpenAPI 3.0 schema validation passes
- [x] API Key authentication UI enabled

### Environment-Specific Configuration Files
- [x] .env.development created
- [x] .env.staging created
- [x] .env.production created
- [x] .env.example created and included in Git
- [x] Sensitive information files added to .gitignore

### Operations Guide
- [x] docs/operations.md created
- [x] Service start/stop procedures documented
- [x] API documentation access method documented
- [x] Client SDK generation guide documented
- [x] Troubleshooting scenarios documented

### Optional
- [ ] TypeScript Client SDK generation success (using OpenAPI Generator)
- [ ] Swagger UI Try it out feature enabled
- [ ] Additional troubleshooting scenarios (3 or more)

---

## Acceptance Pass Criteria

**Required Conditions (All 4 scenarios must pass):**
1. ✅ Scenario 1: Swagger UI Access and API Documentation Verification
2. ✅ Scenario 2: OpenAPI JSON Download and Schema Validation
3. ✅ Scenario 3: Environment-Specific Configuration File Verification
4. ✅ Scenario 4: Operations Guide Document Accessibility Verification

**Recommended Conditions (Optional):**
5. ⭕ Scenario 5: TypeScript Client SDK Generation Verification

**Final Acceptance:** SPEC-DEPLOY-001 is considered complete when all 4 required conditions pass

---

**Last Updated:** 2024-12-25
**Author:** @user
**SPEC Version:** 2.0.0

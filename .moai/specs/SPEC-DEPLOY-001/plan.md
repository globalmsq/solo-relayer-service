# SPEC-DEPLOY-001 Implementation Plan

## Overview

This document defines the specific implementation plan for SPEC-DEPLOY-001 (API Documentation and Operations Guide).

**Goals:**
- Swagger/OpenAPI-based automatic API document generation
- Environment-specific configuration file setup
- Operations guide creation

**Implementation Order:**
1. Swagger/OpenAPI Integration (Priority: High) - ✅ Completed
2. Environment-Specific Configuration Files (Priority: Medium) - ✅ Completed
3. Operations Guide (Priority: Medium) - ✅ Completed

---

## Phase 1: Swagger/OpenAPI Integration (Priority: High)

### 1.1 SwaggerModule Configuration

**Task:**
- Add SwaggerModule configuration to `packages/relay-api/src/main.ts`

**Implementation:**
```typescript
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('MSQ Relayer Service API')
    .setDescription('Meta Transaction Relay Infrastructure API Documentation')
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Enable CORS
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`MSQ Relayer API Gateway is running on port ${port}`);
  console.log(`Swagger UI: http://localhost:${port}/api/docs`);
  console.log(`OpenAPI JSON: http://localhost:${port}/api/docs-json`);
}

bootstrap();
```

**Verification:**
- Access `http://localhost:3000/api/docs` after service startup
- Download and validate schema from `http://localhost:3000/api/docs-json`

---

### 1.2 Controller Documentation

**Task:**
- Add `@ApiOperation`, `@ApiResponse` decorators to all controllers

**Example: HealthController**
```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Health Check',
    description: 'Checks service status. Includes connection status of all dependent services (Redis, Relayers).',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is running normally.',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2024-12-25T12:00:00.000Z',
        services: {
          redis: 'connected',
          relayers: ['relayer-1: ok', 'relayer-2: ok', 'relayer-3: ok'],
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'One or more dependent services have failed.',
  })
  healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
```

**Controllers to Document:**
- HealthController
- RelayController (Direct TX)
- GaslessController (Gasless TX)
- StatusController (TX Status)
- All other controllers

**Verification:**
- Verify documentation for each endpoint in Swagger UI
- Test API with "Try it out" feature

---

### 1.3 DTO Documentation

**Task:**
- Add `@ApiProperty` decorator to all DTOs

**Example: CreateRelayRequestDto**
```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber } from 'class-validator';

export class CreateRelayRequestDto {
  @ApiProperty({
    description: 'Wallet address of the meta-transaction requester',
    example: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
  })
  @IsString()
  @IsNotEmpty()
  from: string;

  @ApiProperty({
    description: 'Transaction recipient address',
    example: '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
  })
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiProperty({
    description: 'Transaction data (hex encoded)',
    example: '0xa9059cbb000000000000000000000000...',
  })
  @IsString()
  @IsNotEmpty()
  data: string;

  @ApiProperty({
    description: 'Gas Limit',
    example: 100000,
  })
  @IsNumber()
  gasLimit: number;
}
```

**DTOs to Document:**
- CreateRelayRequestDto
- CreateGaslessRequestDto
- RelayResponseDto
- TxStatusResponseDto
- All other request/response DTOs

**Verification:**
- Verify schema for each DTO in Swagger UI
- Confirm example values display correctly

---

### 1.4 API Key Authentication Documentation

**Task:**
- Enable API Key input UI in Swagger UI

**Implementation:**
```typescript
// main.ts
const config = new DocumentBuilder()
  .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
  .build();
```

**Apply Security to Controllers:**
```typescript
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';

@ApiSecurity('api-key')
@Controller('relay')
export class RelayController {
  // ...
}
```

**Verification:**
- Verify "Authorize" button at top of Swagger UI
- Test authenticated requests after entering API Key

---

## Phase 2: Environment-Specific Configuration Files (Priority: Medium)

### 2.1 Environment File Creation

**File List:**
- `.env.development`
- `.env.staging`
- `.env.production`
- `.env.example`

**`.env.development` (Local Development):**
```env
NODE_ENV=development
PORT=3000
RELAY_API_KEY=local-dev-api-key
REDIS_HOST=localhost
REDIS_PORT=6379
RPC_URL=http://localhost:8545
```

**`.env.staging` (Staging Environment):**
```env
NODE_ENV=staging
PORT=3000
RELAY_API_KEY=staging-api-key-change-me
REDIS_HOST=redis
REDIS_PORT=6379
RPC_URL=https://rpc-amoy.polygon.technology
```

**`.env.production` (Production Environment):**
```env
NODE_ENV=production
PORT=3000
RELAY_API_KEY=production-api-key-change-me
REDIS_HOST=redis
REDIS_PORT=6379
RPC_URL=https://polygon-rpc.com
```

**`.env.example` (Template, included in Git):**
```env
NODE_ENV=development
PORT=3000
RELAY_API_KEY=your-api-key-here
REDIS_HOST=localhost
REDIS_PORT=6379
RPC_URL=http://localhost:8545
```

**`.gitignore` Update:**
```gitignore
# Environment files (exclude production secrets)
.env.development
.env.staging
.env.production

# Include template
!.env.example
```

**Verification:**
- Confirm only `.env.example` is included in Git
- Test service startup with each environment file

---

## Phase 3: Operations Guide (Priority: Medium)

### 3.1 Create docs/operations.md

**File Location:**
- `docs/operations.md`

**Document Structure:**

#### 1. Service Start/Stop Procedures

**Start Service:**
```bash
# Start development environment
cd packages/relay-api
pnpm run start:dev

# Or Docker development environment
docker compose -f docker/docker-compose.yaml up -d
```

**Stop Service:**
```bash
# Stop Docker development environment
docker compose -f docker/docker-compose.yaml down
```

**Check Service Status:**
```bash
# Health Check
curl http://localhost:3000/api/v1/health

# Or
curl http://localhost:3001/api/v1/health
curl http://localhost:3002/api/v1/health
```

#### 2. API Documentation Access

**Swagger UI:**
- relay-api-1: http://localhost:3001/api/docs
- relay-api-2: http://localhost:3002/api/docs

**OpenAPI JSON:**
- relay-api-1: http://localhost:3001/api/docs-json
- relay-api-2: http://localhost:3002/api/docs-json

**API Key Authentication:**
1. Click "Authorize" button in Swagger UI
2. Enter `x-api-key` value
3. Click "Authorize" to enable authentication

#### 3. Client SDK Generation Guide

**Extract OpenAPI JSON:**
```bash
make api-docs
```

**Generate TypeScript Client SDK:**
```bash
make generate-client
```

**Using Generated SDK:**
```typescript
import { DefaultApi } from './generated/client';

const api = new DefaultApi({
  basePath: 'http://localhost:3001',
  headers: { 'x-api-key': 'your-api-key' }
});

const response = await api.healthCheck();
console.log(response.data);
```

#### 4. Monitoring and Troubleshooting

**Check Logs:**
```bash
# relay-api-1 logs
docker logs msq-relay-api-1

# relay-api-2 logs
docker logs msq-relay-api-2

# Real-time log tracking
docker logs -f msq-relay-api-1
```

**Common Troubleshooting Scenarios:**

**Scenario 1: Health Check Failure**
- Symptom: Health Check endpoint returns 503 error
- Cause: Redis connection failure or Relayer connection failure
- Solution:
  ```bash
  # Check Redis status
  docker logs msq-redis-prod

  # Check Relayer status
  docker logs msq-oz-relayer-1-prod
  ```

**Scenario 2: Missing Environment Variables**
- Symptom: Error log output at service startup
- Cause: Required environment variable not set
- Solution:
  ```bash
  # Check .env.production file
  cat .env.production

  # Add missing environment variable
  ```

**Scenario 3: Port Conflict**
- Symptom: `bind: address already in use` error
- Cause: Port 3001 or 3002 already in use
- Solution:
  ```bash
  # Check process using port
  lsof -i :3001
  lsof -i :3002

  # Or change port in docker-compose.prod.yml
  ```

**Verification:**
- Confirm `docs/operations.md` file creation
- Review if new team members can operate service using only the documentation

---

## Implementation Priority Summary

| Phase | Priority | Status |
|-------|---------|--------|
| Phase 1: Swagger/OpenAPI Integration | High | ✅ Completed |
| Phase 2: Environment-Specific Configuration Files | Medium | ✅ Completed |
| Phase 3: Operations Guide | Medium | ✅ Completed |

---

## Risks and Mitigation

### Risk 1: Missing Swagger UI Access Restriction
- **Impact:** API documentation exposed externally
- **Mitigation:** Configure Swagger UI to be accessible only from internal network or add API Key authentication

### Risk 2: Environment Variable File Git Commit
- **Impact:** Production API Key leak
- **Mitigation:** Explicitly add to `.gitignore`, set up Pre-commit Hook (optional)

---

## Implementation Complete

All Phases have been completed:

1. ✅ **Phase 1**: Swagger/OpenAPI integration completed
2. ✅ **Phase 2**: Environment-specific configuration files created
3. ✅ **Phase 3**: Operations guide created

---

**Last Updated:** 2024-12-25
**Author:** @user
**SPEC Version:** 2.0.0

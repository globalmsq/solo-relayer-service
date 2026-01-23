---
id: SPEC-PROXY-001
title: Nginx Load Balancer-based OZ Relayer Proxy and Direct Transaction API
domain: PROXY
status: completed
priority: high
created_at: 2025-12-19
updated_at: 2025-12-19
version: 1.0.0
---

# SPEC-PROXY-001: Nginx Load Balancer-based OZ Relayer Proxy and Direct Transaction API

## Overview

Implement an Nginx-based Load Balancer to proxy requests to the OZ Relayer Pool (3+ relayers) and create Direct Transaction API endpoints. This architecture simplifies the implementation by delegating load balancing, health checking, and automatic failover to Nginx's native capabilities.

**Core Strategy**: Replace custom pool management code (~300 LOC) with Nginx upstream configuration (~50 LOC) for production-ready load balancing.

## Objectives

1. **Nginx Load Balancer**: Configure Nginx to proxy requests to OZ Relayer Pool with round-robin distribution
2. **Direct Transaction API**: Implement REST API endpoints for direct blockchain transaction submission
3. **Simplified OzRelayerService**: Replace multi-relayer pool logic with single Nginx LB endpoint
4. **Health Check Integration**: Update health indicators to check Nginx LB status
5. **Production Readiness**: Enable seamless transition to external load balancers via environment variable changes

---

## EARS Requirements

### Ubiquitous Requirements (System-wide)

**U-PROXY-001**: The system shall use Nginx as the Load Balancer for OZ Relayer Pool.

**U-PROXY-002**: The system shall expose a single proxy endpoint `oz-relayer-lb:8080` for all OZ Relayer API calls.

**U-PROXY-003**: The system shall use Nginx upstream module with round-robin strategy for request distribution.

**U-PROXY-004**: The system shall configure automatic failover through Nginx health checks (`max_fails=3`, `fail_timeout=30s`).

**U-PROXY-005**: The system shall place Nginx configuration in `docker/nginx/nginx.conf`.

**U-PROXY-006**: The system shall implement Direct Transaction API under `/api/v1/relay/direct` endpoint.

**U-PROXY-007**: The system shall validate Direct Transaction requests using DTOs (DirectTxRequestDto).

**U-PROXY-008**: The system shall return HTTP 202 Accepted for successful Direct Transaction submissions.

### Event-driven Requirements

**E-PROXY-001**: When Direct Transaction API receives a request, the system shall forward it to Nginx LB.

**E-PROXY-002**: When Nginx LB receives a request, the system shall distribute it to one of the healthy OZ Relayers.

**E-PROXY-003**: When an OZ Relayer fails health check, Nginx shall automatically exclude it from the pool.

**E-PROXY-004**: When a failed OZ Relayer recovers, Nginx shall automatically include it back in the pool.

**E-PROXY-005**: When Health Check endpoint is called, the system shall verify Nginx LB status and return pool health.

### State-driven Requirements

**S-PROXY-001**: While at least one OZ Relayer is healthy, the system shall process Direct Transaction requests.

**S-PROXY-002**: While all OZ Relayers are unhealthy, the system shall return HTTP 503 Service Unavailable.

**S-PROXY-003**: While Nginx LB is running, the system shall log access and error events to Nginx logs.

### Unwanted Behavior

**UW-PROXY-001**: The system shall not implement custom round-robin or load balancing logic in application code.

**UW-PROXY-002**: The system shall not maintain relayer pool state in memory (Nginx handles this).

**UW-PROXY-003**: The system shall not schedule periodic health checks in application code (Nginx handles this).

**UW-PROXY-004**: Direct Transaction API shall not accept requests without API Key authentication (except Health Check).

### Optional Requirements

**O-PROXY-001**: If possible, Nginx shall enable access logging for debugging request distribution.

**O-PROXY-002**: If possible, the system shall support alternative load balancing strategies (least_conn).

---

## Technical Specifications

### Architecture Diagram

```
┌─────────────┐       ┌──────────────────┐       ┌───────────────┐
│  API Client │──────▶│   API Gateway    │──────▶│   Nginx LB    │
│             │       │  (relay-api)     │       │ (oz-relayer-lb│
│             │       │  Port 3000       │       │  Port 8080)   │
└─────────────┘       └──────────────────┘       └───────┬───────┘
                                                          │
                            ┌─────────────────────────────┼─────────────┐
                            │                             │             │
                            ▼                             ▼             ▼
                    ┌──────────────┐            ┌──────────────┐  ┌──────────────┐
                    │ oz-relayer-1 │            │ oz-relayer-2 │  │ oz-relayer-3 │
                    │   Port 8080  │            │   Port 8080  │  │   Port 8080  │
                    └──────────────┘            └──────────────┘  └──────────────┘
```

### Directory Structure

```
docker/
├── nginx/
│   └── nginx.conf                  # Nginx Load Balancer configuration
├── docker-compose.yaml             # Add oz-relayer-lb service

packages/relay-api/src/
├── relay/
│   ├── relay.module.ts             # Register Direct components
│   ├── direct/
│   │   ├── direct.controller.ts    # Direct Transaction REST API
│   │   └── direct.service.ts       # Business logic
│   └── dto/
│       ├── direct-tx-request.dto.ts
│       └── direct-tx-response.dto.ts
├── oz-relayer/
│   └── oz-relayer.service.ts       # Simplified to single LB endpoint
└── health/
    └── indicators/
        └── oz-relayer.health.ts    # Updated to check Nginx LB
```

### 1. Nginx Load Balancer Configuration

**File**: `docker/nginx/nginx.conf`

```nginx
events {
    worker_connections 1024;
}

http {
    upstream oz_relayer_pool {
        # Load balancing strategy (round-robin is default)
        # Alternative: least_conn;

        server oz-relayer-1:8080 max_fails=3 fail_timeout=30s;
        server oz-relayer-2:8080 max_fails=3 fail_timeout=30s;
        server oz-relayer-3:8080 max_fails=3 fail_timeout=30s;
    }

    server {
        listen 8080;
        server_name oz-relayer-lb;

        # Proxy all requests to OZ Relayer Pool
        location / {
            proxy_pass http://oz_relayer_pool;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_connect_timeout 5s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;
        }

        # Health check endpoint (returns 200 if Nginx is running)
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }

    # Access logging for debugging
    access_log /var/log/nginx/oz-relayer-access.log;
    error_log /var/log/nginx/oz-relayer-error.log;
}
```

### 2. Docker Compose Service Addition

**File**: `docker/docker-compose.yaml`

Add new service:

```yaml
services:
  oz-relayer-lb:
    image: nginx:alpine
    container_name: oz-relayer-lb
    ports:
      - "8080:8080"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - oz-relayer-1
      - oz-relayer-2
      - oz-relayer-3
    networks:
      - relayer-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s
```

### 3. Simplified OzRelayerService

**File**: `packages/relay-api/src/oz-relayer/oz-relayer.service.ts`

Replace multi-relayer pool logic with single Nginx LB endpoint:

```typescript
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface DirectTxRequest {
  to: string;
  data: string;
  value?: string;
  gasLimit?: string;
  speed?: string;
}

export interface DirectTxResponse {
  transactionId: string;
  hash: string;
  status: string;
  createdAt: string;
}

@Injectable()
export class OzRelayerService {
  private readonly relayerUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Single Nginx LB endpoint
    this.relayerUrl = this.configService.get<string>(
      'OZ_RELAYER_URL',
      'http://oz-relayer-lb:8080'
    );
  }

  /**
   * Send transaction to OZ Relayer via Nginx Load Balancer
   * Nginx handles distribution to healthy relayers
   */
  async sendTransaction(request: DirectTxRequest): Promise<DirectTxResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.relayerUrl}/api/v1/transactions`,
          request,
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 30000, // 30 seconds
          }
        )
      );
      return response.data;
    } catch (error) {
      throw new ServiceUnavailableException('OZ Relayer service unavailable');
    }
  }

  /**
   * Query transaction status via Nginx Load Balancer
   */
  async getTransactionStatus(txId: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.relayerUrl}/api/v1/transactions/${txId}`,
          { timeout: 10000 }
        )
      );
      return response.data;
    } catch (error) {
      throw new ServiceUnavailableException('OZ Relayer service unavailable');
    }
  }
}
```

### 4. Direct Transaction Controller

**File**: `packages/relay-api/src/relay/direct/direct.controller.ts`

```typescript
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DirectService } from './direct.service';
import { DirectTxRequestDto } from '../dto/direct-tx-request.dto';
import { DirectTxResponseDto } from '../dto/direct-tx-response.dto';

@ApiTags('Direct Transaction')
@Controller('relay/direct')
export class DirectController {
  constructor(private readonly directService: DirectService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send direct transaction via OZ Relayer' })
  @ApiResponse({ status: 202, type: DirectTxResponseDto })
  async sendDirectTransaction(
    @Body() dto: DirectTxRequestDto,
  ): Promise<DirectTxResponseDto> {
    return this.directService.sendTransaction(dto);
  }
}
```

### 5. Direct Transaction Service

**File**: `packages/relay-api/src/relay/direct/direct.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { OzRelayerService } from '../../oz-relayer/oz-relayer.service';
import { DirectTxRequestDto } from '../dto/direct-tx-request.dto';
import { DirectTxResponseDto } from '../dto/direct-tx-response.dto';

@Injectable()
export class DirectService {
  constructor(private readonly ozRelayerService: OzRelayerService) {}

  async sendTransaction(
    dto: DirectTxRequestDto,
  ): Promise<DirectTxResponseDto> {
    const response = await this.ozRelayerService.sendTransaction({
      to: dto.to,
      data: dto.data,
      value: dto.value,
      gasLimit: dto.gasLimit,
      speed: dto.speed,
    });

    return {
      transactionId: response.transactionId,
      hash: response.hash,
      status: response.status,
      createdAt: response.createdAt,
    };
  }
}
```

### 6. DTOs

**File**: `packages/relay-api/src/relay/dto/direct-tx-request.dto.ts`

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEthereumAddress,
  IsHexadecimal,
  IsOptional,
  IsNumberString,
  IsEnum,
} from 'class-validator';

export class DirectTxRequestDto {
  @ApiProperty({ description: 'Target contract address' })
  @IsEthereumAddress()
  to: string;

  @ApiProperty({ description: 'Encoded function call data' })
  @IsHexadecimal()
  data: string;

  @ApiPropertyOptional({ description: 'ETH amount to send (wei)' })
  @IsOptional()
  @IsNumberString()
  value?: string;

  @ApiPropertyOptional({ description: 'Gas limit' })
  @IsOptional()
  @IsNumberString()
  gasLimit?: string;

  @ApiPropertyOptional({
    enum: ['safeLow', 'average', 'fast', 'fastest'],
    description: 'Transaction speed',
  })
  @IsOptional()
  @IsEnum(['safeLow', 'average', 'fast', 'fastest'])
  speed?: string;
}
```

**File**: `packages/relay-api/src/relay/dto/direct-tx-response.dto.ts`

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class DirectTxResponseDto {
  @ApiProperty({ description: 'Transaction ID' })
  transactionId: string;

  @ApiProperty({ description: 'Transaction hash' })
  hash: string;

  @ApiProperty({ description: 'Transaction status' })
  status: string;

  @ApiProperty({ description: 'Created timestamp' })
  createdAt: string;
}
```

### 7. Updated Health Check Indicator

**File**: `packages/relay-api/src/health/indicators/oz-relayer.health.ts`

Replace pool health check with Nginx LB health check:

```typescript
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OzRelayerHealthIndicator extends HealthIndicator {
  private readonly relayerUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.relayerUrl = this.configService.get<string>(
      'OZ_RELAYER_URL',
      'http://oz-relayer-lb:8080'
    );
  }

  /**
   * Check OZ Relayer Load Balancer health
   * Nginx LB handles underlying pool health automatically
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.relayerUrl}/health`, {
          timeout: 5000,
        })
      );

      if (response.status === 200) {
        return this.getStatus(key, true, {
          url: this.relayerUrl,
          status: 'healthy',
        });
      }
    } catch (error) {
      throw new HealthCheckError(
        'OZ Relayer LB check failed',
        this.getStatus(key, false, {
          url: this.relayerUrl,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      );
    }
  }
}
```

### 8. Relay Module Registration

**File**: `packages/relay-api/src/relay/relay.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DirectController } from './direct/direct.controller';
import { DirectService } from './direct/direct.service';
import { OzRelayerModule } from '../oz-relayer/oz-relayer.module';

@Module({
  imports: [HttpModule, OzRelayerModule],
  controllers: [DirectController],
  providers: [DirectService],
})
export class RelayModule {}
```

---

## Environment

### Development Environment
- **OS**: macOS / Linux / Windows (Docker Desktop)
- **Node.js**: 20.x LTS
- **NestJS**: 10.x
- **Docker**: 24.0.0+
- **Docker Compose**: 2.20.0+
- **Package Manager**: pnpm

### Runtime Environment
- **Nginx**: nginx:alpine (latest)
- **OZ Relayer Pool**: 3 instances (oz-relayer-1, oz-relayer-2, oz-relayer-3)
- **Redis**: redis:8.0-alpine
- **Hardhat Node**: Local blockchain (Port 8545)

---

## Assumptions

1. **SPEC-INFRA-001 Complete**: Docker Compose infrastructure with 3 OZ Relayers is running.
2. **SPEC-MODULE-001 Complete**: NestJS modules (auth, relay, oz-relayer, config, common) are scaffolded.
3. **Phase 1 Constraints**: No Prisma/MySQL, Redis + OZ Relayer only.
4. **Nginx Availability**: Nginx alpine image is accessible and lightweight.
5. **API Key Authentication**: Single `RELAY_API_KEY` environment variable is used for authentication.

---

## Constraints

### Technical Constraints
- **NestJS**: 10.x version
- **TypeScript**: 5.x version
- **Nginx**: alpine image only (minimal footprint)
- **Load Balancing Strategy**: round-robin or least_conn only

### Security Constraints
- **API Key**: All Direct Transaction API calls require `X-API-Key` header
- **Health Check**: Public access allowed (no authentication)
- **Nginx Logs**: Access logs enabled for debugging

### Operational Constraints
- **Minimum Relayers**: 3 instances required for production
- **Health Check Timeout**: 5 seconds per relayer
- **Failover**: Automatic via Nginx (`max_fails=3`, `fail_timeout=30s`)

---

## Dependencies

### Technical Dependencies
- **Nginx**: alpine image (Docker Hub)
- **NestJS**: 10.x (`@nestjs/common`, `@nestjs/axios`)
- **class-validator**: For DTO validation
- **class-transformer**: For DTO transformation

### Environment Dependencies
- **Docker Compose**: SPEC-INFRA-001 complete
- **Environment Variables**:
  - `OZ_RELAYER_URL`: Nginx LB endpoint (default: `http://oz-relayer-lb:8080`)
  - `RELAY_API_KEY`: API Key for authentication

### Service Dependencies
- **oz-relayer-1, oz-relayer-2, oz-relayer-3**: Running and healthy
- **Redis**: Running for nonce management (future use)

---

## Non-Functional Requirements

### Performance
- **Request Distribution**: < 5ms overhead via Nginx
- **Health Check Response Time**: < 500ms
- **Transaction Submission**: < 30 seconds timeout

### Availability
- **Nginx LB Uptime**: >= 99.9%
- **Pool Availability**: >= 66% (2/3 relayers healthy minimum)

### Security
- **API Key Validation**: All endpoints except `/health`
- **TLS/HTTPS**: Not required in Phase 1 (internal network only)

### Maintainability
- **Configuration**: Nginx config is readable and well-commented
- **Logging**: Nginx access and error logs for debugging
- **Monitoring**: Health Check endpoint for external monitoring

---

## Traceability

### Task Master Integration
- **Task ID**: `5` (OZ Relayer Proxy Service and Multi-Relayer Pool Manager)
- **Dependencies**: Task `2` (Docker Compose), Task `4` (OZ Relayer configuration)

### Related SPECs
- **SPEC-INFRA-001**: Docker Compose infrastructure (completed)
- **SPEC-MODULE-001**: NestJS module scaffolding (completed)

### PRD Reference
- **Phase 1**: OZ Relayer Pool + Redis (no MySQL)
- **Direct Transaction API**: `/api/v1/relay/direct` endpoint

---

## Completion Checklist

- [ ] Nginx configuration file created (`docker/nginx/nginx.conf`)
- [ ] Docker Compose service `oz-relayer-lb` added
- [ ] OzRelayerService simplified to single LB endpoint
- [ ] DirectController and DirectService implemented
- [ ] DirectTxRequestDto and DirectTxResponseDto created
- [ ] OzRelayerHealthIndicator updated to check Nginx LB
- [ ] RelayModule updated with Direct components
- [ ] All EARS requirements validated:
  - [ ] U-PROXY-001 to U-PROXY-008: Ubiquitous requirements
  - [ ] E-PROXY-001 to E-PROXY-005: Event-driven requirements
  - [ ] S-PROXY-001 to S-PROXY-003: State-driven requirements
  - [ ] UW-PROXY-001 to UW-PROXY-004: Unwanted behavior controls
  - [ ] O-PROXY-001 to O-PROXY-002: Optional enhancements

---

## Version Information

- **SPEC Version**: 1.0.0
- **Created**: 2025-12-19
- **Last Updated**: 2025-12-19
- **Status**: draft
- **Priority**: high

---

## Change History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2025-12-19 | Initial SPEC creation: Nginx LB-based OZ Relayer Proxy and Direct Transaction API | manager-spec |

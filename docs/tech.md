# MSQ Relayer Service - 기술 문서

## 문서 정보
- **버전**: 12.2
- **최종 수정일**: 2025-12-15
- **상태**: Phase 1 구현 단계 (Direct + Gasless + Multi-Relayer Pool)

> **참고**: 이 문서는 기술 구현 상세(HOW)를 다룹니다.
> - 비즈니스 요구사항(WHAT/WHY): [product.md](./product.md)
> - 시스템 아키텍처(WHERE): [structure.md](./structure.md)

> **참고**: MSQ Relayer Service는 **B2B Infrastructure**입니다. 이 문서의 모든 API 사용법은 Client Services (결제 시스템, 에어드랍 시스템, NFT 서비스 등)가 Relayer API를 호출하는 패턴을 기준으로 작성되었습니다. API 문서는 Swagger UI (`/api/docs`)에서 확인할 수 있습니다.

### 관련 문서
- [제품 요구사항](./product.md) - WHAT/WHY
- [시스템 아키텍처](./structure.md) - WHERE
- [Task Master PRD](../.taskmaster/docs/prd.txt)

---

## 기술 스택 개요

Blockchain Transaction Relayer System의 기술 스택 및 구현 사양을 정의합니다.

**v3.0 핵심 변경**: OZ 오픈소스(Relayer v1.3.0, Monitor v1.1.0)를 핵심으로 활용하여 개발 기간 50% 단축

### 구현 범위

| Phase | 기술 범위 | 상태 |
|-------|----------|------|
| **Phase 1** | OZ Relayer, Redis, NestJS (Auth, Direct TX, Gasless TX, EIP-712 검증, Health, Status Polling), ERC2771Forwarder | 🔄 구현 중 |
| **Phase 2+** | TX History (MySQL), Webhook Handler, Queue System (Redis/SQS), OZ Monitor, Policy Engine | 📋 계획됨 |

---

## 1. Core Services 기술 스택 (OZ Open Source)

### 1.1 OZ Relayer v1.3.0

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Language | Rust | - | 고성능, 메모리 안전성 |
| Container | Docker | - | ghcr.io/openzeppelin/openzeppelin-relayer:v1.3.0 |
| License | AGPL-3.0 | - | 수정 시 소스 공개 필요 |
| Queue | Redis | 7.x | OZ Relayer 네이티브 지원 |
| Key Management | Local keystore / AWS KMS | - | Local: docker/keys/, Prod: AWS KMS |

**내장 기능**:
- 트랜잭션 중계 및 서명
- Nonce 자동 관리
- Gas 추정 및 조정
- 재시도 로직
- Webhook 알림

### 1.2 OZ Monitor v1.1.0 (Phase 2+)

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Language | Rust | - | 고성능, 메모리 안전성 |
| Container | Docker | - | ghcr.io/openzeppelin/openzeppelin-monitor:v1.1.0 |
| License | AGPL-3.0 | - | 수정 시 소스 공개 필요 |

**내장 기능**:
- 블록체인 이벤트 감지
- 잔액 모니터링
- Slack/Discord/Telegram/Webhook 알림
- 커스텀 트리거 스크립트 (Python/JS/Bash)

---

## 2. API Gateway 기술 스택 (Custom Development)

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Runtime | Node.js | 20 LTS | 광범위한 Web3 라이브러리 지원 |
| Framework | NestJS | 10.x | 모듈화, DI, 타입 안정성 |
| Language | TypeScript | 5.x | 타입 안전성, 개발자 경험 |
| Blockchain | ethers.js | 6.x | EIP-712 서명 검증용 |
| ORM | Prisma (Phase 2+) | 5.x | Type-safe DB 접근 |
| Validation | class-validator | 0.14.x | DTO 검증 |
| Documentation | Swagger/OpenAPI | 3.x | API 문서화 |

---

## 3. Smart Contracts 기술 스택

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Library | OpenZeppelin Contracts | 5.3.0 | 검증된 보안, 커뮤니티 표준 |
| Framework | Hardhat | 2.x | 개발/테스트/배포 통합 |
| Language | Solidity | 0.8.20 | OZ v5 호환 |
| Testing | Hardhat Toolbox | 4.x | 테스트 유틸리티 |

### 3.1 OpenZeppelin 컨트랙트 활용

**커스텀 컨트랙트 최소화, OpenZeppelin 검증된 코드 최대 활용**

| 구분 | 사용할 컨트랙트 | 출처 |
|------|----------------|------|
| **Forwarder** | `ERC2771Forwarder` | @openzeppelin/contracts v5.3.0 |
| **Target Context** | `ERC2771Context` | @openzeppelin/contracts v5.3.0 |
| **보안 제어** | Policy Engine | NestJS API Gateway (커스텀) |

### 3.2 ERC2771Forwarder 기능

OZ ERC2771Forwarder는 다음 기능을 제공합니다 (100% OZ 코드 그대로 사용):

- EIP-712 서명 검증
- Nonce 관리 (Nonces.sol)
- Deadline 검증
- `execute()` - 단건 실행
- `executeBatch()` - 다건 실행
- `verify()` - 서명 검증
- `nonces(address)` - nonce 조회

### 3.3 ForwardRequest 구조체

```solidity
struct ForwardRequestData {
    address from;      // 원본 사용자 주소
    address to;        // 대상 컨트랙트 주소
    uint256 value;     // ETH 전송량
    uint256 gas;       // 가스 한도
    uint256 nonce;     // 사용자 nonce
    uint48 deadline;   // 유효 기간
    bytes data;        // 함수 호출 데이터
    bytes signature;   // EIP-712 서명
}
```

---

## 4. Infrastructure 기술 스택

| Category | Local | Production |
|----------|-------|------------|
| Container | Docker Compose | AWS EKS |
| Container Runtime | Docker | containerd |
| Orchestration | - | Kubernetes |
| Database | MySQL Container (Phase 2+) | AWS RDS MySQL (Multi-AZ) |
| Cache/Queue | Redis Container | AWS ElastiCache Cluster |
| Secrets | .env / K8s Secret | AWS Secrets Manager |
| Load Balancer | - | AWS ALB / Nginx Ingress |
| Monitoring | Prometheus + Grafana | Prometheus + Grafana |
| Logging | Console | CloudWatch / Loki |

---

## 5. API 사양

> **API 응답 형식 표준**: 모든 성공 응답은 아래 표준 형식을 따릅니다. 에러 응답 형식은 Section 5.6을 참조하세요.
>
> ```json
> {
>   "success": true,
>   "data": { /* 엔드포인트별 응답 데이터 */ },
>   "timestamp": "2025-12-15T00:00:00.000Z"
> }
> ```

### 5.1 Direct Transaction API

```yaml
POST /api/v1/relay/direct
Content-Type: application/json
X-API-Key: {api_key}

Request:
{
  "to": "0x...",           # 대상 컨트랙트 주소
  "data": "0x...",         # Encoded function call
  "value": "0",            # ETH 전송량 (wei)
  "gasLimit": "200000",    # Optional: 가스 한도
  "speed": "average",      # Optional: safeLow|average|fast|fastest
  "metadata": {            # Optional: 추적용 메타데이터
    "jobId": "airdrop-001",
    "batchIndex": 1
  }
}

Response (202 Accepted):
{
  "success": true,
  "data": {
    "txId": "tx_abc123def456",       # 내부 트랜잭션 ID
    "status": "pending",             # pending|submitted|confirmed|failed
    "relayerId": "oz-relayer-1",     # 할당된 Relayer ID
    "createdAt": "2025-12-15T00:00:00.000Z"
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

### 5.2 Gasless Transaction API (Phase 1)

```yaml
POST /api/v1/relay/gasless
Content-Type: application/json
X-API-Key: {api_key}

Request:
{
  "request": {
    "from": "0x...",       # 사용자 주소
    "to": "0x...",         # 대상 컨트랙트 주소
    "value": "0",          # ETH 전송량 (보통 "0")
    "gas": "200000",       # 가스 한도
    "nonce": "5",          # Forwarder 기준 사용자 nonce
    "deadline": 1702400000,# 유효 기간 (Unix timestamp)
    "data": "0x..."        # Encoded function call
  },
  "signature": "0x...",    # EIP-712 서명
  "metadata": {
    "sponsorId": "default-sponsor",
    "clientId": "web-app"
  }
}

Response (202 Accepted):
{
  "success": true,
  "data": {
    "txId": "tx_xyz789ghi012",                              # 내부 트랜잭션 ID
    "status": "pending",                                    # pending|submitted|confirmed|failed
    "forwarder": "0xERC2771ForwarderAddress...",            # Forwarder 컨트랙트 주소
    "originalSender": "0xUserAddress...",                   # 원본 사용자 주소
    "relayerId": "oz-relayer-2"                             # 할당된 Relayer ID
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

### 5.3 Nonce 조회 API

```yaml
GET /api/v1/relay/nonce/{userAddress}?network=polygon

Response (200 OK):
{
  "success": true,
  "data": {
    "address": "0x...",             # 사용자 주소
    "nonce": "5",                   # 현재 Forwarder nonce
    "network": "polygon",           # 네트워크 이름
    "forwarder": "0x..."            # Forwarder 컨트랙트 주소
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

### 5.4 Status 조회 API

```yaml
GET /api/v1/relay/status/{txId}

Response (200 OK):
{
  "success": true,
  "data": {
    "txId": "tx_abc123def456",        # 내부 트랜잭션 ID
    "status": "confirmed",            # pending|submitted|confirmed|failed
    "txHash": "0x...",                # 블록체인 트랜잭션 해시
    "blockNumber": 12345678,          # 확인된 블록 번호
    "gasUsed": "21000",               # 사용된 가스
    "effectiveGasPrice": "30000000000", # 실제 가스 가격
    "confirmedAt": "2025-12-15T00:01:00.000Z"  # 확인 시간
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

### 5.5 Health Check API

```yaml
GET /api/v1/health

Response (Phase 1):
{
  "status": "healthy",
  "timestamp": "2025-12-15T00:00:00.000Z",
  "services": {
    "api-gateway": "healthy",
    "oz-relayer-pool": "healthy",   # 3개 Relayer의 집계 상태
    "redis": "healthy"
  }
}

# oz-relayer-pool 상태 판정:
# - "healthy": 모든 Relayer가 healthy
# - "degraded": 일부 Relayer가 unhealthy (최소 1개 healthy)
# - "unhealthy": 모든 Relayer가 unhealthy
```

#### Relayer Pool Status Aggregation (NestJS 구현)

```typescript
// packages/api-gateway/src/health/health.service.ts

import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout, catchError } from 'rxjs';

interface RelayerHealth {
  id: string;
  url: string;
  status: 'healthy' | 'unhealthy';
  responseTime?: number;
  error?: string;
}

interface PoolHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  healthyCount: number;
  totalCount: number;
  relayers: RelayerHealth[];
}

@Injectable()
export class HealthService {
  private readonly relayerEndpoints = [
    { id: 'oz-relayer-1', url: 'http://oz-relayer-1:8080/api/v1/health' },
    { id: 'oz-relayer-2', url: 'http://oz-relayer-2:8080/api/v1/health' },
    { id: 'oz-relayer-3', url: 'http://oz-relayer-3:8080/api/v1/health' },
  ];

  constructor(private readonly httpService: HttpService) {}

  async checkRelayerPoolHealth(): Promise<PoolHealthStatus> {
    const results = await Promise.all(
      this.relayerEndpoints.map(endpoint => this.checkSingleRelayer(endpoint))
    );

    const healthyCount = results.filter(r => r.status === 'healthy').length;
    const totalCount = results.length;

    return {
      status: this.aggregateStatus(healthyCount, totalCount),
      healthyCount,
      totalCount,
      relayers: results,
    };
  }

  private async checkSingleRelayer(
    endpoint: { id: string; url: string }
  ): Promise<RelayerHealth> {
    const startTime = Date.now();

    try {
      await firstValueFrom(
        this.httpService.get(endpoint.url).pipe(
          timeout(5000), // 5초 타임아웃
          catchError(err => { throw err; })
        )
      );

      return {
        id: endpoint.id,
        url: endpoint.url,
        status: 'healthy',
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        id: endpoint.id,
        url: endpoint.url,
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  private aggregateStatus(
    healthyCount: number,
    totalCount: number
  ): 'healthy' | 'degraded' | 'unhealthy' {
    if (healthyCount === totalCount) return 'healthy';
    if (healthyCount > 0) return 'degraded';
    return 'unhealthy';
  }
}
```

#### Detailed Health Response Example

```json
// GET /api/v1/health - Detailed Response (degraded 상태 예시)
{
  "success": true,
  "data": {
    "status": "degraded",
    "timestamp": "2025-12-15T00:00:00.000Z",
    "services": {
      "api-gateway": "healthy",
      "oz-relayer-pool": {
        "status": "degraded",
        "healthyCount": 2,
        "totalCount": 3,
        "relayers": [
          { "id": "oz-relayer-1", "status": "healthy", "responseTime": 45 },
          { "id": "oz-relayer-2", "status": "healthy", "responseTime": 52 },
          { "id": "oz-relayer-3", "status": "unhealthy", "error": "Connection refused" }
        ]
      },
      "redis": "healthy"
    }
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

**Phase 2+ 확장 Health Check**:

```yaml
GET /api/v1/health

Response (Phase 2+):
{
  "status": "healthy",
  "timestamp": "2025-12-15T00:00:00.000Z",
  "services": {
    "api-gateway": "healthy",
    "oz-relayer-pool": "healthy",
    "oz-monitor": "healthy",        # Phase 2+
    "redis": "healthy",
    "mysql": "healthy"              # Phase 2+
  }
}
```

### 5.6 Error Response Format

모든 API 엔드포인트는 표준화된 에러 응답 형식을 사용합니다.

**Standard Error Response**:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

**HTTP Status Code Mapping**:

| Status | Code | Description |
|--------|------|-------------|
| 400 | `BAD_REQUEST` | Invalid request parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | API key valid but action not permitted |
| 404 | `NOT_FOUND` | Resource not found (tx, nonce) |
| 422 | `VALIDATION_ERROR` | Request validation failed |
| 429 | `RATE_LIMITED` | Too many requests (Phase 2+) |
| 500 | `INTERNAL_ERROR` | Server error |
| 502 | `RELAYER_ERROR` | OZ Relayer communication error |
| 503 | `SERVICE_UNAVAILABLE` | Service temporarily unavailable |

**Error Response Examples**:

```json
// 400 Bad Request - Invalid Parameters
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request body",
    "details": {
      "field": "to",
      "reason": "Invalid Ethereum address format"
    }
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}

// 401 Unauthorized - Missing API Key
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid API key",
    "details": {}
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}

// 404 Not Found - Transaction Not Found
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Transaction not found",
    "details": {
      "txId": "tx_abc123def456"
    }
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}

// 502 Relayer Error - OZ Relayer Communication Failed
{
  "success": false,
  "error": {
    "code": "RELAYER_ERROR",
    "message": "Failed to communicate with OZ Relayer",
    "details": {
      "relayerId": "oz-relayer-1",
      "reason": "Connection timeout"
    }
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

### 5.7 Rate Limiting (Phase 2+ Reserved)

> **참고**: Phase 1에서는 Rate Limiting을 적용하지 않습니다. 아래 사양은 Phase 2+ 구현을 위해 예약되어 있습니다.

**Rate Limit Response Headers**:

```
X-RateLimit-Limit: 1000        # Requests per window
X-RateLimit-Remaining: 999     # Remaining requests
X-RateLimit-Reset: 1702656000  # Unix timestamp of reset
X-RateLimit-Window: 3600       # Window size in seconds
```

**Rate Limit Exceeded Response (429)**:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": {
      "limit": 1000,
      "window": 3600,
      "retryAfter": 1702656000
    }
  },
  "timestamp": "2025-12-15T00:00:00.000Z"
}
```

**Phase 1 참고**: Rate limiting이 비활성화되어 있어도 헤더가 플레이스홀더 값으로 포함될 수 있습니다.

### 5.8 Request/Response Examples (JSON Format)

각 API 엔드포인트의 상세 요청/응답 예시입니다.

#### 5.8.1 Direct TX (POST /api/v1/relay/direct)

**Request**:

```json
{
  "to": "0x1234567890123456789012345678901234567890",
  "data": "0xa9059cbb0000000000000000000000001234567890123456789012345678901234567890000000000000000000000000000000000000000000000000016345785d8a0000",
  "value": "0",
  "gasLimit": "100000",
  "chainId": 80002
}
```

**Success Response (202 Accepted)**:

```json
{
  "success": true,
  "data": {
    "txId": "tx_abc123def456",
    "status": "pending",
    "relayerId": "oz-relayer-1",
    "createdAt": "2025-12-15T00:00:00.000Z"
  }
}
```

#### 5.8.2 Gasless TX (POST /api/v1/relay/gasless)

**Request (EIP-712 Meta Transaction)**:

```json
{
  "request": {
    "from": "0xUserAddress1234567890123456789012345678901234",
    "to": "0xContractAddress12345678901234567890123456",
    "value": "0",
    "gas": "100000",
    "nonce": "0",
    "deadline": 1702656000,
    "data": "0xa9059cbb0000000000000000000000001234567890123456789012345678901234567890000000000000000000000000000000000000000000000000016345785d8a0000"
  },
  "signature": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12",
  "chainId": 80002
}
```

**Success Response (202 Accepted)**:

```json
{
  "success": true,
  "data": {
    "txId": "tx_xyz789ghi012",
    "status": "pending",
    "forwarder": "0xERC2771ForwarderAddress1234567890123456",
    "originalSender": "0xUserAddress1234567890123456789012345678901234",
    "relayerId": "oz-relayer-2"
  }
}
```

#### 5.8.3 Status Query (GET /api/v1/relay/status/{txId})

**Success Response (Transaction Confirmed)**:

```json
{
  "success": true,
  "data": {
    "txId": "tx_abc123def456",
    "status": "confirmed",
    "txHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
    "blockNumber": 12345678,
    "gasUsed": "21000",
    "effectiveGasPrice": "30000000000",
    "confirmedAt": "2025-12-15T00:01:00.000Z"
  }
}
```

**Status Values**:

| Status | Description |
|--------|-------------|
| `pending` | Transaction received, waiting for submission |
| `submitted` | Transaction submitted to blockchain |
| `confirmed` | Transaction confirmed on blockchain |
| `failed` | Transaction failed |

### 5.9 Pagination (Phase 2+ Reserved)

> **참고**: Phase 1 Status API는 단일 항목을 반환합니다. Pagination은 Phase 2+ TX History API를 위해 예약되어 있습니다.

**Pagination Query Parameters**:

```
GET /api/v1/relay/history?page=1&limit=20&sort=createdAt&order=desc
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (1-indexed) |
| `limit` | number | 20 | Items per page (max: 100) |
| `sort` | string | createdAt | Sort field |
| `order` | string | desc | Sort order (asc/desc) |

**Paginated Response Format**:

```json
{
  "success": true,
  "data": [
    {
      "txId": "tx_abc123",
      "status": "confirmed",
      "txHash": "0x...",
      "createdAt": "2025-12-15T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

## 6. EIP-712 TypedData 구조

```typescript
// OZ ERC2771Forwarder의 EIP-712 Domain 및 Types
const EIP712_DOMAIN = {
  name: "Relayer-Forwarder-polygon",  // Forwarder 배포 시 설정한 이름
  version: "1",
  chainId: 137,
  verifyingContract: "0x..."     // Forwarder 주소
};

const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" }
  ]
};
```

---

## 7. Policy Configuration (Phase 2+)

### 7.1 정책 설정 파일 구조 (NestJS API Gateway)

```yaml
# config/policies.yaml
policies:
  - id: "default-policy"
    name: "Default Gasless Policy"
    enabled: true

    # 허용 컨트랙트/메서드 (NestJS Policy Engine에서 검증)
    targets:
      contracts:
        - address: "0x...ERC20_TOKEN"
          methods: ["transfer", "approve", "transferFrom"]
        - address: "0x...ANOTHER_ERC20"
          methods: ["transfer", "approve"]
        - address: "0x...ERC721_NFT"
          methods: ["mint", "safeTransferFrom"]

    # 사용자 제한 (NestJS에서 검증)
    users:
      whitelist: []        # 비어있으면 모두 허용
      blacklist:
        - "0x...blocked_address"

    # 가스 제한 (NestJS에서 검증)
    gas:
      maxGasLimit: "500000"
      maxPriorityFeePerGas: "50000000000"  # 50 gwei
      maxFeePerGas: "200000000000"         # 200 gwei

    # 네트워크
    networks: ["polygon", "amoy"]
```

---

## 8. 스마트 컨트랙트 vs 백엔드 vs OZ 역할 분담

| 보안 기능 | OZ Forwarder (온체인) | NestJS API Gateway | OZ Relayer |
|----------|----------------------|-------------------|------------|
| EIP-712 서명 검증 | 최종 검증 | 사전 검증 | - |
| Nonce 관리 | 온체인 관리 (User) | 조회만 | 내장 (Relayer) |
| Deadline 검증 | 온체인 검증 | 사전 검증 | - |
| **Contract Whitelist** | - | Policy Engine | - |
| **Method Whitelist** | - | Policy Engine | - |
| **User Blacklist** | - | Policy Engine | - |
| **Gas Limit Cap** | - | Policy Engine | - |
| **Gas 추정** | - | - | 내장 |
| **TX 서명/제출** | - | - | 내장 |
| **재시도 로직** | - | - | 내장 |

---

## 9. 보안 요구사항

| 항목 | 요구사항 | 구현 위치 |
|------|----------|----------|
| Private Key 관리 | Local keystore / AWS KMS | OZ Relayer signer config |
| API 인증 | API Key | NestJS API Gateway |
| 네트워크 보안 | VPC Private Subnet, Security Group | Infrastructure |
| Contract Whitelist | 허용된 컨트랙트만 호출 | NestJS Policy Engine |
| Method Whitelist | 허용된 메서드만 호출 | NestJS Policy Engine |
| User Blacklist | 차단된 사용자 거부 | NestJS Policy Engine |
| EIP-712 검증 | Signature 사전 검증 | NestJS + OZ Forwarder |
| Nonce 검증 | Replay Attack 방지 | OZ Forwarder (온체인) |
| Deadline 검증 | 만료 요청 거부 | NestJS + OZ Forwarder |
| Webhook 보안 | WEBHOOK_SIGNING_KEY (Phase 2+) | OZ Relayer |

### 9.1 API Key 인증 (Phase 1)

**인증 방식**:
- 단일 환경변수 `API_GATEWAY_API_KEY`로 API Key 관리
- Header: `X-API-Key: {api_key}`
- 환경변수 값과 일치 여부로 검증

```
Client Service → [X-API-Key 헤더] → API Gateway → [환경변수 비교] → 통과/거부
```

**Docker Compose 환경변수**:
```yaml
api-gateway:
  environment:
    API_GATEWAY_API_KEY: "msq-dev-api-key-12345"  # 개발용
```

**NestJS 모듈 구조**:
```
packages/api-gateway/src/auth/
├── auth.module.ts              # Global Guard 등록
├── guards/
│   └── api-key.guard.ts        # X-API-Key 검증
└── decorators/
    └── public.decorator.ts     # @Public() (Health Check 등 예외)
```

**Phase 2+ 확장 계획**:
- 다중 Client Service 지원
- API Key 관리 시스템 (생성/취소/로테이션)
- DB 기반 저장
- Client별 권한 관리 (permissions)

---

## 10. 패키지 의존성

### 10.1 API Gateway (NestJS)

```json
{
  "name": "@msq/api-gateway",
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/swagger": "^7.0.0",
    "ethers": "^6.0.0",
    "@prisma/client": "^5.0.0",
    "class-validator": "^0.14.0",
    "class-transformer": "^0.5.0",
    "ioredis": "^5.0.0"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.0.0",
    "jest": "^29.0.0",
    "typescript": "^5.0.0",
    "prisma": "^5.0.0"
  }
}
```

### 10.2 Smart Contracts

```json
{
  "name": "@msq/relayer-contracts",
  "dependencies": {
    "@openzeppelin/contracts": "^5.3.0"
  },
  "devDependencies": {
    "@nomicfoundation/hardhat-toolbox": "^4.0.0",
    "hardhat": "^2.19.0",
    "typescript": "^5.0.0"
  }
}
```

---

## 11. OZ Relayer 설정

### 11.1 config.json 예시

```json
{
  "relayers": [{
    "id": "polygon-mainnet-relayer",
    "name": "Polygon Mainnet Relayer",
    "network": "polygon",
    "signer": {
      "type": "local",
      "keystore": "/app/config/keys/local-signer.json"
    },
    "rpc": {
      "url": "${POLYGON_RPC_URL}",
      "timeout": 30000
    },
    "policies": {
      "gas_price_cap": "500000000000",
      "min_balance": "100000000000000000",
      "max_pending_txs": 10
    },
    "notifications": [{
      "type": "webhook",
      "url": "http://api-gateway:3000/api/v1/webhook/relayer",
      "signing_key": "${WEBHOOK_SIGNING_KEY}"
    }]
  }]
}
```

### 11.2 네트워크 설정

| Network | Chain ID | RPC URL 환경변수 |
|---------|----------|------------------|
| Polygon Mainnet | 137 | `POLYGON_RPC_URL` |
| Polygon Amoy | 80002 | `AMOY_RPC_URL` |
| Ethereum Mainnet | 1 | `ETHEREUM_RPC_URL` |
| Ethereum Sepolia | 11155111 | `SEPOLIA_RPC_URL` |

### 11.3 Multi-Relayer Pool 설정

**Relayer Pool 방식**: 각 Relayer가 독립적인 Private Key를 보유하여 Nonce 충돌 없이 병렬 처리

#### Pool 구성 예시

```
docker/config/oz-relayer/
├── relayer-1.json       # Relayer #1 설정 (Hardhat Account #10)
├── relayer-2.json       # Relayer #2 설정 (Hardhat Account #11)
└── relayer-3.json       # Relayer #3 설정 (Hardhat Account #12)
```

> **참고**: OZ Relayer는 단일 config.json 파일을 기대합니다. Docker 볼륨 마운트로 각 flat 파일을 `/app/config/config.json`으로 매핑합니다.
> 예: `./config/oz-relayer/relayer-1.json:/app/config/config.json:ro`

#### 개별 Relayer config.json 예시

```json
{
  "relayers": [{
    "id": "polygon-relayer-1",
    "name": "Polygon Mainnet Relayer #1",
    "network": "polygon",
    "signer": {
      "type": "local",
      "keystore": "/app/config/keys/relayer-1.json"
    },
    "rpc": {
      "url": "${POLYGON_RPC_URL}",
      "timeout": 30000
    },
    "policies": {
      "gas_price_cap": "500000000000",
      "min_balance": "100000000000000000",
      "max_pending_txs": 10
    },
    "notifications": [{
      "type": "webhook",
      "url": "http://api-gateway:3000/api/v1/webhook/relayer",
      "signing_key": "${WEBHOOK_SIGNING_KEY}"
    }]
  }]
}
```

#### API Gateway Relayer Pool 설정

```yaml
# config/relayer-pool.yaml (NestJS에서 로드)
relayer_pool:
  strategy: "round_robin"  # round_robin | least_load
  health_check:
    interval_ms: 10000
    timeout_ms: 5000
    unhealthy_threshold: 3
  relayers:
    - id: "relayer-1"
      url: "http://oz-relayer-1:8080"
      api_key: "${OZ_RELAYER_1_API_KEY}"
      priority: 1
    - id: "relayer-2"
      url: "http://oz-relayer-2:8080"
      api_key: "${OZ_RELAYER_2_API_KEY}"
      priority: 1
    - id: "relayer-n"
      url: "http://oz-relayer-n:8080"
      api_key: "${OZ_RELAYER_N_API_KEY}"
      priority: 2  # Standby (우선순위 낮음)
```

#### Load Balancing 전략

| 전략 | 설명 | 사용 시기 |
|------|------|----------|
| **Round Robin** | 순차적으로 Relayer 선택 | 균등 부하 분산 필요시 |
| **Least Load** | 대기 TX 가장 적은 Relayer 선택 | 응답 시간 최적화 필요시 |

#### Scaling 정책

| Phase | 방식 | 설명 |
|-------|------|------|
| **Phase 1** | Manual | Docker Compose에 Relayer 서비스 추가/제거 |
| **Phase 2+** | Auto | Kubernetes HPA 또는 Queue Depth 기반 자동 스케일링 |

---

## 12. OZ Monitor 설정 (Phase 2+)

### 12.1 네트워크 설정 예시

```json
// config/oz-monitor/networks/polygon.json
{
  "id": "polygon-mainnet",
  "rpc_url": "${POLYGON_RPC_URL}",
  "chain_id": 137,
  "block_time": 2
}
```

### 12.2 모니터 설정 예시

```json
// config/oz-monitor/monitors/relayer-balance.json
{
  "name": "Relayer Balance Monitor",
  "network": "polygon-mainnet",
  "addresses": ["${RELAYER_ADDRESS}"],
  "conditions": [{
    "type": "balance_threshold",
    "threshold": "100000000000000000",
    "comparison": "lt"
  }],
  "triggers": ["slack-alert", "discord-alert"]
}
```

### 12.3 트리거 설정 예시

```json
// config/oz-monitor/triggers/slack.json
{
  "id": "slack-alert",
  "type": "slack",
  "webhook_url": "${SLACK_WEBHOOK_URL}",
  "template": "Relayer balance low: {{balance}} wei"
}
```

---

## 13. Docker Compose 설정 (v5.0 - SPEC-INFRA-001)

> **Docker Build 전략**: 멀티스테이지 빌드 방식 (docker/ 디렉토리 통합)
> - 위치: `docker/docker-compose.yaml` (로컬 개발, Hardhat Node 포함)
> - 위치: `docker/docker-compose-amoy.yaml` (Polygon Amoy Testnet)
> - Dockerfile: `docker/Dockerfile.packages` (멀티스테이지 빌드, target으로 패키지 선택)
> - 환경 변수: docker-compose.yaml에 직접 명시 (.env 파일 사용 안 함)

**파일 위치**:
```
docker/
├── docker-compose.yaml          # 메인 설정 (Hardhat Node 포함)
├── docker-compose-amoy.yaml     # Polygon Amoy Testnet 설정
├── Dockerfile.packages          # 멀티스테이지 빌드
├── config/
│   └── oz-relayer/
│       ├── relayer-1.json       # Relayer #1 설정 (flat 파일)
│       ├── relayer-2.json       # Relayer #2 설정
│       └── relayer-3.json       # Relayer #3 설정
├── keys-example/                # 샘플 키스토어 (Git 포함)
│   ├── relayer-1/keystore.json  # Hardhat Account #10
│   ├── relayer-2/keystore.json  # Hardhat Account #11
│   └── relayer-3/keystore.json  # Hardhat Account #12
└── keys/                        # 실제 키스토어 (.gitignore)
```

**실행 명령**:
```bash
# 로컬 개발 (Hardhat Node)
docker compose -f docker/docker-compose.yaml up -d

# Polygon Amoy 테스트넷
docker compose -f docker/docker-compose-amoy.yaml up -d
```

```yaml
# docker/docker-compose.yaml (Hardhat Node 로컬 개발)
version: '3.8'

# === Top-level anchors (services 외부에 정의) ===
# 참고: YAML Anchors는 반드시 services: 블록 외부 최상위 레벨에 정의해야 합니다.
# deploy.replicas 대신 개별 서비스를 정의합니다.
# 이유: 각 Relayer는 고유 Private Key가 필요 (Nonce 충돌 방지)
# YAML Anchors로 공통 설정을 재사용하여 중복을 최소화합니다.

x-relayer-common: &relayer-common
  image: ghcr.io/openzeppelin/openzeppelin-relayer:v1.3.0
  environment: &relayer-env
    RUST_LOG: info
    KEYSTORE_PASSPHRASE: ${KEYSTORE_PASSPHRASE:-hardhat-test-passphrase}
    RPC_URL: http://hardhat-node:8545
    REDIS_HOST: redis
    REDIS_PORT: 6379
  depends_on:
    redis:
      condition: service_healthy
    hardhat-node:
      condition: service_healthy
  restart: unless-stopped
  networks:
    - msq-relayer-network

# === Services block (anchors 정의 후) ===
services:
  # === 로컬 블록체인 (Phase 1 필수) ===
  hardhat-node:
    build:
      context: ..
      dockerfile: docker/Dockerfile.packages
      target: hardhat-node
    ports: ["8545:8545"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8545"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - msq-relayer-network

  redis:
    image: redis:8.0-alpine
    ports: ["6379:6379"]
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    volumes:
      - msq-relayer-redis-data:/data
    networks:
      - msq-relayer-network

  # === API Gateway ===
  api-gateway:
    build:
      context: ..
      dockerfile: docker/Dockerfile.packages
      target: api-gateway
    ports: ["3000:3000"]
    depends_on:
      hardhat-node:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      NODE_ENV: development
      RELAYER_POOL_CONFIG: /app/config/relayer-pool.yaml
      REDIS_URL: redis://redis:6379
      RPC_URL: http://hardhat-node:8545
    volumes:
      - ../packages/api-gateway/config:/app/config
    networks:
      - msq-relayer-network

  oz-relayer-1:
    <<: *relayer-common
    container_name: oz-relayer-1
    ports:
      - "8081:8080"
      - "8091:8081"
    volumes:
      - ./config/oz-relayer/relayer-1.json:/app/config/config.json:ro
      - ./keys/relayer-1:/app/config/keys:ro
    environment:
      <<: *relayer-env
      API_KEY: ${RELAYER_1_API_KEY:-test-api-key-relayer-1}

  oz-relayer-2:
    <<: *relayer-common
    container_name: oz-relayer-2
    ports:
      - "8082:8080"
      - "8092:8081"
    volumes:
      - ./config/oz-relayer/relayer-2.json:/app/config/config.json:ro
      - ./keys/relayer-2:/app/config/keys:ro
    environment:
      <<: *relayer-env
      API_KEY: ${RELAYER_2_API_KEY:-test-api-key-relayer-2}

  oz-relayer-3:
    <<: *relayer-common
    container_name: oz-relayer-3
    ports:
      - "8083:8080"
      - "8093:8081"
    volumes:
      - ./config/oz-relayer/relayer-3.json:/app/config/config.json:ro
      - ./keys/relayer-3:/app/config/keys:ro
    environment:
      <<: *relayer-env
      API_KEY: ${RELAYER_3_API_KEY:-test-api-key-relayer-3}

  # === Phase 2+: OZ Monitor ===
  # oz-monitor:
  #   image: ghcr.io/openzeppelin/openzeppelin-monitor:v1.1.0
  #   profiles: ["phase2"]

  # Phase 2+: Prometheus/Grafana
  # prometheus:
  #   image: prom/prometheus:v2.47.0
  #   profiles: ["phase2"]
  # grafana:
  #   image: grafana/grafana:10.2.0
  #   profiles: ["phase2"]

networks:
  msq-relayer-network:
    driver: bridge

volumes:
  msq-relayer-redis-data:
```

**환경 변수 전략**:
- ❌ ~~.env 파일 사용~~ (SPEC-INFRA-001에서 제거)
- ✅ docker-compose.yaml에 환경 변수 직접 명시
- ✅ 네트워크별 설정 파일 분리 (docker-compose.yaml, docker-compose-amoy.yaml)

---

## 14. Hardhat 설정

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    localhost: {
      chainId: 31337
    },
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : []
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      chainId: 137,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : []
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      chainId: 11155111,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : []
    },
    mainnet: {
      url: process.env.ETHEREUM_RPC_URL || "https://eth.llamarpc.com",
      chainId: 1,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : []
    }
  }
};

export default config;
```

---

## 15. Queue System (Phase 2+)

> **QUEUE_PROVIDER 패턴**: 환경에 따라 Redis+BullMQ 또는 AWS SQS를 선택적으로 사용할 수 있습니다.

### 15.1 Queue 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    NestJS API Gateway                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   Queue Adapter                        │  │
│  │  ┌─────────────────┐    ┌─────────────────────────┐   │  │
│  │  │ QUEUE_PROVIDER  │────│ Redis+BullMQ (default)  │   │  │
│  │  │ 환경변수         │    │ AWS SQS (production)    │   │  │
│  │  └─────────────────┘    └─────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 15.2 Provider 비교

| 항목 | Redis + BullMQ | AWS SQS |
|------|----------------|---------|
| 사용 환경 | 로컬/개발/테스트 | 프로덕션 |
| 설정 복잡도 | 낮음 | 중간 |
| 비용 | 인프라 비용만 | 요청당 과금 |
| 확장성 | 수평 확장 필요 | 자동 확장 |
| 메시지 보존 | 휘발성 (설정 가능) | 4일 기본 보존 |
| 지연 시간 | 매우 낮음 | 낮음 |

### 15.3 환경 설정

```bash
# .env 파일
# Redis (default)
QUEUE_PROVIDER=redis
REDIS_URL=redis://localhost:6379

# AWS SQS (production)
QUEUE_PROVIDER=sqs
AWS_REGION=ap-northeast-2
AWS_SQS_QUEUE_URL=https://sqs.ap-northeast-2.amazonaws.com/123456789012/relayer-queue
```

### 15.4 Queue Adapter 인터페이스

```typescript
// packages/api-gateway/src/queue/queue-adapter.interface.ts
interface QueueAdapter {
  enqueue(job: RelayJob): Promise<string>;  // returns jobId
  getJob(jobId: string): Promise<JobStatus>;
  cancelJob(jobId: string): Promise<boolean>;
}

interface RelayJob {
  type: 'direct' | 'gasless';
  payload: DirectTxRequest | GaslessTxRequest;
  priority?: 'high' | 'normal' | 'low';
  metadata?: Record<string, string>;
}

interface JobStatus {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  txHash?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### 15.5 API 변경 사항 (Queue 모드)

Queue 시스템 활성화 시 API 응답이 변경됩니다:

```yaml
# Queue 비활성화 (Phase 1 - 즉시 처리)
POST /api/v1/relay/direct
Response (200 OK):
{
  "txId": "uuid",
  "txHash": "0x...",
  "status": "submitted"
}

# Queue 활성화 (Phase 2+ - 비동기 처리)
POST /api/v1/relay/direct
Response (202 Accepted):
{
  "jobId": "uuid",
  "status": "queued",
  "estimatedWait": "5s"
}

# Job 상태 조회
GET /api/v1/relay/job/{jobId}
Response:
{
  "jobId": "uuid",
  "status": "completed",
  "txHash": "0x...",
  "txId": "uuid"
}
```

### 15.6 Redis + BullMQ 설정

```typescript
// packages/api-gateway/src/queue/redis-queue.adapter.ts
import { Queue, Worker } from 'bullmq';

const relayQueue = new Queue('relay-jobs', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379')
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  }
});
```

### 15.7 AWS SQS 설정

```typescript
// packages/api-gateway/src/queue/sqs-queue.adapter.ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'ap-northeast-2'
});

const queueUrl = process.env.AWS_SQS_QUEUE_URL;
```

---

## 16. 라이선스 고려사항

### 16.1 OZ Relayer / OZ Monitor: AGPL-3.0

| 사용 시나리오 | 의무사항 |
|--------------|----------|
| 내부 사용 | 제한 없음 |
| 수정 없이 사용 | 제한 없음 |
| 수정 후 서비스 제공 | 변경 사항 소스 공개 필요 |
| SaaS 형태 제공 | 네트워크를 통한 서비스 제공 시 소스 공개 의무 |

### 16.2 OZ Contracts: MIT

- 상업적 사용 가능
- 수정 및 배포 자유
- 소스 공개 의무 없음

---

## 관련 문서 참조

| 문서 | 설명 | 경로 |
|------|------|------|
| 제품 요구사항 | 비즈니스 요구사항, 마일스톤, 성공 지표 | `./product.md` |
| 시스템 구조 | 아키텍처, 디렉토리 구조, 데이터 흐름 | `./structure.md` |
| Task Master PRD | 태스크 관리용 PRD | `.taskmaster/docs/prd.txt` |

---

## HISTORY

| 버전 | 날짜 | 변경사항 |
|------|------|----------|
| 12.2 | 2025-12-15 | Section 5.5 Health Check API 확장 - Relayer Pool Status Aggregation NestJS 구현 예시 추가 (HealthService, checkRelayerPoolHealth, aggregateStatus), Detailed Health Response JSON 예시 추가 (degraded 상태 포함) |
| 12.1 | 2025-12-15 | API 응답 형식 표준화 - Section 5.1-5.4 응답을 Section 5.8 표준 형식으로 통일 (success/data/timestamp 래퍼 적용), Section 5 시작부에 표준 응답 형식 안내 추가 |
| 12.0 | 2025-12-15 | 문서 버전 동기화 - 전체 문서 구조 정리 완료, 중복 제거, 교차 참조 체계 수립 |
| 11.7 | 2025-12-15 | 문서 역할 명확화 - 헤더에 문서 역할(HOW) 및 cross-references 추가 |
| 11.6 | 2025-12-15 | Section 5 API 사양 확장 - 5.6 Error Response Format (표준 에러 응답, HTTP Status Code Mapping, 에러 예시), 5.7 Rate Limiting (Phase 2+ Reserved, 헤더 사양), 5.8 Request/Response Examples (Direct TX, Gasless TX, Status Query JSON 예시), 5.9 Pagination (Phase 2+ Reserved, Query Parameters, 페이징 응답 형식) 추가 |
| 11.5 | 2025-12-15 | Section 13 Docker Compose YAML Anchors 구조 수정 - x-relayer-common을 services 블록 외부 최상위 레벨로 이동, healthcheck/networks 추가, 올바른 YAML Anchors 문법 적용 |
| 11.4 | 2025-12-15 | Section 5.5 Health Check API 응답 스키마 수정 - Phase 1 서비스만 포함 (api-gateway, oz-relayer-pool, redis), Phase 2+ 확장 스키마 분리 (oz-monitor, mysql 추가), oz-relayer-pool 상태 집계 로직 설명 추가 |
| 11.3 | 2025-12-15 | Section 11.3 OZ Relayer 설정 파일 경로 수정 - 중첩 디렉토리 구조를 flat 파일 구조로 변경 (prd.txt, Docker Compose와 일관성 확보), Docker 볼륨 마운트 참고 추가 |
| 11.2 | 2025-12-15 | Docker Compose YAML Anchors 패턴 적용 - Multi-Relayer Pool 설정 중복 최소화, deploy.replicas 미사용 이유 설명 (개별 Private Key 필요) |
| 11.1 | 2025-12-15 | Section 9.1 API Key 인증 추가 - Phase 1 단일 환경변수 방식 (API_GATEWAY_API_KEY), Phase 2+ 확장 계획 명시 |
| 11.0 | 2025-12-15 | SPEC-INFRA-001 기준 Docker 구조 동기화 - docker/ 디렉토리로 통합, 멀티스테이지 빌드 (Dockerfile.packages), .env 제거, Hardhat Node 포함, Redis 8.0-alpine (AOF), Named Volume (msq-relayer-redis-data), OZ Relayer RPC_URL/REDIS_HOST/REDIS_PORT 환경변수, Read-only 볼륨 마운트 (:ro), Section 13 v5.0 |
| 10.0 | 2025-12-15 | MySQL/Prisma를 Phase 2+로 이동 - Phase 1은 OZ Relayer + Redis만 사용, DB 없음, Docker Compose에서 mysql 제거 |
| 9.0 | 2025-12-15 | TX History, Webhook Handler를 Phase 2+로 이동 - Phase 1은 상태 폴링 방식 사용, MySQL/Webhook은 Phase 2+에서 구현 |
| 8.0 | 2025-12-15 | Rate Limiting, Quota Manager 완전 제거 - Phase 1은 Auth + Relay 기능만 유지 |
| 7.0 | 2025-12-15 | Phase 2 재설계 - SDK 제거 (API 문서로 대체), Queue System 추가 (QUEUE_PROVIDER 패턴: Redis/BullMQ, AWS SQS) |
| 6.2 | 2025-12-15 | Docker Build 전략 확정 - 패키지별 Dockerfile 방식 채택, Docker Compose build context/dockerfile 설정 명시 |
| 6.1 | 2025-12-15 | Multi-Relayer Pool 설정 추가 - Section 11.3 (Pool 구성, Load Balancing, Scaling), Docker Compose v4.0 (Multi-Relayer Profile 지원) |
| 6.0 | 2025-12-15 | Phase 1에 Gasless TX 포함 - Gasless API/SDK Phase 1으로 이동, EIP-712 검증 Phase 1, OZ Monitor/Policy/Quota는 Phase 2+ 유지 |
| 5.0 | 2025-12-14 | Phase 1 중심으로 재정리 - 구현 범위 테이블 추가, OZ Monitor/Gasless/Policy를 Phase 2+로 표시 |
| 4.0 | 2025-12-13 | B2B Infrastructure 관점으로 전면 재작성 - SDK 예제를 Client Service 백엔드 통합 패턴으로 변경, Gasless TX 흐름을 Server-to-Server로 수정 |
| 3.0 | 2025-12-13 | OZ 오픈소스 (Relayer v1.3.0, Monitor v1.1.0) 기반 기술 스택으로 전면 재설계, BullMQ → Redis (OZ native), OZ 설정 가이드 추가 |
| 2.3 | 2025-12-12 | 문서 일관성 개선, 관련 문서 참조 추가 |
| 2.2 | 2025-12-12 | Examples Package 섹션 추가 |
| 2.1 | 2025-12-12 | Client SDK를 OZ Defender SDK 호환 패턴으로 개편 |
| 2.0 | 2025-12-12 | 초기 tech.md 생성 |

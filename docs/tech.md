# MSQ Relayer Service - 기술 문서

## 문서 정보
- **버전**: 7.0
- **최종 수정일**: 2025-12-15
- **상태**: Phase 1 구현 단계 (Direct + Gasless + Multi-Relayer Pool)

> **참고**: MSQ Relayer Service는 **B2B Infrastructure**입니다. 이 문서의 모든 API 사용법은 Client Services (결제 시스템, 에어드랍 시스템, NFT 서비스 등)가 Relayer API를 호출하는 패턴을 기준으로 작성되었습니다. API 문서는 Swagger UI (`/api/docs`)에서 확인할 수 있습니다.

### 관련 문서
- [제품 요구사항](./product.md)
- [시스템 아키텍처](./structure.md)
- [Task Master PRD](../.taskmaster/docs/prd.txt)

---

## 기술 스택 개요

Blockchain Transaction Relayer System의 기술 스택 및 구현 사양을 정의합니다.

**v3.0 핵심 변경**: OZ 오픈소스(Relayer v1.3.0, Monitor v1.1.0)를 핵심으로 활용하여 개발 기간 50% 단축

### 구현 범위

| Phase | 기술 범위 | 상태 |
|-------|----------|------|
| **Phase 1** | OZ Relayer, Redis, NestJS (Auth, Direct TX, Gasless TX, EIP-712 검증, Health, Webhook), ERC2771Forwarder | 🔄 구현 중 |
| **Phase 2+** | Queue System (Redis/SQS), OZ Monitor, Policy Engine, Quota Manager, Vault | 📋 계획됨 |

---

## 1. Core Services 기술 스택 (OZ Open Source)

### 1.1 OZ Relayer v1.3.0

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Language | Rust | - | 고성능, 메모리 안전성 |
| Container | Docker | - | ghcr.io/openzeppelin/openzeppelin-relayer:v1.3.0 |
| License | AGPL-3.0 | - | 수정 시 소스 공개 필요 |
| Queue | Redis | 7.x | OZ Relayer 네이티브 지원 |
| Key Management | HashiCorp Vault | 1.15 | OZ Relayer 네이티브 지원 |

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
| ORM | Prisma | 5.x | Type-safe DB 접근 |
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
| Database | MySQL Container | AWS RDS MySQL (Multi-AZ) |
| Cache/Queue | Redis Container | AWS ElastiCache Cluster |
| Secrets | .env / K8s Secret | HashiCorp Vault |
| Load Balancer | - | AWS ALB / Nginx Ingress |
| Monitoring | Prometheus + Grafana | Prometheus + Grafana |
| Logging | Console | CloudWatch / Loki |

---

## 5. API 사양

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

Response (OZ Defender SDK 호환):
{
  "txId": "uuid",          # 내부 트랜잭션 ID
  "txHash": "0x...",       # 블록체인 트랜잭션 해시
  "status": "submitted",   # pending|sent|submitted|inmempool|mined|confirmed|failed
  "from": "0x...",         # Relayer 주소
  "nonce": 42,
  "gasPrice": "30000000000"
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

Response (OZ Defender SDK 호환):
{
  "requestId": "uuid",
  "txHash": "0x...",
  "status": "submitted",
  "forwarder": "0x...",
  "relayer": "0x...",
  "gasUsed": "150000",
  "effectiveGasPrice": "30000000000"
}
```

### 5.3 Nonce 조회 API

```yaml
GET /api/v1/relay/nonce/{userAddress}?network=polygon

Response:
{
  "address": "0x...",
  "nonce": "5",
  "network": "polygon",
  "forwarder": "0x..."
}
```

### 5.4 Status 조회 API

```yaml
GET /api/v1/relay/status/{txId}

Response:
{
  "txId": "uuid",
  "txHash": "0x...",
  "status": "confirmed",
  "confirmations": 12,
  "blockNumber": 12345678
}
```

### 5.5 Health Check API

```yaml
GET /api/v1/health

Response:
{
  "api-gateway": "healthy",
  "oz-relayer": "healthy",
  "oz-monitor": "healthy",
  "redis": "healthy",
  "mysql": "healthy"
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

    # Quota 설정 (NestJS Quota Manager에서 관리)
    quota:
      perUser:
        maxTxPerDay: 100
        maxTxPerHour: 20
        maxGasPerDay: "10000000"  # 10M gas
      global:
        maxTxPerDay: 10000
        maxGasPerDay: "1000000000"

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
| **Quota / Rate Limit** | - | Quota Manager | - |
| **Gas Limit Cap** | - | Policy Engine | - |
| **Gas 추정** | - | - | 내장 |
| **TX 서명/제출** | - | - | 내장 |
| **재시도 로직** | - | - | 내장 |

---

## 9. 보안 요구사항

| 항목 | 요구사항 | 구현 위치 |
|------|----------|----------|
| Private Key 관리 | HashiCorp Vault | OZ Relayer 네이티브 |
| API 인증 | API Key + Rate Limiting | NestJS API Gateway |
| 네트워크 보안 | VPC Private Subnet, Security Group | Infrastructure |
| Contract Whitelist | 허용된 컨트랙트만 호출 | NestJS Policy Engine |
| Method Whitelist | 허용된 메서드만 호출 | NestJS Policy Engine |
| User Blacklist | 차단된 사용자 거부 | NestJS Policy Engine |
| Quota / Rate Limit | 사용량 제한 | NestJS Quota Manager |
| EIP-712 검증 | Signature 사전 검증 | NestJS + OZ Forwarder |
| Nonce 검증 | Replay Attack 방지 | OZ Forwarder (온체인) |
| Deadline 검증 | 만료 요청 거부 | NestJS + OZ Forwarder |
| Webhook 보안 | WEBHOOK_SIGNING_KEY | OZ Relayer |

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
config/oz-relayer/
├── relayer-1/
│   └── config.json     # Relayer #1 설정 (Key: 0xAAA...)
├── relayer-2/
│   └── config.json     # Relayer #2 설정 (Key: 0xBBB...)
└── relayer-n/
    └── config.json     # Relayer #N 설정 (Key: 0xNNN...)
```

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

## 13. Docker Compose 설정 (v4.0 - Multi-Relayer Pool)

> **Docker Build 전략**: 패키지별 Dockerfile 방식 채택
> - API Gateway: `packages/api-gateway/Dockerfile`
> - 각 패키지가 독립적인 Dockerfile 보유 → 빌드 캐시 최적화, 독립 배포 가능

```yaml
version: '3.8'

services:
  api-gateway:
    build:
      context: ./packages/api-gateway  # 패키지별 Dockerfile 방식
      dockerfile: Dockerfile
    ports: ["3000:3000"]
    depends_on: [mysql, redis, oz-relayer-1]
    environment:
      - NODE_ENV=development
      - RELAYER_POOL_CONFIG=/app/config/relayer-pool.yaml
      - DATABASE_URL=mysql://relayer:${DB_PASSWORD}@mysql:3306/relayer
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./config/relayer-pool.yaml:/app/config/relayer-pool.yaml

  # === Multi-Relayer Pool (독립 Private Key) ===

  oz-relayer-1:
    image: ghcr.io/openzeppelin/openzeppelin-relayer:v1.3.0
    ports: ["8080:8080", "8081:8081"]
    volumes:
      - ./config/oz-relayer/relayer-1:/app/config
      - ./keys/relayer-1:/app/config/keys
    environment:
      - RUST_LOG=info
      - API_KEY=${OZ_RELAYER_1_API_KEY}
      - KEYSTORE_PASSPHRASE=${KEYSTORE_1_PASSPHRASE}
      - REDIS_URL=redis://redis:6379
    depends_on: [redis, vault]

  oz-relayer-2:
    image: ghcr.io/openzeppelin/openzeppelin-relayer:v1.3.0
    ports: ["8082:8080", "8083:8081"]
    volumes:
      - ./config/oz-relayer/relayer-2:/app/config
      - ./keys/relayer-2:/app/config/keys
    environment:
      - RUST_LOG=info
      - API_KEY=${OZ_RELAYER_2_API_KEY}
      - KEYSTORE_PASSPHRASE=${KEYSTORE_2_PASSPHRASE}
      - REDIS_URL=redis://redis:6379
    depends_on: [redis, vault]
    profiles: ["scale"]  # docker-compose --profile scale up 으로 활성화

  # 추가 Relayer는 동일 패턴으로 확장
  # oz-relayer-n:
  #   ...
  #   profiles: ["scale"]

  oz-monitor:
    image: ghcr.io/openzeppelin/openzeppelin-monitor:v1.1.0
    volumes:
      - ./config/oz-monitor:/app/config
    environment:
      - RUST_LOG=info
      - POLYGON_RPC_URL=${POLYGON_RPC_URL}
      - SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL}
      - RELAYER_ADDRESS=${RELAYER_ADDRESS}
    depends_on: [oz-relayer]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes:
      - redis_data:/data

  mysql:
    image: mysql:8.0
    environment:
      - MYSQL_DATABASE=relayer
      - MYSQL_USER=relayer
      - MYSQL_PASSWORD=${DB_PASSWORD}
      - MYSQL_ROOT_PASSWORD=${DB_ROOT_PASSWORD}
    ports: ["3306:3306"]
    volumes:
      - mysql_data:/var/lib/mysql

  vault:
    image: hashicorp/vault:1.15
    ports: ["8200:8200"]
    environment:
      - VAULT_DEV_ROOT_TOKEN_ID=${VAULT_TOKEN}
    cap_add:
      - IPC_LOCK

  prometheus:
    image: prom/prometheus:v2.47.0
    ports: ["9090:9090"]
    volumes:
      - ./config/prometheus:/etc/prometheus

  grafana:
    image: grafana/grafana:10.2.0
    ports: ["3001:3000"]
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    volumes:
      - grafana_data:/var/lib/grafana

volumes:
  redis_data:
  mysql_data:
  grafana_data:
```

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
    hardhat: {
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

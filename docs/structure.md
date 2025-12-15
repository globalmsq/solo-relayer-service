# MSQ Relayer Service - 구조 문서

## 문서 정보
- **버전**: 12.0
- **최종 수정일**: 2025-12-15
- **상태**: Phase 1 구현 단계 (Direct + Gasless + Multi-Relayer Pool)

### 관련 문서
- [제품 요구사항](./product.md)
- [기술 스택 및 API 스펙](./tech.md)
- [Task Master PRD](../.taskmaster/docs/prd.txt)

---

## 프로젝트 구조 개요

MSQ Relayer Service는 **B2B Infrastructure**로, 내부 Client Services(결제, 에어드랍, NFT 서비스 등)가 블록체인 트랜잭션을 쉽게 처리할 수 있도록 지원합니다.

**OZ 오픈소스(Relayer + Monitor)**를 핵심으로 활용하며, NestJS API Gateway가 인증/정책/할당량 관리를 담당합니다.

### 구현 범위

| Phase | 범위 | 상태 |
|-------|------|------|
| **Phase 1** | OZ Relayer + Redis, Auth, Health, Direct TX, Gasless TX, ERC2771Forwarder, EIP-712 검증, 결제 시스템 연동 | 🔄 구현 중 |
| **Phase 2+** | TX History (MySQL), Webhook Handler, Queue System (Redis/SQS), OZ Monitor, Policy Engine, Kubernetes | 📋 계획됨 |

---

## 1. 시스템 아키텍처

### 1.1 High-Level Architecture (v4.0 B2B Infrastructure)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Client Services (B2B)                         │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────┐   │
│  │ 결제       │ │ 에어드랍   │ │ NFT       │ │ DeFi/Game     │   │
│  │ 시스템     │ │ 시스템     │ │ 서비스    │ │ 서비스        │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────────┘   │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                   NestJS API Gateway (개발 필요)                 │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                     │
│  │ Auth      │ │ Queue     │ │ Policy    │                     │
│  │ (API Key) │ │ Adapter   │ │ Engine    │                     │
│  └───────────┘ └───────────┘ └───────────┘                     │
│  ┌───────────┐ ┌───────────────────────────────────────────┐ │
│  │ Gasless   │ │ API Documentation                         │ │
│  │Coordinator│ │ (Swagger/OpenAPI)                         │ │
│  └───────────┘ └───────────────────────────────────────────┘ │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  OZ Relayer     │   │  OZ Monitor     │   │ Smart Contracts │
│  v1.3.0 (Rust)  │   │  v1.1.0 (Rust)  │   │ (Solidity)      │
│  ─────────────  │   │  ─────────────  │   │ ─────────────   │
│  • EVM TX Relay │   │  • Block Watch  │   │ • ERC2771       │
│  • Nonce Mgmt   │   │  • Event Filter │   │   Forwarder     │
│  • Gas Estimate │   │  • Balance Alert│   │ • Sample ERC20  │
│  • Signing      │   │  • Slack/Discord│   │ • Sample ERC721 │
│  • Webhook      │   │  • Custom Script│   │                 │
│  Port: 8080     │   │                 │   │                 │
└────────┬────────┘   └────────┬────────┘   └─────────────────┘
         │                     │
         └──────────┬──────────┘
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Infrastructure                              │
│  ┌───────────┐ ┌───────────┐                                   │
│  │ Redis     │ │ Prometheus│                                   │
│  │ (Queue)   │ │ + Grafana │                                   │
│  └───────────┘ └───────────┘                                   │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Blockchain Networks                           │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐                     │
│  │ Polygon   │ │ Ethereum  │ │ BNB Chain │                     │
│  │ (P0)      │ │ (P1)      │ │ (P2)      │                     │
│  └───────────┘ └───────────┘ └───────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

#### Mermaid Architecture Diagram

```mermaid
flowchart TB
    subgraph Clients["Client Services (B2B)"]
        Payment["결제 시스템"]
        Airdrop["에어드랍 시스템"]
        NFTService["NFT 서비스"]
        DeFi["DeFi/Game 서비스"]
    end

    subgraph Gateway["NestJS API Gateway"]
        Auth["Auth\n(API Key)"]
        QueueAdapter["Queue\nAdapter"]
        Policy["Policy\nEngine"]
        GaslessCoord["Gasless\nCoordinator"]
        APIDocs["API Docs\n(Swagger)"]
    end

    subgraph OZServices["OZ Open Source Services"]
        Relayer["OZ Relayer v1.3.0\n(Rust/Docker)"]
        Monitor["OZ Monitor v1.1.0\n(Rust/Docker)"]
    end

    subgraph SmartContracts["Smart Contracts"]
        Forwarder["ERC2771Forwarder"]
        Target["Target Contracts\n(ERC20, ERC721)"]
    end

    subgraph Infra["Infrastructure"]
        Redis["Redis\n(Queue)"]
        Prometheus["Prometheus\n+ Grafana"]
    end

    subgraph Blockchain["Blockchain Networks"]
        Polygon["Polygon\n(P0)"]
        Ethereum["Ethereum\n(P1)"]
        BNB["BNB Chain\n(P2)"]
    end

    Clients --> Gateway
    Gateway --> OZServices
    Relayer --> SmartContracts
    SmartContracts --> Blockchain
    OZServices --> Infra
    Gateway --> Infra
    Monitor --> Blockchain
```

### 1.2 OZ 서비스 역할 분리

| 컴포넌트 | 역할 | 구현 방식 | Phase |
|----------|------|-----------|-------|
| **OZ Relayer Pool** | TX 중계, Nonce/Gas/Retry (Multi-Instance) | Docker 이미지 (설정만) | Phase 1 |
| **OZ Monitor** | 이벤트 감지, 잔액 알림 | Docker 이미지 (설정만) | Phase 2+ |
| **NestJS Gateway** | 인증, Load Balancing, Direct TX, Gasless TX, EIP-712 검증 | Custom 개발 | Phase 1 (프로덕션) |
| **ERC2771Forwarder** | Meta-TX Forwarder | OZ Contracts 배포 | Phase 1 |

### 1.3 Multi-Relayer Pool Architecture

**Relayer Pool 방식**: 각 Relayer가 독립적인 Private Key를 보유하여 Nonce 충돌 없이 병렬 처리

```
┌─────────────────────────────────────────────────────────────┐
│                NestJS API Gateway (Load Balancer)            │
│  ┌───────────┐ ┌───────────────┐ ┌─────────────────────┐   │
│  │ Auth      │ │ Relayer       │ │ Pool Health         │   │
│  │ Module    │ │ Router        │ │ Monitor             │   │
│  └───────────┘ └───────────────┘ └─────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │ Routing Strategy: Round Robin / Least Load
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ OZ Relayer #1   │ │ OZ Relayer #2   │ │ OZ Relayer #N   │
│ ─────────────── │ │ ─────────────── │ │ ─────────────── │
│ Key: 0xAAA...   │ │ Key: 0xBBB...   │ │ Key: 0xNNN...   │
│ Balance: 1 ETH  │ │ Balance: 1 ETH  │ │ Balance: 1 ETH  │
│ Status: Active  │ │ Status: Active  │ │ Status: Standby │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┴───────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │     Redis       │
                    │  (Shared Queue) │
                    └─────────────────┘
```

**Pool 관리 기능**:
| 기능 | 설명 | Phase |
|------|------|-------|
| Relayer Registry | Pool 내 Relayer 목록 관리 | Phase 1 |
| Health Check | 각 Relayer 상태 모니터링 | Phase 1 |
| Load Balancing | Round Robin / Least Load 라우팅 | Phase 1 |
| Manual Scaling | Relayer 수동 추가/제거 | Phase 1 |
| Auto Scaling | Queue Depth 기반 자동 스케일링 | Phase 2+ |

**Scaling 전략**:
- **Phase 1**: 1개로 시작, 수동으로 확장 (최대 N개)
- **Phase 2+**: Kubernetes HPA 또는 Queue Depth 기반 자동 스케일링

### 1.4 Unified Request Flow

```
┌──────────────────────────────────────────────────────────────┐
│                        API Layer                              │
├──────────────┬──────────────┬─────────────┬─────────────────┤
│ POST         │ POST         │ GET         │ GET             │
│ /relay/direct│ /relay/gasless│ /relay/nonce│ /relay/status   │
└──────┬───────┴──────┬───────┴──────┬──────┴────────┬────────┘
       │              │              │               │
       ▼              ▼              │               │
┌──────────────┐ ┌───────────────────┴───────────────┴────────┐
│ Direct Path  │ │           Gasless Middleware               │
├──────────────┤ ├────────────────────────────────────────────┤
│ Whitelist 검증│ │ 1. Signature Verifier (EIP-712 사전검증)   │
│ (NestJS)     │ │ 2. Policy Engine (Contract/Method 제한)   │
└──────┬───────┘ │                                           │
       │         │ 4. Forwarder TX Builder                   │
       │         └────────────────────┬───────────────────────┘
       │                              │
       └──────────────┬───────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                 OZ Relayer (v1.3.0 Rust)                     │
├─────────────┬─────────────┬─────────────┬───────────────────┤
│ Nonce       │ Gas         │ Signer      │ Queue             │
│ Manager     │ Estimator   │ Service     │ (Redis)           │
├─────────────┴─────────────┴─────────────┴───────────────────┤
│                    Retry Handler (내장)                      │
├─────────────────────────────────────────────────────────────┤
│                 Transaction Submitter                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 보안 제어 레이어

OpenZeppelin 공식 권고에 따라 Contract/Method Whitelist 등 보안 제어는 **NestJS API Gateway**에서 구현합니다.

```
Request → [API Key 인증] → [Contract Whitelist] → [Method Whitelist]
                                                    ↓
                                            [User Blacklist]
                                                    ↓
         [EIP-712 서명 사전검증] → OZ Relayer → [Forwarder.execute()]
         (NestJS)                 (Rust)        (온체인)
                                                    ↓
         OZ Forwarder: [EIP-712 검증] → [Nonce 관리] → [Deadline 검증]
                       (온체인)        (온체인)        (온체인)
```

---

## 3. 디렉토리 구조 (v5.0 - SPEC-INFRA-001 기준)

```
msq-relayer-service/
├── docker/                          # Docker 관련 파일 전용 디렉토리
│   ├── Dockerfile.packages          # 멀티스테이지 빌드 (api-gateway tsx 실행)
│   ├── docker-compose.yaml          # 메인 설정 (Hardhat Node 포함)
│   ├── docker-compose-amoy.yaml     # Polygon Amoy Testnet 설정
│   ├── config/
│   │   └── oz-relayer/              # OZ Relayer 설정 파일
│   │       ├── relayer-1.json       # Relayer #1 설정
│   │       ├── relayer-2.json       # Relayer #2 설정
│   │       └── relayer-3.json       # Relayer #3 설정
│   ├── keys-example/                # 샘플 키스토어 (Git 포함, Hardhat #10,11,12)
│   │   ├── relayer-1/keystore.json
│   │   ├── relayer-2/keystore.json
│   │   └── relayer-3/keystore.json
│   └── keys/                        # 실제 키스토어 (.gitignore)
│       ├── relayer-1/keystore.json
│       ├── relayer-2/keystore.json
│       └── relayer-3/keystore.json
│
├── scripts/
│   ├── health-check.sh              # Health check 스크립트
│   ├── test-infra.sh                # 통합 테스트 스크립트
│   └── create-keystore.js           # 키스토어 생성 스크립트 (ethers.js)
│
├── packages/
│   ├── api-gateway/                 # NestJS API Gateway (Custom 개발)
│   │   ├── src/
│   │   │   ├── auth/                # API Key 인증 모듈
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth.guard.ts
│   │   │   │   └── api-key.service.ts
│   │   │   │
│   │   │   ├── relay/               # Relay 엔드포인트
│   │   │   │   ├── relay.module.ts
│   │   │   │   ├── direct/          # Direct TX 컨트롤러
│   │   │   │   │   ├── direct.controller.ts
│   │   │   │   │   └── direct.service.ts
│   │   │   │   ├── gasless/         # Gasless TX 컨트롤러
│   │   │   │   │   ├── gasless.controller.ts
│   │   │   │   │   └── gasless.service.ts
│   │   │   │   └── status/          # 상태 조회 (폴링)
│   │   │   │       ├── status.controller.ts
│   │   │   │       └── status.service.ts
│   │   │   │
│   │   │   ├── policy/              # Policy Engine (Phase 2+)
│   │   │   │   ├── policy.module.ts
│   │   │   │   ├── whitelist.service.ts
│   │   │   │   ├── blacklist.service.ts
│   │   │   │   └── rules.service.ts
│   │   │   │
│   │   │   ├── webhook/             # OZ Relayer Webhook 핸들러 (Phase 2+)
│   │   │   │   ├── webhook.module.ts
│   │   │   │   └── webhook.controller.ts
│   │   │   │
│   │   │   ├── oz-relayer/          # OZ Relayer SDK 래퍼
│   │   │   │   ├── oz-relayer.module.ts
│   │   │   │   └── oz-relayer.service.ts
│   │   │   │
│   │   │   ├── common/              # 공유 유틸리티
│   │   │   │   ├── filters/
│   │   │   │   ├── interceptors/
│   │   │   │   └── decorators/
│   │   │   │
│   │   │   └── main.ts
│   │   │
│   │   ├── prisma/                  # DB 스키마 (Phase 2+)
│   │   │   └── schema.prisma
│   │   │
│   │   └── package.json             # (Dockerfile 없음 - docker/Dockerfile.packages 사용)
│   │
│   ├── contracts/                   # Smart Contracts (OZ 활용)
│   │   ├── contracts/
│   │   │   └── tokens/
│   │   │       ├── SampleToken.sol  # ERC20 + ERC2771Context
│   │   │       └── SampleNFT.sol    # ERC721 + ERC2771Context
│   │   ├── scripts/
│   │   │   └── deploy-forwarder.ts
│   │   ├── hardhat.config.ts
│   │   └── package.json
│   │
│   └── examples/                    # 통합 예제
│       ├── src/
│       │   ├── direct-tx/           # Direct Transaction 예제
│       │   ├── gasless-tx/          # Gasless Transaction 예제
│       │   └── contracts/           # 스마트 컨트랙트 배포 예제
│       ├── README.md
│       └── package.json
│
├── k8s/                             # Kubernetes Manifests (Phase 2+)
│   ├── base/                        # 기본 매니페스트
│   └── overlays/
│       ├── staging/                 # 스테이징 환경
│       └── production/              # 프로덕션 환경
│
├── README.md                        # 프로젝트 README (문서 인덱스)
│
└── docs/                            # Documentation
    ├── product.md                   # 제품 요구사항 (WHAT/WHY)
    ├── structure.md                 # 이 파일 (WHERE)
    └── tech.md                      # 기술 스펙 (HOW)
```

### Docker 실행 방법

```bash
# Hardhat Node (로컬 개발 환경)
cd docker && docker-compose up

# Polygon Amoy Testnet
cd docker && docker-compose -f docker-compose-amoy.yaml up
```

### 환경 변수 전략

- **.env 파일 사용 금지**: 모든 환경 변수를 docker-compose.yaml에 직접 명시
- **네트워크별 설정 분리**: Hardhat (기본) / Amoy (테스트넷)

---

## 4. 모듈 책임 분리 (v3.0)

### 4.1 OZ Relayer (설정만)

**OZ Relayer v1.3.0** - 트랜잭션 중계 핵심 엔진 (Rust, Docker)

| 기능 | 설명 | 구현 위치 |
|------|------|-----------|
| TX Relay | 트랜잭션 중계 및 서명 | OZ Relayer 내장 |
| Nonce Management | 자동 Nonce 관리 | OZ Relayer 내장 |
| Gas Estimation | 가스 추정 및 조정 | OZ Relayer 내장 |
| Retry Logic | 재시도 로직 | OZ Relayer 내장 |
| Webhook | 상태 알림 | OZ Relayer 내장 |

**설정 파일**: `config/oz-relayer/config.json`

### 4.2 OZ Monitor (설정만) - Phase 2+

**OZ Monitor v1.1.0** - 블록체인 이벤트 모니터링 (Rust, Docker)

> ⏳ **Phase 2+에서 구현 예정** (잔액 모니터링, 이벤트 알림)

| 기능 | 설명 | 구현 위치 |
|------|------|-----------|
| Block Watch | 블록체인 블록 감시 | OZ Monitor 내장 |
| Event Filter | 이벤트 필터링 | OZ Monitor 내장 |
| Balance Alert | 잔액 알림 | OZ Monitor 내장 |
| Slack/Discord | 알림 채널 연동 | OZ Monitor 내장 |
| Custom Script | Python/JS/Bash 스크립트 | OZ Monitor 내장 |

**설정 파일**: `config/oz-monitor/networks/`, `monitors/`, `triggers/`

### 4.3 packages/api-gateway (Custom 개발)

**NestJS API Gateway** - 인증, 정책, 할당량, OZ Relayer 프록시

| 모듈 | 책임 | Phase |
|------|------|-------|
| `auth/` | API Key 인증 | Phase 1 |
| `relay/direct/` | Direct TX 엔드포인트, OZ Relayer 프록시 | Phase 1 |
| `relay/gasless/` | Gasless TX 엔드포인트, EIP-712 사전검증 | Phase 1 |
| `relay/status/` | 트랜잭션 상태 조회 | Phase 1 |
| `policy/` | Contract/Method Whitelist, User Blacklist | Phase 2+ |
| `webhook/` | OZ Relayer Webhook 핸들러, TX History 저장 | Phase 2+ |
| `oz-relayer/` | OZ Relayer SDK 래퍼 서비스 | Phase 1 |

#### 4.3.1 Auth 모듈 상세 (Phase 1)

**인증 방식**:
- 단일 환경변수 `API_GATEWAY_API_KEY`로 API Key 관리
- Header: `X-API-Key: {api_key}`
- 환경변수 값과 일치 여부로 검증

```
packages/api-gateway/src/auth/
├── auth.module.ts              # Global Guard 등록
├── guards/
│   └── api-key.guard.ts        # X-API-Key 검증
└── decorators/
    └── public.decorator.ts     # @Public() (Health Check 등 예외)
```

**Docker Compose 환경변수**:
```yaml
api-gateway:
  environment:
    API_GATEWAY_API_KEY: "msq-dev-api-key-12345"
```

**Phase 2+ 확장**: 다중 Client, DB 기반 저장, Key 로테이션

### 4.4 packages/contracts

**Smart Contracts** - OpenZeppelin 기반 스마트 컨트랙트

| 파일 | 책임 |
|------|------|
| `SampleToken.sol` | ERC20 + ERC2771Context (Gasless 지원 예시) |
| `SampleNFT.sol` | ERC721 + ERC2771Context (Gasless 지원 예시) |
| `deploy-forwarder.ts` | OZ ERC2771Forwarder 배포 스크립트 |

### 4.5 packages/examples

**Examples Package** - API 사용 예제, 스마트 컨트랙트 배포 예제

| 모듈 | 책임 |
|------|------|
| `direct-tx/` | Direct Transaction 예제 |
| `gasless-tx/` | Gasless Transaction 예제 |
| `contracts/` | 스마트 컨트랙트 배포 예제 |
| `integration/` | React 앱, Node.js 백엔드 통합 예제 |

---

## 5. 데이터 플로우

### 5.1 Direct Transaction Flow

```
1. Client → POST /api/v1/relay/direct
2. NestJS API Gateway:
   a. API Key 인증
   b. Whitelist 검증
3. NestJS → OZ Relayer SDK → OZ Relayer (Rust)
4. OZ Relayer:
   a. Nonce 획득 (내장)
   b. Gas 추정 (내장)
   c. Relayer PK로 서명 (내장)
   d. TX 제출 (내장)
   e. Retry 처리 (내장)
5. OZ Relayer → Blockchain
6. msg.sender = Relayer 주소
7. Client → GET /api/v1/relay/status/{txId} (상태 폴링)
```

#### Mermaid: Direct Transaction Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Gateway as NestJS API Gateway
    participant Relayer as OZ Relayer
    participant BC as Blockchain

    Client->>Gateway: POST /api/v1/relay/direct

    rect rgb(240, 248, 255)
        Note over Gateway: Authentication & Validation
        Gateway->>Gateway: API Key 인증
        Gateway->>Gateway: Contract Whitelist 검증
    end

    Gateway->>Relayer: OZ Relayer SDK 요청

    rect rgb(255, 248, 240)
        Note over Relayer: Transaction Processing (Built-in)
        Relayer->>Relayer: Nonce 획득
        Relayer->>Relayer: Gas 추정
        Relayer->>Relayer: Relayer PK로 서명
    end

    Relayer->>BC: TX 제출
    BC-->>Relayer: TX Hash

    rect rgb(240, 255, 240)
        Note over Relayer: Retry & Confirmation
        Relayer->>Relayer: Retry 처리 (필요시)
        Relayer->>BC: TX 확인
    end

    Relayer-->>Gateway: Response {txId, status: pending}
    Gateway-->>Client: Response {txId, status}

    Note over Client: 상태 폴링 (Phase 1)
    Client->>Gateway: GET /api/v1/relay/status/{txId}
    Gateway->>Relayer: 상태 조회
    Relayer-->>Gateway: {txHash, status, ...}
    Gateway-->>Client: {txHash, status, ...}

    Note over BC: msg.sender = Relayer 주소
```

### 5.2 Gasless Transaction Flow (Phase 1)

```
1. End User: EIP-712로 서명 (Client Service의 프론트엔드)
2. Client Service → POST /api/v1/relay/gasless (End User 서명 전달)
3. NestJS API Gateway:
   a. API Key 인증 (Client Service 인증)
   b. EIP-712 Signature 사전 검증
   c. Contract Whitelist 체크
   d. Method Whitelist 체크
   e. User Blacklist 체크
   f. Forwarder TX 빌드
4. NestJS → OZ Relayer SDK → OZ Relayer (Rust)
5. OZ Relayer:
   a. Nonce 획득 (내장)
   b. Gas 추정 (내장)
   c. Relayer PK로 TX 서명 (내장)
   d. TX 제출: Forwarder.execute(request, signature)
6. OZ ERC2771Forwarder (온체인):
   a. EIP-712 서명 검증
   b. Nonce 검증 & 증가
   c. Deadline 검증
7. Forwarder → Target Contract: call(data)
8. Target Contract: _msgSender() = End User 주소
9. Client Service → GET /api/v1/relay/status/{txId} (상태 폴링)
```

#### Mermaid: Gasless Transaction Flow

```mermaid
sequenceDiagram
    autonumber
    participant EndUser as End User
    participant Client as Client Service
    participant Gateway as NestJS API Gateway
    participant Relayer as OZ Relayer
    participant Forwarder as ERC2771Forwarder
    participant Target as Target Contract
    participant BC as Blockchain

    EndUser->>Client: 트랜잭션 요청
    Client->>EndUser: EIP-712 서명 요청
    EndUser->>EndUser: EIP-712 서명 생성
    EndUser->>Client: 서명 전달
    Client->>Gateway: POST /api/v1/relay/gasless

    rect rgb(240, 248, 255)
        Note over Gateway: Comprehensive Validation
        Gateway->>Gateway: API Key 인증
        Gateway->>Gateway: EIP-712 서명 사전검증
        Gateway->>Gateway: Contract Whitelist 체크
        Gateway->>Gateway: Method Whitelist 체크
        Gateway->>Gateway: User Blacklist 체크
        Gateway->>Gateway: Forwarder TX 빌드
    end

    Gateway->>Relayer: OZ Relayer SDK 요청

    rect rgb(255, 248, 240)
        Note over Relayer: Transaction Processing (Built-in)
        Relayer->>Relayer: Nonce 획득
        Relayer->>Relayer: Gas 추정
        Relayer->>Relayer: Relayer PK로 TX 서명
    end

    Relayer->>Forwarder: execute(request, signature)

    rect rgb(255, 240, 245)
        Note over Forwarder: On-chain Verification
        Forwarder->>Forwarder: EIP-712 서명 검증
        Forwarder->>Forwarder: Nonce 검증 & 증가
        Forwarder->>Forwarder: Deadline 검증
    end

    Forwarder->>Target: call(data)
    Note over Target: _msgSender() = End User 주소
    Target->>BC: State Change
    BC-->>Relayer: TX Confirmed
    Relayer-->>Gateway: Response {txId, status: pending}
    Gateway-->>Client: Response {txId, status}

    Note over Client: 상태 폴링 (Phase 1)
    Client->>Gateway: GET /api/v1/relay/status/{txId}
    Gateway->>Relayer: 상태 조회
    Relayer-->>Gateway: {txHash, status, ...}
    Gateway-->>Client: {txHash, status, ...}
    Client-->>EndUser: 처리 완료 알림
```

---

## 6. OZ 서비스 설정

> 📋 **상세 OZ 서비스 설정**: [tech.md - Section 11, 12](./tech.md#11-oz-relayer-설정) 참조

### 6.1 설정 파일 위치

| 서비스 | 설정 경로 | 설명 |
|--------|----------|------|
| **OZ Relayer** | `config/oz-relayer/config.json` | Relayer 설정 (네트워크, Signer, Policies, Webhook) |
| **OZ Monitor** | `config/oz-monitor/networks/` | 네트워크 설정 (RPC URL, Chain ID) |
| **OZ Monitor** | `config/oz-monitor/monitors/` | 모니터 설정 (잔액, 이벤트 조건) |
| **OZ Monitor** | `config/oz-monitor/triggers/` | 트리거 설정 (Slack, Discord, Webhook) |

### 6.2 핵심 설정 항목

**OZ Relayer**:
- `signer.type`: `local` (로컬 키스토어) 또는 `aws_kms` (AWS KMS)
- `policies.gas_price_cap`: 최대 Gas Price (wei)
- `policies.min_balance`: 최소 Relayer 잔액 (wei)
- `notifications`: Webhook URL 설정

**OZ Monitor**:
- `conditions.type`: `balance_threshold` (잔액), `event` (이벤트)
- `triggers`: Slack, Discord, Telegram, Webhook 지원

---

## 7. 환경별 배포 구성

| 설정 | Local | Staging | Production |
|------|-------|---------|------------|
| OZ Relayer | Docker Container | Docker/K8s | EKS Pod |
| OZ Monitor | Docker Container | Docker/K8s | EKS Pod |
| API Gateway | Docker Container | Docker/K8s | EKS Pod |
| Blockchain | Hardhat Node | Amoy | Polygon Mainnet |
| Database | MySQL Container (Phase 2+) | AWS RDS | AWS RDS Multi-AZ |
| Redis | Container | ElastiCache | ElastiCache Cluster |
| Secrets | docker-compose.yaml | K8s Secret | AWS Secrets Manager |
| Key Management | Local Keystore | AWS KMS | AWS KMS |
| Monitoring | Prometheus Local | Prometheus | Prometheus + Grafana |
| Forwarder | 자동 배포 | 사전 배포 | 사전 배포 |

---

## 8. Docker Compose 구성

> 📋 **상세 Docker Compose 설정**: [tech.md - Section 13](./tech.md#13-docker-compose-설정-v30) 참조

**Docker 파일 위치**:
- 메인 설정: `docker/docker-compose.yaml` (Hardhat Node 로컬 개발)
- Amoy 설정: `docker/docker-compose-amoy.yaml` (Polygon Amoy 테스트넷)
- Dockerfile: `docker/Dockerfile.packages` (멀티스테이지 빌드)

**서비스 구성 개요 (로컬 개발)**:

| Service | Image | Port | 역할 |
|---------|-------|------|------|
| hardhat-node | Custom Build | 8545 | 로컬 블록체인 (Chain ID: 31337) |
| api-gateway | docker/Dockerfile.packages | 3000 | NestJS API Gateway |
| oz-relayer-1~3 | openzeppelin-relayer:v1.3.0 | 8081-8083, 8091-8093 | TX 중계 (Multi-Relayer Pool) |
| oz-monitor | openzeppelin-monitor:v1.1.0 | - | 이벤트 모니터링 (Phase 2+) |
| redis | redis:8.0-alpine | 6379 | OZ Relayer 내부 Queue (AOF 퍼시스턴스) |
| prometheus | prom/prometheus:v2.47.0 | 9090 | Metrics (Phase 2+) |
| grafana | grafana:10.2.0 | 3001 | Dashboard (Phase 2+) |

**Phase 1 핵심 서비스**: hardhat-node, api-gateway, oz-relayer-1~3, redis

**Multi-Relayer Pool 구성 방식**:
- `deploy.replicas` 미사용: 각 Relayer는 고유 Private Key 필요 (Nonce 충돌 방지)
- **YAML Anchors 패턴** 사용: 공통 설정 재사용으로 중복 최소화
- Phase 2+: Kubernetes StatefulSet으로 진정한 Replica 패턴 구현 예정

---

## 관련 문서

- 제품 요구사항 (WHAT/WHY) -> [product.md](./product.md)
- 기술 상세 (Docker, API) (HOW) -> [tech.md](./tech.md)

---

## HISTORY

| 버전 | 날짜 | 변경사항 |
|------|------|----------|
| 12.0 | 2025-12-15 | 문서 버전 동기화 - 전체 문서 구조 정리 완료, 중복 제거, 교차 참조 체계 수립 |
| 11.4 | 2025-12-15 | 문서 역할 명확화 - 관련 문서 섹션 추가 (cross-references) |
| 11.3 | 2025-12-15 | 섹션 번호 중복 수정 - 1.3 Unified Request Flow를 1.4로 변경 (1.3 Multi-Relayer Pool Architecture와 중복 해소) |
| 11.2 | 2025-12-15 | Multi-Relayer Pool 구성 방식 설명 추가 - YAML Anchors 패턴 사용 이유, deploy.replicas 미사용 이유 (개별 Private Key 필요) |
| 11.1 | 2025-12-15 | Section 4.3.1 Auth 모듈 상세 추가 - Phase 1 단일 환경변수 방식 (API_GATEWAY_API_KEY), 모듈 구조, Phase 2+ 확장 계획 |
| 11.0 | 2025-12-15 | SPEC-INFRA-001 기준 Docker 구조 동기화 - docker/ 디렉토리로 통합, 멀티스테이지 빌드, .env 제거, Hardhat Node 포함, Redis 8.0-alpine (AOF 퍼시스턴스), Named Volume (msq-relayer-redis-data), OZ Relayer RPC_URL 환경변수, Read-only 볼륨 |
| 10.0 | 2025-12-15 | MySQL/Prisma를 Phase 2+로 이동 - Phase 1은 OZ Relayer + Redis만 사용, DB 없음 |
| 9.0 | 2025-12-15 | TX History, Webhook Handler를 Phase 2+로 이동 - Phase 1은 상태 폴링 방식 사용, MySQL/Webhook은 Phase 2+에서 구현 |
| 8.0 | 2025-12-15 | Rate Limiting, Quota Manager 완전 제거 - Phase 1은 Auth + Relay 기능만 유지, Policy/Quota는 Phase 2+ 미정 |
| 7.0 | 2025-12-15 | Phase 2 재설계 - SDK 제거 (API 문서로 대체), Queue System 추가 (QUEUE_PROVIDER 패턴) |
| 6.2 | 2025-12-15 | Docker 구조 확정 - 패키지별 Dockerfile 방식 채택 (packages/api-gateway/Dockerfile), .dockerignore 추가 |
| 6.1 | 2025-12-15 | Multi-Relayer Pool 아키텍처 추가 - 독립 Private Key 기반 병렬 처리, Load Balancing (Round Robin/Least Load), Manual Scaling (Phase 1), Auto Scaling (Phase 2+) |
| 6.0 | 2025-12-15 | Phase 1에 Gasless TX 포함 - relay/gasless 모듈 Phase 1으로 이동, ERC2771Forwarder 추가, OZ Monitor/Policy/Quota는 Phase 2+ 유지 |
| 5.0 | 2025-12-14 | Phase 1 중심으로 재정리 - 구현 범위 테이블 추가, 모듈별 Phase 구분 명시, OZ Monitor/Gasless를 Phase 2+로 표시 |
| 4.0 | 2025-12-13 | B2B Infrastructure 관점으로 전면 재작성 - Client Services 중심 아키텍처, Gasless Flow에 Client Service 추가 |
| 3.3 | 2025-12-13 | 중복 정리 (Docker/OZ설정 → tech.md 참조), SDK Research 문서 제거 |
| 3.2 | 2025-12-13 | Mermaid 다이어그램 추가 (아키텍처, Direct TX Flow, Gasless TX Flow) |
| 3.1 | 2025-12-13 | README.md를 root로 이동, 디렉토리 구조 다이어그램 업데이트 |
| 3.0 | 2025-12-13 | OZ 오픈소스 (Relayer v1.3.0, Monitor v1.1.0) 기반 아키텍처로 전면 재설계, Nonce/Gas/Retry 모듈 OZ 위임 |
| 2.3 | 2025-12-12 | 문서 일관성 개선, SDK 디렉토리 구조 중복 제거 |
| 2.2 | 2025-12-12 | packages/examples 패키지 추가 |
| 2.1 | 2025-12-12 | packages/sdk를 OZ Defender SDK 호환 구조로 업데이트 |
| 2.0 | 2025-12-12 | 초기 structure.md 생성 |

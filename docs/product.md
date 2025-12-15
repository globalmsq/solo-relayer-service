# MSQ Relayer Service - 제품 문서

## 프로젝트 개요

### 프로젝트명
**Blockchain Transaction Relayer System (MSQ Relayer Service)**

### 문서 버전
- **버전**: 12.0
- **최종 수정일**: 2025-12-15
- **상태**: Phase 1 구현 단계 (Direct + Gasless)

### 관련 문서
- [기술 스택 및 API 스펙](./tech.md)
- [시스템 아키텍처](./structure.md)
- [Task Master PRD](../.taskmaster/docs/prd.txt)

---

## 1. Executive Summary

### 1.1 배경

OpenZeppelin Defender 서비스가 2026년 7월에 종료됨에 따라, **OZ 오픈소스(Relayer + Monitor)**를 활용한 self-hosted **Blockchain Transaction Relayer System**을 구축합니다.

### 1.2 핵심 전략

| 컴포넌트 | 버전 | 역할 |
|----------|------|------|
| **OZ Relayer** | v1.3.0 (Rust, Docker) | 트랜잭션 중계, Nonce 관리, Gas 추정, 재시도 로직 |
| **OZ Monitor** | v1.1.0 (Rust, Docker) | 블록체인 이벤트 모니터링, 잔액 알림 |
| **NestJS API Gateway** | 10.x | 인증, 정책 엔진, API 문서화 (Swagger/OpenAPI) |

### 1.3 핵심 기능

**Phase 1**:
| 기능 | 설명 | 구현 방식 |
|------|------|----------|
| **Direct Transaction** | 자동화 트랜잭션 실행 | OZ Relayer 활용 |
| **Gasless Transaction** | 사용자 가스비 대납 (결제 시스템) | OZ Relayer + ERC2771Forwarder |

**Phase 2+**:
| 기능 | 설명 | 구현 방식 |
|------|------|----------|
| **Queue System** | 트랜잭션 큐잉 및 순차 처리 | Redis(BullMQ) / AWS SQS (QUEUE_PROVIDER) |
| **Policy Engine** | Contract/Method Whitelist, Blacklist | NestJS Policy Module |
| **Monitor Service** | 블록체인 이벤트 모니터링 | OZ Monitor 활용 |

### 1.4 Phase 1 목표

**첫 번째 연동 대상: 결제 시스템**
- Direct TX를 통한 토큰 전송/정산 처리
- Gasless TX를 통한 사용자 가스비 대납 결제
- ERC2771Forwarder 배포 및 EIP-712 서명 검증
- 프로덕션 레벨 API Gateway 구현

### 1.5 핵심 가치 제안

1. **검증된 코드 사용**: OZ 오픈소스 + OpenZeppelin Contracts
2. **서비스 통합 간소화**: 블록체인 복잡성을 추상화하여 내부 서비스가 쉽게 통합
3. **확장성**: 컨테이너 기반 수평 확장으로 대량 트랜잭션 처리

---

## 2. 대상 사용자

> **참고**: MSQ Relayer Service는 **B2B Infrastructure**입니다. End User가 직접 사용하는 것이 아니라, 내부 서비스들이 Relayer API를 호출하여 블록체인 트랜잭션을 처리합니다.

### 2.1 Primary Users (Client Services)

| 클라이언트 서비스 | 설명 | 주요 사용 패턴 |
|-----------------|------|---------------|
| **결제 시스템** | 토큰 기반 결제 처리 | Direct TX - 대량 토큰 전송, 정산 |
| **에어드랍 시스템** | 토큰 대량 발송 서비스 | Direct TX - 배치 처리, 스케줄링 |
| **NFT 서비스** | NFT 민팅/발행 플랫폼 | Gasless TX - End User 가스비 대납 |
| **DeFi 서비스** | Oracle, Keeper Bot | Direct TX - 자동화 트랜잭션 |
| **게임 서비스** | 게임 내 토큰/NFT 처리 | Gasless TX - 원활한 UX 제공 |

### 2.2 Internal Users (운영/개발)

| 사용자 그룹 | 설명 | 주요 니즈 |
|------------|------|----------|
| **서비스 개발팀** | Client Service 개발자 | SDK 통합, API 호출 패턴 |
| **인프라팀** | Relayer 시스템 운영 | 모니터링, 확장, 장애 대응 |
| **보안팀** | 시스템 보안 담당 | Policy 설정, 감사 로그 |

---

## 3. 기능 요구사항

### 3.1 Phase 1: Direct TX + Gasless TX + 결제 시스템 연동

**Infrastructure**:
| 기능 | 설명 |
|------|------|
| Docker Compose | OZ Relayer + Redis |
| OZ Relayer 설정 | config.json (Polygon Amoy/Mainnet) |
| 로컬 개발 환경 | 개발/테스트 환경 구성 |

**Smart Contracts**:
| 기능 | 설명 |
|------|------|
| ERC2771Forwarder | OpenZeppelin Forwarder 배포 |
| Sample Contracts | ERC20/ERC721 + ERC2771Context 예제 |

**API Gateway (프로덕션 레벨)**:
| 기능 | 설명 |
|------|------|
| NestJS 프로젝트 | 프로덕션 스캐폴드 |
| API Key 인증 | 단일 환경변수 (`API_GATEWAY_API_KEY`), Header: `X-API-Key` |
| Health Check | `/api/v1/health` |
| Direct TX 엔드포인트 | `/api/v1/relay/direct` |
| Gasless TX 엔드포인트 | `/api/v1/relay/gasless` |
| Nonce 조회 | `/api/v1/relay/nonce/{address}` |
| 상태 조회 | `/api/v1/relay/status/{txId}` (폴링 방식) |
| EIP-712 서명 검증 | Gasless TX 사전 검증 |

**Phase 1 Use Case**: 결제 시스템 연동
- Direct TX: 정산 시 다수 사용자에게 토큰 전송
- Gasless TX: End User 가스비 대납 결제 처리
- End User가 EIP-712 서명 → 결제 시스템 → Relayer API

---

### 3.2 Phase 2+: 추후 구현

**TX History & Webhook (P1)**:
- MySQL (Transaction History 저장)
- Webhook Handler (OZ Relayer 상태 알림 처리)
- 상태 변경 Push 알림

**Queue System (P1)**:
- Queue Adapter 패턴 (QUEUE_PROVIDER 설정)
- Redis + BullMQ 구현 (기본)
- AWS SQS 구현 (옵션)
- Job 상태 추적 API

**Policy Engine (P1)**:
- Contract Whitelist 검증
- User Blacklist

**Monitor Service (P2)**:
- OZ Monitor 설정
- Relayer 잔액 모니터링
- Slack/Discord 알림

**Infrastructure 고도화 (P2)**:
- Kubernetes 매니페스트
- CI/CD 파이프라인

---

## 4. Transaction 유형 비교

| 구분 | Direct Transaction | Gasless (Meta-TX) |
|------|-------------------|-------------------|
| **호출자** | Client Service (Server-to-Server) | Client Service (End User 서명 전달) |
| **서명 주체** | Relayer Private Key | End User Private Key (EIP-712) |
| **msg.sender** | Relayer 주소 | End User 주소 (_msgSender) |
| **가스비 부담** | Relayer (서비스 비용) | Relayer (서비스가 대납) |
| **주요 Client** | 결제/에어드랍/Oracle 시스템 | NFT/게임/토큰 서비스 |

---

## 5. 지원 블록체인 네트워크

| Network | Chain ID | Type | Forwarder 배포 | 우선순위 |
|---------|----------|------|----------------|----------|
| Hardhat Node | 31337 | Local Dev | 자동 배포 | P0 |
| Polygon Amoy | 80002 | Testnet | 사전 배포 | P0 |
| Polygon Mainnet | 137 | Mainnet | 사전 배포 | P0 |
| Ethereum Mainnet | 1 | Mainnet | 사전 배포 | P1 |
| Ethereum Sepolia | 11155111 | Testnet | 사전 배포 | P1 |
| BNB Smart Chain | 56 | Mainnet | 사전 배포 | P2 |
| BNB Testnet | 97 | Testnet | 사전 배포 | P2 |

---

## 6. 마일스톤

> 📋 **상세 마일스톤**: [Task Master PRD](../.taskmaster/docs/prd.txt) 참조

### Phase 1: 결제 시스템 연동 (Direct + Gasless)

| Week | 핵심 목표 |
|------|----------|
| **Week 1** | Infrastructure + API Gateway 기본 구성 |
| **Week 2** | Direct TX API + OZ Relayer 프록시 |
| **Week 3** | ERC2771Forwarder 배포 + Gasless TX API |
| **Week 4** | EIP-712 서명 검증 + 결제 시스템 연동 |
| **Week 5** | 프로덕션 안정화 + 문서화 |

### Phase 2+: 추후 확장 (미정)

- TX History (MySQL) + Webhook Handler
- Queue System (Redis/BullMQ 또는 AWS SQS)
- Policy Engine (Contract/Method Whitelist)
- OZ Monitor 통합
- Kubernetes / CI/CD

---

## 7. 리스크 및 완화

| 리스크 | 영향도 | 완화 방안 |
|--------|--------|----------|
| RPC 노드 장애 | 높음 | Multi-RPC, Circuit Breaker |
| Private Key 유출 | 치명적 | AWS KMS (Production), Key Rotation |
| Nonce 충돌 | 높음 | OZ Relayer 내장 Nonce 관리 |
| Gas 급등 | 중간 | Gas Price Cap (백엔드), 자동 중단 |
| Gasless Abuse | 중간 | Policy Engine, Blacklist (백엔드) |
| Relayer 잔액 고갈 | 높음 | OZ Monitor 잔액 모니터링, 자동 알림 |
| OZ 취약점 발견 | 중간 | OZ 업데이트 모니터링, 신속 패치 |
| AGPL-3.0 라이선스 | 중간 | 수정 사항 소스 공개 준비 |

---

## 8. 성공 지표

| 지표 | 목표값 | 측정 방법 |
|------|--------|----------|
| 트랜잭션 성공률 | >= 99.5% | 모니터링 대시보드 |
| 응답 시간 (P95) | < 3초 | API 메트릭 |
| 시스템 가용성 | >= 99.9% | 업타임 모니터링 |
| Gasless 일일 처리량 | >= 10,000 TX | 분석 대시보드 |
| OZ 서비스 안정성 | >= 99.9% uptime | OZ Monitor 메트릭 |

---

## 관련 문서

- 시스템 아키텍처 (WHERE) -> [structure.md](./structure.md)
- 기술 상세 구현 (HOW) -> [tech.md](./tech.md)
- 요구사항 (Task Master용) -> [prd.txt](../.taskmaster/docs/prd.txt)

---

## HISTORY

| 버전 | 날짜 | 변경사항 |
|------|------|----------|
| 12.0 | 2025-12-15 | 문서 버전 동기화 - 전체 문서 구조 정리 완료, 중복 제거, 교차 참조 체계 수립 |
| 11.3 | 2025-12-15 | 문서 역할 명확화 - 관련 문서 섹션 추가 (cross-references) |
| 11.2 | 2025-12-15 | 문서 버전 동기화 - Docker Compose YAML Anchors 패턴 적용 (tech.md, prd.txt 참조) |
| 11.1 | 2025-12-15 | API Key 인증 명세 추가 - Phase 1 단일 환경변수 방식 (API_GATEWAY_API_KEY) 명시 |
| 11.0 | 2025-12-15 | SPEC-INFRA-001 기준 Docker 구조 동기화 - docker/ 디렉토리로 통합, 관련 문서(structure.md, tech.md) 업데이트 |
| 10.0 | 2025-12-15 | MySQL/Prisma를 Phase 2+로 이동 - Phase 1은 OZ Relayer + Redis만 사용, DB 없음 |
| 9.0 | 2025-12-15 | TX History, Webhook Handler를 Phase 2+로 이동 - Phase 1은 상태 폴링 방식 사용 |
| 8.0 | 2025-12-15 | Rate Limiting, Quota Manager 완전 제거 - Phase 1은 Auth + Relay 기능만 유지 |
| 7.0 | 2025-12-15 | Phase 2 재설계 - Queue System 추가, SDK 제거 후 API 문서화로 대체 |
| 6.0 | 2025-12-15 | Phase 1에 Gasless TX 포함 - 결제 시스템 Gasless 결제 지원, ERC2771Forwarder/EIP-712 검증 Phase 1으로 이동, Policy/Quota는 Phase 2 유지 |
| 5.0 | 2025-12-14 | Phase 1 중심으로 재정리 - MVP 용어를 Phase 1로 변경, 결제 시스템 연동 목표 |
| 5.0 | 2025-12-13 | Phase 1 중심으로 간소화 - 결제 시스템 연동 목표, Gasless/Monitor를 Phase 2+로 분리 |
| 4.0 | 2025-12-13 | B2B Infrastructure 관점으로 전면 재작성 - 대상 사용자를 Client Services로 변경 |
| 3.0 | 2025-12-13 | OZ 오픈소스 (Relayer v1.3.0, Monitor v1.1.0) 기반 아키텍처로 전면 재설계 |

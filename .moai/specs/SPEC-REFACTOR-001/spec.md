---
id: SPEC-REFACTOR-001
version: "1.0.0"
status: "approved"
created: "2026-02-05"
updated: "2026-02-05"
author: "Claude"
priority: "HIGH"
---

## HISTORY

| Version | Date       | Author | Changes           |
|---------|------------|--------|-------------------|
| 1.0.0   | 2026-02-05 | Claude | Initial SPEC creation |

---

# SPEC-REFACTOR-001: Project Rename - msq-relayer-service → solo-relayer-service

## 1. Overview

프로젝트 전체 이름을 `msq-relayer-service`에서 `solo-relayer-service`로 변경합니다.

### 1.1 Background

프로젝트 브랜딩 변경에 따라 모든 패키지명, Docker 설정, 소스 코드, 문서에서 MSQ 관련 명칭을 Solo로 변경해야 합니다.

### 1.2 Key Decisions

| 항목 | 변경 전 | 변경 후 | 비고 |
|------|---------|---------|------|
| Contract | MSQForwarder | SoloForwarder | 계약 재배포 필요 |
| Network | msq-network | solo-network | 외부 네트워크도 변경 |
| Docker Volume | msq-relayer-* | solo-relayer-* | 데이터 초기화 |
| Database | msq_relayer | solo_relayer | 스키마 재생성 |

---

## 2. Requirements (EARS Format)

### 2.1 Ubiquitous Requirements

**[U-RENAME-001]** The system SHALL rename all npm package scopes from `@msq-relayer/*` to `@solo-relayer/*`.

**[U-RENAME-002]** The system SHALL rename the root project from `msq-relayer-service` to `solo-relayer-service`.

**[U-RENAME-003]** The system SHALL update all Docker network names from `msq-relayer-network` to `solo-relayer-network`.

**[U-RENAME-004]** The system SHALL update all Docker volume names from `msq-relayer-*` to `solo-relayer-*`.

**[U-RENAME-005]** The system SHALL update database name from `msq_relayer` to `solo_relayer`.

### 2.2 Event-Driven Requirements

**[E-RENAME-001]** WHEN the project is renamed, THEN the ERC2771Forwarder contract MUST be redeployed with name `SoloForwarder`.

**[E-RENAME-002]** WHEN Docker services are rebuilt, THEN all volumes MUST be recreated with new names.

### 2.3 State-Driven Requirements

**[S-RENAME-001]** WHILE the system is operational, the API documentation title SHALL display `Solo Relayer Service API`.

**[S-RENAME-002]** WHILE the system is operational, the health endpoint SHALL identify the service as `Solo Relayer`.

### 2.4 Unwanted Behavior Requirements

**[UN-RENAME-001]** The system SHALL NOT use `MSQ` in any user-facing string after migration.

**[UN-RENAME-002]** The system SHALL NOT retain old volume names that could cause data inconsistency.

### 2.5 Optional Feature Requirements

**[O-RENAME-001]** IF changelog history is preserved, THEN historical references to MSQ MAY remain unchanged.

---

## 3. Scope

### 3.1 In Scope

- Package configuration (7 files)
- Docker configuration (8+ files)
- Source code changes (8 files)
- Environment files (5 files)
- CI/CD workflows (1 file)
- Documentation (20+ files)
- OZ Relayer config (6 files)

### 3.2 Out of Scope

- External service notifications
- Production deployment
- Data migration from existing volumes

---

## 4. Technical Constraints

### 4.1 Dependencies

- pnpm workspace (monorepo)
- Docker Compose v2
- Hardhat for contract deployment
- GitHub Actions CI/CD

### 4.2 Compatibility

- Node.js >= 18.0.0
- pnpm 9.15.1
- Docker 20.10+

---

## 5. Search-Replace Pattern Summary

| Pattern | Replacement | Scope |
|---------|-------------|-------|
| `msq-relayer-service` | `solo-relayer-service` | Project name |
| `@msq-relayer/` | `@solo-relayer/` | NPM scope |
| `MSQ Relayer Service` | `Solo Relayer Service` | Display name |
| `MSQ Relayer` | `Solo Relayer` | Short name |
| `MSQForwarder` | `SoloForwarder` | Contract name |
| `msq-relayer-network` | `solo-relayer-network` | Docker network |
| `msq-network` | `solo-network` | External network |
| `msq-relayer-redis-data` | `solo-relayer-redis-data` | Docker volume |
| `msq-relayer-mysql-data` | `solo-relayer-mysql-data` | Docker volume |
| `msq_relayer` | `solo_relayer` | Database name |
| `MSQ Contracts` | `Solo Contracts` | Contracts package |
| `MSQ Relay API` | `Solo Relay API` | API package |

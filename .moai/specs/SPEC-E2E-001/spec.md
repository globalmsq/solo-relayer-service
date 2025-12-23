---
id: SPEC-E2E-001
version: "1.0.0"
status: "draft"
created: "2025-12-23"
updated: "2025-12-23"
author: "Harry"
priority: "high"
---

# SPEC-E2E-001: E2E 테스트 인프라 및 결제 시스템 연동 검증

## HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-12-23 | Harry | 초안 작성 - E2E 테스트 인프라 구축 및 결제 시스템 검증 |

## 개요

| 항목 | 내용 |
|------|------|
| **SPEC ID** | SPEC-E2E-001 |
| **제목** | E2E 테스트 인프라 및 결제 시스템 연동 검증 |
| **상태** | draft |
| **생성일** | 2025-12-23 |
| **수정일** | 2025-12-23 |
| **우선순위** | high |
| **의존성** | SPEC-PROXY-001, SPEC-GASLESS-001, SPEC-STATUS-001 |
| **관련 Task** | Task #11 (Integration Tests and Payment System Verification) |

## 문제 정의

MSQ Relayer Service는 Direct Transaction, Gasless Transaction, Status Polling, Health Check API를 제공하지만, 현재 E2E 테스트 인프라가 부재하여 전체 플로우 검증이 불가능합니다.

**해결해야 할 문제**:
1. HTTP 엔드포인트 수준의 통합 테스트 부재
2. EIP-712 서명 검증 플로우 테스트 부재
3. 결제 시스템 연동 시나리오 검증 불가
4. 외부 서비스(OZ Relayer, RPC) Mock 전략 부재

**Phase 1 범위**: Mock 기반 E2E 테스트 (실제 블록체인 호출 제외)
**Phase 2+ 범위** (별도 SPEC): Docker 기반 실제 통합 테스트 (Task #13)

## 솔루션

supertest, NestJS Testing Module, ethers.js를 활용한 E2E 테스트 인프라를 구축하여:

1. 5개 API 엔드포인트의 전체 플로우 검증
2. EIP-712 서명 생성 및 검증 유틸리티 제공
3. Mock OZ Relayer 응답을 통한 외부 의존성 제거
4. 결제 시스템 연동 시나리오 (Nonce → 서명 → 제출 → 상태 조회) 검증

**아키텍처**:
```
E2E Test Suite
├── supertest → HTTP 엔드포인트 테스트
├── @nestjs/testing → NestJS 앱 팩토리
├── ethers.js → EIP-712 서명 생성
└── Jest Spy → OZ Relayer Mock 응답
```

**설계 원칙**: 외부 서비스 의존성 제거, 빠른 피드백, 유닛 테스트 격리

---

## Environment (환경 요구사항)

### ENV-E2E-001: NestJS Testing Module
**조건**: supertest ^7.0.0, @types/supertest ^6.0.0 설치
**설명**: HTTP 엔드포인트 테스트를 위한 supertest 라이브러리 필수
**검증**: `pnpm list supertest` 명령어로 확인

### ENV-E2E-002: Jest E2E 구성
**조건**: jest-e2e.json 설정 파일 존재
**설명**: E2E 테스트와 유닛 테스트 분리 실행을 위한 Jest 설정
**내용**:
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "moduleNameMapper": { "^src/(.*)$": "<rootDir>/src/$1" },
  "testTimeout": 30000
}
```

### ENV-E2E-003: EIP-712 서명 유틸리티
**조건**: ethers.js 라이브러리 (이미 설치됨)
**설명**: Gasless 트랜잭션 서명 생성 및 검증
**참조**: `packages/relay-api/scripts/test-gasless.ts` 패턴 재사용

### ENV-E2E-004: 테스트 환경 격리
**조건**: 외부 서비스 Mock (OZ Relayer, RPC)
**설명**: 실제 블록체인 호출 없이 E2E 테스트 수행
**방법**: Jest Spy를 사용한 OZ Relayer HTTP 호출 Mock

---

## Assumptions (가정사항)

### A-E2E-001: 유닛 테스트 완료
**가정**: 모든 유닛 테스트가 통과한 상태에서 E2E 테스트 시작
**영향**: E2E 실패 시 유닛 테스트 수준의 버그는 아님
**검증**: `pnpm test` 명령어로 유닛 테스트 먼저 실행

### A-E2E-002: OZ Relayer API 스펙 안정성
**가정**: OZ Relayer API 응답 형식이 변경되지 않음
**영향**: Mock 응답 형식의 신뢰성
**대응**: OZ Relayer API 변경 시 `mock-responses.ts` 업데이트

### A-E2E-003: 테스트 커버리지 목표
**가정**: E2E 테스트는 90% 커버리지 목표에 포함되지 않음
**영향**: 유닛 테스트 90% + E2E 테스트 별도 관리
**근거**: E2E 테스트는 통합 검증 목적이지 코드 커버리지 목적이 아님

### A-E2E-004: Hardhat 계정 안정성
**가정**: Hardhat 기본 계정 #0~#2 사용
**영향**: 테스트 지갑 주소 및 서명 일관성
**계정 역할**:
- Account #0: Relayer (트랜잭션 제출)
- Account #1: User (Gasless TX 서명자)
- Account #2: Merchant (수신자)

---

## Requirements (요구사항)

### U-E2E-001: Direct Transaction E2E 테스트 (Ubiquitous - 필수)
**WHEN** 시스템이 `/api/v1/relay/direct` 엔드포인트를 제공할 때
**THEN** 시스템은 유효한 요청에 대해 202 Accepted를 반환해야 함
**AND** 잘못된 요청에 대해 적절한 에러 코드(400/401/503)를 반환해야 함

**테스트 케이스**:
- TC-E2E-D001: 유효한 Direct TX → 202 Accepted
- TC-E2E-D002: 최소 필드만 포함 → 202 Accepted
- TC-E2E-D003: 잘못된 이더리움 주소 → 400 Bad Request
- TC-E2E-D004: 잘못된 hexadecimal data → 400 Bad Request
- TC-E2E-D005: 잘못된 speed enum → 400 Bad Request
- TC-E2E-D006: API key 누락 → 401 Unauthorized
- TC-E2E-D007: 잘못된 API key → 401 Unauthorized
- TC-E2E-D008: OZ Relayer 불가 → 503 Service Unavailable

### U-E2E-002: Gasless Transaction E2E 테스트 (Ubiquitous - 필수)
**WHEN** 시스템이 `/api/v1/relay/gasless` 엔드포인트를 제공할 때
**THEN** 시스템은 EIP-712 서명이 포함된 유효한 요청에 대해 202 Accepted를 반환해야 함
**AND** 서명 검증 실패 시 401 Unauthorized를 반환해야 함

**테스트 케이스**:
- TC-E2E-G001: 유효한 서명 포함 Gasless TX → 202 Accepted
- TC-E2E-G002: Custom gas 및 value 포함 → 202 Accepted
- TC-E2E-G003: Nonce 조회 → 200 OK + 현재 nonce
- TC-E2E-G004: 잘못된 주소로 nonce 조회 → 400 Bad Request
- TC-E2E-G005: 잘못된 서명 형식 → 401 Unauthorized
- TC-E2E-G006: 잘못된 서명자 서명 → 401 Unauthorized
- TC-E2E-G007: 만료된 deadline → 400 Bad Request
- TC-E2E-G008: Nonce 불일치 → 400 Bad Request
- TC-E2E-G009: 잘못된 형식 서명 → 400 Bad Request
- TC-E2E-G010: 필수 필드 누락 → 400 Bad Request

### U-E2E-003: Status Polling E2E 테스트 (Ubiquitous - 필수)
**WHEN** 시스템이 `/api/v1/relay/status/:txId` 엔드포인트를 제공할 때
**THEN** 시스템은 유효한 UUID에 대해 트랜잭션 상태를 반환해야 함
**AND** 존재하지 않는 txId에 대해 404 Not Found를 반환해야 함

**테스트 케이스**:
- TC-E2E-S001: Pending 상태 조회 → 200 + status: pending
- TC-E2E-S002: Confirmed 상태 조회 → 200 + hash + confirmedAt
- TC-E2E-S003: Failed 상태 조회 → 200 + status: failed
- TC-E2E-S004: 잘못된 UUID 형식 → 400 Bad Request
- TC-E2E-S005: OZ Relayer 불가 → 503 Service Unavailable

### U-E2E-004: Health Check E2E 테스트 (Ubiquitous - 필수)
**WHEN** 시스템이 `/api/v1/health` 엔드포인트를 제공할 때
**THEN** 시스템은 API Key 없이도 200 OK를 반환해야 함
**AND** 모든 서비스가 정상일 때 `status: "ok"`를 반환해야 함

**테스트 케이스**:
- TC-E2E-H001: 모든 서비스 정상 → 200 + status: ok
- TC-E2E-H002: Public 엔드포인트 (API key 불필요) → 200 OK
- TC-E2E-H003: OZ Relayer pool 비정상 → 503 Service Unavailable

### E-E2E-001: Payment Integration 시나리오 (Event-driven - 이벤트 기반)
**WHEN** 사용자가 Nonce 조회 → 서명 → Gasless TX 제출 → Status 조회 순서로 요청할 때
**THEN** 시스템은 전체 플로우가 일관되게 동작해야 함

**테스트 케이스**:
- TC-E2E-P001: Batch 토큰 전송 (Direct TX) → 여러 202 응답
- TC-E2E-P002: 전체 Gasless 결제 플로우 → 4단계 완료

### U-E2E-005: EIP-712 서명 유틸리티 (Ubiquitous - 필수)
**WHEN** 테스트가 Gasless 트랜잭션 서명을 생성할 때
**THEN** 시스템은 `test/utils/eip712-signer.ts`의 `signForwardRequest()` 함수를 사용해야 함
**AND** 서명된 ForwardRequest는 GaslessService의 검증을 통과해야 함

**유틸리티 함수**:
- `signForwardRequest(wallet, request)` - EIP-712 서명 생성
- `createForwardRequest(from, to, options)` - ForwardRequest 빌드
- `createExpiredForwardRequest()` - deadline 검증 테스트용

### U-E2E-006: Mock OZ Relayer 응답 (Unwanted - 금지사항)
**WHEN** E2E 테스트를 실행할 때
**THEN** 시스템은 실제 OZ Relayer API를 호출해서는 안 됨 (Unwanted)
**AND** Jest Spy를 사용하여 Mock 응답을 반환해야 함

**금지사항**:
- ❌ 실제 OZ Relayer API 호출
- ❌ 실제 블록체인 RPC 호출
- ❌ 실제 지갑 서명 (Hardhat 테스트 계정만 사용)

---

## Specifications (구체적 사양)

### S-E2E-001: Jest E2E 설정 파일

**파일**: `packages/relay-api/test/jest-e2e.json`

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "moduleNameMapper": { "^src/(.*)$": "<rootDir>/src/$1" },
  "testTimeout": 30000
}
```

**설명**:
- `testRegex`: `.e2e-spec.ts` 파일만 실행
- `testTimeout`: 30초 (외부 API Mock 시간 고려)
- `moduleNameMapper`: src 경로 alias

### S-E2E-002: npm 스크립트 추가

**파일**: `packages/relay-api/package.json`

```json
{
  "scripts": {
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "test:e2e:cov": "jest --config ./test/jest-e2e.json --coverage"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0"
  }
}
```

### S-E2E-003: 디렉토리 구조

```
packages/relay-api/test/
├── e2e/                             # E2E 테스트 스위트
│   ├── direct.e2e-spec.ts          # Direct TX (7 tests)
│   ├── gasless.e2e-spec.ts         # Gasless TX (10 tests)
│   ├── status.e2e-spec.ts          # Status Polling (5 tests)
│   ├── health.e2e-spec.ts          # Health Check (3 tests)
│   └── payment-integration.e2e-spec.ts  # Payment Flow (2 tests)
├── fixtures/                        # 테스트 데이터
│   ├── test-wallets.ts             # Hardhat 계정 #0~#2
│   ├── test-config.ts              # 테스트 환경 설정
│   └── mock-responses.ts           # OZ Relayer Mock 응답
├── utils/                           # 테스트 유틸리티
│   ├── eip712-signer.ts            # EIP-712 서명 유틸
│   ├── encoding.ts                 # ERC-20 인코딩
│   └── test-app.factory.ts         # NestJS 앱 팩토리
└── jest-e2e.json                    # Jest E2E 설정
```

**파일 수**: 신규 11개, 수정 1개 (package.json)

### S-E2E-004: 테스트 케이스 분류

| 카테고리 | 테스트 파일 | 테스트 수 | 주요 검증 |
|---------|------------|---------|---------|
| Direct TX | direct.e2e-spec.ts | 7 | 유효성 검증, 인증, 에러 처리 |
| Gasless TX | gasless.e2e-spec.ts | 10 | 서명 검증, Nonce, 에러 처리 |
| Status | status.e2e-spec.ts | 5 | 상태 조회, 404/503 에러 |
| Health | health.e2e-spec.ts | 3 | 서비스 상태, 공개 엔드포인트 |
| Payment | payment-integration.e2e-spec.ts | 2 | 전체 플로우, 통합 시나리오 |
| **합계** | **5 files** | **27 tests** | **종합 검증** |

---

## 기술적 제약사항

### 기술 스택

| 라이브러리 | 버전 | 용도 | 설치 상태 |
|-----------|------|------|---------|
| supertest | ^7.0.0 | HTTP 엔드포인트 테스트 | ❌ 설치 필요 |
| @types/supertest | ^6.0.0 | TypeScript 타입 정의 | ❌ 설치 필요 |
| ethers.js | (기존) | EIP-712 서명 생성 | ✅ 이미 설치됨 |
| @nestjs/testing | (기존) | NestJS 테스트 유틸 | ✅ 이미 설치됨 |
| jest | (기존) | 테스트 프레임워크 | ✅ 이미 설치됨 |

### 주의사항

**E2E-WARN-001**: 유닛 테스트 간섭 방지
- E2E 테스트는 `test/e2e/` 디렉토리에만 위치
- Jest 설정 파일 분리 (`jest-e2e.json` vs 기본 Jest)
- 테스트 실행 명령어 분리 (`test:e2e` vs `test`)

**E2E-WARN-002**: Mock 응답 일관성 유지
- OZ Relayer API 응답 형식 변경 시 `mock-responses.ts` 업데이트 필요
- 실제 API와 Mock의 일관성 정기적 검증 필요

**E2E-WARN-003**: 테스트 타임아웃 설정
- 기본 타임아웃 30초 (jest-e2e.json)
- 느린 테스트 케이스는 개별 타임아웃 설정 가능 (`jest.setTimeout()`)

**E2E-WARN-004**: 실제 통합 테스트 제외
- Task #11은 Mock 기반 E2E 테스트만 다룸
- Task #13 (Docker 기반 실제 통합 테스트)는 별도 SPEC 필요

---

## Acceptance Criteria (검수 기준)

### 기능 검증

✅ **AC-E2E-001**: Direct Transaction API 7개 테스트 케이스 모두 통과
✅ **AC-E2E-002**: Gasless Transaction API 10개 테스트 케이스 모두 통과
✅ **AC-E2E-003**: Status Polling API 5개 테스트 케이스 모두 통과
✅ **AC-E2E-004**: Health Check API 3개 테스트 케이스 모두 통과
✅ **AC-E2E-005**: Payment Integration 2개 시나리오 테스트 통과

### 품질 검증

✅ **AC-E2E-006**: 기존 유닛 테스트 회귀 없음 (모든 유닛 테스트 통과)
✅ **AC-E2E-007**: E2E 테스트 실행 시간 30초 이내 (타임아웃 설정 준수)
✅ **AC-E2E-008**: Mock 응답 사용으로 외부 서비스 의존성 제거
✅ **AC-E2E-009**: EIP-712 서명 유틸리티가 실제 GaslessService 검증 통과

### 문서화

✅ **AC-E2E-010**: 각 테스트 파일에 Given-When-Then 주석 포함
✅ **AC-E2E-011**: README 또는 TESTING.md에 E2E 테스트 실행 방법 문서화

---

## 보안 고려사항

- **인증**: 기존 API Key 인증 미들웨어 사용
- **입력 검증**: UUID, 이더리움 주소, hexadecimal 검증
- **Rate Limiting**: 기존 rate limiting 설정 상속
- **데이터 저장 없음**: Phase 1은 OZ Relayer로의 순수 프록시 (데이터 저장 없음)

---

## 의존성

**선행 SPEC** (완료됨):
- ✅ SPEC-PROXY-001: OZ Relayer 통합
- ✅ SPEC-GASLESS-001: Gasless 트랜잭션 API
- ✅ SPEC-STATUS-001: Status Polling API

**후속 SPEC** (별도 작성 필요):
- ⏭️ SPEC-E2E-002: Docker 기반 실제 통합 테스트 (Task #13)
- ⏭️ SPEC-LOAD-001: Artillery 부하 테스트 (선택사항)

---

## 예상 노력

- **파일**: 신규 11개, 수정 1개
- **코드 라인**: ~800 LOC (테스트 포함)
- **테스트 케이스**: 27개
- **구현 시간**: ~4시간 (4 Phase)

---

## Phase 2+ 향후 작업 (범위 외)

**Phase 2: 실제 통합 테스트**
- SPEC-E2E-002: Docker Compose 기반 통합 테스트
- 실제 Hardhat 로컬 노드 사용
- 실제 OZ Relayer 인스턴스 사용
- 실제 블록체인 트랜잭션 검증

**Phase 3: 부하 테스트**
- SPEC-LOAD-001: Artillery 기반 부하 테스트
- 동시 요청 처리 검증
- 처리량(throughput) 측정

---

## 참조

- OZ Relayer API: `GET /api/v1/relayers/{relayerId}/transactions/{txId}`
- DirectService 구현: `packages/relay-api/src/relay/direct/direct.service.ts`
- GaslessService 구현: `packages/relay-api/src/relay/gasless/gasless.service.ts`
- StatusService 구현: `packages/relay-api/src/relay/status/status.service.ts`
- EIP-712 서명 패턴: `packages/relay-api/scripts/test-gasless.ts`

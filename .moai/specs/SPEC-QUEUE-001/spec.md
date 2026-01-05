---
id: SPEC-QUEUE-001
version: "1.0.0"
status: "draft"
created: "2026-01-04"
updated: "2026-01-04"
author: "@user"
priority: "high"
---

# SPEC-QUEUE-001: AWS SQS 비동기 트랜잭션 큐 시스템

## HISTORY

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|----------|
| 1.0.0 | 2026-01-04 | @user | 초기 SPEC 작성 |
| 1.1.0 | 2026-01-05 | @user | 검토 피드백 반영: Prisma 스키마, SQS 설정, Breaking Change |

---

## 개요

AWS SQS Standard Queue 기반 비동기 트랜잭션 큐 시스템을 구현합니다. Producer (relay-api)와 Consumer (queue-consumer)를 독립 서비스로 분리하여 확장성과 가용성을 확보합니다.

### 핵심 목표

- **비동기 처리**: relay-api는 즉시 응답하고 SQS에 메시지 전송
- **독립 스케일링**: Producer와 Consumer를 별도로 확장 가능
- **재시도 전략**: DLQ (Dead Letter Queue)를 통한 실패 처리
- **로컬 개발**: LocalStack을 활용한 AWS 서비스 에뮬레이션

### 아키텍처 개요

```
┌─────────────────┐     ┌─────────────────┐
│    relay-api    │     │ queue-consumer  │
│  (API Server)   │     │  (별도 컨테이너) │
│                 │     │                 │
│  POST /relay/*  │     │  SQS Long-poll  │
│  → SQS 전송     │     │  → OZ Relayer   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
     ┌───────┐               ┌───────┐
     │  SQS  │ ◄───────────► │  SQS  │
     └───────┘               └───────┘
```

---

## EARS Requirements

### 1. Functional Requirements (기능 요구사항)

#### FR-1: SQS Producer (relay-api)

**UBIQUITOUS** (항상 활성):
- relay-api는 트랜잭션 요청을 받으면 MySQL에 `pending` 상태로 저장해야 한다.
- 트랜잭션 저장 후 즉시 SQS 큐에 메시지를 전송해야 한다.
- 클라이언트에게 202 Accepted 응답과 `transactionId`를 반환해야 한다.

**EVENT-DRIVEN** (트리거 기반):
- `POST /relay/direct` 요청이 들어올 때, DirectController는 QueueService를 호출하여 SQS에 메시지를 전송해야 한다.
- `POST /relay/gasless` 요청이 들어올 때, GaslessController는 QueueService를 호출하여 SQS에 메시지를 전송해야 한다.

**STATE-DRIVEN** (조건부):
- SQS 전송이 실패하면, 에러를 로깅하고 클라이언트에게 503 Service Unavailable을 반환해야 한다.

#### FR-2: SQS Consumer (queue-consumer)

**UBIQUITOUS** (항상 활성):
- queue-consumer는 SQS Long-polling (20초)으로 메시지를 수신해야 한다.
- 메시지를 수신하면 OZ Relayer로 HTTP 요청을 전송해야 한다.
- OZ Relayer 성공 시 메시지를 SQS에서 삭제하고 MySQL 트랜잭션 상태를 `success`로 업데이트해야 한다.

**EVENT-DRIVEN** (트리거 기반):
- OZ Relayer 전송이 실패할 때, 메시지를 SQS에 반환하여 재시도해야 한다.
- 메시지가 3회 재시도 후에도 실패하면, DLQ (Dead Letter Queue)로 이동해야 한다.

**STATE-DRIVEN** (조건부):
- DLQ로 이동한 메시지는 MySQL 트랜잭션 상태를 `failed`로 업데이트하고 에러 메시지를 기록해야 한다.

#### FR-3: Dual Credentials Strategy

**UBIQUITOUS** (항상 활성):
- `SQS_ENDPOINT_URL` 환경변수가 설정된 경우 LocalStack을 사용해야 한다.
- `SQS_ENDPOINT_URL`이 없는 경우 IAM Instance Role을 사용해야 한다.

**UNWANTED** (금지):
- Production 환경에서 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`를 하드코딩해서는 안 된다.

---

### 2. Non-Functional Requirements (비기능 요구사항)

#### NFR-1: 성능

- **Long-polling**: SQS Consumer는 20초 Long-polling을 사용하여 API 호출 빈도를 줄여야 한다.
- **처리량**: Consumer는 초당 최소 10개 메시지를 처리할 수 있어야 한다.
- **응답 시간**: relay-api는 200ms 이내에 202 Accepted 응답을 반환해야 한다.
- **Visibility Timeout**: SQS 메시지 처리 중 다른 Consumer가 동일 메시지를 수신하지 않도록 30-60초로 설정해야 한다.
- **Message Retention**: 처리되지 않은 메시지는 최대 4일간 보관해야 한다.

#### NFR-2: 가용성

- **Health Check**: relay-api와 queue-consumer 모두 Health Check 엔드포인트를 제공해야 한다.
- **재시도 전략**: 메시지는 최대 3회 재시도 후 DLQ로 이동해야 한다.
- **장애 격리**: Producer와 Consumer가 독립적으로 배포/재시작될 수 있어야 한다.

#### NFR-3: 확장성

- **독립 스케일링**: relay-api와 queue-consumer를 별도로 스케일링할 수 있어야 한다.
- **수평 확장**: Consumer 인스턴스를 추가하여 처리량을 선형적으로 증가시킬 수 있어야 한다.

---

### 3. Interface Requirements (인터페이스 요구사항)

#### IR-1: AWS SQS SDK

- **라이브러리**: `@aws-sdk/client-sqs` 최신 stable 버전 사용
- **Operations**:
  - `SendMessageCommand`: 메시지 전송 (Producer)
  - `ReceiveMessageCommand`: 메시지 수신 (Consumer, Long-polling)
  - `DeleteMessageCommand`: 메시지 삭제 (성공 시)

#### IR-2: LocalStack Integration

- **버전**: `localstack/localstack:3.0`
- **서비스**: SQS만 활성화
- **Web UI**: Port 4566에서 LocalStack 대시보드 제공
- **Init Script**: 컨테이너 시작 시 SQS 큐 자동 생성

#### IR-3: OZ Relayer Client

- **Protocol**: HTTP/HTTPS
- **Method**: POST
- **Authentication**: API Key (header)
- **Retry**: Consumer가 실패 시 자동 재시도

---

### 4. Design Constraints (설계 제약사항)

#### DC-1: Docker Compose (로컬 개발 전용)

- **환경**: 로컬 개발 환경만 지원
- **하드코딩**: 환경변수 값을 docker-compose.yaml에 직접 설정
- **`.env` 미사용**: docker-compose는 `.env` 파일을 참조하지 않음

#### DC-2: AWS Region

- **Region**: ap-northeast-2 (서울)
- **Queue URL Format**:
  - Local: `http://localhost:4566/000000000000/relay-transactions`
  - Production: `https://sqs.ap-northeast-2.amazonaws.com/{account-id}/relay-transactions`

#### DC-3: Package Manager

- **pnpm**: 모든 패키지는 pnpm으로 관리
- **Monorepo**: packages/relay-api, packages/queue-consumer 분리

#### DC-4: 기존 인프라 재활용

- **MySQL**: 기존 `transactions` 테이블 재활용
- **Redis**: L1 캐시로 기존 Redis 사용
- **OZ Relayer**: 기존 OZ Relayer 인스턴스 활용

#### DC-5: Prisma 스키마 필수 필드

- **type**: 트랜잭션 유형 구분 ('direct' | 'gasless')
- **request**: 원본 요청 데이터 전체 저장 (JSON)
- **result**: OZ Relayer 응답 데이터 저장 (JSON) - hash, transactionId 포함
- **error_message**: 실패 시 에러 메시지 저장 (TEXT)

```prisma
model Transaction {
  // ... existing fields
  type          String?   // 'direct' | 'gasless'
  request       Json?     // 원본 요청 JSON
  result        Json?     // OZ Relayer 응답 JSON
  error_message String?   @db.Text

  @@index([status])
  @@index([type])
  @@index([createdAt])
}
```

---

### 5. Acceptance Criteria (수락 기준)

#### AC-1: 정상 메시지 처리

**Given**: relay-api가 정상 동작 중이고, LocalStack SQS가 실행 중일 때

**When**: `POST /relay/direct`로 트랜잭션 요청이 들어오면

**Then**:
1. 202 Accepted 응답과 `transactionId`를 반환한다.
2. SQS 큐에 메시지가 전송된다.
3. queue-consumer가 메시지를 수신하여 OZ Relayer로 전송한다.
4. 트랜잭션 상태가 `success`로 업데이트된다.
5. `GET /relay/status/:transactionId`로 상태를 조회할 수 있다.

#### AC-2: DLQ 처리

**Given**: queue-consumer가 OZ Relayer 전송에 실패할 때

**When**: 메시지를 3회 재시도해도 실패하면

**Then**:
1. 메시지가 DLQ로 이동한다.
2. 트랜잭션 상태가 `failed`로 업데이트된다.
3. 에러 메시지가 MySQL에 기록된다.
4. LocalStack Web UI에서 DLQ에 메시지가 있음을 확인할 수 있다.

#### AC-3: 중복 메시지 처리 (At-Least-Once)

**Given**: SQS Standard Queue는 at-least-once 전달을 보장하며, 동일 메시지가 여러 번 수신될 수 있다.

**When**: queue-consumer가 동일한 `transactionId`의 메시지를 중복 수신하면

**Then**:
1. Consumer는 MySQL에서 트랜잭션 상태를 확인한다.
2. 이미 `success` 또는 `failed` 상태인 경우, 메시지를 삭제하고 처리를 건너뛴다.
3. 중복 처리로 인한 부작용이 발생하지 않아야 한다 (Idempotent).

#### AC-4: Breaking Change (Sync → Async 전환)

**Given**: 기존 `POST /api/v1/relay/direct` API는 동기 방식으로 즉시 `hash`를 반환했다.

**When**: SQS Queue 시스템 적용 후

**Then**:
1. 응답이 202 Accepted로 변경된다.
2. 응답 본문에 `hash` 필드가 제거되고 `transactionId`가 포함된다.
3. 클라이언트는 `GET /api/v1/relay/status/:transactionId` 또는 Webhook으로 결과를 확인해야 한다.
4. 기존 클라이언트는 마이그레이션이 필요하다.

**클라이언트 마이그레이션 가이드**:
- 이전: 즉시 `{ hash, status: 'success' }` 수신
- 이후: `{ transactionId, status: 'pending' }` 수신 → Polling 또는 Webhook으로 최종 결과 확인

---

## Dependencies

### 선행 작업

- **SPEC-INFRA-001**: Docker 인프라 구성 (완료)
- **SPEC-PROXY-001**: relay-api 기본 구조 (완료)
- **Task #11**: 트랜잭션 테이블 및 OZ Relayer 연동 (완료 확인 필요)

### 신규 의존성

| 패키지 | 버전 | 용도 |
|--------|------|------|
| @aws-sdk/client-sqs | ^3.700.0 | AWS SQS 클라이언트 |
| aws-sdk-client-mock | ^3.0.0 | Unit test용 SDK mock |
| localstack/localstack | 3.0 | Docker 이미지 |

---

## Quality Gates

- **테스트 커버리지**: ≥90% (config.json 기준)
- **TRUST 5 준수**: Test-first, Readable, Unified, Secured, Trackable
- **요구사항 모듈 수**: 5개 이하 (FR-1, FR-2, FR-3, NFR, IR - 총 5개) ✅
- **EARS 형식**: 모든 요구사항이 EARS 패턴을 따름 ✅

---

## Traceability

- **TAG**: SPEC-QUEUE-001
- **Related SPECs**: SPEC-INFRA-001, SPEC-PROXY-001
- **Related Tasks**: Task #15
- **Git Branch**: feature/SPEC-QUEUE-001

---

## Notes

- LocalStack Web UI는 `http://localhost:4566`에서 접근 가능
- Production 배포 시 IAM Instance Role로 자동 전환됨
- Consumer는 별도 패키지로 분리되어 독립 배포 가능
- Health Check는 `/health` 엔드포인트로 제공

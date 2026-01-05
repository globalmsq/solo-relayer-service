---
id: SPEC-QUEUE-001
title: "Acceptance Criteria - AWS SQS Queue System"
version: "1.0.0"
created: "2026-01-04"
updated: "2026-01-04"
---

# Acceptance Criteria: AWS SQS 비동기 트랜잭션 큐 시스템

## 테스트 시나리오 개요

AWS SQS 비동기 트랜잭션 큐 시스템의 정상 동작과 예외 상황을 검증하기 위한 수락 기준입니다. 모든 시나리오는 Given/When/Then 형식으로 작성되며, LocalStack 환경에서 테스트 가능합니다.

---

## Scenario 1: 정상 메시지 처리 플로우

### 목표
relay-api가 트랜잭션을 SQS에 전송하고, queue-consumer가 메시지를 처리하여 OZ Relayer로 전송하는 정상 플로우를 검증합니다.

### Given (전제 조건)

- LocalStack SQS가 실행 중이고 Health Check가 통과 상태입니다.
- relay-api가 정상 동작 중이고 `/health` 엔드포인트가 200 OK를 반환합니다.
- queue-consumer가 정상 동작 중이고 SQS Long-polling이 활성화되어 있습니다.
- OZ Relayer Mock 서버가 실행 중이고 POST 요청을 수락합니다.
- MySQL 데이터베이스가 실행 중이고 `transactions` 테이블이 준비되어 있습니다.

### When (실행 조건)

1. 클라이언트가 `POST /api/v1/relay/direct`로 트랜잭션 요청을 전송합니다.

**요청 예시**:
```json
POST /api/v1/relay/direct
Content-Type: application/json

{
  "to": "0x1234567890abcdef1234567890abcdef12345678",
  "data": "0xabcdef",
  "value": "0",
  "gasLimit": "21000"
}
```

2. relay-api는 트랜잭션을 MySQL에 `pending` 상태로 저장합니다.
3. relay-api는 SQS 큐에 메시지를 전송합니다.
4. relay-api는 202 Accepted 응답과 `transactionId`를 반환합니다.

### Then (기대 결과)

#### 1. relay-api 응답 검증

**응답 예시**:
```json
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "transactionId": "tx-12345678-abcd-1234-efgh-567890abcdef",
  "status": "pending",
  "message": "Transaction queued for processing"
}
```

**검증 항목**:
- [ ] HTTP 상태 코드: 202 Accepted
- [ ] 응답 본문에 `transactionId` 필드 존재
- [ ] 응답 본문에 `status: "pending"` 포함
- [ ] `transactionId`가 UUID v4 형식

#### 2. MySQL 데이터 검증

**SQL 쿼리**:
```sql
SELECT id, status, type, request, created_at
FROM transactions
WHERE id = 'tx-12345678-abcd-1234-efgh-567890abcdef';
```

**기대 결과**:
```
id: tx-12345678-abcd-1234-efgh-567890abcdef
status: pending
type: direct
request: { JSON 데이터 }
created_at: 2026-01-04 12:00:00
```

**검증 항목**:
- [ ] `status`가 `pending`
- [ ] `type`이 `direct`
- [ ] `request` 필드에 원본 요청 데이터 저장

#### 3. SQS 메시지 검증

**LocalStack Web UI 확인**:
- URL: `http://localhost:4566`
- Queue: `relay-transactions`

**awslocal CLI 확인**:
```bash
awslocal sqs receive-message \
  --queue-url http://localhost:4566/000000000000/relay-transactions \
  --max-number-of-messages 1
```

**기대 메시지**:
```json
{
  "MessageId": "msg-uuid-v4",
  "Body": "{\"transactionId\":\"tx-12345678-abcd-1234-efgh-567890abcdef\",\"type\":\"direct\",\"request\":{...}}"
}
```

**검증 항목**:
- [ ] SQS 큐에 메시지가 1개 존재
- [ ] 메시지 본문에 `transactionId` 포함
- [ ] 메시지 본문에 `type: "direct"` 포함

#### 4. Consumer 처리 검증

**Consumer 로그 확인**:
```
[Consumer] Received message: tx-12345678-abcd-1234-efgh-567890abcdef
[Consumer] Sending to OZ Relayer: http://oz-relayer-1:8080/relay
[Consumer] OZ Relayer response: 200 OK
[Consumer] Message processed successfully
[Consumer] Deleted message from SQS
```

**검증 항목**:
- [ ] Consumer가 메시지를 수신
- [ ] OZ Relayer로 HTTP POST 요청 전송
- [ ] OZ Relayer가 200 OK 응답
- [ ] SQS에서 메시지 삭제

#### 5. 트랜잭션 상태 업데이트 검증

**SQL 쿼리**:
```sql
SELECT id, status, result, updated_at
FROM transactions
WHERE id = 'tx-12345678-abcd-1234-efgh-567890abcdef';
```

**기대 결과**:
```
id: tx-12345678-abcd-1234-efgh-567890abcdef
status: success
result: { OZ Relayer 응답 데이터 }
updated_at: 2026-01-04 12:00:05
```

**검증 항목**:
- [ ] `status`가 `success`로 변경
- [ ] `result` 필드에 OZ Relayer 응답 저장
- [ ] `updated_at`이 현재 시간

#### 6. 상태 조회 API 검증

**요청**:
```
GET /api/v1/relay/status/tx-12345678-abcd-1234-efgh-567890abcdef
```

**응답**:
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "transactionId": "tx-12345678-abcd-1234-efgh-567890abcdef",
  "status": "success",
  "result": {
    "txHash": "0xabcdef...",
    "blockNumber": 12345
  }
}
```

**검증 항목**:
- [ ] HTTP 상태 코드: 200 OK
- [ ] `status`가 `success`
- [ ] `result` 필드에 OZ Relayer 응답 포함

---

## Scenario 2: DLQ 처리 플로우 (3회 재시도 실패)

### 목표
OZ Relayer 전송이 3회 연속 실패하면 메시지가 DLQ (Dead Letter Queue)로 이동하는 것을 검증합니다.

### Given (전제 조건)

- LocalStack SQS가 실행 중이고 DLQ가 생성되어 있습니다.
- queue-consumer가 정상 동작 중입니다.
- OZ Relayer Mock 서버가 **500 Internal Server Error**를 반환하도록 설정되어 있습니다.
- MySQL 데이터베이스가 실행 중입니다.
- SQS 큐의 Redrive Policy가 `maxReceiveCount=3`으로 설정되어 있습니다.

### When (실행 조건)

1. relay-api가 트랜잭션을 SQS 큐에 전송합니다.
2. queue-consumer가 메시지를 수신하고 OZ Relayer로 전송을 시도합니다.
3. OZ Relayer가 500 Internal Server Error를 반환합니다.
4. queue-consumer가 메시지를 SQS에 반환합니다 (재시도 1회).
5. 위 과정이 총 3회 반복됩니다.

### Then (기대 결과)

#### 1. 재시도 로그 검증

**Consumer 로그 확인**:
```
[Consumer] Received message: tx-12345678-abcd-1234-efgh-567890abcdef (Attempt 1)
[Consumer] OZ Relayer error: 500 Internal Server Error
[Consumer] Returning message to SQS for retry

[Consumer] Received message: tx-12345678-abcd-1234-efgh-567890abcdef (Attempt 2)
[Consumer] OZ Relayer error: 500 Internal Server Error
[Consumer] Returning message to SQS for retry

[Consumer] Received message: tx-12345678-abcd-1234-efgh-567890abcdef (Attempt 3)
[Consumer] OZ Relayer error: 500 Internal Server Error
[Consumer] Returning message to SQS for retry

[Consumer] Message moved to DLQ after 3 failed attempts
```

**검증 항목**:
- [ ] Consumer가 메시지를 3회 수신
- [ ] 각 시도마다 OZ Relayer 에러 발생
- [ ] 3회 실패 후 DLQ 이동 로그 출력

#### 2. DLQ 메시지 검증

**awslocal CLI 확인**:
```bash
awslocal sqs receive-message \
  --queue-url http://localhost:4566/000000000000/relay-transactions-dlq \
  --max-number-of-messages 1
```

**기대 메시지**:
```json
{
  "MessageId": "msg-uuid-v4",
  "Body": "{\"transactionId\":\"tx-12345678-abcd-1234-efgh-567890abcdef\",\"type\":\"direct\",\"request\":{...}}",
  "Attributes": {
    "ApproximateReceiveCount": "3"
  }
}
```

**검증 항목**:
- [ ] DLQ에 메시지가 1개 존재
- [ ] `ApproximateReceiveCount`가 3
- [ ] 메시지 본문에 원본 `transactionId` 포함

#### 3. Main Queue 메시지 검증

**awslocal CLI 확인**:
```bash
awslocal sqs receive-message \
  --queue-url http://localhost:4566/000000000000/relay-transactions \
  --max-number-of-messages 10
```

**기대 결과**:
```json
{
  "Messages": []
}
```

**검증 항목**:
- [ ] Main Queue에 메시지가 0개 (DLQ로 이동됨)

#### 4. 트랜잭션 상태 업데이트 검증

**SQL 쿼리**:
```sql
SELECT id, status, error_message, updated_at
FROM transactions
WHERE id = 'tx-12345678-abcd-1234-efgh-567890abcdef';
```

**기대 결과**:
```
id: tx-12345678-abcd-1234-efgh-567890abcdef
status: failed
error_message: OZ Relayer error: 500 Internal Server Error (3 attempts)
updated_at: 2026-01-04 12:00:15
```

**검증 항목**:
- [ ] `status`가 `failed`로 변경
- [ ] `error_message` 필드에 에러 메시지 저장
- [ ] `updated_at`이 현재 시간

#### 5. LocalStack Web UI 검증

**접속**: `http://localhost:4566`

**DLQ 확인**:
- Queue Name: `relay-transactions-dlq`
- Messages Available: 1
- Message Body: 메시지 내용 확인

**Main Queue 확인**:
- Queue Name: `relay-transactions`
- Messages Available: 0

**검증 항목**:
- [ ] LocalStack Web UI에서 DLQ에 메시지 1개 확인
- [ ] Main Queue가 비어 있음

---

## Scenario 3: Health Check 검증

### 목표
SQS Health Check가 정상 동작하고, LocalStack 중지 시 Health Check가 실패하는 것을 검증합니다.

### Given (전제 조건)

- relay-api가 정상 동작 중입니다.
- LocalStack SQS가 실행 중입니다.

### When (실행 조건)

1. `GET /api/v1/health` 엔드포인트를 호출합니다.

### Then (기대 결과)

#### 1. 정상 상태 Health Check

**요청**:
```
GET /api/v1/health
```

**응답**:
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "sqs": { "status": "up" }
  },
  "error": {},
  "details": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "sqs": { "status": "up", "queueUrl": "http://localstack:4566/000000000000/relay-transactions" }
  }
}
```

**검증 항목**:
- [ ] HTTP 상태 코드: 200 OK
- [ ] `status`가 `ok`
- [ ] `sqs.status`가 `up`
- [ ] `sqs.queueUrl`이 올바른 URL

#### 2. LocalStack 중지 시 Health Check

**LocalStack 중지**:
```bash
docker-compose stop localstack
```

**요청**:
```
GET /api/v1/health
```

**응답**:
```json
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "status": "error",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  },
  "error": {
    "sqs": { "status": "down", "message": "Connection refused" }
  },
  "details": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "sqs": { "status": "down", "message": "Connection refused" }
  }
}
```

**검증 항목**:
- [ ] HTTP 상태 코드: 503 Service Unavailable
- [ ] `status`가 `error`
- [ ] `sqs.status`가 `down`
- [ ] `sqs.message`에 에러 메시지 포함

---

## Scenario 4: Dual Credentials Strategy 검증

### 목표
로컬 환경과 Production 환경에서 SQS Adapter가 올바른 인증 방식을 사용하는지 검증합니다.

### Given (전제 조건)

- relay-api가 실행 중입니다.

### When (실행 조건)

#### Case 1: 로컬 환경 (LocalStack)

**환경변수 설정**:
```bash
SQS_ENDPOINT_URL=http://localhost:4566
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

#### Case 2: Production 환경 (IAM Role)

**환경변수 설정**:
```bash
SQS_QUEUE_URL=https://sqs.ap-northeast-2.amazonaws.com/123456789012/relay-transactions
AWS_REGION=ap-northeast-2
# SQS_ENDPOINT_URL은 설정하지 않음
```

### Then (기대 결과)

#### Case 1: 로컬 환경 검증

**SQS Client 초기화 로그**:
```
[SqsAdapter] Initializing SQS Client
[SqsAdapter] Detected Local environment (SQS_ENDPOINT_URL is set)
[SqsAdapter] Using explicit credentials (test/test)
[SqsAdapter] Endpoint: http://localhost:4566
[SqsAdapter] Region: ap-northeast-2
```

**검증 항목**:
- [ ] `isLocal`이 `true`
- [ ] Explicit credentials 사용 (test/test)
- [ ] Endpoint가 `http://localhost:4566`

#### Case 2: Production 환경 검증

**SQS Client 초기화 로그**:
```
[SqsAdapter] Initializing SQS Client
[SqsAdapter] Detected Production environment (SQS_ENDPOINT_URL is not set)
[SqsAdapter] Using IAM Instance Role credentials
[SqsAdapter] Region: ap-northeast-2
```

**검증 항목**:
- [ ] `isLocal`이 `false`
- [ ] IAM Instance Role 사용 (credentials 자동 로드)
- [ ] Endpoint가 설정되지 않음

---

## Scenario 5: 중복 메시지 수신 처리 (At-Least-Once)

### 목표
SQS Standard Queue의 at-least-once 특성으로 인해 동일 메시지가 여러 번 수신될 수 있는 상황에서 Consumer가 올바르게 처리하는지 검증합니다.

### Given (전제 조건)

- LocalStack SQS가 실행 중입니다.
- queue-consumer가 정상 동작 중입니다.
- 트랜잭션 `tx-12345678-abcd-1234-efgh-567890abcdef`가 이미 `success` 상태로 MySQL에 저장되어 있습니다.

### When (실행 조건)

1. 네트워크 지연 또는 SQS 내부 동작으로 인해 동일한 메시지가 다시 수신됩니다.
2. queue-consumer가 `transactionId`로 MySQL에서 트랜잭션 상태를 조회합니다.

### Then (기대 결과)

#### 1. 중복 메시지 감지

**Consumer 로그 확인**:
```
[Consumer] Received message: tx-12345678-abcd-1234-efgh-567890abcdef
[Consumer] Checking transaction status in MySQL...
[Consumer] Transaction already in terminal state: success
[Consumer] Skipping duplicate message, deleting from SQS
```

**검증 항목**:
- [ ] Consumer가 MySQL에서 트랜잭션 상태 확인
- [ ] 이미 처리된 메시지 감지 (status: success 또는 failed)
- [ ] 메시지를 SQS에서 삭제
- [ ] OZ Relayer 중복 호출 없음

#### 2. Idempotent 처리 검증

**SQL 쿼리**:
```sql
SELECT id, status, updated_at
FROM transactions
WHERE id = 'tx-12345678-abcd-1234-efgh-567890abcdef';
```

**기대 결과**:
```
id: tx-12345678-abcd-1234-efgh-567890abcdef
status: success  (변경 없음)
updated_at: [원래 시간]  (업데이트 없음)
```

**검증 항목**:
- [ ] 트랜잭션 상태 변경 없음
- [ ] `updated_at` 변경 없음
- [ ] 부작용 없음 (Idempotent)

---

## Scenario 6: Consumer Graceful Shutdown

### 목표
SIGTERM 신호 수신 시 Consumer가 현재 처리 중인 메시지를 완료하고 안전하게 종료되는지 검증합니다.

### Given (전제 조건)

- queue-consumer가 정상 동작 중이고 메시지를 처리 중입니다.
- Docker Compose `stop_grace_period`가 30초로 설정되어 있습니다.
- SQS 큐에 처리 대기 중인 메시지가 있습니다.

### When (실행 조건)

1. `docker-compose stop queue-consumer` 명령 실행 (SIGTERM 전송)
2. Consumer가 현재 처리 중인 메시지가 있습니다.

### Then (기대 결과)

#### 1. Graceful Shutdown 로그

**Consumer 로그 확인**:
```
[Consumer] Received shutdown signal, stopping message processing...
[Consumer] Waiting for in-flight message to complete...
[Consumer] Message tx-abcd1234 processed successfully
[Consumer] Deleting message from SQS...
[Consumer] Consumer gracefully shut down
```

**검증 항목**:
- [ ] SIGTERM 수신 시 `isShuttingDown` 플래그 설정
- [ ] 현재 처리 중인 메시지 완료 대기
- [ ] 새로운 메시지 수신 중단
- [ ] 처리 완료된 메시지 SQS에서 삭제

#### 2. 미처리 메시지 보존

**SQS 큐 확인**:
```bash
awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/relay-transactions \
  --attribute-names ApproximateNumberOfMessages
```

**기대 결과**:
- 처리 중이던 메시지를 제외한 나머지 메시지가 큐에 보존됨
- Visibility Timeout 만료 후 다른 Consumer가 수신 가능

**검증 항목**:
- [ ] 미처리 메시지 큐에 보존
- [ ] 메시지 손실 없음
- [ ] 재시작 후 정상 처리 가능

#### 3. 타임아웃 초과 시 강제 종료

**시나리오**: Consumer가 30초 내에 종료되지 않는 경우

**검증 항목**:
- [ ] 30초 경과 시 SIGKILL로 강제 종료
- [ ] 처리 중이던 메시지가 SQS로 반환됨 (Visibility Timeout 후)
- [ ] 다른 Consumer가 해당 메시지 재처리 가능

---

## Edge Case Scenarios

### Edge Case 1: SQS 큐가 존재하지 않는 경우

**Given**: LocalStack이 실행 중이지만 SQS 큐가 생성되지 않음

**When**: relay-api가 메시지 전송 시도

**Then**:
- [ ] `QueueDoesNotExist` 에러 발생
- [ ] 에러 메시지: `Queue does not exist`
- [ ] relay-api가 500 Internal Server Error 반환

### Edge Case 2: MySQL 연결 실패

**Given**: MySQL이 중지된 상태

**When**: relay-api가 트랜잭션 저장 시도

**Then**:
- [ ] Database connection error 발생
- [ ] 에러 메시지: `Connection refused`
- [ ] relay-api가 503 Service Unavailable 반환

### Edge Case 3: OZ Relayer 타임아웃

**Given**: OZ Relayer가 응답하지 않음 (타임아웃)

**When**: queue-consumer가 메시지 처리 시도

**Then**:
- [ ] Axios timeout error 발생
- [ ] Consumer가 메시지를 SQS에 반환
- [ ] 재시도 카운트 증가

### Edge Case 4: 메시지 형식 오류

**Given**: SQS 메시지 본문이 잘못된 JSON 형식

**When**: queue-consumer가 메시지 파싱 시도

**Then**:
- [ ] JSON parse error 발생
- [ ] 에러 메시지: `Unexpected token`
- [ ] 메시지가 DLQ로 이동

### Edge Case 5: Visibility Timeout 초과

**Given**: Consumer가 메시지를 수신하고 처리 중이지만, OZ Relayer 응답이 매우 느림 (30초 이상)

**When**: Visibility Timeout (30초)이 만료되기 전에 메시지 처리가 완료되지 않음

**Then**:
- [ ] SQS가 메시지를 다시 visible 상태로 전환
- [ ] 다른 Consumer 인스턴스가 동일 메시지를 수신 가능 (중복 처리 위험)
- [ ] Consumer는 중복 처리를 감지하고 Idempotent하게 처리해야 함
- [ ] `ApproximateReceiveCount`가 증가

**완화 전략**:
- Visibility Timeout을 충분히 길게 설정 (30-60초)
- 처리가 오래 걸릴 경우 `ChangeMessageVisibility` API로 타임아웃 연장
- MySQL 상태 확인으로 중복 처리 방지 (Idempotent)

---

## Performance & Quality Gates

### 성능 기준

- [ ] relay-api 응답 시간: 200ms 이내 (95th percentile)
- [ ] Consumer 메시지 처리 시간: 2초 이내 (95th percentile)
- [ ] SQS Long-polling 대기 시간: 20초
- [ ] Consumer 처리량: 초당 최소 10개 메시지

### 품질 기준

- [ ] 테스트 커버리지: ≥90% (config.json 기준)
- [ ] TRUST 5 준수:
  - Test-first: Unit Test 먼저 작성 ✅
  - Readable: ESLint, Prettier 통과 ✅
  - Unified: 코드 스타일 일관성 ✅
  - Secured: OWASP 보안 검토 ✅
  - Trackable: Git Conventional Commits ✅

### 문서화 기준

- [ ] API 문서: OpenAPI/Swagger 생성
- [ ] README.md: 로컬 개발 가이드 포함
- [ ] SPEC 문서: plan.md, spec.md, acceptance.md 완료

---

## Integration Test 체크리스트

### 전체 플로우 통합 테스트

```bash
# 1. Docker Compose 실행
docker-compose up -d

# 2. Health Check 확인
curl http://localhost:8080/api/v1/health

# 3. 트랜잭션 전송
curl -X POST http://localhost:8080/api/v1/relay/direct \
  -H "Content-Type: application/json" \
  -d '{"to":"0x1234...","data":"0xabcd","value":"0","gasLimit":"21000"}'

# 4. SQS 메시지 확인
awslocal sqs receive-message \
  --queue-url http://localhost:4566/000000000000/relay-transactions

# 5. Consumer 로그 확인
docker logs msq-queue-consumer

# 6. 트랜잭션 상태 확인
curl http://localhost:8080/api/v1/relay/status/{transactionId}

# 7. DLQ 메시지 확인 (실패 시나리오)
awslocal sqs receive-message \
  --queue-url http://localhost:4566/000000000000/relay-transactions-dlq
```

**검증 항목**:
- [ ] 모든 curl 명령이 정상 응답
- [ ] SQS 메시지가 정상 전송/수신
- [ ] Consumer가 메시지 처리
- [ ] MySQL 상태 업데이트 확인

---

## 완료 기준 (Definition of Done)

- [ ] Scenario 1: 정상 메시지 처리 플로우 통과
- [ ] Scenario 2: DLQ 처리 플로우 통과
- [ ] Scenario 3: Health Check 검증 통과
- [ ] Scenario 4: Dual Credentials Strategy 검증 통과
- [ ] Scenario 5: 중복 메시지 수신 처리 통과
- [ ] Scenario 6: Consumer Graceful Shutdown 통과
- [ ] Edge Case 1-5 모두 통과
- [ ] Performance & Quality Gates 기준 충족
- [ ] Integration Test 체크리스트 완료
- [ ] LocalStack Web UI에서 큐 및 메시지 확인 가능
- [ ] 모든 Unit Test 통과 (커버리지 ≥90%)
- [ ] 문서화 완료 (API 문서, README, SPEC)

---

## 참고 자료

- AWS SQS Testing: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-test-messages.html
- LocalStack SQS: https://docs.localstack.cloud/user-guide/aws/sqs/
- NestJS Testing: https://docs.nestjs.com/fundamentals/testing
- Jest E2E Testing: https://jestjs.io/docs/tutorial-async

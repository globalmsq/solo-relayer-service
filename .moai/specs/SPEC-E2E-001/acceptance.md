# SPEC-E2E-001 Acceptance Criteria (검수 기준)

## 개요

본 문서는 SPEC-E2E-001 (E2E 테스트 인프라 및 결제 시스템 연동 검증)의 검수 기준을 정의합니다.

---

## 시나리오 1: Direct Transaction E2E 전체 플로우

### Given (전제 조건)
- supertest로 NestJS 앱이 실행된 상태
- OZ Relayer API가 Jest Spy로 Mock 설정됨
- 유효한 API Key가 헤더(`x-api-key`)에 포함됨
- Mock OZ Relayer가 202 응답 및 UUID txId를 반환하도록 설정됨

### When (실행 조건)
**Step 1**: POST /api/v1/relay/direct 요청 전송

**Request Body**:
```json
{
  "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "data": "0x",
  "speed": "fast"
}
```

**Request Headers**:
```
x-api-key: test-api-key
Content-Type: application/json
```

**Step 2**: OZ Relayer Mock 응답 반환

**Mock Response**:
```json
{
  "transactionId": "550e8400-e29b-41d4-a716-446655440000",
  "hash": null,
  "status": "pending",
  "createdAt": "2025-12-23T10:00:00Z"
}
```

### Then (예상 결과)

✅ **HTTP 응답**:
- Status Code: 202 Accepted
- Response Body:
  ```json
  {
    "txId": "550e8400-e29b-41d4-a716-446655440000"
  }
  ```

✅ **검증 항목**:
- `txId`가 UUID v4 형식 (`^[0-9a-f-]{36}$`)
- OZ Relayer API가 1회 호출됨 (Jest spy 검증)
- 응답 시간 < 1초 (Mock 기반)

✅ **에러 처리 검증** (추가 테스트 케이스):
- API Key 누락 시 → 401 Unauthorized
- 잘못된 이더리움 주소 → 400 Bad Request
- OZ Relayer Mock 실패 시 → 503 Service Unavailable

---

## 시나리오 2: Gasless Transaction 서명 검증

### Given (전제 조건)
- EIP-712 서명 유틸리티(`eip712-signer.ts`)가 준비됨
- Hardhat 테스트 계정 #1 (User) 사용
  - Private Key: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
  - Address: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- Forwarder 주소: `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` (Hardhat)
- Chain ID: 31337 (Hardhat local network)
- Forwarder nonce가 0인 상태 (Mock)

### When (실행 조건)

**Step 1**: Nonce 조회
```http
GET /api/v1/relay/gasless/nonce/0x70997970C51812dc3A010C7d01b50e0d17dc79C8
x-api-key: test-api-key
```

**Expected Response**:
```json
{
  "nonce": 0
}
```

**Step 2**: EIP-712 서명 생성

```typescript
const forwardRequest = {
  from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  to: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  value: "0",
  gas: "100000",
  nonce: 0,
  deadline: Math.floor(Date.now() / 1000) + 3600, // 1시간 후
  data: "0x"
};

const signature = await signForwardRequest(TEST_WALLETS.user, forwardRequest);
```

**Expected Signature Format**: `0x` + 130 hexadecimal characters (65 bytes)

**Step 3**: Gasless TX 제출
```http
POST /api/v1/relay/gasless
x-api-key: test-api-key
Content-Type: application/json

{
  "request": {
    "from": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "to": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "value": "0",
    "gas": "100000",
    "nonce": 0,
    "deadline": 1735900800,
    "data": "0x"
  },
  "signature": "0x1234...abcd" // 실제 서명
}
```

**Step 4**: Status 조회
```http
GET /api/v1/relay/status/{txId}
x-api-key: test-api-key
```

### Then (예상 결과)

✅ **Step 1 (Nonce 조회)**:
- Status Code: 200 OK
- Response Body: `{ "nonce": 0 }`

✅ **Step 2 (서명 생성)**:
- 서명 길이: 132 characters (0x + 130 hex)
- 서명 형식: `^0x[0-9a-f]{130}$`
- EIP-712 도메인 검증:
  - name: "ERC2771Forwarder"
  - version: "1"
  - chainId: 31337
  - verifyingContract: `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`

✅ **Step 3 (Gasless TX 제출)**:
- Status Code: 202 Accepted
- Response Body: `{ "txId": "uuid-v4" }`
- SignatureVerifierService 서명 검증 통과

✅ **Step 4 (Status 조회)**:
- Status Code: 200 OK
- Response Body:
  ```json
  {
    "transactionId": "uuid-v4",
    "hash": null,
    "status": "pending",
    "createdAt": "2025-12-23T10:00:00Z"
  }
  ```

✅ **에러 처리 검증** (추가 테스트 케이스):
- 잘못된 서명 → 401 Unauthorized (서명 검증 실패)
- 만료된 deadline → 400 Bad Request
- Nonce 불일치 → 400 Bad Request
- 잘못된 서명 형식 → 400 Bad Request

---

## 시나리오 3: Payment Integration - Batch Token Transfer

### Given (전제 조건)
- 3개의 ERC-20 토큰 전송 요청 준비
- 각 요청은 독립적인 Direct TX
- 동일한 API Key 사용

### When (실행 조건)

**Batch Request**:
```typescript
const transfers = [
  { to: tokenAddress, data: encodeERC20Transfer(merchant1, '1000000000000000000') }, // 1 token
  { to: tokenAddress, data: encodeERC20Transfer(merchant2, '2000000000000000000') }, // 2 tokens
  { to: tokenAddress, data: encodeERC20Transfer(merchant3, '3000000000000000000') }, // 3 tokens
];

const responses = await Promise.all(
  transfers.map(tx =>
    request(app.getHttpServer())
      .post('/api/v1/relay/direct')
      .set('x-api-key', 'test-api-key')
      .send({ ...tx, speed: 'fast' })
  )
);
```

### Then (예상 결과)

✅ **모든 요청 성공**:
- 3개 요청 모두 202 Accepted
- 각 요청마다 고유한 txId 반환
- 응답 시간: 3초 이내 (Mock 기반, 병렬 처리)

✅ **응답 검증**:
```json
[
  { "txId": "uuid-1" },
  { "txId": "uuid-2" },
  { "txId": "uuid-3" }
]
```

✅ **OZ Relayer 호출 검증**:
- OZ Relayer API가 3회 호출됨 (Jest spy)
- 각 호출의 `data` 필드가 올바른 ERC-20 transfer 인코딩

---

## 시나리오 4: Payment Integration - 전체 Gasless 결제 플로우

### Given (전제 조건)
- User 주소: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- Merchant 주소: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- EIP-712 서명 유틸리티 준비
- Mock OZ Relayer 응답 설정

### When (실행 조건)

**전체 플로우 4단계**:

**Step 1**: Nonce 조회
```http
GET /api/v1/relay/gasless/nonce/0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

**Step 2**: ForwardRequest 생성 및 서명
```typescript
const request = createForwardRequest(userAddress, merchantAddress, { nonce });
const signature = await signForwardRequest(TEST_WALLETS.user, request);
```

**Step 3**: Gasless TX 제출
```http
POST /api/v1/relay/gasless
{ request, signature }
```

**Step 4**: Status 조회
```http
GET /api/v1/relay/status/{txId}
```

### Then (예상 결과)

✅ **Step 1 결과**:
- Status: 200 OK
- Body: `{ "nonce": 0 }`

✅ **Step 2 결과**:
- 서명 생성 성공 (132자 hex string)
- EIP-712 타입 데이터 검증 통과

✅ **Step 3 결과**:
- Status: 202 Accepted
- Body: `{ "txId": "uuid-v4" }`
- 서명 검증 통과 (SignatureVerifierService)

✅ **Step 4 결과**:
- Status: 200 OK
- Body:
  ```json
  {
    "transactionId": "uuid-v4",
    "hash": null,
    "status": "pending",
    "createdAt": "2025-12-23T10:00:00Z",
    "from": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "to": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9" // Forwarder
  }
  ```

✅ **전체 플로우 검증**:
- 4단계 모두 성공적으로 완료
- 총 실행 시간: 5초 이내
- 데이터 일관성 검증 (nonce, txId, from/to 주소)

---

## 추가 검증 기준

### AC-E2E-001: Direct Transaction API 검증
- ✅ 7개 테스트 케이스 모두 통과
- ✅ 유효성 검증, 인증, 에러 처리 커버

### AC-E2E-002: Gasless Transaction API 검증
- ✅ 10개 테스트 케이스 모두 통과
- ✅ 서명 검증, Nonce, 에러 처리 커버

### AC-E2E-003: Status Polling API 검증
- ✅ 5개 테스트 케이스 모두 통과
- ✅ 상태 조회, 404/503 에러 커버

### AC-E2E-004: Health Check API 검증
- ✅ 3개 테스트 케이스 모두 통과
- ✅ 서비스 상태, 공개 엔드포인트 커버

### AC-E2E-005: Payment Integration 검증
- ✅ 2개 시나리오 테스트 통과
- ✅ Batch 전송, 전체 Gasless 플로우 커버

---

## 품질 게이트

### 테스트 통과 기준
- ✅ **27개 E2E 테스트 케이스 모두 통과** (Pass rate: 100%)
- ✅ **기존 유닛 테스트 회귀 없음** (`pnpm test` 성공)
- ✅ **E2E 테스트 실행 시간 30초 이내** (Mock 기반, 빠른 피드백)

### 코드 품질
- ✅ **TypeScript strict mode 통과** (`npx tsc --noEmit` 성공)
- ✅ **ESLint 규칙 준수** (경고 없음)
- ✅ **Mock 응답 일관성** (실제 OZ Relayer API 형식과 일치)

### 문서화
- ✅ **각 테스트 파일에 Given-When-Then 주석 포함**
- ✅ **TESTING.md 업데이트** (E2E 테스트 실행 방법 문서화)
- ✅ **README.md 업데이트** (테스트 섹션에 E2E 테스트 추가)

### 외부 의존성 제거
- ✅ **실제 OZ Relayer API 호출 없음** (Jest Spy로 Mock)
- ✅ **실제 블록체인 RPC 호출 없음**
- ✅ **Hardhat 테스트 계정만 사용** (실제 지갑 서명 없음)

---

## 실행 검증 체크리스트

### Phase 1: 인프라 구축
- [ ] `pnpm list supertest` → supertest ^7.0.0 확인
- [ ] `pnpm list @types/supertest` → @types/supertest ^6.0.0 확인
- [ ] `test/jest-e2e.json` 파일 존재 확인
- [ ] `pnpm test:e2e` 명령어 실행 가능 확인

### Phase 2: 유틸리티 및 Fixtures
- [ ] `test/fixtures/test-wallets.ts` 생성 확인
- [ ] `test/fixtures/test-config.ts` 생성 확인
- [ ] `test/fixtures/mock-responses.ts` 생성 확인
- [ ] `test/utils/eip712-signer.ts` 생성 확인 (3개 함수)
- [ ] `test/utils/encoding.ts` 생성 확인
- [ ] `test/utils/test-app.factory.ts` 생성 확인
- [ ] `npx tsc --noEmit` 성공 (TypeScript 컴파일 오류 없음)

### Phase 3: E2E 테스트 스위트
- [ ] `test/e2e/direct.e2e-spec.ts` 생성 확인 (7 tests)
- [ ] `test/e2e/gasless.e2e-spec.ts` 생성 확인 (10 tests)
- [ ] `test/e2e/status.e2e-spec.ts` 생성 확인 (5 tests)
- [ ] `test/e2e/health.e2e-spec.ts` 생성 확인 (3 tests)
- [ ] `test/e2e/payment-integration.e2e-spec.ts` 생성 확인 (2 tests)
- [ ] `pnpm test:e2e` → 27 tests passed

### Phase 4: 최종 검증
- [ ] `pnpm test` → All tests passed (유닛 테스트 회귀 없음)
- [ ] `pnpm test:e2e` → 27/27 tests passed
- [ ] E2E 테스트 실행 시간 < 30초
- [ ] `task-master set-status --id=11 --status=done` 실행

---

## 성공 메트릭

| 메트릭 | 목표 | 실제 |
|--------|------|------|
| **E2E 테스트 통과율** | 100% (27/27) | [구현 후 기록] |
| **유닛 테스트 회귀** | 0건 | [구현 후 기록] |
| **E2E 실행 시간** | < 30초 | [구현 후 기록] |
| **TypeScript 오류** | 0건 | [구현 후 기록] |
| **ESLint 경고** | 0건 | [구현 후 기록] |
| **코드 라인** | ~800 LOC | [구현 후 기록] |

---

## 실패 시나리오 및 대응

### 시나리오 F1: E2E 테스트 실패 (서명 검증)
**증상**: TC-E2E-G001 실패 (401 Unauthorized)
**원인**: EIP-712 서명 형식 불일치
**대응**:
1. `eip712-signer.ts`의 EIP712_DOMAIN 검증
2. `SignatureVerifierService` 로직 확인
3. `test-gasless.ts` 참조 패턴과 비교

### 시나리오 F2: Mock 응답 불일치
**증상**: TC-E2E-S002 실패 (응답 형식 오류)
**원인**: OZ Relayer API 응답 형식 변경
**대응**:
1. `mock-responses.ts` 업데이트
2. 실제 OZ Relayer API 문서 확인
3. StatusService DTO 검증

### 시나리오 F3: 유닛 테스트 회귀
**증상**: 기존 유닛 테스트 실패
**원인**: E2E 테스트 설정이 유닛 테스트에 영향
**대응**:
1. `jest-e2e.json` 설정 검증 (rootDir, testRegex)
2. 유닛 테스트와 E2E 테스트 격리 확인
3. Jest cache 삭제 후 재실행

---

## 검수 승인 기준

본 SPEC은 다음 조건을 **모두 만족**할 때 승인됩니다:

✅ **기능 검증**: 27개 E2E 테스트 케이스 모두 통과
✅ **품질 검증**: 유닛 테스트 회귀 없음, TypeScript 오류 없음
✅ **문서화**: Given-When-Then 주석, TESTING.md 업데이트
✅ **실행 시간**: E2E 테스트 30초 이내 완료
✅ **외부 의존성**: Mock 기반 실행, 실제 API 호출 없음

---

## 다음 단계 (Phase 2+)

### SPEC-E2E-002: Docker 기반 실제 통합 테스트 (Task #13)
- ✅ Mock 기반 E2E 테스트 완료 후 진행
- ✅ Hardhat 로컬 노드 사용
- ✅ 실제 블록체인 트랜잭션 검증

### SPEC-LOAD-001: Artillery 부하 테스트 (선택사항)
- ✅ E2E 테스트 안정화 후 진행
- ✅ 동시 요청 처리 성능 검증
- ✅ 병목 지점 식별 및 최적화

---

**문서 버전**: 1.0.0
**작성일**: 2025-12-23
**작성자**: Harry
**SPEC ID**: SPEC-E2E-001

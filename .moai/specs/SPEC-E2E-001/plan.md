# SPEC-E2E-001 구현 계획

## 개요

| 항목 | 내용 |
|------|------|
| **SPEC ID** | SPEC-E2E-001 |
| **제목** | E2E 테스트 인프라 및 결제 시스템 연동 검증 |
| **총 예상 시간** | ~4시간 (4 Phase) |
| **파일 변경** | 신규 11개, 수정 1개 |
| **테스트 케이스** | 27개 (5개 카테고리) |

---

## 기술 스택

| 라이브러리 | 버전 | 용도 | 설치 상태 |
|-----------|------|------|---------|
| **supertest** | ^7.0.0 | HTTP 엔드포인트 테스트 | ❌ 설치 필요 |
| **@types/supertest** | ^6.0.0 | TypeScript 타입 정의 | ❌ 설치 필요 |
| **ethers.js** | (기존 설치) | EIP-712 서명 생성 | ✅ 이미 설치됨 |
| **@nestjs/testing** | (기존 설치) | NestJS 테스트 유틸 | ✅ 이미 설치됨 |
| **jest** | (기존 설치) | 테스트 프레임워크 | ✅ 이미 설치됨 |

---

## Phase 1: E2E 테스트 인프라 구축 (30분)

### 목표 (Goal)
- supertest 및 관련 패키지 설치
- Jest E2E 설정 파일 생성
- npm 스크립트 추가

### 작업 내용 (Tasks)

#### 1.1 Dependencies 설치

**파일**: `packages/relay-api/package.json` (수정)

**변경 사항**:
```json
{
  "devDependencies": {
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0"
  }
}
```

**실행**:
```bash
cd packages/relay-api
pnpm add -D supertest@^7.0.0 @types/supertest@^6.0.0
```

#### 1.2 Jest E2E 설정 파일 생성

**파일**: `packages/relay-api/test/jest-e2e.json` (신규)

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

**설명**:
- `testRegex`: `.e2e-spec.ts` 파일만 실행
- `testTimeout`: 30초 (외부 API Mock 시간 고려)
- `moduleNameMapper`: src 경로 alias

#### 1.3 npm 스크립트 추가

**파일**: `packages/relay-api/package.json` (수정)

**추가 스크립트**:
```json
{
  "scripts": {
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "test:e2e:cov": "jest --config ./test/jest-e2e.json --coverage"
  }
}
```

### 예상 산출물 (Deliverables)
- ✅ supertest ^7.0.0 설치 완료
- ✅ @types/supertest ^6.0.0 설치 완료
- ✅ jest-e2e.json 설정 파일 생성
- ✅ test:e2e, test:e2e:cov 스크립트 추가

### 검증 기준 (Verification)
```bash
# Dependencies 확인
pnpm list supertest @types/supertest

# 스크립트 실행 가능 확인 (테스트 파일 없어도 오류 없음)
pnpm test:e2e

# 예상 출력: "No tests found..."
```

---

## Phase 2: 테스트 유틸리티 및 Fixtures (45분)

### 목표 (Goal)
- EIP-712 서명 유틸리티 구현
- Test Wallets 및 Config Fixtures 생성
- Mock OZ Relayer 응답 팩토리 생성
- NestJS Test App Factory 구현

### 작업 내용 (Tasks)

#### 2.1 디렉토리 구조 생성

```bash
mkdir -p packages/relay-api/test/e2e
mkdir -p packages/relay-api/test/fixtures
mkdir -p packages/relay-api/test/utils
```

#### 2.2 Test Wallets Fixture

**파일**: `packages/relay-api/test/fixtures/test-wallets.ts` (신규)

**내용**:
```typescript
import { Wallet } from 'ethers';

// Hardhat 기본 계정 #0~#2 (잘 알려진 테스트 지갑)
export const TEST_WALLETS = {
  relayer: new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),  // Account #0
  user: new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'),     // Account #1
  merchant: new Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'), // Account #2
};

export const TEST_ADDRESSES = {
  relayer: TEST_WALLETS.relayer.address,    // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  user: TEST_WALLETS.user.address,          // 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  merchant: TEST_WALLETS.merchant.address,  // 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
};
```

**설명**:
- Account #0: Relayer (트랜잭션 제출자)
- Account #1: User (Gasless TX 서명자)
- Account #2: Merchant (토큰 수신자)

#### 2.3 Test Config Fixture

**파일**: `packages/relay-api/test/fixtures/test-config.ts` (신규)

**내용**:
```typescript
export const TEST_CONFIG = {
  oz_relayer: {
    url: 'https://api.defender.openzeppelin.com',
    api_key: 'test-oz-api-key',
    relayer_id: 'test-relayer-id',
  },
  forwarder: {
    address: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', // Hardhat 기본 Forwarder
    chain_id: 31337, // Hardhat local network
  },
  api: {
    key: 'test-api-key',
  },
};
```

#### 2.4 Mock OZ Relayer 응답 팩토리

**파일**: `packages/relay-api/test/fixtures/mock-responses.ts` (신규)

**내용**:
```typescript
import { v4 as uuidv4 } from 'uuid';

export const createMockOzRelayerResponse = (overrides?: Partial<any>) => ({
  transactionId: uuidv4(),
  hash: null,
  status: 'pending',
  createdAt: new Date().toISOString(),
  ...overrides,
});

export const createMockConfirmedResponse = (overrides?: Partial<any>) => ({
  transactionId: uuidv4(),
  hash: '0x' + '1'.repeat(64),
  status: 'confirmed',
  createdAt: new Date().toISOString(),
  confirmedAt: new Date().toISOString(),
  ...overrides,
});

export const createMockFailedResponse = (overrides?: Partial<any>) => ({
  transactionId: uuidv4(),
  hash: null,
  status: 'failed',
  createdAt: new Date().toISOString(),
  failedAt: new Date().toISOString(),
  error: 'Transaction reverted',
  ...overrides,
});
```

#### 2.5 EIP-712 서명 유틸리티

**파일**: `packages/relay-api/test/utils/eip712-signer.ts` (신규)

**내용**:
```typescript
import { Wallet } from 'ethers';
import { TEST_CONFIG } from '../fixtures/test-config';

const EIP712_DOMAIN = {
  name: 'ERC2771Forwarder',
  version: '1',
  chainId: TEST_CONFIG.forwarder.chain_id,
  verifyingContract: TEST_CONFIG.forwarder.address,
};

const FORWARD_REQUEST_TYPE = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
};

export interface ForwardRequest {
  from: string;
  to: string;
  value: string;
  gas: string;
  nonce: number;
  deadline: number;
  data: string;
}

export async function signForwardRequest(
  wallet: Wallet,
  request: ForwardRequest,
): Promise<string> {
  return wallet.signTypedData(EIP712_DOMAIN, FORWARD_REQUEST_TYPE, request);
}

export function createForwardRequest(
  from: string,
  to: string,
  options: Partial<ForwardRequest> = {},
): ForwardRequest {
  return {
    from,
    to,
    value: '0',
    gas: '100000',
    nonce: 0,
    deadline: Math.floor(Date.now() / 1000) + 3600, // 1시간 후
    data: '0x',
    ...options,
  };
}

export function createExpiredForwardRequest(
  from: string,
  to: string,
): ForwardRequest {
  return createForwardRequest(from, to, {
    deadline: Math.floor(Date.now() / 1000) - 3600, // 1시간 전 (만료됨)
  });
}
```

**참조**: `packages/relay-api/scripts/test-gasless.ts` 패턴 재사용

#### 2.6 ERC-20 인코딩 유틸리티

**파일**: `packages/relay-api/test/utils/encoding.ts` (신규)

**내용**:
```typescript
import { Interface } from 'ethers';

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) public returns (bool)',
];

export function encodeERC20Transfer(to: string, amount: string): string {
  const iface = new Interface(ERC20_ABI);
  return iface.encodeFunctionData('transfer', [to, amount]);
}
```

#### 2.7 NestJS Test App Factory

**파일**: `packages/relay-api/test/utils/test-app.factory.ts` (신규)

**내용**:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../../src/app.module';
import { TEST_CONFIG } from '../fixtures/test-config';

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: jest.fn((key: string) => {
        const config = {
          'OZ_RELAYER_URL': TEST_CONFIG.oz_relayer.url,
          'OZ_RELAYER_API_KEY': TEST_CONFIG.oz_relayer.api_key,
          'FORWARDER_ADDRESS': TEST_CONFIG.forwarder.address,
          'CHAIN_ID': TEST_CONFIG.forwarder.chain_id,
          'API_KEY': TEST_CONFIG.api.key,
        };
        return config[key];
      }),
    })
    .compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  return app;
}
```

### 예상 산출물 (Deliverables)
- ✅ `test-wallets.ts` - Hardhat 계정 #0~#2
- ✅ `test-config.ts` - 테스트 환경 설정
- ✅ `mock-responses.ts` - OZ Relayer Mock 응답 팩토리
- ✅ `eip712-signer.ts` - EIP-712 서명 유틸리티 (3개 함수)
- ✅ `encoding.ts` - ERC-20 transfer 인코딩
- ✅ `test-app.factory.ts` - NestJS 테스트 앱 팩토리

### 검증 기준 (Verification)
```bash
# TypeScript 컴파일 확인
npx tsc --noEmit

# 유틸리티 함수 import 테스트 (간단한 스크립트)
node -e "const { TEST_WALLETS } = require('./test/fixtures/test-wallets'); console.log(TEST_WALLETS.relayer.address);"
```

---

## Phase 3: E2E 테스트 스위트 작성 (2.5시간)

### 목표 (Goal)
- 5개 E2E 테스트 파일 작성 (27개 테스트 케이스)
- Mock OZ Relayer 응답 설정
- Given-When-Then 형식 주석 포함

### 작업 내용 (Tasks)

#### 3.1 Direct Transaction E2E 테스트

**파일**: `packages/relay-api/test/e2e/direct.e2e-spec.ts` (신규)

**테스트 케이스** (7개):
1. TC-E2E-D001: 유효한 Direct TX → 202 Accepted
2. TC-E2E-D002: 최소 필드만 포함 → 202 Accepted
3. TC-E2E-D003: 잘못된 이더리움 주소 → 400 Bad Request
4. TC-E2E-D004: 잘못된 hexadecimal data → 400 Bad Request
5. TC-E2E-D005: 잘못된 speed enum → 400 Bad Request
6. TC-E2E-D006: API key 누락 → 401 Unauthorized
7. TC-E2E-D007: 잘못된 API key → 401 Unauthorized

**구조**:
```typescript
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app.factory';
import { TEST_ADDRESSES } from '../fixtures/test-wallets';
import { createMockOzRelayerResponse } from '../fixtures/mock-responses';

describe('Direct Transaction E2E Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/relay/direct', () => {
    it('TC-E2E-D001: should accept valid direct transaction', async () => {
      // Given: 유효한 Direct TX 요청
      const payload = {
        to: TEST_ADDRESSES.merchant,
        data: '0x',
        speed: 'fast',
      };

      // When: POST /api/v1/relay/direct 호출
      const response = await request(app.getHttpServer())
        .post('/api/v1/relay/direct')
        .set('x-api-key', 'test-api-key')
        .send(payload);

      // Then: 202 Accepted + txId 포함
      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('txId');
      expect(response.body.txId).toMatch(/^[0-9a-f-]{36}$/); // UUID 형식
    });

    // ... 6개 테스트 케이스 추가
  });
});
```

#### 3.2 Gasless Transaction E2E 테스트

**파일**: `packages/relay-api/test/e2e/gasless.e2e-spec.ts` (신규)

**테스트 케이스** (10개):
1. TC-E2E-G001: 유효한 서명 포함 Gasless TX → 202 Accepted
2. TC-E2E-G002: Custom gas 및 value 포함 → 202 Accepted
3. TC-E2E-G003: Nonce 조회 → 200 OK + 현재 nonce
4. TC-E2E-G004: 잘못된 주소로 nonce 조회 → 400 Bad Request
5. TC-E2E-G005: 잘못된 서명 형식 → 401 Unauthorized
6. TC-E2E-G006: 잘못된 서명자 서명 → 401 Unauthorized
7. TC-E2E-G007: 만료된 deadline → 400 Bad Request
8. TC-E2E-G008: Nonce 불일치 → 400 Bad Request
9. TC-E2E-G009: 잘못된 형식 서명 → 400 Bad Request
10. TC-E2E-G010: 필수 필드 누락 → 400 Bad Request

**구조**:
```typescript
import { signForwardRequest, createForwardRequest } from '../utils/eip712-signer';
import { TEST_WALLETS, TEST_ADDRESSES } from '../fixtures/test-wallets';

describe('Gasless Transaction E2E Tests', () => {
  describe('POST /api/v1/relay/gasless', () => {
    it('TC-E2E-G001: should accept valid gasless transaction with signature', async () => {
      // Given: 유효한 ForwardRequest + 서명
      const request = createForwardRequest(
        TEST_ADDRESSES.user,
        TEST_ADDRESSES.merchant,
        { data: '0x', nonce: 0 }
      );
      const signature = await signForwardRequest(TEST_WALLETS.user, request);

      // When: POST /api/v1/relay/gasless 호출
      const response = await request(app.getHttpServer())
        .post('/api/v1/relay/gasless')
        .set('x-api-key', 'test-api-key')
        .send({ request, signature });

      // Then: 202 Accepted + txId 포함
      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('txId');
    });

    // ... 9개 테스트 케이스 추가
  });
});
```

#### 3.3 Status Polling E2E 테스트

**파일**: `packages/relay-api/test/e2e/status.e2e-spec.ts` (신규)

**테스트 케이스** (5개):
1. TC-E2E-S001: Pending 상태 조회 → 200 + status: pending
2. TC-E2E-S002: Confirmed 상태 조회 → 200 + hash + confirmedAt
3. TC-E2E-S003: Failed 상태 조회 → 200 + status: failed
4. TC-E2E-S004: 잘못된 UUID 형식 → 400 Bad Request
5. TC-E2E-S005: OZ Relayer 불가 → 503 Service Unavailable

#### 3.4 Health Check E2E 테스트

**파일**: `packages/relay-api/test/e2e/health.e2e-spec.ts` (신규)

**테스트 케이스** (3개):
1. TC-E2E-H001: 모든 서비스 정상 → 200 + status: ok
2. TC-E2E-H002: Public 엔드포인트 (API key 불필요) → 200 OK
3. TC-E2E-H003: OZ Relayer pool 비정상 → 503 Service Unavailable

#### 3.5 Payment Integration E2E 테스트

**파일**: `packages/relay-api/test/e2e/payment-integration.e2e-spec.ts` (신규)

**테스트 케이스** (2개):
1. TC-E2E-P001: Batch 토큰 전송 (Direct TX) → 여러 202 응답
2. TC-E2E-P002: 전체 Gasless 결제 플로우 → 4단계 완료

**구조**:
```typescript
describe('Payment Integration E2E Tests', () => {
  it('TC-E2E-P002: should complete full gasless payment flow', async () => {
    // Given: User 주소
    const userAddress = TEST_ADDRESSES.user;

    // Step 1: Nonce 조회
    const nonceResponse = await request(app.getHttpServer())
      .get(`/api/v1/relay/gasless/nonce/${userAddress}`)
      .set('x-api-key', 'test-api-key');

    expect(nonceResponse.status).toBe(200);
    const nonce = nonceResponse.body.nonce;

    // Step 2: ForwardRequest 생성 및 서명
    const forwardRequest = createForwardRequest(
      userAddress,
      TEST_ADDRESSES.merchant,
      { nonce, data: '0x' }
    );
    const signature = await signForwardRequest(TEST_WALLETS.user, forwardRequest);

    // Step 3: Gasless TX 제출
    const submitResponse = await request(app.getHttpServer())
      .post('/api/v1/relay/gasless')
      .set('x-api-key', 'test-api-key')
      .send({ request: forwardRequest, signature });

    expect(submitResponse.status).toBe(202);
    const txId = submitResponse.body.txId;

    // Step 4: Status 조회
    const statusResponse = await request(app.getHttpServer())
      .get(`/api/v1/relay/status/${txId}`)
      .set('x-api-key', 'test-api-key');

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.transactionId).toBe(txId);
  });
});
```

### 예상 산출물 (Deliverables)
- ✅ `direct.e2e-spec.ts` - 7개 테스트 케이스
- ✅ `gasless.e2e-spec.ts` - 10개 테스트 케이스
- ✅ `status.e2e-spec.ts` - 5개 테스트 케이스
- ✅ `health.e2e-spec.ts` - 3개 테스트 케이스
- ✅ `payment-integration.e2e-spec.ts` - 2개 테스트 케이스

### 검증 기준 (Verification)
```bash
# E2E 테스트 실행
pnpm --filter @msq-relayer/relay-api test:e2e

# 예상 출력: 27 tests passed
```

---

## Phase 4: 실행 및 검증 (15분)

### 목표 (Goal)
- 모든 유닛 테스트 통과 확인
- 모든 E2E 테스트 통과 확인
- 테스트 커버리지 확인
- TaskMaster Task #11 완료 상태 변경

### 작업 내용 (Tasks)

#### 4.1 유닛 테스트 실행

```bash
# 유닛 테스트 실행 (회귀 확인)
pnpm --filter @msq-relayer/relay-api test

# 예상 출력: All tests passed
```

#### 4.2 E2E 테스트 실행

```bash
# E2E 테스트 실행
pnpm --filter @msq-relayer/relay-api test:e2e

# 예상 출력: 27 tests passed
```

#### 4.3 E2E 테스트 커버리지

```bash
# E2E 테스트 커버리지 (선택사항)
pnpm --filter @msq-relayer/relay-api test:e2e:cov

# 참고: E2E 커버리지는 90% 목표와 별도 관리
```

#### 4.4 TaskMaster 업데이트

```bash
# Task #11 완료 상태로 변경
task-master set-status --id=11 --status=done
```

### 예상 산출물 (Deliverables)
- ✅ 모든 유닛 테스트 통과 (회귀 없음)
- ✅ 27개 E2E 테스트 케이스 통과
- ✅ TaskMaster Task #11 완료 상태

### 검증 기준 (Verification)
- ✅ `pnpm test` 성공 (유닛 테스트 회귀 없음)
- ✅ `pnpm test:e2e` 성공 (27개 테스트 통과)
- ✅ TaskMaster 상태: Task #11 → done

---

## Git 워크플로우 전략

### Personal Mode 기반 브랜치 전략

```bash
# 1. Feature Branch 생성
git checkout -b feature/SPEC-E2E-001

# 2. Phase별 Commit 전략
# Phase 1 완료
git add packages/relay-api/package.json packages/relay-api/test/jest-e2e.json
git commit -m "feat(e2e): setup E2E test infrastructure with supertest"

# Phase 2 완료
git add packages/relay-api/test/fixtures/ packages/relay-api/test/utils/
git commit -m "feat(e2e): add test utilities and fixtures for E2E tests"

# Phase 3 완료
git add packages/relay-api/test/e2e/
git commit -m "feat(e2e): implement 27 E2E test cases across 5 endpoints"

# Phase 4 완료
git add .
git commit -m "test(e2e): verify all E2E tests pass with coverage"

# 3. Branch Merge (Personal mode: main에 직접 merge)
git checkout main
git merge feature/SPEC-E2E-001
```

### Commit Message 규칙 (Conventional Commits)

- `feat(e2e):` - E2E 테스트 인프라 및 유틸리티 추가
- `test(e2e):` - 테스트 케이스 구현
- `docs(e2e):` - E2E 테스트 문서화

---

## 파일 변경 목록

### 신규 파일 (11개)

| 경로 | 용도 | Phase |
|------|------|-------|
| `test/jest-e2e.json` | Jest E2E 설정 | Phase 1 |
| `test/fixtures/test-wallets.ts` | Hardhat 테스트 계정 | Phase 2 |
| `test/fixtures/test-config.ts` | 테스트 환경 설정 | Phase 2 |
| `test/fixtures/mock-responses.ts` | OZ Relayer Mock 응답 | Phase 2 |
| `test/utils/eip712-signer.ts` | EIP-712 서명 유틸 | Phase 2 |
| `test/utils/encoding.ts` | ERC-20 인코딩 | Phase 2 |
| `test/utils/test-app.factory.ts` | NestJS 앱 팩토리 | Phase 2 |
| `test/e2e/direct.e2e-spec.ts` | Direct TX E2E | Phase 3 |
| `test/e2e/gasless.e2e-spec.ts` | Gasless TX E2E | Phase 3 |
| `test/e2e/status.e2e-spec.ts` | Status Polling E2E | Phase 3 |
| `test/e2e/health.e2e-spec.ts` | Health Check E2E | Phase 3 |

### 수정 파일 (1개)

| 경로 | 변경 사항 | Phase |
|------|---------|-------|
| `packages/relay-api/package.json` | supertest deps + test:e2e scripts | Phase 1 |

---

## 주의사항

### E2E-WARN-001: 유닛 테스트 간섭 방지
- E2E 테스트는 `test/e2e/` 디렉토리에만 위치
- Jest 설정 파일 분리 (`jest-e2e.json` vs 기본 Jest)
- 테스트 실행 명령어 분리 (`test:e2e` vs `test`)

### E2E-WARN-002: Mock 응답 일관성 유지
- OZ Relayer API 응답 형식 변경 시 `mock-responses.ts` 업데이트 필요
- 실제 API와 Mock의 일관성 정기적 검증 필요

### E2E-WARN-003: 테스트 타임아웃 설정
- 기본 타임아웃 30초 (jest-e2e.json)
- 느린 테스트 케이스는 개별 타임아웃 설정 가능 (`jest.setTimeout()`)

### E2E-WARN-004: 실제 통합 테스트 제외
- Task #11은 Mock 기반 E2E 테스트만 다룸
- Task #13 (Docker 기반 실제 통합 테스트)는 별도 SPEC 필요

---

## 성공 기준

### 기능 검증
✅ Direct Transaction API 7개 테스트 통과
✅ Gasless Transaction API 10개 테스트 통과
✅ Status Polling API 5개 테스트 통과
✅ Health Check API 3개 테스트 통과
✅ Payment Integration 2개 시나리오 통과

### 품질 검증
✅ 기존 유닛 테스트 회귀 없음
✅ E2E 테스트 실행 시간 30초 이내
✅ Mock 응답 사용으로 외부 의존성 제거
✅ EIP-712 서명 유틸리티 검증 통과

### 문서화
✅ 각 테스트 파일에 Given-When-Then 주석 포함
✅ TESTING.md 업데이트 (E2E 테스트 실행 방법)

---

## 참조 파일 (읽기 전용)

| 경로 | 용도 |
|------|------|
| `packages/relay-api/scripts/test-gasless.ts` | EIP-712 서명 패턴 참조 |
| `packages/relay-api/src/relay/gasless/gasless.service.ts` | Gasless TX 워크플로우 참조 |
| `packages/relay-api/src/relay/gasless/signature-verifier.service.ts` | 서명 검증 로직 |
| `packages/relay-api/src/relay/direct/direct.controller.ts` | Direct TX 엔드포인트 참조 |
| `packages/relay-api/src/relay/status/status.controller.ts` | Status 엔드포인트 참조 |

---

## 다음 단계 (Phase 2+)

### SPEC-E2E-002: Docker 기반 실제 통합 테스트 (Task #13)
- Docker Compose로 Hardhat 로컬 노드 실행
- 실제 OZ Relayer 인스턴스 사용
- 실제 블록체인 트랜잭션 검증

### SPEC-LOAD-001: Artillery 부하 테스트 (선택사항)
- 동시 요청 처리 검증
- 처리량(throughput) 측정
- 병목 지점 식별

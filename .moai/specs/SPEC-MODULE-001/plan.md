---
id: SPEC-MODULE-001
title: NestJS 핵심 모듈 스캐폴딩 (Phase 1)
type: implementation-plan
version: 1.0.0
created: 2025-12-16
updated: 2025-12-16
---

# Implementation Plan: SPEC-MODULE-001

## 개요

NestJS 10.x 기반 API Gateway에 5개 핵심 모듈(auth, relay, oz-relayer, config, common)의 디렉토리 구조와 기본 NestJS 모듈 설정을 생성합니다. Phase 1 제약사항(Prisma/MySQL 제외)을 준수하며, 모듈 간 의존성 순서를 고려한 단계적 구현 계획을 수립합니다.

---

## 구현 전략

### Phase 1 제약사항 준수

1. **NO Database**: Prisma, MySQL 의존성 제외
2. **Minimal Dependencies**: Redis, OZ Relayer 클라이언트만
3. **Scaffolding Only**: 실제 엔드포인트 구현 제외
4. **Module Structure**: DI 컨테이너 설정 및 디렉토리 구조 생성

### 모듈 통합 순서 (의존성 기반)

```
1. config/          # 환경변수 설정 (가장 먼저)
   ↓
2. common/          # 공통 필터, 인터셉터 (config 의존)
   ↓
3. auth/            # API Key Guard (config 의존)
   ↓
4. oz-relayer/      # OZ Relayer 클라이언트 (config 의존)
   ↓
5. relay/           # Relay 엔드포인트 (oz-relayer, auth 의존)
   ↓
6. app.module.ts    # 모든 모듈 통합
```

**의존성 이유**:
- `config`가 먼저 로드되어야 다른 모듈이 환경변수 접근 가능
- `auth`는 `config`의 `RELAY_API_KEY` 환경변수 필요
- `relay`는 `oz-relayer` 서비스와 `auth` Guard 필요

---

## 구현 마일스톤

### Milestone 1: 기본 설정 모듈 (config/)

**목표**: 환경변수 설정 및 전역 ConfigModule 구성

**작업**:
1. `config/` 디렉토리 생성
2. `configuration.ts` 환경변수 설정 파일 작성
   - `port`, `nodeEnv`, `apiKey`
   - `redis.url`, `rpc.url`
3. `config.module.ts` 작성
   - `@nestjs/config` 사용
   - `isGlobal: true` 설정

**검증**:
- `ConfigModule`이 DI 컨테이너에 로드됨
- 환경변수 접근 가능 (`ConfigService.get()`)

**산출물**:
- `config/config.module.ts`
- `config/configuration.ts`

---

### Milestone 2: 공통 기능 모듈 (common/)

**목표**: 전역 필터, 인터셉터, 데코레이터 구조 생성

**작업**:
1. `common/` 디렉토리 생성
2. `filters/` 디렉토리 및 `exception.filter.ts` 스텁 생성
3. `interceptors/` 디렉토리 및 `logging.interceptor.ts` 스텁 생성
4. `decorators/` 디렉토리 생성
5. `common.module.ts` 작성

**검증**:
- `CommonModule`이 DI 컨테이너에 로드됨
- 디렉토리 구조 생성 확인

**산출물**:
- `common/common.module.ts`
- `common/filters/exception.filter.ts` (스텁)
- `common/interceptors/logging.interceptor.ts` (스텁)

---

### Milestone 3: 인증 모듈 (auth/)

**목표**: API Key Guard 및 Public 데코레이터 구조 생성

**작업**:
1. `auth/` 디렉토리 생성
2. `guards/` 디렉토리 및 `api-key.guard.ts` 스텁 생성
   - `ConfigService` 의존성 주입
   - `RELAY_API_KEY` 환경변수 검증 로직 (스텁)
3. `decorators/` 디렉토리 및 `public.decorator.ts` 생성
   - `@Public()` 데코레이터 정의
4. `auth.module.ts` 작성
   - `APP_GUARD` 프로바이더로 `ApiKeyGuard` 등록

**검증**:
- `AuthModule`이 DI 컨테이너에 로드됨
- `ApiKeyGuard`가 전역 Guard로 등록됨

**산출물**:
- `auth/auth.module.ts`
- `auth/guards/api-key.guard.ts` (스텁)
- `auth/decorators/public.decorator.ts`

---

### Milestone 4: OZ Relayer 클라이언트 모듈 (oz-relayer/)

**목표**: OZ Relayer API 클라이언트 서비스 스캐폴딩

**작업**:
1. `oz-relayer/` 디렉토리 생성
2. `oz-relayer.service.ts` 스텁 생성
   - `HttpService` (`@nestjs/axios`) 의존성 주입
   - OZ Relayer API 호출 메서드 스텁
3. `oz-relayer.module.ts` 작성
   - `HttpModule` 임포트
   - `OzRelayerService` 프로바이더 등록 및 export

**검증**:
- `OzRelayerModule`이 DI 컨테이너에 로드됨
- `OzRelayerService`가 다른 모듈에서 주입 가능

**산출물**:
- `oz-relayer/oz-relayer.module.ts`
- `oz-relayer/oz-relayer.service.ts` (스텁)

---

### Milestone 5: Relay 엔드포인트 모듈 (relay/)

**목표**: Relay 엔드포인트 디렉토리 구조 생성

**작업**:
1. `relay/` 디렉토리 생성
2. 서브디렉토리 생성 (비어있음, 구조만):
   - `direct/` (Direct TX 엔드포인트 - Phase 2+)
   - `gasless/` (Gasless TX 엔드포인트 - Phase 2+)
   - `status/` (Status 조회 엔드포인트 - Phase 2+)
3. `relay.module.ts` 작성
   - `OzRelayerModule` 임포트
   - 컨트롤러/프로바이더 비어있음 (Phase 2+에서 추가)

**검증**:
- `RelayModule`이 DI 컨테이너에 로드됨
- 서브디렉토리 구조 확인

**산출물**:
- `relay/relay.module.ts`
- `relay/direct/` (빈 디렉토리)
- `relay/gasless/` (빈 디렉토리)
- `relay/status/` (빈 디렉토리)

---

### Milestone 6: 루트 모듈 통합 (app.module.ts)

**목표**: 모든 모듈을 `app.module.ts`에 통합

**작업**:
1. `app.module.ts` 수정
2. 모든 모듈 임포트 (의존성 순서대로):
   ```typescript
   imports: [
     HttpModule,
     AppConfigModule,    // 1. Config
     CommonModule,        // 2. Common
     AuthModule,          // 3. Auth
     OzRelayerModule,     // 4. OZ Relayer
     RelayModule,         // 5. Relay
     HealthModule,        // 6. Health Check (기존)
   ]
   ```

**검증**:
- `npm run start:dev` 실행 시 모든 모듈 로드 성공
- 콘솔에 "API Gateway listening on port 3000" 출력
- Prisma/MySQL 관련 에러 없음

**산출물**:
- `app.module.ts` (업데이트)

---

## 기술 스택

### 런타임
- **Node.js**: 20.x LTS
- **NestJS**: 10.x
- **TypeScript**: 5.x

### 핵심 의존성
- `@nestjs/common`: 10.x
- `@nestjs/core`: 10.x
- `@nestjs/config`: 3.x
- `@nestjs/axios`: 3.x (HttpModule)
- `class-validator`: 0.14.x
- `class-transformer`: 0.5.x

### Phase 1 제외 의존성
- ❌ `@prisma/client` (Phase 2+)
- ❌ `prisma` (Phase 2+)
- ❌ `mysql2` (Phase 2+)

---

## 위험 요소 및 대응 방안

### 위험 1: 모듈 간 순환 의존성

**설명**: 모듈 간 순환 참조로 인한 DI 컨테이너 로드 실패

**대응**:
- 의존성 방향을 명확히 정의 (config → common → auth → oz-relayer → relay)
- `forwardRef()` 사용 최소화

**검증**:
- `npm run start:dev` 정상 시작 확인

### 위험 2: 환경변수 누락

**설명**: 필수 환경변수 미설정으로 인한 서버 시작 실패

**대응**:
- `.env.example` 파일 제공
- `configuration.ts`에 기본값 설정

**검증**:
- 환경변수 없이 서버 시작 시 기본값으로 작동 확인

### 위험 3: TypeScript 컴파일 에러

**설명**: 타입 불일치, import 경로 오류

**대응**:
- `npm run lint` 실행하여 사전 검증
- `npm run build` 성공 확인

**검증**:
- CI/CD 파이프라인에서 자동 검증

---

## 테스트 전략

### 단위 테스트 (Phase 2+)

- 각 모듈의 프로바이더 및 Guard 단위 테스트
- `jest` 사용

### 통합 테스트 (Phase 2+)

- 모듈 간 의존성 주입 테스트
- E2E 테스트 (Health Check 엔드포인트)

### Phase 1 검증 항목

1. **서버 시작 성공**: `npm run start:dev` 에러 없음
2. **모듈 로드 확인**: 콘솔 로그에 모든 모듈 로드 메시지 확인
3. **Health Check**: `curl http://localhost:3000/api/v1/health` → 200 OK
4. **Lint**: `npm run lint` → 0 errors
5. **Build**: `npm run build` → 성공
6. **NO DB 연결**: Prisma/MySQL 연결 시도 없음 확인

---

## 구현 순서 요약

```
1️⃣ config/ 모듈 생성 (환경변수 설정)
   ↓
2️⃣ common/ 모듈 생성 (필터, 인터셉터 구조)
   ↓
3️⃣ auth/ 모듈 생성 (API Key Guard 스텁)
   ↓
4️⃣ oz-relayer/ 모듈 생성 (OZ Relayer 클라이언트 스텁)
   ↓
5️⃣ relay/ 모듈 생성 (서브디렉토리 구조)
   ↓
6️⃣ app.module.ts 통합 (모든 모듈 임포트)
   ↓
7️⃣ 검증 (서버 시작, Lint, Build)
```

---

## Phase 2+ 확장 계획

**추가 예정 모듈**:
- `webhook/` - OZ Relayer Webhook 핸들러
- `prisma/` - DB 스키마 및 클라이언트
- `queue/` - Queue System (Bull, Redis Queue)
- `policy/` - Policy Engine

**추가 예정 엔드포인트**:
- `POST /api/v1/relay/direct` - Direct TX 전송
- `POST /api/v1/relay/gasless` - Gasless TX 전송
- `GET /api/v1/relay/status/:txHash` - TX 상태 조회

---

## 산출물 목록

### 생성될 파일

```
packages/relay-api/src/
├── app.module.ts               (수정)
├── auth/
│   ├── auth.module.ts          (신규)
│   ├── guards/
│   │   └── api-key.guard.ts    (신규, 스텁)
│   └── decorators/
│       └── public.decorator.ts (신규)
├── relay/
│   ├── relay.module.ts         (신규)
│   ├── direct/                 (신규, 빈 디렉토리)
│   ├── gasless/                (신규, 빈 디렉토리)
│   └── status/                 (신규, 빈 디렉토리)
├── oz-relayer/
│   ├── oz-relayer.module.ts    (신규)
│   └── oz-relayer.service.ts   (신규, 스텁)
├── config/
│   ├── config.module.ts        (신규)
│   └── configuration.ts        (신규)
└── common/
    ├── common.module.ts         (신규)
    ├── filters/
    │   └── exception.filter.ts  (신규, 스텁)
    ├── interceptors/
    │   └── logging.interceptor.ts (신규, 스텁)
    └── decorators/              (신규, 빈 디렉토리)
```

**총 신규 파일 수**: 약 11개 (스텁 포함)

---

## 완료 기준

### Definition of Done

1. ✅ 모든 5개 모듈 디렉토리 생성 완료
2. ✅ 각 모듈의 `.module.ts` 파일 작성 완료
3. ✅ `app.module.ts`에 모든 모듈 임포트 완료
4. ✅ `npm run start:dev` 정상 시작 확인
5. ✅ `curl http://localhost:3000/api/v1/health` 200 OK 응답
6. ✅ `npm run lint` 에러 0개
7. ✅ `npm run build` 성공
8. ✅ Prisma/MySQL 의존성 없음 확인 (`package.json`)
9. ✅ Phase 1 제약사항 준수 확인

---

## 버전 정보

- **Plan Version**: 1.0.0
- **생성일**: 2025-12-16
- **최종 수정일**: 2025-12-16
- **상태**: draft

---

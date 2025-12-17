---
id: SPEC-MODULE-001
title: NestJS 핵심 모듈 스캐폴딩 (Phase 1)
type: acceptance-criteria
version: 1.0.0
created: 2025-12-16
updated: 2025-12-16
---

# Acceptance Criteria: SPEC-MODULE-001

## 개요

이 문서는 SPEC-MODULE-001(NestJS 핵심 모듈 스캐폴딩)의 상세 검증 시나리오를 정의합니다. Given-When-Then 형식의 테스트 케이스를 통해 구현 완료 여부를 명확히 판단할 수 있습니다.

---

## 검증 시나리오

### 시나리오 1: 서버 정상 시작 및 모듈 로드

**Given**:
- SPEC-INFRA-001 완료 (Docker Compose 인프라 실행 중)
- 5개 모듈 파일 생성 완료 (auth, relay, oz-relayer, config, common)
- `app.module.ts`에 모든 모듈 임포트 완료
- 환경변수 설정 완료 (`.env` 또는 기본값)

**When**:
```bash
npm run start:dev
```

**Then**:
1. ✅ 서버가 에러 없이 정상적으로 시작되어야 함
2. ✅ 콘솔에 다음 메시지 출력:
   ```
   [Nest] INFO [InstanceLoader] AppConfigModule dependencies initialized
   [Nest] INFO [InstanceLoader] CommonModule dependencies initialized
   [Nest] INFO [InstanceLoader] AuthModule dependencies initialized
   [Nest] INFO [InstanceLoader] OzRelayerModule dependencies initialized
   [Nest] INFO [InstanceLoader] RelayModule dependencies initialized
   [Nest] INFO [InstanceLoader] HealthModule dependencies initialized
   [Nest] INFO [NestApplication] Nest application successfully started
   API Gateway listening on port 3000
   ```
3. ✅ Prisma 또는 MySQL 관련 에러 메시지가 없어야 함
4. ✅ 프로세스가 정상적으로 실행 상태 유지 (종료되지 않음)

**검증 방법**:
- 콘솔 로그 확인
- `curl http://localhost:3000/api/v1/health` → 응답 확인

**실패 조건**:
- ❌ 모듈 로드 에러 발생
- ❌ 순환 의존성 에러 (`Circular dependency`)
- ❌ Prisma 연결 에러 (`Cannot connect to database`)

---

### 시나리오 2: Health Check 엔드포인트 접근

**Given**:
- 서버가 정상적으로 실행 중 (시나리오 1 완료)
- Health Check 엔드포인트 `@Public()` 데코레이터 적용됨

**When**:
```bash
curl http://localhost:3000/api/v1/health
```

**Then**:
1. ✅ HTTP 200 OK 응답
2. ✅ JSON 형식 응답:
   ```json
   {
     "relay-api": "healthy",
     "oz-relayer": "healthy",
     "redis": "healthy"
   }
   ```
3. ✅ 응답 시간 < 500ms
4. ✅ `X-API-Key` 헤더 없이 접근 가능 (인증 스킵)

**검증 방법**:
```bash
# 인증 없이 접근
curl -i http://localhost:3000/api/v1/health

# 예상 응답
HTTP/1.1 200 OK
Content-Type: application/json
...
{"relay-api":"healthy","oz-relayer":"healthy","redis":"healthy"}
```

**실패 조건**:
- ❌ 401 Unauthorized 응답 (`@Public()` 미적용)
- ❌ 500 Internal Server Error
- ❌ 응답 없음 (타임아웃)

---

### 시나리오 3: Lint 검증

**Given**:
- 모든 모듈 파일 생성 완료
- ESLint 설정 완료 (`.eslintrc.js`)

**When**:
```bash
npm run lint
```

**Then**:
1. ✅ Lint 에러 0개
2. ✅ 콘솔 출력:
   ```
   ✓ No ESLint warnings or errors
   ```
3. ✅ Warning 0개 (권장)

**검증 방법**:
- 터미널 출력 확인
- Exit code 0 확인

**실패 조건**:
- ❌ ESLint 에러 발생 (예: `Parsing error`, `Unexpected token`)
- ❌ Import 경로 오류 (`Unable to resolve path`)

---

### 시나리오 4: TypeScript 빌드

**Given**:
- 모든 모듈 파일 생성 완료
- TypeScript 설정 완료 (`tsconfig.json`)

**When**:
```bash
npm run build
```

**Then**:
1. ✅ 빌드 성공 (에러 없음)
2. ✅ `dist/` 디렉토리 생성
3. ✅ 모든 TypeScript 파일이 JavaScript로 컴파일됨
4. ✅ 콘솔 출력:
   ```
   Successfully compiled
   ```

**검증 방법**:
```bash
# 빌드 실행
npm run build

# dist/ 디렉토리 확인
ls -la dist/

# 예상 출력
dist/
├── app.module.js
├── main.js
├── auth/
├── relay/
├── oz-relayer/
├── config/
└── common/
```

**실패 조건**:
- ❌ TypeScript 컴파일 에러 (예: `Type error`, `Cannot find module`)
- ❌ `dist/` 디렉토리 미생성

---

### 시나리오 5: Prisma/MySQL 의존성 없음 확인

**Given**:
- `package.json` 파일 생성 완료

**When**:
```bash
cat package.json | jq '.dependencies'
```

**Then**:
1. ✅ `@prisma/client` 의존성 없음
2. ✅ `prisma` devDependency 없음
3. ✅ `mysql2` 의존성 없음
4. ✅ Phase 1 허용 의존성만 존재:
   ```json
   {
     "@nestjs/common": "^10.0.0",
     "@nestjs/core": "^10.0.0",
     "@nestjs/config": "^3.0.0",
     "@nestjs/axios": "^3.0.0",
     "class-validator": "^0.14.0",
     "class-transformer": "^0.5.0"
   }
   ```

**검증 방법**:
```bash
# Prisma 의존성 검색
npm list @prisma/client
# 예상 출력: (empty)

# MySQL 의존성 검색
npm list mysql2
# 예상 출력: (empty)
```

**실패 조건**:
- ❌ `@prisma/client` 또는 `mysql2` 의존성 존재

---

### 시나리오 6: 모듈 디렉토리 구조 검증

**Given**:
- 구현 완료 상태

**When**:
```bash
tree packages/relay-api/src/ -L 2
```

**Then**:
1. ✅ 다음 디렉토리 구조 존재:
   ```
   src/
   ├── app.module.ts
   ├── main.ts
   ├── auth/
   │   ├── auth.module.ts
   │   ├── guards/
   │   └── decorators/
   ├── relay/
   │   ├── relay.module.ts
   │   ├── direct/
   │   ├── gasless/
   │   └── status/
   ├── oz-relayer/
   │   ├── oz-relayer.module.ts
   │   └── oz-relayer.service.ts
   ├── config/
   │   ├── config.module.ts
   │   └── configuration.ts
   ├── common/
   │   ├── common.module.ts
   │   ├── filters/
   │   ├── interceptors/
   │   └── decorators/
   └── health/
       ├── health.module.ts
       ├── health.controller.ts
       └── health.service.ts
   ```

**검증 방법**:
- 파일 시스템 탐색
- 각 디렉토리 및 파일 존재 확인

**실패 조건**:
- ❌ 필수 디렉토리 누락 (예: `auth/`, `relay/`)
- ❌ 필수 파일 누락 (예: `auth.module.ts`)

---

### 시나리오 7: 환경변수 기본값 작동 확인

**Given**:
- 환경변수 미설정 상태 (`.env` 파일 없음)
- `configuration.ts`에 기본값 정의됨

**When**:
```bash
# 환경변수 없이 서버 시작
npm run start:dev
```

**Then**:
1. ✅ 서버가 기본값으로 정상 시작
2. ✅ 콘솔 로그:
   ```
   API Gateway listening on port 3000
   ```
3. ✅ Redis URL 기본값 사용: `redis://localhost:6379`
4. ✅ RPC URL 기본값 사용: `http://localhost:8545`

**검증 방법**:
- 콘솔 로그 확인
- Health Check 엔드포인트 정상 응답 확인

**실패 조건**:
- ❌ 환경변수 미설정으로 인한 서버 시작 실패
- ❌ `ConfigService.get()` 에러

---

### 시나리오 8: API Key Guard 전역 등록 확인

**Given**:
- 서버가 정상적으로 실행 중
- `AuthModule`에 `APP_GUARD` 프로바이더 등록됨

**When**:
```bash
# Health Check 제외 엔드포인트 접근 시도 (현재 존재하지 않지만, 구조 검증)
curl http://localhost:3000/api/v1/relay/direct
```

**Then**:
1. ✅ `ApiKeyGuard`가 전역으로 등록되어 있어야 함
2. ✅ `@Public()` 데코레이터가 없는 엔드포인트는 401 응답 (Phase 2+에서 검증)
3. ✅ Health Check(`@Public()` 적용)는 인증 없이 접근 가능

**검증 방법**:
- `app.module.ts`에서 `AuthModule` 임포트 확인
- `auth.module.ts`에서 `APP_GUARD` 프로바이더 확인

**실패 조건**:
- ❌ `ApiKeyGuard` 미등록
- ❌ `@Public()` 데코레이터 작동 안 함

---

## 통합 테스트 시나리오

### End-to-End 검증 시퀀스

```bash
# 1. 의존성 설치
npm install

# 2. Lint 검증
npm run lint
# 예상: 에러 0개

# 3. Build 검증
npm run build
# 예상: dist/ 생성 성공

# 4. 서버 시작
npm run start:dev
# 예상: "API Gateway listening on port 3000"

# 5. Health Check
curl http://localhost:3000/api/v1/health
# 예상: {"relay-api":"healthy",...}

# 6. Prisma 의존성 확인
npm list @prisma/client
# 예상: (empty)

# 7. 서버 종료
Ctrl+C
```

**전체 검증 성공 조건**:
1. ✅ 모든 명령어 에러 없이 실행 완료
2. ✅ 서버 정상 시작 및 종료
3. ✅ Health Check 200 OK 응답
4. ✅ Phase 1 제약사항 준수 (Prisma/MySQL 없음)

---

## 품질 게이트

### Definition of Done

**필수 조건** (모두 충족 필요):
- [x] 시나리오 1: 서버 정상 시작 ✅
- [x] 시나리오 2: Health Check 접근 ✅
- [x] 시나리오 3: Lint 검증 ✅
- [x] 시나리오 4: TypeScript 빌드 ✅
- [x] 시나리오 5: Prisma/MySQL 의존성 없음 ✅
- [x] 시나리오 6: 모듈 디렉토리 구조 ✅
- [x] 시나리오 7: 환경변수 기본값 작동 ✅
- [x] 시나리오 8: API Key Guard 전역 등록 ✅

**권장 조건** (선택):
- [ ] 각 모듈에 README.md 추가 (역할 설명)
- [ ] `.env.example` 파일 제공

---

## 실패 시 대응 방안

### 문제 1: 모듈 로드 실패

**증상**: `[Nest] ERROR [ExceptionHandler] Nest can't resolve dependencies`

**원인**: 순환 의존성 또는 프로바이더 미등록

**해결**:
1. 모듈 임포트 순서 확인 (config → common → auth → oz-relayer → relay)
2. 프로바이더 `exports` 배열 확인

### 문제 2: Prisma 연결 에러

**증상**: `Cannot connect to database` 또는 `Prisma Client not found`

**원인**: Phase 1 제약 위반 (Prisma 의존성 추가됨)

**해결**:
1. `package.json`에서 `@prisma/client` 제거
2. Prisma 관련 import 문 제거
3. `npm install` 재실행

### 문제 3: TypeScript 컴파일 에러

**증상**: `Type error: Cannot find module`

**원인**: Import 경로 오류 또는 타입 정의 누락

**해결**:
1. `tsconfig.json` paths 확인
2. 상대 경로 import 사용 (예: `../common/filters`)
3. `npm run lint` 실행하여 사전 검증

---

## 버전 정보

- **Acceptance Criteria Version**: 1.0.0
- **생성일**: 2025-12-16
- **최종 수정일**: 2025-12-16
- **상태**: draft

---

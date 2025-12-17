---
id: SPEC-MODULE-001
version: "1.0.0"
status: "draft"
created: "2025-12-16"
updated: "2025-12-16"
author: "@user"
priority: "high"
---

# SPEC-MODULE-001: NestJS 핵심 모듈 스캐폴딩 (Phase 1)

## 개요

NestJS 10.x 기반 API Gateway에 5개 핵심 모듈(auth, relay, oz-relayer, config, common)의 디렉토리 구조와 기본 NestJS 모듈 설정을 생성합니다. Phase 1 제약사항에 따라 Prisma/MySQL 없이 구성하며, 실제 엔드포인트 구현은 포함하지 않습니다.

**Phase 1 제약사항**:
- ❌ Prisma/MySQL 제외 (DB 연결 없음)
- ✅ Redis + OZ Relayer만 사용
- ✅ 단일 API Key 환경변수 인증
- ✅ 모듈 디렉토리 구조와 DI 설정만

## 목표

1. **모듈 스캐폴딩**: 5개 핵심 모듈의 디렉토리 구조 생성
2. **DI 컨테이너 설정**: 각 모듈의 `.module.ts` 파일과 의존성 주입 설정
3. **app.module.ts 통합**: 모든 모듈을 루트 모듈에 임포트
4. **Phase 1 제약 준수**: Prisma/MySQL 없이 서버 정상 시작

---

## HISTORY

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2025-12-16 | 초기 SPEC 생성: 5개 핵심 모듈 스캐폴딩 요구사항 정의 | manager-spec |

---

## EARS 요구사항

### Ubiquitous Requirements (시스템 전반)

**U-MODULE-001**: 모든 모듈은 NestJS 10.x 표준 모듈 구조(`@Module()` 데코레이터)를 따라야 함.

**U-MODULE-002**: Phase 1에서는 Prisma, MySQL 의존성을 `package.json`에 포함하지 않아야 함.

**U-MODULE-003**: 모든 모듈은 `app.module.ts`의 `imports` 배열에 등록되어야 함.

**U-MODULE-004**: 각 모듈은 독립적인 디렉토리 구조를 가져야 함 (예: `auth/`, `relay/`).

**U-MODULE-005**: 공통 기능(필터, 인터셉터, 데코레이터)은 `common/` 모듈에 위치해야 함.

### Event-driven Requirements (특정 이벤트 발생 시)

**E-MODULE-001**: `npm run start:dev` 실행 시, 모든 모듈이 DI 컨테이너에 정상적으로 로드되어야 함.

**E-MODULE-002**: 서버 시작 시, Prisma 또는 MySQL 연결 시도가 발생하지 않아야 함.

**E-MODULE-003**: `npm run lint` 실행 시, ESLint 에러가 발생하지 않아야 함.

**E-MODULE-004**: `npm run build` 실행 시, TypeScript 컴파일이 성공해야 함.

### State-driven Requirements (특정 상태 동안)

**S-MODULE-001**: 개발 모드(`NODE_ENV=development`)일 때, 파일 변경 시 핫 리로드가 작동해야 함.

**S-MODULE-002**: 모든 모듈이 로드된 상태에서, `http://localhost:3000/api/v1/health` 엔드포인트가 응답해야 함.

### Unwanted Behaviors (금지 동작)

**UW-MODULE-001**: Phase 1에서 `@prisma/client` 의존성을 추가하면 안 됨.

**UW-MODULE-002**: 실제 데이터베이스 연결 코드(Prisma Client 초기화)를 포함하면 안 됨.

**UW-MODULE-003**: 실제 REST API 엔드포인트 구현(컨트롤러 메서드)을 포함하면 안 됨.

**UW-MODULE-004**: Webhook, Queue, Policy Engine 관련 디렉토리를 생성하면 안 됨 (Phase 2+ 예정).

### Optional Requirements (선택 요구사항)

**O-MODULE-001**: 가능하다면, 각 모듈에 README.md를 추가하여 모듈의 역할을 설명할 수 있음.

---

## 기술 사양

### 디렉토리 구조

```
packages/relay-api/src/
├── app.module.ts               # 루트 모듈 (모든 모듈 임포트)
├── main.ts                     # 엔트리 포인트
├── auth/                       # 인증 모듈
│   ├── auth.module.ts
│   ├── guards/
│   │   └── api-key.guard.ts
│   └── decorators/
│       └── public.decorator.ts
├── relay/                      # Relay 엔드포인트 모듈
│   ├── relay.module.ts
│   ├── direct/                 # Direct TX 디렉토리 (비어있음)
│   ├── gasless/                # Gasless TX 디렉토리 (비어있음)
│   └── status/                 # Status 조회 디렉토리 (비어있음)
├── oz-relayer/                 # OZ Relayer 클라이언트 모듈
│   ├── oz-relayer.module.ts
│   └── oz-relayer.service.ts   # OZ Relayer API 클라이언트 (스텁)
├── config/                     # 환경변수 설정 모듈
│   ├── config.module.ts
│   └── configuration.ts        # Redis, RPC URL 설정
├── common/                     # 공통 기능 모듈
│   ├── common.module.ts
│   ├── filters/
│   │   └── exception.filter.ts
│   ├── interceptors/
│   │   └── logging.interceptor.ts
│   └── decorators/
└── health/                     # Health Check 모듈 (이미 존재)
    ├── health.module.ts
    ├── health.controller.ts
    └── health.service.ts
```

### 모듈별 구성 요소

#### 1. auth/ 모듈

**auth.module.ts**:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AuthModule {}
```

**guards/api-key.guard.ts**: API Key 검증 Guard (스텁 구현)
**decorators/public.decorator.ts**: `@Public()` 데코레이터

#### 2. relay/ 모듈

**relay.module.ts**:
```typescript
import { Module } from '@nestjs/common';

@Module({
  imports: [],
  controllers: [],  // Phase 2+에서 컨트롤러 추가
  providers: [],
})
export class RelayModule {}
```

**서브디렉토리**: `direct/`, `gasless/`, `status/` (비어있음, 구조만 생성)

#### 3. oz-relayer/ 모듈

**oz-relayer.module.ts**:
```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OzRelayerService } from './oz-relayer.service';

@Module({
  imports: [HttpModule],
  providers: [OzRelayerService],
  exports: [OzRelayerService],
})
export class OzRelayerModule {}
```

**oz-relayer.service.ts**: OZ Relayer API 클라이언트 서비스 (스텁 구현)

#### 4. config/ 모듈

**config.module.ts**:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import configuration from './configuration';

@Module({
  imports: [
    NestConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
  ],
})
export class AppConfigModule {}
```

**configuration.ts**:
```typescript
export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  apiKey: process.env.RELAY_API_KEY,
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  rpc: {
    url: process.env.RPC_URL || 'http://localhost:8545',
  },
});
```

#### 5. common/ 모듈

**common.module.ts**:
```typescript
import { Module } from '@nestjs/common';

@Module({
  providers: [],
  exports: [],
})
export class CommonModule {}
```

**filters/exception.filter.ts**: 전역 예외 필터 (스텁)
**interceptors/logging.interceptor.ts**: 로깅 인터셉터 (스텁)
**decorators/**: 공통 데코레이터 디렉토리

### app.module.ts 통합

```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { RelayModule } from './relay/relay.module';
import { OzRelayerModule } from './oz-relayer/oz-relayer.module';
import { AppConfigModule } from './config/config.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    HttpModule,
    AppConfigModule,    // 1. Config 먼저
    CommonModule,        // 2. Common 기능
    AuthModule,          // 3. 인증
    OzRelayerModule,     // 4. OZ Relayer 클라이언트
    RelayModule,         // 5. Relay 엔드포인트
    HealthModule,        // 6. Health Check
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

---

## 환경

### 개발 환경
- **OS**: macOS / Linux / Windows (Docker Desktop)
- **Node.js**: 20.x LTS
- **NestJS**: 10.x
- **TypeScript**: 5.x
- **Package Manager**: npm (pnpm 사용 가능)

### 런타임 환경
- **Docker Compose**: SPEC-INFRA-001 완료 상태
- **Redis**: redis:8.0-alpine (Port 6379)
- **Hardhat Node**: 로컬 블록체인 (Port 8545)

---

## 가정

1. **SPEC-INFRA-001 완료**: Docker Compose 인프라가 이미 구축되어 있음.
2. **Health Check 존재**: `health/` 모듈이 이미 구현되어 있음.
3. **Phase 1 제약**: Prisma/MySQL 없이 Redis + OZ Relayer만 사용.
4. **모듈 스캐폴딩**: 실제 엔드포인트 구현은 하지 않음 (디렉토리 구조만).

---

## 제약사항

### 기술 제약사항
- **NestJS**: 10.x 버전 고정
- **TypeScript**: 5.x 버전
- **Phase 1**: Prisma, MySQL, Webhook, Queue, Policy Engine 제외

### 보안 제약사항
- **API Key**: 환경변수 `RELAY_API_KEY` 단일 키 방식
- **Public 엔드포인트**: Health Check만 `@Public()` 데코레이터 적용

### 파일 위치 제약사항
- **모듈 위치**: `packages/relay-api/src/` 하위
- **설정 파일**: `config/` 모듈에 집중

---

## 의존성

### 기술 의존성
- **NestJS**: 10.x (`@nestjs/common`, `@nestjs/core`, `@nestjs/config`)
- **TypeScript**: 5.x
- **Node.js**: 20.x LTS
- **Redis Client**: `ioredis` (Phase 2+에서 실제 연결)

### 환경 의존성
- **Docker Compose**: SPEC-INFRA-001 완료 상태
- **환경변수**:
  - `RELAY_API_KEY`: API Key 인증
  - `REDIS_URL`: Redis 연결 URL
  - `RPC_URL`: Blockchain RPC 엔드포인트

---

## 비기능 요구사항

### 성능
- **서버 시작 시간**: < 5초 (cold start)
- **핫 리로드**: < 2초 (파일 변경 감지)

### 가용성
- **서버 시작 성공률**: >= 99%

### 보안
- **환경변수 분리**: `.env` 파일로 관리 (Git 제외)
- **API Key 검증**: 모든 엔드포인트 (Health Check 제외)

### 유지보수성
- **모듈 독립성**: 각 모듈은 독립적으로 테스트 가능
- **코드 포맷팅**: ESLint + Prettier 준수

---

## 추적성

### Task Master 통합
- **Task ID**: `2` (NestJS API Gateway 프로젝트 스캐폴드 및 기본 모듈 구성)
- **의존성**: Task `1` (Docker Compose 인프라 설정) 완료

### PRD 참조
- **PRD Section 3.1**: Phase 1 요구사항 (DB 없이 OZ Relayer + Redis만)
- **PRD Section 4**: 모듈 구조 및 API Gateway 구성

### 관련 문서
- `.taskmaster/tasks/tasks.json` (Task #2)
- `SPEC-INFRA-001` (Docker Compose 인프라)

---

## Acceptance Criteria (검증 기준)

### Given/When/Then 시나리오 1: 서버 정상 시작

**Given**: SPEC-INFRA-001 완료, Docker Compose 실행 중
**When**: `npm run start:dev` 실행
**Then**:
1. 서버가 정상적으로 시작되어야 함
2. 5개 모듈(auth, relay, oz-relayer, config, common)이 DI 컨테이너에 로드되어야 함
3. 콘솔에 "API Gateway listening on port 3000" 메시지 출력
4. Prisma/MySQL 연결 에러가 발생하지 않아야 함

### Given/When/Then 시나리오 2: Health Check 엔드포인트

**Given**: 서버가 정상적으로 실행 중
**When**: `curl http://localhost:3000/api/v1/health` 요청
**Then**:
1. HTTP 200 OK 응답
2. JSON 형식 응답 (`{ "relay-api": "healthy", ... }`)
3. 인증 없이 접근 가능 (`@Public()` 적용)

### Given/When/Then 시나리오 3: Lint 및 Build

**Given**: 모든 모듈 파일이 생성된 상태
**When**: `npm run lint` 실행
**Then**: ESLint 에러 0개

**When**: `npm run build` 실행
**Then**: TypeScript 컴파일 성공, `dist/` 디렉토리 생성

---

## 완료 체크리스트

- [ ] `auth/` 모듈 디렉토리 및 `auth.module.ts` 생성
- [ ] `relay/` 모듈 디렉토리 및 서브디렉토리 (`direct/`, `gasless/`, `status/`) 생성
- [ ] `oz-relayer/` 모듈 및 `oz-relayer.service.ts` 스텁 생성
- [ ] `config/` 모듈 및 `configuration.ts` 환경변수 설정
- [ ] `common/` 모듈 및 `filters/`, `interceptors/`, `decorators/` 디렉토리 생성
- [ ] `app.module.ts`에 모든 모듈 임포트
- [ ] `npm run start:dev` 정상 시작 확인
- [ ] `http://localhost:3000/api/v1/health` 200 OK 응답 확인
- [ ] `npm run lint` 에러 없음 확인
- [ ] `npm run build` 성공 확인
- [ ] Prisma/MySQL 의존성 없음 확인

---

## 버전 정보

- **SPEC Version**: 1.0.0
- **생성일**: 2025-12-16
- **최종 수정일**: 2025-12-16
- **상태**: draft
- **우선순위**: high

---

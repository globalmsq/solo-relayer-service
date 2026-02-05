# Acceptance Criteria: SPEC-REFACTOR-001

## Overview

프로젝트 이름 변경(msq-relayer-service → solo-relayer-service)의 수락 기준입니다.

---

## Scenario 1: Package Installation Success

**Given** 모든 package.json 파일이 @solo-relayer/ 스코프로 업데이트됨
**When** `rm -rf node_modules pnpm-lock.yaml && pnpm install` 실행
**Then** 모든 패키지가 성공적으로 설치되어야 함
**And** 경고 또는 에러 없이 완료되어야 함

---

## Scenario 2: Lint Check Pass

**Given** 모든 소스 코드에서 MSQ 참조가 Solo로 변경됨
**When** `pnpm lint` 실행
**Then** 린트 검사가 통과해야 함
**And** ESLint 에러가 0개여야 함

---

## Scenario 3: Unit Test Pass

**Given** 테스트 코드에서 MSQForwarder가 SoloForwarder로 변경됨
**When** `pnpm test` 실행
**Then** 모든 단위 테스트가 통과해야 함
**And** signature-verifier.service.spec.ts 테스트가 SoloForwarder 이름으로 통과해야 함

---

## Scenario 4: Build Success

**Given** 모든 패키지 설정이 @solo-relayer/ 스코프로 변경됨
**When** `pnpm build` 실행
**Then** 모든 패키지가 성공적으로 빌드되어야 함
**And** dist/ 폴더에 결과물이 생성되어야 함

---

## Scenario 5: Docker Compose Build

**Given** docker-compose.yaml에서 network와 volume 이름이 변경됨
**When** `cd docker && docker compose build` 실행
**Then** 모든 Docker 이미지가 성공적으로 빌드되어야 함
**And** 빌드 로그에 에러가 없어야 함

---

## Scenario 6: Docker Services Startup

**Given** Docker 이미지가 성공적으로 빌드됨
**When** `docker compose up -d` 실행
**Then** 모든 서비스가 healthy 상태로 시작되어야 함
**And** solo-relayer-network가 생성되어야 함
**And** solo-relayer-redis-data 볼륨이 생성되어야 함

---

## Scenario 7: Health Check API Response

**Given** relay-api 서비스가 실행 중
**When** `curl http://localhost:8080/api/v1/health` 요청
**Then** HTTP 200 응답을 받아야 함
**And** 응답에 "Solo" 관련 정보가 포함되어야 함

---

## Scenario 8: Swagger UI Title

**Given** relay-api 서비스가 실행 중
**When** `http://localhost:8080/api/docs` 접속
**Then** Swagger UI 타이틀이 "Solo Relayer Service API"로 표시되어야 함

---

## Scenario 9: No MSQ References Remain

**Given** 모든 변경이 완료됨
**When** `grep -r "MSQ" --include="*.ts" --include="*.json" --include="*.yaml" . | grep -v node_modules | grep -v CHANGELOG` 실행
**Then** MSQForwarder 외에 MSQ 문자열이 발견되지 않아야 함 (CHANGELOG 제외)

---

## Scenario 10: CI/CD Pipeline Pass

**Given** GitHub에 변경사항이 푸시됨
**When** GitHub Actions 워크플로우가 실행됨
**Then** lint, test, build 단계가 모두 통과해야 함
**And** @solo-relayer/relay-api 패키지가 올바르게 참조되어야 함

---

## Verification Checklist

### Package Configuration
- [ ] `pnpm install` 성공
- [ ] 모든 패키지 이름이 @solo-relayer/ 스코프

### Code Quality
- [ ] `pnpm lint` 통과
- [ ] `pnpm test` 통과
- [ ] `pnpm build` 성공

### Docker
- [ ] Docker Compose 빌드 성공
- [ ] 모든 서비스 healthy 상태
- [ ] solo-relayer-network 생성됨
- [ ] solo-relayer-redis-data 볼륨 생성됨

### API Verification
- [ ] Health check API 응답 확인
- [ ] Swagger UI 타이틀 확인

### Search Validation
- [ ] MSQ 참조 제거 확인 (CHANGELOG 제외)

---

## Post-Rename Tasks (별도 진행)

1. **계약 재배포**: SoloForwarder로 새 계약 배포
2. **환경변수 업데이트**: FORWARDER_ADDRESS 업데이트
3. **외부 서비스 알림**: msq-network 사용하는 다른 서비스에 변경 통보

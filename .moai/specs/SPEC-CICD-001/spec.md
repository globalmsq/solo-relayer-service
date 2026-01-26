# SPEC-CICD-001: contracts 및 integration-tests 패키지 ECR 빌드/푸시 추가

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-CICD-001 |
| 제목 | contracts 및 integration-tests 패키지 ECR 빌드/푸시 추가 |
| 생성일 | 2026-01-26 |
| 상태 | Planned |
| 우선순위 | Medium |
| 담당 | expert-devops |
| 관련 SPEC | SPEC-CONTRACTS-001 |

---

## 1. 환경 (Environment)

### 1.1 현재 상태

- **CI/CD 파이프라인**: `.github/workflows/_docker.yml` 재사용 워크플로우
- **현재 빌드 대상**: relay-api, queue-consumer, relayer-discovery (3개 패키지)
- **ECR 레지스트리**: `347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service`
- **Dockerfile**: `docker/Dockerfile.packages` (다중 타겟 지원)

### 1.2 기존 Dockerfile 타겟

| 타겟 | CI/CD 빌드 | 설명 |
|------|-----------|------|
| relay-api | O | NestJS API 서버 |
| queue-consumer | O | SQS 메시지 소비자 |
| relayer-discovery | O | 릴레이어 헬스 모니터링 |
| hardhat-node | X | 로컬 블록체인 (개발용) |
| **contracts-deploy** | **X (추가 대상)** | 컨트랙트 배포 이미지 |
| **integration-tests** | **X (추가 대상)** | 통합 테스트 러너 |

### 1.3 제약 조건

- 기존 워크플로우 구조 및 태깅 패턴 준수
- Turborepo affected packages 감지 활용
- 독립적 패키지 버전 관리 (per-package versioning)
- nightly/release 태깅 전략 일관성 유지

---

## 2. 가정 (Assumptions)

### 2.1 기술적 가정

- [HIGH] ECR 리포지토리 `contracts` 및 `integration-tests`가 이미 생성되어 있음
- [HIGH] `packages/contracts/package.json` 및 `packages/integration-tests/package.json`에 버전 필드 존재
- [MEDIUM] contracts-deploy 타겟은 컴파일된 컨트랙트를 포함하여 독립 실행 가능
- [MEDIUM] integration-tests 타겟은 테스트 실행에 필요한 모든 의존성 포함

### 2.2 비즈니스 가정

- contracts 이미지는 다양한 네트워크에 컨트랙트 배포 시 사용
- integration-tests 이미지는 CI/CD 파이프라인 또는 QA 환경에서 테스트 실행에 사용
- 두 패키지 모두 main 브랜치 푸시 시 nightly 빌드 필요

---

## 3. 요구사항 (Requirements)

### 3.1 유비쿼터스 요구사항 (Ubiquitous)

- [REQ-U-001] 시스템은 **항상** 기존 태깅 패턴(nightly, release)을 준수해야 한다
- [REQ-U-002] 시스템은 **항상** GitHub Actions Summary에 빌드 결과를 표시해야 한다

### 3.2 이벤트 기반 요구사항 (Event-Driven)

- [REQ-E-001] **WHEN** main 브랜치에 contracts 패키지 변경이 푸시되면 **THEN** contracts-deploy 이미지를 빌드하고 ECR에 푸시해야 한다
- [REQ-E-002] **WHEN** main 브랜치에 integration-tests 패키지 변경이 푸시되면 **THEN** integration-tests 이미지를 빌드하고 ECR에 푸시해야 한다
- [REQ-E-003] **WHEN** release 태그가 생성되면 **THEN** 해당 패키지의 stable 태그와 버전 태그를 생성해야 한다

### 3.3 상태 기반 요구사항 (State-Driven)

- [REQ-S-001] **IF** contracts 패키지에 변경이 없으면 **THEN** contracts 빌드를 스킵해야 한다
- [REQ-S-002] **IF** integration-tests 패키지에 변경이 없으면 **THEN** integration-tests 빌드를 스킵해야 한다
- [REQ-S-003] **IF** push 입력이 false이면 **THEN** 이미지 빌드만 수행하고 ECR 푸시는 스킵해야 한다

### 3.4 금지 요구사항 (Unwanted)

- [REQ-N-001] 시스템은 hardhat-node 타겟을 CI/CD에서 빌드**하지 않아야 한다** (개발 전용)
- [REQ-N-002] 시스템은 변경되지 않은 패키지의 이미지를 불필요하게 빌드**하지 않아야 한다**

---

## 4. 명세 (Specifications)

### 4.1 affected packages 체크 확장

```yaml
# 기존 패키지 (relay-api, queue-consumer, relayer-discovery)에 추가
for pkg in relay-api queue-consumer relayer-discovery contracts integration-tests; do
  pkg_var=$(echo "$pkg" | tr '-' '_')
  if echo "$AFFECTED" | grep -q "$pkg"; then
    echo "${pkg_var}=true" >> $GITHUB_OUTPUT
  else
    echo "${pkg_var}=false" >> $GITHUB_OUTPUT
  fi
done
```

### 4.2 태그 생성 확장

```yaml
# 기존 generate_tags 함수 활용
echo "contracts=$(generate_tags contracts)" >> $GITHUB_OUTPUT
echo "integration_tests=$(generate_tags integration-tests)" >> $GITHUB_OUTPUT
```

### 4.3 빌드/푸시 스텝 추가

| 패키지 | Dockerfile 타겟 | 조건 | 캐시 스코프 |
|--------|----------------|------|------------|
| contracts | contracts-deploy | contracts == 'true' | contracts |
| integration-tests | integration-tests | integration_tests == 'true' | integration-tests |

### 4.4 Summary 테이블 확장

기존 3개 패키지 + contracts + integration-tests = 총 5개 패키지 표시

---

## 5. 추적성 (Traceability)

| 요구사항 | 구현 위치 | 검증 방법 |
|---------|----------|----------|
| REQ-E-001 | _docker.yml (Build contracts step) | CI 로그 확인 |
| REQ-E-002 | _docker.yml (Build integration-tests step) | CI 로그 확인 |
| REQ-S-001 | _docker.yml (affected check) | PR 테스트 |
| REQ-S-002 | _docker.yml (affected check) | PR 테스트 |
| REQ-U-001 | generate_tags function | ECR 태그 확인 |
| REQ-U-002 | Summary step | Actions Summary 확인 |

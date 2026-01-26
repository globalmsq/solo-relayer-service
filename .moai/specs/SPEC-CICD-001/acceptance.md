# SPEC-CICD-001: 인수 기준

## 관련 SPEC

- **SPEC ID**: SPEC-CICD-001
- **참조**: [spec.md](./spec.md), [plan.md](./plan.md)

---

## 1. 인수 테스트 시나리오

### Scenario 1: contracts 패키지 변경 시 빌드

```gherkin
Feature: contracts 패키지 ECR 빌드/푸시

  Scenario: contracts 패키지 변경 시 이미지 빌드
    Given main 브랜치에 푸시가 발생했다
    And packages/contracts 디렉토리에 변경사항이 있다
    When Docker 워크플로우가 실행된다
    Then contracts-deploy 타겟이 빌드되어야 한다
    And ECR에 contracts 이미지가 푸시되어야 한다
    And 태그가 nightly 패턴을 따라야 한다

  Scenario: contracts 패키지 미변경 시 빌드 스킵
    Given main 브랜치에 푸시가 발생했다
    And packages/contracts 디렉토리에 변경사항이 없다
    When Docker 워크플로우가 실행된다
    Then contracts 빌드가 스킵되어야 한다
    And Summary에 "skipped"로 표시되어야 한다
```

### Scenario 2: integration-tests 패키지 변경 시 빌드

```gherkin
Feature: integration-tests 패키지 ECR 빌드/푸시

  Scenario: integration-tests 패키지 변경 시 이미지 빌드
    Given main 브랜치에 푸시가 발생했다
    And packages/integration-tests 디렉토리에 변경사항이 있다
    When Docker 워크플로우가 실행된다
    Then integration-tests 타겟이 빌드되어야 한다
    And ECR에 integration-tests 이미지가 푸시되어야 한다
    And 태그가 nightly 패턴을 따라야 한다

  Scenario: integration-tests 패키지 미변경 시 빌드 스킵
    Given main 브랜치에 푸시가 발생했다
    And packages/integration-tests 디렉토리에 변경사항이 없다
    When Docker 워크플로우가 실행된다
    Then integration-tests 빌드가 스킵되어야 한다
    And Summary에 "skipped"로 표시되어야 한다
```

### Scenario 3: Release 태깅

```gherkin
Feature: Release 버전 태깅

  Scenario: contracts 릴리스 태그 생성
    Given release 워크플로우가 트리거되었다
    And tag-type이 "release"이다
    And contracts 패키지 버전이 "1.2.3"이다
    When Docker 워크플로우가 실행된다
    Then contracts 이미지에 다음 태그가 생성되어야 한다:
      | 태그 |
      | v1.2.3 |
      | v1.2 |
      | stable |
```

### Scenario 4: Summary 테이블 표시

```gherkin
Feature: GitHub Actions Summary

  Scenario: 전체 패키지 빌드 결과 표시
    Given Docker 워크플로우가 완료되었다
    When Summary를 확인한다
    Then 5개 패키지 행이 표시되어야 한다:
      | 패키지 |
      | relay-api |
      | queue-consumer |
      | relayer-discovery |
      | contracts |
      | integration-tests |
    And 각 행에 빌드 상태(✅ 또는 ⏭️ skipped)가 표시되어야 한다
    And 빌드된 패키지는 태그 정보가 표시되어야 한다
```

---

## 2. Quality Gate 기준

### 2.1 기능 완료 기준

| 기준 | 검증 방법 | 필수 |
|-----|----------|-----|
| contracts 빌드 동작 | CI 로그 확인 | Yes |
| integration-tests 빌드 동작 | CI 로그 확인 | Yes |
| 변경 없음 시 스킵 동작 | PR 테스트 | Yes |
| nightly 태그 생성 | ECR 콘솔 확인 | Yes |
| release 태그 생성 | 릴리스 테스트 | Yes |
| Summary 표시 | Actions Summary 확인 | Yes |

### 2.2 비기능 기준

| 기준 | 목표 | 검증 방법 |
|-----|------|----------|
| 빌드 시간 | 기존 대비 30% 이내 증가 | CI 실행 시간 비교 |
| 캐시 적중률 | 70% 이상 | 캐시 로그 확인 |
| 기존 빌드 영향 | 없음 | 기존 패키지 빌드 테스트 |

---

## 3. 검증 방법

### 3.1 로컬 테스트 (Dry Run)

```bash
# 워크플로우 문법 검증
act -l

# contracts 태그 생성 테스트
PKG="contracts"
VERSION=$(jq -r '.version' "packages/${PKG}/package.json")
echo "contracts:${VERSION}-nightly"

# integration-tests 태그 생성 테스트
PKG="integration-tests"
VERSION=$(jq -r '.version' "packages/${PKG}/package.json")
echo "integration-tests:${VERSION}-nightly"
```

### 3.2 PR 테스트

1. feature 브랜치 생성
2. `packages/contracts/package.json` 또는 소스 파일 변경
3. PR 생성 후 워크플로우 실행 확인
4. Summary에서 contracts 빌드 결과 확인

### 3.3 ECR 푸시 테스트

1. main 브랜치에 머지
2. nightly 워크플로우 실행 확인
3. AWS ECR 콘솔에서 이미지 및 태그 확인:
   - `relayer-service/contracts:{version}-nightly`
   - `relayer-service/integration-tests:{version}-nightly`

---

## 4. Definition of Done

- [ ] 모든 인수 테스트 시나리오 통과
- [ ] Quality Gate 기준 충족
- [ ] 코드 리뷰 완료
- [ ] PR 머지
- [ ] 실제 main 브랜치 빌드 성공 확인
- [ ] ECR에 이미지 푸시 확인
- [ ] 관련 문서 업데이트 (필요시)

---

## 5. 롤백 계획

### 5.1 롤백 트리거

- contracts 또는 integration-tests 빌드로 인한 워크플로우 실패
- 기존 패키지 빌드에 영향 발생
- ECR 푸시 실패

### 5.2 롤백 절차

1. 해당 PR 리버트
2. main 브랜치에 리버트 커밋 푸시
3. 기존 워크플로우 동작 확인
4. 원인 분석 후 수정된 PR 재생성

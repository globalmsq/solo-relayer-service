# SPEC-CICD-001: 구현 계획

## 관련 SPEC

- **SPEC ID**: SPEC-CICD-001
- **참조**: [spec.md](./spec.md), [acceptance.md](./acceptance.md)

---

## 1. 구현 개요

### 1.1 변경 범위

- **수정 파일**: `.github/workflows/_docker.yml` (1개 파일)
- **영향도**: 낮음 (기존 패턴 확장)
- **위험도**: 낮음 (기존 빌드에 영향 없음)

### 1.2 기술적 접근 방식

기존 워크플로우의 패턴을 그대로 활용하여 2개 패키지를 추가합니다:

1. affected packages 체크에 contracts, integration-tests 추가
2. generate_tags 함수에 두 패키지 태그 생성 추가
3. docker/build-push-action 스텝 2개 추가
4. Summary 테이블에 두 패키지 행 추가

---

## 2. 마일스톤

### Primary Goal: affected packages 체크 확장

**목표**: contracts 및 integration-tests 패키지 변경 감지

**수정 내용**:
```yaml
# Line 61: for 루프 확장
for pkg in relay-api queue-consumer relayer-discovery contracts integration-tests; do
```

**검증**: `steps.affected.outputs.contracts` 및 `steps.affected.outputs.integration_tests` 출력 확인

---

### Secondary Goal: 태그 생성 추가

**목표**: 두 패키지에 대한 Docker 태그 생성

**수정 내용**:
```yaml
# tags step에 추가
echo "contracts=$(generate_tags contracts)" >> $GITHUB_OUTPUT
echo "integration_tests=$(generate_tags integration-tests)" >> $GITHUB_OUTPUT
```

**참고**:
- contracts 패키지 경로: `packages/contracts/package.json`
- integration-tests 패키지 경로: `packages/integration-tests/package.json`

---

### Tertiary Goal: 빌드/푸시 스텝 추가

**목표**: Docker 이미지 빌드 및 ECR 푸시

**contracts 빌드 스텝**:
```yaml
- name: Build and push contracts
  if: steps.affected.outputs.contracts == 'true'
  uses: docker/build-push-action@v6
  with:
    context: .
    file: docker/Dockerfile.packages
    target: contracts-deploy
    push: ${{ inputs.push }}
    cache-from: type=gha,scope=contracts
    cache-to: type=gha,mode=max,scope=contracts
    tags: ${{ steps.tags.outputs.contracts }}
```

**integration-tests 빌드 스텝**:
```yaml
- name: Build and push integration-tests
  if: steps.affected.outputs.integration_tests == 'true'
  uses: docker/build-push-action@v6
  with:
    context: .
    file: docker/Dockerfile.packages
    target: integration-tests
    push: ${{ inputs.push }}
    cache-from: type=gha,scope=integration-tests
    cache-to: type=gha,mode=max,scope=integration-tests
    tags: ${{ steps.tags.outputs.integration_tests }}
```

---

### Final Goal: Summary 테이블 업데이트

**목표**: GitHub Actions Summary에 5개 패키지 빌드 결과 표시

**추가 내용**:
```yaml
# contracts 행
if [ "${{ steps.affected.outputs.contracts }}" = "true" ]; then
  echo "| contracts | ✅ | \`${{ steps.tags.outputs.contracts }}\` |" >> $GITHUB_STEP_SUMMARY
else
  echo "| contracts | ⏭️ skipped | - |" >> $GITHUB_STEP_SUMMARY
fi

# integration-tests 행
if [ "${{ steps.affected.outputs.integration_tests }}" = "true" ]; then
  echo "| integration-tests | ✅ | \`${{ steps.tags.outputs.integration_tests }}\` |" >> $GITHUB_STEP_SUMMARY
else
  echo "| integration-tests | ⏭️ skipped | - |" >> $GITHUB_STEP_SUMMARY
fi
```

---

## 3. 아키텍처 설계

### 3.1 워크플로우 흐름

```
main 브랜치 푸시
    │
    ▼
Check affected packages (Turborepo)
    │
    ├─ relay-api 변경? ──────► Build relay-api
    ├─ queue-consumer 변경? ──► Build queue-consumer
    ├─ relayer-discovery 변경? ► Build relayer-discovery
    ├─ contracts 변경? ────────► Build contracts-deploy [NEW]
    └─ integration-tests 변경? ► Build integration-tests [NEW]
    │
    ▼
Generate Summary Table (5 packages)
```

### 3.2 태깅 전략 (기존 패턴 준수)

**Nightly 태그** (main 브랜치 푸시 시):
- `{version}-nightly`
- `{version}-nightly.{YYYYMMDD}`
- `{sha-short}`
- `nightly`

**Release 태그** (release 워크플로우):
- `v{version}`
- `v{major}.{minor}`
- `stable`

---

## 4. 위험 및 대응

| 위험 | 확률 | 영향 | 대응 방안 |
|-----|------|-----|----------|
| package.json 버전 필드 누락 | 낮음 | 빌드 실패 | 사전 검증 후 구현 |
| ECR 리포지토리 미존재 | 낮음 | 푸시 실패 | AWS 콘솔에서 확인 |
| 캐시 충돌 | 매우 낮음 | 빌드 시간 증가 | 고유 스코프명 사용 |

---

## 5. 의존성

### 5.1 선행 조건

- [x] ECR 리포지토리 존재 확인 (이미 존재함)
- [x] Dockerfile 타겟 존재 확인 (contracts-deploy, integration-tests)
- [ ] package.json 버전 필드 확인

### 5.2 후속 작업

- 릴리스 워크플로우에서 두 패키지 포함 여부 검토
- 문서 업데이트 (CI/CD 가이드)

---

## 6. 구현 체크리스트

- [ ] affected packages 체크 확장 (for 루프)
- [ ] contracts 태그 생성 추가
- [ ] integration_tests 태그 생성 추가
- [ ] contracts 빌드/푸시 스텝 추가
- [ ] integration-tests 빌드/푸시 스텝 추가
- [ ] Summary 테이블에 contracts 행 추가
- [ ] Summary 테이블에 integration-tests 행 추가
- [ ] 로컬 테스트 (dry-run)
- [ ] PR 생성 및 리뷰

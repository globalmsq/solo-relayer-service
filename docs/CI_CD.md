# CI/CD Strategy

MSQ Relayer Service의 CI/CD 파이프라인 및 버전 관리 전략을 설명합니다.

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Developer Workflow                                                  │
│  ───────────────────────────────────────────────────────────────────│
│  1. Feature development                                              │
│  2. pnpm changeset  ← Record change type (patch/minor/major)        │
│  3. Create PR and merge                                             │
│                                                                      │
│  ⚠️ No changeset → Changeset Bot adds warning comment to PR         │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Automation (GitHub Actions)                                         │
│  ───────────────────────────────────────────────────────────────────│
│  1. Main merge → Nightly Docker build & ECR Push                    │
│  2. Changesets Bot → Auto-create "Version Packages" PR              │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Release (Manual Approval)                                           │
│  ───────────────────────────────────────────────────────────────────│
│  1. Review & merge "Version Packages" PR                            │
│  2. Auto-update package.json versions + generate CHANGELOG          │
│  3. Auto-create Git tag (v1.1.0)                                    │
│  4. GitHub Release → Release Docker build & ECR Push                │
└─────────────────────────────────────────────────────────────────────┘
```

## Docker Image Tagging Strategy

### ECR Repositories

| Repository | URL |
|------------|-----|
| relay-api | `347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service/relay-api` |
| queue-consumer | `347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service/queue-consumer` |
| relayer-discovery | `347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service/relayer-discovery` |

### Nightly Tags (Main Branch Merge)

Main 브랜치에 머지될 때마다 자동으로 빌드됩니다.

| Tag | Example | Type | Purpose |
|-----|---------|------|---------|
| `{version}-nightly` | `1.0.0-nightly` | Rolling | 버전별 최신 nightly |
| `{version}-nightly.{YYYYMMDD}` | `1.0.0-nightly.20260123` | Rolling | 날짜별 최신 (덮어쓰기 허용) |
| `{sha:8}` | `abc1234d` | Immutable | 정확한 빌드 추적 |
| `nightly` | `nightly` | Rolling | 전체 최신 |

> **Note:** 날짜 태그는 같은 날 여러 빌드 시 덮어쓰기됩니다. 정확한 빌드 추적이 필요하면 SHA 태그를 사용하세요.

### Release Tags (GitHub Release)

GitHub Release를 생성하면 자동으로 빌드됩니다.

| Tag | Example | Type | Purpose |
|-----|---------|------|---------|
| `v{version}` | `v1.1.0` | Immutable | 정확한 버전 |
| `v{major}.{minor}` | `v1.1` | Rolling | 패치 자동 업데이트 |
| `v{major}` | `v1` | Rolling | 마이너 자동 업데이트 |
| `stable` | `stable` | Rolling | 프로덕션 최신 |

## Version Management (Changesets)

Changesets를 사용하여 monorepo의 버전을 관리합니다.

### Changesets 설정

모든 패키지가 동일한 버전을 유지하도록 `fixed` 옵션이 설정되어 있습니다:

```json
// .changeset/config.json
{
  "fixed": [["@msq-relayer/*"]]
}
```

### 개발 후 버전 업데이트 방법

#### Step 1: Changeset 생성

기능 개발이 완료되면 changeset을 생성합니다:

```bash
pnpm changeset
```

대화형 프롬프트가 나타납니다:

```
? Which packages would you like to include?
  ◉ @msq-relayer/relay-api
  ◉ @msq-relayer/queue-consumer
  ◉ @msq-relayer/relayer-discovery

? What kind of change is this for @msq-relayer/* packages?
  ○ patch (1.0.0 → 1.0.1)  # 버그 수정, 사소한 변경
  ○ minor (1.0.0 → 1.1.0)  # 새 기능 추가
  ○ major (1.0.0 → 2.0.0)  # Breaking change

? Summary: Added new authentication feature
```

이렇게 하면 `.changeset/random-name.md` 파일이 생성됩니다:

```markdown
---
"@msq-relayer/relay-api": minor
"@msq-relayer/queue-consumer": minor
"@msq-relayer/relayer-discovery": minor
---

Added new authentication feature
```

#### Step 2: PR 생성 및 머지

Changeset 파일과 함께 PR을 생성하고 머지합니다.

#### Step 3: Version Packages PR 머지 (릴리스)

Main 브랜치에 머지되면 Changesets Bot이 자동으로 "Version Packages" PR을 생성합니다.

이 PR에는:
- `package.json` 버전 업데이트
- `CHANGELOG.md` 자동 생성
- `.changeset/*.md` 파일 삭제

릴리스 준비가 되면 이 PR을 머지하세요.

### 버전 타입 가이드라인

| Type | When to Use | Example |
|------|-------------|---------|
| **patch** | 버그 수정, 문서 수정, 내부 리팩토링 | 1.0.0 → 1.0.1 |
| **minor** | 새 기능 추가, 하위 호환 API 변경 | 1.0.0 → 1.1.0 |
| **major** | Breaking change, 하위 비호환 API 변경 | 1.0.0 → 2.0.0 |

### Changeset 없이 PR 머지 시

Changeset Bot이 PR에 경고 코멘트를 추가합니다:

```
⚠️ No Changeset found

This PR has no changeset. If this is intentional, you can ignore this message.
Otherwise, run `pnpm changeset` to create one.
```

다음 경우에는 changeset 없이 머지해도 됩니다:
- 문서만 수정하는 PR
- CI/CD 설정 변경
- 테스트 코드만 변경

## CI Workflows

### Workflow Architecture

```
.github/
├── actions/
│   └── setup-node-pnpm/    # Composite Action (재사용 가능한 Setup)
│       └── action.yml
└── workflows/
    ├── ci.yml              # PR CI (lint, test, build)
    ├── cd.yml              # Main merge → CI + Docker
    ├── release.yml         # GitHub Release → Docker
    ├── changesets.yml      # Version management
    ├── _shared.yml         # Reusable CI jobs
    └── _docker.yml         # Reusable Docker build & push
```

### 1. CI (ci.yml)

PR에서 실행되는 기본 CI:

- Lint
- Unit tests
- Build verification

### 2. CD (cd.yml)

Main 브랜치 머지 시 실행:

- `_shared.yml` 호출 (E2E tests 포함)
- `_docker.yml` 호출 (Nightly tags로 ECR Push)
- Turborepo를 통한 선택적 빌드

### 3. Release (release.yml)

GitHub Release 생성 시 실행:

- Semver 태그 검증
- `_docker.yml` 호출 (Release tags로 ECR Push)
- Release notes 자동 업데이트

### 4. Changesets (changesets.yml)

Main 브랜치 머지 시 실행:

- Changeset 분석
- "Version Packages" PR 자동 생성

### 5. Reusable Workflows

#### _shared.yml (CI Jobs)

재사용 가능한 CI 작업:

- Lint, Test, Build, E2E
- Composite Action으로 Setup 간소화

#### _docker.yml (Docker Build & Push)

재사용 가능한 Docker 빌드:

- 영향받는 패키지만 선택적 빌드 (Turborepo)
- Nightly/Release 태그 자동 생성
- AWS ECR 인증 및 Push

## Turborepo Integration

Turborepo를 사용하여 변경된 패키지만 선택적으로 빌드합니다:

```yaml
# 영향받는 패키지 감지
AFFECTED=$(pnpm turbo build --filter="...[HEAD~1]" --dry-run=json)

# 패키지별 조건부 빌드
if echo "$AFFECTED" | grep -q "relay-api"; then
  # Build relay-api
fi
```

## Prerequisites

### GitHub Secrets 설정

Repository Settings → Secrets and variables → Actions에서 설정:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | ECR push 권한이 있는 IAM access key |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |

### IAM Policy

ECR push에 필요한 최소 권한:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:ap-northeast-2:347765734000:repository/relayer-service/*"
    }
  ]
}
```

### Changeset Bot 설치

GitHub Marketplace에서 Changeset Bot 설치:
https://github.com/apps/changeset-bot

## Pulling Images

### AWS CLI 인증 후 이미지 Pull

```bash
# ECR 로그인
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin \
  347765734000.dkr.ecr.ap-northeast-2.amazonaws.com

# Nightly 이미지 Pull
docker pull 347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service/relay-api:nightly
docker pull 347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service/queue-consumer:nightly
docker pull 347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service/relayer-discovery:nightly

# Release 이미지 Pull
docker pull 347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service/relay-api:v1.0.0
docker pull 347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service/queue-consumer:v1.0.0
docker pull 347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service/relayer-discovery:v1.0.0
```

## ECR Lifecycle Policy (권장)

오래된 이미지 자동 정리를 위한 Lifecycle Policy:

```json
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep last 30 nightly builds",
      "selection": {
        "tagStatus": "tagged",
        "tagPatternList": ["*-nightly.*"],
        "countType": "imageCountMoreThan",
        "countNumber": 30
      },
      "action": { "type": "expire" }
    },
    {
      "rulePriority": 2,
      "description": "Remove untagged after 7 days",
      "selection": {
        "tagStatus": "untagged",
        "countType": "sinceImagePushed",
        "countUnit": "days",
        "countNumber": 7
      },
      "action": { "type": "expire" }
    }
  ]
}
```

---

**Last Updated**: 2026-01-23
**Version**: 1.0.0

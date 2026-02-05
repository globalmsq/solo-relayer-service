# Implementation Plan: SPEC-REFACTOR-001

## Overview

프로젝트 이름을 `msq-relayer-service`에서 `solo-relayer-service`로 변경하는 7단계 구현 계획입니다.

---

## Phase 1: Package Configuration (7 files)

### 1.1 Root package.json

**File:** `package.json`

| Pattern | Replacement |
|---------|-------------|
| `"name": "msq-relayer-service"` | `"name": "solo-relayer-service"` |
| `MSQ Relayer Service` | `Solo Relayer Service` |
| `@msq-relayer/` | `@solo-relayer/` |
| `msq-relayer-service.git` | `solo-relayer-service.git` |

### 1.2 Package Workspaces (5 files)

| File | Change |
|------|--------|
| `packages/relay-api/package.json` | `@msq-relayer/relay-api` → `@solo-relayer/relay-api` |
| `packages/queue-consumer/package.json` | `@msq-relayer/queue-consumer` → `@solo-relayer/queue-consumer` |
| `packages/relayer-discovery/package.json` | `@msq-relayer/relayer-discovery` → `@solo-relayer/relayer-discovery` |
| `packages/contracts/package.json` | `@msq-relayer/contracts` → `@solo-relayer/contracts` |
| `packages/integration-tests/package.json` | `@msq-relayer/integration-tests` → `@solo-relayer/integration-tests` |

### 1.3 Other Config Files

| File | Change |
|------|--------|
| `.changeset/config.json` | `@msq-relayer/integration-tests` → `@solo-relayer/integration-tests` |
| `packages/integration-tests/jest.config.js` | `@msq-relayer/relay-api` → `@solo-relayer/relay-api` |
| `packages/integration-tests/tsconfig.json` | Path alias 업데이트 |
| `.moai/config/config.yaml` | `name: msq-relayer-service` → `name: solo-relayer-service` |

---

## Phase 2: Docker Configuration (8+ files)

### 2.1 docker-compose.yaml

**File:** `docker/docker-compose.yaml`

| Pattern | Replacement |
|---------|-------------|
| `msq-relayer-network` | `solo-relayer-network` |
| `msq-network` | `solo-network` |
| `msq-relayer-redis-data` | `solo-relayer-redis-data` |
| `msq-relayer-mysql-data` | `solo-relayer-mysql-data` |
| `msq_relayer` (database) | `solo_relayer` |

### 2.2 docker-compose-amoy.yaml

**File:** `docker/docker-compose-amoy.yaml`

동일한 패턴 적용:
- `msq-relayer-redis-data-amoy` → `solo-relayer-redis-data-amoy`
- `msq-relayer-mysql-data-amoy` → `solo-relayer-mysql-data-amoy`

### 2.3 Dockerfile.packages

**File:** `docker/Dockerfile.packages`

- 주석: `MSQ Relayer Service` → `Solo Relayer Service`

### 2.4 OZ Relayer Config Files (6 files)

**Directory:** `docker/config/oz-relayer/`

| File | Change |
|------|--------|
| `relayer-0.json` | `"name": "MSQ Relayer 0..."` → `"name": "Solo Relayer 0..."` |
| `relayer-1.json` | `"name": "MSQ Relayer 1..."` → `"name": "Solo Relayer 1..."` |
| `relayer-2.json` | `"name": "MSQ Relayer 2..."` → `"name": "Solo Relayer 2..."` |
| `relayer-0-amoy.json` | 동일 패턴 |
| `relayer-1-amoy.json` | 동일 패턴 |
| `relayer-2-amoy.json` | 동일 패턴 |

---

## Phase 3: Source Code (8 files)

### 3.1 Forwarder Name (Critical Change)

| File | Line | Change |
|------|------|--------|
| `packages/relay-api/src/relay/gasless/signature-verifier.service.ts` | 26, 34 | `MSQForwarder` → `SoloForwarder` |
| `packages/relay-api/src/relay/gasless/signature-verifier.service.spec.ts` | 24 | `MSQForwarder` → `SoloForwarder` |
| `packages/contracts/scripts/deploy-forwarder.ts` | 22 | `MSQForwarder` → `SoloForwarder` |
| `packages/contracts/scripts/deploy-samples.ts` | 32 | `MSQForwarder` → `SoloForwarder` |
| `packages/contracts/scripts/deployers/forwarder.ts` | 13 | `MSQForwarder` → `SoloForwarder` |
| `packages/relay-api/scripts/test-gasless.ts` | 15 | `MSQForwarder` → `SoloForwarder` |

### 3.2 API Service

**File:** `packages/relay-api/src/main.ts`

| Line | Change |
|------|--------|
| 62 | `.setTitle("MSQ Relayer Service API")` → `.setTitle("Solo Relayer Service API")` |
| 74 | `MSQ Relayer API Gateway` → `Solo Relayer API Gateway` |

### 3.3 Error Classification

**File:** `packages/queue-consumer/src/errors/relay-errors.ts`

- Line 2: `MSQ Relayer Service` → `Solo Relayer Service`

### 3.4 Queue Consumer Config

**File:** `packages/queue-consumer/src/config/configuration.ts`

- Line 8: Database URL `msq_relayer` → `solo_relayer`

---

## Phase 4: Environment Files (5 files)

| File | Changes |
|------|---------|
| `packages/contracts/.env.example` | `# MSQ Contracts` → `# Solo Contracts` |
| `packages/contracts/.env.amoy` | `# MSQ Contracts` → `# Solo Contracts` |
| `packages/relay-api/.env.example` | Header + DATABASE_URL |
| `packages/relay-api/.env` | DATABASE_URL: `msq_relayer` → `solo_relayer` |
| `packages/relay-api/.env.amoy` | FORWARDER_NAME comment |

---

## Phase 5: CI/CD Workflows (1 file)

**File:** `.github/workflows/_shared.yml`

Lines 47, 73, 101, 104:
- `@msq-relayer/relay-api` → `@solo-relayer/relay-api`

---

## Phase 6: Documentation (20+ files)

### 6.1 Main README

**File:** `README.md`

- 전체 `msq-relayer` → `solo-relayer`
- `MSQ Relayer` → `Solo Relayer`
- `MSQForwarder` → `SoloForwarder`

### 6.2 docs/ Directory (16 files)

| File | Estimated Changes |
|------|-------------------|
| `docs/ARCHITECTURE.md` | ~10 occurrences |
| `docs/CI_CD.md` | ~15 occurrences |
| `docs/CONTRACTS_GUIDE.md` | ~5 occurrences |
| `docs/DEPLOYMENT.md` | ~20 occurrences |
| `docs/DOCKER_SETUP.md` | ~15 occurrences |
| `docs/product.md` | ~5 occurrences |
| `docs/SQS_SETUP.md` | ~5 occurrences |
| `docs/structure.md` | ~10 occurrences |
| `docs/tech.md` | ~30 occurrences |
| `docs/TESTING.md` | ~10 occurrences |

### 6.3 Package READMEs (5 files)

- `packages/relay-api/README.md`
- `packages/queue-consumer/README.md`
- `packages/relayer-discovery/README.md`
- `packages/contracts/README.md`
- `packages/integration-tests/README.md`

### 6.4 Misc Files

- `.gitignore` Line 4: Comment header
- `CHANGELOG.md`: Historical references (선택적)

---

## Phase 7: Contract Deployment Update

**File:** `packages/contracts/deployments/polygon-amoy.json`

계약 재배포 후:
- 새 Forwarder 주소로 업데이트
- EIP-712 domain name 확인

---

## Execution Order

```
1. Feature branch 생성
   git checkout -b feature/rename-to-solo-relayer

2. Phase 1: Package 설정 변경 (7 files)
3. Phase 2: Docker 설정 변경 (8+ files)
4. Phase 3: Source code 변경 (8 files)
5. Phase 4: Environment 파일 변경 (5 files)
6. Phase 5: CI/CD workflow 변경 (1 file)
7. Phase 6: Documentation 변경 (20+ files)

8. Verification
   - rm -rf node_modules pnpm-lock.yaml && pnpm install
   - pnpm lint
   - pnpm test
   - pnpm build
   - docker compose build & test

9. Commit & PR
```

---

## Risk Analysis

### High Risk
- **Contract Redeployment**: MSQForwarder → SoloForwarder requires new deployment
- **EIP-712 Signature**: Domain name change breaks existing signatures

### Medium Risk
- **Docker Volumes**: Data loss when switching to new volume names
- **External Dependencies**: Services using msq-network need updates

### Low Risk
- **Documentation**: Non-breaking changes
- **Package Names**: Internal naming only

---

## Rollback Strategy

1. Git revert to pre-rename commit
2. Restore old Docker volumes from backup
3. Redeploy old MSQForwarder contract if needed

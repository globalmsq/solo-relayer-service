# SPEC-CICD-001: Implementation Plan

## Related SPEC

- **SPEC ID**: SPEC-CICD-001
- **References**: [spec.md](./spec.md), [acceptance.md](./acceptance.md)

---

## 1. Implementation Overview

### 1.1 Change Scope

- **Modified File**: `.github/workflows/_docker.yml` (1 file)
- **Impact**: Low (extends existing patterns)
- **Risk**: Low (no impact on existing builds)

### 1.2 Technical Approach

Extend the workflow by leveraging existing patterns to add 2 packages:

1. Add contracts, integration-tests to affected packages check
2. Add tag generation for both packages to generate_tags function
3. Add 2 docker/build-push-action steps
4. Add 2 rows to Summary table

---

## 2. Milestones

### Primary Goal: Extend Affected Packages Check

**Objective**: Detect contracts and integration-tests package changes

**Modification**:
```yaml
# Line 61: Extend for loop
for pkg in relay-api queue-consumer relayer-discovery contracts integration-tests; do
```

**Verification**: Confirm `steps.affected.outputs.contracts` and `steps.affected.outputs.integration_tests` outputs

---

### Secondary Goal: Add Tag Generation

**Objective**: Generate Docker tags for both packages

**Modification**:
```yaml
# Add to tags step
echo "contracts=$(generate_tags contracts)" >> $GITHUB_OUTPUT
echo "integration_tests=$(generate_tags integration-tests)" >> $GITHUB_OUTPUT
```

**Note**:
- contracts package path: `packages/contracts/package.json`
- integration-tests package path: `packages/integration-tests/package.json`

---

### Tertiary Goal: Add Build/Push Steps

**Objective**: Docker image build and ECR push

**contracts build step**:
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

**integration-tests build step**:
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

### Final Goal: Update Summary Table

**Objective**: Display 5 package build results in GitHub Actions Summary

**Addition**:
```yaml
# contracts row
if [ "${{ steps.affected.outputs.contracts }}" = "true" ]; then
  echo "| contracts | ✅ | \`${{ steps.tags.outputs.contracts }}\` |" >> $GITHUB_STEP_SUMMARY
else
  echo "| contracts | ⏭️ skipped | - |" >> $GITHUB_STEP_SUMMARY
fi

# integration-tests row
if [ "${{ steps.affected.outputs.integration_tests }}" = "true" ]; then
  echo "| integration-tests | ✅ | \`${{ steps.tags.outputs.integration_tests }}\` |" >> $GITHUB_STEP_SUMMARY
else
  echo "| integration-tests | ⏭️ skipped | - |" >> $GITHUB_STEP_SUMMARY
fi
```

---

## 3. Architecture Design

### 3.1 Workflow Flow

```
main branch push
    │
    ▼
Check affected packages (Turborepo)
    │
    ├─ relay-api changed? ──────► Build relay-api
    ├─ queue-consumer changed? ──► Build queue-consumer
    ├─ relayer-discovery changed? ► Build relayer-discovery
    ├─ contracts changed? ────────► Build contracts-deploy [NEW]
    └─ integration-tests changed? ► Build integration-tests [NEW]
    │
    ▼
Generate Summary Table (5 packages)
```

### 3.2 Tagging Strategy (Following Existing Patterns)

**Nightly tags** (on main branch push):
- `{version}-nightly`
- `{version}-nightly.{YYYYMMDD}`
- `{sha-short}`
- `nightly`

**Release tags** (release workflow):
- `v{version}`
- `v{major}.{minor}`
- `stable`

---

## 4. Risks and Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Missing version field in package.json | Low | Build failure | Pre-implementation verification |
| ECR repository not existing | Low | Push failure | Verify in AWS console |
| Cache collision | Very Low | Increased build time | Use unique scope names |

---

## 5. Dependencies

### 5.1 Prerequisites

- [x] ECR repository existence confirmed (already exists)
- [x] Dockerfile targets existence confirmed (contracts-deploy, integration-tests)
- [x] package.json version field verified

### 5.2 Follow-up Tasks

- Review whether to include both packages in release workflow
- Update documentation (CI/CD guide)

---

## 6. Implementation Checklist

- [x] Extend affected packages check (for loop)
- [x] Add contracts tag generation
- [x] Add integration_tests tag generation
- [x] Add contracts build/push step
- [x] Add integration-tests build/push step
- [x] Add contracts row to Summary table
- [x] Add integration-tests row to Summary table
- [x] Local test (dry-run)
- [x] PR creation and review

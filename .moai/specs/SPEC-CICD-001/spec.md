# SPEC-CICD-001: Add contracts and integration-tests Packages to ECR Build/Push

## Metadata

| Field | Value |
|-------|-------|
| SPEC ID | SPEC-CICD-001 |
| Title | Add contracts and integration-tests Packages to ECR Build/Push |
| Created | 2026-01-26 |
| Status | Completed |
| Priority | Medium |
| Assignee | expert-devops |
| Related SPEC | SPEC-CONTRACTS-001 |

---

## 1. Environment

### 1.1 Current State

- **CI/CD Pipeline**: `.github/workflows/_docker.yml` reusable workflow
- **Current Build Targets**: relay-api, queue-consumer, relayer-discovery (3 packages)
- **ECR Registry**: `347765734000.dkr.ecr.ap-northeast-2.amazonaws.com/relayer-service`
- **Dockerfile**: `docker/Dockerfile.packages` (multi-target support)

### 1.2 Existing Dockerfile Targets

| Target | CI/CD Build | Description |
|--------|-------------|-------------|
| relay-api | O | NestJS API server |
| queue-consumer | O | SQS message consumer |
| relayer-discovery | O | Relayer health monitoring |
| hardhat-node | X | Local blockchain (development only) |
| **contracts-deploy** | **X (to be added)** | Contract deployment image |
| **integration-tests** | **X (to be added)** | Integration test runner |

### 1.3 Constraints

- Must follow existing workflow structure and tagging patterns
- Leverage Turborepo affected packages detection
- Independent package versioning (per-package versioning)
- Maintain nightly/release tagging strategy consistency

---

## 2. Assumptions

### 2.1 Technical Assumptions

- [HIGH] ECR repositories `contracts` and `integration-tests` already exist
- [HIGH] `packages/contracts/package.json` and `packages/integration-tests/package.json` have version fields
- [MEDIUM] contracts-deploy target includes compiled contracts and can run independently
- [MEDIUM] integration-tests target includes all dependencies required for test execution

### 2.2 Business Assumptions

- contracts image is used for deploying contracts to various networks
- integration-tests image is used for running tests in CI/CD pipeline or QA environments
- Both packages require nightly builds on main branch push

---

## 3. Requirements

### 3.1 Ubiquitous Requirements

- [REQ-U-001] The system **SHALL ALWAYS** follow existing tagging patterns (nightly, release)
- [REQ-U-002] The system **SHALL ALWAYS** display build results in GitHub Actions Summary

### 3.2 Event-Driven Requirements

- [REQ-E-001] **WHEN** contracts package changes are pushed to main branch **THEN** build contracts-deploy image and push to ECR
- [REQ-E-002] **WHEN** integration-tests package changes are pushed to main branch **THEN** build integration-tests image and push to ECR
- [REQ-E-003] **WHEN** a release tag is created **THEN** generate stable and version tags for the packages

### 3.3 State-Driven Requirements

- [REQ-S-001] **IF** contracts package has no changes **THEN** skip contracts build
- [REQ-S-002] **IF** integration-tests package has no changes **THEN** skip integration-tests build
- [REQ-S-003] **IF** push input is false **THEN** only build images without ECR push

### 3.4 Unwanted Requirements

- [REQ-N-001] The system **SHALL NOT** build hardhat-node target in CI/CD (development only)
- [REQ-N-002] The system **SHALL NOT** unnecessarily build images for unchanged packages

---

## 4. Specifications

### 4.1 Affected Packages Check Extension

```yaml
# Add to existing packages (relay-api, queue-consumer, relayer-discovery)
for pkg in relay-api queue-consumer relayer-discovery contracts integration-tests; do
  pkg_var=$(echo "$pkg" | tr '-' '_')
  if echo "$AFFECTED" | grep -q "$pkg"; then
    echo "${pkg_var}=true" >> $GITHUB_OUTPUT
  else
    echo "${pkg_var}=false" >> $GITHUB_OUTPUT
  fi
done
```

### 4.2 Tag Generation Extension

```yaml
# Use existing generate_tags function
echo "contracts=$(generate_tags contracts)" >> $GITHUB_OUTPUT
echo "integration_tests=$(generate_tags integration-tests)" >> $GITHUB_OUTPUT
```

### 4.3 Build/Push Steps Addition

| Package | Dockerfile Target | Condition | Cache Scope |
|---------|------------------|-----------|-------------|
| contracts | contracts-deploy | contracts == 'true' | contracts |
| integration-tests | integration-tests | integration_tests == 'true' | integration-tests |

### 4.4 Summary Table Extension

Existing 3 packages + contracts + integration-tests = Total 5 packages displayed

---

## 5. Traceability

| Requirement | Implementation Location | Verification Method |
|-------------|------------------------|---------------------|
| REQ-E-001 | _docker.yml (Build contracts step) | CI log verification |
| REQ-E-002 | _docker.yml (Build integration-tests step) | CI log verification |
| REQ-S-001 | _docker.yml (affected check) | PR test |
| REQ-S-002 | _docker.yml (affected check) | PR test |
| REQ-U-001 | generate_tags function | ECR tag verification |
| REQ-U-002 | Summary step | Actions Summary verification |

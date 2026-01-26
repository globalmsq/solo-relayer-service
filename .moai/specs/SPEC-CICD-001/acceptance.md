# SPEC-CICD-001: Acceptance Criteria

## Related SPEC

- **SPEC ID**: SPEC-CICD-001
- **References**: [spec.md](./spec.md), [plan.md](./plan.md)

---

## 1. Acceptance Test Scenarios

### Scenario 1: Build on contracts Package Change

```gherkin
Feature: contracts Package ECR Build/Push

  Scenario: Build image when contracts package changes
    Given a push to main branch occurs
    And packages/contracts directory has changes
    When Docker workflow executes
    Then contracts-deploy target should be built
    And contracts image should be pushed to ECR
    And tags should follow nightly pattern

  Scenario: Skip build when contracts package unchanged
    Given a push to main branch occurs
    And packages/contracts directory has no changes
    When Docker workflow executes
    Then contracts build should be skipped
    And Summary should display "skipped"
```

### Scenario 2: Build on integration-tests Package Change

```gherkin
Feature: integration-tests Package ECR Build/Push

  Scenario: Build image when integration-tests package changes
    Given a push to main branch occurs
    And packages/integration-tests directory has changes
    When Docker workflow executes
    Then integration-tests target should be built
    And integration-tests image should be pushed to ECR
    And tags should follow nightly pattern

  Scenario: Skip build when integration-tests package unchanged
    Given a push to main branch occurs
    And packages/integration-tests directory has no changes
    When Docker workflow executes
    Then integration-tests build should be skipped
    And Summary should display "skipped"
```

### Scenario 3: Release Tagging

```gherkin
Feature: Release Version Tagging

  Scenario: Create contracts release tags
    Given release workflow is triggered
    And tag-type is "release"
    And contracts package version is "1.2.3"
    When Docker workflow executes
    Then contracts image should have the following tags:
      | Tag |
      | v1.2.3 |
      | v1.2 |
      | stable |
```

> **Note**: integration-tests package is for testing purposes only and does not require release tags. It only uses nightly tags for CI/CD testing pipelines.

### Scenario 4: Summary Table Display

```gherkin
Feature: GitHub Actions Summary

  Scenario: Display all package build results
    Given Docker workflow has completed
    When Summary is checked
    Then 5 package rows should be displayed:
      | Package |
      | relay-api |
      | queue-consumer |
      | relayer-discovery |
      | contracts |
      | integration-tests |
    And each row should display build status (✅ or ⏭️ skipped)
    And built packages should display tag information
```

---

## 2. Quality Gate Criteria

### 2.1 Functional Completion Criteria

| Criterion | Verification Method | Required |
|-----------|---------------------|----------|
| contracts build works | CI log verification | Yes |
| integration-tests build works | CI log verification | Yes |
| Skip on no changes works | PR test | Yes |
| nightly tag generation | ECR console verification | Yes |
| release tag generation | Release test | Yes |
| Summary display | Actions Summary verification | Yes |

### 2.2 Non-Functional Criteria

| Criterion | Target | Verification Method |
|-----------|--------|---------------------|
| Build time | Within 30% increase vs existing | CI execution time comparison |
| Cache hit rate | Above 70% | Cache log verification |
| Existing build impact | None | Existing package build test |

---

## 3. Verification Methods

### 3.1 Local Test (Dry Run)

```bash
# Workflow syntax validation
act -l

# contracts tag generation test
PKG="contracts"
VERSION=$(jq -r '.version' "packages/${PKG}/package.json")
echo "contracts:${VERSION}-nightly"

# integration-tests tag generation test
PKG="integration-tests"
VERSION=$(jq -r '.version' "packages/${PKG}/package.json")
echo "integration-tests:${VERSION}-nightly"
```

### 3.2 PR Test

1. Create feature branch
2. Modify `packages/contracts/package.json` or source files
3. Create PR and verify workflow execution
4. Verify contracts build result in Summary

### 3.3 ECR Push Test

1. Merge to main branch
2. Verify nightly workflow execution
3. Verify images and tags in AWS ECR console:
   - `relayer-service/contracts:{version}-nightly`
   - `relayer-service/integration-tests:{version}-nightly`

---

## 4. Definition of Done

- [x] All acceptance test scenarios pass
- [x] Quality Gate criteria met
- [x] Code review completed
- [x] PR merged
- [ ] Actual main branch build success verified
- [ ] ECR image push verified
- [ ] Related documentation updated (if needed)

---

## 5. Rollback Plan

### 5.1 Rollback Triggers

- Workflow failure caused by contracts or integration-tests build
- Impact on existing package builds
- ECR push failure

### 5.2 Rollback Procedure

1. Revert the PR
2. Push revert commit to main branch
3. Verify existing workflow operation
4. Analyze root cause and create fixed PR

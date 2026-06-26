# Documentation, Roadmap, Matrix Alignment and Final Verification

## Overview

This plan updates all user-facing and developer-facing documentation artifacts so that test behavior, CI policy, test counts, and reliability metrics are current and internally consistent after the test reliability hardening work (plans test-1 through test-6). It also performs the final end-to-end verification of the entire hardening initiative.

This plan should be executed LAST, after all other test hardening plans (test-1-reliability-telemetry, test-2-skip-policy-pseudo-skips, test-3-coverage-ci-signal, test-4-trycatch-signal-quality, test-5-crud-lifecycle, test-6-btp-stability) have been completed.

## Context

### Current State

The audit identified multiple stale documentation artifacts:

- **README.md** (line 62): claims "700+ tests" — actual unit count alone is 1,258+.
- **README.md** (line 66): claims "CI matrix across Node 20, 22, and 24" — workflow uses Node 22 and 24 (no 20).
- **CLAUDE.md** (line 373-376): test matrix table shows "1148+" unit tests — actual is 1,258+.
- **docs/roadmap.md** (line 47): CI row claims "lint + typecheck + unit tests (Node 20/22) + integration tests" — inaccurate about Node versions and integration/E2E CI policy.
- **docs/roadmap.md** (line 66): test coverage row claims "1,104 unit tests + 28 BTP integration tests" — stale count.
- **docs/compare/00-feature-matrix.md** (line 212): claims "707+" unit tests — very stale.
- **docs/compare/00-feature-matrix.md** (line 213): claims integration tests "on-prem + BTP" — misleading since BTP never runs in CI.
- **tests/e2e/README.md**: claims auto-creation of test objects that doesn't happen.
- `.claude/commands/ralphex-plan.md`: references `INFRASTRUCTURE.md` which doesn't exist; test counts may be stale.

### Target State

All documentation reflects:
- Current test counts (run `npm test` to get actual numbers).
- Accurate CI policy (which suites run on push, PR, schedule).
- New reliability features (telemetry, skip policy, coverage, CRUD lifecycle, BTP smoke).
- Correct Node.js version matrix.
- New scripts and helper files in the codebase structure.

### Key Files

| File | Role |
|------|------|
| `README.md` | Public-facing testing section |
| `CLAUDE.md` | AI assistant guidelines — test matrix, codebase structure, key files |
| `docs/roadmap.md` | Project status — CI and test coverage rows |
| `docs/compare/00-feature-matrix.md` | Competitor comparison — testing section |
| `.claude/commands/ralphex-plan.md` | Autonomous agent planning template |
| `docs/research/2026-04-10-test-reliability-audit-points-2-7.md` | Audit baseline — needs implementation evidence |
| `docs/index.md` | User-facing doc index |

### Design Principles

1. Accuracy over aspiration: report what actually exists, not what's planned.
2. Counts should be approximate with direction: "1,250+" rather than exact numbers that go stale immediately.
3. Link to source of truth: reference npm scripts and workflow files rather than duplicating behavior descriptions.

## Development Approach

Run the test suite first to get accurate counts, then update each documentation file. Group updates by file for efficiency. Final verification runs all validation commands end-to-end.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Update README.md Testing Section

**Files:**
- Modify: `README.md`

Update the public-facing testing section with accurate counts, CI policy, and new capabilities.

- [x] Run `npm test` and record the actual test count from the output (look for "X passed" in the vitest summary).
- [x] Update `README.md` testing section (around lines 60-66) to reflect:
  - Actual unit test count (use "1,250+" or similar rounded number).
  - Number of unit test files (count files in `tests/unit/`).
  - Integration tests with note about skip behavior when credentials absent.
  - E2E tests with note about MCP server requirement.
  - BTP smoke tests (new, scheduled CI).
  - CI matrix: Node 22 and 24 (not Node 20 — verify in `.github/workflows/test.yml`).
  - Mention reliability telemetry and coverage as informational signals.
  - Remove or update the "33 test files" claim (count actual files).
- [x] Run `npm test` — all tests must pass.

### Task 2: Update CLAUDE.md Test Matrix and Codebase Structure

**Files:**
- Modify: `CLAUDE.md`

Update the test matrix table, codebase structure tree, and key files table to reflect new files and accurate counts.

- [x] Update the test matrix table (around line 373) with accurate counts:
  - Unit test count from actual `npm test` output.
  - Integration test count (total tests including CRUD lifecycle suite).
  - E2E test count.
  - Add row for BTP Smoke tests if not present.
- [x] Update the codebase structure tree (around line 169) to include new directories and files:
  - `scripts/ci/` — CI telemetry and coverage scripts.
  - `tests/helpers/skip-policy.ts` — shared skip helper.
  - `tests/helpers/expected-error.ts` — expected error assertions.
  - `tests/integration/crud-harness.ts` — CRUD test harness.
  - `tests/integration/crud.lifecycle.integration.test.ts` — CRUD lifecycle tests.
  - `tests/integration/btp-abap.smoke.integration.test.ts` — BTP smoke tests.
  - `docs/testing-skip-policy.md` — skip policy documentation.
- [x] Update the Key Files for Common Tasks table to include:
  - "Add skip policy test" → `tests/helpers/skip-policy.ts`
  - "Add expected error assertion" → `tests/helpers/expected-error.ts`
  - "Add CRUD lifecycle test" → `tests/integration/crud.lifecycle.integration.test.ts`, `tests/integration/crud-harness.ts`
  - "Add BTP smoke test" → `tests/integration/btp-abap.smoke.integration.test.ts`
- [x] Verify the Quick Reference section's build/test commands are still accurate. Add `npm run test:coverage`, `npm run test:integration:crud`, `npm run test:integration:btp:smoke` if useful.
- [x] Run `npm test` — all tests must pass.

### Task 3: Update Roadmap and Feature Matrix

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`

Update project status and competitor comparison matrices with accurate test data.

- [x] In `docs/roadmap.md`:
  - Line 47 (CI/CD row): Update to reflect accurate CI policy — "GitHub Actions: lint + typecheck + unit tests (Node 22/24) + integration tests + E2E tests (on push to main and internal PRs). BTP smoke tests on weekday schedule."
  - Line 66 (Test Coverage row): Update count — "1,250+ unit tests + ~150 integration tests + ~60 E2E tests + 28 BTP tests (vitest). Coverage reporting as informational CI signal."
  - Add a note about the reliability hardening initiative if there's a relevant section for recent improvements.
- [x] In `docs/compare/00-feature-matrix.md`:
  - Line 212 (Unit tests row): Update ARC-1 count from "707+" to actual count (e.g., "1,250+").
  - Line 213 (Integration tests row): Update from "on-prem + BTP" to "on-prem (CI) + BTP (scheduled smoke)" for accuracy.
  - Line 214 (CI/CD row): Keep as is or add note about reliability telemetry.
  - Update the "Last Updated" date in the header if present.
- [x] Run `npm test` — all tests must pass.

### Task 4: Update Planning Template and Audit Research Doc

**Files:**
- Modify: `.claude/commands/ralphex-plan.md`
- Modify: `docs/research/2026-04-10-test-reliability-audit-points-2-7.md`

Update the autonomous agent planning template with current test references, and append implementation evidence to the audit research document.

- [x] In `.claude/commands/ralphex-plan.md`:
  - Check for any references to test counts that need updating.
  - Check for references to `INFRASTRUCTURE.md` — if it doesn't exist, either create a minimal version or update the reference to point to `CLAUDE.md`'s testing section instead.
  - Ensure test tier guidance reflects new test suites (CRUD lifecycle, BTP smoke).
- [x] In `docs/research/2026-04-10-test-reliability-audit-points-2-7.md`, append an "Implementation Evidence" section at the end:
  ```markdown
  ---

  ## Implementation Evidence (Post-Hardening)

  Implementation plans executed: test-1 through test-7.

  ### Changes Made
  - **Point 2 (Skip Policy):** Early-return pseudo-skips replaced with `ctx.skip()` via shared `tests/helpers/skip-policy.ts`. Workflow updated to run integration/E2E on push to main. Skip policy documented in `docs/testing-skip-policy.md`.
  - **Point 3 (Coverage):** `@vitest/coverage-v8` installed. Coverage runs as informational step in CI and release workflows. Summary published to GitHub step summary.
  - **Point 4 (try/catch):** Low-signal catches refactored to dual-path assertions using `tests/helpers/expected-error.ts`. Cleanup catches tagged with `// best-effort-cleanup`.
  - **Point 5 (Pseudo-skips):** All `if (!x) return;` patterns converted to `requireOrSkip()` or `ctx.skip()` in integration and E2E suites.
  - **Point 6 (CRUD):** Full lifecycle test in `tests/integration/crud.lifecycle.integration.test.ts` with harness, cleanup guarantees, and placeholder removal.
  - **Point 7 (BTP):** Smoke suite in `tests/integration/btp-abap.smoke.integration.test.ts`, scheduled workflow in `.github/workflows/btp-smoke.yml`, documentation in `docs/btp-abap-environment.md`.
  - **Telemetry:** JSON reporters on all test levels. `scripts/ci/collect-test-reliability.mjs` and `scripts/ci/assert-required-test-execution.mjs` parse and report test reliability metrics.
  ```
- [x] Run `npm test` — all tests must pass.

### Task 5: Final End-to-End Verification

**Files:**
- Modify: `docs/plans/completed/2026-04-10-test-reliability-audit-points-2-7-hardening.md` (mark complete)

Run all validation commands and verify the complete test reliability hardening initiative.

- [x] Run full unit suite: `npm test` — all tests pass.
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Run coverage: `npm run test:coverage` — completes and produces reports.
- [x] Run reliability report: `npm run test:reliability-report` — produces summary (may show "no results" for integration/E2E without credentials — that's expected).
- [x] Verify all new files exist:
  - `scripts/ci/collect-test-reliability.mjs`
  - `scripts/ci/assert-required-test-execution.mjs`
  - `scripts/ci/coverage-summary.mjs`
  - `tests/helpers/skip-policy.ts`
  - `tests/helpers/expected-error.ts`
  - `tests/integration/crud-harness.ts`
  - `tests/integration/crud.lifecycle.integration.test.ts`
  - `tests/integration/btp-abap.smoke.integration.test.ts`
  - `.github/workflows/btp-smoke.yml`
  - `docs/testing-skip-policy.md`
- [x] Verify documentation accuracy by spot-checking:
  - README test count matches actual `npm test` output.
  - CLAUDE.md test matrix matches actual counts.
  - Roadmap CI description matches `.github/workflows/test.yml` behavior.
  - Feature matrix unit test count is current.
- [x] Move all completed test plans to `docs/plans/completed/`:
  - `test-1-reliability-telemetry.md`
  - `test-2-skip-policy-pseudo-skips.md`
  - `test-3-coverage-ci-signal.md`
  - `test-4-trycatch-signal-quality.md`
  - `test-5-crud-lifecycle.md`
  - `test-6-btp-stability.md`
  - `test-7-docs-verification.md`
  - `test-reliability-audit-points-2-7-hardening.md`
- [x] Move this plan to `docs/plans/completed/` once all tasks are done.

# Test Reliability Hardening Plan (Audit Points 2-7)

## Overview

This plan hardens test reliability for the exact gaps identified in `docs/research/2026-04-10-test-reliability-audit-points-2-7.md`: skip misuse, missing coverage telemetry, low-signal `try/catch`, pseudo-skips via early return, incomplete CRUD lifecycle validation, and dormant BTP checks. The objective is to make green pipelines mean real behavioral evidence, not just test volume.

The plan keeps rollout risk low by separating informational telemetry from enforcement. Point 3 (coverage) remains non-blocking initially, while skip/try-catch/CRUD corrections focus on correctness and observability. BTP work is split into CI-capable smoke and local-only extended paths to reflect real infrastructure constraints.

The implementation also updates workflow governance and project documentation so current behavior is accurately described in `README.md`, `docs/index.md`, `docs/roadmap.md`, `docs/compare/00-feature-matrix.md`, `CLAUDE.md`, and `.claude/commands/ralphex-plan.md`.

## Context

### Current State

The audit baseline (2026-04-10) shows the following reliability issues:

- CI workflow policy skips runtime jobs on push to main (`.github/workflows/test.yml:41-43`, `:71-73`), confirmed by run `24213793920` where `integration` and `e2e` were skipped.
- Runtime regressions are real when jobs execute, confirmed by run `24212490295` (`integration` and `e2e` both failed).
- Coverage script exists (`package.json:38`) but provider dependency is missing and no workflow publishes coverage artifacts.
- Multiple test paths pass without proving behavior:
  - try/catch swallow patterns in `tests/integration/adt.integration.test.ts:220-225`, `:269-274`, `:283-290`, `:431-447`
  - pseudo-skips via early return in `tests/integration/context.integration.test.ts:277-330` and `tests/e2e/cds-context.e2e.test.ts:54-100`
- Declared CRUD lifecycle test is a placeholder (`tests/integration/adt.integration.test.ts:299-309`) and does not execute full create/update/delete assertions.
- BTP suite is gated local-only by design (`tests/integration/btp-abap.integration.test.ts:7-13`, `:58`) and not wired into CI secrets/workflows.
- Branch protection is not enforced on `main` (GitHub API returns `404 Branch not protected`).

### Target State

A green CI run should provide trustworthy evidence that critical runtime behavior was actually exercised:

- Internal PRs and `push` to `main` execute unit + integration + e2e (unless infra outage is explicitly classified).
- Skips are explicit, reasoned, and measurable; pseudo-skip passes are eliminated.
- Coverage is collected and published as informational telemetry in CI and release workflows.
- Integration/e2e tests assert deterministic contracts even in variable SAP environments.
- CRUD lifecycle has at least one required full roundtrip test with strict cleanup semantics.
- BTP tests are split into stable CI smoke and local-only extended checks with documented ownership and failure taxonomy.

### Key Files

| File | Role |
|------|------|
| `docs/research/2026-04-10-test-reliability-audit-points-2-7.md` | Audit baseline and evidence source for points 2-7 |
| `.github/workflows/test.yml` | Main CI test orchestration and current skip policy |
| `.github/workflows/release.yml` | Release-time test/coverage confidence gate |
| `package.json` | Test scripts, coverage command, and profile entry points |
| `vitest.config.ts` | Unit test and coverage configuration |
| `vitest.integration.config.ts` | Integration execution behavior |
| `tests/e2e/vitest.e2e.config.ts` | E2E execution/reporting behavior |
| `tests/integration/helpers.ts` | Shared integration credential/skip helpers |
| `tests/integration/adt.integration.test.ts` | Largest integration hotspot for skip/try-catch/CRUD issues |
| `tests/integration/context.integration.test.ts` | Early-return pseudo-skip hotspot |
| `tests/integration/btp-abap.integration.test.ts` | BTP local-only gating and permissive assertions |
| `tests/e2e/cds-context.e2e.test.ts` | E2E pseudo-skip hotspot |
| `tests/e2e/diagnostics.e2e.test.ts` | Complex fallback chains with low-signal pass risk |
| `tests/e2e/navigate.e2e.test.ts` | Example of valid explicit runtime skipping (`ctx.skip`) |
| `tests/e2e/rap.e2e.test.ts` | Long-lived lifecycle `it.skip` gap |
| `tests/e2e/setup.ts` | Fixture provisioning utilities currently drifting from usage |
| `tests/e2e/README.md` | E2E setup claims and fixture behavior documentation |
| `README.md` | Public test confidence claims (currently stale counts/matrix wording) |
| `docs/index.md` | User-facing documentation index and quality claims |
| `docs/roadmap.md` | Project status matrix and CI/testing status entries |
| `docs/compare/00-feature-matrix.md` | Comparative quality/testing matrix |
| `CLAUDE.md` | Contributor/testing conventions and file map |
| `.claude/commands/ralphex-plan.md` | Autonomous planning template with stale testing references |

### Design Principles

1. Reliability over raw pass count: a pass must prove a concrete contract or be marked as an explicit skip with reason.
2. Explicit precondition model: missing credentials, fixtures, or environment features must produce `ctx.skip('reason')`, never silent success.
3. Non-blocking telemetry first: introduce visibility (coverage, executed/skipped ratios) before adding hard gates.
4. Isolate unstable surfaces: keep BTP and cross-tenant variability in dedicated lanes with failure classification.
5. Enforce cleanup invariants for write tests: create/update/delete tests must leave system state clean and report cleanup failure clearly.
6. Keep CI semantics aligned with documentation and branch governance.

## Development Approach

Implement in phased, verifiable slices mapped directly to points 2-7. Start with policy and observability (skip taxonomy, telemetry, reporting), then refactor low-signal tests (`try/catch`, early returns), then add deterministic CRUD lifecycle coverage, and finally split BTP into stable smoke vs extended local checks. Each phase includes targeted tests and workflow updates, with docs/roadmap/matrix/skills synced before final closure.

## Validation Commands

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run test:coverage`

### Task 1: Build Reliability Telemetry Foundation (Executed/Skipped/Reasons)

**Files:**
- Modify: `.github/workflows/test.yml`
- Modify: `package.json`
- Create: `scripts/ci/collect-test-reliability.mjs`
- Create: `scripts/ci/assert-required-test-execution.mjs`
- Modify: `tests/e2e/vitest.e2e.config.ts`
- Modify: `vitest.integration.config.ts`

Create CI-visible reliability telemetry that reports executed/passed/skipped test counts and skip reasons per suite, without failing builds initially except for malformed reports.

- [ ] Add machine-readable integration/e2e outputs (Vitest JSON/JUnit artifacts) in CI and persist them as workflow artifacts.
- [ ] Implement `scripts/ci/collect-test-reliability.mjs` to parse artifacts and publish a Markdown summary to `GITHUB_STEP_SUMMARY`.
- [ ] Implement `scripts/ci/assert-required-test-execution.mjs` with configurable minimum executed tests per profile (`required`, `optional`, `local`) but default it to warning-only mode.
- [ ] Add `package.json` scripts for reliability report generation (local reproducibility of CI parsing).
- [ ] Ensure telemetry includes explicit visibility of skipped suites in push/PR runs so policy drift is immediately visible.
- [ ] Add unit tests (~8 tests) for parser and threshold logic under `tests/unit/` for deterministic CI signal.
- [ ] Run `npm test` — all tests must pass.

### Task 2: Point 2 Hardening — Valid Skip Policy vs Lazy Green

**Files:**
- Modify: `tests/integration/helpers.ts`
- Modify: `tests/integration/adt.integration.test.ts`
- Modify: `tests/integration/context.integration.test.ts`
- Modify: `tests/e2e/cds-context.e2e.test.ts`
- Modify: `tests/e2e/diagnostics.e2e.test.ts`
- Modify: `.github/workflows/test.yml`
- Create: `tests/helpers/skip-policy.ts`
- Create: `docs/testing-skip-policy.md`

Replace implicit skip behavior with explicit policy, and ensure workflow-level skips are limited to valid secret-boundary cases rather than event type alone.

- [ ] Introduce a shared skip helper (`requireOrSkip` / `skipWithReason`) that standardizes runtime skip reasons across integration and e2e suites.
- [ ] Refactor tests using implicit pass-as-skip to call explicit skip APIs with concrete reason text.
- [ ] Update workflow `if:` logic so internal `push` to `main` runs integration/e2e (maintain fork PR protection checks).
- [ ] Add reliability report section listing top skip reasons and their counts per run.
- [ ] Document valid skip taxonomy in `docs/testing-skip-policy.md` with examples from current suites.
- [ ] Add unit tests (~10 tests) for skip helper behavior and reason formatting.
- [ ] Run `npm run test:integration` — no pseudo-skips should remain in targeted files.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Point 3 Hardening — Coverage as Informational CI Signal

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `.github/workflows/test.yml`
- Modify: `.github/workflows/release.yml`
- Create: `scripts/ci/coverage-summary.mjs`

Enable coverage reporting as non-blocking telemetry in both test and release workflows.

- [ ] Add `@vitest/coverage-v8` as dev dependency and ensure `npm run test:coverage` works locally.
- [ ] Configure coverage provider/reporters in `vitest.config.ts` (`text-summary`, `json-summary`, `lcov`) without thresholds.
- [ ] Add workflow step to run coverage and always publish report artifacts (`coverage/`) and concise job summary.
- [ ] Keep coverage step informational-only (`continue-on-error: true` initially) and explicitly label it as non-blocking.
- [ ] Mirror informational coverage collection in `release.yml` so publish runs include visibility into tested surface.
- [ ] Add unit tests (~4 tests) for `coverage-summary.mjs` parser behavior on missing/partial files.
- [ ] Run `npm run test:coverage` — command must complete and generate reports.
- [ ] Run `npm test` — all tests must pass.

### Task 4: Point 4 Hardening — try/catch Signal Quality Refactor

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`
- Modify: `tests/integration/btp-abap.integration.test.ts`
- Modify: `tests/e2e/diagnostics.e2e.test.ts`
- Create: `tests/helpers/expected-error.ts`
- Modify: `CLAUDE.md`

Classify and refactor `try/catch` usage so catches either enforce expected error contracts or remain explicitly marked as best-effort cleanup.

- [ ] Convert low-signal catches in `adt.integration.test.ts` to dual-path assertions: success contract OR explicit expected error signature.
- [ ] Refactor permissive BTP restriction tests to assert known failure categories (e.g., 403/404/not-released) instead of generic truthy errors.
- [ ] Rewrite diagnostics fallback chains to fail when no validated outcome was proven, unless explicitly skipped with reason.
- [ ] Add helper assertions (`expectSapFailureClass`) to centralize allowed error-shape contracts.
- [ ] Keep cleanup catches allowed only when preceded by comment tag such as `best-effort-cleanup` and no hidden product assertion.
- [ ] Update `CLAUDE.md` testing conventions with do/don’t rules for try/catch in tests.
- [ ] Add unit tests (~12 tests) covering expected-error helper and representative integration/e2e message patterns.
- [ ] Run `npm run test:integration` and `npm run test:e2e` — targeted suites must still pass under real environment variability.

### Task 5: Point 5 Hardening — Remove Early-Return Pseudo-Skips

**Files:**
- Modify: `tests/integration/context.integration.test.ts`
- Modify: `tests/e2e/cds-context.e2e.test.ts`
- Modify: `tests/integration/adt.integration.test.ts`
- Modify: `tests/e2e/README.md`
- Modify: `tests/e2e/setup.ts`

Eliminate `if (!x) return;` behavior in tests and align fixture discovery/setup contracts with actual runtime behavior.

- [ ] Replace all targeted early-return pseudo-skips with `ctx.skip('reason')` plus actionable reason text.
- [ ] Separate discovery/precondition logic into helper functions that return explicit outcomes (`ready`, `missing-fixture`, `backend-unsupported`).
- [ ] Reconcile `tests/e2e/README.md` setup claims with actual usage; either wire `ensureTestObjects()` into relevant suites or correct docs and add explicit opt-in helper usage.
- [ ] Add a lightweight lint/check script that fails CI if new `return;`-based pseudo-skip patterns appear in `tests/integration` or `tests/e2e`.
- [ ] Add tests (~6 tests) for precondition helper behavior and pseudo-skip detector script.
- [ ] Run `npm run test:integration` — converted tests should appear as skipped, not passed, when prerequisites are absent.
- [ ] Run `npm run test:e2e` — converted tests should remain deterministic in CI environment.

### Task 6: Point 6 Hardening — Real CRUD Lifecycle Execution and Cleanup Guarantees

**Files:**
- Create: `tests/integration/crud.lifecycle.integration.test.ts`
- Modify: `tests/integration/adt.integration.test.ts`
- Create: `tests/integration/crud-harness.ts`
- Modify: `package.json`
- Modify: `.github/workflows/test.yml`

Replace placeholder CRUD coverage with deterministic, required lifecycle tests that create, read, update, activate, delete, and verify deletion with strong cleanup guarantees.

- [ ] Add `crud-harness.ts` for unique name generation, created-object registry, lock/delete retry, and post-test cleanup diagnostics.
- [ ] Implement `crud.lifecycle.integration.test.ts` to assert full roundtrip behavior (`create -> read -> update -> activate -> delete -> read 404`).
- [ ] Convert placeholder CRUD section in `adt.integration.test.ts:299-309` into either explicit deprecation note or redirect to lifecycle suite.
- [ ] Add profile scripts (`test:integration:required`, `test:integration:crud`) and workflow wiring so CRUD smoke runs on internal PR and push-to-main.
- [ ] Ensure cleanup failures are visible and fail required profile runs instead of being silently ignored.
- [ ] Add unit tests (~10 tests) for CRUD harness naming, retry, and cleanup reporting logic.
- [ ] Run `npm run test:integration:crud` — lifecycle test must execute (not skip) in configured CI profile.
- [ ] Run `npm run test:integration` — all integration tests must pass with updated structure.

### Task 7: Point 7 Hardening — BTP Stability Model (CI Smoke + Local Extended)

**Files:**
- Modify: `tests/integration/btp-abap.integration.test.ts`
- Create: `tests/integration/btp-abap.smoke.integration.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/test.yml`
- Create: `.github/workflows/btp-smoke.yml`
- Modify: `docs/btp-abap-environment.md`

Retain local extended BTP checks while adding a stable, non-interactive BTP smoke lane that can run in CI and report flakiness by class.

- [ ] Split BTP tests into `smoke` (CI-capable, deterministic) and `extended` (local interactive/non-deterministic) suites.
- [ ] Define strict smoke contracts (connectivity, system info shape, released-object read/search) and explicit skip criteria for missing BTP secrets.
- [ ] Add `test:integration:btp:smoke` and `test:integration:btp:extended` scripts.
- [ ] Add `btp-smoke.yml` scheduled + workflow_dispatch pipeline with artifacted logs and failure taxonomy summary.
- [ ] Keep smoke lane non-blocking initially, but ensure visibility in PR dashboard/reporting.
- [ ] Document BTP stability requirements, tenant assumptions, and escalation path for flaky infrastructure in `docs/btp-abap-environment.md`.
- [ ] Add unit tests (~6 tests) for BTP precondition/failure taxonomy helper logic.
- [ ] Run `npm run test:integration:btp:smoke` in a configured environment and capture baseline skip/fail behavior.

### Task 8: Documentation, Roadmap, Matrix, and Skill Artifact Alignment

**Files:**
- Modify: `README.md`
- Modify: `docs/index.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `.claude/commands/ralphex-plan.md`
- Modify: `docs/research/2026-04-10-test-reliability-audit-points-2-7.md`

Update all user/developer planning artifacts so test behavior, CI policy, and reliability metrics are current and internally consistent.

- [ ] Update README and docs index testing sections to reflect current Node matrix, suite behavior, and reliability telemetry outputs.
- [ ] Update roadmap CI/testing status rows to match actual workflow behavior and planned hardening milestones.
- [ ] Refresh feature matrix testing row values and last-updated date after implementation.
- [ ] Update `CLAUDE.md` test conventions and key files references for new reliability scripts/profiles.
- [ ] Update `.claude/commands/ralphex-plan.md` stale testing references (counts, profile expectations, infrastructure assumptions).
- [ ] Append implementation evidence and post-change run comparisons into `docs/research/2026-04-10-test-reliability-audit-points-2-7.md`.
- [ ] Run `npm test` and `npm run lint` to ensure docs/code references remain consistent with repository scripts.

### Task 9: Final Verification and Rollout Gate

**Files:**
- Modify: `.github/workflows/test.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `docs/plans/completed/2026-04-10-test-reliability-audit-points-2-7-hardening.md`

Complete end-to-end validation of new reliability model and close the plan.

- [ ] Run full unit suite: `npm test` — all tests pass.
- [ ] Run integration suite: `npm run test:integration` — required profile executes and reports executed/skipped counts.
- [ ] Run E2E suite: `npm run test:e2e` — report includes executed/skipped counts and explicit skip reasons.
- [ ] Run coverage: `npm run test:coverage` — coverage summary and artifacts produced without blocking failure policy.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Validate GitHub Actions on an internal PR and on `push` to `main` to confirm integration/e2e are no longer silently skipped by event policy.
- [ ] Verify BTP smoke workflow emits classified outcomes and does not hide instability as success.
- [ ] Move this plan to `docs/plans/completed/` once all tasks are done.

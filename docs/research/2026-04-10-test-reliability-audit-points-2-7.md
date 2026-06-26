# Test Reliability Research (Points 2-7)

Date: 2026-04-10  
Scope: Deep-dive on points 2-7 from the external test setup review request.

## Executive Summary

The repository has a large and valuable test corpus, but several mechanisms currently allow green results without proving key runtime behavior:

- Integration tests can report green with most tests skipped (`21 passed | 132 skipped` in current local run).
- Coverage collection is configured as an npm script but not actually operational (missing provider dependency).
- Some integration/e2e tests intentionally absorb failures (`try/catch` with no assertion), which reduces signal.
- Some tests use early returns as implicit skip, which records as pass (not skipped).
- The declared CRUD lifecycle test does not run CRUD; real create/delete checks exist elsewhere but are partial.
- BTP integration tests are intentionally local-only and effectively dormant in CI by design.

This document separates valid skip/fallback patterns from lazy green patterns and outlines practical hardening options.

## Evidence Base

Commands and results used for this analysis:

- `npm test`: `46 files, 1251 passed`
- `npm run test:integration`: `1 passed file | 5 skipped files`, `21 passed | 132 skipped`
- `npm run test:integration -- --reporter=verbose`: confirmed only `tests/integration/elicitation.integration.test.ts` runs in this environment.
- `npm run test:e2e`: fails fast if MCP server preflight is unreachable.
- `npm run test:eval`: fails if configured local model is unavailable.
- `npm run test:coverage`: fails because `@vitest/coverage-v8` is missing.
- `gh api repos/arc-mcp/arc-1/actions/runs/<run-id>/jobs`: used to extract exact job conclusions for requested workflow runs.
- `gh run view <run-id> --repo arc-mcp/arc-1 --log-failed`: used to extract failed test names and stack traces.
- `gh api repos/arc-mcp/arc-1/branches/main/protection`: used to verify whether required checks are enforced at branch level.

Key files reviewed:

- `.github/workflows/test.yml`
- `.github/workflows/release.yml`
- `package.json`
- `vitest*.config.ts`
- `tests/integration/*.test.ts`
- `tests/e2e/*.test.ts`
- `tests/evals/*.ts`
- `scripts/e2e-*.sh`

### GitHub Actions Run Audit (requested runs)

Runs requested for detailed workflow behavior review:

- [24213793920](https://github.com/arc-mcp/arc-1/actions/runs/24213793920)
- [24212490295](https://github.com/arc-mcp/arc-1/actions/runs/24212490295)
- [24197428731](https://github.com/arc-mcp/arc-1/actions/runs/24197428731)

| Run | Event / Branch | Job outcomes | Reliability signal |
|---|---|---|---|
| 24213793920 | `push` on `main` | `test (22)` success, `test (24)` success, `integration` skipped, `e2e` skipped | Main branch push did **not** execute runtime integration/e2e checks. |
| 24212490295 | `pull_request` (`claude/exciting-joliot`) | unit jobs success, `integration` failure, `e2e` failure | Real runtime failures detected when integration/e2e were executed. |
| 24197428731 | `pull_request` (`phase2-publish-srvb`) | all four jobs success | Confirms integration/e2e can run green on healthy backend state. |

Detailed failure/skip counts from logs:

- Run 24212490295 (`integration`): `121 passed | 28 skipped | 4 failed` (153 total).
- Run 24212490295 (`e2e`): `54 passed | 5 skipped | 4 failed` (63 total).
- Run 24197428731 (`integration`): `125 passed | 28 skipped` (153 total).
- Run 24197428731 (`e2e`): `58 passed | 5 skipped` (63 total).

Observed failing area in 24212490295:

- All four failing tests were in runtime diagnostics dump listing/detail flows.
- Failure signature: `Entity expansion limit exceeded: <n> > 1000`.
- Trace path: `src/adt/xml-parser.ts` -> `src/adt/diagnostics.ts` -> `tests/integration/adt.integration.test.ts`.

Branch protection state (as checked 2026-04-10):

- `main` branch protection endpoint returns `404 Branch not protected`.
- Implication: required checks are currently not enforced by branch protection rules.

---

## 2) Skip Analysis: Valid Reasons vs Lazy Green

### Current Skip Mechanisms

1. Suite-level conditional skip (`describe.skip` via env gating):
   - `tests/integration/adt.integration.test.ts`
   - `tests/integration/audit-logging.integration.test.ts`
   - `tests/integration/cache.integration.test.ts`
   - `tests/integration/context.integration.test.ts`
   - `tests/integration/btp-abap.integration.test.ts`

2. Explicit test skip:
   - `tests/e2e/rap.e2e.test.ts` has `it.skip` for write lifecycle.

3. Runtime skip:
   - `tests/e2e/navigate.e2e.test.ts` uses `ctx.skip()` when custom objects are missing.

4. Implicit skip by early return (reported as pass, not skipped):
   - `tests/integration/context.integration.test.ts`
   - `tests/e2e/cds-context.e2e.test.ts`
   - `tests/integration/adt.integration.test.ts` (runtime diagnostics user-dependent branch)

5. Workflow/job-level skip by event policy:
   - `.github/workflows/test.yml` skips `integration` and `e2e` for `push` to `main`.

### Skip Evidence Matrix (current code)

| Location | Mechanism | Trigger | Classification |
|---|---|---|---|
| `tests/integration/adt.integration.test.ts:17` | `describe.skip` gate | no SAP creds | Valid |
| `tests/integration/audit-logging.integration.test.ts:22` | `describe.skip` gate | no SAP creds | Valid |
| `tests/integration/cache.integration.test.ts:33` | `describe.skip` gate | no SAP creds | Valid |
| `tests/integration/context.integration.test.ts:24` | `describe.skip` gate | no SAP creds | Valid |
| `tests/integration/btp-abap.integration.test.ts:58` | `describe.skip` gate | no BTP service key | Valid (by design), but creates dormant suite in CI |
| `tests/e2e/navigate.e2e.test.ts:59` etc | `ctx.skip()` | custom fixtures missing | Valid/transparent |
| `tests/e2e/rap.e2e.test.ts:159` | `it.skip` | known lifecycle bug | Risky long-term gap |
| `tests/e2e/cds-context.e2e.test.ts:54` etc | `return` (implicit pass) | no DDLS found | Problematic |
| `tests/integration/context.integration.test.ts:277` etc | `return` (implicit pass) | no DDLS found | Problematic |
| `tests/integration/adt.integration.test.ts:476` | `return` (implicit pass) | user env empty | Problematic (should be explicit skip) |
| `.github/workflows/test.yml:41-43` | job-level `if` | non-PR events | Risky for main-branch confidence |
| `.github/workflows/test.yml:71-73` | job-level `if` | non-PR events | Risky for main-branch confidence |

### Classification: Valid vs Problematic

#### Valid / Reasonable

- Skipping whole integration suites when SAP credentials are absent is valid for local developer experience.
- Skipping BTP suite without BTP credentials is valid given dedicated infrastructure needs.
- Using `ctx.skip()` for optional custom-object scenarios is valid and transparent.
- Skipping cleanup failures in `afterAll` is usually acceptable if cleanup is best-effort and does not hide product behavior failures.

#### Problematic / Lazy Green

- Early returns inside test bodies for prerequisite absence (`if (!x) return;`) create false pass signal.
- Large suite-level skipping without guardrails in CI means “green” does not guarantee runtime coverage.
- Hard-coded `it.skip` on a key lifecycle flow (write+activate+read+delete) leaves a persistent gap.
- Main push workflow green can still mean integration/e2e never ran (as seen in run 24213793920).

### What “Correct Skipping” Should Mean

A skip should only happen when a precondition outside product behavior is missing and the test should state that reason in test output.

Good examples:

- Missing credentials/secrets.
- Feature absent on target backend version.
- Optional fixture absent in shared test system (with explicit `ctx.skip('reason')`).

Not good:

- Returning early without marking skip.
- Catching any failure and continuing as pass.
- Permanent skip for a known bug with no enforcement deadline/owner.

### Practical Improvements for Point 2

- Replace early-return pseudo-skips with explicit `ctx.skip('...')`.
- Add CI guardrail: fail if executed integration tests are below minimum threshold for internal PRs.
- Split tests into:
  - `integration:required` (must run in CI)
  - `integration:optional` (allowed to skip with explicit reasons)
- Track long-lived `it.skip` tests with issue IDs and expiry checks.

---

## 3) Coverage as Informational Signal (Non-Blocking)

### Current State

- `package.json` includes `test:coverage: "vitest run --coverage"`.
- Running it fails due to missing provider dependency:
  - `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'`.
- No coverage provider config or thresholds in vitest config.
- CI workflow does not collect or publish coverage metrics.

### Workflow-Level Coverage Gap

Current workflows do not run coverage at all:

- `.github/workflows/test.yml` runs lint, typecheck, `npm test`, integration, e2e.
- `.github/workflows/release.yml` runs `npm test` before publish.
- Neither workflow has a coverage collection or artifact step.
- In audited runs (24197428731, 24212490295, 24213793920), no coverage artifact/summary was produced.

Implication: coverage is invisible in both PR quality checks and release flow.

### Why This Matters

Without coverage telemetry, large pass counts can still hide unexercised areas. Coverage should not block yet (as requested), but it should be visible per run.

### Recommended Informational-Only Setup

1. Add dev dependency:
   - `@vitest/coverage-v8`

2. Add coverage config (unit test config):
   - Provider: `v8`
   - Reporters: `text-summary`, `json-summary`, `lcov`
   - No thresholds initially.

3. Add workflow step after unit tests:
   - Run coverage with `continue-on-error: true` (informational only).
   - Parse `coverage/coverage-summary.json`.
   - Publish summary in GitHub Job Summary.
   - Upload `coverage/` as artifact.

4. Optional:
   - Add PR comment bot for trend (delta vs base branch), still non-blocking.

### Suggested rollout phases

- Phase 1: Collect and publish only.
- Phase 2: Define target baselines by package/module.
- Phase 3: Add soft gates (warning only).
- Phase 4: Enforce hard thresholds selectively on critical modules.

---

## 4) try/catch Audit: Relevant vs Non-Relevant

### Inventory

Observed `try/catch` markers across integration/e2e/eval areas: 33+ occurrences (excluding production code). Highest concentration:

- `tests/integration/adt.integration.test.ts`
- `tests/integration/btp-abap.integration.test.ts`
- `tests/e2e/diagnostics.e2e.test.ts`

### Classification

#### Category A: Relevant and acceptable

Patterns where catch transforms technical failure into explicit setup/runtime failure or best-effort cleanup:

- E2E helper wrappers that rethrow with richer context.
- Global preflight health checks that fail suite explicitly.
- Cleanup blocks in `afterAll` where failure should not mask prior assertion outcomes.

These generally improve observability and are not “lazy green.”

#### Category B: Context-dependent, needs stronger assertion

Patterns that accept variability but should still assert outcome class:

- BTP restriction tests that accept both success and failure (`try` success path and catch path both pass).
- Optional backend behavior differences (e.g., include availability) without asserting expected error type.

These can remain flexible but should assert at least one expected contract, e.g.:

- On failure: assert error class/status pattern.
- On success: assert required response fields.

#### Category C: Low-signal / lazy-green

Patterns where catch swallows failure and test passes without proving behavior:

- `tests/integration/adt.integration.test.ts`
  - interface operation and function module operation blocks.
  - edge-case tests that treat both throw and no-throw as pass.
- `tests/e2e/diagnostics.e2e.test.ts`
  - dump trigger path has multiple fallback catches and can finish with “no dumps” as pass.

### try/catch Detail Matrix

| File | Example lines | Pattern | Signal quality |
|---|---|---|---|
| `tests/e2e/helpers.ts` | 56-62, 67-77, 88-108 | rethrow with context | High (good) |
| `tests/e2e/global-setup.ts` | 20-60 | fail-fast preflight | High (good) |
| `tests/integration/adt.integration.test.ts` | 220-225 | include read catch-ignore | Medium/low |
| `tests/integration/adt.integration.test.ts` | 269-274 | interface read catch-ignore | Low |
| `tests/integration/adt.integration.test.ts` | 283-290 | FM search catch-ignore | Low |
| `tests/integration/adt.integration.test.ts` | 431-437, 441-447 | both throw/no-throw accepted | Low |
| `tests/e2e/diagnostics.e2e.test.ts` | 173-214 | create/update/activate fallback chain | Medium/low |
| `tests/integration/btp-abap.integration.test.ts` | 194-232 | both outcomes accepted for restriction tests | Medium/low |
| `tests/integration/context.integration.test.ts` | helper discovery catches | fallback discovery | Medium |

Recommended treatment:

- Keep high-signal catch blocks (rethrow/fail-fast/cleanup).
- Refactor low-signal catches into explicit expected-failure assertions or explicit skips.

### Recommendation for Point 4

- Keep Category A.
- Refactor Category B to “assert success OR assert specific expected failure shape.”
- Replace Category C with deterministic contracts or explicit skip/fail semantics.
- Add a linting rule/check for empty catch in tests unless annotated (e.g., `// acceptable best-effort cleanup`).

---

## 5) Early Return Instead of Skip: Why It Exists and How to Improve

### Observed Pattern

Examples:

- `tests/integration/context.integration.test.ts`: multiple `if (!ddlSource || !cdsName) return;`
- `tests/e2e/cds-context.e2e.test.ts`: `if (!cdsName) return;`
- `tests/integration/adt.integration.test.ts`: user-dependent diagnostics branch.

### Exact Early-Return Locations

- `tests/e2e/cds-context.e2e.test.ts:54,64,87,99`
- `tests/integration/context.integration.test.ts:277,288,308,318,325`
- `tests/integration/adt.integration.test.ts:476`

These currently inflate pass counts while hiding missing prerequisites.

### Why This Was Likely Done

- Cross-system variability (object availability differs by SAP tenant).
- Desire to avoid flaky failures on shared environments.
- Developer convenience during local runs.

### Why It Is Risky

- Early return is counted as pass, not skipped.
- Dashboards show higher pass rates without proving feature behavior.
- Teams lose visibility into missing prerequisites and dormant test paths.

### Better Pattern

- Convert to explicit runtime skip:
  - `ctx.skip('No DDLS candidate found on system')`
- Emit skip reason consistently.
- Separate fixture discovery from assertions; if discovery fails in a required test profile, fail early.

### Suggested policy

- For optional tests: explicit skip with reason.
- For required CI profile: missing prerequisite is test failure unless explicitly quarantined.

---

## 6) CRUD Test Does Not Actually Run CRUD

### Current Situation

The section named `CRUD operations` in `tests/integration/adt.integration.test.ts` does not execute create/update/delete. It only performs a search and asserts absence. The file itself documents this limitation in comments.

At the same time, a later section (`batch create in $TMP`) does create and delete programs using lower-level CRUD helpers. So write-path coverage exists, but not as a full lifecycle contract of the declared CRUD test.

### CRUD Evidence Matrix

| Location | What it does today | Gap |
|---|---|---|
| `tests/integration/adt.integration.test.ts:299-309` | only `searchObject` and assert empty | not CRUD |
| `tests/integration/adt.integration.test.ts:571-593` | create two programs + read back | no update/asserted delete in same test |
| `tests/integration/adt.integration.test.ts:553-569` | cleanup delete in `afterAll` (best-effort catch-ignore) | delete success not asserted |
| `src/adt/client.ts` | read-oriented API | no first-class lifecycle test surface |
| `src/adt/crud.ts` | low-level CRUD primitives exist | lifecycle contract not tested end-to-end as one required test |

### Why This Happened

- `AdtClient` is focused on read APIs; write lifecycle is mainly in `src/adt/crud.ts` and handler paths.
- Lifecycle tests are harder on shared SAP systems (cleanup reliability, collision risk, auth/safety constraints).
- Existing test appears to have been left as placeholder to keep suite green.

### Risks

- Misleading test naming creates false confidence.
- No strict assertion of full create -> read -> update -> activate -> delete -> verify-delete lifecycle in one deterministic test.
- Cleanup reliability risk if creation succeeds and deletion fails silently.

### Improvement Path (important for your priority)

1. Create dedicated `integration/crud.lifecycle.integration.test.ts`:
   - Use unique names: `ZARC1_IT_<runId>_<case>`.
   - Package: default `$TMP` or configurable dedicated package.
   - Explicit full lifecycle assertions:
     - create succeeds
     - read matches content
     - update succeeds
     - read reflects update
     - activate succeeds (if required)
     - delete succeeds
     - read returns 404 after delete

2. Hard cleanup guarantees:
   - Maintain created object registry.
   - Retry delete with lock recovery.
   - Fail test if cleanup fails in required CI profile (or mark quarantine job).

3. Pre-flight capability checks:
   - verify write permissions and allowed package before lifecycle starts.
   - skip with explicit reason only in non-required profile.

4. Split profiles:
   - `crud:smoke` in CI internal PRs.
   - `crud:full` nightly with extra cases and mutation scenarios.

---

## 7) Why BTP Checks Are Skipped and How to Improve Stability

### Current Reality

BTP integration test file is intentionally local-only in practice:

- It is env-gated via service-key presence.
- Comments document reasons:
  - free-tier nightly stop,
  - 90-day deletion,
  - OAuth browser interaction requirement.
- CI workflow does not provide BTP service key env vars for this suite.

Result: BTP checks are effectively not exercised in standard CI runs.

Confirmed in requested workflow runs:

- `integration` jobs still show `28 skipped` tests attributable to BTP env gating (both passing and failing PR runs).
- These BTP skips are constant background skip debt and are currently independent from the runtime diagnostics failures.

### BTP Skip Evidence

| Evidence | Observation |
|---|---|
| `tests/integration/btp-abap.integration.test.ts:7-13` | local-only rationale documented (free-tier stop/delete + interactive OAuth) |
| `tests/integration/btp-abap.integration.test.ts:58` | suite gated by service-key env |
| `.github/workflows/test.yml` | integration job only injects `TEST_SAP_*`, no BTP env |
| `npm run test:integration -- --reporter=verbose` | all BTP tests skipped in current run |

### Why BTP flakiness is currently structural

- The suite assumes environment characteristics that are not CI-stable:
  - interactive-first OAuth expectations,
  - ephemeral/free-tier lifecycle,
  - object availability variance.
- The workflow is therefore intentionally configured to avoid running BTP tests automatically.

### Why This Is Understandable

- BTP free-tier instability and lifecycle constraints are real.
- Interactive OAuth is not CI-friendly.
- Keeping these tests out of mandatory CI avoids frequent false negatives.

### But the consequence

- BTP behavior regressions can go undetected for long periods.
- Product surface claims for BTP may drift from reality.

### Stability-focused Improvement Strategy

1. Split BTP testing into two tiers:
   - Tier A (CI-capable, non-interactive, stable smoke):
     - 5-10 high-value checks with deterministic objects/contracts.
     - Use non-interactive token flow (pre-provisioned token path/service principal) where possible.
   - Tier B (manual/interactive extended):
     - current broader suite, still local.

2. Infrastructure recommendations:
   - avoid ephemeral free-tier for CI gating; use persistent paid/test tenant for scheduled runs.
   - isolate test artifacts in dedicated package namespace.

3. Pipeline model:
   - keep Tier A non-blocking initially (informational scheduled workflow).
   - after stability period, promote to required check for BTP-labeled PRs.

4. Flakiness controls:
   - retry wrapper only for known transient classes.
   - classify failures (auth, connectivity, backend unavailable, assertion).
   - publish detailed failure reasons as artifacts.

---

## Cross-Cutting Observations for Planning

1. E2E fixture setup drift:
   - `tests/e2e/setup.ts` defines `ensureTestObjects`, but active e2e suites do not call it.
   - `tests/e2e/README.md` claims beforeAll setup auto-creates persistent objects, which does not match current usage in test files.
   - This mismatch likely contributes to runtime `ctx.skip()` behavior for custom-object tests.

2. Release confidence gap:
   - Release workflow runs unit tests only.
   - Runtime-system regressions can pass release pipeline.
   - Push-to-main test workflow can also pass without running integration/e2e (event gating).

3. Branch governance gap:
   - `main` is currently not protected; required checks are not enforced server-side.

4. Metric integrity:
   - Pass count alone is not meaningful without:
     - executed-vs-skipped visibility,
     - explicit skip reasons,
     - coverage telemetry.

---

## Planning Inputs (for follow-up implementation plans)

For each point (2-7), the later implementation plan should define:

1. Target profile:
   - required CI / optional CI / local-only
2. Precondition contract:
   - explicit skip conditions and reason text
3. Signal contract:
   - what exactly must be asserted to count as pass
4. Flakiness policy:
   - retry, quarantine, or fail-fast
5. Rollout phases:
   - informational first, then enforcement
6. Success metrics:
   - executed test count, skip ratio, coverage visibility, defect detection lead time

---

## Implementation Evidence (Post-Hardening)

Date: 2026-04-10  
Scope closed: test plans `test-1` through `test-7`, plus hardening follow-up fixes.

### Changes Delivered

- **Point 2 / 5 (skip policy + pseudo-skips):**
  - Runtime pseudo-skips were refactored to explicit skip mechanisms (`ctx.skip` / `requireOrSkip`) in integration and E2E hotspots.
  - Shared skip policy helper and docs were added (`tests/helpers/skip-policy.ts`, `docs/testing-skip-policy.md`).
  - CI policy was updated so integration and E2E run on `push` to `main` and internal PRs.

- **Point 3 (coverage visibility):**
  - Coverage telemetry is active with `@vitest/coverage-v8`.
  - Coverage collection runs as informational (non-blocking) in test and release workflows.
  - Coverage summary is published via `scripts/ci/coverage-summary.mjs`.

- **Point 4 (try/catch signal quality):**
  - Low-signal catch blocks were converted to dual-path assertions (success contract or expected failure class).
  - Shared helper introduced: `tests/helpers/expected-error.ts`.
  - Cleanup-only catches are explicitly tagged as `best-effort-cleanup`.

- **Point 6 (CRUD lifecycle):**
  - Full lifecycle suite implemented in `tests/integration/crud.lifecycle.integration.test.ts`.
  - Harness added in `tests/integration/crud-harness.ts` for deterministic names and cleanup guarantees.
  - Placeholder coverage paths were replaced with executable lifecycle checks.

- **Point 7 (BTP stability lane):**
  - BTP checks split into local extended tests and CI-capable smoke tests.
  - Smoke workflow added: `.github/workflows/btp-smoke.yml` (weekday schedule + manual dispatch).

- **Telemetry foundation (plan-1 completion):**
  - JSON test outputs across unit/integration/E2E.
  - Reliability parsers/assertions added:
    - `scripts/ci/collect-test-reliability.mjs`
    - `scripts/ci/assert-required-test-execution.mjs`
  - Aggregated reliability summary job added to CI (`reliability-summary`).

### Verified Runtime Results (latest local validation)

- `npm test`: **1315 passed** (52 files)
- `npm run test:integration`: **125 passed, 33 skipped, 0 failed** (158 total)
- `npm run test:e2e`: **58 passed, 5 skipped, 0 failed** (63 total)
- `npm run test:coverage`: completes and publishes summary/artifacts (informational)

### Follow-through on Audit Claims

- Main-branch green now includes runtime integration/E2E execution for internal changes.
- Skip behavior is explicit and auditable instead of hidden via early returns.
- Coverage and execution telemetry are visible in CI summaries/artifacts.
- Documentation and planning references were updated to current counts and workflow behavior in plan `test-7-docs-verification`.

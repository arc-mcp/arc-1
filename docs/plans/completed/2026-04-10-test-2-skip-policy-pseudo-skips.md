# Skip Policy and Pseudo-Skip Elimination

## Overview

This plan replaces implicit skip behavior (early returns that count as pass) with explicit, transparent skip APIs across integration and E2E test suites. It also updates the CI workflow so that `push` to `main` executes integration and E2E tests (not just PRs), and creates a shared skip policy document that defines the taxonomy of valid skip reasons.

The audit identified 10+ locations where `if (!x) return;` silently passes tests without exercising any behavior. These inflate pass counts and hide missing prerequisites. This plan converts all of them to `ctx.skip('reason')` calls via a shared helper, and separates fixture discovery from test assertions.

## Context

### Current State

**Early-return pseudo-skips (counted as PASS, not SKIP):**
- `tests/e2e/cds-context.e2e.test.ts` lines 54, 64, 87, 99 — `if (!cdsName) return;`
- `tests/integration/context.integration.test.ts` lines 277, 288, 308, 318, 325 — `if (!ddlSource || !cdsName) return;`
- `tests/integration/adt.integration.test.ts` line 476 — `if (dumps.length === 0) return;`

**Workflow-level skip on push:**
- `.github/workflows/test.yml` lines 41-43 and 71-73: `integration` and `e2e` jobs have `if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository`, which means pushes to `main` skip runtime tests entirely. Confirmed by run 24213793920 where both jobs were skipped.

**E2E README claims vs reality:**
- `tests/e2e/README.md` line 77-78 claims `beforeAll` auto-creates objects from fixtures, but `ensureTestObjects()` in `tests/e2e/setup.ts` is never called by any test file.

**Good skip patterns already in codebase:**
- `tests/e2e/navigate.e2e.test.ts` lines 58-72 use `ctx.skip()` correctly — this is the model to follow.

### Target State

- All early-return pseudo-skips are converted to `ctx.skip('reason')` with actionable reason text.
- A shared skip helper (`tests/helpers/skip-policy.ts`) standardizes skip reasons across suites.
- CI workflow runs integration and E2E on internal pushes to `main` (not just PRs).
- `docs/testing-skip-policy.md` documents the skip taxonomy with do/don't examples.
- `tests/e2e/README.md` accurately reflects setup behavior.

### Key Files

| File | Role |
|------|------|
| `tests/helpers/skip-policy.ts` | New: shared skip helper functions |
| `tests/integration/context.integration.test.ts` | 5 early-return pseudo-skips to convert (lines 277, 288, 308, 318, 325) |
| `tests/e2e/cds-context.e2e.test.ts` | 4 early-return pseudo-skips to convert (lines 54, 64, 87, 99) |
| `tests/integration/adt.integration.test.ts` | 1 early-return pseudo-skip to convert (line 476) |
| `.github/workflows/test.yml` | Workflow `if:` conditions to update (lines 41-43, 71-73) |
| `tests/e2e/navigate.e2e.test.ts` | Reference: correct `ctx.skip()` usage pattern |
| `tests/e2e/README.md` | Setup claims to reconcile with reality |
| `tests/e2e/setup.ts` | `ensureTestObjects()` — either wire in or document as opt-in |
| `docs/testing-skip-policy.md` | New: skip taxonomy documentation |

### Design Principles

1. Explicit over implicit: every skip must state a reason visible in test output.
2. Model after existing good pattern: `navigate.e2e.test.ts` uses `ctx.skip()` correctly.
3. Separate discovery from assertion: precondition checks in beforeAll, skip decision at test level.
4. Keep fork PR protection: external fork PRs should still skip (no secrets available).

## Development Approach

Start with the shared skip helper and its unit tests, then convert pseudo-skips in integration tests, then E2E tests, then update the workflow, and finally create documentation. The skip helper is simple enough that conversion can proceed file by file.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Create Shared Skip Policy Helper

**Files:**
- Create: `tests/helpers/skip-policy.ts`
- Create: `tests/unit/helpers/skip-policy.test.ts`

Create a shared helper that standardizes how tests skip with reasons, providing consistent formatting across integration and E2E suites.

- [x] Create `tests/helpers/skip-policy.ts` with:
  - `skipWithReason(ctx: TaskContext, reason: string): void` — calls `ctx.skip()` after logging the reason. The `ctx` parameter is the Vitest test context (`import { TaskContext } from 'vitest'`). Example: `skipWithReason(ctx, 'No DDLS found on system')`.
  - `requireOrSkip<T>(ctx: TaskContext, value: T | null | undefined, reason: string): asserts value is T` — if value is nullish, calls `ctx.skip()` with reason; otherwise narrows the type. Example: `requireOrSkip(ctx, cdsName, 'No DDLS candidate found')`.
  - `SkipReason` enum or constants for common reasons: `NO_CREDENTIALS`, `NO_FIXTURE`, `BACKEND_UNSUPPORTED`, `NO_DDLS`, `NO_DUMPS`, `NO_CUSTOM_OBJECTS`.
  - Export all functions and constants.
- [x] Add unit tests (~10 tests) in `tests/unit/helpers/skip-policy.test.ts`:
  - `requireOrSkip` with valid value does not skip (no call to ctx.skip).
  - `requireOrSkip` with null calls ctx.skip with formatted reason.
  - `requireOrSkip` with undefined calls ctx.skip with formatted reason.
  - `skipWithReason` calls ctx.skip with the reason text.
  - `SkipReason` constants have expected values.
  - Type narrowing works: after `requireOrSkip`, value is typed as non-null.
  - Reason text formatting is consistent (e.g., includes suite context).
  - Mock `ctx` object with a spy on `skip` method to verify calls.
  - Edge case: empty string reason still calls skip.
  - Edge case: value is `0` or `false` (falsy but defined) — should NOT skip.
- [x] Run `npm test` — all tests must pass.

### Task 2: Convert Integration Test Pseudo-Skips

**Files:**
- Modify: `tests/integration/context.integration.test.ts`
- Modify: `tests/integration/adt.integration.test.ts`

Replace all early-return pseudo-skips in integration tests with explicit `ctx.skip()` or `requireOrSkip()` calls using the new shared helper.

- [x] In `tests/integration/context.integration.test.ts`:
  - Import `requireOrSkip` from `../../helpers/skip-policy.js`.
  - At line 277 (`if (!ddlSource || !cdsName) return;`): change test callback to accept `ctx` parameter (e.g., `it('extracts deps', async (ctx) => {`), then replace early return with `requireOrSkip(ctx, cdsName, 'No DDLS candidate found on system')` and `requireOrSkip(ctx, ddlSource, 'No DDLS source available')`.
  - Apply same pattern at lines 288, 308, 318, 325 — each early return becomes a `requireOrSkip` call with an appropriate reason.
  - Verify that the `beforeAll` block (which calls `findAnyDdls`) still populates `cdsName` and `ddlSource` as before.
- [x] In `tests/integration/adt.integration.test.ts`:
  - Import `requireOrSkip` from `../../helpers/skip-policy.js`.
  - At line 476 (`if (dumps.length === 0) return;` in diagnostics test): change test callback to accept `ctx`, replace with `if (dumps.length === 0) return ctx.skip('No dumps on system — nothing to verify')`.
  - Check for any other `return;` patterns in the file that act as pseudo-skips and convert them similarly.
- [x] Run `npm run test:integration` locally if SAP credentials are available — converted tests should appear as "skipped" (not "passed") when prerequisites are absent. If no credentials, run `npm test` to verify imports compile.
- [x] Run `npm test` — all tests must pass.

### Task 3: Convert E2E Test Pseudo-Skips and Fix README

**Files:**
- Modify: `tests/e2e/cds-context.e2e.test.ts`
- Modify: `tests/e2e/README.md`
- Modify: `tests/e2e/setup.ts` (documentation only)

Replace all early-return pseudo-skips in E2E tests and reconcile README claims with reality.

- [x] In `tests/e2e/cds-context.e2e.test.ts`:
  - Import `requireOrSkip` from `../../helpers/skip-policy.js`.
  - At line 54 (`if (!cdsName) return;`): the test callback already may not accept `ctx`. Change to `it('reads raw DDL source', async (ctx) => {` and replace `if (!cdsName) return;` with `requireOrSkip(ctx, cdsName, 'No DDLS found on system — CDS tests skipped')`.
  - Apply same pattern at lines 64, 87, 99.
  - The `beforeAll` already sets `cdsName` and logs a skip message — keep that but now the individual tests will properly show as skipped in reports.
- [x] In `tests/e2e/README.md`:
  - Update the setup section (around line 77-78) to accurately describe current behavior. Replace the claim about automatic object creation with: "Test objects (ZARC1_TEST_REPORT, ZIF_ARC1_TEST, ZCL_ARC1_TEST, ZCL_ARC1_TEST_UT) must exist on the SAP system. If missing, tests that require them will skip with explicit reasons. The `ensureTestObjects()` function in `setup.ts` can create them on demand but is not called automatically."
  - Document the skip behavior: when custom objects are missing, navigate tests use `ctx.skip()`; when DDLS objects are missing, CDS tests use `requireOrSkip()`.
- [x] Run `npm test` — all tests must pass.

### Task 4: Update CI Workflow for Main Branch Push

**Files:**
- Modify: `.github/workflows/test.yml`

Update the workflow so internal pushes to `main` also run integration and E2E tests, while still protecting against external fork PRs that lack secrets.

- [x] Modify the `integration` job `if:` condition (lines 41-43) from:
  ```yaml
  if: >
    github.event_name == 'pull_request' &&
    github.event.pull_request.head.repo.full_name == github.repository
  ```
  to:
  ```yaml
  if: >
    github.event_name == 'push' ||
    (github.event_name == 'pull_request' &&
     github.event.pull_request.head.repo.full_name == github.repository)
  ```
  This allows the job to run on both push events (to main) and internal PRs, while still skipping external fork PRs.
- [x] Apply the same `if:` condition change to the `e2e` job (lines 71-73).
- [x] Verify that the secrets (`TEST_SAP_URL`, `E2E_SSH_KEY`, etc.) will be available on push events — they are repository secrets, so they are available for push events on the same repo. Add a comment above each `if:` explaining the policy: `# Run on push (main) and internal PRs; skip external fork PRs (no secrets)`.
- [x] Run `npm test` — all tests must pass.

### Task 5: Create Skip Policy Documentation

**Files:**
- Create: `docs/testing-skip-policy.md`

Document the skip taxonomy, valid vs problematic patterns, and expectations for new tests.

- [x] Create `docs/testing-skip-policy.md` with:
  - **Valid Skip Reasons** section: missing credentials (SAP/BTP), missing fixture on shared system, backend version doesn't support feature, optional custom objects not deployed. Each with code example from the codebase.
  - **Problematic Patterns** section (DO NOT): early return without skip (`if (!x) return;`), catch-and-continue without assertion, permanent `it.skip` without issue tracking, workflow-level skip hiding runtime regressions.
  - **How to Skip Correctly** section: use `requireOrSkip(ctx, value, reason)` for precondition checks, use `ctx.skip('reason')` for runtime decisions, always include actionable reason text.
  - **Skip Reason Constants** section: list the `SkipReason` constants from `tests/helpers/skip-policy.ts` and when to use each.
  - **CI Policy** section: internal PRs and main pushes run all suites; external fork PRs skip integration/E2E (no secrets); all skips are visible in telemetry reports.
  - **Reference Patterns** section: link to `tests/e2e/navigate.e2e.test.ts` as the canonical example of correct skip usage.
- [x] Run `npm test` — all tests must pass.

### Task 6: Final Verification

- [x] Run full unit suite: `npm test` — all tests pass (including 10+ new skip policy tests).
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Verify no remaining `if (!x) return;` pseudo-skip patterns exist in `tests/integration/context.integration.test.ts`, `tests/e2e/cds-context.e2e.test.ts`, or `tests/integration/adt.integration.test.ts` by grepping for early-return patterns.
- [x] Verify `.github/workflows/test.yml` `if:` conditions allow push events.
- [x] Move this plan to `docs/plans/completed/` once all tasks are done.

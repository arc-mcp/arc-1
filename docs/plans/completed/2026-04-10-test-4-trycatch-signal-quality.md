# try/catch Signal Quality Refactor

## Overview

This plan classifies and refactors `try/catch` usage in integration and E2E tests so that catches either enforce expected error contracts (assert specific error shapes) or remain explicitly marked as best-effort cleanup. The audit found 10+ low-signal catch blocks that swallow failures and let tests pass without proving any behavior. After this plan, every catch block either asserts a known error signature or is tagged as acceptable cleanup.

## Context

### Current State

The audit categorized `try/catch` usage into three classes:

**Category A (High signal, keep as-is):**
- `tests/e2e/helpers.ts` lines 56-62, 67-77, 88-108: rethrow with context.
- `tests/e2e/global-setup.ts` lines 20-60: fail-fast preflight.
- `afterAll` cleanup catches that are genuinely best-effort.

**Category B (Medium signal, needs stronger assertion):**
- `tests/integration/btp-abap.integration.test.ts` lines 194-232: restriction tests that accept both success AND failure without asserting expected failure shape. Four separate tests (classic programs, function modules, table preview, free SQL) all pass regardless of outcome.
- `tests/integration/context.integration.test.ts` helper discovery catches: fallback discovery that silently continues.

**Category C (Low signal, lazy green):**
- `tests/integration/adt.integration.test.ts` lines 220-225: include read catch-ignore — catches any error and passes.
- `tests/integration/adt.integration.test.ts` lines 269-274: interface read catch-ignore.
- `tests/integration/adt.integration.test.ts` lines 283-290: FM search catch-ignore.
- `tests/integration/adt.integration.test.ts` lines 431-447: both throw/no-throw accepted for edge cases.
- `tests/e2e/diagnostics.e2e.test.ts` lines 173-214: create/update/activate fallback chain where all steps can fail silently, and the test still passes with zero dumps.

### Target State

- Category A: unchanged.
- Category B: refactored to "assert success shape OR assert specific expected failure class" — dual-path assertions.
- Category C: refactored to deterministic contracts. Success path asserts expected fields; failure path asserts error status/class. If neither path produces a verifiable outcome, the test fails or explicitly skips.
- A shared `tests/helpers/expected-error.ts` provides `expectSapFailureClass()` and related helpers.
- `CLAUDE.md` testing conventions updated with do/don't rules for try/catch in tests.

### Key Files

| File | Role |
|------|------|
| `tests/helpers/expected-error.ts` | New: expected error assertion helpers |
| `tests/integration/adt.integration.test.ts` | Lines 220-225, 269-274, 283-290, 431-447: Category C low-signal catches |
| `tests/integration/btp-abap.integration.test.ts` | Lines 194-232: Category B permissive restriction tests |
| `tests/e2e/diagnostics.e2e.test.ts` | Lines 173-214: Category C fallback chain |
| `CLAUDE.md` | Testing conventions section — needs do/don't rules |
| `tests/e2e/helpers.ts` | Reference: Category A rethrow-with-context pattern (keep as-is) |

### Design Principles

1. Every test must prove at least one contract: either success shape or expected failure class.
2. Both-paths-pass is only allowed if both paths assert something: success asserts fields, failure asserts error type/status.
3. Best-effort cleanup catches are allowed but must be tagged with a `// best-effort-cleanup` comment.
4. Catch blocks that swallow errors without assertion are eliminated.

## Development Approach

Create the error assertion helpers first with unit tests, then refactor integration tests, then E2E tests, then update CLAUDE.md. Each file's refactoring is independent, so work can proceed one file at a time.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Create Expected Error Assertion Helpers

**Files:**
- Create: `tests/helpers/expected-error.ts`
- Create: `tests/unit/helpers/expected-error.test.ts`

Create shared helpers for asserting expected SAP error shapes in test catch blocks.

- [x] Create `tests/helpers/expected-error.ts` with:
  - `expectSapFailureClass(error: unknown, allowedStatuses: number[], allowedPatterns?: RegExp[]): void` — asserts the error is an instance of `Error`, then checks if `error.message` contains one of the allowed HTTP status codes (e.g., 403, 404, 500) or matches one of the allowed patterns. Throws a descriptive assertion error if neither condition is met. Example usage: `expectSapFailureClass(err, [404], [/not found/i])`.
  - `isSapError(error: unknown): error is Error & { message: string }` — type guard for SAP errors.
  - `expectSapErrorContains(error: unknown, substring: string): void` — asserts error message contains a specific substring. For simpler cases where status code matching is overkill.
  - `SapFailureCategory` type: `'not-found' | 'forbidden' | 'not-released' | 'timeout' | 'connectivity' | 'unknown'`.
  - `classifySapError(error: unknown): SapFailureCategory` — classifies error by status code or message pattern. 404 → 'not-found', 403 → 'forbidden', 'not released' → 'not-released', timeout/ECONNREFUSED → 'connectivity'.
- [x] Add unit tests (~12 tests) in `tests/unit/helpers/expected-error.test.ts`:
  - `expectSapFailureClass` passes with matching status code in message (e.g., "Request failed with status 404").
  - `expectSapFailureClass` passes with matching pattern.
  - `expectSapFailureClass` throws when status code doesn't match.
  - `expectSapFailureClass` throws when error is not an Error object.
  - `expectSapFailureClass` throws when message matches no pattern.
  - `isSapError` returns true for Error with message.
  - `isSapError` returns false for non-Error objects.
  - `expectSapErrorContains` passes when substring is found.
  - `expectSapErrorContains` throws when substring is missing.
  - `classifySapError` classifies 404 as 'not-found'.
  - `classifySapError` classifies 403 as 'forbidden'.
  - `classifySapError` classifies unknown errors as 'unknown'.
- [x] Run `npm test` — all tests must pass.

### Task 2: Refactor Low-Signal Catches in ADT Integration Tests

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Convert Category C catch blocks in the ADT integration test to dual-path assertions.

- [x] Import `expectSapFailureClass` from `../../helpers/expected-error.js`.
- [x] Lines 220-225 (include read catch-ignore): refactor from `catch { /* ignore */ }` to a dual-path pattern:
  ```typescript
  try {
    const source = await client.getClass('CL_ABAP_CHAR_UTILITIES', 'definitions');
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(0);
  } catch (err) {
    // Include may not be available on all systems — expect 404 or similar
    expectSapFailureClass(err, [404, 500], [/not found/i, /does not exist/i]);
  }
  ```
- [x] Lines 269-274 (interface read catch-ignore): same dual-path pattern. Success: assert source is truthy and non-empty string. Failure: assert 404 or not-found error shape.
- [x] Lines 283-290 (FM search catch-ignore): same dual-path pattern. Success: assert results array. Failure: assert expected error shape (404 or search failure).
- [x] Lines 431-447 (both throw/no-throw accepted): These are edge-case tests. Refactor to:
  - Empty search query: success asserts empty/valid array; failure asserts error (any shape acceptable for edge case).
  - Table contents maxRows=0: success asserts columns present; failure asserts expected error pattern.
  - Add comment: `// Edge case: both outcomes are acceptable, but we assert the shape of whichever occurs`.
- [x] Verify that existing `afterAll` cleanup blocks (lines 553-568) with catch-ignore are Category A — add `// best-effort-cleanup` comment tag to each.
- [x] Run `npm run test:integration` if SAP credentials are available — all tests should still pass. Otherwise run `npm test`.
- [x] Run `npm test` — all tests must pass.

### Task 3: Refactor Permissive BTP Restriction Tests

**Files:**
- Modify: `tests/integration/btp-abap.integration.test.ts`

Convert Category B restriction tests to assert specific expected failure classes.

- [x] Import `expectSapFailureClass` and `classifySapError` from `../../helpers/expected-error.js`.
- [x] Lines 194-200 (classic programs not available): refactor to expect failure:
  ```typescript
  it('classic programs like RSHOWTIM are NOT available', async () => {
    try {
      await client.getProgram('RSHOWTIM');
      // If it unexpectedly succeeds, verify it returns valid source
      expect(typeof source).toBe('string');
    } catch (err) {
      expectSapFailureClass(err, [403, 404], [/not found/i, /not available/i, /not released/i]);
    }
  });
  ```
- [x] Lines 203-209 (function modules): keep flexible search assertion but add: `expect(results).toBeInstanceOf(Array)` on success path.
- [x] Lines 211-223 (table preview restricted): success path asserts columns; failure path uses `expectSapFailureClass(err, [403, 500], [/restricted/i, /not authorized/i])`.
- [x] Lines 225-232 (free SQL blocked): success path asserts result shape; failure path uses `expectSapFailureClass(err, [403, 500], [/blocked/i, /not authorized/i, /restricted/i])`.
- [x] Run `npm test` — all tests must pass.

### Task 4: Refactor Diagnostics E2E Fallback Chain

**Files:**
- Modify: `tests/e2e/diagnostics.e2e.test.ts`

Improve signal quality in the dump-trigger test fallback chain so that the test fails or explicitly skips when no verifiable outcome is produced.

- [x] In the dump trigger test (lines 141-270), refactor the create/update/activate chain:
  - Track whether each step succeeded: `let createOk = false; let activateOk = false;`.
  - After create try/catch: set `createOk = true` in the try block.
  - After activate try/catch: set `activateOk = true` in the try block.
  - Before the dump-listing section, add a signal check: if none of the write steps succeeded, use `ctx.skip('Could not create or activate dump-trigger program — write steps all failed')` instead of silently continuing.
- [x] In the dump-listing section (lines 232-269), improve the "no dumps at all" branch:
  - Instead of the current silent pass (`console.log('No dumps on system at all'); // This is still a pass`), change to: if create/activate succeeded, expect at least one dump (the one we just triggered). If create/activate failed AND no dumps exist, skip with reason `'No dumps available and write steps failed — cannot verify dump functionality'`.
  - Keep the "different dump available" fallback (reading any available dump to verify API shape) — this is valid.
- [x] Add `// best-effort-cleanup` tag to any cleanup catch blocks in this test.
- [x] Run `npm test` — all tests must pass.

### Task 5: Update CLAUDE.md Testing Conventions

**Files:**
- Modify: `CLAUDE.md`

Add do/don't rules for try/catch usage in tests to the testing conventions section.

- [x] In the `CLAUDE.md` file, find the "Testing" section (around line 345+). After the existing testing content, add a subsection:
  ```markdown
  ### try/catch Rules in Tests

  **DO:**
  - Assert success shape in try block (check fields, types, non-empty values)
  - Assert expected error class in catch block using `expectSapFailureClass()` from `tests/helpers/expected-error.ts`
  - Tag cleanup-only catches with `// best-effort-cleanup` comment
  - Use rethrow-with-context pattern for setup/teardown errors (see `tests/e2e/helpers.ts`)

  **DON'T:**
  - Catch and ignore errors without any assertion (empty catch or `catch { /* skip */ }`)
  - Accept both success and failure without asserting the shape of either
  - Use try/catch to hide test precondition failures (use `requireOrSkip` instead)
  ```
- [x] Run `npm test` — all tests must pass.

### Task 6: Final Verification

- [x] Run full unit suite: `npm test` — all tests pass (including 12+ new expected-error helper tests).
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Grep for empty catch blocks in `tests/integration/` and `tests/e2e/`: all remaining catches should either have assertions or `// best-effort-cleanup` tags.
- [x] Move this plan to `docs/plans/completed/` once all tasks are done.

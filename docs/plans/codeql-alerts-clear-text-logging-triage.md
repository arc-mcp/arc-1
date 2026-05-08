# CodeQL Clear-Text Logging Triage — Alerts #9, #10, #11

## Overview

Three open HIGH CodeQL alerts (`js/clear-text-logging` rule) flag potential clear-text logging of sensitive configuration in [src/cli.ts](src/cli.ts) — specifically tainted accesses to `apiKeys`, `apiKeysRaw`, and `oauthDcrTtlSeconds` flowing into `console.log` / `console.error`. Triage strongly suggests all three are **false positives**: the flagged sites either log only error messages (`err.message`) or build an `out` object that contains only `allow*` flag fields, never the secret `apiKeys` field. CodeQL's taint analysis is correctly conservative — any access to a sensitive field anywhere in the function poisons every later sink — but the actual data flow does not leak.

This plan does three things:
1. **Verify** the data flow with a short audit, locking in the FP-vs-real determination via reading the code.
2. **Document** the audit conclusion in inline comments at each flagged site so a future maintainer (or future CodeQL run) sees why the site is safe.
3. **Lock the FP claim with a regression test** — a unit test that captures stdout/stderr while exercising each flagged code path and asserts no API-key material leaks. This prevents a future change from introducing a real leak that taint analysis already warned about.

If the audit finds an actual leak (low probability based on initial inspection), the plan branches into adding a `redactSensitiveConfig()` helper. The plan is written for the FP-confirmed path; the branching is documented in Task 4.

The remaining manual step — dismissing the three alerts in the GitHub Security tab with rationale referencing this PR — happens after merge. The CI doesn't auto-dismiss CodeQL alerts based on inline comments alone.

Design decisions:

- **Audit before changing code.** The most likely outcome is "no production code change" — CodeQL is just being conservative. Don't add a redaction helper for a non-existent leak; that's noise that obscures real findings later.
- **A regression test is the right artifact** even if the alerts are FPs. The test pins the current behavior and turns the implicit guarantee ("we don't log secrets here") into an explicit assertion checked on every CI run.
- **Inline comments use the CodeQL rule ID and alert number.** Anyone debugging the Security tab can grep `js/clear-text-logging` in the source and find why each site was determined safe.
- **No `redactSensitive()` helper as defense-in-depth.** Adding a helper "just in case" creates code that does nothing and ages poorly. If a future change actually requires logging config, *that* change introduces the helper.

## Context

### Current State

- `src/cli.ts` has three flagged code sites (line numbers in current `main`):
  - **Alert #9 — line 79**: `console.error(err instanceof Error ? err.message : String(err))` inside the `call` command's catch handler. CodeQL traces taint because the function reads CLI args that *eventually* feed `apiKeysRaw` somewhere in the dispatch chain.
  - **Alert #10 — line 241**: `console.log(JSON.stringify(out, null, 2))` inside `config show --format json`. The `out` object is built explicitly (lines 228–240) and only contains `allow*` flags + `sources`. `apiKeys` is *not* a key in `out`. CodeQL is poisoned because the same function calls `resolveConfig()` which returns a `serverConfig` with an `apiKeys` field — accessed earlier even though never put in `out`.
  - **Alert #11 — line 270**: `console.error(`Error: ${(err as Error).message}`)` inside the same `config show` command's catch. Same reason as #9 — error message logging, not config logging.
- No test today asserts that secrets don't leak through the `arc1-cli call` and `arc1-cli config show` commands. The "we don't log secrets" property is a *non*-property — nothing pins it.
- The CodeQL Default Setup re-scans on every push to `main`. Inline comments alone won't dismiss the alerts; the dismissal happens manually in the Security UI after merge with a rationale link to this PR.

### Target State

- Each flagged site has an inline `// codeql[js/clear-text-logging]: …` comment explaining why the site is safe (post-audit).
- A new unit test file (or a new `describe` block in an existing one) captures stdout/stderr while running the flagged code paths and asserts no API-key material leaks. The test acts as a regression guard and as machine-readable evidence for the FP claim.
- CodeQL alerts #9, #10, #11 manually dismissed in the Security UI after merge with rationale "verified false positive — see PR <N>; regression test pins the safety property".

### Key Files

| File | Role |
|------|------|
| `src/cli.ts` | The three flagged sites live here. Lines 79, 241, 270 in current `main`. |
| `src/server/config.ts` | `resolveConfig()` builds the `serverConfig` object that contains `apiKeys`. The audit needs to confirm this object's `apiKeys` field never leaves the function via the `out` shape used in `config show`. |
| `src/server/types.ts` | `ServerConfig` type — confirm the `apiKeys` field's type, and confirm `out` in `config show` doesn't reference it. |
| `tests/unit/cli/` | Existing dir. The regression test goes here. May need to be a new file `clear-text-logging-regression.test.ts` since the test is cross-cutting. |
| `tests/helpers/` | Shared test helpers — may need a small `captureConsole()` helper to wrap a function and collect its stdout/stderr. |

### Design Principles

1. **Verification first, code change second.** The audit determines the work scope. Most paths land in "FP confirmed → comment + test"; only a real leak path adds a redaction helper.
2. **Regression test, not redaction theater.** The test makes the safety property checkable. A redaction helper that doesn't run in production code is dead weight; a test that runs on every CI is alive and useful.
3. **Inline comments use a structured tag.** `// codeql[js/clear-text-logging]: false-positive — out object excludes apiKeys, see clear-text-logging-regression.test.ts` is greppable and traceable.
4. **No production behavior change for FPs.** If the audit confirms FP for all three, the diff is comments + a new test file. Source semantics unchanged.

## Development Approach

Pure code-only change with no SAP system interaction. Order tasks so the audit lands first and drives whether Task 4 (redaction helper) runs at all. The regression test is written to assert *both* the current behavior (no secrets in output) AND to break loudly if a future change introduces a real leak — that future-change-detector is the test's primary value.

The regression test uses Node's `process.stdout.write` / `process.stderr.write` interception (or vitest's `vi.spyOn(console, 'log')`) to capture output without spawning a subprocess. This keeps the test fast and deterministic.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Audit data flow at the three flagged sites

**Files:**
- Read-only audit of: `src/cli.ts`, `src/server/config.ts`, `src/server/types.ts`, `src/handlers/intent.ts` (since `runToolCall` in cli.ts dispatches into `handleToolCall`)

This task is read-only — it produces a written audit, not code changes. The audit's conclusion drives Tasks 2–4. The audit is documented in this task's checkboxes (each box becomes a finding) AND inlined into the task's own description in this plan via post-execution annotation.

- [ ] Read [src/cli.ts:73-82](src/cli.ts:73-82) (the `call` command's action handler around alert #9). Trace where `err` originates: it's the catch-block of `runToolCall(tool, args, opts.output)`. Confirm `runToolCall` is defined in `cli.ts` (or imported) and verify whether its thrown errors ever interpolate `apiKeys`/`apiKeysRaw` into the message.
- [ ] Read [src/cli.ts:217-273](src/cli.ts:217-273) (the `config show` command's action handler around alerts #10 and #11). Specifically verify what fields the `out` object built at line 228 contains. Expected: `effectivePolicy.{allowWrites, allowDataPreview, allowFreeSQL, allowTransportWrites, allowGitWrites, allowedPackages, allowedTransports, denyActions}` plus `sources`. Confirm `apiKeys` / `apiKeysRaw` / `oauthDcrTtlSeconds` are NOT properties of `out`.
- [ ] Read `resolveConfig()` in `src/server/config.ts` to verify how `apiKeys` ends up on `serverConfig`. Confirm it's a top-level field on `ServerConfig`, not nested inside the `allow*` fields used by `out`.
- [ ] Read the catch block at `cli.ts:269-272` (alert #11). Confirm the `(err as Error).message` interpolation can only contain text from `resolveConfig` parser failures — these are config-validation messages and never embed credential strings. Document any exceptions found.
- [ ] Reconcile the audit:
  - If all three are confirmed FPs: proceed to Task 2 (comments) and Task 3 (regression test). Skip Task 4.
  - If any is a real leak: still proceed to Task 2 and Task 3, but ALSO execute Task 4 (redaction helper) for the leaking site(s). Document which alerts are real in the PR description.
- [ ] Update this plan file's Task 1 description with a short audit summary (1 paragraph, what was checked and the conclusion). This becomes the dismissal rationale paste-text for the CodeQL UI.
- [ ] Run `npm test` — sanity check, no changes yet so all tests must pass.

### Task 2: Add inline comments at the three flagged sites

**Files:**
- Modify: `src/cli.ts`

Document the audit conclusion at each flagged site so a future reader (and a future CodeQL run on touched code) sees why the site was determined safe. Format the comments as a structured tag that's greppable for future sweeps.

- [ ] At [src/cli.ts:79](src/cli.ts:79) (alert #9), add an inline comment immediately above the `console.error` line:
  ```ts
  // codeql[js/clear-text-logging]: false-positive (alert #9).
  // err.message comes from runToolCall failures (Zod validation, ADT errors,
  // safety blocks) — none interpolate api-key material. Pinned by
  // tests/unit/cli/clear-text-logging-regression.test.ts.
  ```
- [ ] At [src/cli.ts:241](src/cli.ts:241) (alert #10), add an inline comment immediately above `console.log(JSON.stringify(out, null, 2))`:
  ```ts
  // codeql[js/clear-text-logging]: false-positive (alert #10).
  // `out` is constructed explicitly with only the `allow*` policy flags and
  // `sources` — `apiKeys` / `apiKeysRaw` / `oauthDcrTtlSeconds` are NOT
  // included. Pinned by tests/unit/cli/clear-text-logging-regression.test.ts.
  ```
- [ ] At [src/cli.ts:270](src/cli.ts:270) (alert #11), add an inline comment immediately above the catch's `console.error`:
  ```ts
  // codeql[js/clear-text-logging]: false-positive (alert #11).
  // err.message comes from resolveConfig() parser failures — config validation
  // errors, not credential material. Pinned by tests/unit/cli/clear-text-logging-regression.test.ts.
  ```
- [ ] If Task 1 found any of the three to be a *real* leak, instead document the bug in the comment with `// codeql[js/clear-text-logging]: real-leak (alert #N) — fixed via redactSensitiveConfig() helper, see Task 4.` and proceed to Task 4.
- [ ] Run `npm test` — all tests must pass (no behavior change yet).
- [ ] Run `npm run lint` — no new issues. Biome may flag long single-line comments; if so, break each comment to fit the 120-char limit.
- [ ] Run `npm run typecheck` — no new issues.

### Task 3: Add regression unit test asserting no secret leakage

**Files:**
- Create: `tests/unit/cli/clear-text-logging-regression.test.ts`
- (Optional) Modify: `tests/helpers/` — add a small `captureConsole()` helper if one doesn't already exist

Pin the safety property checked in Task 1 with an automated test. The test exercises each flagged code path with a config that includes a recognizable test API key, captures stdout + stderr, and asserts the test key never appears in the output. This is the regression guard against a future change introducing a real leak.

- [ ] Check `tests/helpers/` for an existing `captureConsole()` or stdout-capture helper. If none exists, create `tests/helpers/capture-console.ts`:
  ```ts
  import { vi } from 'vitest';

  export function captureConsole<T>(fn: () => T | Promise<T>): Promise<{
    result: T;
    stdout: string;
    stderr: string;
  }>;
  ```
  Implementation captures `console.log` / `console.error` calls into accumulated strings and restores spies after the function returns or throws.
- [ ] Create `tests/unit/cli/clear-text-logging-regression.test.ts` with **~5 tests**:
  - **Test 1 — `arc1-cli config show --format json` does not echo the API key.** Set `ARC1_API_KEYS=test-key:viewer,another-key:developer` via env, invoke the `config show` action, assert neither `test-key` nor `another-key` appears in stdout.
  - **Test 2 — `arc1-cli config show --format table` does not echo the API key.** Same fixture, default format, same assertion.
  - **Test 3 — config-show error path does not echo the API key.** Force `resolveConfig()` to throw (e.g., pass a bogus `--api-keys` value that fails parsing), capture stderr, assert no key material leaks.
  - **Test 4 — `arc1-cli call` error path does not echo the API key.** Invoke the `call` action with a bogus tool name to force `runToolCall` to throw, capture stderr, assert the test key (set via env) does not appear.
  - **Test 5 — `oauthDcrTtlSeconds` does not appear in `config show --format json` output.** Set `--oauth-dcr-ttl-seconds 3600` and assert the literal `3600` is not in stdout (since `out` should not include this field).
- [ ] If exercising the actions directly is awkward (Commander's `.action()` callbacks), import the action callback functions and invoke them with synthetic argv. Alternative: use `child_process.spawnSync()` to run the actual built CLI — but that requires `npm run build` first and is slower. Prefer the in-process invocation.
- [ ] Each test must use a recognizable, distinctive token for the "API key" (e.g., `cli-test-key-DO-NOT-LOG-12345`) so a substring check is reliable.
- [ ] Run `npm test` — all 5 new tests pass.
- [ ] Run `npm run lint` and `npm run typecheck` — no new issues.

### Task 4: (Conditional) Add `redactSensitiveConfig()` helper if Task 1 found real leakage

**Files:**
- Modify: `src/server/types.ts` (add helper function)
- Modify: `src/cli.ts` (route the leaky log call through the helper)
- Modify: `tests/unit/server/types.test.ts` (or new file) — unit-test the helper itself

**Skip this task if Task 1's audit confirmed all three alerts as FPs.** Only execute if a real leak was found. If skipped, mark the task as `[x]` with a one-line note: "Skipped — Task 1 audit confirmed all three alerts as FPs."

- [ ] In `src/server/types.ts`, add `export function redactSensitiveConfig(config: ServerConfig): SafeServerConfigForLogging` that returns a copy with `apiKeys`, `apiKeysRaw`, `oauthDcrTtlSeconds`, and any other token-like fields replaced with `"[REDACTED]"` if present.
- [ ] At the actual leaking site identified in Task 1, replace `console.X(thing)` with `console.X(redactSensitiveConfig(thing))` (or wrap whatever object was leaking).
- [ ] Add unit tests for `redactSensitiveConfig`: ~4 tests covering each redacted field type, the round-trip preserving `allow*` flags, and `null`/`undefined` input handling.
- [ ] Update the inline comment from Task 2 at the formerly-leaking site to reflect the fix: `// codeql[js/clear-text-logging]: real-leak fixed via redactSensitiveConfig (alert #N).`
- [ ] Run `npm test` — all tests pass including the new ones.
- [ ] Run `npm run lint` and `npm run typecheck` — no new issues.

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass (including ~5 new regression tests from Task 3, plus 4 more from Task 4 if it ran).
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Verify the three flagged sites have the expected inline comments by `grep -n "codeql\[js/clear-text-logging\]" src/cli.ts` — expect 3 matches.
- [ ] Verify the regression test exists and runs: `npx vitest run tests/unit/cli/clear-text-logging-regression.test.ts` — expect 5 passes.
- [ ] After PR merges to `main`: manually dismiss CodeQL alerts #9, #10, #11 in the Security UI ([https://github.com/marianfoo/arc-1/security/code-scanning](https://github.com/marianfoo/arc-1/security/code-scanning)) with rationale text (paste from Task 1's audit summary):
  > Verified false positive in PR #N. The flagged `console.X` sinks log either `err.message` from upstream errors (not credentials) or an explicitly-constructed `out` object that excludes `apiKeys`/`apiKeysRaw`/`oauthDcrTtlSeconds`. Audit and rationale documented inline in src/cli.ts; safety property pinned by `tests/unit/cli/clear-text-logging-regression.test.ts` (5 tests).
- [ ] Move this plan to `docs/plans/completed/codeql-alerts-clear-text-logging-triage.md`.

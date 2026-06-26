# Test Suite Audit Quick Wins

**Status:** Completed in PR `#274`; local validation and GitHub Actions run `26534513455` passed after the quick-win implementation. A later PR-readiness run exposed a `$TMP` cache warmup flake, so the final implementation also moves that strict delta assertion to stable `$DEMO_SOI_DRAFT`.

## Overview

This plan implements the low-risk "Quick Wins" from `docs/research/2026-05-11-test-suite-audit.md`. The changes improve test telemetry wording, make local E2E helper scripts portable across Linux and macOS, and make the GitHub Actions test workflow run cheap unit/lint/typecheck checks even when SAP-heavy jobs are skipped for `docs:` or `chore:` PRs.

The plan intentionally avoids the P0 correctness blockers from the audit, such as fixture activation hardening and CTS cleanup. Those remain separate follow-up work because they touch live SAP behavior and need dedicated validation against the S4 system.

## Context

### Current State

- `scripts/ci/collect-test-reliability.mjs` renders skipped test titles under `### Top Skip Reasons`, even though it does not collect structured skip reasons.
- `scripts/e2e-start-local.sh` uses `fuser -k "${MCP_PORT}/tcp"` and `grep -oP`, which are Linux/GNU-specific and fail or degrade on macOS/BSD tooling.
- `scripts/e2e-stop-local.sh` detects only JSON log lines with `"level":"error"`, while the default ARC-1 logger writes text lines such as `[timestamp] ERROR: ...`.
- `.github/workflows/test.yml` uses the `gate` job as a dependency of the full `test` job, so `docs:` and `chore:` PRs skip unit tests, lint, typecheck, npm audit, and package smoke checks.
- `INFRASTRUCTURE.md` was referenced by the ralphex plan instructions but is not present in this checkout. `CLAUDE.md`, `package.json`, and the existing workflow/scripts define the applicable local validation commands.

### Target State

- Reliability summaries label the table as skipped tests, not skip reasons.
- Local E2E start/stop scripts work with portable shell plus Node.js helpers, support macOS port cleanup through `lsof`, and detect both JSON and text error log lines.
- The GitHub Actions workflow always runs cheap non-SAP checks on PRs and manual dispatches, while SAP integration/E2E jobs remain title-gated and serialized across the repository.
- The audit report documents which quick wins were implemented and what remains.

### Key Files

| File | Role |
|------|------|
| `scripts/ci/collect-test-reliability.mjs` | Generates CI test reliability markdown from Vitest JSON results. |
| `tests/unit/scripts/collect-test-reliability.test.ts` | Unit coverage for reliability summary output. |
| `scripts/e2e-start-local.sh` | Starts the local HTTP MCP server for E2E tests. |
| `scripts/e2e-stop-local.sh` | Stops the local HTTP MCP server and prints log diagnostics. |
| `scripts/e2e-local-utils.mjs` | New portable Node.js helper for health JSON parsing and log error summarization. |
| `tests/unit/scripts/e2e-local-utils.test.ts` | New unit coverage for the E2E local helper. |
| `.github/workflows/test.yml` | CI workflow to separate cheap checks from SAP-heavy jobs. |
| `tests/unit/workflows/test-workflow.test.ts` | New static regression tests for workflow gate/concurrency behavior. |
| `docs/research/2026-05-11-test-suite-audit.md` | Audit report updated with implemented quick-win status. |

### Design Principles

1. Keep quick wins low-risk and observable. Do not change live SAP test semantics in this PR.
2. Prefer Node.js for JSON parsing and log classification because Node 22 is already required by the project and available in CI.
3. Keep shell scripts POSIX-ish and portable: prefer `lsof` for port listener discovery, fall back to `fuser` only when `lsof` is unavailable.
4. Keep SAP-heavy workflow serialization repository-wide, not ref-wide, and avoid canceling SAP jobs while they may hold locks or own cleanup.
5. Add focused unit/static tests for every code or workflow behavior change.

## Development Approach

Implement the smallest behavior changes first, then workflow restructuring, then documentation. Run focused tests after each code-bearing task and the full local validation set before pushing. After the branch is pushed, change the PR title to a non-`docs:`/`chore:` prefix before the final synchronize event so GitHub Actions exercises the updated workflow path.

## Validation Commands

- `npm test -- tests/unit/scripts/collect-test-reliability.test.ts tests/unit/scripts/e2e-local-utils.test.ts tests/unit/workflows/test-workflow.test.ts`
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:npx-smoke`
- `npm run btp:validate`

### Task 1: Rename skipped-test telemetry label

**Files:**
- Modify: `scripts/ci/collect-test-reliability.mjs`
- Modify: `tests/unit/scripts/collect-test-reliability.test.ts`

The summary currently says "Top Skip Reasons" but counts skipped test titles from Vitest JSON output. Rename the table so readers do not confuse titles with structured skip reasons.

- [x] Change the generated markdown heading from `### Top Skip Reasons` to `### Top Skipped Tests`.
- [x] Keep the existing counting behavior unchanged; do not introduce structured reason extraction in this quick win.
- [x] Update unit assertions in `tests/unit/scripts/collect-test-reliability.test.ts`.
- [x] Run `npm test -- tests/unit/scripts/collect-test-reliability.test.ts`.

### Task 2: Add portable E2E local helper and update scripts

**Files:**
- Add: `scripts/e2e-local-utils.mjs`
- Add: `tests/unit/scripts/e2e-local-utils.test.ts`
- Modify: `scripts/e2e-start-local.sh`
- Modify: `scripts/e2e-stop-local.sh`

The local E2E scripts should work on macOS and Linux without GNU-only grep features and should detect errors in both JSON and default text log formats.

- [x] Add `scripts/e2e-local-utils.mjs` with exported helpers for reading a field from health JSON and summarizing error log lines.
- [x] The health parser must return `unknown` for missing or malformed JSON fields.
- [x] The log helper must count JSON error entries containing `"level":"error"` and text logger entries containing `] ERROR:`.
- [x] Update `scripts/e2e-start-local.sh` to prefer `lsof -tiTCP:${MCP_PORT} -sTCP:LISTEN` for port cleanup, then fall back to `fuser -k`.
- [x] Update `scripts/e2e-start-local.sh` to parse `version` and `startedAt` through the Node helper instead of `grep -oP`.
- [x] Update `scripts/e2e-stop-local.sh` to print log line count and last error lines through the Node helper.
- [x] Add unit tests covering health field extraction, malformed health JSON, JSON error logs, text error logs, and last-five error truncation.
- [x] Run `npm test -- tests/unit/scripts/e2e-local-utils.test.ts`.

### Task 3: Keep cheap CI checks outside the SAP gate

**Files:**
- Modify: `.github/workflows/test.yml`
- Add: `tests/unit/workflows/test-workflow.test.ts`

The `gate` job should guard only SAP-heavy jobs. Unit tests, lint, typecheck, npm audit, and package smoke checks should run on all PRs and manual dispatches, including `docs:` and `chore:` PRs.

- [x] Remove `needs: gate` from the `test` job so cheap checks always run.
- [x] Keep the `gate` job title-based skip behavior for SAP-heavy jobs.
- [x] Add `needs: [test, gate]` and `needs.gate.result == 'success'` checks to `integration` so SAP integration runs only when the gate passes and the unit/lint job succeeds.
- [x] Add `gate` to the `e2e` dependencies and require `needs.gate.result == 'success'` in the E2E job condition.
- [x] Move repository-wide SAP serialization from top-level workflow concurrency to `integration` and `e2e` jobs with group `${{ github.repository }}-sap-live-a4h` and `cancel-in-progress: false`.
- [x] Update stale comments, especially the E2E "push main" comment.
- [x] Add static workflow tests that assert `test` does not depend on `gate`, SAP jobs do depend on `gate`, SAP jobs use repository-wide concurrency, and the E2E comment no longer claims push-to-main behavior.
- [x] Run `npm test -- tests/unit/workflows/test-workflow.test.ts`.

### Task 4: Document implemented quick wins

**Files:**
- Modify: `docs/research/2026-05-11-test-suite-audit.md`
- Modify: `docs/plans/completed/2026-05-27-test-suite-audit-quick-wins.md`

After implementation and local verification, the audit report should say what was implemented so future test-hardening work can start from the remaining blockers.

- [x] Add an implementation update section to the audit report for the quick wins.
- [x] Mark the quick-win rows as implemented or superseded by the new section without hiding the remaining P0/P1/P2 follow-ups.
- [x] Record validation commands and GitHub workflow observations once they are available.
- [x] Mark this plan's completed task checkboxes and move it to `docs/plans/completed/`.

### Task 5: Final verification and PR readiness

**Files:**
- Review: all modified files in this plan

Verify the implementation locally and then through GitHub Actions before marking the PR ready for review.

- [x] Run focused quick-win tests: `npm test -- tests/unit/scripts/collect-test-reliability.test.ts tests/unit/scripts/e2e-local-utils.test.ts tests/unit/workflows/test-workflow.test.ts`.
- [x] Run full unit suite: `npm test`.
- [x] Run typecheck: `npm run typecheck`.
- [x] Run lint: `npm run lint`.
- [x] Run package smoke: `npm run test:npx-smoke`.
- [x] Run MTA validation: `npm run btp:validate`.
- [x] Update the PR title to a non-`docs:`/`chore:` prefix before the final push so the workflow gate runs the SAP jobs.
- [x] Push the branch and monitor GitHub workflow checks.
- [x] If workflow checks fail, inspect logs, fix, push again, and repeat until checks pass or a real external blocker is documented.
- [x] Mark the draft PR ready for review after successful checks.

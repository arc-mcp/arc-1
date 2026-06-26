# GitHub Actions A4H 2025 Migration

Status: completed in PR [#365](https://github.com/arc-mcp/arc-1/pull/365). The implementation workflow run [27058553382](https://github.com/arc-mcp/arc-1/actions/runs/27058553382) passed with GitHub artifact counts of unit `3,468/0 skipped`, integration `208/54 skipped`, and E2E `137/4 skipped`. Later CI reruns exposed a live SAP ADT lock/unlock routing flake; the PR now includes the skip-classifier hardening and final green Test workflow run [27059551872](https://github.com/arc-mcp/arc-1/actions/runs/27059551872), with Node 22/24 unit `3,473/0 skipped`, integration `208/54 skipped`, and E2E `119/22 skipped / 0 failed`.

## Overview

This plan moves ARC-1's live SAP CI path from the older A4H 2023 target to the tuned A4H 2025 target. The code change should make `.github/workflows/test.yml` use one canonical live-test secret set, `TEST_SAP_*`, for both integration and E2E jobs, so future target rotations do not require keeping `TEST_SAP_*` and `SAP_*` in sync.

The GitHub repository secret values are external state and must never be committed. The workflow should be explicit enough to prove the target is healthy: preflight should fail fast when required secrets are missing or authenticated ADT discovery is not HTTP 200, while fork PRs remain excluded from SAP jobs.

## Context

### Current State

The current workflow uses `TEST_SAP_*` secrets for integration, but E2E uses a separate `SAP_*` secret set and hard-codes `SAP_CLIENT: '001'`. Repository secret names currently include both sets, but there are no 2025-specific names. The prior runtime research notes that GitHub default CI still targets the older 2023 secrets and names the 2025 migration as the next runtime improvement.

Local infrastructure docs expose a tuned A4H 2025 system at `http://a4h-2025.marianzeis.de:50100`, client `001`, with SAP_BASIS 816. A raw authenticated ADT core discovery probe against that target returned HTTP 200 on 2026-06-06.

### Target State

The Test workflow uses `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`, `TEST_SAP_CLIENT`, and `TEST_SAP_INSECURE` for both live SAP jobs. GitHub repository `TEST_SAP_*` secrets are rotated to the A4H 2025 values. E2E maps those secrets to the runtime's expected `SAP_*` environment variables only inside the job.

Docs record that the 2025 system is now the GitHub live-test target, that the old 2025 "not tuned" warning is obsolete, and that the resulting PR CI was actually exercised against A4H 2025.

### Key Files

| File | Role |
|------|------|
| `.github/workflows/test.yml` | Live SAP CI workflow; integration and E2E secret wiring and preflight behavior. |
| `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md` | Existing runtime follow-up that calls out the 2025 GitHub migration as open. |
| `docs/research/2026-06-06-github-actions-a4h-2025-migration.md` | New checkpoint document for this migration. |
| `docs/integration-test-skips.md` | Skip-profile documentation; contains an outdated warning about the 2025 system not being tuned. |
| `/Users/marianzeis/DEV/arc-1/INFRASTRUCTURE.md` | Local infrastructure source of truth for 2025 endpoint and tuning state; do not copy secrets. |
| `/Users/marianzeis/DEV/arc-1/.env.infrastructure` | Local credential source for live validation and secret rotation; do not print or commit values. |

### Design Principles

1. Keep one canonical GitHub live SAP target secret set. The workflow should not require separate integration and E2E SAP credentials.
2. Keep fork PR protection. SAP jobs should still run only on internal PRs or manual dispatch because GitHub does not pass repository secrets to fork PRs.
3. Fail fast on broken live SAP target configuration. A green live SAP job with no executed tests is worse than a red preflight.
4. Do not leak credentials. Workflow logs can print a non-secret target label and HTTP status, not usernames or passwords.
5. Keep integration and E2E sequential. This PR changes the target and validation contract, not SAP test parallelism.

## Development Approach

First update the workflow wiring and preflight behavior, then update docs. Rotate repository `TEST_SAP_*` secrets to the A4H 2025 values only through `gh secret set` using local raw parsing, never by echoing values. Validate locally with lint/typecheck/unit plus live A4H 2025 integration/E2E default profiles, then push a `test:` PR so the SAP gate runs.

## Validation Commands

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:integration`
- `npm run test:e2e`

### Task 1: Update GitHub Actions live SAP target wiring

**Files:**
- Modify: `.github/workflows/test.yml`

This task makes `TEST_SAP_*` the single GitHub Actions live SAP target for integration and E2E. It also makes preflight a real assertion that the target is configured and authenticated.

- [x] Add a non-secret target label such as `SAP_CI_TARGET_LABEL: A4H 2025` at workflow or job scope.
- [x] In the integration preflight, include `TEST_SAP_INSECURE`, check that `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`, and `TEST_SAP_CLIENT` are present, and fail with a GitHub `::error` if any are missing.
- [x] In the integration preflight, call authenticated ADT core discovery and fail unless HTTP status is `200`; keep the status visible and do not print credentials.
- [x] Apply the same preflight contract to E2E, using the `TEST_SAP_*` secret names instead of the current `SAP_*` names.
- [x] Map `TEST_SAP_*` secrets to `SAP_*` environment variables only for the E2E start/test steps, because the local server and E2E tests expect `SAP_URL`, `SAP_USER`, `SAP_PASSWORD`, `SAP_CLIENT`, and optionally `SAP_INSECURE`.
- [x] Run `npm run typecheck` and `npm run lint`.

### Task 2: Update research and skip-profile documentation

**Files:**
- Modify: `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`
- Modify: `docs/integration-test-skips.md`
- Create: `docs/research/2026-06-06-github-actions-a4h-2025-migration.md`

This task records the migration research while work is in progress and removes stale guidance that would discourage using the tuned 2025 system as a write/activate CI target.

- [x] Add a new research checkpoint with current branch baseline, workflow findings, GitHub secret names checked, official GitHub Actions secret-handling references, live 2025 preflight evidence, and implementation decisions.
- [x] Update the prior runtime research's open follow-up section to say this PR is implementing the 2025 GitHub migration.
- [x] Update the 2025 rows in `docs/integration-test-skips.md` to reflect the tuned 2025 system and the measured default profile skip counts from the prior PR.
- [x] Ensure no credentials, tokens, or local absolute secret values are copied into docs.
- [x] Run `npm run lint`.

### Task 3: Rotate repository live-test secrets to A4H 2025

**Files:**
- External state only: GitHub repository Actions secrets for `arc-mcp/arc-1`
- Read only: `/Users/marianzeis/DEV/arc-1/.env.infrastructure`

This task points GitHub's canonical `TEST_SAP_*` secret set at the tuned A4H 2025 system. It intentionally does not change the committed repository except through docs that record the fact of rotation.

- [x] List current repository secret names with `gh secret list -R arc-mcp/arc-1` and confirm `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`, `TEST_SAP_CLIENT`, and `TEST_SAP_INSECURE` exist or can be created.
- [x] Parse `.env.infrastructure` without shell evaluation so special characters in the password are not interpreted.
- [x] Set `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`, `TEST_SAP_CLIENT`, and `TEST_SAP_INSECURE` to the A4H 2025 values with `gh secret set -R arc-mcp/arc-1`.
- [x] Re-list secret names and timestamps only; do not print secret values.
- [x] Run an authenticated local ADT core discovery probe against A4H 2025 and record only target label, client, HTTP status, and response size.

### Task 4: Local live validation on A4H 2025

**Files:**
- No planned source changes; use the current branch.

This task validates that the workflow target is usable before opening the PR. The commands should use A4H 2025 variables parsed from `.env.infrastructure`.

- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run test:integration` with `TEST_SAP_*` env populated from A4H 2025.
- [x] Start the local MCP server with A4H 2025 `SAP_*` env and run `npm run test:e2e`; always stop the server afterward.

### Task 5: Publish PR and verify GitHub CI

**Files:**
- Commit all intended changes from this plan only.

This task creates a review-ready PR and verifies that GitHub Actions actually runs against the updated target.

- [x] Inspect `git status -sb` and the diff; stage only `.github/workflows/test.yml`, docs touched by this plan, and the plan file.
- [x] Commit with a conventional `test:` message.
- [x] Push branch `codex/github-ci-a4h-2025`.
- [x] Create a PR with a `test:` title so the SAP gate runs.
- [x] Watch the Test workflow. Confirm `test`, `integration`, `e2e`, and `reliability-summary` are green.
- [x] If GitHub CI fails, inspect logs, fix the root cause, rerun checks, and repeat until green.

### Task 6: Final documentation and review

**Files:**
- Modify: `docs/research/2026-06-06-github-actions-a4h-2025-migration.md`
- Modify: `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`
- Move: `docs/plans/completed/2026-06-06-github-actions-a4h-2025-migration.md` to `docs/plans/completed/2026-06-06-github-actions-a4h-2025-migration.md`

This task closes the loop after GitHub CI has run. The docs should include concrete evidence so future test-suite work knows what changed and what remains.

- [x] Add the PR number, GitHub Actions run id, job results, runtimes, and skip counts where artifacts expose them.
- [x] Record whether workflow preflight behaved as intended and whether A4H 2025 was the effective target.
- [x] List remaining follow-ups, especially whether slow profiles should be added to manual or scheduled CI.
- [x] Move this plan to `docs/plans/completed/`.
- [x] Review the implementation architecture: one canonical live SAP secret set, no new concurrency, no hidden test skips, no secrets in docs/logs.

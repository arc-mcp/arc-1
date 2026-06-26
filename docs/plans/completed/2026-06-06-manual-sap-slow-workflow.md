# Manual SAP Slow Workflow

## Overview

This plan adds one reviewable PR for the remaining post-A4H-2025 test-suite items: a manually dispatched GitHub Actions workflow for slow live SAP profiles, documentation of the first manual baseline, tracking guidance for A4H 2025 ADT lock/unlock instability, and audit guidance for old repository `SAP_*` secrets after the default CI migration to `TEST_SAP_*`.

The slow profiles must stay manual for now. They exercise broad where-used scans, repeated cache warmup, full RAP write lifecycles, and recursive transport release coverage. Those paths are valuable but should not run on every PR, and recursive release remains destructive enough to require an explicit opt-in input.

The PR also removes hard-coded SAP defaults from the local rate-limit smoke harness. That script is test-support code and should not write credential-like values into `/tmp` from repository contents.

## Context

### Current State

`origin/main` already contains the default runtime split from PR #364 and the GitHub A4H 2025 migration from PR #365. The default `.github/workflows/test.yml` uses `TEST_SAP_*` for both integration and E2E, runs the default live SAP profiles sequentially behind the shared `${{ github.repository }}-sap-live-a4h` concurrency group, and reports reliability through `scripts/ci/collect-test-reliability.mjs`.

Slow scripts already exist in `package.json`: `npm run test:integration:slow` and `npm run test:e2e:slow`. They are not yet wired into GitHub Actions. `vitest.integration.slow.config.ts` writes `test-results/integration-slow.json`; `tests/e2e/vitest.e2e.slow.config.ts` writes `test-results/e2e-slow.json` unless `E2E_LOG_DIR` is set, in which case it writes `${E2E_LOG_DIR}/e2e-slow.json`.

The repository still has old `SAP_URL`, `SAP_USER`, `SAP_PASSWORD`, and `SAP_CLIENT` GitHub secret names. The default workflow no longer references `secrets.SAP_*`, but local runtime scripts and docs legitimately still use `SAP_*` environment variables as application configuration. Secret deletion is external state and should be documented for an operator rather than hidden inside a code PR.

### Target State

There is a `workflow_dispatch` workflow for slow SAP tests on A4H 2025. Its live slow SAP job is manual-only. The workflow also has a cheap pull-request definition check so GitHub validates the new workflow file during PR review without accessing SAP secrets or running slow tests.

The manual slow job uses the canonical `TEST_SAP_*` secrets, authenticates with the same ADT core discovery preflight as the default workflow, runs selected slow integration and/or E2E profiles sequentially, uploads slow JSON/skip/log artifacts, and normalizes results so the existing reliability summary can read them.

The slow workflow exposes explicit boolean inputs for running integration slow, running E2E slow, and enabling recursive transport release. The default input keeps recursive release disabled. The workflow should fail early if both slow suites are disabled.

The research docs explain what was implemented, how to run the manual workflow, what baseline was observed, how to interpret A4H 2025 lock/unlock instability, and which old GitHub secrets are cleanup candidates after the `TEST_SAP_*` migration.

### Key Files

| File | Role |
|------|------|
| `.github/workflows/test.yml` | Existing default PR workflow and source for SAP preflight/concurrency patterns. |
| `.github/workflows/sap-slow-tests.yml` | New manual-only workflow for slow live SAP profiles. |
| `package.json` | Existing `test:integration:slow`, `test:e2e:slow`, and E2E server lifecycle scripts. |
| `vitest.integration.slow.config.ts` | Slow integration JSON output and sequential execution config. |
| `tests/e2e/vitest.e2e.slow.config.ts` | Slow E2E JSON/JUnit output and sequential execution config. |
| `scripts/ci/collect-test-reliability.mjs` | Existing reliability summary; expects normalized `integration.json` and `e2e.json`. |
| `scripts/ci/assert-required-test-execution.mjs` | Existing threshold check; can run in warn mode with slow-profile threshold overrides. |
| `scripts/rate-limit-smoke.sh` | Local test-support harness that must stop writing hard-coded SAP defaults. |
| `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md` | Runtime research checkpoint to update with manual slow workflow status and baseline. |
| `docs/research/2026-06-06-github-actions-a4h-2025-migration.md` | GitHub secret migration research to update with the old-secret audit result. |
| `docs/integration-test-skips.md` | Skip taxonomy to update with manual slow workflow and lock/unlock monitoring guidance. |

### Design Principles

1. Keep slow live SAP tests manual-only and sequential; do not turn on file-level parallelism for integration or E2E.
2. Reuse the canonical `TEST_SAP_*` GitHub secrets and only map them to `SAP_*` inside E2E server/test steps.
3. Preserve the shared live SAP concurrency group so default and slow workflows do not hit A4H simultaneously.
4. Require authenticated ADT core discovery HTTP 200 before any slow SAP command runs.
5. Keep recursive transport release disabled by default and require a dedicated manual input.
6. Normalize slow JSON filenames for reliability reporting instead of changing the reliability script's default suite model.
7. Do not delete repository secrets from the PR; document the audit and operator cleanup criteria.
8. Do not store SAP credential defaults in repository scripts, generated temp files, docs, workflow logs, or PR text.

## Development Approach

Start with the workflow because it is the missing executable surface. Keep duplication with the default workflow acceptable for this PR; extracting a shared action or shell script can be a later cleanup if both workflows diverge. Then update docs with explicit operator guidance and sanitize the rate-limit smoke harness. Validate locally with YAML parsing, typecheck, lint, unit tests, and diff checks before pushing.

After the PR exists, run the normal PR CI and the slow workflow's pull-request definition check. GitHub only accepts `workflow_dispatch` events after a workflow file exists on the default branch, so the first live manual slow run is a post-merge operator step for this new workflow. Document that constraint in the runtime research. After merge, dispatch the slow workflow with recursive release disabled, then fill in the baseline evidence.

## Validation Commands

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/sap-slow-tests.yml'); puts 'workflow yaml ok'"`
- `git diff --check`

### Task 1: Add the manual slow SAP workflow

**Files:**
- Add: `.github/workflows/sap-slow-tests.yml`

Create a manual-only GitHub Actions workflow for the existing slow SAP profiles. Follow `.github/workflows/test.yml` for Node setup, SAP auth preflight, secret naming, target label, and concurrency.

- [x] Add a pull-request definition check and `workflow_dispatch` inputs for `run_integration_slow`, `run_e2e_slow`, and `enable_transport_release_tests`, defaulting both suites to enabled and release tests to disabled.
- [x] Add `permissions: contents: read` and `env: SAP_CI_TARGET_LABEL: A4H 2025`.
- [x] Add one Ubuntu job with concurrency group `${{ github.repository }}-sap-live-a4h`, `cancel-in-progress: false`, Node 22, `npm ci`, and a guard step that exits with a clear `::error` when both suite inputs are false.
- [x] Add the authenticated ADT core discovery preflight using `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`, `TEST_SAP_CLIENT`, and `TEST_SAP_INSECURE`.
- [x] Run `npm run test:integration:slow` when `run_integration_slow` is true and upload `test-results/integration-slow.json` plus `test-results/integration-skips.ndjson`.
- [x] Build, start the local MCP server, run `npm run test:e2e:slow`, stop the server, and upload slow E2E JSON/JUnit/log artifacts when `run_e2e_slow` is true.
- [x] Pass `TEST_TRANSPORT_RELEASE_TESTS` from the manual input to both slow profiles; keep it `false` unless explicitly enabled.
- [x] Normalize slow JSON files to `test-results/integration.json` and/or `test-results/e2e.json`, run the existing reliability summary, and run required-execution warn mode with thresholds appropriate for selected slow suites.
- [x] Run the workflow YAML parse command locally.

### Task 2: Sanitize local rate-limit smoke harness credentials

**Files:**
- Modify: `scripts/rate-limit-smoke.sh`

The rate-limit smoke harness currently writes SAP defaults into `/tmp/arc1-smoke.env` when the file is absent. Replace those defaults with a safe template and fail with clear instructions until the operator supplies real credentials.

- [x] Change `ensure_env()` so it writes placeholder `SAP_URL=`, `SAP_USER=`, `SAP_PASSWORD=`, `SAP_CLIENT=001`, and `SAP_LANGUAGE=EN` values without host/user/password defaults.
- [x] Add validation after sourcing the env file so `start_server()` fails with a concise message when required SAP values are blank or still placeholders.
- [x] Keep stdout/stderr behavior suitable for smoke output and avoid printing password values.
- [x] Run shell syntax validation with `bash -n scripts/rate-limit-smoke.sh`.

### Task 3: Update runtime and skip documentation

**Files:**
- Modify: `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`
- Modify: `docs/integration-test-skips.md`

Document that slow profiles now have a manual GitHub workflow and define how to interpret its results. Include the release-test input behavior and A4H 2025 lock/unlock monitoring guidance.

- [x] Update the runtime research document's follow-up state so the manual slow workflow is implemented rather than only a future option.
- [x] Add operator steps for manually dispatching the slow workflow and explain that recursive transport release remains disabled unless `enable_transport_release_tests=true`.
- [x] Add a baseline placeholder that will be replaced after the manual workflow run completes on GitHub.
- [x] Update the skip taxonomy to mention that A4H 2025 transient ADT lock/unlock skips are tracked through default and manual slow workflow reliability summaries, and that persistent increases require SAP-side investigation.
- [x] Run `rg -n "manual slow|SAP Slow|transport release|lock/unlock" docs/research/2026-06-06-test-runtime-profiles-and-coverage.md docs/integration-test-skips.md` to confirm the new guidance is discoverable.

### Task 4: Update GitHub secret audit documentation

**Files:**
- Modify: `docs/research/2026-06-06-github-actions-a4h-2025-migration.md`

Update the migration research with the current `gh secret list` result and the post-merge secret cleanup recommendation. Keep the distinction between GitHub secret names and legitimate local runtime `SAP_*` variables.

- [x] Document that current `.github/workflows/*.yml` files do not reference `secrets.SAP_*` after PR #365.
- [x] Document that repository secret names `SAP_URL`, `SAP_USER`, `SAP_PASSWORD`, and `SAP_CLIENT` still exist as of the audit, but values were not read.
- [x] Recommend deleting the old GitHub `SAP_*` secrets only after the default PR workflow and the new manual slow workflow have both passed from `TEST_SAP_*`.
- [x] Note that local scripts/docs must keep `SAP_*` runtime environment variables because the application uses those names outside GitHub Actions.
- [x] Run a targeted `rg` command over `.github` to prove workflow secret references use `TEST_SAP_*`.

### Task 5: GitHub validation and baseline documentation

**Files:**
- Modify: `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`
- Move: `docs/plans/completed/2026-06-06-manual-sap-slow-workflow.md` to `docs/plans/completed/2026-06-06-manual-sap-slow-workflow.md`

After local validation passes, create the PR and run normal GitHub CI plus the new workflow's pull-request definition check. Do not claim the live slow job was dispatched from the PR branch: GitHub requires a new `workflow_dispatch` workflow file to exist on the default branch before it can receive manual dispatch events. Document the PR evidence now and leave the live slow baseline as the post-merge follow-up.

- [x] Run local validation commands: `npm run typecheck`, `npm run lint`, `npm test`, workflow YAML parse, `bash -n scripts/rate-limit-smoke.sh`, and `git diff --check`.
- [x] Commit, push, and create a ready PR with a conventional `ci:` title and a description covering goal, content, and validation.
- [x] Wait for the normal PR `Test` workflow checks and the new `SAP Slow Tests` pull-request definition check to pass. Latest checked PR head `033ba0fe`: `Test` run `27061737354` passed, `SAP Slow Tests` run `27061737358` passed the definition check and skipped live slow profiles on pull request as intended, Dependency Review run `27061737351` passed, and CodeQL run `27061736790` passed.
- [x] Confirm the runtime research document explains that the first live manual slow dispatch is post-merge because new `workflow_dispatch` workflows must exist on the default branch.
- [x] After merge, dispatch the new `SAP Slow Tests` workflow with slow integration and slow E2E enabled, recursive release disabled. Run `27068686650` passed on `main`.
- [x] After that post-merge dispatch, update the runtime research document with the slow workflow URL, run id, runtime, pass/fail/skip counts, and any A4H 2025 lock/unlock observations.
- [x] Move this plan to `docs/plans/completed/` after implementation and validation are complete.

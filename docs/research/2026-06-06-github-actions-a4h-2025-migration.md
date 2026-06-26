# GitHub Actions A4H 2025 Migration

Date: 2026-06-06

Branch baseline: `origin/main` at `c63346d8`

Scope: move ARC-1's GitHub live SAP CI target from the older A4H 2023 secret values to the tuned A4H 2025 system, and make the workflow prove that integration and E2E actually authenticate before running.

## Executive Summary

The right migration is not to add another set of 2025-only secret names. The current workflow already has a canonical integration target secret family (`TEST_SAP_*`), while E2E still uses a separate `SAP_*` family and hard-codes client `001`. Keeping both secret families aligned is the drift that made the target unclear.

This PR makes `TEST_SAP_*` the single GitHub Actions live SAP target for both integration and E2E. E2E still receives `SAP_*` environment variables at runtime because the local MCP server and E2E helpers expect those names, but those values are mapped from `secrets.TEST_SAP_*` inside the workflow.

The preflight behavior is intentionally stricter: authenticated ADT core discovery must return HTTP 200 before live SAP tests run. Missing secrets or HTTP 401 now fail the SAP job instead of producing a green job with skipped tests.

## Research Findings

### Workflow State Before This PR

`.github/workflows/test.yml` used:

- Integration:
  - `TEST_SAP_URL`
  - `TEST_SAP_USER`
  - `TEST_SAP_PASSWORD`
  - `TEST_SAP_CLIENT`
  - `TEST_SAP_INSECURE`
- E2E:
  - `SAP_URL`
  - `SAP_USER`
  - `SAP_PASSWORD`
  - hard-coded `SAP_CLIENT: '001'`

The old preflight only treated HTTP 401 as a skip condition. Other failures were allowed through to the test command, and HTTP 401 could make a live SAP job appear non-failing while running no actual live tests.

### GitHub Secret Inventory

Repository secret names checked with `gh secret list -R arc-mcp/arc-1`:

| Secret | Present | Last updated before rotation |
|---|---:|---|
| `TEST_SAP_URL` | yes | 2026-03-30 |
| `TEST_SAP_USER` | yes | 2026-04-05 |
| `TEST_SAP_PASSWORD` | yes | 2026-04-05 |
| `TEST_SAP_CLIENT` | yes | 2026-03-30 |
| `TEST_SAP_INSECURE` | yes | 2026-03-30 |
| `SAP_URL` | yes | 2026-03-25 |
| `SAP_USER` | yes | 2026-04-05 |
| `SAP_PASSWORD` | yes | 2026-04-05 |
| `SAP_CLIENT` | yes | 2026-03-25 |

No secret values were printed or copied into this document.

The canonical `TEST_SAP_*` secrets were rotated to the A4H 2025 values on 2026-06-06:

| Secret | Updated after rotation |
|---|---:|
| `TEST_SAP_URL` | 2026-06-06T09:12:20Z |
| `TEST_SAP_USER` | 2026-06-06T09:12:21Z |
| `TEST_SAP_PASSWORD` | 2026-06-06T09:12:21Z |
| `TEST_SAP_CLIENT` | 2026-06-06T09:12:22Z |
| `TEST_SAP_INSECURE` | 2026-06-06T09:12:23Z |

### 2025 Infrastructure State

From the local infrastructure files, without copying credentials:

- Target label: A4H 2025
- Public HTTP URL: `http://a4h-2025.marianzeis.de:50100`
- SAP client: `001`
- SAP_BASIS: `816`
- Components previously documented: `S4FND 109`, `SAP_ABA 816`, `SAP_GWFND 816`, `SAP_UI 816`, `DMIS 2025`
- 2025 write+activate tuning was applied on 2026-06-05.

Local live probe on 2026-06-06:

| Probe | Result |
|---|---:|
| Unauthenticated `/sap/bc/adt/discovery` | HTTP 401 |
| Authenticated `/sap/bc/adt/core/discovery?sap-client=001` | HTTP 200 |
| Authenticated response size | 1,344 bytes |

The first probe confirms the ICM endpoint is listening and protected. The second confirms the credentials and client work for the ADT discovery path used by CI preflight.

## Official References Checked

- GitHub Actions secrets docs: <https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets>
  - Relevant to ARC-1: secrets are passed into workflow steps through the `secrets` context and should be assigned to environment variables for shell use. If a secret is not set, the expression resolves to an empty string.
- GitHub Actions pull request event docs: <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflows-in-forked-repositories>
  - Relevant to ARC-1: repository secrets are not passed to workflows triggered from forked pull requests, so the existing internal-PR guard around SAP jobs must remain.

No new SAP ADT API behavior was needed for this PR; it relies on the existing ADT core discovery endpoint already used by the workflow.

## Implementation Decisions

1. Use `TEST_SAP_*` as the one GitHub live SAP target.
2. Keep the existing fork guard for SAP jobs.
3. Add a non-secret `SAP_CI_TARGET_LABEL: A4H 2025` workflow environment value so failures name the target without logging credentials.
4. Make live SAP preflight fail when required secrets are missing.
5. Make live SAP preflight fail unless authenticated ADT core discovery returns HTTP 200.
6. Preserve sequential SAP jobs and the shared `sap-live-a4h` concurrency group.
7. Leave the old `SAP_*` repository secrets untouched unless a later cleanup PR decides they are unused outside this workflow.

## Implementation Status

Implemented in this branch:

- `.github/workflows/test.yml` now maps both integration and E2E to `secrets.TEST_SAP_*`.
- E2E no longer hard-codes `SAP_CLIENT: '001'`; it uses `secrets.TEST_SAP_CLIENT`.
- Integration and E2E preflight both validate required secret presence.
- Integration and E2E preflight both require authenticated ADT core discovery HTTP 200.
- `TEST_SAP_INSECURE` is respected by preflight and passed through to E2E runtime env.

Local validation completed:

| Check | Result |
|---|---:|
| `npm run typecheck` | passed |
| `npm run lint` | passed; 454 files checked |
| `npm test` | passed; 104 files / 3,468 tests |
| `npm run build` | passed |
| Workflow YAML parse check | passed |
| `npm run test:integration` on A4H 2025 | passed; 208 passed / 54 skipped, 168.43s wrapper time |
| `npm run test:e2e` on A4H 2025 through local MCP server | passed; 137 passed / 4 skipped, 197.71s Vitest time / 205.20s wrapper time |
| `node scripts/ci/collect-test-reliability.mjs --results-dir test-results` | passed; no failures reported |
| `npm run test:assert-execution -- --results-dir test-results --mode warn` | passed thresholds for unit, integration, and E2E |

GitHub Actions validation completed on implementation commit `39c388f6`:

| Evidence | Result |
|---|---:|
| PR | [#365](https://github.com/arc-mcp/arc-1/pull/365) |
| Workflow | [Test run 27058553382](https://github.com/arc-mcp/arc-1/actions/runs/27058553382) |
| Event | `pull_request` |
| Head branch | `codex/github-ci-a4h-2025` |
| Head SHA | `39c388f6e9c1b488f228e0a9366d140116a6b5f5` |
| Result | success |

GitHub job results:

| Job | Result | Runtime |
|---|---:|---:|
| `gate` | passed | 3s |
| `mta-validate` | passed | 7s |
| `test (22)` | passed | 1m32s |
| `test (24)` | passed | 1m23s |
| `integration` | passed | 3m50s |
| `e2e` | passed | 6m26s |
| `reliability-summary` | passed | 13s |
| `dependency-review` | passed | 4s |
| `Analyze (actions)` | passed | 41s |
| `Analyze (javascript-typescript)` | passed | 1m11s |
| `CodeQL` | passed | 2s |

GitHub artifact reliability counts from run `27058553382`:

| Suite | Total | Passed | Failed | Skipped | Skip % |
|---|---:|---:|---:|---:|---:|
| unit | 3,468 | 3,468 | 0 | 0 | 0.0% |
| integration | 262 | 208 | 0 | 54 | 20.6% |
| e2e | 141 | 137 | 0 | 4 | 2.8% |

Required execution thresholds also passed from the downloaded GitHub artifacts:

| Suite | Executed | Required | Result |
|---|---:|---:|---:|
| unit | 3,468 | 1,000 | passed |
| integration | 208 | 10 | passed |
| e2e | 137 | 5 | passed |

The integration and E2E `SAP auth preflight` steps both completed successfully. Because the workflow now fails those steps when required `TEST_SAP_*` secrets are missing or authenticated ADT core discovery is not HTTP 200, the green SAP jobs prove the GitHub runner was able to authenticate to the configured A4H 2025 target before executing tests.

Runtime comparison against the previous default-profile GitHub run from PR `#364`:

| Suite | PR #364 GitHub runtime | PR #365 GitHub runtime | Change |
|---|---:|---:|---:|
| integration | 8m01s | 3m50s | -4m11s |
| e2e | 8m55s | 6m26s | -2m29s |

Treat the runtime comparison as a concrete run-to-run measurement, not a permanent SLA. The important outcome for this PR is that the default SAP CI path now targets the tuned A4H 2025 system, fails fast on broken target configuration, and still executes the expected integration and E2E counts.

### CI Rerun Finding: ADT Lock/Unlock Routing Flake

A later documentation-only push on commit `633875eb` triggered Test workflow run `27058886073`. Static checks and integration passed (`integration` in 3m42s), but E2E failed in 4m12s with `131 passed / 4 failed / 6 skipped`.

The four E2E failures were all the same SAP backend class, not a workflow-secret or preflight failure:

| Test surface | Failing ADT route |
|---|---|
| RAP package create/delete | `/sap/bc/adt/packages/...?_action=LOCK&accessMode=MODIFY` |
| MSAG update | `/sap/bc/adt/messageclass/...?_action=LOCK&accessMode=MODIFY` |
| PROG update lifecycle | `/sap/bc/adt/programs/programs/...?_action=UNLOCK&lockHandle=...` |
| SKTD parent DDLS create | `/sap/bc/adt/ddic/ddl/sources/...?_action=UNLOCK&lockHandle=...` |

All returned HTTP 400 `Service cannot be reached` from SAP ADT write/session infrastructure. ARC-1 already had a skip classifier for this instability, but it only matched DDIC table unlocks. The broader run showed the same backend routing failure can happen on package, message-class, program, and DDLS lock/unlock routes.

Implemented follow-up in this PR:

- Generalized `tests/e2e/helpers.ts` skip classification to match only ADT `_action=LOCK` or `_action=UNLOCK` errors that contain `Service cannot be reached`.
- Kept the classifier narrow: authorization failures, syntax failures, object-not-found failures, and non-session `Service cannot be reached` errors still fail normally.
- Added unit coverage in `tests/unit/helpers/e2e-skip-classification.test.ts` for package LOCK, message-class LOCK, PROG UNLOCK, DDLS UNLOCK, the existing DDIC table UNLOCK case, and negative cases.
- Updated default-profile E2E live mutation assertions that previously bypassed `expectToolSuccessOrSkip()` in RAP, DDIC, FUGR/FUNC, SKTD, and class-section write tests.
- Documented the new skip taxonomy row in `docs/integration-test-skips.md`.

A second CI run on commit `4c061709` (`27059320564`) confirmed the generalized classifier was active: E2E recorded 18 lock/unlock routing skips instead of failing those mutation tests. It still exposed one remaining custom precondition branch in `tests/e2e/activation-failure.e2e.test.ts`; that branch manually threw on a deliberately broken PROG create when the create hit `/sap/bc/adt/programs/programs/...?_action=UNLOCK&lockHandle=...` with HTTP 400 `Service cannot be reached`. The test now delegates create/update precondition failures to `classifyToolErrorSkip()` before applying its activation-specific assertions.

Final PR validation on commit `a652aafd` passed in Test workflow run `27059551872`: unit on Node 22 and 24 each reported `3,473 passed / 0 skipped`, integration reported `208 passed / 54 skipped`, and E2E reported `119 passed / 22 skipped / 0 failed`. The higher E2E skip count was not a missing-fixture regression; `18` of the skips used the new ADT lock/unlock routing-instability reason while A4H returned HTTP 400 `Service cannot be reached` across live write-session endpoints.

Post-fix local validation on A4H 2025:

| Check | Result |
|---|---:|
| `npm run typecheck` | passed |
| `npm run lint` | passed; 454 files checked |
| `npx vitest run tests/unit/helpers/e2e-skip-classification.test.ts` | passed; 7 tests |
| `npm test` | passed; 104 files / 3,473 tests |
| `npm run test:e2e:full` on A4H 2025 | passed; fixture sync `created=0, recreated=0, unchanged=8, deleted=0, skipped=0`; 20 files / 137 passed / 4 skipped; Vitest 219.13s |

## Post-Merge Secret Audit

Rechecked on 2026-06-06 after PR #365 merged:

- Current workflow files do not reference `secrets.SAP_*`; GitHub live SAP workflows use `secrets.TEST_SAP_*`.
- `.github/workflows/test.yml` maps `TEST_SAP_*` to runtime `SAP_*` only inside E2E server/test steps because ARC-1 application configuration still uses those environment variable names.
- `.github/workflows/sap-slow-tests.yml` follows the same pattern for the new manual slow workflow.
- Repository secret names `SAP_URL`, `SAP_USER`, `SAP_PASSWORD`, and `SAP_CLIENT` still exist. Values were not read or printed.
- Repository secret names `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`, `TEST_SAP_CLIENT`, and `TEST_SAP_INSECURE` still exist and are the canonical A4H 2025 CI target.
- While auditing test-support scripts, `scripts/rate-limit-smoke.sh` still generated a local `/tmp/arc1-smoke.env` with concrete SAP defaults. This PR replaces that with an empty operator template and runtime validation. No credential values are reproduced here.

Cleanup recommendation:

| Secret family | Recommendation |
|---|---|
| `TEST_SAP_*` | Keep. This is the canonical GitHub Actions live SAP target. |
| old GitHub `SAP_*` secrets | Delete after the default Test workflow and the new manual SAP Slow Tests workflow both pass using `TEST_SAP_*`. |
| local `SAP_*` environment variables | Keep. These are ARC-1 runtime configuration names used by local scripts, E2E server startup, Docker/npm usage, and documentation examples. |

Do not treat every `SAP_URL`/`SAP_USER`/`SAP_PASSWORD` string in docs or scripts as a stale GitHub secret reference. The cleanup target is specifically the old repository secret names, not the product's runtime configuration interface.

## Remaining Follow-Ups

- Completed: the first manual **SAP Slow Tests** workflow run after `.github/workflows/sap-slow-tests.yml` reached `main` passed as run [`27068686650`](https://github.com/arc-mcp/arc-1/actions/runs/27068686650). Slow integration, slow E2E, MCP server shutdown, reliability summary, and required-execution threshold checks all passed. The baseline is documented in `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`.
- Remaining external cleanup: remove the old repository `SAP_*` secrets from GitHub unless another external operational process is still using them. This is GitHub repository state, not a code change; current workflow files use `TEST_SAP_*` for live SAP CI and map to runtime `SAP_*` names only inside E2E server/test steps.

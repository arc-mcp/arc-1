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

Repository secret names checked with `gh secret list -R marianfoo/arc-1`:

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

Pending GitHub validation:

- Open the PR and verify GitHub Actions `test`, `integration`, `e2e`, and `reliability-summary` are green.
- Update this document with PR number, run id, job runtimes, and artifact skip counts after the workflow completes.

## Remaining Follow-Ups

- Decide whether `test:integration:slow` and `test:e2e:slow` should become manual `workflow_dispatch` jobs or a scheduled/nightly workflow after the 2025 default profile is stable in GitHub.
- Consider removing or repurposing old `SAP_*` repository secrets after confirming no other workflows or operational scripts depend on them.

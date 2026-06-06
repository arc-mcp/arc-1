# Test Runtime Profiles And Coverage Follow-Up

Date: 2026-06-06

Branch baseline: `origin/main` at `94551af0`

Scope: follow-up to `docs/research/test-suite-audit-2026-05-11.md` items 8-15. This checkpoint covers the remaining PR-path runtime reductions, slow-profile split, feature-probe cleanup, read-only concurrency smoke, and focused unit coverage for HTTP/server/BTP/cookie extraction surfaces.

## Executive Summary

The remaining runtime issues are concentrated in a few live SAP files, not in Vitest overhead. Broad file-level parallelism is still the wrong default because the slowest tests create ABAP repository objects, acquire ADT locks, mutate CTS transports, publish service bindings, or inspect shared warmup state. The correct next move is a profile split:

- Keep the default PR path sequential and faster.
- Move repeated cache warmup, recursive transport release, broad BAPIRET2/T000 where-used scans, and full RAP/SRVB stack variants into explicit slow profiles.
- Add one bounded read-only concurrency smoke to prove the Streamable HTTP server and `ARC1_MAX_CONCURRENT` path can accept simultaneous requests without mixing that with SAP mutations.
- Add focused unit coverage around BTP startup helpers, standard HTTP verifier API-key behavior, and cookie extraction pure helpers.

## Implementation Result

This PR implements the profile split and coverage work described below.

- Default integration now excludes `*.slow.integration.test.ts`; `test:integration:slow` runs the moved cache warmup and recursive transport release coverage.
- Default E2E now excludes `*.slow.e2e.test.ts`; `test:e2e:slow` runs the broad where-used, full RAP stack, and recursive transport release coverage.
- E2E repeated capability setup now uses `SAPManage features` where cached feature state is sufficient.
- A read-only concurrency E2E smoke runs three simultaneous MCP `SAPRead` calls through one Streamable HTTP client and logs `ARC1_MAX_CONCURRENT`, `ARC1_AUTH_RATE_LIMIT`, and `ARC1_RATE_LIMIT`.
- Focused unit coverage was added for `createStandardVerifier`, BTP VCAP/destination/connectivity proxy helpers, and cookie host/Netscape-format helpers.
- While validating, cache-marker handling had to be normalized in E2E helpers/tests: `[cached:revalidated]` is now stripped where tests parse source or JSON-like tool output, and fixture source comparison now tolerates SAP TABL pretty-printer differences. This stopped steady-state fixture sync from recreating unchanged managed objects.

Measured on A4H 2025 / `SAP_BASIS 816`:

| Suite | Result | Runtime | Notes |
|---|---:|---:|---|
| `npm run test:integration` | 208 passed / 54 skipped | 188.06s | Default profile; package fixture skips on missing A4H 2025 demo package are now explicit. |
| `npm run test:integration:slow` | 6 passed / 1 skipped | 25.97s | Slow cache warmup plus recursive release guard. |
| `npm run test:e2e` | 137 passed / 4 skipped | 183.22s | Default profile through local MCP server on port 3105; fixture sync steady state was `created=0, recreated=0, unchanged=8`. |
| `npm run test:e2e:slow` | 8 passed / 1 skipped | 188.08s | Slow RAP stack and broad where-used profile; recursive transport release skipped because `TEST_TRANSPORT_RELEASE_TESTS` was not enabled. |

Local no-SAP validation:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 104 files / 3,468 tests passed.
- `npm run test:coverage`: 104 files / 3,468 tests passed; statements 82.57%, branches 73.38%, functions 88.48%, lines 83.79%.
- `npm run build`: passed.

GitHub Actions validation:

- PR `#364`, run `27056833245`, passed after retitling the PR to `test:` so the SAP gate ran on the synchronize event.
- `gate`: passed in 3s.
- `test (22)`: passed in 1m35s.
- `test (24)`: passed in 1m23s.
- `integration`: passed in 8m01s with the new default integration profile.
- `e2e`: passed in 8m55s with the new default E2E profile.
- `reliability-summary`: passed in 17s.
- `mta-validate`, dependency review, and CodeQL checks also passed.

Runtime interpretation:

- Local default E2E dropped from the original audit's 424.95s all-in profile to 183.22s for the default profile, while preserving the heavier checks in `test:e2e:slow`.
- Local default integration dropped from the original audit's 320.07s all-in profile to 188.06s for the default profile.
- The slow E2E profile remains dominated by real SAP backend calls: `BAPIRET2` where-used took 50.3s on A4H 2025, `T000` where-used took 16.2s, and full RAP/SRVB write lifecycles took 111.4s combined.
- The GitHub default profile is now measured and substantially below the earlier 2026-05-11 run (`integration` 8m01s vs 6m39s on a different system/run, `e2e` 8m55s vs 13m12s). Integration did not improve in PR #364 because that workflow run still targeted the older 2023 secrets. The follow-up PR on branch `codex/github-ci-a4h-2025` addresses this by making `TEST_SAP_*` the single GitHub live SAP target and rotating it to A4H 2025.

## Sources Checked

### Project And Infrastructure Docs

- `CLAUDE.md` testing and architecture guidance: current scripts, live SAP suite behavior, skip policy, 2025 release notes, and key files.
- `docs/research/test-suite-audit-2026-05-11.md`: remaining items 8-15 and the GitHub Actions runtime deep dive from run `25674270461`.
- `docs/research/abap-platform-2025-816-compatibility.md`: 2025/816 compatibility backlog and write-tuning status.
- `/Users/marianzeis/DEV/arc-1/INFRASTRUCTURE.md`: live system inventory, 2025 write tuning, 2023 SAP capacity settings, NPL 7.50 HTTP ADT limitations. Secrets were not copied into this document.
- `/Users/marianzeis/DEV/arc-1/.env.infrastructure`: variable names only, to confirm `SAP_A4H_2025_*`, `SAP_NPL_*`, and 2023 credentials are available for local validation.

### Official Protocol And Vendor Docs

- Model Context Protocol, Streamable HTTP transport: `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports`
  - Relevant facts: Streamable HTTP can handle multiple client connections; every JSON-RPC message uses HTTP POST; stdio logging must go to stderr, not stdout; HTTP local servers should bind to localhost and use auth/origin controls.
  - ARC-1 implication: HTTP transport concurrency exists at the MCP layer, but it does not make SAP repository-object mutation safe to parallelize.
- OpenAI MCP/Connectors docs: `https://developers.openai.com/api/docs/guides/tools-connectors-mcp`
  - Relevant facts: remote MCP servers are imported through tool listing, tool definitions add cost/latency, and remote MCP calls can access data or take action, so high-trust integrations need careful controls.
  - ARC-1 implication: keeping ARC-1's 12 intent tools and reducing unnecessary repeated live probe calls matters for latency and tool cost.
- SAP ABAP docs via SAP docs MCP:
  - `ABENADT_GLOSRY`: ADT are Eclipse-based tools for editing ABAP repository objects; newer repository objects sometimes require ADT.
  - `ABENNAMES_REPOS_OBJ_GUIDL`: repository objects are maintained in ADT or ABAP Workbench and assigned to packages.
  - `ABENCDS_SERVICE_BINDINGS`: service bindings are ADT repository objects binding CDS service definitions to protocols/business services.
  - `ABENABAP_TEST_COCKPIT_GLOSRY` and `ABENABAP-TESTCOCKPIT_GUIDL`: ATC is integrated into ADT/Workbench and CTS/Transport Organizer workflows.
  - ARC-1 implication: RAP/SRVB/ATC/CTS tests are real repository workflows and should stay isolated from broad parallelism.

### External ADT/ABAP Repos

Temporary clones used for local source inspection:

- `marcellourbani/abap-adt-api` (`https://github.com/marcellourbani/abap-adt-api`)
  - Confirms explicit ADT session type handling through `X-sap-adt-sessiontype`, stateful/stateless modes, and transport release via `newreleasejobs` / `relwithignlock`.
  - Its disruptive tests use stateful mode for lock/write flows and stateless clones for some transport paths.
- `mario-andreschak/mcp-abap-abap-adt-api` (`https://github.com/mario-andreschak/mcp-abap-abap-adt-api`)
  - Confirms MCP wrappers often expose many low-level ADT operations (`transportRelease`, `usageReferences`, `activateObjects`) and set the ADT client to stateful mode globally.
  - ARC-1 should keep the intent-tool model but avoid repeated broad live operations on the PR path.
- `bluefunda/abaper` (`https://github.com/bluefunda/abaper`)
  - Provides an ABAP LSP/SDK implementation that treats ADT live operations as stateful, lock-bound workflows. Its parity docs distinguish read/source operations from write/lock/activate/transport workflows.
  - This is the closest public "ADT language server" implementation found; no public Eclipse ADT core implementation was found.
- `abapGit/ADT_Frontend` (`https://github.com/abapGit/ADT_Frontend`)
  - Confirms the abapGit ADT bridge uses custom `http://www.sap.com/adt/abapgit/relations/...` relations and transport request fields.
  - Relevant mainly for availability skips; it does not change the runtime profile plan.

Public Eclipse ADT implementation source was not found. SAP Help and Eclipse update-site/docs establish ADT concepts, but not the internal Java plugin code for the proprietary ADT core.

## Live SAP Evidence

### A4H 2025 / SAP_BASIS 816

Read-only probes against the new 2025 test system:

- `SAPManage probe` equivalent completed in about 1.6 s.
- Feature summary: on-prem, RAP available, text search unavailable; warnings for optional services such as abapGit/UI5 BSP/AMDP debug/text search.
- `SAPRead COMPONENTS` confirmed `SAP_BASIS 816`, `SAP_ABA 816`, `S4FND 109`.
- `SAPRead TABL T000` succeeded.
- `SAPRead CLAS CL_ABAP_CHAR_UTILITIES method=*` succeeded.

Infrastructure now documents that 2025 write+activate was tuned on 2026-06-05 and CRUD lifecycle reached 7/7. This PR should validate at least the default integration/E2E path against 2025 where practical, but the GitHub Actions migration from 2023 secrets to 2025 secrets should remain a separate follow-up after this runtime-profile PR is merged and measured.

### NPL 7.50

Read-only probes against NPL:

- `SAPRead COMPONENTS` confirmed `SAP_BASIS 750 SP02`.
- `SAPRead CLAS CL_ABAP_CHAR_UTILITIES method=*` succeeded.
- `SAPRead TABL T000` failed on `/sap/bc/adt/ddic/tables/T000/source/main` with HTTP 404.
- Feature probing reported some modern capability as available, but infra docs and targeted reads show NPL's HTTP ADT surface remains limited. Treat RAP-like feature flags on NPL cautiously and rely on targeted endpoint availability/skips.

NPL is useful for compatibility checks and skip behavior, but not for proving the fast PR path for modern RAP/DDIC write coverage.

## Affected ARC-1 Files

### Runtime Profile And Workflow Surface

| File | Current role | Finding |
|------|--------------|---------|
| `package.json` | Defines `test:integration`, `test:e2e`, and E2E lifecycle scripts. | No slow profile scripts exist yet. |
| `vitest.integration.config.ts` | Includes `tests/integration/**/*.test.ts`, sequential. | Needs to exclude `*.slow.integration.test.ts` from default and keep sequential execution. |
| `tests/e2e/vitest.e2e.config.ts` | Includes `tests/e2e/**/*.e2e.test.ts`, sequential, JSON/JUnit reporters. | Needs to exclude `*.slow.e2e.test.ts` from default and keep sequential execution. |
| `.github/workflows/test.yml` | Runs default integration then default E2E with repository-wide SAP concurrency. | Default workflow can remain on default profiles; manual slow profiles can be documented or added separately after measuring local behavior. |
| `scripts/ci/collect-test-reliability.mjs` | Aggregates `unit`, `integration`, `e2e` JSON plus skip telemetry. | No immediate change required unless workflow starts uploading slow JSON files in this PR. |

### Integration Hotspots

| File | Current role | Finding |
|------|--------------|---------|
| `tests/integration/cache.integration.test.ts` | Live cache source, dependency, warmup, usages, and persistence tests. | Warmup block repeatedly calls `runWarmup()` with broad package filters. It is the largest controllable integration runtime cost. Keep source/dependency/cache-stats/default warmup smoke; move repeated/full warmup behavior to slow profile. |
| `src/cache/warmup.ts` | TADIR scan and source/dependency indexing. | No implementation bug found. Runtime reduction should come from test selection and bounded package filters. |

### E2E Hotspots

| File | Current role | Finding |
|------|--------------|---------|
| `tests/e2e/navigate.e2e.test.ts` | Custom fixture navigation plus broad standard where-used coverage. | `BAPIRET2` is queried twice and `T000` once. These are broad SAP where-used scans and dominated E2E runtime. Keep one representative standard class and BUKRS DDIC smoke; move BAPIRET2/T000 variants to slow profile. |
| `tests/e2e/rap-write.e2e.test.ts` | Package, table entity, TABL update, DDLS+BDEF, DCLS, SRVD, SRVB publish, batch_create, MSAG. | Several tests create overlapping full dependency stacks. Keep package/TABL/MSAG and a narrow RAP write signal in default; move DDLS+BDEF, DCLS, SRVD, SRVB publish/unpublish, and batch_create variants to slow profile. |
| `tests/e2e/smoke.e2e.test.ts` | Broad MCP tool smoke including `SAPManage probe`. | Should use `SAPManage features` so the PR path reads cached startup probe results instead of forcing another live probe. |
| `tests/e2e/saptransport.e2e.test.ts` | Transport create/get/list/delete/reassign/release and transportable package writes. | Recursive release is already gated, but still appears as a default skipped slot and remains a high-cost path when enabled. Move it to slow profile. |
| `tests/e2e/helpers.ts` | MCP client, tool-call wrapper, skip/error classifiers. | Add a small read-only concurrency test using existing helpers; no helper changes required unless runtime logging needs reuse. |

### Coverage Targets

| File | Current role | Finding |
|------|--------------|---------|
| `src/server/http.ts` | HTTP transport, OAuth callback, standard API-key/OIDC verifier. | `extractOidcScopes` is covered. `createStandardVerifier` is private, but exporting it for unit tests would cover API-key verifier behavior without starting an HTTP server. |
| `src/server/server.ts` | Tool filtering, ADT config, per-user auth token application, server setup. | Per-user token application already has `tests/unit/server/per-user-auth-tokens.test.ts`; no urgent extra server test needed for this PR. |
| `src/adt/btp.ts` | VCAP parsing, Destination Service lookup, connectivity proxy, PP destination lookup, public app URL. | PP lookup and app URL are covered; startup helpers `parseVCAPServices`, `lookupDestination`, and `createConnectivityProxy` need focused tests. |
| `src/extract-sap-cookies.ts` | Browser-based cookie extraction utility. | Current test only covers PP refusal. Pure helpers `cookieMatchesHost` and `toNetscapeCookieFile` can be exported and tested without spawning a browser. |
| `src/server/xsuaa.ts` | XSUAA OAuth/chained token verifier. | Current tests already cover scope qualification, chained verifier fallback, API keys, XSUAA/OIDC paths, and expansion. No extra change required unless coverage report still shows a specific uncovered branch after this PR. |

## Design Decisions

1. Do not enable broad `fileParallelism` for integration or E2E. The test files share SAP users, locks, CTS state, server cache, and generated ABAP names.
2. Add explicit slow profiles before any future parallelism. This makes the PR path faster while preserving the heavier coverage on demand.
3. Keep slow profiles sequential too. The goal is test selection, not concurrent mutation.
4. Use `SAPManage features` in E2E tests that only need cached capability information. Keep live probe as startup/server behavior, not repeated test setup.
5. Add one small read-only concurrency smoke. It should run read-only calls only and log `ARC1_MAX_CONCURRENT`, `ARC1_AUTH_RATE_LIMIT`, and `ARC1_RATE_LIMIT` so future capacity experiments have context.
6. Keep GitHub default workflow on default profiles first. Add slow-profile scripts in this PR; consider workflow-dispatch slow jobs only after local 2025/2023 validation shows stable timings.
7. Do not include infrastructure secrets in docs, tests, workflow logs, or PR text.

## Planned Implementation Units

1. Runtime profile split:
   - Add `vitest.integration.slow.config.ts`.
   - Add `tests/e2e/vitest.e2e.slow.config.ts`.
   - Add `test:integration:slow` and `test:e2e:slow` scripts.
   - Exclude `*.slow.integration.test.ts` and `*.slow.e2e.test.ts` from default configs.

2. Move slow live coverage:
   - Extract/move integration warmup heavy tests to `tests/integration/cache-warmup.slow.integration.test.ts`.
   - Move broad where-used variants to `tests/e2e/navigate.slow.e2e.test.ts`.
   - Move RAP full-stack variants to `tests/e2e/rap-write.slow.e2e.test.ts`, using shared helper functions where needed.
   - Move recursive transport release to `tests/e2e/saptransport.slow.e2e.test.ts`.

3. Reduce repeated probing:
   - Change E2E RAP availability setup from `SAPManage probe` to `SAPManage features`.
   - Change smoke probe test to cached features.

4. Add read-only concurrency smoke:
   - New E2E test file with concurrent `SAPRead SYSTEM`, `SAPRead COMPONENTS`, and a stable class method-list read.
   - Assert all results succeed and log server capacity env values.

5. Add unit coverage:
   - Export and test cookie host/file-format helpers.
   - Export/test `createStandardVerifier` API-key behavior.
   - Add BTP startup helper tests for VCAP parsing, destination lookup, proxy creation, and token caching.

6. Update docs:
   - Update `CLAUDE.md` command list/test-level table.
   - Update `docs/research/test-suite-audit-2026-05-11.md` with implemented status and new findings.
   - Keep this research document as the implementation checkpoint.

## Validation Strategy

Local no-SAP:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:coverage`

Live SAP:

- A4H 2025: default `npm run test:integration` and focused/default `npm run test:e2e` through local MCP server, if credentials and server startup are healthy.
- A4H 2025 slow: targeted `npm run test:integration:slow` and `npm run test:e2e:slow` after default is green.
- NPL 7.50: read-only smoke where relevant; expect skips or endpoint gaps for modern RAP/DDIC write paths.

GitHub:

- PR default CI should run `test`, `integration`, `e2e`, and `reliability-summary` using the faster default profiles.
- If CI fails because of real assertions, fix. If CI exposes SAP transient/time-budget failures, adjust timeouts or profile membership only with evidence.

## Follow-Up Completed: GitHub A4H 2025 Migration

The 2025 system was prepared for GitHub Actions in PR [#365](https://github.com/marianfoo/arc-1/pull/365) on branch `codex/github-ci-a4h-2025`.

- `.github/workflows/test.yml` now uses `TEST_SAP_*` as the one live SAP target for both integration and E2E; E2E maps those values to the `SAP_*` runtime env expected by the local MCP server.
- Live SAP preflight now fails fast unless the required secrets are present and authenticated ADT core discovery returns HTTP 200. This prevents a green live SAP job caused by an auth skip.
- Local A4H 2025 preflight on 2026-06-06 returned HTTP 401 unauthenticated and HTTP 200 authenticated against `/sap/bc/adt/core/discovery?sap-client=001`.
- GitHub `TEST_SAP_*` secrets were rotated to A4H 2025 values on 2026-06-06. Secret values are external state and are not documented here.
- PR `#365`, Test workflow run `27058553382`, passed with `integration` in 3m50s and `e2e` in 6m26s.
- Downloaded GitHub artifacts from run `27058553382` reported unit `3,468 passed / 0 skipped`, integration `208 passed / 54 skipped`, and E2E `137 passed / 4 skipped`; required-execution thresholds passed.
- A later docs push exposed one more reliability issue in Test workflow run `27058886073`: E2E failed on four SAP ADT write-session routing errors, all HTTP 400 `Service cannot be reached` on `_action=LOCK` or `_action=UNLOCK` routes. The existing skip classifier only covered DDIC table unlocks, so this PR generalized that classifier and made default live mutation assertions use the skip-aware helper where appropriate.
- Test workflow run `27059320564` on commit `4c061709` showed the generalized classifier working (`18` ADT lock/unlock routing skips), and identified one remaining activation-regression custom precondition branch that needed to delegate to the shared classifier.
- Final Test workflow run `27059551872` on commit `a652aafd` passed: Node 22 unit `3,473 passed / 0 skipped`, Node 24 unit `3,473 passed / 0 skipped`, integration `208 passed / 54 skipped`, and E2E `119 passed / 22 skipped / 0 failed`. The E2E skip increase came from `18` ADT lock/unlock routing-instability skips during that live SAP write-session window.
- Post-fix local A4H 2025 validation passed: `npm run typecheck`, `npm run lint`, targeted helper unit test (`7` tests), full unit (`3,473` tests), and `npm run test:e2e:full` (`137 passed / 4 skipped`, fixture sync unchanged).

Runtime implication:

| Suite | PR #364 measured GitHub runtime | PR #365 measured GitHub runtime | Result |
|---|---:|---:|---|
| integration | 8m01s | 3m50s | The default integration profile now benefits from the tuned 2025 target and stricter preflight. |
| e2e | 8m55s | 6m26s | The default E2E profile remains sequential but is materially faster on the 2025 target. |

Remaining decision after the 2025 default profile is stable in GitHub: whether `test:integration:slow` and `test:e2e:slow` should become manual `workflow_dispatch` jobs or a scheduled/nightly workflow.

# Test Suite Audit

Date: 2026-05-11
Workspace: `/Users/marianzeis/.codex/worktrees/7d78/arc-1`
Baseline commit: `85112917` (`chore(main): release 0.9.5 (#266)`)
Target SAP system used: A4H/S4 test system via local infrastructure credentials.

## Executive Summary

The suite is much healthier than the earlier April reliability audit, but there are still material gaps:

- The main unit, integration, and E2E suites all pass against the live S4 system.
- Current totals: 2,881 unit tests, 236 integration tests, and 137 E2E tests.
- Unit skips are gone. E2E skip rate is low at 2.2%. Integration skip rate is 17.4%, but 33 of 41 integration skips are BTP tests in an S4-only run.
- There are still real pseudo-skip bugs in E2E tests: several tests print `[SKIP]` or return early while Vitest records them as passed.
- Cleanup is not good enough for a long-lived shared SAP system. The current run left at least one open E2E transport and one integration transport, and the live system already has many older `ZARC1*` leftovers.
- E2E fixture setup can recreate invalid CDS fixtures, log activation failures as warnings, and still report `skipped=0`. This is the highest-risk harness issue found.
- Runtime hotspots are concentrated and actionable: integration cache warmup, recursive transport release, E2E RAP write lifecycle, E2E where-used navigation, and E2E transport release.
- Coverage is operational but still weak around HTTP/auth/server/BTP paths. Overall branch coverage is 71.59%; `src/server/http.ts`, `src/server/server.ts`, `src/adt/btp.ts`, and `src/extract-sap-cookies.ts` should be next.
- A second-pass live cleanup reconciliation found current-run E2E transient object cleanup mostly worked: successful E2E creates were followed by successful deletes except the managed persistent fixtures. The unresolved cleanup problem is old residue plus transports plus inactive persistent fixtures.

## Evidence Log

### Repository State

- Current worktree was clean before this report file was added.
- Dependencies were installed with `npm ci`.
- Install warning: `lint-staged@17.0.4` requires Node `>=22.22.1`; local Node is `v22.21.1`.
- No committed `.env` was present in this worktree.
- Local S4 credentials were injected for live tests without writing secrets to the repo.

### Earlier Audit Baseline

Previous reliability work is documented in:

- `docs/research/test-reliability-audit-points-2-7.md`
- `docs/plans/completed/test-1-reliability-telemetry.md`
- `docs/plans/completed/test-2-skip-policy-pseudo-skips.md`
- `docs/plans/completed/test-3-coverage-ci-signal.md`
- `docs/plans/completed/test-4-trycatch-signal-quality.md`
- `docs/plans/completed/test-5-crud-lifecycle.md`
- `docs/plans/completed/test-6-btp-stability.md`
- `docs/plans/completed/test-7-docs-verification.md`
- `docs/plans/completed/test-reliability-audit-points-2-7-hardening.md`

The previous audit found skipped-test drift, pseudo-skips, missing coverage infrastructure, weak try/catch assertions, and missing CRUD/BTP coverage. Most of that was addressed, but some drift has returned.

## Test Runs

### Unit

Command: `npm test`

Result:

- Files: 83 passed.
- Tests: 2,881 passed, 0 skipped, 0 failed.
- Duration: 9.37s.
- JSON: `test-results/unit.json`.

Largest unit runtimes:

| File | Tests | Runtime | Notes |
|---|---:|---:|---|
| `tests/unit/adt/http.test.ts` | 113 | 11.1s | Dominates unit runtime; likely intentional timeout/retry coverage but worth checking for fake timers. |
| `tests/unit/handlers/intent.test.ts` | 561 | 3.7s | Large but valuable router coverage. |
| `tests/unit/lint/lint-e2e.test.ts` | 24 | 0.6s | Acceptable. |

### Integration

Command: `npm run test:integration` with A4H/S4 credentials.

Result:

- Files: 11 passed, 2 skipped.
- Tests: 195 passed, 41 skipped, 0 failed.
- Duration: 320.07s.
- JSON: `test-results/integration.json`.

By file:

| File | Passed | Skipped | Runtime | Review |
|---|---:|---:|---:|---|
| `tests/integration/cache.integration.test.ts` | 20 | 0 | 122.7s | Main integration hotspot; repeated live warmups. |
| `tests/integration/adt.integration.test.ts` | 99 | 2 | 77.6s | Broad live ADT coverage; two legitimate backend/fixture skips. |
| `tests/integration/transport.integration.test.ts` | 8 | 4 | 54.5s | Runtime dominated by recursive release; also leaves transports. |
| `tests/integration/crud.lifecycle.integration.test.ts` | 5 | 0 | 20.9s | Good CRUD lifecycle signal. |
| `tests/integration/context.integration.test.ts` | 19 | 0 | 13.4s | Good coverage for context/probe features. |
| `tests/integration/fugr-func-params.integration.test.ts` | 2 | 0 | 6.0s | Passes, but internal skip calls lack reasons. |
| `tests/integration/fugr-func.integration.test.ts` | 3 | 0 | 5.9s | Passes, but internal skip calls lack reasons. |
| `tests/integration/abapgit.integration.test.ts` | 5 | 2 | 1.7s | Two hard-coded `it.skip()` tests remain. |
| `tests/integration/audit-logging.integration.test.ts` | 7 | 0 | 1.0s | Good. |
| `tests/integration/gcts.integration.test.ts` | 6 | 0 | 1.0s | Good. |
| `tests/integration/elicitation.integration.test.ts` | 21 | 0 | 0.0s | Unit-like integration coverage; good. |
| `tests/integration/btp-abap.integration.test.ts` | 0 | 28 | 0.0s | Expected skipped in S4-only run. |
| `tests/integration/btp-abap.smoke.integration.test.ts` | 0 | 5 | 0.0s | Expected skipped in S4-only run. |

Skip interpretation:

- 33/41 skips are BTP-only tests because BTP service key configuration was not provided for this S4 run.
- 8/203 non-BTP integration tests skipped (3.9%).
- `tests/integration/abapgit.integration.test.ts:95` and `:100` are permanent hard skips for stage/pull.
- Four transport tests skipped because optional `TEST_TRANSPORT_PACKAGE` / `TEST_TRANSPORT_OBJECT_NAME` inputs were not configured.
- Two ADT skips were backend/fixture dependent.

Follow-up targeted transport-package run:

- Command: `npx vitest run --config vitest.integration.config.ts tests/integration/transport.integration.test.ts` with `TEST_TRANSPORT_PACKAGE=Z_LLM_TEST_PACKAGE`.
- Result: 11 passed, 1 skipped, 0 failed, 63.26s.
- This closed the package-gated auto-corrNr behavior: both `update succeeds without explicit transport` and `explicit transport overrides lock corrNr` passed.
- Remaining skip: reverse lookup for a transportable class object because no `TEST_TRANSPORT_OBJECT_NAME` class fixture was configured; the package currently contains PROG entries, while the test hard-codes a class URL.
- Important: this focused run overwrote `test-results/integration.json`; the full-suite integration counts above are from the earlier full run output.

### E2E

Command: `npm run test:e2e:full` with A4H/S4 credentials.

Result:

- Files: 16 passed.
- Tests: 134 passed, 3 skipped, 0 failed.
- Duration: 424.95s.
- JSON: `test-results/e2e.json`.
- JUnit: `/tmp/arc1-e2e-logs/junit-results.xml`.

By file:

| File | Passed | Skipped | Runtime | Review |
|---|---:|---:|---:|---|
| `tests/e2e/rap-write.e2e.test.ts` | 9 | 0 | 127.7s | Slowest E2E file; broad write/activate/delete lifecycle. |
| `tests/e2e/navigate.e2e.test.ts` | 11 | 2 | 80.8s | Expensive where-used queries; two live backend skips. |
| `tests/e2e/saptransport.e2e.test.ts` | 13 | 1 | 54.6s | Creates/deletes/releases transports; first created transport is not cleaned up. |
| `tests/e2e/ddic-write.e2e.test.ts` | 6 | 0 | 29.8s | Cleanup looked good for current run. |
| `tests/e2e/diagnostics.e2e.test.ts` | 13 | 0 | 29.4s | Contains a weak "fresh dump" test that can pass via old dumps. |
| `tests/e2e/func-write.e2e.test.ts` | 4 | 0 | 17.3s | Current-run cleanup looked good. |
| `tests/e2e/smoke.e2e.test.ts` | 28 | 0 | 13.4s | Good broad smoke coverage. |
| `tests/e2e/sktd-write.e2e.test.ts` | 4 | 0 | 12.8s | Current run passed, but has pseudo-skips if SKTD unsupported. |
| `tests/e2e/rap.e2e.test.ts` | 10 | 0 | 12.2s | Good read/write smoke for RAP features. |
| `tests/e2e/func-params.e2e.test.ts` | 2 | 0 | 11.3s | Current-run cleanup looked good. |
| `tests/e2e/cds-context.e2e.test.ts` | 6 | 0 | 8.4s | Good CDS read/context coverage. |
| `tests/e2e/cache.e2e.test.ts` | 9 | 0 | 6.0s | Good E2E cache behavior. |
| `tests/e2e/activation-failure.e2e.test.ts` | 1 | 0 | 6.0s | Valuable regression, but has false-pass skip branches. |
| `tests/e2e/cds-impact.e2e.test.ts` | 4 | 0 | 3.8s | Passed despite inactive local fixtures; setup validity should be enforced. |
| `tests/e2e/sap-git.e2e.test.ts` | 8 | 0 | 1.8s | Good read/safety coverage. |
| `tests/e2e/revisions.e2e.test.ts` | 6 | 0 | 1.8s | Good revision read coverage. |

Actual E2E skips:

- `tests/e2e/navigate.e2e.test.ts`: reference lookup for `ZCL_ARC1_TEST`.
- `tests/e2e/navigate.e2e.test.ts`: definition lookup of interface reference in class source.
- `tests/e2e/saptransport.e2e.test.ts`: transportable package auto-corrNr test, because `TEST_TRANSPORT_PACKAGE` was not set.

### Coverage

Command: `npm run test:coverage`

Result:

- Files/tests: 83 files, 2,881 tests passed.
- Duration: 12.25s.
- Lines: 82.15% (8,040/9,786).
- Statements: 81.01% (8,733/10,779).
- Functions: 87.04% (1,250/1,436).
- Branches: 71.59% (6,591/9,206).
- Report: `coverage/coverage-summary.json`, `coverage/lcov.info`.

Lowest source-file coverage:

| File | Statements | Branches | Uncovered statements | Recommendation |
|---|---:|---:|---:|---|
| `src/extract-sap-cookies.ts` | 2.95% | 3.27% | 164 | Add CLI arg/env parsing tests and browser-cookie extraction fixtures. |
| `src/server/http.ts` | 19.35% | 18.79% | 150 | Add supertest coverage for API key/OIDC/XSUAA/error/auth-pruning paths. |
| `src/server/server.ts` | 33.71% | 34.55% | 232 | Test tool registration, hyperfocused mode, PP client creation, cache warmup branches. |
| `src/adt/btp.ts` | 38.79% | 34.16% | 71 | Mock Destination/Connectivity responses and failure modes. |
| `src/server/xsuaa.ts` | 48.73% | 40.00% | 61 | More JWT/scope/audience/key edge cases. |
| `src/probe/fixtures.ts` | 60.00% | 50.00% | 14 | Add missing fixture resolution/negative tests. |
| `src/server/sinks/file.ts` | 62.50% | 37.50% | 9 | Add fs error, rotation/path, invalid config tests. |
| `src/server/sinks/btp-auditlog.ts` | 71.25% | 57.14% | 23 | Add token/client/audit-log failure branches. |
| `src/adt/oauth.ts` | 74.64% | 75.00% | 36 | Add callback/browser/token-cache edge coverage. |
| `src/context/contract.ts` | 78.18% | 56.60% | 24 | Add branch-heavy parser cases. |

Uncovered-function examples from `coverage/lcov.info`:

| File | Notable uncovered functions/areas |
|---|---|
| `src/server/http.ts` | `matchApiKey`, `createMcpHandler`, `startHttpServer`, OIDC verifier construction, JWKS init. |
| `src/server/server.ts` | per-user client creation, startup probe, caching layer creation, `createAndStartServer`. |
| `src/adt/btp.ts` | VCAP parsing, client-credentials token fetch, destination lookup, connectivity proxy, destination resolution. |
| `src/server/xsuaa.ts` | JWT verification branches and scope extraction edge paths. |
| `src/extract-sap-cookies.ts` | almost all CLI/browser/CDP helpers except the one covered path. |
| `src/context/contract.ts` | parser edge lines only; no wholly uncovered functions. |

Validation commands also run:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test:assert-execution`: passed for unit/integration/e2e thresholds.

## Findings

### P0 - Fixture Sync Can Report Success After Activation Failure

`tests/e2e/setup.ts:186-191` treats any `SAPActivate` error as an activation warning and returns success. During this run, fixture sync recreated `ZI_ARC1_I33_ROOT` and `ZI_ARC1_I33_PROJ`, both failed activation, and the summary still reported `skipped=0`.

Concrete evidence:

- `tests/fixtures/abap/zi_arc1_i33_root.ddls.abap:2` contains `@AbapCatalog.compiler.compareFilter: true`, which this S/4 system rejects for view entities.
- `ZI_ARC1_I33_ROOT` failed activation with "Annotation `AbapCatalog.compiler.compareFilter` is not allowed in view entities".
- `ZI_ARC1_I33_PROJ` then failed because `ZI_ARC1_I33_ROOT` was not active.
- A live inactive-object check after the run found both `ZI_ARC1_I33_ROOT` and `ZI_ARC1_I33_PROJ` inactive.

Impact:

- E2E can go green while persistent fixtures are inactive.
- Subsequent runs can repeatedly delete/recreate invalid fixtures.
- Tests depending on those fixtures are not necessarily validating active runtime behavior.

Recommended fix:

- Fix the DDLS fixture source first.
- Make `activateObject()` throw unless the error is classified as a known backend gap.
- Add a post-sync assertion that all non-skipped persistent fixtures are active/readable.

### P0 - Transport Tests Leave Live SAP Transports

The current run created real transport requests that remain in draft state:

- E2E created `A4HK905131` from `tests/e2e/saptransport.e2e.test.ts:40-59`; no cleanup path deletes or releases that request.
- Integration created `A4HK905123` from `tests/integration/transport.integration.test.ts:135-142`; `afterAll()` only logs that cleanup is manual at `:125-131`.
- Follow-up package-enabled integration created additional draft transports. Empty transports `A4HK905149` and `A4HK905151` were manually deleted after the research run, but `A4HK905159` and `A4HK905161` remain because their tasks contain locked objects.

Live SAP check after the run found 17 open/draft ARC-1 transport requests listed for the user, including current-run and older runs.

After the package-enabled follow-up and best-effort cleanup, the list contains 19 ARC-1 transport requests. The two new remaining requests are:

- `A4HK905159` (`ARC-1 IT corrNr ...`) with task `A4HK905160` containing locked `PROG ZARC1_TR_6N7NC0`.
- `A4HK905161` (`ARC-1 IT explicit ...`) with task `A4HK905162` containing locked `PROG ZARC1_TR_6N9SK1`.

Those two program names exist in TADIR under `Z_LLM_TEST_PACKAGE`, but `SAPSearch` returns no object and `SAPRead(PROG)` returns 404. This is the exact "ghost row + locked transport task" failure mode the cleanup harness needs to prevent.

Impact:

- The test system accumulates transport requests indefinitely.
- `listTransports` tests become less deterministic as old test data grows.
- Parallel CI or repeated local runs can pollute each other's assumptions.
- Failed cleanup can leave transport tasks undeletable through ARC-1 because the object is locked in CTS but not addressable through the normal ADT program endpoint.

Recommended fix:

- Track created transport IDs in each suite and delete or release them in `finally` / `afterAll`.
- If a transport intentionally must remain, move that test behind an explicit opt-in env var such as `TEST_ALLOW_TRANSPORT_LEAKS=true`.
- Add a post-run transport residue check that fails when new draft `ARC-1 E2E` / `ARC-1 IT` requests remain.
- For transportable-package write tests, cleanup must delete the generated object while it is still addressable and with the correct transport. If cleanup fails, the test should fail instead of logging only.

### P1 - Real Pseudo-Skips Still Exist

These branches can make tests pass without executing assertions:

- `tests/e2e/sktd-write.e2e.test.ts:57-58`, `:75-76`, `:86-87`, `:97-98`: `if (!sktdSupported) return;`.
- `tests/e2e/activation-failure.e2e.test.ts:69-71` and `:88-90`: logs `[SKIP]` and returns, but the test is recorded as passed.
- `tests/e2e/helpers.ts:205-210`: exported `skipIf()` is unused and its comment says Vitest cannot skip inside a test, which is now outdated.

Recommended fix:

- Add `ctx` to the affected test callbacks and call `ctx.skip('reason')`.
- Delete `skipIf()` or rewrite it to require a Vitest context.
- Add a static test that rejects `[SKIP]` logs paired with bare `return` in test files.

### P1 - Skip Reason Telemetry Is Misleading

`scripts/ci/collect-test-reliability.mjs:44-47` uses `test.title` as the skip reason. Vitest JSON does not include the actual `ctx.skip()` message, and the JUnit report also emitted blank skip messages in this run.

Impact:

- The reliability summary says "Top Skip Reasons", but it is actually a "Top Skipped Test Titles" table.
- Operators cannot tell whether a skip was caused by missing credentials, backend release gaps, or a real regression.

Recommended fix:

- Rename the table to "Skipped Tests" unless actual reasons are captured.
- Better: introduce a small `skipWithReason(ctx, reason)` helper that logs structured skip events to a JSONL artifact, then merge that artifact into the reliability report.

### P1 - Some Tests Are Weak Or Outdated

Examples:

- `tests/e2e/diagnostics.e2e.test.ts:143-184` says "triggers a fresh dump", but the test does not execute the program. It can pass by reading any existing dump if no new dump exists.
- `tests/e2e/diagnostics.e2e.test.ts:148` uses persistent `ZARC1_E2E_DUMP`, but it is not declared in `PERSISTENT_OBJECTS`; a live search confirmed it exists after the run.
- `tests/integration/abapgit.integration.test.ts:95` and `:100` are permanent `it.skip()` tests with no opt-in path, issue link, or expiry.
- `tests/integration/fugr-func.integration.test.ts` and `tests/integration/fugr-func-params.integration.test.ts` call `ctx.skip()` without reason in several branches, weakening telemetry.

Recommended fix:

- Rename or rewrite the diagnostics dump test. Either truly execute the program via a supported mechanism, or split it into "prepare dump fixture" and "read existing dump detail".
- Add `ZARC1_E2E_DUMP` to persistent fixture management or delete it after the diagnostic test.
- Convert abapGit hard skips into opt-in tests gated by `TEST_ABAPGIT_REMOTE_TESTS=true` plus a STRUST/preflight check.
- Always provide a reason to `ctx.skip()`.

### P1 - E2E Local Scripts Are Not Portable On macOS

During local E2E startup:

- `scripts/e2e-start-local.sh:37-38` used Linux-style `fuser -k "${MCP_PORT}/tcp"`, which errored on macOS.
- `scripts/e2e-start-local.sh:83-84` used `grep -P`, which BSD grep does not support; health metadata printed as `unknown`.
- `scripts/e2e-stop-local.sh:44-48` searched for JSON `"level":"error"` entries, but the server log format is `[timestamp] ERROR: ...`. It reported no errors while the log contained 33 `ERROR:` lines, many from expected negative tests and fixture failures.

Recommended fix:

- Replace `grep -P` health parsing with `node -e` JSON parsing.
- Use `lsof -ti tcp:${MCP_PORT} | xargs kill` on macOS, or branch by platform.
- Update error-summary grep to match the actual logger format and optionally suppress known negative-test request IDs.

### P2 - CI Gating And Concurrency Drift

`.github/workflows/test.yml` has comments that no longer match behavior:

- `on:` only includes `pull_request` and `workflow_dispatch`; no `push` trigger exists.
- The E2E comment says "Run on push (main) and internal PRs", but push is not configured.
- Top-level concurrency group is `sap-tests-${{ github.ref }}`. Different PR refs can still run SAP-heavy jobs concurrently, despite the comment saying only one SAP-hitting workflow at a time.
- `docs:` and `chore:` PRs skip the `test` job entirely. That saves SAP time, but also skips unit/lint/typecheck for dependency and test-infra chore PRs.

Recommended fix:

- Move SAP serialization to job-level concurrency for integration/E2E with a repository-global key.
- Keep unit/lint/typecheck running on docs/chore PRs, or make the skip rule path-based rather than title-based.
- Align comments with actual triggers or re-add `push` if intended.

## Finding Deep Dives And Remediation Design

This section expands each finding into root cause, failure mode, and concrete fix criteria. It is intentionally prescriptive so follow-up implementation can be split into small PRs without redoing the research.

### 1. Fixture Sync Activation Contract

Current behavior:

- `tests/e2e/setup.ts` treats `SAPActivate` `isError=true` as a warning in `activateObject()`.
- `syncPersistentFixtures()` records the object as created/recreated after `activateObject()` returns, even when activation failed.
- `tests/e2e/sync-fixtures.ts` prints `created/recreated/unchanged/deleted`, but not `skipped`, so fixture health is easy to miss in CLI output.

Root cause:

- The fixture harness conflates "activation returned warnings" with "activation failed". The MCP result shape has only `isError`, so a backend-specific warning needs classification before it is safe to ignore.
- The invalid fixture source makes this visible: `tests/fixtures/abap/zi_arc1_i33_root.ddls.abap` uses classic CDS annotations on a view entity. On this S/4 system, `@AbapCatalog.compiler.compareFilter` is rejected for view entities. The dependent projection then fails because the root is inactive.

Why this can still produce green E2E:

- Some tests read source or parse dependency text and do not require active runtime objects.
- `cds-impact` can still validate local source relationships while the live object is inactive.
- The server log contains activation errors, but `scripts/e2e-stop-local.sh` currently misses them because it searches for JSON log fields that are not present in text logs.

Fix design:

- Fix the fixture first: remove `@AbapCatalog.sqlViewName` and `@AbapCatalog.compiler.compareFilter` from the view-entity fixture unless a release-specific reason requires them. Keep only annotations valid for view entities on the supported S/4 target.
- Change `activateObject()` to throw on `activateResult.isError` unless the text matches a known activation warning category that is explicitly allowed.
- After sync, verify persistent fixtures through an active-state check. Acceptable options are `SAPRead(INACTIVE_OBJECTS)` absence, a successful `SAPActivate` result, or a targeted ADT active-source/read check per object type.
- Make `tests/e2e/sync-fixtures.ts` print `skipped` count and skipped labels/reasons. It should exit non-zero for unclassified activation failures.
- Add unit tests around fixture sync using a mocked `callTool()` path: activation error must not count as `created` or `recreated`; classified backend gaps must count as `skipped`.

Acceptance criteria:

- A fixture activation failure fails `npm run test:e2e:fixtures` unless it is classified.
- `npm run test:e2e:full` cannot start the test phase with inactive managed fixtures.
- The reportable fixture summary includes created, recreated, unchanged, deleted, and skipped.

### 2. CTS Transport And Transportable Package Cleanup

Current behavior:

- `tests/e2e/saptransport.e2e.test.ts` creates a transport in the create/get group, stores `createdTransportId`, and never deletes or releases that request.
- `tests/integration/transport.integration.test.ts` tracks `createdTransportIds` but `afterAll()` only logs a manual cleanup message.
- The package-enabled follow-up run proved a worse failure mode: generated transported programs can become TADIR rows attached to locked transport tasks while normal ADT read/search endpoints no longer resolve the object.

Root cause:

- Transport requests are treated as durable test evidence rather than test-owned resources.
- Object cleanup and transport cleanup are separate concerns in the tests, but in SAP CTS they are coupled. A generated object must be deleted with the correct transport while it is still addressable; only then can the task/request be deleted or released cleanly.
- The reverse-lookup integration branch assumes a class-style object URL, while the configured package currently exposes generated `PROG` entries. That makes the optional branch partly mismatched to the live package shape.

Why this matters:

- Draft transports accumulate across runs and make `listTransports` less deterministic.
- Parallel or repeated CI runs can see each other's old test transports.
- Once a task contains a locked ghost object, ARC-1 may not be able to clean it up through normal ADT endpoints. Manual SAP cleanup may be required.

Fix design:

- Introduce a transport cleanup registry that records request id, task id when available, created object type/name, package, and transport used for deletion.
- For each test-created transport, prefer this lifecycle: create request, create/update object, assert behavior, delete object with the same transport, verify no object residue, delete empty transport request.
- For tests that intentionally validate release behavior, release the transport or move them behind an explicit opt-in such as `TEST_TRANSPORT_RELEASE_TESTS=true`.
- Make `afterAll()` fail the suite when current-run transport cleanup fails. Logging only is not enough for a shared SAP system.
- Add a post-run CTS residue assertion for descriptions beginning `ARC-1 E2E` and `ARC-1 IT`, scoped to the current run timestamp or unique run id.
- Fix or parameterize the reverse-lookup object URL so `TEST_TRANSPORT_OBJECT_TYPE=PROG|CLAS|...` controls the object endpoint used by the test.

Acceptance criteria:

- A clean run leaves zero new draft `ARC-1 E2E` or `ARC-1 IT` transports.
- Package-enabled transport tests either delete their generated object and transport or fail with a clear cleanup error.
- The current stuck objects are documented for manual cleanup: `A4HK905159` / `ZARC1_TR_6N7NC0` and `A4HK905161` / `ZARC1_TR_6N9SK1`.

### 3. Pseudo-Skip Discipline

Current behavior:

- Some tests return early after a feature probe without calling `ctx.skip()`.
- Some tests print `[SKIP]` and return. Vitest records these as passed tests, not skipped tests.
- `tests/e2e/helpers.ts` still contains `skipIf()` with an outdated comment saying Vitest cannot skip inside a test.

Root cause:

- The skip policy was improved previously, but old patterns were not completely removed and there is no static guard preventing them from returning.

Why this matters:

- False passes are worse than honest skips. They inflate pass counts and hide unsupported backend behavior.
- Reliability telemetry cannot catch these because the test runner never sees a skip.

Fix design:

- Replace boolean early returns with helpers that require the Vitest context, for example `requireFeature(ctx, sktdSupported, 'SKTD not supported on this backend')`.
- Convert the activation-failure tests to `async (ctx) => { ... return ctx.skip(reason); }`.
- Delete `skipIf()` or rewrite it so it accepts `ctx` and delegates to `ctx.skip(reason)`.
- Add a static unit test or CI script that rejects `[SKIP]` log strings and bare `return;` in E2E/integration test bodies unless allowlisted with a reason.

Acceptance criteria:

- No E2E/integration test can silently pass because an unsupported feature branch returned early.
- All skip paths include an actionable reason visible in the Vitest output or the supplemental skip artifact.

### 4. Skip Telemetry Semantics

Current behavior:

- `scripts/ci/collect-test-reliability.mjs` labels skipped test titles as "Top Skip Reasons".
- Vitest JSON and the observed JUnit output do not preserve `ctx.skip()` reason messages in a way this script can currently consume.
- `scripts/ci/summarize-skips.mjs` can categorize verbose reporter output, but the main CI reliability report uses JSON artifacts instead.

Root cause:

- The reporting script assumes `assertionResults` contain reason text. In the observed artifacts, the only stable value is the test title.

Why this matters:

- Operators cannot distinguish expected S/4/BTP release gaps from fixture failures or policy problems.
- A growing skip count can look acceptable if the table labels are misleading.

Fix design:

- Short-term: rename the table to "Top Skipped Tests" unless real reasons are available.
- Better: add a structured skip artifact. A helper such as `recordSkip(ctx, reason, metadata)` can append JSONL records from `requireOrSkip()`, `expectToolSuccessOrSkip()`, and direct skip helpers.
- Make direct `ctx.skip()` rare or wrap it in a helper so reasons are consistently recorded.
- Merge the JSONL skip records into `collect-test-reliability.mjs`; fall back to titles only when no structured reason exists.
- Keep `summarize-skips.mjs` for ad hoc verbose runs, but do not treat it as the source of truth for CI unless the workflow uploads the raw verbose logs.

Acceptance criteria:

- The reliability summary distinguishes `NO_CREDENTIALS`, `NO_TRANSPORT_PACKAGE`, backend unsupported, fixture missing, and unclassified skip reasons.
- Any unclassified skip reason appears as a warning in the summary.

### 5. Weak Or Outdated Tests

Diagnostics dump test:

- The test name says it "triggers a fresh dump", but ARC-1 does not execute the created program. The test creates/updates/activates `ZARC1_E2E_DUMP`, then reads whatever matching or available dump already exists.
- If a stale `COMPUTE_INT_ZERODIVIDE` exists, the test can pass without proving the newly prepared program caused it.
- `ZARC1_E2E_DUMP` is persistent in practice but not managed by `PERSISTENT_OBJECTS`.

Recommended correction:

- Either add a real execution mechanism and assert the dump timestamp/program matches this run, or rename/split the test into "prepares dump fixture" and "reads available dump details".
- Add `ZARC1_E2E_DUMP` to managed persistent fixtures if it should stay, or create it with a unique name and delete it in `finally`.
- If no execution mechanism exists, the test should skip when no suitable dump is already present instead of implying fresh dump coverage.

abapGit hard skips:

- `tests/integration/abapgit.integration.test.ts` permanently skips stage and pull flows.
- These are high-risk integration paths because they cross SAP SSL, remote Git connectivity, and repository state.

Recommended correction:

- Convert them to opt-in tests gated by `TEST_ABAPGIT_REMOTE_TESTS=true`, a remote URL/repo fixture, and a timeout.
- Add a preflight that distinguishes missing STRUST/SSL/network configuration from product failures.
- If no maintained fixture can be provided, remove the permanent tests and track the gap in docs rather than reporting a hard skip forever.

FUGR/FUNC skip reasons:

- The FUGR integration tests use `ctx.skip()` in backend-gap branches without useful reason text.
- This should be a small cleanup: pass the classified backend error or a specific release-gap reason into each skip.

Acceptance criteria:

- Test names describe exactly what is asserted.
- Long-lived fixtures are either in fixture management or explicitly cleaned.
- No permanent `it.skip()` remains without an owner, opt-in path, and reason.

### 6. E2E Script Portability And Log Signal

Current behavior:

- `scripts/e2e-start-local.sh` uses Linux `fuser -k "${MCP_PORT}/tcp"` when `fuser` exists. On macOS this form errors.
- The same script uses `grep -P`, which BSD grep does not support.
- `scripts/e2e-stop-local.sh` searches for JSON `"level":"error"` entries, while the local server log is text formatted as `[timestamp] ERROR: ...`.

Root cause:

- The scripts were written for Linux CI but are also used locally on macOS.
- Log parsing was coupled to a JSON format that is not the active format for this run.

Why this matters:

- Startup can appear partially broken locally even when the server starts.
- Stop summaries can say no errors were found while fixture activation and expected negative-test errors are present in the log.

Fix design:

- Replace `grep -P` health parsing with `node -e` JSON parsing, which is portable because Node is already required.
- Implement a platform-aware port cleanup function: use `lsof -tiTCP:${MCP_PORT} -sTCP:LISTEN | xargs kill` on macOS and `fuser` on Linux.
- Update error summarization to detect both JSON and text logger formats.
- Categorize expected negative-test errors separately from unexpected setup/runtime errors. Fixture activation errors should be prominent, not buried among expected 4xx tests.

Acceptance criteria:

- `npm run test:e2e:full` startup prints version/start time on macOS and Linux.
- Stop summary reports text-format `ERROR:` lines and highlights fixture setup failures.

### 7. CI Gating And SAP Serialization

Current behavior:

- The workflow comments say push/main behavior exists, but `on:` currently includes only `pull_request` and `workflow_dispatch`.
- Top-level concurrency uses `sap-tests-${{ github.ref }}`, which serializes reruns on the same ref but does not serialize different PR refs.
- `docs:` and `chore:` PR titles skip the whole `test` job, not only SAP-heavy jobs.

Root cause:

- The workflow evolved from "skip SAP-heavy work" into "skip all tests" for some PR titles.
- Concurrency was placed at workflow level using a ref-specific key, which does not match the stated "only one SAP-hitting workflow" goal.

Fix design:

- Keep unit/lint/typecheck/npx smoke on every PR. These are cheap and do not require SAP.
- Put repository-global concurrency only on SAP jobs: `integration` and `e2e`. Use a key such as `${{ github.repository }}-sap-live-a4h`.
- Prefer `cancel-in-progress: false` for SAP live jobs. Canceling a run while it holds locks or owns cleanup can create exactly the residue this audit found.
- Decide whether `push` to `main` should run tests. Either re-add it or update comments.
- Replace title-based skip with path-based or label-based SAP gating if the goal is saving live system capacity.

Acceptance criteria:

- Chore/test-infra PRs still run unit/lint/typecheck.
- At most one SAP live integration/E2E job uses the shared S4 system at a time across PRs.
- Workflow comments match actual triggers and scheduling behavior.

### 8. Runtime, Parallelization, And Server Capacity

Current configuration:

- `vitest.integration.config.ts` sets `fileParallelism: false` and `sequence.concurrent: false`.
- `tests/e2e/vitest.e2e.config.ts` also serializes files and tests because all E2E tests share one MCP server.
- ARC-1 itself has a request-level concurrency limit: `ARC1_MAX_CONCURRENT` / `--max-concurrent`, default `10`, passed into `AdtClient` and enforced by `src/adt/semaphore.ts` around SAP HTTP requests.

Important distinction:

- Increasing `ARC1_MAX_CONCURRENT` lets one server issue more simultaneous SAP HTTP requests.
- Enabling Vitest file parallelism makes independent test files run at the same time, with overlapping object creation, locks, CSRF/session use, cleanup, and CTS mutations.
- These are not interchangeable. The server may handle more request concurrency while the SAP test data model still cannot tolerate parallel writes.

Safe parallelization model:

- Read-only shards are the first candidates: smoke reads, cache reads, CDS context/impact reads, revisions, SAPGit read/safety, and selected diagnostics reads.
- Write-heavy shards should remain sequential until each file owns unique names, transports, and cleanup verification.
- Transport tests should remain isolated. They mutate global CTS state and include the slowest individual tests.
- Each parallel E2E shard should run its own MCP server on a separate port and its own cache file/memory cache. Sharing one server mostly queues requests and makes failures cascade.

Server-capacity guidance:

- For local experiments, start with `ARC1_MAX_CONCURRENT=10` because that is the default already tested.
- Try `ARC1_MAX_CONCURRENT=15` or `20` only for read-only shards, while watching SAP "Service cannot be reached", 5xx, timeout, and enqueue errors.
- Do not raise server concurrency for write/transport suites until cleanup gates are in place. More concurrency can amplify leaked locks and partial creates.
- Add a dedicated server load smoke before broad parallelism: for example, run 20 concurrent `SAPRead SYSTEM` or safe `SAPSearch` calls through one HTTP server and assert no transport/session breakage.

Runtime reduction plan:

- Split profiles before enabling parallelism: `integration:core`, `integration:slow`, `e2e:read`, `e2e:write`, `e2e:transport`.
- Move repeated live cache warmup behavior into unit tests where possible; keep one live warmup smoke.
- Keep recursive release tests manual/nightly unless CTS code changed.
- Only after cleanup gates are green, run read-only profiles in parallel servers and measure whether wall time improves without backend instability.

Acceptance criteria:

- Read-only parallel shards produce the same pass/skip counts as serial runs.
- No new current-run `ZARC1*` residue or draft transports appear after a parallel experiment.
- Server logs show no increase in timeout, reset, 5xx, or enqueue categories.

### 9. Coverage Improvement Priorities

Current risk profile:

- Overall coverage is acceptable for general logic, but weakest where production risk is highest: HTTP auth, server startup modes, BTP destination/connectivity, XSUAA, cookie extraction, and audit sinks.
- These areas are hard to validate through live tests alone because failures depend on auth headers, token shape, proxy settings, and startup configuration.

Highest-value unit coverage additions:

- `src/server/http.ts`: API key profile matching, missing/invalid auth branches, OIDC verifier creation, XSUAA fallback behavior, MCP handler error mapping, health/CORS/security header combinations.
- `src/server/server.ts`: standard vs hyperfocused tool registration, cache mode selection, startup probe success/failure/timeout, per-user client creation with principal propagation, safety config propagation.
- `src/adt/btp.ts`: VCAP parsing, service-key parsing, destination lookup success/failure, connectivity proxy construction, token fetch failure, missing destination properties.
- `src/server/xsuaa.ts`: JWKS/key failures, audience/scope extraction variants, local scope mapping, admin/write/read implication paths.
- `src/extract-sap-cookies.ts`: CLI argument parsing, browser executable detection, CDP cookie conversion, Netscape output formatting, timeout/error paths. These can use fixtures and mocks; they do not need a live browser.
- `src/server/sinks/file.ts` and `src/server/sinks/btp-auditlog.ts`: file write failures, invalid config, token failure, audit API failure, redaction preservation.

Coverage strategy:

- Do not chase percentage alone. Target branches that encode security, auth, and deployment behavior.
- Prefer focused unit tests with mocked fetch/fs/time over new live tests for auth/proxy branches.
- Add a small number of integration smoke tests only where wire compatibility matters and credentials are available.

Acceptance criteria:

- Branch coverage improves first in `server/http`, `server/server`, `adt/btp`, and `server/xsuaa`.
- New tests assert negative paths, not just happy-path construction.
- Coverage report labels remain informational unless the project decides to add minimum thresholds later.

## Second-Pass Deep Dive Evidence

### Slowest Individual Tests

The slowest tests are concentrated enough that targeted profile splits should reduce wall time without weakening coverage.

Integration slowest:

| Runtime | Test |
|---:|---|
| 48.3s | `tests/integration/transport.integration.test.ts` > `releaseTransportRecursive` > `recursively releases a transport` |
| 42.4s | `tests/integration/cache.integration.test.ts` > `warmup` > `second warmup run skips unchanged objects` |
| 23.8s | `tests/integration/cache.integration.test.ts` > `warmup` > `TADIR query returns custom CLAS/INTF objects` |
| 22.3s | `tests/integration/cache.integration.test.ts` > `warmup` > `warmup indexes objects into cache` |
| 21.6s | `tests/integration/cache.integration.test.ts` > `warmup` > `warmup sets isWarmupAvailable flag` |
| 10.2s | `tests/integration/adt.integration.test.ts` > `SAPWrite batch_create activateAtEnd` > `activateAtEnd=true activates a composition-linked DDLS pair` |
| 9.3s | `tests/integration/adt.integration.test.ts` > `edit_method against class includes` > `round-trips a local handler method body` |

E2E slowest:

| Runtime | Test |
|---:|---|
| 47.1s | `tests/e2e/saptransport.e2e.test.ts` > `release_recursive releases transport` |
| 34.9s | `tests/e2e/rap-write.e2e.test.ts` > `create SRVB, activate, publish, unpublish, delete` |
| 29.9s | `tests/e2e/navigate.e2e.test.ts` > `finds references to BAPIRET2 structure` |
| 24.6s | `tests/e2e/rap-write.e2e.test.ts` > `create DDLS CDS view entity + BDEF` |
| 16.6s | `tests/e2e/navigate.e2e.test.ts` > `finds references to T000 table` |
| 16.1s | `tests/e2e/rap-write.e2e.test.ts` > `DCLS lifecycle` |
| 15.8s | `tests/e2e/rap-write.e2e.test.ts` > `create SRVD service definition` |
| 15.2s | `tests/e2e/rap-write.e2e.test.ts` > `batch_create for table entity + CDS view + DCL` |
| 14.5s | `tests/e2e/diagnostics.e2e.test.ts` > `ATC findings include quickfix metadata` |

### Live SAP Residue

Read-only live queries after the run found:

| Evidence | Result |
|---|---:|
| TADIR rows with `OBJ_NAME LIKE 'ZARC1%' OR 'ZI_ARC1%' OR 'ZTABL_ARC1%'` | 488 |
| `BDEF` rows | 13 |
| `DCLS` rows | 7 |
| `DDLS` rows | 144 |
| `DOMA` rows | 102 |
| `DTEL` rows | 74 |
| `FUGR` rows | 7 |
| `MSAG` rows | 31 |
| `PROG` rows | 40 |
| `STOB` rows | 42 |

Targeted current-run transient checks:

- `OBJ_NAME LIKE '%MP15%'`: 0 rows.
- `OBJ_NAME LIKE '%INLG%'`: 0 ARC-1 rows; only SAP standard `RSTSLINLG`.
- `ZARC1SKTDMP15%`: 0 rows.
- `ZARC1_DOMA_MP15%`, `ZARC1_DMD_MP15%`, `ZARC1_DEL_MP15%`: 0 rows.

This supports that current-run E2E transient cleanup mostly worked. Old residue remains substantial:

- `ZARC1_E2E_ACTBROKE_%`: 2 old rows.
- `ZARC1_E2E_WPOL%`: 16 old rows.
- Many old generated DDIC/RAP rows from previous runs are still present.

E2E server-log reconciliation:

- Successful `SAPWrite create` calls in the current E2E run: 40.
- Successful `SAPWrite delete` calls in the current E2E run: 45.
- Successful creates not followed by a later successful delete: only `ZTABL_ARC1_I33`, `ZI_ARC1_I33_ROOT`, and `ZI_ARC1_I33_PROJ`, which are managed persistent fixtures.
- The problem is that `ZI_ARC1_I33_ROOT` and `ZI_ARC1_I33_PROJ` are persistent but inactive.

Transport residue:

- `listTransports()` after the full run showed 17 `ARC-1` transport requests in draft/released status for this user.
- The current E2E run created `A4HK905131` and did not delete/release it.
- The current integration run created `A4HK905123` and intentionally did not auto-release it.
- The follow-up package-enabled integration run temporarily raised the count to 21; best-effort cleanup deleted the two empty transports and left 19, with `A4HK905159` and `A4HK905161` stuck due locked ghost objects.

### Static Skip/Catch Inventory

Hard skips:

- `tests/integration/abapgit.integration.test.ts:95`
- `tests/integration/abapgit.integration.test.ts:100`

Pseudo-skips:

- `tests/e2e/sktd-write.e2e.test.ts:58`, `:76`, `:87`, `:98`
- `tests/e2e/activation-failure.e2e.test.ts:70-71`, `:89-90`
- `tests/e2e/helpers.ts:205-210` contains an unused/outdated `skipIf()` helper that encourages pseudo-skip behavior.

Skip calls without useful reason text:

- `tests/integration/fugr-func.integration.test.ts`: multiple `ctx.skip()` calls in known backend-gap branches.
- `tests/integration/fugr-func-params.integration.test.ts`: multiple `ctx.skip()` calls in lock/backend-gap branches.

Broad catches that should stay under observation:

- `tests/e2e/diagnostics.e2e.test.ts`: create/update/activate steps continue after catch; acceptable for broad diagnostic smoke, weak for a test named "triggers a fresh dump".
- `tests/integration/adt.integration.test.ts`: several `best-effort-cleanup` catches explicitly accept leaving transient `$TMP` objects to time out. These are now visible in the live residue count and should be tightened over time.

## Detailed Integration File Review

| File | Detailed assessment |
|---|---|
| `tests/integration/adt.integration.test.ts` | Very broad live ADT coverage and still valuable. It also hides the most complexity: batch create, edit-method, DDLX/SRVB, diagnostics, safety, DDIC reads, search variants. Weak spots are best-effort cleanup comments that allow `$TMP` leftovers and two runtime skips. Split into smaller files before parallelization. |
| `tests/integration/cache.integration.test.ts` | Coverage is meaningful, but it is the largest integration runtime. Multiple live `runWarmup()` calls repeat expensive TADIR scans. Move most warmup behavior to unit tests or a slow profile; keep one live warmup smoke. |
| `tests/integration/transport.integration.test.ts` | Valuable for CTS compatibility but actively creates transport requests. `createTransport` intentionally does not auto-release; recursive release is slow. With `TEST_TRANSPORT_PACKAGE=Z_LLM_TEST_PACKAGE`, the auto-corrNr tests pass but leave ghost `ZARC1_TR_*` TADIR rows and undeletable locked CTS tasks. Needs cleanup policy before any more frequent CI use. |
| `tests/integration/crud.lifecycle.integration.test.ts` | Good registry-based lifecycle coverage. Cleanup helper is better than most live tests, though it still uses best-effort retries. |
| `tests/integration/context.integration.test.ts` | Good context/compression coverage. Discovery fallbacks are reasonable. No current skip issue found. |
| `tests/integration/fugr-func.integration.test.ts` | Good live FUGR/FUNC coverage. Replace bare `ctx.skip()` with reasoned skips. |
| `tests/integration/fugr-func-params.integration.test.ts` | Good structured parameter lifecycle coverage. Replace bare `ctx.skip()` with reasoned skips. |
| `tests/integration/abapgit.integration.test.ts` | The two hard skips are stale. Convert to opt-in with remote/STRUST preflight, or remove if no longer actionable. |
| `tests/integration/gcts.integration.test.ts` | Good read-only gCTS coverage. Some systems may return empty payloads; assertions still validate shape. |
| `tests/integration/audit-logging.integration.test.ts` | Good integration signal for audit events. No major issue found. |
| `tests/integration/elicitation.integration.test.ts` | Mostly unit-like but valuable because it covers elicitation flow/audit behavior. No skip/cleanup issue found. |
| `tests/integration/btp-abap.integration.test.ts` | Correctly skipped in S4-only runs. Needs separate periodic BTP run to avoid permanent blind spot. |
| `tests/integration/btp-abap.smoke.integration.test.ts` | Same as above; useful when BTP credentials are supplied. |

## Detailed E2E File Review

| File | Detailed assessment |
|---|---|
| `tests/e2e/rap-write.e2e.test.ts` | Highest E2E runtime. Current-run object cleanup looked good, but helper deletes swallow all errors. Keep sequential. Consider splitting package/TABL/DDLS/BDEF/SRVD/SRVB/DCLS/MSAG into profile shards. |
| `tests/e2e/navigate.e2e.test.ts` | Expensive because of broad where-used calls against standard objects. Skips are real. Consider marking BAPIRET2/T000 reference scans as slow profile or lowering scope when not testing navigation changes. |
| `tests/e2e/saptransport.e2e.test.ts` | Main E2E cleanup offender. The create+get test creates a draft transport and keeps it for later get/list assertions but never deletes/releases it. Add afterAll cleanup for `createdTransportId`. |
| `tests/e2e/ddic-write.e2e.test.ts` | Current-run DDIC transient cleanup looked good. `skipOnBatchCreateFailure()` returns after a real `ctx.skip()` and is acceptable. |
| `tests/e2e/diagnostics.e2e.test.ts` | Broad diagnostic smoke coverage. The "triggers a fresh dump" name is inaccurate because it cannot execute the program and can validate any existing dump. `ZARC1_E2E_DUMP` should be managed or deleted. |
| `tests/e2e/func-write.e2e.test.ts` | Current-run cleanup looked good. Uses best-effort helper, but no live residue with current-run names. |
| `tests/e2e/func-params.e2e.test.ts` | Current-run cleanup looked good. Useful issue-specific lifecycle test. |
| `tests/e2e/sktd-write.e2e.test.ts` | Current-run cleanup looked good. Pseudo-skips remain if SKTD is not supported. |
| `tests/e2e/activation-failure.e2e.test.ts` | Valuable regression. Current-run object was deleted. Pseudo-skips and "leaving stale objects is acceptable in CI" comment should be fixed. Old `ZARC1_E2E_ACTBROKE_*` rows prove this has leaked before. |
| `tests/e2e/smoke.e2e.test.ts` | Good broad smoke. Some backend-specific skips are real. Current-run generated write-policy object was deleted. |
| `tests/e2e/cache.e2e.test.ts` | Good E2E cache behavior and cheap enough. No major issue. |
| `tests/e2e/cds-context.e2e.test.ts` | Uses system demo DDLS discovery; reasonable. The beforeAll `[SKIP]` log is harmless because individual tests use `requireOrSkip()`. |
| `tests/e2e/cds-impact.e2e.test.ts` | Useful, but currently coupled to inactive persistent fixtures. It can pass via source parsing even when fixtures are inactive. Add fixture active-state precondition. |
| `tests/e2e/rap.e2e.test.ts` | Good RAP read/write smoke. Pre-cleanup of stale `ZARC1_E2E_WRITE` is useful. |
| `tests/e2e/revisions.e2e.test.ts` | Good revision coverage. Skip helper is explicit and reasoned. |
| `tests/e2e/sap-git.e2e.test.ts` | Good read/safety coverage. Early `beforeAll` return is not a pseudo-skip because each test calls `requireOrSkip()`. |
| `tests/e2e/setup.ts` | Must be hardened. Activation errors should not be warnings unless classified. |
| `tests/e2e/sync-fixtures.ts` | Does not print `summary.skipped`, so skipped fixtures can be hidden in CLI output. |
| `tests/e2e/global-setup.ts` | Useful zombie preflight. Contains Unicode console art only; no behavioral issue. |
| `tests/e2e/helpers.ts` | `skipIf()` is outdated; `expectToolSuccessOrSkip()` and `skipOnBatchCreateFailure()` are useful. |

## Runtime Improvement Plan

Do not broadly enable parallelism for all integration/E2E tests yet. Current configs serialize files because tests share one SAP user, one server, locks, CSRF/session state, transports, and mutable ABAP objects. The observed failures and cleanup residue support keeping write-heavy tests sequential until isolation improves.

Recommended phased plan:

1. Split slow/optional profiles before parallelizing:
   - `test:integration:core`: current integration minus repeated cache warmup and recursive transport release.
   - `test:integration:slow`: cache warmup, recursive release, optional transportable-package tests.
   - `test:e2e:read`: smoke, cache, CDS context/impact, RAP read, revisions, SAPGit read/safety.
   - `test:e2e:write`: RAP write, DDIC write, FUNC write, SKTD write, activation failure.
   - `test:e2e:transport`: transport suite only.
2. Reduce `tests/integration/cache.integration.test.ts` runtime:
   - Avoid repeating full `$TMP` warmups in one file.
   - Share one prewarmed cache per suite where possible.
   - Move delta/full warmup behavior into a slow profile or mock most warmup logic at unit level.
3. Keep transport release tests sequential and optional:
   - `releaseTransportRecursive` took about 46-48s in both integration/E2E.
   - Make it opt-in on PRs or run nightly/manual unless it is the feature under change.
4. Parallelize only read-only shards after isolation:
   - Run separate MCP servers on separate ports, each with its own memory cache.
   - Keep the server request limit explicit per shard with `ARC1_MAX_CONCURRENT`; default is 10. Raise it only for read-only experiments after a load smoke passes.
   - Keep write-heavy suites single-file sequential.
   - Add a server concurrency smoke test before assuming the HTTP transport can handle the load safely.
5. Add cleanup gates before adding parallelism:
   - No new draft `ARC-1` transports after a run.
   - No inactive `ZARC1*` / `ZI_ARC1*` objects except explicitly allowlisted fixtures.
   - No transient `ZARC1*` objects from current-run prefixes left behind.

## Setup And Destroy Review

Current strengths:

- Most transient E2E write tests use unique names and `finally` cleanup.
- CRUD lifecycle tests use a registry and cleanup helper.
- E2E startup/stopping works despite macOS portability warnings.

Current gaps:

- Persistent fixture activation failures are not fatal.
- Transport requests are intentionally/manual-cleanup in integration and partially untracked in E2E.
- Diagnostic dump program is persistent but unmanaged.
- Live system contains many old `ZARC1*` objects. The audit search was capped at 200 results and still hit the cap.
- Live inactive-object check found 15 inactive ARC-1-looking objects, including the current invalid CDS fixture pair.

Recommended cleanup hardening:

- Add `npm run test:e2e:audit-cleanup` or equivalent that reports:
  - created transport requests by description prefix and status,
  - inactive ARC-1 objects,
  - transient-name patterns older than the current run,
  - persistent fixture active/readable status.
- Make cleanup failures fail the suite for tests that create objects in the current run.
- Keep a small allowlist for intentionally persistent fixtures only.

## Per-File Review

### Unit Files

All unit files passed with no skips. The main issue is not correctness drift; it is coverage concentration. The table below is an inventory checkpoint for resuming this audit.

| File | Tests | Passed | Skipped | Runtime |
|---|---:|---:|---:|---:|
| `tests/unit/adt/abapgit.test.ts` | 19 | 19 | 0 | 16ms |
| `tests/unit/adt/btp-pp.test.ts` | 7 | 7 | 0 | 8ms |
| `tests/unit/adt/cds-impact.test.ts` | 17 | 17 | 0 | 7ms |
| `tests/unit/adt/client.test.ts` | 109 | 109 | 0 | 43ms |
| `tests/unit/adt/codeintel.test.ts` | 26 | 26 | 0 | 16ms |
| `tests/unit/adt/cookies.test.ts` | 15 | 15 | 0 | 6ms |
| `tests/unit/adt/crud.test.ts` | 58 | 58 | 0 | 16ms |
| `tests/unit/adt/ddic-xml.test.ts` | 45 | 45 | 0 | 8ms |
| `tests/unit/adt/devtools.test.ts` | 119 | 119 | 0 | 50ms |
| `tests/unit/adt/diagnostics.test.ts` | 73 | 73 | 0 | 32ms |
| `tests/unit/adt/discovery.test.ts` | 35 | 35 | 0 | 19ms |
| `tests/unit/adt/errors.test.ts` | 77 | 77 | 0 | 12ms |
| `tests/unit/adt/features.test.ts` | 73 | 73 | 0 | 20ms |
| `tests/unit/adt/flp.test.ts` | 20 | 20 | 0 | 9ms |
| `tests/unit/adt/fm-signature.test.ts` | 25 | 25 | 0 | 9ms |
| `tests/unit/adt/gcts.test.ts` | 17 | 17 | 0 | 11ms |
| `tests/unit/adt/get-app-url.test.ts` | 9 | 9 | 0 | 1ms |
| `tests/unit/adt/http.test.ts` | 113 | 113 | 0 | 11090ms |
| `tests/unit/adt/oauth.test.ts` | 40 | 40 | 0 | 144ms |
| `tests/unit/adt/rap-generate.test.ts` | 20 | 20 | 0 | 11ms |
| `tests/unit/adt/rap-handlers.test.ts` | 27 | 27 | 0 | 81ms |
| `tests/unit/adt/rap-preflight.test.ts` | 13 | 13 | 0 | 4ms |
| `tests/unit/adt/refactoring.test.ts` | 15 | 15 | 0 | 9ms |
| `tests/unit/adt/safety.test.ts` | 51 | 51 | 0 | 7ms |
| `tests/unit/adt/semaphore.test.ts` | 8 | 8 | 0 | 38ms |
| `tests/unit/adt/transport.test.ts` | 71 | 71 | 0 | 20ms |
| `tests/unit/adt/ui5-repository.test.ts` | 5 | 5 | 0 | 4ms |
| `tests/unit/adt/xml-parser.test.ts` | 111 | 111 | 0 | 41ms |
| `tests/unit/aff/validator.test.ts` | 7 | 7 | 0 | 98ms |
| `tests/unit/authz/policy.test.ts` | 38 | 38 | 0 | 6ms |
| `tests/unit/cache/caching-layer.test.ts` | 28 | 28 | 0 | 15ms |
| `tests/unit/cache/inactive-list-cache.test.ts` | 7 | 7 | 0 | 4ms |
| `tests/unit/cache/memory.test.ts` | 25 | 25 | 0 | 7ms |
| `tests/unit/cache/sqlite.test.ts` | 26 | 26 | 0 | 29ms |
| `tests/unit/cli/clear-text-logging-regression.test.ts` | 5 | 5 | 0 | 3ms |
| `tests/unit/cli/cli-args.test.ts` | 17 | 17 | 0 | 6ms |
| `tests/unit/cli/cli.test.ts` | 2 | 2 | 0 | 1ms |
| `tests/unit/cli/config-show.test.ts` | 7 | 7 | 0 | 5ms |
| `tests/unit/context/cds-deps.test.ts` | 23 | 23 | 0 | 6ms |
| `tests/unit/context/compressor.test.ts` | 23 | 23 | 0 | 165ms |
| `tests/unit/context/contract.test.ts` | 14 | 14 | 0 | 126ms |
| `tests/unit/context/deps.test.ts` | 19 | 19 | 0 | 168ms |
| `tests/unit/context/method-surgery.test.ts` | 39 | 39 | 0 | 293ms |
| `tests/unit/extract-sap-cookies.test.ts` | 1 | 1 | 0 | 2ms |
| `tests/unit/handlers/action-policy-integration.test.ts` | 27 | 27 | 0 | 86ms |
| `tests/unit/handlers/hyperfocused.test.ts` | 17 | 17 | 0 | 5ms |
| `tests/unit/handlers/intent.test.ts` | 561 | 561 | 0 | 3746ms |
| `tests/unit/handlers/schemas.test.ts` | 141 | 141 | 0 | 32ms |
| `tests/unit/handlers/slash-type-map.test.ts` | 17 | 17 | 0 | 3ms |
| `tests/unit/handlers/tools.test.ts` | 69 | 69 | 0 | 13ms |
| `tests/unit/handlers/zod-errors.test.ts` | 7 | 7 | 0 | 4ms |
| `tests/unit/helpers/e2e-skip-classification.test.ts` | 2 | 2 | 0 | 3ms |
| `tests/unit/helpers/expected-error.test.ts` | 5 | 5 | 0 | 3ms |
| `tests/unit/helpers/skip-policy.test.ts` | 8 | 8 | 0 | 4ms |
| `tests/unit/integration/crud-harness.test.ts` | 17 | 17 | 0 | 55ms |
| `tests/unit/integration/helpers.test.ts` | 3 | 3 | 0 | 2ms |
| `tests/unit/lint/config-builder.test.ts` | 25 | 25 | 0 | 247ms |
| `tests/unit/lint/lint-e2e.test.ts` | 24 | 24 | 0 | 608ms |
| `tests/unit/lint/lint-enhanced.test.ts` | 15 | 15 | 0 | 324ms |
| `tests/unit/lint/lint.test.ts` | 27 | 27 | 0 | 203ms |
| `tests/unit/package-metadata.test.ts` | 2 | 2 | 0 | 1ms |
| `tests/unit/probe/quality.test.ts` | 6 | 6 | 0 | 2ms |
| `tests/unit/probe/replay.test.ts` | 13 | 13 | 0 | 55ms |
| `tests/unit/probe/runner.test.ts` | 28 | 28 | 0 | 4ms |
| `tests/unit/scripts/assert-required-test-execution.test.ts` | 12 | 12 | 0 | 66ms |
| `tests/unit/scripts/collect-test-reliability.test.ts` | 9 | 9 | 0 | 41ms |
| `tests/unit/scripts/coverage-summary.test.ts` | 6 | 6 | 0 | 2ms |
| `tests/unit/server/audit-integration.test.ts` | 5 | 5 | 0 | 24ms |
| `tests/unit/server/audit.test.ts` | 10 | 10 | 0 | 4ms |
| `tests/unit/server/config.test.ts` | 125 | 125 | 0 | 29ms |
| `tests/unit/server/context.test.ts` | 5 | 5 | 0 | 8ms |
| `tests/unit/server/deny-actions.test.ts` | 24 | 24 | 0 | 7ms |
| `tests/unit/server/effective-policy-log.test.ts` | 10 | 10 | 0 | 6ms |
| `tests/unit/server/elicit.test.ts` | 16 | 16 | 0 | 8ms |
| `tests/unit/server/http-security-headers.test.ts` | 14 | 14 | 0 | 48ms |
| `tests/unit/server/http.test.ts` | 13 | 13 | 0 | 5ms |
| `tests/unit/server/logger.test.ts` | 11 | 11 | 0 | 8ms |
| `tests/unit/server/server.test.ts` | 27 | 27 | 0 | 21ms |
| `tests/unit/server/sinks/btp-auditlog.test.ts` | 11 | 11 | 0 | 6ms |
| `tests/unit/server/sinks/file.test.ts` | 4 | 4 | 0 | 10ms |
| `tests/unit/server/sinks/stderr.test.ts` | 6 | 6 | 0 | 3ms |
| `tests/unit/server/stateless-client-store.test.ts` | 33 | 33 | 0 | 17ms |
| `tests/unit/server/xsuaa.test.ts` | 27 | 27 | 0 | 236ms |

### Integration And E2E Files

The integration and E2E per-file reviews are embedded in the Test Runs section because these suites are where skip/runtime/cleanup behavior matters most. The highest priority files to fix first are:

1. `tests/e2e/setup.ts` and CDS fixture files.
2. `tests/e2e/saptransport.e2e.test.ts`.
3. `tests/integration/transport.integration.test.ts`.
4. `tests/e2e/sktd-write.e2e.test.ts`.
5. `tests/e2e/activation-failure.e2e.test.ts`.
6. `tests/e2e/diagnostics.e2e.test.ts`.
7. `scripts/ci/collect-test-reliability.mjs`.
8. `scripts/e2e-start-local.sh` and `scripts/e2e-stop-local.sh`.

## Recommended Work Items

Order these by risk reduction:

1. Fix E2E fixture activation handling and the invalid DDLS fixture.
2. Stop transport leakage in integration/E2E; add a live cleanup audit.
3. Convert pseudo-skips into real `ctx.skip()` calls with reasons.
4. Repair skip reason telemetry.
5. Clean up or declare `ZARC1_E2E_DUMP`.
6. Split slow integration/E2E profiles and add a read-only server concurrency smoke before attempting broader parallelism.
7. Add focused unit coverage for `src/server/http.ts`, `src/server/server.ts`, `src/adt/btp.ts`, `src/server/xsuaa.ts`, and `src/extract-sap-cookies.ts`.
8. Fix macOS portability in E2E local scripts.
9. Align CI comments/triggers/concurrency with actual behavior.

## Research Completeness

At this point the requested audit areas have been covered against the S4 test system:

- Full unit, integration, coverage, and E2E runs were executed.
- A package-enabled focused transport run was executed to close the main env-gated transport-package gap.
- Static skip/pseudo-skip/catch patterns were scanned.
- Live SAP cleanup state was checked through ADT search, TADIR SQL, inactive object listing, and CTS transport listing.
- E2E current-run create/delete behavior was reconciled from the server log.
- CI workflow gating/concurrency and local E2E scripts were inspected.
- A deeper remediation design was added for each finding, including acceptance criteria, cleanup gates, skip telemetry design, and server concurrency guidance around `ARC1_MAX_CONCURRENT`.

Known remaining blind spots are intentional external-scope items, not unresearched gaps in the S4 audit:

- BTP ABAP tests were not run because this audit used the S4 test system and no BTP service key was configured in this run.
- The transport reverse-lookup test for a transportable class still lacks a real configured class object in `Z_LLM_TEST_PACKAGE`; the package currently exposes only PROG entries in the live checks.
- No automated cleanup of older historical SAP residue was performed. Only a best-effort cleanup attempt was made for artifacts created by the focused follow-up run, and that attempt proved the locked-ghost failure mode.

## Raw Suite Summary

| Suite | Total | Passed | Failed | Skipped | Skip % |
|---|---:|---:|---:|---:|---:|
| unit | 2,881 | 2,881 | 0 | 0 | 0.0% |
| integration | 236 | 195 | 0 | 41 | 17.4% |
| e2e | 137 | 134 | 0 | 3 | 2.2% |

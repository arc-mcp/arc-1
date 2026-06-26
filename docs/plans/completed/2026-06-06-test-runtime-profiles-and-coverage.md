# Test Runtime Profiles And Coverage

Status: completed on 2026-06-06.

Final validation:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 104 files / 3,468 tests passed.
- `npm run test:coverage`: 104 files / 3,468 tests passed; statements 82.57%, branches 73.38%, functions 88.48%, lines 83.79%.
- `npm run build`: passed.
- A4H 2025 `npm run test:integration`: 208 passed / 54 skipped, 188.06s.
- A4H 2025 `npm run test:integration:slow`: 6 passed / 1 skipped, 25.97s.
- A4H 2025 `npm run test:e2e`: 137 passed / 4 skipped, 183.22s.
- A4H 2025 `npm run test:e2e:slow`: 8 passed / 1 skipped, 188.08s.

## Overview

This plan implements the remaining test-suite audit follow-ups that reduce the default PR-path live SAP runtime without losing coverage. The key design is to split expensive but valuable live checks into explicit slow profiles, keep the default integration/E2E configs sequential, remove repeated feature probing from E2E setup, add one bounded read-only concurrency smoke, and improve focused unit coverage for HTTP auth, BTP startup, and cookie extraction helpers.

The plan deliberately does not enable broad Vitest file parallelism. The slowest existing tests mutate ABAP repository objects, lock sources, create/delete CTS requests, publish service bindings, or inspect shared cache warmup state. Those workflows are not safe to run in parallel just because MCP Streamable HTTP supports multiple client connections.

## Context

### Current State

`package.json` exposes `test:integration` and `test:e2e`, but there are no explicit slow profile commands. `vitest.integration.config.ts` includes all `tests/integration/**/*.test.ts`, and `tests/e2e/vitest.e2e.config.ts` includes all `tests/e2e/**/*.e2e.test.ts`. Both configs correctly serialize live SAP files.

The runtime audit identifies the main default-path hotspots as repeated integration cache warmup scans, broad E2E where-used calls on `BAPIRET2` and `T000`, full RAP write dependency stacks in `rap-write.e2e.test.ts`, and recursive transport release coverage. `smoke.e2e.test.ts` and `rap-write.e2e.test.ts` still force `SAPManage probe` calls where cached `SAPManage features` is sufficient.

Coverage remains weaker around `src/server/http.ts`, `src/adt/btp.ts`, and `src/extract-sap-cookies.ts`. Current tests already cover `extractOidcScopes`, XSUAA chained verifier behavior, per-user server token wiring, and `getAppUrl`; the useful additions are pure verifier/helper/startup tests rather than broad HTTP server integration tests.

### Target State

Default PR CI uses faster default profiles that exclude explicitly named slow files while preserving representative integration/E2E coverage. Slow integration/E2E commands exist for manual or future scheduled runs and retain the moved heavy coverage. E2E availability checks use cached `SAPManage features` instead of repeated live probes. A small read-only concurrency E2E test proves simultaneous MCP tool calls work without mutating SAP state.

Unit coverage improves through focused tests for API-key standard verifier behavior, BTP VCAP/destination/connectivity proxy startup helpers, and cookie extraction host/format helpers. Documentation records the implemented profile split and remaining follow-up to prepare the 2025 SAP system for GitHub Actions.

### Key Files

| File | Role |
|------|------|
| `package.json` | Add slow-profile npm scripts while keeping existing default commands stable. |
| `vitest.integration.config.ts` | Exclude `*.slow.integration.test.ts` from the default integration profile. |
| `vitest.integration.slow.config.ts` | New sequential slow integration profile with separate JSON output. |
| `tests/e2e/vitest.e2e.config.ts` | Exclude `*.slow.e2e.test.ts` from the default E2E profile. |
| `tests/e2e/vitest.e2e.slow.config.ts` | New sequential slow E2E profile with separate JSON/JUnit output. |
| `tests/integration/cache.integration.test.ts` | Keep default cache/source/dependency coverage and move repeated warmup checks. |
| `tests/integration/cache-warmup.slow.integration.test.ts` | New slow warmup/usages coverage file. |
| `tests/e2e/navigate.e2e.test.ts` | Keep representative navigation checks and move broad DDIC scans. |
| `tests/e2e/navigate.slow.e2e.test.ts` | New slow broad where-used coverage file. |
| `tests/e2e/rap-write.e2e.test.ts` | Keep default package/TABL/MSAG/narrow RAP write coverage. |
| `tests/e2e/rap-write.slow.e2e.test.ts` | New slow RAP full-stack coverage file. |
| `tests/e2e/rap-write-helpers.ts` | Shared unique-name, cleanup, and RAP feature helper functions for default and slow RAP write files. |
| `tests/e2e/saptransport.e2e.test.ts` | Keep default transport coverage excluding recursive release. |
| `tests/e2e/saptransport.slow.e2e.test.ts` | New slow recursive transport release coverage file. |
| `tests/e2e/smoke.e2e.test.ts` | Change `SAPManage probe` smoke to cached `SAPManage features`. |
| `tests/e2e/concurrency-read.e2e.test.ts` | New read-only concurrency smoke. |
| `src/server/http.ts` | Export `createStandardVerifier` for focused unit tests. |
| `tests/unit/server/http.test.ts` | Add standard verifier API-key tests. |
| `src/adt/btp.ts` | Existing BTP helpers under test; no production change expected unless testability requires a small pure export. |
| `tests/unit/adt/btp.test.ts` | New VCAP/destination/connectivity proxy tests. |
| `src/extract-sap-cookies.ts` | Export pure cookie host/format helpers for tests. |
| `tests/unit/extract-sap-cookies.test.ts` | Add cookie helper and argument parsing tests. |
| `CLAUDE.md` | Document slow profile commands and test-level table updates. |
| `docs/research/2026-05-11-test-suite-audit.md` | Mark implemented runtime/coverage items and record validation. |
| `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md` | Keep implementation status and new findings current. |

### Design Principles

1. Keep all live SAP profiles sequential unless the test itself is explicitly read-only and bounded.
2. Split profile membership before attempting any broad parallelism.
3. Preserve coverage by moving expensive tests to slow files, not deleting them.
4. Keep default PR path representative: at least one cache warmup smoke, one standard where-used smoke, one write lifecycle signal for core write types, and default transport create/get/delete coverage.
5. Avoid leaking infrastructure secrets into docs, commands, GitHub logs, or PR text.
6. Unit-test pure helper logic rather than spawning browsers, BTP services, or HTTP servers when a focused function-level test proves the behavior.

## Development Approach

Implement in four layers: profile/config scripts first, test-file moves and feature-probe reductions second, focused unit coverage third, and documentation plus validation last. After each layer, run focused unit tests or targeted Vitest config checks before running full suites. Live SAP validation should use the configured infrastructure environment without printing secrets.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:coverage`
- `npm run test:integration`
- `npm run test:integration:slow`
- `npm run test:e2e`
- `npm run test:e2e:slow`

### Task 1: Add default and slow profile configuration

**Files:**
- Modify: `package.json`
- Modify: `vitest.integration.config.ts`
- Add: `vitest.integration.slow.config.ts`
- Modify: `tests/e2e/vitest.e2e.config.ts`
- Add: `tests/e2e/vitest.e2e.slow.config.ts`
- Modify: `CLAUDE.md`

Add explicit slow profile commands while keeping the existing default commands as the PR path. The slow configs must remain sequential and write their own JSON/JUnit artifacts so later workflow work can collect them without overwriting default results.

- [x] In `vitest.integration.config.ts`, add `exclude: ['tests/integration/**/*.slow.integration.test.ts']` and keep `fileParallelism: false` and `sequence.concurrent: false`.
- [x] Create `vitest.integration.slow.config.ts` with the same global setup, timeout, hook timeout, sequential settings, and a JSON reporter outputting `test-results/integration-slow.json`; include only `tests/integration/**/*.slow.integration.test.ts`.
- [x] In `tests/e2e/vitest.e2e.config.ts`, add `exclude: ['tests/e2e/**/*.slow.e2e.test.ts']` and keep the existing reporters for default E2E.
- [x] Create `tests/e2e/vitest.e2e.slow.config.ts` with the same global setup and sequential settings; include only `tests/e2e/**/*.slow.e2e.test.ts`; output JSON to `test-results/e2e-slow.json` and JUnit to `$E2E_LOG_DIR/junit-results-slow.xml` or `/tmp/arc1-e2e-logs/junit-results-slow.xml`.
- [x] In `package.json`, add `test:integration:slow` and `test:e2e:slow`; the E2E slow command must run `test:e2e:fixtures` before Vitest, same as default `test:e2e`.
- [x] Update `CLAUDE.md` Quick Reference and test-level table to document the slow commands.
- [x] Run `npm test -- tests/unit/scripts/collect-test-reliability.test.ts` to ensure existing reliability tests still pass.

### Task 2: Move repeated integration cache warmup coverage to slow profile

**Files:**
- Modify: `tests/integration/cache.integration.test.ts`
- Add: `tests/integration/cache-warmup.slow.integration.test.ts`
- Modify: `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`

The default cache integration file should keep source caching, dependency graph caching, cache stats, usages-without-warmup, and one bounded warmup smoke. Repeated broad warmup scans and warmup-backed usages belong in the slow profile.

- [x] In `cache.integration.test.ts`, remove or reduce the repeated `describe('warmup')` tests so default runs at most one bounded warmup smoke using a stable package such as `$DEMO_SOI_DRAFT`.
- [x] Create `cache-warmup.slow.integration.test.ts` that contains the detailed warmup coverage moved from default: enumeration, nodes/sources indexing, warmup flag, second-run delta by hash, `getUsages()` after warmup, and `SAPContext usages` after warmup.
- [x] Keep the existing `requireDepGraphFixture()` style skip behavior and explicit timeout budgets for slow warmup tests.
- [x] Ensure all cache temporary SQLite files still clean up.
- [x] Update the research checkpoint with the new default/slow cache split.
- [x] Run `npm run test:integration -- tests/integration/cache.integration.test.ts` and `npm run test:integration:slow -- tests/integration/cache-warmup.slow.integration.test.ts` when SAP credentials are available; otherwise run `npm test` for affected unit tests and document the live-test gap.

### Task 3: Move broad E2E navigation scans to slow profile

**Files:**
- Modify: `tests/e2e/navigate.e2e.test.ts`
- Add: `tests/e2e/navigate.slow.e2e.test.ts`
- Modify: `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`

The default navigation file should still cover custom fixture references, one standard class where-used query, BUKRS domain/data-element checks, objectType filtering on `CL_ABAP_CHAR_UTILITIES`, and error handling. The broad `BAPIRET2` and `T000` scans should move to slow.

- [x] Move `finds references to BAPIRET2 structure`, `finds references to T000 table`, and `filters references by objectType CLAS/OC` for `BAPIRET2` into `navigate.slow.e2e.test.ts`.
- [x] Keep `BUKRS` domain and data-element checks in the default file because they are lower-cost and cover DDIC type routing.
- [x] Ensure the slow file creates/closes its own MCP client and uses the same `callTool`/`expectToolSuccessOrSkip` helpers.
- [x] Update the file-level comments to explain default versus slow coverage.
- [x] Update the research checkpoint with the moved broad where-used tests.
- [x] Run `npm run test:e2e -- tests/e2e/navigate.e2e.test.ts` and `npm run test:e2e:slow -- tests/e2e/navigate.slow.e2e.test.ts` when an MCP server is available.

### Task 4: Consolidate RAP write E2E and use cached features

**Files:**
- Modify: `tests/e2e/rap-write.e2e.test.ts`
- Add: `tests/e2e/rap-write.slow.e2e.test.ts`
- Add: `tests/e2e/rap-write-helpers.ts`
- Modify: `tests/e2e/smoke.e2e.test.ts`
- Modify: `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`

RAP write coverage is valuable, but the default file currently creates several overlapping full object stacks. Keep one narrow default RAP/TABL signal and move full-stack variants to slow. Also replace repeated `SAPManage probe` calls with cached `SAPManage features`.

- [x] Extract `uniqueName`, `bestEffortDelete`, `bestEffortDeletePackage`, and a `loadRapAvailability(client)` helper into `rap-write-helpers.ts`; the feature helper must call `SAPManage` with `{ action: 'features' }` and map `features.rap.available === true` to `true`.
- [x] Update `rap-write.e2e.test.ts` to import the helpers and remove its direct `SAPManage probe` call.
- [x] Keep these default tests: package create/verify/delete, TABL table entity create/activate/read/delete, TABL create/read/update/activate/delete, and MSAG create/read/update/delete.
- [x] Move these to `rap-write.slow.e2e.test.ts`: DDLS CDS view entity + BDEF, DCLS lifecycle, SRVD lifecycle, SRVB create/activate/publish/unpublish/delete, and RAP `batch_create` for table entity + CDS view + DCL.
- [x] Ensure both default and slow files close their MCP client in `afterAll` and preserve best-effort cleanup in reverse dependency order.
- [x] Change `smoke.e2e.test.ts` from `SAPManage probe — detects system features` to a cached `SAPManage features` smoke.
- [x] Update the research checkpoint with the RAP split and probe-to-features change.
- [x] Run focused E2E default and slow RAP files when an MCP server is available.

### Task 5: Move recursive transport release to slow E2E

**Files:**
- Modify: `tests/e2e/saptransport.e2e.test.ts`
- Add: `tests/e2e/saptransport.slow.e2e.test.ts`
- Modify: `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`

Recursive release is expensive and released requests cannot be deleted from the shared test system. It should not occupy the default E2E profile, even as a skipped test. Preserve it in a slow, explicit profile gated by `TEST_TRANSPORT_RELEASE_TESTS=true`.

- [x] Remove the `release_recursive releases transport` test from the default `saptransport.e2e.test.ts` file.
- [x] Create `saptransport.slow.e2e.test.ts` that connects its own MCP client and contains only the recursive release test.
- [x] Keep the `TEST_TRANSPORT_RELEASE_TESTS=true` guard using `requireOrSkip(ctx, ..., SkipReason.TRANSPORT_RELEASE_DISABLED)`.
- [x] On failure before release, delete the created request recursively; after successful release, do not attempt deletion.
- [x] Update comments in both files so release coverage is clearly slow/manual.
- [x] Run focused default/slow transport tests only when transport writes are enabled and shared-system impact is acceptable.

### Task 6: Add bounded read-only E2E concurrency smoke

**Files:**
- Add: `tests/e2e/concurrency-read.e2e.test.ts`
- Modify: `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`

This test proves ARC-1 can process simultaneous MCP calls through the local Streamable HTTP server without mutating SAP. It must not create, update, delete, activate, release, or warm up objects.

- [x] Add a new E2E file that connects one MCP client and logs `ARC1_MAX_CONCURRENT`, `ARC1_AUTH_RATE_LIMIT`, and `ARC1_RATE_LIMIT`.
- [x] Run three or four concurrent read-only calls with `Promise.all`, such as `SAPRead SYSTEM`, `SAPRead COMPONENTS`, and `SAPRead CLAS CL_ABAP_CHAR_UTILITIES method='*'`.
- [x] Assert each result is successful and has the expected JSON/text shape.
- [x] Keep the concurrency level fixed and low; this is a smoke test, not a load test.
- [x] Close the MCP client in `afterAll`.
- [x] Run `npm run test:e2e -- tests/e2e/concurrency-read.e2e.test.ts` when an MCP server is available.

### Task 7: Add focused unit coverage for HTTP, BTP, and cookie helpers

**Files:**
- Modify: `src/server/http.ts`
- Modify: `tests/unit/server/http.test.ts`
- Modify: `src/extract-sap-cookies.ts`
- Modify: `tests/unit/extract-sap-cookies.test.ts`
- Add: `tests/unit/adt/btp.test.ts`

Improve coverage in high-value auth/connectivity/helper surfaces without adding slow or brittle integration tests. Keep production changes limited to exporting existing pure/factory helpers for tests.

- [x] Export `createStandardVerifier` from `src/server/http.ts`.
- [x] Add HTTP unit tests for API-key verifier success with `viewer`, success with `admin`/expanded scopes, far-future `expiresAt`, and invalid token rejection when no OIDC verifier is configured.
- [x] Export `cookieMatchesHost`, `formatNetscapeCookieLine`, and `toNetscapeCookieFile` from `src/extract-sap-cookies.ts`.
- [x] Add cookie extraction unit tests for CLI/env URL precedence, unsupported browser rejection, host/domain matching, Netscape line formatting, and generated cookie-file header/body output.
- [x] Add BTP unit tests for `parseVCAPServices()` with destination `uri`/token fallback and connectivity token URL suffix normalization.
- [x] Add BTP unit tests for `lookupDestination()` using a stubbed global `fetch` sequence for client-credentials token and Destination Service lookup.
- [x] Add BTP unit tests for `createConnectivityProxy()` returning `null` without a proxy host and caching the connectivity token until expiry buffer.
- [x] Ensure all global env and `fetch` stubs are restored in `afterEach`.
- [x] Run `npm test -- tests/unit/server/http.test.ts tests/unit/extract-sap-cookies.test.ts tests/unit/adt/btp.test.ts tests/unit/adt/btp-pp.test.ts`.

### Task 8: Documentation, audit updates, and final validation

**Files:**
- Modify: `docs/research/2026-05-11-test-suite-audit.md`
- Modify: `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md`
- Modify: `CLAUDE.md`
- Move: `docs/plans/completed/2026-06-06-test-runtime-profiles-and-coverage.md` to `docs/plans/completed/2026-06-06-test-runtime-profiles-and-coverage.md` after implementation and validation.

Update the audit so future follow-up work can start from the new baseline. Document what moved to slow profiles, what remains open, the live SAP systems used, and the reason the 2025 GitHub migration is deferred to a separate follow-up.

- [x] Update `docs/research/2026-05-11-test-suite-audit.md` Recommended Work Items / Implemented Follow-ups to mark items 8, 9, 10, 11, 12, 13, 14, and 15 as implemented or partially implemented by this PR.
- [x] Update `docs/research/2026-06-06-test-runtime-profiles-and-coverage.md` with final implementation details, measured local/SAP runtimes, test results, and any new findings.
- [x] Confirm no infrastructure secrets are present in changed files with targeted `rg` scans for sensitive variable assignments and known credential-like literals.
- [x] Run no-SAP validation: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run test:coverage`.
- [x] Run SAP-backed default validation against the available S/4/2025 system: `npm run test:integration`; build/start local MCP server; `npm run test:e2e`; stop the server.
- [x] Run SAP-backed slow validation where safe: `npm run test:integration:slow`; `npm run test:e2e:slow`.
- [x] Review `.github/workflows/test.yml` and confirm default CI still invokes default profiles, uploads default artifacts, and remains serialized by the repository-wide SAP concurrency group.
- [x] Move this plan to `docs/plans/completed/2026-06-06-test-runtime-profiles-and-coverage.md`.

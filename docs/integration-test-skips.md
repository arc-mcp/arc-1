# Integration + E2E test skips — taxonomy

The **integration** suite (`npm run test:integration`) and the **E2E** suite (`npm run test:e2e`) skip recognized missing features, optional fixtures and disabled test opt-ins. Missing required credentials and unexpected backend errors fail the run. Check each skip reason against the target system; a green run alone does not establish coverage.

This doc is the map. When you see a `↓ [SkipReason.…]` line in a test run, look up the category here to understand (a) why it's firing, (b) whether it's expected on your system, and (c) when investigation would be warranted.

Runtime summaries per category are available via:
- `npm run test:integration:skip-summary` (integration suite)
- `npm run test:e2e:skip-summary` (E2E suite)

Both use [scripts/ci/summarize-skips.mjs](../scripts/ci/summarize-skips.mjs) with the same taxonomy. For acceptance, retain the original Vitest exit code and JSON results; these piped summaries are reporting helpers.

> **Note on counts:** the summary tool parses per-test `↓` lines, which vitest emits for tests skipped via `skipTest()` / `requireOrSkip()` (both delegate to `ctx.skip()`). **File- or describe-level skips** — like the whole BTP ABAP suite skipping when `TEST_BTP_SERVICE_KEY_FILE` isn't set, or the gCTS suite when the backend doesn't have gCTS — are rolled up in the `Test Files … skipped` summary line instead. The summary tool reads both and reports the delta; see the "Note:" line at the end of its output if your run shows more total skipped tests than per-test `↓` lines.

## How to read this

- **Typical on** — systems where this skip is routine; seeing it is healthy, not a bug.
- **Should NOT skip on** — if this skip fires on a listed system, that's a regression signal; investigate.
- **Skip message pattern** — what you grep for in test output. All runtime skips go through `skipTest(ctx, "<message>")` or `requireOrSkip()`, then Vitest prints them as `↓ <test> [<message>]`.

## Skip reason constants

The base codes live in [tests/helpers/skip-policy.ts](../tests/helpers/skip-policy.ts):

| Code | Meaning |
|---|---|
| `NO_CREDENTIALS` | `TEST_SAP_URL` / `TEST_SAP_USER` / `TEST_SAP_PASSWORD` not set |
| `NO_FIXTURE` | Object the test expects is absent from the target system |
| `NO_DDLS` | Walks the catalog looking for *any* readable DDLS, finds none |
| `NO_DUMPS` | ST22 shows no short dumps on this system |
| `NO_TRANSPORT_PACKAGE` | `TEST_TRANSPORT_PACKAGE` env var not set |
| `TRANSPORT_PACKAGE_WRITES_DISABLED` | `TEST_TRANSPORT_PACKAGE_WRITE_TESTS=true` not set |
| `BACKEND_UNSUPPORTED` | Feature genuinely not available on this SAP release |

Tests typically suffix these with a specific clause explaining *which* fixture or feature, e.g. `NO_FIXTURE (/DMO/CL_FLIGHT_LEGACY) — S/4 demo content`.

## Category 1 — S/4-only demo content

**What it is:** Objects SAP ships only on S/4HANA boxes (Flight Reference Scenario `/DMO/*`, BOBF demos, S/4 CDS views). These never existed on plain NetWeaver systems and will not exist on pre-S/4 releases regardless of SP level.

| Skip message fragment | Affected tests | Typical on | Should NOT skip on |
|---|---|---|---|
| `NO_FIXTURE (/DMO/CL_FLIGHT_LEGACY)` | `context.integration.test.ts` dep-extraction, contract extraction, method surgery (~9 tests) | Plain NW ≤ 7.58, BTP ABAP | S/4HANA any release |
| `NO_FIXTURE (/DMO/IF_FLIGHT_LEGACY)` | `context.integration.test.ts` interface deps (~3 tests) | Plain NW, BTP ABAP | S/4HANA any release |
| `NO_FIXTURE (/DMO/CL_FLIGHT_AMDP)` | `adt.integration.test.ts` AMDP include variants (5 tests) | Plain NW, BTP ABAP | S/4HANA any release |
| `NO_FIXTURE (/DMO/ DDLX)` | `adt.integration.test.ts` DDLX read tests (2 tests) | Plain NW, BTP ABAP | S/4HANA any release |
| `NO_FIXTURE (/DMO/ SRVB)` | `adt.integration.test.ts` SRVB read tests (2 tests) | Plain NW, BTP ABAP | S/4HANA any release |
| `NO_FIXTURE (ZCL_DEMO_D_CALC_AMOUNT)` | `context.integration.test.ts` inheritance; `cache.integration.test.ts` dep-graph (4 tests) | Plain NW, BTP ABAP | S/4HANA with BOBF |
| `NO_FIXTURE (I_ABAPPACKAGE)` | `adt.integration.test.ts` CDS impact classifier (2 tests) | Plain NW, BTP ABAP | S/4HANA any release |

**When to investigate:** If any of these fire on an S/4HANA system, the Flight Reference Scenario package may not be deployed, or the user lacks authorization to read `/DMO/*`.

## Category 2 — Release gap (pre-7.52 / pre-RAP)

**What it is:** ADT endpoints or content types that didn't exist yet on older SAP_BASIS levels. These are the issue #162 core cases — the probe should have already classified the underlying endpoint as `unavailable-*` before the test even runs.

| Skip message fragment | Affected tests | Typical on | Should NOT skip on |
|---|---|---|---|
| `BACKEND_UNSUPPORTED: DOMA reads not supported on this release` | `adt.integration.test.ts` domain metadata (MANDT, BUKRS) (2 tests) | NW 7.50–7.51 | SAP_BASIS ≥ 7.52 |
| `BACKEND_UNSUPPORTED: /datapreview/ddic endpoint not available on this release` | `adt.integration.test.ts` table contents, POST/CSRF session (4 tests) | NW 7.50 (depends on SP/activation) | Most modern releases |
| `BACKEND_UNSUPPORTED: API release collection absent` | `api-release.integration.test.ts` | NW 7.50 | Systems advertising `/apireleases` |
| `/ddic/tables collection not available on this release` | E2E fixture sync | NW 7.50/7.51 without the table collection | Systems advertising `/ddic/tables` |
| `BACKEND_UNSUPPORTED: ADT domains collection absent` | `llm-arg-normalization.integration.test.ts` DOMA lifecycle | Systems without the domain collection | Systems advertising `/ddic/domains` |
| `ADT quicksearch does not advertise packageName` | `package-contents.integration.test.ts` package-filtered cases | NW 7.50 | Systems advertising the `packageName` quicksearch filter (verified on 758/816) |
| `BACKEND_UNSUPPORTED: /ddic/domains endpoint not available on this release` | `crud.lifecycle.integration.test.ts` DOMA CRUD variants (2 tests) | NW 7.50–7.51 | SAP_BASIS ≥ 7.52 |
| `NW 7.5x ADT_TM gap: release endpoint rejects /newreleasejobs path segment; no client-side workaround` | `transport-release.slow.integration.test.ts` releaseTransportRecursive (1 test) | NW 7.50–7.51 | S/4HANA any release |

**When to investigate:** If `DOMA reads not supported` fires on a ≥ 7.54 system, double-check that the ICF service `/sap/bc/adt/ddic` is active in SICF.

Transport creation uses `POST /sap/bc/adt/cts/transports`, verified on NW 7.50 SP02 and S/4HANA. Reassignment sends the owner in both the `targetuser` query parameter (read by 7.50) and the XML body (read by newer CTS handlers); it no longer skips on 7.50. Recursive release remains unsupported there: `POST /transportrequests/{id}/newreleasejobs` returns *"user action newreleasejobs is not supported"*, with no verified client-side workaround.

### `/datapreview/ddic` and `/datapreview/freestyle` routing failures

The 7.50 test system returns HTTP 404 "No suitable resource found" for these collections even though discovery advertises data preview. Native checks found the freestyle handler and its resource registration; the effective routing failure remains unresolved. Do not infer that SQL is unsupported on every 7.50 system or that activating an ICF node will fix this instance. SAP KBA 3128830 is troubleshooting guidance, not a confirmed diagnosis.

Only a verified collection refusal is a backend skip. Authentication errors and unexpected request failures must remain failures.

### Fixture prerequisites across releases

- `SABP_UNIT` children and T000's ADT source format vary by release; reads assert the shared contract.
- Predefined DTEL creation runs independently of DOMA creation. Unsupported domain/table/package writes use ARC-1's explicit discovery refusal.
- Fixtures using `DEFINE VIEW ENTITY` require SAP_BASIS 755 or newer. This is a fixture limit, not a claim that older systems lack classic CDS or DCL. Behavior-extension tests also require the table and behavior collections.
- RAP E2E tests probe features before deciding availability; an unpopulated feature cache is not a skip reason.
- Optional `ZCL_ABAPGIT_HASH` coverage and `ZC_FBCLUBTP` documentation are missing-fixture skips when absent. A "No Knowledge Transfer Document" response does not pass the decoded-content test.
- A 404 from `/packages/valuehelps/transportlayers` skips that value-help test only; other transport tests still run.

Program lifecycle tests use unique names and require successful activation. The separately reproduced
7.50 metadata gap after an absent-program pre-delete remains [COMPAT-18](../docs_page/roadmap.md#compat-18),
not an unsupported-backend skip.

### Root cause: DTEL v2 content-type 415 on older releases

ARC-1 originally posted DTEL create/update with `Content-Type: application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8`. Older SAP_BASIS releases (pre-7.52) only accept the v1 MIME type `…dataelements.v1+xml` — same XML body, different MIME version suffix.

**Fixed** in `src/adt/crud.ts` via a static `CONTENT_TYPE_FALLBACKS` map: on HTTP 415 for the v2 MIME type, `createObject` and `updateObject` transparently retry once with the v1 MIME type. DTEL create now works across releases. Follow-up DTEL updates (lock → PUT) may still hit the lock-handle 423 issue on NW < 7.51 systems without the `abapfs_extensions` enhancement — see below.

## Category 3 — Backend quirk (trial systems, unstable services)

**What it is:** Individual SAP services that either behave quirkily on trial editions or have known release-specific bugs (ABAP dumps, session-correlation oddities).

| Skip message fragment | Affected tests | Typical on | Should NOT skip on |
|---|---|---|---|
| `BACKEND_UNSUPPORTED: lock-handle session correlation differs on this release` | `crud.lifecycle.integration.test.ts` full PROG lifecycle, DTEL CRUD update step, RAP write + SKTD + MSAG on E2E | NW < 7.51 without the `abapfs_extensions` enhancement | NW ≥ 7.51, or any release with `abapfs_extensions` installed |

### Root cause: persistent lock-handle 423 after successful LOCK

On **SAP_BASIS < 7.51** the ADT REST handler `CL_REST_HTTP_HANDLER` does not honor the `X-sap-adt-sessiontype: stateful` header over HTTP (the 7.51+ mechanism `CONFIGURE_SESSION_STATE` in `CL_ADT_WB_RES_APP` does not exist). The session reverts to stateless, the ENQUEUE lock is released, and the PUT after a successful LOCK fails with `423 invalid lock handle`. Validated live on NPL 7.50 (423 before, 200 after the fix); a4h (kernel 7.58) works natively.

**Fix:** install the [`abapfs_extensions`](https://github.com/marcellourbani/abapfs_extensions) enhancement on the SAP system (abapGit import, or a manual implicit enhancement on `CL_REST_HTTP_HANDLER`). Once installed, these skips no longer fire — the NPL test instance now passes these writes. See [docs_page/sap-trial-setup.md](../docs_page/sap-trial-setup.md) (423 troubleshooting) for both install paths.

> **SAP Note 2727890** ("ADT: fix unstable adt lock handle", `BC-DWB-AIE`) is a *separate, narrow* bug for lock handles containing `+` characters — it is **not** this issue and does not fix it (confirmed: reporters with the note applied on 7.40 still fail). The error hint (`category: enqueue-error`) is release-aware: on a detected < 7.51 system it points at `abapfs_extensions`.
| `BACKEND_UNSUPPORTED: PageChipInstances service unstable on this release` | `adt.integration.test.ts` FLP lists tiles | NW 7.50, some older S/4 | Recent S/4 |
| `BACKEND_UNSUPPORTED: scope denied` (transport test) | `transport.integration.test.ts` type-W/R (customizing, repair) | Systems where user lacks `S_TRANSPRT` for non-K types | Full-privilege users |

**When to investigate:** Lock-handle issues on a non-trial system are unusual and worth reporting (potential session/cookie handling bug). PageChipInstances 500s on a recent S/4 are an FLP content/config issue, not an ARC-1 bug.

## Category 4 — Infrastructure gap (fixture not seeded)

**What it is:** ARC-1's own persistent test fixtures haven't been materialized on this SAP box. Running `npm run test:e2e` once seeds them.

| Skip message fragment | Affected tests | Fix |
|---|---|---|
| `NO_FIXTURE (ZARC1_TEST_REPORT) — run npm run test:e2e once to seed` | `cache.integration.test.ts` report source-cache tests (11 tests) | Run `npm run test:e2e` once against the target system |
| `NO_FIXTURE (ZCL_ARC1_TEST)` | `cache.integration.test.ts` class conditional-read test (1 test) | Run `npm run test:e2e` once against the target system |

**When to investigate:** Seeing this after `npm run test:e2e` succeeded is a fixture-sync bug.

## Category 5 — Policy / credentials

**What it is:** Environment variables controlling optional features aren't set, or the test user lacks authorization.

| Skip message fragment | Affected tests | Typical cause |
|---|---|---|
| `TEST_TRANSPORT_PACKAGE not configured` | transport-scoped CRUD (~3 tests) | Opt-in: set `TEST_TRANSPORT_PACKAGE=Z_LLM_TEST_PACKAGE`; write paths additionally require `TEST_TRANSPORT_PACKAGE_WRITE_TESTS=true` |
| `TEST_TRANSPORT_PACKAGE_WRITE_TESTS not enabled` | transportable-package write cleanup can leave locked CTS tasks | Expected on shared SAP systems unless running a manual destructive cleanup experiment |
| `NO_FIXTURE (RSHOWTIM)` | search by pattern (1 test) | RSHOWTIM report not on this system |
| `NO_FIXTURE: set TEST_APPLICATION_LOG_NUMBERS` | `application-log.integration.test.ts` (1) | No stable saved logs configured; set 1–10 exact log numbers for a read-only qualification run. Configured fixtures must succeed, including native authorization. |

**When to investigate:** Basic integration helpers require URL, user and password and fail setup if any is missing. Dedicated BTP suites skip when their service-key configuration is absent; that is not BTP test coverage.

## Category 6 — Unimplemented / uninstalled features

| Skip message fragment | Affected tests | Typical on |
|---|---|---|
| `gCTS integration` skips (whole suite) | `gcts.integration.test.ts` | Systems without gCTS configured |
| `abapGit` skips (whole suite) | `abapgit.integration.test.ts` | Systems without abapGit installed |
| `NO_DDLS — no DDLS readable on this system` | CDS-related dep/impact tests | Pre-CDS systems |
| `NO_DUMPS — no short dumps on this system` | diagnostics dump tests | Freshly booted systems |

## Typical skip profile per system (integration)

The counts below are historical observations, not current release thresholds. Suite sizes and fixtures have changed; compare named skip reasons with a fresh baseline from the same revision and target.

| System | Typical skip count | Categories that dominate |
|---|---|---|
| **NW 7.50 trial** (e.g. `npl.marianzeis.de`) | ~120 / 207 tests | Cat 1 (S/4 demo), Cat 2 (release gap), Cat 3 (trial quirks) |
| **S/4HANA 2023** (e.g. `a4h.marianzeis.de`) | ~40 / 207 tests | Cat 5 (no transport package), Cat 6 (abapGit/gCTS not installed), some Cat 4 |
| **ABAP Platform 2025** (SAP_BASIS 816, e.g. `a4h-2025.marianzeis.de`) | ~54 / 262 default-profile tests | Reads, release detection, write+activate, and CRUD lifecycle are validated on the tuned 2025 trial. Cat 6 dominates where optional backends are absent: the abapGit ADT bridge is **not installed** on the 2025 trial, so SAPGit tests skip. Local 2026-06-06 default-profile baseline: 208 passed / 54 skipped. |
| **BTP ABAP (cloud)** | ~80 / 207 tests | Cat 1 (no /DMO), Cat 2 (DDIC changes on cloud), Cat 5 (policy) |

Fixture sync also skips a dependent fixture when its declared prerequisite was skipped, retaining that reason. For example, an unavailable managed table prevents creation of its root and projection CDS views; unrelated fixtures still run.

Investigate newly skipped scenarios, especially previously working features or managed fixtures. Do not use these historical totals as a pass/fail threshold.

## E2E-specific skip sources

The E2E suite calls tools end-to-end through a running MCP server. The integration categories above still apply, plus a few E2E-only ones.

### E2E cat α — Fixture sync failure cascade

E2E's fixture sync (`tests/e2e/sync-fixtures.ts`) seeds managed Z-namespace persistent objects (`ZCL_ARC1_TEST`, `ZI_ARC1_I33_ROOT`, etc.) before tests run. If sync fails for a given fixture because of a **backend quirk** (same 7.50 lock-handle 423 issue, DOMA 404), that single fixture goes into a `summary.skipped` list and the suite continues — tests that expect it then auto-skip via `expectToolSuccessOrSkip()`.

| Skip message fragment | Root cause | Typical on |
|---|---|---|
| `NO_FIXTURE: ZCL_ARC1_TEST not found — run npm run test:e2e:fixtures first` | Fixture not materialized on target system | Fresh SAP box, systems where sync was skipped |
| `NO_FIXTURE (ZI_ARC1_I33_ROOT) — fixture sync skipped this object` | DDLS create failed during sync (likely lock-handle 423 on 7.50) | NW 7.50 trial |
| `NO_FIXTURE (/DMO/CL_FLIGHT_LEGACY) — S/4 Flight Reference Scenario, not on this release` | Upstream S/4 demo content not shipped on plain NetWeaver | Plain NW, BTP ABAP |

### E2E cat β — Soft "placeholder" responses from read tools

Several SAPRead types return a human-readable placeholder (not an MCP error) when the requested object doesn't exist. Tests that parse the result as JSON need to detect the placeholder first.

| Placeholder string | Handled in | Action |
|---|---|---|
| `"No metadata extension (DDLX) found for ..."` | `rap.e2e.test.ts` DDLX tests | Treated as `NO_FIXTURE` skip |
| `"No version ..."` (plain-text, not JSON) | `revisions.e2e.test.ts` | Detected before `JSON.parse` via `parseVersionsOrSkip()` helper |
| `"Version source endpoint unavailable or fixture missing"` | Version-history tests | Same path — skip |
| Empty `tran.program` on `TRAN` read | `smoke.e2e.test.ts` SE38 read | Skip with backend-unsupported reason |
| `"Table ... not found"` from `SAPQuery` | `smoke.e2e.test.ts` | Fallback for absent `/datapreview/ddic` endpoint |

### E2E cat γ — PrettyPrinter keyword-case preference

`SAPLint action=format` honors the SAP user's configured keyword case (`keywordUpper`, `keywordLower`, `keywordAuto`, `none`). Tests must probe `get_formatter_settings` before asserting specific casing, rather than hardcoding `REPORT`/`DATA` uppercase. Not a skip per se — a test-robustness fix in `smoke.e2e.test.ts`.

### Historical E2E skip profile

| System | Typical E2E skip count | Categories that dominate |
|---|---|---|
| **NW 7.50 trial** | ~50 / 122 tests | Cat 2 (release gap), Cat 3 (lock-handle 423), E2E-α (fixture sync partial), Cat 1 (/DMO missing) |
| **S/4HANA 2023** | 3 / 122 tests | Cat 5 (no transport package / `--allow-git-writes`) |
| **ABAP Platform 2025** (SAP_BASIS 816) | 4 / 141 default-profile tests when stable | Cat 5 + abapGit ADT bridge absent on the trial (SAPGit tests skip). Local 2026-06-06 default-profile baseline: 137 passed / 4 skipped. LOCK/UNLOCK HTTP 400 `Service cannot be reached` (`400 Session not found`) fails the test; failures were associated with new SAP logon bursts, but the SAP-internal cause remains inferred. See the [session investigation](research/2026-09-27-sap-816-session-failures.md). |
| **BTP ABAP** | ~30 / 122 tests | Cat 5 (policy), some of Cat 1 |

Compare the current revision's per-test results and fixture-sync summary. Quickfix tests require their managed class/program fixtures and fail on unexpected errors; a message containing a quickfix URL is not an unsupported-feature reason.

### Manual slow workflow monitoring

`.github/workflows/sap-slow-tests.yml` runs the slow live SAP profiles on demand through the GitHub Actions **SAP Slow Tests** workflow. It uses the same A4H 2025 `TEST_SAP_*` target as the default Test workflow and keeps recursive transport release disabled unless the operator explicitly sets `enable_transport_release_tests=true`.

Use the manual slow workflow to sample expensive coverage that is intentionally outside the PR path: broad where-used scans, RAP full-stack writes, and recursive transport release guards. Compare its skip summary with the default workflow summary. Unexpected ADT lock/unlock failures remain failures; investigate session stability rather than broadening skip rules. The slow integration profile currently contains only the opt-in transport-release test, so its default run skips that test. The workflow's execution-count check is advisory; verify actual executed cases before claiming slow coverage.

## Adding a new skip

When a test needs a new skip condition, keep it categorizable:

1. **Prefer an existing SkipReason constant** — extends this matrix without a doc change.
2. **Pass a specific clause** — `requireOrSkip(ctx, value, \`${SkipReason.NO_FIXTURE} (FOO_BAR) — why\`)` so the summary tool can classify it.
3. **If it's genuinely a new category** (not covered above), add a row to this doc and to the regex in `scripts/ci/summarize-skips.mjs`.

Skip messages are the public API of this taxonomy — changing them means updating both files.

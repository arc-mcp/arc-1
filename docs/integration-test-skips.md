# Integration + E2E test skips — taxonomy

Both the **integration** suite (`npm run test:integration`) and the **E2E** suite (`npm run test:e2e`) are designed to **skip cleanly** (never fail) when the target SAP system lacks a feature, fixture, or policy permission required by a test. A healthy run on *any* system reports some skips — the question is whether the skips match that system's profile.

This doc is the map. When you see a `↓ [SkipReason.…]` line in a test run, look up the category here to understand (a) why it's firing, (b) whether it's expected on your system, and (c) when investigation would be warranted.

Runtime summaries per category are available via:
- `npm run test:integration:skip-summary` (integration suite)
- `npm run test:e2e:skip-summary` (E2E suite)

Both use [scripts/ci/summarize-skips.mjs](../scripts/ci/summarize-skips.mjs) with the same taxonomy.

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
| `BACKEND_UNSUPPORTED: DTEL v2 content type not supported on this release` | `crud.lifecycle.integration.test.ts` DTEL + DOMA+DTEL lifecycle (2 tests) | NW 7.50–7.51 | SAP_BASIS ≥ 7.52 |
| `BACKEND_UNSUPPORTED: /datapreview/ddic endpoint not available on this release` | `adt.integration.test.ts` table contents, POST/CSRF session (4 tests) | NW 7.50 (depends on SP/activation) | Most modern releases |
| `BACKEND_UNSUPPORTED: /ddic/domains endpoint not available on this release` | `crud.lifecycle.integration.test.ts` DOMA CRUD variants (2 tests) | NW 7.50–7.51 | SAP_BASIS ≥ 7.52 |
| `NW 7.5x ADT_TM gap: reassign requires URL-query params on that release; needs release-aware fallback` | `transport.integration.test.ts` reassignTransport (1 test) | NW 7.50–7.51 | S/4HANA any release |
| `NW 7.5x ADT_TM gap: release endpoint rejects /newreleasejobs path segment; no client-side workaround` | `transport.integration.test.ts` releaseTransportRecursive (1 test) | NW 7.50–7.51 | S/4HANA any release |

**When to investigate:** If `DOMA reads not supported` fires on a ≥ 7.54 system, double-check that the ICF service `/sap/bc/adt/ddic` is active in SICF.

**Note (2026-05-08):** The previous *"transport create not supported on this SAP release"* entry was removed when `SAPTransport.create` switched to the `CreateCorrectionRequest` endpoint (`POST /sap/bc/adt/cts/transports`), which works on NW 7.50 SP02 and S/4HANA alike — verified live on `npl.marianzeis.de` and `a4h.marianzeis.de`. **Two related NW 7.5x gaps were uncovered when the create-skip stopped masking them:** (1) reassign — `PUT /transportrequests/{id}` body attributes are silently dropped on NW 7.5x; only URL-query params work, and S/4HANA only accepts the body, so a fix needs release-aware fallback. (2) release — `POST /transportrequests/{id}/newreleasejobs` is rejected with *"user action newreleasejobs is not supported"*; no client-side workaround was found across body / URL-query / PUT-variant probing. Both are pre-existing limitations now visible because create no longer skips the test.

### Root cause: `/datapreview/ddic` 404 "No suitable resource found"

We've seen this on minimally-configured systems where the endpoint IS registered in the discovery doc with full template links, but every verb (GET, POST with SQL body, POST with empty body, the `/metadata` sub-resource, the `/freestyle` alternate) returns `HTTP 404 "No suitable resource found"`. Same class of issue can surface on any SAP release — it just means the ADT framework can't route the URI to any handler.

Two possible root causes:
1. The ICF service node is activated but its handler class isn't bound (check the **Handler List** tab in `tcode SICF`).
2. The service is active with a handler class, but the ADT framework's internal resource registration is missing (typically after incomplete upgrades or on trial/dev-edition SAP installations).

Not fixable from ARC-1 client code. The error classifier (`classifySapDomainError`) surfaces a detailed hint when this comes back (category: `icf-handler-not-bound`), pointing at `tcode SICF` → Handler List + SAP KBA 3128830 ("Troubleshooting ICF 404 Errors").

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
| `NO_FIXTURE (ZCL_ARC1_TEST) — run npm run test:e2e once to seed` | `cache.integration.test.ts` most source-cache tests (11 tests) | Run `npm run test:e2e` once against the target system |

**When to investigate:** Seeing this after `npm run test:e2e` succeeded is a fixture-sync bug.

## Category 5 — Policy / credentials

**What it is:** Environment variables controlling optional features aren't set, or the test user lacks authorization.

| Skip message fragment | Affected tests | Typical cause |
|---|---|---|
| `SAP credentials not configured` | Every integration test | `TEST_SAP_URL` / `TEST_SAP_USER` / `TEST_SAP_PASSWORD` not set |
| `TEST_TRANSPORT_PACKAGE not configured` | transport-scoped CRUD (~3 tests) | Opt-in: set `TEST_TRANSPORT_PACKAGE=Z_LLM_TEST_PACKAGE`; write paths additionally require `TEST_TRANSPORT_PACKAGE_WRITE_TESTS=true` |
| `TEST_TRANSPORT_PACKAGE_WRITE_TESTS not enabled` | transportable-package write cleanup can leave locked CTS tasks | Expected on shared SAP systems unless running a manual destructive cleanup experiment |
| `NO_FIXTURE (RSHOWTIM)` | search by pattern (1 test) | RSHOWTIM report not on this system |

**When to investigate:** Credentials skipping everything is the expected state on a machine without SAP access. Everything else is a deliberate opt-in.

## Category 6 — Unimplemented / uninstalled features

| Skip message fragment | Affected tests | Typical on |
|---|---|---|
| `gCTS integration` skips (whole suite) | `gcts.integration.test.ts` | Systems without gCTS configured |
| `abapGit` skips (whole suite) | `abapgit.integration.test.ts` | Systems without abapGit installed |
| `NO_DDLS — no DDLS readable on this system` | CDS-related dep/impact tests | Pre-CDS systems |
| `NO_DUMPS — no short dumps on this system` | diagnostics dump tests | Freshly booted systems |

## Typical skip profile per system (integration)

A quick sanity-check for "is my run healthy?":

| System | Typical skip count | Categories that dominate |
|---|---|---|
| **NW 7.50 trial** (e.g. `npl.marianzeis.de`) | ~120 / 207 tests | Cat 1 (S/4 demo), Cat 2 (release gap), Cat 3 (trial quirks) |
| **S/4HANA 2023** (e.g. `a4h.marianzeis.de`) | ~40 / 207 tests | Cat 5 (no transport package), Cat 6 (abapGit/gCTS not installed), some Cat 4 |
| **ABAP Platform 2025** (SAP_BASIS 816, e.g. `a4h-2025.marianzeis.de`) | ≈ S/4HANA 2023 profile (reads), + see note | Reads + release detection fully validated (full RAP/CDS surface, `adt.integration` 97/114). Cat 6 (abapGit ADT bridge **not installed** on the 2025 trial → SAPGit tests skip). **Note:** the as-migrated 2025 container is *not* perf-tuned like 2023 — concurrent write+activate (DDLS/TABL) intermittently hits ABAP `STACK_TRACE_ERROR` short-dumps + 30 s timeouts. The same tests pass on the tuned 2023 box; tune `rdisp/wp_no_dia` + ICM threads (see `INFRASTRUCTURE.md`) before using 2025 as a write/activate CI target. |
| **BTP ABAP (cloud)** | ~80 / 207 tests | Cat 1 (no /DMO), Cat 2 (DDIC changes on cloud), Cat 5 (policy) |

Large deviations from these counts on a given system are the signal. If an S/4HANA box suddenly skips 120+ tests, something broke in fixture sync or auth — the matrix helps identify which category lit up.

## E2E-specific skip sources

The E2E suite calls tools end-to-end through a running MCP server. The integration categories above still apply, plus a few E2E-only ones.

### E2E cat α — Fixture sync failure cascade

E2E's fixture sync (`tests/e2e/sync-fixtures.ts`) seeds managed Z-namespace persistent objects (`ZCL_ARC1_TEST`, `ZI_ARC1_I33_ROOT`, etc.) before tests run. If sync fails for a given fixture because of a **backend quirk** (same 7.50 lock-handle 423 issue, DTEL 415, DOMA 404), that single fixture goes into a `summary.skipped` list and the suite continues — tests that expect it then auto-skip via `expectToolSuccessOrSkip()`.

| Skip message fragment | Root cause | Typical on |
|---|---|---|
| `NO_FIXTURE (ZCL_ARC1_TEST) — run npm run test:e2e once to seed` | Fixture not materialized on target system | Fresh SAP box, systems where sync was skipped |
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

### Typical E2E skip profile

| System | Typical E2E skip count | Categories that dominate |
|---|---|---|
| **NW 7.50 trial** | ~50 / 122 tests | Cat 2 (release gap), Cat 3 (lock-handle 423), E2E-α (fixture sync partial), Cat 1 (/DMO missing) |
| **S/4HANA 2023** | 3 / 122 tests | Cat 5 (no transport package / `--allow-git-writes`) |
| **ABAP Platform 2025** (SAP_BASIS 816) | ≈ S/4HANA 2023 profile | Cat 5 + abapGit ADT bridge absent on the trial (SAPGit tests skip) |
| **BTP ABAP** | ~30 / 122 tests | Cat 5 (policy), some of Cat 1 |

Anything over ~5 skips on S/4HANA is a regression signal — most likely a broken fixture sync or an unintended breaking change to a SAPRead handler output.

## Adding a new skip

When a test needs a new skip condition, keep it categorizable:

1. **Prefer an existing SkipReason constant** — extends this matrix without a doc change.
2. **Pass a specific clause** — `requireOrSkip(ctx, value, \`${SkipReason.NO_FIXTURE} (FOO_BAR) — why\`)` so the summary tool can classify it.
3. **If it's genuinely a new category** (not covered above), add a row to this doc and to the regex in `scripts/ci/summarize-skips.mjs`.

Skip messages are the public API of this taxonomy — changing them means updating both files.

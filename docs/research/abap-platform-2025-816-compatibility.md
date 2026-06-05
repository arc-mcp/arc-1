# ABAP Platform 2025 (SAP_BASIS 816) — arc-1 Compatibility Research & Implementation Backlog

**Status:** research complete; the 8xx abaplint false-positive blocker is implemented on `main` (PR #350, released in 0.9.11). Remaining work is 2025 write-path validation, table-entity coverage, and one server-driven-object spike.
**Date:** 2026-06-05.
**How verified:** live tests against `a4h-2025.marianzeis.de:50100` (SAP_BASIS **816**) and `a4h.marianzeis.de:50000` (SAP_BASIS **758**), plus tsx harnesses running arc-1's actual parsers/linter, plus SAP-sourced research (`SAP/abap-file-formats`, ABAP `ABENNEWS-816-*` docs, ABAP Platform 2025 What's New).
**Companion docs:** [`abap-platform-2025-new-adt-apis.md`](./abap-platform-2025-new-adt-apis.md) (the 124 new ADT endpoints), PR #347 (816 added as a validated probe target).

This doc is written so a future session can pick up **any single item** and implement it: each has a verdict, the live evidence, and a concrete file-level plan + tests.

---

## TL;DR — what to do next after release 0.9.11

| # | Topic | Verdict | Action | Effort |
|---|-------|---------|--------|--------|
| **2.2** | **Writes on the 2025 container** | ✅ **done (2026-06-05)** | Tuning applied (`wp_no_dia=40`, `PHYS_MEMSIZE=8192`, ICM threads). 816 CRUD lifecycle now **7/7** (was flaky write+activate). ⚠️ needs an ephemeral-port reservation after each container restart — see §2.2. | — |
| **1.3** | **CDS table entity create/read** | ⚠️ routing/lint OK; live write validation blocked by 2.2 | After 2.2, add a focused table-entity lifecycle test on 816. | S |
| **3.1** | **Server-driven-object read/write** | ✅ **done** (read #356; write 2026-06-05) | Generic discovery-gated engine `src/adt/server-driven.ts`: read (`SAPRead`) + write (`SAPWrite create/update/delete` + `SAPActivate`) for DESD/EVTB/DTSC/CSNM/EVTO/COTA. Live-verified create on all 6 (816); DESD full round-trip. See §3.1 below. | M |
| **1.2** | **abaplint v758 false-positive-blocks 816 syntax** | ✅ **implemented** | No action now. Keep `ABAPLINT_MAX_RELEASE` and release mapping coupled when abaplint gains newer grammar. | — |
| 1.1 | Existing parsers on 816 (objectstructure etc.) | ✅ pass | None (optional: capture a 816 objectstructure fixture) | XS |
| 2.1 | `rap-preflight` on 816 | ✅ correct | None (document) | — |
| 2.3 | gCTS / abapGit on 816 | ✅ gCTS works; abapGit absent on trial | None (document) | — |
| 3.2 | abap-file-formats `release_state` | ℹ️ not a repo field | Source release state from ADT runtime instead | — |
| 4.x | SAP_ABA parse / discovery parse / 2025 auth | ✅ safe | None (TLS 1.2+ hygiene only) | — |

**Recommendation:** do not spend the next PR on lint. That bug is already fixed on current `main`. The next useful order is: **(1) tune the 2025 container for write+activate stability, (2) add the 816 CDS table-entity lifecycle validation, (3) spike one real server-driven-object round-trip**, then decide whether generic SDO support is worth implementing.

> **Update (2026-06-05):** 1.2 shipped in #350 (release 0.9.11). The first *new-API* 816 capability also landed — `SAPDiagnose action=cds_testcases` (CDS Test Double Framework test-case suggestions, read-only, discovery-gated 8.16+). See the companion new-APIs doc §5.1 and `docs/plans/completed/add-cds-test-cases-scaffolding.md`.

---

## Tier 1 — does arc-1 work on 816 today?

### 1.1 — Existing parsers handle 816 responses ✅ PASS

**Why it matters:** the probe proved *availability*, not that arc-1's XML parsers handle 816's response shapes. `parseClassStructure` is the only parser with release-branched logic (7.50 split `CLAS/OO`+`CLAS/OM` vs 7.58 unified `CLAS/OM`), so it's the regression risk.

**Live evidence** — `GET /oo/classes/CL_ABAP_TYPEDESCR/objectstructure` on both systems returned the **identical shape**:
```
[816] root=abapsource:objectStructureElement  types=[CLAS/OA,OC,OCX,OF,OK,OM,OT]
[758] root=abapsource:objectStructureElement  types=[CLAS/OA,OC,OCX,OF,OK,OM,OT]
```
816 uses the **unified `CLAS/OM`** (no 7.50-style `CLAS/OO` split). Running arc-1's actual parser:
```
[816] parseClassStructure OK: methods=13 attributes=57
[758] parseClassStructure OK: methods=13 attributes=56
```
(The 56→57 attribute delta is just CL_ABAP_TYPEDESCR gaining one attribute on 2025 — not a parse issue.) `parseInstalledComponents` + `parseSyntaxConfigurations` were already verified on 816 in PR #347. All other parsers (`parseDomain`, `parseDataElement`, `parseFunctionGroup`, message-class, package-contents, inactive-objects, search) have **no release-version branch** — they key on stable root elements/namespaces (confirmed by code sweep).

**Verdict:** no parser regression on 816. **Optional polish:** capture a 816 `objectstructure` fixture (`tests/fixtures/xml/objectstructure-clas-a4h-816.xml`) alongside the existing `{a4h-758,npl-750}` ones so `parseClassStructure` has explicit 816 coverage. Low value; do only if touching that area.

### 1.2 — abaplint v758 false-positive-blocks 816 syntax ✅ IMPLEMENTED

**Why it matters:** arc-1's pre-write lint pins abaplint to `v758` for any 8xx release (`mapSapReleaseToAbaplintVersion('816') → v758` — correct, since abaplint has no v759/816). But abaplint's *parser grammar* is therefore behind the release, so **legitimate new 816 syntax fails to parse**, and `parser_error`/`cds_parser_error` are treated as **blocking** write errors.

**Original live evidence before the fix** — `validateBeforeWrite(src, file, {abapRelease:'816', systemType:'onprem'})`:
```
CDS table entity  `define table entity ZTE {...}`      → pass=false  [cds_parser_error: CDS Parser error]   ❌
READ TABLE itab ... WHERE table_line > 2  (816)        → pass=false  [parser_error: Statement does not exist in ABAPv758, "READ"]  ❌
define view entity ... (classic CDS, control)          → pass=true   ✓
plain class / factorial() (controls)                   → pass=true   ✓
```
And critically, **abaplint `Cloud` fails too** (tested `systemType:'btp'` → same `cds_parser_error`/`parser_error`). So **mapping 8xx→Cloud does NOT help** — abaplint has no grammar for these constructs in any version.

**Old blocking mechanism** (confirmed mechanism before PR #350): `runPreWriteLint` (`src/handlers/intent.ts`) →
- `LINTABLE_TYPES = {PROG, CLAS, INTF, INCL, DDLS}` (line **5542**)
- calls `validateBeforeWrite(..., {abapRelease: cachedFeatures?.abapRelease ?? config.abapRelease, ...})` (line **5552**)
- `if (!result.pass)` → returns `{ blocked: true, result: errorResult('Pre-write lint check failed…') }` (lines **5557–5566**)
- the SAPWrite caller returns that error → **the PUT never happens**.

Before PR #350, a 816 system could wrongly block **`SAPWrite` of a CDS table entity, or any CLAS/PROG/INTF/INCL using new 816 ABAP statements** unless the caller disabled pre-write lint. That is now fixed on `main`.

**The new-816 syntax surface that trips this** (from `ABENNEWS-816-*`, on-prem docs — non-exhaustive): CDS `DEFINE TABLE ENTITY` / `DEFINE EXTERNAL ENTITY` / aspects / entity buffers / writable view entities / `EXPOSE METHOD`; RAP BDL `default function`, `auxiliary class`, `with friends`, non-root `authorization master`, `for side effects`, treeview `instance hierarchy`/`reorder action`; ABAP `READ TABLE … WHERE`, dynamic `SELECT`/`WITH`/`OPEN CURSOR`, `OPTIONS` clause, spatial `ST_*` functions, new numeric built-ins (`factorial`/`binomial`/`ERF`/`GAMMA`), `TABLE KEY … COMPONENTS`, EML `FORWARDING PRIVILEGED`. abaplint v758 knows none of these.

#### Implementation status (PR #350)

- `src/adt/features.ts` exports `ABAPLINT_MAX_RELEASE = 758` plus `isBeyondAbaplintCeiling(release)`.
- `src/lint/config-builder.ts` demotes `parser_error` and `cds_parser_error` to `Warning` in both `buildPreWriteConfig()` and `buildLintConfig()` when the raw SAP_BASIS release is beyond abaplint's grammar ceiling.
- `tests/unit/adt/features.test.ts` locks the ceiling behavior: `816`, `800`, and `759` are beyond the ceiling; `758` and below are not.
- `tests/unit/lint/lint.test.ts` proves the intended behavior: on `816`, a CDS table entity and `READ TABLE ... WHERE` no longer block pre-write lint; on `758`, the same parser failures still block.
- `CLAUDE.md` now documents the 8xx lint behavior and the coupling between `ABAPLINT_MAX_RELEASE` and `mapSapReleaseToAbaplintVersion()`.

**Re-bump path:** when `@abaplint/core` ships a v759/816 grammar, raise `ABAPLINT_MAX_RELEASE` and the `mapSapReleaseToAbaplintVersion` branch together; the demotion then self-disables for releases abaplint can parse.

### 1.3 — CDS table entity (`DEFINE TABLE ENTITY`) end-to-end ⚠️ blocked by 2025 write tuning

**Why it matters:** the flagship 2025 dev object. It's a **DDLS source** (which arc-1 already read/writes via `/ddic/ddl/sources`) created with `DEFINE TABLE ENTITY`, plus a separate **DTSC** buffer sidecar object (see the new-APIs doc).

**Findings:**
- **Create routing is correct:** the `intent.ts` guard `/\bdefine\s+table\s+(entity|function)\b/i` + `releaseNum < 757` (intent.ts:2814–2828) **allows** 816 (816 > 757). No routing change needed.
- **Pre-write lint no longer blocks 816 table entities:** PR #350 demotes the expected `cds_parser_error` false positive to a warning when SAP_BASIS is beyond abaplint's ceiling.
- **Live create/update/activate validation is still pending:** the 2025 container write path hit DDLS/TABL short dumps and 30 s timeouts before the container received the 2023 performance tuning.
- The DTSC buffer is a separate server-driven object (see 3.1) — not required to create the entity itself.

**Plan:** after 2.2 tuning, add an integration test that creates a CDS table entity in `$TMP` on the 816 system and activates it. The test should keep pre-write lint enabled so it proves both the new 8xx lint demotion and the live SAP write/activation path.

---

## Tier 2 — write-path & RAP correctness

### 2.1 — `rap-preflight` on 816 ✅ CORRECT

`isOnPrem75x` (`src/adt/rap-preflight.ts:433`) is `systemType==='onprem' && release in [750,759]`. For 816 it returns **false**, so the five 7.5x-only rules are **skipped** — which is correct, because they encode NW-7.50 quirks (`abap.uname`/`utclong`/`boolean` forbidden in TABL, projection `use etag` unsupported, on-prem DDLX annotation-scope limits) that **don't exist on 816**. The universal rules (currency/unit consistency, BDEF auth-master, duplicate-etag, DDLX duplicate-UI, DDLS client-field) still apply. **No action.** (If SAP ever adds *new* 8xx-specific RAP restrictions, they'd need new rules — none known today.)

### 2.2 — Writes on the 2025 container ✅ DONE (with an ephemeral-port caveat)

The `adt.integration` run on 816 originally passed **97/114** (all reads) but write+activate hit ABAP `STACK_TRACE_ERROR` short-dumps + 30 s timeouts on DDLS/TABL — proven environmental (the same tests pass on the tuned 2023 box). Root cause: the 2025 container was migrated "as-is" **without** the 2023 box's perf-tuning — it shipped with only **`rdisp/wp_no_dia=7`** and **`PHYS_MEMSIZE=2048`** (→ `em/initial_size_MB=1434`).

**Applied (2026-06-05)** to the `a4h-2025` instance profile `/sapmnt/A4H/profile/A4H_D00_vhcala4hci` (backed up first), matching the 2023 box:
- `rdisp/wp_no_dia = 40` (was 7) — the main fix; 40 DIA work processes now.
- `PHYS_MEMSIZE = 8192` (was 2048; the profile had a duplicate line with 2048 winning) → `em/initial_size_MB = 5734`.
- `icm/max_threads = 200`, `icm/min_threads = 30`, `icm/keep_alive_timeout = 15`, `abap/heap_area_total = 4000000000`, `rdisp/max_wprun_time = 300`, `http/security_session_timeout = 120`, `rdisp/plugin_auto_logout = 120`.

**Result:** `npm run test:integration:crud` against 816 → **7/7 pass** (full create→read→update→activate→delete + DOMA/DTEL CRUD), 85 s, no STACK_TRACE/timeouts. Write+activate is stable. Unblocks 1.3, the 2.1 integration, and the SDO write path (3.1).

> **⚠️ Ephemeral-port race (gotcha discovered during tuning — read before restarting a4h-2025).** After the restart the ICM came up **HTTP: 0** — it could not bind its listen port **50000** (`NiBuf2Listen … NIESERV_USED`), even though `ss -ltn` showed 50000 free. Cause: the Linux ephemeral range (`32768–60999`) **includes 50000**, and with 40 work processes now opening HANA connections (port 30215) at startup, one grabbed **50000 as its outbound source port** before the ICM bound it — a race the old 7-WP config rarely hit. The container lacks `CAP_NET_ADMIN`, so reserve the SAP ports from the host:
> ```bash
> PID=$(docker inspect -f '{{.State.Pid}}' a4h-2025)
> nsenter -t "$PID" -n sysctl -w net.ipv4.ip_local_reserved_ports=50000-50001,8101
> docker exec a4h-2025 su - a4hadm -c "sapcontrol -nr 00 -function RestartInstance"   # ICM re-binds 50000
> ```
> **This reservation is NOT persistent** — `docker stop/start` recreates the netns and loses it. Re-apply it after every container restart (the ICM may already have come up HTTP:0; `RestartInstance` after reserving fixes it), **or** permanently fix it by recreating the container with `--sysctl net.ipv4.ip_local_reserved_ports=50000-50001,8101`. Verify: `curl http://a4h-2025.marianzeis.de:50100/sap/bc/adt/discovery` → expect `401`.

### 2.3 — gCTS / abapGit on 816 ✅ gCTS works; abapGit absent on trial

Live probe:
```
            /sap/bc/cts_abapvcs/system   /sap/bc/adt/abapgit/repos
[816]            200 (gCTS available)        404 (bridge NOT installed)
[758]            200                          400 (bridge installed)
```
**gCTS works on 816** → arc-1's `SAPGit` gCTS backend (`src/adt/gcts.ts`) should function. The **abapGit ADT bridge is absent on the 2025 *trial*** (an install difference, not a release change) → arc-1's abapGit backend reports unavailable and SAPGit/abapGit tests skip there. A productive S/4HANA 2025 may have it. **No code action**; the existing feature-probe gating already degrades cleanly. Document in the skip-policy (already noted in PR #347).

---

## Tier 3 — the new-API follow-up (after #347)

### 3.1 — Server-driven-object read + write ✅ DONE

> **Shipped.** Read landed in **#356** (`SAPRead type=DESD|EVTB|EVTO|DTSC|CSNM|COTA`). Write landed
> **2026-06-05**: `SAPWrite action=create|update|delete` + `SAPActivate` for the same 6 types, via the
> same generic engine `src/adt/server-driven.ts`. The write contract was probed live on a4h-2025 (816)
> first: **all 6 types create** with a `<blue:blueSource>` POST (per-type `createType` — NOT uniformly
> `/TYP`; EVTB uses `EVTB/EVB`) and the type's blues content-type (**NOT uniformly v1 — EVTO needs
> `blues.v2+xml`**, the others v1). Source is AFF JSON (`application/json` PUT to `…/source/main`);
> create leaves the object inactive (→ `SAPActivate`). DESD round-tripped end-to-end
> (create→source→activate→read→delete). **Cross-release verified live** (per-type/release-adaptive gate,
> like the read path): on a4h (758) **EVTB write works** (create→read→delete; gate true for EVTB,
> false for the 816-only types → clean "requires 8.16+" error); on npl (7.50) all 6 gate cleanly with
> no crash. The original spike notes below are retained for context.

The new-APIs doc established that ~30 new 816 objects (DTSC, DESD, CSNM, EVTO, SPRV, UIAD/UIPG/UIST, Communication Targets, …) share one AFF mechanism: `…/{name}` + `…/{name}/source/main` with `application/vnd.sap.adt.blues.v1+xml`, and a live `…/$schema` (`application/vnd.sap.adt.serverdriven.schema.v1+json; framework=objectTypes.v1`). Read-by-name **routing** is confirmed (404-for-nonexistent), and `$schema` returns the abap-file-formats JSON schema — but **no real instance was round-tripped** (the trial ships none).

**Spike plan (before building the generic path):** seed ONE object on 816 (a Communication Target via the ADT editor or SE-tooling, or a DTSC once a CDS table entity exists), then via raw HTTP: `GET …/{name}` (metadata) + `GET …/{name}/source/main` (source) + lock → `PUT source/main` → unlock → activate. Confirms: (a) `blues.v1+xml` round-trips, (b) `$schema`-based validation, (c) create prerequisites (e.g. DTSC requires an existing table entity). Only then implement the generic discovery-gated SDO read path sketched in the new-APIs doc (`src/adt/client.ts` `getServerDrivenObject(category,name)`, `intent.ts` dispatch via discovery lookup, `src/probe/catalog.ts` entries with `minRelease:816`).

### 3.2 — abap-file-formats `release_state` ℹ️ NOT A REPO FIELD

Important correction for future work: **`SAP/abap-file-formats` does NOT publish a per-type `release_state`** (verified across all 23 type interfaces/schemas). The repo is authoritative for the *serialization format* (description, JSON schema, layout) only, and its blanket stance is "early phase / not for productive use." To know whether a type is `released`/`deprecated`/`experimental`, query **ADT runtime API-state** per object or SAP's **"Released ABAP Object Types"** list — not the AFF repo. Notable: **INTS/INTM (Intelligent Scenario / Model) are deprecated** — the 816 What's New says Intelligence/BERS scenarios "will be deleted in S/4HANA 2025 FPS01"; **don't** invest in INTS/INTM support. DESD, SFPF (Forms), UIAD/UIPG/UIST are confirmed on-prem; AIF-family is the on-prem/Private-Cloud AIF add-on; several (CSNM, SPRV, SWCR, DCAT, BGQC, COTA, ILMB, SAIA, EVTO/EVTB) could not be pinned to on-prem with primary sources — verify per-type before building.

---

## Tier 4 — confirm-and-move-on (all ✅ safe)

- **4.1 SAP_ABA "75I" alphanumeric parse:** SAFE. Code sweep found **no** path that integer-parses any component release other than `SAP_BASIS` (which stays numeric: 758, 816). `SAP_ABA`/`SAP_UI`/`S4FND` are extracted as strings, never `parseInt`-ed. No action.
- **4.2 discovery doc parse on 816:** SAFE. `parseDiscoveryDocument` uses generic string handling with no count/size/MIME-whitelist assumptions; it already parsed the 352-collection 816 doc (fixture captured in #347) and the new `blues.v1+xml`/`serverdriven.schema.v1+json` types are treated as opaque strings. No action.
- **4.3 2025 platform auth (OAuth PKCE / JWT client auth / TLS 1.3):** SAFE. These are **additive**; the classic ADT auth path (HTTP Basic, logon cookies/SSO tickets, X.509 principal propagation via Cloud Connector) is **unchanged and not deprecated** in 816 (SAP Notes 3694327, 2926224; on-prem What's New has no inbound-auth deprecation — only outbound email OAuth2). TLS 1.3 is offered *by default* but 1.2 still works. **Only prudent action:** ensure the client (undici) negotiates TLS 1.2+ — no auth-flow code change. "Secure by Default" hardening is opt-out and doesn't touch upgraded systems' ICF auth.

---

## Appendix — reproduce the live tests

- **Lint false-positive harness** (offline, no SAP): `validateBeforeWrite('define table entity ZTE { key id : abap.int4; }', 'zte.ddls.asddls', {abapRelease:'816', systemType:'onprem'})` now returns `pass:true` with `cds_parser_error` as a warning. `READ TABLE ... WHERE` on 816 likewise returns `pass:true` with `parser_error` as a warning. The same parser failures still block on `abapRelease:'758'`.
- **Parser parity** (needs 816+758 creds from `.env.infrastructure` `SAP_A4H_2025_*`): `GET /oo/classes/CL_ABAP_TYPEDESCR/objectstructure` (`Accept: application/vnd.sap.adt.objectstructure.v2+xml`) on both → identical `CLAS/OM`-unified shape → `parseClassStructure` succeeds on both.
- **gCTS/abapGit:** `GET /sap/bc/cts_abapvcs/system` (816→200), `GET /sap/bc/adt/abapgit/repos` (816→404, 758→400).

Sources for the 816 syntax surface: `ABENNEWS-816-*` (ABAP Keyword Documentation), [DEFINE TABLE ENTITY](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_DEFINE_TABLE_ENTITY.html), [What's New ABAP Platform 2025](https://help.sap.com/doc/dbd707a7a338430ebb6c0d2544b4bdde/2025.000/en-US/WN_ABAP_PLATFORM_OP2025_EN.pdf), [SAP/abap-file-formats](https://github.com/SAP/abap-file-formats), [abaplint version.ts](https://github.com/abaplint/abaplint/blob/main/packages/core/src/version.ts), SAP Notes 3694327 / 2926224 (auth/TLS).

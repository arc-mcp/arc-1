# ABAP Platform 2025 (SAP_BASIS 816) — arc-1 Compatibility Research & Implementation Backlog

**Status:** research complete; one actionable bug + several follow-ups. Nothing here is implemented yet.
**Date:** 2026-06-05.
**How verified:** live tests against `a4h-2025.marianzeis.de:50100` (SAP_BASIS **816**) and `a4h.marianzeis.de:50000` (SAP_BASIS **758**), plus tsx harnesses running arc-1's actual parsers/linter, plus SAP-sourced research (`SAP/abap-file-formats`, ABAP `ABENNEWS-816-*` docs, ABAP Platform 2025 What's New).
**Companion docs:** [`abap-platform-2025-new-adt-apis.md`](./abap-platform-2025-new-adt-apis.md) (the 124 new ADT endpoints), PR #347 (816 added as a validated probe target).

This doc is written so a future session can pick up **any single item** and implement it: each has a verdict, the live evidence, and a concrete file-level plan + tests.

---

## TL;DR — what to do before/after merging #347

| # | Topic | Verdict | Action | Effort |
|---|-------|---------|--------|--------|
| **1.2** | **abaplint v758 false-positive-blocks 816 syntax** | ❌ **real bug** | **Demote `parser_error`/`cds_parser_error` to non-blocking when release > abaplint ceiling.** Highest priority. | S–M |
| 1.1 | Existing parsers on 816 (objectstructure etc.) | ✅ pass | None (optional: capture a 816 objectstructure fixture) | XS |
| 1.3 | CDS table entity create/read | ⚠️ routing OK, blocked by 1.2 | Fix 1.2; then add a focused test | S (after 1.2) |
| 2.1 | `rap-preflight` on 816 | ✅ correct | None (document) | — |
| 2.2 | Writes on the 2025 container | ⚠️ ops | Perf-tune the container, then re-run CRUD slice | S (ops) |
| 2.3 | gCTS / abapGit on 816 | ✅ gCTS works; abapGit absent on trial | None (document) | — |
| 3.1 | Server-driven-object read/write | 🔬 spike | One real round-trip before building the generic path | M |
| 3.2 | abap-file-formats `release_state` | ℹ️ not a repo field | Source release state from ADT runtime instead | — |
| 4.x | SAP_ABA parse / discovery parse / 2025 auth | ✅ safe | None (TLS 1.2+ hygiene only) | — |

**Recommendation:** **1.2 is the only behavior bug** and is worth doing before relying on arc-1 for writes on any 8xx system. It is independent of #347 and can ship as its own small PR. Everything else is either already-correct (document) or a follow-up spike.

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

### 1.2 — abaplint v758 false-positive-blocks 816 syntax ❌ THE BUG (do this)

**Why it matters:** arc-1's pre-write lint pins abaplint to `v758` for any 8xx release (`mapSapReleaseToAbaplintVersion('816') → v758` — correct, since abaplint has no v759/816). But abaplint's *parser grammar* is therefore behind the release, so **legitimate new 816 syntax fails to parse**, and `parser_error`/`cds_parser_error` are treated as **blocking** write errors.

**Live evidence** — `validateBeforeWrite(src, file, {abapRelease:'816', systemType:'onprem'})`:
```
CDS table entity  `define table entity ZTE {...}`      → pass=false  [cds_parser_error: CDS Parser error]   ❌
READ TABLE itab ... WHERE table_line > 2  (816)        → pass=false  [parser_error: Statement does not exist in ABAPv758, "READ"]  ❌
define view entity ... (classic CDS, control)          → pass=true   ✓
plain class / factorial() (controls)                   → pass=true   ✓
```
And critically, **abaplint `Cloud` fails too** (tested `systemType:'btp'` → same `cds_parser_error`/`parser_error`). So **mapping 8xx→Cloud does NOT help** — abaplint has no grammar for these constructs in any version.

**How it blocks the write** (confirmed mechanism): `runPreWriteLint` (`src/handlers/intent.ts:5514`) →
- `LINTABLE_TYPES = {PROG, CLAS, INTF, INCL, DDLS}` (line **5542**)
- calls `validateBeforeWrite(..., {abapRelease: cachedFeatures?.abapRelease ?? config.abapRelease, ...})` (line **5552**)
- `if (!result.pass)` → returns `{ blocked: true, result: errorResult('Pre-write lint check failed…') }` (lines **5557–5566**)
- the SAPWrite caller returns that error → **the PUT never happens**.

So on a 816 system, **`SAPWrite` of a CDS table entity, or any CLAS/PROG/INTF/INCL using new 816 ABAP statements, is wrongly blocked** (unless the user sets `--lint-before-write=false` or per-call `lintBeforeWrite:false` — the current workaround). This is the same failure class as the FUNC exclusion already documented at intent.ts:5534.

**The new-816 syntax surface that trips this** (from `ABENNEWS-816-*`, on-prem docs — non-exhaustive): CDS `DEFINE TABLE ENTITY` / `DEFINE EXTERNAL ENTITY` / aspects / entity buffers / writable view entities / `EXPOSE METHOD`; RAP BDL `default function`, `auxiliary class`, `with friends`, non-root `authorization master`, `for side effects`, treeview `instance hierarchy`/`reorder action`; ABAP `READ TABLE … WHERE`, dynamic `SELECT`/`WITH`/`OPEN CURSOR`, `OPTIONS` clause, spatial `ST_*` functions, new numeric built-ins (`factorial`/`binomial`/`ERF`/`GAMMA`), `TABLE KEY … COMPONENTS`, EML `FORWARDING PRIVILEGED`. abaplint v758 knows none of these.

#### Implementation plan (1.2)

**Goal:** when the detected release is beyond abaplint's ceiling, `parser_error`/`cds_parser_error` must NOT block the write (abaplint can't be trusted to parse the source). Keep them as advisory warnings; keep real semantic lint rules working on supported releases unchanged.

- **Add a ceiling constant + helper.** In `src/adt/features.ts` (next to `mapSapReleaseToAbaplintVersion`) export `ABAPLINT_MAX_RELEASE = 758` and `isBeyondAbaplintCeiling(release?: string): boolean` (`parseReleaseNumber(release) > ABAPLINT_MAX_RELEASE`). Note `mapSapReleaseToAbaplintVersion` can't be the gate — it already collapses 816→v758, losing the distinction; you must compare the *raw* release.
- **Demote parser errors in `runPreWriteLint`** (`src/handlers/intent.ts:5555–5566`, the surgical spot): after `validateBeforeWrite`, if `isBeyondAbaplintCeiling(configOptions.abapRelease)`, move any `parser_error`/`cds_parser_error` entries from `result.errors` into the non-blocking warning path; only set `blocked:true` if non-parser errors remain. Add a one-line note in the returned warning string: *"lint downgraded: abaplint vMAX is behind SAP_BASIS <release>; relying on activation for syntax validation."*
  - *Alternative (more central):* do it in `src/lint/config-builder.ts` `buildPreWriteConfig` — when `isBeyondAbaplintCeiling`, set `parser_error`/`cds_parser_error` severity to `Info`/`Warning`. Cleaner globally, but also affects `SAPLint action=lint`; decide whether that's desirable (probably yes — same reasoning). The `runPreWriteLint` spot is the minimal-blast-radius choice.
- **Keep `SAP_CHECK_BEFORE_WRITE` + activation as the real validator** on 8xx (already the design for FUNC and unsupported types).
- **Tests** (`tests/unit/handlers/intent.test.ts` + `tests/unit/lint/lint.test.ts`):
  - On `abapRelease:'816'`: `define table entity …` and `READ TABLE … WHERE` → `runPreWriteLint` returns `blocked:false` (with a warning).
  - On `abapRelease:'758'`: a genuine syntax error still returns `blocked:true` (no regression — the demotion must be release-gated, not blanket).
  - `isBeyondAbaplintCeiling('816')===true`, `('758')===false`, `('759')===true`, `(undefined)===false`.
- **Docs:** update CLAUDE.md's lint-pipeline row + `docs/tools.md` lint section to note the 8xx behavior; mention the `--lint-before-write=false` interim workaround.
- **Effort:** small–medium. Self-contained; no SAP needed for the unit tests (the harness in this doc is reproducible offline).

**Re-bump path:** when `@abaplint/core` ships a v759/816 grammar, raise `ABAPLINT_MAX_RELEASE` and the `mapSapReleaseToAbaplintVersion` branch together; the demotion then self-disables for releases abaplint can parse.

### 1.3 — CDS table entity (`DEFINE TABLE ENTITY`) end-to-end ⚠️ blocked by 1.2

**Why it matters:** the flagship 2025 dev object. It's a **DDLS source** (which arc-1 already read/writes via `/ddic/ddl/sources`) created with `DEFINE TABLE ENTITY`, plus a separate **DTSC** buffer sidecar object (see the new-APIs doc).

**Findings:**
- **Create routing is correct:** the `intent.ts` guard `/\bdefine\s+table\s+(entity|function)\b/i` + `releaseNum < 757` (intent.ts:2814–2828) **allows** 816 (816 > 757). No routing change needed.
- **But write is blocked by 1.2:** `define table entity` → `cds_parser_error` → blocked. So **fixing 1.2 is the prerequisite** to writing table entities through arc-1.
- The DTSC buffer is a separate server-driven object (see 3.1) — not required to create the entity itself.

**Plan:** after 1.2 lands, add an integration test that creates a CDS table entity in `$TMP` on the 816 system and activates it (needs the tuned container — see 2.2). Until then, table-entity writes work only with `lintBeforeWrite:false`.

---

## Tier 2 — write-path & RAP correctness

### 2.1 — `rap-preflight` on 816 ✅ CORRECT

`isOnPrem75x` (`src/adt/rap-preflight.ts:433`) is `systemType==='onprem' && release in [750,759]`. For 816 it returns **false**, so the five 7.5x-only rules are **skipped** — which is correct, because they encode NW-7.50 quirks (`abap.uname`/`utclong`/`boolean` forbidden in TABL, projection `use etag` unsupported, on-prem DDLX annotation-scope limits) that **don't exist on 816**. The universal rules (currency/unit consistency, BDEF auth-master, duplicate-etag, DDLX duplicate-UI, DDLS client-field) still apply. **No action.** (If SAP ever adds *new* 8xx-specific RAP restrictions, they'd need new rules — none known today.)

### 2.2 — Writes on the 2025 container ⚠️ OPS PREREQUISITE

The `adt.integration` run on 816 passed **97/114** (all reads) but write+activate hit ABAP `STACK_TRACE_ERROR` short-dumps + 30 s timeouts on DDLS/TABL — proven environmental (the same tests pass on the tuned 2023 box). Root cause: the 2025 container was migrated "as-is" **without** the 2023 box's perf-tuning.

**Plan (ops, not arc-1 code):** apply the 2023 instance-profile tuning to `a4h-2025` — `rdisp/wp_no_dia=40`, `icm/max_threads`/`min_threads`, `icm/keep_alive_timeout`, `PHYS_MEMSIZE`/`em/initial_size_MB` (see the A4H-2023 section of `INFRASTRUCTURE.md`), restart, then re-run `npm run test:integration:crud` against 816. This unblocks **all** write-path validation (1.3, 2.1 integration, 3.1).

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

### 3.1 — One real server-driven-object round-trip 🔬 SPIKE

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

- **Lint false-positive harness** (offline, no SAP): `validateBeforeWrite('define table entity ZTE { key id : abap.int4; }', 'zte.ddls.asddls', {abapRelease:'816', systemType:'onprem'})` → `pass:false, errors:[cds_parser_error]`. Same with `systemType:'btp'` (Cloud) → still fails. Controls (`define view entity …`, plain class) → `pass:true`.
- **Parser parity** (needs 816+758 creds from `.env.infrastructure` `SAP_A4H_2025_*`): `GET /oo/classes/CL_ABAP_TYPEDESCR/objectstructure` (`Accept: application/vnd.sap.adt.objectstructure.v2+xml`) on both → identical `CLAS/OM`-unified shape → `parseClassStructure` succeeds on both.
- **gCTS/abapGit:** `GET /sap/bc/cts_abapvcs/system` (816→200), `GET /sap/bc/adt/abapgit/repos` (816→404, 758→400).

Sources for the 816 syntax surface: `ABENNEWS-816-*` (ABAP Keyword Documentation), [DEFINE TABLE ENTITY](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_DEFINE_TABLE_ENTITY.html), [What's New ABAP Platform 2025](https://help.sap.com/doc/dbd707a7a338430ebb6c0d2544b4bdde/2025.000/en-US/WN_ABAP_PLATFORM_OP2025_EN.pdf), [SAP/abap-file-formats](https://github.com/SAP/abap-file-formats), [abaplint version.ts](https://github.com/abaplint/abaplint/blob/main/packages/core/src/version.ts), SAP Notes 3694327 / 2926224 (auth/TLS).

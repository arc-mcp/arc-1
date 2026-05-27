# TABL — Table / Structure (DDIC)

## TL;DR
`TABL` is the canonical TADIR R3TR type covering both transparent tables (DD02L `TABCLASS=TRANSP`) and DDIC structures (`TABCLASS=INTTAB`/`APPEND`). ADT splits these into two slash subtypes: `TABL/DT` (transparent table, URL `/sap/bc/adt/ddic/tables/`) and `TABL/DS` (structure, URL `/sap/bc/adt/ddic/structures/`). PR #219 collapsed both into ARC-1's single canonical short `TABL` and removed the bogus `STRU` (kept `STRU/DS → TABL` as a legacy alias).

**Read path** uses `AdtClient.getTabl()` / `resolveTablObjectUrl()` which probe `/tables/` first and fall back to `/structures/` on 404 — correct because the source body is identical either way.

**Write path** (after issue #285) uses a separate `AdtClient.resolveTablObjectUrlForWrite()` that asks SAP via repository search for the actual subtype (TABL/DT vs TABL/DS) and refuses transparent-table writes on systems that don't expose `/sap/bc/adt/ddic/tables/` (NW 7.50/7.51 ship `/ddic/structures/` only; the database-table editor was added in NW 7.52, per ADT 2.52 release notes). Pre-fix, the read-path resolver was reused for writes — on NW 7.50 every TABL/DT write silently routed to `/structures/`, where a PUT corrupts DD02L-TABCLASS to INTTAB on the inactive draft.

## TADIR ground truth
- **R3TR type**: `TABL`. There is no `R3TR STRU`. Pre-#219 ARC-1 invented one.
- **LIMU sub-objects**: `TABD` (table definition), `INDX` (secondary indexes attached to a table).
- **abap-file-formats support**: ❌ no `tabl/` directory in AFF. (Tables are not yet released for cloud as standalone serialized objects.)

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `TABL/DT` | Transparent / pooled / cluster table | `/sap/bc/adt/ddic/tables/<NAME>` | a4h ✅ |
| `TABL/DS` | DDIC structure (incl. APPEND) | `/sap/bc/adt/ddic/structures/<NAME>` | a4h ✅ |

Live evidence: search with `objectType=TABL/DT` returns tables only; `objectType=TABL/DS` returns structures only. Unfiltered `objectType=TABL` returns a mix — confirms both subtypes share TABL.

## SAP docs & notes
- DD02L documentation (TABCLASS column) defines the TRANSP/INTTAB/APPEND distinction.
- ADT plugin: `/sap/bc/adt/ddic/tables` and `/sap/bc/adt/ddic/structures` are separate REST collections under the same workbench type.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: uses `TABL/DT` for tables, `TABL/DS` for structures.
- abapGit: serializes both as `tabl` (lower) but distinguishes via the `TABCLASS` field inside the XML.
- `compare/00-feature-matrix.md`: TABL coverage was a known parity item; PR #219 closed it.

## Live verification
### a4h (S/4HANA 2023)
- `GET /repository/informationsystem/search?objectType=TABL/DT&query=T000` → returns `T000` with `adtcore:type="TABL/DT"`, URL `/sap/bc/adt/ddic/tables/t000`.
- `GET /sap/bc/adt/ddic/tables/T000` → 200.
- `GET /sap/bc/adt/ddic/structures/<some-struct>` → 200 (verified by `TABL/DS` search results all carrying `/sap/bc/adt/ddic/structures/...` URIs).

### 7.50 (NW 7.50, npl.marianzeis.de) — verified 2026-05-15 (issue #285)
- ADT discovery feed lists `ddic/structures` (with `ddic/structures/validation` and `ddic/structures/parser/info`) but **does NOT list `ddic/tables`**. The transparent-table endpoint genuinely does not ship on 7.50.
- `GET /sap/bc/adt/ddic/tables/T000` → **404**. `GET /sap/bc/adt/ddic/structures/T000` → **200**.
- `GET /sap/bc/adt/ddic/structures/SCARR/source/main` → **200**, body framed as `define type scarr { ... }` (structure source for a transparent table). Writing this back via PUT would let SAP flip DD02L-TABCLASS=INTTAB.
- `POST /sap/bc/adt/ddic/tables` (create collection) → **404** — confirms no transparent-table create path either.
- `GET /repository/informationsystem/search?query=T000` → returns `adtcore:type="TABL/DT" adtcore:name="T000 (Database Table)"` (the localized name suffix is NPL-only; matchers must strip parenthesized text). URI is `/sap/bc/adt/vit/wb/object_type/tabldt/object_name/T000`, NOT `/sap/bc/adt/ddic/tables/T000`.
- Eclipse ADT 2.51 release notes (the 7.50 plug-in) ship editors for **structures, data elements, domains** but not for transparent tables — confirming the missing REST endpoint is intentional, not a config issue. NW 7.52 / ADT 2.52 added the database-table editor.

## ARC-1 current surface
| Location | Form used | Correct? |
|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | `TABL/DT → TABL`, `TABL/DS → TABL` | ✅ |
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | `STRU/DS → TABL` (legacy alias for old prompts) | ✅ legacy-tolerable |
| `src/handlers/intent.ts` `objectBasePath` | default `/ddic/tables/` (with comment about /structures/ fallback) | ✅ |
| `src/adt/client.ts` `getTabl` / `resolveTablObjectUrl` | **read path**: tries `/tables/` then falls back to `/structures/` on 404 | ✅ |
| `src/adt/client.ts` `resolveTablObjectUrlForWrite` (issue #285) | **write/activate/delete path**: search-first, refuses TABL/DT writes when discovery lacks `/ddic/tables` | ✅ |
| `src/handlers/intent.ts` SAPWrite create/batch_create | refuses TABL upfront when discovery lacks `/ddic/tables` (issue #285) | ✅ |
| `src/handlers/schemas.ts` enums | `TABL` only (no `STRU`) | ✅ |
| `src/probe/catalog.ts` | `TABL` with note about /structures/ duality | ✅ |

## Cross-repo pattern reference (researched 2026-05-15)
| Source | Pattern | Notes |
|---|---|---|
| **Eclipse ADT 2.51 (NW 7.50)** | Ships editors for structures + DTEL + DOMA only; no table editor | Users edit transparent tables in SE11 |
| **Eclipse ADT 2.52+ (NW 7.52+)** | Both `/ddic/tables/` and `/ddic/structures/` REST endpoints; UI picks Table vs Structure deterministically (never probes) | The canonical pattern |
| **abapGit `zcl_abapgit_object_tabl`** | Reads `DD02V-TABCLASS` via `DDIF_TABL_GET`; comparator branches on `IF ls_dd02v-tabclass <> 'TRANSP'` | De-facto OSS standard: inspect type, then route |
| **abap-adt-api (Marcello Urbani)** | Probe `/tables/` first, fall back to `/structures/` on 404 | Same probe-and-fallback as ARC-1 pre-fix; has the same latent bug for writes on 7.50 |
| **SAP/abap-file-formats** | No `tabl/` schema yet (cloud-only project; standalone TABL CRUD not exposed) | No constraint |

## Verdict
- **Status**: PR #219 collapse was correct for reads; the write path needed the additional resolver introduced in the issue #285 fix.
- **Evidence**: verified-on-live-system (both a4h S/4HANA 2023 and npl NW 7.50).
- **Issue**: none after issue #285 fix. Bare `STRU` is intentionally NOT aliased so it surfaces as a schema error — the deliberate breaking-change signal is preserved.

## Recommendation
- Keep current state.
- Consider sunsetting the `STRU/DS` legacy alias one minor release after v0.8.0 once telemetry confirms no real callers. (Not urgent.)
- **Breaking change**: none from current state.
- **Test gap closed**: integration tests in `tests/integration/adt.integration.test.ts` now cover `resolveTablObjectUrlForWrite` on a4h; unit tests in `tests/unit/adt/client.test.ts` and `tests/unit/handlers/intent.test.ts` mock the search response and discovery state to exercise the NW 7.50 refusal path.

# TTYP (Table Type) Read + Create (FEAT-65) — and why TRAN write is deferred

## Overview

ARC-1 has no DDIC Table Type (TTYP) support — neither read nor write. This plan adds both:
`SAPRead type=TTYP` and `SAPWrite action=create type=TTYP` (+ activate/delete via the existing DDIC
lifecycle). Competitor parity: dassian-adt `5f691ff` + sapcli ship TTYP create.

TTYP is an **XML-metadata** DDIC object (not source-based) at `/sap/bc/adt/ddic/tabletypes/{name}`,
content type `application/vnd.sap.adt.tabletype.v1+xml`. It mirrors the existing DOMA/DTEL create path
(`buildDomainXml`/`buildDataElementXml` in `ddic-xml.ts`; `isMetadataWriteType` in `write-helpers.ts`).

**TRAN write (#6) is deferred — hard blocker.** The transaction-create endpoint `/sap/bc/adt/aps/iam/tran`
(the path sapcli uses) returns **404 on both a4h 758 and a4h-2025 816**, and is absent from discovery on
all three systems (758, 816, 7.50 — confirmed live 2026-06-24, matching the prior probe in
`docs/research/2026-04-28-adt-transaction-source-write.md`). There is no backend on any available test system to
implement and verify TRAN create against, so per the "test against 7.50/758/816" requirement it cannot
be shipped now. Roadmap FEAT-62 already tracks it as feature-detected/on-prem; this plan adds a one-line
note that no test system currently exposes the endpoint.

Ponytail scope for TTYP create: the two common, verified row-type shapes — a **built-in** row (e.g.
table of `STRING`) and a **structure** row (e.g. table of `BAPIRET2`) — as a standard table with a
non-unique standard key. Sorted/hashed tables, unique/secondary keys, key components, range/ref row
types are deferred (the builder leaves room).

Success criteria (plain bullets):
- `SAPRead type=TTYP name=STRINGTAB` returns the row type + access/key info.
- `SAPWrite create type=TTYP name=… rowType=…` creates a table type (built-in or structure row),
  which then activates.
- 7.50 behaves correctly (the endpoint exists there too; if not, a clean backend-unsupported error).

## Context

### Current State

- TTYP is **not** in `SAPREAD_TYPE_TABLE`/`SAPWRITE_TYPE_TABLE` (`src/handlers/tool-registry.ts`), not in
  `SLASH_TYPE_MAP`/`objectBasePath`/the canonical-types set (`src/handlers/object-types.ts`). `TRAN` is in
  `SAPREAD_TYPE_TABLE` (`:78`, `btp:false`) but not SAPWRITE.
- DDIC metadata create precedent: `objectBasePath('DOMA')` → `/sap/bc/adt/ddic/domains/`
  (`object-types.ts:375`); `buildDomainXml`/`buildDataElementXml` (`ddic-xml.ts:194/294`);
  `isMetadataWriteType` returns true for DOMA/DTEL/MSAG/SRVB (`write-helpers.ts:86`); the create path runs
  `buildCreateXml` → `createObject` → activate.

### Target State

- TTYP added to the type tables (read + write, on-prem only — `btp:false`), `SLASH_TYPE_MAP`
  (`TTYP/DA`→`TTYP`), canonical types, and `objectBasePath('TTYP')` → `/sap/bc/adt/ddic/tabletypes/`.
- `buildTableTypeXml(params)` in `ddic-xml.ts`; TTYP wired into `isMetadataWriteType` + `buildCreateXml`.
- `SAPRead type=TTYP` returns a structured summary (rowType name/kind, accessType, key kind).

### Verified Live Evidence (2026-06-24)

- **TTYP read** — `GET /sap/bc/adt/ddic/tabletypes/STRINGTAB` → **200 on a4h 758 AND a4h-2025 816**,
  `Content-Type: application/vnd.sap.adt.tabletype.v1+xml`, `adtcore:type="TTYP/DA"`. `…/source/main`
  → 404 (XML-metadata, not source-based). Real response captured (use as the read-parse fixture).
- **TTYP create** — `POST /sap/bc/adt/ddic/tabletypes` (CSRF, content type as above), the body a
  `<ttyp:tableType>` with `<adtcore:packageRef adtcore:name="$TMP"/>` and a `<ttyp:rowType>` whose
  children are required **in order**: `typeKind`, `typeName`, `builtInType(dataType,length,decimals)`,
  `rangeType`. Then `accessType`, `primaryKey(definition,kind,components,alias)`, `secondaryKeys(allowed)`.
  Verified **201**:
  - **built-in row** (`typeKind=predefinedAbapType`, `typeName` empty, `builtInType.dataType=STRING`) →
    201 on **758 AND 816**.
  - **structure row** (`typeKind=dictionaryType`, `typeName=BAPIRET2`, `builtInType.dataType=STRU`) →
    201 on **816**.
  - Omitting `builtInType` → 400 `expected element builtInType`; empty `builtInType` → 400 `expected
    element dataType` — so all four `rowType` children, and `builtInType.dataType`, are mandatory.
  - Created object is **inactive** → activates via the existing DDIC activate flow. Cleaned up via
    `DELETE /ddic/tabletypes/{name}` (200) in all probes.
- **TRAN create** — `/sap/bc/adt/aps/iam/tran` → **404 on 758 + 816**, not in discovery on any system.
  Blocker (see Overview).

### Design Principles

1. **Mirror DOMA/DTEL** (XML-metadata create via `ddic-xml.ts` + `isMetadataWriteType` + `buildCreateXml`).
   No new create mechanism.
2. **Two verified row-type modes.** `rowType` param = the row type name; `rowTypeKind` ('builtin' |
   'structure', auto-defaulted: a known ABAP built-in → builtin, else structure). builtin →
   `predefinedAbapType` + `builtInType.dataType=<ROWTYPE>`; structure → `dictionaryType` +
   `typeName=<ROWTYPE>` + `builtInType.dataType=STRU`. Standard table, non-unique standard key. Advanced
   options deferred (note in docs).
3. **Three-file type-table sync.** TTYP rows go in `tool-registry.ts` `*_TYPE_TABLE` (single source) —
   never hand-copied into tools.ts/schemas.ts. The create params (`rowType`, `rowTypeKind`) need the
   three-file param sync (`schemas.ts` + `tools.ts` + handler) with `looseOptionalBoolean`/enum.
4. **On-prem only** (`btp:false`) — classic DDIC table types aren't an ABAP-Cloud authoring target.
5. **Release-robust.** Endpoint verified on 758 + 816; on 7.50, feature-detect / return a clean
   backend-unsupported error if absent (the create path already surfaces ADT 404s).
6. Master language on create per #343 (use `SAP_LANGUAGE`); uppercase `adtcore:responsible`
   (`normalizeAdtResponsible`).

## Development Approach

TDD `buildTableTypeXml` first against the verified shapes (assert the exact element order + the
builtin/structure `dataType` mapping). Then wire the type tables + read + create. Integration creates a
uniquely-named TTYP (built-in row) on a live system, reads it, activates, deletes — `generateUniqueName`,
cleanup in `finally`, on 758 + 816; 7.50 `requireOrSkip` if the endpoint is absent. Failure path: a
create with a non-existent structure row type → SAP 400, surfaced as an error (test the error shape).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Type-table + routing wiring (TTYP read + write)

**Files:**
- Modify: `src/handlers/tool-registry.ts` (add `{ type: 'TTYP', btp: false }` to `SAPREAD_TYPE_TABLE` and `SAPWRITE_TYPE_TABLE`)
- Modify: `src/handlers/object-types.ts` (`SLASH_TYPE_MAP` `'TTYP/DA':'TTYP'` + EVIDENCE entry; canonical-types set; `objectBasePath` case `'TTYP'` → `/sap/bc/adt/ddic/tabletypes/`)
- Modify: `tests/unit/handlers/slash-type-map.test.ts` + `tests/unit/handlers/object-types*.test.ts` (verify the new mapping)

- [ ] Add the TTYP rows/cases as above. `objectBasePath('TTYP')` returns `/sap/bc/adt/ddic/tabletypes/`
      (trailing slash, matching DOMA). Add `'TTYP/DA': 'TTYP'` to `SLASH_TYPE_MAP` with an EVIDENCE path
      (create `docs/research/abap-types/types/ttyp.md` noting the live `adtcore:type="TTYP/DA"`).
- [ ] Tests for the slash-map + objectBasePath (mirror the DOMA assertions). Regenerate the tool-def
      snapshot (TTYP now appears in SAPRead/SAPWrite type enums on on-prem) — review the diff.
- [ ] Run `npm test`.

### Task 2: `buildTableTypeXml` + read parse (ddic-xml.ts)

**Files:**
- Modify: `src/adt/ddic-xml.ts` (`buildTableTypeXml`, `TableTypeCreateParams`; optional `parseTableType` for read)
- Modify: `tests/unit/adt/ddic-xml.test.ts`

- [ ] `interface TableTypeCreateParams { name; description?; package?; rowType: string; rowTypeKind?: 'builtin'|'structure'; responsible?; masterLanguage? }`.
- [ ] `buildTableTypeXml(params)` emits the **verified** structure: `<ttyp:tableType>` with
      `adtcore:name/type="TTYP/DA"/description/masterLanguage/responsible`, `<adtcore:packageRef
      adtcore:name="…"/>`, and `<ttyp:rowType>` with all four children in order. builtin →
      `typeKind=predefinedAbapType`, empty `typeName`, `builtInType.dataType=<ROWTYPE upper>`,
      length/decimals `000000`; structure → `typeKind=dictionaryType`, `typeName=<ROWTYPE upper>`,
      `builtInType.dataType=STRU`. Then `<ttyp:initialRowCount>00000</…>`, `accessType=standard`,
      `primaryKey(definition=standard, kind=nonUnique, empty components+alias)`, `secondaryKeys(allowed=notSpecified)`.
      Escape every free value via `escapeXmlAttr`; uppercase responsible via `normalizeAdtResponsible`.
- [ ] Unit tests (~6): built-in row XML contains `predefinedAbapType` + `dataType>STRING`; structure row
      contains `dictionaryType` + `typeName>ZFOO` + `dataType>STRU`; element order is typeKind→typeName→
      builtInType→rangeType; package/description/responsible flow through (responsible upper-cased); a
      failure-style assertion that a missing `rowType` is rejected upstream (schema) — covered in Task 3.
- [ ] (Optional) `parseTableType(xml)` → `{ rowType, rowTypeKind, accessType, keyKind }` for the read; unit-test against the captured STRINGTAB fixture.
- [ ] Run `npm test`.

### Task 3: Wire create + read into the handlers (three-file sync)

**Files:**
- Modify: `src/handlers/write-helpers.ts` (`isMetadataWriteType` += TTYP; `buildCreateXml` case `'TTYP'` → `buildTableTypeXml`)
- Modify: `src/handlers/read.ts` (TTYP read → GET tabletypes + return parsed/raw)
- Modify: `src/handlers/schemas.ts` (SAPWrite: `rowType: z.string().optional()`, `rowTypeKind: z.enum(['builtin','structure']).optional()`; TTYP picked up from the type table)
- Modify: `src/handlers/tools.ts` (SAPWrite: `rowType`/`rowTypeKind` property descriptions; batch_create item schema too — Rule 7)
- Modify: snapshot fixtures + `tests/unit/handlers/{write,read,schemas}*.test.ts`

- [ ] `buildCreateXml`: route TTYP to `buildTableTypeXml({ name, description, package, rowType, rowTypeKind, … })`; add TTYP to `isMetadataWriteType`. Validate `rowType` is present for TTYP create (clear error if missing).
- [ ] `read.ts` TTYP case: `GET objectBasePath('TTYP')+name` (or `client.get` of the tabletype URL) → return `parseTableType` summary (or the raw XML).
- [ ] Three-file param sync for `rowType`/`rowTypeKind` (schemas + tools + batch_create item schema). Regenerate the tool-def snapshot; bump the schema-budget ratchet if it trips (same commit).
- [ ] Tests: write unit (TTYP create routes to `buildTableTypeXml`, mockFetch 201); read unit (TTYP GET parsed); polluted-payload (a non-TTYP write must NOT accept rowType meaningfully / TTYP create without rowType errors).
- [ ] Run `npm test`.

### Task 4: Live integration + docs

**Files:**
- Modify: `tests/integration/adt.integration.test.ts` (or the CRUD integration suite)
- Modify: `docs_page/tools.md` (SAPRead/SAPWrite TTYP), `AGENTS.md` Key-Files row, `docs/research/2026-04-28-adt-transaction-source-write.md` (note: endpoint still 404 on 758+816 — TRAN deferred)

- [ ] Integration (TEST_SAP_URL): `generateUniqueName('ZARC1_TTYP')`; SAPWrite create TTYP (built-in row `STRING`) → SAPRead TTYP (assert rowType) → SAPActivate → SAPWrite delete (cleanup in `finally`). Run 758 + 816; 7.50 `requireOrSkip` if `/ddic/tabletypes` absent. A negative test: create with a bogus structure row type → expect an ADT error.
- [ ] Docs: TTYP read/write in tools.md (note: standard table, non-unique key; advanced options not yet supported); roadmap FEAT-65 done; feature-matrix TTYP row; AGENTS row. Note TRAN deferred (endpoint absent).
- [ ] Run `npm test`.

### Task 5: Final verification

- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:sizes` — green.
- [ ] Live on 758 + 816: create a TTYP (built-in + structure row), read, **activate** (the definitive
      check), delete. (creds per INFRASTRUCTURE.md; do not commit scripts.)
- [ ] Move this plan to `docs/plans/completed/`.

# ADT API Audit: Documentation Fixes & High-Value API Implementations

## Overview

This plan addresses all findings from `docs/research/complete/2026-04-09-adt-api-audit-documentation-and-unused.md`. The audit (2026-04-09) uncovered significant documentation inaccuracies in `docs/tools.md` (wrong SAPDiagnose actions, 6 missing SAPRead types, undocumented SAPSearch source_code mode, incorrect SAPManage read-only claim) and identified 4 high-value ADT APIs not yet used by ARC-1.

The plan has two phases:
1. **Documentation fixes** (Tasks 1–4): Correct all inaccuracies in `docs/tools.md` and `CLAUDE.md` so the documentation matches the actual code.
2. **API implementations** (Tasks 5–7): Implement the two highest-value unused ADT APIs (class hierarchy and type information) and update the roadmap for remaining items.
3. **Finalization** (Task 8): Move the three audit research documents to `docs/research/complete/`.

## Context

### Current State

The ADT API audit found:
- **docs/tools.md SAPDiagnose section** lists 7 wrong actions (`dumps`, `dump_detail`, `traces`, `trace_detail`, `sql_traces`, `call_graph`, `object_structure`). The actual code supports 5 actions: `syntax`, `unittest`, `atc`, `dumps`, `traces`.
- **docs/tools.md SAPRead** is missing 6 supported types: `STRU`, `DOMA`, `DTEL`, `TRAN`, `SOBJ`, `BSP`. Several parameters are undocumented (`method` for CLAS, `expand_includes` for FUGR, `main` as valid CLAS include, `elements` as DDLS include).
- **docs/tools.md SAPSearch** doesn't document the source code search capability (`searchType`, `objectType`, `packageName` parameters).
- **docs/tools.md SAPManage** incorrectly states "Blocked when `--read-only` is active" — the `probe`, `features`, and `cache_stats` actions are read-only and work regardless.
- **CLAUDE.md** is missing `src/context/cds-deps.ts` and `src/adt/btp.ts` from the Key Files table.
- **Tier 1 unused APIs** (class hierarchy, quick fix, type information) are not implemented despite high value.

The companion audit documents (`adt-api-audit-issues.md` and `adt-api-audit-working.md`) are already fully resolved — all 9 actionable issues were fixed in plan `docs/plans/completed/2026-04-09-fix-adt-api-audit-issues.md`.

### Target State

- `docs/tools.md` accurately documents all 11 MCP tools with correct actions, types, and parameters
- `CLAUDE.md` has complete Key Files entries for all task-relevant files
- Class hierarchy and type information APIs are implemented and documented
- Roadmap tracks remaining Tier 1/2 items (quick fix → FEAT-12, used objects, enhancements → FEAT-03)
- All three audit docs moved to `docs/research/complete/`

### Key Files

| File | Role |
|------|------|
| `docs/tools.md` | Tool reference documentation — needs 4 sections fixed |
| `CLAUDE.md` | AI assistant guidelines — needs Key Files table updated |
| `src/handlers/schemas.ts` | Zod schemas — SAPDiagnose schema (line 199) confirms actual actions |
| `src/handlers/intent.ts` | Intent router — SAPDiagnose handler (line 1575), SAPRead handler (line 430+), SAPSearch handler (line 700+), SAPManage handler (line 1803), TOOL_SCOPES (line 84) |
| `src/handlers/tools.ts` | Tool descriptions — LLM-facing descriptions that should match docs |
| `src/adt/client.ts` | ADT client — methods for all read operations |
| `src/adt/codeintel.ts` | Code intelligence — will host type information API |
| `src/adt/xml-parser.ts` | XML parser — will need new parser for hierarchy/type responses |
| `src/adt/types.ts` | ADT response types — will need new types |
| `docs/roadmap.md` | Roadmap — update Tier 2 tracking |
| `docs/compare/00-feature-matrix.md` | Feature matrix — update if new capabilities added |

### Design Principles

1. Documentation must exactly match the code — every documented action, type, and parameter must correspond to actual implementation
2. New API implementations follow existing patterns: ADT client method with safety check → XML parser → handler case → tool description update
3. Probe new ADT endpoints on the test SAP system before implementing parsers, to get real XML response samples
4. Each task is self-contained and can be executed by an autonomous agent in isolation

## Development Approach

Documentation tasks (1–4) modify only markdown files and require no tests. API implementation tasks (5–7) follow the standard pattern: ADT client → XML parser → handler → tool definition → tests. Use the test SAP system (credentials from `.env` or `SAP_*` env vars) to probe endpoints and capture response XML for fixtures.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

---

### Task 1: Fix docs/tools.md — Rewrite SAPDiagnose section

**Files:**
- Modify: `docs/tools.md`

The SAPDiagnose section (starting at line 397) is completely wrong. The documented actions don't match the actual code. The Zod schema at `src/handlers/schemas.ts:199` confirms the real actions are `syntax`, `unittest`, `atc`, `dumps`, `traces`.

- [ ] Read `src/handlers/schemas.ts` lines 197-208 to confirm the SAPDiagnose schema (actions: `syntax`, `unittest`, `atc`, `dumps`, `traces` and parameters: `name`, `type`, `variant`, `id`, `user`, `maxResults`, `analysis`)
- [ ] Read `src/handlers/intent.ts` starting at line 1575 to understand how each action works:
  - `syntax`: takes `name` + `type`, runs syntax check, returns errors with line/column
  - `unittest`: takes `name` + `type`, runs ABAP unit tests, returns results with class/method/status/alerts
  - `atc`: takes `name` + `type` + optional `variant`, runs ATC check, returns findings with priority/URI/line
  - `dumps`: without `id` → lists dumps (optional `user`, `maxResults` filters); with `id` → returns dump detail
  - `traces`: without `id` → lists traces; with `id` → returns trace detail; with `id` + `analysis` → returns hitlist/statements/dbAccesses
- [ ] Replace the entire SAPDiagnose section in `docs/tools.md` (lines 397-410) with correct documentation:
  - Update the description line to: "Server-side code analysis: syntax check, ABAP unit tests, ATC checks, short dumps (ST22), and ABAP profiler traces."
  - Replace the parameters table with the correct parameters:
    | Parameter | Type | Required | Description |
    | `action` | string | Yes | `syntax`, `unittest`, `atc`, `dumps`, or `traces` |
    | `name` | string | No | Object name (required for syntax/unittest/atc) |
    | `type` | string | No | Object type: PROG, CLAS, INTF, FUNC (required for syntax/unittest/atc) |
    | `id` | string | No | Dump ID (for dump detail) or Trace ID (for trace detail) |
    | `user` | string | No | Filter dumps by user |
    | `maxResults` | number | No | Max dumps to return |
    | `variant` | string | No | ATC check variant name |
    | `analysis` | string | No | For trace detail: `hitlist`, `statements`, or `dbAccesses` |
  - Add an "Actions" subsection explaining each action with examples
  - Add examples showing common usage patterns

### Task 2: Fix docs/tools.md — Add missing SAPRead types and parameters

**Files:**
- Modify: `docs/tools.md`

The SAPRead section (starting at line 9) is missing 6 supported types and several parameters. Read the code to verify all types and then update the docs.

- [ ] Read `src/handlers/intent.ts` lines 430-660 to verify all SAPRead type handlers, specifically:
  - `STRU` (line ~568): `client.getStructure()` — structure definitions
  - `DOMA` (line ~573): `client.getDomain()` — domain metadata as JSON
  - `DTEL` (line ~579): `client.getDataElement()` — data element metadata as JSON
  - `TRAN` (line ~585): `client.getTransaction()` — transaction metadata as JSON
  - `SOBJ` (line ~614): SQL lookup for BOR business objects
  - `BSP` (line ~635): `client.listBspApps()`, `getBspAppStructure()`, `getBspFileContent()` — BSP/UI5 filestore
- [ ] Add the 6 missing types to the "Supported types" table in docs/tools.md (after line 48, before DEVC):
  - `STRU` — Structure definition (DDIC structure source)
  - `DOMA` — Domain metadata (structured JSON: data type, length, fixed values, value table)
  - `DTEL` — Data element metadata (structured JSON: type, labels, search help)
  - `TRAN` — Transaction metadata (structured JSON: code, description, program)
  - `SOBJ` — BOR business object (via SQL lookup)
  - `BSP` — BSP/UI5 filestore (list apps, browse structure, read files)
- [ ] Read `src/handlers/intent.ts` lines 456-471 to verify the `method` parameter behavior for CLAS type, then add to the parameters table:
  - `method` parameter: "For CLAS: method name to read (`get_name`), or `*` to list all methods"
- [ ] Read `src/handlers/intent.ts` line 502 to verify `expand_includes` for FUGR, then add to parameters table:
  - `expand_includes` parameter: "For FUGR: expand include source inline (boolean)"
- [ ] Update the `include` parameter description (line 20) to include `main` as a valid value: "For CLAS: `main`, `testclasses`, `definitions`, `implementations`, `macros`"
- [ ] Read `src/handlers/intent.ts` lines 529-532 to verify the `elements` include for DDLS, then add to the `include` description: "For DDLS: `elements` (extract CDS view elements)"
- [ ] Add examples showing the new types and parameters

### Task 3: Fix docs/tools.md — SAPSearch source_code mode and SAPManage note

**Files:**
- Modify: `docs/tools.md`

SAPSearch (starting at line 75) doesn't document the source code search capability. SAPManage (line 458) incorrectly claims it's blocked by `--read-only`.

- [ ] Read `src/handlers/intent.ts` lines 700-730 to verify SAPSearch source_code mode behavior:
  - `searchType` parameter: `"object"` (default) or `"source_code"`
  - `objectType` parameter: filter source search by object type
  - `packageName` parameter: filter source search by package
- [ ] Read `src/handlers/schemas.ts` to verify the SAPSearch schema includes these parameters
- [ ] Update the SAPSearch parameters table in docs/tools.md (after line 84) to add:
  - `searchType`: "Search mode: `object` (default, name search) or `source_code` (text search within ABAP source)"
  - `objectType`: "For source_code search: filter by object type"
  - `packageName`: "For source_code search: filter by package"
- [ ] Add source code search examples:
  ```
  SAPSearch(query="SY-SUBRC", searchType="source_code")
  SAPSearch(query="SELECT * FROM mara", searchType="source_code", objectType="CLAS", packageName="ZDEV")
  ```
- [ ] Fix the SAPManage note at line 458. Replace "Blocked when `--read-only` is active." with: "The `probe`, `features`, and `cache_stats` actions are read-only operations that work regardless of `--read-only` mode. In HTTP auth mode, SAPManage requires `write` scope."
- [ ] Verify this claim by reading `src/handlers/intent.ts` lines 1803-1870 to confirm that `handleSAPManage()` doesn't call `checkOperation()` for probe/features/cache_stats

### Task 4: Fix CLAUDE.md — Add missing Key Files entries

**Files:**
- Modify: `CLAUDE.md`

Two files used in the codebase are missing from the Key Files table and codebase structure tree.

- [ ] Read `CLAUDE.md` and locate the Key Files table (around line 190) and the codebase structure tree (around line 105)
- [ ] Verify `src/context/cds-deps.ts` exists by reading the first 10 lines, then add it to:
  - The codebase structure tree under `src/context/` with description: `cds-deps.ts — CDS-specific dependency extraction`
  - The Key Files table: `Add CDS dependency pattern | src/context/cds-deps.ts`
- [ ] Verify `src/adt/btp.ts` exists by reading the first 10 lines, then add to the Key Files table:
  - `BTP Destination Service | src/adt/btp.ts` (it's already in the structure tree but missing from the Key Files table)

### Task 5: Implement class hierarchy API

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/adt/xml-parser.ts`
- Modify: `src/adt/types.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/adt/xml-parser.test.ts`
- Create: `tests/fixtures/xml/class-hierarchy.xml`
- Modify: `tests/unit/handlers/intent.test.ts`

Implement the class hierarchy ADT API (`GET /sap/bc/adt/oo/classes/{name}/hierarchy`). This is Tier 1 high-value, small-effort. It returns the inheritance chain (superclass, subclasses, implemented interfaces) — critical for understanding OO design.

- [ ] First, probe the endpoint on the test SAP system to get a real XML response. Run: `curl -s -u "$SAP_USER:$SAP_PASSWORD" "$SAP_URL/sap/bc/adt/oo/classes/CL_ABAP_TYPEDESCR/hierarchy" -H "Accept: application/xml"` (or use the ADT client). Capture the response XML structure.
- [ ] If the endpoint returns a 404 or error, try alternative URLs: `/sap/bc/adt/oo/classes/{name}?withHierarchy=true` or check if hierarchy data is in the class metadata response. Document what works.
- [ ] Add a `ClassHierarchy` type to `src/adt/types.ts`:
  ```typescript
  export interface ClassHierarchy {
    className: string;
    superclass?: string;
    interfaces: string[];
    subclasses: string[];
  }
  ```
- [ ] Add `parseClassHierarchy()` to `src/adt/xml-parser.ts` that parses the response XML into the `ClassHierarchy` type. Use `parseXml()` + `findDeepNodes()` following the existing pattern.
- [ ] Add `getClassHierarchy(name: string)` to `src/adt/client.ts` following the existing pattern:
  ```typescript
  async getClassHierarchy(name: string): Promise<ClassHierarchy> {
    checkOperation(this.safety, OperationType.Read, 'GetClassHierarchy');
    const resp = await this.http.get(`/sap/bc/adt/oo/classes/${encodeURIComponent(name)}/hierarchy`);
    return parseClassHierarchy(resp.body);
  }
  ```
- [ ] Add a `hierarchy` action to SAPNavigate in `src/handlers/intent.ts` (in the `handleSAPNavigate` function). It should accept `name` (class name) and return the hierarchy as JSON.
- [ ] Update `src/handlers/schemas.ts` — add `'hierarchy'` to the SAPNavigate action enum
- [ ] Update `src/handlers/tools.ts` — add `hierarchy` to the SAPNavigate tool description
- [ ] Create `tests/fixtures/xml/class-hierarchy.xml` with a realistic hierarchy response (based on the probed response or the expected ADT format)
- [ ] Add unit tests (~5 tests) to `tests/unit/adt/xml-parser.test.ts`:
  - Parse hierarchy with superclass and interfaces
  - Parse hierarchy with subclasses
  - Parse hierarchy for root class (no superclass)
  - Parse empty hierarchy
  - Parse hierarchy with multiple interfaces
- [ ] Add handler test to `tests/unit/handlers/intent.test.ts` for `SAPNavigate(action="hierarchy", name="ZCL_TEST")`
- [ ] Run `npm test` — all tests must pass

### Task 6: Implement type information API

**Files:**
- Modify: `src/adt/codeintel.ts`
- Modify: `src/adt/xml-parser.ts`
- Modify: `src/adt/types.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/adt/codeintel.test.ts`
- Create: `tests/fixtures/xml/type-information.xml`
- Modify: `tests/unit/handlers/intent.test.ts`

Implement the type information ADT API (`POST /sap/bc/adt/abapsource/typeinformation`). This is Tier 1 medium-high value. It returns the complete type of a variable/expression at a given source position — critical for the LLM to write correct ABAP code.

- [ ] First, probe the endpoint on the test SAP system. The endpoint likely requires a POST with the source code as body and position query params, similar to `findDefinition` in `src/adt/codeintel.ts`. Run a test against a known class to capture the response format.
- [ ] If the endpoint is not available (404/501), document this in the task output and skip implementation. Update the audit doc to note the endpoint is not available on the test system.
- [ ] Add a `TypeInformation` type to `src/adt/types.ts`:
  ```typescript
  export interface TypeInformation {
    typeName: string;
    typeKind: string; // 'TABLE', 'STRUCTURE', 'REF TO', 'ELEMENTARY', etc.
    fullType: string; // complete type definition
  }
  ```
- [ ] Add `getTypeInformation()` to `src/adt/codeintel.ts` following the `findDefinition()` pattern at line ~31:
  ```typescript
  export async function getTypeInformation(
    http: AdtHttp, safety: SafetyConfig,
    sourceUrl: string, line: number, column: number, source: string
  ): Promise<TypeInformation | null> {
    checkOperation(safety, OperationType.Intelligence, 'GetTypeInformation');
    const resp = await http.post(
      `/sap/bc/adt/abapsource/typeinformation?uri=${encodeURIComponent(sourceUrl)}&line=${line}&column=${column}`,
      source, { 'Content-Type': 'text/plain' }
    );
    return parseTypeInformation(resp.body);
  }
  ```
- [ ] Add `parseTypeInformation()` to `src/adt/xml-parser.ts` using `parseXml()` + `findDeepNodes()`
- [ ] Add a `type_info` action to SAPNavigate in `src/handlers/intent.ts`. It should accept `uri`, `line`, `column`, `source` (same as `definition` action) and return type info as JSON.
- [ ] Update `src/handlers/schemas.ts` — add `'type_info'` to the SAPNavigate action enum
- [ ] Update `src/handlers/tools.ts` — add `type_info` to the SAPNavigate tool description
- [ ] Create `tests/fixtures/xml/type-information.xml` with a realistic response
- [ ] Add unit tests (~4 tests) to `tests/unit/adt/codeintel.test.ts`:
  - Get type information for an elementary variable
  - Get type information for a structure reference
  - Get type information for a table type
  - Handle no type information (null response)
- [ ] Add handler test to `tests/unit/handlers/intent.test.ts`
- [ ] Run `npm test` — all tests must pass

### Task 7: Update documentation for new APIs, roadmap, and feature matrix

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs/research/complete/2026-04-09-adt-api-audit-documentation-and-unused.md`

Update all documentation artifacts to reflect the newly implemented APIs and track remaining items.

- [ ] Update `docs/tools.md` SAPNavigate section (starting at line 161):
  - Add `hierarchy` to the action parameter description: `definition`, `references`, `completion`, `hierarchy`, or `type_info`
  - Add `hierarchy` action description: "Returns the class inheritance chain (superclass, subclasses, implemented interfaces)"
  - Add `type_info` action description: "Returns the complete type of a variable/expression at a given source position"
  - Add examples:
    ```
    SAPNavigate(action="hierarchy", name="ZCL_ORDER")
    SAPNavigate(action="type_info", uri="/sap/bc/adt/oo/classes/zcl_order/source/main", line=15, column=10, source="...")
    ```
- [ ] Update `docs/roadmap.md`:
  - Add a new roadmap item for class hierarchy (mark as ✅ Complete):
    ```
    ### FEAT-25: Class Hierarchy API
    | Field | Value |
    | **Status** | ✅ Complete |
    ```
  - Add a new roadmap item for type information (mark as ✅ Complete):
    ```
    ### FEAT-26: Type Information API
    | Field | Value |
    | **Status** | ✅ Complete |
    ```
  - Verify FEAT-12 (Fix Proposals) exists and tracks the quick fix API (Tier 1 item from audit)
  - Verify FEAT-03 (Enhancement Framework) exists and tracks enhancements (Tier 2 item from audit)
  - Add "Object Where-Used (forward dependencies)" as a new P2 roadmap item if not already tracked — this is the `usedObjects` Tier 1 item from the audit
  - Add ABAP Doc as a P2/P3 roadmap item if not tracked — Tier 2 item from audit
- [ ] Update `docs/compare/00-feature-matrix.md`:
  - Add or update row for "Class Hierarchy" under Code Intelligence section — mark ARC-1 as ✅
  - Add or update row for "Type Information" under Code Intelligence section — mark ARC-1 as ✅
  - Update "Last Updated" date
- [ ] Update `docs/research/complete/2026-04-09-adt-api-audit-documentation-and-unused.md`:
  - Add a note at the top of Part 1 indicating all documentation fixes have been applied
  - Add notes to Tier 1 items indicating which have been implemented (class hierarchy, type information) and which are tracked in roadmap (quick fix → FEAT-12, used objects → new roadmap item)

### Task 8: Final verification and move audit docs

**Files:**
- Move: `docs/research/complete/2026-04-09-adt-api-audit-documentation-and-unused.md` → `docs/research/complete/`
- Move: `docs/research/complete/2026-04-09-adt-api-audit-issues.md` → `docs/research/complete/`
- Move: `docs/research/complete/2026-04-09-adt-api-audit-working.md` → `docs/research/complete/`

Final verification that all changes are correct, then move the three audit research documents to the completed directory.

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify `docs/tools.md` accuracy:
  - SAPDiagnose lists correct actions: `syntax`, `unittest`, `atc`, `dumps`, `traces`
  - SAPRead lists all types including STRU, DOMA, DTEL, TRAN, SOBJ, BSP
  - SAPSearch documents `searchType`, `objectType`, `packageName`
  - SAPManage doesn't claim to be blocked by `--read-only`
- [ ] Create directory `docs/research/complete/` if it doesn't exist: `mkdir -p docs/research/complete/`
- [ ] Move the three audit docs:
  ```bash
  git mv docs/research/complete/2026-04-09-adt-api-audit-documentation-and-unused.md docs/research/complete/
  git mv docs/research/complete/2026-04-09-adt-api-audit-issues.md docs/research/complete/
  git mv docs/research/complete/2026-04-09-adt-api-audit-working.md docs/research/complete/
  ```
- [ ] Move this plan to `docs/plans/completed/`: `git mv docs/plans/completed/2026-04-10-adt-api-audit-documentation-and-unused.md docs/plans/completed/`

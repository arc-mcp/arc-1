# Joule Roadmap Feature 5 — Extensibility Assistant (TABL APPEND + BAdI scaffold + skill)

## Overview

SAP's Joule for Developers 2026 roadmap announces "Extensibility Assistant" (S/4HANA Cloud Private 2027; already GA on Public Cloud for *key users*). It is a Joule chat surface in the S/4HANA Cloud UI that finds the right extension option (custom field, BAdI, value help) and creates it. SAP's example: *"I want to create a custom field in the sales order header area and make it relevant for pricing."*

This is the only roadmap feature where SAP's surface is **outside ADT** (Key User Extensibility apps). For an ABAP developer using ARC-1, the analogous capabilities are: (a) **append structures** (TABL subtype `R3TR APPS`) — extend a standard table with custom fields; (b) **BAdI implementations** — implement an enhancement spot's interface. Both touch **classic** ABAP types that `adt-ls` does not serve — this is **permanently ARC-1's domain**.

This plan delivers three independent code changes plus the orchestrating skill:

1. **5a — TABL APPEND structure subtype.** New `appendStructureXml()` in `src/adt/ddic-xml.ts`; new `tabl-v1.json` AFF schema (currently absent); wire `appendOf` through `buildCreateXml()` in `src/handlers/intent.ts:2709` and the SAPWrite schema chain.
2. **5b — BAdI implementation scaffold.** New `src/adt/badi-scaffold.ts` (pure module mirroring `src/adt/rap-handlers.ts`); new `SAPWrite action='scaffold_badi_impl'`; reads the BAdI definition's interface, emits a CLAS stub.
3. **5c — `extensibility-assistant` skill.** Orchestrates BAdI search → BAdI definition read → impl-class scaffold; or append-structure scaffold for the field-extension workflow.

See [`docs/research/2026-06-03-joule-2026-roadmap-feature-assessment.md §5`](../research/2026-06-03-joule-2026-roadmap-feature-assessment.md) for the full feature assessment.

## Context

### Current State

- TABL writes exist for base transparent tables and structures (`buildCreateXml()` at `src/handlers/intent.ts:2709` has a `case 'TABL'`)
- AFF schemas exist for `bdef, clas, ddls, intf, prog, srvb, srvd` — **no `tabl-v1.json` yet** (gap to close in 5a)
- `src/aff/validator.ts` line 10 has `TYPE_MAP` mapping object type → schema filename; line 28 has `getAffSchema(type)` that resolves from the map
- `getEnhancementImplementation()` exists at `src/adt/client.ts:595` — reads ENHO and parses BAdI implementations via `parseEnhancementImplementation()` at `src/adt/xml-parser.ts:643`
- No `getBadiDefinition()` reader exists — needed to read the BAdI interface signature before scaffolding the implementation class
- `src/adt/rap-handlers.ts` (1233 LOC) is the canonical pattern for a scaffold module: `extractRapHandlerRequirements()`, `applyRapHandlerSignatures()`, `ensureRapHandlerSkeletons()`, with `case 'scaffold_rap_handlers'` dispatch in `handleSAPWrite`
- No skill exists for extensibility tasks

### Target State

- **5a:** `SAPWrite(action='create', type='TABL', appendOf='<parent_table>', source='...', package='Z*')` creates an append structure. The XML envelope uses `R3TR APPS` semantics and includes `<r3tr:appendOf>`. The TABL AFF schema validates the envelope.
- **5b:** `SAPWrite(action='scaffold_badi_impl', badiDefinition='<spot_def>', implementationClass='ZCL_MY_IMPL', implementationName='ZMY_IMPL', enhancementSpot='Z_SPOT')` reads the BAdI definition's interface and writes a CLAS stub implementing it. The class declaration follows the canonical SAP pattern: `CLASS zcl_my_impl DEFINITION PUBLIC FINAL CREATE PUBLIC. PUBLIC SECTION. INTERFACES <badi_interface>. ENDCLASS.`
- **5c:** Skill drives discovery (`SAPSearch tadir_lookup` for ENHS/BADI_DEF) → user picks a BAdI → `getBadiDefinition` reads the interface → `scaffold_badi_impl` writes the stub → `SAPActivate`.
- Unit tests + integration tests for each piece
- Documentation updated end-to-end

### Key Files

| File | Role |
|------|------|
| `src/adt/ddic-xml.ts` | Add `appendStructureXml()` ~ near `dtelXml`/`domaXml` (file is 418 LOC; existing builders end around line 309) |
| `src/handlers/intent.ts` | Extend `buildCreateXml()` (line 2709) `case 'TABL'` to branch on `args.appendOf`; add `case 'scaffold_badi_impl'` in `handleSAPWrite` |
| `src/handlers/schemas.ts` | Add `appendOf?` to TABL slice of `SAPWriteSchema`; add `scaffold_badi_impl` action |
| `src/handlers/tools.ts` | Mirror the schema additions in JSON Schema |
| `src/authz/policy.ts` | Add `'SAPWrite.scaffold_badi_impl': 'write'` |
| `src/aff/schemas/tabl-v1.json` | New TABL AFF schema (prerequisite — doesn't exist) |
| `src/aff/validator.ts` | Add TABL row to `TYPE_MAP` at line 10 |
| `src/adt/badi-scaffold.ts` | New pure module: `extractBadiRequirements`, `applyBadiImplementationStubs` |
| `src/adt/client.ts` | Add `getBadiDefinition(name)` near `getEnhancementImplementation()` (line 595) |
| `src/adt/xml-parser.ts` | Add `parseBadiDefinition()` for the BAdI definition response |
| `src/adt/types.ts` | New types: `BadiDefinitionInfo`, `BadiRequirement` |
| `tests/unit/adt/ddic-xml.test.ts` | Tests for `appendStructureXml` |
| `tests/unit/adt/badi-scaffold.test.ts` | New: pure-function tests |
| `tests/unit/handlers/intent.test.ts` | Handler tests for both new actions |
| `tests/integration/adt.integration.test.ts` | Integration tests against a4h |
| `skills/extensibility-assistant/SKILL.md` | New: orchestration skill |
| `docs/tools.md`, `CLAUDE.md`, `README.md`, `docs/compare/00-feature-matrix.md` | Documentation |

### Design Principles

1. **Mirror `scaffold_rap_handlers`.** `scaffold_badi_impl` follows the same pattern as the existing RAP handler scaffold in `src/adt/rap-handlers.ts`: pure module with `extract*` + `apply*` functions, plus handler dispatch in `intent.ts`. Don't reinvent the structure.
2. **TABL append is a subtype, not a new type.** Keep `type='TABL'` and route on `appendOf` to preserve the existing TABL infrastructure (lock/unlock, transport, activation).
3. **AFF schema must be created.** `tabl-v1.json` is a *prerequisite* — without it, no AFF validation runs for TABL writes today, which is a latent gap.
4. **Three-file schema sync, atomically.** All new properties / actions must land in `tools.ts`, `schemas.ts`, `intent.ts`, and `authz/policy.ts` in the same commit.
5. **Each piece is independently testable.** 5a (TABL APPEND), 5b (BAdI scaffold), 5c (skill) ship in that order — no circular dependencies.
6. **Never bypass `checkOperation`.** Both new write actions are gated by `OperationType.Create` (TABL APPEND) and `OperationType.Update` (scaffold_badi_impl — it modifies CLAS plus optionally ENHO).
7. **Package allowlist applies normally.** Append structures inherit the parent table's package gate naturally; BAdI impl classes are gated by `args.package`.

## Development Approach

- Tasks 1-3: 5a TABL APPEND (schema + builder + wiring)
- Tasks 4-5: 5a tests (unit + integration)
- Tasks 6-8: 5b BAdI scaffold module + handler + tests
- Task 9: 5c skill
- Task 10: Documentation
- Task 11: Final verification

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (requires TEST_SAP_URL)

### Task 1: Create the TABL AFF schema and register it

**Files:**
- Create: `src/aff/schemas/tabl-v1.json`
- Modify: `src/aff/validator.ts`

Prerequisite for 5a. The TABL AFF schema doesn't exist yet (`ls src/aff/schemas/` shows bdef/clas/ddls/intf/prog/srvb/srvd only). Without it, no validation runs for any TABL write today. Adding it is independent value beyond the APPEND subtype.

- [ ] Create `src/aff/schemas/tabl-v1.json` modeled on `src/aff/schemas/ddls-v1.json` envelope structure. Validate:
  - Top-level object with `header { name, description, originalLanguage, abapLanguageVersion }`
  - `tabl { fields: [{ name, dataType, length?, decimals?, isKey, notNull }, ...] }`
  - Optional `appendOf: { tableName: <string> }` block — indicates this is an APPEND structure
  - When `appendOf` is set: `header.name` must start with `Z` or `Y` and end with a special char (or follow the customer-namespace rule); ABAP language version must be present
- [ ] In `src/aff/validator.ts`, add to `TYPE_MAP` at line 10: `TABL: 'tabl-v1.json'`. The existing `getAffSchema()` at line 28 resolves it automatically.
- [ ] Add unit tests to `tests/unit/aff/validator.test.ts` (~4 tests): valid plain table envelope, valid APPEND envelope, missing required field rejected, `appendOf` set without table name rejected
- [ ] Run `npm test` — all tests pass

### Task 2: Add `appendStructureXml()` XML builder

**Files:**
- Modify: `src/adt/ddic-xml.ts`
- Modify: `tests/unit/adt/ddic-xml.test.ts`

Mirror the existing `buildDataElementXml()` / `buildDomainXml()` exports in `src/adt/ddic-xml.ts` (the file is 418 LOC with builders ending around line 309).

- [ ] Add `interface AppendStructureCreateParams { name: string; description: string; appendOf: string; fields: AppendField[]; package: string; abapLanguageVersion?: string }`
- [ ] Add `interface AppendField { name: string; dataType: string; length?: number; decimals?: number }`
- [ ] Add `export function buildAppendStructureXml(params: AppendStructureCreateParams): string` that emits:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <blue:appendStructure xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="{name}" adtcore:type="TABL/APP" adtcore:description="{description}" adtcore:language="EN" adtcore:masterLanguage="EN" adtcore:masterSystem="...">
    <blue:appendOf adtcore:name="{appendOf}" adtcore:type="TABL/TT"/>
    <blue:fields>
      <blue:field blue:fieldName="{f.name}" blue:dataType="{f.dataType}" blue:length="{f.length}" blue:decimals="{f.decimals}"/>
      ...
    </blue:fields>
    <blue:package adtcore:name="{package}"/>
  </blue:appendStructure>
  ```
  Verify root element + namespace against the existing DDIC builders. The exact root name TBD against live a4h on first integration run — use `R3TR APPS` semantics.
- [ ] Use the existing `escapeXmlAttr()` helper (`src/adt/xml-parser.ts`) for all attribute values
- [ ] Add unit tests (~4 tests): happy path, empty fields list rejected, name validation (starts with Z/Y), special characters escaped correctly
- [ ] Run `npm test -- ddic-xml` — all tests pass

### Task 3: Wire `appendOf` through `buildCreateXml` and schemas

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`

Extend the TABL create path to branch on `args.appendOf`. NOTE: `buildCreateXml()` lives in `src/handlers/intent.ts:2709` (NOT in `src/adt/crud.ts` despite what older docs said).

- [ ] In `src/handlers/intent.ts`, find `buildCreateXml()` at line 2709. In its `case 'TABL'` branch, add: `if (args.appendOf) { return buildAppendStructureXml({ name, description, appendOf: args.appendOf, fields: args.fields ?? [], package: pkg, abapLanguageVersion: args.abapLanguageVersion }); }` before the existing TABL XML builder call.
- [ ] In `src/handlers/schemas.ts`, find `validateSapWriteInput()` at line 352 and extend the TABL slice of `SAPWriteSchema` to accept `appendOf: z.string().min(3).optional()` and `fields: z.array(z.object({ name: z.string(), dataType: z.string(), length: z.number().optional(), decimals: z.number().optional() })).optional()`. Add cross-validation: `appendOf` requires `fields` to be non-empty.
- [ ] In `src/handlers/tools.ts`, add `appendOf` and `fields` to the SAPWrite TABL JSON Schema with clear descriptions:
  - `appendOf`: "Parent table name (e.g. 'MARA'). When set, creates an APPEND structure (R3TR APPS) extending the parent table. Required for append structures."
  - `fields`: "Array of fields to add to the parent table. Required when appendOf is set. Each field: { name, dataType, length?, decimals? }"
- [ ] In `src/authz/policy.ts`, no change needed — TABL APPEND uses the same `SAPWrite.create` policy as base TABL
- [ ] Verify three-file sync: `grep -rn "appendOf" src/handlers/` should hit all three files
- [ ] Run `npm run typecheck` — no errors
- [ ] Run `npm test` — all tests pass

### Task 4: Integration test for TABL APPEND

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Live integration test against a standard table on a4h. Use a Z-namespace append.

- [ ] Use `getTestClient()` from `tests/integration/helpers.ts`
- [ ] Pick a parent table that exists on a4h (e.g. `MARA` for materials, or `T000` for clients — verify the table is present first via `SAPRead(type=TABL, name=...)`). If neither exists, skip via `requireOrSkip(ctx, parentTablePresent, 'APPEND_PARENT_NOT_PRESENT')`.
- [ ] Test: `SAPWrite create TABL appendOf=MARA name=ZMARA_<unique> fields=[{name: 'ZZ_TEST_FIELD', dataType: 'CHAR', length: 10}]` → expect 201 / success; then `SAPActivate`; then `SAPRead(type=TABL, name=ZMARA_<unique>)` to verify the append is live; cleanup with `SAPWrite(action='delete')`
- [ ] Test: rejects an append whose name doesn't start with Z/Y (sanity check on the schema)
- [ ] Tag cleanup catches with `// best-effort-cleanup`
- [ ] Capture the actual XML response root element from the first successful create — if it differs from the placeholder in Task 2, update both the builder and parser
- [ ] Run `TEST_SAP_URL=... npm run test:integration -- TABL.*APPEND` — test passes or skips

### Task 5: Final 5a verification

- [ ] Run unit tests: `npm test -- (ddic-xml|validator|intent)` — all pass
- [ ] Run integration: `npm run test:integration -- TABL` — passes or skips
- [ ] Verify three-file sync: `appendOf` appears in `tools.ts`, `schemas.ts`, `intent.ts` ✅
- [ ] Verify AFF schema loads: write a TABL create call with a malformed envelope and confirm the validator catches it

### Task 6: Create the BAdI scaffold pure module

**Files:**
- Create: `src/adt/badi-scaffold.ts`
- Modify: `src/adt/types.ts`
- Create: `tests/unit/adt/badi-scaffold.test.ts`

Pure module mirroring `src/adt/rap-handlers.ts` (1233 LOC — read its header comment for the design pattern). The scaffold module takes a parsed BAdI requirement and an existing CLAS source, returns updated CLAS source with method declarations + empty implementations.

- [ ] In `src/adt/types.ts`, add:
  - `interface BadiDefinitionInfo { name: string; interfaceName: string; isMultiple: boolean; isFilterDependent: boolean; methods: BadiMethod[] }`
  - `interface BadiMethod { name: string; signature: string; description: string }`
  - `interface BadiRequirement { interfaceName: string; methods: BadiMethod[] }`
  - `interface BadiScaffoldResult { classSource: string; inserted: BadiMethod[]; changed: boolean }`
- [ ] Create `src/adt/badi-scaffold.ts` exporting pure functions:
  - `extractBadiRequirements(badiDef: BadiDefinitionInfo): BadiRequirement[]` — given a parsed BAdI definition, return one `BadiRequirement` per method that needs implementation
  - `applyBadiImplementationStubs(req: BadiRequirement, classSource: string): BadiScaffoldResult` — splice `INTERFACES <interface>` into the class definition section and add `METHOD <interface>~<method>. ENDMETHOD.` blocks to the implementation section
  - `buildEmptyBadiImplClass(className: string, badiInterface: string): string` — emit a minimal CLAS source `CLASS <name> DEFINITION PUBLIC FINAL CREATE PUBLIC. PUBLIC SECTION. INTERFACES <badiInterface>. ENDCLASS. CLASS <name> IMPLEMENTATION. ENDCLASS.`
- [ ] Add unit tests (~10 tests): valid scaffold from empty class, scaffold preserves existing methods, multiple BAdI methods in one class, BAdI with filter parameter, splices INTERFACES into the right section, idempotent (running twice doesn't duplicate)
- [ ] Run `npm test -- badi-scaffold` — all tests pass

### Task 7: Add `getBadiDefinition` client method and XML parser

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/fixtures/xml/badi-definition.xml`

Adds the reader needed by Task 8's `scaffold_badi_impl` handler.

- [ ] In `src/adt/client.ts`, add `async getBadiDefinition(name: string): Promise<BadiDefinitionInfo>` near `getEnhancementImplementation()` at line 595. Endpoint: `/sap/bc/adt/enhancements/badi_definitions/<name>` — verify the exact path against the abap-adt-api library if uncertain.
- [ ] In `src/adt/xml-parser.ts`, add `parseBadiDefinition(xml: string): BadiDefinitionInfo` near `parseEnhancementImplementation()` at line 643. Parse the BAdI definition XML to extract: interface name, isMultiple flag, isFilterDependent flag, list of methods (name + signature + ABAP-Doc).
- [ ] Create a fixture XML in `tests/fixtures/xml/badi-definition.xml` based on a real BAdI (capture from a4h or copy from abap-adt-api fixtures)
- [ ] Add unit tests to `tests/unit/adt/xml-parser.test.ts` for `parseBadiDefinition` (~3 tests): happy path, missing interface attribute, multi-method BAdI
- [ ] Add unit tests to `tests/unit/adt/client.test.ts` for `getBadiDefinition` using mock-fetch (~2 tests): happy path + 404
- [ ] Run `npm test` — all tests pass

### Task 8: Wire `SAPWrite action='scaffold_badi_impl'` through the three-file sync

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/authz/policy.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

New SAPWrite action that reads the BAdI definition + writes a new CLAS stub. Optionally registers the implementation under an enhancement spot (deferred — out of scope for v1).

- [ ] In `src/handlers/intent.ts`, add `case 'scaffold_badi_impl'` in `handleSAPWrite` near the existing `case 'scaffold_rap_handlers'`. Body:
  - Read the BAdI definition via `client.getBadiDefinition(args.badiDefinition)`
  - Call `extractBadiRequirements(def)` to get the method list
  - Call `buildEmptyBadiImplClass(args.implementationClass, def.interfaceName)` to get the starter CLAS source
  - Call `applyBadiImplementationStubs(req, starterSource)` to splice in the method stubs
  - Create the CLAS via the existing CLAS write path (`SAPWrite.create` internally — call `buildCreateXml('CLAS', ...)` then `createObject()`)
  - Optionally activate (`SAPActivate`) if `args.activate !== false`
  - Return the URI of the new class + the scaffold result summary as JSON
- [ ] In `src/handlers/schemas.ts`, add the `scaffold_badi_impl` action to the SAPWrite action union with args `{ badiDefinition: string, implementationClass: string, implementationName: string, package: string, enhancementSpot?: string, activate?: boolean (default true) }`
- [ ] In `src/handlers/tools.ts`, mirror the schema in the JSON Schema with descriptions referencing the BAdI/ENHS terminology
- [ ] In `src/authz/policy.ts`, add `'SAPWrite.scaffold_badi_impl': 'write'`
- [ ] Add unit tests to `tests/unit/handlers/intent.test.ts` (~5 tests): happy path with mock BAdI def, BAdI def not found returns clean error, write failure returns error, allowWrites=false rejected, package allowlist enforced
- [ ] Run `npm test` — all tests pass
- [ ] Verify three-file sync: `grep -rn "scaffold_badi_impl" src/handlers/ src/authz/` — all four files

### Task 9: Author the `extensibility-assistant` skill

**Files:**
- Create: `skills/extensibility-assistant/SKILL.md`

Skill that orchestrates either the field-extension flow (append structure) or the BAdI implementation flow.

- [ ] Create `skills/extensibility-assistant/` directory
- [ ] Write `SKILL.md` with frontmatter: `name: extensibility-assistant`, `description: ABAP extensibility helper — extend a standard SAP table with an APPEND structure, or implement a BAdI. Use when user asks to "add a custom field to MARA", "create a BAdI implementation for X", "extend standard SAP", or "find the right BAdI for Y".`
- [ ] Step 1 — Detect intent: field-extension vs BAdI implementation. Ask if unclear.
- [ ] **Field-extension branch:**
  1. User names the target table (e.g. `MARA`)
  2. `SAPRead(type='TABL', name='<target>')` — confirm the table exists and read its current field list
  3. Look up `mcp-sap-docs search` for "APPEND structure" + the table's BAdI/extension recommendations
  4. Compose the append source: `Z<TARGET>_<PURPOSE>` name, fields from user requirements
  5. `SAPWrite(action='create', type='TABL', appendOf='<target>', name='Z<TARGET>_<PURPOSE>', fields=[...], package='$TMP' or user-specified)`
  6. `SAPActivate`
  7. Verify via `SAPRead`
- [ ] **BAdI implementation branch:**
  1. User describes the BAdI or business scenario
  2. `SAPSearch(searchType='tadir_lookup', source='adt', objectType='ENHS')` — find enhancement spots; OR `SAPSearch(query='BAdI: <description>')` — fuzzy search
  3. Read the chosen BAdI definition (currently via SAPRead type=ENHS to read the spot; the per-BAdI getBadiDefinition is internal to the scaffold action)
  4. `SAPWrite(action='scaffold_badi_impl', badiDefinition='<spot>~<badi>', implementationClass='ZCL_MY_IMPL', implementationName='ZMY_IMPL', enhancementSpot='<spot>', package='$TMP')`
  5. Show the scaffolded class
  6. Iterate via `SAPWrite(action='edit_method')` to fill in business logic
- [ ] Edge cases: target table is in a restricted package → suggest $TMP; BAdI not found → ask for an alternative description; BAdI is filter-dependent → explain filter values are required at runtime
- [ ] Cross-link: *"For RAP-style behavior extensions (not BAdI), see `generate-rap-logic`."*
- [ ] Verify: `cat skills/extensibility-assistant/SKILL.md | head -10` shows the frontmatter

### Task 10: Documentation

**Files:**
- Modify: `docs/tools.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`, `docs/index.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs/roadmap.md` (if exists)

- [ ] In `docs/tools.md`, document:
  - `SAPWrite type='TABL' appendOf=<parent>` — APPEND structure semantics, args, examples
  - `SAPWrite action='scaffold_badi_impl'` — args, return shape, examples
- [ ] In `CLAUDE.md`, add to "Key Files for Common Tasks":
  - `| Add TABL APPEND structure subtype | src/adt/ddic-xml.ts (buildAppendStructureXml), src/aff/schemas/tabl-v1.json, src/aff/validator.ts (TYPE_MAP), src/handlers/intent.ts (buildCreateXml line 2709), src/handlers/schemas.ts, src/handlers/tools.ts, tests/unit/adt/ddic-xml.test.ts, tests/integration/adt.integration.test.ts |`
  - `| Add BAdI implementation scaffold | src/adt/badi-scaffold.ts (pure module), src/adt/client.ts (getBadiDefinition near line 595), src/adt/xml-parser.ts (parseBadiDefinition near line 643), src/handlers/intent.ts (case 'scaffold_badi_impl'), src/handlers/schemas.ts, src/handlers/tools.ts, src/authz/policy.ts, skills/extensibility-assistant/SKILL.md |`
- [ ] Update README/docs/index with the new SAPWrite capabilities + the skill
- [ ] In `docs/compare/00-feature-matrix.md`, add or update Extensibility section: ARC-1 ✅ APPEND + BAdI scaffold; SAP Joule Extensibility Assistant noted as a UI-side equivalent
- [ ] Update the feature matrix "Last Updated" header
- [ ] If `docs/roadmap.md` exists, mark "Extensibility Assistant parity" completed and link to this plan
- [ ] Run `npm run lint` — passes

### Task 11: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run integration: `npm run test:integration` — passes or skips with valid reason
- [ ] Verify three-file sync for both new features (TABL `appendOf` and `scaffold_badi_impl`)
- [ ] Manually invoke the skill via Claude Code for both branches: APPEND on MARA, BAdI scaffold on a real spot
- [ ] Move this plan to `docs/plans/completed/`

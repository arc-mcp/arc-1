# Plan: FEAT-13 DDIC Domain/Data Element Write

## Overview

Add create, update, and delete support for DDIC Domains (DOMA) and Data Elements (DTEL) to the SAPWrite tool. Currently ARC-1 can read these objects but cannot write them, blocking full AI-assisted data modeling workflows (e.g., "create domain ZSTATUS with values A=Active, I=Inactive, then create a data element referencing it").

The ADT API for DOMA/DTEL write was validated against the A4H test system. Key findings:

1. **Create** uses POST to the collection URL (`/sap/bc/adt/ddic/domains`, `/sap/bc/adt/ddic/dataelements`) with type-specific v2 content types — NOT `application/xml` like other object types.
2. **Update** uses the standard lock/PUT/unlock flow with stateful sessions (already supported by `http.withStatefulSession()`).
3. **Delete** uses the standard lock/DELETE/unlock flow.
4. **Content types**: Only v2 is supported (`application/vnd.sap.adt.domains.v2+xml`, `application/vnd.sap.adt.dataelements.v2+xml`). v1 returns 406.
5. **Data element XML is strictly ordered** — every field from `typeKind` through `deactivateBIDIFiltering` must be present.
6. **Domain fixed values** work via nested `<doma:fixValues>` elements in the create/update XML.

Design approach: DOMA/DTEL writes differ from source-based objects (PROG, CLAS, etc.) because they have no `/source/main` endpoint — the entire object is defined by structured XML properties. This requires a new "metadata write" pattern: create sends the full XML body, update sends a PUT with the full XML body (not source text). This is fundamentally different from the existing create-then-write-source pattern.

## Context

### Current State

- DOMA/DTEL **read** is fully implemented: `client.getDomain()`, `client.getDataElement()`, XML parsing, type definitions
- DOMA/DTEL are in `SAPREAD_TYPES` but NOT in `SAPWRITE_TYPES`
- `buildCreateXml()` has no cases for DOMA/DTEL
- The existing `create` action in SAPWrite creates an object shell then writes source — this pattern doesn't work for DOMA/DTEL which have no source endpoint
- `safeUpdateSource()` writes text/plain to `/source/main` — DOMA/DTEL updates need XML PUT to the object URL itself

### Target State

- SAPWrite supports `create`, `update`, `delete` for DOMA and DTEL
- Domain creates accept: dataType, length, decimals, outputLength, conversionExit, signExists, lowercase, fixedValues, valueTable
- Data element creates accept: typeKind (domain or predefinedAbapType), typeName/domainName, dataType, length, decimals, labels (short/medium/long/heading), searchHelp, searchHelpParameter, setGetParameter, changeDocument
- Updates use lock/PUT/unlock with the full XML body
- Deletes follow existing lock/DELETE/unlock pattern (already works, just needs type routing)
- `batch_create` also supports DOMA/DTEL for end-to-end data modeling in one call

### Key Files

| File | Role |
|------|------|
| `src/adt/crud.ts` | CRUD operations: lock/update/delete/create patterns |
| `src/adt/client.ts` | ADT client facade — getDomain(), getDataElement() at lines 300-311 |
| `src/adt/types.ts` | DomainInfo (line 240), DataElementInfo (line 256) — existing read types |
| `src/adt/xml-parser.ts` | parseDomainMetadata() (line 354), parseDataElementMetadata() (line 405) |
| `src/handlers/intent.ts` | handleSAPWrite() (line 1142), buildCreateXml() (line 954), objectBasePath() (line 1074) |
| `src/handlers/schemas.ts` | SAPWRITE_TYPES arrays (line 121-122), SAPWriteSchema (line 138) |
| `src/handlers/tools.ts` | SAPWRITE_TYPES arrays (line 101-102), tool descriptions (line 104) |
| `src/handlers/hyperfocused.ts` | Hyperfocused mode — may need DOMA/DTEL write references |
| `src/adt/safety.ts` | checkOperation(), checkPackage() — already covers Create/Update/Delete |
| `tests/unit/handlers/intent.test.ts` | SAPWrite handler tests |
| `tests/unit/adt/crud.test.ts` | CRUD operation unit tests |
| `tests/fixtures/xml/domain-metadata.xml` | Domain XML fixture (BUKRS) |
| `tests/fixtures/xml/dataelement-metadata.xml` | Data element XML fixture (BUKRS) |

### Design Principles

1. **Metadata-write pattern, not source-write**: DOMA/DTEL have no `/source/main`. Creates send the full XML body; updates PUT the full XML body to the object URL. This is a new pattern distinct from source-based objects.
2. **Type-specific content types are mandatory**: `application/vnd.sap.adt.domains.v2+xml` and `application/vnd.sap.adt.dataelements.v2+xml`. Generic `application/xml` returns 415.
3. **Reuse existing CRUD primitives**: `lockObject()`, `unlockObject()`, `deleteObject()`, `createObject()` from `src/adt/crud.ts` all work for DOMA/DTEL — only the content type and body differ.
4. **New `updateObject()` function**: Needed for metadata PUT (existing `updateSource()` writes text/plain). Add a parallel function that PUTs XML to the object URL.
5. **Strict XML element ordering for data elements**: All fields must be present in exact order. Use a builder function that always emits every field.
6. **Sensible defaults**: Omitted properties get safe defaults (empty strings, false booleans, "000000" for lengths). The LLM only needs to specify what matters.
7. **Consistent safety**: All writes go through existing `checkOperation()` and `checkPackage()` gates. No new safety surface needed.

## Development Approach

- Test-first: add XML fixtures for create/update responses, then implement builders, then wire handlers
- Each task ends with `npm test` passing
- Integration tests validate against the A4H system
- The new `updateObject()` function in crud.ts is the key primitive — it enables the lock/PUT-XML/unlock pattern for metadata objects

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add CRUD primitives for metadata objects

**Files:**
- Modify: `src/adt/crud.ts`
- Modify: `tests/unit/adt/crud.test.ts`

Add a new `updateObject()` function to `src/adt/crud.ts` that PUTs an XML body to an object URL with a custom content type. This parallels the existing `updateSource()` (line 68) but writes structured XML instead of text/plain to the object URL instead of `/source/main`.

Also add a `safeUpdateObject()` convenience function (paralleling `safeUpdateSource()` at line 112) that wraps the lock/updateObject/unlock pattern with `withStatefulSession()`.

- [ ] Add `updateObject(http, safety, objectUrl, body, lockHandle, contentType, transport?)` function to `src/adt/crud.ts`. It should call `checkOperation(safety, OperationType.Update, 'UpdateObject')`, then `http.put()` with the given content type (not text/plain). URL construction: append `?lockHandle=...` and optionally `&corrNr=...` — same pattern as `updateSource()` at line 78-85.
- [ ] Add `safeUpdateObject(http, safety, objectUrl, body, contentType, transport?)` that wraps lock/updateObject/unlock in `withStatefulSession()` with try-finally. Follow the exact pattern of `safeUpdateSource()` at line 112-129, including `lock.corrNr` auto-propagation.
- [ ] Update the `createObject()` function signature — it already accepts `contentType` parameter (line 56), so no change needed there. Just verify it works with the v2 content types.
- [ ] Add unit tests (~6 tests): updateObject happy path, updateObject with transport, safeUpdateObject happy path with lock/unlock, safeUpdateObject corrNr auto-propagation, safeUpdateObject unlock-on-error, updateObject safety block. Mock pattern: `vi.mock('undici', ...)` with `mockResponse()` from `tests/helpers/mock-fetch.ts`.
- [ ] Run `npm test` — all tests must pass

### Task 2: Add XML builders for DOMA/DTEL create and update

**Files:**
- Modify: `src/handlers/intent.ts` (the `buildCreateXml()` function at line 954)
- Create: `src/adt/ddic-xml.ts` (new file for DDIC XML builder functions)
- Create: `tests/unit/adt/ddic-xml.test.ts`
- Create: `tests/fixtures/xml/domain-create-response.xml`
- Create: `tests/fixtures/xml/dataelement-create-response.xml`

DOMA/DTEL creation XML is significantly more complex than other object types (which are just a root element with name/description/package). Domains need `<doma:content>` with type information, output information, and optional value information. Data elements need `<dtel:definition>` with ALL fields in strict order.

- [ ] Create `src/adt/ddic-xml.ts` with two builder functions:
  - `buildDomainXml(params: DomainCreateParams): string` — builds the full domain XML with `<doma:domain>` root element, namespace declarations (`xmlns:doma="http://www.sap.com/dictionary/domain"`, `xmlns:adtcore="http://www.sap.com/adt/core"`), `<adtcore:packageRef>`, and `<doma:content>` containing typeInformation, outputInformation, and valueInformation (with optional fixValues). Parameters: `{ name, description, package, dataType, length, decimals?, outputLength?, conversionExit?, signExists?, lowercase?, fixedValues?: Array<{low, high?, description}>, valueTable? }`.
  - `buildDataElementXml(params: DataElementCreateParams): string` — builds the full data element XML with `<blue:wbobj>` root (namespace `xmlns:blue="http://www.sap.com/wbobj/dictionary/dtel"`), `<adtcore:packageRef>`, and `<dtel:dataElement>` with ALL fields in strict order: typeKind, typeName, dataType, dataTypeLength, dataTypeDecimals, shortFieldLabel, shortFieldLength, shortFieldMaxLength, mediumFieldLabel, mediumFieldLength, mediumFieldMaxLength, longFieldLabel, longFieldLength, longFieldMaxLength, headingFieldLabel, headingFieldLength, headingFieldMaxLength, searchHelp, searchHelpParameter, setGetParameter, defaultComponentName, deactivateInputHistory, changeDocument, leftToRightDirection, deactivateBIDIFiltering. Parameters: `{ name, description, package, typeKind, typeName?, domainName?, dataType?, length?, decimals?, shortLabel?, mediumLabel?, longLabel?, headingLabel?, searchHelp?, searchHelpParameter?, setGetParameter?, defaultComponentName?, changeDocument? }`.
  - Both functions must use `escapeXml()` for all user-provided values (import from `intent.ts` or duplicate the 5-line helper).
  - Length/decimal values must be zero-padded to 6 digits (e.g., `"4"` → `"000004"`) to match SAP's format. Label length fields should default to their maxLength values.
- [ ] Export `DomainCreateParams` and `DataElementCreateParams` interfaces from `src/adt/ddic-xml.ts`.
- [ ] Add `buildCreateXml()` cases for DOMA and DTEL in `src/handlers/intent.ts` (line 954). These should delegate to the new builder functions in `ddic-xml.ts`. The DOMA case uses `adtcore:type="DOMA/DD"`, DTEL uses `adtcore:type="DTEL/DE"`. Note: `buildCreateXml()` currently takes `(type, name, pkg, description)` — for DOMA/DTEL we need additional properties. Add an optional 5th parameter `properties?: Record<string, unknown>` to pass through domain/data element specific fields.
- [ ] Add XML fixtures: `tests/fixtures/xml/domain-create-response.xml` (based on actual SAP response from test — domain with `adtcore:version="inactive"`), `tests/fixtures/xml/dataelement-create-response.xml`.
- [ ] Add unit tests (~10 tests) in `tests/unit/adt/ddic-xml.test.ts`: buildDomainXml basic, buildDomainXml with fixed values, buildDomainXml with value table, buildDomainXml zero-padding, buildDataElementXml with domain reference, buildDataElementXml with predefined type, buildDataElementXml strict field ordering, buildDataElementXml with all optional fields, buildDataElementXml defaults for omitted fields, XML escaping of special characters.
- [ ] Run `npm test` — all tests must pass

### Task 3: Wire DOMA/DTEL into SAPWrite handler

**Files:**
- Modify: `src/handlers/intent.ts` (handleSAPWrite at line 1142)
- Modify: `src/handlers/schemas.ts` (SAPWRITE_TYPES at line 121-122, SAPWriteSchema at line 138)
- Modify: `src/handlers/tools.ts` (SAPWRITE_TYPES at line 101-102, descriptions at line 104)
- Modify: `tests/unit/handlers/intent.test.ts`

Wire the new DOMA/DTEL write capability into the SAPWrite handler. This is the most complex task because DOMA/DTEL writes follow a different flow than source-based objects.

- [ ] Add `'DOMA'` and `'DTEL'` to `SAPWRITE_TYPES_ONPREM` and `SAPWRITE_TYPES_BTP` in both `src/handlers/schemas.ts` (line 121-122) and `src/handlers/tools.ts` (line 101-102).
- [ ] Add DOMA/DTEL-specific properties to the Zod schema in `src/handlers/schemas.ts`. Add optional fields to `SAPWriteSchema` (line 138): `dataType: z.string().optional()`, `length: z.coerce.number().optional()`, `decimals: z.coerce.number().optional()`, `outputLength: z.coerce.number().optional()`, `conversionExit: z.string().optional()`, `signExists: z.coerce.boolean().optional()`, `lowercase: z.coerce.boolean().optional()`, `fixedValues: z.array(z.object({low: z.string(), high: z.string().optional(), description: z.string().optional()})).optional()`, `valueTable: z.string().optional()`, `typeKind: z.enum(['domain', 'predefinedAbapType']).optional()`, `typeName: z.string().optional()`, `shortLabel: z.string().optional()`, `mediumLabel: z.string().optional()`, `longLabel: z.string().optional()`, `headingLabel: z.string().optional()`, `searchHelp: z.string().optional()`, `searchHelpParameter: z.string().optional()`, `setGetParameter: z.string().optional()`, `defaultComponentName: z.string().optional()`, `changeDocument: z.coerce.boolean().optional()`. Do the same for `SAPWriteSchemaBtp`. Also add these to the batch object schemas.
- [ ] Update the `create` case in `handleSAPWrite()` (line 1182) to detect DOMA/DTEL and use a different flow:
  - For DOMA: call `buildDomainXml()` with the DDIC properties from args, then `createObject()` with content type `application/vnd.sap.adt.domains.v2+xml; charset=utf-8`. The create URL is `/sap/bc/adt/ddic/domains` (the collection URL from `objectBasePath('DOMA')`). Do NOT attempt to write source after create (DOMA has no source).
  - For DTEL: call `buildDataElementXml()` with properties from args, then `createObject()` with content type `application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8`. Create URL: `/sap/bc/adt/ddic/dataelements`. No source write.
  - Return a success message with the created object details.
- [ ] Update the `update` case in `handleSAPWrite()` (line 1171) to detect DOMA/DTEL and use `safeUpdateObject()` instead of `safeUpdateSource()`. For update, the LLM sends the full property set (same fields as create). Build the XML body, then PUT it to the object URL with the v2 content type. This replaces the entire object definition.
- [ ] Update the `delete` case — no changes needed. The existing lock/DELETE/unlock flow already works for DOMA/DTEL (verified on test system). `objectUrlForType()` already returns the correct URL for DOMA/DTEL (line 1102-1105).
- [ ] Update the `batch_create` case (line 1274) to handle DOMA/DTEL objects: use the metadata-write flow (no source step, no lint step) and the correct content type.
- [ ] Update SAPWrite tool descriptions in `src/handlers/tools.ts` (lines 104-114) to mention DOMA and DTEL support with property descriptions.
- [ ] Add unit tests (~12 tests): create DOMA with basic properties, create DOMA with fixed values, create DTEL with domain reference, create DTEL with predefined type, update DOMA (mock lock/PUT/unlock), update DTEL, delete DOMA, delete DTEL, batch_create with DOMA+DTEL, DOMA create with package check, DTEL create in read-only mode (blocked), Zod schema validation for DOMA/DTEL properties.
- [ ] Run `npm test` — all tests must pass

### Task 4: Add integration tests

**Files:**
- Modify: `tests/integration/crud.lifecycle.integration.test.ts`
- Modify: `tests/integration/crud-harness.ts` (if new helpers needed)

Add integration tests that exercise the full DOMA/DTEL CRUD lifecycle against the real SAP system. These tests require `TEST_SAP_URL` to be set.

- [ ] Add a `describe('DOMA CRUD lifecycle')` block in `tests/integration/crud.lifecycle.integration.test.ts`:
  - Generate unique name using `generateUniqueName('ZARC1_TDOM')` from `crud-harness.ts`
  - Create a domain with `CHAR` type, length 1, two fixed values (A=Active, I=Inactive)
  - Read back and verify: dataType, length, fixedValues match
  - Update: change length to 2, add a third fixed value
  - Read back and verify updates applied
  - Delete the domain
  - Read back — expect 404
  - Use `try/finally` for cleanup (delete in finally block, `// best-effort-cleanup` tag)
- [ ] Add a `describe('DTEL CRUD lifecycle')` block:
  - Generate unique name using `generateUniqueName('ZARC1_TDEL')`
  - Create a data element with `typeKind: 'predefinedAbapType'`, `dataType: 'CHAR'`, length 10, labels (short/medium/long/heading)
  - Read back and verify: typeKind, dataType, length, labels match
  - Update: change labels
  - Read back and verify updates
  - Delete the data element
  - Read back — expect 404
  - Cleanup via `try/finally`
- [ ] Add a `describe('DOMA+DTEL dependency lifecycle')` block:
  - Create a domain, then create a data element referencing it (`typeKind: 'domain'`, `typeName: domainName`)
  - Read the data element back, verify it references the domain
  - Delete data element first, then domain (reverse dependency order)
  - Cleanup via `try/finally`
- [ ] Use `requireOrSkip(ctx, testUrl, SkipReason.NO_CREDENTIALS)` for credential checks. Use `expectSapFailureClass()` for expected errors.
- [ ] Run `npm run test:integration` (if SAP credentials available) or verify tests compile with `npm run typecheck`

### Task 5: Add E2E tests

**Files:**
- Modify: `tests/e2e/fixtures.ts`
- Create: `tests/e2e/ddic-write.e2e.test.ts`

Add E2E tests that exercise DOMA/DTEL write through the full MCP JSON-RPC stack.

- [ ] Add a new E2E test file `tests/e2e/ddic-write.e2e.test.ts` with tests for:
  - SAPWrite create DOMA — call via MCP `callTool('SAPWrite', {action: 'create', type: 'DOMA', name: uniqueName, package: '$TMP', dataType: 'CHAR', length: 1, fixedValues: [{low: 'X', description: 'Test'}]})`. Use `expectToolSuccess()`. Clean up in `finally` with delete.
  - SAPWrite create DTEL — call via MCP with domain-based and predefined type variants.
  - SAPWrite update DOMA — create, then update with new properties, read back to verify.
  - SAPWrite delete DOMA/DTEL — create then delete, verify 404 on re-read.
  - SAPWrite batch_create with DOMA+DTEL — create domain then data element referencing it in one batch call.
- [ ] Use `connectClient()` and helpers from `tests/e2e/helpers.ts`. Use `generateUniqueName()` for collision-safe names. All transient objects cleaned up in `finally` blocks.
- [ ] Run `npm run test:e2e` (if MCP server running) or verify with `npm run typecheck`

### Task 6: Update documentation and roadmap

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `README.md` (if feature list needs updating)
- Modify: `.claude/commands/implement-feature.md` (if it references SAPWrite capabilities)

- [ ] Update `docs/tools.md` SAPWrite section: add DOMA and DTEL to the supported types list, document the DDIC-specific parameters (dataType, length, fixedValues, typeKind, labels, etc.), add example calls for creating a domain with fixed values and creating a data element referencing a domain.
- [ ] Update `docs/roadmap.md`: change FEAT-13 status from "Not started" to "Done", add completion date.
- [ ] Update `docs/compare/00-feature-matrix.md`: change Domain write and Data element write from ❌ to ✅, refresh "Last Updated" date.
- [ ] Update `CLAUDE.md`:
  - Add `src/adt/ddic-xml.ts` to the codebase structure tree under `src/adt/`
  - Add row to "Key Files for Common Tasks" table: "Add DDIC domain/data element write" → `src/adt/ddic-xml.ts`, `src/adt/crud.ts`, `src/handlers/intent.ts`
  - Update config table if any new config options were added
  - Update SAPWrite types list in any example or reference
- [ ] Check `.claude/commands/implement-feature.md` and other skills for references to SAPWrite supported types that need DOMA/DTEL added.
- [ ] Run `npm test` — all tests still pass after doc changes

### Task 7: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify DOMA/DTEL appear in SAPWrite tool schema (check JSON schema output)
- [ ] Verify existing SAPRead for DOMA/DTEL still works (no regressions)
- [ ] Move this plan to `docs/plans/completed/`

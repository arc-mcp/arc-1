# ABAP File Formats (AFF) Integration

## Overview

Integrate ABAP File Formats (AFF) concepts into ARC-1 to improve how the MCP server reads, writes, and reasons about ABAP objects. This plan focuses on three high-value improvements:

1. **Structured class decomposition in SAPRead** — Return class includes (testclasses, local definitions, local implementations, macros) as a structured multi-part response instead of a single blob, and fetch object metadata (description, language version, category) from the ADT object endpoint.
2. **Multi-object batch creation in SAPWrite** — Accept an ordered list of objects to create and activate in sequence, enabling single-call RAP stack creation instead of 10+ sequential tool calls.
3. **AFF JSON schema validation** — Bundle AFF JSON schemas from the open-source `SAP/abap-file-formats` repo and use them to validate object metadata before sending to SAP, providing fail-fast feedback with clear error messages.

These features are additive — they extend existing tool parameters without breaking current behavior. The existing plaintext format remains the default for backwards compatibility.

## Context

### Current State

- **SAPRead for classes** returns raw source from `/source/main` as a single text blob. Class metadata (description, language version, category) is not returned. Class includes (testclasses, definitions, implementations, macros) require an explicit `include` parameter and are fetched individually with `=== include_name ===` headers.
- **SAPWrite create** creates one object at a time via `buildCreateXml()` → `createObject()` → `safeUpdateSource()`. Creating a RAP service requires ~10 sequential tool calls with manual activation ordering.
- **No metadata validation** exists — LLM-generated metadata errors only surface as cryptic ADT XML errors after the write attempt.
- The AFF specification at `github.com/SAP/abap-file-formats` (MIT license, 83 object types, actively maintained) defines how ABAP objects decompose into JSON metadata + source files. ARC-1 does not use AFF today.

### Target State

- `SAPRead(type="CLAS", name="ZCL_FOO", format="structured")` returns a JSON response with metadata (description, language, category) and decomposed source (main, testclasses, definitions, implementations, macros) as separate named fields.
- `SAPWrite(action="batch_create", objects=[...], package="ZDEV", transport="K900123")` creates and activates multiple objects in dependency order via a single tool call.
- Object metadata is validated against bundled AFF JSON schemas before ADT API calls, with LLM-friendly error messages on validation failure.

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | ADT client — class reading with includes (lines 88-134), object metadata fetch |
| `src/adt/crud.ts` | CRUD operations — lock/create/update/unlock pattern |
| `src/adt/xml-parser.ts` | XML parsing — will add class metadata parser |
| `src/adt/types.ts` | ADT response types — will add `ClassMetadata`, `StructuredClassResponse` |
| `src/handlers/intent.ts` | Tool dispatch — SAPRead CLAS handler (lines 383-406), SAPWrite handler (lines 906-961), `buildCreateXml()` (lines 739-844) |
| `src/handlers/tools.ts` | Tool definitions — SAPRead schema (lines 282-327), SAPWrite schema (lines 333-361) |
| `src/handlers/schemas.ts` | Zod schemas — `SAPReadSchema` (lines 66-75), `SAPWriteSchema` (lines 114-122) |
| `src/adt/safety.ts` | Safety system — operation type checks |
| `src/handlers/hyperfocused.ts` | Hyperfocused mode — single SAP tool |
| `tests/unit/adt/client.test.ts` | Client unit tests — class reading tests |
| `tests/unit/handlers/intent.test.ts` | Handler unit tests — SAPRead/SAPWrite dispatch |
| `tests/unit/handlers/schemas.test.ts` | Schema validation tests |
| `tests/unit/adt/xml-parser.test.ts` | XML parser tests |

### Design Principles

1. **Additive, not breaking** — New parameters (`format`, `batch_create`) extend existing tools. Default behavior is unchanged. No migration required for existing MCP clients.
2. **ADT-native, not AFF-native** — We parse ADT XML responses into AFF-compatible structures, not replicate SAP's ABAP-side AFF serialization. The ADT REST API is the source of truth.
3. **Plaintext stays default** — The existing plaintext format is token-efficient for LLMs. Structured format is opt-in via `format="structured"`.
4. **Bundle schemas, don't depend on npm** — AFF JSON schemas are not published as an npm package. We bundle the schema files directly from the GitHub repo (MIT license).
5. **Batch is orchestration, not transaction** — Multi-object batch creation is sequential create+activate with error reporting, not atomic rollback. SAP ADT doesn't support transactions across object types.
6. **Safety checks apply per-object** — Each object in a batch goes through the same `checkOperation()` and `checkPackage()` guards as individual operations.

## Development Approach

- Tasks are ordered: types first, then client methods, then handler wiring, then schemas/tools, then batch, then validation, then docs
- Every task includes unit tests using the project's `vi.mock('undici')` + `mockResponse()` pattern
- Integration tests added for new ADT endpoints (auto-skipped when `TEST_SAP_URL` not set)
- E2E tests added for new tool operations (SAPRead format, SAPWrite batch_create)

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add class metadata types and ADT metadata parser

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/fixtures/xml/class-metadata.xml`
- Modify: `tests/unit/adt/xml-parser.test.ts`

ADT exposes class metadata via `GET /sap/bc/adt/oo/classes/{name}` (without `/source/main`). This returns XML with description, language, category, fixPointArithmetic, and other properties. This task adds the types and parser to extract this metadata.

- [x] Add `ClassMetadata` interface to `src/adt/types.ts` with fields: `name`, `description`, `language`, `abapLanguageVersion` (optional, BTP only), `category` (string, e.g. "generalObjectType", "exitClass", "testClass"), `fixPointArithmetic` (boolean), `package` (string). Place it near the existing `DomainInfo` / `DataElementInfo` types (around line 239).
- [x] Add `StructuredClassResponse` interface to `src/adt/types.ts` with fields: `metadata` (ClassMetadata), `main` (string — main source), `testclasses` (string | null), `definitions` (string | null), `implementations` (string | null), `macros` (string | null). This mirrors the AFF multi-file decomposition for classes.
- [x] Create XML fixture `tests/fixtures/xml/class-metadata.xml` with a realistic ADT class XML response. The ADT response for `GET /sap/bc/adt/oo/classes/{name}` returns XML with root element `class:abapClass` containing attributes like `adtcore:description`, `adtcore:language`, `adtcore:masterLanguage`, `class:category`, `class:fixPointArithmetic`, and a nested `adtcore:packageRef` element.
- [x] Add `parseClassMetadata(xml: string): ClassMetadata` function to `src/adt/xml-parser.ts`. Follow the pattern of `parseDomainMetadata()` (line 318) and `parseServiceBinding()` (line 428): call `parseXml(xml)`, extract the root element (after NS strip: `abapClass`), read attributes and nested elements. Map `class:category` numeric codes to human-readable strings using the AFF enum: `"00"` → `"generalObjectType"`, `"40"` → `"exitClass"`, etc.
- [x] Add unit tests (~6 tests) to `tests/unit/adt/xml-parser.test.ts`: parse valid class metadata XML, handle missing optional fields (abapLanguageVersion, category defaults), verify package extraction, verify category code mapping, handle empty/malformed XML gracefully.
- [x] Run `npm test` — all tests must pass

### Task 2: Add class metadata fetching and structured read to ADT client

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

This task adds two new methods to the ADT client: one to fetch class metadata from the object endpoint, and one to return a structured class response with metadata + decomposed includes.

- [x] Add `getClassMetadata(name: string): Promise<ClassMetadata>` method to the `AdtClient` class in `src/adt/client.ts`. It should: call `checkOperation(this.safety, OperationType.Read, 'GetClassMetadata')`, fetch `GET /sap/bc/adt/oo/classes/${encodeURIComponent(name)}` (no `/source/main` suffix), pass `Accept: application/xml` header, and call `parseClassMetadata(resp.body)` from `xml-parser.ts`. Place it after `getClass()` (after line 134).
- [x] Add `getClassStructured(name: string): Promise<StructuredClassResponse>` method to `AdtClient`. It should: (1) call `getClassMetadata(name)` to get metadata, (2) call `getClass(name)` to get main source, (3) for each include (`testclasses`, `definitions`, `implementations`, `macros`), call `getClass(name, include)` and catch 404 errors (set to null if not found — follow the existing 404 handling pattern at lines 124-131), (4) return a `StructuredClassResponse` with all fields populated. Use `Promise.all` for the include fetches to parallelize them.
- [x] Add unit tests (~8 tests) to `tests/unit/adt/client.test.ts`: (1) `getClassMetadata` makes correct GET request without `/source/main`, (2) `getClassMetadata` passes through parsed metadata, (3) `getClassStructured` fetches metadata + main + all includes, (4) `getClassStructured` sets null for 404 includes, (5) `getClassStructured` re-throws non-404 errors, (6) `getClassStructured` safety check blocks when read-only is off but operation filter blocks Read, (7) verify correct Accept header on metadata request, (8) verify parallel fetching of includes (mock should show all include requests made).
- [x] Run `npm test` — all tests must pass

### Task 3: Wire structured format into SAPRead handler and tool definition

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/hyperfocused.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`

This task connects the structured class reading to the SAPRead tool, adding a `format` parameter that LLMs can use to request structured output.

- [x] Add `format` parameter to the SAPRead tool definition in `src/handlers/tools.ts` (around line 323, after `sqlFilter`). Type: `string`, enum: `["text", "structured"]`, description: `'Output format. "text" (default): raw source code. "structured" (CLAS only): JSON with metadata (description, language, category) + decomposed source (main, testclasses, definitions, implementations, macros). Useful when you need to understand class structure or separate test code from production code.'`
- [x] Add `format` field to `SAPReadSchema` and `SAPReadSchemaBtp` in `src/handlers/schemas.ts` (around lines 66-85). Add `format: z.enum(['text', 'structured']).optional()` to both schemas.
- [x] Update the SAPRead CLAS handler in `src/handlers/intent.ts` (lines 383-406). Before the existing `methodParam` check (line 384), add a check: if `args.format === 'structured'` and type is `'CLAS'`, call `client.getClassStructured(name)` and return the result as `textResult(JSON.stringify(structuredResponse, null, 2))`. If `format="structured"` is used with a non-CLAS type, return `errorResult('The "structured" format is only supported for CLAS type. Other types return text format.')`. If `format` is omitted or `"text"`, fall through to existing behavior.
- [x] Update the hyperfocused tool definition in `src/handlers/hyperfocused.ts` if it includes SAPRead parameters — add `format` to its schema. Check the file first; if hyperfocused mode doesn't expose individual parameters, no change needed.
- [x] Add unit tests (~6 tests) to `tests/unit/handlers/intent.test.ts`: (1) SAPRead CLAS with `format="structured"` returns JSON with metadata and source fields, (2) SAPRead CLAS with `format="text"` returns plain source (default behavior), (3) SAPRead CLAS without `format` returns plain source (backwards compatible), (4) SAPRead PROG with `format="structured"` returns error message, (5) SAPRead CLAS with `format="structured"` and `method` param — format takes precedence, returns full structured response, (6) verify structured response is valid JSON with expected keys.
- [x] Add schema tests (~2 tests) to `tests/unit/handlers/schemas.test.ts`: (1) `format` field accepts "text" and "structured", (2) `format` field rejects invalid values.
- [x] Run `npm test` — all tests must pass

### Task 4: Add batch create action to SAPWrite

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/adt/safety.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`

This task adds a `batch_create` action to SAPWrite that creates and activates multiple objects in sequence. This is the key enabler for single-call RAP stack creation.

- [x] Add `batch_create` to the `action` enum in the SAPWrite tool definition in `src/handlers/tools.ts` (around line 339). Add a new `objects` parameter: type `array`, items with `type` (string), `name` (string), `source` (string, optional), `description` (string, optional). Description: `'For batch_create: ordered list of objects to create and activate. Each object needs type, name, and source (if applicable). Objects are created and activated in array order — put dependencies first (e.g., CDS view before projection, BDEF after CDS views).'`
- [x] Add `batch_create` to the action enum in `SAPWriteSchema` and `SAPWriteSchemaBtp` in `src/handlers/schemas.ts`. Add `objects` field as `z.array(z.object({ type: z.string(), name: z.string(), source: z.string().optional(), description: z.string().optional() })).optional()`.
- [x] Add the `batch_create` case to `handleSAPWrite()` in `src/handlers/intent.ts` (after the `delete` case, around line 1000). Implementation: (1) Parse the `objects` array from args, validate it's non-empty. (2) For each object in order: call `buildCreateXml(obj.type, obj.name, pkg, obj.description ?? obj.name)` to build creation XML, call `createObject()` to create, if `obj.source` is provided call `safeUpdateSource()` to write source, then call the activation function (`handleSAPActivate` or directly `client.activate(objectUrlForType(obj.type, obj.name))`). (3) Collect results per object (success/failure). (4) If any object fails, stop and report which objects succeeded and which failed. (5) Invalidate cache for all created objects. (6) Return a summary: `"Batch created N objects: OBJ1 (CLAS) ✓, OBJ2 (DDLS) ✓, OBJ3 (BDEF) ✗ — activation error: ..."`.
- [x] Ensure safety checks apply per-object: each `createObject()` call goes through `checkOperation(safety, OperationType.Create, 'CreateObject')` (already built into `createObject()` in `src/adt/crud.ts` line 59). Verify that `checkPackage()` is called for the batch package. Look at how the existing `create` action does this (around line 932) and replicate.
- [x] Add unit tests (~8 tests) to `tests/unit/handlers/intent.test.ts`: (1) batch_create with 3 objects creates all in order, (2) batch_create stops on first failure and reports partial results, (3) batch_create with empty objects array returns error, (4) batch_create respects read-only safety mode, (5) batch_create applies package filter, (6) batch_create activates each object after creation, (7) batch_create without source skips source update step, (8) batch_create invalidates cache for all created objects.
- [x] Add schema tests (~3 tests) to `tests/unit/handlers/schemas.test.ts`: (1) `batch_create` action is valid, (2) `objects` array validates correct structure, (3) `objects` rejects items missing required `type` or `name`.
- [x] Run `npm test` — all tests must pass

### Task 5: Bundle AFF JSON schemas and add metadata validation

**Files:**
- Create: `src/aff/schemas/` (directory)
- Create: `src/aff/schemas/clas-v1.json`
- Create: `src/aff/schemas/ddls-v1.json`
- Create: `src/aff/schemas/bdef-v1.json`
- Create: `src/aff/schemas/srvd-v1.json`
- Create: `src/aff/schemas/srvb-v1.json`
- Create: `src/aff/schemas/intf-v1.json`
- Create: `src/aff/schemas/prog-v1.json`
- Create: `src/aff/validator.ts`
- Create: `tests/unit/aff/validator.test.ts`

This task bundles AFF JSON schemas and provides a validation function for object metadata. The schemas are from `github.com/SAP/abap-file-formats` (MIT license, JSON Schema draft 2020-12).

- [x] Download the AFF JSON schema files for the 7 most important object types from the `SAP/abap-file-formats` GitHub repo. The schemas are at `file-formats/{type}/{type}-v1.json`. For each type (clas, ddls, bdef, srvd, srvb, intf, prog), download the schema and save to `src/aff/schemas/{type}-v1.json`. These are self-contained JSON Schema draft 2020-12 files with `additionalProperties: false`. Note: the schemas contain non-standard keywords like `enumTitles` and `enumDescriptions` — Ajv will need `strict: false`.
- [x] Install `ajv` as a dependency: `npm install ajv` (Ajv v8 supports JSON Schema draft 2020-12 via `ajv/dist/2020`). Add it to `package.json` dependencies.
- [x] Create `src/aff/validator.ts` with: (1) A `validateAffMetadata(type: string, metadata: Record<string, unknown>): { valid: boolean; errors?: string[] }` function. It should: load the schema for the given type from `src/aff/schemas/{type}-v1.json`, compile it with Ajv (use `new Ajv2020({ strict: false, allErrors: true })`), validate the metadata, and return structured errors. (2) A `getAffSchema(type: string): object | null` function that returns the raw schema for a type, or null if not bundled. (3) Cache compiled validators (Ajv compilation is expensive — compile once per type). (4) Map ARC-1 type codes to AFF type codes: `'CLAS' → 'clas'`, `'DDLS' → 'ddls'`, etc.
- [x] Add unit tests (~8 tests) to `tests/unit/aff/validator.test.ts`: (1) valid CLAS metadata passes validation, (2) invalid CLAS metadata (missing description) fails with clear error, (3) unknown type returns null schema / skips validation gracefully, (4) extra properties rejected (additionalProperties: false), (5) header.description exceeds max length (60 chars) fails, (6) header.abapLanguageVersion enum validated correctly, (7) SRVB metadata with services array validates, (8) compiled validators are cached (second call doesn't recompile).
- [x] Run `npm test` — all tests must pass

### Task 6: Integrate AFF validation into SAPWrite create and batch_create

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

This task wires the AFF validator into the SAPWrite handler so that object metadata is validated before hitting the ADT API.

- [x] In the SAPWrite `create` action handler in `src/handlers/intent.ts` (around line 932), after building the create XML but before calling `createObject()`, add an optional AFF metadata validation step. If the object type has a bundled AFF schema (check via `getAffSchema(type) !== null`), validate a metadata object derived from the create parameters: `{ formatVersion: "1", header: { description, originalLanguage: "en" } }`. If validation fails, return `errorResult()` with the validation errors formatted as: `"AFF metadata validation failed for ${type} ${name}:\n- ${errors.join('\n- ')}\n\nFix the metadata and retry."`. If validation passes or no schema exists, proceed normally.
- [x] Apply the same validation in the `batch_create` action: for each object in the batch, validate before creating. If any object fails validation, stop the batch and report which object failed and why.
- [x] Add unit tests (~5 tests) to `tests/unit/handlers/intent.test.ts`: (1) SAPWrite create with valid metadata proceeds normally, (2) SAPWrite create with description > 60 chars fails AFF validation with clear message, (3) SAPWrite create for type without AFF schema (e.g., FUGR) skips validation, (4) batch_create stops on first AFF validation failure, (5) AFF validation errors include field path and expected value.
- [x] Run `npm test` — all tests must pass

### Task 7: Add integration tests for structured read and batch create

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

This task adds integration tests that exercise the new features against a real SAP system. These tests auto-skip when `TEST_SAP_URL` is not set, so they're safe to add without breaking CI.

- [x] Add integration test: `it('reads class with structured format')` — call `getClassStructured()` on a known test class (e.g., `ZCL_ARC1_TEST` from `tests/e2e/fixtures.ts`), verify metadata has description and package fields, verify main source is non-empty, verify testclasses/definitions/implementations are string or null.
- [x] Add integration test: `it('reads class metadata')` — call `getClassMetadata()` on a known class, verify description, language, package are populated.
- [x] Add integration test: `it('batch creates multiple objects')` — create 2-3 simple programs in `$TMP`, verify all succeed, clean up by deleting them. This tests the end-to-end batch flow.
- [x] Run `npm run test:integration` (if SAP system available) or verify tests are properly skipped when `TEST_SAP_URL` is not set.
- [x] Run `npm test` — all unit tests must pass

### Task 8: Update documentation and CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/tools.md`
- Modify: `docs/architecture.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `README.md`

This task updates all documentation artifacts to reflect the new AFF integration features.

- [x] Update `CLAUDE.md`: (1) Add `src/aff/` directory to the codebase structure tree with `validator.ts` and `schemas/` subdirectory. (2) Add rows to Key Files for Common Tasks table: "Add AFF schema" → `src/aff/schemas/`, "Modify AFF validation" → `src/aff/validator.ts`. (3) Add `format` parameter to the Configuration table if it becomes a server-level default. (4) Update the "Add new read operation" row to mention structured format handling.
- [x] Update `docs/tools.md`: (1) In the SAPRead section, document the new `format` parameter: default is `"text"`, `"structured"` returns JSON with metadata + decomposed includes (CLAS only). Include an example response. (2) In the SAPWrite section, document the `batch_create` action: accepts `objects` array, creates and activates in order, stops on first failure. Include an example with a RAP stack. (3) Note that AFF metadata validation runs automatically on create/batch_create for supported types.
- [x] Update `docs/architecture.md`: Add a note about the AFF validation layer in the request flow — between Zod input validation and the ADT client call. Mention bundled AFF schemas.
- [x] Update `docs/roadmap.md`: Add new entries for the three AFF features implemented. Mark them as completed with the implementation date. If there are existing AFF-related items, update their status.
- [x] Update `docs/compare/00-feature-matrix.md`: Add rows for "Structured object decomposition (class metadata + includes)" and "Multi-object batch creation" and "AFF schema validation". Mark ARC-1 as supported. Update "Last Updated" date.
- [x] Update `README.md`: In the features section, add a brief mention of structured class reading and batch object creation. Keep it concise — one bullet point each.
- [x] Run `npm test` — all tests must pass (docs changes shouldn't break tests, but verify)

### Task 9: Update skills to leverage AFF features

**Files:**
- Modify: `.claude/commands/explain-abap-code.md`
- Modify: `.claude/commands/generate-abap-unit-test.md`
- Modify: `.claude/commands/generate-rap-service.md`

This task updates existing Claude Code skills to take advantage of the new AFF integration features.

- [x] Update `.claude/commands/explain-abap-code.md`: In Step 1 (Read target object), add guidance that for classes, the agent should use `SAPRead(type="CLAS", name="...", format="structured")` to get both metadata and decomposed source. This provides class description, category, and separates test code from production code automatically. Update the example to show the structured format call.
- [x] Update `.claude/commands/generate-abap-unit-test.md`: In Step 1d (Read existing tests), note that `SAPRead(type="CLAS", format="structured")` returns testclasses as a separate field, making it easier to analyze existing tests without parsing the full class source. The agent should prefer structured format for the initial class read.
- [x] Update `.claude/commands/generate-rap-service.md`: Add a note at the top of the creation section (Steps 4-13) that batch creation is available: `SAPWrite(action="batch_create", objects=[...], package="...", transport="...")` can create all RAP artifacts in a single call. Update the workflow to show the batch approach as the preferred method, with the sequential approach as a fallback. Include an example `objects` array for a typical RAP service (CDS view → projection → BDEF → service definition → metadata extension → behavior pool).
- [x] Run `npm test` — all tests must pass

### Task 10: Final verification

**Files:**
- (none — verification only)

- [x] Run full test suite: `npm test` — all tests pass
- [x] Run typecheck: `npm run typecheck` — no errors
- [x] Run lint: `npm run lint` — no errors
- [x] Verify structured class read works: grep for `getClassStructured` in source and tests, confirm it's wired end-to-end from tool definition through handler to client
- [x] Verify batch create works: grep for `batch_create` in source and tests, confirm it's wired end-to-end
- [x] Verify AFF validator works: grep for `validateAffHeader` in source and tests, confirm it's called in both create and batch_create paths
- [x] Verify documentation is consistent: check that `CLAUDE.md` codebase tree includes `src/aff/`, `docs/tools.md` documents all new parameters, `docs/roadmap.md` has AFF entries
- [x] Move this plan to `docs/plans/completed/`

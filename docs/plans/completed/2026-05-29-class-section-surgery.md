# Class-Section Surgery (issue #303)

## Overview

Issue [#303](https://github.com/arc-mcp/arc-1/issues/303) asks for a token-efficient way to change a class's **DEFINITION** block without re-sending the whole `/source/main`. Today `SAPWrite(action="edit_method")` replaces a method **body** but cannot add, remove, or re-sign a method declaration; any change to the DEFINITION block requires `SAPWrite(action="update")` with the full concatenated DEFINITION + IMPLEMENTATION source. For a 20-method class that is ~3000–4000 tokens per change — the issue's actual complaint.

The plan adds four `SAPWrite` actions on `type=CLAS`, backed by SAP's existing `/sap/bc/adt/oo/classes/{name}/objectstructure` endpoint which returns **precise `#start=L,C;end=L,C` line ranges** for the class-level DEFINITION + IMPLEMENTATION blocks and for every method's declaration and body. We splice into `/source/main` using those ranges; no client-side ABAP parsing is required for the common path. abaplint stays as a fallback parser for the rare case `objectstructure` is unavailable. Architecture is **already live-verified** end-to-end on a4h (S/4HANA 2023) via [scripts/probe-issue-303.mjs](../../scripts/probe-issue-303.mjs) — all 4 actions PUT 200 + activate clean against a real Z-class; reads also verified on NPL (NW 7.50 SP02) with one wire-format quirk to handle (methods split across `CLAS/OO` + `CLAS/OM` elements on 7.50 vs. one merged `CLAS/OM` on 7.58+).

The four actions are deliberately overlapping: `edit_class_definition` covers any DEFINITION-block change (visibility, parent class, FRIENDS, FINAL/ABSTRACT, EVENTS, INTERFACES, ALIASES) but refuses if the diff would produce a non-activatable class (added method declaration with no matching IMPL stub, or orphan METHOD in IMPLEMENTATION). `add_method` and `delete_method` are atomic alternatives that touch both DEFINITION and IMPLEMENTATION in one PUT — same lock, same activation. `edit_method_signature` is a one-range replacement on a method's METHODS clause (no IMPL changes, no symmetry concern). The refuse-policy error message points the caller at the right action when a diff slips into `edit_class_definition` that would be cleaner as `add_method`/`delete_method`.

## Context

### Current State

- `SAPWrite(action="edit_method")` ([src/handlers/intent.ts:3991](../../src/handlers/intent.ts)) replaces a method **body** by splicing into `/source/main` via [src/context/method-surgery.ts](../../src/context/method-surgery.ts) `spliceMethod()`. Auto-routes to `/includes/implementations` for `lhc_*`/`lcl_*`/`ltc_*` prefixed methods via `detectLocalHandlerInclude()`.
- `SAPWrite(action="update", type="CLAS", include="definitions")` ([src/handlers/intent.ts:3535](../../src/handlers/intent.ts)) writes the **CCDEF** include (LOCAL class definitions, e.g. RAP `lhc_*` handlers). It does **not** target the global class's DEFINITION block.
- The global CLASS DEFINITION block lives inside `/source/main` next to the IMPLEMENTATION block. SAP rejects partial PUTs with `HTTP 400 ExceptionResourceScanDuringSaveFailure — "The source code of this class is incomplete"` (verified live on a4h). Any change to the global signature today requires `SAPWrite(action="update")` with the entire concatenated source.
- `/sap/bc/adt/oo/classes/{name}/objectstructure` is **already known to ARC-1** ([src/adt/xml-parser.ts:60](../../src/adt/xml-parser.ts) lists `objectStructureElement` in the array-coercion set) but no client method fetches it; no parser exists for its payload.
- abaplint AST exposes `Structures.ClassDefinition` / `Structures.ClassImplementation` with `getFirstToken().getStart()` / `getLastToken().getEnd()` returning 1-indexed `{row, col}` — verified usable as a fallback.

### Target State

Four new `SAPWrite` actions on `type=CLAS`:

| Action | Sends | Touches | Refuse-policy |
|---|---|---|---|
| `edit_class_definition` | New DEFINITION block source | DEFINITION only (in `/source/main` or `/includes/definitions` when `include=` is set) | Blocks if diff adds a concrete method without IMPL stub, or leaves an orphan METHOD. Exempts `ABSTRACT METHODS`, `EVENTS`, `INTERFACES`, `ALIASES`. Skipped entirely for `include=` writes. |
| `add_method` | `method` source (METHODS clause) + optional `visibility` (default `public`) | DEFINITION + IMPLEMENTATION atomically (one PUT) | Refuses if the target visibility section header doesn't exist; suggests `edit_class_definition` to add the section first. ABSTRACT method case: caller passes `abstract: true` — ARC-1 only inserts the METHODS declaration, no IMPL stub. |
| `edit_method_signature` | New METHODS clause for one method | DEFINITION only — one range replacement | No symmetry check (IMPLEMENTATION untouched). SAP activation catches body incompatibility, same as today's `edit_method`. |
| `delete_method` | `method` name | DEFINITION + IMPLEMENTATION atomically | implementationBlock absent for ABSTRACT — handled gracefully (only definitionBlock deleted). |

Backed by:
- New `client.getClassStructure(name)` that GETs `/sap/bc/adt/oo/classes/{name}/objectstructure` and returns parsed block ranges, per-method ranges, attributes, and visibility/level/abstract/constructor metadata.
- New `parseClassStructure()` parser in `src/adt/xml-parser.ts` that handles **both** wire shapes:
  - **7.58+ (a4h):** one `CLAS/OM` element per method with both `definitionBlock` and `implementationBlock` atom-links.
  - **7.50 (NPL):** methods split across `CLAS/OO` (carries `definitionBlock`) and `CLAS/OM` (carries `implementationBlock`) — parser groups by `adtcore:name` and merges.
- New `src/adt/class-structure.ts` for splicing helpers (the existing `src/context/method-surgery.ts` stays — it handles `edit_method` body replacement which keeps its abaplint-based path).
- Schema, tool, and handler wiring identical to the `edit_method` pattern.

Behavioral invariants:
- No auto-activate. Same contract as `update`/`edit_method`: writes the inactive draft; caller runs `SAPActivate` next.
- Inactive-aware reads via `resolveVersionAndDraftInfo()` (same pattern as [intent.ts:4030](../../src/handlers/intent.ts)) so chained writes stack on each other.
- Pre-write lint runs on the **spliced full source** (after splice, before PUT), not on the raw DEFINITION fragment — the fragment doesn't parse standalone (abaplint emits "Expected CLASSIMPLEMENTATION").
- All four actions respect the existing `allowWrites=true` + package allowlist + `SAP_DENY_ACTIONS` gates.

### Key Files

| File | Role |
|------|------|
| `src/adt/class-structure.ts` (new) | Pure module: `parseClassStructure(xml)` → `ClassStructure` (re-uses the XML parser plumbing); `diffMethodSets(oldStructure, newSource)` → `{added, removed, exempt}`; `spliceClassDefinition(source, structure, newDef)`; `spliceMethodSignature(source, structure, methodName, newSig)`; `insertMethodPair(source, structure, methodName, decl, visibility, isAbstract)`; `removeMethodPair(source, structure, methodName)`; `findSectionAnchor(source, structure, visibility)` (string-fallback for empty-section case). |
| `src/adt/client.ts` | New `getClassStructure(name)` that hits `/sap/bc/adt/oo/classes/{name}/objectstructure`; `checkOperation(..., Read, 'GetClassStructure')`. |
| `src/adt/xml-parser.ts` | New `parseClassStructure(xml)` exported. Handles 7.50 split (`CLAS/OO`+`CLAS/OM` merge by name) and 7.58+ single-element (`CLAS/OM`) shape. Returns `{classBlock: {def, impl}, methods: MethodStructure[], attributes: AttributeStructure[]}` with all line ranges. |
| `src/adt/types.ts` | New types: `ClassStructure`, `MethodStructure`, `AttributeStructure`, `LineRange { sr, sc, er, ec }`. |
| `src/handlers/intent.ts` | Four new switch cases in `handleSAPWrite`. Refuse-policy helper. Share `getClassStructure` + splice helpers. Update existing CLAS update-include validation to allow the new actions for `include=`. |
| `src/handlers/schemas.ts` | Add `'edit_class_definition'`, `'add_method'`, `'edit_method_signature'`, `'delete_method'` to action enums in `SAPWriteSchema` + `SAPWriteSchemaBtp`. New optional fields: `visibility: z.enum(['public','protected','private'])`, `abstract: z.coerce.boolean()`. Update `validateSapWriteInput` to accept the new actions for `include=`. |
| `src/handlers/tools.ts` | Add new actions to the JSON Schema enum. Document each in the action description. Document new `visibility` + `abstract` properties. |
| `src/authz/policy.ts` | Add `'SAPWrite.edit_class_definition'`, `'SAPWrite.add_method'`, `'SAPWrite.edit_method_signature'`, `'SAPWrite.delete_method'` policy entries — all `scope: 'write'`, `opType: OperationType.Update`. |
| `tests/unit/adt/class-structure.test.ts` (new) | ~25 unit tests. Parser tests against captured fixtures `objectstructure-clas-a4h-758.xml` + `objectstructure-clas-npl-750.xml`. Splice helpers. Diff helper. Section-anchor empty-section fallback. |
| `tests/fixtures/xml/objectstructure-clas-a4h-758.xml` | Already captured. a4h shape: single `CLAS/OM` per method. |
| `tests/fixtures/xml/objectstructure-clas-npl-750.xml` | Already captured. NPL shape: split `CLAS/OO`+`CLAS/OM` per method. |
| `tests/unit/handlers/intent.test.ts` | New tests for each of the 4 actions: happy path (mock HTTP), refuse-policy branches (missing impl, orphan impl), include= routing for CCDEF, missing section refuse, edit_method_signature one-range replace. |
| `tests/unit/handlers/schemas.test.ts` | Schema acceptance + validator tests for the new actions and `visibility`/`abstract` fields. |
| `tests/unit/handlers/tools.test.ts` | Verify the new action enum + properties appear in the JSON Schema. |
| `tests/integration/class-section-surgery.integration.test.ts` (new) | Live a4h lifecycle: create probe class → exercise all four actions in order (edit_class_definition happy + refuse → add_method → edit_method_signature → delete_method) → cleanup. Hard-fails without `TEST_SAP_URL`. Auto-skips on NPL 7.50 lock-handle 423 via `expectSapFailureClass(err, [423], [/invalid lock handle/])`. |
| `tests/e2e/class-section-surgery.e2e.test.ts` (new) | MCP JSON-RPC smoke: each action returns success + the expected inactive draft. Uses fresh transient class with `try/finally` cleanup. |
| `scripts/probe-issue-303.mjs` (already present) | Re-runnable end-to-end probe used during design. Keep as-is; the integration test exercises the same shape through arc-1's normal client. |
| `docs_page/tools.md` | New action rows in the SAPWrite table. One canonical example per action. |
| `docs_page/roadmap.md` | New completed entry. Update "Current State" feature matrix row 'Method-Level Surgery'. |
| `docs/compare/00-feature-matrix.md` | New "Class-section surgery" capability row (or extend existing "EditSource (surgical)" row). Bump "Last Updated". |
| `CLAUDE.md` | New row in Key Files table: "Add CLAS class-section surgery action". Update tool description for `SAPWrite` if needed. |
| `README.md` | Update SAPWrite capability line to mention class-section surgery. |

### Design Principles

1. **`objectstructure` is the line-range source of truth.** SAP already serves `#start=L,C;end=L,C` for the class-level DEFINITION/IMPLEMENTATION blocks and every method's declaration + body. No client-side ABAP parsing is needed for the common path. Verified live on a4h S/4HANA 2023 (kernel 7.58) and reads on NPL NW 7.50 SP02 — same wire format, different element layout.
2. **One parser, two wire shapes.** `parseClassStructure()` merges per-name across `CLAS/OO` (def-side) and `CLAS/OM` (impl-side) on 7.50; on 7.58+ both come from a single `CLAS/OM`. Same output type; one fixture per shape gates the regression. ABSTRACT methods on both shapes appear as `CLAS/OO` only (no `implementationBlock`).
3. **abaplint AST is the fallback, not the default.** When `objectstructure` 404s or returns a malformed structure, fall back to `Structures.ClassDefinition` / `Structures.ClassImplementation` parsed from the class source via abaplint. We already depend on `@abaplint/core`; this is ~30 LOC. Logged at info level so we know when the fallback fires.
4. **Refuse-policy is client-side, with structured errors and tool hints.** When `edit_class_definition` would produce a non-activatable draft (added concrete method without IMPL stub, or orphan IMPL after removal), refuse before PUT and tell the caller which action to use instead. Exemptions: `ABSTRACT METHODS`, `EVENTS`, `INTERFACES`, `ALIASES`. SAP's activation rejection is verified evidence that this check matches reality (test 3 of probe — "Implementation missing for method GREET").
5. **Atomic add/delete touch both halves.** `add_method` inserts METHODS clause **and** empty `METHOD x. ENDMETHOD.` stub in one PUT; `delete_method` removes both ranges in one PUT. This makes the common "I want to add a method" case a single tool call with no symmetry concerns.
6. **Empty-section anchor uses string fallback.** When a target visibility section has zero existing methods (every fresh class), `objectstructure` gives no anchor. Scan the DEFINITION block for `/^\s*(PUBLIC|PROTECTED|PRIVATE)\s+SECTION\s*\.\s*$/im` and insert AFTER the matching section header. If the section doesn't exist, refuse with a structured hint pointing at `edit_class_definition`. Verified live on a4h step 11 of the probe.
7. **`include=` mirrors `edit_method` routing.** All four actions accept `include=definitions|implementations|macros|testclasses`. Auto-detected from `lhc_*`/`lcl_*`/`ltc_*` prefix on method names (same `detectLocalHandlerInclude` logic). For `include=` variants, the symmetry check is skipped (CCDEF and CCIMP are separate URLs — cross-include validation gets messy); SAP's activation is the validator.
8. **Pre-write lint on the SPLICED source, not the fragment.** A raw DEFINITION block fails abaplint with "Expected CLASSIMPLEMENTATION" (verified live). Lint runs after splice on the fully-assembled new `/source/main` body, before PUT. Same `runPreWriteLint` helper as `edit_method`.
9. **No auto-activate.** All four actions write inactive drafts only. Caller runs `SAPActivate` next. Matches existing `update`/`edit_method` contract; avoids surprising activation in the middle of a multi-step refactor.
10. **NPL 7.50 lock-handle bug is documented, not worked around.** [SAP Note 2727890](https://launchpad.support.sap.com/#/notes/2727890) "ADT: fix unstable adt lock handle" affects every ADT write on the un-patched 7.50 image — not specific to our new actions. arc-1 already detects 423 and emits a hint via `AdtApiError:enqueue-error` (verified live). Integration test classifies the failure with `expectSapFailureClass(err, [423], [/invalid lock handle/])`.
11. **Three-file schema sync is non-negotiable.** Per CLAUDE.md invariants: every new field must exist in `tools.ts` (JSON Schema for LLMs), `schemas.ts` (Zod), and `intent.ts` (handler). Tests in `tools.test.ts` catch drift.
12. **All four actions go through the same `safeUpdateSource` + lock flow.** No new HTTP primitive; reuse `withStatefulSession` + `lockObject` + `safeUpdateSource` + `unlockObject` exactly as `edit_method` does. Transport handling, `corrNr` fallback, error classification are identical.

## Development Approach

- **TDD ordering**: pure module (parser + splice + diff) lands with its unit tests first, against the two captured XML fixtures. Then handler cases. Then integration + E2E. This matches `add-fm-parameters.md`'s ordering and gives every implementation task a red→green signal.
- **No new env vars or config flags.** Feature is on by default, gated by existing `allowWrites=true` + `SAP_ALLOWED_PACKAGES` + `SAP_DENY_ACTIONS`.
- **Fixtures already captured** at `tests/fixtures/xml/objectstructure-clas-a4h-758.xml` and `tests/fixtures/xml/objectstructure-clas-npl-750.xml`. Unit tests run against both — drift in either system's wire format is the regression signal.
- **Live verification is end-to-end through arc-1's client**, not curl. The integration test creates a transient `ZCL_ARC1_CLASS_SURGERY_*` class in `$TMP`, exercises all four actions through `SAPWrite`/`SAPActivate`, and cleans up in `finally`. The probe script (`scripts/probe-issue-303.mjs`) stays as a re-runnable spike — useful when debugging future regressions.
- **NPL 7.50 coverage is via the parser unit tests against the captured fixture.** Live writes on NPL are blocked by SAP Note 2727890 (pre-existing, not ours). Integration tests against NPL classify the 423 failure with `expectSapFailureClass(err, [423], [/invalid lock handle/])` and move on — same pattern as existing FUNC/SKTD/PROG integration tests.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (requires `TEST_SAP_URL`)
- `npm run test:e2e` (requires running MCP server at `E2E_MCP_URL`)

### Task 1: Foundation — types and `parseClassStructure()` parser

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/unit/adt/class-structure-parser.test.ts`

Build the pure XML-to-types parser that all four actions depend on. The parser must handle TWO wire shapes: 7.58+ (one `CLAS/OM` per method) and 7.50 (split `CLAS/OO` + `CLAS/OM` merged by name). Captured XML fixtures `tests/fixtures/xml/objectstructure-clas-a4h-758.xml` and `tests/fixtures/xml/objectstructure-clas-npl-750.xml` are the ground truth — every parser change must round-trip through both.

- [ ] Add to `src/adt/types.ts`: `LineRange { sr: number; sc: number; er: number; ec: number }` (1-indexed rows, 0-indexed cols, end-INCLUSIVE rows). Add `MethodStructure { name; visibility: 'public'|'protected'|'private'; level: 'instance'|'static'; abstract: boolean; constructor: boolean; definition: LineRange; implementation?: LineRange; definitionIdentifier?: LineRange; implementationIdentifier?: LineRange }`. Add `AttributeStructure { name; visibility; level; constant: boolean; definition: LineRange }`. Add `ClassStructure { className; classDefinitionBlock: LineRange; classImplementationBlock?: LineRange; methods: MethodStructure[]; attributes: AttributeStructure[] }`.
- [ ] Add `parseClassStructure(xml: string): ClassStructure` to `src/adt/xml-parser.ts`. Extract class-level `definitionBlock` (first `<atom:link rel=".../source/definitionBlock"` in document order) and `implementationBlock` (first in document order). Parse each `<abapsource:objectStructureElement>` element with `adtcore:type` in `{CLAS/OM, CLAS/OO}` (methods), `CLAS/OA` (attributes). For 7.50 shape: group method entries by `adtcore:name` and merge `CLAS/OO` (def-side `definitionBlock`) with `CLAS/OM` (impl-side `implementationBlock`). For 7.58+ shape: a single `CLAS/OM` per method carries both blocks. ABSTRACT methods (no `implementationBlock` link) round-trip as `implementation: undefined`. `href` `#start=L,C;end=L,C` parses to `LineRange`.
- [ ] Verify the parser ignores `CLAS/OE` (events), `CLAS/OT` (types), `CLAS/OF` (friends), `CLAS/OK` (constants/literals), `CLAS/OCX` (text-elements external refs) — they have `definitionBlock` but aren't relevant for method surgery. Document the ignored types in a code comment with a forward pointer to attribute-management follow-up.
- [ ] Add unit tests (~12 tests) in `tests/unit/adt/class-structure-parser.test.ts`:
  - Parse a4h fixture: classDefinitionBlock {sr:1,sc:0,er:10,ec:8}, classImplementationBlock {sr:12,sc:0,er:22,ec:8}, 2 methods (HELLO + GOODBYE) each with both def and impl ranges
  - Parse NPL fixture: classDefinitionBlock {sr:1,sc:0,er:175,ec:8}, classImplementationBlock {sr:179,sc:0,er:636,ec:8}, 13 method names (CLASS_CONSTRUCTOR + 12 others), 12 with both def+impl, 1 abstract (IS_INSTANTIATABLE) with def-only
  - Method visibility/level/abstract/constructor flags round-trip from XML attrs
  - Empty class (no methods) returns `methods: []`
  - Class with attributes only (no methods) returns `attributes: [...]`, `methods: []`
  - Malformed XML throws a typed error (not a silent empty result)
  - `LineRange` parses `#start=L,C;end=L,C` correctly (no off-by-one)
- [ ] Run `npm test` — all tests must pass

### Task 2: `getClassStructure()` client method + safety check

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

Wire the parser to a live HTTP call. The client method is read-only (just GETs `objectstructure`) — no lock, no PUT. Safety check uses `OperationType.Read` (same as `getClass`).

- [ ] In `src/adt/client.ts`, add `async getClassStructure(name: string): Promise<ClassStructure>`. Path: `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}/objectstructure`. Pass `Accept` via the existing discovery-driven MIME negotiation in `src/adt/http.ts` so v1+xml is chosen on NW 7.50 and v2+xml on a4h. Call `checkOperation(this.safety, OperationType.Read, 'GetClassStructure')`. Pipe response body through the new `parseClassStructure(resp.body)`.
- [ ] In `tests/unit/adt/client.test.ts`, add ~4 tests using `mockFetch` + the captured XML fixtures from `tests/fixtures/xml/`:
  - `getClassStructure('ZCL_TEST')` returns parsed `ClassStructure` from a4h fixture
  - Same but feeding NPL fixture — returns same shape via merge
  - 404 from SAP throws `AdtApiError` with `ExceptionResourceNotFound`
  - Safety: when `safety.allowReads=false` (synthetic), throws `AdtSafetyError`
- [ ] Run `npm test` — all tests must pass

### Task 3: Splice + diff helpers in `src/adt/class-structure.ts`

**Files:**
- Create: `src/adt/class-structure.ts`
- Modify: `tests/unit/adt/class-structure-parser.test.ts` (extend with splice/diff tests)

Pure functions that operate on `(source, structure)` and return new source. No HTTP, no lock, no I/O. The handler later wires lock → splice → PUT → unlock.

- [ ] Create `src/adt/class-structure.ts` exporting:
  - `spliceClassDefinition(source: string, structure: ClassStructure, newDefBlock: string): string` — replaces the class-level `definitionBlock` line range with `newDefBlock`. Preserves the source's line-ending convention (\r\n vs \n).
  - `spliceMethodSignature(source: string, methodStruct: MethodStructure, newSig: string): string` — replaces a single method's `definition` line range with `newSig`. Errors if `methodStruct.definition` is undefined (shouldn't happen but defensive).
  - `insertMethodPair(source, structure, opts: { decl: string; visibility: 'public'|'protected'|'private'; isAbstract?: boolean; methodName: string }): string` — inserts METHODS clause at end of target visibility section + (unless `isAbstract`) inserts empty `METHOD <methodName>. ENDMETHOD.` stub at end of IMPLEMENTATION block. Returns spliced full source. Throws if section anchor cannot be located (caller's refuse).
  - `removeMethodPair(source, methodStruct: MethodStructure, classImplBlock?: LineRange): string` — removes `methodStruct.definition` range. If `methodStruct.implementation` is set, also removes that range. Splice in descending line-order so earlier ranges aren't invalidated.
  - `diffMethodSets(oldStructure: ClassStructure, newDefBlock: string): { added: { name: string; isAbstract: boolean; isEvent: boolean; isInterface: boolean; isAlias: boolean }[]; removed: MethodStructure[] }` — parses `newDefBlock` with `@abaplint/core` `Structures.ClassDefinition` to enumerate METHODS / CLASS-METHODS / EVENTS / INTERFACES / ALIASES declarations; diffs against `oldStructure.methods.map(m => m.name)`. Exempts ABSTRACT methods (no IMPL needed), EVENTS, INTERFACES, ALIASES from the symmetry check by tagging them in the `added` array. Returns names UPPERCASE for case-insensitive comparison.
  - `findSectionAnchor(source: string, structure: ClassStructure, visibility: 'public'|'protected'|'private'): { afterLine: number } | null` — locates insertion point. Primary: last method in the target visibility section per `structure.methods`. Fallback (empty section): regex on DEFINITION-block source for `/^\s*(PUBLIC|PROTECTED|PRIVATE)\s+SECTION\s*\.\s*$/im` and return AFTER that line. Returns `null` if neither found — caller must refuse.
  - All exported functions are PURE: no Date, no Math.random, no logging side-effects. Same input → same output.
- [ ] Extend `tests/unit/adt/class-structure-parser.test.ts` (or split into `class-structure.test.ts` if the file gets large): ~13 splice/diff tests:
  - `spliceClassDefinition` replaces DEFINITION lines, preserves IMPLEMENTATION, preserves \r\n
  - `spliceMethodSignature` replaces just the method signature, leaves IMPLEMENTATION block untouched
  - `insertMethodPair` happy path (existing public methods) — METHODS inserted after last public method, stub inserted before final ENDCLASS of IMPLEMENTATION
  - `insertMethodPair` with `isAbstract: true` — METHODS inserted, NO stub added to IMPLEMENTATION
  - `insertMethodPair` into protected section when no protected methods exist but section header exists — uses `findSectionAnchor` regex fallback
  - `insertMethodPair` into missing section header — throws
  - `removeMethodPair` removes both ranges in descending order (so def doesn't shift before impl is found)
  - `removeMethodPair` for ABSTRACT (no impl range) removes only def
  - `diffMethodSets`: new method declared without stub → `added: [{name: 'GREET', isAbstract: false, ...}]`, `removed: []`
  - `diffMethodSets`: ABSTRACT method declared → `added: [{name: 'X', isAbstract: true}]` (refuse-policy will exempt)
  - `diffMethodSets`: method removed → `removed: [{name: 'HELLO', ...}]`
  - `diffMethodSets`: EVENTS / INTERFACES / ALIASES emit `isEvent/isInterface/isAlias=true` and are exempted
  - `findSectionAnchor` returns AFTER last method's def end row when methods exist; returns AFTER section-header line when section is empty
- [ ] Run `npm test` — all tests must pass

### Task 4: Schemas + tool definitions for the four new actions

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/authz/policy.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

Three-file sync per CLAUDE.md invariant: `tools.ts` (JSON Schema for LLMs), `schemas.ts` (Zod), `intent.ts` (handler — Task 5). This task is schema/tool/policy only — handler comes next.

- [ ] In `src/handlers/schemas.ts`, add `'edit_class_definition'`, `'add_method'`, `'edit_method_signature'`, `'delete_method'` to the `action` enum on `SAPWriteSchema` AND `SAPWriteSchemaBtp`. Add optional fields: `visibility: z.enum(['public','protected','private']).optional()` (default applied in handler), `abstract: z.coerce.boolean().optional()`.
- [ ] Update `validateSapWriteInput()` (around line 352) — the new `edit_class_definition`, `add_method`, `edit_method_signature`, `delete_method` actions all accept `include=` for the CCDEF/CCIMP routing parity. Extend the action-name check accordingly.
- [ ] In `src/handlers/tools.ts`, add the four new actions to the JSON Schema `action` enum (around line 588). Update the action description string to document each. Add `visibility` + `abstract` properties to the SAPWrite `properties` block. Update `type` description to mention the new actions where `(for create/update/delete/edit_method)` appears.
- [ ] In `src/authz/policy.ts`, add four `ACTION_POLICY` entries (around line 60):
  ```ts
  'SAPWrite.edit_class_definition': { scope: 'write', opType: OperationType.Update },
  'SAPWrite.add_method': { scope: 'write', opType: OperationType.Update },
  'SAPWrite.edit_method_signature': { scope: 'write', opType: OperationType.Update },
  'SAPWrite.delete_method': { scope: 'write', opType: OperationType.Update },
  ```
- [ ] Add unit tests (~8 tests) in `tests/unit/handlers/schemas.test.ts`:
  - Each of the 4 new actions parses without error with the minimal required params
  - `edit_class_definition` accepts `include=definitions` (no validator error)
  - `add_method` accepts `visibility=protected` + `abstract=true`
  - `add_method` accepts the `method` field as the METHODS clause source
  - `edit_method_signature` requires `method` + `source`
  - `delete_method` requires `method`, rejects `source` (only delete by name)
  - Unknown action fails Zod parse
- [ ] Add unit tests (~3 tests) in `tests/unit/handlers/tools.test.ts`:
  - The SAPWrite tool's `inputSchema.properties.action.enum` includes the 4 new actions
  - `visibility` and `abstract` properties are documented in `inputSchema.properties`
  - Tool description string mentions each new action by name
- [ ] Run `npm test` — all tests must pass

### Task 5: `edit_class_definition` + `edit_method_signature` handler cases

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Wire the first two actions to the splice helpers. These are the "single range replace" actions — no method-pair insertion, no diff for `edit_method_signature`, but `edit_class_definition` needs the diff + refuse-policy.

- [ ] In `src/handlers/intent.ts`, add a new switch case `'edit_class_definition'` in `handleSAPWrite` (next to the existing `'edit_method'` case ~line 3991). Steps:
  1. Validate: `type === 'CLAS'`, `source` provided (the new DEFINITION block).
  2. `enforcePackageForExistingObject()` (existing helper at line 3521).
  3. Resolve include from `args.include` or `detectLocalHandlerInclude` — same precedence as `edit_method` (explicit > auto > MAIN).
  4. Fetch `objectstructure` via `client.getClassStructure(name)`.
  5. For MAIN (no include): fetch `/source/main` (inactive-aware via `resolveVersionAndDraftInfo`). Call `diffMethodSets(structure, args.source)`. **Refuse-policy:** if any added concrete (non-abstract, non-event, non-interface, non-alias) method has no `METHOD <name>. ENDMETHOD.` block in the current `/source/main` IMPLEMENTATION (string-search `^\s*METHOD\s+<name>\s*\.\s*$` case-insensitive), return an `errorResult` listing missing impls and suggesting `add_method`. If any removed method still has its METHOD block in IMPLEMENTATION (not deleted by the caller), return an error suggesting `delete_method`. For `include=` writes: skip the diff/refuse and just splice.
  6. `spliceClassDefinition(main, structure, args.source)`.
  7. Run pre-write lint on the spliced full source (re-use `runPreWriteLint`). For `include=` writes: skip lint (same as today's `update include=`).
  8. `safeUpdateSource(client.http, client.safety, objectUrl, writeUrl, splicedSource, transport, cachedFeatures?.abapRelease)` where `writeUrl` is `classIncludeUrl(name, include)` if `include` else `srcUrl`.
  9. `invalidateWrittenObject(type, name)`.
  10. Return success: `Successfully updated CLAS ${name} definition${where}. Active version unchanged until activation; read with SAPRead(version="inactive") to verify.`
- [ ] Add a new switch case `'edit_method_signature'` after the `edit_class_definition` case. Steps:
  1. Validate: `type === 'CLAS'`, `args.method` provided, `args.source` provided (the new METHODS clause).
  2. `enforcePackageForExistingObject()`.
  3. Fetch `objectstructure` via `client.getClassStructure(name)`. Find the matching method by case-insensitive name. If not found, return `errorResult` listing the available method names.
  4. Fetch `/source/main` (inactive-aware).
  5. `spliceMethodSignature(main, methodStruct, args.source)`.
  6. Pre-write lint on spliced full source.
  7. `safeUpdateSource(...)`.
  8. `invalidateWrittenObject(type, name)`.
  9. Return success.
- [ ] Add unit tests (~12 tests) in `tests/unit/handlers/intent.test.ts`:
  - `edit_class_definition` happy path: no method-set change → PUT 200, success message
  - `edit_class_definition` refuse-policy: added method without impl → returns error, no PUT
  - `edit_class_definition` refuse-policy exemption: ABSTRACT method added → accepted
  - `edit_class_definition` refuse-policy: removed method with orphan impl → returns error, no PUT
  - `edit_class_definition` with `include=definitions` → skips refuse, PUTs to `/includes/definitions`
  - `edit_class_definition` rejects non-CLAS type
  - `edit_class_definition` requires `source`
  - `edit_method_signature` happy path: single range replace → PUT 200
  - `edit_method_signature` unknown method name → returns error listing available methods
  - `edit_method_signature` rejects without `method` param
  - `edit_method_signature` rejects without `source` param
  - `edit_method_signature` rejects non-CLAS type
- [ ] Run `npm test` — all tests must pass

### Task 6: `add_method` + `delete_method` handler cases

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Atomic two-block ops. Share the lock/PUT plumbing with the earlier cases. `add_method` is the more complex one (section anchor + stub for non-abstract + DEFINITION + IMPLEMENTATION in one PUT).

- [ ] Add a new switch case `'add_method'`. Steps:
  1. Validate: `type === 'CLAS'`, `args.method` (the METHODS clause source), `args.name`. `visibility` defaults to `'public'` if omitted.
  2. Method name extraction: parse the first identifier from `args.method` (regex `^\s*METHODS\s+([A-Z][A-Z0-9_]*)` case-insensitive, or via abaplint). If parsing fails, return error suggesting the caller pass a `methodName` argument.
  3. `enforcePackageForExistingObject()`.
  4. Fetch `objectstructure`. Reject if a method with the same name already exists (suggests `edit_method_signature` instead).
  5. Resolve include (explicit > auto-detect from method-name prefix > MAIN).
  6. Fetch `/source/main` (inactive-aware).
  7. `findSectionAnchor(main, structure, visibility)`. If `null`, return error: "No <VIS> SECTION exists in CLAS <name>. Use SAPWrite(action=edit_class_definition) to add the section first."
  8. `insertMethodPair(main, structure, { decl: args.method, visibility, isAbstract: args.abstract === true, methodName: parsedName })`.
  9. Pre-write lint on spliced full source.
  10. `safeUpdateSource(...)`.
  11. `invalidateWrittenObject(type, name)`.
  12. Return success: `Successfully added method "${parsedName}" to CLAS ${name} (${visibility})${abstract? ' (abstract, no impl stub)':''}. ...`
- [ ] Add a new switch case `'delete_method'`. Steps:
  1. Validate: `type === 'CLAS'`, `args.method` (the method name, NOT a clause).
  2. `enforcePackageForExistingObject()`.
  3. Resolve include (auto from prefix > explicit > MAIN).
  4. Fetch `objectstructure`. Find the method case-insensitively. If not found, return error listing available method names.
  5. Fetch `/source/main` (inactive-aware).
  6. `removeMethodPair(main, methodStruct)`. ABSTRACT (no impl) handled by the helper.
  7. Pre-write lint on spliced full source.
  8. `safeUpdateSource(...)`.
  9. `invalidateWrittenObject(type, name)`.
  10. Return success: `Successfully deleted method "${methodName}" from CLAS ${name}. ...`
- [ ] Add unit tests (~12 tests) in `tests/unit/handlers/intent.test.ts`:
  - `add_method` happy path: public section, with existing methods → METHODS clause + stub inserted
  - `add_method` happy path: empty PUBLIC SECTION (no existing methods) → uses string-fallback anchor
  - `add_method` with `abstract=true` → METHODS inserted, NO stub
  - `add_method` rejects when target section header doesn't exist (refuse-policy)
  - `add_method` rejects when method name already exists
  - `add_method` rejects without `method` or `name`
  - `add_method` rejects non-CLAS type
  - `add_method` with `include=implementations` → writes to CCIMP (local-class add)
  - `delete_method` happy path: method with impl → both ranges removed
  - `delete_method` ABSTRACT method (no impl) → only def removed
  - `delete_method` unknown method → returns error listing available methods
  - `delete_method` rejects non-CLAS type
- [ ] Run `npm test` — all tests must pass

### Task 7: Integration tests against live SAP (a4h primary, NPL classified-skip)

**Files:**
- Create: `tests/integration/class-section-surgery.integration.test.ts`

End-to-end against a real SAP system. Creates a transient `ZCL_ARC1_CLASS_SURGERY_*` class via `generateUniqueName()`, exercises all four actions in order against the live system, asserts SAPActivate succeeds between writes, cleans up in `finally`. On NPL 7.50 the lock-handle bug (SAP Note 2727890) trips on writes — classify with `expectSapFailureClass` and move on.

- [ ] Create the integration test file. Use `getTestClient()` from `tests/integration/helpers.ts`, `requireSapCredentials()` (hard-fail on missing `TEST_SAP_URL`), `generateUniqueName('ZCL_ARC1_CSURG')` from `tests/integration/crud-harness.ts`.
- [ ] One `describe` block with sequential `it()` cases:
  - `it('seeds a probe class with two methods')` — `SAPWrite(create)` + `SAPWrite(update with full source)` + `SAPActivate`. Asserts via `SAPRead`.
  - `it('edit_class_definition: changes class modifier (FINAL→not-FINAL)')` — happy path, no method-set change. Activate, assert `SAPRead` reflects new definition.
  - `it('edit_class_definition: refuses added method without impl stub')` — passes a DEFINITION that declares an extra method without stub. Asserts error matches `/Implementation missing for|use add_method/i`. NO PUT happens.
  - `it('add_method: inserts new method atomically')` — adds GREET to PUBLIC. Activates. Asserts both METHODS clause and METHOD/ENDMETHOD block exist.
  - `it('edit_method_signature: appends a parameter with DEFAULT')` — replaces GREET signature with a new IMPORTING param having DEFAULT. Activates. Asserts `SAPRead` reflects new signature.
  - `it('delete_method: removes def and impl atomically')` — deletes GREET. Activates. Asserts both blocks gone.
- [ ] Cleanup in `afterAll`: `SAPWrite(delete)` the transient class. Tagged `// best-effort-cleanup`.
- [ ] On NPL 7.50, wrap each write in `try/catch` using `expectSapFailureClass(err, [423], [/invalid lock handle/])` from `tests/helpers/expected-error.ts`. If the 423 fires, mark the test as expected-failure-on-7.50 via `requireOrSkip` style; do NOT silently `return`.
- [ ] Run `npm run test:integration` — must pass on a4h (`TEST_SAP_URL=http://a4h.marianzeis.de:50000`)
- [ ] Run `npm test` — unit tests must still pass

### Task 8: E2E test via the MCP protocol

**Files:**
- Create: `tests/e2e/class-section-surgery.e2e.test.ts`

Smoke-test that the 4 new actions are visible via MCP `tools/list` AND callable via `tools/call` end-to-end against a running MCP server. Uses transient class with `try/finally` cleanup. No persistent fixture — too much state.

- [ ] Create the E2E test file. Use `connectClient()`, `callTool()`, `expectToolSuccess()`, `expectToolError()` from `tests/e2e/helpers.ts`. Test timeout 120s (config inherits).
- [ ] One `describe` block with sequential `it()` cases mirroring the integration test, but going through MCP JSON-RPC:
  - Create + activate baseline class
  - `edit_class_definition` happy + refuse-with-hint
  - `add_method` happy + missing-section refuse
  - `edit_method_signature` happy
  - `delete_method` happy
- [ ] Cleanup transient class in `try/finally` (or per-test `afterAll`).
- [ ] Run `npm run test:e2e` — requires a running MCP server pointed at the live SAP. Both the e2e config (120s timeout) and the sequential test order are baseline assumptions.
- [ ] Run `npm test` — unit tests must still pass

### Task 9: Documentation — internal + end-user + CLAUDE.md + roadmap + feature matrix

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs_page/tools.md`
- Modify: `docs_page/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `README.md`

User-visible feature → must update every artifact surface. No code changes in this task.

- [ ] In `CLAUDE.md`:
  - Add a new row in "Key Files for Common Tasks": `Add CLAS class-section surgery action (edit_class_definition / add_method / edit_method_signature / delete_method)` → `src/handlers/intent.ts`, `src/adt/class-structure.ts`, `src/adt/client.ts` (`getClassStructure`), `src/adt/xml-parser.ts` (`parseClassStructure`), `src/handlers/schemas.ts`, `src/handlers/tools.ts`, `src/authz/policy.ts`
  - Update the "Add new tool type" row to mention the new actions if relevant
  - In the codebase structure tree (~line 144 area), add `class-structure.ts` under `src/adt/`
  - In the "Architecture: Request Flow" section, note the new actions follow the same lock → splice → PUT → unlock pattern as `edit_method`
- [ ] In `docs_page/tools.md`:
  - Add a row for each of the 4 new actions in the SAPWrite section. Document params + one canonical example each. Anchor the section after the existing `edit_method` rows for findability.
  - Document `visibility` and `abstract` params.
  - Mention the refuse-policy + tool hints in the `edit_class_definition` row.
- [ ] In `docs_page/roadmap.md`:
  - Add a "Completed" entry dated today: "Class-section surgery (issue #303) — edit_class_definition + add_method + edit_method_signature + delete_method via objectstructure line ranges; verified live on a4h S/4HANA 2023 (kernel 7.58) + NPL NW 7.50 SP02 (read shape)."
  - Update the "Current State" feature matrix row "Method-Level Surgery" to include the four new actions and bump the descriptor.
- [ ] In `docs/compare/00-feature-matrix.md`:
  - Update or extend the "EditSource (surgical)" row (around line 152) to add class-section surgery alongside `edit_method`.
  - Add a new `_<date>:_` entry at the top of the file describing what shipped. Bump "Last Updated" at the top.
- [ ] In `README.md`:
  - Update the SAPWrite capability line (~line 84) to mention "class-section surgery (edit_class_definition / add_method / edit_method_signature / delete_method)" alongside the existing `edit_method` capability.
- [ ] Run `npm test` — verifying nothing broke
- [ ] Run `npm run lint` — biome should be happy with the docs (markdown isn't linted but the source tree is)

### Task 10: Final verification

- [ ] Run full unit test suite: `npm test` — all tests must pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run integration tests against a4h: `TEST_SAP_URL=http://a4h.marianzeis.de:50000 TEST_SAP_USER=MARIAN TEST_SAP_PASSWORD=<from INFRASTRUCTURE.md> TEST_SAP_CLIENT=001 npm run test:integration -- class-section-surgery` — all PASS
- [ ] Re-run the spike probe to confirm the architecture still holds end-to-end: `node scripts/probe-issue-303.mjs a4h` — should report ALL PASSED for the 12 steps
- [ ] Optional: against NPL — `node scripts/probe-issue-303.mjs npl` — read-side steps should pass, write-side steps should fail with the documented 423 lock-handle bug (SAP Note 2727890). This is the documented baseline, not a regression.
- [ ] Move this plan: `mv docs/plans/completed/2026-05-29-class-section-surgery.md docs/plans/completed/2026-05-29-class-section-surgery.md`

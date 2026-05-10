# Add Function-Module Parameter Support (issue #252)

## Overview

Issue [#252](https://github.com/marianfoo/arc-1/issues/252) is the user-asked follow-up to [#250](https://github.com/marianfoo/arc-1/issues/250): "New function module is created successfully, but no parameters can be added via mcp — tool returns that input/output parameters should be set via SE37/Eclipse. Can direct parameter addition be added later? Maybe via SAPWrite update?"

Live probing of a4h S/4HANA 2023 + NPL 7.50 SP02 settles a year of speculation around fr0ster's #77 ("parameter loss"): **FM parameters are not in a separate ADT metadata document**. They live INSIDE `/source/main` as ABAP source-based signature syntax (`IMPORTING VALUE(name) TYPE type [DEFAULT x] [OPTIONAL]`). Every standard FM (BAPI_USER_GETLIST, POPUP_TO_CONFIRM, STFC_CONNECTION, ...) ships its parameters this way. PUTting an `<fmodule:parameter>` element to the root metadata endpoint silently no-ops; PUTting `*"IMPORTING"*` SAPGUI-comment-block syntax is rejected with `HTTP 400 / FUNC_ADT028 "Parameter comment blocks are not allowed"`. **The only channel is `PUT /source/main` with the signature embedded as ABAP.**

So the implementation is purely a structured-array → ABAP-source generator: take a `parameters` array (`[{ kind: 'importing', name: 'IV_X', type: 'STRING', byValue: true, optional: true, default: "''" }]`), build the `IMPORTING / EXPORTING / CHANGING / TABLES / EXCEPTIONS / RAISING` clause, splice it between `FUNCTION <name>` and the trailing `.`, then PUT through the existing FUNC source-update flow. No new endpoint, no new vendor MIME, no new lock dance, no upstream blockers. The parameter-loss bug class becomes structural: when callers supply `parameters`, ARC-1 emits a complete signature; when they only supply `source`, the existing strip-and-warn path keeps working.

The MVP is bidirectional: writers get a structured array → source generator (this is what the user asked for), readers get an optional source → structured array parser on `SAPRead(type='FUNC', includeSignature=true)` so an LLM can round-trip "read → modify-one-field → write" without re-typing the full signature. We **do** support `RAISING cx_*` and `EXCEPTIONS exc_name` together (verified accepted by SAP); we do NOT try to parse pragmas (`##ADT_PARAMETER_UNTYPED` etc.) — they round-trip as part of the type string.

## Context

### Current State

Closed in PR #251 (issue #250):
- `SAPWrite(action='create', type='FUNC', group=…, name=…, description=…)` creates an empty-shell FM.
- `SAPWrite(action='update', type='FUNC', name=…, group=…, source=…)` PUTs source body to `/source/main`.
- `stripFmParamCommentBlock()` ([src/handlers/intent.ts:2649](../../src/handlers/intent.ts)) strips SAPGUI `*"` comment blocks and warns.
- Tool description warns: *"FM parameter signatures (IMPORTING/EXPORTING/EXCEPTIONS) are NOT managed by this tool — add them via SAPGUI/SE37 or Eclipse after activation."* ([src/handlers/tools.ts:164](../../src/handlers/tools.ts)).
- `SAPRead(type='FUNC', group=…, name=…)` returns the source body as plain text.

Gap (issue #252): there is no way for an LLM to write `IMPORTING IV_X TYPE STRING` into a freshly-created FM without manually pasting raw ABAP and getting case/syntax wrong. The advertised "use SAPGUI/SE37" fallback is not viable for headless agents (Copilot Studio, Claude Code on a remote box).

### Target State

Three new capabilities, all on the existing `/source/main` PUT channel:

1. **Structured `parameters` on `SAPWrite` for `FUNC`** (create + update). When provided, ARC-1 generates the IMPORTING/EXPORTING/CHANGING/TABLES/EXCEPTIONS/RAISING clause from the array and splices it into the user's source (or synthesizes a stub body if no `source` is given on create).
2. **Structured signature parsing on `SAPRead` for `FUNC`** with optional `includeSignature: true`. Returns `{ source, signature: { importing: [...], exporting: [...], changing: [...], tables: [...], exceptions: [...], raising: [...] } }` (JSON) instead of plain source text.
3. **Updated tool description and CLAUDE.md** that flip the caveat: ARC-1 now *does* manage FM parameters via the source channel; the old "use SAPGUI" warning is gone, replaced by a one-line example of the new schema.

ABAP grammar supported (verified live):

```text
IMPORTING [VALUE(]name[)] TYPE type [DEFAULT default] [OPTIONAL]
EXPORTING [VALUE(]name[)] TYPE type [OPTIONAL]
CHANGING  [VALUE(]name[)] TYPE type [DEFAULT default] [OPTIONAL]
TABLES    name {LIKE struct | TYPE STANDARD TABLE [OF line_type]} [OPTIONAL]
EXCEPTIONS exc_name [exc_name = code]
RAISING    cx_class_name [cx_class_name ...]
```

Out of scope (deferred — not blockers for closing #252):
- Editing parameters on a SAPGUI-style FM that ships `*"…IMPORTING…"*` comment blocks. The existing strip-and-warn covers them.
- Validating that parameter types resolve in the SAP system (e.g., `TYPE BAPIRET2`). SAP's own activate-after-write rejects unresolved types.
- Pragma round-tripping (`##ADT_PARAMETER_UNTYPED`). Survives via raw-string preservation in the `type` field.

### Key Files

| File | Role |
|------|------|
| `src/adt/fm-signature.ts` (new) | Pure functions: `buildFmSignatureClause(params)` (array → ABAP), `parseFmSignature(source)` (ABAP → array), `spliceFmSignature(source, name, params)` (rebuild source with new signature, preserving body). |
| `src/handlers/intent.ts` | `handleSAPWrite` FUNC branch: when `args.parameters` present, splice signature into source before strip+PUT. `handleSAPRead` FUNC branch: when `args.includeSignature===true`, parse and return JSON. |
| `src/handlers/schemas.ts` | New `fmParameterSchema` (importing/exporting/changing/tables/exceptions/raising kind). `parameters: z.array(fmParameterSchema).optional()` on `SAPReadSchema` (output flag), `SAPWriteSchema`, `SAPWriteSchemaBtp`, and `batchObjectSchemaOnprem` / `batchObjectSchemaBtp`. New `includeSignature: z.coerce.boolean().optional()` on `SAPReadSchema`. |
| `src/handlers/tools.ts` | `parameters` JSON Schema property on SAPWrite. `includeSignature` on SAPRead. Update SAPWrite description: drop the "manage via SAPGUI/Eclipse" warning, add a one-line shape example. |
| `src/adt/client.ts` | Optional: `getFunction()` already returns `{ source }`; we don't need to change it — `intent.ts` calls `parseFmSignature` on the returned source. |
| `tests/unit/adt/fm-signature.test.ts` (new) | ~25 unit tests for `buildFmSignatureClause`, `parseFmSignature`, `spliceFmSignature`. Round-trip property test. |
| `tests/unit/handlers/intent.test.ts` | Add tests for FUNC create/update with `parameters`; for SAPRead `includeSignature`. |
| `tests/unit/handlers/schemas.test.ts` | Schema acceptance tests for `parameters` + `includeSignature`. |
| `tests/unit/handlers/tools.test.ts` | Verify the `parameters` JSON schema appears in the tool definition. |
| `tests/integration/fugr-func-params.integration.test.ts` (new) | Live lifecycle: create FUGR → create FM with parameters → activate → SAPRead with includeSignature → assert structured signature → update parameters → re-activate → assert change persisted → delete. Auto-skips on NPL 7.50 lock-handle 423. |
| `tests/e2e/func-params.e2e.test.ts` (new) | Same lifecycle via the MCP JSON-RPC stack. |
| `docs_page/tools.md` | SAPWrite/SAPRead doc: parameter array shape with one canonical example. |
| `compare/00-feature-matrix.md` | Add row "FUNC parameter management (structured)". Bump "Last Updated". |
| `compare/fr0ster/evaluations/issue-77-fm-update-parameter-loss.md` | Append 2026-05-10 update — the parameter-loss class is closed via the source-channel approach. fr0ster's metadata-endpoint speculation was incorrect: parameters live in `/source/main`, not in metadata. |
| `docs_page/roadmap.md` | New completed entry: "FUNC parameter management via structured array". |
| `CLAUDE.md` | Update "Add FUGR/FUNC write" Key Files row — add `src/adt/fm-signature.ts` and the new `parameters` field on the SAPWrite schema. Drop the "FM signature/parameter management is out of scope" wording. |

### Design Principles

1. **Source is the channel** — every parameter mutation goes through `PUT /source/main`. No second endpoint, no new XML body, no metadata round-trip. Verified live on a4h S/4HANA 2023 (`/tmp/fm-probe/fm-source-with-params.txt`) and inferred from NPL 7.50 (BAPI_USER_GETLIST, POPUP_TO_CONFIRM, STFC_CONNECTION return source-based syntax via `/source/main?version=active`).
2. **Pure functions for the generator/parser** — `buildFmSignatureClause`, `parseFmSignature`, `spliceFmSignature` live in their own module (`src/adt/fm-signature.ts`), no I/O, no client coupling. This is what makes the round-trip test a property test.
3. **Backward compatible** — when callers pass only `source` (no `parameters`), behavior is exactly today's PR #251 path. When they pass only `parameters` (no `source`), ARC-1 generates a minimal stub (`FUNCTION <name>.\n  <signature>.\n\nENDFUNCTION.`). When they pass both, the `parameters` array is authoritative for the signature clause; the user's `source` body is preserved verbatim from the line after the signature-terminator `.` to the `ENDFUNCTION`.
4. **Strict source case-preservation, structured-array case-normalization** — the structured array always emits uppercase keywords (`IMPORTING`, `VALUE`, `TYPE`) and uppercase parameter names (SAP normalizes to lowercase on read but ARC-1's input contract is uppercase; on parse-back we uppercase the names). The user's body source between `<signature>.` and `ENDFUNCTION.` is preserved verbatim — case and whitespace.
5. **Round-trip safety is a tested invariant** — `parseFmSignature(buildFmSignatureClause(p)) === normalize(p)` is a property unit test. This catches the "we emit something we can't parse" class of bugs before it hits a live system.
6. **No abaplint dependency for parsing** — abaplint is overkill (and slow at scale). A scoped regex-based parser handles the production grammar above. abaplint runs separately as the existing pre-write lint check; if our generator produces invalid ABAP, lint will catch it before PUT.
7. **`stripFmParamCommentBlock` stays** — defense-in-depth for source the user pastes. When `parameters` is supplied, our generated clause replaces the existing signature region (everything between `FUNCTION <name>` and the first `.` outside a string literal); a stray `*"` block in the user's body is still stripped.
8. **Cross-release portability is structural** — both a4h S/4HANA 2023 and NPL 7.50 SP02 emit source-based parameter syntax (verified six standard FMs on NPL — zero `*"` lines across all). No release-specific code path needed.
9. **No env vars or config flags** — feature is on by default, gated only by existing `allowWrites=true` (parameter mutation is still an FM write).
10. **Test coverage matches risk surface** — ~25 unit tests for the pure module (every grammar construct + round-trip + a fuzzy parse-on-real-source corpus seeded with BAPI_USER_GETLIST and POPUP_TO_CONFIRM bodies), plus 1 integration + 1 E2E lifecycle test. The integration auto-skips on NPL 7.50 lock-handle 423 (same pattern as `tests/integration/fugr-func.integration.test.ts:118` from PR #251).

## Development Approach

- TDD ordering: integration test (Task 1) + E2E test (Task 2) + the pure-module unit tests (Task 3) all land **before** the production code (Tasks 4–7), so every implementation task has a definitive red→green signal.
- Unit tests after each code task; integration + E2E only after Task 8.
- Fixture corpus for the parser: copy `b_bapis.txt` (BAPI_USER_GETLIST source) and the NPL POPUP_TO_CONFIRM body into `tests/fixtures/abap/fm-signatures/` so the round-trip test runs on real SAP-emitted source.
- The integration test creates a fresh FUGR per run (`generateUniqueName('ZARC1XPARAMS')`) and cleans up in `finally`. No persistent E2E fixture — too much state to maintain across releases.

## Validation Commands

- `npm test` — unit suite; must pass after every code-touching task
- `npm run typecheck` — must be clean
- `npm run lint` — must be clean
- `npm run test:integration -- fugr-func-params.integration` — runs only the new integration file (after Task 8)
- `npm run test:e2e -- func-params` — runs only the new E2E (after Task 9; needs running MCP server, see [docs/setup-guide.md](../setup-guide.md))

### Task 1: Add integration test for FUNC parameter lifecycle (TDD red)

**Files:**
- Create: `tests/integration/fugr-func-params.integration.test.ts`
- Reference: `tests/integration/fugr-func.integration.test.ts` (PR #251 — the already-merged plain-source lifecycle test; mirror its structure)
- Reference: `tests/integration/crud.lifecycle.integration.test.ts:44` (NPL 7.50 lock-handle skip pattern)

This is the live-system contract for issue #252. It must fail before any implementation lands and pass after Task 7.

- [ ] Read `tests/integration/fugr-func.integration.test.ts` — copy its FUGR-create + FM-create + cleanup boilerplate. Use `getTestClient()` from `tests/integration/helpers.ts` and `generateUniqueName()` from `tests/integration/crud-harness.ts`.
- [ ] Write a single test `'FUGR + FUNC parameter create → activate → read → update → activate → read'` that:
  - Creates a fresh FUGR `ZARC1X<random>` in `$TMP`.
  - Creates an FM `Z_<random>` in that FUGR with structured `parameters: [{ kind: 'importing', name: 'IV_X', type: 'STRING', byValue: true }, { kind: 'exporting', name: 'EV_Y', type: 'STRING', byValue: true }]` and a body source `'  ev_y = iv_x.\n'`.
  - Activates the FM via `SAPActivate`.
  - Reads it back via `SAPRead(type='FUNC', includeSignature: true)`. Asserts the response is JSON with a top-level `signature.importing[0].name === 'IV_X'`, `signature.exporting[0].name === 'EV_Y'`, and the body source contains `ev_y = iv_x.`
  - Updates the FM with an additional `CHANGING` parameter and a `TABLES` parameter and a `RAISING cx_root` raising clause. Re-activates.
  - Re-reads with `includeSignature: true`; asserts all four parameter kinds are present, names match, and the body is preserved.
  - Cleans up in `finally`: delete FM, lock+delete FUGR. Tag cleanup catches `// best-effort-cleanup`.
- [ ] Use `requireOrSkip(ctx, !lockHandleErrored, 'NPL 7.50 lock-handle bug')` around the PUT after lock — same pattern as `crud.lifecycle.integration.test.ts:44`. Capture the 423 with the existing `expectSapFailureClass` from `tests/helpers/expected-error.ts`.
- [ ] Add a second test `'SAPRead includeSignature on existing FM (BAPI_USER_GETLIST)'` that does NO writes — just reads the released BAPI and asserts the parser handles real SAP-emitted source: at least one importing + one exporting + one tables, plus at least one parameter with `default` populated.
- [ ] Run `npm run test:integration -- fugr-func-params.integration` — confirm it FAILS (the schema rejects `parameters`). This is the TDD red signal.
- [ ] Do NOT implement anything yet. The test compiles and fails for the right reason; that is the deliverable.

### Task 2: Add E2E test through the MCP stack (TDD red)

**Files:**
- Create: `tests/e2e/func-params.e2e.test.ts`
- Reference: `tests/e2e/func-write.e2e.test.ts` (PR #251 baseline)

- [ ] Mirror `tests/e2e/func-write.e2e.test.ts` boilerplate — `connectClient()`, `callTool()`, `expectToolSuccess()`, `expectToolError()` from `tests/e2e/helpers.ts`. Sequential test (`test.concurrent.skip` not set).
- [ ] Write one full lifecycle test `'SAPWrite FUNC with structured parameters round-trips through MCP'`:
  - `SAPWrite(action='create', type='FUGR', name='ZARC1XE2EP<rand>', package='$TMP', description='ARC-1 E2E params test')`.
  - `SAPWrite(action='create', type='FUNC', name='Z_E2E_PARAMS<rand>', group='ZARC1XE2EP<rand>', description='param test FM', parameters=[ {kind: 'importing', name: 'IV_INPUT', type: 'STRING', byValue: true}, {kind: 'exporting', name: 'EV_OUTPUT', type: 'STRING', byValue: true} ], source='  ev_output = iv_input.\n')`.
  - `SAPActivate({ type: 'FUNC', name: ..., group: ... })` — assert success.
  - `SAPRead({ type: 'FUNC', name: ..., group: ..., includeSignature: true })` — parse the JSON tool result, assert structured signature has `importing[0].name === 'IV_INPUT'` and `exporting[0].name === 'EV_OUTPUT'`.
  - `SAPWrite(action='update', type='FUNC', name=..., group=..., parameters=[{...same importing}, {...same exporting}, {kind: 'changing', name: 'CV_FLAG', type: 'I'}], source='  ev_output = iv_input.\n  cv_flag = cv_flag + 1.\n')`.
  - `SAPActivate` again.
  - `SAPRead` with `includeSignature: true` — assert `changing[0].name === 'CV_FLAG'`.
  - `try/finally` cleanup: delete FM, lock+delete FUGR.
- [ ] Add a second test `'SAPWrite FUNC structured parameters: missing required type field returns schema error'` — `expectToolError` for a malformed parameters array (e.g., importing parameter with no `type`).
- [ ] Run `npm run test:e2e -- func-params` — confirm it FAILS for "schema rejects parameters". TDD red.
- [ ] Run `npm test` — sanity check the unit suite still passes (no production code changed yet).

### Task 3: Add unit tests for the pure FM-signature module (TDD red)

**Files:**
- Create: `tests/unit/adt/fm-signature.test.ts`
- Create: `tests/fixtures/abap/fm-signatures/bapi-user-getlist.abap` (copy `/tmp/fm-probe/b_bapis.txt` body verbatim — that's the live SAP-emitted source)
- Create: `tests/fixtures/abap/fm-signatures/popup-to-confirm.abap` (the NPL POPUP_TO_CONFIRM source body — captured by the NPL probe agent at `/tmp/fm-probe-npl/src-popup_to_confirm.txt`. If the file is gone, regenerate via curl GET against `https://npl.marianzeis.de/sap/bc/adt/functions/groups/spo1/fmodules/popup_to_confirm/source/main?version=active` with `DDIC:Appl1ance` client 001.)

This task creates the contract for `src/adt/fm-signature.ts`. The module is created in Task 4; the tests must be written first.

- [ ] Add `buildFmSignatureClause` tests (~10):
  - Empty params → empty string (no clause emitted).
  - Single IMPORTING with `type: 'STRING'`, `byValue: true` → `IMPORTING\n  VALUE(NAME) TYPE STRING`.
  - Single IMPORTING by reference → `IMPORTING\n  NAME TYPE STRING`.
  - IMPORTING with `default: "'X'"` and `optional: true` → `IMPORTING\n  VALUE(NAME) TYPE C DEFAULT 'X' OPTIONAL`.
  - Multi-kind: importing + exporting + changing + tables + exceptions + raising emitted in canonical order.
  - TABLES with `LIKE` syntax (`type: 'LIKE BAPIRET2'`) — the type string is emitted verbatim.
  - TABLES with `TYPE STANDARD TABLE` syntax (`type: 'TYPE STANDARD TABLE OF BAPIRET2'`).
  - EXCEPTIONS — emits `EXCEPTIONS\n  EXC_NAME` (no `VALUE()`, no `TYPE`).
  - RAISING — emits `RAISING\n  CX_ROOT`.
  - Mixed EXCEPTIONS + RAISING — both clauses emitted.
- [ ] Add `parseFmSignature` tests (~10):
  - Empty `FUNCTION x.\nENDFUNCTION.` → empty arrays.
  - Round-trip seed: parse the BAPI_USER_GETLIST fixture; assert `importing.length === 2` (max_rows, with_username), `exporting.length === 1` (rows), `tables.length === 4` (selection_range, selection_exp, userlist, return).
  - Round-trip POPUP_TO_CONFIRM fixture; assert at least one parameter with the `##ADT_PARAMETER_UNTYPED` pragma preserved in the type string.
  - Mixed-case input handled (`function x importing value(iv_x) type string.`).
  - Multi-line type expressions (`TYPE TABLE OF X`, `TYPE REF TO Y`).
  - DEFAULT and OPTIONAL flags both detected.
- [ ] Add `spliceFmSignature` tests (~5):
  - Replace existing signature: source `FUNCTION x.\n  IMPORTING NAME TYPE C.\n  body.\nENDFUNCTION.` with new params → signature swapped, body line preserved.
  - Insert into bare stub: source `FUNCTION x.\nENDFUNCTION.` → signature inserted, no body.
  - Body source containing the literal token `IMPORTING` inside a string preserved (anti-false-positive: `WRITE 'IMPORTING the foo'.`).
- [ ] Add 1 property/round-trip test (~1): for a deterministic seed array of mixed parameter kinds, assert `parseFmSignature(buildFmSignatureClause(p))` deep-equals `normalize(p)` (uppercase names, default empty arrays for missing kinds).
- [ ] Run `npx vitest run tests/unit/adt/fm-signature.test.ts` — must FAIL (module doesn't exist). TDD red.

### Task 4: Implement `src/adt/fm-signature.ts` (TDD green)

**Files:**
- Create: `src/adt/fm-signature.ts`
- Test (existing): `tests/unit/adt/fm-signature.test.ts` (Task 3) — must turn green.

Pure-functions module. No imports from `client.ts`, `intent.ts`, or `undici`. Exports three functions and one type:

```typescript
export type FmParameterKind = 'importing' | 'exporting' | 'changing' | 'tables' | 'exceptions' | 'raising';
export interface FmParameter {
  kind: FmParameterKind;
  name: string;
  type?: string;       // ABAP type expression — ignored for `kind: 'exceptions'` and 'raising' (those use `name` only)
  byValue?: boolean;   // emit VALUE(...) wrapper. Default false for importing/changing, true for exporting
  default?: string;    // raw ABAP literal — only IMPORTING/CHANGING. Emit verbatim, no escaping.
  optional?: boolean;  // emit OPTIONAL keyword. Implicit-true for EXPORTING; emit nothing.
}
export function buildFmSignatureClause(params: FmParameter[]): string;
export function parseFmSignature(source: string): { params: FmParameter[]; bodyStart: number; bodyEnd: number };
export function spliceFmSignature(source: string, fmName: string, params: FmParameter[]): string;
```

- [ ] Implement `buildFmSignatureClause` (~50 LoC):
  - Group params by `kind`.
  - Emit kinds in canonical order: `IMPORTING`, `EXPORTING`, `CHANGING`, `TABLES`, `EXCEPTIONS`, `RAISING`.
  - For each parameter line: 4-space indent + `VALUE(NAME) TYPE <type>` (or just `NAME TYPE <type>` when `byValue` is false), then ` DEFAULT <default>` if present, then ` OPTIONAL` if `optional === true`.
  - For EXCEPTIONS lines: just `    NAME`.
  - For RAISING lines: just `    NAME` (uppercase).
  - Two-space indent on the keyword (`  IMPORTING`), four-space indent on each parameter — matches what SAP emits.
- [ ] Implement `parseFmSignature` (~100 LoC):
  - Find `FUNCTION` keyword (case-insensitive) at the start of the source.
  - Walk forward, tracking string-literal context (`'...'` and the `\``...\`` template-string form), to find the first `.` or the first kind keyword (IMPORTING/EXPORTING/CHANGING/TABLES/EXCEPTIONS/RAISING).
  - For each kind keyword, collect lines until the next keyword or the first `.` outside a string literal.
  - Per parameter line: regex-match `^\s*(?:VALUE\s*\(\s*)?(\S+?)\s*\)?\s+(?:TYPE|LIKE)\s+(.+?)(?:\s+DEFAULT\s+(.+?))?(?:\s+OPTIONAL)?\s*$` (case-insensitive). For TABLES: also match `^\s*(\S+)\s+(?:TYPE|LIKE)\s+(.+?)\s*(OPTIONAL)?\s*$`. For EXCEPTIONS / RAISING: match `^\s*(\S+)\s*$` (one identifier per line).
  - Return `{ params, bodyStart, bodyEnd }` where bodyStart is the offset just after the signature-terminator `.` and bodyEnd is the offset of `ENDFUNCTION` (case-insensitive). If `ENDFUNCTION` is missing, bodyEnd is `source.length`.
- [ ] Implement `spliceFmSignature` (~30 LoC):
  - Call `parseFmSignature` to find body bounds.
  - If `params.length === 0`: emit `FUNCTION ${fmName}.${body}ENDFUNCTION.` (no signature clause).
  - Otherwise: emit `FUNCTION ${fmName}\n${buildFmSignatureClause(params)}.\n${body}ENDFUNCTION.`
  - `body` is `source.slice(bodyStart, bodyEnd)` — preserved verbatim.
  - Edge case: source has no `FUNCTION` keyword → throw `Error('FM source does not start with FUNCTION keyword')`. Caller catches and falls back to the user's raw source.
- [ ] Run `npx vitest run tests/unit/adt/fm-signature.test.ts` — all Task 3 tests must turn green.
- [ ] Run `npm run typecheck` and `npm run lint`.

### Task 5: Add Zod schemas + JSON Schema for `parameters` and `includeSignature`

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

- [ ] In `schemas.ts`, near `messageClassMessageSchema` (~line 274), add:
  ```typescript
  const fmParameterSchema = z.object({
    kind: z.enum(['importing', 'exporting', 'changing', 'tables', 'exceptions', 'raising']),
    name: z.string(),
    type: z.string().optional(),
    byValue: z.coerce.boolean().optional(),
    default: z.string().optional(),
    optional: z.coerce.boolean().optional(),
  });
  ```
- [ ] Add `parameters: z.array(fmParameterSchema).optional()` to: `SAPWriteSchema`, `SAPWriteSchemaBtp`, `batchObjectSchemaOnprem`, `batchObjectSchemaBtp`. (All four — keeps the schema layer consistent.)
- [ ] Add `includeSignature: z.coerce.boolean().optional()` to `SAPReadSchema` and `SAPReadSchemaBtp` (if present — check how SAPRead schemas are defined).
- [ ] In `tools.ts`, add the matching JSON Schema property to the SAPWrite tool's `inputSchema.properties` and the SAPRead tool's `inputSchema.properties`. Mirror the Zod shape exactly. Include a tight `description` field on each property explaining the structure with one example in the description string.
- [ ] Update SAPWrite tool description (~line 164): drop the "FM parameter signatures (IMPORTING/EXPORTING/EXCEPTIONS) are NOT managed by this tool" wording. Replace with a one-line inline example like: `'FUNC: parameters supports structured signature management — pass an array of {kind: importing|exporting|changing|tables|exceptions|raising, name, type, byValue?, optional?, default?} to add/replace IMPORTING/EXPORTING/etc. The existing *" SAPGUI comment-block strip-and-warn still runs as defense-in-depth.'`. SAPGUI users keep the strip behavior.
- [ ] Add ~4 unit tests in `schemas.test.ts`:
  - Schema accepts SAPWrite FUNC with valid `parameters` array.
  - Schema rejects SAPWrite FUNC `parameters` with missing `kind`.
  - Schema accepts SAPRead FUNC with `includeSignature: true`.
  - Schema accepts SAPRead FUNC without `includeSignature` (backward compat).
- [ ] Add ~2 unit tests in `tools.test.ts`:
  - `parameters` property exists in SAPWrite tool definition.
  - `includeSignature` property exists in SAPRead tool definition.
- [ ] Run `npm test`.

### Task 6: Wire structured parameters into SAPWrite (intent.ts)

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

- [ ] At the top of `handleSAPWrite` FUNC create branch (after `args.group` resolution at ~line 3083), extract `parameters` from `args` (`const parameters = args.parameters as FmParameter[] | undefined`). Import `FmParameter` and `spliceFmSignature` from `../adt/fm-signature.js`.
- [ ] In the create branch (~line 3214 onwards):
  - When `parameters` is provided: build the source via `spliceFmSignature(source ?? `FUNCTION ${name}.\nENDFUNCTION.`, name, parameters)`. Wrap in try/catch — if `spliceFmSignature` throws (no `FUNCTION` token), fall back to `source` and append a warning.
  - The resulting source still goes through `stripFmParamCommentBlock` (defense-in-depth: the user's body could still contain `*"` blocks).
- [ ] In the update branch (~line 3173 onwards): same logic. When `parameters` is supplied, splice into the user's source (or fetch the current source via `client.getFunction(group, name)` if the user provided only `parameters` and no `source` — preserves the existing body).
- [ ] Drop the always-emitted "FM signature/parameter management is out of scope" tone in the response — replace with a contextual warning only when `parameters` is empty AND the user's source contains no signature keywords (LLM probably forgot).
- [ ] Add ~6 unit tests in `tests/unit/handlers/intent.test.ts` (use the existing `vi.mock('undici', ...)` pattern):
  - `SAPWrite create FUNC with parameters → PUT body contains generated IMPORTING clause`.
  - `SAPWrite update FUNC with parameters → splices into user's source preserving body`.
  - `SAPWrite update FUNC with parameters but no source → fetches current source and replaces signature only`.
  - `SAPWrite create FUNC with neither parameters nor source → creates empty-shell FM (no PUT to /source/main)`.
  - `SAPWrite create FUNC with both parameters and SAPGUI *" block in source → strips block AND emits structured clause`.
  - `SAPWrite create FUNC with malformed parameters (no kind) → returns schema error from Zod (no PUT issued)`.
- [ ] Run `npm test` — new tests pass; existing tests still pass.

### Task 7: Wire `includeSignature` into SAPRead (intent.ts)

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

- [ ] In `handleSAPRead` `case 'FUNC'` (~line 1447), check `args.includeSignature === true`. When true, call `parseFmSignature(source)` on the result of `client.getFunction(group, name)`, and return JSON via `textResult(JSON.stringify({ source, signature: { importing, exporting, changing, tables, exceptions, raising } }, null, 2))` where each kind is the parameters of that kind from the parser (defaulting to empty array).
- [ ] When `includeSignature` is false/missing, behavior is unchanged (returns plain source — backward compatible).
- [ ] Add ~3 unit tests:
  - `SAPRead FUNC with includeSignature=true → JSON shape with structured arrays`.
  - `SAPRead FUNC without includeSignature → plain source string (backward compat)`.
  - `SAPRead FUNC includeSignature=true on FM with no parameters → all six arrays empty`.
- [ ] Run `npm test`.

### Task 8: Run live integration + E2E tests; verify TDD red turns green

**Files:**
- Update if needed: `tests/integration/fugr-func-params.integration.test.ts`, `tests/e2e/func-params.e2e.test.ts`

- [ ] Run `npm run test:integration -- fugr-func-params.integration` against `TEST_SAP_URL=https://a4h.marianzeis.de` (a4h S/4HANA 2023). All tests must pass.
- [ ] Run `npm run test:integration -- fugr-func-params.integration` against `TEST_SAP_URL=https://npl.marianzeis.de` (NPL 7.50). The lifecycle test must auto-skip with `SkipReason.BACKEND_UNSUPPORTED` (lock-handle 423); the BAPI_USER_GETLIST read test must pass (it's read-only).
- [ ] Build (`npm run build`) and start the MCP server in HTTP-streamable mode locally (`npm run dev:http`). Run `npm run test:e2e -- func-params` — all tests must pass.
- [ ] If any test fails, debug the production code (Tasks 4–7). Do NOT relax the tests to make them pass.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint` — all clean.

### Task 9: Update documentation, roadmap, feature matrix, and CLAUDE.md

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `compare/00-feature-matrix.md`
- Modify: `compare/fr0ster/evaluations/issue-77-fm-update-parameter-loss.md`
- Modify: `docs_page/roadmap.md`
- Modify: `CLAUDE.md`

- [ ] In `docs_page/tools.md`: extend the SAPWrite section for FUNC with the new `parameters` array. Show one canonical example: `parameters: [{ kind: 'importing', name: 'IV_X', type: 'STRING', byValue: true }, { kind: 'exporting', name: 'EV_Y', type: 'STRING', byValue: true }, { kind: 'raising', name: 'CX_ROOT' }]`. Add `includeSignature: true` row to SAPRead section, with a JSON-shaped example response.
- [ ] In `compare/00-feature-matrix.md`: add a new row "FUNC parameter management (structured)" with ARC-1 = ✅, others = ❌ (we verified none of the other clients have this). Bump "Last Updated".
- [ ] In `compare/fr0ster/evaluations/issue-77-fm-update-parameter-loss.md`: append a `## 2026-05-10 update — issue #252 closes parameter management for ARC-1` section explaining: parameters live INLINE in `/source/main`, not in metadata; fr0ster's metadata-endpoint hypothesis was incorrect; the fix is a structured-array → ABAP-source generator (this PR); cross-release verified on a4h S/4 + NPL 7.50.
- [ ] In `docs_page/roadmap.md`: add a new completed entry "FUNC parameter management via structured array (issue #252)" with the date and a one-line summary.
- [ ] In `CLAUDE.md`: edit the "Add FUGR/FUNC write" Key Files row — append `+ src/adt/fm-signature.ts (parameter generator/parser) + parameters array on SAPWriteSchema` and drop the "FM signature/parameter management is out of scope" sentence. Replace it with: `Structured parameters (importing/exporting/changing/tables/exceptions/raising) supported via parameters array — see src/adt/fm-signature.ts. Issue #252 / docs/plans/completed/add-fm-parameters.md.`. Keep the FUNC_ADT028 SAPGUI-block-strip note (still load-bearing defense-in-depth).

### Task 10: Final verification

- [ ] Run full unit test suite: `npm test` — all tests pass (no skips beyond pre-existing skips).
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run `npm run test:integration -- fugr-func-params.integration` against a4h — all pass.
- [ ] Run `npm run test:e2e -- func-params` (with MCP server running) — all pass.
- [ ] Smoke test by hand: start MCP server, call `SAPWrite create FUGR + FUNC with parameters` via direct MCP client, then `SAPRead includeSignature=true` and verify the JSON shape. Document in the PR description.
- [ ] Move this plan to `docs/plans/completed/add-fm-parameters.md`.
- [ ] Verify no commented-out code, no `console.log`, no `any` casts beyond what was already there.
- [ ] Verify the `SAPWRITE_TYPES_ONPREM` enum and tool description three-file sync is intact (CLAUDE.md "Tool schema three-file sync" invariant).

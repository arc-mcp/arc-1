# Harden tool-argument validation against GPT/OpenAI schema pollution (issue #360)

## Overview

GPT/OpenAI-style tool callers routinely send "polluted" tool payloads: they over-populate optional schema fields with `null`, empty strings, default booleans, and irrelevant enum values. This makes otherwise-valid ARC-1 tool calls fail — or, worse, silently corrupt data. This plan hardens ARC-1's input layer so common ABAP operations succeed even when the client adds harmless-but-irrelevant optional fields.

Every real failure was reproduced and verified live on S/4HANA 2023 (SAP_BASIS 758, `a4h.marianzeis.de`) plus deterministic Zod probes. The failures are **all at the Zod schema-validation layer**, via four mechanisms:

1. **`null` on optional fields** → `z.X().optional()` rejects `null`. OpenAI Structured Outputs / `strict` mode (the **default** for the Responses API) emulates an optional field as a `["type","null"]` union and emits `null` for every unused optional, so a strict client cannot make a clean call — every optional field it doesn't use becomes `null` and is rejected. **Broadest vector — affects every optional field of every tool.** (OpenAI Structured Outputs guide; MCP spec "servers MUST validate all tool inputs".)
2. **Empty / whitespace strings** → rejected on optional enums (`odataVersion=""`, `category=""`, `visibility=""`, `typeKind=""`, `format=""`, `version=""`, `style=""`, `analysis=""`, `backend=""`, `packageType=""`), and silently coerced to `0` on optional numbers (`length=""` → `0`).
3. **Stringified booleans** → `z.coerce.boolean()` runs `Boolean("false") === true`, so `signExists="false"` / `lowercase="no"` / `dryRun="false"` are silently **inverted to `true`**. Live-proven data corruption: a DOMA created with `signExists="false"`/`lowercase="false"` persisted on the server as `signExists=true`/`lowercase=true`. The codebase already documents this trap at `src/handlers/schemas.ts:391` (`looseOptionalBoolean`) but applied the fix to only one field (`abstract`).
4. **Non-empty `include` on a non-CLAS / non-include-aware action** → hard Zod rejection (the issue's headline case). Compounded by a doc bug: `src/handlers/tools.ts` advertises `include` for `add_method`/`edit_method_signature`/`delete_method`, which `src/handlers/schemas.ts` rejects.

The fix is small and central. A single pre-validation normalization pass that strips `null` + empty/whitespace strings subsumes the enum-empty and number-empty problems (Zod then sees `undefined`, and `.optional()` is satisfied) across all 12 tools at one choke-point. Only the stringified-boolean case needs a schema-level helper (stripping can't fix the non-empty string `"false"`), and only `include` needs targeted handling. Research confirmed the ADT wire format is `true`/`false` text (three independent ADT clients agree) and that ARC-1's `boolToXml` + parser already round-trip correctly — so the fix is purely client-side input normalization, with the post-fix end state (real boolean `false` → non-sign domain) verified live.

## Context

### Current State

- All tool args are validated by Zod in `handleToolCall` (`src/handlers/intent.ts`), after a per-tool `normalizeTypeArgsForValidation()` pass that today only normalizes `type` slash-aliases. This single call site (`src/handlers/intent.ts:1166`) feeds **both** scope-key derivation and Zod validation, and covers standard tools, hyperfocused mode (`server.ts` → `expandHyperfocusedArgs` → `handleToolCall`), and the CLI.
- `null`-valued optional fields are rejected everywhere (`z.string().optional()` rejects `null`).
- Empty-string optional **enums** are rejected; empty-string optional **numbers** silently become `0`.
- 36 `z.coerce.boolean().optional()` sites silently map `"false"`/`"0"`/`"no"` → `true`. Only `abstract` uses the safe `looseOptionalBoolean` helper.
- `include` is hard-rejected by `validateSapWriteInput` (`src/handlers/schemas.ts:426`) on any non-CLAS or non-`{update,edit_method,edit_class_definition}` action, but `src/handlers/tools.ts:684` tells LLMs it is valid for three more actions.
- Validation failures return `errorResult(formatZodError(...))` with a generic "Check the tool schema" hint and no "do not retry unchanged" guidance.

### Target State

- A client may add irrelevant optional fields (`null`, `""`, stringified booleans, an irrelevant `include`) and still have valid intent succeed.
- `null` and empty/whitespace strings on optional fields are treated as omitted, for all tools, at one place — before scope derivation and before Zod.
- `signExists="false"` (and every other boolean) is correctly interpreted as `false`; real JSON booleans (`false`) still work (compliant clients like Claude send those).
- A non-empty but inapplicable `include` is dropped (e.g. `include` on a DDLS update writes `/source/main` and succeeds); a *garbage* `include` value on a valid CLAS include-write path still errors clearly.
- Public tool docs state `include` is CLAS-only (3 actions) and that `delete` needs only a minimal payload.
- Invalid-argument errors tell the model to fix the listed fields and not resend the same arguments unchanged.

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | `handleToolCall` validation choke-point (line ~1166–1246); `normalizeTypeArgsForValidation` (line ~3362) — the place to add the strip pass + `include` drop. |
| `src/handlers/schemas.ts` | Zod schemas for all tools; `looseOptionalBoolean` helper (line ~399); `validateSapWriteInput` (line ~426); 36 `z.coerce.boolean().optional()` sites. |
| `src/handlers/tools.ts` | Public JSON Schema + descriptions shown to LLMs; `include` field description (line ~680–685); SAPWrite tool description (line ~177). |
| `src/handlers/zod-errors.ts` | `formatZodError` — LLM-facing validation error text + hint. |
| `tests/unit/handlers/schemas.test.ts` | Schema unit tests (already covers `coerces boolean expand_includes`, `signExists:'true'`, numeric coercion). |
| `tests/unit/handlers/zod-errors.test.ts` | `formatZodError` unit tests. |
| `tests/unit/handlers/intent.test.ts` | Handler tests incl. existing include rejection (`rejects garbage include value`). |
| `tests/unit/handlers/tools.test.ts` | Tool-definition tests. |

### Design Principles

1. **Fix at the validation layer, not the handler.** Every reproduced failure is a Zod-layer problem. Handler-level normalization the issue also proposes (strip cross-leaked metadata, minimal delete payload, strip batch top-level fields) is already effectively done — `buildDataElementXml`/`buildDomainXml`/`mergeMetadataWriteProperties` and the `delete` handler only read relevant fields (verified live: a `delete DTEL` with `source`/`dataType`/`odataVersion` pollution succeeds; a `DTEL update` with leaked SRVB fields succeeds). Do **not** add handler normalization passes.
2. **One choke-point.** Add the strip pass inside `normalizeTypeArgsForValidation` so it runs once for standard tools, hyperfocused mode, and the CLI — before scope derivation and Zod.
3. **Strip `null` + empty/whitespace strings only; never `false` or `0`.** The condition is `v === null || (typeof v === 'string' && v.trim() === '')`. Real boolean `false` and numeric `0` MUST survive.
4. **Shallow at top level + one level into `objects[]`.** Batch arrays (`objects` for SAPWrite `batch_create` and SAPActivate) carry the same per-item optional fields and must be sanitized. Do NOT recurse into leaf data arrays (`messages`, `fixedValues`, `parameters`, `where`) — those carry user data where empty/null may be meaningful.
5. **Keep `looseOptionalBoolean` (accepts real booleans AND `"true"/"false"/"1"/"0"/"yes"/"no"`); do NOT use `z.stringbool()`.** Verified: `z.stringbool()` REJECTS real JSON booleans, which would regress compliant clients. The ADT wire contract is text `true`/`false` and ARC-1's `boolToXml`/parser already handle it — so no XML/handler change is needed.
6. **`include`: drop when inapplicable, keep the enum check for garbage-on-valid-path.** Drop `include` unless `type === 'CLAS'` AND `action ∈ {update, edit_method, edit_class_definition}`. A garbage value on a valid CLAS include-write path must still fail (preserves the existing `tests/unit/handlers/intent.test.ts` "rejects garbage include value" test).
7. **Three-file sync.** Any schema/descriptor change must stay consistent across `tools.ts` (JSON Schema for LLMs), `schemas.ts` (Zod), and `intent.ts` (handler).
8. **No behavior change for compliant clients.** Real booleans, real numbers, and properly-omitted optionals must validate exactly as before. The existing `schemas.test.ts` coercion tests (`coerces boolean expand_includes from string`, `signExists:'true'`, numeric `maxRows`/`maxResults`) must keep passing.

### Out of scope (document, do not implement here)

- Empty `source` on a source-bearing update still PUTs empty source (pre-existing; a "source required for source-type update" guard is a separate change). The strip pass does not make this worse — handler behavior is unchanged whether `source=""` is stripped or not.
- Recursing strip into nested config objects/arrays beyond `objects[]` (`where`, `fixedValues`, `messages`, `parameters`).
- Converting a single top-level create-like object into a one-item `batch_create` (the issue's optional suggestion) — keep the clear "objects array required" error.

## Development Approach

- TypeScript strict, ESM (`.js` import suffixes), Biome formatting (pre-commit auto-fixes — never hand-format).
- Each task adds/updates unit tests and must leave `npm test`, `npm run typecheck`, `npm run lint` green.
- The two boolean-helper sites already in use (`abstract`) must keep working; the existing `schemas.test.ts` assertions are the regression guard.
- Live SAP verification (integration task) uses `a4h.marianzeis.de` (SAP_BASIS 758) via `TEST_SAP_URL`; objects go in `$TMP` and are cleaned up in `finally`.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add the pre-validation strip pass (null + empty-string → omitted) for all tools

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

This is the foundation: a pure normalizer that removes GPT "overpopulation" pollution before Zod sees it. It fixes the `null`-on-optional rejection (every optional field, every tool) and the empty-string-on-enum rejection and the empty-string-on-number → `0` silent bug, all at one choke-point. Verified live: `SAPWrite create DTEL` with `serviceDefinition:null, source:null, group:null` is currently rejected ("required (expected string)"); after this task it must succeed.

- [ ] In `src/handlers/intent.ts`, add an exported pure function near `normalizeTypeArgsForValidation` (~line 3344):
  ```ts
  /**
   * Strip GPT/OpenAI "overpopulation" pollution before Zod validation:
   *  - null values (Structured Outputs / strict mode emits null for unused optionals)
   *  - empty / whitespace-only strings (treated as "omitted")
   * Preserves real `false` and `0` — only null and empty/whitespace strings are removed.
   * Shallow at the top level, plus one level into each `objects[]` item (batch_create /
   * SAPActivate). Does NOT recurse into leaf data arrays (messages/fixedValues/parameters/where)
   * — those carry user data where empty/null can be meaningful.
   */
  export function stripLlmEmptyValues(args: Record<string, unknown>): Record<string, unknown> {
    const isEmpty = (v: unknown): boolean => v === null || (typeof v === 'string' && v.trim() === '');
    const cleanShallow = (obj: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!isEmpty(v)) out[k] = v;
      }
      return out;
    };
    const cleaned = cleanShallow(args);
    if (Array.isArray(cleaned.objects)) {
      cleaned.objects = cleaned.objects.map((o) =>
        o && typeof o === 'object' && !Array.isArray(o) ? cleanShallow(o as Record<string, unknown>) : o,
      );
    }
    return cleaned;
  }
  ```
- [ ] Wire it into `normalizeTypeArgsForValidation` (~line 3362) so EVERY tool branch (including `default`) operates on the stripped object: at the top of the function compute `const cleaned = stripLlmEmptyValues(args);` and replace all subsequent reads of `args` in that function with `cleaned` (each `case` spreads `...cleaned` and reads `cleaned.type` / `cleaned.objects` / etc.; the `default` returns `cleaned`). Do not change the type-normalization logic itself.
- [ ] Add unit tests (~8 tests) in `tests/unit/handlers/intent.test.ts` (import `stripLlmEmptyValues`): strips `null` values; strips `""` and `"   "` strings; PRESERVES real `false`; PRESERVES real `0`; PRESERVES non-empty strings; sanitizes each item inside `objects[]` (null/empty dropped per item); does NOT recurse into `messages`/`fixedValues` (a `fixedValues:[{low:'',...}]` keeps its inner empty string); returns a new object (does not mutate input).
- [ ] Run `npm test` — all tests must pass.

### Task 2: Stop `z.coerce.boolean()` from inverting stringified "false"

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`

`z.coerce.boolean()` maps the string `"false"`/`"0"`/`"no"` → `true` (it calls `Boolean()`), silently inverting intent. Live-proven DDIC corruption (`signExists="false"` persisted as `true`). Replace every `z.coerce.boolean().optional()` with the existing safe `looseOptionalBoolean` helper, which accepts real booleans AND stringified ones and maps `"false"/"0"/"no"` → `false`. Do NOT switch to `z.stringbool()` — it rejects real JSON booleans (verified), which would regress compliant clients.

- [ ] In `src/handlers/schemas.ts`, MOVE the `looseOptionalBoolean` definition (currently ~line 399) UP to just after the imports / first helpers, BEFORE its first use. Required because the SAPRead/SAPSearch schemas (~line 198+) appear before line 399 and will now reference it. Keep its implementation unchanged (it already handles real booleans, `"true"/"1"/"yes"` → true, `"false"/"0"/"no"/""` → false).
- [ ] Replace ALL `z.coerce.boolean().optional()` occurrences (36 of them) with `looseOptionalBoolean`. Sites span: SAPRead (`expand_includes`, `includeSignature`, `force_refresh`) + its BTP variant, SAPSearch, SAPWrite top-level (`signExists`, `lowercase`, `changeDocument`, `lintBeforeWrite`, `preflightBeforeWrite`, `checkBeforeWrite`, `autoApply`, `activate`, `activateAtEnd`, `dryRun`) + BTP variant, both `batchObjectSchema*` (`signExists`, `lowercase`, `changeDocument`), `fmParameterSchema` (`byValue`, `optional`), `SAPLintSchema` (`indentation`), `SAPDiagnoseSchema` (`preaudit`), `SAPQuerySchema` (`includeFullText`). Verify zero `z.coerce.boolean(` remain: `grep -c "z.coerce.boolean(" src/handlers/schemas.ts` must be `0`.
- [ ] Confirm `abstract` still uses `looseOptionalBoolean` (unchanged) and that `tests/unit/handlers/schemas.test.ts` existing assertions still hold: `coerces boolean expand_includes from string` (line ~178), `signExists:'true'` → `true` (line ~561/569), `abstract:false` → `false` (line ~748).
- [ ] Add unit tests (~6 tests) in `tests/unit/handlers/schemas.test.ts`: `signExists:"false"` → `false` (the regression); `signExists:false` (real bool) → `false`; `signExists:true` (real bool) → `true`; `lowercase:"no"` → `false`; `dryRun:"false"` → `false`; `lintBeforeWrite:"0"` → `false`.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Normalize inapplicable `include` + fix the public include/delete docs

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

A non-empty `include` on a non-CLAS / non-include-aware action is the issue's headline failure (`SAPWrite update DDLS include="definitions"` is hard-rejected today). Drop `include` when it cannot apply, so valid intent (write `/source/main`) succeeds; keep the enum check so a garbage value on a real CLAS include-write path still errors. Also fix the JSON-schema doc that wrongly advertises `include` for three unsupported actions.

- [ ] In `src/handlers/intent.ts` `normalizeTypeArgsForValidation`, in the `case 'SAPWrite':` branch (operating on the stripped `cleaned` object from Task 1), compute the normalized type and action, then drop `include` unless applicable:
  ```ts
  const act = String(cleaned.action ?? '');
  const normType = cleaned.type === undefined ? undefined : normalizeWriteObjectType(String(cleaned.type ?? ''));
  const includeApplies =
    normType === 'CLAS' && (act === 'update' || act === 'edit_method' || act === 'edit_class_definition');
  const base = { ...cleaned };
  if (!includeApplies) delete base.include; // inapplicable include is meaningless → omit it
  // then return base with type/objects normalized as today
  ```
  Ensure the existing `type`/`objects` normalization still applies on top of `base`.
- [ ] Keep `validateSapWriteInput` (`schemas.ts`) and the `include` enum as defense-in-depth (they now only fire for a garbage value on a valid CLAS path, which is correct).
- [ ] In `src/handlers/tools.ts`, fix the `include` field description (~line 684): list ONLY `update, edit_method, edit_class_definition` (remove `add_method, edit_method_signature, delete_method`); add a sentence: "`include` is CLAS-only; it is ignored for other object types." Also append to the SAPWrite tool description (`SAPWRITE_DESC_ONPREM` ~line 177 and `SAPWRITE_DESC_BTP`): "`delete` needs only `type` and `name` (plus optional `transport`); other fields are ignored." Keep `tools.ts`/`schemas.ts`/`intent.ts` consistent (three-file sync).
- [ ] Add/adjust unit tests (~6 tests) in `tests/unit/handlers/intent.test.ts` (exercise via the exported `normalizeTypeArgsForValidation` and/or `handleToolCall` with a mocked client): `SAPWrite update DDLS include="definitions"` → `include` dropped (no validation error; routes to source write); `SAPWrite delete CLAS include="definitions"` → dropped; `batch_create` with top-level `include` → dropped; `SAPWrite update CLAS include="definitions"` → KEPT; `SAPWrite update CLAS include="frobnicate"` → still REJECTED (garbage on valid path); `SAPWrite add_method CLAS include="implementations"` → dropped (MAIN-only action). Confirm the existing "rejects garbage include value" test still passes.
- [ ] Run `npm test` — all tests must pass.

### Task 4: Add a "do not retry unchanged" hint to validation errors

**Files:**
- Modify: `src/handlers/zod-errors.ts`
- Modify: `tests/unit/handlers/zod-errors.test.ts`

Per the MCP error model, input-validation failures are returned as tool errors (`isError: true`) so the model can self-correct — but the model often resends the identical payload. Make the hint explicit and actionable.

- [ ] In `src/handlers/zod-errors.ts` `formatZodError`, replace the trailing hint line with two lines: (1) "Fix the fields listed above, then retry — do NOT resend the same arguments unchanged." (2) "Tip: omit optional fields you don't need (do not send empty strings or null for them)." Keep the existing per-issue formatting unchanged.
- [ ] Update `tests/unit/handlers/zod-errors.test.ts`: existing assertions check `toContain('Hint:')` — keep a recognizable hint marker (e.g. keep the word `retry`/`omit`) and add assertions that the message contains "do NOT resend" (or equivalent) and the omit-optionals guidance. Add ~2 tests.
- [ ] Run `npm test` — all tests must pass.

### Task 5: Live SAP integration test — DDIC boolean round-trip + pollution acceptance

**Files:**
- Modify: `tests/integration/adt.integration.test.ts` (or add a focused file under `tests/integration/`)

Prove on a live system that the post-fix behavior is correct end-to-end. Read `docs/testing-skip-policy.md` and use `getTestClient()` from `tests/integration/helpers.ts`; objects go in `$TMP`, names from `generateUniqueName()`, cleanup in `finally` tagged `// best-effort-cleanup`. Hard-fail when `TEST_SAP_URL` is unset (`requireSapCredentials()`), never silent-skip.

- [ ] Add a test that creates a DOMA (dataType `DEC`, length 8, decimals 2) with `signExists: "false"` and `lowercase: "false"` (stringified, GPT-style), then reads it back and asserts `signExists === false` and `lowercase === false` (the regression — pre-fix this persisted as `true`). Clean up in `finally`.
- [ ] Add a test that creates a DTEL with strict-mode `null` pollution on optionals (`serviceDefinition: null`, `source: null`, `group: null`, `bindingType: null`) plus valid DTEL fields, and asserts the create succeeds (pre-fix this was rejected). Clean up.
- [ ] Add a test that updates a CDS/source object (or DTEL) where the payload includes an empty-string optional enum (`odataVersion: ""`) and an inapplicable `include: "definitions"`, asserting success (pre-fix: rejected). Use an object the harness can create; clean up.
- [ ] Run `npm run test:integration` against `TEST_SAP_URL=http://a4h.marianzeis.de:50000` — new tests pass; no unexpected skips.

### Task 6: E2E test — pollution payloads through the full MCP stack

**Files:**
- Modify: `tests/e2e/` (add cases to an existing `*.e2e.test.ts`; transient objects with `try/finally`)

Exercise the real MCP JSON-RPC path (`connectClient()`, `callTool()`, `expectToolSuccess()` from `tests/e2e/helpers.ts`) to prove the normalization works at the protocol boundary, not just in unit tests. 120s timeouts; sequential.

- [ ] Add an E2E case: `SAPWrite create DTEL` with a heavily polluted payload (mix of `null`, `""`, and stringified booleans on irrelevant optionals) succeeds and the object reads back with correct flags. Clean up the transient object in `finally`.
- [ ] Add an E2E case: `SAPWrite update` on a non-CLAS source object with `include="definitions"` present succeeds (include dropped). Clean up.
- [ ] Add an E2E case: an intentionally invalid payload (e.g. `odataVersion` set to a non-enum non-empty value like `"V9"`) returns a tool error whose text contains the "do NOT resend" hint.
- [ ] Run `npm run test:e2e` (requires a running MCP server) — new cases pass.

### Task 7: Documentation, roadmap, feature matrix, skills

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs_page/tools.md`
- Modify: `docs_page/architecture.md`
- Modify: `docs_page/roadmap.md`
- Modify: `compare/00-feature-matrix.md`

Keep the autonomous-agent-facing and user-facing docs consistent with the new behavior.

- [ ] `CLAUDE.md`: add a "Key Files for Common Tasks" row, e.g. "Normalize/sanitize LLM tool args (strip null/empty pollution, drop inapplicable include) | `src/handlers/intent.ts` (`stripLlmEmptyValues` + `normalizeTypeArgsForValidation`), `src/handlers/schemas.ts` (`looseOptionalBoolean` for all optional booleans), `tests/unit/handlers/{intent,schemas}.test.ts`". Add a one-line note in the "Architecture: Request Flow" section step 4 that args are stripped of null/empty pollution before Zod. Keep rows terse (per repo convention).
- [ ] `docs_page/tools.md`: note that optional fields may be omitted/null/empty without breaking calls; `include` is CLAS-only (update/edit_method/edit_class_definition); `delete` uses a minimal payload.
- [ ] `docs_page/architecture.md`: add the pre-validation normalization step (null/empty strip + boolean coercion) to the request-flow description.
- [ ] `docs_page/roadmap.md` and `compare/00-feature-matrix.md`: add/refresh a row for "Robust against GPT/OpenAI schema over-population" (✅) and update the "Last Updated" date in the feature matrix.
- [ ] Run `npm run typecheck` and `npm run lint` (docs-only edits won't affect these, but keep the gate green).

### Task 8: Final verification

- [ ] Run full unit suite: `npm test` — all pass.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] `grep -c "z.coerce.boolean(" src/handlers/schemas.ts` returns `0`.
- [ ] Re-run the live pollution scenarios via the CLI against `a4h.marianzeis.de` (SAP_BASIS 758): `signExists="false"` create → reads back `false`; `null`-polluted DTEL create → succeeds; `update DDLS include="definitions"` → succeeds; `odataVersion=""` → no longer rejected. Clean up scratch objects.
- [ ] Confirm `tools.ts` / `schemas.ts` / `intent.ts` remain three-file-consistent for `include` and the boolean fields.
- [ ] Move this plan to `docs/plans/completed/`.

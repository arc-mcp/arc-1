# Add `grep` regex search to SAPRead source reads

## Overview

This plan adds an optional `grep="<regex>"` parameter to the `SAPRead` tool. When supplied for a source-bearing object type, ARC-1 fetches the source (via the existing cached read path) and returns **only the matching lines plus ±3 lines of context**, each with its 1-based line number, instead of the full object source. For `CLAS`, each match is annotated with the owning class/method (e.g. `ltcl_test=>setup`) so an agent can immediately follow up with a targeted `method=` read.

This is a token-efficiency feature (Design Principle #3): it gives LLM clients the same "search → locate → read" loop they use on a local filesystem with ripgrep, but server-side over ADT — turning a 1,000+ line full-class read into a few hundred tokens of matches. It is the one non-redundant capability from the suggestion in [issue #313](https://github.com/arc-mcp/arc-1/issues/313): the surgery half of that suggestion (`edit_definition`, method listing) already shipped in [PR #307](https://github.com/arc-mcp/arc-1/pull/307) (`edit_class_definition`, `add_method`, `method="*"`, `class-structure.ts`).

Key design decisions: (1) the matching logic lives in a **new pure module `src/context/grep.ts`** (no I/O), mirroring `src/context/method-surgery.ts`, so it is fully unit-testable in isolation; (2) CLAS match annotation reuses the **existing `MethodInfo.containingClass`** field from `method-surgery.ts` — we do NOT add a new field; (3) `grep` is a pure response transform on already-fetched, already-cached source, so it requires **no new scope, no safety/authz change, and no new SAP round-trip** (it reuses the `read` scope and the source cache).

## Context

### Current State

- `handleSAPRead` in `src/handlers/intent.ts` (function starts ~line 1445) dispatches by object type. Source-bearing cases each fetch source via a local `cachedGet(type, name, effectiveVersion, (ifNoneMatch) => client.getX(...))` closure (defined ~line 1474, returns `{ source, cacheHit, revalidated }`) and return it with the existing `cachedTextResult(source, cacheHit, revalidated, versionWarning)` helper. Derived/early-return results use `textResult(...)`; user errors use `errorResult(...)`.
- Relevant source-bearing case labels (verified on `origin/main`): `PROG` (1501), `CLAS` (1507), `INTF` (1544), `FUNC` (1550), `INCL` (1610), `DDLS` (1616), `DCLS` (1636), `BDEF` (1642), `SRVD` (1648). The `CLAS` case already handles `format==='structured'`, `method` (incl. `method="*"` → `formatMethodListing`), and `include=` sub-sections.
- There is **no** way to search within an object's source today — an agent must read the entire object and scan it in-context. The word "grep" appears nowhere in `src/handlers/{schemas,tools,intent}.ts` on `origin/main`.
- `src/context/method-surgery.ts` already exports `listMethods(source, className, abaplintVersion?) → MethodListResult { methods: MethodInfo[] }`. `MethodInfo` (line 20) already carries `name`, `startLine`, `endLine`, `visibility`, and **`containingClass?: string`** (line 45) — the local `CLASS x IMPLEMENTATION` name that contains each method, which is exactly the annotation label this feature needs.
- `SAPReadSchema` and `SAPReadSchemaBtp` (`src/handlers/schemas.ts`, ~lines 164 and ~182) already declare `method`, `include`, `format`, etc. as `z.string().optional()` / enums. The SAPRead `inputSchema` properties live in `src/handlers/tools.ts` (the `method`/`format` properties are ~lines 511–540), plus the long `SAPREAD_DESC_ONPREM` / `SAPREAD_DESC_BTP` description constants (~lines 158–162).

### Target State

- `SAPRead(type=PROG|CLAS|INTF|FUNC|INCL|DDLS|DCLS|BDEF|SRVD, name=..., grep="<regex>")` returns a compact match report: a header line (`N match(es) for /pattern/i:`), then for each match a `>`-marked line with a 5-wide right-padded 1-based line number and the line text, with ±3 context lines (un-marked) and `--` separators between non-contiguous blocks.
- For `CLAS`, matches are grouped/labelled by `containingClass=>method` using `listMethods`. `grep` may be combined with `include=` to scope the search to one class section; combining `grep` with `method=` returns a clear `errorResult` ("use grep to find, then method= to read").
- Invalid regex → `errorResult` with a clear message. Zero matches → a friendly "No matches" text result. If the pattern has regex metacharacters and matches nothing, retry once as a literal string (LLMs frequently forget to escape `(`, `.`, `?`). Output is capped at 100 matches with a "narrow your pattern" note.
- New pure module `src/context/grep.ts` with `grepSource(source, pattern, opts?) → { matchCount, output, invalidPattern }`, fully unit-tested.
- Docs (`tools.md`, `CLAUDE.md`, `README.md`, feature matrix, roadmap) reflect the new parameter.

### Key Files

| File | Role |
|------|------|
| `src/context/grep.ts` | **NEW** pure helper: compile regex, find matching lines, expand context, annotate by method range, format output. No I/O. |
| `src/context/method-surgery.ts` | Source of `MethodInfo` (`name`, `startLine`, `endLine`, `containingClass`) and `listMethods()`; read-only, not modified. |
| `src/handlers/intent.ts` | `handleSAPRead` — wire `grep` into source-bearing cases; CLAS annotation + `grep`+`method` guard. |
| `src/handlers/schemas.ts` | Add `grep: z.string().optional()` to `SAPReadSchema` and `SAPReadSchemaBtp`. |
| `src/handlers/tools.ts` | Add `grep` property to the SAPRead `inputSchema`; mention grep in `SAPREAD_DESC_ONPREM`/`SAPREAD_DESC_BTP`. |
| `src/adt/client.ts` | Add `getClassInclude(name, include)` — RAW section source (no `=== inc ===` wrapper) so section-scoped CLAS grep stays line-accurate. |
| `tests/unit/context/grep.test.ts` | **NEW** unit tests for `grepSource` (pure). |
| `tests/unit/handlers/{intent,schemas,tools}.test.ts` | Handler grep paths + three-file schema/tools sync tests. |
| `tests/e2e/sapread-grep.e2e.test.ts` | **NEW** E2E: grep an existing persistent fixture class via the MCP stack. |
| `docs_page/tools.md`, `CLAUDE.md`, `README.md`, `docs/compare/00-feature-matrix.md`, `docs_page/roadmap.md` | Documentation. |

### Design Principles

- `grep.ts` is pure (string in, string out) — no `undici`, no client, no `MethodInfo` import coupling. It accepts a minimal local `MethodRange` interface (`{ name, containingClass, startLine, endLine }`); the handler maps `MethodInfo` → `MethodRange`.
- Reuse `containingClass`; do NOT add a `className` field to `MethodInfo`.
- `grep` runs AFTER the existing `cachedGet`, so the source cache + ETag revalidation still apply; grep only transforms the returned source. Use `textResult`/`errorResult` for grep output (not `cachedTextResult`) since the result is a derived view.
- No new scope or safety check — `grep` reuses the `read` scope of the underlying read. Do not touch `src/authz/policy.ts`.
- Regex flags are `gim` (case-insensitive; ABAP is case-insensitive). Do not mutate the caller's `pattern` string.

## Development Approach

- Build the pure helper + its tests first (Task 1), so wiring tasks can rely on a tested contract.
- Schema/tools contract (Task 2) before handler wiring (Tasks 3–4), since the handler reads `args.grep` which must pass Zod validation first.
- Every code task ends by running `npm test`. Keep the three-file tool-schema sync (tools.ts ↔ schemas.ts ↔ intent.ts) intact.
- Match the existing code style (Biome: 2-space, single quotes, semicolons, `.js` import extensions).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Create the pure `grepSource` helper + unit tests

**Files:**
- Create: `src/context/grep.ts`
- Create: `tests/unit/context/grep.test.ts`

This is the foundation: a pure, I/O-free function that searches source text and formats matches. It mirrors `src/context/method-surgery.ts` (same directory, pure, unit-tested). No other task should contain matching logic.

- [ ] Create `src/context/grep.ts` exporting:
  - `export interface MethodRange { name: string; containingClass?: string; startLine: number; endLine: number; }` (1-based, inclusive line range)
  - `export interface GrepOptions { methods?: MethodRange[]; contextLines?: number; /* default 3 */ maxMatches?: number; /* default 100 */ }`
  - `export interface GrepResult { matchCount: number; output: string; invalidPattern: boolean; }`
  - `export function grepSource(source: string, pattern: string, opts?: GrepOptions): GrepResult`
- [ ] Behavior:
  - Split source on `\n` (normalize `\r\n` → `\n` first). A line matches if the regex tests true; reset `regex.lastIndex` between lines (or use a fresh non-global test) so the global flag doesn't skip lines.
  - **Pattern resolution** (compute an `effectivePattern` local; never mutate the caller's `pattern` argument): (1) try `new RegExp(pattern, 'gim')`; if it compiles and matches ≥1 line, use it. (2) If it compiles but matches zero AND contains a regex metacharacter (`/[.*+?^${}()|[\]\\]/`), retry escaped-as-literal; if the literal matches ≥1, use it. (3) If `new RegExp(pattern)` THROWS (invalid regex — e.g. an LLM sent `read_entities(`), fall back to the escaped literal; if that matches ≥1, use it (`invalidPattern:false`). (4) Only if an invalid pattern ALSO has zero literal matches → `{ matchCount: 0, invalidPattern: true, output: 'Invalid regex pattern: "<pattern>" (and no literal match). <error message>' }`. The header/display use `effectivePattern`.
  - Zero matches with a valid pattern → `{ matchCount: 0, invalidPattern: false, output: 'No matches found for /<effectivePattern>/i.' }`.
  - Expand each matching line to ±`contextLines`; collect the union of visible line indexes; sort ascending.
  - Build output: header `"<N> match(es) for /<effectivePattern>/i:"`; for each visible line, `>` if it is itself a match else ` `, then the 1-based line number right-padded to width 5, `: `, then the line text. Insert `--` between non-contiguous visible blocks.
  - If `opts.methods` is provided, before a line whose owning method (first `MethodRange` where `startLine <= line1 <= endLine`, `startLine > 0`) differs from the previous, emit a `[<containingClass||name>=><name>]` label line (use `containingClass` when present, else fall back to a bare method label). This is what makes CLAS output method-aware.
  - Cap displayed matches at `maxMatches` (default 100); when truncated, append `"\n... showing first <max> of <N> matches. Narrow your pattern."`. `matchCount` always reflects the true total.
- [ ] Add unit tests (~14 tests) in `tests/unit/context/grep.test.ts`: basic single match; multiple matches with context; `>` marker only on match lines; line numbers are 1-based; non-contiguous blocks separated by `--`; zero-match message (valid pattern); a malformed regex that matches nothing literally sets `invalidPattern:true`; a malformed regex that DOES appear literally (e.g. `read_entities(`) matches via literal fallback with `invalidPattern:false`; a valid regex with metachars that matches zero retries as literal (e.g. `a.b` finds `a.b`); case-insensitivity (`SELECT` matches `select`); `\r\n` source normalized; truncation past `maxMatches` with note and correct `matchCount`; method annotation emits `[ltcl_x=>setup]` from a `MethodRange[]`; multi-class annotation switches label between two `containingClass` values; the caller's `pattern` argument is not mutated (the literal fallback uses a separate `effectivePattern`, and the header reflects it).
- [ ] Run `npm test` — all tests must pass.

### Task 2: Add `grep` to the SAPRead tool contract (schemas + tools + sync tests)

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

ARC-1 requires the three-file tool-schema sync: a property must exist in `tools.ts` (JSON Schema for LLMs), `schemas.ts` (Zod), and be consumed in `intent.ts` (Task 3/4). This task does the schema + tools half so the handler can read a validated `args.grep`.

- [ ] In `src/handlers/schemas.ts`, add `grep: z.string().optional(),` to BOTH `SAPReadSchema` (~line 164, near the existing `method`/`include` fields) and `SAPReadSchemaBtp` (~line 182).
- [ ] In `src/handlers/tools.ts`, add a `grep` property to the SAPRead `inputSchema` (near the existing `method`/`format` properties, ~line 511): `grep: { type: 'string', description: 'Regex pattern to search within the object source. Returns matching lines with 1-based line numbers and ±3 context lines instead of full source. For CLAS, matches are annotated with the owning class/method (combine with include= to scope a section; do NOT combine with method=). Works for source-bearing types (PROG, CLAS, INTF, FUNC, INCL, DDLS, DCLS, BDEF, SRVD).' }`.
- [ ] In `src/handlers/tools.ts`, append a one-sentence mention of `grep` to `SAPREAD_DESC_ONPREM` and `SAPREAD_DESC_BTP` (e.g. "Use grep=\"<regex>\" to search within an object's source and return only matching lines + context (token-efficient).").
- [ ] Add unit tests: in `tests/unit/handlers/schemas.test.ts` (~2 tests) assert `SAPReadSchema` and `SAPReadSchemaBtp` accept a `grep` string and reject a non-string; in `tests/unit/handlers/tools.test.ts` (~2 tests) assert the SAPRead tool `inputSchema.properties.grep` exists with `type: 'string'` for both onprem and BTP tool definitions.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Wire `grep` into non-CLAS source reads + handler tests

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Wire the helper into the simple source-bearing cases. Each of these cases currently fetches `{ source }` via `cachedGet` and returns `cachedTextResult(...)`. After the source is fetched, branch on `args.grep`.

- [ ] At the top of `src/handlers/intent.ts`, import `grepSource` (and the `MethodRange` type if needed later) from `'../context/grep.js'` (note the `.js` ESM extension).
- [ ] In `handleSAPRead`, for cases `PROG` (~1501), `INTF` (~1544), `FUNC` (~1550), `INCL` (~1610), `DDLS` (~1616), `DCLS` (~1636), `BDEF` (~1642), `SRVD` (~1648): after the `cachedGet(...)` that yields `source`, insert before the existing return:
  ```ts
  if (args.grep) {
    const g = grepSource(source, String(args.grep));
    return g.invalidPattern ? errorResult(g.output) : textResult(g.output);
  }
  ```
  (For `DDLS`, grep the `ddlSource`; place the branch after the existing `include === 'elements'` check so `grep` and `elements` don't collide — `grep` wins only when `args.include` is not `elements`.)
- [ ] Add unit tests (~4 tests) in `tests/unit/handlers/intent.test.ts` following the existing `vi.mock('undici', ...)` + `mockResponse()` pattern: `SAPRead(type=PROG, grep=...)` returns only matching lines (assert the header `match(es) for` and that a non-matching line is absent); `grep` with no match returns the "No matches" text; `grep` with an invalid regex returns an error result; `grep` on another type (e.g. `BDEF` or `INTF`) works. Reuse existing source fixtures or inline source strings in the mock response.
- [ ] Run `npm test` — all tests must pass.

### Task 4: CLAS grep with method annotation + `grep`+`method` guard

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/adt/client.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

CLAS grep must annotate matches with the owning class/method AND stay line-accurate. The existing `getClass(name, include)` path wraps each section in a `=== <inc> ===\n` header (verified on `origin/main`, `client.ts` ~line 35), which would offset line numbers and pollute output — so section-scoped grep needs a RAW include fetch. The no-`include` `getClass(name)` path already returns raw `/source/main`, so main-source grep is line-accurate as-is. The case already uses `listMethods` + `mapSapReleaseToAbaplintVersion` in its `method="*"` branch.

- [ ] In `src/adt/client.ts`, add a raw single-include reader next to `getClass` (~line 274), mirroring its `checkOperation` + `fetchSource` pattern:
  ```ts
  /** Raw source of a single class include (no '=== inc ===' wrapper) — for line-accurate grep. */
  async getClassInclude(name: string, include: string, opts?: SourceReadOptions): Promise<SourceReadResult> {
    checkOperation(this.safety, OperationType.Read, 'GetClassInclude');
    return this.fetchSource(
      `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}/includes/${encodeURIComponent(include)}`,
      opts,
    );
  }
  ```
- [ ] In the `CLAS` case (~1507) of `handleSAPRead`, add grep handling BEFORE the existing `method`/`structured`/`include` branches:
  - If `args.grep && args.method` → `return errorResult('Do not combine grep with method. Use grep to find code, then method="<name>" to read the full method.')`.
  - If `args.grep`: obtain RAW source — when `args.include` is set, `(await client.getClassInclude(name, String(args.include), { version: effectiveVersion })).source`; otherwise reuse the `cachedGet('CLAS', name, ...)` source (the no-include `getClass` path is already raw). Compute `abaplintVer` as the `method="*"` path does, then `const listing = listMethods(source, name, abaplintVer);`, map `listing.methods` → `MethodRange[]` (`{ name, containingClass, startLine, endLine }`), then `const g = grepSource(source, String(args.grep), { methods: listing.success ? ranges : undefined });`. Return `g.invalidPattern ? errorResult(g.output) : textResult(\`[${name} section=${args.include ?? 'main'}]\n${g.output}\`)`.
- [ ] Add unit tests: in `tests/unit/adt/client.test.ts` (~1 test) assert `getClassInclude` GETs `/sap/bc/adt/oo/classes/<name>/includes/<inc>` and returns the raw body with NO `=== ===` wrapper (use `vi.mock('undici')` + `mockResponse()`). In `tests/unit/handlers/intent.test.ts` (~3 tests): `SAPRead(type=CLAS, grep="select")` returns matches annotated with a `=>` method label (mock `getClass` to return a small class whose method contains the match); `SAPRead(type=CLAS, grep=..., method=...)` returns the combine-error; `SAPRead(type=CLAS, grep=..., include="testclasses")` greps the raw section (mock `getClassInclude`).
- [ ] Run `npm test` — all tests must pass.

### Task 5: E2E test against a persistent fixture class

**Files:**
- Modify: `tests/e2e/sapread-grep.e2e.test.ts` (create)
- Reference: `tests/e2e/fixtures.ts`, `tests/e2e/helpers.ts`

`grep` is a new MCP tool-parameter behavior, so per the test policy it warrants an E2E test exercising the full MCP JSON-RPC stack. Use an EXISTING persistent class fixture (check `PERSISTENT_OBJECTS` in `tests/e2e/fixtures.ts` for a class with known content) — do not create a new SAP object unless none is suitable.

- [ ] Create `tests/e2e/sapread-grep.e2e.test.ts` using `connectClient()`, `callTool()`, `expectToolSuccess()` from `tests/e2e/helpers.ts`. Pick a persistent CLAS fixture from `fixtures.ts`; assert that `SAPRead(type="CLAS", name=<fixture>, grep="<token known to be in the fixture source>")` succeeds, the output contains `match(es) for`, contains the known token, and is shorter than a full `SAPRead(type="CLAS", name=<fixture>)` of the same object (token-efficiency assertion). If no persistent class fixture exposes stable greppable content, add a minimal one to `PERSISTENT_OBJECTS` (+ an ABAP source file in `tests/fixtures/abap/`) per the fixture conventions.
- [ ] Guard server/fixture availability with `requireOrSkip(ctx, value, reason)` from `tests/helpers/skip-policy.ts` (use the appropriate `SkipReason` constant) — never `if (!x) return;`.
- [ ] Run `npm test` — all UNIT tests must still pass (E2E runs separately via `npm run test:e2e`; do not gate this task on a live server).

### Task 6: Documentation

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs_page/roadmap.md`

Update all affected artifacts so the feature is discoverable. (Skills in `.claude/commands/*.md` need no change — grep is a parameter, not a workflow.)

- [ ] `docs_page/tools.md`: add a `grep` row to the SAPRead Parameters table (~after line 31) and one or two usage examples in the SAPRead examples section (e.g. `SAPRead(type="CLAS", name="ZCL_ORDER", grep="RETURNING")`, `SAPRead(type="PROG", name="ZREPORT", grep="SELECT.*FROM")`).
- [ ] `CLAUDE.md`: add `│   ├── grep.ts                      # Regex match + ±context over source (SAPRead grep)` to the `src/context/` block of the codebase-structure tree (after the `method-surgery.ts` entry); add a "Key Files for Common Tasks" row: `| Add grep regex search to a source read | src/context/grep.ts (pure helper), src/handlers/intent.ts (handleSAPRead grep branch), src/handlers/{schemas,tools}.ts (grep param), tests/unit/context/grep.test.ts |`.
- [ ] `README.md`: extend the SAPRead description (~line 83) to mention grep-based regex search as a token-efficiency feature.
- [ ] `docs/compare/00-feature-matrix.md`: add a row under the ABAP Read Operations section (~after line 142) for "Grep/regex search within source" and refresh the "Last updated" line (~line 5).
- [ ] `docs_page/roadmap.md`: note the grep parameter under completed/quick-wins and refresh the "Last Updated" line (~line 3).
- [ ] Run `npm test` — all tests must pass (docs-only edits should not affect tests; confirm nothing broke).

### Task 7: Final verification

- [ ] Run full unit suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors (Biome).
- [ ] Grep the codebase to confirm the three-file sync: `grep -rn "grep" src/handlers/{schemas,tools,intent}.ts` shows the param in all three.
- [ ] Confirm `src/context/grep.ts` has no `undici`/client/`MethodInfo` import (purity check) and that CLAS annotation uses `containingClass` (no new `className` field was added to `MethodInfo`).
- [ ] Sanity-check the build: `npm run build` succeeds.
- [ ] Move this plan to `docs/plans/completed/`.

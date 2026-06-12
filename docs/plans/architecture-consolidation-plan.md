# Architecture Consolidation Plan (v2)

**Status:** Proposed — v2 for owner review
**Date:** 2026-06-11 (v2, same day as v1)
**Audience:** An LLM coding agent executing this plan, plus human review.
**Scope:** PR 1 = the complete code refactor (tests-first, single PR, no behavior change). PR 2 = knowledge/docs architecture — **deferred; the owner will specify it in detail separately.**

### Changes from v1 (what the review asked for)

1. **Tests-first, explicitly.** Stage A builds a characterization safety net (snapshot of the LLM-visible tool surface, schema sync tests, dispatch coverage, export-surface lock, coverage baseline) that must pass against the **untouched monolith** before any code moves. Verified green baseline recorded below.
2. **One PR for all code work.** v1's Phases 0+1+2 plus the valuable backlog items are now Stages A–F of a single PR (granular commits kept for review/bisect). The docs/knowledge overhaul (v1 Phase 3 — CLAUDE.md/AGENTS.md, the rules for future LLM sessions) is **PR 2, deferred, owner-specified**.
3. **Corrected measurements.** v1's per-handler sizes counted "start of handler N → start of handler N+1", overcounting handlers with helpers between them. Real function boundaries were measured for v2. Consequence: *handleSAPLint is 90 lines, not 1,387* (splitting it is pointless) and *handleSAPWrite is 1,827 lines in one function* (splitting it is the single highest-value move).
4. **Backlog triage done in detail** (§6): B1 and B5 pulled into PR 1 with concrete steps; B3 partially pulled in as a test; B2 dropped with evidence; B4 → PR 2; B6 stays a separate `fix:` PR.

---

## 1. Why now — measured facts (re-verified 2026-06-11)

| Metric | Value |
|---|---|
| Total `src/` | 41,286 lines / 88 files (~19,900 on 2026-04-15 — **doubled in 8 weeks**) |
| `src/handlers/intent.ts` | **8,199 lines** — 20% of all source in one file |
| `tests/unit/handlers/intent.test.ts` | **15,135 lines** — 22% of all test code in one file |
| `src/handlers/tools.ts` / `schemas.ts` | 1,718 / 1,052 lines — **type lists hand-duplicated in both** |
| Root `CLAUDE.md` | ~56 KB ≈ ~14K tokens auto-loaded into every LLM session |
| Root `AGENTS.md` | Stale fork of an old CLAUDE.md (missing ~35 config vars) — two diverging agent-guidance sources |
| **Unit test baseline** | **105 files / 3,583 tests / all green / ~14 s** (`npm test`, recorded 2026-06-11) |

**True handler sizes** (function-boundary-accurate, intent.ts as of 2026-06-11):

| Function | Lines (span) | | Function | Lines (span) |
|---|---|---|---|---|
| handleToolCall | 290 (1085–1374) | | handleSAPActivate | 261 (5914–6174) |
| handleSAPRead | 583 (1488–2070) | | handleSAPNavigate | 210 (6288–6497) |
| handleSAPSearch | 166 (2071–2236) | | handleSAPDiagnose | 231 (6498–6728) |
| handleSAPQuery | 49 (2432–2480) | | handleSAPGit | 206 (6836–7041) |
| handleSAPLint | **90** (2481–2570) | | handleSAPTransport | 304 (7042–7345) |
| handleServerDrivenObjectWrite | 92 (3776–3867) | | handleSAPContext | 347 (7356–7702) |
| **handleSAPWrite** | **1,827** (3868–5694) | | handleSAPManage | 415 (7761–8175) |

Handlers ≈ 5,071 lines; the remaining ~3,100 lines are ~90 helpers and ~30 constant tables interleaved between them. `handleSAPWrite` alone is 22% of the file and is also the highest-churn function (most feature work touches SAPWrite) — it is the merge-conflict magnet.

### What is already healthy — do NOT restructure

- Layering is sound: transport → auth → `handleToolCall` → adt client → http → SAP. **No circular imports in `src/`** (verified).
- `src/adt/` specialty modules are well-sized and cohesive; `client.ts` (1,461) and `xml-parser.ts` (1,513) are large but tolerable.
- Safety system, scope policy + `validate:policy` CI gate, audit, release automation, test infrastructure: solid. Leave alone.

### The problems PR 1 fixes

1. **P1 — Handler monolith** (file level): dispatcher + 12 handlers + ~90 helpers + ~30 constant tables + mutable module state in one 8,199-line file.
2. **P2 — Function monolith** (new in v2): `handleSAPWrite` is 1,827 lines in a single function — 13 `case` bodies in one `switch (action)`.
3. **P3 — Triple-maintained type lists**: `SAPREAD_TYPES_*`, `SAPWRITE_TYPES_*`, `SAPCONTEXT_TYPES_*` duplicated in `tools.ts` AND `schemas.ts`, with an implicit third copy as `case` labels in intent.ts and a fourth in the hand-written "Unsupported type" error message. Only policy drift is CI-checked today.
4. **P4 — Test monolith**: intent.test.ts mirrors P1.
5. **P5 — No regrowth brake**: nothing stops the next 8K-line file.

(The knowledge monolith / AGENTS.md drift problem is real but deliberately deferred to PR 2.)

### Non-goals

- **Zero behavior change, zero LLM-visible change.** The MCP tool definitions JSON must be byte-identical (Stage A1 snapshot proves it). No schema, description, error-text, or protocol changes.
- No tool renames, no request-flow / safety / scope semantics changes, no `src/adt/` restructuring, no test-infrastructure changes.
- No docs rewrite in PR 1 (PR 2). PR 1 will leave some doc references to `intent.ts` internals temporarily stale — acceptable because the file continues to exist as a barrel; PR 2 sweeps them.
- No wholesale Zod→JSON-Schema generation (rejected with rationale in §6 B3).

---

## 2. Target end-state of PR 1 (code only)

```
src/handlers/
├── intent.ts                 # ≤60-line deprecated BARREL re-exporting the 21-name public surface
├── dispatch.ts               # handleToolCall: rate-limit → scope → deny → Zod → handler map → audit
├── tool-registry.ts          # SINGLE source of type lists (read/write/context × onprem/btp)
├── read.ts                   # handleSAPRead + its version/draft/BTP helpers        (~700)
├── search.ts                 # handleSAPSearch + transliterate/field-name helpers  (~250)
├── query.ts                  # handleSAPQuery                                      (~60)
├── lint.ts                   # handleSAPLint                                       (~120)
├── activate.ts               # handleSAPActivate + activation formatting           (~350)
├── navigate.ts / diagnose.ts / git.ts / transport.ts / context.ts / manage.ts
├── write/
│   ├── index.ts              # handleSAPWrite: prologue + guards + action dispatch (~200)
│   ├── create.ts             # create + batch_create                               (~720)
│   ├── update-delete.ts      # update + delete                                     (~220)
│   ├── class-surgery.ts      # 6 method/definition surgery actions                 (~470)
│   ├── rap.ts                # scaffold_rap_handlers + generate_behavior_impl      (~270)
│   └── server-driven.ts      # handleServerDrivenObjectWrite                       (~100)
├── object-types.ts           # SLASH_TYPE_MAP, KNOWN_BASE_TYPES, normalize*, URL builders (~450)
├── shared.ts                 # textResult/errorResult, formatErrorForLLM tree, hints (~850)
├── cds-hints.ts              # CDS impact constants + ordering/hint helpers         (~300)
├── write-helpers.ts          # pre-write lint/syntax/RAP, metadata write, buildCreateXml (~750)
├── query-helpers.ts          # SAPQuery IN-list chunking + SQL literal parsing      (~200)
├── feature-cache.ts          # the ONLY home of cachedFeatures/cachedDiscovery      (~50)
├── tools.ts / schemas.ts     # unchanged roles; type lists imported from tool-registry.ts

tests/unit/handlers/
├── tool-definitions-snapshot.test.ts   # NEW (Stage A1) — locks LLM-visible surface
├── registry-sync.test.ts               # NEW (Stage A4) — type-list drift + dispatch coverage
├── schema-key-sync.test.ts             # NEW (Stage A5) — Zod keys ↔ JSON-Schema keys per tool
├── barrel-surface.test.ts              # NEW (Stage A2) — locks intent.ts exports
├── read.test.ts … manage.test.ts, write.test.ts, dispatch.test.ts   # intent.test.ts split
└── test-helpers.ts                     # shared mocks extracted from intent.test.ts

scripts/ci/check-file-sizes.mjs         # NEW regrowth ratchet, wired into CI
```

No file in `src/handlers/` exceeds ~900 lines after PR 1 (tools.ts 1,718 and schemas.ts 1,052 keep their current size — their *content* is the product, and they shrink slightly via the registry extraction).

---

## 3. PR 1 — stages and commits

> Single PR, **one stage = one or more small commits**, every commit leaves the tree green (`npm test && npm run typecheck` minimum; the suite runs in ~14 s, so run it after *every* extraction). Commit prefixes: `test:` (Stage A tests), `refactor(handlers):` (moves), `chore(ci):` (ratchet). **Never `feat:`/`fix:`** — release-please must not cut a release. If the PR is squash-merged, the PR title itself must be `refactor(handlers): …`.

### Stage A — Test safety net (BEFORE any code moves)

Every Stage-A test must pass against the **current monolith first** — that is what makes them characterization tests rather than aspirations. Order within A matters (A1/A2 lock the status quo before A3 touches code).

**A1 — Tool-definition snapshots** (`tests/unit/handlers/tool-definitions-snapshot.test.ts`)
The single most important artifact of the whole plan: it freezes the bytes LLM clients see.
- Call the real `getToolDefinitions(config, textSearchAvailable, resolvedFeatures)` (signature: [tools.ts:572](../../src/handlers/tools.ts)) and write each result via `expect(json).toMatchFileSnapshot(...)` to `tests/fixtures/tool-definitions/<variant>.json` (pretty-printed, so any later diff is human-reviewable).
- Matrix (~9 variants): `{onprem, btp} × {standard} × {textSearchAvailable: true, false}` (4) + `{onprem, btp} × hyperfocused` (2) + `onprem/standard` with `allowedPackages: []` (unrestricted — exercises the package-note injection at tools.ts:716) + `onprem/standard` with resolvedFeatures git **on** vs **off** (SAPGit is feature-gated) (2).
- Build configs from a minimal `ServerConfig` factory inside the test; do not read `.env`.
- These snapshots must show **zero diff** at the end of every later stage.

**A2 — Barrel-surface lock** (`tests/unit/handlers/barrel-surface.test.ts`)
`import * as intent from '../../../src/handlers/intent.js'` and assert `Object.keys(intent).sort()` equals exactly the current 21-name surface: `ToolResult` (type-only, excluded from runtime keys), `TOOL_SCOPES`, `hasRequiredScope`, `transliterateQuery`, `looksLikeFieldName`, `handleToolCall`, `warnCdsReservedKeywords`, `buildCreateXml`, `stripFmParamCommentBlock`, `SLASH_TYPE_MAP`, `SLASH_TYPE_EVIDENCE`, `KNOWN_BASE_TYPES`, `normalizeObjectType`, `stripLlmEmptyValues`, `normalizeTypeArgsForValidation`, `objectBasePath`, `resetCachedFeatures`, `setCachedFeatures`, `getCachedFeatures`, `setCachedDiscovery`, `getCachedDiscovery`. (Generate the expected list from the actual module on first write, then hard-code it.) This guarantees the Stage-B barrel can't silently lose an export that `src/cli.ts`, `src/server/server.ts`, or the ~10 importing test files rely on.

**A3 — `tool-registry.ts` (single source of type lists)**
- **Pre-check (STOP condition):** assert programmatically that the tools.ts copies (lines ~38–189) and schemas.ts copies (lines ~43–132, ~371–428, ~917–918) of `SAPREAD_TYPES_ONPREM/BTP`, `SAPWRITE_TYPES_ONPREM/BTP`, `SAPCONTEXT_TYPES_ONPREM/BTP` are element-identical **today**. If any pair differs → stop, report the diff to the owner; that is a live bug to fix in a separate `fix:` PR first.
- Create `src/handlers/tool-registry.ts` exporting the six arrays `as const` (plus derived union types). `tools.ts` and `schemas.ts` import from it; `schemas.ts` keeps re-exporting any names tests already import (check `grep -rn "SAPWRITE_TYPES\|SAPREAD_TYPES" tests/`).
- **Update `scripts/validate-action-policy.ts`:** read it first — if it extracts `z.enum()` lists from schemas.ts textually, the indirection may break it; convert it to import the arrays from `tool-registry.ts` directly (it runs under tsx). `npm run validate:policy` green before AND after.
- A1 snapshots must be unchanged after A3 — first proof the net works.

**A4 — Registry drift + dispatch coverage** (`tests/unit/handlers/registry-sync.test.ts`)
- BTP lists ⊆ ONPREM lists (read/write/context).
- JSON-Schema enums inside `getToolDefinitions()` output ≡ registry arrays (both btp variants).
- Zod enums ≡ registry arrays.
- **Dispatch coverage:** for every type in `SAPREAD_TYPES_ONPREM`, call the real `handleToolCall(mockClient, permissiveConfig, 'SAPRead', argsForType)` with undici mocked to reject with a sentinel, and assert the result is **not** the "Unsupported type" default-case message. Because Zod validation runs *before* dispatch, the test keeps a per-type minimal-args table and **self-checks it**: for each type, first assert `getToolSchema('SAPRead', false).safeParse(args).success === true` (forces the table to stay valid), then dispatch. Use a config with data-preview/SQL enabled so gated types reach their case. `resetCachedFeatures()` in `beforeEach`. Repeat the same pattern for `SAPWRITE_TYPES_ONPREM` against action `create` (assert not-unsupported; the mocked HTTP sentinel error is fine).

**A5 — Zod ↔ JSON-Schema field-key sync** (`tests/unit/handlers/schema-key-sync.test.ts`) *(pulled from backlog B3)*
For every tool × {onprem, btp}: compare `Object.keys(jsonSchema.properties)` from `getToolDefinitions()` with the Zod object's shape keys from `getToolSchema()`. Maintain an explicit, commented allowlist for intentional mismatches discovered on first run (if any); anything outside the allowlist fails. This catches the "added a field to Zod, forgot tools.ts (field invisible to LLMs)" bug class — the highest-value slice of B3 at zero risk.

**A6 — Coverage + count baseline (recorded, not a new gate)**
- Record in the PR description: unit test count (**baseline 2026-06-11: 105 files / 3,583 tests**), and line coverage for `src/handlers/*` from the repo's coverage script (check package.json for the exact script name, e.g. `test:coverage`). Re-measure at Stage F; coverage must not drop by more than ~1 point and count must be ≥ baseline + the new Stage-A tests.

**A7 — File-size ratchet** (`scripts/ci/check-file-sizes.mjs` + `chore(ci)` wiring)
- Budget map inline in the script; **default budget 1,500 lines** for unlisted `src/**/*.ts`, **3,000** for unlisted test files; explicit seed entries at *current size + ~100* for today's oversized files (intent.ts 8,300; tools.ts 1,800; intent.test.ts 15,300; xml-parser.ts 1,600; client.ts 1,550; …generate the seed list from `find src tests -name '*.ts' | xargs wc -l` at execution time).
- Clear failure message: "<file> is N lines, budget B — split it (see docs/plans/architecture-consolidation-plan.md) or consciously raise its budget in this script."
- Add `"check:sizes"` npm script; call it in `.github/workflows/test.yml` next to `validate:policy`. **Budgets are lowered in the same commit that shrinks a file** (end of Stages B/D/E).

**A8 — Generate the SAPRead default-case error from the registry**
Replace the hand-maintained ~32-type list in handleSAPRead's `default:` branch (~intent.ts:2062) with a string built from the registry arrays. Verify the wording stays identical for the current type set (A1 snapshots don't cover error strings, so eyeball the diff; intent.test.ts asserts on this message — if its assertion is wording-sensitive, keep wording identical).

### Stage B — Split intent.ts along existing function boundaries (move-only)

**Prime directive: MOVE code verbatim.** No renames, no signature changes, no logic edits, no dead-code deletion. Every hunk = "moved from intent.ts". After every numbered step: `npm test && npm run typecheck` (~14 s + ~10 s).

Extraction order (leaf modules first, then handlers smallest-first, dispatch last):

1. `object-types.ts` — SLASH_TYPE_MAP, SLASH_TYPE_EVIDENCE, KNOWN_BASE_TYPES, TABL_WRITE_SUBTYPES, SAPWRITE_TABL_ALIAS, EMPTY_STRING_MEANINGFUL_FIELDS, normalizeObjectType, normalizeWriteObjectType, canonicalTablType, stripLlmEmptyValues, normalizeTypeArgsForValidation, objectBasePath, objectUrlForType, objectUrlForTypeRaw, sourceUrlForType, inferObjectType, classIncludeUrl, normalizeClassWriteInclude, detectLocalHandlerInclude, stripIncludeHeader. (Pure utilities, no project-internal imports.)
2. `feature-cache.ts` — the `cachedFeatures`/`cachedDiscovery` module state + its five accessors. **This mutable state must live in exactly one module**; all later modules import the getters. Highest-subtlety extraction → run the full suite plus `npx vitest run tests/unit/handlers/intent.test.ts` immediately after.
3. `shared.ts` — textResult, errorResult, formatErrorForLLM and its private tree (buildBaseErrorMessage, enrichWithSapDetails, classifyError, getWriteInfrastructureHint, getTransportHint, getBehaviorPoolSaveFailureHint, buildDiagnosticsNotFoundHint, buildAuditResultPreview, isDeleteDependencyError), DDIC_SAVE_HINT_TYPES, DDIC_POST_SAVE_CHECK_TYPES.
4. `cds-hints.ts` — all CDS_* constants + the 13 CDS bucket/ordering/hint helpers + guardCdsSyntax, warnCdsReservedKeywords, CDS_RESERVED_KEYWORDS.
5. `query-helpers.ts` — SAPQUERY_IN_LIST_CHUNK_SIZE + the 11 SQL-parsing/chunking helpers + runChunkedSapQuery.
6. `write-helpers.ts` — content-type constants, isMetadataWriteType/needsVendorContentType/createContentTypeForType/dtelNeedsPostCreateUpdate/vendorContentTypeForType, toBoolean, getMetadataWriteProperties, normalizeSrvbCategory, mergeMetadataWriteProperties, buildCreateXml, escapeXml, stripFmParamCommentBlock, buildLintConfigOptions, runPreWriteLint, runPreWriteSyntaxCheck, runRapPreflightValidation, mergePreWriteWarnings, SYNTAX_CHECKABLE_TYPES, NAME_CASE_GUARD_ACTIONS, enforceAllowedPackageForObjectUrl, plus `handleServerDrivenObjectWrite` (92 lines; moves again to `write/server-driven.ts` in Stage D).
7. Handlers, one commit each, smallest-first: `query.ts` (49) → `lint.ts` (90) → `search.ts` (166 + transliterateQuery/looksLikeFieldName) → `git.ts` (206 + resolveSapGitBackend/loadAbapGitRepo) → `navigate.ts` (210) → `diagnose.ts` (231 + the 5 dump-section helpers) → `activate.ts` (261 + the 4 activation-formatting helpers) → `transport.ts` (304 + parseSiblingMaxCandidates + constants) → `context.ts` (347 + buildCdsUpstream/isLikelyCdsViewName) → `manage.ts` (415) → `read.ts` (583 + resolveVersionAndDraftInfo, sourceVersionWarning, isBtpSystem, isTablesEndpointAvailable, inactiveTypeMatches, BTP_HINTS, VERSIONED_SOURCE_READ_TYPES, TABL_DT_WRITE_UNAVAILABLE_HINT) → `write.ts` (handleSAPWrite verbatim, 1,827 lines — Stage D splits it).
8. `dispatch.ts` — handleToolCall, ToolResult, TOOL_SCOPES, hasRequiredScope. Replace the 12-arm `switch` with a handler map (`const HANDLERS: Record<string, ToolHandler>`); keep the `case 'SAP'` hyperfocused re-entry behavior exactly as-is.
9. Reduce `intent.ts` to a barrel re-exporting exactly the A2-locked surface, with an `@deprecated — import from the specific handlers/* module` comment. A2's test now pins it.
10. Lower ratchet budgets for intent.ts (→60) in the same commit.

**Stage-B gate:** full suite green with the 15K-line intent.test.ts **unmodified**; A1 snapshots zero-diff; `npm run lint && npm run validate:policy && npm run build` green.

### Stage C — Split intent.test.ts along the same seams (move-only)

1. Extract shared scaffolding (mock client/config factories, undici `mockFetch` wiring, repeated `beforeEach`) into `tests/unit/handlers/test-helpers.ts`.
2. Relocate each per-tool `describe` block to `tests/unit/handlers/<tool>.test.ts` (write-related blocks → `write.test.ts`); dispatch-level tests (scope, rate-limit, Zod rejection, normalization, audit) → `dispatch.test.ts`; pure-helper tests → `object-types.test.ts` / `write-helpers.test.ts` / etc. New files may import from the new modules directly (preferred) — the barrel keeps old-style imports working during the move.
3. **Do not rewrite assertions.** Delete intent.test.ts only when empty.
4. **Count parity gate:** total tests ≥ **3,583** + Stage-A additions (capture `npx vitest run --reporter=json` → `numTotalTests` before and after; paste both numbers into the PR description).
5. Lower the test-file ratchet budgets.

Doing C before D is deliberate: Stage D then iterates against a focused `write.test.ts` (`npx vitest run tests/unit/handlers/write.test.ts`) instead of the 15K-line file.

### Stage D — Split handleSAPWrite (backlog B1, pulled in — the only stage that creates NEW function boundaries)

This is the one stage that goes beyond verbatim moves, so it gets the strictest protocol. `handleSAPWrite` is one 1,827-line function: a ~164-line prologue (arg extraction, name-case guard, server-driven routing, TABL create routing) followed by `switch (action)` whose case bodies are block-scoped and `return`-terminated. Measured case map (relative offsets within the function as of today — **locate by `case '<action>'` label, not by line number**, since Stages B–C shifted everything):

| `case` | Rel. span | ~Lines | Target module |
|---|---|---|---|
| (prologue + guards + pre-switch create/TABL routing) | 1–164 | 164 | `write/index.ts` |
| `'update'` | 165–340 | 176 | `write/update-delete.ts` |
| `'create'` | 341–632 | 292 | `write/create.ts` |
| `'edit_method'` | 633–756 | 124 | `write/class-surgery.ts` |
| `'edit_class_definition'` | 757–844 | 88 | `write/class-surgery.ts` |
| `'edit_method_signature'` | 845–897 | 53 | `write/class-surgery.ts` |
| `'add_method'` | 898–981 | 84 | `write/class-surgery.ts` |
| `'delete_method'` | 982–1029 | 48 | `write/class-surgery.ts` |
| `'change_method_visibility'` | 1030–1102 | 73 | `write/class-surgery.ts` |
| `'scaffold_rap_handlers'` | 1103–1329 | 227 | `write/rap.ts` |
| `'generate_behavior_implementation'` | 1330–1369 | 40 | `write/rap.ts` |
| `'delete'` | 1370–1407 | 38 | `write/update-delete.ts` |
| `'batch_create'` | 1408–1827 | 420 | `write/create.ts` |

**D1 — In-place case extraction (one commit per case, same file):**
- Define once: `interface SapWriteContext { client; config; cachingLayer; args; action; type; name; source; hasSource; include; includeProvided; transport; lintOverride; preflightOverride; checkOverride; }` — i.e. exactly the prologue locals plus the handler parameters.
- For each case (order: smallest first — delete, generate_behavior_implementation, delete_method, edit_method_signature, change_method_visibility, add_method, edit_class_definition, edit_method, update, scaffold_rap_handlers, create, batch_create): move the case body verbatim into `async function writeAction<Name>(ctx: SapWriteContext): Promise<ToolResult>` in the same file; the case becomes `return writeActionUpdate(ctx);`.
- **Extraction preconditions per case (check before moving):** the body must end in `return`/`throw` on every path and must not write to prologue locals consumed by *other* cases or by post-switch code. If a case violates this, **leave it inline** and note it in the PR description rather than forcing it. (`batch_create` is the most likely candidate to need care — it's 420 lines and may share create-logic via local closures; if it calls into the `create` body's logic, extract that shared piece as its own function first.)
- After each case: `npx vitest run tests/unit/handlers/write.test.ts && npm run typecheck`; full suite after every third case.

**D2 — Group into `write/` submodules (verbatim moves again):**
- `write/index.ts` = prologue + guards + the now-thin switch (or action map) importing the case functions; exports `handleSAPWrite` unchanged.
- Move case functions to `write/create.ts`, `write/update-delete.ts`, `write/class-surgery.ts`, `write/rap.ts`; move `handleServerDrivenObjectWrite` from write-helpers.ts to `write/server-driven.ts`.
- Update the one import site in `dispatch.ts` (path only). Delete the now-empty `write.ts` or convert it to a one-line re-export — pick whichever keeps existing test imports compiling, then align tests.
- Full gate after D2, including A1 snapshot zero-diff. Lower ratchet budgets for the write/ files.

### Stage E — Migrate consumers off the barrel (backlog B5, pulled in)

Evidence for safety: `package.json` has **no `exports` map** and `main: dist/index.js`; the package ships as a server/CLI (`bin: arc-1, arc1, arc1-cli`), not a library — deep imports of `dist/handlers/intent.js` by third parties are unsupported-by-construction and implausible.

1. Update `src/cli.ts` and `src/server/server.ts` to import from `dispatch.ts` / specific modules.
2. Update the ~10 test files that import from `handlers/intent.js` (`tests/unit/handlers/slash-type-map.test.ts`, `intent-rate-limit.test.ts`, `tests/integration/llm-arg-normalization.integration.test.ts`, `crud-harness.ts`, `fugr-func-params`, `audit-logging`, `class-section-surgery`, `cache-warmup.slow`, `cache.integration`, plus any found by `grep -rln "handlers/intent.js"`). Integration files only get path changes — their bodies are untouched.
3. **Keep `intent.ts` itself** as the ≤60-line `@deprecated` barrel for one release cycle (free insurance for unknown deep-importers; its A2 test keeps it honest). Its deletion is the only remaining backlog item from B5.
4. Adjust A2's test location note (it now documents the compat shim) — the assertion itself stays identical.

### Stage F — Final verification (gate to mark the PR ready)

| # | Check | Expected |
|---|---|---|
| 1 | `npm test` | ≥ 3,583 + Stage-A tests, all green |
| 2 | `npm run typecheck && npm run lint` | clean |
| 3 | `npm run validate:policy` | green |
| 4 | `npm run build` | dist/ builds |
| 5 | `node scripts/ci/check-file-sizes.mjs` | green with the **lowered** post-split budgets |
| 6 | A1 snapshots | **zero diff vs. the Stage-A originals** (the headline guarantee) |
| 7 | Coverage on `src/handlers/*` | ≥ baseline − 1 pt (compare to A6 record) |
| 8 | Test-count parity | before/after numbers pasted in PR description |
| 9 | `grep -c "" src/handlers/intent.ts` | ≤ 60 |
| 10 | If `TEST_SAP_URL` is set (a4h): `npm run test:integration` | green / only policy-valid skips |
| 11 | Optional, creds + running server: `npm run test:e2e` | green / policy-valid skips |

---

## 4. PR 2 — Knowledge architecture (DEFERRED — owner will specify in detail)

> Intentionally not executable from this plan. The owner decides scope and wording after PR 1 lands. Outline retained from v1 so the intent isn't lost:

- Unify `AGENTS.md` + `CLAUDE.md` into one source of truth (today AGENTS.md is a stale fork — non-Claude agents read outdated guidance; fixing this is the most urgent piece of PR 2).
- Root agent file ≤200 lines: identity, commands, module map, invariants, a **knowledge-routing rule** (where future gotchas/recipes/research go, so the file never re-bloats).
- Nested per-directory `CLAUDE.md` files (`src/handlers/`, `src/adt/`, `src/server/`, `tests/`), each ≤60 lines.
- Move the Key-Files table to `docs/dev/task-index.md` with one-line rows; update all paths to the post-PR-1 module layout (this is also where the doc references left stale by PR 1 get swept — `grep -rn "intent.ts" CLAUDE.md AGENTS.md docs/ .claude/`).
- `CONTRIBUTING.md`; adt-facade charter doc (backlog B4 lands here).

---

## 5. Backlog triage — detailed verdicts on v1's Phase-4 items

| Item | Verdict | Evidence / rationale |
|---|---|---|
| **B1** split write further | **IN — Stage D** | handleSAPWrite measured at **1,827 lines in one function** (v1 underestimated by treating it as already-split). 13 cleanly bounded, return-terminated `case` bodies make extraction near-mechanical. SAPWrite is the highest-churn surface (most features touch it) → biggest future merge-conflict payoff. Done under the Stage-A net + focused write.test.ts. |
| **B2** split lint | **DROPPED** | v1's "1,387-line handleSAPLint" was a measurement artifact (span ran to the next *handler*, swallowing unrelated helpers like buildCreateXml and SLASH_TYPE_MAP that sit between them). Real function: **90 lines** (intent.ts 2481–2570). Nothing to split — `lint.ts` lands at ~120 lines in Stage B. |
| **B3** Zod→JSON-Schema generation | **PARTIAL IN — Stage A5 (sync test only); generation REJECTED** | The high-risk drift (enums) dies in A3/A4; field-key drift dies in A5 — both at zero behavior risk. Full generation is rejected because the JSON Schema's value is hand-tuned and runtime-dependent: BTP-conditional description stripping (tools.ts:452–454), runtime `allowedPackages` injection into the SAPWrite description (tools.ts:716–717), GPT strict-mode nullable wrappers, and ~80% pedagogical prose. Generation would churn LLM-visible bytes — the exact thing this PR promises not to do. |
| **B4** adt/client facade charter | **→ PR 2** | It's documentation (the de-facto rule "reads via the AdtClient facade, mutations/specialties via dedicated modules" goes in the future `src/adt/` agent doc). No code change warranted: no circular imports exist, and client.ts (1,461) is under its ratchet budget. |
| **B5** retire intent.ts barrel | **IN — Stage E (consumers migrated; thin shim kept one release)** | package.json has no `exports` map and the package is a CLI/server (3 bins), so deep-import compatibility is a non-API; internal consumers are just 2 src files + ~10 test files. Migration is typecheck-verified path edits. The ≤60-line deprecated shim costs nothing and removes the last externally-visible risk; deleting it is the lone surviving backlog entry. |
| **B6** SRVB publish/unpublish package-gate | **OUT — separate `fix:` PR** | It is a **behavior change** (closing a known, documented allowlist gap where the SRVB ADT URL returns JSON instead of packageRef XML). Including any behavior change would invalidate PR 1's "snapshots and tests byte-identical" verification story, and as a `fix:` it must trigger a release — which this PR must not. Track via a GitHub issue referencing the security-focus list. |

---

## 6. Execution rules for PR 1

*(Operational rules for executing this refactor only. The broader agent-guidance content — what future LLM sessions read in CLAUDE.md/AGENTS.md — is PR 2 and intentionally unspecified here.)*

1. **Behavior preservation is the contract.** If a test fails after a move, the move was wrong — fix the move, never the test. The only test changes allowed: adding Stage-A files, relocating files in Stage C, and import-path edits in Stage E.
2. **Stage A is non-negotiable and comes first.** Every Stage-A test passes against the untouched monolith before Stage B begins.
3. **Move, don't improve** (Stages B, C, D2, E). Stage D1 may create function boundaries but copies bodies verbatim; park every improvement idea as a one-line note in the PR description instead.
4. After every extraction step: `npm test && npm run typecheck` (≈25 s total). Before pushing each stage: add `npm run lint && npm run validate:policy && npm run build && node scripts/ci/check-file-sizes.mjs`.
5. Commits: `test(handlers): …` / `refactor(handlers): …` / `chore(ci): …`. Never `feat:`/`fix:`; never touch CHANGELOG.md or version fields. Squash-merge title must also be `refactor(handlers): …`.
6. Git hygiene: stage files explicitly (`git add <paths>`), never `git add -A` (shared tree may contain other sessions' WIP). No force-push. Don't push or open the PR unless the owner asked — default is handing over the branch.
7. Formatting belongs to the Husky/lint-staged Biome hook — don't hand-reflow.
8. ESM: all new local imports end in `.js`; no `console.log` anywhere (stderr logger only).
9. Integration/E2E run only when credentials exist; absence = clean skip, not a failure to chase.
10. Finding a live bug mid-refactor (e.g. the A3 pre-check diff, a case body with a fall-through) = STOP that step, report; bug fixes ship as separate `fix:` PRs.

## 7. Definition of done — PR 1

- [ ] Stage-A tests exist, passed against the pre-refactor monolith (first commits of the PR prove it), and still pass at HEAD.
- [ ] `tool-registry.ts` is the only place type lists are written; tools.ts, schemas.ts and validate-action-policy consume it.
- [ ] A1 snapshots byte-identical from first commit to HEAD.
- [ ] intent.ts ≤ 60 lines (deprecated barrel, A2-locked); 13 handler modules + `write/` package + 6 helper modules exist; no `src/handlers/` file > ~900 lines except tools.ts/schemas.ts.
- [ ] handleSAPWrite decomposed per the Stage-D table (any cases left inline are listed with reasons in the PR description).
- [ ] intent.test.ts fully relocated; test count ≥ 3,583 + Stage-A additions (numbers in PR description); handlers coverage within 1 pt of baseline.
- [ ] Ratchet in CI with post-split budgets; `npm test`, `typecheck`, `lint`, `validate:policy`, `build` all green; integration suite green on a4h if creds present.
- [ ] No behavior change anywhere; PR description lists parked improvement ideas + any STOP-condition findings.

## 8. After PR 1

- **PR 2** (owner-specified): knowledge architecture per §4 outline.
- **Separate `fix:` PR**: B6 SRVB publish package-gate.
- **Backlog**: delete the intent.ts shim after one released version; consider `adt/client.ts` read-domain split only if it crosses its 1,550-line budget.

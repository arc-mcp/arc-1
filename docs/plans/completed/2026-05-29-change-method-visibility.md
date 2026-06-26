# change_method_visibility + delete_method hardening (issue #303 follow-up)

## Overview

PR #307 (class-section surgery) shipped four `SAPWrite` actions. The issue author ([samibouge, PR feedback](https://github.com/arc-mcp/arc-1/pull/307#issuecomment-4574155604)) validated all four against real + artificial scenarios — zero bugs — and surfaced one important gap: when asked to change a method's visibility, Claude's **default instinct was the destructive path** (`delete_method` + `add_method`), which wipes the method body and recreates an empty stub. The author found the safe `edit_class_definition` route manually, but an autonomous agent would silently lose implementation code.

This plan closes that gap two ways:

1. **`change_method_visibility`** — a dedicated action that moves a method's METHODS clause from its current visibility section to a target section, touching DEFINITION only. The IMPLEMENTATION block is never touched, so the method body is preserved. This was on the original #303 wishlist (`move_method_visibility`), deferred at the time; the author's feedback justifies adding it now. It makes the safe path the *obvious* path and saves tokens (1 method name + target vs. the whole DEFINITION block).

2. **`delete_method` guidance hardening** — steer LLMs away from the delete+recreate anti-pattern at decision time, via the tool description (which the LLM reads when choosing an action). `delete_method` genuinely destroys code; the description must say "to change visibility, use `change_method_visibility` (preserves body) — do NOT delete+recreate."

## Context

### Current State

- Four class-section surgery actions live in `src/handlers/intent.ts` (`edit_class_definition` 4250, `edit_method_signature` 4338, `add_method` 4391, `delete_method` 4475), all sharing the `fetchClassStructureAndMain(name)` helper ([intent.ts:3645](../../src/handlers/intent.ts)).
- Pure splice/diff helpers in `src/adt/class-structure.ts`: `findSectionAnchor` (locates target-section insert point, comment-tolerant), `removeMethodPair`, `insertMethodPair`, `spliceMethodSignature`, `spliceLines` (empty-replacement deletes cleanly — review fix). `MethodStructure` carries `name`, `visibility`, `definition` (LineRange), `implementation?` (LineRange).
- `SAPWRITE_INCLUDE_AWARE_ACTIONS = {update, edit_method, edit_class_definition}` in `schemas.ts` — `add_method`/`edit_method_signature`/`delete_method` are MAIN-only (include= rejected at schema + defensive handler guard). `change_method_visibility` joins them as MAIN-only.
- `delete_method` is `opType: Update` in `src/authz/policy.ts` (it's a source update, not an object delete).
- There is no way to change a method's visibility without either re-sending the whole DEFINITION (`edit_class_definition`) or destroying the body (`delete_method` + `add_method`).

### Target State

- New action `change_method_visibility` (type=CLAS, MAIN-only): params `method` (name) + `visibility` (target section). Moves the METHODS clause; IMPLEMENTATION untouched → body preserved. Idempotent (no-op if already in target). Refuses if the target section header is missing (hint: use `edit_class_definition`). Refuses if method not found (lists available; `~`-qualified hint like the other actions). No auto-activate.
- New pure helper `moveMethodDefinition(source, method, targetAfterLine)` in `class-structure.ts` — single-pass line walk: drop the method's `definition` range, re-emit it after `targetAfterLine`. IMPLEMENTATION lines never touched. Preserves EOL + original clause indentation.
- `delete_method` tool description + the overall SAPWrite action description steer toward `change_method_visibility` for visibility changes and warn that delete+recreate loses the body.
- Schema/tools/policy three-file sync for the new action. `visibility` field doc updated to cover both `add_method` (insert section) and `change_method_visibility` (target section).

### Key Files

| File | Role |
|------|------|
| `src/adt/class-structure.ts` | New `moveMethodDefinition(source, method, targetAfterLine)` pure helper. |
| `src/handlers/intent.ts` | New `case 'change_method_visibility'` in `handleSAPWrite` (after `delete_method`). |
| `src/handlers/schemas.ts` | Add `change_method_visibility` to both action enums; update `visibility` field doc. NOT added to `SAPWRITE_INCLUDE_AWARE_ACTIONS`. |
| `src/handlers/tools.ts` | Add action to JSON Schema enum; document it; harden `delete_method` + `visibility`/`method` descriptions (feedback #1). |
| `src/authz/policy.ts` | Add `SAPWrite.change_method_visibility` (scope write, opType Update). |
| `tests/unit/adt/class-structure.test.ts` | `moveMethodDefinition` unit tests. |
| `tests/unit/handlers/intent.test.ts` | `change_method_visibility` handler tests. |
| `tests/unit/handlers/schemas.test.ts` | Schema accept + include-reject tests. |
| `tests/unit/handlers/tools.test.ts` | Action-enum + description-steering assertions. |
| `tests/integration/class-section-surgery.integration.test.ts` | Live move public→private, assert IMPL preserved + activates. |
| `docs_page/tools.md` | `change_method_visibility` row + `delete_method` destructive warning. |
| `CLAUDE.md` | Update the class-section-surgery Key Files row to list the new action + helper. |
| `docs/compare/00-feature-matrix.md`, `docs_page/roadmap.md` | One-line note. |

### Design Principles

1. **DEFINITION-only move = body preservation.** `moveMethodDefinition` never touches the IMPLEMENTATION block. This is the entire point: a visibility change must not risk the method body. Contrast with `delete_method` + `add_method`, which discards it.
2. **Single-pass line walk, not double-splice.** Extract the method's `definition` lines, then re-emit the whole source skipping those lines and inserting them after the target anchor. One pass over the original line array using original line numbers — no fragile index-shift math between a remove and an insert.
3. **Reuse `findSectionAnchor`.** Same anchor logic as `add_method`: last existing method in the target section, else the (comment-tolerant) section-header line. `null` → refuse with the same hint.
4. **Idempotent.** If `method.visibility === target`, return a friendly no-op (no PUT). Avoids a pointless write + cache invalidation.
5. **MAIN-only, consistent with siblings.** Reject `include=` (defensive guard mirrors `add_method`/`delete_method`); not in `SAPWRITE_INCLUDE_AWARE_ACTIONS`.
6. **No auto-activate.** Writes an inactive draft; caller runs `SAPActivate`. Same contract as the other six write actions.
7. **No pre-write lint suppression needed.** Unlike `edit_method_signature` (body still references old signature), a pure visibility move produces a complete, consistent class — lint the spliced full source normally.
8. **Feedback #1 is decision-time steering.** The LLM picks the action from the tool *description*; the `delete_method` success message fires after the body is already gone. So the mitigation lives in the description, not (only) the response text.

## Development Approach

- TDD-ish: add the `moveMethodDefinition` unit tests first, then the helper, then the handler + handler tests, then schema/tools/policy, then live integration.
- No new config flags or env vars. Gated by existing `allowWrites` + package allowlist + scope + deny-actions.
- Live-verify on a4h (the lock-handle bug blocks NPL writes — same documented baseline as the rest of the feature).
- Keep the diff minimal and mirror the existing four cases' structure exactly (validation order, error messages, `safeUpdateSource` call shape, `invalidateWrittenObject`).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (requires `TEST_SAP_URL`)

### Task 1: `moveMethodDefinition` pure helper + unit tests

**Files:**
- Modify: `src/adt/class-structure.ts`
- Modify: `tests/unit/adt/class-structure.test.ts`

Add a pure helper that moves a method's DEFINITION clause to a new location in the DEFINITION block, leaving IMPLEMENTATION untouched. This is the core of `change_method_visibility` and the reason the body is preserved.

- [ ] Add `export function moveMethodDefinition(source: string, method: MethodStructure, targetAfterLine: number): string` to `src/adt/class-structure.ts`. Algorithm: split into lines; capture the clause = lines `[method.definition.sr-1 .. method.definition.er-1]`; single-pass walk over all lines by 1-indexed `lineNo` — skip lines inside `[method.definition.sr, method.definition.er]`, push every other line, and after pushing the line whose `lineNo === targetAfterLine`, push the captured clause lines. Rejoin with the detected EOL (reuse `detectEol`/`splitLines`/`joinLines` — they're module-private; the helper is in the same module). Throw `RangeError` if `method.definition` is missing or `targetAfterLine` falls inside the moved range (defensive — the handler guarantees target ≠ source section).
- [ ] Add unit tests (~7 tests): move public→private (clause appears under PRIVATE SECTION, gone from PUBLIC); IMPLEMENTATION block byte-identical after the move; move into an empty target section (anchor = section header line); move when target section is ABOVE the method (anchor line < def.sr); move when target section is BELOW (anchor line > def.er); CRLF preserved; original clause indentation preserved verbatim.
- [ ] Run `npm test` — all tests must pass

### Task 2: `change_method_visibility` handler case + unit tests

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Wire the helper into a new `handleSAPWrite` case, mirroring the structure of the existing `delete_method` case (intent.ts:4475) for validation/lint/PUT/invalidate.

- [ ] Add `case 'change_method_visibility':` after the `delete_method` case (~intent.ts:4521). Steps: (1) require `type==='CLAS'`; (2) `method = String(args.method ?? '').trim()` — require non-empty (the method NAME); (3) `target = args.visibility as 'public'|'protected'|'private'` — require present; (4) reject `includeProvided` with a MAIN-only message mirroring the siblings; (5) `await enforcePackageForExistingObject()`; (6) `fetchClassStructureAndMain(name)`; (7) find method by UPPERCASE name — not-found error lists available methods + the `~`-qualified hint (copy from delete_method); (8) **idempotent**: if `method.visibility === target` return a friendly `textResult` "already in the <TARGET> SECTION … no change made" (no PUT); (9) `findSectionAnchor(main, structure, target)` — `null` → refuse with the add_method-style "No <TARGET> SECTION exists … use edit_class_definition" hint; (10) `spliced = moveMethodDefinition(main, method, anchor.afterLine)`; (11) `runPreWriteLint(spliced, type, name, config, lintOverride)` — block if blocked; (12) `safeUpdateSource(client.http, client.safety, objectUrl, srcUrl, spliced, transport, cachedFeatures?.abapRelease)`; (13) `invalidateWrittenObject(type, name)`; (14) success `textResult` noting the move + "IMPLEMENTATION preserved" + "SAPActivate next".
- [ ] Add unit tests (~9 tests) in the existing `SAPWrite class-section surgery (issue #303)` describe block, reusing `mockClassSurgeryFlow`: happy path public→private (PUT body has the clause under PRIVATE SECTION, has NO change to the METHOD body, METHODS gone from PUBLIC); IMPL untouched (PUT body still contains `METHOD hello.`); idempotent no-op when already public (no PUT call); method-not-found error lists available; target-section-missing refuse (probe class has no PROTECTED SECTION → move to protected refuses with edit_class_definition hint); rejects non-CLAS; rejects missing `method`; rejects missing `visibility`; rejects `include=`.
- [ ] Run `npm test` — all tests must pass

### Task 3: Schema + tool definitions + policy (three-file sync) + feedback #1 hardening

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/authz/policy.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

Register the action across the three sync points and harden `delete_method` guidance (feedback #1).

- [ ] `src/handlers/schemas.ts`: add `'change_method_visibility'` to the `action` enum on BOTH `SAPWriteSchema` and `SAPWriteSchemaBtp`. Do NOT add it to `SAPWRITE_INCLUDE_AWARE_ACTIONS` (MAIN-only). Update the `visibility` field jsdoc to note it's the *target* section for `change_method_visibility` as well as the insert section for `add_method`.
- [ ] `src/handlers/tools.ts`: add `'change_method_visibility'` to the JSON Schema `action` enum. In the action `description`: (a) add a sentence describing `change_method_visibility` (moves a method between sections, preserves the body, params method + visibility); (b) **feedback #1** — in the `delete_method` sentence add: "destructive — removes the METHOD body; to change a method's visibility use `change_method_visibility` (preserves the body), do NOT delete + re-add." Update the `method` property description to include `change_method_visibility` (method NAME) and the `visibility` property description to include it (target section).
- [ ] `src/authz/policy.ts`: add `'SAPWrite.change_method_visibility': { scope: 'write', opType: OperationType.Update },` next to the other three.
- [ ] `tests/unit/handlers/schemas.test.ts`: accept `change_method_visibility` with `method`+`visibility`; reject it with `include=` (schema error — not in include-aware set).
- [ ] `tests/unit/handlers/tools.test.ts`: assert the action enum contains `change_method_visibility`; assert the action description mentions `change_method_visibility` AND contains the delete_method destructive-warning steering text (e.g. matches `/change_method_visibility/` near the delete_method wording).
- [ ] Run `npm test` — all tests must pass

### Task 4: Live integration test (a4h) + docs

**Files:**
- Modify: `tests/integration/class-section-surgery.integration.test.ts`
- Modify: `docs_page/tools.md`
- Modify: `CLAUDE.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs_page/roadmap.md`

Prove the body-preservation invariant end-to-end on a real class, and document the new action + the delete_method warning.

- [ ] Add an `it('change_method_visibility: moves a method between sections, preserving the body')` case to the integration test: against the seeded probe class, give `hello` a real body (it already has one from the seed), call `change_method_visibility(method='hello', visibility='private')`, activate, `SAPRead` and assert: (a) `METHODS hello` now appears after `PRIVATE SECTION`, (b) the method body (`result = |Hello, { name }!|.`) is still present in IMPLEMENTATION, (c) activation succeeded. Guard with the same `seeded` flag pattern as the other cases.
- [ ] `docs_page/tools.md`: add a `change_method_visibility` subsection under "Class-section surgery" (params, example moving public→private, "IMPLEMENTATION preserved" note). In the `delete_method` subsection add a bold warning: destructive (removes body); for visibility changes use `change_method_visibility`.
- [ ] `CLAUDE.md`: update the class-section-surgery Key Files row to list `change_method_visibility` + the `moveMethodDefinition` helper.
- [ ] `docs/compare/00-feature-matrix.md`: append a dated note that `change_method_visibility` landed (token-efficient, body-preserving visibility move) + bump the existing surgery line; `docs_page/roadmap.md`: extend the Method-Level Surgery row.
- [ ] Run `npm test` — all unit tests still pass
- [ ] Run `npm run typecheck` and `npm run lint` — no errors

### Task 5: Final verification

- [ ] Run full unit suite: `npm test` — all pass
- [ ] Run `npm run typecheck` — no errors
- [ ] Run `npm run lint` — no errors
- [ ] Run integration on a4h: `TEST_SAP_URL=http://a4h.marianzeis.de:50000 TEST_SAP_USER=MARIAN TEST_SAP_PASSWORD=<from .env> TEST_SAP_CLIENT=001 npm run test:integration -- class-section-surgery` — all PASS (incl. the new move case)
- [ ] Commit and push to the existing PR branch `feat/class-section-surgery-303` (do NOT comment on the PR)
- [ ] Move this plan to `docs/plans/completed/2026-05-29-change-method-visibility.md`

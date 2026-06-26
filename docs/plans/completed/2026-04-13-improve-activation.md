# Plan: Improve SAPActivate — Richer Responses, GetInactiveObjects, Preaudit Control

## Overview

Enhance ARC-1's activation capabilities based on gaps identified from our DDIC implementation experience (PR #86) and fr0ster's v5.0.7-5.0.8 ActivateObjects implementation. Three improvements:

1. **Richer activation responses** — Currently `parseActivationResult()` only returns success/fail + flat message strings. SAP's activation XML contains severity levels, object references, warning vs error distinction, and line numbers. Parsing these into structured data gives the LLM actionable error information (e.g., "line 42: type ZI_TRAVEL is not active" vs "Activation was cancelled").

2. **GetInactiveObjects** — New `SAPRead` action to list objects pending activation via `GET /sap/bc/adt/activation/inactive`. Enables the LLM workflow: "show what's inactive → batch activate". fr0ster has this (`GetInactiveObjects` tool); ARC-1 doesn't. Roadmap item FEAT-18.

3. **Optional `preaudit` parameter** — Currently hardcoded to `true`. fr0ster exposes this as a toggle. Adding it as an optional parameter (default `true`) gives advanced users control without changing default behavior.

## Context

### Current State

- `activate()` and `activateBatch()` in `devtools.ts` (lines 36-92) hardcode `preauditRequested=true`
- `parseActivationResult()` (line 267) returns `{ success: boolean; messages: string[] }` — loses severity, type, object URI, and line number info from the XML
- The handler in `intent.ts` (lines 1824-1856) formats results as simple text strings
- No way to list inactive objects — FEAT-18 in roadmap, P2 priority, marked "not started"
- SAPActivate tool definition in `tools.ts` (lines 500-538) has no preaudit parameter

### Target State

- `parseActivationResult()` returns structured data: per-message severity, type, short text, object URI, and line number
- Handler formats structured results for LLM consumption (errors with line refs, warnings separated from errors)
- New `inactive_objects` action on SAPRead lists pending activations
- Optional `preaudit` parameter on SAPActivate (default `true`, no breaking change)
- Updated docs, roadmap, and feature matrix

### Key Files

| File | Role |
|------|------|
| `src/adt/devtools.ts` | `activate()`, `activateBatch()`, `parseActivationResult()`, `extractShortText()` — lines 36-309 |
| `src/handlers/intent.ts` | `handleSAPActivate()` (line 1738), `handleSAPRead()` for new inactive_objects action |
| `src/handlers/tools.ts` | SAPActivate tool definition (line 500), SAPRead tool description |
| `src/handlers/schemas.ts` | SAPActivateSchema (line 264), SAPReadSchema |
| `src/adt/client.ts` | New `getInactiveObjects()` method |
| `src/adt/xml-parser.ts` | Parser for inactive objects XML response |
| `src/adt/types.ts` | New `InactiveObject` type |
| `src/adt/safety.ts` | Existing `checkOperation(OperationType.Read)` for inactive objects |
| `tests/unit/adt/devtools.test.ts` | Activation parsing tests (line 102+) |
| `tests/unit/handlers/intent.test.ts` | SAPActivate handler tests (line 1821+) |
| `tests/unit/adt/client.test.ts` | New getInactiveObjects tests |
| `docs/tools.md` | SAPActivate section (line 199), SAPRead section |
| `docs/roadmap.md` | FEAT-18 status update (line 520) |
| `docs/compare/00-feature-matrix.md` | Inactive objects row (line 165), activation features |

### Design Principles

1. **Backward compatible** — `parseActivationResult()` signature changes but the `success` and `messages` fields remain. New fields are additive. Existing callers continue to work.
2. **Structured where it helps the LLM** — errors with line numbers are more actionable than flat strings. Warnings separated from errors prevent false alarm.
3. **Default-safe** — `preaudit` defaults to `true` (current behavior). GetInactiveObjects is a read operation.
4. **Minimal surface** — GetInactiveObjects is an action on existing SAPRead tool, not a new tool. Preaudit is an optional parameter on existing SAPActivate.
5. **Test the real SAP response** — Use the A4H test system to capture actual activation XML responses for fixtures.

## Development Approach

- Start with the response parsing improvement (most value, touches core devtools)
- Then add GetInactiveObjects (new read capability)
- Then add preaudit parameter (trivial)
- Each task ends with `npm test` passing
- Use real SAP XML response fixtures captured from A4H system

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Enrich activation response parsing

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `tests/unit/adt/devtools.test.ts`
- Create: `tests/fixtures/xml/activation-response-errors.xml`
- Create: `tests/fixtures/xml/activation-response-warnings.xml`

Enrich `parseActivationResult()` to return structured message objects instead of flat strings. The SAP activation response XML contains per-message attributes: `severity` (error/warning/info), `type` (E/W/I/S/A), `shortText`, `uri` (object reference), and `line` (source line number). Currently only `shortText` is extracted and severity is used only for the boolean `success` flag.

- [ ] Define a new `ActivationMessage` interface in `devtools.ts` with fields: `{ severity: 'error' | 'warning' | 'info'; text: string; uri?: string; line?: number }`. Export it.
- [ ] Change return type of `parseActivationResult()` to `{ success: boolean; messages: string[]; details: ActivationMessage[] }`. The `messages` field remains as-is (string array) for backward compat — `details` adds the structured data.
- [ ] In the `for (const m of msgs)` loop (line 275), extract `@_uri` as optional `uri` and `@_line` as optional `line` (parse to number). Map severity/type to the three-value enum: E/A/fatal → 'error', W → 'warning', everything else → 'info'.
- [ ] Create XML fixture `tests/fixtures/xml/activation-response-errors.xml` with realistic SAP activation error XML (multiple messages, mixed severity, some with line numbers and URIs, both attribute and child-element shortText formats).
- [ ] Create XML fixture `tests/fixtures/xml/activation-response-warnings.xml` with a warning-only response (success=true but has warning messages).
- [ ] Add unit tests (~6 tests): structured details contain correct severity/uri/line; warnings don't set success=false; mixed errors+warnings parse correctly; backward-compat `messages` array still works; empty response returns empty details array; line numbers parse as numbers not strings.
- [ ] Run `npm test` — all tests must pass

### Task 2: Update SAPActivate handler to use structured responses

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Update `handleSAPActivate()` in `intent.ts` (lines 1824-1856) to use the new `details` field from `parseActivationResult()` for richer error/success messages to the LLM.

- [ ] In the batch activation path (line 1824), when `result.success` is false, format error messages with line numbers and URIs when available. Example format: `"Errors:\n- [line 42] Type ZI_TRAVEL is not active (/sap/bc/adt/ddic/ddl/sources/zi_travel)\n- Activation was cancelled"`. When `result.success` is true but there are warning details, append them: `"\nWarnings: ..."`.
- [ ] Apply the same formatting to the single activation path (line 1845).
- [ ] When result is successful and has no messages, keep the existing simple format: `"Successfully activated..."`.
- [ ] Update existing handler unit tests to match new message format (tests at line 1821+).
- [ ] Add unit test (~2 tests): activation with warnings shows success + warnings; activation with line-number errors formats them with `[line N]` prefix.
- [ ] Run `npm test` — all tests must pass

### Task 3: Add GetInactiveObjects to SAPRead

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/adt/types.ts`
- Modify: `src/adt/xml-parser.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/adt/client.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Create: `tests/fixtures/xml/inactive-objects.xml`

Add `inactive_objects` as a new SAPRead action. The ADT endpoint `GET /sap/bc/adt/activation/inactive` returns an XML list of objects pending activation with name, type, and URI. This is roadmap item FEAT-18.

- [ ] Add `InactiveObject` type to `src/adt/types.ts`: `{ name: string; type: string; uri: string; description?: string }`.
- [ ] Add `parseInactiveObjects()` to `src/adt/xml-parser.ts` — parse the activation/inactive XML response. The response uses `<adtcore:objectReference>` elements with `adtcore:uri`, `adtcore:type`, `adtcore:name`, and optional `adtcore:description` attributes.
- [ ] Add `getInactiveObjects()` to `src/adt/client.ts`: calls `GET /sap/bc/adt/activation/inactive` with Accept `application/xml`, guarded by `checkOperation(safety, OperationType.Read, 'GetInactiveObjects')`. Returns `InactiveObject[]`.
- [ ] Add `inactive_objects` case to `handleSAPRead()` in `intent.ts`. Format as JSON with count and object list. No parameters needed (system-wide query).
- [ ] Add `'inactive_objects'` to the SAPRead action enum in `schemas.ts` (find the `SAPReadSchema` z.object, add to the action enum array).
- [ ] Add `inactive_objects` to the SAPRead tool description in `tools.ts` — mention it lists objects pending activation, useful before batch activate.
- [ ] Create `tests/fixtures/xml/inactive-objects.xml` with sample ADT response containing 3-5 inactive objects of mixed types (DOMA, DTEL, CLAS).
- [ ] Add unit tests for `parseInactiveObjects()` (~3 tests): parses multiple objects, handles empty response, handles single object.
- [ ] Add unit test for `getInactiveObjects()` client method (~1 test): calls correct endpoint with correct headers.
- [ ] Add unit test for `handleSAPRead` with `inactive_objects` action (~1 test): returns JSON with count and objects.
- [ ] Run `npm test` — all tests must pass

### Task 4: Add optional preaudit parameter to SAPActivate

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/adt/devtools.test.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Add an optional `preaudit` boolean parameter to SAPActivate. Currently hardcoded to `true` in `activate()` and `activateBatch()` (lines 49 and 85 of devtools.ts). fr0ster exposes this as a toggle. Default remains `true` (no behavior change).

- [ ] Add `preaudit?: boolean` parameter to `activate()` and `activateBatch()` in `devtools.ts`. Default to `true` via `preaudit ?? true`. Update the URL: `preauditRequested=${preaudit ?? true}`.
- [ ] Add `preaudit` to `SAPActivateSchema` in `schemas.ts` (line 264): `preaudit: z.boolean().optional()`.
- [ ] Add `preaudit` property to the SAPActivate tool inputSchema in `tools.ts` (line 500 block): `preaudit: { type: 'boolean', description: 'Request pre-audit before activation (default: true). Set to false to skip pre-check.' }`.
- [ ] Pass `args.preaudit` through from `handleSAPActivate()` in `intent.ts` to both `activate()` and `activateBatch()` calls.
- [ ] Add unit tests (~3 tests): default preaudit=true in URL; explicit preaudit=false in URL; handler passes preaudit through to activate/activateBatch.
- [ ] Run `npm test` — all tests must pass

### Task 5: Update documentation, roadmap, and feature matrix

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Update all documentation artifacts to reflect the three improvements.

- [ ] Update `docs/tools.md` SAPActivate section (line 199): add `preaudit` parameter to the table, mention structured error responses with line numbers. Add `inactive_objects` to the SAPRead section's action list with description and example.
- [ ] Update `docs/roadmap.md` FEAT-18 (line 520): change status from "Not started" to "✅ Completed". Remove the "Why not" section or keep it as historical note. Update the description to reflect the actual implementation (SAPRead `inactive_objects` action).
- [ ] Update `docs/compare/00-feature-matrix.md` "Inactive objects list" row (line 165): change ARC-1 from `❌` to `✅`. Update the "P2+ future gaps" section (line 300) — remove "inactive objects" from the gap list.
- [ ] Update `CLAUDE.md` if needed: verify the Key Files table and codebase structure are accurate after these changes. The `src/adt/devtools.ts` description already mentions "activate" — no change needed. Add `inactive_objects` to the SAPRead action types if there's a list in CLAUDE.md.
- [ ] Run `npm test` — all tests must pass (no code changes, but verify nothing broke)

### Task 6: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify SAPActivate tool schema includes `preaudit` parameter
- [ ] Verify SAPRead tool schema includes `inactive_objects` action
- [ ] Verify `parseActivationResult()` returns both `messages` (string[]) and `details` (ActivationMessage[])
- [ ] Verify FEAT-18 marked as completed in roadmap
- [ ] Verify feature matrix updated for inactive objects
- [ ] Move this plan to `docs/plans/completed/`

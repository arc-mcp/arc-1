# Plan: FEAT-01 Where-Used Analysis (Usage References)

## Overview

Enhance the existing `findReferences` implementation to support the full 2-step scope-based Where-Used Analysis ADT API. Currently, `findReferences` in `src/adt/codeintel.ts` does a simple GET to `/sap/bc/adt/repository/informationsystem/usageReferences?uri=...` and parses basic XML attributes with regex. The full ADT API supports a scope discovery step (POST to `.../usageReferences/scope`) followed by a filtered query (POST to `.../usageReferences` with scope), enabling filtering by object type and returning richer results (line numbers, snippets, package info).

This is the #1 most requested missing feature per the roadmap (P1, XS effort) and the #1 item in the feature parity analysis.

### Source Documents

- **Roadmap:** `docs/roadmap.md` — FEAT-01 definition (line ~266), prioritized as Phase B item #5 (line ~859)
- **Feature Parity Report:** `docs/plans/completed/2026-03-24-001-feature-parity-implementation.md` — Item #1, Phase 1 implementation plan (line ~48)
- **Current implementation:** `src/adt/codeintel.ts` — `findReferences()` (line 69-97)
- **Handler:** `src/handlers/intent.ts` — `handleSAPNavigate` case `'references'` (line ~792)
- **Tool definition:** `src/handlers/tools.ts` — `SAPNavigate` tool schema (line ~352)
- **Unit tests:** `tests/unit/adt/codeintel.test.ts` — existing `findReferences` tests (line ~75)
- **Handler tests:** `tests/unit/handlers/intent.test.ts` — SAPNavigate references tests

### Key Design Decisions

- Keep backward compatibility: the existing simple `findReferences` (GET-based) remains the default behavior
- Add a new `findWhereUsed` function for the full 2-step scope-based API
- Expose via `SAPNavigate` action `references` — enhance it to use the scope-based API when available, with optional `objectType` filter parameter
- Parse XML responses properly using `fast-xml-parser` (v5) instead of regex for the new function
- Follow the ADT client pattern: safety check, HTTP call, parse response

## Validation Commands

- `npm run build`
- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Implement scope-based Where-Used in ADT codeintel layer

Add the full 2-step Where-Used API to `src/adt/codeintel.ts`:

- [x] Add `WhereUsedScope` interface (available object types/counts from scope response)
- [x] Add `WhereUsedResult` interface extending `ReferenceResult` with additional fields: `packageName`, `snippet`, `objectDescription`
- [x] Implement `getWhereUsedScope(http, safety, objectUrl)` — POST to `/sap/bc/adt/repository/informationsystem/usageReferences/scope` with the object URI in the request body, returns available scope/object types
- [x] Implement `findWhereUsed(http, safety, objectUrl, objectType?)` — POST to `/sap/bc/adt/repository/informationsystem/usageReferences` with scope filter in request body, returns detailed results
- [x] Use `fast-xml-parser` for XML parsing (consistent with `src/adt/xml-parser.ts` patterns) instead of regex
- [x] Add safety check using `checkOperation(safety, OperationType.Intelligence, 'FindWhereUsed')`

Reference: `docs/plans/completed/2026-03-24-001-feature-parity-implementation.md` Phase 1 describes the 2-step API. Current simple implementation is at `src/adt/codeintel.ts:69-97`.

### Task 2: Wire up handler and tool schema

Update the SAPNavigate handler and tool definition to expose the enhanced Where-Used:

- [x] Update `src/handlers/intent.ts` `handleSAPNavigate` case `'references'` to call `findWhereUsed` instead of `findReferences`, falling back to `findReferences` if the scope endpoint returns an error (older SAP systems)
- [x] Add optional `objectType` parameter to `SAPNavigate` tool schema in `src/handlers/tools.ts` — allows filtering where-used results by object type (e.g., only show CLAS references)
- [x] Update the `SAPNavigate` tool description to mention the enhanced where-used capability
- [x] Export new functions from `src/adt/codeintel.ts` and update import in `src/handlers/intent.ts`

### Task 3: Add unit tests

Add comprehensive unit tests for the new Where-Used functions:

- [x] Add XML fixture files in `tests/fixtures/xml/` for scope response and where-used response
- [x] Add unit tests in `tests/unit/adt/codeintel.test.ts` for `getWhereUsedScope` — happy path, empty scope, safety block
- [x] Add unit tests in `tests/unit/adt/codeintel.test.ts` for `findWhereUsed` — with/without objectType filter, multiple results, empty results, safety block
- [x] Add handler test in `tests/unit/handlers/intent.test.ts` for the enhanced references action with objectType parameter
- [x] Verify backward compatibility: existing `findReferences` tests still pass unchanged

### Task 4: Update hyperfocused mode and documentation

- [x] Check if `src/handlers/hyperfocused.ts` needs updates for the enhanced references capability
- [x] Update `docs/tools.md` SAPNavigate section to document the new `objectType` parameter and enhanced where-used behavior
- [x] Update the FEAT-01 status in `docs/roadmap.md` from "Not started" to "Done"

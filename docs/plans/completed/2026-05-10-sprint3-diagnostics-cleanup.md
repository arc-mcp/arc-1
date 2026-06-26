# Sprint 3 Diagnostics Cleanup

## Overview

This plan implements the opportunistic Sprint 3 items from the RAP migration run notes: #13 `SAPDiagnose action="object_state"`, #9 automatic SAPQuery chunking for long literal `IN (...)` lists, and #8 verification that `SAPRead type=DEVC` no longer uses the misaligned package `nodestructure` descriptions. The work is driven by the 2026-05-09 SEGW-to-RAP vibe-coding runs in `/Users/marianzeis/DEV/arc-1-legacy-ui5-rap-conversion/RUN-NOTES.md` and the prior deep-research evaluation captured in the chat transcript.

The implementation keeps ARC-1's 12-tool design intact. Object state is a read-only diagnostic under `SAPDiagnose`, SQL chunking stays inside `SAPQuery`, and the DEVC item is treated as a current-state verification because this checkout already contains the completed search-endpoint implementation and regression tests.

## Context

### Current State

- `SAPDiagnose` already supports syntax, ATC, quickfix, dumps, traces, system messages, and gateway errors, but it has no compact way to compare active vs. inactive source state across class includes.
- RAP behavior-pool troubleshooting in Run 3 lost time because active and inactive class includes diverged while ordinary reads made the state hard to compare.
- `SAPQuery` currently returns an LLM hint when the ADT freestyle SQL parser rejects a query, but it does not automatically split long single-column literal `IN (...)` lists.
- `SAPRead type=DEVC` is already fixed in this branch: `AdtClient.getPackageContents()` uses `/sap/bc/adt/repository/informationsystem/search` rather than `/repository/nodestructure`, and tests assert description/name alignment.

### Target State

- `SAPDiagnose(action="object_state", type="CLAS", name="...")` returns active/inactive state for `main`, `definitions`, `implementations`, `macros`, and `testclasses`: URL, availability, HTTP status, ETag, byte length, SHA-256 hash, and `divergent`.
- `SAPDiagnose(action="object_state", type="<non-CLAS>", name="...")` returns the same compact comparison for the object's `/source/main` endpoint.
- `SAPQuery` detects simple long literal `IN (...)` lists, splits them into batches of eight values, runs multiple equivalent queries, and merges rows up to `maxRows`.
- `SAPQuery` still emits parser hints for unsupported SQL shapes and does not transform complex or unsafe query forms.
- Documentation and tests make clear that #8 is already done and remains covered.

### Key Files

| File | Role |
|------|------|
| `src/adt/diagnostics.ts` | Add read-only object-state source comparison helper |
| `src/adt/types.ts` | Add object-state diagnostic result types |
| `src/handlers/intent.ts` | Wire `SAPDiagnose object_state`; add SAPQuery IN-list chunking helper and route |
| `src/handlers/schemas.ts` | Add `object_state` action to `SAPDiagnoseSchema` |
| `src/handlers/tools.ts` | Document `object_state` and SAPQuery chunking behavior |
| `tests/unit/adt/diagnostics.test.ts` | Unit-test object-state comparison helper |
| `tests/unit/handlers/intent.test.ts` | Unit-test handler wiring and SQL chunking |
| `tests/unit/handlers/schemas.test.ts` | Unit-test schema acceptance for `object_state` |
| `tests/unit/handlers/tools.test.ts` | Unit-test tool descriptions mention new behavior |
| `docs_page/tools.md` | User-facing tool reference for `SAPDiagnose` and `SAPQuery` |
| `docs/plans/completed/2026-05-09-fix-devc-listing-descriptions.md` | Existing completed #8 plan, referenced as current-state evidence |
| `docs/compare/00-feature-matrix.md` | Update diagnostics cleanup note if feature surface changes |

### Design Principles

1. Keep object-state diagnostics read-only: no locks, writes, or activation attempts.
2. Return compact metadata, not raw source, so the diagnostic is safe and token-efficient.
3. Treat ETags as opportunistic: hash/byte comparison is the source of truth for divergence.
4. Split only one simple literal `IN (...)` predicate. Complex SQL remains unchanged and receives the existing parser hint.
5. Preserve `maxRows` semantics across all SQL chunks by stopping once the merged result reaches the requested row limit.
6. Keep #8 as verified-current behavior rather than reworking already-fixed code.

## Development Approach

Implement in three layers: diagnostics helper and tool wiring first, SAPQuery chunking second, then documentation and final verification. Unit tests cover all code paths. Integration tests are not added in this PR because the available DW4 connector has inactive ADT ICF services; live S/4 and NW 7.50 evidence is represented by existing probe fixtures and the prior completed DEVC plan.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add object-state diagnostics foundation

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/diagnostics.ts`
- Modify: `tests/unit/adt/diagnostics.test.ts`

Add a reusable read-only helper that compares active and inactive source metadata for a list of ADT source URLs.

- [x] Add `ObjectStateSourceVersion`, `ObjectStateSection`, and `ObjectStateResult` types in `src/adt/types.ts`.
- [x] In `src/adt/diagnostics.ts`, implement `getObjectState(http, safety, input)` that reads each section with `version=active` and `version=inactive`.
- [x] Compute SHA-256 hashes, byte lengths, status codes, ETags, and per-section `divergent` flags without returning raw source text.
- [x] Treat 404 for optional class includes as `{ available: false }` while rethrowing non-404 errors.
- [x] Add unit tests (~6): active/inactive equal, divergent, ETag capture, 404 optional include handling, non-404 rethrow, and read safety gating.
- [x] Run `npm test` — all tests must pass.

### Task 2: Wire `SAPDiagnose action="object_state"`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

Expose the object-state helper as a diagnostic action while keeping object URL construction local to the handler.

- [x] Add `object_state` to the `SAPDiagnoseSchema` action enum.
- [x] Add `object_state` to the SAPDiagnose JSON schema enum and description.
- [x] In `handleSAPDiagnose()`, require `name` and `type` for `object_state`.
- [x] For `CLAS`, build sections for `main`, `definitions`, `implementations`, `macros`, and `testclasses`; for other supported source objects, build a single `main` section from `sourceUrlForType()`.
- [x] Return the object-state result as formatted JSON.
- [x] Add unit tests (~6): CLAS section URLs, non-CLAS main URL, missing name/type errors, schema acceptance, and tool description coverage.
- [x] Run `npm test` — all tests must pass.

### Task 3: Add SAPQuery long-IN-list chunking

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

Make the common TADIR lookup pattern robust on 7.5x systems by splitting simple long literal `IN (...)` lists into multiple safe queries.

- [x] Add an internal parser that recognizes exactly one simple predicate like `FIELD IN ('A','B',...)` outside string literals.
- [x] Only transform when there are more than eight literal values and the SQL contains exactly one SELECT statement.
- [x] Generate chunked SQL by replacing the original list with batches of up to eight values.
- [x] Execute chunks sequentially through `client.runQuery()`, merge columns from the first response, append rows, and stop once `maxRows` is reached.
- [x] If chunked execution fails, return the existing parser hint with an additional note that automatic IN-list chunking was attempted.
- [x] Update SAPQuery tool description to mention automatic chunking and that complex SQL should still be split manually.
- [x] Add unit tests (~7): long IN list chunks into multiple POSTs, short IN list stays single-call, maxRows cap across chunks, complex/non-literal IN remains unchanged, parser-error fallback still works, chunk failure hint, and tool description coverage.
- [x] Run `npm test` — all tests must pass.

### Task 4: Documentation and #8 verification

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Review only: `docs/plans/completed/2026-05-09-fix-devc-listing-descriptions.md`

Update user-facing and assistant-facing docs for the two new behaviors and record that Sprint 3 #8 is already implemented.

- [x] Document `SAPDiagnose action="object_state"` in `docs_page/tools.md` with a class behavior-pool troubleshooting example.
- [x] Document SAPQuery long-IN-list auto-chunking in `docs_page/tools.md`.
- [x] Update `docs/compare/00-feature-matrix.md` with a dated note for Sprint 3 diagnostics cleanup.
- [x] Update `CLAUDE.md` key-file guidance if the new diagnostic changes common task mapping.
- [x] Verify `docs/plans/completed/2026-05-09-fix-devc-listing-descriptions.md` still matches current code and tests; do not duplicate that plan.
- [x] Run `npm run lint` — no errors.

### Task 5: Final verification and plan completion

- [x] Run full unit suite: `npm test` — all tests pass.
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Review the implementation diff for scope creep and safety invariants.
- [x] Move this plan to `docs/plans/completed/`.

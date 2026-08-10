# Plan: Correct the TABLE_QUERY value contract (#690)

**Status:** Implemented and validated
**Research:** [Issue 690 dossier](../research/issues/690-table-query-where-values.md)

## Goal

Prevent callers from following the `TABLE_QUERY` schema and silently receiving zero rows because they supplied SQL-quoted values to a builder that already quotes and escapes raw values.

## Evidence-based scope

- Live reproduction on SAP_BASIS 758 and 816 shows the documented quoted form succeeds with zero rows and the bare form returns the matching `TADIR` row.
- `src/adt/client.ts` and `tests/unit/adt/table-query.test.ts` already implement and verify the intended raw-value behavior.
- The mismatch is in the shared LLM-visible schema description in `src/handlers/tools.ts`, copied into the frozen tool-definition snapshots.

## Implementation tasks

1. Replace the `IN`/`NOT IN` schema wording with an explicit raw-value contract: comma-separated bare values, no caller quotes, ARC-1 quotes and escapes each element, with a bare `261,262` example.
2. Add a focused `tests/unit/handlers/tools.test.ts` assertion against the generated `SAPRead` schema. Assert the positive guidance and the absence of the stale “single-quoted literals” wording.
3. Regenerate the tool-definition snapshots with the repository snapshot command. Review that only the expected `where` description changes in the seven variants exposing the shared SAPRead schema.

## Deliberate non-changes

- Do not change `buildInList()` or scalar quoting behavior.
- Do not accept a second pre-quoted input dialect by stripping quotes.
- Do not change ADT requests, safety gates, or published prose that does not document this structured parameter.

## Validation and review

- Focused: `tests/unit/adt/table-query.test.ts`, `tests/unit/handlers/tools.test.ts`, and the tool-definition snapshot test.
- Full: `npm test`, `npm run typecheck`, `npm run lint`, and the size/schema budget check if required by the changed surface.
- Final review: inspect the complete diff, verify no stale quoted guidance remains in generated fixtures, confirm the builder/security tests are unchanged, and compare the final behavior to the live dossier.
- Publish: create a focused commit, push a descriptive branch, and open a draft PR with the root cause, impact, live evidence, and checks.

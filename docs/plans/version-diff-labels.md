# Plan: readable labels for `SAPRead action="diff"`

## Evidence

Use the verified findings in `docs/research/2026-06-27-version-diff-labels.md` and the existing
diff contract in `docs/research/2026-06-15-version-diff-saved-read-action.md`.

## Implementation

1. Add optional `fromLabel` and `toLabel` fields to the SAPRead Zod schemas and LLM-visible tool
   schema.
2. Extend `getVersionDiff` options with `fromLabel`/`toLabel`, preserving the current default labels
   exactly when labels are omitted.
3. Thread labels from `handleSAPRead` into `getVersionDiff` and use the same display labels in the
   one-line `Diff ...` / `No differences ...` messages.
4. Update `docs_page/tools.md` with parameter rows and examples.
5. Regenerate tool-definition fixtures.

## Tests

1. Add a handler unit test proving custom labels appear in both the summary and unified diff headers.
2. Add a handler unit test proving labels also apply to the no-difference message without affecting
   source resolution.
3. Add a schema unit test for `fromLabel`/`toLabel`.
4. Run focused tests:
   - `npx vitest run tests/unit/adt/source-diff.test.ts tests/unit/handlers/read.test.ts tests/unit/handlers/schemas.test.ts tests/unit/handlers/schema-key-sync.test.ts tests/unit/handlers/tool-definitions-snapshot.test.ts`
5. Run broader gates:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`

## Plan Review

- Scope is presentation-only; no ADT calls, safety checks, or revision resolution logic change.
- Three-file schema sync is covered: `schemas.ts`, `tools.ts`, handler, plus schema-key and snapshot
  tests.
- Existing default behavior remains observable through current tests; new tests cover only the added
  label path.
- Live SAP testing is not required for the label plumbing because no SAP request/response contract
  changes. A post-implementation read-only smoke was still run on A4H and recorded in
  `docs/research/2026-06-27-version-diff-labels.md`.

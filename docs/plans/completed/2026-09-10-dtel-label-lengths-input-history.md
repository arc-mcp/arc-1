# DTEL Label Lengths and Input History Implementation Plan

**Status:** completed
**Created:** 2026-09-10
**Issue:** #771
**Research:** [DTEL label lengths and input-history root cause](../../research/issues/771-dtel-label-lengths-input-history.md)

## Goal

Expose DTEL short, medium, long, and heading lengths plus the negative ADT
`deactivateInputHistory` flag through `SAPWrite` and `SAPRead`. Preserve these stored fields during
partial updates, apply explicit lengths during create through the existing follow-up PUT, retain the
v2-to-v1 content-type fallback, and document the exact create/update behavior.

## Context

The validated wire contract is stable on SAP_BASIS 750 SP02, 758 SP02, and 816 SP01. ADT stores the
four lengths and `deactivateInputHistory` directly in the DTEL XML. ARC-1 already reads that XML and
already uses a post-create PUT for DTEL metadata, but its public types, parser, schemas, and builder
discard these fields. The builder then derives lengths from source-language label text and emits
`deactivateInputHistory=false`, so unrelated partial updates overwrite valid stored metadata.

Implementation decisions reviewed before coding:

- Public fields use the ADT names `shortLength`, `mediumLength`, `longLength`, `headingLength`, and
  `deactivateInputHistory`.
- Lengths are optional integers in their canonical ranges: short 0–10, medium 0–20, long 0–40,
  heading 0–55. Values are rejected rather than clamped. SAP activation remains authoritative for
  label/translation consistency.
- Omitted lengths retain current create behavior: derive from the matching label text, or use the
  canonical maximum when that label is absent. During update, a stored length is preserved when
  neither its label nor its length is supplied. Supplying a label without its length derives the new
  length from that label, matching ARC-1's existing behavior.
- Omitted `deactivateInputHistory` defaults to `false` on create and preserves the stored value on
  update. `true` means SAP GUI input history is disabled, matching the ADT XML polarity.
- Explicit label lengths use the existing post-create PUT because SAP ignores them in the create
  POST on all three verified releases. The input-history flag is sent in both POST and PUT bodies.
- Single-object, BTP, and nested `batch_create` schemas must expose and validate the same fields.

## Tasks

### Task 1: Extend the DTEL XML model and read parser

**Files:**

- `src/adt/ddic-xml.ts`
- `src/adt/types.ts`
- `src/adt/xml-parser.ts`
- `tests/unit/adt/ddic-xml.test.ts`
- `tests/unit/adt/xml-parser.test.ts`
- `tests/unit/adt/client.test.ts`

- [x] Write focused failing tests for explicit values, zero lengths, defaults, and parsed read-back.
- [x] Add the four optional length inputs and optional history flag to `DataElementCreateParams`.
- [x] Serialize explicit lengths without truthiness checks; derive existing defaults only when a
      length is absent.
- [x] Add the fields to `DataElementInfo` and parse them from active and inactive DTEL metadata.
- [x] Assert the expanded `getDataElement` result at the ADT client boundary and forward the
      requested active/inactive version from `SAPRead`.
- [x] Keep the existing v2/v1 media types and `safeUpdateObject` fallback path unchanged.
- [x] Run the focused XML builder/parser tests and typecheck the touched interfaces.

### Task 2: Expose the fields through every write surface and preserve partial updates

**Files:**

- `src/handlers/schemas.ts`
- `src/handlers/tools.ts`
- `src/handlers/data-element-fields.ts`
- `src/handlers/write-helpers.ts`
- `src/handlers/write/create.ts`
- `tests/unit/handlers/schemas.test.ts`
- `tests/unit/handlers/schema-key-sync.test.ts`
- `tests/unit/handlers/zod-jsonschema-parity.test.ts`
- `tests/unit/handlers/write-ddic.test.ts`
- `tests/unit/handlers/write-create-batch.test.ts`
- `tests/unit/handlers/build-create-xml-cloud.test.ts`

- [x] Add failing schema tests for valid boundary values, out-of-range/fractional rejection, strict
      single-object validation, and retained nested `batch_create` fields.
- [x] Add length fields to all four Zod DTEL shapes and both JSON Schema DTEL surfaces; use
      `looseOptionalBoolean` for the history flag.
- [x] Forward the fields into DTEL XML for create, batch create, update, and BTP variants.
- [x] Trigger the existing DTEL follow-up PUT when any explicit label length is supplied, including
      zero.
- [x] Merge omitted update fields according to the reviewed semantics, preserving stored lengths and
      both boolean values without truthiness bugs.
- [x] Preserve reservations when callers re-send unchanged labels and abort partial metadata updates
      when the existing full XML state cannot be read.
- [x] Add single, batch, and partial-update handler tests that assert the final XML sent to SAP.
- [x] Run focused handler/schema tests, typecheck, and lint.

### Task 3: Update the public contract and durable implementation notes

**Files:**

- `docs_page/tools.md`
- `AGENTS.md`
- `src/handlers/tool-descriptions.ts`
- `tests/fixtures/tool-definitions/*.json`
- `docs/research/issues/771-dtel-label-lengths-input-history.md`

- [x] Document each new field, its limits and polarity, and omitted-field behavior for create versus
      update.
- [x] Update the DTEL read contract to mention returned lengths and the history flag.
- [x] Record the follow-up PUT and preservation gotcha in the repository routing guidance.
- [x] Regenerate tool-definition snapshots and inspect the fixture diff for top-level and nested
      parity rather than accepting it mechanically.
- [x] Add implementation and validation results to the research dossier.

### Task 4: Validate the implementation offline and against live SAP systems

**Files:**

- `docs/research/issues/771-dtel-label-lengths-input-history.md`

- [x] Run the focused DTEL/schema/handler suite and all adjacent regression tests identified by the
      research dossier.
- [x] Run `npm run typecheck`, `npm run lint`, `npm run build`, and the full `npm test` suite.
- [x] On SAP_BASIS 758 and 816, run create, active/inactive read, activation, and description-only
      update through the public handlers. On 750, run the public write path with v2→v1 fallback and
      verify the parser/merge/update path with explicit-version reads around the known default-read
      anomaly.
- [x] Verify an explicit zero boundary and one rejected invalid request without leaving an SAP
      object behind.
- [x] Delete every disposable object and verify both active and inactive reads return 404.
- [x] Scrub and parse-check the captured evidence, summarize durable results in the dossier, and keep
      one-off logs/runners out of the repository.

### Task 5: Complete the review loop and prepare the pull request

**Files:**

- all changed files
- `docs/plans/2026-09-10-dtel-label-lengths-input-history.md`

- [x] Review the full diff for correctness, security, error handling, backward compatibility,
      schema parity, test quality, documentation accuracy, and repository conventions.
- [x] Resolve every actionable finding, rerun the affected checks, and repeat review until no
      material finding remains.
- [x] Reproduce the external Claude review findings, apply the preservation/version/fail-closed
      corrections, document the schema-budget decision, and rerun offline and live validation.
- [x] Confirm the diff contains no credentials, temporary logs, generated build output, or unrelated
      changes.
- [x] Mark every completed task, move this plan to `docs/plans/completed/`, and repair its relative
      research link.
- [x] Commit with a conventional `fix:` subject, push the `codex/issue-771-dtel-metadata` branch, and
      create a PR that links issue #771 and reports offline and live validation.

## Validation Commands

```bash
npx vitest run \
  tests/unit/adt/ddic-xml.test.ts \
  tests/unit/adt/xml-parser.test.ts \
  tests/unit/adt/client.test.ts \
  tests/unit/adt/crud.test.ts \
  tests/unit/handlers/read.test.ts \
  tests/unit/handlers/schemas.test.ts \
  tests/unit/handlers/schema-key-sync.test.ts \
  tests/unit/handlers/zod-jsonschema-parity.test.ts \
  tests/unit/handlers/tool-definitions-snapshot.test.ts \
  tests/unit/handlers/write-ddic.test.ts \
  tests/unit/handlers/write-create-batch.test.ts \
  tests/unit/handlers/build-create-xml-cloud.test.ts \
  tests/unit/handlers/write-schema-pollution.test.ts
npm run typecheck
npm run lint
npm run build
npm test
```

## Acceptance Criteria

1. `SAPWrite` accepts all five fields for single create/update and nested batch create on on-premise
   and BTP schemas.
2. Explicit boundary values serialize exactly, invalid values fail validation, and no value is
   silently clamped or lost through normalization.
3. `SAPRead type=DTEL` returns all five stored values from the requested active or inactive version.
4. Explicit lengths survive create and activation on SAP_BASIS 750, 758, and 816, with the 750
   default-read qualification recorded in the research dossier.
5. A description-only update preserves existing lengths and `deactivateInputHistory=true`.
6. Existing callers that omit the fields retain current create behavior.
7. The v2-to-v1 DTEL update fallback and package/write safety gates continue to pass their tests.
8. All disposable live-test objects are deleted and independently verified absent.

# Plan — #692: allow DDLS table functions on 7.50 and classify post-lock delete 404s correctly

**Evidence base:**
[`docs/research/issues/692-ddls-table-function-guard-delete-404.md`](../../research/issues/692-ddls-table-function-guard-delete-404.md)
— live-verified 2026-08-11 on NW 7.50 SP02 (`SAP_BASIS 750`) and S/4HANA 2023
(`SAP_BASIS 758`).

**Status:** completed and validated; amended during live review after 7.50 exposed a phantom-lock
edge case and during PR review to preserve truthful diagnostics when the confirmation probe itself
fails.

## Goal

Restore valid `define table function` create/update behavior on NW 7.50, make `batch_create`
enforce the same entity-only release guard as single writes, and stop describing a DDLS delete as
"object not found" when metadata and mutation-stage evidence confirm it still existed after SAP
rejected DELETE.

## Verified facts this plan rests on

| Fact | Evidence |
|---|---|
| `DEFINE TABLE FUNCTION` is supported in ABAP 7.50 | Official ABAP 7.50 release notes; active SAP demo on both live systems |
| A custom table function works end to end on 7.50 | Create, source write, activation, readback, and delete succeeded through the current unguarded batch path |
| The guard was designed for table entities only | Original completed plan, comment, and error all say `define table entity`; commit `c06d8847` accidentally added `|function` |
| `batch_create` omits the release guard | Its source-validation phase runs RAP preflight and lint but not `guardCdsSyntax()` |
| AMDP/runtime presence alone is not the delete blocker | Table-function delete succeeded with the active implementation class still present on 750 and 758 |
| An active DDLS consumer triggers the reported response | Live 750 DELETE returned HTTP 404 with German `konnte nicht gelöscht werden`; removing the consumer made delete succeed |
| The dependent resource existed when DELETE failed | Its metadata/source was readable before the attempt and remained readable afterward |
| LOCK alone is insufficient evidence on 750 | A batch-rejected, TADIR-absent DDLS name still received a handle; DELETE then failed 423 with an invalid-lock message |
| Text matching is insufficient | English logon language triggered the current phrase matcher; German did not; the status and dependency were otherwise identical |

## Design

### 1. Keep the release guard narrow and consistent

`guardCdsSyntax()` will match only `define table entity`. Its existing release threshold, BTP
exception, and fail-open behavior when no feature probe is cached remain unchanged.

`batch_create` will call that same helper in its per-object source-validation block, before RAP
preflight, lint, or any create request. A blocked item will be recorded using the existing
per-object failure shape and the batch will stop, matching its other deterministic validation
failures.

No bypass parameter will be added: once table functions are removed from the false-positive match,
the guard covers only syntax that the live 7.50 system genuinely cannot accept.

### 2. Carry operation-stage evidence on the typed ADT error

`AdtApiError` will gain an optional handler-owned `resourceExistenceAfterDelete` state. This is
classification metadata, not user-facing prose. After a successfully locked DELETE returns 404,
the delete handler records `exists` when the follow-up metadata read succeeds, `absent` only when
that probe also returns 404, and `unknown` for any other probe failure. Every post-lock 404 gets
that follow-up read before classification; the extra request exists only on the error path and
closes any race with earlier package metadata resolution.

This preserves the distinction the HTTP status alone loses:

- a failure while resolving or locking the object can still mean it is absent;
- a 7.50 lock handle alone does not prove a DDLS exists;
- a DELETE 404 plus independent successful post-failure metadata resolution cannot truthfully be
  described as absence;
- a non-404 failure from the confirmation probe establishes neither existence nor absence, so the
  formatter must report uncertainty rather than falling back to a missing-object claim.

### 3. Make dependency enrichment language-independent

For DDLS, either the existing structured/message detector or a post-lock 404 will trigger
`buildCdsDeleteDependencyHint()`. The existing detector remains useful for non-404 DDIC error 039
responses and for other dependency-sensitive types. Restricting the new structural inference to
the live-verified DDLS handler avoids labeling unrelated post-lock 404s as dependency failures. It
still covers localized DDLS text without growing a fragile list of translations. A follow-up probe
404 suppresses the existing English phrase matcher so a phantom lock cannot add contradictory
dependency guidance to a real not-found result. If that probe instead fails inconclusively, the
message-based matcher remains useful but structural DDLS inference is withheld.

The dispatcher will check `resourceExistenceAfterDelete` before its generic not-found branch. It
will distinguish confirmed existence, confirmed absence, and an inconclusive follow-up probe. An
inconclusive result directs the caller to verify the current state with `SAPSearch` before retrying.
Handler-provided dependency remediation stays last through `extraHint`.

## Tasks

### 1. Correct and synchronize the CDS guard

- `src/handlers/cds-hints.ts`: remove `function` from the regex.
- `src/handlers/write/create.ts`: run `guardCdsSyntax()` in batch source validation and report a
  normal failed batch item when it blocks.

### 2. Preserve successful-lock evidence

- `src/adt/errors.ts`: add and document the tri-state `resourceExistenceAfterDelete` fact on
  `AdtApiError`.
- `src/handlers/write/update-delete.ts`: combine a post-failure metadata read with lock-stage
  evidence, record `exists`/`absent`/`unknown`, and enrich confirmed DDLS post-lock 404s independent
  of response language while retaining message-based evidence when the probe is inconclusive.
- `src/handlers/dispatch.ts`: render confirmed existence and inconclusive probes truthfully instead
  of falling through to the absent-object hint.

### 3. Add focused regression coverage

- `tests/unit/handlers/cds-write-guard.test.ts`:
  - single create and update allow `define table function` with cached 750 features;
  - batch create allows a table function with cached 750 features;
  - batch create rejects `define table entity` with cached 750 features before its create POST;
  - retain coverage that single create/update still reject the table-entity syntax.
- `tests/unit/handlers/transport.test.ts`:
  - a German DDLS 404 after a successful lock gets dependency follow-up and no missing-object hint;
  - a genuine pre-lock 404 keeps the normal missing-object hint;
  - a 7.50-style phantom DDLS lock followed by DELETE 404 and metadata 404 still keeps the
    missing-object hint;
  - a message-based dependency 404 followed by an inconclusive metadata probe keeps dependency
    remediation but does not claim either confirmed existence or absence;
  - a non-CDS 404 after a successful lock gets the generic delete-handler explanation rather than
    a dependency claim or missing-object hint.

### 4. Validate locally and on both real systems

- Run the focused handler tests, typecheck, lint, build, and the full unit suite.
- On NW 7.50, create/update/activate/read a table function through the normal guarded path.
- On NW 7.50, confirm a batched table entity is rejected before creation.
- On NW 7.50 with German logon language, recreate the dependent-DDLS delete failure and confirm the
  corrected diagnostics; delete the consumer and confirm cleanup succeeds.
- On S/4HANA 2023, create/update/activate/read/delete a table function to check the newer-release
  path for regressions.
- Verify all temporary objects are absent afterward.

## Plan review

Reviewed against the live traces, the original CDS-robustness plan, the stateful CRUD sequence, and
the dispatcher ordering. The review rejected three tempting but weaker changes:

- adding only the German phrase would remain logon-language dependent;
- treating every DDLS 404 as a dependency failure would misclassify genuine missing objects;
- adding a user override would broaden writes without solving the guard's incorrect syntax match.

The tri-state metadata/lifecycle fact is the narrowest reusable boundary: it is produced only by
the handler that knows both the existence lookup and the mutation stage, while the generic
formatter consumes it without learning CRUD internals. The review narrowed structural dependency
inference from all dependency-sensitive types to DDLS, the only handler behavior established by
the live trace. A first post-fix live pass then disproved lock-only evidence, so the implementation
was tightened to require metadata confirmation as well. No schema, tool-definition fixture, ADT
path, or authorization change is required. Final validation also moved the cohesive CDS guard suite
out of `write-create-batch.test.ts` rather than raising that file's 3,000-line CI budget. PR review
then closed the remaining degraded path: a non-404 confirmation-probe failure now remains
explicitly unknown and preserves existing message-based dependency remediation.

## Validation results

- Focused handler tests: 228 passed.
- Full unit suite: 171 files / 4,993 tests passed.
- Typecheck, Biome, build, file-size ratchet, and tool-schema budgets passed. Biome emitted only the
  existing configuration-version/deprecation notices.
- NW 7.50 (`SAP_BASIS 750`): single table-function create/update/activate/read passed; batch table
  entity was blocked before creation; German dependent-DDLS delete 404 produced the corrected,
  language-independent diagnostic; all temporary objects were absent after cleanup.
- S/4HANA 2023 (`SAP_BASIS 758`): single table-function create/update/activate/read/delete passed;
  the temporary object was absent after cleanup.

## Out of scope

- Discovering or deleting dependencies automatically.
- Changing SAP object activation order or HANA runtime lifecycle.
- Promising that the 7.50 usage-reference endpoint will enumerate every blocker; live testing
  returned no rows, so the fallback remediation remains part of the result.
- Changing minimal-error mode, which intentionally omits detailed remediation.

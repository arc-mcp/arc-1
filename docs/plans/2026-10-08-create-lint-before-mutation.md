# Lint before single-object creation (#942)

## Research and reproduction

Base: `c7bbfb5376c90a172538fb440c30b7b41405732f`; no existing PR for #942.
Checked the roadmap: no matching unfinished idea or roadmap impact.

The built dispatcher on SAP_BASIS 758 SP02 over HTTPS/Basic creates a disposable
`$TMP` class before rejecting a missing period in its method. The response reports
success with a lint-rejection suffix; a separate SAPRead finds SAP's generated
class stub. Deleted it and verified 404. No transportable object was used in this
live reproduction; transport recording is a consequence of the same create POST.

Static inspection confirms single create calls `runPreWriteLint` after metadata
creation, unlike batch_create. Function source preparation is local and can move
with that validation. FUNC remains outside abaplint's supported types.

## Plan and review

1. Move existing source preparation and lint ahead of the generic metadata create,
   after the specialized SKTD path and existing package/transport/RAP checks.
2. Return the existing lint error when blocked; reuse the prepared source and lint
   warnings during source PUT. Keep metadata-only and specialized creates unchanged.
3. Add regression tests proving a lint error and no mutating request for local and
   transportable-package inputs, plus valid/metadata-only and lint override cases.
   Existing FUNC tests cover signature synthesis, warnings, and processing metadata.
4. Run the full checks, repeat the live failure (404, no stub), then create and
   activate corrected source using the same name. Review the final diff.

Plan review: moving two existing checks is sufficient. Deleting a stub after lint
failure would add mutations and leave transport side effects. Avoid that approach,
and avoid broad changes to the create pipeline or lint policy.

## Verification and final review

- Seven new tests pass; four failed before the fix. All 7,951 unit tests pass,
  including existing FUNC and batch lifecycle tests. Typecheck, lint, policy,
  build, and file/schema budgets pass.
- The first complete run exposed a diagnostic test whose deliberately malformed
  CDS now failed locally before reaching its mocked SAP error. Set that test's
  `lintBeforeWrite:false` explicitly; the complete rerun passes. No production
  lint rules or exceptions were changed.
- Repeated the live class scenario against the built candidate: lint returns an
  error, zero mutating calls, and an independent source GET returns 404. Corrected
  source then creates and activates under the same name, reads back correctly,
  and is deleted with 404 verified.
- Reviewed ordering, lint overrides, warning preservation, FUNC preparation,
  metadata-only creates, and package gates. No remaining actionable findings.
- Live coverage is local Node 24.11.1 dispatcher/HTTPS Basic on 758 SP02, client
  001. Transport recording, BTP, PP, 750, and unavailable 816 were not retested.
  Transportable-package rejection has unit coverage. Roadmap recheck: no impact.

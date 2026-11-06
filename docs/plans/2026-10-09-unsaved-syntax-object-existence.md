# Unsaved syntax checks require a real object (#951)

Reviewed external PR #951 at `b41be2ef`, then merged current main `d6cb05382`.
On both live SAP_BASIS 750 SP02 and 758 SP02, an absent program with modern Open
SQL returns `checked:true` and false fixed-point arithmetic errors through both
`SAPRead SYNTAX` and `SAPDiagnose syntax`. SAP checks a standalone include with
default attributes rather than the intended program. Three of the PR's tests
fail against main's handler.

## Plan and review

1. Retain the PR's small shared-handler fix: for supplied source, read the object
   metadata root and return the existing not-checked result on confirmed 404.
   Probe without a version so inactive-only objects remain eligible.
2. Keep stored-version checks and pre-write checks unchanged. Non-404 probe
   failures are inconclusive; preserve SAP's check-report verdict. This does not
   cache absence or grant authorization, and the metadata read uses the existing
   safety guard and request identity.
3. Strengthen version-handling tests for both public tools. Verify absent objects,
   real fixed-point errors and clean checks on existing programs, plus a newly
   created inactive-only program on the authorized test systems. Delete fixtures
   and verify cleanup.
4. Run all six local gates and strict docs, review the final diff and push normal
   commits to the existing PR. No replacement PR or rewritten author history.

No synthetic program attributes, temporary server-side objects during syntax
checks, additional configuration or general existence-cache abstraction are
needed. Creating fixtures is test-only. The extra GET cannot make existence and
checking atomic; the existing SAP result handling remains authoritative after it.

## Verification

At `fba347ff`, the reviewed build passes 8,053 unit tests and all six local gates
plus strict documentation build. The author implementation is unchanged there; added tests
assert version-less metadata and exact source/version forwarding for both tools.

Direct HTTPS Basic-auth handler probes on 750 SP02 and 758 SP02 confirm absent
programs now return `checked:false` without a check POST; existing FIXPT-on/off
programs retain clean/genuine-error results. Stored checks send no metadata GET.
New `$TMP` PROG and CLAS drafts, confirmed in SAP's inactive list, accept supplied
source through both tools with either requested version. All fixtures were deleted
and metadata reads returned 404.

The attempted inactive-only program fixture instead had an active shell plus an
inactive source (758 REPOSRC: A and I); class metadata also answered both versions.
These establish draft compatibility, not a proven inactive-only repository state.
750's freestyle data-preview endpoint returned 404, so repository-row inspection
was limited to 758. No new PP/BTP/816 run or live 403/500 probe was available.

## Review follow-up

Claude's review of `fba347ff` found no blocking implementation defect. Independent
read-only 758 SP02 probes confirmed its two edge cases:

- `BAPIRET2` metadata and source exist at `/ddic/structures`, while the table root
  returns 404. Both `TABL` and `TABL/DS` syntax inputs use the table route. The
  unchanged lower-level check reports `checked:true` with false table-definition
  errors; the PR refuses validation. Its generic advice now asks callers to verify
  type and name and create only if absent, instead of always recommending creation.
- An absent PROG checked without source, including normalized empty source,
  retains the lower-level result: `checked:true`, `hasErrors:true`, with SAP's
  missing REPORT/PROGRAM message. This PR only probes checks with supplied source.

No routing fallback, extra probe or new abstraction is added. The existing 404
regressions cover the conditional advice through both public tools. These review
probes made no SAP mutations. Claude also reported successful version-less metadata
for a never-activated DDLS draft; that is additional reviewer evidence, not a new
independent live run or a reason to generalize version behavior to every type.

Roadmap: ARCH-01 now records the verified structure syntax-routing gap. Its scope,
priority and resume trigger are unchanged; FEAT-69 remains a separate batch feature.

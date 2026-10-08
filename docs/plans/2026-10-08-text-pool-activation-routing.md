# Route explicit program text-pool activation (#940)

## Evidence and root cause

Base: `d9a6d483` (includes the text-write fix in #946). No open PR addresses
the remaining explicit-activation route. Roadmap checked: no impact; FEAT-34
still concerns translation beyond text elements.

On SAP_BASIS 758 SP02, HTTPS/Basic, client 001, an already-active disposable
`$TMP` program with a directly saved text draft reproduces both failures:
`SAPActivate(REPT)` says success but leaves REPOTEXT state I, and `PROG/PX`
is rejected. `REPT` is unknown to the common URL builder and falls through to
the program-source object; the live slash subtype has no normalization entry.

The text-pool GET itself reports `adtcore:type="PROG/PX"`, its own packageRef,
and `/sap/bc/adt/textelements/programs/<name>` in the inactive-object feed.
Activating this URI with the existing helper and default preaudit clears the
text draft, while a separate program-source draft remains inactive. The
fixture and all its REPOTEXT rows were removed after the experiment.

## Plan

1. Add the evidenced `PROG/PX` → `REPT` alias and explicit program text-pool
   base path. This fixes single and batch activation through the shared router.
2. Reuse the text-element discovery guard. Preserve native activation errors,
   scope/write gates, and the existing package check against the pool's metadata.
   Validate every batch package before sending any activation request.
3. Describe REPT success as an activation request, including the first-PROG-
   activation guidance already established in #946. Batch status uses `requested`
   for these entries; never claim active state for a never-activated program.
4. Add regression tests for both spellings, mixed batches, URI escaping,
   restricted/unresolved packages, missing service, write/deny gates, errors and
   cache behavior. Reproduce the routing failures before changing production.
5. Replay single/batch activation live, check REPOTEXT and inactive-object state,
   preserve unrelated source drafts, and verify cleanup. Run the full local gates
   and review the complete diff before opening the closing PR.

## Plan review

The existing metadata already supplies the true package, so no owner resolver,
additional backend probe, configuration, or activation implementation is needed.
Keep program-source activation distinct from text-pool activation. Do not change
the unrelated legacy fallback for other unknown types or invent class/function-
group slash aliases. The new-program caveat belongs in the response, matching
#946, rather than automatically activating its owner's source.

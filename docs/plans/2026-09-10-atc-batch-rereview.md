# ATC batch re-review follow-up

Review input: the user's second Claude review, against `5f7ea999`.

## Plan and review decisions

1. Reproduce child-object finding loss and TABL source-URI rejection before editing
   production code. Retain the existing passing suite as the baseline.
2. Keep findings from enclosing object types outside the explicit batch-root
   contract (including FUNC and INCL). Such records may be children of a selected
   container; the worklist does not provide a general parent association. Preserve
   their original identity/provenance and mark the run incomplete, with unknown
   coverage counts. Continue excluding demonstrably unselected supported root
   identities, including overlap from a verification worklist. Do not infer parent
   membership from source locations or add metadata requests or hierarchy rollups.
3. Recognize TABL table and structure roots and their exact `/source/main` resources.
   Keep DOMA/DTEL/SRVB metadata-only routes restricted to their roots.
4. Add independent tests for recoverable network failures, caller cancellation
   without AbortError, AbortError without an aborted caller, SAP-reported Unicode
   names, SRVB roots/source rejection and DEVC with an otherwise-valid name.
5. Retain run-scoped completeness for contradictory URI evidence. Observed good
   findings remain visible, but their verified totals stay unknown when the
   worklist is inconsistent. A new per-object completeness/retry model would
   enlarge this fix; instead add an explicit mixed-good/bad regression test.
6. Clarify the historical red-test count as the recorded initial test-development
   run, not a replay of the later committed assertions. Keep the existing pure
   utility import: moving the shared object-type module is a separate structural
   change without a demonstrated runtime failure.
7. Run targeted tests before/after, fault-injection checks of the independent
   guards, all local gates, and read-only live container/table/class regressions.
   Review the diff, update the evidence, commit separately and update PR #772.

The plan preserves the 20-entry cap, at most two worklists, one original deadline,
existing single/package behavior and the current response layout. The intentional
tradeoff is an incomplete result when a possible child cannot be assigned safely,
with its findings retained instead of reporting a false clean result.

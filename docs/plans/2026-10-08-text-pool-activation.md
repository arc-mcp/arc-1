# Activate saved text pools (#940)

## Independent reproduction

Base main: `c7bbfb5376c90a172538fb440c30b7b41405732f`; no existing PR for #940.
Checked the roadmap, including FEAT-34 (translation beyond text symbols): no impact.

On SAP_BASIS 758 SP02, HTTPS/Basic, separate disposable `$TMP` PROG, FUGR, and
CLAS objects all save an inactive REPOTEXT row after edit_text_symbols. The new
text is readable, so source read-back alone is not sufficient verification. Native
inactive objects include a PROG/PX reference to the textelements URI. Activating
that exact URI clears the inactive row; deletion then leaves no REPOTEXT rows.
This independently extends the report's program-only evidence to all three types.

Experiments with a program whose source also has an unrelated draft:

- Activation while holding the text-pool lock returns SAP EU/510 (currently editing),
  even in the same stateful session. The lock must be released first.
- Lock → PUT → unlock → activate in one stateful session succeeds. REPOTEXT contains
  only the active row. Explicit active/inactive source reads retain the old active
  program and the separate draft. All test objects/pools were cleaned up.

## Plan and review

1. Extend the existing shared text-part writer: after successful PUT and unlock,
   activate the exact textelements URI in the same session using the existing helper.
   Set `preaudit:false` so no unrelated suggested objects are added to the request.
2. Treat failed activation as an error, state that the text was saved but activation
   was not confirmed, and retain native errors. Always invalidate the caller's caches
   after an attempted write, including activation failure after a successful PUT.
3. Correct code comments, agent routing and user guidance. Success explicitly says
   the text pool was activated. No new SAPActivate aliases or release heuristics.
4. Add ordering/session, error, no-activation-after-PUT-failure, and cache regression
   tests. Extend live integration assertions to verify no text-pool inactive entry,
   not merely that the source can be read. Run the full gates and live final replay.

Plan review: automatic text-pool activation restores the existing documented write
contract, works for all three verified owners, and uses one existing helper. Merely
adding slash aliases leaves the write's misleading success contract unresolved and
requires separate routing/package work. The activation request contains only the pool;
the parent's source remains a draft. A saved pool can remain inactive on failure, so
the error and invalidation paths are part of the fix, not optional cleanup.

## Verification and final review

- Six regression tests fail on main and pass with the fix. All 7,950 unit tests pass;
  typecheck, lint, policy, build, and file/schema budgets pass. Four on-prem writable
  snapshots change only the action description. Existing safety/package/part guards
  and failed-PUT unlock checks pass; failed PUTs never activate.
- Three live lifecycle tests pass on 758 SP02: PROG/FUGR symbols, selections, headings,
  replacement/clear, and CLAS symbols/invalid-input behavior. Seven unrelated tests
  were excluded by the test-name filter, not counted as live coverage. Added native
  inactive-list assertions after text writes, including the class wrapper.
- The compiled candidate dispatcher independently shows only active REPOTEXT rows,
  no pool entry in the inactive list, correct text read-back, and successful clears
  for all three owners. Explicit source-version reads prove that each owner's active
  source remains byte-identical and its separate draft remains inactive. An initial
  FUGR probe incorrectly assumed group activation promoted a TOP include; corrected
  the probe to compare the actual captured active source. No product change was
  made for that fixture assumption. All created objects were deleted and REPOTEXT
  queries returned zero rows afterward.
- Reviewed exact activation URI, disabled preaudit expansion, session/lock ordering,
  preserved native errors, failure invalidation, and documentation. No remaining
  actionable finding. Existing transport-layer 403 CSRF retry is retained.
- Route: Node 24.11.1, local dispatcher/direct ADT over HTTPS/Basic, client 001.
  No installed-client, transportable-package, BTP/PP, or 816 replay (816 license
  unavailable). 750's missing service remains discovery-gated. Roadmap recheck:
  no impact; translation beyond text symbols remains deferred in FEAT-34.

# Batch preflight and persisted outcomes

## Root cause and evidence

Baseline: `6dd53c14eb0bf0f2a90502995b6f9bfe0a0c444f`. The customer reported batches
stopping after the first object in populated packages. Earlier live 758 tests
created twelve independent programs successfully, reproduced first-only success
with a duplicate second entry, and reproduced a zero-created summary after an
activation failure left the first object and source persisted. All fixtures were
removed. This establishes failure-reporting defects, not a universal ten-object
limit or the customer's exact first failing request.

Re-review finds predictable name, source, AFF header, type-support, and metadata
construction checks inside the mutation loop. A late rejection leaves earlier
objects behind. Duplicate entries are not rejected. Terminal activation exceptions
escape the accumulated result model. In addition, the existing activation-status
mapper calls an object active when it has no assigned error: that is insufficient
evidence of success when the overall activation failed.

New handler regressions exercise the real dispatcher and HTTP client. Before the
fix, late name/type/header/source errors allow a first create; duplicate entries
are accepted; failed activation is reported as zero created; and terminal HTTP
failure loses the batch summary. Empty-name rejection and the successful one-block
response are compatibility controls. An initial test incorrectly demanded a
handler preflight message for the already schema-rejected empty name; review
corrected that assertion before implementation.

## Implementation plan

1. Prepare and validate every entry before any create. Aggregate deterministic
   failures (name, canonical duplicate, supported type/discovery, source preparation,
   enabled lint/RAP checks, AFF header, and create-body construction). Keep normalized
   URLs and prepared source/body in the plan so execution uses what was checked.
2. Preserve all scope/safety/package checks, including inherited FUNC packages.
   Check the create safety gate before remote preflight. Resolve effective transports
   and MSAG request validity before mutations. Transport discovery remains a best-effort
   compatibility lookup, but safety and authentication/authorization errors must not
   be swallowed. No new existence scan, overwrite, rollback, or concurrency change.
3. Bound batches to 100 entries in both tool schemas and the runtime handler. This
   keeps full preflight and per-entry failure output bounded and covers the reported
   roughly 30-object use case. Reject oversized input before any mutation.
4. Track each entry's creation, source/metadata write, and activation independently.
   Creation/write use `not_attempted`, `confirmed`, and `unknown` (plus `not_required`
   for writes); activation also distinguishes explicit `failed` from `unknown`.
   Count confirmed creations, not completed lifecycles. Skipped means unattempted.
5. Preserve the successful single-text-block response. On batch validation/execution
   failures, return a human summary followed by a compact JSON `{batch: ...}` block
   with per-entry phases and counts. Schema/scope rejections retain their existing
   response. Document the error response extension and explicit readback/recovery.
6. Preserve default sequential activation and `activateAtEnd` activation of the
   already-written subset after a write failure. Catch terminal exceptions without
   dropping prior writes. On overall activation failure, entries without explicit
   failure evidence remain unknown; never infer activation from missing messages.
7. Invalidate affected object/inactive-list caches after confirmed or uncertain
   mutation, even if the final phase fails. Preserve canonical type keys and the
   request's cache-security context. No cache promotion on uncertain outcomes.
8. Keep SAP-derived diagnostics hidden in both response blocks under minimal-error
   mode, including non-exception activation messages and wrapped metadata failures.
   Bound detailed diagnostics; retain actionable locally produced preflight errors.

## Plan review

Preflight prevents known input failures, not SAP races or runtime failures. A
successful POST followed by a failed PUT must still report a created object. A
rejected/timed-out create without readback is an unknown creation outcome, not
proof that the object is absent. Recovery instructions must require verification
before re-creation or updating; no source is retained in the result manifest.

Duplicate detection must preserve distinct DDLS/BDEF objects with the same name,
collapse TABL aliases, respect the shared PROG/INCL namespace, and treat FUNC names
as unique independently of a supplied group. Runtime safety checks remain at every
existing HTTP sink after the earlier preflight checks. Error formatting must not
turn the new second block into a minimal-error bypass.

The batch implementation can keep shared create helpers in their current module;
put the result contract/formatting in a small separate module. Do not perform a
large move-only refactor as part of the behavior change. Keep source/test size and
tool-schema budgets unchanged, apart from intentional reviewed schema descriptions
and the new maximum array size. No new tool/action or write permission is needed.

## Validation and completion

- Establish failing regressions before source changes; review their assumptions.
- Exercise bad first/middle/last entries, multiple preflight errors, alias duplicates,
  invalid metadata construction, enabled/disabled source lint, and zero mutations.
- Exercise create rejection, source and metadata PUT failure, inline activation
  failure, unassigned terminal error, partial terminal error, and terminal exception.
- Verify persisted counts, skipped states, uncertain outcomes, both error blocks,
  minimal errors, canonical cache invalidation, read-only/package/transport gates,
  successful response compatibility, and deferred activation ordering.
- Run focused suites, then all unit tests, typecheck, lint, policy validation,
  build, size/schema budgets, and reviewed snapshot updates.
- Run owned live fixtures: rejected later entry creates nothing; failed activation
  reports its persisted draft; a 30-object dependency chain works with deferred
  activation. Clean up and verify every owned fixture.
- Review the final diff for phase accuracy, exception boundaries, safety, response
  compatibility, and test quality; fix findings and rerun affected checks.
- Create a focused PR after final local review, then inspect GitHub checks and fix
  any regression before handoff. UIAD/publication remain research-only in this task.

## Final review and evidence

Implemented the plan above. The new focused suite has 34 cases. The baseline had
eight failing regressions and two passing compatibility controls before the fix.
Final local validation: all **6,613 unit tests across 214 files** pass, as do
typecheck, build, lint, action-policy validation, file-size and tool-schema budgets.
The five writable tool snapshots change only the batch description and `maxItems`.

Three new MCP E2E tests pass against SAP_BASIS 758: late-entry preflight leaves
nothing, activation failure reports its persisted inactive source, and dependent
interfaces activate together. Separate live dispatcher/client tests exercise the
same rejection and persistence cases on **758 and 816**, plus **30 interfaces in a
dependency chain per release**, with active-source readback for all 60 interfaces.
The chain creation/activation/readback took 37.7 seconds on 758 and 42.2 seconds on
816. These are individual observations, not throughput guarantees. Search checks
confirmed removal of every owned fixture after cleanup.

Review findings addressed:

- Terminal failure with no assigned object error previously produced a false
  success; it now preserves unknown activation state. Object URI matching also
  distinguishes `ZFIRST` from `ZFIRST2`.
- Wrapped TTYP metadata and non-exception activation messages needed explicit
  minimal-error handling in both output blocks. Transport 401/403 failures now
  reject preflight instead of entering the compatibility fallback.
- The old TTYP assertion counted a successful POST as zero creations after its
  PUT failed. It now checks confirmed creation and uncertain writing.
- An existing transport test used invalid placeholder CDS. Early lint correctly
  intercepted it; valid program source now isolates transport behavior, with an
  explicit no-create assertion.
- The standalone live cleanup harness initially used the wrong search-result
  field (`name` instead of `objectName`). The harness was corrected, all 758
  fixtures were removed and absence verified before the 816 run. This was a test
  harness defect, not an ARC-1 runtime defect.
- The source-size ratchet caught a one-line overflow in `tools.ts`; simplifying
  its introductory comment retained the existing budget.

Final diff review checked all mutation/exception boundaries, per-user canonical
cache invalidation, FUNC package inheritance, type routing, transport inheritance,
DTEL/TTYP follow-up PUTs, deferred activation of the written subset, and the absence
of source payloads in the result manifest. No unresolved finding remains within
this PR's scope. SAP runtime races, semantic errors, and lost responses remain
possible and are represented explicitly; preflight is not an atomic transaction.

The sanitized live record is
[`2026-09-14-batch-preflight-live.json`](../research/2026-09-14-batch-preflight-live.json).

## Review round 2 (2026-09-15)

Confirmed R1–R3 against the implementation and regression tests. Plan: use one
transport preflight helper for single and batch create, reject shared CLAS/INTF
identities before I/O, and separate object-specific activation errors from global
messages. Preserve unknown activation after an overall failure. Bound the human
summary, restore naming guidance, remove duplicate mutation invalidation, and
document structural includes and long-running batches.

Plan review: skipping transport lookup does not skip package authorization or SAP's
create checks. Safety errors and HTTP 401/403 must refuse both create paths;
other lookup failures retain older-system compatibility. SAP documents all
`$`-prefixed packages as temporary local packages, in both
[NetWeaver 7.02](https://help.sap.com/docs/SAP_NETWEAVER_702/fe1a4b276c551014b24d80fe2b500e38/940e46d361b6417d805cdb8062ca40e9.html)
and [ABAP Platform 2025](https://help.sap.com/docs/ABAP_PLATFORM_NEW/ba879a6e2ea04d9bb94c7ccd7cdac446/940e46d361b6417d805cdb8062ca40e9.html).
A shared boundary-aware URI matcher is available for the SAPActivate follow-up.

Kept uncertain creation for backend “already exists” errors: the backend text can
be localized and a readback is still needed to establish the current object state.
Did not generalize DDIC namespace collisions without supporting live evidence.

Implementation review and final validation: build, typecheck, lint, policy,
file/schema budgets and all **6,622 tests in 214 files** passed. Updated the transport
logger regression to assert package/status only, without raw SAP error details.
No tool schema or snapshot changed in this round.

Compiled CLI live verification: 7.50, 7.58 and 8.16 each preserve `unknown` for the
valid interface after the sibling fails activation, without copying the sibling's
error. Each refuses INTF/CLAS duplicate names in preflight with zero creations.
7.50 also confirms the existing runtime-collision manifest and successful three-interface
dependency activation. Readback verified active shells versus inactive source; every
fixture was deleted and confirmed absent. Sanitized evidence:
[round-2 live results](../research/2026-09-15-batch-preflight-review-live.json).

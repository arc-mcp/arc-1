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
response are compatibility controls.

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
3. Bound batches to 100 entries in both tool schemas. This
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

## Live facts and recovery boundaries

| Release | Scenario | Outcome |
|---|---|---|
| 7.58 | Twelve independent programs | Created successfully; no general ten-object backend limit established |
| 7.58 / 8.16 | Later invalid entry | Zero creations; preflight refused the batch |
| 7.58 / 8.16 | Activation failure after writing source | Creation and inactive source retained; manifest reported persistence |
| 7.58 / 8.16 | Thirty dependent interfaces, deferred activation | All active sources read back successfully |
| 7.50 / 7.58 / 8.16 | One valid and one broken interface | Valid member remained unknown; only the broken member received its error |
| 7.50 / 7.58 / 8.16 | INTF and CLAS with the same name | Preflight duplicate refusal, zero creations |
| 7.50 | Existing-object runtime collision | Manifest preserved confirmed and unknown outcomes |
| 7.50 | Three dependent interfaces | Deferred activation succeeded |

All disposable fixtures were deleted and their absence confirmed. These observations
establish the tested scenarios, not the customer's exact first failing request.

Single and batch create share transport preflight. All `$` packages skip the CTS
lookup, following SAP's [local-package definition](https://help.sap.com/docs/ABAP_PLATFORM_NEW/ba879a6e2ea04d9bb94c7ccd7cdac446/940e46d361b6417d805cdb8062ca40e9.html).
Safety and HTTP 401/403 errors refuse both paths; other lookup failures retain the
compatibility fallback. Package authorization and write guards still apply.

A backend "already exists" error does not establish the current source state and
can be localized. Keep creation unknown until readback. Global activation messages
appear once, separately from each object's diagnostic. Human output is bounded;
the manifest retains every entry and uncertain persistence state. No automatic
rollback, overwrite or guessed DDIC namespace rule is introduced.

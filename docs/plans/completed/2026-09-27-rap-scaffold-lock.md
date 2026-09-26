# RAP scaffolding: preserve edits made before lock acquisition

## Root cause and scope

Both `scaffold_rap_handlers(autoApply=true)` and `generate_behavior_implementation`
read class source and calculate replacement includes before taking the class lock.
A colleague can complete a change in that interval and have it overwritten. A stale
worklist is not needed. Source hashes from #853 do not apply to these actions.
A lock also does not make separate include PUTs atomic: a later failure can leave
an earlier include saved, while the current handlers skip cache invalidation.

## Implementation

Both mutation paths lock before serial, uncached reads of MAIN/CCDEF/CCIMP and
scaffolding. Only 404 means an absent optional include. Previews stay lock-free;
activation remains after unlock. Unlock failures surface, and attempted writes
invalidate source caches even when a later save or unlock fails. No transaction
abstraction, rollback, new configuration, tool parameter or schema bytes.

## Review constraints

Use the existing class read, scaffold transforms and stateful lock lifecycle.
No new tool/configuration, cross-call lock, transaction abstraction or schema bytes.
BDEF is input to scaffolding, not modified or locked by this operation; concurrent
BDEF changes can still require a new scaffold/activation attempt.
ARCH-03 is removed from the roadmap after fixing both paths.

## Verification — 2026-09-27

The dispatcher harness first reproduced overwritten edits on main for both actions
(10 failures, 2 preview passes). It also covers locked read/lock/PUT/unlock failures,
partial include persistence, cache invalidation, absent includes and no-op reruns.

Live on SAP_BASIS 758 and 816: disposable TABL/DDLS/BDEF/CLAS stacks, with a second
client's include update awaited immediately before the tested LOCK. Both actions
preserved that update, inserted the requested stub, and allowed a subsequent lock.
All eight objects were deleted and their metadata returned 404. Live generation
used inactive sources with activation disabled; multi-include failure cases are
simulated unit regressions, not natural SAP failures.

Full unit suite and typecheck/lint/policy/sizes/build/strict docs pass. The live
harness and red/green logs are retained with the review handoff outside the repo.

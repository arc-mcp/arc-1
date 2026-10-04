# Preserve intervening edits in edit_unit

## Root cause

`edit_unit` reads and splices source before `safeUpdateSource` acquires the SAP
lock. Another writer can finish between those operations; the subsequent PUT
silently restores stale surrounding source. Independently, a missing/stale/failed
inactive worklist can select active source over an existing draft. Both defects
predate #597's lint correction.
The dispatcher reproduction confirms success while losing another FORM's edit.

#586 puts source reads inside a lock, but also adds a generic transform API,
conditional cache reads, content editing and unrelated features. Its source-version
choice still occurs before the lock and may consult a stale inactive-object list.

## Plan

1. Verify source-version behavior on an owned live SAP object with distinct active
   and inactive source. Keep version selection and fresh reads inside the same
   stateful lock session as the write; never rely on cached draft absence.
2. Keep the implementation local to `edit_unit` using existing lock/read/write/
   unlock primitives. Preserve package gates, release-aware splice/lint, the
   optional SAP syntax check, transport propagation and existing output.
3. Always unlock after read/splice/lint/write failure; do not PUT after validation
   fails. Invalidate caches after an attempted write, including uncertain failures.
4. Regression-test an intervening edit, inactive drafts, stale cache, denied
   writes, refusals and cleanup; preserve #597 release tests. Run local checks,
   live disposable-object verification and a combined check with the create fix.

## Verified source contract

On a4h SAP_BASIS 758, a locked PROG with distinct active/inactive text returned:

| Source query | Returned text |
|---|---|
| no `version` | inactive draft |
| `version=active` | active source |
| `version=inactive` | inactive draft |

The implementation therefore omits `version`, makes an unconditional `no-cache` GET
after locking, and does not need the inactive-list resolver or its failure fallback.

## Scope

No generic transform/caching API, edit_content, line-range reads, insert-unit
feature or FUGR auto-discovery. #586 retains its remaining proposed features.
No roadmap item covers this correctness defect; no roadmap impact.

## Live validation

Live a4h/758, client 001, direct HTTPS Basic: two clients using the same test user;
the second client completed a draft change immediately before the first acquired
its lock. `edit_unit` preserved that change despite caches primed beforehand.
A subsequent unit edit accumulated on the draft; active source stayed unchanged.
Malformed replacement was refused and another client could immediately re-lock.
Standalone and function-group INCL create→activate→draft→edit→read checks also
preserved surrounding draft text. All disposable objects were deleted, with include/
program metadata 404 confirmed. Other releases/auth routes remain untested live.

Follow-up: class-method/definition surgery still selects a version and reads source
before locking (`write.ts:fetchClassStructureAndMain`, `write/class-surgery.ts`).
The same stale-worklist/concurrent-edit risk needs a separate fix that also keeps
class-structure ranges consistent with the locked source. This PR is limited to
`edit_unit`.

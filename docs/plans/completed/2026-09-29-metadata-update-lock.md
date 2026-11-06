# Metadata updates under the SAP lock

## Root cause

Metadata updates read and merge a full XML replacement before `safeUpdateObject`
acquires the lock. A save between that read and the lock is silently overwritten.
DOMA reproduces on main; draft #877 inherits the same path for ENQU. DTEL, MSAG,
and SRVB share it; SKTD builds its replacement envelope before locking too.

## Plan and review

1. Reproduce each family through the dispatcher, with a competing save completed
   before LOCK succeeds. Assert preserved content and reads in the locked session.
2. Reuse existing readers/builders through a scoped stateful AdtClient facade.
   Keep safety and identity intact; do not mutate the request's shared client.
3. Keep the metadata update lifecycle in one small handler: lock, read, merge,
   PUT, unlock. Retain package checks before locking, transport fallback, and
   invalidate caches after attempted writes, including uncertain failures.
4. Keep SKTD dry-run read-only and unlocked. A preview is not a reserved snapshot.
5. Check negative paths, existing metadata preservation and live disposable-object
   updates when available. Verify #877's added reader works with the same fix.

TTYP uses the same handler but does not currently read/merge stored metadata;
its replacement semantics are unchanged.

No new input, transaction framework, schema or auth setting is needed. A lock
protects the merge only if its reads use the same SAP session. Caller-supplied
whole replacements remain replacements; this fix preserves omitted fields.

Roadmap checked: no existing item covers this defect; no roadmap impact.

## Outcome

The five read/merge paths now read through an isolated stateful client after LOCK.
TTYP still uses its existing full-replacement contract. SKTD validation may briefly
lock before refusing an edit; dry-run remains unlocked. Failed reads never PUT;
attempted writes invalidate caches even when PUT or UNLOCK fails. The Update gate
runs before LOCK; SKTD dry-run remains available with writes disabled.

Local regression tests fail against the old handler and pass with the fix. The
full suite passes, as do typecheck, lint, policy, size budgets, build
and strict docs. The schema is unchanged.

Live dispatcher reproduction on 2026-09-29: DOMA on SAP_BASIS 758 and 816, direct
HTTPS Basic, client 001. A second session saved a new description immediately
before the first acquired its lock. Updating lowercase preserved that description;
a later update acquired the lock again. Both disposable objects were deleted and
404-verified. This does not establish live coverage for the other metadata types,
BTP or principal propagation. Local evidence retains the tested source SHA-256s.

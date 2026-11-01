# Pinned owner deletion candidate — 1 November 2026

This checkpoint adds an unadvertised native adapter for CLAS/INTF deletion in PR #1142.
It reuses the existing native DELETE and shared owning-session lock/cleanup lifecycle. It does
not yet admit `SAPWrite.delete` to pinned routes or change the single-target deletion handler.
Other object types retain their native prechecks; in particular, PROG/FUGR text-pool checks and
ENHO technology validation must not be bypassed when the supported types expand.

The adapter requires a registered pinned context, global writes, the actual owner package,
destination/server package policies and fresh native recording evidence. It repeats package and
recording checks under the lock. Every request shares the finite cancellation/deadline policy,
with mutation replay and transient retries disabled. Cleanup uses the owning session and its
separate bounded budget. No source hash is required for deletion: the authorization and lock
concern the current owner, as specified in the accepted plan.

A successful DELETE response alone is insufficient. The adapter requires a subsequent uncached
native owner read returning 404. A surviving owner, denied read, network failure or server failure
remains unconfirmed. Definitive DELETE rejections are separate from uncertain outcomes. An
independently confirmed deletion and a failed unlock are also reported separately; callers must
not retry a mutation merely because its cleanup failed.

## Verification

[Machine-readable native evidence](broader-pinned-pp-writes/delete-native-2026-11-01.json) identifies
the candidate source hashes, harness hash and the source base revision. On A4H/client 001, direct
MARIAN authentication created, saved and activated a unique disposable class and interface in
`$TMP`. Native metadata verified name, package, author and creation time, with an exact source
fingerprint. Each deletion returned `deleted`, completed its unlock, and was independently
verified absent. A final cleanup pass confirmed both objects absent. No CTS requests, SAP user
roles, destinations or deployed application settings were changed by this run.

The 30 focused tests cover both owner types, real HTTP-stack DELETE/lock wiring, native absence
readback, failures/uncertainty, cancellation with cleanup, finite non-replay policy, package drift,
CTS restrictions, lock locality and invalid/legacy contexts. The complete unit suite passed
**390 files / 10,788 tests**; typecheck, build, lint and file/schema budgets passed.

This is direct native evidence, not two-user PP qualification. The live fixtures were local;
transportable deletion and negative cases currently have unit evidence. Handler/catalog
admission, live PP qualification and actual Claude Code Opus 5.5 max review remain outstanding.

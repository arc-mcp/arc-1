# Pinned owner deletion candidate — 1 November 2026

This record began with an unadvertised native adapter for CLAS/INTF deletion in PR #1142.
It reuses the existing native DELETE and shared owning-session lock/cleanup lifecycle. At that
checkpoint it did not admit `SAPWrite.delete` or change the single-target deletion handler.
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

## Handler and catalog integration

The following delta admits only CLAS/INTF owner deletion, with `action`, `type`, `name` and optional
`transport`. Source, source hash, include, batch and caller-supplied package fields remain refused.
The adapter runs through ordinary dispatch and an explicit capability row, so read-only callers,
missing exact write grants, read-only destinations/apps, aggregate and shared Basic routes remain
mutation-free. Per-action deny rules remove deletion from the catalog and refuse direct calls.

A shared pinned context/result boundary now serves source writes, deletion and formatter actions.
It verifies the selected target against both policies, preserves per-operation finite budgets,
uses request cancellation and reports the selected target/request correlation. Any pinned marker
in SAPWrite selects the guarded path; incomplete state cannot silently select legacy writes.
Source-save/activation behavior remains separate. Native deletion evidence above still qualifies
the same low-level adapter; the new integration needs its own PP run and Claude acceptance.

Integration adds 23 handler tests and eight route/catalog cases, including exact write-grant,
destination, raw scope, global, aggregate and Basic refusals, deny rules, context mismatch,
cancellation propagation and result correlation. The full suite passed **391 files / 10,819 tests**,
with typecheck, build, lint, file/schema budgets and strict documentation build. The source budget
and non-replay tests, existing source lifecycle and formatter tests remain green after consolidation.

## First production review and corrections

Actual Claude Code `claude-opus-5-5`, effort `max`, CLI 2.1.302 reviewed immutable revision
`96dfc4e6b734667c46d284d45c3a37dbc1460e9b`. Its [report](broader-pinned-pp-writes/claude-adapters-review-20261101.md)
refused acceptance: two High findings, one Medium and three Low. Corrections preserve legacy
single-target dispatch on overlap deployments; reject meaningful raw fields before normalization
can drop a deletion include selector; and make source optional in the mixed-action catalog while
retaining runtime create/update requirements. Native absence now requires a typed resource-not-found
response and excludes classified service errors. Failed deletion retains its original phase/status,
with separate cleanup details and inspection guidance. The operator guide documents the deletion
opt-out. Regression checks cover each behavioral defect, including actual advertised-schema validation.

The accompanying [harness review](broader-pinned-pp-writes/claude-qualification-review-20261101.md)
accepted direct-native deletion only as a MARIAN happy-path fixture exercise. Its independent absence
read used the same endpoint, account and client stack; no TADIR cross-check was performed. The old
receipt did not gate active version or record changedBy, and its cleanup branch was not fault-tested.
These limits are not retrospectively erased. Fresh two-writer CLAS/INTF deletion and formatter evidence
on the corrected revision, including stronger actor/backend binding, remains outstanding.

Validation of the review corrections: **391 unit files / 10,843 tests**, typecheck, build, lint,
file/schema budgets and strict documentation build passed. No candidate deployment occurred during
this correction loop; the test app and temporary SAP/IAM access remain restored.

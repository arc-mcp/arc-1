# Pinned class-local includes — implementation checkpoint

PR #1142 now implements `SAPWrite.update` for CLAS `definitions`, `implementations`, `macros`
and `testclasses`. Code review and live native/two-writer PP qualification remain pending for
this addition. The earlier [combined run](2026-11-01-broader-pinned-pp-writes-combined-qualification.md)
does not qualify these paths or their initialization behavior.

## Shared protocol and policy

`adt/class-include-write.ts` owns the existing include read/initialize/save protocol. `crud.ts`
retains its compatibility export and legacy signature. Single-target callers keep optional hashes,
their legacy missing-resource behavior and transport fallback. Pinned calls provide a registered
mutation context, finite non-replayable request policy and mandatory owning-lock policy.

`write/pinned-lock.ts` factors the existing package/recording recheck out of the main-source adapter.
Both main source and includes use it: resolve the real class package and recording before locking,
lock the class, revalidate both policies and the lock's recording evidence, then touch source.
An include belongs to this exact owner. A verified parent request is used for both initialization
and saving; a pinned save cannot fall back to the lock's task ID.

Existing includes require the exact hash returned by `SAPRead(format="editable", include=...)`.
The helper reads again under the lock. Hash omission only permits initialization when that same
read reports typed `ExceptionResourceNotFound` without a service-resolution classification.
Generic HTML, untyped/service 404s and disappearance with a supplied hash refuse initialization.
There is no invented hash for a missing include.

After saving, exact editable readback must match, allowing only CRLF normalization and terminal
line breaks. The returned hash uses SAP's actual bytes. An explicit empty include replacement is
preserved through normalization for both single-target and pinned dispatch. Other actions retain
their missing/empty-source rules. Saving never activates the class automatically.

## Admission and outcomes

The capability table admits only the four explicit selectors on CLAS update. Create, delete,
INTF, main/text-symbol selectors and include-based surgery remain refused. Raw selectors are
checked before legacy normalization can drop an inapplicable include and broaden the request.
The pinned catalog and instructions describe this boundary.

Results distinguish unconfirmed or rejected initialization from a confirmed initialization followed
by an uncertain/rejected source save. `initialized` is omitted until initialization status is known;
a later PUT failure retains the created-include state and never triggers automatic deletion.
Unlock/session cleanup uses the shared owning-session lifecycle and reports cleanup failure separately.

## Checks and next evidence

The full unit suite passed 396 files / 10,924 tests; build, typecheck, lint and file/schema budgets
passed. Focused tests exercise all four selectors, exact hashes, typed absence, initialization,
parent request mapping, changed package, partial outcomes, no replay, cancellation and cleanup.
Legacy compatibility and explicit empty replacement are also exercised. These are mocked HTTP
tests, not SAP or PP evidence.

Before treating this family as qualified, review the immutable implementation and run both mapped
writers against disposable classes: native initialization/absence behavior, successive include hashes,
whole-owner activation, active/editable native readback, actor binding and complete fixture cleanup.
Keep existing reader/destination/aggregate/Basic denials and the broader PR's pending families explicit.

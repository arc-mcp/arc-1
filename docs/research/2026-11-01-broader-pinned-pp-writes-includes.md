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
line breaks. The returned hash uses SAP's actual bytes. Exactly `source=""` with an existing include hash is preserved through normalization for both
single-target and pinned dispatch. Empty source without a hash and whitespace-only source are
refused, preserving the existing protection against optional-field pollution. Other actions retain
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

## Read-only native protocol probe

At 05:15 UTC, direct reads on A4H/001 returned `text/plain` for all four include kinds of
`CL_ABAP_CONTEXT_INFO`. Both `CX_ROOT` and `CL_ABAP_CHAR_UTILITIES` had readable class metadata
but returned HTTP 404 / `ExceptionResourceNotFound` for `testclasses`, without a service-error
classification. The [sanitized observations](broader-pinned-pp-writes/include-read-contract-20261101.json)
contain response metadata only; no SAP source bodies or credentials are published.

This supports the strict absence predicate against existing class owners. The probe acquired no
lock and sent no mutation. It does not qualify initialization, saving, PP identity or cleanup.

## First Opus review and correction

The [verbatim Opus 5.5 max review](broader-pinned-pp-writes/claude-includes-review-20261101.md)
reviewed immutable revision `cc34bbd6b`; all 2,568 snapshot hashes matched before and after.
It found one Medium issue (blank source without a hash could clear a single-target include)
and three Low coverage gaps (positive route preparation, recording drift and failed unlock).
The correction requires an exact empty string plus a hash for clearing, rejects whitespace-only
source, and adds those regression cases. It also documents the single-target clear contract.

The reviewer ran all 37 previous offline simulations. Its focused Vitest command failed during
argument parsing, so it ran **zero unit tests**; its typecheck failed on `.mjs` resolution inside
the `node_modules/.cache` snapshot. Those are not test passes. The next review uses
`--silent=true` and a snapshot outside `node_modules`, and must review the new include harness
before any live run.

## Include qualification harness

The combined qualifier now exercises both writers' existing temporary class fixtures before
whole-owner activation. For each of the four include kinds it checks initial/existing writes,
missing/stale-hash refusal, explicit clearing and final source restoration. A failed preliminary
MCP read is not absence evidence: only the writer's typed native absence check can authorize
initialization. The first independent ownership receipt is captured after activation and includes
all eight active/editable include hashes. Subsequent native checks and cleanup compare those
hashes too, including under the class lock. Incomplete ownership evidence or a foreign include
draft visible to the primary native reader preserves the fixture for investigation. This does not
prove visibility of every other SAP user's inactive drafts. The original ownership receipt is never replaced.

The harness remains offline-only until reviewed and run against a new, clean source revision.
Transportable include initialization still requires a separate qualification; this fixture run
uses `$TMP`.

The stale-hash case reuses the first save's real hash after the second save. The journal records
which include kinds were initialized. Missing initialization coverage fails qualification without
stopping the remaining cleanup; it is never reported as a successful initialization test.

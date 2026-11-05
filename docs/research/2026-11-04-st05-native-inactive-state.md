# ST05 native inactive state and private write safety

The captured A4H/001 SAP_BASIS 758 implementation establishes a narrower contract than the earlier synthetic filter-preservation model. This correction changes the pinned adapter; the ordinary single-target setter remains separate.

## Primary evidence

Private, read-only packet: `/Users/marianzeis/.local/state/arc1-review/pr1142-st05-enho-native-handler-sources-20261104`. Source basis is `a72c40eec6c767377e4b4ed747692f062ae4558f`.

- `002.json`, receipt SHA256 `e8e3f5913086144ef98f65a4dfdf666bbc9f896e70b43ced289103c01f72247e`, payload `0e7fdbefac7349ee65257384daa06e1859458145390fbb049d2a858c5c65356b`: `CL_ADT_ST05_TRACE_STATE` PUT, lines 87–94, clears all seven non-SQL trace flags before the native setter.
- `003.json`, receipt SHA256 `7210652759409cb2bc52bf2dff97de93c49846279455cd7ed04a89e6d2f3973d`, payload `31c5087824c5296b3b523d0e1cef57833e7c04c8aed0d189b1415a406f9c48dc`: `CL_ADT_ST05_KERNEL_INTERFACE`, lines 59–105, exposes initial filter and non-stack property values when tracing is off. Lines 365–374 pass initial TST21 to OFF; stack state is separately written/read at 388 and 395–396. The captured kernel does not use `isSelected` as a write-selection boundary.

Raw proprietary implementation remains private. This is source-backed A4H behavior, not a universal release qualification or a new native execution result.

## Pinned correction

A fresh native document is still read and submitted at most once. A valid no-op sends no PUT. If a write is needed, any active non-SQL flag on any listed instance refuses before submission, even when its user matches and `isSelected` is false. Namespace-bound structural validation requires all eight exact boolean flags and prevents foreign, duplicate, missing or nested fields from hiding an active trace. Global write/context, exact target, scope, deny, ETag, body, deadline and no-replay gates remain unchanged.

The outgoing body edits only SQL state and, when arming, the explicit user. Native OFF may clear the known filter fields and reset `includeMissingTableNameOn`/`authErrorsOnly`; empty included/excluded table selections stay empty. `stackTraceOn` and all other qualified opaque state must survive readback. An explicit unknown filter/property or an unqualified nonempty table-list representation refuses before OFF; numeric-reference serialization is also outside this private representation to avoid legacy-parser semantic collisions. Ordinary named-entity escaping and literal entity-looking opaque text remain distinguishable. No unknown subtree is silently excluded.

Post-OFF success requires all instances off, empty users and the exact source-proven inactive projection. A changed instance set, retained filter, changed stack/opaque field, unsupported shape or failed readback remains unconfirmed; nothing is replayed or compensated automatically. The result no longer promises that OFF preserves a filter. Without a strong native ETag, concurrency is still explicitly `native-unconditional`; a pre-read is not a cross-writer lock.

## Remaining qualification

The previous qualifier's inactive MARIAN filter is not achievable through the captured native getter. A fresh representative should start with all trace types disabled and an empty filter, arm MARIAN, then disarm and verify the original inactive projection. Native OFF supplies restoration; a third operator restore PUT is unnecessary. The three already completed runtime stages must not replay. A new fixed one-stage continuation and independent actual-history audit are separate work; no old claim is reset, and this source correction alone grants no native, PP, public or merge approval.

## Ignored-node shape follow-up

Root's independent inspection of `232a7aa63e865c2f4519555ca66f50c3aa517fdd` found that dropping a whole native modification/locality node could hide opaque attributes or descendants. Fourteen real-handler counterexamples reproduce that gap (attributes, descendants, duplicates and invalid booleans); the two optional/empty scalar controls pass. The follow-up validates any present ignored modification value as exactly one scalar and any present locality/selection value as exactly one boolean scalar before projection. Foreign-namespace siblings remain compared. This is a separate correction; the original checkpoint and failing probes remain preserved. It does not change the ordinary setter or authorize any historical protocol execution.


## Qualification observer correction

The common private observer now requires an all-off, empty-user baseline whose resettable
fields already equal the source-proven native inactive defaults. It permits the independent
stack setting and preserves it. The two authorized writes remain ON(MARIAN) then OFF;
submission retains the selected user, while OFF readback must have an empty user again.
The complete unrelated projection and instance identities must match the initial baseline.
There is no third restoration attempt after an uncertain response. Historical claims and
intents remain consumed; this source correction does not reopen any old phase.

The actual a72 run independently confirmed quickfix/class cleanup, own-user profiler
cancellation and populated CUST FLP completion; ST05 made only one GET and refused the old
impossible off-plus-MARIAN prerequisite. A new fixed ST05-only continuation remains separate.
Profiler parameter retention, native CTS recording and generic FLP read absence remain
explicitly unverified. This is not PP/public admission.

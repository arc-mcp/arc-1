# Private native-governed V4 publication alternative

This candidate adds an internal alternative to the [non-recording publication profile](2026-11-03-pinned-v4-publication.md).
It does not admit a public tool action, enable a native fixture, implement V2 or establish cloud/PP
parity. The non-recording profile remains separate and still requires trusted current-principal
branch/category evidence. Its missing production configuration reader is not a prerequisite for
this different native-governed contract.

## Contract and bounded source evidence

Already captured active standard sources establish the synchronous on-premise 758 V4 REST action,
its selected binding argument, native validation and conditional cloud-mode BAdI dispatch. The
on-premise branch is non-recording. The cloud-mode branch is selected by system configuration or
a native user parameter; it may invoke the installed native implementation. The API receives a
binding identity, not caller-selected ABAP code or an arbitrary resource URL. ARC-1 retains native
SAP authorization as a boundary; it does not recursively prove every SAP-side implementation.

The native-governed alternative requires **explicit unrestricted `*` in both effective server and
destination request lists**. This proves membership for any request/task the native operation may
select. It proves neither recording, non-recording, a specific request, ownership nor SAP authority.
Missing/empty/narrow/malformed/deny-all lists refuse. Unknown native selection cannot expand these
lists or require a made-up request-selector API. The shared strict predicate is also used by the
private FLP profile without changing its behavior. Recording remains separate from transport
management: no additional transport-management switch or functional scope is imposed.

The native REST result has important limits. An unbound cloud-mode BAdI can perform no action and
still return native `OK`; its returned publication boolean is not consumed. Cloud-mode metadata
URLs depend on test-catalog assignment for native version 0001, whereas the on-premise getter depends
on frontend group publication. A caught native error can also yield a false publication flag.
Therefore this profile reports matching results as `native-state-observed`, not frontend availability
or all-alias removal. An acknowledged no-op with a mismatched getter stays `acknowledged-unverified`.
A matching initial flag cannot establish completion or skip an explicit job. Both private profiles
submit that job once through the existing guards, then evaluate its native status and readback.
The [review corrections](2026-11-03-pinned-publication-native-governed-corrections.md) preserve the
original findings and their synthetic reproductions; they add no native qualification.

The private assessment's SHA256 is
`b850bf846295b1093bdad6a23106a402da04a2fbea7362a368d0e6ea1ce319df`.
It binds the integrated source and verification of 37 existing native payloads. No proprietary
SAP source, new native response fixture or personal identity is added by this change. The UIConfig
lead was exhausted: HTTP 200 with zero bytes and an inherited empty implementation cannot establish
current configuration. This alternative makes no configuration assertion from it.

## Shared implementation and final-send guards

`handlers/pinned-publication-native-governed.ts` accepts only a registered internal mutation context
and invocation scopes. It checks raw write/read permission, strict PP, attribute authorization,
selected target/client, the exact policy object, global/destination write ceilings and action denials.
It retains the original request context/signal and refuses package-policy changes during asynchronous
waits. Effective target grants still come from the existing selected-target runtime builder. The
internal coverage restriction is the reviewed on-premise 758 V4 route; a release label is not native
or PP qualification, and an unknown release refuses.

`publication-recording.ts` registers context-bound profiles in a private registry. No caller field,
cloned object or unrelated context can mint authority. The existing executor performs full raw batch
validation and all owner/package/membership preflight before any job. It still accepts only 1–10 distinct
bindings and at most 100 native membership entries per binding, with exact editable/active agreement,
metadata hashes and no coexisting draft. These existing conservative limits remain parity gaps.

Every request shares cancellation, a maximum five-minute call deadline, 4 MiB all-response allowance
and a 128-attempt ceiling, charging any stricter parent allowance too. At the direct/Connectivity send
boundary, after authentication and semaphore waits, the guarded attempt allowance rechecks policy,
context, target, invocation and package-policy stability. The final native membership lease starts
**before** fresh metadata reads and expires after 30 seconds. The existing shared sender carries its
original absolute expiry into the job deadline; asynchronous work cannot renew it. Package metadata
may still change after observation; this is not a lock or atomic SAP snapshot.

The single-use sender sends one binding reference and one POST, consumes authority before awaits,
and never replays HTTP 421, 401, 406/415, transient/native errors or uncertain responses. The non-recording
profile retains its own configuration-based expiry and results; ordinary single-target defaults and
legacy MIME negotiation are untouched. The `submitted` counter retains the shared executor's
conservative job-invocation accounting: transport admission may fail after invocation but before a
wire send. It must not be interpreted as proof that SAP received every attempted job.

## Outcomes, tests and remaining gates

Native `ERROR`, malformed status and failed readback retain explicit failed/unknown outcomes.
Later batch failure preserves earlier observations and leaves later owners unattempted. Native-governed
results say recording is unverified, failures may have CTS effects, and no compensation is attempted.
An `OK` plus matching native metadata does not provide a CTS receipt or confirm consumer access.
Both private handler boundaries omit native short/long diagnostic text when `minimalErrors` is
enabled. Native severity, submission/partial states and structural observations remain available;
the complete executor result is retained unchanged internally.

Offline tests use real shared HTTP with a MockAgent that disables external connections and a mocked
Connectivity client. They cover successful publication/unpublication, both policy intersections,
raw grants/runtime projection, owner/hash/package drift, all-before-first-write batch authorization,
original freshness through actual queue/auth waits, policy narrowing at those boundaries, cancellation,
response/attempt bounds, native no-op/error/unknown outcomes and partial batches. Existing publication,
FLP, low-level legacy and public-closure regressions remain applicable. Mock responses are not new
native evidence.

The generated-owner CRUD guard remains closed. No child deletion, dependency cascade or compensation
is added. A reviewed owned lifecycle must establish the selected native cleanup route and distinguishing
absence evidence, then qualify publication status/metadata and recording under actual native/PP
identities. Public admission, narrower-policy native selection, actual configured BAdI behavior,
other platform/release variants and coexisting drafts remain separate gates. This candidate is ready
only for independent source review after its offline checks pass.

## Independent correction review

[Exact-source re-review](2026-11-03-pinned-publication-native-governed-review2-verbatim.md) approved private integration of the composite candidate at `412e10b78e47845fe10c54e4eb42c59815b912ae`. All eight original external probes now pass, along with 397 affected tests, three TypeScript projects, lint, policy and size checks. All 4,749 snapshot files remained unchanged. The matching-getter skip and minimal-error diagnostic leaks are closed. Native lifecycle, generated-owner cleanup, current-build PP and public admission remain open.

# Private synchronous V4 publication candidate

This follow-up implements a publicly closed on-premise V4 executor. It does not enable public
publication, provide a production native-configuration reader, authorize a native fixture, or
complete native/two-writer Principal Propagation qualification. No new setting, schema field,
role, transport permission or caller assertion enables the executor.

## Source contract and limits

Private active standard-source captures from A4H client 001, supplied Basic user MARIAN,
SAP_BASIS 758 SP02 establish a synchronous native V4 action. The publish/unpublish REST resources
accept a binding reference, invoke the action inline and return ASXML status; there is no job
polling contract. The action selects the complete active binding. The requested version remains
a validated selector; it does not limit changes to that version. Unpublication affects the whole
group and its alias assignments, including other consumers.

The identified on-premise publish path passes the native non-recording flag and local alias;
unpublish derives non-recording from its empty transport argument. Publication itself therefore
does not require a fabricated CTS request, transport-management scope, nonempty request list or
`$TMP` package. Repository CRUD and activation retain their separate package/CTS requirements.
The native cloud branch is selected by either system configuration or the current SAP user's
`SAP_CLOUD_PLATFORM` parameter. Customizing clients are refused through T000 category `C`.
A release number, target label, cloud/on-premise setting or source capture alone cannot establish
those current-principal facts.

`PublicationConfigurationReader` is an internal integration contract, not a tool input. A trusted
native reader must establish the source-qualified contract, exact target/client, current SAP
principal, both branch inputs and actual client category on the request-owned client. The
executor requires fresh evidence before preflight and again before each submission, refuses
branch/category/principal drift, and does not infer facts from another user's session. **No
production implementation of this reader is installed.** The offline tests provide explicit
mock evidence only. The future reader needs review and real current-principal evidence before
execution can become reachable.

## Shared sender and private lifecycle

`service-publication.ts` contains the existing single-target sender, re-exported from
`devtools.ts`. Single-target defaults, response parsing and MIME negotiation are unchanged. Both
legacy entrypoints now explicitly refuse multi-target policy without a registered private profile.
A private profile is single-use, bound to the exact mutation transport, safety/context, action,
binding and version. It sends one reference using the qualified ASXML MIME on the first request;
406/415, timeout, native error, uncertain response and malformed status cannot trigger the legacy
second POST. No compensating publication or rollback is attempted.

The internal handler retains write/read scopes, strict PP, exact selected-target policy,
attribute authorization, action denials and server/destination write ceilings. Every native binding
is checked against both package policies. It uses the shared cancellation/deadline/no-replay
transport with one cumulative all-response allowance, at most 4 MiB and five minutes. There is
no synthetic repository lock or claim that publication is atomic with the metadata/configuration
reads. This native action does not expose a proven owner-lock/If-Match publication contract.

The private batch contains 1–10 distinct binding names. It validates all raw inputs and
preauthorizes every owner, actual package and complete active membership before any POST.
Each selected binding is revalidated immediately before its one request, after asynchronous CSRF
preparation has completed. Its configuration observation expires after 30 seconds; the job request
uses the earlier of that original expiry and the overall deadline through HTTP queueing,
authentication preparation and the send. Waiting cannot renew the evidence or replay the grant.
The shorter job deadline does not change the owning context or cleanup allowance. Multiple native
services and versions are included in the observed scope (at most 100 distinct service/version pairs);
two services may share a selected version. Repeating a binding with another version is refused.
The existing conservative active/editable agreement and no-inactive-alternative requirements
remain explicit parity gaps; the native source does not itself require absence of a draft.

Results preserve each binding's submitted state. HTTP success alone, missing/unknown severity,
or a false metadata fallback cannot turn an error into success. A native `ERROR` stays
`native-failed`; a lost/unparseable response stays `submitted-unconfirmed`; an `OK` status followed
by failed or changed readback stays `acknowledged-unverified`. Confirmation requires matching
active owner/membership/opaque metadata and desired reported publication state. A native false
flag is not an exhaustive generated-state absence proof. Following the
[shared executor review correction](2026-11-03-pinned-publication-native-governed-corrections.md),
a matching initial flag also cannot skip the explicit job: it still passes the original guarded,
single-use sender. Later failure retains earlier outcomes and leaves remaining items unsubmitted;
the batch is not atomic. Both private wrappers project native short/long diagnostics out of
minimal-error responses while retaining native severity and the unchanged internal result.

## Generated state and remaining qualification

`bindingCreated` describes generated implementation existence. It is different from the
individual V4 resource's `created` field and from `published`. An unpublished generated binding
can be legitimate. Generated objects owned by the native binding lifecycle are distinct from a
shared SRVD or unrelated dependency. **This change leaves the current generated-binding delete
guard unchanged.** No guessed child DELETE or broad cascade allowance is added.

Further private source captures bind SRVB/SVAL to `CL_SRVB_OBJECT_PERSIST`, the binding URI and
`CL_SRVB_WB_ACCESS`; the latter inherits the generic blue access class. The concrete plugin
resource delegates DELETE to bound persistence. One registration detail remains to be reconciled:
the SRVB additional-links override imports the superclass metadata but not its owner-template
output. A separate default registration path or selected-endpoint evidence must settle that
precise path before treating it as a qualified cleanup route. This is source inspection, not a
native DELETE result or a demand to prove every native helper recursively.

Next work: independently review this candidate; implement and qualify the trusted current-user
configuration reader; prepare a reviewed owned publication fixture with generated ownership,
selected-endpoint deletion and discriminating post-cleanup evidence; qualify actual request MIME,
status/readback and races on supported releases; run current-code two-writer PP and denied-grant
cases. V2, cloud/BAdI, coexisting drafts and other unqualified contracts remain unsupported here.
No source capture or passing mock test admits them publicly.

## Independent correction review and integration

The [first independent review](2026-11-03-pinned-publication-review1-verbatim.md) found that a
30-second configuration observation could expire while the actual HTTP request waited for its
semaphore or authentication. Correction `4bd4a4c86864c6e5cbe499e85d0cd521129fe4f6` carries that
original expiry into the one job request's deadline. The
[second review](2026-11-03-pinned-publication-review2-verbatim.md) passed 277 affected tests and
13 independent expiry/budget controls; its original delayed-send reproduction now sends zero POSTs.
All source/test bytes of the corrected candidate match the integrated revision `6a229e8cd`.

The [combined integration checkpoint](2026-11-03-pinned-integration-checkpoint.md) records passing
checks. This closes the private implementation review only. The production configuration reader,
native lifecycle/generated-owner cleanup, public admission and current-build PP remain open.

## Separate native-governed alternative

A later [private alternative](2026-11-03-pinned-publication-native-governed.md) uses explicit unrestricted
request policies at both layers and reports recording as unverified. It reuses this executor and
single-use sender without claiming the native branch is non-recording. This does not remove the
configuration-reader requirement from the stronger profile documented above or admit public calls.

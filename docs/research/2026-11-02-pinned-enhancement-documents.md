# Private ENHO and SKTD document profiles

Date: 2026-11-02. Author baseline: `5884adc722f5dba8f85cd6c425b51840b4785880`.
This is an offline implementation candidate for the accepted broader pinned-PP plan, not a
native qualification receipt or public capability admission. Aggregate, shared Basic, Copilot,
read-only applications and read-only destinations keep their existing mutation refusals.

## Contract and shared implementation

The private entry is `handlePrivatePinnedDocumentWrite`; private activation uses
`handlePrivatePinnedDocumentActivation`. Neither is registered as a public tool handler.
The existing public capability matrix and machine inventory remain closed for these resources.

| Profile | Candidate behavior | Existing contract evidence |
| --- | --- | --- |
| ENHO/XHB, technology BADI_IMPL | Empty-container create followed by one locked metadata save; metadata update; exact-owner delete and preaudited activation | [ENHO native contract](2026-10-07-enho-xhb-write-contract.md) and [type evidence](abap-types/types/enho.md) |
| SKTD/TYP, including KTD alias | Native parent-reference create, read generated nodes, optional locked Markdown/short-text save; update/dry-run, exact-owner delete and preaudited activation | [Multi-node](2026-09-02-sktd-multi-node-write.md), [short texts](2026-09-04-sktd-short-texts.md), [routing review](2026-09-08-pr766-ktd-routing-review.md), [SMBC parent](2026-10-07-ktd-smbc-parent.md) |

The profiles reuse `createObject`, `updateObject`, `withLockedMutation`, `deletePinnedOwner`,
`pinnedRecording`, `validatePinnedLock` and the existing activation engine. ENHO reuses the
legacy JSON definition parser, merge, filter resolver and XML builder; an optional strict spot
validation callback leaves the ordinary legacy path unchanged. The existing KTD create body
and reference-type helpers are extracted unchanged into `ktd-create.ts`; update still uses the
existing native document rewrite, routing, short-text validation and report helpers.

A factory-registered context must belong to the exact selected client safety policy. The private
write entry checks the matching target, pinned strict-PP configuration, writes and deny action.
Native package evidence is checked independently against the global and destination package
policies. Source recording uses both allowed-request policies and native parent/task checks;
transport-management opt-ins do not authorize source recording or vice versa. Identity is the
provided mapped-user client, never a guessed IdP name or a technical-user fallback.

The operation keeps one deadline of at most five minutes, 64 dispatched attempts and 8 MiB of
cumulative responses (all statuses), retaining an already supplied allowance only when it is at least as strict; broader or success-only
outer allowances are refused without resetting their accounting. All calls carry no-replay semantics. The owning lock/session retains its separate bounded
cleanup allowance after cancellation or ordinary operation-budget exhaustion. Single-target
contexts keep their existing options and session behavior. The shared facade now forwards an
explicit outer cumulative allowance through nested adapters.

## Native document evidence and preservation

Updates require a private `expectedMetadataHash` of the complete parsed native XML, including
source-bearing text and opaque state. Fresh preflight and under-lock reads must match that hash;
under-lock changes stop before PUT. The native root namespace, name, type, version, package,
reference owner and relevant technology are verified. Creation requires typed ADT absence,
verified parent/spot evidence and post-create identity, reference, package and inactive/new state.
Explicit ENHO description and KTD reference description are checked on readback.

ENHO patches retain unknown root, common, technology and surviving-implementation fields,
attributes and namespaces, including opaque filter trees, example/customizing flags and ABAP
language version. Only selected definition fields are changed; an explicit implementation list
still replaces membership, exactly as in the ordinary handler. Omitted filters remain untouched;
changing a definition with an opaque retained filter is refused. Strict spot evidence must agree
with the lexical declarations consumed by the shared resolver. Internal spots are refused before
create, including for namespaced names.

SKTD reads omit `version` during edits so existing inactive drafts accumulate. Node IDs, reference
metadata, unaddressed texts, obligations and unknown native fields remain in the full document.
The established short-text and heading routing refusals still apply. Private create currently
accepts only verified top-level DDLS/DF, BDEF/BDO, SRVD/SRV, SRVB/SVB, DEVC/K and SMBC/TYP
parent roots; BDEF subobject reference contracts remain unsupported here. SMBC uses the
existing `/sap/bc/adt/bct/smbctyp` native route. Unknown roots or lexical contracts are refused.

Readback compares the entire canonical document, excluding only root version/change bookkeeping
and the native object-state relation; SKTD Base64 text line wrapping is normalized. All other
unknown fields remain significant. Activation requires one exact native owner reference and
consistent pre/post native views; expansion, warnings, stale/ambiguous views or retained inactive
state cannot be reported as confirmed activation. Native normalization of other fields may
therefore leave an honest unconfirmed outcome until separately evidenced.

Creation, save, activation and deletion are never replayed after a rejected or uncertain response.
If create succeeds but the follow-up save/readback fails, the result keeps the created-document
partial state. It does not delete the container to conceal the partial result. Own-session cleanup
failure also prevents an unqualified success claim; result errors use the existing redaction path.

## Offline evidence and remaining gates

`tests/unit/handlers/pinned-documents.test.ts` drives the real ADT client and shared HTTP/lifecycle
code through the established undici mock. It covers preservation, pending drafts, create/save
partial results, metadata drift under lock, independent package/CTS denials, typed absence,
response bounds, shared budget forwarding, cancellation with cleanup, no replay, strict native
identity/spot/refusals and public-admission denial. Existing ENHO/KTD and lifecycle tests cover
single-target compatibility. Before/after regressions also cover consistent inactive-link case handling and retaining a saved-but-unconfirmed result when the readback itself cannot be dispatched. Mocked fetch does not debit a dispatcher attempt budget itself:
forwarding assertions and the existing real transport-budget tests cover those separate layers.
No SAP, BTP, credentials, deployment or native experiment was used for this authoring pass.

The independently reviewed editable-read companion change is not part of this baseline. A follow-up
must extend that shared ordinary-read infrastructure for ENHO/SKTD to return the exact complete
native metadata hash and existing editable representation, using an ordinary read gate rather
than a write-package gate. Do not expose the private write entry or duplicate the read framework.

Before public admission, obtain independent source-bound review and current-code native evidence
for both local and transportable CRUD/activation, both distinct mapped SAP writers, cross-target
and denied-user refusals, exact CTS recording, incomplete/uncertain responses, and cleanup. ENHO
needs classic and cloud BADI_IMPL fixtures with real filters, opaque fields, internal-spot refusal,
post-create behavior and native activation views. SKTD needs real multi-node/inactive-draft and
short-text views, all claimed parent roots, source/reference preservation, exact-owner activation
and typed delete absence. Capture native namespace/identity/state differences explicitly; narrow
unsupported contracts instead of widening the parser from synthetic fixtures. No result here
establishes native, PP, public, or whole-PR readiness.

# Private CDS/RAP source adapters — 2 November 2026

PR 2 now has private native create/update/delete profiles for DDLS, DCLS, DDLX, BDEF and SRVD.
They enter the existing shared creation/source/deletion handlers and use the same owning-session
lifecycle. Public capability admission remains closed; exact-owner activation now has a private profile below; this is not shipped support
or live mutation/PP qualification.

## Native identity evidence

A read-only A4H/001 query selected existing Z objects through bounded ADT quick search and GET
metadata. All five native identity/package shapes were observed. No source was read or changed,
no object was created/deleted/activated, and no permissions or cloud configuration changed.
The probe used the unchanged AdtClient on HEAD `909419f7e` while private adapter work was present
in the working tree; it did not execute those new adapters.

| Type | Native type | Root | Namespace |
| --- | --- | --- | --- |
| DDLS | DDLS/DF | ddlSource | `http://www.sap.com/adt/ddic/ddlsources` |
| DCLS | DCLS/DL | dclSource | `http://www.sap.com/adt/acm/dclsources` |
| DDLX | DDLX/EX | ddlxSource | `http://www.sap.com/adt/ddic/ddlxsources` |
| BDEF | BDEF/BDO | blueSource | `http://www.sap.com/wbobj/blue` |
| SRVD | SRVD/SRV | srvdSource | `http://www.sap.com/adt/ddic/srvdsources` |

The [sanitized fixture](../../tests/fixtures/declarative-owners/native-metadata.json) retains original
identity/package values, timestamps and original-body hashes. Unrelated fields and authors were
removed. This closes the previously recorded DDLX native identity observation gap on this target;
it does not establish behavior on another release or qualify mutations.

Private evidence directory: `pr1142-declarative-metadata-1793623740294` under the local
qualification state directory. Probe SHA-256: `ef2a2fc93a019c673f2b2c166ee197f98d83771bd6c90768f8b1d38b66ef4e7b`.
Authentication was direct Basic with writes disabled, strict HTTPS on port 443, client 001.
Search and metadata each used a 1 MiB all-response budget and a 20-second deadline.

## Private mutation contract

- Explicit uppercase owner selection and exact canonical native path, root, namespace, type and
  own package. Container metadata is refused. Server and destination package restrictions remain
  independent; fresh evidence is required again under the lock.
- Existing updates require a source hash from the exact editable resource. Creates require an
  explicit package and use the existing per-type templates. Optional responsibility is not copied
  from an unverified IdP username. Metadata-only creation reads back the generated source.
- Native package/CTS checks, parent/task validation, source preparation, save/readback and owning
  unlock/close reuse the shared engine. New profiles do not bypass the existing quality checks or
  implicitly activate objects.
- Deletion verifies typed native absence. Creation, save and deletion uncertainty is preserved;
  no automatic retry is claimed safe. A new source stub may remain after a later phase fails.
- Only create/update/delete fields are accepted. Public dispatch rejects all five types for writes
  and activation; private helpers are qualification entries, not a new tool interface.

## Validation and remaining work

The current focused tests replay native identity shapes, independently denied packages, malformed
identities/URIs, stream budgets, under-lock package/identity drift, source-hash refusal, CTS parent
recording, cancellation/cleanup, uncertain mutations and public-route refusal. Create, skeleton
creation, update and delete each run through the shared handler for all five types.

At the original CRUD checkpoint `bd6ecdf87`, author checks passed **492 files / 13,175 unit tests**, all three TypeScript projects, build, policy, lint (three existing infos), file/schema budgets and strict docs. The first full run caught an obsolete DDLS refusal assertion in the lower-level deletion test; DDLS now has a private profile, so the negative case now covers the still-unimplemented DOMA profile. All five new public-dispatch refusal cases remain in place. The full rerun passes. Independent review and current-profile live mutation tests remain required.
Private exact-owner activation now has offline tests; its native qualification, batch activation,
public admission, RAP-generated multi-object workflows and current-code PP/recording-transport
qualification remain incomplete. Other DDIC metadata and server-driven
families retain their own implementation gaps in the accepted PR 2 plan.

## Private exact-owner activation follow-up

The five types now use the existing activation orchestrator through a separate internal grant that
tool arguments cannot supply. Only one exact owner reference can proceed; native name/type and the
deleted marker, when present, must match; another owner, generated expansion or batch is refused. Before each
activation POST, fresh native identity/package, independent CTS policy, complete metadata and source
hashes must agree with the first capture. A changed draft stops native confirmation.

After native success, both default and explicit active metadata must identify the same active owner
and package with no inactive alternative; the explicit active source hash must equal the captured
draft. This proves observed native state and source, not an atomic snapshot or equality of every
metadata attribute after compilation. Metadata is compared completely across preaudit, but may be
derived from source during activation. The result calls this `nativeStateVerified`, not full metadata
equality. Unexpected state-link shapes refuse and still require live qualification.

The common five-minute deadline, cancellation and no-replay rules cover the operation. New metadata
and source reads each have a 1 MiB all-response cap; canonical comparison retains the common namespace,
depth and traversal budgets. Source reads require the exact `text/plain` media type. Later readback
failure preserves SAP's earlier native result and reports activation unconfirmed without retry.

At `70d4e83b`, seventy new tests cover all five positive types, public/private grant and input boundaries, source
and metadata drift, independent package/CTS policies, exact references/namespaces, both activation
phases, native flags, inactive/incorrect active readback, response limits, cancellation and minimal
errors. Combined with the review 20 follow-up, focused source/group/declarative activation suites pass
178 cases. The [review 20 corrections](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-02-declarative-review-followup.md) remain separate from
that review's accepted snapshot; neither they nor this new activation profile have fresh native or
PP evidence yet.

At `246b98b05`, the combined activation/review follow-up author run passes **494 files / 13,301 unit tests**, three
TypeScript projects, build, lint (three existing informational findings), policy, the historical
offline harness and strict documentation. These counts supersede the explicitly dated CRUD-only
checkpoint above; the live-qualification limitations remain unchanged.

## Current read-only native contracts

A second probe used clean source commit `246b98b0508584723b74d66b4ffefa37b6140346`, direct MARIAN
Basic authentication on A4H/001, and `allowWrites=false`. Each fixed owner was checked through the
current native owner helper, then explicit active metadata and inactive/active source were read.
The request context set no replay, no transient retry and one 20-second deadline per family; every
metadata/source response had a 1 MiB cap. No source body was retained, only its byte count and hash.

| Type | Native owner verified | Explicit active metadata | Source MIME; inactive / active bytes |
| --- | --- | --- | --- |
| DDLS | Yes | HTTP 200, **inactive** | text/plain; 0 / 0 |
| DCLS | Yes | HTTP 200, active | text/plain; 154 / 154 |
| DDLX | Yes | HTTP 200, active | text/plain; 12,678 / 12,678 |
| BDEF | Yes | HTTP 200, active | text/plain; 166 / 166 |
| SRVD | Yes | HTTP 200, **inactive** | text/plain; 0 / 0 |

This demonstrates that explicit active-version reads can return inactive metadata for the
selected DDLS/SRVD resources; their earlier activation history was not inspected. HTTP success or a matching active-source GET alone is not activation proof. The new
profile checks both default and explicit active metadata state in addition to the source hash.
The read-only result supports these selectors and requested Accept values without renegotiation;
it does not qualify locking, creation, save, activation, typed deletion absence or PP. Request
headers are recorded as supplied arguments, not as a separate wire capture.

Private receipts: `pr1142-declarative-reads-1793628520131`. Probe SHA-256:
`209431c90761cf437da681c13fc3563776baee3257f7891075a34d2170ad2bd7`.
All five owner checks and fifteen explicit reads succeeded. Existing objects, roles and application
configuration were unchanged; the original owned qualification fixtures remain absent.


## Review 21 and the next native fixture plan

[Review 21 and its follow-up](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-02-declarative-activation-review-followup.md) close review 20
and address activation result wording, explicit state/size coverage and stable CTS recording across
preaudit. At `63303383` the private activation suite has 85 cases; the next follow-up adds five saved-draft/active-alternative cases. None enables a public mutation.

The next native workflow is being prepared with six disposable `$TMP` resources: a CDS view entity,
a separate CDS root abstract entity, DCL, metadata extension, abstract BDEF and service definition.
The abstract BDEF avoids an implementation class; the service definition has no binding/publication.
The initial and replacement sources differ only by a fixture comment. Dependencies are explicit,
and an uncertain child preserves its dependency closure during cleanup. The original fifteen offline checks at `63303383` cover fixture constraints and local rules;
follow-up coverage also checks every dependency and both source versions. Only the two DDLS sources
reach a parser. BDEF/DDLX use narrow pattern rules; DCLS/SRVD have declaration/target assertions,
not grammar validation. A [one-run qualification harness](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-02-native-declarative-qualification.md) now has offline
checks. Review 23 said not to run it; its [follow-up](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-02-native-declarative-harness-review-followup.md)
awaits independent review. It has not been run against SAP; these sources have not been
compiled or mutated on SAP. SAP's current language reference is syntax
research, not A4H release qualification:
[abstract BDEF header](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENBDL_BDEF_ABSTRACT_HEADER.html),
[abstract entity behavior](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENBDL_DEFINE_BEH_ABSTRACT.html),
[CDS abstract entity](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCDS_F1_DEFINE_ABSTRACT_ENTITY.html).

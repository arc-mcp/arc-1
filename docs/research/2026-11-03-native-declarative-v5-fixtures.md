# Declarative V5 fixture candidate after the V4 preaudit failure

Historical scope: **the independently reviewed change was fixture data only**. The subsequent
[fixed V5 protocol](2026-11-03-native-declarative-v5.md) binds the completed V4 recovery and adds separate
phase machinery; it requires its own review and fresh qualification. No existing failed claim or
fixture graph is reopened.

## Observed V4 result

The single V4 attempt at `99a375a16efd8891adbff9d2995d2684c5e550fb` failed at the first BDEF activation.
The preserved result hash is `3cb95d1620f6dfad4402d61eba1171d955e02f375c7f7cb434c392f161afb940`.
Its native response says `checkExecuted=true`, `activationExecuted=false`, `generationExecuted=false`;
the source location is line 7, column 10. The error requires `mandatory:execute` to have both
`with hierarchy` and `with control`. The old fixture already had the former and lacked the latter.

Four owners completed create/save/activate/comment-update/activate. DDLX, DCLS and view DDLS were then
deleted with typed independent absence; BDEF and its abstract DDLS dependency were retained by that
failed run. SRVD was never created. Recovery is a separate procedure; these are the audited failure
facts, not an assertion of present SAP state or a cleanup permission.

The 14-observation fixed GET inspection additionally found two different BDEF versions: intended
abstract source inactive (168 bytes, hash `8f34e7d608334e42ab6eaf4d10cf662928461c4898746a46582ccf16d083effb`),
and an active unmanaged default template (483 bytes, hash
`7be05fcec2b5134a6ee5e91aebdb3ce65351924a341704b079a707eb930182de`). The class named by the default
source was separately inspected and returned typed native not-found. A class reference is not proof
that a CLAS owner exists. Conversely, active BDEF metadata is not proof that the intended abstract
source was activated. Both facts must remain distinct in future qualification.

## Six-owner review

| Owner | Source and dependency contract | Evidence and remaining assumption |
| --- | --- | --- |
| View DDLS | Root view entity selecting only SFLIGHT Carrier, ConnectionId and FlightDate; explicit extension allowance and no required DCL check. | V4 create, both activations, comment update and deletion passed. Native warnings about inherited search helps were non-blocking. The external read dependency SFLIGHT must still be present; no table data is written or queried by this qualification. |
| Abstract DDLS | Root abstract entity with `Item : abap.char(10)`; separate native owner from same-name BDEF. | Both V4 activations and comment update passed; retained only to protect the unresolved BDEF dependency. It supplies the root-abstract prerequisite for the revised BDEF. |
| DCLS | Mapping role grants SELECT on the owned view; its only fixture dependency is that view. | Full V4 forward lifecycle and cleanup passed. This fixture exercises that narrow role form, not arbitrary PFCG/authorization semantics. |
| DDLX | CUSTOMER metadata extension annotates Carrier on the extension-enabled owned view. | Full V4 forward lifecycle and cleanup passed. Its dependency/field already exists; no extra annotation or owner is added. |
| BDEF | `abstract; strict ( 2 ); with hierarchy;`, then entity-level `define behavior for <abstract> with control`, with the mandatory-execute Item field. | V4 saved but native preaudit rejected the missing control clause. The V5 correction follows the native error and supplied SAP references. Its activation remains unqualified; an active generated default is not the intended source. |
| SRVD | One `define service`, exposing only the already-active owned view as Flights; no binding or publication. | Repository E2E source uses the same declaration/expose form. No SRVD CREATE/activation/update/delete ran in V4, so payload serialization, normalization, state links and cleanup remain native observations to obtain. |

Only V5 naming/markers and the BDEF control clause change. The pure `declarativeV5Fixtures` factory
reuses the frozen V4 graph without editing its builder or evidence semantics; every owner and edge
gets the disjoint V5 family. It refuses all four known consumed suffixes. These safeguards do not
constitute a fresh runtime claim or evidence of target absence.

## Placement, creation defaults and proof

The corrected original source places `with control` on line 5, on the `define behavior for` entity
clause. `with hierarchy;` remains header line 4; `field ( mandatory : execute ) Item;` remains line 7.
The comment-only update shifts these lines by one and otherwise preserves the complete body.
There is no implementation class, transactional CRUD clause, behavior extension or foreign dependency
in the intended abstract source.

The root's supplied official SAP Help references are [Modeling Parameters for Non-Standard Operations](https://help.sap.com/docs/abap-cloud/abap-rap/modeling-parameters-for-non-standard-operations)
and [Abstract BDEF entity definition](https://help.sap.com/docs/abap-cloud/abap-keywords-standard-abap/ABENBDL_DEFINE_BEH_ABSTRACT.html).
They were not fetched again in this offline task. The former supplies entity-level `with control` for
mandatory-execute parameters; the latter supplies the hierarchy/root-abstract context. This is a
reasoned fixture correction, not native compilation evidence.

The shared CREATE builder still classifies BDEF as `BDEF/BDO`, using `blue:blueSource`, vendor MIME
`application/vnd.sap.adt.blues.v1+xml`, packageRef `$TMP` and the required `_package` query parameter.
For this non-extension source it supplies **no abstract-template selector**. V4 request 00459 confirms
that actual payload. The native default unmanaged template is therefore an expected state to inspect,
not something the current metadata POST proves absent. The existing save path locks/reads that owner,
PUTs the explicit desired source, reads it back, unlocks and closes its owning session. Only subsequent
successful native activation plus exact active-source/state checks can establish the intended source.
Do not invent a template property or send additional implementation-class writes to avoid that distinction.

SRVD's existing builder uses `SRVD/SRV`, `srvd:srvdSource`, `srvdSourceType="S"` and the package reference;
it likewise creates metadata before the explicit source PUT. Its endpoint is the definition collection,
not service-binding or publish-job endpoints. All six payloads remain inside the unchanged exact-owner
transport fence. The BDEF terminal-newline normalization observed in V4 is already handled by the shared
source equality rule; that rule was not broadened, and receipts retain the native-byte hash.

## Ordering, checks and remaining qualification

The reused workflow completes create/save → activate → comment update → activate for each owner before
creating the next. Creation order is view DDLS, abstract DDLS, DCLS, DDLX, BDEF, SRVD. Reverse cleanup is
SRVD, BDEF, DDLX, DCLS, abstract DDLS, view DDLS. An uncertain BDEF preserves its abstract parent;
an uncertain SRVD preserves its view. No base is deleted under a known or unresolved child. Final
absence, inventory and owning-session cleanup checks must all remain in a future independently
reviewed protocol; none are bypassed here.

The targeted offline tests protect old graph hashes, exact new declarations/field positions, all six
native CREATE classifications and request fences, comment-only updates, dependency ordering and
uncertainty closure. Synthetic active-default BDEF metadata plus the wrong source must fail actual
snapshot verification. Available DDLS parsing and BDEF parsing run, but the BDEF parser accepts both
old and corrected forms and reports missing related entity in its single-file context. The automatic
pre-write gate does not run full BDEF semantics; the narrow RAP rules did not catch this native failure.
DCLS/DDLX/SRVD do not gain a native grammar proof from these tests. No global lint rule is changed.

Before a new full lifecycle, independently review the recovery evidence and fixed protocol with fresh
source/runtime/intent/preflight/SM12 bindings and permanent no-replay semantics. Observe the actual BDEF
placeholder, desired inactive and intended active bytes separately. If the default references a class,
a bounded read of that exact reference can distinguish absence from an unexpected artifact; it does
not authorize creation or deletion of that class. SRVD remains a first-time native family observation.
Current-build two-writer PP and public multi-target write admission remain separate from Basic-native
qualification, and a failed full lifecycle must remain failed even if independent cleanup succeeds.

Roadmap impact: FEAT-93 now records the consumed V4 BDEF failure and the fixture-only V5 correction;
recovery-bound full-protocol review, native lifecycle and current-code PP qualification remain open.

## Independent fixture review

[Exact-source review](2026-11-03-native-declarative-v5-fixture-review1-verbatim.md) approved private integration of `5e88ce5bf49438b0330be6036836da961e956bd4`. All 291 committed focused tests and 22 additional probes passed, as did all three TypeScript projects and changed-test lint. The reviewer verified 4,742 snapshot files and all 622 original V4 protocol files unchanged. This approves the fixture-only correction; a new native protocol and corrected BDEF/SRVD lifecycles remain pending.

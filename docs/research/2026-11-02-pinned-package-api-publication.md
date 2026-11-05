# Private package, API release and service-binding adapters

Date: 2 November 2026. Base: `e2b08f3d984f8cd84a30038f74820932db36cf1a`.
This checkpoint contains offline implementation and tests only. No SAP, BTP, credentials,
publication job or native qualification harness was used. It does not change public capability
admission, schemas, scopes, target grants or single-target behavior. The explicit profile table in
`src/adt/pinned-managed-resources.ts` marks every row private and without native qualification.

The [V4 publication follow-up](2026-11-03-pinned-v4-publication.md) supersedes this initial
checkpoint's publication recording gap with a private source-qualified synchronous/non-recording
executor. Its trusted current-principal production reader, native cleanup and PP qualification
remain open.

## Implemented private boundaries

| Resource | Implementation | Limits and remaining evidence |
| --- | --- | --- |
| Package create | Explicit parent and SAP responsible user, native target absence, both parent/child package policies, fresh creation recording and namespace-bound native description/responsible/parent/component/settings readback. Uses the existing package builder and shared create request. | No implicit IdP-to-SAP username mapping. Local/recorded hierarchy changes and namespaces are constrained. On-premise and cloud native creation/PP qualification remain pending. |
| Package delete | Exact native package identity, reserved `$TMP` refusal, known-content checks and shared owner-deletion policy interface. | **Always refuses DELETE.** Direct package browsing has unknown completeness; neither an empty result nor missing tree evidence proves emptiness. Authoritative emptiness and non-cascading native deletion semantics remain required. |
| Package move | One explicit owner and source/target package. Native preview must name exactly that owner and target; its CTS selection is checked structurally, independent of XML prefix. Owner, both package policies and both recording contexts are refreshed before execute. Final owner package is verified. | Recorded-to-local moves refuse. The native preview may itself have effects and is reported when execution is refused. No lock covers preview through execute; native preview effects, concurrent change windows and release-specific recording remain unqualified. |
| API release | Existing narrow v10 GET/PUT/GET builder, exact contract/state and optional complete visibility selection. Validates native owner and the contract's **APIS** resource/package; recording checks use APIS, not a substituted repository URI. Rechecks owner, native document bytes and recording before PUT; verifies contract and visibility afterward. | Native create/update and ReadOnly/default visibility apply. No lock/ETag closes the final document race. Mock CLAS coverage is not native proof for any candidate type or contract. Current-profile native and PP qualification remain required. |
| SRVB create/update/delete | Exact native binding owner/package, definition reference and one service version. Creates inactive; updates preserve opaque native XML and require the full native metadata hash under the owner lock. Fresh package/recording checks, shared lock/update/delete lifecycle and bounded readback. | CRUD requires explicit unpublished/not-generated native flags. Published/generated bindings, unknown state, multi-service patching and unsupported fields refuse. Delete verifies native absence. Native CTS/lock/draft behavior and two-user PP remain unqualified. |
| SRVB activation | Internal entry into the existing pinned activation orchestrator. Captures full native metadata, accepts only the selected owner reference, rechecks before confirmation, requires positive execution and matching explicit active/default native readback. | No publication is implicit. Public activation remains closed. Native generated fields and dependent activation behavior require qualification; metadata differences are incomplete outcomes, not accepted guesses. |
| Publish/unpublish and batches | Exact active binding, full metadata hash, explicit OData V2/V4 and four-digit service version; active/default documents must agree and have no inactive alternative. Batches validate all 1–10 selectors and reject duplicates before reads. | **Never submits a publication job.** Repository-owner transport checks cannot prove publication-specific CTS handling. A native recording contract, exact polling/readback, no-replay adaptation of legacy MIME fallback, cancellation/partial-batch outcomes and actual availability scope remain unimplemented/unqualified. |

The adapters require a registered pinned mutation context and existing write/package/CTS policy.
Their internal exports do not grant HTTP admission. No caller boolean, transport guess, public field
or user-provided proof enables publication or package deletion. Future wiring must retain exact
target identity/write grants, action/functional scopes, audit correlation, capability projection
and cancellation at the existing dispatch boundary; internal fixture calls do not qualify those
end-to-end properties.

## Shared implementation and failure semantics

The package move adds optional preview validation and response limits to the existing refactoring
function. API release adds optional before-build/before-PUT/readback hooks and response limits to
the existing v10 implementation. Legacy callers pass no hooks/options and retain the original wire
calls. Deletion uses a typed internal owner/precondition profile; the public pinned owner allowlist
is unchanged. SRVB update uses `withLockedMutation` and the owning session for cleanup.

All private requests carry the outer cancellation/deadline and shared no-replay policy. Native
metadata reads are capped at 1 MiB; the API lifecycle has a 3 MiB cumulative response budget plus
one separately bounded 1 MiB freshness read; move preview/execute share a 1 MiB response budget.
Publication's candidate batch limit is an offline bound, not a throughput claim.

Acknowledged writes with failed readback remain unverified; transport/network loss remains
unconfirmed. Native rejection is distinguished only for known rejection statuses. Cleanup failure
does not undo a save/delete and is reported without lock/session credentials. No automatic replay,
compensating rollback, arbitrary URI, source execution, RFC or helper installation is introduced.

## Validation and next work

The focused suites cover input refusal before requests; namespace/owner binding; stale metadata;
opaque field preservation; actual APIS recording identity; package/CTS policy refresh; move-preview
expansion; publication/batch bounds; uncertain writes; owning-session cleanup; native active-state
verification and unchanged public activation denial. Existing delete, API visibility, refactoring
and declarative activation suites provide shared-call regression checks.

Validation at the initial `8dd5dfa` checkpoint: the three new suites pass **103 tests**; the full suite passes
**505 files / 13,621 tests**. The three-project typecheck, build, action policy, file/schema size
budgets, full lint and strict MkDocs build pass. Lint reports only three preexisting informational
`useTemplate` suggestions in untouched files. The mock harness loads the existing undici mock
before importing HTTP-dependent adapters and fails each test on any unexpected captured request.

## Package-create review follow-up

The independent review of `8dd5dfa07402a36d5cc4c347e475b31406e35db7` found that creation could
report success without verifying its required description and person responsible. The package
reader now exposes both native root attributes in the ADT core namespace, preserving exact decoded
values, and creation compares them with the submitted values before reporting `created`. Missing,
changed, empty, incorrectly bound or padded values leave an acknowledged POST `created-unverified`;
there is no retry, compensating DELETE or extra update.

The attribute names follow the existing `buildPackageXml` contract (`adtcore:description` and
`adtcore:responsible`). The [native package dossier](2026-06-27-btp-package-create-solved.md)
records the responsible attribute and the need for an internal ABAP user on BTP. This follow-up
neither infers that user from the caller nor broadens cloud or on-premise creation support. Exact
native readback fidelity and current-profile PP remain unqualified on both platforms.

The positive fixture now supplies both attributes rather than relying on their omission. New
regressions cover absent, changed, empty, padded and wrong-namespace values, plus an alternate
namespace prefix and XML-escaped description. The 13 negative regressions failed against the old
implementation; all retain one POST and no PUT/DELETE after the correction. The [independent follow-up review](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/broader-pinned-pp-writes/codex-package-api-review2-20261102.md)
closed the finding with 82 independently passing focused tests and an unchanged snapshot. The
[original review](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/broader-pinned-pp-writes/codex-package-api-review1-20261102.md) remains available.

Follow-up validation uses Node 22.21.1: the full suite passes **505 files / 13,635 tests**;
source/scripts/tests typecheck, build, full lint, policy and size/schema budgets pass. The focused
package and service-binding suites pass **82 tests**. Lint retains three informational findings.
These are offline results; no native package or PP operation was run.

Required before public admission: independent implementation review; native evidence for every
claimed resource/profile/release; authoritative package deletion and publication current-principal/native-cleanup qualification;
reviewed disposable native harnesses with cleanup; source-bound two-writer strict-PP tests and the
full denied-grant/read-only/Basic/aggregate truth table. Neither this checkpoint nor passing mocks
completes P2-E or FEAT-93.

## Local package-delete follow-up

The [3 November private candidate](2026-11-03-pinned-local-package-delete.md) supersedes the always-refused
delete row at this historical checkpoint. Active native source now supplies the non-cascade contract;
empty browsing still does not prove emptiness. The local profile uses repeated metadata/recording
checks and the shared one-shot owning-session lifecycle. Recorded deletion, native lifecycle/cleanup,
current-code PP and public admission remain unqualified. No native operation ran for this follow-up.

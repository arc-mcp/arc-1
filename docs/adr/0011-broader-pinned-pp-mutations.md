# ADR 0011 — Broader built-in mutations on pinned PP targets

**Status:** Proposed for final acceptance; explicit adapters and public admission are integrated in PR #1142. Final native CTS, current-build PP, restoration and release review remain pending.
**Date:** 29 October 2026; implementation contract reconciled 5 November 2026.
**Contract:** [Accepted PR 2 plan](../plans/2026-10-26-broader-pinned-pp-writes.md) and [current operator matrix](../../docs_page/multi-target-writes.md).
**Dependency:** [PR #1138](https://github.com/arc-mcp/arc-1/pull/1138), merged as `ac8385fa4`.

## Context and decision

ADR-0010 is the earlier accepted CLAS/INTF baseline. The owner requested the existing built-in
single-target development workflows on writable pinned targets, including deletion, CTS management,
runtime tracing and classic Fiori Launchpad content. Git and custom extensions remain excluded.
The shared lifecycle does not automatically authorize additional operations; the explicit capability
matrix is the current implementation authority, not the older private-candidate checkpoints.

Extend ADR-0010 only through reviewed tool/action/type/input rows. Reuse existing native adapters
and the common lock/session/request lifecycle, preserving their explicit legacy and pinned profiles.
Every new action, type, alias and nested input needs admission review; single-target schema presence
alone is insufficient. The operator matrix records the complete current rows, supported input
combinations, native limitations and qualification status. These source changes do not themselves
accept the broader ADR or qualify every backend.

## Common authorization boundary

Every mutation requires a pinned route, strict Principal Propagation, enforced XSUAA target
attributes, global writes, destination write opt-in, read access, verified raw write scope and an
exact write-target grant. Functional scopes, action denials, feature/platform rules and native SAP
authorization further restrict the call. Admin diagnostics never replace these checks. Aggregate,
Copilot, shared Basic, standard target authorization and read-only destinations remain mutation-free.
Keep standard tools, cache-none, UI/plugins off, per-call target validation and no PP fallback.

The same explicit action matrix drives early invocation admission and schema/catalog projection.
Validate meaningful raw fields before normalization/schema stripping, including nested objects.
A displayed or cached action is not authorization: an application-wide write catalog may be visible
on a destination that refuses writes. Every dispatch and low-level mutation must still enforce that
destination. No new global enable switch, upgrade acknowledgment or destination transport boolean
is introduced; existing opted-in writers gain the documented source capability expansion.

Writer-only companions include CTS layers/targets, formatter format/settings reads, FLP lists and
Manage features/probe/cache_stats. They retain normal read scope but require the writable pinned
connection and raw write/exact grants. Ordinary editable reads remain normal reads without write
package gating. Existing reader catalogs and workload-producing reads are not silently broadened.
Git/Custom calls remain refused even when sent directly or by an administrator.

## Native resource contracts

| Resource | Current policy and postconditions |
|---|---|
| Repository objects | Independent server/destination package rules against the real native package. Distinguish edited resource, lock owner, package owner and activation owner. Explicit create package or proven parent inheritance; recording preflight and owning-lock revalidation. |
| Source replacement/surgery | Existing-source hash over the exact selected editable unit; native identity/state/ranges and preservation checks. Missing optional includes have a separate verified creation path. Declared source bytes are not arbitrary target/owner authority. |
| Metadata and server-driven source | ENHO/SKTD/SRVB updates require full metadata hashes. DDIC metadata and technical-settings patches optionally accept a caller metadata hash and always merge fresh locked native state. Server-driven source updates require source hashes and their registered native body/MIME format. Unknown state is preserved or refused. MSAG and APLO/UIAD may save active; there is no universal inactive-save promise. |
| Activation | Authorize initial owners before preaudit and every explicit expanded reference before confirmation. Single/batch/nested calls share the guarded orchestrator. Whole-owner scope can include preexisting drafts; FUGR generation does not prove child FUNC/INCL activation. Selected structural INCL activates its own reference. No caller arbitrary URI or preaudit=false. |
| Text pools | Verified repository owner and exact native pool lock; complete selected-part replacement has no optimistic source hash. Unlock before exact-pool activation, verify active state/content, preserve uncertainty. Other pending parts in that pool can activate. Guarded PROG/FUGR deletion requires active pool evidence. |
| Package/API management | Explicit native package construction, exact source/target move preview and actual APIS recording resource. LOCAL root create and local non-cascading DELETE are bounded on-prem 758 profiles; $TMP is protected and is not proven ancestry. Recorded package deletion and unsupported move/contract variants refuse. |
| CTS management | Global transport switch plus transports scope and all common write gates. Independent request lists; native request/task membership and state, complete recursive preflight/revalidation, bounded terminal evidence and retained unexpected members. Source recording is a separate operation. |
| Trace/settings/quickfix | Native user/client/server resources, not fictitious package owners. Exact trace subjects and IDs; formatter native-version preservation; quickfix computes same-owner unsaved deltas with exact URI/context/range validation. Persistence remains guarded SAPWrite. |
| Classic FLP/publication | Selected native client or binding-wide scope, explicit platform/owner checks and the constrained native-governed recording profiles below. A native acknowledgment is not a universal absence, frontend or recording receipt. |

The repository matrix includes source/DDIC/server-driven CRUD, supported class/procedural surgery,
FUGR/FUNC/structural includes, text pools, BADI_IMPL ENHO, SKTD documents, bounded batches and RAP
helpers. TABL/DTT is update-only; FUGR main-source replacement and unsupported batch combinations
are excluded. APLO/UIAD do not expose separate activation. Ordinary SRVB CRUD refuses published or
generated state. Generated V4 parent deletion has a distinct internal qualification entry, not a
public schema row. Public publication is one V4 binding/version; no public publication batch or
V2 publication path is inferred. The [matrix](../../docs_page/multi-target-writes.md#explicit-action-type-and-input-matrix)
is authoritative for exact fields and current platform filters.

### Request policies and role composition

Repository recording resolves one modifiable Workbench parent or proven task membership and checks
both request policies. Source recording does not require the transport-management switch/scope.
An absent/empty destination request list permits only positively established local repository
recording and denies explicit CTS management; it never inherits the global list's legacy empty
unrestricted convention.

CTS create always creates a Workbench K request. Because its generated ID is unknown before POST,
creation requires unrestricted global policy (legacy empty or explicit `*`) and explicit destination
`*`; narrower lists require separately created requests. The native target/package/layer determines
the TMS route. A present empty native target means local; a missing field means unknown. `target`
is not an ARC-1 route selector. Management preserves full object keys and native task types, rejects
unqualified state/membership, and checks inactive objects before release. Recursive work freezes
and revalidates its full scope; later expansion remains inspection evidence even if omitted by a
subsequent read. Partial effects, including CTS effects after an error, are never treated as rollback.
The release timeout is at most 300 seconds and cannot exceed the remaining call budget.

The optional MCPTargetTransportDeveloper template combines read/write/transports scopes with the
same exact access/write target attributes. **Functional scopes are application-wide and merge across
roles:** transport role A plus write role B can permit CTS management on both A and B when their
policies allow it. There is no target-specific transports grant. Use destination restrictions or
separate applications for that isolation. Roles are not silently assigned or expanded. Transport
scope advertisement belongs to the writable pinned OAuth surface, not aggregate endpoints.

### Native-governed recording and outcome limits

The accepted constrained-selection alternative permits native selection only when every possible
native request is covered by **explicit unrestricted `*` in both effective request lists**. An empty
global list does not qualify this alternative. No invented request-selection endpoint/header or
post-write-only permission check is substituted. The registered request context, scopes, target,
owner/package policy, deadline and fresh binding are revalidated at actual submission after waits.

Classic PAGE_BUILDER_CUST uses the reviewed on-prem 758 no-dialog/native-authority flow. SAP may
record or permit a non-recorded change; completion reports native-governed/unverified recording,
not a CTS receipt. Narrow/missing/malformed policies refuse. Catalog/group creation relies on the
source-backed native duplicate/no-overwrite contract plus exact returned entity proof, not an
unknown pre-read or a supposedly unique name. Generic OData 404 and application /UI2/FND/604 remain
unknown. Public catalog deletion can therefore be acknowledged but unconfirmed. Tile/group
multi-step effects and native failure uncertainty remain explicit. This adds no transport-management
scope gate, public group-delete action, modern spaces/pages or Work Zone contract.

V4 publication uses the same both-explicit-* policy and native platform evidence, with exact
binding/version/type/package and metadata. It sends the authorized native job even when a weak
getter appears to match. Native cloud BAdI/no-op branches and getters do not establish universal
frontend/all-alias success; no non-recording or CTS receipt is claimed. The stronger internal
non-recording profile remains distinct and has no general native configuration reader. Generated V4
cleanup additionally needs both package policies explicitly unrestricted, exact generated state and
whole-parent intent; it sends only the parent DELETE. Parent typed absence and generated cleanup
accepted-but-unverified remain separate. This internal entry does not bypass the public generated
binding guard.

### Effects beyond the selected resource

The accepted plan accepts native downstream effects within the selected single-target-parity
scope. Package and target checks authorize the resources ARC-1 submits; they do not bound every
consumer or later native side effect:

- CTS policy is not an import-route sandbox. Release can place a request in other systems' import
  queues; subsequent imports follow TMS routes and operational approvals, independently of ARC-1
  target grants. Recorded deletions can travel too. TMS routing, QA/import approvals and SAP
  authorization control that progression. Administrators can deny `SAPTransport.release` and
  `SAPTransport.release_recursive` through `SAP_DENY_ACTIONS`. SAP documents
  [target groups and delivery routes](https://learning.sap.com/courses/technical-implementation-and-operation-ii-of-sap-s-4hana-and-sap-business-suite/configuring-extended-transport-control-1).
- DDIC activation can adjust active dependent objects outside the edited package, including
  database structures. SAP's preaudit references do not enumerate all such effects. Interface
  changes can also break callers elsewhere. The accepted plan accepts these native dependency
  effects; it does not introduce a mandatory where-used closure as an authorization boundary.
  Every explicitly submitted/expanded activation reference still requires the independent package
  checks. See SAP's [direct and indirect table adjustments](https://learning.sap.com/courses/building-data-models-with-the-abap-dictionary-and-abap-core-data-services/handling-changes-to-database-tables_d6d6d97a-979e-4efe-b5c3-f3e3d85332fb).
- Existing ABAP Unit reads can execute authored test code under the requesting SAP principal,
  including a reader or CI identity. Treat [author-declared test properties](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABAPCLASS_FOR_TESTING.html) as test selection controls, not an authorization sandbox. Keep the
  existing reader surface, document this interaction, and offer `SAP_DENY_ACTIONS=SAPDiagnose.unittest`
  where executing writers' tests is inappropriate. `unittest_ci` remains refused on multi-target;
  if later admitted, the opt-out must deny both `SAPDiagnose.unittest` and `SAPDiagnose.unittest_ci`. A writes-off destination blocks ARC-1 mutation
  calls; it does not isolate shared repository code from execution through other allowed workflows.
- Explicit trace subjects may identify another SAP user when SAP authorizes it. Existing trace
  reads retain their current scopes and native authorization; they may expose results produced by a
  writer. This is an explicit native-authorization tradeoff, without a new self-only/data gate.
  ST05 state covers application-server instances beyond the route's client. Report the actual
  filter/client/instance scope; the pinned route does not provide client isolation. Unqualified
  native filter/reset semantics remain blocked.
- Publication/unpublication changes service availability for other consumers; SAP service/data
  authorization controls their access. Whole-owner activation may include preexisting drafts by
  other developers. The owner/package/reference checks remain mandatory, with truthful scope and
  outcome reporting instead of an assertion that only the caller's edits are activated.

## Identity, lifetime and recovery

JWT display names/config.username do not prove the mapped SAP identity. Omit optional responsibility
when SAP uses the logged-on principal; package creation instead requires an explicit native SAP
person-responsible on every platform. Responsibility is not the acting identity. API-state expectedCurrentState is a read precondition,
not a qualified atomic compare-and-swap or lock contract. Trace operations
without an authoritative native default require an explicit SAP username. The final PP evidence
must include another identity whose IdP name differs from its SAP user.

Profiler requests bound executions/expiry and name one exact subject/client. Same-user HTTP traces
can be consumed by the next ADT read, which the arming result reports. ST05 affects all returned
application-server instances, not only the pinned client. ON refuses replacing live filters; a write
that would clear another active non-SQL trace refuses. Qualified OFF resets known filters and
non-stack properties to native inactive defaults; no extra restore PUT or filter-preservation promise
is made. Unknown reset shapes/nonempty unqualified table lists and allUsers remain blocked; already-matching
state is preserved without PUT. Tests
restore actual prior state without clearing unrelated traces. See the [native ST05 contract](../research/broader-pinned-pp-writes/native-runtime-contracts.md#traces-and-selected-platform).

Formatter patches are mapped-user preferences, not global system settings. Native v5 preserves
visible unselected attributes; older/lossy representations and unsupported native styles refuse.
Native conditional enforcement, hidden storage and same-user concurrent update preservation remain
unqualified. Quickfix keeps write classification but returns deltas only, never saves source.

All nested requests, package hierarchy reads and policy checks share bounded response/attempt
budgets, cancellation and a finite deadline. Every modifying request disables replay/transient
retry. Owning unlock/session close have independent bounded cleanup after failure or expiry.
Keep unchanged/saved/activated/deleted/partial/unknown facts distinct. A network error does not prove
rollback or authorize retry; preserve observed expansions and current residuals even after a prior
successful deletion observation. Audit delivery retains its asynchronous durability limitations.

## Evidence, upgrade and acceptance

The [current acceptance ledger](../research/2026-11-05-pr1142-current-acceptance.md) is the single
status record for final checks, remaining live evidence and restoration. The requirements below
remain binding; dated evidence retains its original revision and outcome.

The 2–3 November reports titled private candidate are immutable implementation/review checkpoints,
not current blanket admission denials. See the [resource checkpoint](../research/broader-pinned-pp-writes/native-service-contracts.md#publication-and-generated-resources),
[DDIC profiles](../research/broader-pinned-pp-writes/native-metadata-contracts.md#definition-preservation),
[trace/FLP checkpoint](../research/broader-pinned-pp-writes/native-runtime-contracts.md#traces-and-selected-platform),
[FLP recording contract](../research/broader-pinned-pp-writes/native-runtime-contracts.md#classic-flp) and
[publication alternative](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-publication-native-governed.md).
Current dispatch/capability rows supersede their historical “not publicly wired” status while
retaining each unresolved native limit. Names such as handlePrivatePinned… and historical scenario
lists are not the current public capability decision.

Named native 758 representatives have now completed the local package/API lifecycle and four-owner
cleanup, ENHO retained activation/reverse cleanup, ST05 ON/OFF restoration, and procedural/table/MSAG
cleanup. The [RAP v4 tail](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-native-rap-retained-v4.md#actual-native-outcome-4-november)
also completed publication/unpublication and reverse cleanup, with seven owners and implicit table
settings typed absent; its generated-resource and recording limits remain explicit. These direct
Basic-native observations do not enable shared Basic mutations or qualify current-build PP.
Remaining CTS parent/recursive release and empty-request deletion, final current-build two-writer
PP/text/recording, classic FLP and negative-route/Basic evidence, and app/IAM/destination/SAP-role
restoration are outstanding. Historical
[combined PP evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-01-broader-pinned-pp-writes-combined-qualification.md) applies
only to its named builds and tested operations.

Do not equate missing 750/816/cloud evidence with native non-support. Apply the actual type registry,
discovery and native contracts. The observed 750 missing text-pool service and explicit 758-only
FLP/publication/local-package profiles are concrete boundaries; other unverified combinations remain
named qualification gaps. No blanket backend parity or final ADR acceptance is claimed.

Before upgrade, operators review the expanded matrix, action denials, both restriction lists and
merged role scopes. Preserve the old artifact, MTA properties, destination and XSUAA configuration.
Restart every instance after server/destination changes, obtain fresh authorization after role/scope
changes and refresh catalogs. Already admitted work may complete; role removal alone does not revoke
old tokens/refresh sessions immediately. Disable with explicit false values, not deleted MTA lines.
Rollback restores matching artifact and configuration; older binaries can quarantine newly supported
destination properties. Existing write gates keep read-only apps/destinations mutation-free; no new acknowledgment is required.

Acceptance still requires the complete explicit inventory, regression and negative-boundary checks,
security review, independent review/fix loops and isolated current-build two-writer PP evidence.
Separate controlled-wire, direct-native and PP evidence. Release tests use a disposable route without
downstream imports or explicit approval of those effects. No deployment or native execution follows
from this ADR. Keep FEAT-93 open until the accepted expansion is implemented, qualified and reviewed.

Residual risks include shared-process availability, cross-client repository effects, authored code,
preexisting drafts activated by whole-owner operations, irreversible releases/deletes, trace load
and data, shared FLP/preferences, asynchronous audit delivery and retained token grants. Separate
instances remain the stronger isolation option.

## Alternatives

Automatically exposing the single-target schema would bypass resource-specific policy and future
review. A second full write engine would duplicate its lifecycle and fixes. Per-target transport
scopes need another IAM contract/migration; this design uses existing functional scopes plus
independent destination request policy. Aggregate writes, Basic writes, Git and custom plugins stay
outside the accepted scope.

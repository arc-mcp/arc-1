# PR 2: broader built-in writes on pinned PP targets

Status: implementation in progress. Formatter, CLAS/INTF deletion, class-include updates, existing-include method edits and main-source class metadata surgery are admitted in the draft.
The fresh local run at `77e41fdcd` qualifies include replacement and the refactored main method path;
the later include-method and class metadata adapters, refactored transportable paths and remaining families still need qualification.
The [combined PP run](../research/2026-11-01-broader-pinned-pp-writes-combined-qualification.md)
qualifies the listed local CLAS/INTF and tested v5 formatter cases at `1b234d3a4`. Claude accepted its evidence
follow-up for continued development; broader capabilities and final acceptance remain outstanding.
Date: 26 October 2026. Research baseline: `e538bf71197ddb47ea74aca225c340a856d331af`.
Dependency: [PR 1 shared mutation infrastructure](2026-10-26-shared-mutation-infrastructure.md).
PR 1 merged as [#1138](https://github.com/arc-mcp/arc-1/pull/1138), commit `ac8385fa4`.
Implementation starts with [ADR-0011](../adr/0011-broader-pinned-pp-mutations.md), the
[mutation inventory](../research/broader-pinned-pp-writes/inventory.md) and request-scoped package hierarchy checks.
[Implementation checkpoint and incomplete review status](../research/2026-10-29-broader-pinned-pp-writes-progress.md).
[Existing CLAS two-writer PP evidence and remaining qualification](../research/2026-11-01-broader-pinned-pp-writes-pp-qualification.md).
[CLAS/INTF deletion integration and qualification limits](../research/2026-11-01-broader-pinned-pp-writes-deletion.md).
[Class-local include implementation and local two-writer qualification](../research/2026-11-01-broader-pinned-pp-writes-includes.md).
[Main-source class metadata adapter and remaining qualification](../research/2026-11-01-pinned-class-metadata.md).
Proposed title: `feat: expand pinned PP writes across built-in development operations`.
[Research and owner decisions](../research/2026-10-26-multi-target-write-parity.md).

## 1. Outcome and fixed scope

Offer the built-in single-target development and management workflows on writable pinned PP
connections, subject to native backend support and the policies below. Include deletion, transport
management, runtime tracing and classic FLP operations. Exclude SAPGit and custom plugins/extensions.

Preserve strict PP, exact read/write target grants, existing pinned URLs, destination write opt-in,
global ceilings, action denials and native SAP authorization. Aggregate `/multi/mcp`, its Copilot
compatibility route, shared Basic targets and destinations without write opt-in remain mutation-free.

Keep current discovery/authentication topology, standard tool mode, cache-none and ARC-1 UI-off.
Classic SAP FLP content management does not enable ARC-1's UI. No SaaS, cross-subaccount discovery,
new authentication provider, arbitrary ABAP/RFC execution or ABAP helper installation is included.
This does not add support for a backend topology outside the existing pinned PP deployment contract.

The owner accepts the documented expansion for existing opted-in writers. Do not add a separate
upgrade-acknowledgment switch. This acceptance does not relax any gate for read-only deployments.

## 2. Capability inventory and completeness rule

Build one reviewed matrix from the current `ACTION_POLICY`, public/runtime schemas, type registry
and actual handler branches. Every existing built-in mutation must have a disposition. Do not
assume every action supports every type. Verify slash aliases, generated SDO types and nested batch
inputs rather than taking a Cartesian product of the enums.

| Tool/group | Planned coverage | Resource policy |
| --- | --- | --- |
| SAPWrite CRUD | `create`, `update`, `delete` for current supported types/subtypes, including source and metadata objects, class includes, FUNC/FUGR/INCL, DDIC/CDS/RAP, SKTD/KTD, text-related and server-driven paths | Repository owner/package/recording |
| Class surgery | `edit_method`, `edit_class_definition`, `add_method`, `edit_method_signature`, `delete_method`, `change_method_visibility`, including supported local/test includes | Repository owner plus actual edited include |
| Procedural surgery | `edit_unit`, `add_unit` on supported PROG/INCL and FUGR structural includes | Native include owner/lock and real package |
| Text elements | `edit_text_symbols`, supported symbols/selections/headings and owner types | Text-pool lock, owner package, whole-pool activation scope |
| RAP helpers | `scaffold_rap_handlers`, `generate_behavior_implementation` | All generated/edited owner resources and nested activation |
| Batch creation | `batch_create`, inline/deferred activation and supported per-item inputs | Every item and every later activation; bounded partial results |
| SAPActivate | `activate` for supported owners, includes and batches; `publish_srvb`, `unpublish_srvb` | Complete activation/publication scope |
| SAPManage repository | `create_package`, `delete_package`, `change_package`, `set_api_state` | Package endpoints/move source and destination/actual API owner |
| SAPTransport | `create`, `release`, `release_recursive`, `delete`, `reassign`, `remove_object`; retain reads and add supporting `layers`/`targets` where available | Explicit CTS management policy in section 5 |
| SAPDiagnose mutations | `trace_start`, `trace_cancel`, `set_sql_trace_state`, `apply_quickfix` | Native trace/settings resources or exact quickfix proposal; section 6 |
| SAPLint settings | `set_formatter_settings`, with `format` and `get_formatter_settings` companions | Target settings; no fictitious package owner |
| SAPManage classic FLP | `flp_create_catalog`, `flp_create_group`, `flp_create_tile`, `flp_add_tile_to_group`, `flp_delete_catalog`, plus required `flp_list_*` reads | Target/client FLP resources; section 6 |
| SAPManage supporting reads | `features`, `probe`, `cache_stats` only with truthful per-target behavior | Scoped runtime/probe state; cache-none must not expose another runtime |
| SAPGit / Custom_* | Excluded | Refuse even for admin, globally enabled Git or direct hidden calls |

Current source/metadata type families include PROG/CLAS/INTF/FUNC/FUGR/INCL, DDLS/DCLS/DDLX/BDEF/
SRVD/SRVB, TABL and supported subtypes, DOMA/DTEL/MSAG/TTYP/ENQU/ENHO, SKTD/KTD and the SDO registry.
The implementation inventory must resolve exact combinations against `src/handlers/tool-registry.ts`,
`object-types.ts`, `schemas.ts`, `write.ts` and `write/*`, including alias-only branches.
SAP release, discovery and language-version restrictions continue to apply.

Read companions are enabled deliberately on pinned routes as needed. Do not use this PR to make
the aggregate catalog equivalent to the whole single-target catalog or broaden ATC/Unit workload
selection incidentally. Existing read/data/SQL policies and bounds remain authoritative.

New companion reads (`flp_list_*`, transport `layers`/`targets`, SAP-backed formatting/settings
reads and the listed SAPManage reads) are initially exposed only on the same writable pinned PP
connections being expanded. Existing pinned-reader, writes-off-destination, Basic and aggregate
catalogs retain their current read allowlists. Pass route/context explicitly into pruning rather
than guessing from tool name. Each companion keeps its normal read/data scope; this exposure rule
does not reclassify it as a repository mutation. Broader read parity remains separate work.

Do not declare parity complete until every matrix entry is implemented and tested, explicitly
backend-unsupported, or a named unverified combination with a tracked follow-up. Missing live
evidence is not proof of backend non-support. Public documentation must enumerate residual gaps.

## 3. Authorization, catalog and upgrade contract

Every new mutation requires:

```text
pinned route and verified selected target
AND strict Principal Propagation
AND enforced target authorization
AND global SAP_ALLOW_WRITES
AND destination arc1.allow_writes=true
AND read access to the exact target
AND verified raw write scope and exact arc1_write_targets grant
AND reviewed tool/action/type/input combination
AND operation-specific scope and global capability switch
AND applicable independent resource restrictions
AND no SAP_DENY_ACTIONS match
AND SAP authorization
```

Apply this to SAPManage, SAPTransport, SAPDiagnose and SAPLint mutations as well as SAPWrite and
SAPActivate. Keep early denial before PP/SAP preparation for invalid capabilities/arguments, plus
resource checks at the actual low-level operation. Missing policy must refuse. Admin diagnostics
do not substitute for the raw write scope or exact write-target grant.

Use the same capability decisions for catalog pruning, instructions, invocation and effective-policy
diagnostics. Mixed read/write tools advertised to a writer need truthful destructive/read-only
annotations. Reader variants remain accurate. Strict-schema/null handling, action defaults and
batch-item schemas must agree with dispatch. Unknown new single-target actions stay denied until
added to the reviewed matrix. Reject unrelated pinned route selectors; see CTS `target` below.

### Configuration and roles

- Reuse existing global write/transport switches, destination write opt-in, package/request lists
  and action denials. No new global multi-target flag or general per-action acknowledgment.
- Transport management additionally requires `SAP_ALLOW_TRANSPORT_WRITES=true` and existing
  functional `transports` scope. Source recording does not acquire that requirement.
- Proposed design: no new `arc1.allow_transport_writes` destination boolean. Target write opt-in,
  explicit destination request policy and the global transport gate define its admission.
  `arc1.allow_git_writes` remains unsupported. Do not silently change unknown-property handling.
- Preserve `MCPTargetDeveloper` (read/write). Add an optional `MCPTargetTransportDeveloper` template
  with read/write/transports and the same required target attributes; do not assign it automatically
  or put an attribute-bearing role into a collection with invented defaults. Keep Git out of it.
- Verify role composition with current `hasRequiredScope` behavior, including admin. The explicit
  raw-write and exact-target checks still apply even when a functional scope is implied.
- Functional transport scope is application-wide. XSUAA merges attributes from assigned roles:
  a transport role for A plus a write role for B permits transport management on both A and B
  when their destination/request/global gates allow it. The proposed role is not a per-target CTS
  entitlement boundary. Keep this composition model rather than adding a third target attribute
  or destination flag in this plan; put the effect in the ADR, role description and guide.
  Recording and management cannot be separated per destination/user beyond these existing gates
  and native SAP roles. This is an explicit proposed tradeoff for review, not a new owner decision.
- Advertise `transports` only on pinned protected-resource metadata when instance configuration
  allows enforced writes and transport management. Use instance capability, not unauthenticated
  destination lookup. Aggregate/Copilot metadata never gains mutation scopes.
- Verify fresh client authorization and tool refresh. Old refresh sessions may not pick up changed
  roles; neither sign-out nor role removal guarantees revocation of all outstanding tokens.

Required upgrade truth table:

| Global writes | Destination writes | Caller grants | Result |
| --- | --- | --- | --- |
| Off | Any | Any | No mutation |
| On | Missing/off | Writer/admin | No mutation |
| On | On | Missing read grant, raw write scope or exact write grant | No mutation |
| On | On | All required grants | Reviewed mutations, further restricted by operation/resource gates |
| Any | Any | Aggregate, Basic or standard authorization mode | No mutation |

Add a cross-destination test: enabling A must not enable B. Keep direct-call tests independent of
the displayed catalog. Preserve read behavior when a writer lacks the transport capability.

Transport truth table (every row additionally requires the common pinned write gates):

| Global transport switch | Functional transport scope | Destination request list | Management result |
| --- | --- | --- | --- |
| Off | Any | Any | Denied; allowed source recording remains independent |
| On | Absent | Any | Denied; allowed source recording remains independent |
| On | Present/implied by existing scope rules | Absent | Denied |
| On | Present | Exact/prefix | Known allowed parent requests and their verified tasks; create denied |
| On | Present | `*` | Management allowed beneath global request policy; create needs global unrestricted too |
| Previously configured On | Existing role already carries transports | Existing recording list | Upgrade enables reviewed management for allowed writable targets; no second acknowledgment |

Test two-role attribute merging and preexisting MCPDeveloper/MCPAdmin assignments. A global
transport switch retained from an older configuration can become effective on pinned routes.
Enforced multi-target mode still cannot coexist with an independent single-target `/mcp` in the
same app; do not describe that prohibited topology as an upgrade prerequisite.

Upgrade note for the shipped guide/release notes:

> This release expands built-in operations on explicitly writable pinned PP destinations,
> including deletion, target settings, tracing and classic FLP management. Global write enablement
> alone does not enable destination writes. Read-only applications and destinations remain
> read-only. Transport management also requires its existing global switch and functional scope.
> Existing recording allowlists also govern management when those gates are already enabled.
> Functional transport scope applies to every exact write-granted target, including grants merged
> from other roles; it is not limited to targets listed in the role that supplied that scope.
> Package restrictions govern repository edits; CTS management and non-repository operations have
> the separate scope described below. Review SAP_DENY_ACTIONS and SAP roles for unwanted operations.

## 4. Repository mutation contract

Use PR 1's shared lifecycle/context and the existing single-target object adapters. Extend the
adapters with required pinned policy, not optional bypass hooks. Do not fork a full second set of
DDIC/RAP/include/metadata implementations.

Converge all pinned repository operations onto the common dispatch/protocol adapters and remove
the overlapping `handlePinnedWrite` orchestrator after its CLAS/INTF behavior is represented there.
Use the same required context discriminator for SAPWrite and SAPActivate. Preserve the existing
pinned result semantics for existing operations through shared formatters, not a second engine.
All new adapters receive PR 1's scoped HTTP facade, including direct HTTP calls in text pools,
FLP, trace, formatter, CTS and publication helpers. Its policy reaches every modifying request;
session-close options or `postCreate` alone do not establish no-replay behavior. Ordinary reads
outside the mutation scope retain their current policies.
Include package-hierarchy dependency reads made during mutation validation: the existing
`getPackageHierarchyResolver()` uses the raw client without the mutation deadline/signal.
This predates PR 1 and is not a replayed-write gap, but PR 2 must propagate the scope there too.
Test a subtree allowlist with cancellation during hierarchy resolution and assert no later GET/save.

### Mapped SAP identity inventory

P2-A inventories every native user field and default: create/batch-create/metadata `responsible`,
explicit-target CTS creation's `tm:owner`, CTS listing filters, profiler trace user, trace-request
listing and any per-type create template. For pinned `mapped-user-unverified` contexts, omit
optional responsible/owner fields so SAP chooses its logged-on user; never substitute `username`,
`config.username` or `getEffectiveUser()` when they originate from JWT claims. Accept an explicit
native user only where the operation actually supports that field and SAP authorizes it.

Name `SAPManage.create_package` explicitly: on-prem packages require a nonempty native
`responsible`, and the current default comes directly from `config.username`. Pinned calls require
an explicit `responsible`; do not omit it or derive it from JWT identity. SAP checks that this user
exists, not that it is the caller. Document responsibility separately from the acting PP identity.

For CTS reads, omit an absent user filter where SAP defaults to the logged-on user. For profiler
and trace-request APIs without a verified current-user default, require an explicit native SAP
user or existing authoritative identity evidence. Correct pinned read-default attribution in PR 2
as a named compatibility fix, with regression tests; PR 1 does not change it. Fix misleading
display-only username comments in affected code. Verify SAP-assigned responsibility/task ownership
with a second identity whose IdP name differs from the mapped SAP username.

For every operation, specify and test:

1. The actual authorization owner, edited resource, lock owner and activation owner. They may
   differ: FUGR structural includes lock the include; class includes lock the class; text elements
   lock the text-pool resource; table settings use the table package.
2. Independent global/destination package decisions using native metadata. Creates require a
   valid requested package, followed by verification of SAP's actual assignment. An inherited
   package cannot be authorized from a caller's ignored `package` argument.
3. Locality/CTS evidence, canonical request/task policy and under-lock revalidation. Do not
   blindly apply the current CLAS wire parser to every metadata object. An unknown native shape
   is incomplete evidence, not permission to fall back to legacy unchecked recording.
4. A five-minute per-call mutation budget and existing tighter operation limits, cancellation
   between unsent phases, no replay of ambiguous mutations, and cleanup in the owning session
   with a separate bounded budget. Nested creates/saves/activation share the outer budget.
5. A verified outcome: source readback where meaningful; metadata/state verification according to
   the object's native contract; explicit partial/unknown results after submission. Do not retry
   creation, deletion or activation automatically because the result cannot be confirmed.

### Freshness and object-specific behavior

Retain mandatory hashes for the currently qualified CLAS/INTF operations. Extend the requirement
to existing text-source updates/surgery already covered by `SAPRead(format="editable")`, matching
the exact owner/include/group bytes under the correct lock. For a deliberately new optional
include, verified absence plus initialization under its owner's lock is a separate creation path;
do not invent a hash of a non-existent object.

Metadata, AFF/SDO, text pools and other representations do not currently share that hash API.
Use fresh under-lock merge/native ETag or version evidence where supported. Preserve omitted
fields, arrays' documented replacement semantics and inactive drafts. Whole-document replacement
without an optimistic precondition must be documented as such; do not claim lock acquisition alone
detects changes completed before the lock. A universal snapshot protocol is separate work unless
native evidence makes a small adapter-specific addition necessary for safe support.

Preserve current create templates, post-create metadata PUTs, missing-include initialization,
method-surgery algorithms and required deletion prechecks. Keep immediate-active types truthful:
APLO/UIAD and native management operations cannot promise a separate review-before-activation step.
Honor existing quality flags where they affect only lint/advisory syntax; no input may disable
authorization, recording evidence, locking or required activation validation. Review per-call
quality overrides explicitly in the matrix before exposing them.

Deletion has no source-hash precondition in this scope: authorize/lock the actual current resource,
perform native deletion/dependency checks and verify absence, while documenting that a lock does
not prove the content is unchanged since a prior read. RAP helpers likewise have no caller-supplied
multi-source hash protocol today. Read every affected source fresh under its native owning lock,
preserve intervening drafts, and generate/apply against those bytes; validate the complete set
before any implicit activation. Report generation's existing default activation explicitly.
Do not describe delete or RAP generation as protected by `expectedSourceHash`.

### Exact text-pool activation exception

The current text-element adapter deliberately activates the exact text-pool URI with
`preaudit=false`; the present pinned activation boundary rejects this. Choose a narrowly typed
internal `exact-text-pool` activation policy for PR 2, subject to live qualification and a new ADR
exception. Validate the canonical pool URI, actual owner/package and recording before sending;
do not accept caller-selected arbitrary URIs or expose a generic bypass via `preaudit=false`.
Refuse any SAP-expanded reference. Verify explicit pool metadata with `readTextPoolState` after
the request. The pool must be unlocked before activation, so metadata alone cannot prove which
content activated: require an active version and an active-part read equal to the saved readback,
using a supported version-specific read. If either proof is unavailable or differs, report
saved/activation-unconfirmed. Do not clear the multi-target context.

This remains a named-unverified adapter until qualified on the supported releases. Test an owner
with unrelated inactive drafts, all supported pool parts, empty active/inactive CLAS/FUGR cases
and a never-activated PROG that requires its first owner activation. Preserve PROG/FUGR deletion's
second text-pool lock and refusal of inactive pools; never activate an unrelated draft to make
deletion succeed. Verify afterwards that unrelated owner drafts remain inactive. Ordinary
owner/batch activation keeps the preaudit validation rule below.

### Activation and batches

Replace or generalize `handlePinnedActivation` as the single pinned activation adapter; do not
retain its CLAS/INTF-only, five-reference orchestration beside a new broader implementation.
SAPActivate and every nested caller use this adapter and one shared reference-validation entry
point with typed owner/batch/exact-text-pool policies. Keep public `preaudit=false` refused; the
qualified internal pool policy is the only exception. Publication actions dispatch to their
guarded protocol adapters without falling through the old activate-only handler.

Authorize every initial resource before the first preaudit request; that request may already
activate. Resolve each additional SAP reference to a recognized owner and independently check
type, package, recording and target before any confirmation. Reject unrecognized, foreign or
ambiguous reference forms. Report the complete affected scope, including existing inactive drafts.

Extend low-level batch activation with a required pinned validator and the shared deadline.
Every nested caller (batch create, text elements, RAP helpers, server-driven adapters) must carry
the same context. Never clear `multiTargetWrite` to enter the old batch path. The ED064 fallback
is usable only if each resulting submission stays within the validated set and shared budget;
otherwise report the unresolved result without replay.

Do not inherit the single-target 100-item batch limit as a pinned throughput promise. Start the
qualification harness with a pinned candidate cap of 10 input objects and 20 resolved activation
owners, plus a separate 100-reference cap before reference normalization/deduplication. Measure
per-adapter PP round trips and end-to-end latency with cleanup reserve, then set final constants
and matching schemas from that evidence. Reject oversized inputs and known over-budget workflows
before the first mutation. An estimate cannot guarantee runtime latency: retain the shared deadline
and honest partial outcomes when SAP is slower. No cross-target batch. Preserve per-item results
and the existing partial-subset behavior after a runtime failure; do not imply atomic rollback.

### Package moves, API contracts and publication

For moves, verify the actual original package and require both policies to authorize both sides;
include subobject ownership and CTS effects. Package creation/deletion must check the package
resource itself and required hierarchy/emptiness evidence. Follow current native API-state
ReadOnly/visibility flags and verify state after updates. Publication/unpublication must identify
the actual binding, version and service type, verify outcome and report availability changes.

Inventory implicit recording before admission, not just explicit transport arguments: API state
uses `request=`, package-move preview can return a SAP-selected request, publication may have
release-specific effects and FLP can trigger client customizing recording. Validate any preview/
native selected request against both CTS policies before the executing call. Establish whether
the preview itself has side effects before treating it as read-only. If recording cannot be
established before a mutation, refuse that operation/configuration with a precise reason until
qualified; do not bypass recording checks because the resource uses a non-CRUD endpoint.

## 5. CTS management contract

CTS management is authorized at request/task scope. An allowed request grants management of the
request, including its contents; package policies continue to constrain repository editing, but
do not promise a per-package subset release. Make this distinction explicit in the new ADR and
operator documentation. This is a proposed policy choice to review, not existing ADR-0010 scope.

- Require the common write gates plus global transport enablement, functional transport scope
  and a nonempty destination request allowlist. Check global and destination restrictions
  independently; retain the global legacy-empty semantics without applying them to destination
  absence. Do not copy write restrictions into the read-only transport configuration.
- Derive runtime `allowTransportWrites = enabled && base.allowTransportWrites`. The current runtime
  deliberately sets `allowedTransports=[]` for reads, and the existing `checkTransport` and
  `checkRecursiveTransportReleaseScope` interpret that empty list as unrestricted. Therefore both
  low-level write guards need an explicit multi-target branch reading the real destination and
  `serverAllowedTransports` policies; merely enabling the flag/action is unsafe. Leave their
  read-side behavior and single-target semantics unchanged.
- Resolve a supplied task to its proven parent and verify exact membership before mutation.
  Preserve parent-level recording semantics. Do not bypass the legacy single-target transport
  guards by passing an unrestricted fabricated safety object.
- Resolve/freeze the native parent/task tree asynchronously in the adapter, then carry an internal
  verified request scope into the synchronous guard. Check only the canonical parent against
  both lists and require every submitted task ID to belong to that verified scope; never accept a
  caller-created membership object or authorize a task merely because its ID matches a prefix.
  The create path needs a distinct pre-ID admission check; an empty ID must not skip restrictions.
- Existing handler checks before native tree resolution perform capability checks only; complete
  request authorization follows resolution and precedes mutation. Use one freeze point across the
  adapter and `prepareTransportRelease`; if a second read remains, a newly observed explicit task
  must fail closed rather than enter the submitted set without verification.
- For known requests, validate native type/state for the requested operation. Do not force every
  management action into the repository-save rule that only modifiable Workbench recording is
  valid; describe supported request categories per native action. Creating requests stays Workbench.
- Choose parent-request-level authorization consistently for pinned release/delete/reassign,
  including recursive forms. Exact parent grants authorize verified SAP-managed children; the
  single-target wildcard-only recursive-release rule remains unchanged for single-target calls.
  For pinned calls, the frozen tree bounds the explicitly submitted work and supports truthful
  reporting; it is not a separate task entitlement list. Do not silently add new explicit child
  operations mid-call. SAP may itself affect concurrent children during a parent operation: those
  children are within the parent grant, but report the observed expansion/uncertainty and do not
  claim an atomic snapshot. Retain inactive-object prechecks and terminal CTS evidence.
- `remove_object` uses the complete actual CTS key and verified membership. It removes a request
  entry, not the repository object. `removeLockedObjects=true` is an explicit destructive cleanup
  option, not a preview; preserve its current semantics and report affected tasks/entries.
- New request IDs are not known before SAP assigns them. Initial PR 2 create admission requires
  global unrestricted (legacy empty or explicit `*`) and explicit destination `*`. Under exact/prefix
  policies, explain that a request must be created externally and then allowed. Do not create and
  discover afterward that its ID was forbidden; do not derive authorization from a guessed prefix.
- Package-based request creation verifies the routing package against both package policies.
  Explicit native CTS `target` creation is request-level management; it does not have a fictitious
  package owner. Preserve the discovery-gated endpoint distinction and native target validation.

Require an explicit routing package for pinned package-based creation; do not silently default to
`$TMP` when it may be excluded. Expose pinned release `timeoutSeconds` only up to 300 seconds and
cap it by the remaining outer deadline; the single-target 1800-second schema remains unchanged.
An explicit CTS target may be any native configured TMS target/group authorized by SAP; no new
TMS-target allowlist is proposed. State that request/target policy is not an import-route sandbox.

`SAPTransport.create.target` means CTS destination (`TR_TARGET`) on a pinned route. It must stay
in the handler arguments and must never select another ARC-1 target. Only the pinned URL selects
the SAP backend. Keep aggregate mutations forbidden and reject route-selector-shaped input where
it conflicts with the native field grammar. Include this distinction in the schema description,
tests, examples and audit fields (ARC target versus CTS target).

## 6. Tracing, formatter settings, quickfix and classic FLP

These operations are explicitly in PR 2. The proposed non-repository policy uses the common target
write gates, per-action denial and SAP authorization; package lists do not constrain trace users,
formatter settings or catalog IDs. The design proposes no new per-operation permission system.
This policy choice requires the new ADR/review and is not an already accepted runtime exception.
Document the actual resource scope in tools and diagnostics. Implicit CTS recording still needs
the evidence and policy checks from section 4.

### Profiler and ST05

Qualify the PP identity used for trace defaults. `client.username`/JWT display claims cannot be
assumed to be the mapped SAP username. Use supported native identity evidence; if none is available,
require an explicit SAP trace user where the native contract allows it. Never silently widen to
all users because the default user is missing. Explicit broader filters remain subject to SAP
authorization and truthful output, consistent with the selected target-level management policy.

Profiler creation has two POSTs (parameters, then armed request). Track each phase and report an
orphaned/unknown parameters or request outcome accurately. Do not replay either after ambiguous
failure. Use verified returned IDs for readback/cancel; validate request URI/ownership according
to SAP's supported permissions, without converting the action into arbitrary DELETE.
Add pinned-only finite bounds in both schema and adapter: proposed 1–100 executions and an expiry
greater than zero and at most 24 hours, retaining the current defaults of one execution/24 hours.
These are new pinned limits; current single-target fields do not have matching upper bounds.

ST05 currently modifies SQL state on every application-server instance in the returned document.
Preserve unrelated fields and report the resulting instance/filter state. Require readback to
distinguish applied from unconfirmed state. Do not claim own-user or one-server scope. Trace state
intentionally survives the tool call so a workload can be reproduced; automatic disarm at return
would break the workflow. Provide explicit stop/inspect guidance. Live tests must restore the
captured prior state and record any leftovers rather than turning off another user's trace.

For pinned `sqlOn=true`, require either an explicit nonempty native SAP `user` or a proposed
`allUsers=true` input, mutually exclusive. No omitted/blank user may inherit an empty all-users
filter. `allUsers` is an explicit requested trace scope, not a new permission or deployment switch;
add it to the schema/runtime/handler together using the project's safe optional-boolean parser.
Qualify the native all-users representation before enabling that input. For `sqlOn=false`, preserve
the filter unless an explicit supported filter change was requested. Read back and show the actual
filter across instances. Preserve existing single-target defaults as an explicitly separate profile.
Qualify the native `user` grammar too: pinned `user` denotes one exact SAP username, with wildcard
or pattern selectors refused. A broad filter requires explicit `allUsers=true`; a pattern must not
circumvent that choice.

### Formatter and quickfix

The [1 November formatter checkpoint](../research/2026-11-01-broader-pinned-pp-writes-formatter.md)
records SAP's user-specific scope documentation, native adapter and handler integration, a restored
direct-authentication round trip and a two-identity MCP-visible run. Claude identified missing
in-run actor/backend proof; stronger current-revision PP qualification remains required.

Verify the native scope of formatter settings through PP. The current parser maps unknown styles
to `keywordUpper` and the writer emits only two fields; do not describe that as preserving native
fields. For the pinned adapter, patch only explicitly requested supported settings into the native
document, preserve untouched fields/style values, and refuse an unrecognized document shape.
Read-only native inspection subsequently found that older GET versions omit preferences replaced by
PUT. The current pinned adapter therefore requires v5, with no older-version fallback; the native
qualification reader must inspect that complete representation too.
Confirm readback, keeping single-target changes separate unless a shared fix is explicitly reviewed.
Report that it is a settings change, with no claim of DEVCLASS isolation. `format` returns source;
it does not save it. `apply_quickfix` retains its existing write-scope classification but returns
deltas without persisting repository source. Keep exact proposal URI/context validation and require
the ordinary guarded SAPWrite path to save proposed changes.

### Classic FLP

Reuse the current `PAGE_BUILDER_CUST` adapter. Qualify the non-ADT Cloud Connector path, PP,
OData CSRF handling and SAP roles; no Basic/shared-cookie fallback. Advertise only the classic
catalog/group/tile model actually supported, not business-catalog, spaces/pages or Work Zone parity.

Validate catalog, group, tile and membership identifiers and native ownership relationships.
Use existing readback where available. Current list actions do not prove group membership after
tile assignment; add a supported bounded membership read if native evidence supports it, otherwise
report assignment as accepted but unconfirmed and name the manual verification step. Do not turn
an HTTP success alone into verified membership. Existing FLP creates suppress transient retries
only; they do not suppress every auth/CSRF/negotiation replay, and catalog deletion uses default
retries. Apply the complete pinned request policy to every FLP mutation while preserving the
single-target baseline unless a separate shared correction is explicitly scoped.
No invented package/CTS mapping or new SAP helper is permitted for FLP.

## 7. Implementation work packages within PR 2

PR 2 is the feature PR after PR 1; the following are implementation commits/evidence milestones,
not authorization to publish a partly qualified full-parity claim.

| Package | Work and files | Exit evidence |
| --- | --- | --- |
| P2-A | Freeze exhaustive action/type/input and native-user-default inventories. Draft new ADR (next free number, expected 0011) qualifying ADR-0010; update security-domain model/R23 proposal. | No uncovered built-in mutation; explicit text-pool, CTS-parent and non-repository policy decisions; exclusions only Git/plugins and recorded backend gaps. |
| P2-B | Runtime/projection/safety plumbing; `multi-target-runtime.ts`, `multi-target-server.ts`, `multi-target-write-surface.ts`, `multi-target-tools.ts`, `authz/policy.ts`, `dispatch.ts`. | Common gate truth table passes for every mutating tool and direct hidden calls; transport management stays disabled until P2-F's guards land. |
| P2-C | Reuse shared object adapters in `handlers/write/*`, `write-helpers.ts`, `adt/crud.ts`, source/metadata/type modules. | CRUD/surgery/text/metadata families preserve owner/package/recording/concurrency and errors. |
| P2-D | `adt/devtools.ts`, `handlers/activate.ts`, `handlers/write/pinned-activation.ts`, batch/text/RAP callers. | One generalized pinned activation adapter; validated multi-owner activation, bounds, partial results and no legacy-path escape. |
| P2-E | `handlers/manage.ts`, `adt/refactoring.ts`, `api-release.ts`, publication adapters. | Package lifecycle, API state and service availability readback. |
| P2-F | `handlers/transport.ts`, `adt/transport.ts`, pinned request policy; `http.ts`, `xs-security.json`, deployment examples. | Runtime transport enablement and both low-level guard branches land together; generated-ID/recursive constraints, real-client scope and role evidence. |
| P2-G | `handlers/diagnose.ts`, `adt/diagnostics.ts`, `handlers/lint.ts`, `adt/devtools.ts`, `handlers/manage.ts`, `adt/flp.ts`. | PP trace/settings/FLP contracts, partial outcomes and cleanup verified. |
| P2-H | Schemas/tools/batch schemas, snapshots, budget checks, instructions/catalog, docs and final evidence. | Final-build tests, reviewed ADR, documented limits, upgrade and rollback examples. |

Preserve single-target signatures and behavior except explicitly identified shared bug fixes with
their own regression evidence. PR 1's behavior-preserving guarantees must not be used to hide a
feature change in its diff. Discoveries that materially change scope or architecture are recorded
as design changes before implementation, not silently removed from the inventory.

## 8. Validation and release gates

### Automated evidence

- Full off/on/grant/identity truth table for every mutating action family, including raw admin-only,
  missing/malformed write grants, read `*`, target mismatch, destination drift and direct calls.
- Global/destination package and CTS constraints independently: empty, disjoint, exact, prefix,
  subtree, `*`, unresolved metadata and hierarchy failure. Transport read behavior stays unchanged.
- Actual lock owners, include initialization, type aliases, inactive drafts, language/master-language
  handling, PP responsible-user fields and nested writes/activations.
- Cancellation, response loss, 401/403/429/5xx, session reset attempts, unlock/close failure,
  created stubs, partial deletion/batches, immediate-active types and unconfirmed readbacks.
- Initial/expanded activation refs, cross-target forms, malformed references, scope bounds and
  recovery. No inherited single-target path bypasses the required pinned validator.
- CTS parent/task relationships, generated ID refusal before POST, explicit native `target`,
  concurrent children, released/unknown states and full removal keys.
- Build CTS negative tests from the actual `buildMultiTargetConfig` result whose legacy
  `allowedTransports` is empty. Prove both policies still bind management and recursive calls;
  do not test only hand-built safety objects. Cover role-merge expansion explicitly.
- PP trace user defaults, two-step trace failures, ST05 multi-instance/filter preservation,
  settings scope, FLP create/assignment/delete readback and canonical non-ADT paths.
- Tool-schema/runtime parity, truthful mixed-tool annotations, strict-mode compatibility, maximum
  catalog size, bounded diagnostic fields, no secrets and correct target/identity audit correlation.
- Unchanged single-target and existing aggregate/Basic regression suites; ordinary read retries,
  cache behavior and native ATC/Unit/read/data/SQL scope remain unaffected.

Reuse focused tests under `tests/unit/handlers/`, `tests/unit/adt/` and `tests/unit/server/` named in
the research/PR 1 plan. Add a machine-checked coverage assertion that every policy mutation has a
multi-target disposition; newly added actions must not inherit approval automatically.
Run `npm test`, `typecheck`, `lint`, `validate:policy`, `build`, `check:sizes` and relevant docs/MTA
validation for the actual changed files. Do not claim skipped integration cases as passing.

### Live evidence

Use isolated authorized test systems, disposable objects/requests/catalogs and actual deployed
CF pinned PP routes. A Basic-auth helper test does not prove PP. No live work is authorized by this
planning-only change. At implementation time record fixture ownership, target, permitted changes,
prior state and cleanup plan before mutation.

Cover a positive mapped SAP writer, a second identity with negative write evidence, a destination
with no write opt-in, and aggregate/Basic negatives. Verify author, native saved/active state,
recording and remaining locks. Use representative 750, 758 and 816 routes where available; keep
an action-family/release evidence matrix and distinguish unsupported from unverified combinations.
The previous 758 CLAS qualification is a baseline, not proof of the expanded feature.

Required workflows: class/include/test-class development; program/FUGR/FUNC; metadata and DDIC;
RAP stack with batch activation/publication; text pools; deletion; package move/API state;
transport create/record/release/delete/reassign/removal; trace arm/inspect/cancel/ST05 restoration;
formatter settings restoration; classic FLP lifecycle. Some tests may reuse the same disposable
fixture, but no operation group is waived merely because another group shares a helper.

Transport release is irreversible and can affect downstream queues. Use a test transport route
with no downstream import path, or obtain and record explicit authorization for the actual queue
effects before the live test. Neither this plan nor generic disposable-object permission authorizes
an import or production transport action.

Run a real MCP client through new authorization and catalog refresh for write/transports. Verify
fresh tokens, the unchanged mutation-free aggregate connection and the effective role setup.
Record exact ARC-1 build, SAP release/SP, route/auth, client/version, observed outcome and cleanup.
Any unavailable backend evidence becomes a precise support limitation or a merge-blocking gap for
the claimed scope, never a fabricated success. Security/design review remains necessary.

### Documentation and governance

The feature PR needs a new reviewed ADR qualifying ADR-0010, updated security model/resource
domains, AGENTS/dev-guide routing, the authoritative deployment/write/authorization guides,
configuration reference, examples and annotated release notes. Keep current docs unchanged until
implementation supports the claim. Plan/research links must be labelled proposed.

Include the upgrade note, generated-ID/recursive transport limitations, target-level tracing/
settings/FLP permissions, immediate-active types, actual cross-client effects, stale token limits,
asynchronous audit and partial/unknown recovery. Show explicit false values for MTA rollback;
restart every instance for changed policy/snapshots and state that admitted calls may finish.

Name the authored-test execution path: newly editable class/program/function-group tests can run
under whichever SAP identity invokes ABAP Unit, which remains read-scoped. A declared harmless
test is not a sandbox. Preserve ADR-0009 and document `SAP_DENY_ACTIONS=SAPDiagnose.unittest`
(and any separately enabled Unit CI action) for operators who do not intend that execution.

FEAT-93 remains open during planning and after PR 1. At PR 2 completion remove the shipped scope
from overview/details; keep only concrete remaining gaps with evidence. Git/plugins are explicit
exclusions, not automatically promised follow-up work. The planning change itself ships no writes.

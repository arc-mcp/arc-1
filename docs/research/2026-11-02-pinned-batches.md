# Private bounded creation and activation batches

This is an offline implementation candidate for PR #1142, P2-D/P2-H. It adds no public
capability or schema row. Native contracts, release coverage, two-writer PP, recording transports
and final limits remain unqualified. No native request was made for this change.

## Scope and input

`handlers/write/pinned-batches.ts` has two private entries: `handlePrivatePinnedBatchCreate`
and `handlePrivatePinnedBatchActivation`. The authenticated harness supplies scopes separately;
input cannot select a target, scope, profile, URI, runtime policy or arbitrary nested action.
The public dispatch and capability matrix continue to refuse both batch forms.

The candidate accepts at most **10 input objects before deduplication**, **20 resolved activation
owners**, and **100 raw native preaudit references**. The native parser checks its raw reference
count before normalizing names; it never silently truncates. The fixed source limit is 256 KiB
per item and one MiB of total input strings/keys, with bounded arrays/depth/node count. These are
qualification limits, not throughput or latency promises. Every nested phase shares one five-minute
deadline, caller cancellation and non-replayable transport; owning-session cleanup retains its
separate bounded allowance.

Creation accepts `action=batch_create`, `objects`, optional `package`, `transport`, `group`
defaults and boolean `activateAtEnd`. Objects use reviewed per-item fields. An explicit package
is required per item or as a default, except FUNC inherits its verified existing group's package.
`group` defaults only FUNC; it cannot redirect another family. Names/types are canonical uppercase;
create TABL means TABL/DT. Unsupported nested fields are refused before legacy Zod normalization
could strip them. Unknown quality flags cannot disable native checks.

Activation accepts `action=activate` (or omission), `objects` with exact `type/name` and an explicit
FUNC `group`; `preaudit` can only be absent or true. Identical activation owners are deduplicated
in first-occurrence order, after the raw cap. Conflicting kinds or function parents refuse.
Creation duplicates refuse, including CLAS/INTF and TABL subtype collisions. A DDLS and BDEF
with the same name remain distinct native owners.

| Combination | Private candidate behavior |
| --- | --- |
| CLAS/INTF/standalone PROG/INCL creation | Shared source context, creation, save verification and cleanup |
| DDLS/DCLS/DDLX/BDEF/SRVD creation | Shared private declarative context/actions; metadata-only forms retain their existing native verification |
| DOMA/DTEL/MSAG/TTYP/ENQU and TABL/DT or /DS creation | Shared DDIC context/actions, including required post-create metadata saves |
| FUNC creation | Explicit existing group; inherited native package/recording; structured source/processing behavior remains in the shared adapter |
| SRVB creation | Shared private binding create; explicit definition/version/category; native inactive/unpublished readback; no publication |
| Activation | The common source/declarative/DDIC/FUNC/SRVB owner profiles, including non-immediate-active server-driven activation |
| SDO creation, FUGR/group-owned INCL batches, ENHO/SKTD | Refused; these batch combinations remain unimplemented/unqualified |
| APLO/UIAD activation | Refused: their saves are immediately active |
| RAP scaffold/generation, publication, package/CTS batches | Outside this candidate; no implicit dispatch |

Whole-group generation is not combined with the ordinary activation protocol. New technical settings
still require their existing parent-activation sequence; a batch does not bypass that native rule.
A single-owner profile existing privately does not by itself establish every batch combination.

## Shared preparation and execution

The input snapshot is immutable. Every item is statically selected and validated, including the
single-create quality checks and body builders, before native calls. Package/recording preflight
then covers all source-create items before the first create. Requested binding packages are checked
at that stage; its actual package, definition and recording are proved by the binding adapter at its
own step, since the definition can be an earlier explicit SRVD item. Each real adapter repeats its
fresh native checks at execution; no package or CTS result is reused across items as authorization.
FUNC's ignored package argument never replaces its group's native package.

The default creation mode activates each completed owner inline, in input order. `activateAtEnd=true`
creates all items in input order, then submits the complete explicitly selected set in one native
activation handshake. This supports dependency sets without inventing a dependency sorter or adding
owners. The caller must supply a viable create order and choose deferred activation when appropriate.
Source declarations and native authorization remain SAP's responsibility; this is not RAP scaffolding.

`pinned-activation.ts` now exposes an internal preparation/completion boundary around its existing
owner validators. The ordinary single-owner entries use the same execution path as before. The private
batch prepares all native initial owners before the first preaudit POST (which may itself activate).
It partitions every native reference to exactly one selected owner's existing validator; duplicate,
foreign, ambiguous, omitted-owner or over-limit sets refuse confirmation. Existing permitted class
includes/program text-pool expansions remain owned scope, not new repository owner admission.
Every selected owner's draft/package/recording is rechecked before confirmation. An arbitrary dependency
outside the explicit set is never added, even if SAP reports it.

The existing `adt/devtools.ts::activateBatch` performs the handshake. Its new pinned branch requires a
registered scoped transport, preaudit and a validator. It shares the caller deadline and uses strict
native execution evidence. It never runs the legacy ED064 single-object fallback. Legacy single-target
batch behavior, including ED064 recovery and its existing partial-subset activation, stays unchanged.

## Partial outcomes and stop rules

Each item retains separate create and activation results. A successful source/metadata save is not
erased by failed activation or later cleanup. Native batch success is retained even when per-owner
readback fails; remaining owners are unconfirmed rather than inferred successful from absent messages.
`submissionPossible` prevents a failed activation POST from being reported as unchanged. Earlier
individually verified activation results survive a later owner's verification failure. Each owner also
reports the bounded union of exact attempted native references, including allowed owned drafts/expansions;
rejected or merely inspected references are not reported as attempted.

The private workflow stops on failure, cancellation, deadline or uncertainty. In particular, deferred
activation does not begin after a create/save failure, following this task's explicit stop requirement.
This is a deliberate difference from the unchanged legacy single-target partial-subset behavior.
There is no rollback, repair, publication, repeat activation, or retry of ambiguous create/save requests.
Native effects may already have occurred, including dependent DDIC/database effects and existing inactive
owner drafts documented by each family. Review the detailed result before any new request.

## Offline evidence and remaining qualification

`tests/unit/handlers/pinned-batches.test.ts` drives the real orchestrator, native adapters and HTTP
layer through the established fake backend. It covers later-invalid-input with zero earlier writes,
package and CTS denial, mixed families, inline/deferred ordering, a six-owner CDS dependency set,
static/raw/resolved scope bounds, exact owner deduplication, scope and target gates, immutable input,
preaudit expansion/drift, non-replay, shared deadlines, cancellation, cleanup failure and partial results.
Focused existing suites cover single-owner activation and legacy create/batch/ED064 compatibility.
All HTTP-bearing test imports occur after the undici mock prologue. These checks are offline models,
not SAP compilation, native wire qualification or PP identity proof.

Before public admission: independently review the immutable candidate; qualify representative native
source/DDIC/FUNC/binding batches with exact transport and lock evidence; exercise first-POST activation,
partial native reports and owned expansions; measure PP round trips and cleanup reserve on supported
releases; run the current-build two-writer and negative-route matrix; only then set final public schemas,
capability rows and descriptions. Deferred SDO/group/ENHO/SKTD batch support and higher-level RAP
orchestration remain explicit implementation gaps.

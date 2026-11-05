# Native CTS, runtime and classic FLP contracts

The [research index](inventory.md) links current admission and acceptance. Scenario IDs below stay
checked against the runtime catalog; they describe evidence to reconcile, not a blanket claim that
every scenario is unattempted or every implemented row qualified.

## CTS inventory and absence

Rich inactive inventory distinguishes request headings, exact empty slots, unassigned objects
with a present empty transport container, and assigned objects with a canonical request reference.
Neither `linked=false`, `deleted=true` nor navigation `parentUri` removes an assignment. An object assigned
to the selected task/parent blocks release. Missing/ambiguous containers, foreign fields, pagination,
count metadata and incomplete responses never prove an empty inventory. Class DELETE can re-record
its R3TR row after explicit record removal; class absence neither empties that request nor supplies
a package fallback. [Native inventory shapes](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-05-pinned-cts-inactive-native-shapes.md).

The captured missing-request response is bounded HTTP 404 with communication-framework XML:
com.sap.adt, ExceptionResourceNotFound, SADT_RESOURCE/002, resource kind Transport Request/Task and
the exact requested ID in T100KEY-V2. This post-delete discriminator is not a generic preflight
fallback. Wrong identities/namespaces/status, extra/duplicate properties, HTML and authorization
failures remain unknown; child deletion does not justify a disappearing parent.
[Typed absence evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-cts-typed-absence.md).

## Traces and selected platform

Profiler start creates parameters and then a request. Failures can leave parameters, an armed
request or an unconfirmed request; known IDs/effects must survive in results. No native parameter
delete contract is established. Cancellation selects an exact listed user/client entry. Requested
SAP subject and native acting user are distinct.

ST05 spans application-server instances and is neither client-isolated nor own-user-only. A4H's
inactive getter empties the user filter and resets known inactive fields while preserving the
independent stack setting. Verify OFF against that projection, not a retained-filter promise or
third restoration PUT. Opaque fields stay compared; ignored modification/locality nodes still need
exact scalar/boolean shapes. Numeric-reference representations are outside this ST05 profile;
named escaping and literal entity-looking opaque text remain distinct. Without a strong ETag,
the result stays `native-unconditional`: pre-read is not a cross-writer lock.
[ST05 native evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-st05-native-inactive-state.md).

Native-governed profiles require selected-target native platform evidence. Configured release
overrides and unknown platforms do not supply it. Automatic/manual producers must preserve the
native detector fields through runtime handoff; caller-supplied coverage cannot qualify a profile.
[Projection correction](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-05-pinned-native-platform-projection.md).

## Quickfix computation

Native proposals use the captured concrete identifier/type pairs as well as a generic spelling,
bound to exact refactoring paths. Delta display labels are not owner authority. Optional
`variableSourceStates` is accepted only with its exact empty ADT-core object-reference envelope;
populated or unknown state is not ignored.

Application computes unsaved deltas without source lock/save/activation. Exact proposal URI/context
headers, owner/type, supplied-unit membership, fresh source/cursor/state, bounded nonoverlapping
ranges and complete text stay checked. Native replacement is not necessarily insertion: the observer
compares the complete resulting in-memory buffer and independently proves stored source unchanged.
[Captured types](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-native-quickfix-type-contract.md)
and [result envelope](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-native-quickfix-result-contract.md).

## Classic FLP

PAGE_BUILDER_CUST error /UI2/FND/604 means unknown lookup, not entity absence: provider/cache failures
can collapse to it. Another key's successful read does not resolve that. Collection errors do not
mean empty collections; post-DELETE 604 remains unconfirmed.

Create-only behavior instead relies on native CREATE checking authority, enqueue/changeability and
must-not-exist under its lock. It does not infer absence from failed lookup. POST and keyed readback
must agree on exact writable CUSTOMIZING identity and group-container relationship. Submitted
failures may leave Page/PageConfig/CTS effects and are not atomic no-effect rejections. No replay or
speculative cleanup follows. [Native duplicate protection](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-flp-create-only.md).

The native no-dialog transport path permits empty/- no-request context and sends actual requests
to CTS without proving which request/task was used. Explicit * independently in both request
policies covers any native selection before execution; missing/empty/narrow lists do not. Results
stay `native-governed-unverified`, not a request receipt or CTS-management grant. Final direct/proxy
send checks retain context, deadline, cumulative limits and cancellation. This ordinary CUST source
profile does not qualify FDM, cloud or custom-handler variants.
[Native recording contract](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-pinned-flp-native-recording.md).

## Qualification scenarios

Use the [acceptance ledger](../2026-11-05-pr1142-current-acceptance.md) for actual completed/remaining
work. Execution requires bound source/artifact, exact authorization and original ownership/no-replay
records. These IDs never authorize replay of a consumed experiment.

| ID | Required evidence and refusal boundary |
| --- | --- |
| TRC-1 | Real PP mapped acting user/roles and selected client, not IdP-name inference. |
| TRC-2 | Explicit second SAP subject, native authorization result, distinct acting user; listing cannot consume the request. |
| TRC-3 | Each POST denied/lost/cancelled: orphaned parameters versus unconfirmed/armed request, known IDs and no replay; no invented parameter cleanup. |
| TRC-4 | User grammar, expiry rounding/tolerance, executions, task types and server selection fidelity; unsupported multiple-entry shapes refuse. |
| TRC-5 | Exact cancel entry/client, consumed/expired entries, DELETE/absence and other-client refusal. |
| ST5-1 | Exact SAP-user behavior and native release grammar, including pattern refusal. |
| ST5-2 | Empty-user/all-user semantics per release; no inferred public allUsers input. |
| ST5-3 | Complete stable instance set, all-instance state, ETag/If-Match and scalar locality/selection fields; incomplete readback stays unconfirmed. |
| ST5-4 | All-off/empty-user inactive baseline, ON(subject), then OFF restoring its projection; preserve stack/opaque state and another operator's trace; no automatic third PUT. |
| FLP-1 | PP/Cloud Connector service, roles, CSRF/no replay, exact keyed identity and truthful bounded listing; 604/service failure never proves absence or permits Basic fallback. |
| FLP-2 | Recorded/unrecorded/refused native behavior and actual CTS effects; both explicit wildcard policies for native-governed selection, never a guessed request receipt. |
| FLP-3 | Catalog create-only/duplicate refusal, exact id/domain/type/scope and writable flags; submitted failures retain possible effects. |
| FLP-4 | Group create-only/duplicate refusal, exact container, CUSTOMIZING scope, catalog-page/read-only flags and cleanup. |
| FLP-5 | Tile configuration/association readback, native length limits and instance identity. |
| FLP-6 | PageChipInstances support and complete page/instance/chip membership; unsupported/incomplete readback stays accepted-unconfirmed. |
| FLP-7 | Authoritative catalog absence and effects on tiles/referencing groups; parent success and generic 404/604 cannot establish cleanup. |
| QFX-1 | Real PP evaluation/application with exact URI/headers/namespaces/state and two mapped writers; read-only/Basic/aggregate/Copilot/scope/grant/deny-action negatives. |
| QFX-2 | Complete delta text/ranges; unchanged independently read stored/default/active source, including inactive owners and unsaved includes; no persistence fallback. |
| QFX-3 | Same-owner affected units and fresh source/cursor/state; foreign units, query/interactive proposals or unstable state stay unsupported. |
| QFX-4 | Denial/lost response/cancellation/deadline, no replay, bounded complete documents, truthful uncertainty and independently verified cleanup. |

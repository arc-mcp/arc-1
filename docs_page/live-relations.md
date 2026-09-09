# Live relations (experimental)

Ask SAP for a small, current repository relationship network without collecting source code
or operating a graph database. ARC-1 automatically offers `SAPNavigate(action="relations")`
where available; it adds no top-level tool, database, collector or configuration switch.

Use it to find objects using a class/interface, explore its dependencies, or follow several
native relationship steps before deciding what code to inspect. For exact source locations use
`SAPNavigate(action="references")`; for a CDS/RAP impact assessment use `SAPContext(action="impact")`.

## Prerequisites

- An already working **single-target** ARC-1 deployment with `ARC1_TOOL_MODE=standard`.
- SAP must advertise `/sap/bc/adt/objectrelations/network` with
  `application/vnd.sap.adt.objectrelations.request.v1+xml` in ADT discovery.
- The caller needs ARC-1 `read` scope and SAP authorization for object metadata and Relation
  Explorer. The lookup is a read-only POST: the relevant SAP ADT resource authorization may need
  `ACTVT=01` and `02`. No new ARC-1 role, SQL permission, or write permission is required.
- Cloud Connector must permit discovery, objectrelations and metadata paths for the requested types.
  Use the normal least-privilege resource allowlist; do not expose all SAP paths just for this feature.

Single-target principal propagation keeps using the caller's selected SAP identity. Shared Basic
authentication keeps its existing shared identity. Neither mode falls back to the other on failure.
Multi-target and hyperfocused modes do not offer this experimental action.

## Local and Docker setup

Keep your working SAP connection and authentication configuration. Use an ARC-1 build containing
this feature and refresh the MCP client's tools after upgrading.
Do not publish another port or deploy another container/database. Normal `ARC1_CACHE` settings
remain independent. See [Deployment](deployment.md) if ARC-1 is not installed yet.

The action is visible while
capability discovery is still unknown, so clients that only list tools once can use it. A known
unsupported endpoint/MIME hides it. tools/list never waits on SAP; invocation always checks the
exact capability before object access and performs bounded discovery when necessary. A shared-client
`SAPManage(action="probe")` can refresh failed/stale discovery; per-user probes do not replace the
shared capability cache.
Successful shared-client fallback discovery is parsed once and retained in the existing in-memory,
destination-scoped capability cache. Later calls reuse these hints, but still read root metadata
and relationships live as the caller. Per-user fallback discovery stays request-local: it never
changes another user's capability hints or tool surface. While shared discovery remains unknown,
per-user calls repeat bounded discovery. Failed or unsupported fallback discovery is not retained.
This cache is independent of `ARC1_CACHE`; it stores neither object results nor authorization grants.

## SAP BTP Cloud Foundry setup

Start with your working single-target deployment from the
[BTP task map](btp-overview.md). This feature needs **no additional BTP service, HANA/PostgreSQL
instance, service key, AI Core subscription, or separate route**.

1. Upgrade the existing ARC-1 application using the normal
   [BTP administration workflow](btp-administration.md). Preserve its destination and authentication settings.
2. No relation-specific application property or service binding is required.
3. Reconnect the client and run a depth-1 lookup on a known object. If hidden/unsupported, inspect
   ADT discovery, Cloud Connector resources and the user's SAP authorization before changing roles.

To disable this action, append `SAPNavigate.relations` to the existing `SAP_DENY_ACTIONS` list
and redeploy/restart. This both hides the action and rejects invocation; preserve other denials.
For early preview upgrades, remove `ARC1_LIVE_RELATIONS` / `--live-relations`: that switch no
longer exists. An old environment value of `false` is not a denial; use `SAP_DENY_ACTIONS` instead.
Do not change your existing XSUAA/PP/shared-identity topology for this feature.

No extra BTP service charge is introduced by the feature itself. It still consumes the existing
app's memory/CPU and SAP requests; it does not guarantee that a particular deployment is free.
Stay within your current trial quota and do not provision storage for it.

## Calls and prompts

### Choose the evidence you need

Use `relations` for a bounded dependency map or package neighborhood, then read
selected sources to explain important connections. Do not also fetch every dependency contract
by default. Only the qualified types below are expanded; other returned nodes remain boundaries.

### Qualified object types

The same types can be roots and deeper nodes. All use live active metadata plus native ENV/WUL
relationships, not source parsing. The evidence was collected on SAP_BASIS 758; it is not a
promise of completeness on this or another release.

| Type | Useful question | Important limit |
|---|---|---|
| `CLAS`, `INTF` | Dependencies and neighboring consumers | Not a method-call graph |
| `DDLS`, `DCLS` | CDS/access-control dependencies | Generated `STOB` entities remain boundaries; no guessed DDLS alias |
| `TABL` | Table/structure dependencies and usages | Exact bounded search resolves the real subtype; no table rows read |
| `TTYP`, `DTEL`, `DOMA` | Row type → structure → data element → domain links | Built-in types are not repository nodes |
| `PROG`, `INCL` | Program/include dependencies | Large programs can exceed the byte limit even at depth 1 |
| `FUNC`, `FUGR` | Function/module-group dependencies and consumers | FUNC needs one bounded parent lookup; no function execution |
| `VIEW` | Classic DDIC view/table relationships | Exact bounded search proves identity before VIT metadata; CDS uses `DDLS` |
| `ENHO` | BAdI implementation class/spot links | Only live-verified `ENHO/XHB`, not every enhancement subtype |
| `ENHS` | Enhancement-spot interface links | Only `ENHS/XSB`; conflicting native facets fail rather than being merged |
| `MSAG` | Objects using a message class | Not a per-message-number usage search |
| `BDEF`, `SRVD` | Observed incoming implementation/binding links | On 758 outgoing can omit dependencies visible in source; use SAPRead for the RAP stack |
| `TRAN`, `SOBJ`, `SHLP` | Transaction/program, maintenance-object and search-help dependencies | Exact search independently validates VIT identities; no transaction execution or data access |
| `ENQU`, `TYPE` | Lock-object tables and type-group dependencies | Metadata only; no locks acquired |
| `SKTD` | Links from documentation objects to documented objects | Does not read the document or establish its business rules |
| `EVTB`, `DSFD` | Event-binding and scalar-function-definition relationships | Not event traffic or executed function calls; unqualified related types remain boundaries |

`DEVC`, `SRVB`, `DDLX`, `AUTH`, `DTDC`, `UIAD` and other unqualified roots are not accepted. Use package listing,
source/metadata reads, existing references or CDS/RAP impact tools instead. A native HTTP 200 or
empty graph alone is not enough evidence to advertise a new type.

For a class-only consumer list, including tiny samples, prefer
`SAPNavigate(action="references", type="INTF", name="<interface>", objectType="CLAS/OC", maxResults=5)`.
Here `type` identifies the root; `objectType` filters the results. Omit `objectType`
when all consumer types matter (for example, an unused-code investigation).
For a known pair or behavior,
targeted `SAPRead(grep=...)` or `SAPRead(method=...)` may answer the question in one call.
Where-used rows are not unique consumers or runtime call counts. Neither a small sample nor
source-derived `SAPContext` contracts prove complete system coverage or safe deletion.

### Authentication and redirects

Bounded analysis deliberately refuses HTTP redirects (including CSRF setup) so redirects cannot
escape the attempt budget. It does not perform interactive SAML browser login. Use your existing
authenticated SAP session, OAuth/principal-propagation destination, or a direct ADT endpoint.
If your on-premise administrator explicitly permits Basic authentication, `SAP_DISABLE_SAML=true`
can suppress the SAML redirect for those requests. Do not set it for BTP ABAP/S/4 Public Cloud,
disable TLS verification, or change the SAP identity to bypass a failure. A generic HTTP redirect
follow is not evidence that an SSO login completed.

### Examples

Replace the example object with an existing object on your SAP system:

```json
{"action":"relations","type":"CLAS","name":"ZCL_ORDER","direction":"incoming","depth":1,"maxResults":50}
```

```json
{"action":"relations","type":"INTF","name":"ZIF_ORDER","direction":"outgoing","depth":3,"maxResults":50,"expandPackages":["ZORDER"]}
```

Useful prompts:

- “Find the objects using ZCL_ORDER. Separate observed relationships from unknown coverage.”
- “Explore ZIF_ORDER's dependency network, expanding only package ZORDER. Which objects should I inspect next?”
- “Follow up to three native relationship steps from this class. Report any truncation, then verify the important links with source or where-used.”

Input requires a qualified `type` and `name`; `uri`, `source`, inactive versions and arbitrary endpoint
paths are not accepted. `direction` defaults to `outgoing`; `incoming` finds users of the root.
`expandPackages` accepts up to eight exact package names, no wildcards. It limits expansion beyond
the root, **not visibility or authorization**: neighboring packages still appear as boundary nodes.

## Interpret the result honestly

Edges point **consumer → dependency** in both directions. Nodes are identified by URI, so a CDS
definition and a behavior definition with the same name stay distinct. Unqualified object types
may be returned as boundary evidence but never become arbitrary HTTP targets.
Traversal is breadth-first, prioritizing neighbors in the root's package at each expansion,
then sorting by URI. This makes small-budget results useful and repeatable, not complete.

- `coverage="unknown"` is always present: native Relation Explorer is not a complete call graph.
- `scopeBoundaries` explains nodes not expanded due to requested depth, type, package or disappearance.
- `truncated`/`truncationReasons` reports resource limits; `pending` lists retained unexpanded work.
  Dropped nodes/edges cannot be enumerated after a size cap, so this is not a resumable cursor.
- `observedAt` is the analysis start time, not a transactionally consistent SAP snapshot.
- `metrics` reports SAP HTTP attempts, successful decoded metadata bytes and elapsed analysis time.
- The root is independently validated against live metadata. Other nodes are observed native
  references, not independently verified existence/authorization assertions.

Empty results do **not** mean unused, safe to delete, runtime-unreachable, or impact-free. Native
edges are generic “uses” evidence, not proven method calls, interface implementation edges, or
direct source-call hops. Some source constructs are absent from SAP's native network. There is
no hidden where-used, SQL, source-parser or alternate-identity fallback.

## Fixed resource limits

| Control | Limit |
|---|---|
| Depth | Default 1, maximum 3 native expansion steps |
| Nodes (`maxResults`) | Default 50, maximum 100, including root |
| Edges / expansions | 100 edges / 8 native expansions |
| SAP HTTP attempts | 12, including discovery/root metadata, CSRF and retries |
| Analysis deadline | 15 seconds including analysis admission and SAP HTTP queue/body/retry time |
| Successful metadata bodies | 1 MiB cumulative decoded bytes; error bodies individually capped |
| Concurrent analyses | 2 per ARC-1 process; normal global SAP concurrency limit also applies |
| Final serialized result | 512 KiB defense-in-depth cap |

These are overlapping ceilings, not promised completion counts. With no discovery/session state,
discovery GET + root metadata GET + CSRF HEAD + eight native POSTs uses 11 attempts; a CSRF GET
fallback uses the twelfth. `TABL`, `FUNC` and VIT roots (`VIEW`, `TRAN`, `SOBJ`, `SHLP`) need an additional identity-resolution request,
so a cold session can stop before eight expansions. Retries or large responses can stop earlier. Reusing ordinary
discovery/session state saves setup requests, never authorization checks or relationship results.

`metrics.successfulMetadataBytes` includes any discovery and root metadata read inside this analysis,
plus successful native response bodies. Failed response bodies have a separate per-response 1 MiB
cap and still consume HTTP attempts/time; the metric is **not** a cumulative cap on all network traffic.

CSRF control bodies are discarded after headers rather than buffered. These are not included in
the successful-metadata byte metric. The deadline starts after normal dispatch/identity preparation;
ordinary startup feature probes and Destination Service identity resolution are separate existing
work. Bounds are deliberately not configurable in v1. They bound retained data/work, not exact RSS
or total wire bytes. Compressed responses through Connectivity must honor `Accept-Encoding: identity`.
The strict parser accepts the ordinary XML declaration, but rejects comments, CDATA, custom
processing instructions and DTD/entities. Unexpected protocol variants fail with an error.

Authorization and malformed protocol responses are errors, including after earlier successful
expansions. A session/CSRF retry counts as recovered only after a complete, valid native expansion;
successful control headers alone (or a denied request retried as 404) cannot clear that failure.
Resource exhaustion after valid results may return explicitly partial evidence. Narrow
the requested root/depth/package scope; do not keep retrying the identical broad request.
If final response processing crosses the deadline, retained evidence is marked with `deadline`
truncation rather than discarded. Explicit caller cancellation always remains an error.
An unresolved native reference (`exists="false"`) remains a protocol error: v1 cannot distinguish
deletion from restricted visibility from that flag alone and does not present it as proven absence.

## Validation status

Experimental: the protocol was observed on SAP_BASIS 758 (S/4HANA 2023 trial). SAP documents the
[Relation Explorer user feature](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/relation-explorer),
not a stable public REST contract. Supported families evolve across releases. Exact discovery is
a prerequisite, not a compatibility or authorization guarantee. Direct SAP trial smoke and local
Connectivity-protocol tests do not establish live BTP PP or cross-release compatibility.

# Live relations (experimental)

Find dependencies or consumers of a repository object with `SAPNavigate(action="relations")`.
It reads SAP's current metadata and returns a small relationship map. Start with a known object:

```text
SAPNavigate(action="relations", type="CLAS", name="ZCL_ORDER",
  direction="incoming", depth=1, maxResults=20)
```

Inspect the returned limits and warnings before choosing source code to read. An empty map does
not prove an object is unused or safe to delete.

## Choose the right lookup

| Question | Tool |
|---|---|
| Which objects are related to this object? | `SAPNavigate(action="relations")` |
| Where is this object referenced in source? | `SAPNavigate(action="references")` |
| What could a CDS change affect? | `SAPContext(action="impact")` |
| What does a method actually do? | `SAPRead(method=...)` or `SAPRead(grep=...)` |

For a class-only sample of consumers, use `references` with `objectType="CLAS/OC"`. The `relations`
action uses `type` for its root and does not accept `objectType`.

## Prerequisites

- A working **single-target** connection with `ARC1_TOOL_MODE=standard`. Multi-target and
  hyperfocused modes do not expose this action.
- SAP discovery must advertise `/sap/bc/adt/objectrelations/network` with
  `application/vnd.sap.adt.objectrelations.request.v1+xml`.
- ARC-1 `read` scope and SAP metadata/Relation Explorer authorization. The lookup uses a read-only
  POST; SAP ADT resource authorization may require `ACTVT=01` and `02`. No ARC-1 SQL or write
  permission is needed.
- For Cloud Connector: discovery, objectrelations, and the requested types' metadata paths.
  `TABL`, `FUNC`, `VIEW`, `TRAN`, and `SHLP` also need
  `/sap/bc/adt/repository/informationsystem/search` for exact identity resolution. Add only the
  needed resources to the Cloud Connector allowlist; do not expose all SAP paths for this feature.

The action uses your existing SAP identity. It does not fall back to another identity on failure.

## Enable or disable it

Upgrade ARC-1 through your normal [deployment](deployment.md) or
[BTP administration](btp-administration.md) workflow, then refresh the client's tool list.
No relation-specific service, database, port, route, or feature switch is required.

The action may appear before discovery completes. Its invocation still checks the exact capability
before reading an object. Known unsupported capability hides it. If it is missing or unavailable,
check discovery, Cloud Connector resources, and the caller's SAP authorization.

To disable it, append `SAPNavigate.relations` to the existing `SAP_DENY_ACTIONS` list and restart or
redeploy. This hides the action and rejects direct invocation. Remove early-preview
`ARC1_LIVE_RELATIONS` / `--live-relations` settings: the flag no longer exists and
`--live-relations` prevents startup. An old environment value of `false` does not disable the action.

## Parameters

| Parameter | Values |
|---|---|
| `action` | `relations` |
| `type`, `name` | A qualified root type below and its exact object name |
| `direction` | `outgoing` (default: dependencies) or `incoming` (consumers) |
| `depth` | 1–3 native expansion steps; default 1 |
| `maxResults` | 1–100 nodes including the root; default 50 |
| `expandPackages` | Up to 8 exact package names, without wildcards; limits deeper expansion |

Package boundaries control expansion, not visibility or authorization. Neighboring packages can
still appear as unexpanded nodes. The action rejects `uri`, `source`, inactive versions, and
arbitrary endpoint paths.

```text
SAPNavigate(action="relations", type="INTF", name="ZIF_ORDER",
  direction="outgoing", depth=3, maxResults=50, expandPackages=["ZORDER"])
```

## Qualified object types

These types can be roots and deeper nodes. They use active metadata and SAP's native environment
and where-used relationships. Coverage was observed on SAP_BASIS 758 and can differ by release.

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
| `TRAN`, `SHLP` | Transaction/program and search-help dependencies | Exact search independently validates VIT identities; no transaction execution or data access |
| `ENQU`, `TYPE` | Lock-object tables and type-group dependencies | Metadata only; no locks acquired |
| `SKTD` | Links from documentation objects to documented objects | Does not read the document or establish its business rules |
| `EVTB`, `DSFD` | Event-binding and scalar-function-definition relationships | Not event traffic or executed function calls; unqualified related types remain boundaries |


`DEVC`, `SRVB`, `DDLX`, `AUTH`, `DTDC`, and `UIAD` are not qualified roots. Use their existing
source/metadata readers, package listing, references, or CDS impact tools instead. Unqualified types
returned as neighbors stay unexpanded; relation support does not add a corresponding SAPRead type.

`SOBJ` is excluded because SAPRead uses that name for BOR objects, while native `SOBJ/MO` means
maintenance objects. Neither is an accepted relation root.

## Read the result

Edges always point **consumer → dependency**. URI-based node identity keeps different object types
with the same name distinct. Native edges are generic relationships: they do not establish method
calls, interface implementation, or exact source-call distance.

| Field | Interpretation |
|---|---|
| `coverage="unknown"` | Always present; this is not a complete call graph |
| `summary` | Returned nodes/edges, expanded/queued nodes, boundaries, and actual truncation reasons |
| `limits` | Configured ceilings, not counts of completed work |
| `scopeBoundaries` | Nodes not expanded because of depth, type, package, or disappearance |
| `truncated`, `truncationReasons` | Resource exhaustion after partial results |
| `pending` | Retained unexpanded work; not a resumable cursor |
| `observedAt` | Analysis start time; not an atomic SAP snapshot |
| `metrics` | HTTP attempts, successful decoded metadata bytes, and elapsed analysis time |

ARC-1 independently validates the root. Other nodes are native references, not independent proof
of existence or authorization. Breadth-first traversal prioritizes the root's package and then URI
order, so a small budget returns a repeatable sample. Dropped nodes and edges cannot be reconstructed
from `pending`. No hidden source parsing, SQL, where-used, or alternate-identity fallback fills gaps.

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


These limits overlap and are not configurable. Discovery, identity resolution, CSRF, and retries
consume the same request budget as expansions. A cold session can therefore stop before eight
expansions, especially for roots that require an extra identity lookup.

`successfulMetadataBytes` counts successful discovery, root metadata, and relation bodies. Failed
bodies have a separate per-response 1 MiB cap. CSRF control bodies are discarded after headers.
The metric does not cap all wire traffic or guarantee a particular process-memory peak.

The deadline includes analysis admission and SAP request queue/body/retry time. It starts after
normal dispatch/identity preparation; startup probes and Destination Service identity resolution
are outside it. Normal process-wide SAP concurrency also applies.

## Troubleshoot failures

| Result | What to do |
|---|---|
| Unsupported capability | Check the exact discovery endpoint and MIME type |
| Authorization error | Check the caller's SAP authorization and Cloud Connector resources |
| Redirect refused | Use an authenticated SAP session or the existing OAuth/PP destination |
| Resource limit reached | Narrow the root, depth, node limit, or expansion packages |
| Malformed protocol response | Inspect the backend response; repeating a broad request will not fix the format |

Redirects, including during CSRF setup, are refused to keep the request budget bounded. The action
does not perform interactive SAML login. For explicitly permitted on-premise Basic authentication,
`SAP_DISABLE_SAML=true` can suppress redirects. Do not use it for BTP ABAP or S/4 Public Cloud.

Authorization and protocol failures remain errors even after earlier expansions succeeded.
An unresolved native `exists="false"` reference cannot distinguish deletion from restricted
visibility and remains a protocol error. A CSRF retry only recovers after a complete valid expansion.
Resource exhaustion may return marked partial evidence; final processing past the deadline marks
retained evidence as truncated. Explicit cancellation remains an error.

The XML parser accepts a normal declaration but rejects comments, CDATA, custom processing
instructions, and DTD/entities. Connectivity responses must honor `Accept-Encoding: identity`.

## Discovery caching

`SAPManage(action="probe")` on a shared client refreshes its capability cache. Successful shared
fallback discovery is retained in memory, scoped to the destination; failed or unsupported fallback
results are not retained. Per-user fallback discovery stays request-local and never changes another
user's tool surface. While shared capability remains unknown, per-user calls repeat discovery.

This cache is independent of `ARC1_CACHE`. It stores capability hints, not object relationships or
authorization grants; metadata and relationships are read live for each call.

## Compatibility

The protocol was observed on SAP_BASIS 758 (S/4HANA 2023 trial). SAP documents the
[Relation Explorer feature](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/relation-explorer),
but not a stable public REST contract. Exact discovery does not guarantee cross-release
compatibility or authorization. Direct trial smoke tests and local Connectivity protocol tests do
not establish live BTP principal-propagation compatibility.

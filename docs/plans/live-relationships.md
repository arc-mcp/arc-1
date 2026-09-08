# Live repository relationships — implementation plan

Status: implementation and functional verification complete; final diff review pending, 2026-09-08. Separate from the optional
repository-graph database experiment. No database, collection job, new service, or AI dependency.

## Decision and value

1. Fix SAPContext aggregate caching. A root-source hash cannot validate changed dependency
   contracts or different depth/maxDeps options. Recompute the aggregate, retaining normal
   ETag-validated source caching and the existing principal-propagation cache bypass.
2. Add experimental `SAPNavigate(action="relations")`, explicitly enabled by
   `ARC1_LIVE_RELATIONS=true`. Reuse SAP's native Relation Explorer metadata rather than downloading
   source or building an index. Existing tools and their default schemas stay unchanged.
3. Traverse a small request-local network. This answers “what uses this?” and “what does this
   depend on?” across several native expansion steps, without another maintained infrastructure.

Not selected: persistent graph/cache, semantic embeddings, automatic SQL/where-used/source
fallback, full-system inventory, inactive code, exact call graphs, or a new plugin system.

## Contract

- Single-target, standard tools only. Config rejects the opt-in with multi-target/hyperfocused.
- Root: validated CLAS/INTF type and name, never a caller URL. Active repository metadata only.
- Direction incoming/outgoing, depth 1 (maximum 3), maxResults 50 (maximum 100 nodes).
- Fixed ceilings: 100 edges, 8 expansions, 12 SAP HTTP attempts including CSRF/retries,
  15-second deadline including admission/HTTP queueing, 1 MiB cumulative successful decoded
  metadata bodies, two concurrent analyses per process. Error bodies remain individually capped.
- The control-response path must dispose of CSRF bodies without unbounded proxy buffering.
- Exact discovery collection and request MIME gate availability. tools/list never performs SAP
  I/O. Unknown capability is hidden; an explicit invocation can perform bounded discovery.
- Calls use the already selected SAP identity, normal read scope/safety/audit. No shared-result
  cache and no identity fallback. Disabled calls fail before SAP I/O.
- Native ENV = Used Objects, WUL = Using Objects. Normalize edges consumer → dependency.
  Validate returned context/root/URIs; deduplicate by canonical URI, not object name.
  Breadth-first selection prioritizes neighbors in the root package, then URI. Live smoke showed
  that unqualified URI sorting can spend the small expansion allowance on generic SAP exceptions
  before application relationships. This ordering is a relevance heuristic, not completeness.
- Report evidence, observation time, unknown native coverage, limits, and separate scope
  boundaries from resource truncation. Native edges are not proven source-level calls/hops.
- Empty results never prove unused code. 401/403 and malformed protocol are terminal errors;
  resource exhaustion after verified results may return explicitly incomplete evidence.

## Prior evidence and plan review

Read-only SAP_BASIS 758 spikes found: FACTORY ENV 6 nodes/5 edges; ENGINE incoming depth 3
17 nodes/20 edges; IMPORT_ACTION outgoing depth 3 42 nodes/63 edges (8 expansions).
These are prototype observations, not shipping-code acceptance results.

Important negative findings: unknown contexts silently fall back to ENV; nonexistent roots can
return an apparently existing singleton; package roots can return an empty unsupported context;
some source references are missing. Therefore validate context and independently read root
metadata, limit v1 roots to CLAS/INTF, and state coverage uncertainty in every response.

Cache spikes on memory and SQLite confirmed stale contracts and option contamination. Rebuilding
the aggregate retained ETag/304 zero-body dependency reads. Fault spikes confirmed HTTP retries
and CSRF consume more sends than logical operations; count at the transport choke point.

## Implementation and acceptance sequence

1. Cache correction plus memory/SQLite regression tests: changing dependencies with unchanged root,
   both option orders, KTD composition, ETag reuse, access denial/deletion and PP isolation.
2. Optional request-attempt budget and CSRF response disposal: direct and Connectivity proxy,
   retries, cancellation, deadlines, body limits and semaphore cleanup. Existing calls unchanged.
3. Native adapter and pure bounded traversal: direction, duplicate/type collisions, cycle/diamond,
   high fanout, unsupported/malformed/mismatched results, auth failure and partial limits.
4. Runtime/config/schema/policy integration: default snapshot stability; opt-in listing; exact
   discovery; disabled guessed calls; read/deny scopes; unsupported modes; unchanged normal cache.
5. Isolated ARC-1 smoke against the live trial: both directions and multi-step results, default-off
   negative, nonexistent root, and actual MCP tool-list/call. No SAP writes or paid provisioning.
6. Human/LLM-readable operator page with local/Docker and BTP property setup, rollback, examples,
   limitations and identity requirements. No duplicated BTP installation runbook.
7. Full unit/type/lint/policy/build/size/docs gates, final diff/security review, fix/retest. Record
   measured results and unverified release/identity/deployment combinations. Push a new PR; no merge.

## Sources and uncertainty

Implementation, plan-review adaptations, real MCP trial results and remaining gaps are recorded
in [the verification report](../research/2026-09-08-live-relations-implementation.md).

- [SAP Relation Explorer](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/relation-explorer)
  documents user-facing contexts, not a stable public REST contract.
- [ADT 3.56 changes](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/version-3-56)
  show that supported object families evolve. Discovery is necessary but does not guarantee parity
  across releases or prove a user's SAP authorization.
- Direct 758 smoke plus mocked proxy/identity tests do not constitute live BTP PP or multi-release
  validation. These remain explicitly unverified until measured; the feature stays experimental.

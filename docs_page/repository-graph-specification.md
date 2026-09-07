# Repository graph specification (experimental)

**Revision:** 2026-09-07, implementation and validation in progress. **Feature milestone:** experimental v1.
This milestone name is not the wire version: the existing connection descriptor is version **1**
and the query API is version **2**.

!!! warning "A specification is not an installation prerequisite"

    The [setup guide](repository-graph.md) and [backend runbook](repository-graph-backend.md)
    describe the currently implemented experimental deployment. Requirements marked **Future gate**
    below are not shipped settings or commands. The independent
    backend now lives in `services/repository-graph/` in the ARC-1 repository, with its own
    dependencies/build/deployment. It is not included in the normal ARC npm/image/MTA and is not
    a supported production release. Neither this document nor successful tests establish production readiness.

## 1. Outcome and scope

Provide a small, optional native ARC adapter to an independently built repository metadata graph.
It helps users find relevant objects, inspect static dependencies, identify potential change impact,
and compare package relationships without contacting SAP for every graph query.

The graph is an additional evidence source, not an authorization cache, source mirror, replacement
for SAPRead/SAPContext, or proof of runtime use. It can later supply retrieval context to an LLM;
experimental v1 does not require an embedding model, AI Core, vector database extension, or LLM call.

**In scope:** one SAP system/client, one explicitly shared metadata audience, PostgreSQL or HANA, bounded
read-only queries, internal diagnostics first, Docker setup, then an optional SAP BTP CF deployment.
Existing ARC readers must not need a new role solely for this feature.

**Out of scope:** persisted complete source, business/table data, inactive drafts, SAP writes,
automatic source-cache warmup, generic plugin changes, multi-target ARC configurations, inferred
per-user graph permissions, unrestricted graph/SQL query languages, and production HANA parity.
The earlier HANA source-index experiment is separate; metadata-only graph retention does not mean
that historical experiment's data has been deleted.

## 2. Evidence baseline and limits

The implementation reviewed here is ARC PR [#756](https://github.com/arc-mcp/arc-1/pull/756), runtime
baseline `ef5f0e26b685e1a6719f29f2dbba2314ae6f4915`, followed by the metadata-only service import
under `services/repository-graph/`. The original `arc-repository-index` source-storage experiment
is not imported. Record an immutable backend revision before distributing it.

| Stage | Verified | Not established by that evidence |
|---|---|---|
| Internal ARC | Standard/hyperfocused/HTTP tests; default-hidden tools; native calls to local and BTP APIs; zero SAP transport calls during graph retrieval | A released ARC version containing the adapter; deployment into the existing CF ARC apps |
| Fresh Docker | New isolated volume; setup and repeat setup; schema/roles, seed, API, failure retention, and non-empty retrieval | Every external PostgreSQL provider or arbitrary production scale |
| BTP PostgreSQL | Actual `postgresql-db/free`, separate reader/writer apps, HTTPS API, live collection through an Internet destination, dedicated ARC test app: all six graph actions and ordinary SAP read | Cloud Connector collection, private app networking, managed backup restore, or an unattended installer |
| BTP HANA | New `hana-cloud/hana-free`; validated SQL TLS; owner/reader/writer separation; identical 13-check API suite; snapshot, rollback, lease and refresh tests; live collection; dedicated ARC end-to-end test | Production operations, native graph acceleration performance, Cloud Connector collection or full-system accuracy |

Representative original PostgreSQL results: 75 live objects produced 505 observations from 380,456 source bytes in
12.73 seconds. The CF-to-CF HTTPS sample had p95 55.22 ms; local ARC-to-BTP had p95 501.09 ms.
These are small samples with different network locations, not an SLA or general sizing result.
The combined database's 1,661 nodes included 1,579 unresolved references; those are not 1,661
successfully collected sources. The separate 100k-node/1m-observation Docker test is synthetic
storage/traversal evidence, not a live SAP accuracy measurement.

The new HANA run collected the same 75 objects/505 observations in 38.75 seconds with bounded
parser workers. The broader custom-package run found 125 objects/715 observations in 67.42 seconds:
122 sources parsed, one empty source failed and two unsupported/macro parses were partial. This
correctly publishes **partial**, not complete, coverage. No source is retained. The new local
PostgreSQL synthetic rerun used 502,259,712 bytes of relations/indexes plus 1,073,862,048 bytes WAL;
warm bounded traversals had p95 1.51–13.25 ms at concurrency 1–10. Three-hop samples hit explicit
result bounds. Do not interpret these numbers as complete impact traversal or SAP ingestion speed.

Detailed evidence is maintained in `docs/research/repository-graph-internal-docker-btp-2026-09-07.md`
in the same ARC source checkout, with current work tracked in `docs/plans/repository-graph-delivery.md`. Setup instructions
must not substitute proposed behavior for these distinctions.

## 3. Architecture and ownership

```text
Existing live path: MCP client -> ARC auth/safety -> SAP (caller identity) + normal ARC cache

Optional graph:     MCP client -> ARC auth/safety -> graph HTTPS API -> PG/HANA reader
                                  tools off by default       ^
                                                            |
                   manual collector -> PG/HANA writer
                              |
                              +-> SAP active metadata/source (approved collector identity)

                   separate bootstrap task -> database administration/migrations
```

| Component | Owns | Must not acquire |
|---|---|---|
| ARC core integration | Config selection, existing auth/scope/deny/audit dispatch, lifecycle attachment | Database drivers, migrations, collection, graph scheduling, source retention |
| `src/repository-graph/` | Descriptor, bounded HTTP client, validated contract, availability, optional tools/CLI | SAP credentials or direct database access |
| Independent graph API | Authentication, fixed audience/system checks, bounded reads, response semantics | SAP/Destination bindings, writer/admin database identities |
| Independent collector | Allowlisted discovery, transient parsing, refresh publication, collection diagnostics | MCP exposure, request-time caller credentials, API administration |
| Bootstrap/maintenance task | Role checks and explicit schema migration | Permanent web route or routine serving traffic |
| Operator tooling | Preflight, artifact versions, selected deployment resources, private connection output | Silent paid provisioning, unrelated app replacement, secret values in output |

**Decision:** native optional integration, not a `Custom_*` JavaScript plugin. Isolate functionality
and tests under the graph module. The normal 12-tool surface remains unchanged unless explicitly
enabled; no graph runtime, polling, or graph network traffic in unconfigured or internal-only MCP.
This is a behavioral isolation guarantee, not a claim of zero additional package bytes/imports.

**Decision:** keep the backend in the ARC-1 repository, but build and release it separately. One future setup workflow may orchestrate
both artifacts, but must offer backend-only installation and attach-to-existing-ARC as independent
steps. Do not put the graph in the default ARC MTA or Docker startup path. Feature removal must
not require replacing the normal cache or editing the plugin framework.

## 4. Data and relationship model

### 4.1 Identity and retained data

The current PostgreSQL schema contains `systems`, `nodes`, `edge_observations`, `generations`,
`collection_jobs`, and `schema_migrations`. Use ordinary relational tables and B-tree adjacency
indexes; do not require a graph extension. The schema contains a metadata full-text GIN index,
but the current search implementation uses `ILIKE` substring matching rather than that index.
Choose and benchmark prefix/token/substring semantics with `EXPLAIN (ANALYZE, BUFFERS)` before
claiming indexed full-text performance. Limit returned rows and database work independently.

HANA uses column-store node/evidence/generation tables in a dedicated `ARC_GRAPH` schema, a
small row-table collector lock, and separate schema owner/reader/writer accounts. Queries use
parameterized SQL and the same bounded traversal implementation as PostgreSQL. The free-instance
spike successfully created a native property-graph workspace over those tables; the API does not
yet use native graph algorithms or vectors, and no acceleration benefit is claimed.

| Record | Identity / content | Rules |
|---|---|---|
| System | Operator-assigned `systemKey` identifying installation and SAP client | Uppercase, immutable for this index; same SID/client on another installation needs a different key |
| Node | System + exact ADT object type + normalized object name | Preserve slash subtypes; carry package, bounded description, resolution status and internal locator |
| Observation | Source, target, relation, evidence owner/method and source resource | Multiple observations are evidence, not necessarily distinct semantic dependencies |
| Collection | Scope, extractor version, generation, times and bounded outcome counters | Must distinguish discovery completeness, parse outcome and unresolved/dynamic references |

Public results use integer IDs within the database, `type` as the base family and `adtType` as
the exact type. IDs are not durable cross-export or cross-rebuild object identifiers. Bare-type
lookup may resolve exactly one subtype; multiple candidates return `ambiguous`, never a guess.
Reference-only nodes stay `unresolved`; an indexed name alone does not prove its source was read.

Allowed relationships are `belongs_to`, `inherits_from`, `implements`, `references`, `static_call`,
`function_call`, `reads_from`, `projects_on`, `associates_to`, and `composes`. Edges point from the
dependent to its dependency, except membership points from object to package. Impact traverses
incoming dependency edges and excludes `belongs_to`. These are static evidence categories; do
not describe `reads_from` as a measured database read or `static_call` as a runtime execution.

Metadata search covers names, packages and descriptions, not full source text. Package coupling
counts observations between known packages, not execution frequency or automatically deduplicated
dependency counts. Unknown package metadata limits the result.

The 2026-09-07 PostgreSQL metadata-search test used 100,001 synthetic nodes, concurrency 1 and
30 warm queries per case: exact-looking substring p95 **70.85 ms**, missing term **73.28 ms**,
broad substring **39.87 ms**, including the read snapshot. `EXPLAIN ANALYZE` confirms the current
`ILIKE` query uses a system-filtered node scan, **not** `nodes_metadata_search_idx` (that GIN
index is for `to_tsvector`, a different search semantic). Do not cite the existence of that index
as proof of accelerated substring retrieval. A future migration should evaluate `pg_trgm` where
available, or an explicit full-text search mode, against a HANA search implementation while
preserving contract semantics. No extension or schema change was silently applied to BTP.

### 4.2 Retention boundary

**Existing:** the graph stores metadata and relationships, not complete source bodies. Source is
read transiently to extract relationships. Metadata-only mode can collect object/package membership
without source parsing; it cannot produce the same dependency richness.

**Implemented:** bounded source downloads and isolated parsing; allowlisted persisted diagnostics;
sanitized runtime failures; artifact allowlisting; source/error canary tests on failed refresh and
publication rollback. No intentional source files, source snippets or SAP error bodies are persisted.
**Future gate:** provider log retention, crash-dump handling, encrypted durable exports and restore
must be reviewed for each production deployment, not inferred from the SQL schema.

Object names, descriptions and graph results are untrusted model context and may be sensitive even
without source code. Do not treat text found in the graph as instructions or proof of authorization.

## 5. Collection, refresh and consistency

### 5.1 Existing collector

The collector collects active `CLAS`, `INTF`, `PROG` and `DDLS`, plus package membership. It discovers
packages first, reads bounded repository search results and filters supported types. The current
object cap is 500; SAP concurrency defaults to 2 and accepts 1–5. Source reads have a 15-second
request deadline and up to two retries. This is not a system-wide inventory algorithm.

On a successful parse, evidence owned by that source resource is transactionally replaced; valid
empty output removes that source's old evidence. Read/parse failures preserve last-good evidence.
Other evidence owners must not be removed. Repeating collection is semantically idempotent even
though observation IDs and timestamps may change. A failed import rolls back atomically.

Implemented protection and remaining limits:

- A saturated mixed search falls back to supported-type partitions, mitigating starvation by
  unsupported objects. Discovery is bounded to 200 logical requests/1,000 packages. Hitting a cap
  is partial discovery, not end-of-catalog evidence; this remains a bounded package collector.
- Decoded source responses are streamed into a **1 MiB/source** cap; larger objects are rejected
  and retain last-good evidence. Parsing runs in isolated workers with a 5-second deadline and
  128 MiB old-space limit. Large sources are intentionally unsupported in this experimental profile.
- A request counter primarily counts logical collector operations, not every SAP retry or Destination
  token request. It is not yet a reliable total-backend-load counter.
- Conditional HTTP support exists in the lower client, but live graph collection does not yet use
  durable per-source validators to skip unchanged reads/parses.
- Collector exclusion is implemented: PostgreSQL uses a session advisory lock on the exact writer
  connection; HANA holds a row lock and publishes on that same transaction/session. Losing the
  connection fences its writes. Durable scheduling, queued jobs and resumable collection are not implemented.
- Absent objects are not safely reconciled as deletions; overlapping scopes accumulate evidence.
- `coverage` describes the latest collection scope, not the union of all indexed scopes. A completed
  run can still contain unresolved/dynamic references and cannot establish semantic completeness.
- Multi-query responses use one read-only repeatable-read snapshot on both backends. Concurrent
  publication tests verify old/new visibility. Allocated IDs are still not commit-order clocks.

### 5.2 Future gate: unattended and system-wide refresh

The experimental release uses explicit, manual, bounded scopes with conservative retention and
session-fenced collection. The following is the follow-on design, **not a claim that scheduling,
resume, conditional refresh or authoritative deletion are implemented**. Snapshot/publication,
parser bounds and failure retention below already have tests; the wider lifecycle does not.

1. Store a collection specification: installation/client identity, package/query/type allowlist,
   extractor version, and deterministic scope fingerprint. Do not identify scope by free text alone.
2. Acquire one durable per-system collection lease with expiry and fencing; reject or queue a second
   writer. Crash recovery must not allow an old worker to publish after its lease has been replaced.
3. Discover using verified paging or deterministic partitions. Persist cursors/checkpoints and
   distinguish `exhausted`, `capped`, `failed`, and `unsupported`. Never delete from a capped result.
4. Keep streaming caps and parser isolation. The implemented conservative limit is **1 MiB/source**,
   concurrency 2, and a cancellable parser worker. Measure
   peak RSS and tune before enabling larger batches. Oversize/timeout preserves old evidence and
   records a sanitized partial outcome; it does not trigger automatic heap enlargement.
5. Retain only validators/hashes and extraction outcomes needed for refresh, not source. Use ETag
   conditional reads where verified; otherwise use a source hash to skip parsing after download.
   A parser-version change forces re-extraction even if the source hash is unchanged.
6. Stage successful changes, then publish a consistent generation. Use a read-only repeatable-read
   transaction for each multi-query API response, or an equivalently tested snapshot design. Keep
   the old visible generation when publication fails; retry only whole safe read queries.
7. Preserve source-owned last-good evidence on failure. Track successful refresh time separately from
   latest attempted refresh, including across overlapping scopes. Do not silently mark old evidence fresh.
8. Reconcile disappearance only after a complete authorized inventory and confirmation that it is
   deletion, not changed visibility. Distinguish deleted, inaccessible and out-of-scope objects.
   Tombstone with provenance before garbage collection; unknown cases retain qualified evidence.
9. Record exact request attempts, bytes, throttle/retry time, parse CPU/RSS, outcome counts, commit
   duration and DB growth. Set run and scope budgets. Schedule only after manual/repeated runs pass.

Proposed retention defaults for the next implementation: keep the current graph and last-good
evidence until successfully replaced or explicitly reconciled; keep bounded job diagnostics for
30 days; purge confirmed tombstones after 30 days and a successful backup. Keep schedules off by
default. These defaults need storage/load tests; they are not current environment variables.

### 5.3 Coverage contract evolution

API v2 must remain honest without changes: display collection scope/time and qualification with
every result. `complete` means completion of that bounded collection, not the entire repository,
all relationship kinds, or the absence of dynamic dependencies.

For broader adoption, add explicit per-scope inventory completeness, unsupported counts, successful
source freshness, failed-attempt age and stale-evidence indicators. Separate collection completion
from semantic coverage. Choose and fixture-test these fields before implementing them.

**Compatibility decision:** v2 response validation is strict on both sides. Adding even a seemingly
optional response field can break existing ARC clients. Freeze v2. Introduce a versioned endpoint
for the richer contract with a transition period serving both versions; do not silently extend v2
or confuse descriptor version 1 with API version 2. Negotiate only explicitly supported versions.

## 6. Query and ARC contract

`POST /v2/query` accepts the validated action arguments plus `systemKey` and `audience` injected
by ARC from its administrator-selected connection. No tool input can select another origin,
system/audience, database, arbitrary SQL/Cypher, collection job, or mutation.

| Action | Required arguments | Semantics |
|---|---|---|
| `status` | None | API collection coverage; ARC CLI wraps it with adapter readiness/state |
| `search` | `query` | Bounded metadata search; return node resolution status |
| `neighbors` | `name`, `type` | Incoming/outgoing/both bounded neighborhood |
| `impact` | `name`, `type` | Incoming potential dependencies, excluding membership |
| `path` | `name`, `type`, `targetName`, `targetType` | Bounded path between resolved nodes, not an exhaustive no-path proof |
| `package_coupling` | None | Bounded package-to-package observation counts |

Current limits: depth 1–3 (default 1), limit 1–100 (default 20), maxNodes 1–100 (default 100),
maxEdges 1–300 (default 300), and up to ten relation kinds. Direction defaults to `both`; impact
always uses incoming. Query deadline is five seconds including body consumption, probe deadline
two seconds, decompressed response cap 512,000 bytes, and eight in-flight requests per ARC graph
runtime with immediate `busy` instead of an unbounded queue. Do not multiply runtime limits into
an assumed account-wide limit; backend admission/connection limits must stand independently.

Responses contain identity/version/action, coverage, nodes, edges, couplings, start/target status,
path result and traversal/truncation scope. Require a closed, deduplicated subgraph with no dangling
edges; validate request/response identity. `not_indexed` and `ambiguous` are not empty-dependency
successes. `hasMore`/`truncationReasons` describe response budgets, independently of data coverage.

### Availability state and isolation

| Configuration/state | MCP behavior | Operator behavior |
|---|---|---|
| No connection or `ARC1_GRAPH=off` | No graph runtime, probes or tool | Status unavailable/not configured |
| Connection, `ARC1_GRAPH_TOOLS=false` (default) | No graph runtime, probes, listed tool or accepted direct/wrapped graph invocation | Explicit CLI diagnostics and queries available |
| Tools enabled, no completed generation yet | Hidden initially | Diagnose `not_indexed`; collection is a separate action |
| Tools enabled, compatible generation available | Optional `SAPGraph`, or hyperfocused `SAP` graph action | Readiness does not certify a complete or non-empty dataset |
| Temporary outage after readiness | Keep tool name; fail query explicitly | Retry probes with bounded backoff; no SAP fallback/result cache |
| Invalid credentials, descriptor or protocol | Hide tool; fail closed | Sanitized status; ordinary SAP tools remain independent |

Persistent stdio sessions receive list-change notifications. Stateless HTTP sees availability on
the next tool listing; there is no durable per-request subscription. Clients that do not refresh
must reconnect. Healthy checks run every 30 seconds; failed probes back off 2–60 seconds. The
current no-generation state retries after one second; it is not the failure-backoff state.

### Configuration and secret lifecycle

Use `ARC1_GRAPH_CONNECTION_FILE` locally or explicit `ARC1_GRAPH_SERVICE_BINDING` on CF. File takes
precedence, explicit off overrides both. No automatic selection among arbitrary bindings. A local
descriptor and its key file must have absolute paths and owner-only permissions; a named CF
user-provided binding carries the key in credentials. Keys never enter public status/errors.

Require an origin-only URL, no redirects, certificate verification, and HTTPS except loopback or
explicitly approved internal HTTP. `SAP_INSECURE` is not a graph override. Key-file content is read
on the next request; changing descriptor endpoints/scope requires restart. CF binding updates need
the platform's binding refresh/restart or restage workflow, not a claim of hot rotation.

**Implemented:** the backend supports at most two API keys, including explicitly selected CF UPS
credentials. HTTP tests prove old-only, overlap and new-only rejection behavior. The
[rotation runbook](repository-graph-backend.md#6-operations-rotation-and-recovery) coordinates API
and ARC restarts and rollback during overlap. This is not a zero-downtime database-password
rotation mechanism; live managed credential rotation remains an operator acceptance exercise.

## 7. Authorization and trust boundaries

The administrator declares `sharing=shared-repository-metadata`: every permitted ARC reader on
this single-system instance may see that dataset. This is an explicit shared-data exception,
not a conclusion drawn from SAP login, SAP read permission or the collector's access.

Existing ARC HTTP authentication, `read` scope, deny rules, audit and MCP rate limits still apply.
Strict PP still requires a verified JWT. Only SAP-specific preflight/session creation is bypassed
for graph calls; graph credentials never contain the caller JWT, SAP cookies or Destination token.
Local CLI/stdio retains its existing trusted-local authorization model.

**Hard stop:** do not enable client tools when all-reader sharing cannot be approved. No new broad
SAP role or XSUAA role is a workaround. Restricted audiences/per-user filtering need their own
future authorization design. Multi-target configuration is rejected for this feature, including
a side-by-side deployment that enables multi-target endpoints on the same ARC configuration.

The graph API independently enforces its key's exact system/audience. Audience is an API access
boundary today, not row-level multitenancy in the database. Deploy one dedicated index/API audience;
do not relabel the same database to simulate isolated tenants. Anonymous health is minimal; every
metadata endpoint requires authentication. Reader/writer roles do not have DDL privileges; only
the explicitly run bootstrap has managed administration credentials.

Before wider use, complete adversarial API checks and direct-route abuse controls: authentication
failures, rate/admission limits, oversized input, query timeout/cancellation, pool exhaustion, and
secret-free errors. ARC's MCP rate limit alone does not protect the public backend route.

## 8. Deployment profiles and setup contract

### 8.1 Internal and local Docker first

The experimental backend includes an offline Compose profile with PostgreSQL,
migrations, API and deterministic fixture. No SAP connection, BTP login or paid service is required.
Generate private secrets once and preserve them on rerun; bind the API only to loopback by default,
do not publish the database port, and give ARC read-only mounted connection/key files.

A separate live collector profile requires an explicit SAP connection and approved collection
scope. Never read live SAP just because Docker starts. Stop/restart preserves volumes. Destructive
reset must be a separate clearly labeled operator action, never the standard troubleshooting step.

For PostgreSQL outside BTP, keep the same schema/API. The candidate compatibility baseline is
PostgreSQL 16 and 17 (tested 16.13 on BTP and 17.6 locally), without superuser-dependent extensions.
Remote TLS/CA authentication, clean role provisioning, upgrade and restore must pass against an
external instance before advertising a generic managed-PostgreSQL recipe. Docker success alone
does not prove this path. Do not connect ARC itself directly to PostgreSQL.

### 8.2 SAP BTP CF

First follow [BTP Start Here](btp-overview.md) for the existing ARC application. Graph setup is an
optional follow-on task, not a new default topology or a second copy of the ARC runbook.

| Resource | Initial PoC allocation | Binding/ownership rule |
|---|---|---|
| Query app | One 256 MiB process | Reader DB credentials + graph API key only |
| Collector task app | Stopped; 512 MiB during manual task | Writer DB + named Destination; Connectivity only for a verified on-premise profile |
| Bootstrap task app | Stopped; 256 MiB during migration | Managed DB administrator + explicit role material |
| Diagnostic consumer | Optional stopped 128 MiB task app | Graph connection only; no DB or SAP credentials |
| PostgreSQL | `postgresql-db/free` where actually entitled | Dedicated instance; no implicit paid fallback |
| HANA alternative | `hana-cloud/hana-free`: verified 16 GiB memory / 80 GiB storage | Dedicated graph schema; temporary bootstrap administration, never DBADMIN in API/collector |
| ARC | Existing allocation unchanged by backend setup | Add only selected graph connection when explicitly attaching |

These allocations are starting measurements, not production capacity recommendations. The PoC
uses a maximum API pool of three and writer pool of two; account for bootstrap, diagnostics and
replica/task overlap when budgeting database connections.

This account has 4,096 MiB CF memory and ten routes. Staging requests below 1,024 MiB were clamped
to 1,024 MiB, so reserve a full GiB and stage sequentially. The test temporarily stopped only its
own graph/ARC test apps. HANA tests reused the graph HTTPS route rather than exceeding route quota.
Node native-client artifacts use a 1 GiB app disk limit; this is distinct from HANA's database storage.

SAP BTP CF lists container-to-container networking as unsupported. The tested profile uses a
standard **internet-reachable authenticated HTTPS route**; sharing a space is not a private network.
If private-only routing is mandatory, stop this profile and assess another deployment topology.
Do not attempt to solve platform network restrictions by adding application roles.
[SAP supported features](https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/f8a351c8d81544a2942c911dccaba3c7.html).

CF tasks inherit their parent app's bindings. Therefore reader API, writer collector and bootstrap
must be distinct apps even if built from the same backend artifact. The single installer must not
collapse those identities for convenience. [Cloud Foundry tasks](https://docs.cloudfoundry.org/devguide/using-tasks.html).

### 8.3 Unproven on-premise collector path

The live BTP test used a publicly reachable HTTPS destination. Code inspection shows the PoC SAP
client resolving a URL/auth header and using direct HTTP, without Connectivity proxy handling.
An existing working ARC Cloud Connector configuration does not automatically make this collector
Cloud Connector-capable.

**Recommended implementation spike:** use SAP Cloud SDK connectivity and generic HTTP support
inside the separate collector. Verify named service selection, `ProxyType=OnPremise`, location ID,
proxy authorization, TLS, cancellation and bounded responses. The SDK documents the Connectivity
binding/proxy flow and a generic HTTP client suitable for non-OData requests.
[On-premise connectivity](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/on-premise),
[HTTP client](https://sap.github.io/cloud-sdk/docs/js/features/connectivity/http-client).

A background collector has no interactive end-user JWT to propagate. Use only an already approved
read-only technical identity for the explicitly shared scope; do not invent a new broad role or
reuse a human token as a scheduler credential. If that identity cannot be supplied, live background
collection for that installation remains unsupported. Live ARC calls keep their own PP identity.
Proof requires a real Cloud Connector-only endpoint and SAP identity evidence, not merely a
successful public endpoint or anonymous graph health check.

### 8.4 Portable setup and future installer

The [backend runbook](repository-graph-backend.md) now ships parameterized CF manifests, free-plan
preflight, private non-overwriting credential preparation, separate PostgreSQL/HANA bootstrap and
the ARC connection handoff. The checked-in examples contain placeholders, not this trial's
credentials. The following describes a future unattended installer; these scripts are not one.

1. Preflight reports target org/space, artifact versions, existing service names and ownership,
   supported plans/entitlements, remaining CF quota, intended HTTPS route and collection scope.
2. Select **create** or **reuse** for each graph resource explicitly. Do not silently adopt/recreate
   existing ARC Destination/XSUAA/Connectivity resources. In MTA, model reused services as existing
   services in the correct base descriptor; an `.mtaext` cannot change a resource's type/ownership.
3. Generate a customer-owned graph deployment configuration and private credentials. No account,
   route, Destination or system/client may be hardcoded as a deployment default. Deterministic
   offline fixtures and explicitly named validation scripts are test-only, never live defaults.
4. Deploy only the bootstrap, verify roles/migration, then query app. Run offline contract checks,
   then an explicitly bounded live collector and non-empty known-object retrieval.
5. Produce a versioned connection descriptor/UPS payload. Attaching to ARC is a separate selected
   step preserving existing safety/auth/route settings, with `ARC1_GRAPH_TOOLS=false`.
6. Persist ARC binding selection in its owned deployment configuration. A transient `cf set-env`
   alone is not durable across MTA deployment; `.env` is not CF configuration.
7. Diagnose through CLI first. Enable tools only after audience and operational acceptance. Record
   health, safe read, actual SAP collector identity and MCP exposure as distinct verification results.
8. Rerun is idempotent: no new passwords, changed ports, duplicate resources, surprise collection
   or existing ARC restart without the selected attachment/change step. Failed setup is resumable.

### 8.5 Cost, lifecycle and operations

Free availability is conditional on region, account, entitlement and current quota. Verify the
actual plan, not a service name or quota label. The PoC verified both PostgreSQL and CF free plans
and reused Destination lite. Expected incremental plan charge is zero within those selections;
this is neither a total-account bill estimate nor a perpetual-free production promise.

SAP documents 90 active days for PostgreSQL free followed by a 30-day backup/migration period.
For the PoC created 2026-09-07, an export/upgrade decision is needed **before 2026-12-06**. No
automated export, reminder or paid upgrade is currently configured. Verify lifecycle at setup
and record an owner/deadline. [SAP PostgreSQL free plan](https://help.sap.com/docs/PostgreSQL/b3fe3621fa4a4ed28d7bbe3d6d88f036/715c7b8c813c4e24ba49f758e468846e.html).

The measured small live database was about 12.1 MB including catalog overhead. The earlier large
synthetic local test used about 502 MB for graph relations/indexes and generated about 1.07 GB
initial WAL. Neither establishes the free plan's hard disk/RAM ceiling; the retrieved broker data
did not expose those values. Capacity testing must measure relations, indexes, WAL, temporary
space and restore headroom separately. Stop before exhausting available storage; increasing a
plan requires a separate explicit cost decision. HANA free creation and API parity are now tested;
the new instance's broker parameters confirm 16 GiB memory and 80 GiB storage. Free HANA stops
nightly and can be deleted after 30 inactive days. An old CF/HDI record can outlive the actual
database: check Cloud Central and real SQL readiness, not `cf services` alone.
[HANA free-plan restrictions](https://help.sap.com/docs/hana-cloud/sap-hana-cloud-administration-guide/sap-hana-database-license).

The local logical restore rehearsal passed for 100,086 nodes and 1,020,153 observations, including
reader access in a scratch database; the original graph remained intact. Before calling a production
profile supported, rehearse encrypted backup/export and restore into a clean
database, verify counts and known paths, preserve logical scope identity, and publish recovery
instructions. Rebuilding from SAP is a fallback with load/time consequences, not a backup test.
Keep one compatible prior app artifact and test schema-aware rollback. Do not automatically run
reverse/destructive migrations. Record CF stack and runtime support dates at release.

## 9. Decision register and release gates

Settled decisions can be implemented without another architecture round. Open gates require
evidence or an operator-specific input; they are not permission to invent credentials or policy.

| ID | State | Decision / uncertainty | Resolution and gate |
|---|---|---|---|
| D1 | Settled | Minimal native ARC adapter; separate backend | Preserve default schemas/cache and internal-only default; no plugin rewrite |
| D2 | Settled and tested | PostgreSQL and HANA are optional alternatives; vectors later | Same API v2 contract; neither HANA nor AI Core is a core ARC prerequisite |
| D3 | Settled, per-install approval | Shared metadata, existing ARC read scope | Unknown/restricted audience blocks MCP exposure; no new end-user role |
| D4 | Settled, topology constraint | BTP authenticated public HTTPS | Private-only requirement blocks this CF profile; same space is not sufficient |
| D5 | Ownership settled; release gate open | Backend stays under ARC-1, independently packaged/deployed | Publish immutable artifacts, lockfile/SBOM/license/secret checks and ARC/API compatibility matrix; do not advertise an unattended installer first |
| D6 | Open on-premise gate | Cloud Connector transport and headless collector identity | SDK spike plus live proxy-only read, wrong-location/expired-credential negatives and Basis identity evidence |
| D7 | Partially verified | Snapshot/lease/rollback tested; scope freshness, deletion and durable jobs remain limited | Preserve conservative coverage; do not claim authoritative deletion or resumable scheduling |
| D8 | Partially verified | Response/parser caps and 100k/1m PG synthetic test pass; discovery/search plans remain limited | Test supported-type starvation/partitions and actual metadata-search index use before full-system claims |
| D9 | Local gates verified; managed operations open | Local restore, bounded overlap-key rotation and DB deadlines pass | Live managed-service restore/credential rotation and future schema upgrades still require rehearsal |
| D10 | Open adoption gate | Dependency precision/recall and actual user benefit | Human-reviewed static oracle + recorded retrieval questions; report blind spots, not only latency |
| D11 | Deferred | Native graph acceleration, vectors, restricted audiences, multi-target | HANA SQL contract parity is implemented; these broader capabilities require separate evidence/design |

D1–D4 are the recommended architecture for this specification, not a production security sign-off.
There is no need to choose HANA versus PostgreSQL again to complete the next implementation.

## 10. Implementation sequence and acceptance

| Phase | Deliverable and principal files | Exit criteria |
|---|---|---|
| A. Freeze the experimental boundary | ARC `src/repository-graph/`, config/dispatch/policy bridge; contract fixtures and this specification | Default tools byte-identical; configured-but-hidden standard/hyperfocused/HTTP paths make no graph requests; ordinary SAP identity/cache tests pass |
| B. Portable backend + fresh Docker | Backend package/Compose/setup scripts, schema and graph tests | Clean checkout install with no SAP/BTP secrets; two isolated projects; safe rerun and restart; reader/write/admin separation; known non-empty query; no secret/source artifacts |
| C. Collector correctness and scale | Backend `src/collector/`, SAP transport, job reports, query snapshot/coverage | Byte/parser/discovery bounds, partition fallback, session lease fencing, failure retention and concurrent generation tests; explicitly defer resume/conditional refresh/deletion and full-system claims |
| D. Optional BTP profile | Parameterized CF artifacts/bootstrap, technical HTTPS collector, connection handoff | Actual free-plan preflight; separate app roles; HTTPS rejection tests; no existing ARC mutation during backend-only setup; explicitly refuse Cloud Connector collection and document managed recovery limits |
| E. ARC attachment and limited exposure | Existing graph adapter plus configuration/docs/examples only where needed | CLI first; named binding and private files; explicit opt-in; scope/deny/rate/strict-JWT/audit negatives; production live SAP auth unchanged; no auto collection |
| F. Experimental release and handoff | Published artifacts, compatibility matrix, canonical setup/operations docs, reviewed PR | All applicable gates below pass; remaining unsupported paths prominent; independent fresh-reader walkthrough succeeds |

A–E now have experimental evidence for the documented HTTPS path. F still requires final review
and PR handoff. Broader production/Cloud Connector gates remain visible below; do not repeat
successful provisioning or claim those unsupported paths just to mark every future gate complete.

### Required test matrix

| Area | Required cases | Evidence requirement |
|---|---|---|
| Core regression | Unconfigured/off/internal-only/enabled; both MCP modes and real authenticated HTTP; multi-target rejection | Full unit/typecheck/build/lint/policy/schema budgets; unchanged default fixtures |
| Contract | All six actions; aliases/collisions; unknown nodes; closed subgraphs; truncation; cycles/high fanout; wrong version/system/audience | Shared fixtures executed against API and ARC, including negative response fixtures |
| Resource protection | Slow/chunked/oversize compressed response; cancellation; exhausted API/DB pool; SAP 429/503 and parser timeout | Fixed upper bounds, no unbounded queue, last-good data preserved |
| Refresh | Repeat/empty-success/read-failure/partial-parse; changed/deleted/inaccessible source; overlapping scopes; changed parser | No false deletion/freshness; stable semantic evidence; explicit partial outcomes |
| Concurrency | Two writers, crash before/after commit, lease replacement, import during query, out-of-order attempted publications | No mixed-generation success; no stale lease publication; documented recovery |
| Retention/auth | Source/error canaries; key/token headers; tampered URL, redirect and descriptor; shared-audience boundary | No persisted/logged secrets or source; denied calls do not bypass existing ARC controls |
| Deployment | Clean Docker twice, unrelated volume preserved; named CF/PG bindings; existing-service adoption; failed setup rerun | No implicit secret rotation, paid fallback, accidental service ownership or unrelated app restart |
| Operations | Key rotation failure/rollback, backup + clean restore, schema upgrade/old-client compatibility, free-plan expiry procedure | Reproducible operator record; recovery actually exercised, not just commands listed |
| Retrieval quality | Known positives/negatives, unresolved/dynamic cases, metadata-only vs transient-source distinction | Ground-truth review and limitations attached to results |
| Documentation | Fresh setup, existing BTP attach, unknown audience, absent free plan, Cloud Connector-only SAP | One correct next step, no invented settings/roles and explicit stop for unsupported paths |

Proposed quality evaluation: at least 50 manually reviewed supported objects across ABAP OO,
programs and CDS, at least 100 labeled relationships and 30 realistic retrieval questions. Require
100% expected fixture behavior and no cross-scope/auth leaks. For the manually labeled *supported
static subset*, target precision at least 95% and recall at least 90%; report unsupported/dynamic
cases separately, never remove them silently from coverage reports. These are proposed acceptance
targets, not measured results. Any lower result requires a narrowed claim or extractor fix.

Repeat latency tests with dataset shape, network location, concurrency and cache state recorded.
Target the existing five-second adapter deadline without increasing it to mask unbounded backend
work. Measure collection cost separately from retrieval; prove zero SAP calls during graph queries.

## 11. Documentation deliverables

The [experimental setup page](repository-graph.md) is the single graph entry point. General
[Deployment](deployment.md) and [BTP Start Here](btp-overview.md) link to it only as an optional
follow-on. Keep the default Quickstart and PP deployment path free of graph prerequisites.

At artifact publication, the setup page must link a version-matched backend quickstart with one
offline Docker path, one opt-in live path, one external-PG path only when verified, and one BTP
profile. Each path states prerequisites, artifact revision, secret ownership, exact expected
verification, repeat/stop/recovery behavior and its next step. Examples must not contain PoC account
names or plausible fabricated passwords. Keep long validation records in engineering docs.

Maintain a small compatibility table with ARC release/commit, descriptor/API version, backend
artifact digest, schema version, tested PostgreSQL/runtime/CF stack and supported SAP transport.
Do not tell users to install `latest` until that version is confirmed to contain the feature.
Mark navigation, setup, specification and release notes **Experimental** until the stated gates
are met; merging the adapter alone does not graduate the feature.

Follow the existing BTP documentation review process: inspect runtime/descriptors/examples together,
run focused documentation/profile tests and strict MkDocs, then walk the affected task from Start
Here. Test both raw Markdown and rendered links. A build passing is not a measured usability gain.
This specification should change with the implementation when a test disproves an assumption;
the setup page must continue to describe only what users can actually run.

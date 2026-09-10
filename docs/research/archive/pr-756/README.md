# PR #756 research archive and continuation decision

Reviewed on **2026-09-10** against main `19692fa2f4d593cebad7335312ace7933797a43b`.
Recommendation: close [#756](https://github.com/arc-mcp/arc-1/pull/756) without merging its
persistent-graph implementation, preserve this research, and continue from the live navigation
delivered by [#769](https://github.com/arc-mcp/arc-1/pull/769).

PR #769 merged on 2026-09-10 at 09:43 UTC as
[`81baa517`](https://github.com/arc-mcp/arc-1/commit/81baa517).
PR #756 was still open when inspected, at
[`69d7d596f2bee8740d9629e017b58d6deecb192d`](https://github.com/arc-mcp/arc-1/tree/69d7d596f2bee8740d9629e017b58d6deecb192d).
Its 18 reported checks were successful. Retirement is a product/maintenance decision;
those historical green checks do not validate a merge with today's main.

The persistent graph remains an unmerged experiment. Archived configuration variables,
`SAPGraph`, database setup instructions and the proposed ADR-0008 do **not** describe current
ARC-1 capabilities or accepted policy. Read the current
[live-relations operator page](../../../../docs_page/live-relations.md) for supported usage and
[consolidated research](../../repository-retrieval-consolidated.md) for the wider history.
The snapshot's older "next steps" and "not yet tested" statements apply to their recorded phases.

## Why retire the implementation PR?

The complete #756 diff has **179 files, 22,530 insertions and 10 deletions**, including its
backend, tests, documentation and lockfile. Keeping it open creates a second integration and
operations track after the owner selected live retrieval. Rebasing it into main would still
introduce database/API/collector ownership and the separate shared-audience trust decision.

| Concern | Persistent graph, #756 | Merged live approach, #769 |
|---|---|---|
| Object navigation | Indexed search, neighbors, impact and paths | Bounded native relations, references and selected source/context reads |
| Package-wide analytics | Stored directional coupling counts; repeated queries avoid SAP | Package neighborhoods only; no equivalent indexed aggregate ranking or dedicated shortest-path query |
| Data and freshness | Persisted nodes/observations; explicit collection; last-good evidence can predate the latest batch | Relationship evidence fetched per request; active metadata, unknown completeness, no transactional SAP snapshot |
| Identity | Technical collector plus explicitly shared metadata audience; no per-query SAP authorization | Existing caller SAP identity and metadata authorization; returned neighbors are not separately source-authorized |
| Operations | PostgreSQL/HANA, API, collector, credentials, refresh, recovery and lifecycle | Existing ARC deployment; no new database, collector or BTP service |
| Coverage | Source extraction for CLAS/INTF/PROG/DDLS and package metadata; important includes omitted | 25 qualified root types, with native relation/context limitations |
| Bounds | Indexed bounded queries; collection has separate budgets | Depth 1–3, 100 nodes/edges, 8 expansions, 12 SAP attempts, 15 seconds and 1 MiB successful metadata |

The live feature serves immediate object investigation. It does not replace corpus text search,
semantic retrieval or repeated estate-wide analytics. Those remain possible future projects,
conditional on demonstrated need and explicit ownership.

## Findings that already carried forward

The [guided pilot](docs/research/2026-09-07-graph-guided-pilot.md) exposed normal SAPContext
reusing dependency answers across incompatible `depth`/`maxDeps` requests. Later research also
showed that an unchanged root did not validate changed dependency contracts. #769 removed
aggregate answer reuse, retained ordinary source/ETag caching and PP isolation, and introduced
bounded pure parsing memoization after source retrieval. The graph experiment's stale cache
finding is therefore already addressed in the chosen core direction.

The two recovered September 8 notes explain the transition: native Relation Explorer recovered
an implementation-include relationship that the MAIN-only collector missed, and request-local
traversal could supply useful maps without an index. #769 implemented that direction and later
expanded it to 25 root types with automatic capability-based exposure. Its experimental action
is single-target/standard-mode only; `SAP_DENY_ACTIONS=SAPNavigate.relations` can disable it.
The early `ARC1_LIVE_RELATIONS` proposal in these notes was superseded and is not current setup.

These improvements do not globally bound legacy deep SAPContext fan-out or prove complete
native coverage. The relation analysis budgets belong to the new action.

## Evidence worth retaining

- **Actual PG/HANA feasibility and operations:** separate reader/writer/bootstrap privileges,
  transactional publication/snapshots, failure retention, local restore and API-key rotation.
  Local restore does not establish managed-service disaster recovery or DB-password rotation.
- **Cloud Connector transport:** proxy-only technical-user collection, with tested failure
  controls. That evidence does not qualify the different live-relations path under BTP PP/CC.
- **Live sizing:** 2,187 distinct source objects across 82 packages; two passes/4,374 source
  reads; 4,712 retained nodes and 12,702 observations. Added storage was about 11.41 MiB PG /
  3.32 MiB HANA; peak collector RSS was about 316 MiB. Discovery and parsing remained partial.
- **Refresh cost:** the unchanged repeat still took about 19.65 minutes and repeated source
  downloads/parsing. Stable logical counts did not remove write amplification. Generated WAL
  is not permanently retained database storage.
- **Synthetic scale:** 100,000 nodes/1,000,000 observations and bounded-query measurements.
  These are synthetic feasibility measurements, not whole-system ingestion rates or an SLA.
- **Negative evidence:** missing RAP implementation includes, uncounted dynamic object creation,
  native omission of a source-confirmed `INSTANCE OF` edge, and unequal pilot verification/cache
  conditions. The nine-scenario guided pilot was not a blind repeated model A/B benchmark.

The current consolidated report already summarized much of this. This archive additionally
preserves the detailed reports, raw safe measurements, specification, plans and historical
operator guidance on the documentation branch, instead of requiring the feature branch for reading.

## Archive inventory and provenance

The `docs/` and `docs_page/` layout below mirrors original paths for traceability. These are
research snapshots under `docs/research/archive/`, outside the public MkDocs `docs_dir`.
They add no product navigation, installation requirement, runtime dependency or accepted ADR.

| Material | Archived files |
|---|---|
| Original proposal and delivery | [Proposed ADR-0008](docs/adr/0008-optional-shared-repository-graph.md), [initial plan](docs/plans/optional-repository-graph.md), [delivery record](docs/plans/repository-graph-delivery.md), [CC/sizing plan](docs/plans/repository-graph-cloud-connector-and-sizing.md) |
| Validation and review | [Initial validation](docs/research/repository-graph-validation.md), [internal/Docker/BTP](docs/research/repository-graph-internal-docker-btp-2026-09-07.md), [specification review](docs/research/repository-graph-spec-review-2026-09-07.md) |
| Live transport and scale | [CC and storage report](docs/research/2026-09-07-graph-cloud-connector-sizing.md), [raw soak evidence](docs/research/2026-09-07-graph-cc-soak-evidence.json), [raw scale evidence](docs/research/2026-09-07-graph-scale-evidence.json) |
| Comparative value and gaps | [Matched-pair setup](docs/research/2026-09-07-graph-ab-comparison.md), [guided pilot](docs/research/2026-09-07-graph-guided-pilot.md), [prompt guide](docs_page/repository-graph-comparison.md) |
| Historical specification and operation | [Specification](docs_page/repository-graph-specification.md), [entry point](docs_page/repository-graph.md), [backend operation](docs_page/repository-graph-backend.md), [sizing worksheet](docs_page/repository-graph-sizing.md) |
| Recovered local work, absent from the PR commit | [September 8 options/smoke](docs/research/2026-09-08-live-relationship-options-and-smoke.md), [integration spikes/plan](docs/plans/live-relationships-integration.md), [uncommitted delivery follow-up](local-delivery-followup.patch) |

[manifest.json](manifest.json) records original and archived SHA-256 hashes and byte counts.
Seventeen published documents come from the exact PR head above. Two uncommitted Markdown
notes and the delivery-plan diff were recovered from the existing graph worktree on 2026-09-10;
they are separately attributed and were not retroactively assigned to that commit.
Markdown receives an archive notice and relative-link adjustments. Historical prose is retained;
the two JSON evidence files and local diff are byte-identical to their sources.
Links to implementation/supporting files outside this archive use the original immutable revision.

The complete backend, adapter, tests and deployment artifacts remain available in the
[original implementation tree](https://github.com/arc-mcp/arc-1/tree/69d7d596f2bee8740d9629e017b58d6deecb192d).
Do not cherry-pick its feature commits into main to preserve documentation. Keep the original
branch/worktree; if later deleting them, retain a separate archival ref or verified Git bundle first.
The older local `arc-repository-index` source/vector prototype and private operator artifacts are
outside this extraction. Their identifiers remain in the consolidated report. They have not been
deleted or copied into public Git.

## Continue from here

1. Publish/review this documentation-only extraction, then close #756 unmerged with a link to
   the archive and #769. Preserve its branch. Do not repurpose the old feature PR into a massive
   removal diff or describe its research as merged implementation.
2. Use #769 on the existing ARC deployment. Keep the experimental coverage and identity limits
   explicit. No graph database setup is needed to use it.
3. Prioritize real BTP PP/CC, restricted-user and cross-release qualification of native relations.
   Preserve source-confirmed missing-edge cases and held-out model workflow failures. Avoid
   broad guidance rewrites unless representative comparisons support them.
4. Treat any deeper SAPContext total-work budget or targeted parser improvements as separate,
   evidence-driven core work. Do not import the graph extractor/collector incidentally.
5. Revisit a persistent graph only for a measured repeated aggregate workload. Before adoption,
   require include-aware extraction, precise dynamic/partial coverage, an adjudicated edge oracle,
   durable incremental discovery/refresh/deletion, an approved audience, restore/rotation/lifecycle
   rehearsal and measured SAP/DB cost. A new scoped proposal can reuse this research.
6. Keep semantic/vector retrieval deferred until structural and lexical approaches fail a defined
   retrieval benchmark and source/embedding retention plus operational ownership are agreed.

## Deployment retirement is separate

Closing the PR neither stops apps nor preserves experimental database contents. A read-only
Docker inventory on 2026-09-10 still found the two comparison containers and three local PG/API
projects running. The graph worktree also has the uncommitted documentation preserved above.
Do not remove that worktree, Docker volumes or owner-private reproduction folders as incidental
PR cleanup.

Cloud Foundry was targeted at the recorded trial space, but `cf apps` failed because its login
token had expired or been revoked. **Current cloud app/service state was not verified.** Historic
records mention `arc1-graph-validation`, `arc-graph-pg` and `arc-graph-hana-test`, along with API,
collector/bootstrap and source-index resources. Those are inventory leads, not a deletion allowlist.

For a separately authorized retirement, reauthenticate, identify exact owners/bindings/routes,
export any datasets worth keeping and verify recovery, then stop/remove only confirmed experiment
resources and retire their dedicated credentials. Preserve unrelated ARC, shared Destination/
Connectivity services and the older source-index experiment unless explicitly included. The
historical PG export/decision date was before 2026-12-06; recheck actual service lifecycle before
relying on it. No teardown, credential change, SAP call or new cloud provisioning occurred here.

## Verification of this disposition

The review used current GitHub PR states/check summaries, complete Git diffs, the merged relation
and cache implementation/tests, the original research, local uncommitted research and Docker
inventory. It did not repeat the historical live SAP, database or model benchmarks. Documentation
validation passed for all 20 artifact hashes, published-source hashes, local link targets,
22 distinct pinned supporting paths, both evidence JSON files, whitespace and strict MkDocs build.
The repository's Biome configuration excludes research files; JSON was validated directly and
the raw evidence retained byte-for-byte.

The four existing context-freshness, parse-cache, relation-walk and live-relations test files
were rerun on Node 24.11.1: **83 tests passed**. These support the core comparison; they are not
a new full-PR security/compatibility audit or live deployment test. Runtime code and tool
definitions are outside this preservation change.

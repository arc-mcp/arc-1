# Repository retrieval: current direction and research map

Updated **2026-09-10** after [PR #769](https://github.com/arc-mcp/arc-1/pull/769) merged as
`81baa517`. The owner selected live navigation and retirement of the separate persistent-graph
[PR #756](https://github.com/arc-mcp/arc-1/pull/756). Its useful research is consolidated in the
[graph decision](archive/pr-756/README.md), [findings](archive/pr-756/findings.md) and
[source index](archive/pr-756/sources.md); full records/raw evidence are preserved in a tagged snapshot.

Use [Live relations](../../docs_page/live-relations.md) for current setup and limits. It needs
an existing single-target, standard-mode ARC deployment and native SAP capability. It adds no
database, collector, BTP service or top-level MCP tool. `ARC1_LIVE_RELATIONS` / `--live-relations`
were removed; existing `SAP_DENY_ACTIONS` can hide and block `SAPNavigate.relations`.
The old graph's `ARC1_GRAPH*` settings are not current features or prerequisites.

## Choose evidence for the task

| Need | Approach | Limit |
|---|---|---|
| Explain selected code, contracts or behavior | SAPRead/SAPContext with normal source caching | Source-derived context can miss includes/dynamic dependencies; deep expansion has its own fan-out |
| Explore a current object neighborhood | Native `SAPNavigate(action="relations")`, followed by selected reads | Active metadata with unknown completeness, bounded work and generic relationship evidence |
| Find exact reference locations | Existing `SAPNavigate(action="references")` | Reference entries are not unique callers or runtime frequency |
| CDS/RAP impact | Existing `SAPContext(action="impact")` and source verification | Native outgoing RAP links can be absent on 758 |
| Repeated estate/package-wide analytics | Deferred persistent metadata graph | Requires collection, freshness/deletion management, database and approved audience |
| Corpus-wide code text/semantic retrieval | Separate deferred source index | Requires source retention, ingestion, relevance evaluation and possibly embeddings |

Live relations is neither whole-system RAG nor a complete inventory. Empty/limited results
never establish unused code, safe deletion, complete impact or runtime unreachability.

## What #769 delivered

- Rebuild dependency aggregates per request instead of trusting the root source hash. Changed
  `depth`/`maxDeps` and dependency contracts no longer reuse stale assembled context.
- Retain normal ETag source reuse and PP cache isolation. Pure parsing is memoized only after
  authorized retrieval, with 128 entries/4 MiB of accounted keys/results per cache owner;
  this is not an authorization cache or process-RSS guarantee.
- Remove active aggregate-cache APIs. Old SQLite `dep_graphs` records may remain until explicit
  cache clear; no production path reads/updates them as context. No startup corpus crawl returns.
- Offer bounded native incoming/outgoing traversal through the selected caller identity when
  capability permits. Tool listing adds no SAP I/O; invocation validates exact discovery and
  root metadata. Relationship results stay request-local.
- Qualify 25 root types, including CLAS/INTF, DDIC, CDS and selected other repository types.
  `SOBJ` is excluded because native maintenance objects collide with ARC's BOR pseudo type.
  Consult the operator type table instead of inferring support from a successful empty response.
- Clarify reference counts, provenance, MAIN versus local includes and format prerequisites.
  Tool correctness still does not establish model answer quality.

The action is unavailable in multi-target and hyperfocused modes. Native edges are generic uses
relationships, not necessarily source-call hops or typed implementation evidence. Root validation
does not independently authorize source reads for every returned neighbor. No alternate-identity,
SQL, where-used or source-parser fallback is hidden behind a failed native request.

## Boundaries and qualification

| Native analysis ceiling | Value |
|---|---|
| Depth / nodes / edges | 1–3 steps; at most 100 nodes and 100 edges |
| Work | 8 expansions / 12 actual SAP attempts, including in-analysis discovery, metadata, CSRF and retries |
| Time / concurrency | 15 seconds / two analyses per process plus normal SAP concurrency |
| Data | 1 MiB successful decoded metadata / 512 KiB final serialized output |

These overlapping ceilings can stop a request early. Error bodies have separate caps; metrics
are not total network traffic or exact RSS. Normal identity preparation/startup is outside the
analysis deadline. Coverage stays unknown, resource truncation is explicit, and authorization,
cancellation or malformed protocol remains an error. Redirects/interactive SAML are not followed.
These budgets do not globally bound legacy deep SAPContext expansion.

Protocol qualification was on SAP_BASIS 758. Direct trial and local Connectivity-protocol tests
do not establish real BTP PP/CC or cross-release compatibility. Prior graph-collector CC results
exercise a different path. Next qualification should use restricted identities, advertised-but-
unusable endpoints, representative missing edges and another release.

## What earlier experiments contributed

Startup source warmup was rejected because of discovery caps, stale/shared state and SAP load.
The separate source-index prototype explored resumable discovery, lexical/fuzzy retrieval and
ETag refresh. Its historical HANA capacity/configuration was not a measured full-system size.
Vector storage/cosine was probed, but integrated embedding generation failed on certificate/model
availability; end-to-end semantic retrieval was not delivered and AI Core was not required.

The metadata graph demonstrated PostgreSQL/HANA feasibility and useful package coupling without
persisting complete source. Its pilot exposed the cache bug fixed in #769 and missing class
implementation includes. Native metadata recovered that include edge but missed a source-confirmed
`INSTANCE OF` relation. Neither source is complete. Measured scale, refresh amplification, access
boundaries, parser lessons and exact counterexamples now live in the graph findings rather than
being repeated here. The old proposed ADR and setup procedures are historical only.

## Model evidence and next steps

Actual GPT, Qwen and Gemma evaluations were small, revision-specific samples. They found useful
maps and better provenance, but also missed documentation, incorrect routing, unsupported claims
and tests that preserved bugs. Source checks and CI success do not prove general answer-quality
non-regression. The September 9 hold recommendation and opt-in/class-only guidance were historical;
#769 subsequently expanded/changed exposure and merged. Preserve the failures as evaluation cases.

Before broad guidance changes, use pinned surfaces, repeated held-out specification/draft/test-
design prompts across model families and ordinary source/navigation controls. Distinguish fixture
success from live behavior and uncompiled ABAP suggestions from passing tests. Avoid adaptive prompt
changes that improve one scenario while weakening another.

Continue with live identity/transport/release qualification. Revisit persistent storage only for
a measured repeated aggregate workload with include-aware extraction, an adjudicated edge oracle,
durable refresh/deletion, approved audience and rehearsed recovery. Add semantic retrieval only
when structural/lexical evidence fails a defined benchmark and retention/ownership are agreed.

## Evidence map

- Current contracts: [operator page](../../docs_page/live-relations.md), [caching](../../docs_page/caching.md),
  [BTP task map](../../docs_page/btp-overview.md), [developer verification](../dev-guide.md#live-relations-verification).
- Final type expansion: [research](2026-09-10-live-relations-types.md),
  [review](2026-09-10-pr769-expansion-review.md), [execution plan](../plans/2026-09-10-live-relations-types.md).
- Core/cache evolution: [implementation plan](../plans/live-relationships.md),
  [initial results](2026-09-08-live-relations-implementation.md),
  [complete review](2026-09-08-pr769-complete-review.md),
  [third review](2026-09-09-pr769-third-review.md),
  [cache/simplicity review](2026-09-09-pr769-core-simplicity.md).
- Model evaluation: [initial results](2026-09-09-model-output-evaluation.md),
  [gap results](2026-09-09-model-output-gap-review.md),
  [September 9 final review](https://github.com/arc-mcp/arc-1/pull/769#issuecomment-5608865806).
- Graph experiment: [decision](archive/pr-756/README.md), [findings](archive/pr-756/findings.md),
  [all original sources](archive/pr-756/sources.md). Infrastructure retirement remains separate.
- Full pre-condensation report, including phase-local counts and original local source-index artifact
  identifiers: [preserved snapshot](https://github.com/arc-mcp/arc-1/blob/a14584b9f50896eb91ec14fc76dfb35237025218/docs/research/repository-retrieval-consolidated.md).
  Those local prototype/private operator folders were not deleted or imported into current product code.

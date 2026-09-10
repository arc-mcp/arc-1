# Repository retrieval: consolidated research, decisions and plan

## Current direction — 2026-09-10

The owner chose automatic capability-based exposure instead of a dedicated rollout variable.
`ARC1_LIVE_RELATIONS` and `--live-relations` are removed. Existing `SAP_DENY_ACTIONS` can hide
and block `SAPNavigate.relations`; read scope, SAP identity/authorization, request bounds,
single-target standard mode and the experimental label remain. No database or BTP service is added.

The implementation has qualified CLAS/INTF plus DDLS, DCLS, TABL (tables/structures),
TTYP, DTEL, DOMA, PROG, INCL, FUNC, FUGR, VIEW, ENHO/XHB, MSAG, BDEF, SRVD, TRAN, SHLP,
SKTD, ENHS/XSB, ENQU, TYPE, EVTB and DSFD (25 root types). `SOBJ` was removed during the
expansion review because it collides with ARC-1's existing BOR pseudo type. Native relation support
is narrower than the SAP UI's complete set of contexts. In particular, outgoing RAP links can be
missing on 758, inactive/new roots must fail, and conflicting same-URI identities remain errors.

The [current per-type research and validation record](2026-09-10-live-relations-types.md) and
[operator page](../../docs_page/live-relations.md) supersede the flag and class/interface-only
recommendations below. The [execution plan](../plans/2026-09-10-live-relations-types.md) covers
actual model comparisons and final verification. Live type qualification is separate from model
reliability: GPT, Qwen and Gemma were tested, and weaker-model routing/interpretation errors remain.
The earlier ordinary-workflow concerns are not silently marked resolved. The pre-review live matrix
returned 100 bounded graphs and eight expected refusals in 108 calls; all 26 absent roots were
rejected. No new infrastructure or source collection was introduced.

## Consolidated baseline and evidence archive — through 2026-09-09

The remainder records the pre-change research and dispositions, including the superseded flag
decision. Its test counts describe those pinned revisions, not the additional work above.

Status snapshot: **2026-09-09**, live-relations PR [#769](https://github.com/arc-mcp/arc-1/pull/769)
at `18f42c30`, compared with main at `c55adcb8`. The separate persistent-graph experiment is
PR [#756](https://github.com/arc-mcp/arc-1/pull/756), reviewed through `69d7d596`.
This document consolidates the work to date; dated reports remain the evidence archive.
It supersedes their earlier recommendations where later findings changed the plan. It is not
a fresh audit of running BTP resources, current service pricing, or a claim that either PR is released.

## The short version

- **Keep normal ARC-1 source caching.** Remove stale aggregate shortcuts and startup collection
  from the core request path; memoize pure parsing only after normal source/authentication checks.
- **Use SAP's live metadata first.** The current addition is a bounded, on-demand
  `SAPNavigate(action="relations")` inside ARC-1. No database, collector, extra deployment or AI Core.
- **Its roots are active global classes and interfaces only**, including SAP, Z/Y and namespaced
  objects. Other native object types can appear as unexpanded neighbors, not as supported roots.
- **Keep it experimental and opt-in for now.** This is a rollout decision, not a technical need
  for an environment variable or a requirement to provision HANA/PostgreSQL.
- **A persistent graph worked in Docker and on BTP with PG/HANA**, but adds collection, freshness,
  authorization and operational ownership. Keep it separate from this PR and defer adoption until
  repeated package/system-wide analytics justify those costs.
- **Functional checks are green; general model-output non-regression is not cleared.** The latest
  review recommends holding merge under the requested ordinary-workflow quality criterion.
  Turning relations off does not undo this PR's general tool-description changes.

## 1. How the plan evolved

| Stage | What was investigated or built | Conclusion now |
|---|---|---|
| Startup warmup | TADIR discovery and source preloading into ARC-1's cache | Poor fit for core startup: discovery caps, stale state, SAP load and shared-identity concerns. Retain request-driven caching instead. |
| Full-source index / RAG foundation | Independent CF collector/API, HANA source storage and lexical/fuzzy retrieval; resumable discovery and refresh | Technically useful for corpus text search, but requires storing source and maintaining ingestion. Not part of the current core addition. |
| Metadata graph | Typed nodes/relationships in ordinary PostgreSQL; transient source parsing, provenance, bounded graph queries | Reduces retained data and enables package coupling, paths and reverse impact. Does not eliminate source downloads during collection or completeness problems. |
| Deployment / integration | Local Docker, BTP PG and HANA, Cloud Connector collector, optional ARC API adapter | Demonstrated feasibility. Backend moved into the ARC-1 repo in the graph experiment, but remained separately built/deployed. |
| Graph versus live comparison | Same-system live reads, where-used, source-derived contracts and indexed graph queries; native ADT Relation Explorer spike | Neither graph source is complete. Native metadata can answer many immediate questions without operating an index. Fix existing cache correctness first. |
| Current core implementation | Cache correction, bounded native `relations`, explicit coverage/error reporting, tests and one operator page | Small core action behind an opt-in, not a new plugin framework or persistent graph service. |
| Model-output evaluation | Actual paired model calls, routing/format/count/provenance corrections and ordinary-workflow counterexamples | Some answers improve; broader description changes can also weaken other tasks. Functional success alone is insufficient for merge clearance. |

The initial `abap_wiki` and `codegraph` suggestions motivated source-mirror and graph exploration;
neither was adopted as a runtime dependency. The retained patterns are stable identity, typed
evidence, bounded traversal, incremental work and explicit coverage—not a claim that those
repositories validate this implementation. SQLite is not inherently incapable of graph storage;
the rejected design was the startup/cache lifecycle and its correctness/scale trade-offs.

## 2. Which approach solves which problem?

| Approach | Best use | Retained data / SAP work | Maintenance |
|---|---|---|---|
| Normal ARC-1 plus live relations | Explain selected objects, verify references, explore a small current class/interface neighborhood | Normal source-cache policy; no persistent relationship index. Relationships fetched from SAP per analysis. | Existing ARC deployment only |
| Persistent metadata graph | Repeated cross-package coupling, indexed paths/impact and larger-scope architecture analysis | Nodes, observations, provenance and collection state. Source can be parsed transiently; queries avoid SAP, collection does not. | DB, API, collector, refresh/reconciliation, backups and access policy |
| Full-source lexical/vector index | System-wide text search and later semantic code retrieval | Source/chunks, searchable metadata and optionally embeddings; collection/refresh transfers source | Largest storage, ingestion and retrieval-evaluation burden |

Live relations is **not system-wide RAG**, a complete inventory, or a replacement for the last
two approaches. It is the lowest additional operational cost for the immediate object-exploration
use case. Persistent metadata remains worthwhile if measured repeated-query value outweighs
collection and ownership; a source index addresses efficient corpus-wide code-text retrieval.

## 3. What the current PR actually changes

### Existing functionality, independent of the flag

- Rebuild SAPContext's aggregate on each request. A root-source hash cannot validate changed
  dependency contracts or different `depth`/`maxDeps` requests. Keep normal ETag source reuse and
  the existing principal-propagation cache isolation/bypass rules.
- Memoize pure contract/dependency parsing by content after source retrieval. The per-cache-owner
  memo is bounded to 128 entries / 4 MiB of accounted serialized keys/results, not a process-RSS
  guarantee. It is not a persisted graph, retained AST or authorization cache.
- Remove unused aggregate graph methods, memory storage and UI activity cases. Old SQLite
  `dep_graphs` rows can remain at rest until explicit cache clear; no production path reads or
  updates them. The compatibility table/count is not an active graph engine.
- Correct context/reference count qualifications, preserve enrichment warnings and clarify
  source versus metadata evidence, supported formats and class MAIN versus local includes.
  General SAPRead/SAPContext descriptions and initialize guidance also change.

### Only when `ARC1_LIVE_RELATIONS=true`

- Add `relations` to the existing SAPNavigate tool, with its graph-specific guidance/parameters.
- Verify the exact ADT discovery path and request MIME, independently validate root metadata,
  then traverse SAP's native relationship network through the caller's selected SAP client.
- Return nodes, consumer-to-dependency edges, evidence, limits, boundaries and unknown coverage.
  No relationship result survives the call; ordinary discovery/session hints may be reused.

`ARC1_GRAPH` / `ARC1_GRAPH_TOOLS` belong to the older persistent-graph experiment. They are **not**
aliases or prerequisites for `ARC1_LIVE_RELATIONS`. The database backend under
`services/repository-graph/` in that experiment is not included in this native-relations PR.

## 4. Why an opt-in instead of default-on?

There is no inherent technical requirement to keep a separate flag forever. It currently provides
an explicit enable/disable boundary for an experimental capability:

1. It respects the requested minimal core impact and no new client-visible option by default.
2. The wire protocol was observed on S/4HANA 2023 / SAP_BASIS 758. Exact discovery is necessary
   but does not prove compatibility across SAP releases, authorization setups or protocol variants.
3. It introduces another model choice and potentially several SAP requests. For a known source
   link or tiny consumer sample, ordinary reads/references are often better.
4. Native metadata has incomplete coverage and can be misunderstood as direct calls or complete
   impact. The experimental boundary makes that limitation explicit during qualification.
5. An administrator can disable it without disabling normal reads, navigation or caching.

It is **read-only** and uses the existing read scope, safety ceiling and SAP authorization.
It does not need a new end-user role, write permission, SQL permission or database. The flag is
not an authorization substitute. Likewise, it does not contain general description regressions:
those descriptions are present even when relations is disabled.

After opt-in, unknown discovery leaves the action visible; invocation verifies support before
object access. Known unsupported discovery hides it. Listing tools does not contact SAP. This
avoids making clients that list tools only once miss a supported capability at cold startup.
Disabled calls fail before SAP access. V1 rejects opt-in with multi-target or hyperfocused mode.

**Later default-on/automatic exposure is possible**, after representative release and live BTP
identity/routing tests, credible ordinary-workflow model non-regression evidence, and an acceptable
SAP-load/error profile. Retain an administrator off switch. There is no recommendation to enable
it by default in the current PR. See the [operator page](../../docs_page/live-relations.md).

## 5. Supported objects and useful alternatives

| Object / task | New `relations` support | Existing route where appropriate |
|---|---|---|
| Global ABAP class (`CLAS`) | Root and recursive expansion (`CLAS/OC`) | SAPRead for behavior; SAPNavigate references for exact usages |
| Global ABAP interface (`INTF`) | Root and recursive expansion (`INTF/OI`) | References for consumers; source to distinguish implementation, calls and constant access |
| SAP standard, Z/Y, namespaced classes/interfaces | Same support; names such as `/BOBF/CL_FRW_FACTORY` work | Same normal authorization and source navigation |
| DDIC objects, e.g. tables/structures/table types | May appear when SAP returns them, but are not roots or expanded nodes | SAPRead; `SAPContext(action="structure", type="TABL")` for supported structure hierarchy |
| CDS / RAP artifacts | May appear as native boundary evidence; not accepted as roots | `SAPContext(action="impact")` and targeted source reads |
| Programs/includes, function modules/groups, packages and other object types | Not supported as roots; any accepted non-OO neighbors stay boundaries | Existing object-specific reads/navigation; no new universal graph coverage |
| Inactive drafts, local classes or individual methods as roots | Not supported; graph uses active global repository objects | Existing source/include/method/diff workflows |

The non-OO boundary types are not an exhaustive promised list: they depend on what SAP returns.
Only exact `CLAS/OC` and `INTF/OI` nodes expand. Use `type="CLAS"` or `"INTF"` plus `name` in the
request; arbitrary URLs/source are not inputs.

`outgoing` means dependencies; `incoming` means users of the root. Edges always point
consumer → dependency. For class-only consumers, ordinary references can use
`objectType="CLAS/OC"`; omit that filter when all consumer types matter. A package expansion
filter accepts up to eight exact names, limits work beyond the root and **does not hide neighbors
or establish authorization**. Empty results never prove unused code or safe deletion.

## 6. Bounds, security and known limitations

The native action performs no startup crawl, source collection, business-table query, SAP mutation,
SQL fallback or alternate-identity retry. Single-target principal propagation keeps the caller's
identity; shared authentication keeps its existing identity. Root validation does not mean every
returned neighbor has independently passed a source-read authorization check.

| Control | Current ceiling |
|---|---|
| Depth | Default 1, maximum 3 native expansion steps |
| Nodes / edges | Default 50 nodes including root; maximum 100 nodes / 100 edges |
| Expansion / HTTP work | 8 expansions / 12 actual SAP attempts, including in-analysis discovery, metadata, CSRF and retries |
| Time / concurrency | 15-second analysis deadline; 2 analyses per process plus normal SAP concurrency ceiling |
| Retained output | 1 MiB cumulative successful decoded metadata; final serialized result capped at 512 KiB |

These are overlapping ceilings, not guaranteed completion counts. Error bodies are individually
capped, outside the cumulative successful-body metric; CSRF bodies are discarded after headers.
Existing startup/identity resolution is outside the analysis deadline. Limits do not represent
total network bytes or exact memory use. Valid partial evidence reports truncation; authorization,
cancellation and malformed protocol are errors, not successful incomplete analyses.

Reviews fixed namespace handling, authorization recovery, real-send retry accounting, discovery
reuse, strict argument/URI/XML validation, cancellation and schema/docs/budget coverage in both
modes. Retained deliberate limitations: no redirect following/interactive SAML login in bounded
analysis; `exists=false` is a protocol error rather than proof of deletion; coverage is always
unknown. Real BTP principal propagation/Cloud Connector and other releases remain unqualified
for **this native feature**. Earlier collector CC tests do not prove this separate request path.

## 7. What the database experiments proved—and did not

The graph used stable system/client/type/object identity, typed evidence observations, unresolved
references and bounded queries. PostgreSQL used ordinary tables/indexes and bounded traversal,
not AGE or pgvector. HANA exposed the same contract through parameterized SQL; creation of a
HANA graph workspace did not make the tested API a native graph-engine benchmark.

The prototype separated API reader, collector writer and schema administrator. Source parsing
was transient: no source-body columns/canaries were retained. Failed or partial extraction preserved
last-good evidence; successful empty extraction was distinct. Nevertheless, metadata itself can
be sensitive. A trial-wide common audience does not establish production per-user authorization,
and authorizing one root does not authorize all indexed neighbors.

| Historical measurement | Result | Interpretation |
|---|---|---|
| Local PG synthetic scale | 100,000 nodes / 1,000,000 observations; 502,349,824 bytes of tables/indexes (~479 MiB); 10.36 s load | About 427 bytes/node and 460 bytes/observation for this fixture, not a universal sizing constant |
| PG volume after hub tests | ~520 MB whole database; 1.55 GB Docker volume including overhead/WAL | Plan beyond graph-table bytes; backups, retained WAL and provider baseline are separate |
| Live CC two-pass collection | 2,187 distinct source objects, 82 packages; 4,374 reads / 4,579 total SAP attempts; 33,321,998 source bytes transferred | Bounded sample, not whole-system collection; metadata-only storage still needs source reads for parsed edges |
| Same clean live scope in both DBs | 4,712 nodes / 12,702 observations, including 2,443 unresolved nodes | Each pass: 1,993 full parses, 165 partial, 25 parse failures, 4 read failures and 21 dynamic targets |
| Added live schema storage after repeat | PG 11,960,320 bytes (~11.41 MiB); HANA 3,481,600 bytes (~3.32 MiB) | Excludes pre-existing schema/provider baseline; not a complete deployment bill |
| Live collection duration / memory | First 21.20 min, repeat 19.65 min; peak collector RSS 316.09 MiB | Unchanged repeat still downloads/parses; it is not an efficient incremental refresh yet |
| HANA synthetic scale | 100,000 nodes / 1,000,000 observations, prepared-batch load 13.33 s | Synthetic load speed, not SAP collection throughput |
| Later HANA schema snapshot | 62.40 MiB persistence / 57.68 MiB resident columns, including synthetic and live datasets | Allocation changed after load; not a clean head-to-head PG compression ratio or guaranteed steady state |

Bounded queries were fast enough to demonstrate usefulness: local PG p95 ranged roughly 1–80 ms
across the recorded load/concurrency cases; CF-to-HANA SQL p95 was about 146–440 ms in small
12-sample cases. Neither is a production end-to-end SLA. Generated PG WAL during the live two-pass
experiment was about 605 MB; that counter is **not permanently retained graph disk**.

The practical comparison found both wins and gaps. Indexed queries avoided SAP requests and made
cross-package coupling/paths convenient. Native SAP references recovered a RAP implementation-include
dependency missed by MAIN-only collection. Parsed source found an `INSTANCE OF` edge missing from
the native network. Dynamic targets and uncollected includes prevent either approach from proving
complete impact; zero detected dynamic targets is not proof there are none.

### BTP deployment and cost conclusion

For current live relations, use the existing ARC app and SAP connection. Set one application
property and restart/redeploy; no additional PG/HANA/AI service or route. Existing app/SAP resource
consumption remains, so “no extra service” is not “zero total cost.” The canonical setup remains
the [BTP task map](../../docs_page/btp-overview.md) plus the live-relations operator page.

The older persistent-graph design could keep its API and route-less collector tasks on CF, with
the durable database supplied by managed HANA/PG or external PG. CF app disk is not the database
storage design. Same repository did not require the same process/image/deployment. The BTP
experiment used an authenticated standard HTTPS route because its private CF networking approach
was unsupported; internet-reachable did not mean anonymous metadata access.

On the dates tested, PG `postgresql-db/free`, CF `cloudfoundry/free` and later HANA `hana-free`
were verified without a paid upgrade. The earlier HANA connection failure was superseded by the
later successful HANA setup, parity and scale tests. Free services had quotas/lifecycle limits:
the PG report recorded 90 active days plus 30 migration days, with an export/decision date before
2026-12-06. These are historical account/service observations, not current availability or pricing
promises. Recheck entitlement, expiry and region before resuming that deployment; do not create
a paid fallback automatically. Current native relations does not need either experimental database.

### What remains of the vector/RAG proposal

The source-index POC used typed resumable discovery shards, bounded backfill and ETag/freshness
refresh. Its historical HANA plan was recorded as 1 vCPU / 16 GB memory / 80 GB storage; the
6 GB source guard was a conservative configuration, not a measured full-system capacity.
Source/fuzzy-index memory matters as well as disk.

The proposed later layer was structural chunks, content-hash/versioned embeddings, exact/fuzzy
lexical retrieval plus vector similarity, package/type filters and rank fusion. HANA vector
storage/cosine was probed; integrated embedding generation failed on certificate trust/model
availability. End-to-end semantic retrieval was **not delivered**. Externally generated vectors
were an option, not an adopted dependency; AI Core was not required or added. Benchmark relevance,
refresh cost and permissions before implementing embeddings or duplicating stored source chunks.

## 8. Final functional and actual-model evidence

The latest recorded verification at `18f42c30` passed **6,156 unit tests / 207 files**, typecheck,
lint, policy, build, file/schema budgets and strict docs build. All 16 GitHub checks passed,
including integration/E2E. This snapshot is documented in the
[final PR review](https://github.com/arc-mcp/arc-1/pull/769#issuecomment-5608865806).

The largest enabled schema was 71,995 bytes / 17,999 estimated tokens against 72,000 / 18,000:
only five bytes of headroom. Earlier “default surface byte-identical” reports describe the native
action's initial integration; later general description changes mean that is **not** a claim
about the final whole PR. Input shapes for ordinary tools remain unchanged by that wording follow-up.

Manual final live verification used 90 read-only SAP2023 calls across 45 paired cases, plus
8 native-graph cases: source/includes, DDIC metadata, reference filters/caps and namespaced roots.
Source comparisons remained byte-identical. These 98 checks are not 98 unrelated business workflows
and did not provision services or mutate SAP. A separate pure-parser benchmark measured 453.45 ms
versus 0.64 ms with warm memoization for a synthetic 20-dependency case; it is CPU time, not total
SAP response time.

Actual model evaluation used GPT-5.6 Sol and installed Ollama Qwen3.6 35B on the final revision:
48 synthetic paired sessions and 6 live GPT sessions, **54 attempted / 51 completed**. Three GPT
fixture runs hit call limits. Earlier Gemma/Qwen experiments are separate historical samples;
do not add them to this final count. Synthetic fixtures had no SAP client, refused mutations and
validated JSON Schema, not the complete runtime dispatch. Generated ABAP tests were not compiled.

| Final live prompt | Main / candidate tool calls | Observed answer difference |
|---|---|---|
| Explain a BOPF amount determination | 4 / 3 | Both correct; candidate additionally acknowledges incomplete source-derived context |
| Build an object/dependency evidence map | 6 / 7 | Candidate obtains 11 native relationships and better provenance; one extra call |
| Verify a known interface reference | 5 / 2 | Both identify constant access rather than a method call or interface implementation |

Ordinary-workflow counterexamples matter just as much: Qwen sometimes detected requirement/code
mismatches but proposed tests preserving the bug; main's expectations were better. Candidate draft
reviews in both GPT and Qwen skipped documentation that main retrieved, missing documented rules.
Some Qwen answers also invented interface implementation or unsupported syntax reassurance.
Not every failure is branch-specific; repeats showed GPT variation. These small samples establish
unresolved risk, not a statistical regression rate or universal model-quality ranking.

The broad source-first routing change was narrowed back to established context-first guidance for
general understanding. A final extra reminder was tested in 12 separate prototype sessions and
rejected because one task improved while draft review worsened. It is not shipped and is not
counted in the 54 sessions above. No model-specific runtime integration was added.

**Latest recommendation: hold merge under the requested ordinary-workflow non-regression criterion.**
Green functional/CI checks and better graph answers do not establish that all general descriptions
are improvements. The PR remains unmerged in this recorded review.

## 9. One continuation plan

1. **Resolve the general-guidance merge risk first.** Keep factual format/include/count/provenance
   corrections. Evaluate reverting or separating broader routing/requirements wording from the
   native feature if it cannot meet the ordinary-workflow criterion. Default-off is not a solution
   for descriptions outside that gate.
2. **Use a frozen, representative comparison**, not endless adaptive prompt tuning: pinned main
   and candidate, same fixtures/tool surfaces, repeated held-out draft/specification/test-design
   prompts across model families plus source, CDS/RAP, navigation, dump and transport controls.
   Judge evidence and final conclusions, retain failures, and distinguish uncompiled suggestions.
3. **Re-run complete gates after any change**, inspect the actual merged tree and tight schema
   headroom, then repeat read-only live source/reference/graph checks. Report remaining failures
   explicitly before a merge decision; no automatic merge.
4. **Qualify native relations before wider exposure:** another SAP release, real BTP PP/CC,
   restricted identities, advertised-but-unusable endpoints and representative missing edges.
   Document supported combinations and clear failure paths; consider default-on only afterward.
5. **Resume a persistent graph only for a demonstrated aggregate use case.** Required gates include
   implementation-include coverage, a manually adjudicated edge oracle, durable discovery/refresh/
   deletion reconciliation, dynamic/partial evidence accounting, real audience authorization,
   restore/rotation/lifecycle operation and measured SAP/DB cost. PG is the portability-first
   candidate; existing HANA is valid where its operational footprint is already accepted.
6. **Semantic retrieval comes last**, only if metadata and lexical retrieval cannot answer the
   target prompts and source/embedding retention is explicitly approved. No new service or
   maintenance commitment is justified solely because vector features are available.

## 10. Evidence map

Use this document for the current direction; use these records for implementation details and
dated measurements. Old “next steps,” “not yet tested” and “complete” statements are phase-local.

- Current operator documentation: [Live relations](../../docs_page/live-relations.md),
  [Caching](../../docs_page/caching.md), [BTP task map](../../docs_page/btp-overview.md).
- Current code contracts: [accepted inputs](../../src/handlers/relation-input.ts),
  [tool visibility](../../src/handlers/relation-tool.ts),
  [traversal and limits](../../src/context/relation-walk.ts),
  [configuration defaults](../../src/server/types.ts).
- Core plan and verification: [implementation plan](../plans/live-relationships.md),
  [first implementation results](2026-09-08-live-relations-implementation.md),
  [external review](2026-09-08-pr769-external-review.md),
  [complete review disposition](2026-09-08-pr769-complete-review.md),
  [third review](2026-09-09-pr769-third-review.md),
  [simplicity/cache retirement/merge ratchets](2026-09-09-pr769-core-simplicity.md).
- Model work: [guidance plan](../plans/2026-09-09-model-output-guidance.md),
  [initial evaluation](2026-09-09-model-output-evaluation.md),
  [gap plan](../plans/2026-09-09-model-output-gap-review.md),
  [gap results](2026-09-09-model-output-gap-review.md), and the final PR review linked above.
  Raw SAP/model traces stay private; completion counts are not semantic pass counts.
- Persistent graph archive at its own revision:
  [specification](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/docs_page/repository-graph-specification.md),
  [delivery plan](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/docs/plans/repository-graph-delivery.md),
  [CC collection and storage evidence](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/docs/research/2026-09-07-graph-cloud-connector-sizing.md),
  [graph/live comparison](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/docs/research/2026-09-07-graph-ab-comparison.md),
  [guided pilot](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/docs/research/2026-09-07-graph-guided-pilot.md).
  The additional `docs/research/2026-09-08-live-relationship-options-and-smoke.md` spike is a
  local-only record in the graph worktree, not a file published at that revision.
- Original local-only `arc-repository-index` archive: `docs/scaling-and-vectors.md`,
  `docs/metadata-graph-research-2026-09-06.md`, `docs/local-postgres-graph-test-plan.md`,
  `docs/repository-graph-continuation-plan-2026-09-06.md`,
  `docs/native-arc1-integration-plan-2026-09-06.md`, `docs/internal-docker-btp-plan-2026-09-07.md`,
  and `docs/results/{local-postgres-graph-poc,collector-correctness,native-adapter-validation}-2026-09-06.md`
  / `docs/results/internal-docker-btp-2026-09-07.md`. These are archival identifiers, not extra
  installation instructions or files required by this PR.

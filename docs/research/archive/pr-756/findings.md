# Repository graph: consolidated findings

Historical experiments from September 6–8, 2026; editorial disposition on September 10.
This records an unmerged prototype, not deployment guidance or a production guarantee.
[Decision](README.md) · [Original reports, raw evidence and provenance](sources.md).

## What worked, and what it costs

PostgreSQL and HANA served the same bounded metadata-query contract through a separate API.
Reader, writer and bootstrap identities were distinct. Tests covered transactional publication,
repeatable read snapshots, session-fenced collector exclusion, failure retention and valid-empty
replacement. Local logical restore preserved 100,086 nodes/1,020,153 observations and reader
access; API-key overlap/revocation was tested. Managed-service restore, database-password rotation
and future schema upgrades remained unrehearsed.

Source was downloaded and parsed transiently, with a 1 MiB/source cap and isolated 5-second /
128 MiB old-space parser workers. Failed/partial extraction retained last-good evidence. This
avoided persistent source bodies but did not eliminate source traffic or make metadata public.
The common trial audience was an explicit trust decision, not per-user SAP authorization.

The collector's Cloud Connector proof used a virtual hostname unresolvable from CF: source 200,
anonymous 401, invalid proxy token 407 and wrong location 503. It supported an explicitly selected
OnPremise/Basic technical identity without direct fallback. Headless PP remained refused. This
collector proof does not qualify #769's separate live-relations path under BTP PP/CC.

The BTP API used authenticated internet-reachable HTTPS; same-space placement was not private
networking. Collection/bootstrap had no routes. Free-plan availability, service lifecycle and
CF staging quotas were observations of that account/date, not current entitlement promises.

Useful implementation lessons: strict identity/version validation and closed bounded subgraphs;
no SAP fallback or caller credentials in graph queries; source-owned evidence replacement;
separate collection coverage and response truncation. A completed latest scope did not certify
older retained scopes or per-edge freshness. Durable scheduling/resume, conditional refresh and
authoritative deletion were absent.

Both stores used ordinary parameterized SQL. HANA graph-workspace creation did not establish
native graph acceleration. PostgreSQL's substring search used `ILIKE`, not the full-text GIN
index present in the schema; measured search plans matter more than the existence of an index.
No embeddings, AI Core or semantic retrieval were delivered by the graph experiment.

## Comparison: useful aggregate answers, incomplete impact

The guided nine-scenario pilot made 94 scenario calls, with matching live-source controls.
Package coupling was the clearest distinct benefit. Both approaches found seven interface
implementers, and source questions needed no graph. A separate 20-query MCP sample reported
p50 265 ms / p95 348 ms with zero SAP request events, verified against a positive live control.
This excluded collection and model reasoning; it was not a speedup against equivalent live work.

The pilot used one investigator, prior fixture knowledge and unequal warm caches/verification
work. No blind repeated model study or maintenance ROI followed from those call counts.
Coupling counts were observations, potentially multiple kinds per pair, not unique callers or
runtime frequencies. Future comparisons need matched identities/surfaces, fresh independent
sessions, repeated prompts, alternating order, separate cold/warm cases and adjudicated answers.

| Counterexample | Evidence | Disposition |
|---|---|---|
| MAIN-only graph collection misses class includes | `ZBP_SSI_R_IMPRUN` implementations call `ZCL_SSI_IMPORT`; graph had only package membership | Require per-include extraction, ownership, freshness and stale-edge replacement before broad impact claims |
| Native references are also incomplete | `ZCL_SSI_UNIT` has `INSTANCE OF zcl_ssi_engine`; native network omitted that edge while parsed graph found it | Retain source verification and unknown coverage |
| Zero dynamic targets is misleading | Factory dynamically constructs a registered class; collector reported zero | Counter covered selected constructs, not dynamic object creation; extend or label precisely |
| Aggregate context reused incompatible answers | Changing `depth`/`maxDeps` in either order reused the root-hash result; changed dependency contracts could stay stale | #769 removed aggregate answer reuse, retaining source caching and PP isolation |
| Index absence is not SAP absence | Unindexed `CL_DEMO_OUTPUT.WRITE` remained readable live | Distinguish not-indexed, unresolved, partial and absent |

## Measurements to retain

These samples demonstrate feasibility, not whole-system completeness, sizing guarantees or SLAs.
Raw events and the detailed measurement definitions remain linked in the [source index](sources.md).

| September 7 live CC two-pass run | Observed result |
|---|---|
| Scope | 2,187 distinct source objects, 82 nonempty packages; 3,000-object target stopped at attempted-package cap |
| Work | 4,374 source reads, 33,321,998 downloaded bytes; 4,579 SAP attempts including three separately observed planning calls |
| Retained graph in each backend | 4,712 nodes / 12,702 observations, including 2,443 unresolved references; all 82 repeat batches stable |
| Outcomes per pass | 1,993 fully parsed, 165 partial, 25 parse failures, four read failures, 21 counted dynamic targets |
| Duration | 21.20 minutes first pass / 19.65 minutes unchanged repeat; 40.84 minutes total |
| Peak collector RSS | 331,440,128 bytes, about 316 MiB; a measurement, not a worst-case bound |
| Added tables/indexes after both passes | PG 11,960,320 bytes (11.41 MiB); HANA persistence 3,481,600 bytes (3.32 MiB) |
| Generated cluster WAL | 605,075,744 bytes, about 577 MiB; neither retained WAL nor necessarily graph-only |

The staged raw summary counts 4,576 SAP attempts; the report adds the three planning calls.
Repeated collection still downloaded/parsed unchanged sources and increased allocation despite
stable logical counts. PG/HANA received identical metadata sequentially; this was not atomic
replication or an isolated throughput comparison. Keep discovery saturation and parse failures
with every coverage claim.

| Separate synthetic/diagnostic test | Result and qualification |
|---|---|
| PG, 100k nodes/1m observations | About 479 MiB tables/indexes; 1.00 GiB initial generated WAL; traversal p95 1.51–13.25 ms. Repeated runs varied; not a universal bytes/row constant |
| PG metadata substring search | p95 39.87–73.28 ms, 30 warm samples/case; system-filtered scan, not GIN acceleration |
| HANA, same synthetic scale | Prepared batches of at most 5,000 observations loaded in 13.33 seconds; monolithic join had failed on statement memory |
| HANA later schema snapshot | 62.40 MiB persistence / 57.68 MiB resident columns; includes live indexes and an affected baseline, not a clean PG compression ratio |
| HANA bounded traversal | 48 samples, p95 approximately 146–440 ms across four cases; CF-to-HANA SQL, not public MCP end-to-end latency |

For future sizing, separate logical graph bytes, allocation/refresh churn, provider baseline,
retained logs, backups/restore capacity and app RAM/disk. Whole database size already includes
its graph tables. HANA persistence changes after savepoints/merges; retain immediate and later
samples. Synthetic bulk-loading speed is not SAP ingestion speed. Do not provision from table
bytes alone or treat generated WAL as permanently retained storage.

## Recovered September 8 research: why the live approach followed

The options/smoke note and integration plan were uncommitted in the old graph worktree and are
preserved in the tagged snapshot. Their proposed opt-in flag and initial CLAS/INTF-only scope
were superseded by #769's automatic exposure and 25 qualified root types.

- **Protocol:** 12 native network calls read no source and recovered the RAP include edge.
  An absent class nevertheless returned HTTP 200/`exists=true`; an unknown context silently
  selected ENV. Validate root metadata and returned context independently. Reverse WUL response
  ordering into consumer → dependency; preserve URI/type identity for same-name BDEF/DDLS.
- **ETag correctness:** 14 controls across memory/SQLite covered option order, dependency changes,
  403/404 and PP bypass. On a live small fixture, two conditional dependency reads returned zero
  body bytes and matched cold output after aggregate reuse was disabled. Correctness costs SAP
  checks; retaining source cache does not mean reusing unvalidated assembled answers.
- **Discovery reuse:** one document was 300,036 bytes. Reusing its parsed map reduced a fixture
  lookup from three calls/312,729 bytes to two calls/12,693 bytes, with equal results. Discovery
  hints are not object authorization, and listing tools must not wait on SAP.
- **Bound actual sends:** one logical POST could send HEAD + POST + retry. Charge physical sends
  and carry deadlines/cancellation through queueing, control requests and bodies. Separate whole
  analysis admission from per-HTTP admission to avoid deadlock. Current relation bounds arose
  from these spikes; they are not a global legacy-context budget.
- **Parser lessons:** seven source resources produced 69,554 raw bytes versus 3,460 metadata JSON
  bytes, reducing model payload rather than SAP downloads. Fixtures exposed name-first loss of
  relation kinds, local/built-in false dependencies and unqualified empty parse failures. Consume
  raw client source, not formatted tool text. Reuse pure-parser lessons only through focused tests;
  neither extractor solved dynamic object creation.

The local delivery-plan diff only linked these findings and proposed checklists; it adds no
independent result. The next adoption gates are recorded in the [decision](README.md).

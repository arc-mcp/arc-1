# Cloud Connector collection and storage evidence — 2026-09-07

Experimental ARC-1 repository graph, PR #756. No SAP objects, users, roles, destinations or
Cloud Connector mappings changed. All database services remained on verified free plans;
no additional database or route was created for these experiments.

## Transport and isolation

The independent collector now supports an explicitly selected Connectivity binding and
OnPremise/BasicAuthentication Destination. It uses bounded absolute-form HTTP proxy requests,
not CONNECT or direct-network fallback. The HTTP target is a private CC virtual address; it
does not expose public SAP HTTP. SAP-leg TLS remains the administrator's CC mapping choice.

Live proof used a virtual hostname that cannot resolve directly from CF, identified A4H/client
001 by cookie name only, and verified source HTTP 200, anonymous HTTP 401, wrong location
HTTP 503 and invalid proxy token HTTP 407. No source or secret values were logged. Headless
PrincipalPropagation is still rejected: an approved technical collector identity is required.
No change to normal ARC auth or default graph-tool visibility was needed.

## Extended live SAP run

- Task: `5c16cbdf-832c-44d6-9383-e2cb3b1aa0b0`, 11:17:09–11:58:00 UTC.
- Isolated key: `SOAK-A4H2023-CC-20260907-A`; package patterns `SABAPDEMOS*,SABP*,SADT*`.
- Budget: 3,000-object target, two passes, 100 attempted first-pass batches, concurrency two,
  at most 500 objects/batch, 90-minute deadline, 512 MiB task memory/1 GiB app disk.
- Result: 2,187 distinct source objects, 82 nonempty packages, 182 total batch attempts,
  4,374 source reads, 33,321,998 downloaded bytes, 4,579 SAP request attempts including planning.
  The package-attempt cap stopped discovery before the target: this is a bounded sample.
- Both databases: 4,712 nodes, 12,702 observations; 2,443 nodes are unresolved references.
  All 82 nonempty repeated batches had stable metadata fingerprints; logical counts did not grow.
- Each pass: 1,993 fully parsed sources, 165 partial parses, 25 parse failures, four read failures,
  21 dynamic targets. First/repeat passes reported eight/five saturated searches. These counts
  must accompany coverage claims; successful import does not prove complete dependency extraction.
- First pass 21.20 min; unchanged repeat 19.65 min. Aggregate database import time first/repeat:
  PG 71.26/73.80 s, HANA 236.02/205.05 s. Parsing, SAP reads and other orchestration take the rest;
  this combined sequential experiment is not an isolated single-backend throughput comparison.
- Peak RSS 331,440,128 bytes (316.09 MiB). Only peak RSS was captured in this staged revision;
  do not infer proof of leak freedom. Current CLI also emits current RSS for future runs.

### Raw schema measurements (bytes)

| Counter | Baseline | First pass | Repeat complete |
|---|---:|---:|---:|
| PG graph tables/indexes | 2,891,776 | 12,402,688 | 14,852,096 |
| PG whole database | 12,090,391 | 21,683,223 | 24,165,399 |
| HANA graph-table persistence | 692,224 | 3,743,744 | 4,173,824 |
| HANA resident column-table memory | 965,736 | 3,029,455 | 3,304,461 |

Added schema footprint after first/repeat: PG 9,510,912/11,960,320 bytes; HANA
3,051,520/3,481,600 bytes. The PG unchanged refresh grew allocation by 2,449,408 bytes despite
stable logical counts. HANA allocation can move independently as persistence/merge occurs.
The monitoring views were available using normal writer privileges; no monitoring role was granted.

Generated PostgreSQL cluster WAL: 337,418,528 bytes first pass, 605,075,744 bytes total.
This is **not retained WAL**, is not necessarily graph-only, and must not be added to live
schema storage as though it were a permanently retained graph file. Current repeated upserts
have high write amplification; unchanged refresh is not yet an incremental collection optimization.

Evidence: [safe batch events and snapshots](2026-09-07-graph-cc-soak-evidence.json).
All 182 batches, both pass snapshots and the final summary are retained. Initial planning
events expired from CF recent logs before capture; three planning requests were separately
observed and added to the total above. The newer CLI includes these in its summary counter.

## Larger HANA synthetic run

The final prepared-batch loader created **100,000 nodes / 1,000,000 observations in 13.33 s**
on the existing HANA free instance. This is synthetic bulk loading, **not SAP collection speed**.
Names, evidence widths and ten outgoing observations/node match the earlier PG synthetic fixture.
No source downloads, schema changes, new services or higher paid limits were needed.

The initial monolithic expression-join insert failed with HANA code 129, classified from the
native driver as a statement-memory failure. Transaction rollback left no committed synthetic
index. A smaller join-based attempt was stopped after several minutes without reaching its
first 10,000-node progress marker. The final implementation reads only the bounded generated
node-ID map and uses the official driver's prepared `execBatch`, at most 5,000 edge rows/call,
with one transaction and numeric-only errors. Regression tests cover batching, prepare/batch
failure rollback and error redaction. No production collector/store algorithm was changed.

Task `23b5fc1d-b4cc-4ab6-a3e4-493954bf010c`, synthetic key `SCALE-HANA-20260907-A`:
seed completed at approximately 12:18:19 UTC; 48 bounded traversal samples completed by 12:18:25.

| Hops | Concurrency | Samples | p50 | p95 | Representative nodes/edges |
|---|---:|---:|---:|---:|---:|
| 1 | 1 | 12 | 89.74 ms | 439.89 ms | 21 / 20 |
| 3 | 1 | 12 | 105.26 ms | 291.99 ms | 41 / 237, truncated |
| 1 | 3 | 12 | 85.99 ms | 197.60 ms | 21 / 20 |
| 3 | 3 | 12 | 109.88 ms | 146.19 ms | 41 / 237, truncated |

These CF-to-HANA SQL timings include connection/snapshot overhead, not public API or MCP latency.
Bounds stayed at 100 nodes/300 observations. Twelve samples/case are a small diagnostic sample,
not a production latency SLA; data topology is regular and compressible.

Immediate schema footprint: 96,559,104 persistence bytes and 240,228,318 resident column bytes.
Pre-seed baseline was 9,355,264/7,281,888 bytes respectively, including unreclaimed versions from
the stopped join experiment. A clean earlier post-soak persistence measurement was 3,047,424
bytes. Therefore a baseline-subtracted synthetic allocation is not a precise compression ratio.
Retain overall schema totals and later settled measurements rather than hiding this history.

At 12:21:11 UTC, approximately three minutes after seeding, graph-table persistence was
**65,429,504 bytes (62.40 MiB)** and resident column memory **60,486,426 bytes (57.68 MiB)**.
No forced savepoint, delta merge or memory-limit adjustment was issued. This later observation
is not a promise of permanent steady state. The schema includes the synthetic graph, the soak
index and the smaller normal live index; tenant baseline/logs/backups are not in these counters.
PostgreSQL retained WAL was unavailable to its writer identity; no extra privilege was granted.

The same task then refreshed the normal `A4H-2023-001` index through CC, PG first/HANA second:
125 source objects, 715 batch observations, 921,278 transient source bytes and 152 SAP requests
per backend. Durations were 59.86/66.31 s. Each reported one parse failure and two partial
parses, with zero read failures. PG's pre-existing normal index covers additional historical
scopes (1,799 nodes/2,496 observations versus HANA's 282/715); this refresh deliberately does
not erase out-of-scope evidence. Only the clean SOAK key supports the parity comparison above.

Evidence: [safe scale, refresh and later measurements](2026-09-07-graph-scale-evidence.json).

## Final integration and checks

Core regression: 5,842 tests/202 files, typecheck, lint, policy validation, build and size
budgets passed. Backend: 114 tests/33 files, typecheck, Biome and audit (zero known vulnerabilities)
passed. Docker API/quality/snapshot/lease/retention and logical restore passed, preserving
100,086 nodes/1,020,153 observations and reader access without changing the original database.
The final native bulk-loader path was additionally verified on real HANA, not a mocked SQL engine.

Live graph API passed 27 checks at concurrency three during collection (local HTTPS p50 280 ms,
p95 595 ms; no database/SAP binding in the API client). Live ARC passed all 11 enabled graph/
ordinary-SAP-read checks at 12:22 UTC. After restoring `ARC1_GRAPH_TOOLS=false`, the graph was
absent from tool discovery and non-invokable (two checks at 12:23 UTC). No core runtime source
change was needed for CC collection. The collector is stopped/no-route, with HANA writer,
Destination and Connectivity only; its temporary PG comparison binding was removed.

## Interpreting the experiment

This proves the supported CC transport and stable repeated metadata extraction for this sample,
not complete-system coverage, semantic precision/recall, PP collection, autonomous crawling,
live-change detection or production HA. Metadata is transiently collected once per batch and
written sequentially into two backends for comparison; this is not atomic cross-database replication.
Full source is not stored. Test indexes remain isolated from the API's configured system key.

Use the [operator sizing worksheet](../../docs_page/repository-graph-sizing.md) for capacity
planning. Keep measured graph bytes, provider baseline, logs/backups and CF app quotas separate.
Synthetic scale results must be labeled separately from live SAP collection.

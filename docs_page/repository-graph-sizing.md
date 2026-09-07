# Repository graph storage sizing (experimental)

This graph stores object metadata and dependency evidence, **not complete SAP source**. Source
is downloaded and parsed transiently for `collect-live-source`; `collect-live-metadata` avoids
source downloads but mostly provides object/package membership. Neither mode creates embeddings.
Database size depends mainly on node count, relationship count, name/description lengths,
indexes and refresh frequency—not the ABAP system's business-data size.

## What needs disk or memory?

| Resource | Include in planning |
|---|---|
| Persistent graph | Objects, unresolved referenced objects, package nodes, evidence observations, indexes, collection outcomes and generations |
| Refresh headroom | PostgreSQL old row versions/index churn until vacuum; HANA delta/main/merge and transactional versions; job history grows with runs |
| Transaction logs | PostgreSQL WAL or HANA redo/undo; retention depends on provider, replication and backup policy |
| Recovery | Backups outside the active database; spare capacity for restore/rebuild, not just the live graph |
| Collector | Bounded source/parser workers, one metadata batch in memory, native libraries and app image on ephemeral disk |
| Query app | Separate read-only process; no local source mirror or database file |

Do not add `pg_database_size` to table/index sizes: it already includes them. Likewise,
downloaded source bytes and metadata JSON bytes describe traffic/serialization, not allocated
database storage. CF app disk limits, database storage and HANA memory are separate budgets.

## Measure your installation

Use a representative mix of packages, object types, small/large sources and relationship density.
Measure before import, after the first pass, and after at least one **unchanged refresh**. Confirm
node/observation counts do not multiply. Include partial/failed parses in the results; successful
batch execution is not proof that every dependency was extracted.

The backend provides a bounded comparison experiment, separate from normal collection:

```sh
# Run inside services/repository-graph after build, on an isolated collector deployment.
# Both PG and HANA writer bindings must be configured explicitly; never bind DBADMIN.
export ARC_GRAPH_SYSTEM_KEY=SOAK-YOUR_SYSTEM_CLIENT_RUN1
export ARC_GRAPH_SOAK_PACKAGES='YOUR_PACKAGE_A,YOUR_PACKAGE_PREFIX*'
export ARC_GRAPH_SOAK_OBJECTS=3000
export ARC_GRAPH_SOAK_PASSES=2
export ARC_GRAPH_SOAK_MINUTES=90
node dist/graph/soak.js
```

The test imports the **same metadata** sequentially into both databases, at most 500 source
objects/batch and concurrency 2. It refuses an already populated `SOAK-` key. This is not an
atomic cross-database write feature, a scheduler, or a resumable full-system crawler. It does
not expose the test index through an API configured for another system key. Existing index data
is preserved; test data remains until an owner plans explicit cleanup.

Limits: 10,000 distinct collected objects, five passes, 200 attempted first-pass batches and
180 minutes maximum; defaults are 3,000/two/100/90. Package discovery may be capped and no
inventory deletion is inferred. The deadline terminates the experiment; committed earlier
batches remain and a failed second-database import makes the run incomplete. Reports include
safe counts, per-batch timings, content fingerprints, peak process RSS and schema storage, not
source, credentials or raw errors. Save JSON progress output privately before CF logs expire.

On BTP, run this as a task of the isolated collector using the binding instructions in
[backend setup](repository-graph-backend.md). Recheck free plans and available task memory first.
No new database is required when dedicated PG and HANA trial databases already exist. A normal
installation needs **one** database, not both.

### Larger synthetic HANA check

For a separate database-capacity/traversal check, `dist/graph/hana-scale.js` generates up to
100,000 nodes and one million observations **in HANA**, with the same names, widths and
regular fanout pattern as the PostgreSQL synthetic fixture. It does not read SAP or measure
collector speed. Run only on a dedicated test database, after the free-quota preflight:

```sh
export ARC_GRAPH_SCALE_CONFIRM=synthetic-metadata-only
export ARC_GRAPH_SCALE_SYSTEM_KEY=SCALE-YOUR_UNIQUE_RUN
export ARC_GRAPH_SCALE_NODES=100000
export ARC_GRAPH_SCALE_FANOUT=10
node dist/graph/hana-scale.js
```

Use the existing HANA writer binding, not DBADMIN. The script refuses an existing test key,
takes the collector lock, rolls back a failed seed and leaves other systems untouched. It
requires visible pre-existing schema storage below 1 GiB and caps the seed at one million
observations. Nodes use set-based SQL; edges use the driver's prepared `execBatch` in groups
of at most 5,000 observations within one transaction. The collector keeps only the bounded
synthetic node-ID map and one edge batch in memory. A monolithic million-edge join exceeded
statement memory on the tested free HANA; the final loader does not use that join or raise
service limits. It does not auto-delete test data. A post-commit benchmark failure leaves the
seed for diagnosis; do not rerun with the same key expecting overwrite. Capture immediate
**and later settled** persistence measurements. Native bulk SQL timing is not live SAP ingestion.

### Measurement definitions

- PostgreSQL: `pg_table_size` includes heap/TOAST and auxiliary storage; `pg_indexes_size`
  reports table indexes; `pg_total_relation_size` combines them. Count only base tables to avoid
  double-counting indexes. `pg_database_size` includes other schemas/catalogs. The difference
  between WAL positions measures **cluster WAL generated**, not retained WAL or graph-only WAL.
  [PostgreSQL administration functions](https://www.postgresql.org/docs/16/functions-admin.html).
- HANA: `M_TABLE_PERSISTENCE_STATISTICS.DISK_SIZE` measures graph-table persistence;
  `M_CS_TABLES.MEMORY_SIZE_IN_TOTAL` measures resident column-table memory. It is not total tenant
  memory and excludes the small row-store lock table. Monitoring views can be privilege-filtered;
  missing rows are reported as unavailable, never zero. Persistence can lag until savepoints/
  merges, so retain a later settled measurement. Do not force global maintenance merely to
  improve a benchmark. [Persistence view](https://help.sap.com/docs/hana-cloud-database/sap-hana-cloud-sap-hana-database-sql-reference-guide/m-table-persistence-statistics-system-view),
  [column-table memory view](https://help.sap.com/docs/hana-cloud-database/sap-hana-cloud-sap-hana-database-sql-reference-guide/m-cs-tables-system-view).

## Live Cloud Connector measurements

On 2026-09-07, a **40.84-minute** A4H 2023/client 001 run collected 2,187 distinct source
objects from 82 nonempty packages and repeated the same collection. Both backends received
identical metadata: **4,712 nodes and 12,702 observations**, unchanged after the second pass.
The index includes 82 package nodes and 2,443 unresolved referenced objects; node count is
therefore not source-object count. All 82 repeat batches had identical content fingerprints.

| Schema measurement | Before | After first pass | After unchanged refresh |
|---|---:|---:|---:|
| PostgreSQL tables + indexes | 2.76 MiB | 11.83 MiB | 14.16 MiB |
| HANA graph-table persistence | 0.66 MiB | 3.57 MiB | 3.98 MiB |
| HANA column-table memory | 0.92 MiB | 2.89 MiB | 3.15 MiB |

Added graph footprint after both passes: **11.41 MiB PostgreSQL / 3.32 MiB HANA** at these
measurement times. These are schema deltas, not minimum database provisioning requirements.
Existing datasets remained in the baseline. HANA persistence is savepoint/merge-dependent.

The two passes transferred 31.78 MiB of source transiently and made 4,579 SAP request attempts,
including package planning. Peak collector process RSS was **316 MiB** inside a 512 MiB CF task.
This is one measured sample, not a worst-case memory bound. Each pass had 1,993 fully parsed
objects, 165 partial parses, 25 parse failures and four read failures. Dynamic dependencies and
capped searches prevent complete-system coverage. The 3,000-object target stopped at the
configured 100 attempted-package cap; it is not evidence that the SAP system has only 2,187 objects.

The refresh still downloads/parses sources: content fingerprints prove stable output, not an
incremental-download cache. PostgreSQL generated **577 MiB of cluster WAL** across both passes;
this does not measure retained WAL or a graph-only log allocation. Current row-by-row imports
and unchanged upserts have significant write amplification. Batch upsert/change detection and
job-history retention are future optimizations, not implemented savings. Allow for this when
scheduling frequent refreshes. See the [reproducible evidence report](https://github.com/arc-mcp/arc-1/blob/codex/optional-repository-graph/docs/research/2026-09-07-graph-cloud-connector-sizing.md).

## Sizing worksheet

For representative imports, estimate:

`live graph bytes ≈ fixed baseline + nodes × measured bytes/node + observations × measured bytes/observation + retained job history`

Measure node and observation tables separately; never multiply a whole-database per-source ratio
without accounting for unresolved referenced nodes and relationship density. Include every index
actually deployed. Description/evidence width and duplicate observations from different methods
can materially change the result.

As an initial **planning allowance**, reserve 2–3× the measured live graph for growth and refresh
churn, then add provider/system baseline, retained logs, backups and restore capacity separately.
This multiplier is not a guaranteed requirement or service limit; revise it from repeated-refresh
measurements and your retention policy. Do not fill a trial database to its last free bytes.

Monitor the provider's **overall** storage utilization, not only these schema counters. SAP's
PostgreSQL storage event uses warning above 80% and fatal above 90%; plan intervention before
those thresholds, not at 100%. This guide does not install an alerting service or change its
entitlements. [SAP storage alerts](https://help.sap.com/docs/alert-notification/sap-alert-notification-for-sap-btp/postgresql-storage-full).

Earlier controlled PostgreSQL synthetic evidence: 100,000 nodes and 1,000,000 observations used
502,259,712 bytes (479 MiB) in graph relations/indexes and generated 1,073,862,048 bytes (1.00 GiB)
of WAL during initial import. At identical widths and density, 1 million nodes/10 million
observations would extrapolate to roughly 4.7 GiB of relations/indexes **before** operational
headroom. This is a linear estimate, not a tested live-SAP size or a HANA compression estimate.

The corresponding **HANA free synthetic test passed** with 100,000 nodes/1,000,000 observations.
Whole graph-schema persistence was 92.09 MiB immediately after bulk loading and **62.40 MiB**
about three minutes later; column-table memory fell from 229.10 MiB to **57.68 MiB**. These
totals also include the smaller live indexes. Earlier rolled-back test versions affected the
pre-seed baseline, so this is not a precise per-row compression ratio. The prepared-batch seed
took 13.33 seconds; 48 bounded traversal samples passed (p95 146–440 ms across the tested
hop/concurrency cases). This neither measures live SAP ingestion nor promises production latency.

Practical starting point for a **100k-node/1m-observation metadata graph of similar widths**:
budget roughly 1–1.5 GiB for PostgreSQL graph growth/churn from the measured 479 MiB, then add
logs, provider baseline and backups separately. HANA's tested graph-table footprint was much
smaller, but its minimum service memory/storage and operational headroom remain separate.
Do not provision a database from the graph's 62 MiB alone. Retained PostgreSQL WAL was not
readable with the tested writer privileges; use provider monitoring rather than granting a
collector extra administrative access just to obtain that number.

## Trial and deployment baseline

The tested HANA free instance provisions **16 GiB memory and 80 GiB storage** even when the graph
uses only megabytes. That provisioned baseline cannot be inferred from a table-size measurement.
PostgreSQL free has provider-specific allocation and a limited lifecycle; do not equate SQL
database size with the remaining quota. Verify entitlements and current limits as described in
[the specification](repository-graph-specification.md#85-cost-lifecycle-and-operations).

The existing experimental manifests allocate 256 MiB RAM/1 GiB app disk to the query app and
512 MiB RAM/1 GiB app disk to the collector task. Local Docker additionally needs space for
images/build cache and a PostgreSQL volume/WAL; start with several GiB free disk and approximately
4 GiB available RAM, then size the volume from the worksheet. No AI Core or vector embedding
service is required. Vectors, if added later, need their own dimension/index/refresh budget.

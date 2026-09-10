> Historical research from PR #756; the persistent graph was not merged.
> [Archive status and current direction](../../README.md) take precedence over the dated instructions below.
> Source: [69d7d596](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/docs/plans/repository-graph-cloud-connector-and-sizing.md).

# Repository graph: Cloud Connector and storage sizing

Status: implemented and locally/live verified. Extension of PR #756; do not merge automatically.

## Scope and acceptance gates

1. Add an independent collector transport for an explicitly selected Connectivity binding and
   `OnPremise`/`BasicAuthentication` destination. Keep direct HTTPS working; never fall back from
   the proxy to a public endpoint. Principal propagation remains a separate unsupported headless
   identity model. Do not change normal ARC auth, default tool visibility or database contracts.
2. Verify absolute-form proxy requests, location routing, token expiry/refresh, authentication
   failure containment, redirects, timeouts and decoded response-size bounds with local fixtures.
3. Bind the existing free Connectivity service to the dedicated stopped collector. Reuse the
   existing 2023/client 001 technical-user destination without editing it. Verify SAP identity
   and a source read through its non-public virtual hostname, plus wrong-location/proxy-auth
   negative checks. Never test unrelated destinations or change SAP objects/roles.
4. Perform a bounded extended live collection, aiming for several thousand distinct objects
   in batches of at most 500, concurrency 2. Run a repeat refresh to expose storage churn and
   deduplication. Keep checkpoints and reports metadata-only; preserve existing trial datasets.
5. Measure both PG and HANA using the same collected metadata where possible. Separate table/
   index storage, HANA resident memory, database baseline, transaction logs/WAL and refresh
   headroom. Report actual bytes, counts, duration, failures, saturation, and partial coverage;
   never substitute synthetic seed speed for live ingestion speed.
   Add a separate bounded HANA 100k-node/1m-observation native SQL seed to complement the
   existing PostgreSQL synthetic fixture; same regular fanout/metadata widths, separate key,
   no SAP traffic, no extra services, no schema administration or storage-maximizing run.
6. Derive a sizing worksheet for larger repositories from measured node/edge density and
   metadata width. Explicitly distinguish measured ranges, extrapolation, and unknown overhead.
   Reuse the earlier synthetic PG large-graph evidence, extending it if needed.
7. Update the canonical setup/runbook/specification and add a reproducible sizing report.
   Run backend/core regression gates, Docker, live ARC smoke, docs validation and PR CI.
   Restore owned test apps and default-hidden tools; retain free plans and leave PR unmerged.

## Deployment safeguards

- Existing services: `arc-index-destination` (`destination/lite`), `arc1-multi-connectivity`
  (`connectivity/lite`), `arc-graph-pg` (`postgresql-db/free`), `arc-graph-hana-test`
  (`hana-cloud/hana-free`). Revalidate plans/quota before every stage/task.
- Serial staging: stop only the owned graph query and ARC validation apps for the 1 GiB staging
  reservation. Collection: keep the ARC validation app stopped to fit a 512 MiB task.
- Do not modify existing destinations, Cloud Connector mappings, SAP users, roles or source.
- The existing destination's HTTP virtual address is a Cloud Connector target, not permission
  to call public SAP HTTP ports. Internet/direct collection remains verified HTTPS only.
- Explicit shared metadata audience remains mandatory. No caller JWT or human session becomes
  a background collector credential. No new ARC role is introduced.

## Design investigation

SAP Cloud SDK supports Connectivity proxying, but its default binding selection takes the first
Connectivity binding. ARC already has a verified bounded `undici` absolute-form proxy path.
Selected the small independent transport: no additional SDK dependency and no core change.
Explicit binding selection, secret-safe failures, response bounds and no process-global config
mutation are retained in the production transport. The isolated sizing CLI sets its own scopes.

## Evidence

- Live final transport proof: task `7ab95e3f-1f91-474a-b740-faaefe29ac7a`, 2026-09-07
  11:15 UTC, succeeded. A4H/client 001 via CF-unresolvable virtual hostname: source 200,
  anonymous 401, invalid proxy token 407, wrong location 503. No source/token/cookie values logged.
- Early probe issues were diagnostic assumptions, not a bypass: `ZSSI*` matched CDS but no
  class; changed to standard `CL_ABAP*`. Raw protected-source proof needed `Accept: text/plain`.
- Local proxy tests caught an unhandled Undici cancellation error; body error handling fixed.
  Review additionally rejected ambiguous direct/destination configuration and made SAP 401
  fatal before consuming a potentially large/slow error body.
- Core: 5,842 tests passed, typecheck/lint/build/policy/schema-size gates and strict docs passed.
  Backend: 114 tests at this checkpoint, including real local proxy and sizing regression tests.
  Docker: all 14 API checks, seven collector-quality checks, six snapshot/lease/role checks,
  source canaries and refresh retention passed.
- Docker restore repeated successfully with 100,086 nodes/1,020,153 observations; original
  database unchanged. Final image at this checkpoint:
  `sha256:1396927c3316866d4e45eec6e962a40592ebf99acf465bfccca10ca14c54c42a`.
- Concurrent live HANA API smoke during CC collection: 27 checks, concurrency 3, p50 284 ms/
  p95 591 ms from the local workstation. Actual `ZCL_SSI_ADAPTER_GEN` impact: five nodes/eight
  edges. The first broad `ZSSI` sample selected a leaf class with no callers; narrowed the
  diagnostic sample instead of claiming every class must have incoming edges.
- Extended live run: task `5c16cbdf-832c-44d6-9383-e2cb3b1aa0b0`, separate system key
  `SOAK-A4H2023-CC-20260907-A`, succeeded at 11:58 UTC after 40.84 minutes.
  The 100 attempted-package cap stopped the first pass at 2,187 objects/82 nonempty packages,
  not the 3,000 target. Two passes made 4,374 source reads; all 82 repeated batches were stable.
  Both backends retained 4,712 nodes/12,702 observations. Added schema footprint after refresh:
  PG 11.41 MiB, HANA 3.32 MiB; generated cluster WAL 577 MiB; peak process RSS 316 MiB.
  Partial extraction remains explicit: each pass had 165 partial parses, 25 parse failures,
  four read failures. Same metadata imported sequentially is not a production dual-write promise.
  All 182 safe batch events, both pass snapshots and final summary are preserved in
  `docs/research/2026-09-07-graph-cc-soak-evidence.json`. Package-planning requests add three to
  the older staged summary's request counter; current code includes them automatically.
- Final CC proof with explicit ABAP source validation passed again at 12:04 UTC. Final HANA
  scale/normal PG+HANA refresh task `23b5fc1d-b4cc-4ab6-a3e4-493954bf010c` succeeded.
  Synthetic 100k nodes/1m observations loaded in 13.33 s using prepared batches. A monolithic
  expression join hit statement memory; a smaller join attempt was stopped; neither committed
  test data. Final implementation binds at most 5,000 edge rows/batch and rolls back on failure.
  All 48 bounded traversal samples passed. Later HANA schema disk/memory: 62.40/57.68 MiB,
  including smaller live indexes. See the research report for the affected baseline and limits.
- Final normal CC refresh: 125 sources/715 batch observations on each backend, 59.86 s PG /
  66.31 s HANA; one parse failure/two partial parses, no read failures. Historical PG scopes
  were preserved, so its whole normal-index counts need not match the narrower HANA index.
- Final live ARC attachment: 11 enabled checks passed at 12:22 UTC, including ordinary SAPRead;
  two hidden/non-invokable checks passed at 12:23 UTC after restoring `ARC1_GRAPH_TOOLS=false`.
  Query and ARC validation apps are running; collector is stopped/no-route with only HANA writer,
  Destination and Connectivity bindings. Temporary PG writer binding/selector removed. No
  runtime admin bindings, new routes or paid services were introduced. Private CC deployment
  snapshot retained locally for this owned collector; no secrets or account examples enter docs.
- Operator guide now separates measured live/synthetic data, graph vs database/app/log storage,
  refresh churn, sample failures and planning allowances. All 16 known local credential values
  checked against 1,597 repository files: zero matches. Strict docs and eight documentation
  assertions passed; final remote CI is checked after pushing this revision.

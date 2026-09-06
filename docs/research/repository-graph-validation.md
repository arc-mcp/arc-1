# Repository graph: implementation review and validation

2026-09-06. Branch `codex/optional-repository-graph`, based on `38910bbf`.

## Result and boundaries

Optional native SAPGraph, no plugin installation: standard/hyperfocused MCP and CLI use a
small per-runtime HTTP adapter. Collector and PostgreSQL stay in the separate local
`arc-repository-index` project. This ARC PR includes the contract, adapter, regression tests,
smoke runner and setup documentation—not that project's source/HANA history, secrets or an
additional deployment. Current main already removed warmup; normal caches were not modified.

## Evidence

| Check | Observed result |
|---|---|
| Full ARC suite | 5,831 tests / 201 files passed, including final review cases |
| New ARC adapter tests | 60 tests: configuration, client, lifecycle, MCP, CLI, authenticated HTTP, enabled-schema snapshots |
| Separate collector unit suite | 80 tests / 18 files; source **and test** TypeScript now checked |
| Real PostgreSQL API v2 suite | 13 positive checks: limit+1, slash aliases, missing/ambiguous identities, closed node budget, paths, coupling, scope/key rejection, v1 closure, safe errors, invalid impact relation |
| Collector/DB failure suite | Seven checks, including nonempty-edge last-good preservation, successful empty replacement, rollback of graph + collection metadata, no-source canaries |
| Live SAP refresh, twice | 125 discovered; 122 parsed; 0 read failures; 1 parse failure; 2 partial parses. 153 nominal requests and 921,278 transient bytes per run; 12.701 / 11.171 s |
| Live resulting partition | 322 nodes, 715 observations, 181 unresolved nodes (includes retained stubs); identical counts across the immediate refreshes |
| Native MCP live-index smoke | 58 successful calls; no SAP requests on query path; standard SDK list/call with intentionally blocked SAP preflight |
| Example impact payload | Seven nodes / twelve observations; about 3.1 KB vs earlier 9.4 KB repeated-node representation |
| Enabled schema | 1,190 added wire bytes (~298 estimated tokens); full-write listing 71,955 bytes, under unchanged 72,000-byte ceiling. Hyperfocused 1,065 bytes vs 927 default |
| Synthetic scale rerun | 100k-node/1m-observation fixture, 180 traversals at concurrency 1/5/10 and depth 1/3: zero errors/timeouts, p95 2.32–11.38 ms; deeper responses explicitly truncated |
| High-degree bounds | 20k-edge hub: 301 candidate observations examined, 100 returned nodes / 99 observations, closed and truncated; 8.09 ms. Legacy representation 67,909 bytes, below 512k cap |
| Final non-test gates | Source/script/test typecheck, lint, policy, build, file/schema budgets and strict MkDocs build passed |

The first 50-query smoke timing (5 concurrent) was p50 7.31 / p95 10.58 ms, but the automatically
selected class had no incoming impact edges. Treat it as empty-result/control-path latency,
not a representative traversal benchmark. Selecting connected `ZCL_SSI_ENGINE` returned seven
nodes/twelve observations: p50 7.56 / p95 14.09 ms, then 6.64 / 13.03 ms on repetition (50 queries,
five concurrent). These warm local measurements are not an accuracy or production-SLA claim.
The reproducible smoke now guards/counts SAP transport attempts instead of merely asserting
that the supplied failed preflight should block them. Final guarded run: 58 calls, zero SAP
attempts, p50 7.11 / p95 13.79 ms, seven nodes/twelve observations.

The three incomplete live objects had **zero old edges**, so their live preservation check alone
is vacuous. Nonempty preservation is demonstrated by the independent failure-injection suite.
No SAP object writes, HANA changes, CF deployments or paid provisioning were performed.

## Plan review and fixes during implementation

- Use current main instead of the older, dirty checkout; preserve all unrelated work there.
- The legacy API could bypass scoped v2 credentials; scoped deployments now refuse v1 entirely.
- Return `not_indexed`/`ambiguous`, never silently conflate a missing root with zero dependencies.
- Filter edge endpoints before admitting an edge so maxNodes produces a genuinely closed graph;
  deduplicate observations and transfer IDs, not duplicated full node payloads.
- Validate response shape, system, audience, action, counts, closure and traversal semantics.
  Do not expose backend exception bodies or source snippets.
- Keep graph auth state separate from the `isPerUserClient` flag; there is no SAP client minting.
- HTTP creates a Server per request: shared runtime ownership prevents duplicate probe loops;
  only persistent stdio sessions subscribe. HTTP requests retain no notification listeners.
- Cancelling a status waiter does not cancel the probe shared by other callers. Real rate-limit
  exhaustion is verified to stop the next query before any backend call.
- The old high-degree oracle expected edges with omitted endpoints. Its positive assertion now
  requires closure and the correct 99-edge star under a 100-node limit, with compact diagnostics.
- Give the optional tool its own schema-budget scenarios. Compact redundant model annotations
  instead of increasing the wire ceiling; keep full validation in the runtime schema.
- The backend's original tsc command excluded tests. Enabling test typechecking exposed incorrect
  Node HTTP overload extraction and a mock tuple type; those are fixed.

Security review: no mutation/SQL path (I1/I6); explicit shared audience and instance isolation
(I2/I3, ADR-0008); graph-only credentials and safe errors (I4); bounded transport/concurrency and
no per-HTTP-request listener retention (I5); scope/deny ceilings apply regardless of model intent
(I7). Existing common auditing is retained. This is a
scoped implementation review, not an independent security certification.

## Reproduce

ARC: `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run validate:policy`,
`npm run check:sizes`, `npm run build`. Node 24.11.1 was used locally (default shell Node 22.18
is below current ARC's supported engine). No new dependencies were added to ARC.

Read-only connected smoke:

```sh
ARC1_GRAPH_CONNECTION_FILE=/absolute/private/connection.json node scripts/repository-graph-smoke.mjs
arc1-cli graph status
```

Backend Docker checks: `tests/graph/api-v2.mjs`, `tests/graph/collector-quality.mjs`,
`tests/graph/live-collector-quality.mjs` (explicit trial scope); `graph/cli.js retention-check`,
`verify-refresh`, `benchmark-scale`, `verify-bounds`.

## Not yet proven

Manual precision/recall over 50 objects/100 edges; full semantics of includes/macros/dynamic SQL;
30-question value comparison; per-edge source version/freshness; canonical storage consolidation
and exact metadata enrichment; durable distributed refresh/deletion; restricted audiences;
HANA parity; actual CF network/binding deployment; behavior of each desktop client's cached
tool list. These remain production gates, not silent acceptance claims for this local adapter.

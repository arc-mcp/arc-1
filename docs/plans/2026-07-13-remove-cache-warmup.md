# Remove the ARC-1 cache warmup

**Status:** implemented
**Scope:** ARC-1 only; no HANA configuration, adapter, probe, interface, or external index service is introduced
in this change
**Decision:** remove the startup pre-warmer and its graph storage, retain the normal source/ETag cache,
and keep `SAPContext(action="usages")` as a live SAP-authorized lookup.

## Goal

Remove ARC-1's system-wide TADIR/source warmup so ARC-1 returns to being an on-demand MCP server with a
small, request-driven cache. This creates a clean boundary for a later, separately deployed search/index
service without making ARC-1 startup, authorization, or local SQLite responsible for system-wide indexing.

The change must:

- keep normal source caching, ETag revalidation, inactive-draft handling, dependency contracts, and function
  group resolution;
- remove all startup indexing, reverse-edge graph state, warmup configuration, UI state, and warmup tests;
- preserve the `SAPContext.usages` tool action by using SAP's live where-used APIs through the caller's
  `AdtClient`;
- fail clearly when removed warmup configuration is still present instead of silently ignoring it;
- add no HANA/index integration code until that separate design is proven.

## Non-goals

- Building the BTP/HANA index service.
- Adding a placeholder HANA/index interface, health probe, feature flag, service binding, or deployment module.
  The future implementation is not clear enough yet; it must start as a separate design after this cleanup.
- Adding RAG, embeddings, vector search, or system-wide text search to ARC-1.
- Removing `ARC1_CACHE`, memory caching, or optional SQLite persistence.
- Redesigning `SAPContext.impact`; it already uses live SAP analysis and does not require the warmup graph.
- Cleaning unrelated, currently unused cache APIs such as `putApi`/`getApi`.
- Rewriting historical changelog, security-review, completed-plan, or research documents.

## Current-state findings

### Startup and load

`src/server/server.ts` awaits `runWarmup()` before it starts the feature probe and creates the MCP server.
Warmup therefore blocks readiness. This conflicts with the current caching guide's statement that warmup runs
in the background.

The pipeline in `src/cache/warmup.ts` performs:

1. three unrestricted custom-name-prefix TADIR queries (`Z%`, `Y%`, `/%`) for `CLAS`, `INTF`, and `FUGR`;
2. in-memory package filtering;
3. one or more SAP source requests for every selected object, in batches of five;
4. local dependency extraction and source/node/edge writes.

The declared 10,000-object limit is passed to each prefix query, so it is not a true global 10,000-object cap.
The implementation always enumerates TADIR and source-checks every candidate. The source comment and docs
claim an on-premise `REPOSRC-UDAT` delta strategy, but no `REPOSRC` query exists. The `_systemType` argument is
unused.

This is the wrong lifecycle for a Cloud Foundry web process. Cloud Foundry documents tasks as finite,
asynchronous jobs with their own container while inheriting application environment and service bindings;
index construction belongs in that shape if it is reintroduced. Cloud Foundry also recommends health checks
that respond quickly and independently of business logic. ARC-1 should not hold readiness on a repository scan.

References:

- [Cloud Foundry tasks](https://docs.cloudfoundry.org/devguide/using-tasks.html)
- [Cloud Foundry application health checks](https://docs.cloudfoundry.org/devguide/deploy-apps/healthchecks.html)

### Correctness gaps in the graph

The current graph cannot be treated as a reliable system index:

- A changed object's new edges are upserted, but edges removed from its source are never deleted. This leaves
  false-positive reverse usages.
- Objects deleted from SAP disappear from TADIR but remain in persistent SQLite with their old nodes and edges.
- Edge identity uses object names, not `(object type, object name)`, so same-name objects of different types can
  be conflated.
- Coverage is limited to classes, interfaces, function groups, and their function modules. Programs, includes,
  CDS entities, behavior definitions, and many other repository types are absent.
- Warmup is marked complete even when enumeration yields no objects or individual indexing largely fails.
- `warmupDone` is process-local and is not restored from the SQLite database after restart.
- If SAP returns a changed ETag with identical source content, the hash shortcut skips the write and retains the
  old ETag, causing avoidable subsequent transfers.

These gaps make incremental repair a larger project than removal and do not solve the architectural problem.

### Security and identity

Warmup uses the startup technical `AdtClient`, while HTTP requests can use per-user principal propagation.
The resulting shared reverse index is not scoped to the caller's SAP identity. ARC-1 currently mitigates the
leak by disabling `SAPContext.usages` under principal propagation, as recorded by security risk R12.

Removing the shared graph and performing live where-used through the request's per-user client satisfies cache
isolation invariant I2 by construction: SAP authorizes the lookup for the actual caller. It also avoids placing
additional system source in SQLite, reducing the cleartext-at-rest exposure described by residual risk R15.

### Normal caching remains valid

The normal cache is request-driven and server-validated:

- source reads store source plus ETag;
- later reads send `If-None-Match` and accept `304 Not Modified`;
- inactive drafts and the activation freshness window have separate correctness rules;
- dependency contracts are keyed by source hash;
- memory remains the automatic default and SQLite remains explicit persistent storage.

Conditional requests are the standard HTTP mechanism for avoiding a full representation transfer when the
stored representation is unchanged; see [RFC 9110, conditional requests](https://www.rfc-editor.org/rfc/rfc9110#section-13).
None of this depends on warmup nodes or edges.

## Target architecture

```text
MCP request
    |
    +-- source/dependency read --> normal ARC-1 ETag cache --> SAP on miss/revalidation
    |
    +-- SAPContext.usages ------> shared live where-used helper --> caller's SAP client
    |
ARC-1 startup --> initialize small cache --> auth/feature probes --> serve
                 (no TADIR scan, no repository crawl, no graph build)
```

ARC-1 keeps the tool action but not the index implementation. This avoids an unnecessary breaking change in
the MCP action enum. No future index abstraction is added by this removal; a later HANA design can choose its
own integration boundary based on evidence from the standalone index build.

## Compatibility decisions

### Keep `SAPContext(action="usages")`

Do not remove the action from `src/handlers/schemas.ts`, `src/handlers/tools.ts`, or authorization policy.
Instead, make it an alias over the same live where-used behavior as
`SAPNavigate(action="references")`.

Resolution rules:

1. If `type` and `name` are provided, resolve the canonical object URI exactly as `SAPNavigate` does.
2. If only `name` is provided, call the ADT object lookup for that exact name.
3. If one exact supported object is found, use its type/URI.
4. If multiple exact objects are found, return a bounded ambiguity response listing type/name/URI and ask the
   caller to resend `type`; never guess.
5. If no exact object is found, return a normal not-found result.
6. Use scope-based where-used first and retain the existing older-release fallback to references.

Return a JSON payload with `name`, resolved object metadata, `usageCount`, `usages`, and `source: "live"`.
The action semantics remain stable, but the old synthetic `{fromId, edgeType}` edge shape is retired because it
was incomplete and cannot accurately represent SAP's richer where-used result.

### Keep authorization stable

`SAPContext.usages` remains a `read` action in `src/authz/policy.ts`. The shared helper must use only operations
already authorized by the live navigate path. Principal propagation is no longer a reason to disable usages.

### Reject removed configuration explicitly

Remove the active fields, but add the four identifiers to the retired-config detector:

- `ARC1_CACHE_WARMUP`
- `ARC1_CACHE_WARMUP_PACKAGES`
- `--cache-warmup`
- `--cache-warmup-packages`

Startup must fail with a focused migration message: warmup was removed; normal cache remains enabled; use live
`SAPContext.usages`/`SAPNavigate.references`; system-wide indexing belongs to the optional external service.
Silent acceptance would make operators believe a repository index still exists.

### Retire graph stats

Remove `warmupAvailable`, `nodeCount`, and `edgeCount` from `SAPManage.cache_stats` and the UI API. Keep
`sourceCount`, `contractCount`, `apiCount`, mode/configuration, and cache activity. Document this small response
shape change in the updating guide and release notes.

## Implementation plan

### Phase 0 — Characterization tests

Add tests before removing code so the desired replacement behavior is fixed:

- `SAPContext.usages` with explicit type uses live where-used and returns results.
- Name-only usage resolves one exact object through ADT lookup.
- Ambiguous name-only usage returns candidates and makes no where-used call.
- Older SAP where-used endpoint failure takes the existing references fallback.
- Principal-propagation requests use the per-user client and are no longer rejected.
- Cache-disabled mode does not affect live usages.
- `SAPContext.impact` behavior is unchanged.

Primary files:

- `tests/unit/handlers/manage-context.test.ts`
- `tests/unit/handlers/search-navigate.test.ts`
- `tests/helpers/` only if a shared mock fixture is useful

### Phase 1 — Share the live where-used implementation

Extract the symbolic URI resolution and reference lookup from `src/handlers/navigate.ts` into a small internal
module, for example `src/handlers/where-used.ts`.

The helper should:

- resolve `FUNC` through its function group;
- resolve `TABL` through `resolveTablObjectUrl`;
- retain slash-form `objectType` filter semantics;
- use `findWhereUsed`, with the existing narrow `404/405/415/501` fallback to `findReferences`;
- retain best-effort interface implementer augmentation without broadening data/SQL permissions;
- return structured data rather than a preformatted `ToolResult`, so both callers control their response shape.

Update:

- `src/handlers/navigate.ts` to call the helper;
- `src/handlers/context.ts` to call it for `usages`;
- `src/handlers/tools.ts` descriptions to say usages is live and SAP-authorized;
- tool-definition fixtures through the repository's normal snapshot update process.

Do not copy the navigate logic into `context.ts`; one implementation prevents the two actions from drifting.

### Phase 2 — Remove startup and configuration paths

Delete:

- `src/cache/warmup.ts`
- `tests/unit/cache/warmup.test.ts`
- `tests/integration/cache-warmup.slow.integration.test.ts`

Update:

- `src/server/server.ts`: remove dynamic warmup import, client construction, awaited run, result logging, and edge
  count startup logging;
- `src/server/types.ts`: remove `cacheWarmup` and `cacheWarmupPackages` fields/defaults;
- `src/server/config.ts`: remove active resolvers and add retired env/CLI guards with dedicated wording;
- `.env.example`: remove warmup examples;
- `mta-overrides.mtaext.example`: remove warmup properties;
- `mta.yaml` and override comments: refer to the BasicAuth destination only for the startup feature probe where
  that remains true.

Add config tests showing all retired names fail (including explicit `false` values) and ordinary cache options
still resolve. Use a general retired-config map/message rather than adding warmup to the existing
authorization-specific v0.7 legacy error. These four string constants and their tests are the only intentional
non-historical code tombstones; they provide no warmup behavior and may be removed after the documented
migration window.

Remove the warmup import, smoke block, and no-warmup usages block from
`tests/integration/cache.integration.test.ts`. Replace only the usages coverage with live lookup coverage; the
dedicated slow warmup integration file is deleted entirely.

### Phase 3 — Remove warmup graph storage and state

`src/cache/caching-layer.ts`:

- remove `warmupDone`, `setWarmupDone`, `isWarmupAvailable`, `getUsages`, and the `warmup_state` activity event;
- retain all source, inactive-list, activation, contract, invalidation, and function-group behavior.

`src/cache/cache.ts`, `src/cache/memory.ts`, and `src/cache/sqlite.ts`:

- remove `CacheNode`, `CacheEdge`, and graph CRUD methods;
- remove in-memory node/edge maps and reverse maps;
- stop creating `nodes` and `edges` tables/indexes;
- remove `nodeCount` and `edgeCount` from `CacheStats`;
- remove the public `Cache.transaction()` method and its memory/SQLite tests because warmup is its only runtime
  caller;
- keep source, dependency-contract, API, and function-group storage.

SQLite needs an idempotent retirement migration on open:

1. start a transaction;
2. drop `edges` before `nodes` if they exist;
3. leave all retained tables untouched;
4. commit before serving cache operations.

Add a migration fixture/test that creates a pre-removal SQLite database containing sources, contracts, nodes,
and edges, opens it with the new implementation, and verifies:

- obsolete graph tables are gone;
- retained source and contract records still read correctly;
- reopening is idempotent.

The cache is rebuildable, so no graph export is required.

Update the retained cache tests deliberately:

- `tests/unit/cache/memory.test.ts`: delete node, edge, reverse-edge, graph-stat, and transaction cases; retain
  source, API, dependency-contract, function-group, clear, and retained-stat coverage.
- `tests/unit/cache/sqlite.test.ts`: delete the equivalent obsolete cases and add the old-database retirement
  migration test.
- `tests/unit/cache/caching-layer.test.ts`: delete warmup state/activity and cached-usages cases; retain normal
  source, draft, activation, dependency-contract, inventory, and activity coverage.

### Phase 4 — Remove presentation and documentation surface

Runtime/UI:

- `src/handlers/manage.ts`: remove `warmupAvailable` from `cache_stats`;
- `src/server/ui.ts`: remove warmup configuration and availability;
- `src/server/ui-state.ts`: remove warmup fields;
- `public/ui/app.js`: remove node/edge cards;
- `tests/e2e/cache.e2e.test.ts`: remove warmup-state assertions and replace the expected warmup error with a
  successful bounded live-usages smoke test;
- `tests/unit/server/ui.test.ts`: assert only retained cache and UI-state fields;
- `tests/evals/scenarios/context-impact.ts`: remove the pre-warmed-cache assumption from the usages scenario;
- all seven `tests/fixtures/tool-definitions/*.json` snapshots: update usages and cache-stat descriptions without
  changing the usages action enum.

Current documentation:

- `README.md`
- `AGENTS.md`
- `docs/dev-guide.md`
- `docs/caching.md`
- `docs_page/caching.md`
- `docs_page/architecture.md`
- `docs_page/index.md`
- `docs_page/roadmap.md`
- `docs_page/btp-cloud-foundry-deployment.md`
- `docs_page/btp-destination-setup.md`
- `docs_page/configuration-reference.md`
- `docs_page/tools.md`
- `docs_page/updating.md`
- `docs/integration-test-skips.md`
- `docs/plans/2026-06-22-ralphex-ui-v1-readonly-console.md` because it is a current plan, not a completed
  historical record
- `skills/analyze-chat-session/SKILL.md` if its live guidance still mentions warmup

Rewrite the caching guide around two modes: request-driven memory cache and optional SQLite persistence. Remove
timing estimates, delta claims, warmup deployment examples, and reverse-edge descriptions.

Do not edit historical records solely to erase the term:

- `CHANGELOG.md`
- `docs/security-review-2026-06.md`
- risk R12 history in `docs/security-model.md`
- dated research reports and completed plans

In `docs/security-model.md`, remove warmup from the current cache architecture and review checklist, and record
that live usages is now per-user authorized. Retain R12 as historical evidence, marked as superseded by removal.
Generic mentions of SAP/HTTP cold-cache warming or JWKS pre-warming are unrelated and must not be mechanically
deleted.

### Phase 5 — Test and release verification

Focused tests:

```bash
npx vitest run tests/unit/cache tests/unit/handlers/manage-context.test.ts tests/unit/handlers/search-navigate.test.ts
npx vitest run tests/unit/server/config.test.ts tests/unit/server/ui.test.ts
```

Repository gates:

```bash
npm test
npm run typecheck
npm run lint
npm run validate:policy
npm run build
npm run check:sizes
```

Live verification against the available ABAP systems:

- explicit-type usages for a class with known callers;
- name-only resolution for a unique object;
- ambiguous same-name lookup if a fixture can be created safely;
- no-result lookup;
- principal-propagation lookup on BTP/Cloud Connector;
- old-release fallback on the NW 7.50 system if available;
- ARC-1 startup time/log inspection confirms no TADIR query or source crawl;
- existing source-cache integration test confirms first fetch, ETag revalidation, and `304` behavior.

Update frozen tool-definition snapshots only after reviewing the textual diff. The action enum should not change.

Run a final static audit over non-historical files. It must find no warmup-owned identifiers or graph APIs:

```bash
rg -n 'ARC1_CACHE_WARMUP|cache-warmup|cacheWarmup|runWarmup|WARMUP_|warmupAvailable|warmup_state|CacheNode|CacheEdge|getUsages|putNode|getNode|getNodesByPackage|invalidateNode|putEdge|getEdges(To|From)|nodeCount|edgeCount' \
  src tests public docs_page skills README.md AGENTS.md .env.example mta.yaml mta-overrides.mtaext.example
rg -n 'transaction<T>' src/cache tests/unit/cache
```

Review every match rather than blindly deleting it. Expected non-historical exceptions are limited to the four
retired-config tombstones, their migration tests, and the updating guide. The removal plan itself and
dated/completed historical records may describe the former implementation. Generic SAP cold-cache or JWKS
pre-warming is unrelated.

## Expected file inventory

### Delete

- `src/cache/warmup.ts`
- `tests/unit/cache/warmup.test.ts`
- `tests/integration/cache-warmup.slow.integration.test.ts`

### Major edits

- `src/handlers/context.ts`
- `src/handlers/navigate.ts`
- new internal `src/handlers/where-used.ts`
- `src/cache/cache.ts`
- `src/cache/caching-layer.ts`
- `src/cache/memory.ts`
- `src/cache/sqlite.ts`
- `src/server/server.ts`
- `src/server/config.ts`
- `src/server/types.ts`

### Mechanical edits

- handler, cache, config, UI, integration, E2E, evaluation, and snapshot tests identified above;
- current configuration examples, BTP deployment guides, architecture/roadmap pages, active plans, and skills
  identified above.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Live usages is slower than an in-process edge lookup | It is correct, current, and SAP-authorized; retain one action and let the separate future HANA design decide whether and how to optimize it. |
| Name-only calls become ambiguous | Resolve exact names and return bounded candidates; never guess a type. |
| Older SAP lacks scope-based where-used | Preserve the existing narrow fallback to references. |
| Operators keep old warmup flags | Fail startup with a direct migration message. |
| Existing SQLite has obsolete graph tables | Run an idempotent drop migration and test that retained records survive. |
| Tool response consumers expect node/edge stats | Document the response change; remove fields together in one release. |
| Refactor changes `SAPNavigate.references` | Characterize it first and route both callers through one tested helper. |
| Current dirty worktree overlaps implementation | Before coding, review user changes, especially `src/server/server.ts`; do not overwrite unrelated edits. |

## Commit sequence

Use reviewable commits in this order:

1. `refactor: share live where-used resolution`
2. `feat: serve SAPContext usages from live SAP lookup`
3. `refactor: remove cache warmup startup and config`
4. `refactor: retire warmup graph cache storage and transaction API`
5. `docs: remove cache warmup guidance`

The behavior change should be called out in release notes even if commit types are adjusted to the project's
release policy.

## Rollback

Rollback means reverting the removal release, not trying to reconstruct graph records. The SQLite migration
drops only rebuildable warmup tables. Retained source and contract tables remain compatible. If live usages has
a release-specific regression, temporarily direct callers to `SAPNavigate.references`; do not restore the
shared warmup graph under principal propagation.

## Acceptance criteria

- ARC-1 contains no runtime import, active configuration, startup log, UI field, or active feature documentation
  for cache warmup. Only the bounded retired-config migration tombstones and migration guide remain temporarily.
- ARC-1 contains no warmup-only graph types, methods, tables, indexes, stats, activity events, or transaction
  abstraction.
- Startup performs no TADIR enumeration or bulk source crawl.
- `SAPContext.usages` remains in the public action enum and works without cache configuration.
- `SAPContext.usages` works under principal propagation using the caller's SAP identity.
- `SAPNavigate.references` behavior is unchanged.
- Normal memory and SQLite source caching, ETag revalidation, inactive drafts, contracts, and function-group
  mapping pass their existing tests.
- Old warmup env vars and CLI flags fail with actionable migration guidance.
- Old SQLite databases open safely, retain normal cache data, and lose only obsolete graph tables.
- All repository gates pass and tool-definition snapshot changes contain descriptions only, not removal of the
  `usages` action.

## Future HANA index is explicitly deferred

This cleanup adds no HANA dependency or speculative integration seam. The future project must first prove its
storage model, indexing lifecycle, authorization behavior, cost, and API in a separate deployment. Only then
should ARC-1 integration be planned. It must remain optional, be capability/health checked, preserve live SAP as
the authorization-safe fallback, and never reintroduce a system crawl into the ARC-1 web process.

# ARCH-01 — Discovery-driven Endpoint Routing

## Overview

Replace the static SAP_BASIS release maps proposed in [PR #196](https://github.com/marianfoo/arc-1/pull/196) with a routing primitive that reads the truth from the SAP system's own `/sap/bc/adt/discovery` feed. The discovery feed already lists every collection the system publishes; the static release maps were a manually-maintained proxy for what the feed says directly.

This plan implements the foundation. A follow-up plan ([discovery-driven-routing-cleanup.md](#) — to be created after this lands) consumes the foundation by removing the release-version literals and the `isRelease750()` helper from PR #196 and rewriting tool-enum filtering.

This plan ships ARCH-01 only (the new helpers + the lazy load path + the test fixtures). The static maps from PR #196 do not touch this PR — they ship in PR-ε after this PR merges.

Context, decision, and consequences are recorded in [docs/adr/0001-discovery-driven-endpoint-routing.md](../adr/0001-discovery-driven-endpoint-routing.md). Live evidence captured 2026-04-28 against A4H 758 SP02 and NPL 750 SP02 confirms the discovery feed is the right authority: A4H lists `/sap/bc/adt/ddic/tables`, NPL doesn't; A4H lists `/ddic/domains`, NPL doesn't; A4H lists both `enhancements/enhoxh` + `enhoxhb`, NPL only `enhoxh` — a precision the SAP_BASIS release literal cannot express.

## Context

### Current State

- [src/adt/discovery.ts](../../src/adt/discovery.ts) `fetchDiscoveryDocument` is called once per startup probe in MCP-server mode (via `runStartupProbe` in [src/server/server.ts](../../src/server/server.ts)). Result is stored as a `DiscoveryMap` (path → accepted MIME types) and consumed by `resolveAcceptType` / `resolveContentType` in the HTTP layer.
- [src/adt/xml-parser.ts](../../src/adt/xml-parser.ts) `parseDiscoveryDocument` only retains collections that have `<app:accept>` elements (necessary for MIME negotiation). Collections without `<app:accept>` are dropped — but those still indicate an available endpoint. Live counts: A4H 671 total / 232 with-accept / 439 without; NPL 214 total / 32 with-accept / 182 without.
- The CLI `arc1-cli call …` path does **not** invoke `runStartupProbe`. Discovery is fetched lazily by the HTTP layer's first content-type-resolution call. This means routing decisions that depend on discovery must trigger the lazy load — they cannot rely on `cachedDiscovery` being populated synchronously.
- [src/handlers/intent.ts](../../src/handlers/intent.ts) `objectBasePath` (the per-type URL mapper) hard-codes one URL per type (e.g., `TABL → /sap/bc/adt/ddic/tables/`). When SAP doesn't publish that endpoint, requests 404 with a misleading "Object not found" hint.
- [src/handlers/tools.ts](../../src/handlers/tools.ts) `filterByRelease` (introduced by PR #196) prunes types from the SAPRead/SAPWrite enums based on `cachedFeatures.abapRelease`. `cachedFeatures` is populated lazily but does **not** reach the CLI fast path (live verified 2026-04-28: NPL TABL read via CLI hits `/ddic/tables` and 404s because `isRelease750()` returns false).
- Two probe fixtures in [tests/fixtures/probe/](../../tests/fixtures/probe/) (`npl-750-sp02-dev-edition` and `ecc-ehp8-nw750-sp31-onprem-prod`) capture real SAP responses. They become the regression set for this plan.

### Target State

- A new `discoveryHasCollection(uri: string): boolean` helper consults a per-client `discoveryAvailability` cache (set of normalized hrefs) populated from the discovery feed, including collections without `<app:accept>` elements.
- A new `resolveSourceUrl(type, name)` helper in [src/handlers/intent.ts](../../src/handlers/intent.ts) returns either `{ url: string }` for the first available candidate URL, or `{ unavailable: string }` with an actionable hint that does not name a SAP_BASIS release literal.
- A per-type candidate-URL list lives in one place — `RESOLVE_RULES` table in `intent.ts`, structured as `Map<type, OrderedCandidates>` where each candidate is a `{ collectionUri, urlBuilder, hintOnFallback? }`.
- `filterByDiscovery(items, typeToCollection, discoveryAvailability)` replaces (in PR-ε) `filterByRelease` for tool-enum filtering. This plan ships the new helper; the swap-out happens in PR-ε.
- A small augmentation to `parseDiscoveryDocument` returns both the existing accept-types map AND a new "all collections" set that includes accept-less collections.
- CLI mode populates the same discovery cache on first `AdtClient` construction (lazy, single-flight).
- Tests cover routing decisions against both probe fixtures (NPL 7.50, ECC EHP8) plus a synthesized A4H 758 fixture captured during this plan's verification.

### Key Files

| File | Role |
|------|------|
| `src/adt/discovery.ts` | Add `discoveryHasCollection` helper; expose collection-availability set; integrate lazy load on first AdtClient use |
| `src/adt/xml-parser.ts` | `parseDiscoveryDocument` returns both accept-types map and full collection set |
| `src/adt/types.ts` | `DiscoveryMap` augmented with `available: Set<string>` (or new sibling type `DiscoveryAvailability`) |
| `src/adt/http.ts` | `AdtHttpClient` lazy-loads discovery on first construction (single-flight via existing infra), exposes accessor |
| `src/handlers/intent.ts` | `resolveSourceUrl(type, name)` helper + `RESOLVE_RULES` table |
| `src/handlers/tools.ts` | New `filterByDiscovery(items, typeToCollection)` (consumed by PR-ε; ships unused but tested here) |
| `src/server/server.ts` | `runStartupProbe` populates the new availability set in addition to the existing MIME map |
| `tests/unit/adt/discovery.test.ts` | Unit tests for `discoveryHasCollection` |
| `tests/unit/adt/xml-parser.test.ts` | Tests for the augmented `parseDiscoveryDocument` (accept-less collections retained) |
| `tests/unit/handlers/intent.test.ts` | Tests for `resolveSourceUrl` against synthetic discovery maps |
| `tests/unit/handlers/tools.test.ts` | Tests for `filterByDiscovery` |
| `tests/fixtures/probe/a4h-758-sp02-onprem/` | New probe fixture from live A4H discovery (capture during plan implementation) |
| `tests/fixtures/probe/npl-750-sp02-dev-edition/responses/GET__sap_bc_adt_discovery.xml` | Confirm exists; if not, add for tests |
| `CLAUDE.md` | Architecture: Request Flow note for "discovery-driven URL resolution"; Key Files row for "Add SAP version-quirk workaround" updated to reference `resolveSourceUrl` instead of release literals |
| `docs_page/architecture.md` | New subsection: how discovery drives endpoint routing |

### Design Principles

1. **Discovery is the source of truth for endpoint availability.** The release literal is a proxy; the discovery feed is the authority. When SAP back-ports a collection to NW 7.50 SP15, ARC-1 picks it up automatically.
2. **Graceful degradation when discovery is unavailable.** `fetchDiscoveryDocument` already returns an empty map on failure. The new `discoveryHasCollection` returns `false` on an empty set, which routes to "use the canonical URL and surface SAP's response" — defensive default that doesn't worsen current behavior.
3. **Candidate-list per type, ordered.** When multiple URLs can serve the same type (e.g., `TABL → /ddic/tables` first, fallback `/ddic/structures` second), the order is deterministic and documented in `RESOLVE_RULES`. A4H prefers `/ddic/tables` (richer table metadata); NPL falls through to `/ddic/structures`.
4. **No SAP_BASIS version literals in routing code.** This plan introduces zero `release < 751` checks. The only place release literals remain is the lock-conflict heuristic (covered by ADR-0002) — entirely separate concern.
5. **Lazy load preserves CLI parity.** Single-flight discovery fetch on first AdtClient construction means CLI and MCP-server paths see the same routing decisions — the bug surfaced by live probe (NPL TABL via CLI 404s because `cachedFeatures` empty) goes away because routing keys off discovery, which loads on demand.
6. **Unused-helper smell tolerated for one PR.** `filterByDiscovery` ships in this plan but is consumed by PR-ε. Tests cover it; it sits dormant in `tools.ts` until PR-ε removes the static maps. This is preferable to a giant single PR that mixes foundation with cleanup.

## Development Approach

Implement in five passes:

1. Augment the discovery parser to retain accept-less collections (smallest unit; pure function refactor).
2. Add the availability accessor to `AdtHttpClient` and the `runStartupProbe` integration.
3. Implement `resolveSourceUrl` and the `RESOLVE_RULES` table.
4. Implement `filterByDiscovery` (used by PR-ε but tested here).
5. Tests, fixtures, and docs.

The capture of an A4H 758 fixture happens during Task 1 — copy `/tmp/probe/a4h-discovery.xml` from the live verification into `tests/fixtures/probe/a4h-758-sp02-onprem/responses/GET__sap_bc_adt_discovery.xml` so the same file drives unit tests.

## Validation Commands

- `npm test`
- `npm test -- tests/unit/adt/discovery.test.ts`
- `npm test -- tests/unit/adt/xml-parser.test.ts`
- `npm test -- tests/unit/handlers/intent.test.ts`
- `npm test -- tests/unit/handlers/tools.test.ts`
- `npm run typecheck`
- `npm run lint`

### Task 1: Augment `parseDiscoveryDocument` to retain accept-less collections

**Files:**
- Modify: `src/adt/xml-parser.ts`
- Modify: `src/adt/types.ts`
- Modify: `tests/unit/adt/xml-parser.test.ts`
- Add: `tests/fixtures/probe/a4h-758-sp02-onprem/responses/GET__sap_bc_adt_discovery.xml` (capture from live A4H system per Approach above)

The current parser drops collections without `<app:accept>` because they're useless for MIME negotiation. For routing-availability, every published collection matters.

- [ ] Add a new exported type in `src/adt/types.ts`:
    ```ts
    export interface DiscoveryParseResult {
      mimeMap: Map<string, string[]>;
      availableCollections: Set<string>;
    }
    ```
- [ ] Modify `parseDiscoveryDocument(xml: string): DiscoveryParseResult` to return both:
    - The existing `mimeMap` (path → accept types, only entries with `<app:accept>` retained — preserves current MIME negotiation contract).
    - A new `availableCollections` Set containing every collection's normalized href, regardless of whether it has accept types.
- [ ] Update all callers of `parseDiscoveryDocument` to consume the new shape. There is exactly one external caller (`fetchDiscoveryDocument` in `src/adt/discovery.ts`); update it.
- [ ] Capture the live A4H discovery XML to `tests/fixtures/probe/a4h-758-sp02-onprem/responses/GET__sap_bc_adt_discovery.xml`. Use the file already saved at `/tmp/probe/a4h-discovery.xml` from prior probing, or re-run: `curl -su MARIAN:$SAP_PASSWORD "http://a4h.marianzeis.de:50000/sap/bc/adt/discovery?sap-client=001" -H "Accept: application/atomsvc+xml" > tests/fixtures/probe/a4h-758-sp02-onprem/responses/GET__sap_bc_adt_discovery.xml`. Add a sibling `meta.json` with `{"systemId": "A4H", "release": "758", "spLevel": "0002"}` for documentation.
- [ ] Add unit tests (~5 tests) in `tests/unit/adt/xml-parser.test.ts`:
    - **Test 1**: Parse the A4H fixture — `availableCollections.size > 600`, `mimeMap.size` matches the existing assertion (regression check).
    - **Test 2**: Parse the NPL fixture (use existing `tests/fixtures/probe/npl-750-sp02-dev-edition/...` if discovery XML is captured; otherwise add it now) — `availableCollections.size > 200`.
    - **Test 3**: A4H fixture contains `/sap/bc/adt/ddic/tables` AND `/sap/bc/adt/ddic/structures` AND `/sap/bc/adt/ddic/domains` AND `/sap/bc/adt/ddic/ddlx/sources` AND `/sap/bc/adt/bo/behaviordefinitions` AND `/sap/bc/adt/businessservices/bindings` in `availableCollections`.
    - **Test 4**: NPL fixture contains `/sap/bc/adt/ddic/structures` but NOT `/sap/bc/adt/ddic/tables`, NOT `/sap/bc/adt/ddic/domains`, NOT `/sap/bc/adt/ddic/ddlx/sources`, NOT `/sap/bc/adt/bo/behaviordefinitions`.
    - **Test 5**: Empty XML → `{ mimeMap: empty, availableCollections: empty }` (graceful).
- [ ] Run `npm test -- tests/unit/adt/xml-parser.test.ts` — all tests must pass.

### Task 2: Expose discovery availability via `discoveryHasCollection`

**Files:**
- Modify: `src/adt/discovery.ts`
- Modify: `src/adt/http.ts`
- Modify: `tests/unit/adt/discovery.test.ts`

A single helper that callers can ask "is this collection published?". Lazy-load semantics already exist for the MIME map; reuse the same cache lifecycle.

- [ ] In `src/adt/discovery.ts`, change `fetchDiscoveryDocument(client)` to return `Promise<DiscoveryParseResult>` (same shape as the new parser). Update all internal callers and the `runStartupProbe` integration in `src/server/server.ts`.
- [ ] Add `export function discoveryHasCollection(availability: Set<string>, uri: string): boolean`:
    - Normalizes `uri` (strip trailing slash, ensure leading slash).
    - Returns `availability.has(normalized)`.
    - Returns `false` when `availability` is empty (graceful degradation).
- [ ] In `AdtHttpClient` (in `src/adt/http.ts`), expose the discovery availability as `getDiscoveryAvailability(): Promise<Set<string>>` — single-flight: if cached, return immediately; if not, kick off `fetchDiscoveryDocument` and cache the result.
- [ ] Add unit tests (~4 tests) in `tests/unit/adt/discovery.test.ts`:
    - **Test 1**: `discoveryHasCollection(set, '/sap/bc/adt/ddic/tables')` returns `true` when the set contains the path.
    - **Test 2**: Trailing-slash variant: `discoveryHasCollection(set, '/sap/bc/adt/ddic/tables/')` returns `true` when the set contains either form.
    - **Test 3**: Empty set → returns `false` for any input.
    - **Test 4**: Path not in set → returns `false`.
- [ ] Run `npm test -- tests/unit/adt/discovery.test.ts` — all tests must pass.

### Task 3: Implement `resolveSourceUrl` with `RESOLVE_RULES`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

The per-type candidate-URL table is the consumer of `discoveryHasCollection`. This is the function PR-ε will call instead of `objectBasePath` for the affected types.

- [ ] Add a `RESOLVE_RULES` table in `src/handlers/intent.ts` near `objectBasePath`. Each entry maps a type to an ordered list of candidates. Initial entries (informed by the live probe data captured in [docs/adr/0001-discovery-driven-endpoint-routing.md](../adr/0001-discovery-driven-endpoint-routing.md)):
    ```ts
    type Candidate = {
      collectionUri: string;
      buildUrl: (name: string) => string;
    };
    const RESOLVE_RULES: Record<string, { candidates: Candidate[]; unavailableHint: string }> = {
      TABL: {
        candidates: [
          { collectionUri: '/sap/bc/adt/ddic/tables', buildUrl: (n) => `/sap/bc/adt/ddic/tables/${encodeURIComponent(n)}` },
          { collectionUri: '/sap/bc/adt/ddic/structures', buildUrl: (n) => `/sap/bc/adt/ddic/structures/${encodeURIComponent(n)}` },
        ],
        unavailableHint: 'Neither /ddic/tables nor /ddic/structures is published by this SAP system. Use SE11 in SAP GUI.',
      },
      STRU: {
        candidates: [
          { collectionUri: '/sap/bc/adt/ddic/structures', buildUrl: (n) => `/sap/bc/adt/ddic/structures/${encodeURIComponent(n)}` },
        ],
        unavailableHint: '/ddic/structures is not published by this SAP system. Use SE11 in SAP GUI.',
      },
      DOMA: {
        candidates: [
          { collectionUri: '/sap/bc/adt/ddic/domains', buildUrl: (n) => `/sap/bc/adt/ddic/domains/${encodeURIComponent(n)}` },
        ],
        unavailableHint: '/ddic/domains is not published by this SAP system. Use SE11 in SAP GUI, or query DD01L via SAPQuery.',
      },
      DDLX: {
        candidates: [
          { collectionUri: '/sap/bc/adt/ddic/ddlx/sources', buildUrl: (n) => `/sap/bc/adt/ddic/ddlx/sources/${encodeURIComponent(n)}` },
        ],
        unavailableHint: 'CDS metadata extensions (DDLX) are not published by this SAP system.',
      },
      BDEF: {
        candidates: [
          { collectionUri: '/sap/bc/adt/bo/behaviordefinitions', buildUrl: (n) => `/sap/bc/adt/bo/behaviordefinitions/${encodeURIComponent(n)}` },
        ],
        unavailableHint: 'Behavior definitions (BDEF) are not published by this SAP system.',
      },
      SRVD: {
        candidates: [
          { collectionUri: '/sap/bc/adt/ddic/srvd/sources', buildUrl: (n) => `/sap/bc/adt/ddic/srvd/sources/${encodeURIComponent(n)}` },
        ],
        unavailableHint: 'Service definitions (SRVD) are not published by this SAP system.',
      },
      SRVB: {
        candidates: [
          { collectionUri: '/sap/bc/adt/businessservices/bindings', buildUrl: (n) => `/sap/bc/adt/businessservices/bindings/${encodeURIComponent(n)}` },
        ],
        unavailableHint: 'Service bindings (SRVB) are not published by this SAP system.',
      },
      SKTD: {
        candidates: [
          { collectionUri: '/sap/bc/adt/documentation/ktd/documents', buildUrl: (n) => `/sap/bc/adt/documentation/ktd/documents/${encodeURIComponent(n.toLowerCase())}` },
        ],
        unavailableHint: 'Knowledge Transfer Documents (SKTD) are not published by this SAP system.',
      },
      AUTH: {
        candidates: [
          { collectionUri: '/sap/bc/adt/ddic/authorityfields', buildUrl: (n) => `/sap/bc/adt/ddic/authorityfields/${encodeURIComponent(n)}` },
        ],
        unavailableHint: 'Authorization fields (AUTH) are not published by this SAP system. Use SU20/SU21 in SAP GUI.',
      },
      FTG2: {
        candidates: [
          { collectionUri: '/sap/bc/adt/ddic/featuretoggles', buildUrl: (n) => `/sap/bc/adt/ddic/featuretoggles/${encodeURIComponent(n)}` },
        ],
        unavailableHint: 'Feature toggles (FTG2) are not published by this SAP system. Use SFW5 in SAP GUI.',
      },
      ENHO: {
        candidates: [
          { collectionUri: '/sap/bc/adt/enhancements/enhoxhb', buildUrl: (n) => `/sap/bc/adt/enhancements/enhoxhb/${encodeURIComponent(n)}` },
          { collectionUri: '/sap/bc/adt/enhancements/enhoxh', buildUrl: (n) => `/sap/bc/adt/enhancements/enhoxh/${encodeURIComponent(n)}` },
        ],
        unavailableHint: 'Enhancement implementations (ENHO) are not published by this SAP system. Use SE18/SE19 in SAP GUI.',
      },
    };
    ```
    (Note the SKTD `toLowerCase` quirk — copies behavior from the existing `objectUrlForType` special case.)
- [ ] Add `export async function resolveObjectUrl(client: AdtClient, type: string, name: string): Promise<{ url: string } | { unavailable: string }>`:
    ```ts
    const rule = RESOLVE_RULES[type];
    if (!rule) return { url: objectUrlForType(type, name) }; // fallback to legacy mapper for types not in the table
    const availability = await client.http.getDiscoveryAvailability();
    for (const c of rule.candidates) {
      if (discoveryHasCollection(availability, c.collectionUri)) return { url: c.buildUrl(name) };
    }
    return { unavailable: rule.unavailableHint };
    ```
- [ ] Add `export async function resolveSourceUrl(client: AdtClient, type: string, name: string): Promise<{ url: string } | { unavailable: string }>` — same as `resolveObjectUrl` but appends `/source/main` to the URL when an object URL is resolved.
- [ ] Add unit tests (~6 tests) in `tests/unit/handlers/intent.test.ts`:
    - **Test 1**: A4H availability set → `resolveObjectUrl(client, 'TABL', 'T000')` returns `{ url: '/sap/bc/adt/ddic/tables/T000' }`.
    - **Test 2**: NPL availability set → `resolveObjectUrl(client, 'TABL', 'T000')` falls through to `{ url: '/sap/bc/adt/ddic/structures/T000' }`.
    - **Test 3**: NPL availability set → `resolveObjectUrl(client, 'DOMA', 'ABAP_BOOL')` returns `{ unavailable: '...not published by this SAP system. Use SE11...' }`.
    - **Test 4**: A4H availability set → `resolveObjectUrl(client, 'ENHO', 'ZE_FOO')` prefers `/enhoxhb`.
    - **Test 5**: NPL availability set → `resolveObjectUrl(client, 'ENHO', 'ZE_FOO')` falls through to `/enhoxh`.
    - **Test 6**: Empty discovery set → falls through to `unavailable` hints (graceful).
- [ ] Run `npm test -- tests/unit/handlers/intent.test.ts` — all tests must pass.

### Task 4: Implement `filterByDiscovery` (used by PR-ε)

**Files:**
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

The companion to `resolveSourceUrl` for tool-enum filtering. Ships unused in this PR but tested; PR-ε swaps `filterByRelease` → `filterByDiscovery` at the call sites.

- [ ] Add `export function filterByDiscovery<T extends string>(items: readonly T[], typeToCollection: Record<string, string>, availability: Set<string>): T[]`:
    - For each item: if it's not in `typeToCollection`, keep it (no gating). Otherwise keep iff `availability.has(typeToCollection[item])`.
    - When `availability` is empty (discovery failed/unloaded), keep all items (defensive — same shape as `filterByRelease` for `release === 0`).
- [ ] Add a `TYPE_TO_COLLECTION` table near `RESOLVE_RULES` (or import from `intent.ts`), keyed by the same types. The simplest copy is the first-candidate `collectionUri` from each `RESOLVE_RULES` entry.
- [ ] Add unit tests (~4 tests) in `tests/unit/handlers/tools.test.ts`:
    - **Test 1**: `filterByDiscovery(['TABL', 'STRU', 'DOMA'], {...}, npl-availability)` returns `['TABL', 'STRU']` (DOMA filtered out because NPL doesn't publish `/ddic/domains` — but TABL is kept because the type-to-collection table maps TABL to `/ddic/structures` for the routing purpose ... NOTE: we may want the gating-collection to be the *required* one, distinct from the routing first-choice. Decide during implementation: gating uses *any* candidate present, not just the first).
    - **Test 2**: Empty availability set → all items returned.
    - **Test 3**: Items not in `typeToCollection` → kept (e.g., `'CLAS'` is not gated).
    - **Test 4**: Items where the gating collection is present → kept.
- [ ] Run `npm test -- tests/unit/handlers/tools.test.ts` — all tests must pass.

### Task 5: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs_page/architecture.md`

Make the new primitive discoverable for future contributors and explain the architectural shift.

- [ ] In `CLAUDE.md` "Architecture: Request Flow" diagram, add a line under HTTP Request: *"Discovery-driven URL routing for selected types — see `RESOLVE_RULES` in `src/handlers/intent.ts`"*.
- [ ] In the same `CLAUDE.md` Key Files table, replace the row for "Add SAP version-quirk workaround (NW 7.50 / S/4 gating)" with: *"Don't gate by SAP_BASIS release literal. Add an entry to `RESOLVE_RULES` in `src/handlers/intent.ts` listing ordered candidate collection URIs; `resolveObjectUrl` checks the discovery feed for availability. See [docs/adr/0001-discovery-driven-endpoint-routing.md](docs/adr/0001-discovery-driven-endpoint-routing.md)."*
- [ ] In `docs_page/architecture.md`, add a subsection "Discovery-driven endpoint routing" (~200 words) describing the candidate-list pattern, the `discoveryHasCollection` primitive, and the graceful-degradation contract when discovery is unavailable.
- [ ] Run `npm run lint` — no new lint errors.

### Task 6: Final verification

- [ ] Run `npm test` — all unit tests pass (target: ~5 parser tests, ~4 discovery helper tests, ~6 resolve helper tests, ~4 filter tests = ~19 new tests).
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] When `TEST_SAP_URL` is configured for both A4H and NPL: run an integration test that exercises `resolveObjectUrl(client, 'TABL', 'T000')` against both and asserts A4H returns `/ddic/tables/...` while NPL returns `/ddic/structures/...`. (Add as `tests/integration/discovery-routing.integration.test.ts` if it doesn't exist.)
- [ ] Move this plan to `docs/plans/completed/`.
- [ ] Schedule PR-ε (the cleanup that consumes this foundation) — see `docs/todo.md` "ARCH-01 follow-ups".

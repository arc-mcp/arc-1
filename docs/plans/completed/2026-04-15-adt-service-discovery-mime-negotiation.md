# FEAT-38: ADT Service Discovery (MIME Negotiation)

## Overview

Implement proactive ADT service discovery by fetching and parsing `GET /sap/bc/adt/discovery` at startup. This Atom Publishing Protocol (AtomPub) service document (~300 KB, ~500 collections across ~115 workspaces) declares which MIME types each ADT endpoint accepts. By caching this mapping once at startup, ARC-1 can send correct `Accept` and `Content-Type` headers from the first request, eliminating 415/406 content negotiation retries entirely.

sapcli has implemented this pattern since 2018 in `sap/adt/core.py` — it stores `Map<endpointPath, string[]>` of accepted MIME types and looks them up before every request. ARC-1 currently uses reactive retry logic (FEAT-08, already completed) as a fallback. FEAT-38 is the proactive complement: probe once, get it right for all subsequent requests.

Key design decisions:
1. **Fetch during startup probe** — run alongside existing `probeFeatures()` in `src/adt/features.ts`
2. **Store on AdtHttpClient** — the HTTP layer owns header selection, not the caller
3. **Graceful degradation** — if discovery fails (404, timeout), fall through to existing FEAT-08 retry logic
4. **Cache in SQLite** — reuse existing cache infrastructure for persistence across restarts

## Context

### Current State

- `src/adt/http.ts:397-476` has reactive 406/415 retry with `inferAcceptFromError()` — works but adds one round-trip per mismatch per session
- `src/adt/features.ts` runs 8+ probes at startup using `GET` against SAP endpoints — discovery would be a new parallel probe
- `parseSystemInfo()` in `src/adt/xml-parser.ts:265-294` already parses the Atom service document from `/sap/bc/adt/core/discovery` for `SAPRead SYSTEM` — but this endpoint returns an **empty** service document (no workspaces/collections)
- The **full** discovery document lives at `/sap/bc/adt/discovery` (no `core` segment) and returns ~300 KB of XML with 115 workspaces and ~500 collections
- Each `<app:collection href="/sap/bc/adt/...">` contains 0-N `<app:accept>` elements listing supported MIME types (e.g., `application/vnd.sap.adt.oo.classes.v4+xml`)
- **Critical**: Both discovery endpoints return 406 if `Accept: application/xml` is sent — must use `Accept: application/atomsvc+xml` or `Accept: */*`
- `src/server/server.ts:156-204` runs `runStartupProbe()` which calls `probeFeatures()` and stores results via `setCachedFeatures()`
- sapcli pattern: lazy-init `_collection_types: dict[str, list[str]]` on `Connection`, populated on first property access, cached for session lifetime

### Target State

- At startup, `GET /sap/bc/adt/discovery` is fetched and parsed into a `Map<string, string[]>` mapping endpoint paths to their accepted MIME types
- Before each HTTP request, `AdtHttpClient` looks up the endpoint path in the discovery map and uses the first matching MIME type as `Accept` header (if no explicit Accept was passed by the caller)
- For write requests, the Content-Type is similarly looked up from the discovery map
- If discovery is unavailable, behavior falls through to existing defaults + FEAT-08 retry
- Discovery results are cached in SQLite (if caching enabled) with a TTL matching cache warmup patterns
- Per-endpoint header caching from successful retries (the gap noted in `docs/compare/fr0ster/evaluations/b059736-adt-clients-415-negotiation.md`) is also implemented, providing a learning fallback

### Key Files

| File | Role |
|------|------|
| `src/adt/discovery.ts` | **New** — fetch, parse, and cache the ADT discovery document |
| `src/adt/http.ts` | Integrate discovery map into request method; apply MIME types before each request |
| `src/adt/features.ts` | Add discovery fetch to startup probe (parallel with existing probes) |
| `src/adt/types.ts` | Add `DiscoveryMap` type and extend `ResolvedFeatures` with discovery data |
| `src/adt/xml-parser.ts` | Add `parseDiscoveryDocument()` parser for the AtomPub service document |
| `src/server/server.ts` | Pass discovery results through startup probe to cached state |
| `src/handlers/intent.ts` | Access cached discovery data for logging/diagnostics |
| `tests/unit/adt/discovery.test.ts` | **New** — unit tests for discovery parsing and MIME resolution |
| `tests/unit/adt/http.test.ts` | Tests for discovery-aware header selection |
| `tests/fixtures/xml/discovery.xml` | **New** — XML fixture for ADT discovery response |

### Design Principles

1. **Proactive over reactive** — discover MIME types once at startup rather than retrying on every mismatch. FEAT-08 retry remains as defense-in-depth for endpoints not in the discovery map.
2. **Callers still override** — when `client.getProgram()` passes explicit `Accept: text/plain`, discovery doesn't interfere. Discovery only fills in defaults when no explicit header is set.
3. **Graceful degradation** — if `/sap/bc/adt/discovery` returns 404 (older systems), 403 (insufficient auth), or times out, the feature silently degrades. No startup failure.
4. **Path normalization** — discovery hrefs may be relative or absolute; normalize to `/sap/bc/adt/...` paths for consistent lookup.
5. **Prefer newest version** — when multiple MIME versions are listed (e.g., `v2+xml`, `v4+xml`), store them in order. Callers that don't specify a version get the list and can pick appropriately.
6. **Minimal coupling** — discovery is owned by the HTTP layer. Higher-level code (client.ts, intent.ts) doesn't need to know about MIME types.

## Development Approach

Bottom-up: parser first, then HTTP integration, then startup wiring, then tests, then docs. Each task is self-contained and can be verified independently.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: XML parser for ADT discovery document

**Files:**
- Create: `tests/fixtures/xml/discovery.xml`
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/unit/adt/discovery.test.ts` (parser tests only)

Add a `parseDiscoveryDocument()` function that parses the AtomPub XML from `/sap/bc/adt/discovery` into a `Map<string, string[]>` mapping endpoint paths to accepted MIME types.

The XML structure is an Atom Publishing Protocol service document:
```xml
<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">
  <app:workspace>
    <atom:title>Workspace Name</atom:title>
    <app:collection href="/sap/bc/adt/oo/classes">
      <atom:title>Classes</atom:title>
      <app:accept>application/vnd.sap.adt.oo.classes.v4+xml</app:accept>
      <app:accept>text/html</app:accept>
    </app:collection>
  </app:workspace>
</app:service>
```

- [ ] Create `tests/fixtures/xml/discovery.xml` with a representative subset of the real discovery response. Include at least: a workspace with multiple collections (e.g., `oo/classes`, `oo/interfaces`, `programs/programs`, `ddic/ddl/sources`, `ddic/domains`, `packages`, `cts/transportrequests`, `activation`, `abapunit/testruns`), each with realistic `<app:accept>` MIME types. Include edge cases: collection with no `<app:accept>` elements, collection with single accept, collection with multiple accepts (versioned: v1, v2, v4). Use real MIME types observed on SAP A4H 758 (e.g., `application/vnd.sap.adt.oo.classes.v4+xml`, `application/vnd.sap.adt.programs.programs.v2+xml`, `application/vnd.sap.adt.functions.groups.v3+xml`).
- [ ] Add `parseDiscoveryDocument(xml: string): Map<string, string[]>` to `src/adt/xml-parser.ts`. Use the existing shared `parser` instance (fast-xml-parser v5 with `removeNSPrefix: true`). After namespace stripping, the structure is: `service > workspace[] > collection[]`. For each collection, extract `@_href` (the endpoint path) and all `accept` text content values. Normalize `href` to start with `/sap/bc/adt/` (strip any leading `https://host:port` prefix if present). Add `'collection'` and `'accept'` to the `isArray` list in the parser config so they're always arrays even for single elements. Add `'workspace'` to the isArray list too. Return a `Map<string, string[]>` where keys are normalized paths and values are arrays of MIME type strings.
- [ ] Add unit tests (~10 tests) in `tests/unit/adt/discovery.test.ts`:
  - Parses full fixture into correct map size
  - Collection with multiple accepts returns all types in order
  - Collection with no accepts is omitted from map (or has empty array)
  - Collection with single accept returns single-element array
  - Handles `href` with absolute URL (strips host prefix)
  - Handles empty XML (returns empty map)
  - Handles malformed XML (returns empty map, no throw)
  - `workspace` and `collection` elements with missing attributes are skipped
  - Real MIME types are preserved exactly (no lowercasing, no trimming)
  - Duplicate hrefs: later collection overwrites earlier (or merges — pick one and document)
- [ ] Run `npm test` — all tests must pass

### Task 2: Discovery module — fetch, resolve, cache

**Files:**
- Create: `src/adt/discovery.ts`
- Modify: `src/adt/types.ts`
- Modify: `tests/unit/adt/discovery.test.ts` (add fetch/resolve tests)

Create a new `src/adt/discovery.ts` module that handles fetching the discovery document and resolving MIME types for request paths.

- [ ] Add types to `src/adt/types.ts`: add `discoveryMap?: Map<string, string[]>` to `ResolvedFeatures` interface. Also export a type alias `DiscoveryMap = Map<string, string[]>` for convenience.
- [ ] Create `src/adt/discovery.ts` with the following exports:
  - `fetchDiscoveryDocument(client: AdtHttpClient): Promise<Map<string, string[]>>` — calls `client.get('/sap/bc/adt/discovery', { Accept: 'application/atomsvc+xml' })`, parses with `parseDiscoveryDocument()`, returns the map. On any error (404, 406, timeout, parse failure), logs a warning via `logger` and returns an empty map. Must not throw — this is a startup probe.
  - `resolveAcceptType(discoveryMap: Map<string, string[]>, path: string): string | undefined` — given a request path like `/sap/bc/adt/oo/classes/ZCL_FOO/source/main`, finds the best matching collection. The discovery map contains collection-level paths (e.g., `/sap/bc/adt/oo/classes`), so the resolution must match the request path as a prefix. Walk through map keys, find the longest prefix match. Return the first (highest-priority) MIME type from the matched collection, or `undefined` if no match.
  - `resolveContentType(discoveryMap: Map<string, string[]>, path: string): string | undefined` — same logic as `resolveAcceptType()` but for Content-Type. In the discovery document, `<app:accept>` lists what the endpoint accepts for both read (Accept) and write (Content-Type). Return the first MIME type, or `undefined`.
- [ ] Add unit tests (~12 tests) to `tests/unit/adt/discovery.test.ts`:
  - `fetchDiscoveryDocument` success: mock fetch returns discovery XML fixture, verify map is populated correctly
  - `fetchDiscoveryDocument` 404: returns empty map, no throw
  - `fetchDiscoveryDocument` 406: returns empty map (graceful degradation)
  - `fetchDiscoveryDocument` network error: returns empty map
  - `resolveAcceptType` exact match: `/sap/bc/adt/oo/classes` matches collection `/sap/bc/adt/oo/classes`
  - `resolveAcceptType` prefix match: `/sap/bc/adt/oo/classes/ZCL_FOO/source/main` matches `/sap/bc/adt/oo/classes`
  - `resolveAcceptType` longest prefix: `/sap/bc/adt/oo/classes/ZCL_FOO` matches `/sap/bc/adt/oo/classes` not `/sap/bc/adt/oo`
  - `resolveAcceptType` no match: returns undefined
  - `resolveAcceptType` empty map: returns undefined
  - `resolveContentType` returns first type from matched collection
  - Multiple collections: each resolves independently
  - Path with query params: strips query before matching
- [ ] Run `npm test` — all tests must pass

### Task 3: Integrate discovery into AdtHttpClient

**Files:**
- Modify: `src/adt/http.ts`
- Modify: `tests/unit/adt/http.test.ts`

Wire the discovery map into the HTTP client so that request headers are automatically set based on discovered MIME types.

- [ ] Add a `discoveryMap` property to `AdtHttpClient` class in `src/adt/http.ts`: `private discoveryMap: Map<string, string[]> = new Map()`. Add a setter method: `setDiscoveryMap(map: Map<string, string[]>): void` to allow the startup probe to inject the discovery results.
- [ ] Add a `private negotiatedHeaders: Map<string, { accept?: string; contentType?: string }> = new Map()` for per-endpoint header caching from successful retries (the gap vs. fr0ster noted in `docs/compare/fr0ster/evaluations/b059736-adt-clients-415-negotiation.md`).
- [ ] In the `request()` method (line ~161), after building the default `Accept: '*/*'` header and before merging `extraHeaders`, add discovery-based header resolution:
  ```typescript
  // Discovery-based MIME resolution: use discovered type if no explicit Accept/Content-Type
  if (!extraHeaders?.Accept) {
    // Check per-endpoint cache first (from previous successful retries)
    const cached = this.negotiatedHeaders.get(path);
    if (cached?.accept) {
      headers.Accept = cached.accept;
    } else {
      const discovered = resolveAcceptType(this.discoveryMap, path);
      if (discovered) headers.Accept = discovered;
    }
  }
  if (contentType === undefined) {
    const cached = this.negotiatedHeaders.get(path);
    if (cached?.contentType) {
      headers['Content-Type'] = cached.contentType;
    }
  }
  ```
  Import `resolveAcceptType` from `./discovery.js`.
- [ ] In the 406/415 retry success path (around line ~460), after a successful retry with fallback headers, cache the winning headers:
  ```typescript
  // Cache successful negotiation for future requests to this endpoint
  this.negotiatedHeaders.set(path, {
    accept: fallbackHeaders.Accept !== headers.Accept ? fallbackHeaders.Accept : undefined,
    contentType: fallbackHeaders['Content-Type'] !== (contentType ?? headers['Content-Type']) ? fallbackHeaders['Content-Type'] : undefined,
  });
  ```
- [ ] In `withStatefulSession()` (line ~148), copy `discoveryMap` and `negotiatedHeaders` to the session client so stateful sessions also benefit from discovery.
- [ ] Add unit tests (~8 tests) to `tests/unit/adt/http.test.ts`:
  - Request with no explicit Accept uses discovered type
  - Request with explicit Accept header is NOT overridden by discovery
  - Request to unknown path falls through to default `*/*`
  - Empty discovery map: default behavior unchanged
  - After 406 retry succeeds, next request to same path uses cached header
  - After 415 retry succeeds, next request to same path uses cached Content-Type
  - Stateful session inherits discovery map
  - Discovery + explicit extraHeaders: explicit wins
- [ ] Run `npm test` — all tests must pass

### Task 4: Wire discovery into startup probe

**Files:**
- Modify: `src/adt/features.ts`
- Modify: `src/server/server.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/adt/features.test.ts`

Connect discovery fetching to the existing startup probe flow so it runs in parallel with feature detection.

- [ ] In `src/adt/features.ts`, modify `probeFeatures()` to also fetch the discovery document in parallel with existing probes. Import `fetchDiscoveryDocument` from `./discovery.js`. Add it to the `Promise.all()` at line ~94:
  ```typescript
  const [probeResults, systemDetection, textSearchResult, authProbeResult, discoveryResult] = await Promise.all([
    // ... existing probes ...
    fetchDiscoveryDocument(client),
  ]);
  ```
  Store the result on `resolved.discoveryMap = discoveryResult`.
- [ ] In `src/server/server.ts`, in `runStartupProbe()` (line ~156), after `setCachedFeatures(features)`, also set the discovery map on the shared client's HTTP instance. This requires passing the client reference or storing discovery separately. The cleanest approach: add `setCachedDiscovery(map: Map<string, string[]>)` to `intent.ts` (alongside `setCachedFeatures`), and in `server.ts` call it with `features.discoveryMap`. Then in `createServer()`, when creating per-request clients, inject the cached discovery map via `client.http.setDiscoveryMap(getCachedDiscovery())`.
- [ ] In `src/handlers/intent.ts`, add module-level storage for the discovery map:
  ```typescript
  let cachedDiscovery: Map<string, string[]> = new Map();
  export function setCachedDiscovery(map: Map<string, string[]>): void { cachedDiscovery = map; }
  export function getCachedDiscovery(): Map<string, string[]> { return cachedDiscovery; }
  ```
- [ ] In `src/server/server.ts`, in the tool call handler where the AdtClient is created for each request, inject the discovery map: `client.http.setDiscoveryMap(getCachedDiscovery())`. This ensures every request (including per-user PP clients) benefits from the shared discovery data.
- [ ] Add/update unit tests (~5 tests) in `tests/unit/adt/features.test.ts`:
  - `probeFeatures` calls `fetchDiscoveryDocument` and includes result in resolved features
  - Discovery failure doesn't block feature probing (other probes still succeed)
  - `discoveryMap` is populated on `ResolvedFeatures` when discovery succeeds
  - `discoveryMap` is empty (not undefined) when discovery fails
- [ ] Run `npm test` — all tests must pass

### Task 5: Integration and E2E testing

**Files:**
- Modify: `tests/integration/adt.integration.test.ts` (if integration tests exist for this area)
- Modify: `tests/e2e/smoke.e2e.test.ts` (verify discovery doesn't break existing smoke tests)

Verify the feature works end-to-end on a real SAP system.

- [ ] Add an integration test in `tests/integration/adt.integration.test.ts` that calls `fetchDiscoveryDocument()` against the live test system and verifies: (a) the map is non-empty, (b) key endpoints like `/sap/bc/adt/oo/classes` and `/sap/bc/adt/programs/programs` are present, (c) MIME types follow the expected `application/vnd.sap.adt.*` pattern. Use `requireOrSkip()` for credentials check.
- [ ] Add an integration test that verifies `resolveAcceptType()` returns sensible types for known endpoints (classes, programs, DDL sources, transports).
- [ ] Verify existing E2E smoke tests still pass — discovery should be transparent. Run `npm run test:e2e` against a running MCP server with the new code. All existing SAPRead operations (PROG, CLAS, TABL, STRU, DOMA, DTEL, SYSTEM) should work identically.
- [ ] If any E2E test fails due to MIME type changes (unlikely but possible), investigate whether the discovered type is correct and the previous hardcoded type was wrong, or vice versa. Fix accordingly.
- [ ] Run `npm test` — all unit tests must pass

### Task 6: Documentation and roadmap updates

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `docs/tools.md` (if it mentions content negotiation or MIME handling)
- Modify: `docs/architecture.md` (if it describes the request flow)

Update all project documentation to reflect the new discovery feature.

- [ ] In `docs/roadmap.md`:
  - Strike through FEAT-38 in the priority table (line ~81): `| ~~38~~ | ~~FEAT-38~~ | ~~ADT Service Discovery (MIME Negotiation)~~ | ~~P0~~ | ~~S~~ | ~~Completed YYYY-MM-DD~~ |`
  - Update the Phase A.5 section (line ~166) to mark as completed
  - Add entry to the Completed Features section with today's date
  - Update the FEAT-38 detail section (line ~994) status to "Completed"
- [ ] In `docs/compare/00-feature-matrix.md`:
  - Find the FEAT-38 / discovery row and mark ARC-1 as having this capability (change from open to completed)
  - Update "Last Updated" date
- [ ] In `CLAUDE.md`:
  - Add `src/adt/discovery.ts` to the codebase structure tree under `src/adt/`
  - Add a row to the "Key Files for Common Tasks" table: `| Modify ADT service discovery / MIME types | src/adt/discovery.ts, src/adt/http.ts |`
  - Update the "Architecture: Request Flow" section to mention discovery-based header selection
- [ ] Check `docs/architecture.md` and `docs/tools.md` — if they describe content negotiation or the 415/406 retry, add a note about proactive discovery
- [ ] Run `npm run lint` — no errors

### Task 7: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify discovery module loads correctly: check that `import { fetchDiscoveryDocument, resolveAcceptType } from './discovery.js'` works without circular dependency issues
- [ ] Review that the 406/415 retry logic in `http.ts` still works as fallback when discovery map is empty (regression check)
- [ ] Move this plan to `docs/plans/completed/`

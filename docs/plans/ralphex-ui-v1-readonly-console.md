# Ralphex Plan: ARC-1 Read-Only Local UI Console v1

## Overview

This plan defines v1 of an ARC-1 browser UI focused on read-only local/operator visibility. The goal is
not to build an IDE, SAP object editor, or write-capable admin console. The goal is to make the local,
Docker, and BTP Cloud Foundry scenarios easier to understand by exposing the server state ARC-1 already
has: effective configuration, safety gates, auth/deployment mode, feature status, cache health, cache
inventory, and recent logs/audit events.

The UI should behave like a console for "what is ARC-1 doing and what does it know locally?" It must not
weaken ARC-1's safety ceiling, per-user authorization, stdout discipline, or cache-isolation model. All
UI data APIs are read-only, bounded, redacted, and covered by HTTP bearer auth with `admin` scope whenever
the server is network-reachable and auth is configured.

## Context

### Current State

ARC-1 has no browser UI today.

The relevant runtime pieces already exist:

- HTTP streamable mode runs an Express app in `src/server/http.ts` with `/health`, OAuth/XSUAA endpoints,
  and `/mcp`.
- Docker defaults to HTTP streamable on `0.0.0.0:8080`; local npm/Claude stdio mode does not open an HTTP
  listener.
- BTP Cloud Foundry deployments already use the HTTP app, `/health`, XSUAA OAuth, BTP Destination Service,
  and `ARC1_PUBLIC_URL` for advertised OAuth metadata.
- The cache layer exposes aggregate stats through `SAPManage(action="cache_stats")`, but not an inventory
  or browser-readable inspection API.
- `SqliteCache` stores full ABAP source in cleartext when SQLite is active. The security model already
  calls this out as an IP-confidentiality risk.
- `logger.emitAudit()` writes typed audit events to sinks, but there is no in-memory ring buffer for a UI.
  File/BTP audit sinks currently receive raw event JSON and may include SAP source/error snippets.
- Config source tracking exists in `resolveConfig()`/`ConfigSource`, but no UI-safe config projection exists.

Important constraints from the existing architecture:

- stdout is reserved for MCP JSON-RPC in stdio mode; UI startup messages must go to stderr or tool results.
- The safety ceiling is server-wide and only restricts; the UI must not introduce runtime config mutation in
  v1.
- Under principal propagation, cache and inactive-object views must not leak one user's SAP-authorized data
  to another user.
- Any browser path must respect existing Helmet/CORS choices. Same-origin `/ui` avoids CORS for v1.

### Target State

ARC-1 has an opt-in read-only UI console:

- Local stdio: `arc1 --ui` starts MCP over stdio plus a loopback-only UI listener, for example
  `http://127.0.0.1:8711/ui`.
- Local/VM/Docker HTTP: `ARC1_UI=true` serves `/ui` and `/ui/api/*` from the existing HTTP server.
- BTP Cloud Foundry: the supported browser path uses SAP AppRouter as the web entrypoint. AppRouter handles
  the browser login/session and forwards the JWT to ARC-1's read-only `/ui/api/*` endpoints. Same-app `/ui`
  can remain available for local/Docker and token-bearing technical clients, but it is not the primary BTP
  browser-auth story.
- The UI is read-only in v1. It displays status, config, logs, cache info, and cache inventory.
- Cache source preview is omitted from v1. The v1 cache view shows metadata only: type, name, version, hash
  prefix, ETag presence, cachedAt, package when known, and source length.
- All UI API responses are bounded and redacted. No passwords, tokens, cookies, service keys, raw request
  headers, raw response bodies, or full ABAP sources are returned by default.

### V1 Product Scope

The first version should include these read-only views:

1. **Overview**
   - Version, uptime, PID, transport, bind address/public URL, system type setting, detected SAP release
     if known, cache backend, and deployment hint (`local-stdio`, `local-http`, `docker`, `btp-cf`).

2. **Safety & Authorization**
   - Effective safety ceiling: writes, data preview, free SQL, transport writes, Git writes, plugin execute,
     plugin raw writes, allowed packages, allowed transports, deny actions, tool mode, rate-limit settings.
   - MCP auth mode summary: none/API keys/OIDC/XSUAA, PP enabled/strict, destination names present or not.
   - Secret-bearing values are represented as booleans or redacted markers only.

3. **Configuration**
   - Sanitized effective config grouped by category, with source metadata (`default`, `env`, `flag`, `file`)
     where available.
   - No raw secret values. For path values such as cache/log file, display exact paths only when local; for
     BTP, display basename or redacted path if needed.

4. **Features**
   - Cached `SAPManage(action="features")` result when available.
   - A clear "not probed yet" state with a read-only explanation. Do not auto-probe from page load in v1.

5. **Cache**
   - Existing aggregate cache stats plus backend/mode/file path when safe to show.
   - Cache inventory with pagination and filters: object type, name prefix/search, active/inactive version,
     package where known, cachedAt range.
   - Node/edge summary counts and warmup availability.
   - Inactive-list cache stats only as aggregate counts by user bucket, never object lists across users.

6. **Logs / Audit**
   - Recent in-process log/audit ring buffer with level/event filters and requestId search.
   - Events are UI-sanitized before storage/display, not sanitized only at render time.
   - Raw `requestBody`, `responseBody`, `errorBody`, and `resultPreview` are omitted or truncated further in
     the UI buffer by default.

7. **Help / Docs Links**
   - Short links to local documentation pages or docs site sections for configuration, deployment, cache,
     security, and troubleshooting.

### Explicitly Out of Scope for v1

- Editing ARC-1 configuration from the browser.
- Mutating SAP objects, transports, Git repositories, packages, FLP content, or cache contents.
- Triggering cache warmup or feature probes from the UI.
- Full ABAP source browsing or source preview.
- A multi-system landscape dashboard.
- A custom auth/login system separate from ARC-1's existing HTTP auth model.
- A custom SPA OAuth implementation in ARC-1. For BTP browser sessions, use AppRouter instead of adding a
  second login stack inside ARC-1.

### Key Files

| File | Role |
|------|------|
| `src/server/types.ts` | Add UI config flags and defaults (`ARC1_UI`, bind/port/open behavior). |
| `src/server/config.ts` | Parse UI flags/env vars and track config sources for UI-safe display. |
| `src/server/http.ts` | Mount `/ui` static assets and `/ui/api/*`; wire auth consistently with `/mcp` in HTTP mode. |
| `src/server/server.ts` | Thread startup state, config sources, cache layer, feature state, and UI config into HTTP/UI setup. |
| `src/server/ui.ts` | New UI route module: static serving, read-only API handlers, response bounds, redaction helpers. |
| `src/server/ui-state.ts` | New shared runtime state projection for uptime, server metadata, sanitized config, and deployment mode. |
| `src/server/ui-log-buffer.ts` | New in-memory ring buffer sink for recent sanitized logs/audit events. |
| `src/server/logger.ts` | Register optional UI log sink without changing stderr/file/BTP sink semantics. |
| `src/server/audit.ts` | Add no new event types unless UI access itself needs audit events. Reuse existing typed events where possible. |
| `src/cache/cache.ts` | Add cache inspection methods or a separate read-only inspector interface. |
| `src/cache/memory.ts` | Implement bounded cache inventory reads for memory cache. |
| `src/cache/sqlite.ts` | Implement bounded cache inventory reads with SQL parameters and indexes where needed. |
| `src/cache/caching-layer.ts` | Expose read-only inspection helpers without bypassing cache-security constraints. |
| `src/handlers/manage.ts` | Keep `cache_stats` behavior aligned with UI aggregate cache API. |
| `src/index.ts`, `src/cli-args.ts` | Add CLI flags such as `--ui`, `--ui-port`, `--ui-open` if the parser owns these flags. |
| `public/ui/` or `src/server/ui-assets/` | New bundled static UI assets, built/copied into `dist`. |
| `app-router/` or `ui-approuter/` | Optional BTP AppRouter module for browser login/session and proxying to ARC-1. |
| `xs-app.json` | AppRouter route config if BTP browser UI ships in v1. |
| `package.json` | Add build/copy step for UI assets only if assets live outside TypeScript output. |
| `Dockerfile` | Expose no new port for HTTP mode; document same-port `/ui`. |
| `mta.yaml`, `mta-overrides.mtaext.example` | Add optional `ARC1_UI` setting for BTP CF deployments. |
| `docs_page/local-development.md` | Document local stdio `--ui` and Claude configuration. |
| `docs_page/docker.md` | Document same-origin `/ui` for Docker, bind and volume guidance. |
| `docs_page/btp-cloud-foundry-deployment.md` | Document BTP `/ui` behind XSUAA and `ARC1_PUBLIC_URL` interaction. |
| `docs_page/security-guide.md` | Document UI exposure, source-cache sensitivity, log redaction, and auth requirements. |
| `tests/unit/server/*` | HTTP route, config parsing, auth, redaction, UI state, and log-buffer coverage. |
| `tests/unit/cache/*` | Cache inventory methods for memory and SQLite. |

### Design Principles

1. Read-only by construction: UI routes use GET-only APIs in v1; no POST/PUT/DELETE handlers except static
   asset delivery mechanics.
2. Stronger auth boundary for HTTP UI APIs: if a deployment protects `/mcp`, `/ui/api/*` is protected too
   and requires an `admin`-scoped bearer token.
3. Local-first without public exposure: stdio UI binds to `127.0.0.1` by default; Docker docs prefer
   `-p 127.0.0.1:8080:8080` for local use.
4. Metadata before content: cache inventory is useful without returning full ABAP source.
5. Redact before buffering: UI log storage must not retain secrets or high-volume source bodies and rely on
   frontend masking later.
6. Bound every listing: pagination, filter caps, max payload sizes, and no unbounded cache/log dumps.
7. Preserve stdout discipline: UI URLs and startup notes go to stderr, structured logs, or an MCP tool
   response, never stdout.
8. Avoid CORS by default: serve UI and API same-origin under the ARC-1 server. Only use `ARC1_ALLOWED_ORIGINS`
   for a future separately hosted UI.
9. Keep browser auth explicit: MCP bearer auth protects APIs, but it is not a browser session. Local/Docker may
   use loopback/no-auth or manual bearer entry; BTP browser usage should use AppRouter.

## Development Approach

Build the feature as backend-first, then add the minimal UI shell.

1. Add config parsing and UI mode semantics without mounting any routes.
2. Add sanitized runtime-state and config projections.
3. Add the UI log/audit ring buffer sink.
4. Add cache inventory APIs to cache implementations.
5. Mount authenticated read-only `/ui/api/*` routes and local/Docker static `/ui`.
6. Add a minimal, utilitarian frontend that consumes those APIs.
7. Add or document the BTP AppRouter shape for browser-authenticated deployments.
8. Document local, Docker, and BTP CF deployment shapes.

The frontend should be a small static asset bundle, not a new application framework unless the first
implementation proves it needs one. A single HTML/CSS/JS bundle is enough for v1 and avoids introducing a
frontend build chain into ARC-1's release path.

## API Shape

Proposed read-only API endpoints:

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /ui/api/overview` | Version, uptime, transport, deployment mode, cache mode, auth mode summary. | No secrets. |
| `GET /ui/api/config` | Sanitized grouped config plus source metadata. | Redact secret-bearing keys. |
| `GET /ui/api/safety` | Safety ceiling and rate/concurrency settings. | Mirrors effective policy log fields. |
| `GET /ui/api/features` | Cached feature-probe result or "not probed". | No auto-probe side effect. |
| `GET /ui/api/cache/stats` | Cache stats plus warmup/inactive-list aggregate state. | Align with `SAPManage cache_stats`. |
| `GET /ui/api/cache/sources` | Paginated source-cache inventory. | Metadata only by default. |
| `GET /ui/api/cache/nodes` | Warmup node summary or paginated metadata. | Aggregate-only under PP unless revalidated. |
| `GET /ui/api/cache/edges` | Dependency-edge summary or paginated metadata. | Aggregate-only under PP unless revalidated. |
| `GET /ui/api/logs` | Recent sanitized log/audit events. | Filter by level/event/requestId; bounded. |
| `GET /ui/api/docs` | Static list of relevant docs links. | No filesystem browsing. |

All list endpoints should accept `limit` and `cursor` or `offset`, clamp limits to a small maximum, and
sort deterministically.

## Deployment Matrix

| Runtime | Enablement | URL | Auth behavior |
|---------|------------|-----|---------------|
| Local stdio via Claude | `arc1 --ui --ui-port 8711` or env equivalent | `http://127.0.0.1:8711/ui` | Loopback-only; optional local UI token can be added later if needed. |
| Local HTTP | `ARC1_UI=true SAP_TRANSPORT=http-streamable` | `http://127.0.0.1:<port>/ui` | Admin-scoped bearer token required when HTTP auth is configured; warn loudly if HTTP is open and bind is non-loopback. |
| Docker local | `ARC1_UI=true`, same mapped port as `/mcp` | `http://127.0.0.1:8080/ui` | Admin-scoped bearer token required when HTTP auth is configured; docs recommend localhost bind and volume permissions for SQLite. |
| Docker shared | `ARC1_UI=true` plus API key/OIDC | `https://host/ui` behind reverse proxy | Must not be documented as unauthenticated; use an admin token. |
| BTP CF on-prem SAP | `ARC1_UI=web` plus AppRouter module | `https://<approuter-route>/ui` | AppRouter session login; ARC-1 API still validates admin-scoped JWT; PP cache leak constraints apply. |
| BTP CF + BTP ABAP | `ARC1_UI=web` plus AppRouter module | `https://<approuter-route>/ui` | Same browser auth; backend uses per-user destination; ARC-1 API still requires admin scope. |

## Security Review Baseline

The v1 implementation must explicitly handle these risks:

- **Secret exposure:** config values such as passwords, cookies, tokens, service keys, API keys, DCR signing
  secret, OAuth client secret, CSRF tokens, and Authorization headers must never be returned.
- **ABAP source exposure:** cache inventory returns metadata only in v1. Source preview is a future feature and
  must require a separate opt-in, auth scope decision, and documentation that SQLite stores source in cleartext.
- **Cross-user leakage under PP:** warmup nodes/edges and source caches may reflect shared-service-account
  visibility. In PP mode, v1 should either aggregate these views or require per-user live checks before
  exposing object-level details.
- **Log leakage:** UI log ring buffer must sanitize before storing and omit raw bodies by default. Do not read
  raw file sink logs back into the UI in v1.
- **Open HTTP mode:** if no Layer A auth is configured and the bind address is non-loopback, enabling UI should
  warn at startup; consider refusing `ARC1_UI=web` without auth outside loopback.
- **Browser auth:** do not assume the MCP bearer-auth middleware creates a browser session. In BTP, use AppRouter
  or explicitly mark same-app `/ui` as technical/manual-token only. HTTP UI APIs require `admin` scope when
  bearer auth is configured.
- **CSP/CORS:** same-origin local `/ui` should work with Helmet defaults. AppRouter-hosted UI should avoid
  browser CORS by proxying API calls same-origin. Any inline script/style decisions must be reflected in CSP tests.
- **DoS:** cache/log endpoints must clamp limits and avoid full-table scans where possible.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run check:sizes`

For UI visual QA after implementation:

- Start local HTTP UI: `SAP_TRANSPORT=http-streamable ARC1_UI=true npm run dev:http`
- Verify with browser/Playwright at desktop and mobile widths: `/ui`, `/ui/api/overview`, `/ui/api/cache/stats`.
- Start stdio UI mode and confirm stdout remains MCP-only.

### Task 1: Add UI Configuration and Startup Semantics

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/config.ts`
- Modify: `src/index.ts`
- Modify: `src/cli-args.ts`
- Modify: `tests/unit/server/config.test.ts`
- Modify: `docs_page/configuration-reference.md`

Define how the UI is enabled without changing default behavior.

- [ ] Add config fields for UI enablement: `uiMode` (`off`, `local`, `web`), `uiAddr` or `uiPort` for stdio
  local mode, and `uiOpen` for explicit browser auto-open.
- [ ] Parse env/flags: `ARC1_UI`, `ARC1_UI_ADDR` or `ARC1_UI_PORT`, and `ARC1_UI_OPEN`; add CLI aliases
  `--ui`, `--ui-port`, `--ui-open`.
- [ ] Define mode mapping: `--ui` in stdio means local loopback UI; `ARC1_UI=true` in HTTP means same-server UI;
  `ARC1_UI=web` allows BTP/network deployment.
- [ ] Keep defaults unchanged: UI off unless explicitly enabled.
- [ ] Warn or fail when a network-reachable UI is enabled without API key/OIDC/XSUAA auth.
- [ ] Unit-test config precedence, invalid ports, default-off behavior, stdio local mapping, and HTTP web mapping.
- [ ] Update configuration docs with all new options and security notes.

### Task 2: Build Sanitized Runtime and Config Projections

**Files:**
- Create: `src/server/ui-state.ts`
- Modify: `src/server/server.ts`
- Modify: `src/server/config.ts`
- Modify: `tests/unit/server/ui-state.test.ts`
- Modify: `tests/unit/server/effective-policy-log.test.ts` if projection overlaps existing policy logging.

Create a UI-safe data model before any browser route exists.

- [ ] Add `buildUiOverview()` for version, startedAt, uptime, pid, transport, bind/public URL, deployment mode,
  cache mode, and auth mode summary.
- [ ] Add `sanitizeConfigForUi(config, sources)` grouped by connection, auth, safety, cache, rate limit, tools,
  plugins, and logging.
- [ ] Represent secret-bearing fields as `present: true/false`, not values.
- [ ] Include config source metadata only where it is already tracked and useful.
- [ ] Add tests proving sensitive fields are redacted recursively and non-sensitive safety fields remain visible.
- [ ] Confirm the projection does not include raw `SAP_URL` credentials if a URL ever includes userinfo.

### Task 3: Add a UI-Safe Recent Log/Audit Ring Buffer

**Files:**
- Create: `src/server/ui-log-buffer.ts`
- Modify: `src/server/logger.ts`
- Modify: `src/server/audit.ts` only if a new `ui_access` event is justified.
- Modify: `tests/unit/server/logger.test.ts`
- Create: `tests/unit/server/ui-log-buffer.test.ts`

Expose recent operational events without reading raw sink files or leaking source snippets.

- [ ] Implement a fixed-size in-memory `UiLogBufferSink` that receives log/audit entries and stores sanitized
  event records.
- [ ] Sanitize before storing: remove `requestBody`, `responseBody`, `requestHeaders`, `responseHeaders`,
  `errorBody`, and large `resultPreview` by default.
- [ ] Preserve useful fields: timestamp, level, event/message, requestId, user, tool, method, path, status,
  duration, safety/auth denial fields.
- [ ] Add filters for level, event, requestId, and limit.
- [ ] Ensure sink failures cannot affect server behavior.
- [ ] Unit-test ring rollover, filtering, redaction, and absence of raw bodies.

### Task 4: Add Read-Only Cache Inspection APIs

**Files:**
- Modify: `src/cache/cache.ts`
- Modify: `src/cache/memory.ts`
- Modify: `src/cache/sqlite.ts`
- Modify: `src/cache/caching-layer.ts`
- Modify: `src/handlers/cache-security.ts`
- Modify: `tests/unit/cache/memory.test.ts`
- Modify: `tests/unit/cache/sqlite.test.ts`
- Modify: `tests/unit/cache/caching-layer.test.ts`

Add bounded metadata inventory without returning full source by default.

- [ ] Define `CacheInventoryQuery` and `CacheSourceEntrySummary` types with `limit`, cursor/offset, object type,
  name prefix/search, version, cachedAt, hash prefix, ETag presence, and source length.
- [ ] Implement memory-cache inventory by iterating maps with stable sorting and limit clamps.
- [ ] Implement SQLite inventory with parameterized SQL and a maximum limit.
- [ ] Add node and edge summary/inventory methods only if they can be exposed safely under PP; otherwise expose
  aggregate counts for v1.
- [ ] Thread cache-security context into UI cache APIs or explicitly disable object-level cache inventory when
  `ppEnabled`/per-user mode makes authorization ambiguous.
- [ ] Add tests for pagination, filters, limit clamps, no-source-return guarantee, and SQLite parameter safety.

### Task 5: Mount Authenticated Read-Only UI API Routes

**Files:**
- Create: `src/server/ui.ts`
- Modify: `src/server/http.ts`
- Modify: `src/server/server.ts`
- Modify: `tests/unit/server/http-ui.test.ts`
- Modify: `tests/unit/server/http-security-headers.test.ts`
- Modify: `tests/unit/server/audit-integration.test.ts` if UI access is audited.

Serve `/ui/api/*` without creating a second auth system, and serve local/Docker static assets where the same
ARC-1 process is the browser entrypoint.

- [ ] Add `mountUiApiRoutes(app, deps)` with GET-only `/ui/api/*`.
- [ ] In HTTP mode, place UI API routes behind bearer auth with `admin` scope when auth is configured.
- [ ] Serve static `/ui` from the ARC-1 app for local/Docker same-process usage.
- [ ] In API-key/OIDC local HTTP mode, decide whether the static UI prompts for a bearer token or relies on an
  already-authenticated reverse proxy; document the decision.
- [ ] In no-auth local HTTP mode, only allow UI when bound to loopback or emit a strong startup warning.
- [ ] In stdio mode, start a separate loopback-only Express listener for UI without touching stdout.
- [ ] Return `405` for non-GET UI API methods.
- [ ] Clamp all query parameters and return structured JSON errors without stack traces.
- [ ] Add tests for disabled UI 404, enabled UI success, auth-required behavior, method rejection, and Helmet/CSP
  compatibility.

### Task 6: Build the Minimal Static UI

**Files:**
- Create: `public/ui/index.html`
- Create: `public/ui/app.js`
- Create: `public/ui/styles.css`
- Modify: `package.json`
- Modify: `tsconfig.json` or build script only if needed for asset copying.
- Create: `tests/unit/server/ui-assets.test.ts` if static asset serving needs regression coverage.

Create a functional console, not a marketing page.

- [ ] Use a compact app layout with tabs or sidebar sections: Overview, Config, Safety, Features, Cache, Logs,
  Docs.
- [ ] Keep UI dense and operational: tables, filters, segmented controls, status badges, and copyable values.
- [ ] No write controls in v1.
- [ ] Use stable table dimensions and pagination to avoid layout jumps.
- [ ] Show explicit empty states for disabled cache, unprobed features, no logs, and PP-restricted cache views.
- [ ] Support a manual bearer-token entry path for local/shared HTTP deployments when no browser session proxy is
  present; store it in memory or session storage, not persistent local storage.
- [ ] Avoid inline scripts if Helmet CSP can stay stricter; if inline is used, update CSP deliberately and test it.
- [ ] Add asset-copying to `npm run build` if assets live outside `src`.

### Task 7: Add the BTP AppRouter Packaging Path

**Files:**
- Create: `ui-approuter/package.json`
- Create: `ui-approuter/xs-app.json`
- Create or reuse: `public/ui/*`
- Modify: `mta.yaml`
- Modify: `mta-overrides.mtaext.example`
- Modify: `xs-security.json` only if UI-specific scopes or redirect settings are required.
- Create: `tests/unit/server/ui-approuter-config.test.ts` or a script-level validation if practical.

Make BTP browser usage a first-class flow instead of relying on manual bearer tokens in the browser.

- [ ] Add an optional AppRouter MTA module that serves `public/ui` and proxies `/ui/api/*` to the ARC-1 backend
  destination.
- [ ] Bind the AppRouter to the same XSUAA instance so browser users get a normal BTP login/session.
- [ ] Ensure proxied API requests forward the user JWT to ARC-1, and ARC-1 still performs its own JWT/scope
  verification.
- [ ] Keep `/mcp` directly available for MCP clients; AppRouter is for browser UI, not a replacement MCP route.
- [ ] Document how `ARC1_PUBLIC_URL` and route hosts interact when AppRouter and ARC-1 have separate routes.
- [ ] If AppRouter packaging is deferred, explicitly mark BTP UI as "manual bearer-token technical preview" and
  do not present it as the supported BTP browser UX.

### Task 8: Document Local, Docker, and BTP Usage

**Files:**
- Modify: `docs_page/local-development.md`
- Modify: `docs_page/docker.md`
- Modify: `docs_page/deployment.md`
- Modify: `docs_page/btp-cloud-foundry-deployment.md`
- Modify: `docs_page/btp-abap-environment.md`
- Modify: `docs_page/security-guide.md`
- Modify: `mta.yaml`
- Modify: `mta-overrides.mtaext.example`
- Modify: `Dockerfile` only if labels/env defaults are added.

Make the operator story clear for every supported deployment.

- [ ] Document Claude stdio config with `--ui --ui-port 8711` and a note that UI URL is returned via stderr or a
  future tool response, never stdout.
- [ ] Document Docker local mapping with `-p 127.0.0.1:8080:8080` and cache volume permissions.
- [ ] Document shared Docker with API key/OIDC requirement.
- [ ] Document BTP CF `/ui` behind AppRouter/XSUAA, `ARC1_PUBLIC_URL` behavior, and backend route separation.
- [ ] Add `ARC1_UI` to `mta-overrides.mtaext.example` as commented opt-in.
- [ ] Add security-guide warnings for cleartext cache, UI auth, log redaction limits, and source preview being
  disabled by default.

### Task 9: Final Verification and Review

**Files:**
- Modify: `docs/plans/ralphex-ui-v1-readonly-console.md`

Close the implementation with tests and a focused security review.

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `npm run check:sizes`.
- [ ] Verify stdio mode still emits no stdout except MCP JSON-RPC.
- [ ] Verify local UI binds to `127.0.0.1` by default.
- [ ] Verify UI disabled mode has no `/ui` route.
- [ ] Verify authenticated HTTP deployments protect `/ui/api/*`.
- [ ] Verify ARC-1 BTP CF route serves `/health` and `/mcp` with expected OAuth metadata.
- [ ] Verify AppRouter BTP CF route serves `/ui` and proxies `/ui/api/*` with the user's JWT.
- [ ] Review all UI JSON responses for secret-bearing values and raw ABAP source.
- [ ] Move this plan to `docs/plans/completed/` after implementation merge.

## Plan Review Notes

Initial review checklist for this plan:

- Scope is read-only and excludes configuration mutation and SAP writes.
- Local stdio, Docker HTTP, and BTP CF deployment shapes are all covered.
- Cache source sensitivity is treated as a first-class constraint, not a UI afterthought.
- Principal-propagation cache isolation is called out before object-level cache inventory is exposed.
- Logs are buffered from sanitized in-memory events, not read back from raw file/BTP sinks.
- The plan prefers same-origin `/ui` locally and AppRouter proxying on BTP to avoid adding CORS complexity in v1.
- Review correction: MCP bearer authentication protects APIs but does not by itself create a browser login
  session. BTP browser support therefore needs AppRouter or an explicitly separate OAuth UI design; this plan
  chooses AppRouter for v1 BTP.
- The main unresolved design decision for implementation is whether object-level cache inventory is disabled,
  aggregated, or per-user revalidated under PP. This should be decided in Task 4 before route work starts.

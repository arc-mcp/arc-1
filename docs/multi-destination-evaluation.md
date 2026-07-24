# Evaluation: Multiple BTP Destinations in One ARC-1 Instance

**Date:** 2026-07-02
**Status:** Historical PR #543 prototype evaluation. The replacement v1 architecture uses global
XSUAA roles, destination-discovered SID/client routes, and a mutation-free ceiling; it is specified
in `docs/plans/destination-discovered-multi-target-v1.md`. All CSV, destination-name route,
target-bound-role, default-route, and write-policy details below are superseded and must not be used
as implementation requirements.
**Fork state:** `lemaiwo/arc-1` main = v0.4.4 (last synced ~2026-04-08)
**Upstream state:** v0.9.24 (published 2026-07-01), repo moved to `arc-mcp/arc-1`

## TL;DR

- **Upstream sync:** The fork is ~25 releases behind (0.4.4 → 0.9.24). Upstream moved
  from `marianfoo/arc-1` to `arc-mcp/arc-1`. Syncing could not be done from this
  session (repo access is scoped to `lemaiwo/arc-1` only); use GitHub's **Sync fork**
  button or fetch upstream locally.
- **Multi-destination:** Neither 0.4.4 nor 0.9.24 supports more than one SAP system per
  instance today. However, the architecture is already ~80% ready: tool dispatch takes
  an `AdtClient` per call, per-request client construction already exists (principal
  propagation), and the HTTP transport is stateless (a fresh MCP `Server` per request).
  **A path-per-destination design (`/mcp/<destination>`) is feasible with moderate,
  contained effort.**
- **Recommendation:** Sync to upstream 0.9.x first, then implement multi-destination
  there (ideally as an upstream contribution). Implementing on 0.4.4 means rebuilding
  it after every future sync and absorbing the 0.7 breaking config changes anyway.

---

## 1. Upstream gap (0.4.4 → 0.9.24)

Changes since the fork's version that matter for this feature:

| Area | Change |
|------|--------|
| Repo | Moved to `github.com/arc-mcp/arc-1` |
| Auth/config (**breaking**, v0.7) | `SAP_READ_ONLY`/`SAP_BLOCK_*`/`SAP_ENABLE_*` replaced by positive opt-ins (`SAP_ALLOW_WRITES`, `SAP_ALLOW_DATA_PREVIEW`, …); `SAP_ALLOWED_OPS`/`SAP_DISALLOWED_OPS` → `SAP_DENY_ACTIONS`; single `ARC1_API_KEY` → `ARC1_API_KEYS="key:profile"` with per-key authorization profiles (`viewer`…`admin`). Startup **fails hard** if legacy vars are set. |
| BTP/destination logic | Extracted from `src/adt/btp.ts` into a separate package `@arc-mcp/xsuaa-auth` (`lookupDestinationWithUserToken`, proxy selection, etc.) |
| Per-request safety | `client.withSafety(...)` derives an effective per-user client from API-key profile or OIDC scopes on every tool call |
| Concurrency | `ARC1_MAX_CONCURRENT` server-wide semaphore shared across all clients |
| New surfaces | Plugin system (`Custom_*` tools), web UI, rate limiting (`ARC1_AUTH_RATE_LIMIT`), OAuth DCR, abapGit, startup probes (textSearch smoketest, auth preflight) |

The fork has no local commits beyond upstream history, so a sync is a fast-forward:

```bash
git remote add upstream https://github.com/arc-mcp/arc-1.git
git fetch upstream
git checkout main && git merge --ff-only upstream/main
git push origin main
```

(Or simply the **Sync fork** button on github.com/lemaiwo/arc-1.)

## 2. Current architecture: one instance = one system

Both in the fork (0.4.4) and upstream (0.9.24):

1. **Startup resolution mutates global config.** `SAP_BTP_DESTINATION` is resolved once
   at startup and overwrites `config.url/username/password/client`
   (`src/server/server.ts:409` in the fork). One shared `defaultClient` is built from it.
2. **Cache keys have no system dimension.** Object cache keys are
   `TYPE:NAME:version` (`src/cache/cache.ts`); the SQLite schema (`nodes`, `edges`,
   `sources`, …) has no system/destination column. Two systems in one cache would
   collide silently.
3. **Feature probe + ADT discovery are process singletons.** System type detection
   (BTP vs on-prem), textSearch availability, and the discovery MIME map are cached
   module-globally and drive the tool listing.
4. **`SAP_BTP_PP_DESTINATION` is not multi-system.** The dual-destination setup is two
   destinations pointing at the *same* backend (shared BasicAuth + per-user
   PrincipalPropagation), not two systems.

## 3. What already works in favor of multi-destination

1. **Tool dispatch is client-agnostic.** Every call goes through
   `handleToolCall(effectiveClient, config, toolName, args, …)` — the client is a
   parameter, not a global.
2. **Per-request client construction is proven.** The principal-propagation path
   (`createPerUserClient`) already looks up a BTP destination *at request time*,
   selects the correct Cloud Connector proxy per destination
   (`selectPerUserProxy` handles per-destination `CloudConnectorLocationId`), and
   builds a fresh `AdtClient` per request.
3. **The HTTP transport is stateless.** Each `POST /mcp` creates a fresh MCP
   `Server` + `StreamableHTTPServerTransport` from a `serverFactory()` closure
   (`src/server/http.ts`). Mounting *N* factories at *N* paths is a small change.
4. **Per-request safety derivation exists** (0.9.x): `client.withSafety(...)` — the
   same mechanism can carry per-destination policies (e.g. writes on DEV only).

## 4. Design options

### Option A — Path-per-destination endpoints (recommended)

```
SAP_BTP_DESTINATIONS=S4D,S4Q,S4P   # allowlist; per-system guardrails live on the destinations (§6.4)

https://arc1.cfapps.../mcp/S4D   → dev system
https://arc1.cfapps.../mcp/S4Q   → qa system
https://arc1.cfapps.../mcp/S4P   → prod system
https://arc1.cfapps.../mcp       → default (first entry / SAP_BTP_DESTINATION), back-compat
```

Each destination is registered in the MCP client (Claude/Copilot) as its **own MCP
server entry**. Consequences:

- **No tool schema changes** — the LLM never has to pass a "system" parameter and can
  never write to prod because it hallucinated the wrong system ID.
- **Tool listing stays correct per system** — BTP vs on-prem feature differences are
  probed per destination.
- **Per-destination safety** — e.g. `SAP_ALLOW_WRITES_S4D=true` while S4P stays
  read-only. Deny-by-default for anything not in the allowlist.

Implementation sketch (a `DestinationRegistry`):

```
Map<destName, {
  adtClient        // shared client, resolved lazily on first request, re-resolved on 401/TTL
  bearerProvider   // OAuth lifecycle if service-key based
  btpProxy         // per-destination Cloud Connector config
  features         // feature probe result (system type, textSearch, …)
  discoveryMap     // ADT discovery MIME map
  cachingLayer     // per-destination cache (see below)
  safety           // per-destination ceiling
}>
```

`startHttpServer` mounts one `createMcpHandler(serverFactoryFor(dest))` per registry
entry.

### Option B — `system` argument on every tool (not recommended)

Add a `system` parameter to all 11 tool schemas. Rejected because: schema churn on all
tools, the LLM must reliably pass the right system (prod-write risk), mixed
BTP/on-prem tool listings become ambiguous, and hyperfocused mode gets more complex.

### Option C — Header/session-based routing (not recommended)

An `X-ARC1-Destination` header per session. The Streamable HTTP transport runs in
stateless mode (no session), and most MCP clients make custom per-server headers
awkward. Option A achieves the same isolation with plain URLs.

### Option D — Zero-code alternative: N instances (works today)

One CF app (or one process) per destination. With `ARC1_*`/`SAP_*` env per app this
works unmodified right now; a single `mta.yaml` can declare N modules sharing one
destination-service instance. Cost: N × ~100–150 MB memory and N deployments to
maintain. This is the pragmatic stopgap until Option A exists.

## 5. Work items for Option A (on top of 0.9.x)

| # | Item | Where (0.9.x layout) | Size |
|---|------|----------------------|------|
| 1 | `SAP_BTP_DESTINATIONS` CSV allowlist; per-system policy = mta.yaml baseline ∩ `arc1.*` destination properties ∩ `SAP_*_<DEST>` env overrides (narrowing only); startup validation + back-compat rules of §6.5 | `server/config.ts`, registry | S–M |
| 2 | `DestinationRegistry` with lazy init + credential re-resolution on 401/TTL (startup-once resolution is already a latent staleness bug for long-running instances) | new `server/destination-registry.ts`, reuse `@arc-mcp/xsuaa-auth` | M |
| 3 | Feature cache + discovery map keyed by destination (currently module-global in `handlers/feature-cache.ts`) | `handlers/feature-cache.ts`, `server/server.ts` | S–M |
| 4 | Cache isolation: per-destination cache file (`.arc1-cache-<dest>.db`) **or** a `system` column/key prefix. Separate files are simpler and make eviction trivial | `cache/*` | M |
| 5 | Mount `/mcp/:dest` routes; bare `/mcp` routes to the default destination (§6.5 rule 2); shared MCP auth (API keys / XSUAA) across routes | `server/http.ts` | S |
| 6 | PP per destination: convention `<DEST>_PP` or explicit map, replacing the single `SAP_BTP_PP_DESTINATION` | `server/server.ts` | S |
| 7 | Audit events include destination (field already exists on PP events — extend to all) | `server/audit.ts` | S |
| 8 | Decide concurrency scope: keep `ARC1_MAX_CONCURRENT` global (protects instance memory) but consider per-destination sub-limits so one slow system can't starve the others | `server/server.ts` | S |
| 9 | Warmup per destination (`ARC1_CACHE_WARMUP_<DEST>`), sequential to bound startup cost | `cache/warmup.ts` | S |
| 10 | stdio transport stays single-destination (multi-dest is an HTTP-deployment feature) | — | — |
| 11 | Historical option: destination-scoped API keys. Superseded for v1—discovered routes require XSUAA user tokens; revisit after a target-bound key format is designed. | `server/config.ts`, `server/http.ts` | deferred |
| 12 | Superseded by §6.3: distinct profile attributes + static `target_*` marker scopes, with allowlisted verified attribute transport from `@arc-mcp/xsuaa-auth`; mandatory for discovered routes. | `xs-security.json`, auth layer, auth package | M |

Rough total: a focused ~1–2 week effort including tests, dominated by items 2–4.

## 6. Per-destination authorization & guardrails

The design covers authorization per system. ARC-1 (0.9.x) enforces three layers, and
Option A makes the first one destination-scoped:

**Layer 1 — Safety ceiling (per destination in Option A).** Today these are global
process env vars; in the registry each destination gets its own ceiling:

| Guardrail | Global (today) | Per destination (Option A, §6.4) |
|-----------|----------------|----------------------------------|
| Writes | `SAP_ALLOW_WRITES` | `allowWrites` per system — prod stays read-only |
| Data preview | `SAP_ALLOW_DATA_PREVIEW` | `allowDataPreview` — e.g. allow on QA, deny on prod |
| Free SQL | `SAP_ALLOW_FREE_SQL` | `allowFreeSQL` — dev only |
| Transport writes | `SAP_ALLOW_TRANSPORT_WRITES` | `allowTransportWrites` — dev/QA only |
| abapGit writes | `SAP_ALLOW_GIT_WRITES` | `allowGitWrites` — dev only |
| Package allowlist | `SAP_ALLOWED_PACKAGES` | `allowedPackages: ["ZTEAM*"]` |
| Transport allowlist | `SAP_ALLOWED_TRANSPORTS` | `allowedTransports` per system |
| Per-action denials | `SAP_DENY_ACTIONS` (e.g. `SAPWrite.delete,SAPManage.flp_*`) | `denyActions` per system |

Because each destination is its own MCP endpoint, the tool *listing* also reflects its
ceiling — a read-only prod endpoint doesn't even advertise write tools, so the LLM
cannot attempt them.

**Layer 2 — Per-caller narrowing (already works, composes unchanged).** On every tool
call, 0.9.x intersects the client's safety config with the caller's rights via
`client.withSafety(...)`:

- **API-key profiles** (`ARC1_API_KEYS="key:profile"`, profiles `viewer`,
  `viewer-data`, `viewer-sql`, `developer`, `developer-data`, `developer-sql`,
  `admin`) — `deriveUserSafetyFromProfile` intersects flags AND-wise and narrows the
  package allowlist (wildcard/subtree-aware, conservative on `**` patterns).
- **XSUAA/OIDC scopes** (`read`/`write`/`data`/`sql`/`transports`/`git`/`admin`) —
  `deriveUserSafety` can only tighten the ceiling, never widen it.

Since the narrowing runs against whatever client handles the request, it applies per
destination for free: **effective rights = destination ceiling ∩ caller profile/scopes.**
Example: a `developer` API key on `/mcp/S4D` can write to `ZTEAM*`; the same key on
`/mcp/S4P` is read-only because prod's ceiling has `allowWrites=false`.

One gap to decide on: API keys and XSUAA config are instance-wide — any valid key can
*reach* every destination endpoint (with that destination's ceiling applied). If keys
should be restricted to specific systems, extend the key syntax, e.g.
`ARC1_API_KEYS="key1:developer@S4D,S4Q;key2:viewer@*"` — a small addition to the
registry lookup (work item 11).

**Layer 3 — SAP-side authorization (inherently per system).** Each destination has its
own technical user (BasicAuth destination) whose SAP roles are the hard backstop — a
prod destination user with display-only roles caps everything above. With principal
propagation, each system maps the *end user* via its own Cloud Connector/CERTRULE
setup, so real SAP authorizations (S_DEVELOP etc.) apply per user, per system.

### 6.1 What moves from `mta.yaml` into the destinations?

Split of responsibilities in the multi-destination setup:

**Lives in each BTP destination:**
- `URL`, auth (`User`/`Password` for BasicAuth, or `PrincipalPropagation` type) —
  this is already how `SAP_BTP_DESTINATION` works today
- `ProxyType` (`OnPremise` → Cloud Connector, incl. `CloudConnectorLocationId`)
- `sap-client` as an **additional property** — ARC-1 already reads it
  (`resolveBTPDestination`, defaults to `100` when absent)
- The system's guardrails, as `arc1.*` additional properties (see §6.4)

**Stays in `mta.yaml` / `mtaext`:**
- Service bindings (destination, connectivity, xsuaa services)
- The destination allowlist `SAP_BTP_DESTINATIONS=S4D,S4Q,S4P` (plain CSV)
- The instance-wide guardrail **ceiling** — the existing global `SAP_ALLOW_*` /
  `SAP_ALLOWED_PACKAGES` / `SAP_DENY_ACTIONS` vars, unchanged (see §6.4)

**System ID: nothing to configure.** The destination *name* is the identifier used for
routing (`/mcp/S4D`), cache scoping, audit, and role checks — no SID property is
needed. System type and capabilities (BTP vs on-prem, textSearch, …) are probed
automatically per destination via ADT discovery on first use. Only `sap-client` must
be set as a destination property if the client isn't 100.


### 6.2 Cross-system calls

Server-side: **no, by design.** One endpoint = one system; ARC-1 never proxies a
request from one system's session to another, so there is no confused-deputy path and
each system's audit log is self-contained.

Cross-system *workflows* still work — at the agent layer. A user with access to both
systems registers both endpoints (`/mcp/S4D`, `/mcp/S4P`) in their MCP client; the
LLM reads from one server and writes via the other in the same conversation
("compare this class between prod and dev", "replicate the fix"). Every call is
authorized and audited independently per system, under that system's guardrails.

A server-side cross-system tool (e.g. `SAPCompare` with an explicit target
destination) is technically possible later but reopens the isolation question —
defer unless a concrete need appears.

### 6.3 BTP roles per system

Today the XSUAA scopes (`read`, `write`, `data`, `sql`, `transports`, `git`,
`admin`) are instance-wide. Static scope-per-destination definitions would work,
but every new target would require an `xs-security.json` update and deployment.
Target attributes allow administrators to create roles for new destinations without
rebuilding ARC-1.

One generic `systems` attribute is **not safe**. XSUAA flattens all scopes and
attributes contributed by a user's roles. Developer(A4D) + Viewer(PRD) could become
`scopes=[read,write,…]` plus `systems=[A4D,PRD]`; independently checking the global
write scope and system membership would incorrectly permit PRD writes.

Independent of both: with principal propagation the backend applies the **actual SAP
roles of the end user per system**, so BTP role collections gate tool access while
S_DEVELOP & co. remain the authoritative object-level authorization in each system.

**Superseding decision: profile-bound target attributes and marker scopes.** Keep
the existing legacy scopes/templates unchanged and add new `MCPTarget*` templates.
Each profile references a different required attribute and a dedicated static marker
scope; target templates do not reuse the legacy functional scopes because that would
also authorize `/mcp`:

```jsonc
{
  "scopes": [
    { "name": "$XSAPPNAME.target_viewer" },
    { "name": "$XSAPPNAME.target_developer" },
    { "name": "$XSAPPNAME.target_data" },
    { "name": "$XSAPPNAME.target_sql" },
    { "name": "$XSAPPNAME.target_admin" }
  ],
  "attributes": [
    { "name": "arc1_viewer_targets", "valueType": "string", "valueRequired": true },
    { "name": "arc1_developer_targets", "valueType": "string", "valueRequired": true },
    { "name": "arc1_data_targets", "valueType": "string", "valueRequired": true },
    { "name": "arc1_sql_targets", "valueType": "string", "valueRequired": true },
    { "name": "arc1_admin_targets", "valueType": "string", "valueRequired": true }
  ],
  "role-templates": [
    {
      "name": "MCPTargetDeveloper",
      "scope-references": ["$XSAPPNAME.target_developer"],
      "attribute-references": ["arc1_developer_targets"]
    },
    {
      "name": "MCPTargetViewer",
      "scope-references": ["$XSAPPNAME.target_viewer"],
      "attribute-references": ["arc1_viewer_targets"]
    }
  ]
}
```

The administrator creates roles such as *ARC1 A4D Developer* with
`arc1_developer_targets=[A4D:100,A4D:200]` and *ARC1 PRD Viewer* with
`arc1_viewer_targets=[PRD:100]`. ARC-1 requires the matching signed marker scope and
attribute, then projects the profile into target-local functional scopes. This also
prevents target roles from granting access to legacy `/mcp`. There are no target
wildcards in v1. Missing/malformed attributes mean no access, and the authenticated
catalog shows only targets carrying effective read access.

The current `@arc-mcp/xsuaa-auth` verifier does not yet carry `xs.user.attributes`.
The v1 plan therefore includes a prerequisite package change that copies only
explicitly allowlisted attributes from `@sap/xssec`'s verified security context into
`AuthInfo`. Interpretation stays in ARC-1. API-key, raw OIDC, and client-credentials
tokens have no target attributes and cannot access discovered routes in v1.

### 6.4 Configuring per-system guardrails

Today (one system) the guardrails are env properties in `mta.yaml`/`mtaext`.
**That stays the baseline and keeps working unchanged.** Per-system differences are
expressed as *narrowing* on top of it — either in the cockpit (`arc1.*` additional
properties on the destination, next to `sap-client`) or in the mtaext (destination-
suffixed env vars), whichever the team prefers. Narrowing can only restrict, never
grant beyond the mta.yaml baseline.

**Per-flag resolution, per destination:**

```
baseline   = global SAP_ALLOW_* / SAP_ALLOWED_PACKAGES / SAP_DENY_ACTIONS   (mta.yaml — as today)
per-system = baseline ∩ arc1.* destination properties ∩ SAP_*_<DEST> env overrides
effective  = per-system ∩ caller roles/profile                              (as today)
```

A destination with no `arc1.*` properties and no suffixed vars simply runs with the
mta.yaml guardrails — existing configurations behave identically.

**In the mtaext** (baseline as today, optional per-system narrowing):

```yaml
# arc-1.mtaext
modules:
  - name: arc-1-srv
    properties:
      SAP_BTP_DESTINATIONS: S4D,S4Q,S4P   # plain CSV allowlist
      SAP_ALLOW_WRITES: true               # baseline, exactly as today
      SAP_ALLOW_TRANSPORT_WRITES: true
      SAP_ALLOW_DATA_PREVIEW: true
      # SAP_ALLOW_FREE_SQL not set → free SQL impossible on every system
      SAP_ALLOW_WRITES_S4P: false          # optional: pin prod read-only at deploy time
```

**In the BTP cockpit, per destination** (equivalent narrowing, no redeploy needed):

```
# Destination S4Q (additional properties)
sap-client              200
arc1.allow_writes       false
arc1.allowed_packages   ZTEAM*
arc1.deny_actions       SAPQuery.*
```

Properties of this model:

- **mta.yaml guardrails always work.** They are the baseline for every system; teams
  that want everything version-controlled use only env vars (global + suffixed) and
  never touch `arc1.*` properties.
- **Narrowing-only, so no privilege escalation from the cockpit.** A destination admin
  can tighten a system but can never enable writes or free SQL beyond what the
  deployed mta.yaml allows.
- **Fail-direction caveat:** because absent narrowing means "inherit baseline", a
  baseline with `SAP_ALLOW_WRITES: true` makes every listed system writable until
  narrowed. For prod, set the deploy-time pin (`SAP_ALLOW_WRITES_S4P: false`) in the
  mtaext rather than relying on someone remembering a cockpit property.
- **Conflicts resolve to the strictest value.** If both a suffixed env var and an
  `arc1.*` property are set, they intersect (env pin can therefore never be undone
  from the cockpit).
- **Auditability.** ARC-1 logs each destination's effective policy at startup and on
  re-resolution (upstream already has an effective-policy log), so cockpit-side
  changes are visible in the app log, not silent.

### 6.5 Backwards compatibility

Explicit compatibility rules, treated as acceptance criteria for the implementation:

1. **Single-system deployments are untouched.** With `SAP_BTP_DESTINATION` (or
   `SAP_URL`+credentials, or a BTP service key) and no `SAP_BTP_DESTINATIONS`, the
   server behaves exactly as today: one client, guardrails straight from env, and the
   MCP endpoint at **`/mcp` without any destination segment**. Existing `mta.yaml`,
   `mtaext`, and MCP client configs work verbatim — multi-destination code never runs.
2. **`/mcp` keeps working in multi-destination mode.** The bare endpoint routes to the
   *default destination* — `SAP_BTP_DESTINATION` if set (must be in the allowlist,
   validated at startup), otherwise the first entry of `SAP_BTP_DESTINATIONS`. Clients
   configured against `/mcp` survive the migration; new clients use `/mcp/<dest>`.
3. **Env guardrails remain authoritative as baseline** (§6.4) — an operator who never
   creates an `arc1.*` property gets today's behavior on every system.
4. **stdio transport** is unaffected (single destination by definition — the default
   destination applies).

## 7. Recommended path

1. **Sync the fork** to upstream `arc-mcp/arc-1` main (fast-forward; migrate any local
   `.env`/deployment config across the 0.7 breaking changes using upstream's
   `docs_page/updating.md`).
2. **Deploy Option D** (one instance per destination) if multi-system access is needed
   immediately — zero code.
3. **Implement Option A** on the synced fork, and consider proposing it upstream as a
   feature PR — the per-request client machinery and stateless transport upstream
   added since 0.5 make this a natural fit there.

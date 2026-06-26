# ARC-1 Extension Framework — Deep Research (basis for the FEAT-61 spec)

> **Status:** Research & design only. No code changes. This document is the **deep-research basis for the eventual extension spec/ADRs**.
> **Relationship to [`tool-extension-points.md`](2026-04-26-tool-extension-points.md):** that doc (the "v1 doc") remains the canonical phased plan + case studies (§14 samibouge, §15 dassian-adt). This document goes **deeper and broader** on the angles that matter for the spec — current-code reality, the SAP CAP convention-over-configuration model, the TS/MCP plugin best-practice corpus, the security-by-default model, how extensions call APIs, the broad ecosystem survey, and an explicit v1 / v2 / out-of-scope split — and ends with **recommendations on every open architecture decision**.
> **Date:** 2026-06-17. **Tracks:** roadmap FEAT-61, issues #187 (closed), #332 (open).
> **Sourcing:** four parallel research sweeps (current code; SAP CAP plugins; TS+MCP plugin best practices + Node sandboxing; the SAP/ABAP MCP ecosystem). External claims carry source URLs in the relevant sections.

---

## 0. TL;DR — what this research concludes

1. **The extension model is real demand, not speculative.** Three external projects already reuse ARC-1's architecture (LISA forked the *entire server* to add 3 translation tools to the same backend; calmcp + samibouge + dassian-adt corroborate). The realistic in-process extension set is **small and ABAP/ADT-HTTP-bound**.
2. **Two reuse paths, decided by backend** (not taste): *extend* ARC-1 (same ABAP system → inherit the whole gateway) vs *own server on the auth module* (different backend → borrow only BTP/XSUAA auth). This doc is about the **extend** path.
3. **Steal CAP's convention-over-configuration ergonomics; invert CAP's trust model.** Ergonomics free (filename=identity, generic middleware for free, config-merge, profile defaults). Power **declared and gated** through ARC-1's existing safety ceiling — the one place to *require* explicit declaration.
4. **Build on the MCP SDK's native dynamic-tool API** (`registerTool` + `RegisteredTool.enable/disable/update/remove` + `list_changed`). Don't reinvent a tool registry primitive; wrap it with a Backstage-style typed extension point that the host owns and intersects against the safety ceiling.
5. **Skip in-process sandboxing** — for the admin-trusted, explicit-opt-in threat model it is security theater (`vm`/`vm2` add CVE surface; the loader's admin could edit source anyway). Security-by-default comes from *inheriting the ceiling*, capability declaration, per-plugin error isolation, audit-with-identity, and redaction — not confinement.
6. **v1 = local trusted JS plugins** (`ARC1_PLUGINS=`) on a typed registry **+ a scoped read-only manifest tier**, additive-only, fully gated. The API is **experimental and may break any time** (no semver commitment yet). Several things are **out of scope for now** (marketplace, new transports/auth, raw HTTP passthrough, non-SAP egress, RFC/GUI protocols, replacing built-in tools, hyperfocused participation, framework-managed ABAP deployment).

---

## 0.1 Decision log (2026-06-17 — user review)

| Topic | Decision | Status (vs §11 recommendation) |
|---|---|---|
| v1 scope | Phase 1 (typed registry) + minimal Phase 2 (`ARC1_PLUGINS=` local JS loader) | ✅ approved |
| **Manifest tier** | **In v1**, scoped to read-only GET + simple stateless POST, bound to paths against the authed client (not raw URLs). Lock-aware writes stay code-tier. | ✅ approved — **moved v2→v1** (see §8) |
| `Custom_*` namespace | reserved, fail-fast on collision | ✅ approved |
| Sandboxing | none (theater for admin-trusted model) | ✅ approved |
| Replace/change built-in tools | **out of scope for v1 AND v2** (additive-only, indefinitely) | ✅ approved — **stricter** (was v2) |
| Ship-your-own-ABAP | **out of scope as a framework feature** (no bundling/install help). Plugins may still *call* custom ICF paths the admin installed by other means. | ✅ approved — **changed** (was "support as convention"); see §5/§7.3 |
| Hyperfocused mode + plugins | out of scope | ✅ approved — **changed** (was opt-in v1) |
| dassian-adt integration | defer to roadmap | ✅ approved |
| Versioning / API stability | **experimental — may break any time**; no semver commitment. Keep only a cheap `apiVersion` integer fuse. | ✅ approved — **changed** (was semver-from-Phase-0) |
| External / non-SAP API access | recommend **out for v1** (clarified §5) | ⏳ needs confirm — **Q-C** in §13 |
| Reference plugin | 3 calls demonstrating **ADT + custom OData + a non-ADT/non-OData SAP API**, in a **separate repo**, pure TS | ✅ refined (see §13 Q-M) |
| **Callable API scope** | **Any SAP HTTP API on the connected system** — ADT, OData, custom ICF — not just ADT. External/non-SAP stays out. | ✅ clarified — see §5 |
| **Path allowlist** | **Any path** (not just `/sap/bc/adt/*`). In BTP the **Cloud Connector** already gates reachable host+paths; on-prem it's the single bound host + SAP auth. | ✅ resolved (was Q-A) |
| **ABAP artifacts** | **No ABAP code in the arc-1 repo OR in any extension** — plugins are pure TS. Custom OData/ICF endpoints exist on SAP by external means. | ✅ clarified |
| **Plugin client surface** | Plugins get a **gated `SafeHttpClient`** (`ctx.http`), NOT the raw `AdtHttpClient` — raw `http.*` bypasses `checkOperation` (a real safety gap found in code). | ✅ new — security (§5.1) |
| **Extension authz model** | **Reuse the existing 7 scopes + allow\* ceiling** (tool declares `policy:{scope,opType}`). **Custom scopes = no** — XSUAA `xs-security.json` is deploy-time static, no wildcard scopes; OIDC drops unknown scopes. Pre-declared `custom.<plugin>` *visibility* labels = future option. | ✅ resolved (§6.4) |
| **Path allowlists** | **None** (on-prem or BTP). CC on BTP allows all endpoints by design → not the gate. Gates = per-user SAP auth + ARC-1 scope/safety. | ✅ resolved (was Q-L) |
| **Core blast radius** | **One** high-risk core change (dispatch `switch`→`ToolRegistry`); everything else additive. | ✅ mapped (§9.4) |

New open questions are in **§13**.

---

## 1. Current architecture reality (2026-06) — what the spec must build on

Grounded in a direct read of current code. **The v1 doc is directionally correct but stale on specifics** — correct these before writing the spec.

### 1.1 How a tool works today (the 6-file spread)

A built-in tool (e.g. `SAPRead`) is defined across:

| Concern | File | Shape |
|---|---|---|
| MCP tool definition (name, description, JSON schema) | `src/handlers/tools.ts` | `ToolDefinition { name, description, inputSchema }`; BTP vs on-prem enum variants; `getToolDefinitions(config)` |
| Runtime input validation | `src/handlers/schemas.ts` | Zod v4; `getToolSchema(toolName, isBtp)` |
| Scope + opType (+ featureGate) | `src/authz/policy.ts` | `ActionPolicy { scope, opType, featureGate? }`; `getActionPolicy(tool, action)` |
| Dispatch | `src/handlers/intent.ts` | **`switch(toolName)` at ~`intent.ts:1264-1324`** (12 built-in cases + a `SAP` hyperfocused recursive case) |
| Hyperfocused mapping | `src/handlers/hyperfocused.ts` | `ACTION_TO_TOOL` static map + `expandHyperfocusedArgs()` |
| Scope-aware list pruning | `src/server/server.ts:53-134` | `pruneToolByPolicy()` / `filterToolsByAuthScope()` |
| Audit bracketing | `src/handlers/intent.ts:1102-1112, 1329-1364` | `tool_call_start` / `tool_call_end` / `safety_blocked` / `auth_scope_denied` |

> **Stale-doc delta:** the v1 doc cites `intent.ts:1104` for the switch — it is actually ~`1264`. All v1 intent.ts line refs are off by ~160. The 6-file spread itself is unchanged. (Note: an architecture-consolidation effort is in flight around a `write/` package; on the current branch `intent.ts` is still the dispatch. The registry refactor below is Phase 1 **regardless of the dispatch file's eventual name.**)

### 1.2 The enforcement backbone a plugin must inherit (security-by-default)

- **`src/adt/safety.ts`** — `SafetyConfig { allowWrites, allowDataPreview, allowFreeSQL, allowTransportWrites, allowGitWrites, allowedPackages, allowedTransports, denyActions }`. `checkOperation(config, op, name)` throws `AdtSafetyError`. `OperationType` enum: `R`ead `S`earch `Q`uery `F`reeSQL `C`reate `U`pdate `D`elete `A`ctivate `T`est `L`ock `I`ntelligence `W`orkflow `X`transport. Plus `checkPackage()` / `checkTransport()`.
- **`src/authz/policy.ts`** — scope model `read | write | data | sql | transports | git | admin` with implications (`admin ⊇ all`, `write ⊇ read`, `sql ⊇ data`). `scripts/validate-action-policy.ts` enforces (Pass 1) every schema action has a policy entry, (Pass 2) every policy entry maps to a real action, (Pass 3) opType↔scope consistency.
- **`src/server/audit.ts`** — typed events; the framework brackets every call. Handlers MUST NOT emit `tool_call_*` themselves.
- **Principal propagation** — `src/server/server.ts:231-330` `createPerUserClient(...)` builds the per-user `AdtClient` (jwt-bearer / SAML / OAuth token precedence). Handlers receive an already-PP-wired client.

### 1.3 The public surface for "how extensions call APIs"

- **`AdtClient`** (`src/adt/client.ts`) — high-level domain reads (`getProgram`, `getClass`, …), each calls `checkOperation()` internally.
- **`AdtHttpClient`** (`src/adt/http.ts:220-268`) — **the low-level seam**: `http.get/head/post/put/delete(path, …)` with **CSRF, cookies, MIME negotiation, the shared semaphore, BTP connectivity proxy, and per-user auth handled transparently**; `withStatefulSession(fn)` for lock→modify→unlock.
- **Missing pieces the spec must add** (flagged by the dassian-adt case study, confirmed against code):
  - `lock`/`unlock` are **module functions in `src/adt/crud.ts`**, *not* methods on `AdtClient` → must be promoted to the public surface (returns `{ lockHandle, corrNr?, isLocal }`).
  - `ToolContext` has **no `elicit`/`notify`/`sampling`** → must be added (optional, capability-detected).
  - **No `src/public/` or `package.json#exports`** → Phase 0 not done.
  - **No `withRetryOnSessionExpiry`** helper → nice-to-have.
  - **No plugin test harness** (`arc-1/public/testing` mocks) → Phase 1 deliverable.

---

## 2. The two reuse paths (scope-setting)

| You want to… | Same ABAP system? | Path | Inherits | Owns |
|---|---|---|---|---|
| Add ABAP tooling (diagnostics, custom REST on the same system) | **yes** | **Extension** (this doc, FEAT-61) | auth + PP + safety + scope + audit + cache | just the tool(s) |
| Serve a **different** backend (Cloud ALM, BTP services, …) | **no** | **Own server** on the auth module | XSUAA/DCR/BTP auth plumbing | own safety/scope/audit + tools |

The deciding rule is the **backend + protocol**: same ABAP system over ADT-HTTP → extension; different backend or non-HTTP protocol (RFC, GUI scripting) → separate server. Both replace the current de-facto answer ("fork the whole repo"). §7 maps the real ecosystem onto this rule.

---

## 3. Best-practices synthesis

### 3.1 SAP CAP plugin system — the convention-over-configuration reference (steal ergonomics, invert trust)

CAP's `cds-plugin` mechanism is the strongest model for **convention over configuration**. Verified against `cap.cloud.sap` docs + real `@cap-js/*` source.

**The mechanism (one convention, no registry):** a package is a plugin if it ships a `cds-plugin.js` next to its `package.json`. The loader iterates the host's **declared dependencies** (not a blind `node_modules` scan), loads framework plugins before project plugins, and — critically — **merges the plugin's `package.json#cds` block into `cds.env` *before* its code runs** (config channel first, code second). Installing the package *is* activation. (`@cap-js/sqlite`'s `cds-plugin.js` is literally **0 bytes** — it ships behavior purely through config + an `impl` path.)

**Convention-over-configuration patterns worth stealing** (each eliminates config):

| CAP convention | Eliminates | ARC-1 analogue |
|---|---|---|
| **Filename = identity** — `srv/cat-service.js` implements `cat-service.cds` | a registration table / `@impl` annotation | `tools/<name>.ts` auto-registers tool `<name>`; schema in `<name>.schema.ts` by convention |
| **Name → path** — `CatalogService` → `/catalog` | explicit routes | tool name → LLM tool list entry, no manual `tools.ts` edit |
| **Generic CRUD + a fixed `handle_*` roster for free** | auth/etag/validation/paging by hand | free cross-cutting middleware: arg-normalization, scope check, Zod validation, audit, package gating |
| **`before`/`on`/`after` phases** ("no `next()` = replace default") | forking the handler to intercept | optional `before`/`after` hooks; explicit `on`-style override for built-ins (v2) |
| **Profiles, `development` default** | per-env config files | maps onto read-only/`$TMP`/mocked-by-default locally; writes + real allowlists only in a "production" posture |
| **Config-merge (12 sources) + per-profile overrides** | manual binding/parsing | plugin `package.json#arc1` defaults merged into `ServerConfig`, gated by ceiling |
| **Compose, don't configure** — sqlite(dev)+hana(prod) under logical `db:"sql"` by *installing both* | a central switchboard | multiple plugins layer by profile, not a registry edit |

**The critical lesson — invert CAP's trust model.** CAP plugins run in-process with the *entire* `cds` facade (`cds.db`, `cds.model`, `cds.services`) — **full trust, no sandbox, no permission manifest, no per-plugin error isolation** (one bad plugin can crash the server via `shutdown_on_uncaught_errors`). This was exploited (the April 2026 "Mini Shai-Hulud" npm supply-chain attack trojaned `@cap-js/db-service`). For a gateway whose entire reason to exist is a centralized safety ceiling + per-user auth, ARC-1 must keep CAP's *ergonomics* but make **power explicitly declared and gated**.

**The "FREE vs DECLARE" rule (the heart of the design):**

| FREE / automatic (convention) | Must be DECLARED (explicit) |
|---|---|
| Discovery & activation (install the package) | **Required scopes** (`read`/`write`/`sql`/…) + **package allowlist** the tool needs — checked vs server ceiling, **intersected, never expanded** |
| Tool name ← filename; schema ← naming convention | **Compatibility floor** on the ARC-1 core (`peerDependencies`) |
| Registration into the LLM tool list (no 6-file edit) | Human-readable description; non-default routing |
| Cross-cutting middleware (normalize, scope check, validate, audit, package-gate) | **Opt-out** of any default (a deliberate, visible choice) |
| Safe defaults (read-only, `$TMP`, dev profile) | **Elevation** beyond the safe default (writes, transportable packages, free SQL) |
| Per-plugin error containment | — |

### 3.2 TypeScript plugin-system patterns (cross-cutting, 5+ ecosystems)

Distilled from ESLint, Vite/Rollup, Fastify, Backstage, Prettier, Docusaurus:

1. **Plugin = named object/factory with a mandatory, load-bearing `id`** (not a class). `id` drives audit attribution, collision detection, namespacing. (Prettier's undefined collision behavior is the anti-pattern.)
2. **A single typed extension-point interface the host owns** (Backstage `createExtensionPoint<T>`): the host owns the `Map` + invariants (duplicate-id throw, prefix reservation), contributors call typed methods. **The TS interface is the versioned contract** — the most directly portable pattern to a tool registry.
3. **Capability injection over globals** (Rollup's tiered `PluginContext`): extensions reach host services only through an **injected, narrow context** — the seam where safety/audit/redaction/version-detection are enforced.
4. **Encapsulation by default + metadata-bearing escape hatch** (Fastify `fastify-plugin`): isolation is default; breaking it carries `name` + a **host-version range checked at load** + declared `dependencies`.
5. **Named hooks with a kind taxonomy** (Rollup): *first* (routing) / *sequential* (middleware) / *parallel* (observers). Adopt the *narrow* slice (parallel observers for audit/metrics), skip the full bus.
6. **Error containment stamps the plugin name** — fail-loud-with-attribution (Rollup auto-stamps `plugin: name`; ESLint stamps rule-id + filename).
7. **Host owns the engine version; plugins declare a compatibility range** (`peerDependencies` floor, runtime `meta.hostVersion` feature-detect); experimental surface behind an `/alpha`-style export.
8. **Declarative config (enablement/options) separate from imperative code** (ESLint).

### 3.3 MCP-native extensibility — build on the SDK, don't reinvent

- **The MCP SDK already supports dynamic tools at runtime.** `registerTool(name, config, cb): RegisteredTool` (throws on duplicate name); the returned handle exposes `enable()` / `disable()` (hidden from `tools/list`) / `update(...)` / `remove()`, **each auto-emitting `notifications/tools/list_changed`**. On first registration `McpServer` declares `capabilities.tools.listChanged: true` and installs the `ListToolsRequestSchema` handler (skips disabled tools, Zod→JSON-Schema). This is **exactly the primitive** for registering plugin tools and gating them per JWT scope — mirroring ARC-1's existing scope-based pruning. No third-party framework needed.
- **Ecosystem reference points:** `mcp-framework` (drop a file in `tools/` exporting a `class extends MCPTool` — the filename-convention model), `mcp-reloader` (chokidar `tools/*.js` → `list_changed`, the FS hot-load reference — useful for *local dev*, not a production gateway), `FastMCP` (imperative `addTool` with `canAccess(auth)`), `MetaMCP` (operator-side aggregator/middleware). Take the **explicit-registration core**; treat FS auto-discovery as an optional thin wrapper.

### 3.4 Distilled principles for ARC-1 (the synthesis the spec uses)

**Build it as:** Backstage's *typed extension point* (host owns a typed `addTool` registry with safety-ceiling invariants) + the *SDK's native dynamic-tool API* (`registerTool` + `enable/disable` + `list_changed`) + Rollup's *capability injection + name-stamped error containment* (narrow `ToolContext`, fail-loud attribution) + CAP's *convention-over-configuration ergonomics* (filename=identity, free middleware, config-merge, profiles) + a *declarative manifest tier* as the eventual safe default. **Deliberately skip** sandboxing, marketplaces, hot-reload, heavy hook/DI machinery — the admin-trusted, in-process, explicit-opt-in model makes them cost without benefit.

---

## 4. The extension contract (convention over configuration)

### 4.1 What the developer writes (the 80% case)

```ts
// arc1-plugin-nw750-dumps/tools/Custom_GetNw750Dump.ts  (filename = tool identity)
import { defineTool, OperationType } from 'arc-1/public';

export default defineTool({
  name: 'Custom_GetNw750Dump',                      // or inferred from filename
  description: 'Read ST22 short-dump detail on NW 7.50 via the custom ICF endpoint.',
  schema: z.object({ id: z.string() }),             // Zod (or sibling <name>.schema.ts)
  policy: { scope: 'read', opType: OperationType.Read },   // DECLARED capability
  availableOn: 'onprem',                            // optional release/variant gate
  async handler(args, ctx) {
    const res = await ctx.client.http.get(`/sap/rest/arc1/dumps/${args.id}`);
    return { content: [{ type: 'text', text: res.body }] };
  },
});
```

### 4.2 `ToolContext` (the injected capability seam) — updated surface

```ts
interface ToolContext {
  readonly client: AdtClient;                 // per-user, PP-wired; high-level reads, all PRE-GATED
  readonly http:   SafeHttpClient;            // gated low-level: every call → checkOperation(method→opType) + scope + audit.
                                              //   Any SAP path (ADT/OData/ICF). NOT the raw AdtHttpClient (which bypasses safety).
  readonly safety: SafetyConfig;              // READ-ONLY view (cannot mutate)
  readonly cache?: CachingLayer;              // optional
  readonly logger: Logger;                    // stderr only (never console.log)
  readonly config: PublicServerConfig;        // redacted, read-only
  readonly authInfo?: AuthInfo;               // userName, scopes, clientId — NO raw JWT
  readonly requestId: string;
  // NEW (Phase 1 — from dassian-adt analysis), all optional + capability-detected:
  readonly elicit?:   (p: ElicitParams) => Promise<ElicitResult>;        // ask the user
  readonly notify?:   (lvl: 'info'|'warning'|'error', m: string) => Promise<void>; // client-visible progress
  readonly sampling?: (sys: string, user: string, max?: number) => Promise<string>; // ask the LLM
}
```

Deliberately **excluded** from the context (the CAP-inversion): raw JWT, safety mutators, the MCP `Server` instance, `process`/env, child-process/port APIs, the ability to construct an `AdtClient` (would bypass PP + ceiling).

### 4.3 Convention summary

- **Tool identity** from filename/name; **registration** automatic (no 6-file edit).
- **Cross-cutting middleware** (arg normalization, scope check, Zod validation, audit bracketing, package gating) applied by the framework for free; opt-out is explicit.
- **Naming:** built-ins keep `SAP*`; plugins use a reserved `Custom_*` (single namespace; no per-plugin prefixes); duplicate names **fail-fast at load**.
- **Config:** plugin `package.json#arc1` defaults merged into `ServerConfig`, **gated by the ceiling**.

---

## 5. How extensions call SAP APIs (a focus area)

**Scope: any SAP HTTP API on the connected system** — ADT, OData, custom ICF/REST — not just ADT. **External / non-SAP hosts are out of scope** (no general `fetch` in `ctx`; §0.1). Plugins are **pure TypeScript — no ABAP artifacts in the arc-1 repo or in any extension**; custom OData/ICF endpoints exist on SAP by external means and the plugin just calls their paths.

### 5.1 The gated client — plugins get `SafeHttpClient`, not the raw client

**Code finding (security-critical, verified in `http.ts`/`client.ts`):** the raw `AdtHttpClient.get/post/…` methods **do not call `checkOperation()`** — only the high-level `AdtClient` methods (e.g. `getProgram()`) do. Handing a plugin the raw client would let it `POST` anywhere even with `allowWrites=false`. **Fix: `ctx.http` is a `SafeHttpClient` wrapper** that, on every call, maps HTTP method → `OperationType` (GET/HEAD→Read, POST→Create, PUT→Update, DELETE→Delete — overridable by the tool's declared `policy.opType`), runs `checkOperation()` + scope + `denyActions`, and audits under the tool's identity. **Plugins never receive the raw `AdtHttpClient`.**

Rides the client **free and path-agnostic** (verified generic): per-user PP auth, cookies, stateful sessions (`withStatefulSession`), the shared semaphore/rate-limit, the BTP connectivity proxy, `sap-client`/`sap-language` params, and caller-supplied `Accept`/`Content-Type`/headers (they win over ADT discovery).

### 5.2 Per-API-kind

| API kind | How | Works today | Caveat |
|---|---|---|---|
| **ADT** (`/sap/bc/adt/…`) | `ctx.client.getProgram()` (high-level, pre-gated) or `ctx.http.get('/sap/bc/adt/…')` | ✅ fully (CSRF auto, MIME auto) | `checkPackage` applies to ADT object writes |
| **OData** (`/sap/opu/odata/…`) | `ctx.http.get('/sap/opu/odata/SVC/Set?$filter=…')` | ✅ **reads** (`Accept: application/json` passes through) | **writes need CSRF against the *service* path** — ARC-1's CSRF is hardcoded to `/sap/bc/adt/core/discovery`. → add a generic `fetchCsrfToken(path)` (Q-J) so plugins don't each reinvent it |
| **Custom ICF / REST** (`/sap/bc/http/…`, `/sap/rest/…`) | `ctx.http.get('/sap/bc/http/sap/zsvc')` | ✅ reads; writes same CSRF caveat | endpoint must already exist on SAP (no ABAP shipped by the plugin) |
| **ADT writes** | `withStatefulSession()` + `ctx.client.lock()/unlock()` (NEW public) + transport | ✅ | transport defaults to `lock.corrNr`; promote `lock()→{lockHandle,corrNr?,isLocal}`/`unlock()` to `AdtClient` |
| **External / non-SAP** | — | ❌ out of scope | no `fetch` in `ctx`; a plugin needing it should be its own server |

### 5.3 What the ceiling does and does NOT gate for non-ADT calls

The `SafeHttpClient` wrapper gates **`allowWrites` + scope + `denyActions` + audit** on every call (ADT or not). But two ADT-specific knobs **cannot** apply to OData/ICF (no ABAP object/package in the path):

- **`allowedPackages` does NOT constrain OData/ICF calls** — there's no package to resolve. For non-ADT writes the real gates are `allowWrites` + scope + `denyActions` **+ the Cloud Connector resource allowlist (BTP) / per-user SAP auth**. The package allowlist is an ADT-object concept — admins must understand this (Q-K).
- **No path allowlists** (neither on-prem nor BTP — resolved). On BTP the Cloud Connector is configured to **allow all endpoints** (it's prepared for this), so the CC is *not* the path gate. The real gates for any SAP call are **per-user SAP-side auth (PP) + ARC-1 scope/safety** (`allowWrites`/scope/`denyActions` via `SafeHttpClient`). On-prem is the same minus CC: bounded to the one configured SAP host + SAP auth + scope/safety.

**Refused by the registry (anti-patterns, fail at load):** a `raw_http` passthrough tool (missing `policy.opType` / shaped as raw HTTP); plugin-supplied auth providers / OAuth login forms; plugins constructing their own client or grabbing the raw `AdtHttpClient`; new MCP transports.

---

## 6. Security model — security by default

### 6.1 Threat model (why the design is what it is)

A plugin enters **only when an admin sets `ARC1_PLUGINS=` on infrastructure they already control**. The plugin author is transitively the admin — already fully trusted, and able to edit source or read SAP creds directly. **Therefore "confine malicious plugin code" is not a real threat for v1** — any in-process sandbox is bypassable by the same actor, and `vm`/`vm2` actively *add* CVE surface (Node's own docs: "`vm` is not a security mechanism"; vm2 discontinued after repeated RCE escapes). **Heavy sandboxing here is security theater.**

The risks that *are* real are **operational**, addressed by engineering discipline, and by **inheriting the ceiling** rather than confining:

### 6.2 Security-by-default controls (the standard built-ins get, extended to plugins)

1. **Inherit the safety ceiling, unconditionally.** Every plugin SAP call routes through the same `checkOperation()` / `checkPackage()` / `ACTION_POLICY` choke-points. A plugin cannot reach a client handle that bypasses safety (`ctx.client` is already gated; no raw client/config/`process`).
2. **Capability declaration, intersected with the ceiling (the CAP-inversion).** A plugin **declares** the scopes + package globs it needs (`policy` per tool + a manifest block). At load the host **intersects** the declaration with the server ceiling — **never expands** it. A `write`-declaring tool on a `allowWrites:false` server is inert. This is the one place the design *requires* explicit declaration.
3. **Per-plugin error isolation.** A throwing plugin fails *its own* tool call (handled MCP error, plugin `id` stamped), **never crashes the process** and never leaks a stack trace with secrets — the opposite of CAP's `shutdown_on_uncaught_errors`. Wrap handlers in try/catch + bounded timeouts.
4. **Audit with plugin identity.** Every plugin tool call is bracketed by the framework's `tool_call_start/end` with the plugin `id` alongside user identity — same pipeline as built-ins. Plugins cannot emit `tool_call_*` themselves.
5. **Deny-actions applies natively.** `SAP_DENY_ACTIONS=Custom_*` (or a specific tool) removes plugin tools — the admin kill switch. Plugin tool names are `denyActions`-eligible by construction.
6. **Scope-based list pruning applies natively.** Plugin tools carry a real `ACTION_POLICY` entry → they participate in per-user `tools/list` filtering (no side-channel).
7. **Redaction at the sink.** Extend ARC-1's existing password/token/cookie redaction to anything a plugin can emit to logs.
8. **Trust tiers.** T0 in-tree → T1 admin-local file (v1) → T2 manifest-only (v2, statically checkable against the ceiling *before load* — the safest tier) → T3 npm (out of scope until the trust model changes).

### 6.3 Optional defense-in-depth (not required)

**SES `lockdown()` + a `harden()`ed endowment** is the *one* defensible lightweight add — it prevents prototype-pollution and accidental over-reach (least-privilege hygiene), **not** confinement of a hostile author. Consider only if cheap. Everything heavier (`worker_threads` for crash-containment, `isolated-vm`, WASM/WASI, OS isolation) is **deferred until the trust model changes** (a marketplace / community-submitted plugins) — at which point "the admin could do it anyway" no longer holds and confinement becomes real.

### 6.4 Extension authorization model — reuse the 7 scopes, not custom scopes

The "custom scopes vs map to `allowWrites`/`allowSQL`" question resolves (verified in code) to **reuse ARC-1's existing 7 scopes + the allow\* ceiling**:

- An extension tool declares `policy: { scope, opType }` (`read`/`write`/`data`/`sql`/`transports`/`git`/`admin`) and is gated **identically to a built-in**: scope check (`hasRequiredScope` + implications `admin`⊇all, `write`⊇`read`, `sql`⊇`data`), the safety ceiling (`checkOperation` maps `opType`→`allowWrites`/`allowFreeSQL`/…), per-user safety derivation (`deriveUserSafety`, tightest side wins), `denyActions`, and `tools/list` pruning. **Zero authz core change** — it works the moment a tool registers a policy. This is the direct answer to "map extension tools to `allowWrites`/`allowSQL`": yes, via the existing scope+opType mechanism.
- **Custom/namespaced scopes are blocked by XSUAA's deploy-time model:** `xs-security.json` scopes are a **static array of exact names — no wildcard** (`custom.*` is not expressible), and XSUAA **rejects tokens carrying scopes not in the deployed file**. The OIDC path **drops unknown scopes** (the `KNOWN_SCOPES` allowlist), and API-key profiles are fixed. So a plugin "introducing a new scope" still requires editing `xs-security.json` + `cf deploy` — the dynamic flexibility is **illusory**. Not worth it.
- **Future option (defer):** for per-plugin *role-based visibility*, a hybrid adds an optional **pre-declared** `custom.<plugin>` *visibility label* in `xs-security.json` (gates list-visibility only; execution still uses the 7 scopes) — ~50 LOC, additive, no runtime scope registration. Not v1.

---

## 7. External repos — detailed evaluation (does integration make sense?)

Anchored on the community census `marianfoo/sap-ai-mcp-servers` + live `gh`. **Updated decision axis** (per the all-SAP-APIs scope): *same SAP **system**, reached over HTTP — ADT **or** OData **or** custom ICF — → extension candidate; a **different** SAP system/product (Cloud ALM, BTP services, BW, HANA, Datasphere, …) or a **non-HTTP** protocol (RFC, SAP-GUI scripting) → separate server.* OData on the **same** system is now in scope — the earlier "business-data plane = separate server" distinction is **dropped**; the axis is **system + protocol**, not plane. (The OData *proxy* projects in the table below remain separate servers because they target arbitrary/other systems, not the one ARC-1 is connected to.)

### 7.1 Extension candidates (same ABAP / ADT-HTTP)

| Project | Tools | Access | Verdict / what it needs |
|---|---|---|---|
| **[ClementRingot/LISA](https://github.com/ClementRingot/LISA)** | 3 (i18n) | **custom ICF** `/sap/bc/http/sap/zi18n_service` → `ZCL_I18N_SERVICE` (XCO) | **Textbook extension.** Its own README: "designed to be used next to an ADT MCP server (e.g. ARC-1)." Collapses from a forked server to *3 `defineTool()`s + an `abap/` folder*. Needs: ICF GET/POST, JSON bodies, transport-for-writes, ship-own-ABAP, release-gate. **Strongest proof of demand** (someone forked the whole server for 3 tools). |
| **[DassianInc/dassian-adt](https://github.com/DassianInc/dassian-adt)** | 25–39 | standard ADT + a `raw_http` escape hatch | **Extension for ~32/39 tools** (one-line wrappers), minus non-goals. **Blocker: HTTP-client identity** — it rides `abap-adt-api`'s own login/cookie/CSRF; running two stacks per user breaks PP/audit/safety, so every handler must be **rewritten to `ctx.client.http.*`**. Surfaces useful gaps (`abap_unlock`, ATC variants, granular trace lifecycle, per-include class writes). Its `raw_http` is an explicit **non-goal**. |
| **[oisee/vibing-steampunk](https://github.com/oisee/vibing-steampunk)** (379★) | large (analysis suite) | standard ADT | **Extension-shaped, novel value:** package-health, dead-code, boundary/LUW analysis — all **computed client-side from standard ADT reads, no new backend**. The ideal additive extension; proves high-value tools need only clever use of the authed read client. |
| **[fr0ster/mcp-abap-adt](https://github.com/fr0ster/mcp-abap-adt)** (59★) | CRUD | ADT (+ optional RFC) | **Partial** — ADT parts are extension; RFC parts need a separate server. |
| **[Hochfrequenz/aibap.mcp](https://github.com/Hochfrequenz/aibap.mcp)** | 69 | ADT (+ BYO GUI/RFC hook) | **Extension for the ADT tools.** Novel pattern worth stealing: a compile-time **`BlackMagicClient` BYO hook** for ops ADT-HTTP can't do (SM30/SE09) — an escape hatch at the *protocol* boundary. |
| **[samibouge fork](https://github.com/arc-mcp/arc-1/compare/main...samibouge:arc-1:feat/nw750-version-fix)** | 1 (of 18 commits) | **custom ICF** `/sap/rest/arc1/dumps` → `ZCL_ARC1_DUMP_HANDLER` | **The canonical "where's the line" case.** 17 commits are plain upstream PRs; exactly one needs the extension model (ships customer ABAP). Bright-line test: **the moment a project requires customer-installed ABAP, it must be an extension, not upstream.** |
| **[DataZooDE/erpl-adt](https://github.com/DataZooDE/erpl-adt)** | CLI+MCP | ADT (+ BW-over-ADT) | Conceptually extension, but a single Go/C++ native binary → ships standalone in practice. |

### 7.2 Clearly out of scope — separate servers (and why)

- **Different backend / data plane:** calmcp (Cloud ALM), all OData business-data proxies (`odata-mcp-proxy` family, `oisee/odata_mcp_go` 137★, GutjahrAI), `bw-modeling-mcp` (BWMT REST), HANA, Datasphere, SuccessFactors, Analytics Cloud, CPI/Integration Suite, Focused Run, sap-security-mcp, sap-released-objects (static Clean-Core data). Riding ARC-1's ADT client buys them nothing.
- **Different protocol on the same data:** all **RFC** MCPs (`thupalo/sap-rfc-mcp-server`, `Richard-Zhangxj/SAP_MCP`, anything on `sap-rfc-lite`/node-rfc/pyrfc — need the NW RFC SDK binary, non-HTTP wire) and all **SAP GUI Scripting** MCPs (`mario-andreschak/mcp-sap-gui` 113★, Windows COM).
- **Inverse / non-applicable:** `abap-ai/mcp` (MCP server runs *inside* ABAP), `marcellourbani/abap-adt-api` (a client *library*, not a server — ARC-1 has its own equivalent), Eclipse-plugin ADT-MCP bridges (wake SAP's in-IDE server — different topology), pure doc/knowledge MCPs (no live backend).

> **Note on the brief's RFC confusion:** `fr0ster/sap-rfc-lite` is C++ RFC bindings (a node-rfc fork), **not** an MCP server; `fr0ster/mcp-abap-adt` is a *separate* ADT-HTTP MCP by the same author. Also: 30+ low-star ADT-MCP clones exist — all same-ABAP/ADT-HTTP, all conceptually mergeable, but each is its own standalone server adding no backend ARC-1 lacks.

### 7.3 The capability union the extension API must cover (derived from the candidates)

1. **Arbitrary ICF/REST path via the authed client** — `ctx.client.http.*`. Covers LISA, samibouge, ~32 dassian tools. *Non-negotiable core.*
2. **Stateful lock→modify→unlock** — `withStatefulSession()` + **public `lock()`/`unlock()`**. The single most impactful addition; every write tool needs it.
3. **Transport handling for writes** (pass request or inherit `lock.corrNr`).
4. **Custom bodies + headers + Accept negotiation** (JSON, versioned ADT MIME).
5. **Safety/scope/audit inheritance, read-only to the plugin** + typed errors.
6. **Mid-flow MCP capabilities** — `elicit` / `notify` / `sampling` (the three that make extensions *useful*, not just possible; dassian uses all three).
7. ~~Ship-your-own ABAP artifacts~~ — **out of scope as a framework feature** (§0.1). Plugins may still *call* custom ICF paths the admin installed separately; the framework neither bundles nor deploys ABAP.
8. **Per-release feature gating** (`availableOn`; in the additive model the admin's opt-in *is* the gate).
9. **Optional cache** (`ctx.cache?.getSource`) + (v2) multi-system `sap_system_id` auto-injection.

### 7.4 Novel use-cases found in the wild (design inputs)

- **i18n as a thin tool-pack** (LISA) — the flagship demand nobody would predict.
- **Filling release holes with customer ABAP** (samibouge) — back-fill a REST surface SAP never shipped.
- **BYO compile-time protocol fallback** (aibap `BlackMagicClient`) — typed hook for SM30/SE09-class ops.
- **Architecture analytics over plain ADT reads** (vibing-steampunk) — high value, zero new backend.
- **Granular surgical tools** (dassian `abap_unlock`, trace lifecycle) — extensions want finer control than coarse intent tools expose.

---

## 8. The two tiers — imperative code + a scoped declarative manifest (both in v1)

| Tier | Power | When | v? |
|---|---|---|---|
| **Imperative JS plugin** | full (any `ctx.*` logic; lock-aware writes; control flow) | anything the manifest grammar can't encode (writes, the aibap-style fallback) | **v1** |
| **Declarative manifest** (JSON, no JS) | map a validated JSON-Schema input → **one** HTTP call against the authed client | the common "wrap one read endpoint" case | **v1, scoped** (read-only GET + simple stateless POST) |

**Why a trusted author still benefits from the declarative tier** (TS/MCP research): *auditability* (reviewable as data — a PR diff shows the whole capability change), *least privilege* (a grammar that can only name vetted calls is statically gateable against the ceiling **before load** — the property MCP does not give for free), *validation* (reject malformed descriptors deterministically), *lower authoring bar* (no code).

### 8.1 Manifest-in-v1 feasibility — evaluation (grounded in ~12 OpenAPI→MCP / API-gateway implementations)

**Verdict: feasible, MEDIUM complexity** — *if* it binds to **paths against the already-authenticated `AdtClient`** (never a raw/LLM/manifest-supplied URL) and **excludes lock-aware writes**. The interpreter is then a pure function: render template → one `ctx.client.http` call → optional select/truncate → return. ARC-1 already owns every hard dependency (`checkOperation`, `ACTION_POLICY`, `encodeURIComponent` ×69 in client.ts, `fast-xml-parser` builder, the SDK's `registerTool`/`list_changed`).

**Minimal grammar (the whole thing):**

```jsonc
{
  "name": "Custom_GetSomething",
  "description": "Read X by name.",
  "scope": "read",                          // intersected with the server ceiling, NEVER expands it
  "inputSchema": { "type":"object", "properties":{
      "name": {"type":"string","pattern":"^[A-Za-z0-9_/]{1,40}$"} },
      "required":["name"], "additionalProperties": false },
  "request": {
    "method": "GET",                        // FIXED at declaration; GET/POST allowlist for v1
    "path": "/sap/bc/adt/.../{name}/source/main",   // fixed template; NO scheme/host — host owns the client
    "pathParams": { "name": "$.name" },     // each segment: validated → percent-encoded
    "query":      { "version": "$.lang" },  // omit-if-absent; arrays = repeated-key default
    "accept": "text/plain",
    "body": { "mode": "json", "template": { "field": "$.name" } }  // POST only; JSON skeleton, NOT a raw string
  },
  "response": { "extract": "$.someField", "maxBytes": 50000 }      // optional select; default = raw body, truncated
}
```

**What makes it grow (resist each):** OpenAPI `style`/`explode` array/object serialization (pick one default: repeated-key arrays, objects→body only); computed/derived values (concat/base64/conditional — that's a DSL → punt to code tier); jq response reshaping (ship truncation in v1, JSONPath select in v1.1, reserve jq); XML response parsing (v1 returns raw truncated body, like native source reads).

**Security the interpreter MUST enforce** (the LLM controls leaf values; the client is already authed — a textbook confused-deputy): fixed base URL = the `AdtClient` (reject any value resembling a URL → kills SSRF); per-segment canonicalize→allowlist→reject `..`/`/`/encoded-equivalents→percent-encode (anti-traversal); reject CR/LF/NUL in headers + a **header allowlist** that forbids `Host`/`Authorization`/`Cookie`/`X-CSRF-Token`/session headers (owned by the transport); build bodies structurally then serialize (never string-interpolate); strict `additionalProperties:false` input schema; route through the **same `scope ∧ safety ∧ SAP auth` chain** as native tools; audit the fully-resolved request with user identity.

### 8.2 Why writes stay in the code tier (v1)

A declarative lock-aware write is a **categorical jump**, not a slope. The ADT write needs exactly what every declarative spec leaves out: `LOCK_HANDLE` captured from the **response body** (not a header), threaded with rename into the PUT + UNLOCK; a shared **stateful session** (sessiontype + cookies + connection-id); a **CSRF refresh-on-403** sub-protocol; and a **guaranteed-finally** unlock. That turns a pure-function interpreter into a stateful workflow engine with a cookie jar — and still wouldn't beat ARC-1's existing `withStatefulSession()` + `try/finally`. **There is no declarative ADT-write manifest in the wild.** So: declarative tier = reads + simple stateless POST; **writes = code tier** in v1. *v2* may expose lock-aware writes as a **named, code-backed "operation vocabulary"** the manifest references and parameterizes (`op: adt.update_source` with `{type,name,source,transport?}`) — declarative breadth for the 90%, a vetted imperative escape for the stateful 10%, without growing the grammar.

---

## 9. Scope — v1 / v2 / out-of-scope

### 9.1 v1 (the experimental feature to ship)

- **Phase 0** — public API boundary: `src/public/` (or `package.json#exports`) exporting `defineTool`, `ToolContext`, `OperationType`, `AdtClient`/`AdtHttpClient` types, typed errors, a `arc-1/public/testing` mock harness. **Marked `@experimental` — no semver commitment; may break any release.** A single `apiVersion` integer is the only compatibility fuse (host fails fast on mismatch at load).
- **Phase 1** — typed `ToolRegistry` (Backstage-style) behind a flag; built-ins register through it; the dispatch `switch` becomes `registry.dispatch()`. Convert one built-in end-to-end (`SAPManage(cache_stats)`) as a self-test. Add to the public surface: **`lock`/`unlock` on `AdtClient`**, **`elicit`/`notify`/`sampling` on `ToolContext`**. Update `validate-action-policy.ts` to walk the registry. Tests: collision, policy-required-on-register, prefix validation, PP-through-registry.
- **Phase 2 (minimal)** — local trusted JS loader: `ARC1_PLUGINS=/abs/path.js[,…]` (absolute, readable, not world-writable, same owner; dynamic import + shape validation; fail-fast). **This is what makes it dev-usable.**
- **Manifest tier (scoped, §8)** — a JSON manifest loader + pure-function interpreter for **read-only GET + simple stateless POST** tools bound to paths against the authed client. Reuses the same registry + ceiling. Writes stay code-tier. (Ship as a fast-follow within v1 — see Q-F.)
- **Cross-cutting (all v1):** capability declaration **intersected with the ceiling, never expanded**; per-plugin error isolation; audit-with-plugin-id; `Custom_*` namespace + collision fail-fast; convention-over-config ergonomics (filename identity, free middleware, `package.json#arc1` config-merge).

### 9.2 v2 (roadmap)

- **Named code-backed "operation vocabulary"** the manifest can reference for **lock-aware writes** (`op: adt.update_source` with `{type,name,source,transport?}`) — declarative writes without an orchestration engine (§8.2).
- **Observer hook bus** — `onToolCall` / `onToolResult` parallel hooks for audit/metrics plugins.
- **`withRetryOnSessionExpiry`** helper; **cache invalidation hooks** (`cache.invalidate`).
- **Multi-system** (`sap_system_id` auto-injection) — FEAT-59.
- **MCP prompts** contribution — FEAT-62 (separate from tools).
- **dassian-adt gap absorption** (`abap_unlock`, ATC variants, trace lifecycle, per-include writes) — as built-ins or a reference plugin; handlers rewritten to `ctx.client.http.*`.
- **API stabilization** — a semver/compat policy *if/when* the feature graduates from experimental.
- **(Maybe) declared non-SAP egress capability** — only if a real use case appears (Q-C).
- **(Maybe) Phase 4 npm peer-package discovery** — only if the trust model still holds.

### 9.3 Out of scope (now — not this feature; some possibly never)

- **Replacing / changing built-in tools** (route-replacement) — **out for v1 AND v2**; additive-only (`Custom_*` add, never replace `SAP*`).
- **Hyperfocused-mode participation** by plugins — plugins do not register hyperfocused actions.
- **Framework-managed ABAP deployment** (ship-your-own-ABAP) — no bundling/install/blessing; plugins may still *call* custom ICF paths the admin installed separately.
- **Non-SAP / external egress** in v1 — `ctx` has no general `fetch` (Q-C may revisit for v2).
- Embedded ARC-1 (FEAT-29g); a **marketplace**; **hot-reload** of code (use SDK `enable/disable` for live toggling); plugins that **change MCP transport** or **add auth providers**; **`raw_http` passthrough**; plugins **constructing their own client**; **heavy sandboxing** (theater for this trust model); **RFC / SAP-GUI-scripting** (separate servers); **business-data OData** as a plane; per-plugin tool **prefixes**; **custom dynamic scopes** (XSUAA deploy-time blocker — §6.4); **path allowlists** (none — gates are SAP auth + scope/safety).

### 9.4 Core code changes vs additive enablement code (the blast radius)

Verified against current code. **The framework is ~90% additive; exactly one change touches the sensitive dispatch path.**

| Capability | Core / Additive | Touches | Risk |
|---|---|---|---|
| **Typed `ToolRegistry` replacing the dispatch `switch`** | **CORE** | `src/handlers/intent.ts` (the `switch(toolName)` ~:1264 in `handleToolCall`) + register built-ins at `server.ts` startup | **HIGH** — central routing; de-risk as a no-op refactor (below) |
| ToolContext `elicit`/`notify`/`sampling` | both (light) | `handleToolCall` already threads `_server`; expose it in the context | MED |
| Public API boundary (`src/public/` + `exports`) | **additive** | new re-export file; new `package.json#exports` | LOW |
| `SafeHttpClient` wrapper | **additive** | new file; wired into ToolContext | LOW |
| Generic `fetchCsrfToken(path?)` | **additive** | `http.ts` optional param, default `/sap/bc/adt/core/discovery` (existing callers unchanged) | LOW |
| `lock`/`unlock` on `AdtClient` | **additive** | new methods delegating to `crud.ts` | LOW |
| Capability/scope ceiling at load | **additive** | `validate-action-policy.ts` walks the registry; `getActionPolicy` gains a registry fallback | LOW |
| Audit with plugin identity | **additive** | optional `pluginName?` field on the audit events | LOW |
| Plugin loader (`ARC1_PLUGINS`) | **additive** | new module + a config field | LOW |
| Manifest interpreter | **additive** | new module | LOW |

**The one unavoidable core change — de-risk as a staged no-op refactor**, existing tests as the safety net:
1. Switch → `registry.dispatch()` for the 12 built-ins (same handlers, same behavior) → tests green.
2. Introduce `ToolContext`, convert the 12 built-ins to `(ctx, args)` → tests green.
3. *Then* Phase 2 (loader) only **adds registry entries** — orthogonal, low-risk.

The risky surface is one bounded refactor that ships and bakes **before any plugin exists**; everything a plugin needs (`SafeHttpClient`, `fetchCsrfToken`, `lock/unlock`, public boundary, loader, manifest tier) is additive and buildable in parallel without touching the dispatch/safety/audit core.

---

## 10. Evaluation matrices

**Trust tiers vs controls:**

| Tier | Loaded by | Confinement | Static ceiling check | v? |
|---|---|---|---|---|
| T0 in-tree | core | n/a | n/a | now |
| T1 local JS (`ARC1_PLUGINS=`) | admin file | none (trusted) | runtime intersect | **v1** |
| T2 manifest-only | admin file | declarative grammar | **before load** | v2 |
| T3 npm package | allowlist | none (trusted) | runtime intersect | deferred |

**Sandboxing options (why v1 uses none):** plain import = full trust (correct for admin-author); `worker_threads` = crash-containment only, not security; `vm`/`vm2` = *not a security mechanism* / discontinued after RCEs; `isolated-vm`/WASM/OS-isolation = real confinement but solve a problem v1 doesn't have. **SES `lockdown()`** = optional least-privilege hygiene. Revisit only if authors become less-trusted than the operator.

**Convention vs configuration (the v1 ergonomics):** FREE = discovery/activation, name←filename, registration, cross-cutting middleware, safe defaults, error containment, config-merge. DECLARE = required scopes/packages, compatibility floor, descriptions, opt-outs, elevation beyond safe default.

---

## 11. Open questions & recommendations (status per §0.1)

| # | Question | Recommendation | Status |
|---|---|---|---|
| 1 | v1 scope — internal (Phase 1) or dev-loadable (Phase 2)? | **Phase 1 + minimal Phase 2** (`ARC1_PLUGINS=` loader). | ✅ approved |
| 2 | Registry shape? | **Backstage-style typed extension point** the host owns, backed by the SDK's `registerTool`/`RegisteredTool` + `list_changed`. | ✅ approved |
| 3 | Manifest tier in v1? | **Yes — scoped** to read-only GET + simple POST, path-against-client binding (§8). Lock-aware writes stay code-tier. | ✅ approved (moved v2→v1) |
| 4 | Expose `lock`/`unlock`? | **Yes, v1**, on `AdtClient`. | ✅ approved |
| 5 | `elicit`/`notify`/`sampling`? | **Yes, v1**, optional + capability-detected. | ✅ approved |
| 6 | Capability declaration? | Per-tool `policy: { scope, opType }` + `package.json#arc1` package globs; **intersect with ceiling, never expand**. | ✅ approved |
| 7 | Naming / collisions? | `Custom_*` namespace; fail-fast on duplicate. | ✅ approved |
| 8 | External / non-SAP API access? | **Out for v1** (`ctx` has no `fetch`). v2 declared-egress only if a use case appears. | ⏳ confirm (Q-C) |
| 9 | Sandboxing? | **None** — theater for this trust model. Optional SES `lockdown()` later. | ✅ approved |
| 10 | Ship-your-own-ABAP? | **Out of scope as a framework feature.** Plugins may still call pre-installed custom ICF paths. | ✅ approved (changed) |
| 11 | Replace a built-in tool? | **Out for v1 AND v2.** Additive-only. | ✅ approved (stricter) |
| 12 | dassian-adt integration? | **Defer to roadmap** (v2 gap-absorption; handlers rewritten to `ctx.client.http.*`). | ✅ approved |
| 13 | Hyperfocused + plugins? | **Out of scope** — plugins don't register hyperfocused actions. | ✅ approved (changed) |
| 14 | Versioning/compat? | **Experimental — may break any time**; only a cheap `apiVersion` integer fuse. Stabilize later if it graduates. | ✅ approved (changed) |
| 15 | Reference plugin? | A **simpler read-only ADT tool in a separate repo** (not LISA, not in-tree) — see Q-E. | ✅ approved (changed) |

---

## 12. Recommended next step

A single **Phase 0 + Phase 1** PR (public boundary marked `@experimental` + typed registry + the `lock`/`unlock` and `elicit`/`notify`/`sampling` additions + one converted built-in + tests), behind a flag, **additive-only**. Then a focused **Phase 2** PR (local JS loader), and the **scoped manifest tier** (§8) as a fast-follow within v1. Build a **simple read-only reference plugin in a separate repo** (§13 Q-E) as the dogfood test. Everything in §9.3 stays out of scope.

---

## 13. Open questions (updated 2026-06-17 — round 3)

**Resolved:** Q-A (any path; gated by SAP auth + scope/safety via `SafeHttpClient`); Q-C (external non-SAP → out); Q-E (reference plugin → 3 SAP-API styles); **Q-H** (`SafeHttpClient` wrapper → yes, additive, required); **Q-J** (generic `fetchCsrfToken(path?)` → yes, additive); **Q-L** (path allowlists → none; gates are SAP auth + scope/safety); **authz model** (reuse the 7 scopes; no custom scopes — §6.4); **core blast radius** (one refactor — §9.4).

| # | Question | Recommendation | Status |
|---|---|---|---|
| Q-B | Manifest scope — read-only GET + simple POST, path-against-client; writes code-tier; named-action vocab = v2. | Confirm (§8). | ⏳ |
| Q-D | Versioning fuse — a single `apiVersion: N` integer despite experimental/breakable? | Yes — a fuse, not a stability commitment. | ⏳ |
| Q-F | Manifest + code tier both in v1 — roughly doubles the loader surface. | Yes, as a fast-follow (code tier first). | ⏳ |
| Q-G | Reference plugin repo + naming. | `marianfoo/arc1-plugin-example`; `arc1-plugin-<name>`. | ⏳ (default) |
| Q-I | opType mapping — default method→opType; tool's declared `policy.opType` overrides. | Declared opType authoritative; method = cross-check. | ⏳ |
| Q-K | Package-gating limit — `allowedPackages` can't constrain OData/ICF (no package). | Accept as a documented limitation. | ⏳ |
| **Q-N** | **Authz model confirm** — reuse the 7 scopes + allow\* ceiling for extension tools; custom scopes deferred (XSUAA blocker); per-plugin visibility-label = future. | Confirm. | ⏳ confirm |
| **Q-M** | **Reference plugin endpoints (a4h)** — (1) ADT: package contents / program read ✅; (2) OData: **`ZGWSAMPLE_BASIC`** (EPM demo, present on a4h) ✅; (3) non-ADT/non-OData: **open** (see Q-O). | Use `ZGWSAMPLE_BASIC` for OData. | ⏳ |
| **Q-O** | **Third (non-ADT/non-OData) endpoint** — `/sap/public/info` is inactive and `/sap/bc/ping` is 403 on a4h. Options: activate `/sap/bc/ping`, use a SOAP service (`/sap/bc/srt/…`), or point me to an existing custom ICF REST on a4h. | I can probe a4h further for a reachable one. | ⏳ needs input |

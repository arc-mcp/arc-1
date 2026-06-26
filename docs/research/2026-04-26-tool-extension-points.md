# Tool Extension Points — Custom Tools on Top of ARC-1

**Date:** 2026-04-26
**Status:** Research / Not yet decided — design only, no implementation in this PR

> **Code-location note (post-#402):** this doc predates the `src/handlers/intent.ts` split. The
> `switch (toolName)` router + `tool_call_*` audit wrapper now live in `src/handlers/dispatch.ts`
> (`handleToolCall`); per-tool logic is in `read.ts`/`write.ts`/etc. The clickable table/step links
> point at the current locations; remaining prose that says "intent.ts" means today's `dispatch.ts`.
**Related roadmap:** [FEAT-61: Tool Extension Points (Custom Tools)](../../docs_page/roadmap.md#feat-61)
**Related (deferred):** FEAT-29g (Embeddable server mode), FEAT-59 (Multi-tenant per-instance config), FEAT-26 (MCP Client Config Snippets)

---

## 1. Goal

Let downstream users add their own tools to an ARC-1 instance and have those tools reuse the same building blocks the built-in tools rely on (ADT client, HTTP transport, safety system, audit, cache), without forking the repository.

The user-stated goals, restated as design constraints:

1. **A defined "what is a tool"** — a single, small, documented contract that declares: name, schema, scope, operation type, optional feature gate, handler.
2. **Reuse, not duplicate, the backend plumbing** — extension authors call `AdtClient` / `AdtHttpClient` / `SafetyConfig` rather than re-implementing CSRF, auth, cookies, locks, MIME negotiation, or audit.
3. **Stable, clearly-labelled public API** — what is exported from `arc-1` and considered stable vs. internal must be unambiguous; everything else stays internal so the core can keep evolving.
4. **Start simple, then grow** — pick the smallest extension surface that solves the 80% case first, so we do not freeze the wrong API and have to break it later. No new transports, no new auth providers, no background daemons in v1.

This document is **research and design only.** It does not propose code changes. The roadmap entry [FEAT-61](../../docs_page/roadmap.md#feat-61) is the implementation tracker.

---

## 2. Why this needs care in ARC-1 specifically

ARC-1 is not a generic MCP shell — it is a centralized, admin-controlled SAP gateway. Six properties of the current design directly shape the extension surface:

| Property | Implication for extensions |
|----------|---------------------------|
| **Server safety ceiling** ([src/adt/safety.ts](../../src/adt/safety.ts)) | A custom tool must not be able to bypass `allowWrites`, `allowedPackages`, `allowFreeSQL`, `denyActions`. Every plugin call site must go through `checkOperation()` / `checkPackage()`. |
| **Per-action scope policy** ([src/authz/policy.ts](../../src/authz/policy.ts)) | Every tool action ships with an `ACTION_POLICY` entry (scope + opType + optional featureGate). Plugins must register one too — the validator at `scripts/validate-action-policy.ts` should accept plugin-contributed entries. |
| **Per-user identity (Principal Propagation)** ([src/server/server.ts:220](../../src/server/server.ts#L220)) | The handler receives an `AdtClient` that is already wired to the right SAP user. Plugins must not create their own `AdtClient` from raw config — they must accept the one passed in. |
| **Audit log** ([src/server/audit.ts](../../src/server/audit.ts)) | `tool_call_start`, `tool_call_end`, `safety_blocked` events bracket every call. Plugin handlers should not emit their own audit events; the framework emits them around the call. |
| **`stdout` is sacred** ([CLAUDE.md](../../CLAUDE.md) — "Security & Architectural Invariants") | One stray `console.log` in a plugin breaks the MCP JSON-RPC channel. Plugins must use the structured `logger` (stderr) or nothing. |
| **Fast tool-list pruning** ([src/server/server.ts:101](../../src/server/server.ts#L101)) | The `ListTools` response is filtered per user (scopes + denyActions) before the LLM ever sees it. Plugin tool/action enums need to participate in this filter — which means they need a real `ACTION_POLICY` entry, not a side-channel. |

**Conclusion:** the extension contract has to be opinionated. A "free-form, do whatever you want" plugin model would break exactly the properties that make ARC-1 different from every other ABAP MCP server.

---

## 3. What "a tool" actually is in ARC-1 today

A built-in tool such as `SAPRead` is split across six places. Any extension contract has to cover the same surface in one place — otherwise plugin authors will forget pieces and ship broken tools.

| Concern | File | Today | What an extension contract must replace |
|---------|------|-------|------------------------------------------|
| MCP tool definition (name, description, JSON schema) | [src/handlers/tools.ts](../../src/handlers/tools.ts) | Hand-written `ToolDefinition` plus BTP/on-prem variants | One `defineTool()` call returns the definition |
| Runtime input validation | [src/handlers/schemas.ts](../../src/handlers/schemas.ts) | Zod v4 schema, BTP/on-prem variants, `getToolSchema()` lookup | Same Zod schema, exposed by the plugin |
| Scope + opType + featureGate | [src/authz/policy.ts](../../src/authz/policy.ts) (`ACTION_POLICY`) | Static map, validated by `scripts/validate-action-policy.ts` | One entry per (tool, action) declared by the plugin |
| Routing | [src/handlers/dispatch.ts:651](../../src/handlers/dispatch.ts#L651) (`switch (toolName)`) | Hand-written switch | Plugin tools route via the registry, not the switch |
| Hyperfocused mapping | [src/handlers/hyperfocused.ts](../../src/handlers/hyperfocused.ts) (`ACTION_TO_TOOL`) | Static map | Plugin opts in by exposing a hyperfocused action key |
| BTP/on-prem variant | tools.ts + schemas.ts BTP arrays | Two enums per tool | Plugin declares `availableOn: ['onprem','btp']` (or `'all'`) |
| Scope-aware listing pruning | [src/server/server.ts:101](../../src/server/server.ts#L101) | Reads `ACTION_POLICY` | Same code, no change — relies on (3) |
| Audit logging | [src/handlers/dispatch.ts:488](../../src/handlers/dispatch.ts#L488) | `tool_call_start` / `tool_call_end` wrapper | Plugin code never logs `tool_call_*` itself; the framework wraps |

The intent surface is intentionally narrow — there are 12 built-in tools, not 200. Extensions must follow the same intent-based shape: small N of well-described tools, each with `action`/`type` enums. A plugin that adds 50 micro-tools defeats the whole point of the design.

---

## 4. The reusable "public surface" — what plugins need to call

These are the building blocks that exist today and would be re-exported (with stable contracts) for plugins. Everything else stays internal.

### 4.1 `AdtClient` (high-level reads)

`src/adt/client.ts` — the facade for all built-in read operations. Methods are domain-grouped (`getProgram`, `getClass`, `searchObject`, `getDomain`, etc.) and already call `checkOperation()`.

For plugins, the recommended pattern is:

```ts
// Inside a plugin handler
async ({ client }) => {
  const source = await client.getProgram('ZMY_REPORT');
  return { content: [{ type: 'text', text: source }] };
}
```

This is the lowest-risk reuse path: the client is already configured for the current user (PP), discovery map is injected, safety is enforced, errors are typed.

### 4.2 `AdtHttpClient` (low-level HTTP)

`src/adt/http.ts` — for endpoints `AdtClient` does not yet expose. Plugins call `client.http.get(path)` / `client.http.post(path, body, contentType)`. The HTTP layer handles CSRF (HEAD-based fetch with GET fallback), cookies, MIME negotiation, 415/406 retry, 401 retry, semaphore, BTP proxy, principal propagation. Plugins must not import `undici` or `fetch` directly.

For lock→modify→unlock sequences, plugins use the existing `withStatefulSession()` helper:

```ts
await client.http.withStatefulSession(async (session) => {
  // session shares CSRF/cookies; do lock→write→unlock here
});
```

### 4.3 `SafetyConfig` + `checkOperation()` / `checkPackage()` / `checkTransport()`

Every plugin handler that touches SAP must call the appropriate safety check first, identical to built-in handlers. Three rules:

1. The safety config is not mutable from a plugin — `client.safety` is read-only.
2. Mutating ops require `allowWrites=true` plus the user's scope.
3. Package allowlist is enforced for *writes only*; reads are never package-gated.

The plugin contract enforces this by passing `safety` into the handler context but not exposing any setter.

### 4.4 `CachingLayer`

`src/cache/caching-layer.ts` — used by built-in `SAPRead` for cached source. Plugins can opt in via `ctx.cache?.getSource(type, name, fetcher)`. Optional; cache may be `undefined` (memory mode disabled, or no cache).

### 4.5 `logger` + structured audit events

`src/server/logger.ts` — stderr-only. Plugins use `logger.info(...)`, `logger.warn(...)`, `logger.error(...)`. Plugins do not call `logger.emitAudit(...)` directly: the framework already brackets every plugin tool call with `tool_call_start` / `tool_call_end`. If a plugin needs domain-specific audit lines, we add a typed event to the AuditEvent union — not free-form audit emission from third-party code.

### 4.6 Typed errors

`src/adt/errors.ts` — `AdtApiError`, `AdtSafetyError`, `AdtNetworkError`, plus the `classifySapDomainError()` helper. Plugins should *throw* these, not catch-and-rewrap into plain `Error`, so the central error formatter (`formatErrorForLLM`) can produce LLM-friendly hints consistently.

### 4.7 XML / JSON parsing helpers

`src/adt/xml-parser.ts` exposes a long list of `parseXxx` functions used by `AdtClient`. These would *not* be public in v1 — they change frequently as SAP releases shift. Plugins that need to parse ADT XML should either use `fast-xml-parser` themselves (it is already a runtime dep) or, better, file an issue to add a high-level method to `AdtClient`.

### 4.8 What must stay internal

The following are deliberately *not* part of the public surface, even if a plugin would find them convenient:

| Internal area | Why off-limits |
|---------------|----------------|
| `src/server/server.ts` (`createServer`, `buildAdtConfig`, `createPerUserClient`) | Plugins must not construct their own clients — that bypasses PP and the safety ceiling. |
| `src/server/http.ts` (auth chain, JWT validation, profiles) | One mistake = auth bypass. Auth code stays in core. |
| `src/server/config.ts`, `ServerConfig` writes | Config is parsed once at startup; runtime mutation is a footgun. |
| `src/aff/validator.ts`, `src/lint/lint.ts` | These are internal SAP-domain validators that the core uses opportunistically. Exposing them couples plugins to abaplint version churn. |
| Cookie/session/CSRF token state on `AdtHttpClient` | Encapsulated for a reason; plugins use `withStatefulSession()` instead. |

---

## 5. Survey: how TypeScript projects expose extension points

These are the seven realistic patterns. The trade-off matrix at the end ranks them against ARC-1's design principles.

### A. In-tree contributions (status quo)

User forks the repo, adds a tool to `tools.ts` / `schemas.ts` / `intent.ts` / `policy.ts`, opens a PR.

* **Pros:** zero new abstraction, full review, clear ownership, atomic with the rest of the codebase.
* **Cons:** every customer-specific tool either lives in upstream or in a fork; high friction; private/customer-specific tools cannot be merged at all.
* **Examples:** ESLint pre-plugin era, every npm CLI before plugin systems.

### B. Local config-driven loading (file paths in env)

Admin sets `ARC1_PLUGINS=/etc/arc1/plugins/foo.js,/etc/arc1/plugins/bar.js`. The server `await import()`s each path at startup and registers exported tools.

* **Pros:** trivial to implement (~50 lines); works on stdio and HTTP equally; admin remains in full control of what code runs (admin chose the file path); no npm dependency at runtime; fits the centralized-gateway model.
* **Cons:** plugin code is fully trusted with same privileges as ARC-1 core; no version pinning unless admin manages it manually.
* **Examples:** ESLint `--rulesdir`, Vitest custom reporters via path, `--require` Node hooks.

### C. NPM peer-package plugins

Plugin is published as `arc1-plugin-foo` on npm, declares `"peerDependencies": { "arc-1": "^X.Y" }`. The server discovers plugins by scanning `dependencies` for the prefix, or via explicit allowlist `ARC1_PLUGINS=arc1-plugin-foo,arc1-plugin-bar`.

* **Pros:** version pinning via package.json; ecosystem-friendly; `npm audit` works; plugin authors publish independently; users `npm install arc1-plugin-foo` and restart.
* **Cons:** still arbitrary code execution; encourages a plugin marketplace that ARC-1's design philosophy actively pushes against (centralized vs. fragmented). Also fights with the BTP CF + Docker deployment model — plugins would need to be baked into the container image or staged via `mta.yaml`.
* **Examples:** ESLint plugins, Babel plugins, `prettier`, `vite`.

### D. Local trusted plugin directory

Admin drops a `.js` or `.ts` file into `~/.arc1/plugins/` (or a path configured via `ARC1_PLUGIN_DIR`). The server scans on startup. Same trust as B, just convention-driven location.

* **Pros:** familiar pattern (Claude Code skills, VS Code extensions, Vim packages); no env-var listing required.
* **Cons:** less explicit than B — admins may forget what's in the directory; surprising behaviour on shared servers.

### E. Manifest-only plugins (declarative, no JavaScript)

Plugin is a single JSON/YAML file describing a tool that calls a known SAP endpoint with parameters substituted from the schema. The core ships a built-in "manifest interpreter" that maps `{endpoint, method, headers, schema, scope, opType}` → an HTTP call through `AdtHttpClient`.

* **Pros:** safest model — no JS execution; can be shipped via Git; trivially auditable (`git diff` shows exactly the new HTTP surface); fits MCP's "data, not code" ethos.
* **Cons:** only covers thin wrappers around single ADT/OData endpoints; cannot do parsing, multi-call orchestration, lint, or local computation. Useful subset, but not a general extension model.
* **Examples:** Postman collections, OpenAPI-driven tools, Terraform providers' YAML schemas.

### F. Out-of-process MCP plugins (sub-MCP servers)

Each "plugin" is itself an MCP server (separate Node process, separate stdio/HTTP). ARC-1 acts as a *meta-server* and proxies tool calls. A plugin declares its name prefix and ARC-1 routes `Custom_FooTool` → plugin process.

* **Pros:** strong isolation — plugin crash does not take down ARC-1; plugins can be in any language; clean trust boundary; plugins do not share memory or auth with core.
* **Cons:** complex to implement (process supervision, stdio multiplexing, restart semantics); adds operational surface (how does Cloud Foundry deploy multiple processes?); duplicates SAP auth (each sub-process needs its own SAP session unless we relay tokens, which re-introduces the auth coupling we tried to avoid).
* **Examples:** Language Server Protocol servers, MCP itself.

### G. Sandboxed in-process plugins (worker_threads / vm / WASM)

Plugin runs in a Node `worker_threads` worker or `vm` sandbox or compiled to WASM. Communication via structured-clone messages.

* **Pros:** isolation without a separate process; can limit CPU/memory.
* **Cons:** complex; Node `vm` is famously not a security boundary; `worker_threads` does not protect against malicious plugins (they can still call `fs`); WASM is a real boundary but limits the plugin to pure compute (no SAP HTTP unless we proxy it back, which is just F with extra steps).

### Trade-off matrix (1 = best fit, 7 = worst)

| Pattern | Simplicity | Trust model | BTP fit | Reuse of core | Versioning | Total |
|---------|:--:|:--:|:--:|:--:|:--:|:--:|
| **B. Local config-driven** | 1 | 3 | 1 | 1 | 4 | **10** ★ |
| E. Manifest-only | 2 | 1 | 1 | 5 | 2 | 11 |
| A. In-tree | 4 | 1 | 1 | 1 | 1 | **8** ★ (status quo) |
| D. Plugin directory | 2 | 4 | 2 | 1 | 4 | 13 |
| C. NPM peer | 5 | 5 | 4 | 1 | 1 | 16 |
| F. Out-of-process MCP | 6 | 2 | 5 | 4 | 3 | 20 |
| G. Sandboxed in-proc | 7 | 3 | 5 | 4 | 5 | 24 |

A and B win the matrix. They are also the cheapest to ship — A already exists; B is ~50 lines on top.

---

## 6. Recommended phased approach

The advice "start simple before going to complicate to not produce too many breaking changes from the beginning" maps directly onto these phases. Each phase is an opt-in capability — no phase is mandatory and any phase can be the final state if the next is not justified.

### Phase 0: Define the public API boundary (no new feature)

Before adding any plugin loader, freeze what is and is not part of the public API. This is the smallest possible step and the one that prevents the most pain later.

* Add a `src/public/` folder (or use `package.json#exports` subpaths) that re-exports only the symbols plugins are allowed to use: `defineTool`, `AdtClient`, `AdtHttpClient`, `SafetyConfig`, `checkOperation`, `checkPackage`, `checkTransport`, `OperationType`, `Scope`, `ACTION_POLICY` types, `ToolDefinition`, `ToolResult`, `AdtApiError`/`AdtSafetyError`/`AdtNetworkError`, `logger`. Everything else stays accessible by deep import but is documented as internal.
* Add semver discipline: anything in `src/public/` is on the public API contract; breaking it bumps the major.
* No runtime behaviour change. All built-in handlers continue to deep-import.

This is the prerequisite for all later phases. It is also valuable on its own — it answers the user-stated requirement *"clearly defined documentation how to use, what is public and ready to use"*.

### Phase 1: In-tree custom-tool registry behind a feature flag

Add a `src/registry/tool-registry.ts` that holds:

* A `Map<toolName, RegisteredTool>` for plugin-contributed tools.
* An equivalent `Map<toolName.action, ActionPolicy>` extension that overlays `ACTION_POLICY` (or a registry-aware `getActionPolicy()`).

Built-in tools are registered identically (one `register(builtinTool)` call per built-in at startup). The intent.ts switch is replaced with `registry.dispatch(toolName, args, ctx)`, which still routes built-ins to today's `handleSAPRead` / `handleSAPWrite` / etc.

Outcome: zero external behaviour change, but the codebase is now extension-shaped. Adding a tool is "register it in the registry from src/handlers/intent.ts", which is one line per tool. This is what we'd ship first because it makes Phase 2 a small additional change.

### Phase 2: Local trusted plugin loader (admin-explicit)

Add `ARC1_PLUGINS=/path/to/plugin.js[,/path/to/another.js]`. At startup, after Phase 1's registry is populated with built-ins, the loader does:

1. For each path: refuse to load if the file is not absolute, not readable, world-writable, or not owned by the same user as the ARC-1 process. (Mirrors `ssh` `IdentityFile` permission checks.)
2. `await import(pathToFileURL(path).href)` — uses Node's ESM dynamic import.
3. Validate the default export is `{ apiVersion: 1, name, tools: Tool[] }`.
4. For every `tool` in the plugin: assert a corresponding `ACTION_POLICY` entry, assert the tool name is unique, assert the name is in the `Custom_*` or `X_*` namespace (so built-in names cannot be shadowed), register it.
5. Emit a startup audit event `plugin_loaded { name, version, file, toolNames }` so admins see exactly what was loaded.
6. If any plugin fails to load: refuse to start with a clear error. (Matching ARC-1's "fail-fast on invalid input" pattern from `SAP_DENY_ACTIONS` and `validateConfig`.)

This is the smallest addition that lets a customer add a tool without forking. The "trust" model is: whoever can write to the path can run code as the ARC-1 service account — same as any binary that admin runs. No claim of sandboxing, no claim of marketplace.

### Phase 3 (optional): Manifest-only plugins for thin endpoint wrappers

Add support for a JSON manifest plugin format that does not contain JS:

```jsonc
{
  "apiVersion": 1,
  "name": "my-team-tools",
  "tools": [
    {
      "name": "Custom_GetMyEndpoint",
      "description": "Read /sap/zcust/myservice for entity X",
      "schema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] },
      "scope": "read",
      "opType": "Read",
      "request": {
        "method": "GET",
        "path": "/sap/zcust/myservice/Entity('{id}')",
        "accept": "application/json"
      }
    }
  ]
}
```

The core ships a "manifest interpreter" that maps each manifest tool to a real `defineTool({ ... handler: () => client.http.get(...) })`. Path templates are substituted from validated schema values; nothing else is allowed. No JS, no eval. This is the safest possible plugin model and covers the long tail of "I just want to wrap this one OData endpoint".

### Phase 4 (only if demand): NPM peer-package plugins

Add a small discovery rule: ARC-1 looks at its own `dependencies`/`peerDependencies` and at an explicit `ARC1_PLUGINS=arc1-plugin-foo` allowlist, and dynamically imports those packages. Same registry contract as Phases 1–2. This is where it would make sense to add a signed plugin convention (npm provenance, or an SHA256 pinning mechanism) if the ecosystem grows.

This phase is **not recommended unless customers ask for it**. The centralized-gateway model already favours admin-controlled deployment; an npm marketplace fights that.

---

## 7. Concrete API sketch (illustrative, not committed)

The contract a plugin author writes against. Names are placeholders; the goal is to show that the public surface is small.

```ts
// arc-1/public  (re-exported from package; plugin authors import from here)
import {
  defineTool,
  type ToolContext,
  type ToolResult,
  type Scope,
  OperationType,
  AdtApiError,
  z,
} from 'arc-1/public';

export default {
  apiVersion: 1 as const,
  name: 'my-team-tools',
  version: '0.1.0',
  tools: [
    defineTool({
      name: 'Custom_PingProgram',
      description: 'Read a program and return its first line. Demo plugin.',
      schema: z.object({ name: z.string() }),
      // Required: every tool declares its policy
      policy: { scope: 'read', opType: OperationType.Read },
      // Optional: BTP/on-prem availability
      availableOn: 'all',
      // Optional: hyperfocused mapping
      hyperfocused: { action: 'custom_ping' },
      async handler(args, ctx: ToolContext): Promise<ToolResult> {
        // ctx.client is the per-user AdtClient (PP-aware, safety-wired)
        const source = await ctx.client.getProgram(args.name);
        const firstLine = source.split('\n')[0] ?? '';
        return { content: [{ type: 'text', text: firstLine }] };
      },
    }),
  ],
};
```

`ToolContext` contains exactly the things a handler may use:

```ts
interface ToolContext {
  readonly client: AdtClient;          // per-user, PP-aware
  readonly safety: SafetyConfig;       // read-only view of the effective ceiling
  readonly cache?: CachingLayer;       // optional, may be undefined
  readonly logger: Logger;             // structured stderr logger
  readonly config: PublicServerConfig; // narrow read-only subset of ServerConfig
  readonly authInfo?: AuthInfo;        // userName, scopes, clientId — never the raw token
  readonly requestId: string;          // for correlation in user-emitted log lines
}
```

Things deliberately not on `ToolContext`:

* The raw JWT (so plugins cannot impersonate the user against external services).
* Any way to mutate `safety` at runtime.
* The MCP `Server` instance (so plugins cannot register additional handlers behind the framework's back).
* `process.env` (use `ctx.config` for any allowlisted plugin-relevant config).
* A way to spawn child processes / open ports — discouraged by API surface, not enforced.

---

## 8. Security model

| Trust tier | Source | Auth needed | Permissions |
|------------|--------|-------------|-------------|
| **T0 — In-tree** | `src/handlers/...` | n/a | Full access (today's built-in tools) |
| **T1 — Admin-local** | File at `ARC1_PLUGINS=...` paths owned by service account | none beyond filesystem | Same as T0 — runs in-process |
| **T2 — Manifest-only** | JSON manifest in `ARC1_MANIFEST_PLUGINS=...` | none | Limited to declared HTTP endpoints, no JS |
| **T3 — npm package** (if Phase 4) | `arc1-plugin-*` dependency | npm allowlist (`ARC1_PLUGINS`) | Same as T1; tier still trusted |

**Naming rules (enforced at registration):**

* Built-in tool names start with `SAP*` or are exactly `SAP` (hyperfocused). These are reserved.
* Plugin tool names must start with `Custom_` (preferred) or `X_` (legacy alias). Anything else is rejected at registration.
* Action enums are scoped to their tool, so `Custom_PingProgram.action="run"` does not collide with `SAPWrite.create`.

**Mandatory invariants for plugin code:**

1. Every plugin tool must have a corresponding `ACTION_POLICY` entry — if the plugin's `policy` is missing, registration fails. This means tool-listing pruning, `denyActions`, scope check, and audit all keep working unchanged.
2. Plugins must call SAP only through `ctx.client` / `ctx.client.http`. Direct `undici`/`fetch` calls bypass MIME negotiation, CSRF, PP, and the safety wall — registration cannot enforce this, but the linter/docs can.
3. Plugins must throw `AdtApiError` / `AdtSafetyError` / `AdtNetworkError` (or sub-classes), or throw a plain `Error` and accept a generic error message in the LLM response. Wrapping in a custom error class blocks the central error formatter from producing actionable hints.
4. Plugins must not write to `process.stdout`. Use `ctx.logger`. The framework should monkey-patch `console.log` to a warning when a plugin loads (defence in depth — `stdout` is sacred).
5. Plugins must respect `ctx.safety` — calling `ctx.client.http.post(...)` for a write op without `checkOperation(ctx.safety, OperationType.Update, '<name>')` is a registration-time concern (we should provide a small wrapper that does it automatically when `policy.opType` is mutating).

**What plugins are *not* allowed to do (even if the language permits it):**

* Add or remove auth providers (OIDC, XSUAA, API keys).
* Add MCP transports.
* Mutate `ServerConfig` at runtime.
* Register additional `ListTools` / `CallTool` handlers on the MCP `Server`.
* Schedule background work (cron, setInterval) that runs outside a tool call. Tool calls are the only authorized request path; anything else complicates audit and PP.
* Open new outbound network connections to non-SAP hosts unless explicitly via a sanctioned helper. (Not enforced in v1, but called out in the docs.)

---

## 9. Open questions / decisions deferred to implementation

Listed so the next implementer does not rediscover them.

1. **Tool-name collision:** if two plugins both register `Custom_Foo`, fail-fast or last-one-wins? Recommendation: **fail-fast at startup** with a clear error. This matches the existing config behaviour.

2. **Plugin enable/disable per profile:** can the admin restrict an API-key profile to a subset of plugin tools? Today profiles narrow scopes only. Likely yes via existing `denyActions` (e.g., `SAP_DENY_ACTIONS=Custom_Risky.*`) — but we should validate.

3. **Plugin tools in hyperfocused mode:** opt-in via the plugin (`hyperfocused: { action: '...' }`). Open question: is the hyperfocused enum capped at ~12 to keep the schema small? If so, plugins compete for slots — we'd want a per-plugin opt-in flag and an admin gate.

4. **Versioning of the public API:** semver on the `arc-1` package; plugins declare `apiVersion: 1`. When we ship breaking changes, we add `apiVersion: 2` and let v1 plugins keep working under a compat shim for one release.

5. **Plugin-emitted audit events:** typed events only, or a generic `plugin_event` envelope? Recommendation: typed events (require core to add the type to `AuditEvent`) — keeps the audit log queryable.

6. **Where do plugin docs live?** Plugins should ship their own README. The ARC-1 docs site should have a single page that lists *known* trusted plugins, similar to `docs_page/skills.md`. Skills are LLM prompt templates; plugins are server code — same idea, different runtime.

7. **Per-user plugin denial:** is there a use case for "user A can use plugin Custom_Foo but user B cannot"? Today it falls out of `ACTION_POLICY` + scopes + denyActions, so probably no extra mechanism needed.

8. **Cache invalidation hooks:** if a plugin writes to SAP, can it invalidate the source cache? Today `CachingLayer` handles this for built-ins. The plugin context could expose a narrow `cache.invalidate(type, name)` method. Defer to implementation.

9. **Per-user plugin context:** if a plugin needs per-user state (e.g., an API key to a non-SAP system), where does that live? Not in `ctx` in v1 — plugins manage their own state with caveats about PP correctness. Real solution may be a future "plugin secret store" backed by BTP Credential Store.

10. **Test harness for plugin authors:** ship a `arc-1/public/testing` import with mock `AdtClient`, mock `AdtHttpClient`, mock `SafetyConfig` so plugin authors can unit-test their handlers. Should be in scope for Phase 1.

---

## 10. Anti-patterns / explicit non-goals

* **Embedded ARC-1 ("ARC-1 as a library inside another app").** Already deferred as [FEAT-29g](../../docs_page/roadmap.md#feat-29) — embedding contradicts the centralized-gateway model. This research is the *opposite*: tools are added *to* an ARC-1 instance, not the other way around.
* **Plugin marketplace / registry hosted by upstream.** Out of scope. If an ecosystem emerges, it is community-driven.
* **Hot-reload of plugins.** Plugins load at startup. A reload requires a restart. Hot-reload tempts plugin authors to rely on it for state, which complicates audit and PP. (And BTP CF restarts are cheap.)
* **Plugins that change MCP transport.** Transport ownership stays in core (`stdio`, `http-streamable`).
* **Plugins that bypass `denyActions`.** A plugin tool name *is* `denyActions`-eligible. Admins always retain the kill switch.
* **Allowing plugins to register their own tool *prefixes*.** Forces a two-level naming and complicates collision detection. Single namespace, `Custom_*`, is enough.

---

## 11. Comparison with related projects

* **`abap-adt-api` (marcellourbani):** a TypeScript ADT client library, no plugin model — extension is "fork it". ARC-1 already reuses concepts from it.
* **`fr0ster/sap-rfc-lite`:** native RFC client, no plugin model. ARC-1 evaluated and deferred RFC integration in [docs/research/2026-04-14-rfc-integration-sap-rfc-lite.md](2026-04-14-rfc-integration-sap-rfc-lite.md).
* **`dassian-adt`:** monolithic, no plugin model — features are added in-tree.
* **MCP SDK itself (`@modelcontextprotocol/sdk`):** the SDK is unopinionated — `Server` lets you register any handler. The opinionation in ARC-1 (centralized safety, scope policy, audit) is *the value-add*. Plugins must inherit that opinionation.
* **VS Code extensions / Eclipse plugins:** Tier-based marketplace, sandboxed manifest permissions. Useful reference for *naming* (`publisher.name`), *manifests* (`package.json` plugin field), and *capability declaration*. Not useful as an architecture model for an MCP server.
* **ESLint plugins:** the closest analogue — config-driven (`extends`, `plugins`), npm-distributed, in-process. Worth re-reading [ESLint's plugin docs](https://eslint.org/docs/latest/extend/plugins) before implementation.

---

## 12. Recommended next step (when implementation begins)

A single, narrow PR that ships **Phase 0 + Phase 1** together:

1. Move public symbols into a stable `src/public/` (or `package.json#exports`) re-export path; document them in `docs_page/extension-api.md`.
2. Refactor [src/handlers/dispatch.ts:651](../../src/handlers/dispatch.ts#L651) `switch (toolName)` to dispatch through a `ToolRegistry`, and register all 12 built-ins into it at server start. No external behaviour change.
3. Add `defineTool` and the `ToolContext` types to the public surface. Convert one built-in tool (suggest `SAPManage` with action `cache_stats` — read-only, simple) to register through `defineTool` end-to-end as a self-test.
4. Update `scripts/validate-action-policy.ts` to walk the registry instead of (or in addition to) the static map.
5. Add unit tests covering: registry collision, ACTION_POLICY-required-on-register, name-prefix validation.
6. Stop here. Do **not** ship Phase 2 in the same PR. Let the public API breathe one minor release before adding the loader.

A subsequent PR adds Phase 2 (`ARC1_PLUGINS` loader). A possible third PR adds Phase 3 (manifest-only plugins). Phase 4 only if customers ask.

---

## 13. Quick sanity checks before any implementation

* [ ] Does the proposed `ToolContext` cover every `client.http.*` call a plugin would make? (Should: yes — `client.http` is the same `AdtHttpClient` built-ins use.)
* [ ] Does an admin with `SAP_DENY_ACTIONS=Custom_*` lose all plugin tools? (Should: yes — `denyActions` glob already matches tool name prefixes.)
* [ ] Does PP keep working through the registry path? (Should: yes — `ctx.client` is the per-user client built in `createPerUserClient`.)
* [ ] Does the `tools/list` response stay deterministic for the LLM? (Should: yes — registry order = built-ins first, then plugins in registration order.)
* [ ] Does a plugin that throws an unexpected error keep the server up? (Should: yes — same try/catch in `handleToolCall` that already wraps every built-in.)
* [ ] Does `ARC1_TOOL_MODE=hyperfocused` still work when plugins are loaded? (Open: depends on whether plugins opt into a hyperfocused action.)
* [ ] Does the test harness work without a live SAP system? (Should: yes — mock `AdtClient` / `AdtHttpClient` provided in `arc-1/public/testing`.)

---

## 14. Worked example: samibouge NW 7.50 fork — what fits, what doesn't

**Source:** [main...samibouge:arc-1:feat/nw750-version-fix](https://github.com/arc-mcp/arc-1/compare/main...samibouge:arc-1:feat/nw750-version-fix) (18 commits, +2&nbsp;936 / −151 lines)

This is a real third-party branch that hardens ARC-1 against SAP NetWeaver 7.50 backend quirks. It is the right shape of contribution to test the extension concept against a concrete case. The author bundled fixes, features, and **one site-local capability that requires installing custom ABAP code on the SAP system**. Maintaining customer-side ABAP is exactly what we don't want in upstream ARC-1 — but the underlying need is real, and this is precisely the situation FEAT-61 is designed to handle.

### 14.1 Bucketing the 18 commits

| # | Commit | Subject | Disposition | Why |
|---|--------|---------|-------------|-----|
| 1 | `8e9c12f` | SAPActivate phantom success + CLI/server alignment (NW 7.50) | **Already upstream** ([PR #179](https://github.com/arc-mcp/arc-1/pull/179), merged 2026-04-26) | n/a — superseded |
| 2 | `e3a8de6` | PR #179 follow-ups + auth-refactor rebase | **Already upstream** (folded into #179 / #181) | n/a — superseded |
| 3 | `7fd90ce` | Two-phase activation handshake + NW 7.50 lock-conflict detection | **Upstream as bug fix** | Affects every system that hits preaudit; lock-as-auth-error reclassification is a universal correctness fix |
| 4 | `dd8dd7e` | Activation error formatting (line numbers, decode entities, dedupe) | **Upstream as bug fix** | Universal output-formatting fix |
| 5 | `5618345` | Update unit test assertions for new activation formatting | **Upstream** with #4 | Test-only |
| 6 | `432ce3f` | Opt-in pre-write SAP syntax check + inactive-version diagnostics | **Upstream as opt-in feature** | No SAP-side install; `SAP_CHECK_BEFORE_WRITE` is a clean opt-in flag |
| 7 | `f658687` | `extract-sap-cookies` CLI subcommand | **Upstream as CLI feature** | Just moves an existing script under the `arc1-cli` binary |
| 8 | `b366dda` | Auto-reload cookie file on stale auth | **Upstream as infra** | Universal improvement to cookie auth mode |
| 9 | `b2f024f` | Cookie hot-reload in CSRF token fetch path | **Upstream** with #8 | Bug fix in the same path |
| 10 | `75ee47e` | Reject mixed-case object names on create | **Upstream as safety fix** | TADIR silent-corruption guard — universal |
| 11 | `7fd9935` | Guard STRU writes against non-structures | **Upstream as safety fix** | SE11 silent-corruption guard — universal |
| 12 | `6e7e660` | Guard MSAG create against task numbers on NW 7.50 | **Upstream as safety fix** | TADIR ghost-entry guard; no install needed |
| 13 | `6d9a89d` | Expose MSAG `messages` property in SAPWrite tool schema | **Upstream as schema bug fix** | Pure schema completeness fix |
| 14 | `bb93034` | Classify 404 deletion-blocked errors | **Upstream as error-class fix** | Hint-text correctness — universal |
| 15 | `f2be2be` | Remove incorrect `minRelease 754` gate on `change_package` | **Upstream as gating fix** | Wrong gate; verified against real 7.50 discovery |
| 16 | `635002e` | NW 7.50 TABL read routing, STRU write support, version param | **Upstream as routing fix** | Pure URL rewrite on the standard ADT API; no SAP install |
| 17 | `2456aea` | Release-gated dispatch tables for unavailable types/actions | **Upstream as hint feature** | Just better 404 hints — internal mapping table only |
| 18 | **`8dedcb0`** | **NW 7.50 dump detail via custom ICF endpoint** | **Plugin (FEAT-61)** | **Requires `ZCL_ARC1_DUMP_HANDLER` installed on SAP — the line we don't want to cross upstream** |

**Net result:** out of 18 commits, **exactly one** belongs in the extension model. The rest are vanilla upstream contributions that should land as small, focused PRs (or be cherry-picked individually). Several already have.

### 14.2 The one that needs the extension model: dump detail via custom ICF

**The technical problem.** SAP NW 7.50 exposes the dump *listing* feed (`/sap/bc/adt/runtime/dumps`) but **does not expose a dump detail REST endpoint**. The standard ADT detail URL (`/sap/bc/adt/runtime/dump/{id}`) returns 404 on 7.50 because the underlying handler class was added in a later release. In Eclipse, "view dump" on 7.50 opens ST22 via SAP GUI integration — there's literally no REST surface. ARC-1 cannot fix this purely on the client; the data isn't exposed.

**samibouge's approach.** Ship an ABAP class `ZCL_ARC1_DUMP_HANDLER` (`IF_HTTP_EXTENSION`) deployed at `/sap/rest/arc1/dumps`. The class:

- lists `SNAP_ADT` for the feed shape;
- parses the `RSDUMP_FT` structure with the same FT field-id codes as `CL_WD_TRACE_TOOL_ABAP_UTIL`;
- calls `RS_ST22_READ_SNAPT` for short text / explanation / hints;
- reads source ±10 lines around the abort via `READ REPORT`;
- serialises with `/UI2/CL_JSON`.

The TS side adds release-gated routing in `src/adt/diagnostics.ts`:

```ts
// commit 8dedcb0 in samibouge's fork
function useCustomDumpEndpoint(abapRelease?: string): boolean {
  if (!abapRelease) return false;
  const r = abapRelease.replace(/\D/g, '');
  const num = Number.parseInt(r, 10);
  return Number.isFinite(num) && num >= 750 && num < 751;
}

export async function listDumps(http, safety, options, abapRelease) {
  if (useCustomDumpEndpoint(abapRelease)) {
    try { return await listDumpsViaCustomEndpoint(http); }
    catch { /* fall through to ADT feed */ }
  }
  // ... standard ADT path
}
```

**Why upstream merging this is wrong.** Five concrete costs:

1. **Permanent ABAP-class maintenance.** Once the TS code references `/sap/rest/arc1/dumps`, the ABAP class is part of ARC-1's contract. Upgrading the class on customer systems becomes a coordinated release. Today ARC-1 ships zero ABAP — it lives on top of standard ADT.
2. **Deployment story breaks.** "Install ARC-1 in BTP/Docker, point at SAP, done" becomes "install ARC-1 *and* transport `ZCL_ARC1_DUMP_HANDLER`." This is the deployment surface FEAT-29b explicitly rejected ("requires ABAP-side deployment, violates 'no ABAP installation required' principle").
3. **Failure modes get worse, not better.** A customer without the class installed currently sees a clean "endpoint not available on this release" error. With this commit they'll see `useCustomDumpEndpoint(abapRelease)` route to a URL that returns 404, then fall through to the ADT path that *also* returns 404. Two failures, one user-visible message.
4. **Slippery-slope precedent.** Once we accept one custom ICF, the next request is inevitable: custom RFC reader, custom ATC variant runner, custom user-info endpoint, custom STMS bridge. Each one a permanent maintenance burden. The line stays bright only if it's at zero.
5. **Centralised-gateway pitch erodes.** ARC-1's differentiator (per the [Vision](../../docs_page/roadmap.md#vision)) is "one instance per SAP system, no SAP-side install, no shared service accounts." Adding even one custom ICF dilutes that pitch.

But the underlying need — letting one customer fill an NW 7.50 hole with their own ABAP code — is real and reasonable. It just doesn't belong in upstream.

### 14.3 What this looks like as a FEAT-61 plugin

The same capability, owned by the customer, leveraging the extension model:

**Customer repo `arc1-plugin-nw750-dumps`** (separate from ARC-1):

```
arc1-plugin-nw750-dumps/
├── package.json           # peerDependencies: { "arc-1": "^0.7" }
├── src/
│   └── index.ts           # defineTool() + http calls
├── abap/
│   └── ZCL_ARC1_DUMP_HANDLER/   # the ABAP class, owned by customer
│       └── README.md      # SICF setup steps
└── README.md
```

**`src/index.ts` sketch (Phase 2, additive-only model):**

```ts
import { defineTool, OperationType, AdtApiError, z } from 'arc-1/public';

export default {
  apiVersion: 1 as const,
  name: 'nw750-dumps',
  version: '0.1.0',
  tools: [
    defineTool({
      name: 'Custom_ListNw750Dumps',
      description:
        'List ABAP short dumps via custom NW 7.50 ICF endpoint /sap/rest/arc1/dumps. ' +
        'Requires ZCL_ARC1_DUMP_HANDLER deployed and SICF-activated on the target system. ' +
        'Use this on NW 7.50 systems where SAPDiagnose(action="dumps") returns 404 for detail.',
      schema: z.object({ user: z.string().optional(), maxResults: z.coerce.number().optional() }),
      policy: { scope: 'read', opType: OperationType.Read },
      availableOn: 'all',
      async handler(args, ctx) {
        // Plugin only registers itself when admin opts in via ARC1_PLUGINS.
        // Skipping the abapRelease check here is fine — the LLM sees this tool
        // only on systems where the admin chose to load this plugin.
        const resp = await ctx.client.http.get('/sap/rest/arc1/dumps', {
          Accept: 'application/json',
        });
        return { content: [{ type: 'text', text: resp.body }] };
      },
    }),
    defineTool({
      name: 'Custom_GetNw750Dump',
      description: 'Read ABAP dump detail via custom NW 7.50 ICF endpoint. ' +
        'Dump ID format: datum;uzeit;ahost;uname;mandt;modno.',
      schema: z.object({ id: z.string() }),
      policy: { scope: 'read', opType: OperationType.Read },
      availableOn: 'all',
      async handler(args, ctx) {
        try {
          const resp = await ctx.client.http.get(
            `/sap/rest/arc1/dumps/${encodeURIComponent(args.id)}`,
            { Accept: 'application/json' },
          );
          return { content: [{ type: 'text', text: resp.body }] };
        } catch (err) {
          if (err instanceof AdtApiError && err.statusCode === 404) {
            return {
              content: [{
                type: 'text',
                text: 'NW 7.50 dump handler not deployed on this system. ' +
                  'Install ZCL_ARC1_DUMP_HANDLER (see arc1-plugin-nw750-dumps/abap/README.md) ' +
                  'and activate SICF node /sap/rest/arc1/dumps.',
              }],
              isError: true,
            };
          }
          throw err;  // central formatter handles other typed errors
        }
      },
    }),
  ],
};
```

**Operator workflow:**

```bash
# admin installs ABAP class once via abapGit / SE38 transport
# admin installs plugin
npm install arc1-plugin-nw750-dumps
# admin opts in
export ARC1_PLUGINS=$(node -p "require.resolve('arc1-plugin-nw750-dumps')")
# restart ARC-1 — plugin tools appear in tools/list for users with read scope
```

**What ARC-1 core ships:** nothing changes. `src/adt/diagnostics.ts` stays as it is today. The `useCustomDumpEndpoint` branch and the `/sap/rest/arc1/dumps` URL never enter the upstream codebase.

### 14.4 Honest tension: additive-only vs. route replacement

The Phase 1+2 model in §6 lets plugins **add** `Custom_*` tools but **not replace** built-in ones. Under that constraint, samibouge's seamless model — where `SAPDiagnose(action="dumps")` *transparently* uses the custom endpoint on NW 7.50 — is not directly reproducible. The LLM has to learn "on NW 7.50, call `Custom_GetNw750Dump` instead of `SAPDiagnose(action="dumps")`."

This is a real UX cost. There are three answers:

**Answer 1 — Live with it.** Ship Phase 1+2 as designed; LLMs that talk to NW 7.50 systems pick up the alternate tool from the tool description. Pros: clean trust boundary, no new mechanism. Cons: more LLM steering required; per-release-conditional routing logic ends up in prompts/skills instead of code.

**Answer 2 — Add a route-replacement hook in Phase 1.5.** Allow a plugin to register a replacement *handler* for a specific `(tool, action[, predicate])` tuple, where the predicate can read `cachedFeatures.abapRelease` and similar. Sketch:

```ts
registerRoute({
  tool: 'SAPDiagnose',
  action: 'dumps',
  when: features => /^7\.50/.test(features.abapRelease ?? ''),
  // when true, this handler replaces the built-in for matching requests
  handler: async (args, ctx) => { /* call /sap/rest/arc1/dumps */ },
});
```

Pros: matches samibouge's actual UX; one code path per release. Cons: bigger blast radius if a plugin gets the predicate wrong; requires fail-fast collision detection across plugins; complicates the audit trail (which plugin's route ran?).

**Answer 3 — Manifest-only routes in Phase 3.** A JSON entry (no JS) declaring "for SAPDiagnose action=dumps when abapRelease starts with 7.50, GET this path with this header, return JSON shape X". The core has a generic interpreter. Safer than Answer 2 but limited to thin mappings; cannot do the FT structure parsing samibouge needs (so it would still need an additional response transformer — back to JS).

**Provisional recommendation:** ship Phase 1+2 *additive-only* and treat the NW 7.50 dump UX gap as the canonical motivating example for whether to add Answer 2 in a Phase 1.5 follow-up. Don't speculate on Answer 2 until at least two real plugin authors hit the same UX wall — one example does not justify a route-replacement hook with all its blast radius.

### 14.5 Implications for the recommended next step (§12)

The case study tightens the §12 plan rather than changing it:

1. **Bucket B + C + D from §14.1 are independent of FEAT-61.** They should land as ordinary upstream PRs whether FEAT-61 ever ships. They are 13 of 18 commits and most of the line count.
2. **The dump-handler commit is the canonical "wait for FEAT-61" example.** Don't merge it. Don't reject it on technical grounds either — the work is correct for what it does. Reject on *scope* grounds and link the author to FEAT-61 when Phase 1+2 ship.
3. **Phase 1+2 design holds.** The additive-only model is enough to unblock the dump-handler use case. Whether to add Phase 1.5 (route replacement) is a future call driven by real demand, not by this single example.
4. **The `availableOn` field probably needs a per-feature predicate.** A plugin that targets only NW 7.50 should be able to say so declaratively, so the registry can hide the tool on other systems. This is a small Phase 1 design tweak: extend `availableOn: 'onprem' | 'btp' | 'all'` to optionally accept a `(features) => boolean` predicate. Cheap to add now, expensive later.

### 14.6 What to communicate back to samibouge

A focused reply along these lines (no commitment yet, since FEAT-61 is P3):

> Thanks for the deep NW 7.50 work. About 13 of the 18 commits are clean upstream candidates and we'd be happy to take them as small focused PRs (some already merged via #179). The custom ICF endpoint commit (`8dedcb0`) we're not going to merge upstream — installing `ZCL_ARC1_DUMP_HANDLER` on every customer's SAP system is the line ARC-1 doesn't cross. We've sketched a plugin model in [docs/research/2026-04-26-tool-extension-points.md](2026-04-26-tool-extension-points.md) (FEAT-61) that is purpose-built for exactly this: you keep the ABAP class in your own repo, ship a small TS plugin that wraps `client.http.get('/sap/rest/arc1/dumps')`, and admins opt in via `ARC1_PLUGINS=...`. Until FEAT-61 lands you can already run a private fork; once it lands you can publish the plugin separately without forking ARC-1.

That answers the user-stated concern ("don't want custom code of mine") while also giving a concrete path that doesn't waste samibouge's work.
---

## 15. Case study: integrating dassian-adt v2.0 as an ARC-1 extension

A concrete worked example of how each extension pattern from §5 would (or would not) accommodate a real third-party MCP server: [dassian-adt](https://github.com/messianic-swop450/dassian-adt) (the upstream repository `DassianInc/dassian-adt` no longer exists; this is the surviving fork from `messianic-swop450`, captured 2026-04-26).

### 15.1 What dassian-adt is

dassian-adt v2.0 is a competing TypeScript MCP server for SAP ABAP, MIT-licensed, ~270 KB of TypeScript. It is built on top of [`abap-adt-api`](https://github.com/marcellourbani/abap-adt-api) (Marcello Urbani's ADT HTTP client) and ships with ~39 tools across 12 domain handlers.

| Property | Value |
|----------|-------|
| Stack | Node 18+, TypeScript 5.7, `@modelcontextprotocol/sdk` 1.28, `abap-adt-api` 7.1 |
| License | MIT |
| Tools | ~39 across 12 handler classes |
| Architecture | One `BaseHandler` per domain; `index.ts` wires them; `validateAndHandle` dispatches |
| Auth | Basic, OAuth (XSUAA, Entra ID), or built-in OAuth login HTML form |
| Multi-system | Yes — `SAP_SYSTEMS` env var, `sap_system_id` auto-injected into every tool schema |
| Transports | stdio + Streamable HTTP |
| MCP capabilities | `tools`, `prompts`, `logging` (sampling and elicitation used internally) |

### 15.2 Tool inventory (39 tools, 12 handlers)

| Handler | Tools |
|---------|-------|
| `SourceHandlers` | `abap_get_source`, `abap_set_source`, `abap_edit_method`, `abap_set_class_include`, `abap_pretty_print`, `abap_revisions`, `abap_get_function_group` |
| `ObjectHandlers` | `abap_create`, `abap_delete`, `abap_activate`, `abap_search`, `abap_activate_batch`, `abap_object_info` |
| `DataHandlers` | `abap_query`, `abap_table` |
| `DdicHandlers` | `ddic_element`, `ddic_references` |
| `GitHandlers` | `git_repos`, `git_pull` |
| `QualityHandlers` | `abap_syntax_check`, `abap_atc_run`, `abap_atc_variants`, `abap_where_used`, `abap_find_definition`, `abap_fix_proposals` |
| `RapHandlers` | `rap_binding_details`, `rap_publish_binding` |
| `RunHandlers` | `abap_unlock`, `abap_run` |
| `SystemHandlers` | `login`, `healthcheck`, `abap_get_dump`, `abap_inactive_objects`, `abap_annotation_defs`, `raw_http` |
| `TestHandlers` | `abap_create_test_include`, `abap_unit_test` |
| `TraceHandlers` | `traces_list`, `traces_set_parameters`, `traces_create_config`, `traces_hit_list`, `traces_statements`, `traces_db_access`, `traces_delete`, `traces_delete_config` |
| `TransportHandlers` | `transport_create`, `transport_assign`, `transport_release`, `transport_list`, `transport_info`, `transport_delete`, `transport_set_owner`, `transport_add_user`, `transport_contents` |

### 15.3 Coverage vs ARC-1's 12 intent tools

Most dassian-adt tools have a one-to-one ARC-1 equivalent — they just live as `action`/`type` parameters on a shared intent tool rather than as separate tools. The interesting subset is what is *not* yet in ARC-1:

| dassian-adt feature | ARC-1 status | Notes |
|---------------------|--------------|-------|
| `raw_http` escape-hatch tool | None — by design | Conflicts with ARC-1's "every endpoint has a safety guard" invariant. dassian-adt's own description warns "NEVER use raw_http to POST to lock endpoints" — exactly the kind of foot-gun ARC-1 wants to make impossible. |
| `abap_unlock` (manual unlock) | None | Useful for orphaned-lock recovery. Could be added as `SAPManage(action="unlock_object")`. |
| `abap_create_test_include` | None | Convenience for testclass scaffolding. Sits naturally in `SAPWrite`. |
| `traces_create_config` / `traces_set_parameters` / `traces_delete_config` | Partial — `SAPDiagnose(action="traces")` reads only | Trace lifecycle (create config → run → analyze → delete) is more granular in dassian-adt. |
| `abap_atc_variants` (list available variants) | None | ARC-1 takes a single variant param. Listing available variants is a small read tool that fits `SAPDiagnose`. |
| `transport_add_user` | None — `SAPTransport` has `reassign` | dassian-adt's transport tools cover a few actions ARC-1 marked as "deferred" in [FEAT-39](../../docs_page/roadmap.md#feat-39). |
| `abap_get_function_group` (parallel-fetch) | Open in [FEAT-18](../../docs_page/roadmap.md#feat-18) | Same idea, not yet built. |
| `abap_set_class_include` (per-include surgical write) | Partial — `SAPWrite type=CLAS include=...` exists for read but not write | Real gap — class includes can only be written via full source today. |
| MCP **prompts** (slash-command templates served via MCP) | None — ARC-1 ships [skills/](../../skills/) as files | dassian-adt registers `fix-atc`, `transport-review`, `class-overview`, `release-transport` as MCP `prompts`. ARC-1 ships the same idea as documentation files copied into client config — different distribution model. |
| Sampling integration (`askClaude(systemPrompt, userMessage)` inside handlers) | None | Lets a handler ask the LLM a sub-question without breaking out to the user. |
| Elicitation as a first-class flow control | Used sparingly via [src/server/elicit.ts](../../src/server/elicit.ts) | dassian-adt prompts for missing transport/package interactively; ARC-1 returns structured errors with hints. |
| OAuth-mediated HTTP login form (HTML + cookie + PKCE) | Not in core — XSUAA on BTP only | dassian-adt embeds its own OAuth provider so users can self-supply SAP credentials per session. Conflicts with ARC-1's "admin controls everything" model. |
| Multi-system with `sap_system_id` auto-injection | Deferred in [FEAT-59](../../docs_page/roadmap.md#feat-59) | dassian-adt does this today by mutating every tool's input schema at startup. |

Things ARC-1 has and dassian-adt does **not**:

* Centralized safety system (`allowWrites`, `allowedPackages`, `allowFreeSQL`, `denyActions`).
* Per-action scope policy with implication rules (`admin → all`, `write → read`, `sql → data`).
* Principal Propagation (per-user SAP identity via BTP Destination Service).
* Structured audit log with multiple sinks (stderr / file / BTP Audit Log Service).
* CDS impact analysis, RAP preflight, `scaffold_rap_handlers`, ABAP-cloud / on-prem feature gating.
* Hyperfocused mode (one-tool ~200-token schema).
* Object cache (memory / SQLite) with warmup.
* `abaplint` integration for local lint + formatter.

In one sentence: **dassian-adt is a single-tenant developer-laptop SAP MCP server with very clever workflow features; ARC-1 is a multi-tenant centrally-administered gateway**. The two address overlapping but different problems.

### 15.4 The hard architectural mismatch: HTTP client identity

This is the single biggest obstacle to integration. **dassian-adt is built on `abap-adt-api`; ARC-1 is built on its own `AdtHttpClient`** ([src/adt/http.ts](../../src/adt/http.ts)). The two HTTP layers are not interchangeable:

| Concern | `abap-adt-api` | ARC-1's `AdtHttpClient` |
|---------|----------------|-------------------------|
| Login flow | `client.login()` — owns cookies/CSRF inside the lib | Discovery probe + lazy CSRF, owned by ARC-1 |
| Auth methods | Basic, OAuth token (string) | Basic, cookie, BTP service key (OAuth), Destination Service, PP via `SAP-Connectivity-Authentication` or `Proxy-Authorization` jwt-bearer |
| Stateful sessions | `client.stateful = stateful` global flag | `withStatefulSession()` per call, isolated client clone |
| Per-user identity | None — one client per credential set | Per-request client built by `createPerUserClient(jwt)` |
| MIME negotiation | Hard-coded per endpoint | Discovery-driven, with proactive MIME map and 415/406 fallback |
| Audit | None | `http_request` audit event per call, request-id correlation |
| Concurrency control | None | Optional semaphore (`SAP_MAX_CONCURRENT`) |
| Safety hooks | None | Every public method calls `checkOperation()` first |

**Consequence:** any "wholesale port" of dassian-adt either (a) keeps `abap-adt-api` and runs *two* HTTP stacks side by side with two separate SAP sessions per user — which silently breaks PP, audit, and safety; or (b) rewrites every handler to call `client.http.get/post/put/delete` instead of `adtclient.lock/setObjectSource/atcCheckVariant/...`. Option (b) is real engineering work, not a copy-paste port.

### 15.5 Feature-by-feature: can a plugin author build this under FEAT-61 today?

The right framing for this case study is **not** "how do we wrap dassian-adt as a plugin" but "for each capability dassian-adt invented, can a plugin author reproduce it with the §7 `ToolContext` as proposed, and if not, what's the smallest API change that makes it possible?"

Five verdict levels:

* ✅ **Buildable today** with the §7 `ToolContext` as proposed — no API change needed.
* 🟢 **Buildable with a small public-API addition** — friction is annoying, the fix is a one-liner.
* 🟡 **Needs a `ToolContext` capability that is currently missing** — must be added in Phase 1 to make this kind of feature work at all.
* 🔵 **Server-level capability, not a plugin concern** — belongs in core ARC-1 (or a different roadmap item), not in the plugin API.
* ❌ **Intentional non-goal** per §10 — stays blocked by design.

#### 14.5.1 Domain tools (all ✅)

Every dassian-adt tool that is "call this ADT endpoint, parse the result, return it" is a one-line `defineTool()` whose handler calls `ctx.client.http.get/post/put/delete`. No new primitives needed.

| dassian-adt tool | Plugin handler skeleton |
|------------------|--------------------------|
| `abap_unlock` | `ctx.client.http.post(unlockUrl, body)` |
| `abap_set_class_include` | `ctx.client.http.withStatefulSession(s => lock → put include → unlock)` |
| `abap_create_test_include` | `ctx.client.http.put(.../includes/testclasses, source)` |
| `abap_atc_variants` | `ctx.client.http.get(.../atc/variants)` |
| `traces_*` (8 tools) | various `ctx.client.http.*` calls |
| `abap_get_function_group` | parallel `Promise.all` of `ctx.client.http.get` calls (FEAT-18 territory) |
| `abap_annotation_defs` | `ctx.client.http.get(/sap/bc/adt/ddic/cds/annotation/definitions)` |
| `ddic_references` | `ctx.client.http.post(.../ddic/where-used, payload)` |
| `abap_revisions` | `ctx.client.http.get(...versions, Accept: atom+xml)` (already in `AdtClient`) |
| `abap_pretty_print` | `ctx.client.http.post(.../prettyprinter)` (already in `AdtClient`) |

**~32 of the ~39 dassian-adt tools fall in this bucket.** A plugin author with the §7 `ToolContext` writes them today.

#### 14.5.2 Workflow patterns (mostly ✅, two 🟢)

The interesting IP in dassian-adt is not the tool list — it's the workarounds and orchestration logic. Each one needs a primitive; here is what's available now and what's missing.

| Pattern | Primitive needed | Status | Plugin code shape |
|---------|------------------|:--:|-------------------|
| ATC fallback (try `createAtcRun`; on `ciCheckFlavour=true`, fall back to `atcCheckVariant` + `atcWorklists`) | Try one HTTP call, catch error, try alternative | ✅ | `try { await ctx.client.http.post(A); } catch (e) { await ctx.client.http.post(B); }` |
| `METADATA_TYPES` set (use `transportReference` for FUGR/MSAG/ENHS instead of lock+write) | A constant Set + branch on type | ✅ | `if (METADATA_TYPES.has(type)) { /* transportReference path */ } else { /* lock+write path */ }` |
| DDLS DELETE bypass (avoid library appending `?corrNr` that SAP rejects) | Direct DELETE with custom query string | ✅ | `ctx.client.http.delete(`${url}?lockHandle=${h}`)` — plugin builds the path |
| `IF_OO_ADT_CLASSRUN` `~run` vs `~main` detection (release-dependent method name) | One GET on the interface source + grep | ✅ | `const src = await ctx.client.http.get('/sap/bc/adt/oo/interfaces/IF_OO_ADT_CLASSRUN/source/main'); const method = src.includes('~run') ? '~run' : '~main';` |
| Smart-redirect hints ("you passed a transport ID where an object name was expected") | Regex on input + helpful error message | ✅ | Plugin returns `{ content: [...], isError: true }` with the hint |
| Retry-on-lock with backoff (3 attempts, 0/3/8s) | try/catch + `setTimeout` | ✅ | Plain JavaScript loop. Optional `ctx.notify` for progress messages (see 14.5.3). |
| Lockless DDLS write detection (read object metadata; if DDLS without lock support, skip lock) | Read object metadata before deciding strategy | ✅ | Plugin decides based on type + metadata |
| `withSession` auto-reconnect on session expiry (catch session-timeout, re-login, retry the wrapped block) | Detect session-timeout error class, re-issue request | 🟢 | ARC-1's `AdtHttpClient` already retries 401 internally per request. For *multi-step* blocks (lock→write→unlock as one unit), a plugin would write its own try/catch around `withStatefulSession`. **Recommendation:** ship `ctx.client.http.withRetryOnSessionExpiry(fn)` in §4 — saves every plugin from re-implementing the same try/catch. Not a Phase-1 blocker. |
| `requireTransport` (read `lockResult.IS_LOCAL` / `CORRNR`, throw if non-`$TMP` and no transport supplied) | Need access to the lock response | 🟢 | Today, `lockObject()` lives in `src/adt/crud.ts` and is *not* on `AdtClient`. Plugins would have to deep-import. **Required §4 addition:** expose `client.lock(objectUrl) → { lockHandle, corrNr, isLocal }` and `client.unlock(objectUrl, lockHandle)` on the public surface. Without this, plugins cannot build any lock-aware write tool. |
| `resolveTaskNumber` (request → task via E070 query) | A SAP table query | ✅ | Plugin calls `ctx.client.http.post('/sap/bc/adt/datapreview/freestyle', "SELECT TRKORR FROM E070 WHERE STRKORR = '...'")` *or*, when allowed, `ctx.client.runQuery(...)`. Helper recommended (see 14.6). |
| `classifyTask` (TRFUNCTION='S' via custom PUT XML) | One PUT with arbitrary XML body | ✅ | `ctx.client.http.put('/sap/bc/adt/cts/transportrequests/X', '<tm:root...trfunction="S"/>')` |
| `resolveNestedUrl` / `resolveFunctionModuleUrl` (FUGR/I, FUGR/FF auto-discovery) | `searchObject` + URL-shape regex | ✅ | `client.searchObject` is already public on `AdtClient`. Plugin reimplements the regex; helper recommended (see 14.6). |

**Conclusion:** every workflow pattern dassian-adt invented can be reproduced inside a plugin handler with the proposed `ToolContext`, **except** for any pattern that needs the lock response object — which is the missing 🟢 in the table above. **Promoting `client.lock()` / `client.unlock()` to the public API is the single most impactful §4 addition** for real-world plugin authors.

#### 14.5.3 MCP capability features (all 🟡 — must be added to `ToolContext`)

Three MCP features dassian-adt uses extensively are *not* in the proposed §7 `ToolContext`. A plugin author cannot build these today. Each is a 5-line injection in the framework — but it has to happen for the API to be useful.

| dassian-adt usage | MCP primitive | Status | What to add |
|-------------------|---------------|:--:|-------------|
| `confirmWithUser(message, details)` — yes/no plus optional fields | `Server.elicitInput()` | 🟡 | **Add `ctx.elicit?: (params) => Promise<ElicitResult>`** to §7. Optional because the connected MCP client may not support elicitation; plugins detect and fall back (dassian-adt does this — `if (!this._elicit) return true`). |
| `notify(message, level)` — UI-visible progress in Claude Code | `Server.sendLoggingMessage()` | 🟡 | **Add `ctx.notify?: (level, message) => Promise<void>`** to §7. Distinct from `ctx.logger` which goes to ARC-1's stderr/audit pipeline — `notify` goes back to the MCP client for the user to see. |
| `askClaude(systemPrompt, userMessage, maxTokens?)` — handler asks the LLM a sub-question | `Server.createMessage()` (sampling) | 🟡 | **Add `ctx.sampling?: (systemPrompt, userMessage, maxTokens?) => Promise<string>`** to §7. Already noted in §15.6 (was Open Question 11) — promote to Phase-1 yes. |

These three are the entire reason §7's current `ToolContext` is *not yet* sufficient for "real-world ABAP-MCP-style plugins". Without them, plugins can do reads/writes but cannot interact with the user mid-flow, cannot show progress on long operations, and cannot delegate sub-decisions to the LLM. Cheap to add (the underlying MCP `Server` instance is already available inside `handleToolCall`); the cost is just deciding to expose them.

#### 14.5.4 Server-level capabilities (🔵 — not per-plugin)

| Feature | Why it's not a plugin concern | Where it belongs |
|---------|-------------------------------|------------------|
| MCP `prompts` capability (`fix-atc`, `transport-review`, `class-overview`, `release-transport` slash templates) | Prompts are registered against the MCP `Server` once at startup. They are not tied to a specific tool. Letting plugins contribute prompts is possible but adds a second registration concept; better to let core ARC-1 own prompts. | Core ARC-1 (separate roadmap item, possibly a new `DOC-XX` for the four templates). The plugin API can extend later (Phase 5+) if customers ask. |
| Multi-system `sap_system_id` injection (mutate every tool's input schema at startup) | Touches the registry's `tools/list` response, not any single plugin tool. Should auto-apply to plugin tools too. | Core ARC-1 — [FEAT-59](../../docs_page/roadmap.md#feat-59). When/if FEAT-59 ships, the registry should auto-inject `sap_system_id` into plugin tools the same way it does for built-ins. |
| `validateAndHandle` required-field check from JSON schema | ARC-1 already validates via Zod in `handleToolCall`. Plugins ship Zod schemas (per §7). Same code path. | Already in core. |
| Auth providers (basic / OAuth / Entra / built-in HTML login form) | Auth is core-only per §10 (centralized control invariant). | Core ARC-1, never plugins. |

#### 14.5.5 Intentional non-goals (❌ — stay blocked)

| Feature | Why blocked |
|---------|-------------|
| `raw_http` (arbitrary HTTP execution as a tool) | Defeats the safety system: any LLM call to `raw_http` bypasses `checkOperation()`, `denyActions`, and audit semantics. dassian-adt's own description has more "DO NOT" warnings than parameters. **Make it harder than just a docs note:** registry refuses to register a tool whose `policy.opType` is missing or whose handler signature is "raw HTTP passthrough". |
| Built-in OAuth HTML login form | Per-session "type your SAP password into a web form" inverts the centralized-control model ARC-1 was built around. ARC-1 uses XSUAA on BTP / OIDC self-hosted. |
| Adding new MCP transports | Transport ownership stays in core (§10). |
| `BaseHandler` inheritance abstraction | ARC-1's handler code is split per intent tool with shared helpers via plain function imports. Inheritance would not improve readability and would conflict with the registry-based dispatch in Phase 1. |

### 15.6 Concrete updates the case study makes to the FEAT-61 design

Walking through dassian-adt feature-by-feature surfaced one design-confirming finding and three design-changing findings for the §7 `ToolContext`. Here is the diff against the existing research doc:

**1. `ToolContext` gains three optional capabilities (§7 update — required for Phase 1):**

```ts
interface ToolContext {
  readonly client: AdtClient;
  readonly safety: SafetyConfig;
  readonly cache?: CachingLayer;
  readonly logger: Logger;             // ARC-1-side stderr/audit
  readonly config: PublicServerConfig;
  readonly authInfo?: AuthInfo;
  readonly requestId: string;

  // ── Driven by dassian-adt feature analysis ──
  /** MCP elicitation: forms, choices, confirmations. May be undefined when
   *  the connected client does not support elicitation. */
  readonly elicit?: (params: ElicitParams) => Promise<ElicitResult>;

  /** MCP sendLoggingMessage: progress visible in the MCP client UI.
   *  Distinct from `logger` (which goes to ARC-1's audit pipeline). */
  readonly notify?: (level: 'info' | 'warning' | 'error', message: string) => Promise<void>;

  /** MCP createMessage (sampling): handler-internal LLM sub-questions.
   *  May be undefined when the client does not support sampling. */
  readonly sampling?: (systemPrompt: string, userMessage: string, maxTokens?: number) => Promise<string>;
}
```

All three are `?`-optional because the connected MCP client may not advertise the capability. Plugins detect and fall back, identical to how dassian-adt's `confirmWithUser` returns `true` when `_elicit` is undefined.

**2. Public surface gains `client.lock()` / `client.unlock()` (§4 update — required for Phase 1):**

The lock primitives currently live in `src/adt/crud.ts` and are not on `AdtClient`. Without them, plugins cannot build any lock-aware write tool. The public surface gains:

```ts
class AdtClient {
  // ... existing read methods ...
  lock(objectUrl: string): Promise<{ lockHandle: string; corrNr?: string; isLocal: boolean }>;
  unlock(objectUrl: string, lockHandle: string): Promise<void>;
}
```

These are thin wrappers around the existing `crud.ts` functions. The signatures already exist internally; this is just a re-export.

**3. Optional helpers that reduce boilerplate (§4 update — nice to have, not blocking):**

```ts
// arc-1/public/sap-helpers
export function resolveNestedUrl(client: AdtClient, name: string, type: string, fugr?: string)
  : Promise<{ objectUrl: string; sourceUrl: string }>;

export function resolveTaskFromRequest(client: AdtClient, requestNumber: string)
  : Promise<string>;

export function classifyTaskAsCorrection(client: AdtClient, taskNumber: string)
  : Promise<void>;

// On client.http
client.http.withRetryOnSessionExpiry<T>(fn: () => Promise<T>): Promise<T>;
```

If 80% of plugins re-implement these by hand, ship them. If we observe that only 1–2 plugins ever need them, leave as documented patterns.

**4. Registry must enforce one anti-pattern (§10 update — confirmed):**

The case study makes the §10 `raw_http` anti-pattern concrete: the registry refuses to register a tool whose `policy.opType` is missing, or whose handler signature signals "arbitrary HTTP passthrough". Document an explicit `OperationType.Raw` rejection rule.

**5. MCP `prompts` flagged as a separate roadmap item, not part of FEAT-61 (§11 update):**

dassian-adt validates the LLM-usefulness of MCP prompts. Track this as a separate core-ARC-1 roadmap item (e.g. a new `FEAT-62: MCP Prompts (slash-command templates)`), not as part of the extension API. Phase-5+ extension work can revisit whether plugins should also contribute prompts.

### 15.7 Summary: how a plugin author maps each dassian-adt feature

The full integration model under FEAT-61 with the §15.6 additions applied:

* **~32 of ~39 dassian-adt tools (the domain reads/writes):** straight `defineTool()` calls. Plugin author writes them today.
* **All workflow workarounds (ATC fallback, METADATA_TYPES, DDLS bypass, retry-on-lock, FUGR auto-discovery, smart redirects, IF_OO_ADT_CLASSRUN detection):** buildable in the plugin handler. The §4.5 expanded public surface gives them what they need.
* **Mid-flow user interaction (elicitation, progress notify, internal sampling):** **buildable only after §7 ToolContext gains the three new optional capabilities listed in §15.6.** This is the change the case study most strongly recommends for Phase 1.
* **MCP prompts:** separate core-ARC-1 roadmap item; plugins do not contribute prompts in v1.
* **Multi-system `sap_system_id`:** FEAT-59 territory; registry handles it transparently for plugin tools.
* **`raw_http` / OAuth HTML form / new transports / new auth providers:** stay blocked.

That accounts for every distinctive feature the dassian-adt fork demonstrates. The conclusion the case study returns to the extension-API design is small and concrete: **Phase 1 of FEAT-61 must ship `ctx.elicit`, `ctx.notify`, `ctx.sampling` in `ToolContext` and `client.lock()` / `client.unlock()` on the public `AdtClient`**, and the `raw_http`-style escape hatch must be refused by the registry. With those four additions, a plugin author can reproduce ~95% of dassian-adt's distinctive workflow IP without forking ARC-1.

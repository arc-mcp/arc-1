# ARC-1 Extension Framework — v1 Specification (FEAT-61)

> **Status:** ✅ **IMPLEMENTED 2026-06-17** — PR1–PR5 + loader / `package.json#exports` / CLI + the `create-arc1-extension` skill; full unit suite green (3620) and **live-verified on a4h** (code + manifest tiers return real SAP source). Since shipped: gated **non-ADT (OData/ICF) writes** (`SAP_ALLOW_PLUGIN_RAW_WRITES`) + **`classRun`** (see the post-merge banner). Still deferred: **package-aware ADT *object* writes** (the v2 `ctx.write` vocabulary). Derived from [`extension-framework-deep-research.md`](2026-06-17-extension-framework-deep-research.md); retained as the design reference.
> **Stability:** The plugin API is **`@experimental` — it may break in any release.** A single `apiVersion` integer is the only compatibility fuse.
> **Date:** 2026-06-17. Tracks roadmap FEAT-61, issues #187 / #332.
> **Review:** adversarial review (2026-06-17) — 1 blocker (B1, fixed inline in §2) + integration/signature clarifications in **§16**. Address §16 before PR1.

> **Post-review hardening (2026-06-17, PR #454 — these supersede the design where they differ):**
> A second adversarial (Codex) review of the implementation drove the following **v1 narrowings**, all conservative-by-default:
> - **`ctx.http` is READ-ONLY (`GET`/`HEAD`).** `post/put/delete/withStatefulSession` are removed from the plugin surface for v1. Reason: a raw write can't be constrained by `SAP_ALLOWED_PACKAGES` (package resolution needs the ADT object-URL shape), so shipping un-package-gated writes would bypass the safety ceiling. The §5 "ADT object writes still get checkPackage" promise is deferred with the rest of writes to **v2** (a package-aware write vocabulary). This applies to BOTH tiers (the manifest tier was already GET-only — §8).
> - **`ctx.client` read-only is enforced at RUNTIME**, not just by the `ReadOnlyAdtClient` type: `createReadOnlyAdtClient` wraps it in a Proxy that blocks `http`/`safety`/`withSafety`/package-mutators, so `(ctx.client as any).http` resolves to `undefined`. (Closes the residual half of B1 — a type-only narrowing was castable.)
> - **`ctx.cache` is removed** from the public `ToolContext` for v1: the raw `CachingLayer` exposed cache-only source/where-used reads that bypass the per-user `cacheSecurity` revalidation (PP cross-user leak class). A safe per-user cache facade is a v2 item.
> - **`availableOn` is enforced** in `tools/list` against the resolved system type (was inert metadata). **`pluginName`** now rides `tool_call_start`/`tool_call_end` audit events; the `http_request`-level `pluginName` tag (§5.4/§9) is deferred — `ctx.http` calls are still logged via the underlying `http_request` event, just untagged.
> - **Loader handles `.js` + `.json` only.** Single-directory (`package.json#main`) loading and `package.json#arc1.requires` ceiling-intersection (§3.1/§6/§7) are deferred to **v2** — not implemented in v1. The ceiling already constrains every call via scope + `checkOperation`, so `requires` would only be a redundant narrowing.
> - **Plugin tools are excluded from hyperfocused mode** — both hidden from `tools/list` AND refused at dispatch (a client that knows a `Custom_` name still gets "Unknown tool"), matching §1 "hyperfocused participation out of scope".
>
> **Post-merge review (2026-06-18) — further narrowings:**
> - **`ctx.client` is a *plain-read* facade** — `getTableContents`/`runQuery`/`runTableQuery` (the `data`/`sql`-scoped reads) are now ALSO blocked at runtime + omitted from `ReadOnlyAdtClient`, so a `read`-declared plugin can't escalate to data/SQL. v1 plugins have no data/SQL surface; a scoped `ctx.data`/`ctx.sql` is a v2 item.
> - **`policy.opType` is validated at registration** — a plugin's declared `scope` must cover its `opType`'s required scope (fail-fast otherwise). It is reused for v2 write gating.
>
> **Raw non-ADT writes shipped (2026-06-19, v2 §2.2 "Path B"):** `ctx.http` regained `post`/`put`/`delete` for **non-ADT** (OData/ICF) paths behind the default-off `SAP_ALLOW_PLUGIN_RAW_WRITES` opt-in (+ `allowWrites` + `write` scope). Writes to `/sap/bc/adt/…` are still **always refused** (normalization-proof) — ADT object writes remain the v2 package-aware `ctx.write` vocabulary. `SAP_ALLOWED_PACKAGES` doesn't apply to OData/ICF paths. So the §5 "read-only" framing below is superseded: reads are open, non-ADT writes are opt-in, ADT object writes deferred.

> ⚠️ **AUTHORITATIVE SOURCE.** The sections below are the **original design** (retained for rationale).
> Several API surfaces shown in code blocks — the `ctx` fields in §2 (`ctx.cache`/`ctx.safety`/`ctx.config`),
> the `SafeHttpClient` write methods in §5 (`post`/`put`/`delete`/`withStatefulSession`/`fetchCsrfToken`),
> directory loading in §7, and the manifest `POST`/`response.extract` in §8 — were **narrowed or deferred**
> before v1 shipped (see the banners above). **For the shipped API, read `src/public/types.ts` and
> [docs_page/extensions.md](../../docs_page/extensions.md); do not implement against the snippets below
> without cross-checking.**

---

## 1. Scope

**v1 ships:** a typed `ToolRegistry`; a public API boundary (`arc-1/public`); local **trusted JS plugins** loaded via `ARC1_PLUGINS=`; a scoped **read-only declarative manifest tier**; `Custom_*` tools that inherit ARC-1's whole gateway (per-user PP, the 7-scope + allow\* ceiling, audit). Additive-only.

**Out of scope (v1):** replacing built-in tools; custom/dynamic scopes; hyperfocused participation; framework-managed ABAP deployment; non-SAP egress; sandboxing; marketplace; hot-reload; manifest **writes**. (See research §9.3.)

**Authorization model:** extension tools reuse the existing 7 scopes (`read`/`write`/`data`/`sql`/`transports`/`git`/`admin`) + the allow\* ceiling. No custom scopes (XSUAA `xs-security.json` is deploy-time static — research §6.4).

**Egress model:** plugins call **any SAP HTTP path** (ADT/OData/ICF) via the gated `ctx.http`. No path allowlists. Gates = per-user SAP auth + ARC-1 scope/safety. External/non-SAP = no `ctx.fetch`.

---

## 2. Public API — `arc-1/public` (the surface plugins import)

A new stable-ish entry exported via `package.json#exports`. All types re-exported from existing internal modules; **no behavior moves**, only a curated re-export path.

```ts
// arc-1/public
export function defineTool(def: ToolDefinition): ToolDefinition;   // identity + dev-time validation

export type Scope = 'read' | 'write' | 'data' | 'sql' | 'transports' | 'git' | 'admin';
export { OperationType } from '../adt/safety.js';                  // R/S/Q/F/C/U/D/A/T/L/I/W/X

export interface ToolDefinition {
  name: `Custom_${string}`;                                        // reserved namespace; collisions fail-fast at load
  description: string;
  schema: ZodTypeAny;                                              // input validation (Zod v4)
  policy: { scope: Scope; opType: OperationType };                 // REQUIRED — gates exactly like a built-in
  availableOn?: 'all' | 'onprem' | 'btp';                          // default 'all'
  handler(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  readonly client: ReadOnlyAdtClient;  // high-level reads ONLY; `.http` DELIBERATELY OMITTED (review B1, §16) — else a
                                       //   plugin could reach the ungated raw client. ReadOnlyAdtClient = Pick<AdtClient, …reads>.
  readonly http: SafeHttpClient;       // the ONLY HTTP path — gated, ANY SAP path (ADT/OData/ICF). Raw AdtHttpClient never exposed.
  readonly safety: SafetyConfig;       // READ-ONLY snapshot
  readonly cache?: CachingLayer;
  readonly logger: Logger;             // stderr only
  readonly config: PublicServerConfig; // redacted, read-only
  readonly authInfo?: AuthInfo;        // userName, scopes, clientId — NO raw JWT
  readonly requestId: string;
  // optional, capability-detected:
  readonly elicit?:   (p: ElicitParams) => Promise<ElicitResult>;
  readonly notify?:   (lvl: 'info'|'warning'|'error', msg: string) => Promise<void>;
  readonly sampling?: (sys: string, user: string, maxTokens?: number) => Promise<string>;
}

export interface SafeHttpClient {                                  // every method gates + audits (see §5)
  get(path: string, headers?: Record<string,string>): Promise<AdtResponse>;
  head(path: string, headers?: Record<string,string>): Promise<AdtResponse>;
  post(path: string, body?: string, contentType?: string, headers?: Record<string,string>): Promise<AdtResponse>;
  put(path: string, body: string, contentType?: string, headers?: Record<string,string>): Promise<AdtResponse>;
  delete(path: string, headers?: Record<string,string>): Promise<AdtResponse>;
  fetchCsrfToken(path?: string): Promise<string>;                 // generic; default = /sap/bc/adt/core/discovery
  withStatefulSession<T>(fn: (s: SafeHttpClient) => Promise<T>): Promise<T>;
}

export interface AdtResponse { statusCode: number; headers: Record<string,string>; body: string; }  // NB: statusCode (not status) — matches src/adt/http.ts:152

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

// errors
export { AdtApiError, AdtSafetyError, AdtNetworkError } from '../adt/errors.js';
// testing entry: arc-1/public/testing → createMockToolContext(overrides?) for unit-testing a plugin with no live SAP
```

---

## 3. Plugin package shape

A plugin is an npm package (pure TypeScript, **no ABAP**) loaded by absolute path.

```jsonc
// package.json
{
  "name": "arc1-plugin-<name>",
  "type": "module",
  "peerDependencies": { "arc-1": ">=<min>" },     // floor only; experimental
  "arc1": {
    "apiVersion": 1,                               // compatibility fuse; host rejects mismatch at load
    "requires": { "scopes": ["read"], "packages": [] }  // declared capability — intersected w/ ceiling, never expands
  }
}
```

```ts
// the module default export
import type { Plugin } from 'arc-1/public';
export default {
  name: 'arc-1-extension-sample',
  version: '0.0.1',
  apiVersion: 1,
  tools: [ /* ToolDefinition[] from defineTool(...) */ ],
  manifests: [ /* optional: paths to *.tool.json declarative tools */ ],
} satisfies Plugin;
```

Loaded by **local path** (`.js` / `.json` / directory) via `ARC1_PLUGINS=` — see §7. Not npm.

### 3.1 What the developer defines (code vs manifest)

**Code tier** — `defineTool`, full power (logic, writes, multi-step):

| Field | Req? | Notes |
|---|---|---|
| `name` | ✅ | `Custom_*` |
| `description` | ✅ | shown to the LLM |
| `schema` | ✅ | Zod → converted to JSON-Schema for `tools/list` |
| `policy.scope` | ✅ | one of the 7 scopes |
| `policy.opType` | ✅ | gates via `checkOperation` |
| `handler(args, ctx)` | ✅ | the code; uses `ctx.http` (any SAP path) / `ctx.client` reads |
| `availableOn` | — | `all` (default) / `onprem` / `btp` |

…plus the module's default export `Plugin { name, version, apiVersion, tools[], manifests?[] }` and `package.json#arc1 { apiVersion, requires:{scopes,packages} }` (declared capability, intersected with the ceiling).

**Manifest tier** — `*.tool.json`, **no code** (one gated HTTP call; read-only + simple POST):

| Field | Req? | Notes |
|---|---|---|
| `name` | ✅ | `Custom_*` |
| `description` | ✅ | |
| `scope` | ✅ | one of the 7 scopes |
| `opType` | — | default = method→opType; declare to override (e.g. an OData function-import POST = Read) |
| `inputSchema` | ✅ | JSON Schema, `additionalProperties:false` |
| `request.method` | ✅ | GET only (v1 — the interpreter rejects non-GET) |
| `request.path` | ✅ | fixed template against the authed client (no host) |
| `request.{pathParams,query,headers,accept,body}` | — | bindings (`$.field`); omit-if-absent |
| `response.{extract,maxBytes}` | — | optional select / truncate |

**The line:** need *logic, a write sequence, or response shaping* → **code tier**. Just *wrapping one read endpoint* → **manifest tier** (no code, statically checkable against the ceiling). Both produce a `Custom_*` tool gated identically.

---

## 4. ToolRegistry (the one CORE change)

```ts
interface RegistryEntry {
  name: string;
  source: 'builtin' | 'plugin';
  pluginName?: string;
  policy: { scope: Scope; opType: OperationType; featureGate?: FeatureGate };
  invoke(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}
interface ToolRegistry {
  register(e: RegistryEntry): void;   // throws: duplicate name; non-Custom_ plugin name; missing policy
  get(name: string): RegistryEntry | undefined;
  list(): RegistryEntry[];            // built-ins first (registration order), then plugins
}
```

- The 12 built-ins register at startup in `createAndStartServer()`.
- `handleToolCall`'s `switch(toolName)` (src/handlers/intent.ts ~:1264) becomes `registry.get(toolName)?.invoke(args, ctx)`.
- **Collision policy:** a plugin tool whose name already exists → **fail-fast at load** (server refuses to start). `Custom_` prefix required for plugin tools; built-ins keep `SAP*`.
- `getActionPolicy` gains a registry fallback; `scripts/validate-action-policy.ts` walks the registry too.

---

## 5. SafeHttpClient (additive — closes the raw-`http.*` safety gap)

Wraps the per-user `AdtHttpClient`. On **every** call:

1. **opType** = the tool's declared `policy.opType` (authoritative); if a tool exposes multiple HTTP verbs, the default method→opType map (GET/HEAD→Read, POST→Create, PUT→Update, DELETE→Delete) is a sanity cross-check that must not exceed the declared scope.
2. `checkOperation(safety, opType, 'Custom:<tool>')` — throws `AdtSafetyError` if the ceiling blocks it.
3. delegate to `AdtHttpClient.<method>` (inherits CSRF/cookies/PP/session/semaphore/MIME — all path-agnostic).
4. audit `http_request` with `pluginName` + `requestId`.

**`fetchCsrfToken(path?)`**: parameterizes the currently-hardcoded `/sap/bc/adt/core/discovery` fetch so OData/ICF **writes** can fetch the token against the service path. Existing internal callers pass nothing → unchanged behavior.

**Non-ADT gating note (documented limitation):** `allowedPackages` cannot constrain OData/ICF calls (no ABAP package in the path). For non-ADT writes the gates are `allowWrites` + scope + `denyActions` + SAP-side auth. ADT object writes still get `checkPackage`.

---

## 6. Authorization (reuse the 7 scopes)

- A plugin tool's `policy.scope` is registered alongside the tool; `getActionPolicy(toolName)` returns it; `hasRequiredScope(authInfo.scopes, policy.scope)` gates the user (with `admin⊇all`, `write⊇read`, `sql⊇data` implications).
- The safety ceiling + `deriveUserSafety` (tightest-side-wins) applies via `SafeHttpClient`/`checkOperation`.
- `tools/list` pruning (`filterToolsByAuthScope`) already reads policy → plugin tools prune per-user automatically.
- `package.json#arc1.requires` is **intersected** with the server ceiling at load (never expands); a plugin requiring `write` on a read-only server loads but its write tools are inert/hidden.
- **No custom scopes.** (Future: optional pre-declared `custom.<plugin>` visibility label — not v1.)

---

## 7. Loading model (`ARC1_PLUGINS`) — local files, NOT npm

A plugin is loaded from a **local path** the admin lists in `ARC1_PLUGINS` (CSV) → `ServerConfig.plugins`. **No `npm publish`/`npm install` is required** — npm-package discovery is a deferred Phase-4 convenience (research §9.2), never the v1 path. Three entry forms, auto-detected:

| `ARC1_PLUGINS` entry | Kind | Loads |
|---|---|---|
| `/abs/…/dist/index.js` | **code plugin** | `import()` the module → its default-export `Plugin` (`tools[]` + optional `manifests[]`) |
| `/abs/…/Custom_Foo.tool.json` | **manifest plugin** | the manifest interpreter (§8) → a synthetic tool. **No JS.** The pure-declarative #332 case. |
| `/abs/…/plugin-dir` | **directory** | resolves the dir's `package.json#main` (code), which may reference `*.tool.json` via `manifests[]` (paths relative to the plugin) |

At startup, per entry: assert absolute + readable + not world-writable + same owner as the process; load by kind; validate shape + `apiVersion`; register each tool into the registry; **fail-fast** (refuse to start) on any malformed plugin or name collision. Runs after built-ins are registered. Stdio + HTTP both supported.

**Deferred (v2+):** npm peer-package discovery (`ARC1_PLUGINS=arc1-plugin-foo`, resolved from `node_modules`, CAP-style); directory auto-scan. Explicit paths are preferred for auditability (research §3.4).

---

## 8. Manifest tier (declarative, read-only — scoped)

A `*.tool.json` manifest → a synthetic `ToolDefinition`. Interpreter is a pure function: validate args → render template → one `ctx.http` call → optional select/truncate.

```jsonc
{
  "name": "Custom_ReadProgram",
  "description": "Read an ABAP program's source.",
  "scope": "read",
  "inputSchema": { "type":"object", "additionalProperties":false,
    "required":["name"], "properties":{ "name":{"type":"string","pattern":"^[A-Za-z0-9_/]{1,40}$"} } },
  "request": {
    "method": "GET",                                   // v1: GET only (the interpreter rejects non-GET)
    "path": "/sap/bc/adt/programs/programs/{name}/source/main",
    "pathParams": { "name": "$.name" },                // each segment: validate → percent-encode
    "query": {},                                       // omit-if-absent; repeated-key array default
    "accept": "text/plain"
  },
  "response": { "maxBytes": 50000 }                    // optional "extract": "$.jsonpath" (v1.1)
}
```

**Interpreter MUST enforce** (research §8.1): fixed base URL = the authed client (reject URL-shaped values → no SSRF); per-segment canonicalize→allowlist→reject `..`/`/`/encoded-equivalents→percent-encode; CR/LF/NUL-reject + header allowlist (no `Host`/`Authorization`/`Cookie`/`X-CSRF-Token`/session headers); structural JSON body (no string interpolation); `additionalProperties:false`; route through `checkOperation` + scope + audit. **Lock-aware writes are NOT expressible** — they stay code-tier (v2 may add a named code-backed op vocabulary).

---

## 9. Audit

Add optional `pluginName?: string` to `ToolCallStartEvent`/`ToolCallEndEvent`/`http_request`. Emitted when the tool is plugin-sourced. Framework still owns the bracketing; plugins never emit `tool_call_*`.

---

## 10. Implementation plan — PR sequence

| PR | Content | Core? | Risk |
|----|---------|-------|------|
| **PR1** | **No-op registry refactor**: `ToolRegistry`; register 12 built-ins; replace the `switch`; introduce `ToolContext` and convert built-ins to `(args, ctx)`. **No plugin-facing change; all existing tests green.** | CORE | HIGH (isolated; tests are the net) |
| **PR2** | Public boundary `src/public/` + `package.json#exports`; `defineTool`; `SafeHttpClient`; `fetchCsrfToken(path?)`; `lock`/`unlock` on `AdtClient`; audit `pluginName`; `arc-1/public/testing` mocks. | additive | LOW |
| **PR3** | Loader (`ARC1_PLUGINS`) + config; capability declaration + ceiling intersection; registry-aware `validate-action-policy`. | additive | LOW |
| **PR4** | Manifest tier (interpreter + grammar + security). | additive | LOW |
| **PR5** | `ToolContext` `elicit`/`notify`/`sampling` threading. | both (light) | MED |

PR1 ships and **bakes one release** before PR3 (the loader) makes plugins real.

---

## 11. Core vs additive (file-level)

**CORE (modify existing):** `src/handlers/intent.ts` (switch→registry, ToolContext build), `src/server/server.ts` (register built-ins, loader call), `src/adt/http.ts` (`fetchCsrfToken(path?)` — backward-compatible optional param). **Light:** `src/authz/policy.ts` (registry fallback in `getActionPolicy`), `src/server/audit.ts` (optional field), `scripts/validate-action-policy.ts` (walk registry), `src/server/{config,types}.ts` (plugins field).

**ADDITIVE (new files):** `src/registry/tool-registry.ts`, `src/public/index.ts` + `src/public/testing.ts`, `src/server/safe-http-client.ts`, `src/server/plugin-loader.ts`, `src/plugins/manifest-interpreter.ts` + `src/plugins/types.ts`. **Plus** new `AdtClient.lock/unlock` methods delegating to `crud.ts`.

---

## 12. Testing

- Unit: registry (collision, missing-policy reject, `Custom_` prefix, built-ins-first order); SafeHttpClient (method→opType gate, `checkOperation` blocks write when `allowWrites=false`, audit carries pluginName); manifest interpreter (path-traversal reject, header-injection reject, SSRF reject, omit-if-absent, percent-encode); loader (file-permission checks, apiVersion mismatch, malformed shape → fail-fast); scope pruning of plugin tools.
- Integration (live SAP): the sample plugin's ADT + OData reads end-to-end.
- The `arc-1/public/testing` mock `ToolContext` lets plugin authors unit-test with no live SAP.

---

## 13. v2 roadmap (deferred)

**→ Full draft: [`extension-framework-v2-spec.md`](2026-06-17-extension-framework-v2-spec.md).** It scopes every
deferral with a design + PR sequence. Headline items: the **package-aware write surface** (`ctx.write`
vocabulary routing through the built-in `write/` path so ADT writes stay package-gated; raw non-ADT
writes behind an opt-in) — the centerpiece, since v1 is read-only; a **safe `ctx.cache`** facade
(cacheSecurity-bound, no PP leak); **directory + npm-specifier loading**; **`package.json#arc1.requires`**
ceiling intersection; **`http_request` pluginName** tag; a **per-handler timeout + `ctx.signal`**
(review N4); custom `custom.<plugin>` visibility labels; an observer hook bus
(`onToolCall`/`onToolResult`/`onCacheInvalidate`); multi-system `sap_system_id` (FEAT-59); MCP prompts
(FEAT-62); and **API stabilization + semver** (graduate from `@experimental`).

---

## 14. Open items

**All confirmed 2026-06-17** — Q-B (manifest scope), Q-D (`apiVersion` fuse), Q-F (manifest fast-follow), Q-G (`arc1-plugin-*` naming), Q-I (opType override), Q-K (package-gating limitation), Q-N (authz model). **Only open:** Q-O — the third (non-ADT/non-OData) reference-plugin endpoint, deferred (the sample ships ADT + OData now).

---

## 15. Reference plugin

[`arc-mcp/arc-1-extension-sample`](https://github.com/arc-mcp/arc-1-extension-sample) — pure TS, demonstrates: an **ADT** read, an **OData** read (`GWSAMPLE_BASIC`), a **manifest** example, a gated **console-class execute** (`Custom_RunClass`), an **OData write** (`Custom_CreateSalesOrder`), and a full **LISA** custom-ICF integration (`Custom_ListLanguages`/`GetTranslation`/`SetTranslation`) — all live-verified on S/4HANA. Doubles as the dogfood + the `ARC1_PLUGINS` smoke test. (Uses the gated `ctx.http`, not the B1 bypass.)

---

## 16. Review corrections (round 1 — 2026-06-17 adversarial review)

An adversarial review against the live codebase found **one blocker (B1, fixed inline in §2)** + integration/signature clarifications. Authoritative resolutions (address before/within the noted PR):

- **B1 — raw-client bypass (FIXED §2).** `AdtClient.http` is a public `readonly` field (`src/adt/client.ts:266`, re-attached by `withSafety` `:324`). Exposing the full `AdtClient` on `ToolContext` would let a plugin call `ctx.client.http.post(...)` → the **ungated** raw client → bypass `allowWrites`/`denyActions`/package gates. **Resolution:** `ToolContext.client` is a narrowed **`ReadOnlyAdtClient`** (a `Pick<AdtClient, …read methods>` interface in `src/public/`) with **no `.http`**. All HTTP goes through the gated `ctx.http`. (The research-doc §4.1 sample showing `ctx.client.http` is superseded.)
- **B2/S3 — registry ↔ policy ↔ validator ↔ listing.** (1) Plugin policy lives in the **registry only**, never in `ACTION_POLICY`. (2) `getActionPolicy(name)` gains a registry fallback for **runtime** checks, but `scripts/validate-action-policy.ts` (a regex scan over `schemas.ts:20`) stays **built-ins-only** and must NOT enumerate registry keys (Pass 2 `:90-110` would flag `Custom_*` as dead). (3) Plugin tools are **flat** (no action/type enum), so `tools/list` pruning uses the **tool-level** `getActionPolicy('Custom_X')` (`server.ts:114`) = the registry fallback. (4) `getToolDefinitions` (`tools.ts:578`) must merge registry plugin defs into the listed array.
- **S4 — `ToolDefinition` collision + Zod→JSON-Schema.** Internal `ToolDefinition` (`tools.ts:24`, `inputSchema: JSONSchema`) ≠ the plugin-facing one (`schema: Zod`, `policy`, `handler`). Name the plugin type **`PluginToolDefinition`** internally; `defineTool` returns it; the registry **adapter** converts Zod `schema` → JSON-Schema `inputSchema` for listing (**new dep:** `zod-to-json-schema` or the MCP SDK converter — PR1 keeps the manual `ListToolsRequestSchema` path, so nothing converts it for free).
- **S6 — per-request `ToolContext`.** Registry is built once at startup; **context is built per call** in `handleToolCall` from the request's `effectiveClient` (the per-user `withSafety()` clone, `server.ts:689`), `authInfo`, `requestId`, `cachingLayer` (threaded separately — NOT a client field), `_server`. `invoke(args, ctx)` gets that per-request ctx; never bind it at registration.
- **S7 — `withSafety()` clone footgun.** `withSafety()` uses `Object.create()` (bypasses the constructor, `client.ts:318`); any **new `AdtClient` field** must be re-attached there (regression #333). `lock`/`unlock` are prototype methods (safe). PR2: if anything adds a client field, extend the reattach block + add a clone test.
- **S1 — `fetchCsrfToken`.** Real signature is `(): Promise<void>` storing on `this.csrfToken` (`http.ts:846`). The spec's `(path?): Promise<string>` is a **new contract** (param + return), backward-compatible for internal callers. OData/ICF **writes** also need the token + session cookie bound to the **same** session — require `withStatefulSession` (`http.ts:256`); document for write plugins.
- **S2 — `AdtResponse.statusCode`** (not `status`) — fixed in §2 + the sample stub.
- **S5 — split PR5.** `elicit` is light (`src/server/elicit.ts:59`; `_server` already threaded `intent.ts:1090`). `notify`/`sampling` are **new** (no `sendLoggingMessage`/`createMessage` plumbing) + need client capability detection (`server.getClientCapabilities()`). **PR5a = elicit; PR5b = notify/sampling.**
- **N1 — preserve hyperfocused.** PR1 must keep the `SAP` recursive case (`intent.ts:1301`, re-enters `handleToolCall` with the mapped tool); add a test.
- **N2 — enforce `availableOn`.** Filter at listing/registration against `config.systemType` (`isBtpMode`, `server.ts:582`) — else it's inert metadata.
- **N4 — no bounded timeout exists.** `handleToolCall`'s try/catch contains *throws*, not *hangs*; a hung plugin holds a semaphore slot. **Add a per-handler timeout in PR3** (or drop the "bounded timeout" claim).

---

## 17. Developer-guidance skill (built LAST — after implementation + tests)

A Claude Code **skill** that guides a developer through creating an ARC-1 extension end-to-end:
1. **Asks the key architecture-decision questions** — same SAP system (→ extension) or different (→ own server)? code tier or manifest tier? which SAP API (ADT/OData/ICF)? read or write? which scope + opType? ships its own pre-installed ABAP endpoint or uses existing?
2. **Scaffolds** the plugin from the answers (the `arc-1-extension-sample` layout — `defineTool`/manifest, `package.json#arc1`, README), and
3. **Walks setup** — build, `ARC1_PLUGINS=`, load, verify in `tools/list`, test against a system.

**Built last, deliberately** — so it encodes the real learnings from implementing the framework + the sample (gotchas, the CSRF/OData caveat, the scope mapping, the manifest grammar edges). **Research how to build it** (skill structure, the question flow via `AskUserQuestion`, the scaffold templates, mirroring `skill-creator`/`implement-feature` conventions) happens **after the tests pass**. Final deliverable; not in any PR1–PR5.

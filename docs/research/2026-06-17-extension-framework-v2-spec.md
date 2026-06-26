# ARC-1 Extension Framework — v2 Specification (FEAT-61, draft)

> **Status:** 📝 **DRAFT / planning** — not implemented. Captures everything deferred from v1
> (shipped in [PR #454](https://github.com/arc-mcp/arc-1/pull/454)) so the work is scoped before
> it starts. The v1 spec is [`extension-framework-spec.md`](2026-06-17-extension-framework-spec.md); the
> rationale is [`extension-framework-deep-research.md`](2026-06-17-extension-framework-deep-research.md).
> **Stability:** v1 is `@experimental` (one `apiVersion` integer fuse). v2's headline non-feature
> is **API stabilization** — see §12.
> **Date:** 2026-06-17. Tracks roadmap FEAT-61, issues #187 / #332.

---

## 0. Why a v2 — what v1 deliberately left out

v1 shipped a **read-only**, conservatively-scoped framework. Every narrowing below was a safety
choice made during the 2026-06-17 implementation review, not an oversight. v2 lifts them, in
priority order.

> **Precedent already in v1:** `ctx.run.classRun` (execute an `IF_OO_ADT_CLASSRUN` console class)
> shipped in v1 as the **first named privileged op** — gated behind `SAP_ALLOW_PLUGIN_EXECUTE` +
> `allowWrites` + `write` scope, validated class name, no generic POST. It proves the §2.2 "named
> operation vocabulary" model end-to-end (live on a4h), and is the template the v2 `ctx.write.*` ops
> follow. The `ctx.run` namespace is where future execute-class ops land (e.g. `programRun`).
>
> **§2.2 "Path B" (raw non-ADT writes) SHIPPED (2026-06-19):** `ctx.http.post`/`put`/`delete` are live
> for **non-ADT** (OData/ICF) paths behind the default-off `SAP_ALLOW_PLUGIN_RAW_WRITES` opt-in (+
> `allowWrites` + `write` scope); `/sap/bc/adt/…` writes stay refused (normalization-proof). This
> enables LISA-style custom-ICF write tools. **Still deferred:** the §2.2 "Path A" package-aware
> `ctx.write` vocabulary for ADT **object** writes (create/update/delete of CLAS/DDLS/…) — the hard
> part (package resolution + lock-aware writes). G8 below now means specifically *Path A*.

| # | Deferred from v1 | Why it was deferred | v2 section |
|---|------------------|---------------------|-----------|
| 1 | **Plugin writes** — *non-ADT (OData/ICF) part SHIPPED* (Path B, `SAP_ALLOW_PLUGIN_RAW_WRITES`); **ADT object writes still deferred** (Path A) | An ADT-object raw write can't be constrained by `SAP_ALLOWED_PACKAGES` (package resolution needs the ADT object-URL shape) → would bypass the safety ceiling, so `/sap/bc/adt/…` writes are refused and wait for `ctx.write` | **§2** |
| 2 | **Lock-aware writes** (lock → modify → unlock, CSRF, stateful session) | Not expressible declaratively; needs `lock`/`unlock` + `fetchCsrfToken(path?)` plumbing | §2.5 |
| 3 | **Safe `ctx.cache`** | The raw `CachingLayer` bypassed per-user `cacheSecurity` revalidation (PP cross-user leak class) | §3 |
| 4 | **Directory loading** (`ARC1_PLUGINS=/abs/plugin-dir`) | Node ESM dir-import needs `package.json#main` resolution; not worth it for a read-only v1 | §4.1 |
| 5 | **npm package discovery** (`ARC1_PLUGINS=arc1-plugin-foo`) | Explicit local paths preferred for auditability in v1 | §4.2 |
| 6 | **`package.json#arc1.requires`** (capability ↔ ceiling intersection) | The ceiling already constrains every call; `requires` would be a redundant (if nice) narrowing | §5 |
| 7 | **`http_request` `pluginName` tag** | Needs `pluginName` threaded into the `AdtHttpClient` logging path | §6 |
| 8 | **Per-handler timeout** (review item N4) | A hung plugin holds a semaphore slot; `handleToolCall`'s try/catch contains throws, not hangs | §7 |
| 9 | **Custom visibility labels** (`custom.<plugin>`) | Scope reuse was enough for v1; labels are cosmetic grouping | §8 |
| 10 | **Observer/hook bus** (`onToolCall`/`onToolResult`) | No consumer in v1 | §9 |
| 11 | **Multi-system** (`sap_system_id`, FEAT-59) | Single connected system in v1 | §10 |
| 12 | **MCP prompts** (FEAT-62) | Tools-only in v1 | §11 |

**Still out of scope in v2** (see §14): replacing built-in tools; non-SAP egress (`ctx.fetch`);
framework-managed ABAP deployment; sandboxing; a marketplace; hot-reload.

---

## 0.5 Post-merge gap review — risk × value backlog (do-next order)

After v1 merged ([PR #454](https://github.com/arc-mcp/arc-1/pull/454)), a review surfaced gaps
**beyond** the original §0 deferral list — mostly operability, release hygiene, and one under-stated
security property. This table triages **all** open extension work (original deferrals + the new
gaps) by **risk × value**, in the order to tackle it. *Risk* = the danger of leaving it undone (or
that the item itself represents). Several P0 items are cheap docs/hygiene with outsized risk
reduction and should land as **v1.x patches, before v2 proper**. This supersedes the §16 PR sequence
as the priority view; §16 stays as the implementation breakdown for the write surface specifically.

| # | Item | Risk | Value | Effort | When |
|---|------|------|-------|--------|------|
| **G1** | **State the trust model bluntly** — a loaded plugin runs in-process with **full ARC-1 privileges** (reads `process.env` creds, FS, outbound network); the gated `ctx` is an API, **not** a sandbox. `classRun`'s gate guards a *buggy*/over-eager plugin + the admin's posture, **not** a hostile one (which already has `child_process`). Add to SECURITY.md + docs_page/extensions.md. | **High** — operators load under a false sense of containment → SAP-credential exfiltration | High | **Low** (docs) | **P0** |
| **G2** | **Published-package smoke** — verify `npm i arc-1@0.10 && import 'arc-1/public'` (+ `/public/testing`) actually resolve **from the tarball** (only `npm link`-tested so far). Add `publint` + `attw` + a pack-and-import test to CI. | Med — the first external install could fail on a bad `exports`/path | High | **Low** | **P0** |
| **G3** | **Contract-freeze `arc-1/public`** — snapshot the exported surface (types, `defineTool`, `ToolContext`, manifest grammar) so a refactor can't silently break it. We froze the *LLM tool* surface, not the *plugin-author API*. | Med — silent public-API drift breaks downstream plugins | High | Low–Med | **P0** |
| **G4** | **Wire the sample into CI** — `arc-mcp/arc-1-extension-sample` is the smoke test + canonical example but isn't built/tested against arc-1 changes, so it rots; breaks are found late + by users. | Med | Med | Med (cross-repo: scheduled build or vendored copy) | **P1** |
| **G5** | **Per-handler timeout + `ctx.signal`** (= §7) — a hung plugin holds a `maxConcurrent` slot indefinitely. This is a **latent availability bug today**, not just a v2 nicety — promote to a v1.x patch. | Med — accidental DoS / slot exhaustion | Med–High | Low–Med | **P1** |
| **G6** | **Plugin dependency supply chain** — a code plugin's transitive `node_modules` run in-process; a compromised dep = full compromise (the practical consequence of G1). Ship guidance (committed lockfile, `npm audit`, minimal deps, prefer the manifest tier when it suffices). | **High** — the #1 real attack vector | Med | Low (guidance) | **P1** |
| **G7** | **Manifest `response.extract`** (jsonpath projection, the v1.1 fast-follow) — without it the manifest tier is too thin for real (nested-JSON) OData, pushing authors to the code tier for trivial wraps and defeating the no-code value. | Low | Med | Low–Med | **P1** |
| **G8** | **`ctx.write` package-aware writes** (§2) — the headline v2 feature; ADT writes stay package-allowlist-gated, raw non-ADT behind an opt-in. | — (it *is* the point of v2) | High | High | **P1→P2** (centerpiece; gated on §2 design + §15 open Qs) |
| **G9** | **Load-failure mode** — fail-fast means one bad plugin blocks server start; decide whether an opt-in **skip-and-warn** belongs for multi-plugin deployments. | Med — availability footgun on a managed instance | Med | Low–Med | **P2** |
| **G10** | **Runtime observability** — a `SAPManage` action / startup summary listing loaded plugins + their tools + versions. | Low | Med (operability) | Low | **P2** |
| **G11** | **The mechanical deferrals** — safe `ctx.cache` (§3), loader directory + npm-specifier (§4), `package.json#arc1.requires` intersection (§5), `http_request` `pluginName` tag (§6). | Low–Med | Med | Med | **P2** |
| **G12** | **MCP resources + prompts** (§11) — let a plugin contribute browsable **resources** / prompt templates, not only tools. Resources may fit "expose this data" better than a tool. | Low | Med (broader MCP surface) | Med–High | **P2→P3** |
| **G13** | **Custom visibility labels** (§8), **observer hooks** (§9), **multi-system** (§10, gated on FEAT-59). | Low | Low–Med | Med | **P3** |
| **G14** | **Per-plugin resource fairness / call budget** — bound a greedy plugin on a shared instance (the global semaphore already caps *total* concurrency). | Low–Med | Low–Med | Med | **P3** (YAGNI until a real multi-plugin / high-traffic deploy) |
| **G15** | **Per-plugin tool namespacing** (`Custom_<plugin>_<tool>`) — only matters once many plugins coexist; collisions already fail-fast safely. | Low | Low | Med (name-contract change) | **P3** (maybe never) |

**Do-next summary:**

- **P0 — now, mostly docs/hygiene, land as v1.x:** **G1** (trust-model statement), **G2** (published-package smoke), **G3** (public-API contract freeze). Cheap, high risk-reduction, *true today* — independent of the v2 write work.
- **P1 — soon:** **G4** (sample-in-CI), **G5** (timeout — latent bug), **G6** (dep-supply-chain guidance), **G7** (manifest projection); then **G8** `ctx.write` as the v2 centerpiece.
- **P2 — v2 proper:** **G9** (load-failure mode), **G10** (observability), **G11** (the mechanical deferrals), **G12** (resources/prompts).
- **P3 — defer / YAGNI:** **G13** (labels/hooks/multi-system), **G14** (fairness), **G15** (namespacing) — revisit only when a concrete multi-plugin, high-traffic deployment makes them real.

The throughline: the highest-risk open items (**G1**, **G6**) are about being *honest that a plugin is trusted code with full privileges*, and they're nearly free to address (docs + guidance). Do those before shipping more capability.

---

## 1. Scope of v2

v2 makes plugins **write-capable without weakening any safety invariant**, stabilizes the public
API, and fills the loader/observability gaps. The non-negotiable rule carries over from v1:

> **A plugin can never do something a built-in tool of the same scope couldn't.** Every write must
> pass `scope ∧ safety-ceiling ∧ SAP-auth`, AND ADT object writes must pass the **package
> allowlist** — the exact gate built-in `SAPWrite` uses.

`apiVersion` bumps **1 → 2**. v1 plugins (`apiVersion: 1`) keep loading unchanged (read-only). A
plugin that wants the v2 write surface declares `apiVersion: 2`.

---

## 2. The write surface (the centerpiece)

### 2.1 The problem v1 hit

Built-in `SAPWrite` enforces `SAP_ALLOWED_PACKAGES` in `enforceAllowedPackageForObjectUrl`
(`write-helpers.ts`) — it resolves the object's **real** package from the ADT object URL and checks
it fail-closed. `checkOperation` (the only gate v1's `SafeHttpClient` ran) checks the `allow*`
booleans but **never** the package allowlist. So a raw `ctx.http.post('/sap/bc/adt/oo/classes', …)`
would create a class in **any** package, bypassing the allowlist. That's why v1 `ctx.http` is
read-only.

The hard part is that an arbitrary `post(path, body)` is **not classifiable**: it could be an ADT
object create (package lives in the body), an ADT object update (package resolved from the URL), an
ADT action (activation — no package), an OData function import (no ABAP package at all), or a custom
ICF write. Package enforcement is well-defined only for the first two.

### 2.2 Design — two paths, picked by what the call actually is

**Path A — named write vocabulary (the safe default for ADT object writes).** Instead of a raw
POST, the plugin calls typed operations that route through the **same** `write/` package the
built-in `SAPWrite` uses, inheriting package enforcement, pre-write lint, master-language handling,
and post-save syntax check for free:

```ts
// ctx.write — present only when the tool declares a write-family scope AND apiVersion >= 2
interface PluginWriteOps {
  createObject(spec: CreateObjectSpec): Promise<WriteResult>;   // → write/create.ts (package-gated)
  updateSource(ref: ObjectRef, source: string): Promise<WriteResult>;  // → write/update-delete.ts
  deleteObject(ref: ObjectRef): Promise<WriteResult>;
  activate(refs: ObjectRef[]): Promise<ActivateResult>;
  // lock/unlock are managed internally by each op (lock → modify → unlock), never hand-rolled.
}
```

Every `ctx.write.*` call resolves the target package and runs `enforceAllowedPackageForObjectUrl`
before mutating — identical to a built-in. A plugin **cannot** opt out. This is the recommended
path for any ABAP object write.

**Path B — gated raw writes for non-ADT paths only (opt-in escape hatch).** OData function-import
POSTs and custom ICF writes have **no ABAP package**, so the package allowlist genuinely can't
constrain them (documented limitation, v1 spec §5). For these, `ctx.http` regains
`post/put/delete`, but:

- gated by `checkOperation(safety, opType)` **+** the tool's declared scope (`write`) **+** `denyActions`,
- **refused for ANY `/sap/bc/adt/…` path** — checked against the path SAP actually routes (`new URL`
  normalization + percent-decode + `startsWith`), so no-leading-slash / tab / `%61`-encoded variants
  can't slip through. ADT **object** writes MUST use Path A (so the package gate can't be skipped),
- behind the server opt-in `SAP_ALLOW_PLUGIN_RAW_WRITES` (default **false**) AND `allowWrites`,
- audited via the underlying `http_request` event.

> **As shipped (v1.x):** the above is implemented exactly, with **no exception** for package-less ADT
> actions (e.g. activation) — *all* `/sap/bc/adt/…` writes are refused. A future allowlist for specific
> non-object ADT actions is a possible refinement, not current behavior.

On BTP the **Cloud Connector resource allowlist** is the backstop for raw non-ADT writes; on-prem
the gate is `allowWrites` + scope + `denyActions` + SAP-side auth. This is spelled out so an admin
enabling it understands exactly what is and isn't constrained.

### 2.3 `ctx.http` write gating summary (v2)

| Call | Path class | Gate |
|------|-----------|------|
| `ctx.write.createObject/updateSource/deleteObject` | ADT object | scope + `allowWrites` + **package allowlist** + lint (= built-in `SAPWrite`) |
| `ctx.http.post` to OData/ICF | non-ADT | scope + `allowWrites` + `denyActions` + `SAP_ALLOW_PLUGIN_RAW_WRITES` + CC allowlist (BTP) |
| `ctx.http.post` to ANY `/sap/bc/adt/…` path | ADT | **refused** (shipped: no exception) — ADT object writes must use `ctx.write` |
| `ctx.http.post` to a package-less ADT action (e.g. activation) | ADT action | *future* allowlist idea — currently **refused** with the rest of ADT |

### 2.4 CSRF + sessions for writes

OData/ICF writes need a CSRF token fetched against the **service path** (not the hardcoded
`/sap/bc/adt/core/discovery`) and bound to the **same** stateful session as the write. v2 ships:

- **`fetchCsrfToken(path?)`** on `AdtHttpClient` — parameterizes the currently-hardcoded discovery
  fetch (v1 spec §5 / review S1). Backward-compatible: existing internal callers pass nothing.
- **`ctx.http.withStatefulSession(fn)`** returns to the plugin surface (removed in v1), but the
  session it hands back is itself write-gated per §2.3.

### 2.5 Lock-aware ADT writes

`ctx.write.*` ops own the lock→modify→unlock dance internally using **`AdtClient.lock`/`unlock`**
(prototype methods — safe for the `withSafety()` `Object.create` clone, review S7). Plugins never
hold a raw lock handle. A failed unlock is logged and the lock left to SAP's timeout, same as the
built-in path.

### 2.6 Manifest-tier writes

Manifests stay **mostly** read-only. v2 adds exactly one declarative write form — a **named op
reference**, not a raw POST:

```jsonc
{ "name": "Custom_Activate", "scope": "write", "op": "activate",
  "inputSchema": { … }, "bind": { "refs": "$.objects" } }
```

`op` selects a vocabulary entry from §2.2 Path A; the interpreter binds args → the typed op → the
package-gated write path. Free-form declarative POSTs remain **un-expressible** (they'd reintroduce
the §2.1 classification problem). Simple stateless OData function-import POSTs (semantically reads,
`opType: 'R'` override) are the one raw-POST manifest form, behind `SAP_ALLOW_PLUGIN_RAW_WRITES`.

---

## 3. Safe `ctx.cache`

v1 removed `ctx.cache` because the raw `CachingLayer` exposes cache-only `getSource`/where-used
reads that skip the per-user `cacheSecurity` revalidation — under principal propagation, user A
could read user B's cached source. v2 reintroduces a **narrowed, per-user facade**:

```ts
interface PluginCache {
  // Read-through ONLY: a miss (or a cacheSecurity revalidation failure) falls back to a live,
  // per-user-authorized fetch — never returns another user's cached bytes.
  getSource(ref: ObjectRef): Promise<string>;
  // No raw cache-only accessors; no cross-user keys; no write/invalidate (framework owns those).
}
```

The facade is constructed from the **same `cacheSecurity` context** threaded into built-in
`SAPRead` (`buildCacheSecurityContext`), so isolation is identical-by-construction. Cache
**invalidation hooks** (a plugin reacting to a write it made) are a separate, later item (§9).

---

## 4. Loading model additions

### 4.1 Directory entries

`ARC1_PLUGINS=/abs/plugin-dir` resolves `dir/package.json` → `exports['.']` ?? `main` ?? `index.js`,
then loads as a code plugin. Same fail-fast ownership/permission checks as a `.js` entry. (v1
handles `.js` + `.json` only.)

### 4.2 npm package discovery (CAP-style)

`ARC1_PLUGINS=arc1-plugin-foo` (a bare specifier, no `/`) resolves from the server's `node_modules`
via standard Node resolution, then loads the package's `arc1` entry. Naming convention
`arc1-plugin-*` (or `@scope/arc1-plugin-*`). **Opt-in and auditable**: still an explicit allowlist
entry, never auto-scanned. Directory auto-scan stays out (v1 spec §7).

---

## 5. `package.json#arc1.requires` — declared capability, intersected with the ceiling

A plugin declares the scopes/packages it needs:

```jsonc
"arc1": { "apiVersion": 2, "requires": { "scopes": ["write"], "packages": ["Z*"] } }
```

At load, ARC-1 **intersects** this with the server ceiling — it can only **narrow**, never expand:

- A plugin requiring `write` on a server with `allowWrites=false` → its write tools load but are
  **inert/hidden** (pruned from `tools/list`, refused at dispatch), with a startup warning.
- `requires.packages` further narrows the effective allowlist **for that plugin's writes** (a plugin
  scoped to `Z*` can't write `Y*` even if the server allows `*`).
- Reading `package.json#arc1` also unifies the `apiVersion` source: today the loader reads it from
  the `Plugin` default export; v2 reads the package manifest for directory/npm entries and
  cross-checks.

This is **defense-in-depth**, not a new authority — the ceiling still wins. It earns its keep once
writes exist (limiting blast radius per plugin).

---

## 6. Audit — `http_request` `pluginName`

Thread `pluginName` (and `requestId`) into the `AdtHttpClient` logging path so **every** SAP call a
plugin makes is attributable, not just the `tool_call_{start,end}` bracket (v1 ships the bracket;
the per-request tag was deferred). Mechanism: a per-call context (AsyncLocalStorage already used by
`requestContext`) carries `pluginName` into `emitAudit({ event: 'http_request', … })`. The field is
already declared optional on `HttpRequestEvent` — v2 populates it.

---

## 7. Per-handler timeout (review N4)

A hung plugin handler holds a `maxConcurrent` semaphore slot indefinitely (`handleToolCall`'s
try/catch contains *throws*, not *hangs*). v2 adds:

- **`ARC1_PLUGIN_TIMEOUT`** (default e.g. 60s) — wraps each plugin `invoke` in a timeout; on expiry
  the call rejects with a typed `PluginTimeoutError`, the slot frees, and an audit event fires.
- **`ctx.signal: AbortSignal`** — passed to the handler and wired into `ctx.http`/`ctx.write` so a
  well-behaved plugin can cooperatively abort in-flight SAP requests.

Applies to built-in handlers too (a strictly-better safety property), gated to avoid regressing
legitimately-long operations (activation of a large batch) — the timeout is generous and
configurable, `0` disables.

---

## 8. Custom visibility labels (`custom.<plugin>`)

Optional, pre-declared, **cosmetic** grouping label surfaced in `tools/list`/diagnostics so an
operator can see which plugin owns which `Custom_*` tool at a glance. **Not** an authorization
primitive (scopes remain the only gate — no custom/dynamic scopes, ever, because XSUAA
`xs-security.json` is deploy-time static). Strictly additive metadata.

---

## 9. Observer / hook bus

A small, synchronous-ish hook surface a plugin can register (declared in the `Plugin` export, not
per-tool):

```ts
interface PluginHooks {
  onToolCall?(evt: { tool: string; args: unknown; user?: string }): void | Promise<void>;
  onToolResult?(evt: { tool: string; ok: boolean; durationMs: number }): void | Promise<void>;
  onCacheInvalidate?(ref: ObjectRef): void;   // pairs with §3 — react to a write
}
```

Use cases: custom audit/metrics sinks, cache invalidation after a plugin write,
`withRetryOnSessionExpiry` wrappers. Hooks are **observe-only** (can't mutate args/results in v2 —
that's a v3 question) and are time-boxed by §7's timeout so a slow hook can't wedge the pipeline.

---

## 10. Multi-system (`sap_system_id`, FEAT-59)

When ARC-1 fronts multiple SAP systems (FEAT-59), a plugin tool accepts/echoes a `sap_system_id` and
`ctx.http`/`ctx.write` target that system's per-user client. Requires FEAT-59 to land first; the
plugin surface change is small (the context already carries a resolved client — it just becomes
system-scoped). Cross-system writes follow each system's own ceiling.

---

## 11. MCP prompts (FEAT-62)

Let a plugin contribute **MCP prompts** (not just tools) — e.g. a guided "create a RAP service"
prompt template. Declared in the `Plugin` export (`prompts?: PluginPrompt[]`), surfaced via the MCP
`prompts/list` + `prompts/get` handlers, gated by scope like tools. Depends on FEAT-62 wiring the
prompt handlers server-side.

---

## 12. API stabilization + semver (the headline non-feature)

v2 is where the public API earns a stability promise:

- Graduate `arc-1/public` from `@experimental` to **semver-stable**; `apiVersion: 2` becomes a
  supported contract, not a "may break any release" fuse.
- Document the **support window**: which `apiVersion`s a given ARC-1 release loads.
- Freeze `ToolContext`, `defineTool`, `PluginToolDefinition`, the manifest grammar, and `ctx.write`.
- Add **contract tests** that fail CI on any breaking change to the exported surface (mirrors the
  tool-definition snapshot freeze from the v1 playbook).

Until then v1 stays `@experimental` — a v1 plugin is expected to need a one-line `apiVersion` bump
+ possibly a small migration (§13) when v2 lands.

---

## 13. Migration from v1

| v1 plugin uses… | v2 change |
|------------------|-----------|
| `apiVersion: 1`, read-only | **loads unchanged** — v2 keeps the v1 read surface verbatim |
| wants writes | bump to `apiVersion: 2`; replace any intended raw `ctx.http.post` with `ctx.write.*` (ADT) or opt into `SAP_ALLOW_PLUGIN_RAW_WRITES` (OData/ICF) |
| wants caching | adopt `ctx.cache` (the safe facade — new in v2) |
| `package.json#arc1.requires` | now **enforced** (was inert in v1) — a too-broad `requires` may narrow the plugin's tools; tighten it |
| relied on no timeout | a runaway handler now aborts at `ARC1_PLUGIN_TIMEOUT`; honor `ctx.signal` |

No silent behavior change for a correct v1 read-only plugin.

---

## 14. Non-goals (still out in v2)

- **Replacing/overriding built-in tools** — `Custom_*` namespace only; never shadow `SAP*`.
- **Non-SAP egress** (`ctx.fetch` to arbitrary hosts) — build a separate MCP server on the BTP-auth
  module for that. ARC-1 plugins talk to the **connected SAP system** only.
- **Framework-managed ABAP deployment** — plugins still ship no ABAP; custom endpoints must already
  exist on the system.
- **Sandboxing / process isolation** — plugins are trusted local code an admin opts into; same
  trust model as v1. (A real sandbox is a v3+ research item.)
- **Marketplace / registry / hot-reload** — explicit `ARC1_PLUGINS` allowlist, restart to change.
- **Result-mutating hooks** — v2 hooks observe only (§9).

---

## 15. Open questions (to resolve before v2 PR1)

- **Q-v2-A — write vocabulary surface.** Exact `ctx.write` op set: just create/update/delete/activate,
  or also rename/move (DEVC), transport assignment, RAP scaffolding? Start minimal (the four), grow
  on demand.
- **Q-v2-B — raw non-ADT writes: ship at all?** `SAP_ALLOW_PLUGIN_RAW_WRITES` is genuinely
  package-unconstrained. Is the OData/ICF write use case strong enough, or defer to v2.1 and ship
  only `ctx.write` (ADT) first?
- **Q-v2-C — timeout default.** What value doesn't regress large-batch activation? Probe real
  durations; consider per-scope defaults (reads short, writes long).
- **Q-v2-D — `requires.packages` semantics.** Does it narrow the allowlist only for that plugin's
  writes, or also filter which objects its reads can touch? (Reads are already PP-gated SAP-side.)
- **Q-v2-E — hooks ordering/failure.** Multiple plugins with `onToolCall`: order? Does a throwing
  hook fail the call or just log? (Lean: log + continue; never let an observer break the tool.)
- **Q-v2-F — apiVersion negotiation.** Should ARC-1 load an `apiVersion: 1` plugin in a v2 server in
  a strict "read-only compatibility" mode, or require a recompile? (Lean: load v1 read-only as-is.)

---

## 16. Implementation sketch — PR sequence

| PR | Content | Risk |
|----|---------|------|
| **v2-PR1** | `ctx.write` vocabulary (create/update/delete/activate) routing through `write/` + package gate; `apiVersion: 2`; `AdtClient.lock/unlock` on the context path | HIGH (writes — adversarial-review each op against the built-in `SAPWrite` gate) |
| **v2-PR2** | `fetchCsrfToken(path?)` + `ctx.http.withStatefulSession` (write-gated) + `SAP_ALLOW_PLUGIN_RAW_WRITES` for non-ADT | MED |
| **v2-PR3** | Safe `ctx.cache` facade (cacheSecurity-bound) | MED |
| **v2-PR4** | Loader: directory + npm-specifier resolution; `package.json#arc1.requires` intersection | LOW |
| **v2-PR5** | `http_request` pluginName tag; per-handler timeout + `ctx.signal` | LOW |
| **v2-PR6** | Custom visibility labels; observer hook bus | LOW |
| **v2-PR7** | API stabilization: drop `@experimental`, contract-snapshot tests, support-window docs | LOW |
| _(later)_ | Manifest named-op writes; multi-system (FEAT-59); MCP prompts (FEAT-62) | — |

Each write-touching PR carries the same bar as the v1 review: **prove a plugin can't exceed a
built-in of the same scope**, with an adversarial test per gate (package bypass, scope coverage,
deny-action, raw-ADT-write refusal).

---

## 17. Cross-references

- v1 spec: [`extension-framework-spec.md`](2026-06-17-extension-framework-spec.md) (§13 roadmap, §16 review
  corrections N4 + S1/S7, §5 package-gating limitation).
- Rationale + external-project case studies:
  [`extension-framework-deep-research.md`](2026-06-17-extension-framework-deep-research.md).
- Security invariants the write surface must preserve: `docs/security-model.md`.
- Built-in write path the vocabulary reuses: `src/handlers/write/` + `src/handlers/write-helpers.ts`
  (`enforceAllowedPackageForObjectUrl`).

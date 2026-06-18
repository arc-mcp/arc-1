# Extensions (Custom Tools)

ARC-1 is **extensible**: you can add your own `Custom_*` tools to an ARC-1 instance **without
forking** — they reuse ARC-1's authenticated SAP client, its safety ceiling, scope policy, audit,
and per-user principal propagation. This is the FEAT-61 extension framework.

!!! info "Experimental"
    The extension API (`arc-1/public`) is **`@experimental`** — it may break in any release. A plugin
    declares a single `apiVersion` integer as the compatibility fuse. No semver guarantee yet.

- **Worked sample:** [`arc-mcp/arc-1-extension-sample`](https://github.com/arc-mcp/arc-1-extension-sample) — two code tools + one manifest tool, **live-verified against S/4HANA**.
- **Guided setup:** the **`create-arc1-extension`** skill (`.claude/skills/create-arc1-extension/`) walks you through the decisions, scaffolds the plugin, and points out the security implications for your use case.
- **Design:** `docs/research/extension-framework-spec.md` (spec) + `extension-framework-deep-research.md` (rationale).

---

## Extension, or a separate server?

The first decision. An extension runs **in-process** and talks to the **same SAP system** ARC-1 is
connected to, over **HTTP**.

| Your tool talks to… | Build a… |
|---|---|
| the **same SAP system** over HTTP — ADT, OData, or a custom ICF/REST service | **Extension** (this page) |
| a **different SAP product** (Cloud ALM, BTP services, BW, HANA, Datasphere, SuccessFactors) | **separate MCP server** (on the BTP-auth module) |
| a **non-HTTP protocol** (native RFC, SAP GUI scripting) | **separate MCP server** |

Extensions never ship ABAP — any custom endpoint they call must already exist on the SAP system.

---

## The two tiers

| Tier | What you write | Use when |
|---|---|---|
| **Code** (`defineTool`, TypeScript) | a handler function | you need logic, response shaping, or multiple reads |
| **Manifest** (`*.tool.json`, no code) | one JSON file declaring `input → one GET` | you just wrap a single **read** endpoint |

Both produce a `Custom_*` tool, gated identically.

!!! warning "v1 is read-only — with one gated exception"
    Both tiers are **read-only** in v1: `ctx.http` exposes **`GET`/`HEAD` only**. General write/`POST`
    support is deferred to v2 because a raw write can't be constrained by `SAP_ALLOWED_PACKAGES`
    (package resolution needs the ADT object-URL shape); shipping un-package-gated writes would bypass
    the server safety ceiling. The **one** privileged op available in v1 is **executing a console class**
    (`ctx.run.classRun`, see below) — a *named* operation (not a generic POST, so no package-bypass),
    locked behind a default-off opt-in. v2 adds the full package-aware write vocabulary.

---

## Quickstart

Clone the sample and adapt it:

```sh
git clone https://github.com/arc-mcp/arc-1-extension-sample
cd arc-1-extension-sample

# link the local arc-1 build (until arc-1 is published with the public API)
( cd /path/to/arc-1 && npm link )
npm install && npm link arc-1 && npm run build

# load into an ARC-1 instance…
ARC1_PLUGINS=$PWD/dist/index.js  arc1 --transport http-streamable
# …or drive one call (args are --json, never positional):
ARC1_PLUGINS=$PWD/dist/index.js  arc1-cli call Custom_ProgramLineCount --json '{"name":"RSPARAM"}'
```

`ARC1_PLUGINS` is a CSV of **absolute paths**. An entry is either a `.js` code plugin (point at the
built module, e.g. `dist/index.js`) or a bare `*.tool.json` manifest. Loading is **fail-fast** — a
malformed plugin or a name collision refuses server start.

---

## The plugin contract

### Code tier

```ts
import { z } from 'zod';
import { defineTool, OperationType } from 'arc-1/public';

export default defineTool({
  name: 'Custom_ProgramLineCount',          // MUST start with Custom_ (reserved namespace)
  description: 'Report the line count of an ABAP program.',
  schema: z.object({ name: z.string().min(1).max(40) }),
  policy: { scope: 'read', opType: OperationType.Read },   // declared capability — see Security below
  async handler(args, ctx) {
    const res = await ctx.http.get(`/sap/bc/adt/programs/programs/${encodeURIComponent((args as { name: string }).name)}/source/main`,
      { Accept: 'text/plain' });
    return { content: [{ type: 'text', text: `${res.body.split('\n').length} lines` }] };
  },
});
```

A `Plugin` default export collects tools + manifests:

```ts
export default { name: 'my-ext', version: '0.1.0', apiVersion: 1, tools: [...], manifests: ['manifests/Custom_X.tool.json'] } satisfies Plugin;
```

### Manifest tier

```json
{
  "name": "Custom_ReadProgram",
  "description": "Read an ABAP program's source.",
  "scope": "read",
  "inputSchema": { "type": "object", "additionalProperties": false,
    "required": ["name"], "properties": { "name": { "type": "string", "pattern": "^[A-Za-z0-9_/]{1,40}$" } } },
  "request": { "method": "GET", "path": "/sap/bc/adt/programs/programs/{name}/source/main",
    "pathParams": { "name": "$.name" }, "accept": "text/plain" },
  "response": { "maxBytes": 50000 }
}
```

v1 manifests are **read-only GET**: `additionalProperties:false` is required, `path` is a template with
**no host**, and path params are percent-encoded (traversal-safe).

---

## Calling SAP APIs

Everything goes through **`ctx.http`** — a **gated, read-only** (`GET`/`HEAD`) wrapper over ARC-1's
authenticated client. It can reach **any SAP path** on the connected system, with auth, CSRF, cookies,
per-user PP, and sessions handled for you:

| API | Example |
|---|---|
| ADT | `ctx.http.get('/sap/bc/adt/programs/programs/ZFOO/source/main')` |
| OData | `ctx.http.get('/sap/opu/odata/sap/ZSVC/EntitySet?$filter=…')` (caller `Accept: application/json`) |
| custom ICF/REST | `ctx.http.get('/sap/bc/http/sap/zmyservice')` (endpoint must already exist) |

The raw client is **never** exposed — `ctx.client` offers high-level reads only; its `.http`/`.safety`
escape hatches are blocked **at runtime** (a `(ctx.client as any).http` cast yields `undefined`), not
just hidden by types.

!!! warning "OData/ICF specifics"
    A service must be **activated in `/IWFND`** even if it appears in the catalog (a 403 *"No service
    found"* means it is registered but not activated).

---

## Executing ABAP (console classes)

The one privileged operation a v1 plugin can perform is **running an ABAP console class** — a class
that implements `IF_OO_ADT_CLASSRUN` (the modern replacement for executable reports on ABAP Cloud).
It runs through **`ctx.run.classRun(name)`**, which returns the class's `out->write( … )` console
output:

```ts
export default defineTool({
  name: 'Custom_RunClass',
  description: 'Execute an ABAP console class and return its console output.',
  schema: z.object({ className: z.string().min(1).max(40) }),
  policy: { scope: 'write', opType: OperationType.Workflow },   // execute ⇒ write-class op
  async handler(args, ctx) {
    const out = await ctx.run.classRun((args as { className: string }).className);
    return { content: [{ type: 'text', text: out }] };
  },
});
```

Executing arbitrary ABAP can mutate anything, so this is the **strictest-gated** capability in the
framework — **all** of the following must hold, or the call is refused with an `AdtSafetyError`:

| Gate | Why |
|---|---|
| `SAP_ALLOW_PLUGIN_EXECUTE=true` | a **dedicated** opt-in (default off) — enabling built-in writes never silently grants plugins code execution |
| `SAP_ALLOW_WRITES=true` | execution is a mutation vector; keeps the `allowWrites=false ⇒ no mutation` guarantee |
| tool declares `scope: 'write'` | a `read`-scoped tool can never execute |
| user has the `write` scope + SAP-side execute auth | the usual `scope ∧ SAP-auth` |

`classRun` is a **named** op (not a raw POST), so a plugin can only run a class **by name** (validated,
no path injection) — it cannot reach arbitrary write endpoints. That's why it can ship in read-only v1
safely; the general write surface still waits for v2.

---

## Security & roles (by use case)

!!! danger "A plugin is trusted code, not a sandbox"
    A code plugin is `import()`-ed into the ARC-1 process and runs with the **full privileges of the
    server**: it can read `process.env` (SAP credentials, the XSUAA `clientsecret`, the DCR signing
    secret), read/write the local filesystem, open outbound network connections, and spawn processes.
    The gated `ctx` (read-only `ctx.http`, the blocked `ctx.client`, the `classRun` gate) is a **clean
    API surface** that protects against a *buggy or over-eager* plugin and honours the admin's posture
    — it is **not** a containment boundary against a *hostile* one (a malicious plugin doesn't need
    `ctx`; it has `child_process`). **Loading a plugin is exactly as much a trust decision as adding a
    dependency to ARC-1 itself.** Only load plugins you have reviewed, and:

    - **Vet the supply chain.** A code plugin's transitive `node_modules` run in-process — a compromised
      dependency is a full ARC-1 compromise. Commit a lockfile, keep dependencies minimal, `npm audit`,
      and prefer the **manifest tier** (no code, no deps) when one GET suffices.
    - **Bake into an immutable artifact.** Ship plugins inside the reviewed deploy image / app bits,
      under the same change control as the rest of the server (see [Deploying](#deploying-extensions-btp-cloud-foundry--docker)).

This is the most important part. An extension tool **inherits ARC-1's full safety pipeline** — it is
gated exactly like a built-in. Two layers must both pass: the **user's scope** (their MCP role/profile)
**and** the **server's safety ceiling** (the admin's `allow*` flags). Per-user **principal propagation**
means the tool acts as the calling SAP user, so SAP-side auth (`S_DEVELOP`, package checks) applies too.

Declare `policy: { scope, opType }` to match the operation your tool performs. The user's scope must
**cover** it (a `read` user never sees a `write`-scoped tool), and the server ceiling must allow it.

| Use case | `scope` | `opType` | Server flag the admin must set | The user needs (XSUAA role / OIDC scope / API-key profile) |
|---|---|---|---|---|
| Read-only diagnostic (ADT/OData/ICF) | `read` | `R` | — | `read` |
| Create / update / delete an ABAP object *(v2)* | `write` | `C`/`U`/`D` | `SAP_ALLOW_WRITES=true` **+** target package in `SAP_ALLOWED_PACKAGES` | `write` |
| Table-content preview *(v2)* | `data` | `Q` | `SAP_ALLOW_DATA_PREVIEW=true` | `data` |
| Free-style SQL *(v2)* | `sql` | `F` | `SAP_ALLOW_FREE_SQL=true` | `sql` |
| Transport operation *(v2)* | `transports` | `X` | `SAP_ALLOW_TRANSPORT_WRITES=true` | `transports` |

Since v1 `ctx.http` is read-only, only the `read` row is live today; the rest document the model for the
v2 write surface (and the package-allowlist enforcement that ships with it).

Key points:

- **`custom` scopes are not supported.** Reuse the 7 built-in scopes — XSUAA scopes are deploy-time
  static (`xs-security.json`), so reuse maps cleanly to existing roles. See
  [Authorization & Roles](authorization.md).
- **Admins keep the kill switch.** `SAP_DENY_ACTIONS=Custom_*` removes all plugin tools;
  `SAP_DENY_ACTIONS=Custom_Foo` removes one.
- **Code execution is opt-in + default off.** `ctx.run.classRun` requires `SAP_ALLOW_PLUGIN_EXECUTE=true`
  **and** `SAP_ALLOW_WRITES=true` **and** a `write`-scoped tool (see [Executing ABAP](#executing-abap-console-classes)).
- **System-type visibility.** A tool may declare `availableOn: 'onprem' | 'btp'` (default `all`); it is
  hidden from `tools/list` when the resolved system type is known and differs.
- **Trust model:** plugins are **trusted in-process code** (see the danger callout above), loaded
  only from local `ARC1_PLUGINS` paths an admin opts into — no marketplace, no runtime upload, no
  sandbox by design. The `ctx` gates bound a buggy plugin and the server's posture, not a hostile one.
- **`policy.opType` is checked at registration, not per HTTP call.** The declared `scope` must cover
  the `opType`'s required scope (a tool can't claim `read` while declaring a write op, else it
  fails-fast at load). In v1 the *runtime* gates are the read-only `ctx.http` and `classRun`'s own
  checks; `opType` is reused for v2's write gating.

---

## Interactive capabilities

When the MCP client supports them, `ctx` also offers (capability-detected — `undefined` otherwise):

- `ctx.elicit(message, schema?)` — ask the user for input mid-tool.
- `ctx.notify(level, message)` — send a client-visible progress line.
- `ctx.sampling(systemPrompt, userMessage)` — ask the LLM a sub-question.

---

## Testing

Unit-test a handler with **no live SAP** using `createMockToolContext` from `arc-1/public/testing` — it
records `ctx.http` calls and returns a configured body:

```ts
import { createMockToolContext } from 'arc-1/public/testing';
const ctx = createMockToolContext({ responseBody: 'REPORT ZX.\nWRITE 1.' });
const res = await myTool.handler({ name: 'ZX' }, ctx);
expect(ctx.httpCalls[0].path).toContain('/programs/ZX/');
```

---

## Deploying extensions (BTP Cloud Foundry / Docker)

A plugin is a **local file** the server loads at startup from an **absolute** `ARC1_PLUGINS` path
(it's a literal CSV — **no `$HOME`/shell expansion**). On a managed deployment the container
filesystem comes from the deploy artifact, so "getting the plugin onto a stable absolute path" is the
whole problem. Three ways, with trade-offs:

| Strategy | How | Upside | Downside |
|---|---|---|---|
| **Derived Docker image** *(recommended)* | `FROM ghcr.io/arc-mcp/arc-1`, `COPY --chown` the plugin's `dist/`, set `ENV ARC1_PLUGINS=…` | self-contained + version-pinned with ARC-1; one immutable artifact through your image review/supply chain; identical local / CF‑Docker / k8s | rebuild + repush to change a plugin; needs a registry; **must `--chown`** (see gotcha) |
| **Buildpack co-deploy** *(matches the committed `mta.yaml`, `nodejs_buildpack`)* | put the plugin's built `dist/` in the pushed app bits (e.g. `plugins/<name>/`), set `ARC1_PLUGINS=/home/vcap/app/plugins/<name>/dist/index.js` | no image build; plain `cf push` / `mta build`; bits are `vcap`-owned so the owner check passes | the plugin rides ARC-1's deploy bits (coupled); rebuild the bits to change it |
| **Volume service (NFS)** | mount a CF volume, point `ARC1_PLUGINS` at it | swap a plugin without rebuilding the image/bits | plugin lives **outside** the audited artifact (trust gap); the mount's uid/permissions must satisfy the loader's owner + not‑world‑writable checks; still needs a restart |

### Derived Docker image — the recipe

```dockerfile
FROM ghcr.io/arc-mcp/arc-1:latest
# ARC-1 runs as the non-root user `arc1`. A plain COPY lands files as root → the loader rejects them.
COPY --chown=arc1:arc1 dist/      /home/arc1/plugins/myext/dist/
COPY --chown=arc1:arc1 manifests/ /home/arc1/plugins/myext/manifests/
ENV ARC1_PLUGINS=/home/arc1/plugins/myext/dist/index.js
```
Then `cf push my-arc1 --docker-image <registry>/my-arc1:<tag>` (or k8s / local `docker run`).

### The owner / permission gotcha (bites on Docker)

The loader **refuses** a plugin file that is **not owned by the server process user** or is
**world-writable** — defense-in-depth against a tampered drop-in. ARC-1's image runs as `arc1`, but a
plain `COPY` lands files as **root** → `"Plugin … is not owned by the server user — refusing to load"`.
Fix: **`COPY --chown=arc1:arc1`**, and never `chmod 777` a plugin. On the buildpack the bits are
already `vcap`-owned, so this is a non-issue there.

### Cross-cutting

- **No hot-reload.** Plugins load once at startup; changing one means a redeploy / `cf restage`. The
  `apiVersion` integer is the compatibility fuse across ARC-1 upgrades.
- **Adding a plugin needs NO XSUAA change.** Plugin tools reuse the 7 built-in scopes (no custom
  scopes), so you do **not** touch `xs-security.json` or role collections to ship a new `Custom_*`
  tool — a real operational win on BTP.
- **Per-user principal propagation still applies** — a plugin's `ctx` carries the per-user (PP) SAP
  client, so its calls run as the calling SAP user, same as built-in tools.
- **Execution is per-deployment opt-in.** `SAP_ALLOW_PLUGIN_EXECUTE` / `SAP_ALLOW_WRITES` are server
  env (`cf set-env` / MTA) — set them only where you intend plugins to run classes.
- **Trust = supply chain.** Plugins are baked into the deploy artifact and reviewed with it; there is
  no runtime upload. Keep `ARC1_PLUGINS` under the same change control as the rest of the app.

---

## Roadmap (v2)

v1 is **read-only** on purpose. The biggest v2 item is a **package-aware write surface** — a
`ctx.write` vocabulary that routes ADT object writes through the same package-allowlist gate built-in
`SAPWrite` uses (so a plugin still can't write outside `SAP_ALLOWED_PACKAGES`), plus opt-in raw writes
for package-less OData/ICF calls. Also planned: a safe per-user `ctx.cache`, directory + npm-package
loading, `package.json#arc1.requires` capability intersection, per-handler timeouts, and graduating
the API from `@experimental` to semver-stable. Full design:
`docs/research/extension-framework-v2-spec.md`.

---

## Reference

- **Sample repo:** <https://github.com/arc-mcp/arc-1-extension-sample>
- **Guided skill:** `create-arc1-extension` (`.claude/skills/create-arc1-extension/`)
- **Spec & research:** `docs/research/extension-framework-spec.md`, `extension-framework-deep-research.md`
- **Related:** [Authorization & Roles](authorization.md) · [Tools Reference](tools.md) · [CLI Guide](cli-guide.md)

---
name: create-arc1-extension
description: Use when a developer wants to add their own custom tool(s) to an ARC-1 MCP instance — an "extension" or "plugin" (FEAT-61). Guides the key architecture decisions (extension vs separate server; code tier vs manifest tier; which SAP API; scope/opType), then scaffolds the plugin and walks build + load + test. Do NOT use for adding a tool to ARC-1 core itself (that is an in-tree change), or for a different SAP backend (that is a separate server).
---

# Create an ARC-1 extension

Guides a developer through building an **ARC-1 extension** — a local plugin that adds `Custom_*`
tools to an ARC-1 instance **without forking**, reusing ARC-1's authenticated SAP client, the
7-scope + allow\* safety ceiling, audit, and PP. Encodes the learnings from building the framework
(PR1–PR5) and verifying it live on S/4HANA.

**Ground truth — read these first, mirror them:**
- **User guide (point the developer here):** [`docs_page/extensions.md`](../../../docs_page/extensions.md)
  — the canonical how-to (tiers, `ctx.http`/`ctx.run`, security, **CF/Docker deployment**). Published at
  the docs site under *Using ARC-1 → Extensions (Custom Tools)*.
- **Spec:** `docs/research/extension-framework-spec.md` (v1) + `extension-framework-v2-spec.md` (what's deferred).
- **Worked sample:** [`arc-mcp/arc-1-extension-sample`](https://github.com/arc-mcp/arc-1-extension-sample)
  — two read tools (ADT + OData), one manifest tool, and **`Custom_RunClass`** (the gated execute op),
  all live-verified on S/4HANA.

**v1 reality (do not get this wrong):** plugins are **read-only** — `ctx.http` is **GET/HEAD only**. The
ONE privileged op is **executing a console class** via `ctx.run.classRun` (gated, opt-in). General
object writes (create/update/delete) are **v2** (`ctx.write`, package-aware) — not available yet.

## Trigger

- "add a custom tool / plugin / extension to ARC-1"
- "wrap this SAP/ADT/OData endpoint as an MCP tool"
- "build my own ARC-1 tool without forking"
- "diagnostic tool on top of ARC-1" (SM37/SLG1/gateway logs, etc.)

## Step 1 — decide the path (ask, don't assume)

Use `AskUserQuestion`. The first question is a gate:

1. **Backend.** Does the tool talk to the **same SAP system ARC-1 connects to, over HTTP** (ADT,
   OData, or a custom ICF/REST service)?
   - **No — a different SAP product** (Cloud ALM, BTP services, BW, HANA, Datasphere, SuccessFactors)
     **or a non-HTTP protocol** (native RFC, SAP GUI scripting) → **this is NOT an extension.** It is a
     **separate MCP server** (build on the BTP-auth module, the "own-server" path). **Stop here** and
     point them there.
   - **Yes** → continue.
2. **Tier.**
   - **Manifest tier** (declarative JSON, no code) — if the tool is "validate inputs → one **read**
     GET → return". No logic.
   - **Code tier** (`defineTool`, TypeScript) — if it needs logic, response shaping, multiple reads,
     or to **execute a console class** (`ctx.run.classRun`).
3. **SAP API** — ADT (`/sap/bc/adt/…`), OData (`/sap/opu/odata/…`), or a custom ICF (`/sap/bc/http/…`).
   For a custom endpoint: it **must already exist on SAP** — extensions ship **no ABAP**.
4. **What it does**, and the **scope** + **opType**:
   - read (any of the three APIs) → `scope: 'read'`, `opType: 'R'` — uses `ctx.http.get`.
   - **execute a console class** (`IF_OO_ADT_CLASSRUN`) → `scope: 'write'`, `opType: OperationType.Workflow`
     — uses `ctx.run.classRun`. Refused unless the admin sets **`SAP_ALLOW_PLUGIN_EXECUTE=true` +
     `SAP_ALLOW_WRITES=true`**. This is the only privileged op in v1.
   - **object create/update/delete** → **NOT available in v1** — that's the v2 `ctx.write` surface.
     If the tool needs it, say so and stop; it can't ship yet.

## Step 2 — scaffold (mirror `arc-1-extension-sample`)

Create a new repo `arc1-plugin-<name>` (pure TS, **no ABAP**):

- **`package.json`** — `"type":"module"`, peerDep `"arc-1": ">=<ver>"`, devDeps `typescript`+`zod`,
  build `"tsc && node -e \"require('node:fs').cpSync('manifests','dist/manifests',{recursive:true})\""`
  (only if it has manifests). An optional `"arc1": { "apiVersion": 1 }` block is a **forward
  declaration** — in v1 the loader reads `apiVersion` from the `Plugin` **default export** (`src/index.ts`),
  and `requires:{scopes,packages}` is **v2** (declared-but-not-yet-enforced), so don't rely on it.
- **Code tier** → `src/tools/Custom_<X>.ts`:
  ```ts
  import { z } from 'zod';
  import { defineTool, OperationType } from 'arc-1/public';
  export default defineTool({
    name: 'Custom_<X>',                 // MUST start with Custom_
    description: '…',
    schema: z.object({ /* … */ }),
    policy: { scope: 'read', opType: OperationType.Read },
    async handler(args, ctx) {
      const res = await ctx.http.get(`/sap/bc/adt/…`, { Accept: 'text/plain' });
      return { content: [{ type: 'text', text: /* shape res.body */ }] };
    },
  });
  ```
- **Manifest tier** → `manifests/Custom_<X>.tool.json`:
  ```json
  { "name": "Custom_<X>", "description": "…", "scope": "read",
    "inputSchema": { "type": "object", "additionalProperties": false,
      "required": ["name"], "properties": { "name": { "type": "string", "pattern": "^[A-Za-z0-9_/]{1,40}$" } } },
    "request": { "method": "GET", "path": "/sap/bc/adt/…/{name}/source/main",
      "pathParams": { "name": "$.name" }, "accept": "text/plain" },
    "response": { "maxBytes": 50000 } }
  ```
- **Execute tier** (run a console class) → `src/tools/Custom_<X>.ts`:
  ```ts
  import { z } from 'zod';
  import { defineTool, OperationType } from 'arc-1/public';
  export default defineTool({
    name: 'Custom_<X>',
    description: 'Execute an ABAP console class and return its output.',
    schema: z.object({ className: z.string().min(1).max(40) }),
    policy: { scope: 'write', opType: OperationType.Workflow },   // execute ⇒ write-class op
    async handler(args, ctx) {
      const out = await ctx.run.classRun((args as { className: string }).className);  // gated; see Step 1.4
      return { content: [{ type: 'text', text: out }] };
    },
  });
  ```
- **`src/index.ts`** — `export default { name, version, apiVersion: 1, tools: [...], manifests: ['manifests/Custom_<X>.tool.json'] } satisfies Plugin;`
- **README** — what it does + the load command.

## Step 3 — build + load + test (this is live-verified)

```sh
# until arc-1 is published with the public API, link the local build:
( cd /path/to/arc-1 && npm link )
npm install && npm link arc-1 && npm run build

# load into an instance…
ARC1_PLUGINS=$PWD/dist/index.js  arc1 --transport http-streamable
# …or drive one read call (args MUST be --json, not positional):
ARC1_PLUGINS=$PWD/dist/index.js  arc1-cli call Custom_<X> --json '{"name":"RSPARAM"}'
# …an execute tool ALSO needs the two opt-ins (else it's refused):
SAP_ALLOW_PLUGIN_EXECUTE=true SAP_ALLOW_WRITES=true \
  ARC1_PLUGINS=$PWD/dist/index.js  arc1-cli call Custom_<X> --json '{"className":"ZCL_FOO"}'
```

Confirm the tool appears in `tools/list` and the call returns real SAP data. For **deploying** the
plugin to BTP Cloud Foundry or Docker (the owner-check / `--chown` gotcha, image vs buildpack vs
volume trade-offs), point the developer at the **Deploying extensions** section of
[`docs_page/extensions.md`](../../../docs_page/extensions.md).

## Gotchas (learned the hard way)

- **`Custom_` namespace is mandatory** and collisions **fail server start** (fail-fast).
- **`ctx.http` is read-only (GET/HEAD).** `post`/`put`/`delete`/`withStatefulSession` are **not on the
  surface** in v1 (a raw write can't be package-allowlist-gated → deferred to v2). Don't write a tool
  that needs them yet.
- **`ctx.client` is a runtime *plain-read* view** — `.http`/`.safety` AND the data/SQL reads
  (`getTableContents`/`runQuery`/`runTableQuery`) are blocked at runtime (a cast yields `undefined`).
  v1 plugins have no data/SQL surface; use the plain read methods (or `ctx.http.get`).
- **`policy.opType` must match `scope`** — the declared scope has to cover the opType's required scope
  (e.g. `opType:'U'` needs `scope:'write'`), or the plugin **fails server start**. Keep them consistent
  with the examples above.
- **Executing a class is the one privileged op.** `ctx.run.classRun(name)` runs an `IF_OO_ADT_CLASSRUN`
  console class. Gated: needs `SAP_ALLOW_PLUGIN_EXECUTE=true` **and** `SAP_ALLOW_WRITES=true` **and** a
  `write`-scoped tool; the class name is validated (no path injection). Off by default.
- **OData service must be ACTIVATED in `/IWFND`** even if it shows in the catalog (a 403
  "No service found" means it is registered but not activated).
- **Manifest tier = read-only GET**, `additionalProperties:false` required, `path` is a template with
  **no host**, path params percent-encoded (traversal-safe). No POST/body in v1.
- **`availableOn: 'onprem' | 'btp'`** (optional, default `all`) hides the tool from `tools/list` when
  the resolved system type differs. Hyperfocused mode shows no plugin tools at all.
- **`elicit`/`notify`/`sampling`** on `ctx` are **capability-gated** — present only when the MCP client
  supports them (absent on the CLI/stdio path).
- **Unit-test the handler** with `createMockToolContext` from `arc-1/public/testing` (records
  `ctx.http`/`ctx.run.classRun` calls, returns configured output — no live SAP needed).
- **Admin kill switch:** `SAP_DENY_ACTIONS=Custom_*` (all) or `Custom_Foo` (one) removes plugin tools.

## Deploy (when they ask)

Point at **Deploying extensions** in [`docs_page/extensions.md`](../../../docs_page/extensions.md).
Key facts: plugins are **local files** loaded from an **absolute** `ARC1_PLUGINS` path (no `$HOME`
expansion); on BTP CF use a **derived Docker image** (`FROM ghcr.io/arc-mcp/arc-1`, `COPY --chown=arc1:arc1`
— a plain `COPY` lands as root and the loader **rejects non-owner / world-writable** files) **or**
co-deploy the built `dist/` in the buildpack app bits (`/home/vcap/app/...`, `vcap`-owned). **No
hot-reload** (redeploy to change). **No XSUAA change** to add a plugin (scopes are reused).

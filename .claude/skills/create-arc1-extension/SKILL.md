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
- **Spec:** `docs/research/2026-06-17-extension-framework-spec.md` (v1) + `extension-framework-v2-spec.md` (what's deferred).
- **Worked sample:** [`arc-mcp/arc-1-extension-sample`](https://github.com/arc-mcp/arc-1-extension-sample)
  — ADT + OData **reads**, a **manifest** tool, **`Custom_RunClass`** (gated execute), an OData
  **write** (`Custom_CreateSalesOrder`), and a full **[LISA](https://github.com/ClementRingot/LISA)
  custom-ICF integration** (`Custom_ListLanguages`/`GetTranslation`/`SetTranslation`) — all
  live-verified on S/4HANA (real HTTP 201/200 writes). Copy the closest tool and adapt.

**v1 reality (do not get this wrong):** reads are open (`ctx.http.get`/`head`). **Writes** (`ctx.http.post`/
`put`/`delete`) work **only to non-ADT paths** (OData/ICF) behind the opt-in `SAP_ALLOW_PLUGIN_RAW_WRITES`.
A console class runs via `ctx.run.classRun` (opt-in `SAP_ALLOW_PLUGIN_EXECUTE`). **ADT object** writes
(CLAS/DDLS/… via `/sap/bc/adt/…`) are **always refused** — those are the v2 package-aware `ctx.write`.

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
     GET → return". No logic, no writes.
   - **Code tier** (`defineTool`, TypeScript) — if it needs logic, response shaping, multiple reads,
     a **write** to an OData/ICF service (`ctx.http.post`/`put`/`delete`), or to **execute a console
     class** (`ctx.run.classRun`).
3. **SAP API** — ADT (`/sap/bc/adt/…`), OData (`/sap/opu/odata/…`), or a custom ICF (`/sap/bc/http/…`).
   For a custom endpoint: it **must already exist on SAP** — extensions ship **no ABAP**.
4. **What it does**, and the **scope** + **opType**:
   - read (any of the three APIs) → `scope: 'read'`, `opType: OperationType.Read` — uses `ctx.http.get`.
   - **write to an OData/ICF service** (`ctx.http.post`/`put`/`delete`) → `scope: 'write'`, `opType`
     `Create`/`Update`/`Delete`. Refused unless the admin sets **`SAP_ALLOW_PLUGIN_RAW_WRITES=true` +
     `SAP_ALLOW_WRITES=true`**. The path must be **non-ADT** (`/sap/opu/odata/…` or `/sap/bc/http/…`).
   - **execute a console class** (`IF_OO_ADT_CLASSRUN`) → `scope: 'write'`, `opType: OperationType.Workflow`
     — uses `ctx.run.classRun`. Refused unless **`SAP_ALLOW_PLUGIN_EXECUTE=true` + `SAP_ALLOW_WRITES=true`**.
   - **ADT object create/update/delete** (CLAS/DDLS/… via `/sap/bc/adt/…`) → **NOT available in v1** —
     always refused; that's the v2 package-aware `ctx.write`. If the tool needs it, say so and stop.

## Step 2 — scaffold (mirror `arc-1-extension-sample`)

Create a new repo `arc1-plugin-<name>` (pure TS, **no ABAP**):

- **`package.json`** — `"type":"module"`, peerDep `"arc-1": ">=<ver>"`, devDeps `typescript`+`zod`,
  build `"tsc && node -e \"require('node:fs').cpSync('manifests','dist/manifests',{recursive:true})\""`
  (only if it has manifests). An optional `"arc1": { "apiVersion": 1 }` block is a **forward
  declaration** — in v1 the loader reads `apiVersion` from the `Plugin` **default export** (`src/index.ts`),
  and `requires:{scopes,packages}` is **v2** (declared-but-not-yet-enforced), so don't rely on it.
- **Read (code tier)** → `src/tools/Custom_<X>.ts`:
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
- **Write (code tier)** — OData / custom-ICF `POST`/`PUT`/`DELETE` → `src/tools/Custom_<X>.ts`:
  ```ts
  import { z } from 'zod';
  import { defineTool, OperationType } from 'arc-1/public';
  export default defineTool({
    name: 'Custom_<X>',
    description: 'Create something via an OData/ICF service.',
    schema: z.object({ /* … */ }),
    policy: { scope: 'write', opType: OperationType.Create },   // POST→Create / PUT→Update / DELETE→Delete
    async handler(args, ctx) {
      const body = JSON.stringify(/* entity / payload */);
      // path MUST be non-ADT (OData/ICF); CSRF is fetched + attached automatically.
      const res = await ctx.http.post('/sap/opu/odata/<ns>/<SERVICE>/<EntitySet>', body, 'application/json',
        { Accept: 'application/json' });
      return { content: [{ type: 'text', text: `HTTP ${res.statusCode}\n${res.body}` }] };
    },
  });
  ```
- **Execute (code tier)** — run a console class → `src/tools/Custom_<X>.ts`:
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
# …a WRITE tool (OData/ICF) needs the raw-write opt-ins (else it's refused):
SAP_ALLOW_PLUGIN_RAW_WRITES=true SAP_ALLOW_WRITES=true \
  ARC1_PLUGINS=$PWD/dist/index.js  arc1-cli call Custom_<X> --json '{ … }'
# …an EXECUTE tool needs the execute opt-ins:
SAP_ALLOW_PLUGIN_EXECUTE=true SAP_ALLOW_WRITES=true \
  ARC1_PLUGINS=$PWD/dist/index.js  arc1-cli call Custom_<X> --json '{"className":"ZCL_FOO"}'
```

Read the result, not just the exit. A gate refusal is an **`AdtSafetyError`** ("…disabled" / "may not
write to an ADT path"); a SAP-side problem (wrong path, missing service, bad payload) is an
**`AdtApiError`** with the SAP status + body — that means the gate *passed* and the request reached SAP
(useful signal). Iterate on the path/payload from the SAP error.

Confirm the tool appears in `tools/list` and the call returns real SAP data. For **deploying** the
plugin to BTP Cloud Foundry or Docker (the owner-check / `--chown` gotcha, image vs buildpack vs
volume trade-offs), point the developer at the **Deploying extensions** section of
[`docs_page/extensions.md`](../../../docs_page/extensions.md).

## Gotchas (learned the hard way)

- **`Custom_` namespace is mandatory** and collisions **fail server start** (fail-fast).
- **`ctx.http` reads freely (GET/HEAD); writes (`post`/`put`/`delete`) hit only NON-ADT paths** and
  only when the admin sets `SAP_ALLOW_PLUGIN_RAW_WRITES=true` (+ `SAP_ALLOW_WRITES=true`) and the tool
  declares `scope:'write'`. Writes to `/sap/bc/adt/…` object paths are **always refused** (package
  allowlist can't be enforced on a raw write — ADT object writes are the v2 `ctx.write` vocabulary).
  CSRF is fetched + attached automatically. Use this for OData / custom-ICF write services.
- **`ctx.client` is a runtime *plain-read* view** — `.http`/`.safety` AND the data/SQL reads
  (`getTableContents`/`runQuery`/`runTableQuery`) are blocked at runtime (a cast yields `undefined`).
  v1 plugins have no data/SQL surface; use the plain read methods (or `ctx.http.get`).
- **`policy.opType` must match `scope`** — the declared scope has to cover the opType's required scope
  (e.g. `opType:'U'` needs `scope:'write'`), or the plugin **fails server start**. Keep them consistent
  with the examples above.
- **Executing a class is the one privileged op.** `ctx.run.classRun(name)` runs an `IF_OO_ADT_CLASSRUN`
  console class. Gated: needs `SAP_ALLOW_PLUGIN_EXECUTE=true` **and** `SAP_ALLOW_WRITES=true` **and** a
  `write`-scoped tool; the class name is validated (no path injection). Off by default.
- **OData path discovery — a 403 `/IWFND/MED/170 "No service found"` usually means the WRONG path,
  not just an inactive service.** The service name AND namespace matter: e.g. the EPM demo is
  `/sap/opu/odata/iwbep/GWSAMPLE_BASIC`, *not* `/sap/opu/odata/sap/ZGWSAMPLE_BASIC`. Find the real
  path by `GET …/$metadata` (200 = right; 403 = wrong path or genuinely inactive → `/IWFND/MAINT_SERVICE`).
- **OData V2 *create* gotcha:** a `POST` must **not** carry a `$format=json` query option (it's a
  SystemQueryOption → `400 "not allowed for this Request Type"`). Negotiate JSON via the `Accept`
  header instead. Required entity fields vary — `GET …/<EntitySet>?$top=1` to see the shape.
- **Custom-ICF (LISA-style) services:** typically `POST /sap/bc/http/sap/<SERVICE>/<action>` with a
  **JSON body** (the action is in the URL path; the body is the params). Two consequences: (1) if the
  service uses `POST` for *reads* too, those read tools STILL need `SAP_ALLOW_PLUGIN_RAW_WRITES` +
  `scope:'write'` (`ctx.http` gates by HTTP method) — declare `opType: Read` to keep the operation
  honest; (2) a write may require an **open transport request** — create one with `SAPTransport`
  (on a system with no STMS routes it's a local request, which is fine).
- **A write reaching SAP ≠ a 2xx.** The gate + CSRF + POST can all succeed and SAP still returns a
  4xx (bad payload, inactive service, missing transport). That's an `AdtApiError`, not a gate
  refusal — adjust the request, the framework did its job.
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

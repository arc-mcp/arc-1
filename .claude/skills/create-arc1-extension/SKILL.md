---
name: create-arc1-extension
description: Use when a developer wants to add their own custom tool(s) to an ARC-1 MCP instance — an "extension" or "plugin" (FEAT-61). Guides the key architecture decisions (extension vs separate server; code tier vs manifest tier; which SAP API; scope/opType), then scaffolds the plugin and walks build + load + test. Do NOT use for adding a tool to ARC-1 core itself (that is an in-tree change), or for a different SAP backend (that is a separate server).
---

# Create an ARC-1 extension

Guides a developer through building an **ARC-1 extension** — a local plugin that adds `Custom_*`
tools to an ARC-1 instance **without forking**, reusing ARC-1's authenticated SAP client, the
7-scope + allow\* safety ceiling, audit, and PP. Encodes the learnings from building the framework
(PR1–PR5) and verifying it live on S/4HANA.

**Ground truth:** `docs/research/extension-framework-spec.md` (the spec) and the worked sample at
`arc-1-extension-sample` (two code tools + one manifest tool, live-verified). Mirror them.

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
   - **Manifest tier** (declarative JSON, no code) — if the tool is "validate inputs → make one
     **read** GET → return". No logic, no writes.
   - **Code tier** (`defineTool`, TypeScript) — if it needs logic, response shaping, multiple calls,
     or **writes**.
3. **SAP API** — ADT (`/sap/bc/adt/…`), OData (`/sap/opu/odata/…`), or a custom ICF (`/sap/bc/http/…`).
   For a custom endpoint: it **must already exist on SAP** — extensions ship **no ABAP**.
4. **Read or write**, and the **scope** + **opType**:
   - read → `scope: 'read'`, `opType: 'R'`
   - create/update/delete → `scope: 'write'`, `opType: 'C'|'U'|'D'` (requires `allowWrites` on the server)
   - data preview → `'data'`/`'Q'`; free SQL → `'sql'`/`'F'`; transport → `'transports'`/`'X'`

## Step 2 — scaffold (mirror `arc-1-extension-sample`)

Create a new repo `arc1-plugin-<name>` (pure TS, **no ABAP**):

- **`package.json`** — `"type":"module"`, peerDep `"arc-1": ">=<ver>"`, devDeps `typescript`+`zod`,
  build `"tsc && node -e \"require('node:fs').cpSync('manifests','dist/manifests',{recursive:true})\""`
  (only if it has manifests), and the capability block:
  ```json
  "arc1": { "apiVersion": 1, "requires": { "scopes": ["read"], "packages": [] } }
  ```
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
- **`src/index.ts`** — `export default { name, version, apiVersion: 1, tools: [...], manifests: ['manifests/Custom_<X>.tool.json'] } satisfies Plugin;`
- **README** — what it does + the load command.

## Step 3 — build + load + test (this is live-verified)

```sh
# until arc-1 is published with the public API, link the local build:
( cd /path/to/arc-1 && npm link )
npm install && npm link arc-1 && npm run build

# load into an instance…
ARC1_PLUGINS=$PWD/dist/index.js  arc1 --http-streamable
# …or drive one call (args MUST be --json, not positional):
ARC1_PLUGINS=$PWD/dist/index.js  arc1-cli call Custom_<X> --json '{"name":"RSPARAM"}'
```

Confirm the tool appears in `tools/list` and the call returns real SAP data.

## Gotchas (learned the hard way)

- **`Custom_` namespace is mandatory** and collisions **fail server start** (fail-fast).
- **`ctx.http` is gated.** A `read`-scoped tool **cannot POST** (scope-coverage throws); a write tool's
  POST also needs `allowWrites` on the server. Declare the scope that matches the highest operation.
- **`allowedPackages` does NOT gate OData/ICF calls** (no ABAP package in the path) — non-ADT writes
  are gated by `allowWrites` + scope + the Cloud Connector allowlist + SAP-side auth only.
- **Writes (v1)** use `ctx.http.withStatefulSession(...)` with the `?_action=LOCK` / `?_action=UNLOCK`
  POSTs; **OData/ICF writes additionally need a CSRF token fetched against the service path** (not yet
  a one-liner — see the spec's deferred write ergonomics).
- **OData service must be ACTIVATED in `/IWFND`** even if it shows in the catalog (a 403
  "No service found" means it is registered but not activated).
- **Manifest tier v1 = read-only GET**, `additionalProperties:false` required, `path` is a template
  with **no host**, path params are percent-encoded (traversal-safe). Writes/POST stay code-tier.
- **`elicit`/`notify`/`sampling`** on `ctx` are **capability-gated** — present only when the MCP client
  supports them (absent on the CLI/stdio path).
- **Unit-test the handler** with `createMockToolContext` from `arc-1/public/testing` (records
  `ctx.http` calls, returns a configured body — no live SAP needed).

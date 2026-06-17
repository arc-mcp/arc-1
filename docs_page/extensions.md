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

!!! warning "v1 is read-only"
    Both tiers are **read-only** in v1 — `ctx.http` exposes **`GET`/`HEAD` only**. Write/`POST` support
    is deferred to v2 because a raw write can't be constrained by `SAP_ALLOWED_PACKAGES` (package
    resolution needs the ADT object-URL shape); shipping un-package-gated writes would bypass the
    server safety ceiling. v2 adds a package-aware write vocabulary.

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
ARC1_PLUGINS=$PWD/dist/index.js  arc1 --http-streamable
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

## Security & roles (by use case)

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
- **System-type visibility.** A tool may declare `availableOn: 'onprem' | 'btp'` (default `all`); it is
  hidden from `tools/list` when the resolved system type is known and differs.
- **Trust model:** plugins are local files an admin explicitly opts into via `ARC1_PLUGINS` (no
  marketplace). They run in-process with the gated context — no sandbox, by design.

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

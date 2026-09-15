# Build custom tools

Add `Custom_*` tools to an ARC-1 instance using its authenticated connection to the same SAP system.
Use an extension for ADT, OData, or custom ICF HTTP calls. Use a separate MCP server for another
system or a non-HTTP protocol such as RFC.

**The extension API is experimental.** `arc-1/public` can change in any release. Plugins declare
`apiVersion: 1`; a version mismatch refuses startup.

## Choose an extension type

| Need | Use |
|---|---|
| Wrap one GET endpoint | A `*.tool.json` manifest |
| Combine calls or shape results | A TypeScript code plugin |
| Write to OData/ICF or execute a console class | A code plugin with the required opt-ins below |

Code plugins run inside the ARC-1 process with access to its secrets, filesystem, network, and
process privileges. The `ctx` API is not a sandbox against malicious code. Review the plugin and
its dependencies as part of the server artifact. Prefer a manifest when one GET is sufficient.

The [extension sample](https://github.com/arc-mcp/arc-1-extension-sample) contains read, OData write,
console-class, and custom ICF examples. Custom SAP services must already be installed and active.

## Create a read tool

Use `defineTool` to declare the schema, required scope, and operation type. The module's default
export must be a **plugin containing a `tools` array**, rather than the individual tool.

```ts
import { z } from 'zod';
import { defineTool, OperationType, type Plugin } from 'arc-1/public';

export const programLineCount = defineTool({
  name: 'Custom_ProgramLineCount',
  description: 'Report the line count of an ABAP program.',
  schema: z.object({ name: z.string().min(1).max(40) }),
  policy: { scope: 'read', opType: OperationType.Read },
  async handler(args, ctx) {
    const { name } = args as { name: string };
    const path = `/sap/bc/adt/programs/programs/${encodeURIComponent(name)}/source/main`;
    const response = await ctx.http.get(path, { Accept: 'text/plain' });
    return {
      content: [{ type: 'text', text: `${response.body.split('\n').length} lines` }],
    };
  },
});

export default {
  name: 'my-extension',
  version: '0.1.0',
  apiVersion: 1,
  tools: [programLineCount],
} satisfies Plugin;
```

Compile the TypeScript module to JavaScript using your project's build. With ARC-1 installed and
its SAP connection configured, load the built file by absolute path:

```bash
export ARC1_PLUGINS=/absolute/path/to/my-extension/dist/index.js
arc1 tools
arc1 call Custom_ProgramLineCount --json '{"name":"RSPARAM"}'
```

To launch the MCP server with the same extension, run `arc1 serve`. Configure authentication when
using HTTP transport; see [Configuration](configuration-reference.md).

## Wrap one GET with a manifest

Save a file such as `Custom_ReadProgram.tool.json`:

```json
{
  "name": "Custom_ReadProgram",
  "description": "Read an ABAP program's source.",
  "scope": "read",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["name"],
    "properties": {
      "name": { "type": "string", "pattern": "^[A-Za-z0-9_/]{1,40}$" }
    }
  },
  "request": {
    "method": "GET",
    "path": "/sap/bc/adt/programs/programs/{name}/source/main",
    "pathParams": { "name": "$.name" },
    "accept": "text/plain"
  },
  "response": { "maxBytes": 50000 }
}
```

Set `ARC1_PLUGINS` to its absolute path. Manifests are GET-only, require
`additionalProperties: false`, and percent-encode path parameters. Paths must be host-relative.
A code plugin can also include `manifests: ['manifests/Custom_ReadProgram.tool.json']`; these paths
resolve relative to the plugin module.

## Call SAP APIs

`ctx.http` handles authentication, CSRF, cookies, sessions, and principal propagation for the
connected system. Set the response format expected by the service:

| API | Example |
|---|---|
| ADT | `ctx.http.get('/sap/bc/adt/programs/programs/ZFOO/source/main', { Accept: 'text/plain' })` |
| OData | `ctx.http.get('/sap/opu/odata/sap/ZSVC/EntitySet', { Accept: 'application/json' })` |
| Custom ICF | `ctx.http.get('/sap/bc/http/sap/zmyservice')` |

`ctx.client` exposes high-level reads. Its raw HTTP and safety interfaces are blocked at runtime.
A service listed in a catalog may still need activation: check `/IWFND` for OData and SICF for ICF.

## Permissions

The user's scope, the server ceiling, and SAP authorization must all permit an operation.
Declare a matching `policy.scope` and `policy.opType`; inconsistent declarations fail at load time.
Runtime HTTP checks also enforce the method and opt-in settings.

| Operation | Scope / operation | Required server settings |
|---|---|---|
| GET/HEAD | `read` / `OperationType.Read` | No extra write opt-in |
| OData/ICF POST, PUT, DELETE | `write` / Create, Update, or Delete | `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_PLUGIN_RAW_WRITES=true` |
| Execute a console class | `write` / `OperationType.Workflow` | `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_PLUGIN_EXECUTE=true` |
| Raw write below `/sap/bc/adt/` | Unavailable | Always refused |

`SAP_ALLOWED_PACKAGES` controls ABAP object writes, not OData/ICF paths or the business effects of
console-class execution. The called service owns its locking, transports, and business checks.
Plugins do not currently have package-aware `ctx.write`, scoped `ctx.data`, or `ctx.sql` APIs.

Additional controls:

- To disable an extension, remove its path from `ARC1_PLUGINS` and restart. Clear `ARC1_PLUGINS`
  to disable all extensions. `SAP_DENY_ACTIONS` accepts built-in tool names only; `Custom_*` and
  `Custom_Foo` are invalid and prevent startup.
- Reuse the seven built-in scopes; custom scopes are not supported and no new XSUAA scope is needed.
- `availableOn: 'onprem'` or `'btp'` limits visibility when the system type is known. Default: `all`.
- Under principal propagation, `ctx` uses the caller's SAP identity.

## Write to an OData or ICF service

Within a tool declaring `scope: 'write'` and a matching operation type:

```ts
const response = await ctx.http.post(
  '/sap/bc/http/sap/your_service',
  JSON.stringify({ id, value }),
  'application/json',
  { Accept: 'application/json' },
);
```

ARC-1 supplies CSRF state automatically. Enable both raw-write and master-write settings from the
permissions table. The dedicated raw-write flag does not permit ADT object writes.

## Execute a console class

Declare `scope: 'write'` and `opType: OperationType.Workflow`, then call:

```ts
const output = await ctx.run.classRun('ZCL_MY_CONSOLE_APP');
return { content: [{ type: 'text', text: output }] };
```

The class must implement `IF_OO_ADT_CLASSRUN`, and the SAP user needs execution authorization.
`classRun` validates a class name; it does not accept an arbitrary path. Executed ABAP may change
data, so enabling ordinary writes alone does not enable this operation.

## Optional client interaction

These members are `undefined` when the MCP client does not support them:

| Member | Purpose |
|---|---|
| `ctx.elicit(message, schema?)` | Request user input |
| `ctx.notify(level, message)` | Report progress |
| `ctx.sampling(systemPrompt, userMessage)` | Ask the client's model a question |

Use `ctx.logger` for server logs on stderr.

## Test a handler

Use `createMockToolContext` to test request construction without SAP:

```ts
import { createMockToolContext } from 'arc-1/public/testing';

const ctx = createMockToolContext({ responseBody: 'REPORT ZX.\nWRITE 1.' });
const result = await programLineCount.handler({ name: 'ZX' }, ctx);
expect(ctx.httpCalls[0].path).toContain('/programs/ZX/');
expect(result.content[0]).toEqual({ type: 'text', text: '2 lines' });
```

## Deploy

Ship compiled plugins and their dependencies with the reviewed application artifact. `ARC1_PLUGINS`
is a comma-separated list of absolute local paths, without npm package names or shell expansion.
Changes require a restart or redeploy; there is no hot reload.

| Deployment | Plugin location |
|---|---|
| Docker | Copy files into a derived image, owned by `arc1` |
| CF buildpack/MTA | Include built files in the app archive; use an absolute `/home/vcap/app/...` path |
| Mounted volume | Ensure owner/permissions meet loader rules; review changes outside the app artifact separately |

Example derived image (replace `<reviewed-tag>`):

```dockerfile
FROM ghcr.io/arc-mcp/arc-1:<reviewed-tag>
COPY --chown=arc1:arc1 dist/ /home/arc1/plugins/myext/dist/
COPY --chown=arc1:arc1 manifests/ /home/arc1/plugins/myext/manifests/
ENV ARC1_PLUGINS=/home/arc1/plugins/myext/dist/index.js
```

On POSIX, files must belong to the server process user and must not be world-writable. A plain
Docker `COPY` creates root-owned files and can fail the ownership check. On Windows, restrict the
plugin paths using ACLs. Malformed plugins, incompatible API versions, or name collisions prevent
startup.

For CF, configure the extension path and opt-ins in the deployed MTA properties; see
[BTP administration](btp-administration.md). Keep plugin versions, dependency lockfiles, and ARC-1
versions together so upgrades can be tested and rolled back as one artifact.

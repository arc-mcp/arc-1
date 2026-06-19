// Manifest interpreter — the declarative (JSON, no JavaScript) plugin tier. FEAT-61 PR4.
//
// A *.tool.json manifest declares a read-only tool whose handler is a single, fixed HTTP GET
// against the already-authenticated client (no host — paths only). The interpreter renders the
// request from validated args and runs it through the SAME gated SafeHttpClient as code plugins.
// v1 scope: GET only; POST/body + response extraction are a fast-follow.
// Security per docs/research/extension-framework-spec.md §8.1.

import { Ajv2020 } from 'ajv/dist/2020.js';
import type { OperationTypeCode } from '../adt/safety.js';
import type { Scope } from '../authz/policy.js';
import type { RegistryEntry, ToolDispatchContext, ToolRegistry, ToolResult } from '../registry/tool-registry.js';
import { createSafeHttpClient } from '../server/safe-http-client.js';

const SCOPES: ReadonlySet<string> = new Set(['read', 'write', 'data', 'sql', 'transports', 'git', 'admin']);

export interface ManifestTool {
  name: string;
  description: string;
  scope: Scope;
  opType?: OperationTypeCode;
  inputSchema: Record<string, unknown>;
  request: {
    method: 'GET';
    path: string;
    pathParams?: Record<string, string>;
    query?: Record<string, string>;
    accept?: string;
  };
  response?: { maxBytes?: number };
}

/** Resolve a `$.field` reference against the validated args (top-level fields only in v1). */
function resolveRef(ref: string, args: Record<string, unknown>): unknown {
  const m = /^\$\.([A-Za-z_]\w*)$/.exec(ref);
  if (!m) throw new Error(`manifest: unsupported reference '${ref}' (use "$.field")`);
  return args[m[1]];
}

/** Validate + percent-encode a single path segment value (anti-traversal). */
function safeSegment(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`manifest: path param '${key}' must be a non-empty string`);
  }
  // Reject traversal, control chars, and scheme/host smuggling. `/` IS allowed (SAP namespaced
  // names) but is percent-encoded below, so it can't introduce extra path segments.
  if (value.includes('..') || [...value].some((c) => c.charCodeAt(0) < 0x20) || value.includes('://')) {
    throw new Error(`manifest: path param '${key}' contains a forbidden sequence`);
  }
  return encodeURIComponent(value);
}

function renderPath(
  template: string,
  pathParams: Record<string, string> | undefined,
  args: Record<string, unknown>,
): string {
  return template.replace(/\{([A-Za-z_]\w*)\}/g, (_full, key: string) => {
    const ref = pathParams?.[key];
    if (!ref) throw new Error(`manifest: path placeholder '{${key}}' has no pathParams mapping`);
    return safeSegment(resolveRef(ref, args), key);
  });
}

function renderQuery(query: Record<string, string> | undefined, args: Record<string, unknown>): string {
  if (!query) return '';
  const usp = new URLSearchParams();
  for (const [k, ref] of Object.entries(query)) {
    const v = resolveRef(ref, args);
    if (v === undefined || v === null || v === '') continue; // omit-if-absent
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/** Validate a manifest's shape + security invariants. Throws on any violation (fail-fast). */
export function validateManifest(obj: unknown): ManifestTool {
  const m = obj as ManifestTool;
  if (!m || typeof m.name !== 'string' || !m.name.startsWith('Custom_')) {
    throw new Error(`manifest: 'name' must be a string starting with 'Custom_' (got '${m?.name}')`);
  }
  if (!m.description || typeof m.description !== 'string') {
    throw new Error(`manifest '${m.name}': 'description' is required`);
  }
  if (!m.scope || !SCOPES.has(m.scope)) {
    throw new Error(`manifest '${m.name}': 'scope' must be one of ${[...SCOPES].join('/')}`);
  }
  if (!m.inputSchema || typeof m.inputSchema !== 'object') {
    throw new Error(`manifest '${m.name}': 'inputSchema' (JSON Schema) is required`);
  }
  if ((m.inputSchema as Record<string, unknown>).additionalProperties !== false) {
    throw new Error(`manifest '${m.name}': inputSchema must set "additionalProperties": false`);
  }
  if (m.request?.method !== 'GET') {
    throw new Error(`manifest '${m.name}': only request.method "GET" is supported in v1`);
  }
  if (typeof m.request.path !== 'string' || !m.request.path.startsWith('/') || m.request.path.includes('://')) {
    throw new Error(`manifest '${m.name}': request.path must be an absolute SAP path with no host`);
  }
  return m;
}

/** Build + register a registry entry from a manifest object. */
export function registerManifestTool(registry: ToolRegistry, pluginName: string, manifestObj: unknown): void {
  const m = validateManifest(manifestObj);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(m.inputSchema);
  const opType: OperationTypeCode = m.opType ?? 'R'; // GET → Read

  const entry: RegistryEntry = {
    name: m.name,
    source: 'plugin',
    pluginName,
    policy: { scope: m.scope, opType },
    listing: { description: m.description, inputSchema: m.inputSchema },
    invoke: async (ctx: ToolDispatchContext): Promise<ToolResult> => {
      const args = ctx.args;
      if (!validate(args)) {
        return {
          content: [{ type: 'text', text: `Invalid arguments for ${m.name}: ${ajv.errorsText(validate.errors)}` }],
          isError: true,
        };
      }
      let path: string;
      try {
        // Anti-traversal / ref-resolution failures surface as an isError result (parity with the
        // ajv branch above), not a thrown exception out of invoke.
        path = renderPath(m.request.path, m.request.pathParams, args) + renderQuery(m.request.query, args);
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid arguments for ${m.name}: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
      // Manifests are GET-only (validateManifest rejects non-GET), so the write opt-in is irrelevant
      // here — pass it through for signature consistency; only `http.get` is ever called below.
      const http = createSafeHttpClient(
        ctx.client.http,
        ctx.client.safety,
        m.name,
        m.scope,
        ctx.config.allowPluginRawWrites,
      );
      const headers = m.request.accept ? { Accept: m.request.accept } : undefined;
      const res = await http.get(path, headers);
      const max = m.response?.maxBytes ?? 100_000;
      const body =
        res.body.length > max ? `${res.body.slice(0, max)}\n…[truncated ${res.body.length - max} bytes]` : res.body;
      return { content: [{ type: 'text', text: body }] };
    },
  };
  registry.register(entry);
}

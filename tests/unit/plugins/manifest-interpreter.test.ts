import { describe, expect, it } from 'vitest';

import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { registerManifestTool, validateManifest } from '../../../src/plugins/manifest-interpreter.js';
import { type ToolDispatchContext, ToolRegistry } from '../../../src/registry/tool-registry.js';

const readProgram = {
  name: 'Custom_ReadProgram',
  description: 'Read an ABAP program source',
  scope: 'read',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: { name: { type: 'string', pattern: '^[A-Za-z0-9_/]{1,40}$' } },
  },
  request: {
    method: 'GET',
    path: '/sap/bc/adt/programs/programs/{name}/source/main',
    pathParams: { name: '$.name' },
    accept: 'text/plain',
  },
};

function ctxFor(args: Record<string, unknown>) {
  const calls: Array<{ path: string; headers?: Record<string, string> }> = [];
  const fakeHttp = {
    get: async (path: string, headers?: Record<string, string>) => {
      calls.push({ path, headers });
      return { statusCode: 200, headers: {}, body: 'PROGRAM SOURCE' };
    },
  };
  const ctx = {
    client: { http: fakeHttp, safety: unrestrictedSafetyConfig() },
    config: { allowPluginRawWrites: false },
    args,
    requestId: 'r1',
  } as unknown as ToolDispatchContext;
  return { ctx, calls };
}

describe('validateManifest', () => {
  it('accepts a valid GET read manifest', () => {
    expect(validateManifest(readProgram).name).toBe('Custom_ReadProgram');
  });
  it('rejects a non-Custom_ name', () => {
    expect(() => validateManifest({ ...readProgram, name: 'ReadProgram' })).toThrow(/Custom_/);
  });
  it('requires additionalProperties:false', () => {
    expect(() => validateManifest({ ...readProgram, inputSchema: { type: 'object', properties: {} } })).toThrow(
      /additionalProperties/,
    );
  });
  it('rejects non-GET methods (v1)', () => {
    expect(() => validateManifest({ ...readProgram, request: { ...readProgram.request, method: 'POST' } })).toThrow(
      /GET/,
    );
  });
  it('rejects a path with a host', () => {
    expect(() =>
      validateManifest({ ...readProgram, request: { ...readProgram.request, path: 'http://evil/x' } }),
    ).toThrow(/absolute SAP path/);
  });
});

describe('registerManifestTool dispatch', () => {
  it('renders the path, percent-encodes the segment, and calls the gated client', async () => {
    const r = new ToolRegistry();
    registerManifestTool(r, 'demo', readProgram);
    const e = r.get('Custom_ReadProgram');
    expect(e?.source).toBe('plugin');
    expect(e?.policy.scope).toBe('read');
    const { ctx, calls } = ctxFor({ name: 'ZFOO' });
    const res = await e!.invoke(ctx);
    expect(res.content[0].text).toBe('PROGRAM SOURCE');
    expect(calls[0].path).toBe('/sap/bc/adt/programs/programs/ZFOO/source/main');
    expect(calls[0].headers).toEqual({ Accept: 'text/plain' });
  });

  it('percent-encodes a namespaced name (slash kept as data, not a path segment)', async () => {
    const r = new ToolRegistry();
    registerManifestTool(r, 'demo', readProgram);
    const { ctx, calls } = ctxFor({ name: '/FOO/ZBAR' });
    await r.get('Custom_ReadProgram')!.invoke(ctx);
    expect(calls[0].path).toBe('/sap/bc/adt/programs/programs/%2FFOO%2FZBAR/source/main');
  });

  it('rejects a path-traversal value that passes a permissive schema', async () => {
    const r = new ToolRegistry();
    // Permissive schema (no pattern) so '..' reaches safeSegment instead of being caught by Ajv.
    registerManifestTool(r, 'demo', {
      ...readProgram,
      name: 'Custom_Loose',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
    });
    const { ctx, calls } = ctxFor({ name: '..' });
    // Parity with the Ajv branch: a path-param violation returns an isError result, not a throw.
    const res = await r.get('Custom_Loose')!.invoke(ctx);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/forbidden sequence/);
    expect(calls).toHaveLength(0);
  });

  it('returns an isError result on schema-invalid args (Ajv)', async () => {
    const r = new ToolRegistry();
    registerManifestTool(r, 'demo', readProgram);
    const { ctx } = ctxFor({ name: 'has spaces!' }); // violates the pattern
    const res = await r.get('Custom_ReadProgram')!.invoke(ctx);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Invalid arguments');
  });

  it('omits absent query params', async () => {
    const r = new ToolRegistry();
    registerManifestTool(r, 'demo', {
      ...readProgram,
      name: 'Custom_ReadProgramQ',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: { name: { type: 'string' }, version: { type: 'string' } },
      },
      request: { ...readProgram.request, query: { version: '$.version' } },
    });
    const { ctx, calls } = ctxFor({ name: 'ZFOO' }); // version absent → omitted
    await r.get('Custom_ReadProgramQ')!.invoke(ctx);
    expect(calls[0].path).toBe('/sap/bc/adt/programs/programs/ZFOO/source/main');
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { defineTool } from '../../../src/public/index.js';
import { type ToolDispatchContext, ToolRegistry } from '../../../src/registry/tool-registry.js';
import { loadPlugins, registerPluginTool } from '../../../src/server/plugin-loader.js';

function echoTool() {
  return defineTool({
    name: 'Custom_Echo',
    description: 'echoes msg + requestId',
    schema: z.object({ msg: z.string() }),
    policy: { scope: 'read', opType: 'R' },
    handler: async (args, ctx) => ({
      content: [{ type: 'text', text: `${(args as { msg: string }).msg}:${ctx.requestId}` }],
    }),
  });
}

function dispatchCtx(args: Record<string, unknown>): ToolDispatchContext {
  return {
    client: { http: {}, safety: unrestrictedSafetyConfig() },
    config: {},
    args,
    requestId: 'req-7',
  } as unknown as ToolDispatchContext;
}

describe('registerPluginTool', () => {
  it('registers a plugin tool with source=plugin, policy, and a JSON-Schema listing', () => {
    const r = new ToolRegistry();
    registerPluginTool(r, 'demo', echoTool());
    const e = r.get('Custom_Echo');
    expect(e?.source).toBe('plugin');
    expect(e?.pluginName).toBe('demo');
    expect(e?.policy.scope).toBe('read');
    expect(e?.listing?.description).toContain('echoes');
    // z.toJSONSchema produced an object schema with the declared property
    expect(JSON.stringify(e?.listing?.inputSchema)).toContain('msg');
  });

  it('dispatch validates args, builds the public ctx, and runs the handler', async () => {
    const r = new ToolRegistry();
    registerPluginTool(r, 'demo', echoTool());
    const res = await r.get('Custom_Echo')!.invoke(dispatchCtx({ msg: 'hi' }));
    expect(res.content[0].text).toBe('hi:req-7');
  });

  it('returns an isError result on invalid args (Zod validation in the adapter)', async () => {
    const r = new ToolRegistry();
    registerPluginTool(r, 'demo', echoTool());
    const res = await r.get('Custom_Echo')!.invoke(dispatchCtx({ msg: 123 }));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Invalid arguments');
  });

  it('rejects a plugin tool outside the Custom_ namespace (registry fail-fast)', () => {
    const r = new ToolRegistry();
    const bad = { ...echoTool(), name: 'Evil' as `Custom_${string}` };
    expect(() => registerPluginTool(r, 'demo', bad)).toThrow(/Custom_/);
  });

  it('gives the plugin a read-only ctx.http + a runtime-locked ctx.client (no write/escape surface)', async () => {
    const r = new ToolRegistry();
    const tool = defineTool({
      name: 'Custom_Surface',
      description: 'reports the shape of the ctx surfaces it was handed',
      schema: z.object({}),
      policy: { scope: 'read', opType: 'R' },
      handler: async (_args, ctx) => {
        const http = ctx.http as unknown as Record<string, unknown>;
        const client = ctx.client as unknown as Record<string, unknown>;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                post: http.post === undefined,
                put: http.put === undefined,
                clientHttp: client.http === undefined,
                clientSafety: client.safety === undefined,
                clientWithSafety: client.withSafety === undefined,
              }),
            },
          ],
        };
      },
    });
    registerPluginTool(r, 'demo', tool);
    const res = await r.get('Custom_Surface')!.invoke(dispatchCtx({}));
    expect(JSON.parse(res.content[0].text)).toEqual({
      post: true,
      put: true,
      clientHttp: true,
      clientSafety: true,
      clientWithSafety: true,
    });
  });
});

describe('loadPlugins — manifest tools', () => {
  it('loads a standalone .tool.json manifest from an ARC1_PLUGINS path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arc1-plugin-test-'));
    const mf = join(dir, 'Custom_Mf.tool.json');
    writeFileSync(
      mf,
      JSON.stringify({
        name: 'Custom_Mf',
        description: 'manifest read tool',
        scope: 'read',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        request: { method: 'GET', path: '/sap/bc/adt/discovery' },
      }),
    );
    try {
      const r = new ToolRegistry();
      const loaded = await loadPlugins([mf], r);
      expect(r.get('Custom_Mf')?.source).toBe('plugin');
      expect(r.get('Custom_Mf')?.policy.scope).toBe('read');
      expect(loaded[0].toolNames).toContain('Custom_Mf');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('plugin MCP capabilities (PR5: elicit/notify/sampling)', () => {
  function fakeServer(caps: { elicitation?: object; sampling?: object }) {
    const calls: string[] = [];
    const server = {
      getClientCapabilities: () => caps,
      elicitInput: async (p: { message: string }) => {
        calls.push(`elicit:${p.message}`);
        return { action: 'accept', content: { ok: true } };
      },
      sendLoggingMessage: async (p: { level: string; data: unknown }) => {
        calls.push(`notify:${p.level}:${String(p.data)}`);
      },
      createMessage: async () => {
        calls.push('sample');
        return { role: 'assistant', content: { type: 'text', text: 'ANSWER' }, model: 'm' };
      },
    };
    return { server, calls };
  }
  const dispatchWith = (server: unknown): ToolDispatchContext =>
    ({
      client: { http: {}, safety: unrestrictedSafetyConfig() },
      config: {},
      args: {},
      requestId: 'r',
      server,
    }) as unknown as ToolDispatchContext;

  it('wires elicit/notify/sampling when the client supports them', async () => {
    const r = new ToolRegistry();
    const { server, calls } = fakeServer({ elicitation: {}, sampling: {} });
    registerPluginTool(
      r,
      'demo',
      defineTool({
        name: 'Custom_Interactive',
        description: 'd',
        schema: z.object({}),
        policy: { scope: 'read', opType: 'R' },
        handler: async (_a, ctx) => {
          const e = await ctx.elicit?.('Proceed?');
          await ctx.notify?.('info', 'working');
          const s = await ctx.sampling?.('sys', 'q');
          return { content: [{ type: 'text', text: `${e?.action}|${s}` }] };
        },
      }),
    );
    const res = await r.get('Custom_Interactive')!.invoke(dispatchWith(server));
    expect(res.content[0].text).toBe('accept|ANSWER');
    expect(calls).toEqual(['elicit:Proceed?', 'notify:info:working', 'sample']);
  });

  it('omits elicit/sampling without the capability; notify stays available', async () => {
    const r = new ToolRegistry();
    const { server } = fakeServer({});
    registerPluginTool(
      r,
      'demo',
      defineTool({
        name: 'Custom_NoCap',
        description: 'd',
        schema: z.object({}),
        policy: { scope: 'read', opType: 'R' },
        handler: async (_a, ctx) => ({
          content: [
            {
              type: 'text',
              text: `${ctx.elicit === undefined}|${ctx.sampling === undefined}|${ctx.notify !== undefined}`,
            },
          ],
        }),
      }),
    );
    const res = await r.get('Custom_NoCap')!.invoke(dispatchWith(server));
    expect(res.content[0].text).toBe('true|true|true');
  });

  it('all three are absent with no server (CLI/stdio path)', async () => {
    const r = new ToolRegistry();
    registerPluginTool(
      r,
      'demo',
      defineTool({
        name: 'Custom_NoServer',
        description: 'd',
        schema: z.object({}),
        policy: { scope: 'read', opType: 'R' },
        handler: async (_a, ctx) => ({
          content: [
            {
              type: 'text',
              text: String(ctx.elicit === undefined && ctx.notify === undefined && ctx.sampling === undefined),
            },
          ],
        }),
      }),
    );
    const res = await r.get('Custom_NoServer')!.invoke(dispatchWith(undefined));
    expect(res.content[0].text).toBe('true');
  });
});

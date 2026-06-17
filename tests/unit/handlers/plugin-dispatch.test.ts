import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AdtClient } from '../../../src/adt/client.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { getToolRegistry, handleToolCall } from '../../../src/handlers/dispatch.js';
import { defineTool } from '../../../src/public/index.js';
import { registerPluginTool } from '../../../src/server/plugin-loader.js';
import type { ServerConfig } from '../../../src/server/types.js';

// FEAT-61 PR3 end-to-end (handler level): a plugin tool registered into the registry must dispatch
// through handleToolCall, be scope-gated by its declared policy (registry fallback), and an
// unregistered Custom_ name must fall through to "Unknown tool".

const fakeClient = { http: {}, safety: unrestrictedSafetyConfig() } as unknown as AdtClient;
const config = { systemType: 'onprem', denyActions: [] } as unknown as ServerConfig;
const auth = (scopes: string[]): AuthInfo => ({ token: 't', scopes, clientId: 'c', extra: {} }) as unknown as AuthInfo;

describe('plugin dispatch through handleToolCall (FEAT-61 PR3)', () => {
  it('dispatches a registered read plugin tool for a read user', async () => {
    registerPluginTool(
      getToolRegistry(),
      'demo',
      defineTool({
        name: 'Custom_PdEcho',
        description: 'echo',
        schema: z.object({ msg: z.string() }),
        policy: { scope: 'read', opType: 'R' },
        handler: async (a) => ({ content: [{ type: 'text', text: (a as { msg: string }).msg }] }),
      }),
    );
    const res = await handleToolCall(fakeClient, config, 'Custom_PdEcho', { msg: 'hello' }, auth(['read']));
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toBe('hello');
  });

  it('scope-gates a write plugin tool against a read-only user (registry policy fallback)', async () => {
    registerPluginTool(
      getToolRegistry(),
      'demo',
      defineTool({
        name: 'Custom_PdWrite',
        description: 'w',
        schema: z.object({}),
        policy: { scope: 'write', opType: 'U' },
        handler: async () => ({ content: [{ type: 'text', text: 'should not run' }] }),
      }),
    );
    const res = await handleToolCall(fakeClient, config, 'Custom_PdWrite', {}, auth(['read']));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Insufficient scope/);
  });

  it('returns "Unknown tool" for an unregistered Custom_ name', async () => {
    const res = await handleToolCall(fakeClient, config, 'Custom_Nope', {}, auth(['read']));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Unknown tool/);
  });

  it('refuses a registered plugin tool in hyperfocused mode (not just hidden from tools/list)', async () => {
    registerPluginTool(
      getToolRegistry(),
      'demo',
      defineTool({
        name: 'Custom_PdHf',
        description: 'echo',
        schema: z.object({ msg: z.string() }),
        policy: { scope: 'read', opType: 'R' },
        handler: async (a) => ({ content: [{ type: 'text', text: (a as { msg: string }).msg }] }),
      }),
    );
    // Even with a scope-passing user, hyperfocused mode must not dispatch a plugin tool.
    const hyperfocused = { ...config, toolMode: 'hyperfocused' } as unknown as ServerConfig;
    const res = await handleToolCall(fakeClient, hyperfocused, 'Custom_PdHf', { msg: 'x' }, auth(['read']));
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Unknown tool/);
  });
});

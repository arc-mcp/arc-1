import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AdtClient } from '../../../src/adt/client.js';
import { DataResultScope, DEFAULT_DATA_PREVIEW_RESPONSE_BYTES } from '../../../src/adt/data-result-context.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { getToolRegistry, handleToolCall } from '../../../src/handlers/dispatch.js';
import { defineTool } from '../../../src/public/index.js';
import { logger } from '../../../src/server/logger.js';
import { registerPluginTool } from '../../../src/server/plugin-loader.js';
import { createServer } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

// FEAT-61 PR3 end-to-end (handler level): a plugin tool registered into the registry must dispatch
// through handleToolCall, be scope-gated by its declared policy (registry fallback), and an
// unregistered Custom_ name must fall through to "Unknown tool".

const fakeClient = {
  http: {},
  safety: unrestrictedSafetyConfig(),
  createDataResultScope: () => new DataResultScope(DEFAULT_DATA_PREVIEW_RESPONSE_BYTES),
} as unknown as AdtClient;
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

  it('hides a denied plugin tool and audits a direct MCP call without running its handler', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ran' }] }));
    const denied = 'Custom_PdLaunchReport';
    const allowed = 'Custom_PdLaunchReportPreview';
    for (const name of [denied, allowed] as const) {
      registerPluginTool(
        getToolRegistry(),
        'demo',
        defineTool({
          name,
          description: 'launch report',
          schema: z.object({}),
          policy: { scope: 'read', opType: 'R' },
          handler,
        }),
      );
    }

    const server = createServer({ ...DEFAULT_CONFIG, denyActions: ['SAPWrite.delete', denied] });
    const client = new Client({ name: 'plugin-deny-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const audit = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain(allowed);
      expect(tools.map((tool) => tool.name)).not.toContain(denied);

      const result = await client.callTool({ name: denied, arguments: {} });
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: `Action '${denied}' is denied by server policy (SAP_DENY_ACTIONS).` }],
      });
      expect(handler).not.toHaveBeenCalled();
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'safety_blocked',
          level: 'warn',
          operation: denied,
          reason: 'Action denied by SAP_DENY_ACTIONS',
        }),
      );
    } finally {
      audit.mockRestore();
      await client.close();
      await server.close();
    }
  });

  it('refuses direct calls to registered plugins in hyperfocused and multi-target mode', async () => {
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

    const multiTarget = { ...config, targetId: 'test-target' };
    const targetResult = await handleToolCall(fakeClient, multiTarget, 'Custom_PdHf', { msg: 'x' }, auth(['read']));
    expect(targetResult.isError).toBe(true);
    expect(targetResult.content[0].text).toMatch(/not enabled for this multi-target connection/);
  });
});

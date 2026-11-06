/** Read-only live BTP coverage through MCP requests; no fixture creation or shared deployment. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBearerTokenProvider, loadServiceKeyFile, parseServiceKey } from '../../src/adt/oauth.js';
import { CachingLayer } from '../../src/cache/caching-layer.js';
import { MemoryCache } from '../../src/cache/memory.js';
import { createServer } from '../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { hasBtpCredentials } from './helpers.js';

const describeIf = hasBtpCredentials() ? describe : describe.skip;
const CLASS = 'CL_ABAP_RANDOM';

describeIf.each(['standard', 'hyperfocused'] as const)('BTP method reads (%s MCP)', (mode) => {
  let client: Client;
  let server: Server;
  const read = (args: Record<string, unknown>) =>
    client.callTool(
      mode === 'standard'
        ? { name: 'SAPRead', arguments: args }
        : { name: 'SAP', arguments: { action: 'read', params: args } },
    );
  const text = (result: Awaited<ReturnType<typeof read>>) => {
    expect(result.isError).toBeFalsy();
    return (result.content as { type: string; text: string }[])
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
  };

  beforeAll(async () => {
    const key = process.env.TEST_BTP_SERVICE_KEY
      ? parseServiceKey(process.env.TEST_BTP_SERVICE_KEY)
      : loadServiceKeyFile(process.env.TEST_BTP_SERVICE_KEY_FILE || process.env.SAP_BTP_SERVICE_KEY_FILE || '');
    const presetToken = process.env.TEST_BTP_ACCESS_TOKEN;
    const bearerTokenProvider = presetToken ? async () => presetToken : createBearerTokenProvider(key);
    // Authorize before the MCP request timeout begins (interactive login can take longer).
    await bearerTokenProvider();
    server = createServer(
      { ...DEFAULT_CONFIG, url: key.url, client: key.abap?.sapClient || '100', systemType: 'btp', toolMode: mode },
      { bearerTokenProvider, cachingLayer: new CachingLayer(new MemoryCache()) },
    );
    client = new Client({ name: 'arc1-btp-read-tests', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  }, 150_000);

  afterAll(async () => {
    await client?.close();
    await server?.close();
  });

  it('advertises the intended read entry point', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((item) => item.name === (mode === 'standard' ? 'SAPRead' : 'SAP'));
    expect(tool).toBeDefined();
    if (mode === 'standard') expect(tool?.inputSchema.properties?.methodView).toMatchObject({ enum: ['signature'] });
  });

  it('reads a real own declaration and retains full source and body after a cached read', async () => {
    const declaration = JSON.parse(
      text(await read({ type: 'CLAS', name: CLASS, method: 'CREATE', methodView: 'signature' })),
    );
    expect(declaration).toMatchObject({ className: CLASS, scope: 'own-declaration', visibility: 'public' });
    expect(declaration.signature).toMatch(/CLASS-METHODS\s+create\b/i);
    expect(declaration.signature).toMatch(/RETURNING/i);
    const full = text(await read({ type: 'CLAS', name: CLASS }));
    expect(full).toMatch(/CLASS\s+cl_abap_random\s+DEFINITION/i);
    expect(full).toMatch(/CLASS\s+cl_abap_random\s+IMPLEMENTATION/i);
    expect(declaration.signature.length).toBeLessThan(full.length / 2);
    expect(text(await read({ type: 'CLAS', name: CLASS, method: 'CREATE' }))).toMatch(/METHOD\s+create[\s.]/i);
  });

  it('keeps a refreshed inactive read valid JSON with an explicit scope', async () => {
    const declaration = JSON.parse(
      text(
        await read({
          type: 'CLAS',
          name: CLASS,
          method: 'CREATE',
          methodView: 'signature',
          version: 'inactive',
          force_refresh: true,
        }),
      ),
    );
    expect(declaration).toMatchObject({ className: CLASS, scope: 'own-declaration' });
    expect(declaration.warning).toContain('No inactive draft exists');
    expect(declaration.signature).toMatch(/CLASS-METHODS\s+create\b/i);
  });

  it('returns bounded suggestions from the actual method inventory', async () => {
    const result = await read({ type: 'CLAS', name: CLASS, method: 'CREAT' });
    expect(result.isError).toBe(true);
    const message = JSON.stringify(result.content);
    expect(message).toMatch(/Suggestions in selected source:.*create/i);
    expect(message.length).toBeLessThan(1200);
  });

  it('rejects conflicting output selectors through MCP validation', async () => {
    const result = await read({ type: 'CLAS', name: CLASS, method: 'CREATE', format: 'structured', version: 'auto' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('structured');
  });
});

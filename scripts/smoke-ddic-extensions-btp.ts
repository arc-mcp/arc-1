/** Read-only BTP qualification. Browser OAuth happens before the bounded MCP requests. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AdtClient } from '../src/adt/client.js';
import { createBearerTokenProvider, loadServiceKeyFile } from '../src/adt/oauth.js';
import { defaultSafetyConfig } from '../src/adt/safety.js';
import { initLogger } from '../src/server/logger.js';
import { createServer } from '../src/server/server.js';
import { DEFAULT_CONFIG } from '../src/server/types.js';

initLogger('text', 'info');
const key = loadServiceKeyFile(process.env.TEST_BTP_SERVICE_KEY_FILE || '');
assert.equal(new URL(key.url).hostname, 'ddb3fc53-263c-4541-a5b1-58634e2e5d5a.abap.us10.hana.ondemand.com');
const bearerTokenProvider = createBearerTokenProvider(key);
await bearerTokenProvider();
const sap = new AdtClient({
  baseUrl: key.url,
  client: key.abap?.sapClient || '100',
  bearerTokenProvider,
  safety: defaultSafetyConfig(),
});
const server = createServer(
  { ...DEFAULT_CONFIG, url: key.url, client: key.abap?.sapClient || '100', systemType: 'btp', cacheMode: 'none' },
  { bearerTokenProvider, defaultHttp: sap.http },
);
const mcp = new Client({ name: 'arc1-ddic-btp-smoke', version: '1' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const rows: unknown[] = [];
const hash = createHash('sha256');
for (const path of readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' })
  .filter((p) => p.endsWith('.ts'))
  .sort()) {
  hash
    .update(path)
    .update('\0')
    .update(readFileSync(new URL(`../src/${path}`, import.meta.url)));
}
try {
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  const system = JSON.parse(await sap.getSystemInfo());
  assert(Array.isArray(system.collections) && system.collections.length > 0);
  assert((await sap.getClass('CL_ABAP_RANDOM')).source.length > 0);
  assert((await sap.searchObject('CL_ABAP_*', 5)).length > 0);
  rows.push({
    coreReads: 'passed',
    collections: system.collections.length,
    components: await sap.getInstalledComponents(),
  });
  const tools = await mcp.listTools();
  assert(tools.tools.find((t) => t.name === 'SAPRead')?.inputSchema.properties?.extensions);
  for (const name of [
    'DSH_MEAL',
    'DDTEST_STRU_INCLUDE',
    'TEST_SBD_TWO_FIELDS_CLASS_INTF',
    'FDT_S_TEST_SFW',
    'SFLIGHT',
  ]) {
    let base: unknown;
    for (const extensions of ['none', 'summary', 'sources']) {
      const result = await mcp.callTool({
        name: 'SAPRead',
        arguments: { type: 'TABL', name, extensions, force_refresh: true },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      assert(!result.isError, `BTP SAPRead failed for ${name}/${extensions}`);
      if (extensions === 'none') {
        assert.equal(content.length, 1);
        base = content[0];
      } else {
        assert.deepEqual(content[0], base);
        assert(content[1]?.text.startsWith('[extensions] '));
        const summary = JSON.parse(content[1]!.text.replace(/^\[extensions\] /, ''));
        const expected = {
          DSH_MEAL: 'DSH_S_MEAL_APPEND',
          DDTEST_STRU_INCLUDE: 'DDTEST_APPEND_ACTIVE',
          TEST_SBD_TWO_FIELDS_CLASS_INTF: 'TEST_SBD_APPEND_ADD_VH',
        }[name];
        if (expected)
          assert(
            summary.identities.some((identity: { name: string }) => identity.name === expected),
            `Missing ${expected}`,
          );
        else assert.equal(summary.providers[0].status, 'not_advertised');
        assert.equal(summary.applicability, 'unknown');
        const expanded = extensions === 'sources';
        assert(summary.consumed.sends <= (expanded ? 20 : 6));
        assert(summary.consumed.responseBytes <= (expanded ? 256 : 128) * 1024);
        assert(
          content.slice(1).reduce((sum, block) => sum + Buffer.byteLength(block.text), 0) <=
            (expanded ? 16 * 1024 : 2048),
        );
        rows.push({
          name,
          extensions,
          basePreserved: true,
          summary,
          sourceLabels: content
            .filter((b) => b.text.startsWith('[extension source '))
            .map((b) => b.text.split('\n')[0]),
        });
      }
    }
  }
} catch (error) {
  rows.push({ failed: true, error: error instanceof Error ? error.message : 'unknown' });
  process.exitCode = 1;
} finally {
  await mcp.close();
  await server.close();
}
process.stdout.write(
  `${JSON.stringify({ target: 'BTP ABAP Environment', timestamp: new Date().toISOString(), sourceTreeSha256: hash.digest('hex'), authRoute: 'browser OAuth developer identity; MCP SDK in-memory transport', rows }, null, 2)}\n`,
);

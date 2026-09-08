/** Read-only, isolated stdio MCP smoke. Build first. No fixture creation or SAP writes. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { LiveRelationsInput } from '../src/handlers/relation-input.js';

const cases = z.array(LiveRelationsInput).min(1).max(8).parse(JSON.parse(process.env.TEST_RELATION_CASES ?? '[]'));
const env: Record<string, string> = {
  PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
  SAP_URL: process.env.TEST_SAP_URL ?? '', SAP_USER: process.env.TEST_SAP_USER ?? '',
  SAP_PASSWORD: process.env.TEST_SAP_PASSWORD ?? '', SAP_CLIENT: process.env.TEST_SAP_CLIENT ?? '001',
  SAP_TRANSPORT: 'stdio', SAP_ALLOW_WRITES: 'false', SAP_ALLOW_FREE_SQL: 'false', SAP_ALLOW_DATA_PREVIEW: 'false',
  SAP_ALLOW_TRANSPORT_WRITES: 'false', SAP_ALLOW_GIT_WRITES: 'false', ARC1_PLUGINS: '', ARC1_CACHE: 'memory',
  ARC1_LOG_LEVEL: 'error', ARC1_TOOL_MODE: 'standard', ARC1_MULTI_TARGET_ENDPOINTS: 'false',
};
assert.ok(env.SAP_URL && env.SAP_USER && env.SAP_PASSWORD, 'TEST_SAP_URL/USER/PASSWORD and TEST_RELATION_CASES are required.');
const report: unknown[] = [];
for (const enabled of [false, true]) {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
    env: { ...env, ARC1_LIVE_RELATIONS: String(enabled) }, stderr: 'pipe',
  });
  // Drain redacted server diagnostics without printing credentials or SAP payloads.
  transport.stderr?.on('data', () => { /* Drain diagnostics without retaining SAP payloads. */ });
  const client = new Client({ name: 'arc1-live-relations-smoke', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const navigation = listed.tools.find((tool) => tool.name === 'SAPNavigate');
    assert.ok(navigation);
    if (!enabled) {
      assert.ok(!JSON.stringify(navigation).includes('"relations"'));
      assert.equal((await client.callTool({ name: 'SAPNavigate', arguments: cases[0]! })).isError, true);
      report.push({ enabled, defaultHidden: true, guessedCallDenied: true });
      continue;
    }
    for (const input of cases) {
      const result = await client.callTool({ name: 'SAPNavigate', arguments: input });
      assert.notEqual(result.isError, true, `Relation smoke failed for ${input.type}/${input.name}`);
      const blocks = result.content as { type: string; text?: string }[];
      const value = JSON.parse(blocks.find((block) => block.type === 'text')!.text!);
      assert.equal(value.coverage, 'unknown');
      assert.equal(value.experimental, true);
      assert.ok(value.nodes.length <= input.maxResults && value.edges.length <= 100 && value.metrics.httpAttempts <= 12);
      report.push({ input, nodes: value.nodes.length, edges: value.edges.length, expanded: value.expanded.length,
        truncated: value.truncated, reasons: value.truncationReasons, metrics: value.metrics });
    }
    const absent = await client.callTool({ name: 'SAPNavigate', arguments: { action: 'relations', type: 'CLAS', name: 'ZCL_ARC1_ABSENT_9F82D' } });
    assert.equal(absent.isError, true);
    const finalList = await client.listTools();
    const finalNavigation = finalList.tools.find((tool) => tool.name === 'SAPNavigate');
    assert.ok(JSON.stringify(finalNavigation).includes('"relations"'), 'Expected relation action after discovery.');
    report.push({ missingRootRejected: true, listedAfterSmoke: true });
  } finally { await client.close(); await transport.close(); }
}
// Script output only, never imported by MCP runtime. Contains counts, not source or credentials.
process.stdout.write(`${JSON.stringify({ observedAt: new Date().toISOString(), report }, null, 2)}\n`);

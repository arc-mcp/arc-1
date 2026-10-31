/** Read-only MCP checks for standard source examples qualified on 750 (npl) / 758 (a4h). */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExtensionDiscoveryResult, ExtensionNode } from '../../src/adt/extension-discovery.js';
import { callTool, connectClient, expectToolSuccess, type ToolResult } from './helpers.js';

type Summary = Omit<ExtensionDiscoveryResult, 'nodes' | 'sources'> & { identities: ExtensionNode[] };
const target = process.env.E2E_SOURCE_PLUGIN_TARGET;
const describeIf = target === 'a4h' || target === 'npl' ? describe : describe.skip;
const cases =
  target === 'npl'
    ? [{ type: 'PROG', name: 'ENH_NESTED_DEMO' }]
    : [
        {
          type: 'INCL',
          name: 'ENH_PROG_INCL_IMPLICIT_OPT',
          enhancementContext: { type: 'PROG', name: 'PROG_ENH_SUBOBJ_CHECK' },
        },
        { type: 'FUNC', name: 'SAPBC_GLOBAL_CANCEL_UPDATE', group: 'SAPBC_GLOBAL_FIS' },
        { type: 'FUNC', name: 'BDS_CONNECTION_CREATE', group: 'BDS_CONNECTIONS' },
        { type: 'FUGR', name: 'SEEF_ADT_TEST_AUNIT_FUGR1' },
      ];
function summary(result: ToolResult): Summary {
  expectToolSuccess(result);
  expect(result.content[1]?.text).toMatch(/^\[extensions\] /);
  return JSON.parse(result.content[1]!.text.replace(/^\[extensions\] /, ''));
}
function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describeIf('source plug-ins through MCP', () => {
  let client: Client;
  const observations: unknown[] = [];
  beforeAll(async () => {
    client = await connectClient();
  });
  afterAll(async () => {
    await client?.close();
    if (observations.length) {
      mkdirSync('test-results', { recursive: true });
      writeFileSync(
        `test-results/source-plugin-mcp-${target}.json`,
        JSON.stringify({ checkedAt: new Date().toISOString(), target, observations }, null, 2),
      );
    }
  });

  it('advertises extension modes and contextual include inputs through MCP', async () => {
    const tools = await client.listTools();
    const props = tools.tools.find((t) => t.name === 'SAPRead')!.inputSchema.properties;
    expect(props?.extensions).toMatchObject({ enum: ['none', 'summary', 'sources'] });
    expect(props?.enhancementContext).toBeDefined();
  });

  it.each(cases)('preserves $type $name and returns positive identities and separate sources', async (unit) => {
    const args = { ...unit, version: 'active', force_refresh: true };
    const base = await callTool(client, 'SAPRead', { ...args, extensions: 'none' });
    expectToolSuccess(base);
    expect(base.content).toHaveLength(1);
    for (const mode of [undefined, 'summary', 'sources']) {
      const result = await callTool(client, 'SAPRead', { ...args, ...(mode ? { extensions: mode } : {}) });
      expect(result.content[0]).toEqual(base.content[0]);
      const report = summary(result);
      expect(report.identities.length).toBeGreaterThan(0);
      expect(report.consumed.sends).toBeLessThanOrEqual(mode === 'sources' ? 20 : 6);
      expect(report.consumed.responseBytes).toBeLessThanOrEqual((mode === 'sources' ? 256 : 128) * 1024);
      expect(result.content.slice(1).reduce((n, b) => n + Buffer.byteLength(b.text), 0)).toBeLessThanOrEqual(
        mode === 'sources' ? 16 * 1024 : 2048,
      );
      const sources = result.content.filter((b) => b.text.startsWith('[extension source '));
      if (mode === 'sources') {
        expect(sources.length).toBeGreaterThan(0);
        expect(sources.every((b) => b.text.includes('representation=rendered_plugin_source'))).toBe(true);
      } else {
        expect(sources).toHaveLength(0);
      }
      observations.push({
        unit,
        mode: mode ?? 'automatic',
        basePreserved: true,
        baseSha256: hash(base.content[0]!.text),
        summary: report,
        sourceBlocks: sources.map((b) => ({ label: b.text.split('\n', 1)[0], sha256: hash(b.text) })),
      });
    }
  });

  it('defaults a source window to none and describes explicit discovery as owning-source scope', async () => {
    const args = { ...cases[0], version: 'active', lineStart: 1, lineEnd: 2, force_refresh: true };
    const base = await callTool(client, 'SAPRead', args);
    expectToolSuccess(base);
    expect(base.content).toHaveLength(1);
    const explicit = await callTool(client, 'SAPRead', { ...args, extensions: 'summary' });
    expect(explicit.content[0]).toEqual(base.content[0]);
    expect(summary(explicit).scope).toContain('owning object/source');
  });
});

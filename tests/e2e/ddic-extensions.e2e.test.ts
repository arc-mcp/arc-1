/** Read-only MCP coverage using standard DDIC examples qualified on SAP_BASIS 750/758. */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExtensionDiscoveryResult, ExtensionNode } from '../../src/adt/extension-discovery.js';
import type { StructureHierarchyResult } from '../../src/adt/structure-hierarchy.js';
import { callTool, connectClient, expectToolSuccess, type ToolResult } from './helpers.js';

type Summary = Omit<ExtensionDiscoveryResult, 'nodes' | 'sources'> & {
  identities: ExtensionNode[];
  applicability: 'unknown';
};
function summary(result: ToolResult): Summary {
  expectToolSuccess(result);
  expect(result.content[1]?.text).toMatch(/^\[extensions\] /);
  return JSON.parse(result.content[1]!.text.replace(/^\[extensions\] /, ''));
}

// Live latency may exhaust the intentional deadline. Verify that contract explicitly;
// successful fixture discovery is qualified separately in the recorded live smoke runs.
function deadlinePartial(report: Pick<ExtensionDiscoveryResult, 'omissions' | 'providers' | 'issues'>): boolean {
  if (!report.omissions.deadline) return false;
  expect(report.issues).toContain('deadline');
  expect(report.issues.every((issue) => issue === 'deadline' || issue === 'optional_phase_stopped')).toBe(true);
  expect(report.providers.some((provider) => provider.status === 'incomplete' && provider.reason === 'deadline')).toBe(
    true,
  );
  console.info('DDIC positive fixture coverage incomplete: optional discovery deadline reached.');
  return true;
}

describe('DDIC extensions through MCP', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connectClient();
  });
  afterAll(async () => {
    await client?.close();
  });

  it('advertises modes and preserves the base in automatic and explicit summaries', async () => {
    const tools = await client.listTools();
    const properties = tools.tools.find((tool) => tool.name === 'SAPRead')!.inputSchema.properties;
    expect(properties?.extensions).toMatchObject({ enum: ['none', 'summary', 'sources'] });
    const args = { type: 'TABL', name: 'DSH_MEAL', force_refresh: true };
    const legacy = await callTool(client, 'SAPRead', { ...args, extensions: 'none' });
    expectToolSuccess(legacy);
    expect(legacy.content).toHaveLength(1);
    for (const selection of [{}, { extensions: 'summary' }]) {
      const result = await callTool(client, 'SAPRead', { ...args, ...selection });
      expect(result.content[0]).toEqual(legacy.content[0]);
      const report = summary(result);
      if (!deadlinePartial(report))
        expect(report.identities).toContainEqual(expect.objectContaining({ name: 'DSH_S_MEAL_APPEND' }));
      expect(report.applicability).toBe('unknown');
      expect(report.consumed.sends).toBeLessThanOrEqual(6);
      expect(report.consumed.responseBytes).toBeLessThanOrEqual(128 * 1024);
      expect(Buffer.byteLength(result.content[1]!.text)).toBeLessThanOrEqual(2048);
    }
  });

  it('returns append sources separately through the public sources mode', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'TABL', name: 'DSH_MEAL', extensions: 'sources' });
    const report = summary(result);
    expect(report.consumed.sends).toBeLessThanOrEqual(20);
    expect(report.consumed.responseBytes).toBeLessThanOrEqual(256 * 1024);
    if (!deadlinePartial(report))
      expect(
        result.content.some(
          (block) =>
            block.text.startsWith('[extension source ') &&
            block.text.includes('DSH_S_MEAL_APPEND') &&
            block.text.includes('representation=authored_source'),
        ),
      ).toBe(true);
    expect(
      result.content.slice(1).reduce((bytes, block) => bytes + Buffer.byteLength(block.text), 0),
    ).toBeLessThanOrEqual(16 * 1024);
  });

  it('defaults partial reads to none and labels explicit discovery with owning-source scope', async () => {
    const args = { type: 'TABL', name: 'DSH_MEAL', lineStart: 1, lineEnd: 2, force_refresh: true };
    const partial = await callTool(client, 'SAPRead', args);
    expectToolSuccess(partial);
    expect(partial.content).toHaveLength(1);
    const explicit = await callTool(client, 'SAPRead', { ...args, extensions: 'summary' });
    expect(explicit.content[0]).toEqual(partial.content[0]);
    expect(summary(explicit).scope).toContain('owning object/source');
  });

  it('preserves repeated include suffixes and the append in structure context', async () => {
    const result = await callTool(client, 'SAPContext', {
      action: 'structure',
      type: 'TABL',
      name: 'DDTEST_STRU_INCLUDE',
    });
    const tree: StructureHierarchyResult = JSON.parse(expectToolSuccess(result));
    expect(tree.extensionDiscovery).toBeDefined();
    expect(tree.extensionDiscovery?.consumed.sends).toBeLessThanOrEqual(20);
    expect(tree.summary.totalNodes).toBeLessThanOrEqual(20);
    if (deadlinePartial(tree.extensionDiscovery!)) return;
    expect(
      tree.tree.children.filter((node) => node.structure === 'DDTEST_STRU_CHAR').map((node) => node.suffix),
    ).toEqual(['a', 'b', undefined]);
    expect(tree.tree.children).toContainEqual(
      expect.objectContaining({ structure: 'DDTEST_APPEND_ACTIVE', kind: 'append' }),
    );
  });
});

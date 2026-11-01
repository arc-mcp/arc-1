/** Shared assertions for live ADT dispatch and MCP transport qualification. */
import { expect } from 'vitest';
import type { ExtensionDiscoveryResult, ExtensionNode } from '../../src/adt/extension-discovery.js';

type Result = { isError?: boolean; content: Array<{ text: string }> };
type Summary = Omit<ExtensionDiscoveryResult, 'nodes' | 'sources'> & {
  identities: ExtensionNode[];
  applicability: 'unknown';
};

export function assertBdefExtensions(base: Result, result: Result, mode: 'summary' | 'sources'): Summary {
  expect(base.isError).not.toBe(true);
  expect(base.content).toHaveLength(1);
  expect(result.isError).not.toBe(true);
  expect(result.content[0]).toEqual(base.content[0]);
  expect(result.content[1]?.text).toMatch(/^\[extensions\] /);
  const summary: Summary = JSON.parse(result.content[1]!.text.slice('[extensions] '.length));
  expect(summary.root).toMatchObject({ type: 'BDEF', name: 'DEMO_RAP_EXTENSIBLE', version: 'active' });
  expect(summary.providers).toContainEqual(
    expect.objectContaining({ id: 'bdef_wul_verified', coverage: 'candidate_index' }),
  );
  expect(summary.identities.length).toBeGreaterThan(0);
  expect(summary.identities.every((node) => node.type === 'BDEF' && node.version === 'active')).toBe(true);
  expect(summary.applicability).toBe('unknown');
  expect(summary.consumed.sends).toBeLessThanOrEqual(mode === 'summary' ? 6 : 20);
  expect(summary.consumed.responseBytes).toBeLessThanOrEqual((mode === 'summary' ? 128 : 256) * 1024);
  expect(result.content.slice(1).reduce((sum, block) => sum + Buffer.byteLength(block.text), 0)).toBeLessThanOrEqual(
    mode === 'summary' ? 2048 : 16384,
  );
  const sources = result.content.filter((block) => block.text.startsWith('[extension source '));
  if (mode === 'summary') {
    expect(summary.identities.length).toBeLessThanOrEqual(2);
    expect(sources).toHaveLength(0);
  } else {
    for (const name of ['DEMO_RAP_EXTEND1', 'DEMO_RAP_EVENT_EXT']) {
      expect(summary.identities).toContainEqual(expect.objectContaining({ name }));
      expect(sources).toContainEqual(
        expect.objectContaining({ text: expect.stringContaining(`[extension source BDEF ${name} `) }),
      );
    }
    expect(sources.every((block) => block.text.includes('representation=authored_source'))).toBe(true);
  }
  return summary;
}

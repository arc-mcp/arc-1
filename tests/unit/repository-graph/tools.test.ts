import { describe, expect, it } from 'vitest';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { GRAPH_ACTIONS, graphInputSchema } from '../../../src/repository-graph/contract.js';
import { addGraphTool, graphToolDefinition } from '../../../src/repository-graph/tools.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

describe('optional graph tool surface', () => {
  it('freezes the standard graph schema independently of default tool snapshots', async () => {
    await expect(JSON.stringify(graphToolDefinition(), null, 2)).toMatchFileSnapshot(
      '../../fixtures/tool-definitions/optional-graph.json',
    );
  });
  it('freezes the enabled hyperfocused schema', async () => {
    const base = getToolDefinitions({ ...DEFAULT_CONFIG, toolMode: 'hyperfocused' });
    await expect(JSON.stringify(addGraphTool(base, true), null, 2)).toMatchFileSnapshot(
      '../../fixtures/tool-definitions/optional-graph-hyperfocused.json',
    );
  });
  it('keeps all runtime fields/actions visible and leaves the default definitions immutable', () => {
    const schema = graphToolDefinition().inputSchema;
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(Object.keys(graphInputSchema.shape).sort());
    expect(schema.properties).toHaveProperty('action.enum', [...GRAPH_ACTIONS]);
    for (const toolMode of ['standard', 'hyperfocused'] as const) {
      const base = getToolDefinitions({ ...DEFAULT_CONFIG, toolMode });
      const frozen = JSON.stringify(base);
      addGraphTool(base, toolMode === 'hyperfocused');
      expect(JSON.stringify(base)).toBe(frozen);
    }
  });
});

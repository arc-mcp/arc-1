import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveGraphConnection } from '../../../src/repository-graph/connection.js';
import { GRAPH_ACTIONS, graphInputSchema } from '../../../src/repository-graph/contract.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const setup = read('docs_page/repository-graph.md');
const spec = read('docs_page/repository-graph-specification.md');

describe('experimental repository graph documentation', () => {
  it('uses a real supported private connection descriptor without enabling MCP tools', () => {
    const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(setup)![1]!);
    expect(example.systemKey).toBe('TRIAL-2023-001');
    expect(example.audience).toBe('trial');
    expect(example).not.toHaveProperty('apiKey');
    const directory = mkdtempSync(join(tmpdir(), 'arc-graph-docs-'));
    try {
      const keyPath = join(directory, 'key');
      const descriptorPath = join(directory, 'connection.json');
      writeFileSync(keyPath, 'test-only-key-not-a-secret-123456789', { mode: 0o600 });
      writeFileSync(descriptorPath, JSON.stringify({ ...example, apiKeyFile: keyPath }), { mode: 0o600 });
      const config = { ...DEFAULT_CONFIG, graphConnectionFile: descriptorPath };
      const connection = resolveGraphConnection(config, {});
      expect(connection.url).toBe('http://127.0.0.1:8091');
      expect(connection.systemKey).toBe(example.systemKey);
      expect(config.graphTools).not.toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps every copyable CLI query valid against the runtime schema', () => {
    const examples = [...setup.matchAll(/arc1-cli call SAPGraph --json '([^']+)'/g)];
    expect(examples.length).toBeGreaterThanOrEqual(3);
    for (const [, json] of examples) expect(graphInputSchema.safeParse(JSON.parse(json!)).success).toBe(true);
  });

  it('specifies exactly the implemented API actions and default bounds', () => {
    const table = spec.split('| Action | Required arguments | Semantics |')[1]?.split('Current limits:')[0];
    expect(table).toBeDefined();
    const actions = [...table!.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]);
    expect(actions).toEqual([...GRAPH_ACTIONS]);
    expect(graphInputSchema.parse({ action: 'status' })).toMatchObject({
      depth: 1,
      direction: 'both',
      limit: 20,
      maxNodes: 100,
      maxEdges: 300,
    });
    expect(spec).toContain('API is version **2**');
    expect(spec).toContain('Adding even a seemingly');
  });

  it('routes general and BTP setup to one experimental entry without changing the default quickstart', () => {
    for (const path of ['docs_page/deployment.md', 'docs_page/btp-overview.md']) {
      expect(read(path)).toContain('[Repository Graph (Experimental)](repository-graph.md)');
    }
    expect(read('docs_page/quickstart.md')).not.toContain('ARC1_GRAPH');
    expect(read('mkdocs.yml')).toContain('Specification & Release Gates: repository-graph-specification.md');
    expect(setup).toContain('[detailed specification](repository-graph-specification.md)');
    expect(read('docs_page/configuration-reference.md')).toContain('## Repository graph (experimental)');
  });

  it('keeps prerelease, cloud transport and audience limits explicit before activation', () => {
    expect(setup).toContain('without a published supported installer');
    expect(setup).toContain('Cloud Connector collection is not yet verified');
    expect(setup).toContain('internet-reachable');
    expect(setup).toContain('ARC1_GRAPH_TOOLS=false');
    expect(setup).toContain('does not bind a service');
    expect(setup.indexOf('## Audience and safety')).toBeLessThan(setup.indexOf('## Local connection'));
    expect(spec).toContain('Unknown/restricted audience blocks MCP exposure');
    expect(spec).toContain('No new broad');
  });
});

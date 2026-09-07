import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
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
    expect(setup).toContain('Cloud Connector collection uses its own technical identity');
    expect(setup).toContain('PrincipalPropagation destinations');
    expect(setup).toContain('remain rejected');
    expect(setup).toContain('internet-reachable');
    expect(setup).toContain('ARC1_GRAPH_TOOLS=false');
    expect(setup).toContain('does not bind a service');
    expect(setup.indexOf('## Audience and safety')).toBeLessThan(setup.indexOf('## Local connection'));
    expect(spec).toContain('Unknown/restricted audience blocks MCP exposure');
    expect(spec).toContain('No new broad');
  });

  it('keeps the optional backend outside core distribution and links real setup artifacts', () => {
    const backend = read('docs_page/repository-graph-backend.md');
    expect(backend).toContain('independent');
    expect(backend).toContain('No paid fallback');
    expect(backend).toContain('ARC1_GRAPH_TOOLS=false');
    expect(read('package.json')).not.toContain('"workspaces"');
    for (const path of ['.cfignore', '.dockerignore', 'mta.yaml']) expect(read(path)).toContain('services/');
    for (const path of [
      'deployment.cf.example.yaml',
      'deployment.hana.cf.example.yaml',
      'deployment.vars.example.yaml',
    ]) {
      expect(backend).toContain(path);
      expect(read(`services/repository-graph/${path}`)).toBeTruthy();
    }
    for (const command of backend.matchAll(/node (scripts\/graph\/[a-z-]+\.mjs)/g))
      expect(read(`services/repository-graph/${command[1]}`)).toBeTruthy();
    const dependencies = JSON.parse(read('package.json')).dependencies;
    expect(dependencies).not.toHaveProperty('pg');
    expect(dependencies).not.toHaveProperty('@sap/hana-client');
  });

  it('keeps both CF manifest paths role-separated and the graph navigation grouped', () => {
    const vars = parse(read('services/repository-graph/deployment.vars.example.yaml'));
    for (const backend of ['deployment.cf.example.yaml', 'deployment.hana.cf.example.yaml']) {
      const template = read(`services/repository-graph/${backend}`);
      const resolved = template.replace(/\(\(([a-zA-Z]+)\)\)/g, (_match, key: string) => {
        expect(vars[key], `Missing template variable ${key}`).toBeDefined();
        return String(vars[key]);
      });
      const apps = parse(resolved).applications;
      expect(apps).toHaveLength(3);
      const [bootstrap, api, collector] = apps;
      expect(bootstrap['no-route']).toBe(true);
      expect(collector['no-route']).toBe(true);
      expect(api.services).toEqual(['arc-graph-reader', 'arc-graph-api-auth']);
      expect(collector.services).toEqual(['arc-graph-writer', vars.destinationService]);
      expect(api.disk_quota).toBe('1G');
      expect(JSON.stringify(api)).not.toContain('bootstrap-auth');
      expect(JSON.stringify(collector)).not.toContain('bootstrap-auth');
    }
    const findGraph = (value: unknown): unknown => {
      if (!value || typeof value !== 'object') return undefined;
      if ('Repository Graph (Experimental)' in value) return value['Repository Graph (Experimental)'];
      return Object.values(value).map(findGraph).find(Boolean);
    };
    // MkDocs uses Python YAML tags for extensions: only its plain nav subtree is relevant here.
    const navText = read('mkdocs.yml')
      .split('\nnav:\n')[1]
      ?.split(/\n(?=[a-zA-Z_][a-zA-Z_]*:)/)[0];
    expect(navText).toBeDefined();
    const group = findGraph(parse(navText!));
    expect(group).toEqual([
      { Setup: 'repository-graph.md' },
      { 'Backend Setup & Operations': 'repository-graph-backend.md' },
      { 'Storage Sizing': 'repository-graph-sizing.md' },
      { 'Specification & Release Gates': 'repository-graph-specification.md' },
    ]);
  });

  it('keeps Cloud Connector setup collector-only and separates capacity measurements from estimates', () => {
    const backend = read('docs_page/repository-graph-backend.md');
    expect(backend).toContain('cf bind-service "$PREFIX-collector" "$CONNECTIVITY"');
    expect(backend).toContain('ARC_GRAPH_CONNECTIVITY_BINDING');
    expect(backend).toContain('Do not set direct');
    expect(backend).toContain('Do not reuse an end-user JWT');
    expect(backend).not.toContain('cf bind-service "$ARC1_APP" "$CONNECTIVITY"');
    const sizing = read('docs_page/repository-graph-sizing.md');
    for (const marker of [
      'not complete SAP source',
      'cluster WAL generated',
      'not retained WAL',
      'linear estimate',
      'one** database',
      'already populated',
      'not an\natomic cross-database',
    ])
      expect(sizing).toContain(marker);
    expect(read('services/repository-graph/src/graph/soak.ts')).toContain('Use a separate SOAK- system key');
  });
});

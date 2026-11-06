import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  type CdsDependencyNode,
  enforceBlockedDataSources,
  parseCdsDependencyGraph,
} from '../../../src/adt/data-source-policy.js';

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/xml/${name}.xml`, import.meta.url), 'utf8');
const mixedXml = fixture('cds-dependency-graph-816-view-entity');
const mixedGraph = () => parseCdsDependencyGraph(mixedXml);
const nodes = (node: CdsDependencyNode): CdsDependencyNode[] => [node, ...node.children.flatMap(nodes)];
const resolver = (graph: CdsDependencyNode) => ({
  resolveDirectSource: vi.fn(async (name: string) => ({ kind: 'cds' as const, name, ddlSource: graph.name })),
  readCdsDependencyGraph: vi.fn(async () => graph),
  readTableReplacement: vi.fn(async () => undefined),
});

describe('CDS view-entity and projection lineage (#912)', () => {
  it('parses the reported 816 mixed graph and drops all three DCL entries', () => {
    const graph = mixedGraph();
    const all = nodes(graph);
    expect(all.map(({ name, kind }) => [name, kind])).toEqual([
      ['Z_PV_PROJECTION', 'CDS_PROJECTION_VIEW'],
      ['Z_VE_ROOT', 'CDS_VIEW_ENTITY'],
      ['Z_VE_INTERFACE', 'CDS_VIEW_ENTITY'],
      ['I_PAYTMEDIA', 'CDS_VIEW'],
      ['I_PAYTDATEGROUPING', 'CDS_VIEW'],
      ['DFPAYG', 'TABLE'],
      ['REGUT', 'TABLE'],
      ['TFCUPM042F', 'TABLE'],
      ['TFPM042F', 'TABLE'],
    ]);
    expect(graph.aliases).toEqual(['Z_PV_PROJECTION']);
    expect(all.find((n) => n.name === 'I_PAYTMEDIA')?.aliases).toEqual(['I_PAYTMEDIA', 'IPAYTMEDIA']);
    // DEFINED and MASKED are context, not alternate authorization paths.
    expect(all.filter((n) => n.accessControlled).map((n) => n.name)).toEqual([
      'Z_PV_PROJECTION',
      'Z_VE_ROOT',
      'Z_VE_INTERFACE',
    ]);
  });

  it('allows a complete mixed graph and inspects every terminal table for replacements', async () => {
    const graph = mixedGraph();
    const r = resolver(graph);
    await expect(enforceBlockedDataSources([graph.name], ['USR02'], r)).resolves.toBeUndefined();
    expect(r.readTableReplacement.mock.calls).toEqual([['DFPAYG'], ['REGUT'], ['TFCUPM042F'], ['TFPM042F']]);
  });

  it('denies a blocked replacement reached through a view-entity terminal table', async () => {
    const graph = mixedGraph();
    const r = {
      ...resolver(graph),
      readTableReplacement: vi.fn(async (name: string) =>
        name === 'REGUT' ? { name: 'BLOCKED_REPLACEMENT', ddlSource: 'BLOCKED_DDLS' } : undefined,
      ),
    };
    await expect(enforceBlockedDataSources([graph.name], ['BLOCKED_REPLACEMENT'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['Z_PV_PROJECTION', 'Z_VE_ROOT', 'Z_VE_INTERFACE', 'I_PAYTMEDIA', 'REGUT', 'BLOCKED_REPLACEMENT'],
    });
  });

  it.each([
    ['Z_VE_ROOT', ['Z_PV_PROJECTION', 'Z_VE_ROOT']],
    ['Z_VE_INTERFACE', ['Z_PV_PROJECTION', 'Z_VE_ROOT', 'Z_VE_INTERFACE']],
    ['IPAYTMEDIA', ['Z_PV_PROJECTION', 'Z_VE_ROOT', 'Z_VE_INTERFACE', 'I_PAYTMEDIA']],
    ['REGUT', ['Z_PV_PROJECTION', 'Z_VE_ROOT', 'Z_VE_INTERFACE', 'I_PAYTMEDIA', 'REGUT']],
    ['DFPAYG', ['Z_PV_PROJECTION', 'Z_VE_ROOT', 'Z_VE_INTERFACE', 'I_PAYTMEDIA', 'I_PAYTDATEGROUPING', 'DFPAYG']],
  ] as const)('denies blocked descendant/alias %s with the complete path', async (blocked, sourcePath) => {
    const graph = mixedGraph();
    const r = resolver(graph);
    await expect(enforceBlockedDataSources([graph.name], [blocked], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      matchedSource: blocked,
      sourcePath,
    });
    expect(r.readTableReplacement).not.toHaveBeenCalled();
  });

  it.each([
    ['cds-dependency-graph-758-view-entity', 'CDS_VIEW_ENTITY', ['DEMO_CDS_SPFLI_ENTITY', 'SPFLI']],
    [
      'cds-dependency-graph-758-projection',
      'CDS_PROJECTION_VIEW',
      ['DEMO_MANAGED_ROOT_PROJ', 'DEMO_MANAGED_ROOT_WAS', 'DEMO_TAB_ROOT_3'],
    ],
  ] as const)('allows and blocks the fresh 758 capture %s', async (file, kind, path) => {
    const graph = parseCdsDependencyGraph(fixture(file));
    expect(graph.kind).toBe(kind);
    expect(graph.databaseExists).toBe(true);
    await expect(enforceBlockedDataSources([graph.name], ['USR02'], resolver(graph))).resolves.toBeUndefined();
    await expect(enforceBlockedDataSources([graph.name], [path.at(-1)!], resolver(graph))).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: path,
    });
  });

  it.each(['CDS_VIEW_ENTITY', 'CDS_PROJECTION_VIEW'] as const)(
    'rejects childless %s nodes at both the root and a nested position',
    async (kind) => {
      for (const isRoot of [true, false]) {
        const graph = mixedGraph();
        const target = isRoot ? graph : graph.children[0]!;
        target.kind = kind;
        target.children = [];
        await expect(enforceBlockedDataSources([graph.name], ['USR02'], resolver(graph))).rejects.toMatchObject({
          code: 'DATA_LINEAGE_UNRESOLVED',
          reason: expect.stringContaining('has no proven terminal source'),
          sourcePath: isRoot ? [graph.name] : [graph.name, target.name],
        });
      }
    },
  );

  it('preserves an empty DB_EXISTS from a live analytical-query graph as false', async () => {
    const graph = parseCdsDependencyGraph(fixture('cds-dependency-graph-758-analytical-query'));
    expect(graph.kind).toBe('CDS_PROJECTION_VIEW');
    expect(graph.databaseExists).toBe(false);
    expect(graph.children.length).toBeGreaterThan(0);
    const r = resolver(graph);
    await expect(enforceBlockedDataSources([graph.name], ['USR02'], r)).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
      reason: 'dependency DEMO_ANALYTICAL_QUERY is not active in the database',
      sourcePath: ['DEMO_ANALYTICAL_QUERY'],
    });
    expect(r.readTableReplacement).not.toHaveBeenCalled();
  });

  it.each([
    '<abapsource:entry abapsource:key="DB_EXISTS"/>',
    '<abapsource:entry abapsource:key="DB_EXISTS"> </abapsource:entry>',
  ])('rejects an empty DB_EXISTS on a nested view entity: %s', async (emptyEntry) => {
    const xml = fixture('cds-dependency-graph-758-projection');
    const marker = '<abapsource:entry abapsource:key="DB_EXISTS">X</abapsource:entry>';
    const rootIndex = xml.indexOf(marker);
    const nestedIndex = xml.indexOf(marker, rootIndex + marker.length);
    expect(nestedIndex).toBeGreaterThan(rootIndex);
    const graph = parseCdsDependencyGraph(
      xml.slice(0, nestedIndex) + emptyEntry + xml.slice(nestedIndex + marker.length),
    );
    expect(graph.databaseExists).toBe(true);
    expect(graph.children[0]?.databaseExists).toBe(false);
    await expect(enforceBlockedDataSources([graph.name], ['USR02'], resolver(graph))).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
      sourcePath: ['DEMO_MANAGED_ROOT_PROJ', 'DEMO_MANAGED_ROOT_WAS'],
    });
  });

  it('keeps the legacy 750 graph with no DB_EXISTS property eligible', async () => {
    const graph = parseCdsDependencyGraph(fixture('cds-dependency-graph-750'));
    expect(graph.databaseExists).toBeUndefined();
    await expect(enforceBlockedDataSources([graph.name], ['USR02'], resolver(graph))).resolves.toBeUndefined();
  });

  it('keeps root identity verification for view entities', async () => {
    const graph = mixedGraph();
    await expect(enforceBlockedDataSources(['OTHER_ENTITY'], ['USR02'], resolver(graph))).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
      reason: expect.stringContaining('does not identify requested CDS source'),
    });
  });

  it('validates the last auxiliary entry rather than only the first', () => {
    const index = mixedXml.lastIndexOf('DCLS/DL');
    const malformed = `${mixedXml.slice(0, index)}TABL/DT${mixedXml.slice(index + 'DCLS/DL'.length)}`;
    expect(() => parseCdsDependencyGraph(malformed)).toThrow(/not a DCLS\/DL object/);
  });

  it('still rejects unknown kinds below an accepted projection root', () => {
    const unknown = mixedXml.replace('>CDS_VIEW_ENTITY<', '>CDS_FUTURE_ENTITY<');
    expect(() => parseCdsDependencyGraph(unknown)).toThrow(/unsupported kind CDS_FUTURE_ENTITY/);
  });

  it('still rejects a table function below an accepted projection root', async () => {
    const graph = mixedGraph();
    const tableFunction = parseCdsDependencyGraph(fixture('cds-dependency-graph-758-table-function'));
    graph.children = [tableFunction];
    await expect(enforceBlockedDataSources([graph.name], ['USR02'], resolver(graph))).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
      reason: expect.stringContaining('AMDP USING lineage'),
    });
  });
});

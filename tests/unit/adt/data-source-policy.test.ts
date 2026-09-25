import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  type DataSourcePolicyResolver,
  enforceBlockedDataSources,
  parseCdsDependencyGraph,
  parseTableReplacement,
} from '../../../src/adt/data-source-policy.js';
import { AdtApiError } from '../../../src/adt/errors.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures/xml');
const loadFixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf8');

function resolver(overrides: Partial<DataSourcePolicyResolver> = {}): DataSourcePolicyResolver {
  return {
    resolveDirectSource: vi.fn(async (name: string) => ({ kind: 'table' as const, name })),
    readTableReplacement: vi.fn(async () => undefined),
    readCdsDependencyGraph: vi.fn(async () => parseCdsDependencyGraph(loadFixture('cds-dependency-graph-758.xml'))),
    ...overrides,
  };
}

describe('parseCdsDependencyGraph', () => {
  it.each(['cds-dependency-graph-750.xml', 'cds-dependency-graph-758.xml'])(
    '%s normalizes live graph aliases',
    (file) => {
      const graph = parseCdsDependencyGraph(loadFixture(file));
      expect(graph.kind).toBe('CDS_VIEW');
      expect(graph.aliases).toEqual(expect.arrayContaining(['DEMO_CDS_SUMDIST', 'DEMO_CDS_SUDI']));
      expect(graph.children.map((node) => node.name)).toEqual(['SCARR', 'SPFLI']);
      expect(graph.children.map((node) => node.relation)).toEqual(['FROM', 'INNER_JOIN']);
    },
  );

  // Live SAP_BASIS 758/816: a released standard view with access control returns SQL nodes PLUS an
  // auxiliary RELATED_OBJECTS_TREE -> RELATED_OBJECTS_ENTRY -> DCLS_OBJECT_LIST -> DCLS/DL branch
  // whose leaf has no properties at all. The prototype treated every elementInfo as a SQL source and
  // therefore refused this ordinary view. The branch carries no application data and must be
  // validated, recorded as audit context, and dropped.
  it('drops the auxiliary access-control branch of a real standard view', () => {
    const graph = parseCdsDependencyGraph(loadFixture('cds-dependency-graph-758-dcl.xml'));
    expect(graph.name).toBe('I_BUSINESSPARTNER');
    expect(graph.kind).toBe('CDS_VIEW');
    // Mixed-case ENTITY_NAME is canonicalized; the DCL object never becomes a data source.
    expect(graph.aliases).toEqual(expect.arrayContaining(['I_BUSINESSPARTNER', 'IBUSINESSPARTNER']));
    expect(graph.children.map((node) => node.name)).toEqual(['BUT000']);
    expect(graph.children[0]?.kind).toBe('TABLE');
    // Access control is retained as audit context only - never as an authorization decision.
    expect(graph.accessControlled).toBe(true);
    expect(graph.children[0]?.accessControlled).toBe(false);
  });

  it('records access control from HAS_DCL/AC_STATE without treating DCL as data lineage', () => {
    const dcl = parseCdsDependencyGraph(loadFixture('cds-dependency-graph-758-dcl.xml'));
    const plain = parseCdsDependencyGraph(loadFixture('cds-dependency-graph-758.xml'));
    expect(dcl.accessControlled).toBe(true);
    expect(plain.accessControlled).toBe(false);
    const names = (node: typeof dcl): string[] => [node.name, ...node.children.flatMap(names)];
    expect(names(dcl)).not.toContain('DCLS_OBJECT_LIST');
    expect(names(dcl)).not.toContain('RELATED_OBJECTS_TREE');
  });

  it('classifies the live CDS_TABLE_FUNCTION node kind', () => {
    const graph = parseCdsDependencyGraph(loadFixture('cds-dependency-graph-758-table-function.xml'));
    const kinds = new Set<string>();
    const walk = (node: typeof graph): void => {
      kinds.add(node.kind);
      for (const child of node.children) walk(child);
    };
    walk(graph);
    expect(kinds).toContain('CDS_TABLE_FUNCTION');
    // SAP does not expand the AMDP USING list: the table-function nodes are childless.
    const findTf = (node: typeof graph): typeof graph | undefined =>
      node.kind === 'CDS_TABLE_FUNCTION' ? node : node.children.map(findTf).find(Boolean);
    expect(findTf(graph)?.children).toEqual([]);
  });

  it('orders siblings deterministically regardless of SAP response order', () => {
    const build = (first: string, second: string) =>
      `<elementInfo name="ROOT"><properties><entry key="TYPE" value="CDS_VIEW"/></properties>` +
      `<elementInfo name="${first}"><properties><entry key="TYPE" value="TABLE"/></properties></elementInfo>` +
      `<elementInfo name="${second}"><properties><entry key="TYPE" value="TABLE"/></properties></elementInfo>` +
      `</elementInfo>`;
    expect(parseCdsDependencyGraph(build('SPFLI', 'SCARR')).children.map((n) => n.name)).toEqual(['SCARR', 'SPFLI']);
    expect(parseCdsDependencyGraph(build('SCARR', 'SPFLI')).children.map((n) => n.name)).toEqual(['SCARR', 'SPFLI']);
  });

  it.each([
    ['an unknown SQL node kind', '<entry key="TYPE" value="EXTERNAL_THING"/>'],
    ['a node with no TYPE at all', ''],
  ])('fails closed on %s inside the SQL branch', (_label, typeEntry) => {
    const xml =
      `<elementInfo name="ROOT"><properties><entry key="TYPE" value="CDS_VIEW"/></properties>` +
      `<elementInfo name="X"><properties>${typeEntry}</properties></elementInfo></elementInfo>`;
    expect(() => parseCdsDependencyGraph(xml)).toThrow(/unsupported kind|missing TYPE/);
  });

  // "Do not broadly ignore a subtree merely because a name contains RELATED or DCLS."
  it('does not let an auxiliary-looking branch hide a real data source', () => {
    const xml =
      `<elementInfo name="ROOT"><properties><entry key="TYPE" value="CDS_VIEW"/></properties>` +
      `<elementInfo name="RELATED_OBJECTS_TREE"><properties><entry key="TYPE" value="RELATED_OBJECTS_TREE"/></properties>` +
      `<elementInfo name="USR02"><properties><entry key="TYPE" value="TABLE"/></properties></elementInfo>` +
      `</elementInfo></elementInfo>`;
    expect(() => parseCdsDependencyGraph(xml)).toThrow(/access-control branch expected RELATED_OBJECTS_ENTRY/);
  });

  it('fails closed when the access-control branch terminal is not a DCLS/DL object', () => {
    const xml =
      `<elementInfo name="ROOT"><properties><entry key="TYPE" value="CDS_VIEW"/></properties>` +
      `<elementInfo name="RELATED_OBJECTS_TREE"><properties><entry key="TYPE" value="RELATED_OBJECTS_TREE"/></properties>` +
      `<elementInfo name="E"><properties><entry key="TYPE" value="RELATED_OBJECTS_ENTRY"/></properties>` +
      `<elementInfo name="L"><properties><entry key="TYPE" value="DCLS_OBJECT_LIST"/></properties>` +
      `<elementInfo type="TABL/DT" name="USR02"><properties/></elementInfo>` +
      `</elementInfo></elementInfo></elementInfo></elementInfo>`;
    expect(() => parseCdsDependencyGraph(xml)).toThrow(/not a DCLS\/DL object/);
  });

  it('rejects malformed or unbounded graphs', () => {
    expect(() => parseCdsDependencyGraph('<elementInfo/>')).toThrow(/root|name/i);
    const deep = `${'<elementInfo name="X"><properties><entry key="TYPE" value="CDS_VIEW"/></properties>'.repeat(70)}${'</elementInfo>'.repeat(70)}`;
    expect(() => parseCdsDependencyGraph(deep)).toThrow(/depth/i);
    expect(() => parseCdsDependencyGraph(' '.repeat(5_000_001))).toThrow(/input limit/i);
  });
});

describe('parseTableReplacement', () => {
  const row = {
    TABNAME: 'DEMO_SUMDIST',
    TABCLASS: 'TRANSP',
    VIEWREF: 'DEMO_CDS_SUDI',
    VIEWREF_ERR: '',
    DDLNAME: 'DEMO_CDS_SUMDIST',
  };
  it('keeps SQL-view and DDLS names distinct', () => {
    expect(parseTableReplacement('DEMO_SUMDIST', [row])).toEqual({
      name: 'DEMO_CDS_SUDI',
      ddlSource: 'DEMO_CDS_SUMDIST',
    });
    expect(parseTableReplacement('DEMO_SUMDIST', [{ ...row, VIEWREF: '', DDLNAME: '' }])).toBeUndefined();
  });
  it.each([
    [],
    [row, row],
    [{}],
    [{ ...row, TABNAME: 'OTHER' }],
    [{ ...row, TABCLASS: 'VIEW' }],
    [{ ...row, VIEWREF_ERR: 'X' }],
    [{ ...row, DDLNAME: '' }],
    [{ ...row, VIEWREF: '' }],
    [{ ...row, DDLNAME: "X' OR 1=1" }],
  ])('refuses unproven catalog results: %j', (...rows) => {
    expect(() => parseTableReplacement('DEMO_SUMDIST', rows as Record<string, string>[])).toThrow();
  });
});

describe('enforceBlockedDataSources', () => {
  it('does nothing, including no resolver call, when the list is empty', async () => {
    const r = resolver();
    await enforceBlockedDataSources(['SCARR'], [], r);
    expect(r.resolveDirectSource).not.toHaveBeenCalled();
  });

  it('denies a direct match without resolver calls', async () => {
    const r = resolver();
    await expect(enforceBlockedDataSources(['scarr'], ['SCARR'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['SCARR'],
    });
    expect(r.resolveDirectSource).not.toHaveBeenCalled();
  });

  it('preflights every direct join/union source before resolving an earlier allowed source', async () => {
    const r = resolver();
    await expect(enforceBlockedDataSources(['SCARR', 'USR02'], ['USR02'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['USR02'],
    });
    expect(r.resolveDirectSource).not.toHaveBeenCalled();
    expect(r.readTableReplacement).not.toHaveBeenCalled();
  });

  it('checks replacement metadata before allowing a table', async () => {
    const r = resolver();
    await enforceBlockedDataSources(['SCARR'], ['USR02'], r);
    expect(r.readTableReplacement).toHaveBeenCalledWith('SCARR');
  });

  it.each([
    [404, 'DATA_POLICY_UNAVAILABLE'],
    [403, 'DATA_LINEAGE_UNRESOLVED'],
  ])('fails closed on catalog HTTP %s', async (status, code) => {
    const r = resolver({
      readTableReplacement: vi.fn(async () => {
        throw new AdtApiError('SECRET', Number(status), '/sap/bc/adt/datapreview/freestyle');
      }),
    });
    await expect(enforceBlockedDataSources(['SCARR'], ['USR02'], r)).rejects.toMatchObject({
      code,
      sourcePath: ['SCARR'],
    });
  });

  it('denies a blocked graph alias before replacement inspection', async () => {
    const r = resolver({
      resolveDirectSource: vi.fn(async () => ({
        kind: 'cds' as const,
        name: 'DEMO_CDS_SUMDIST',
        ddlSource: 'DEMO_CDS_SUMDIST',
      })),
    });
    await expect(enforceBlockedDataSources(['DEMO_CDS_SUMDIST'], ['SPFLI'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['DEMO_CDS_SUMDIST', 'SPFLI'],
    });
    expect(r.readTableReplacement).not.toHaveBeenCalled();
  });

  it.each(['DD02L', 'DDLDEPENDENCY'])('honors the catalog block %s before reading it', async (source) => {
    const r = resolver();
    await expect(enforceBlockedDataSources(['SCARR'], [source], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['SCARR', source],
      matchedSource: source,
    });
    expect(r.readTableReplacement).not.toHaveBeenCalled();
  });

  it('expands a transparent-table replacement object', async () => {
    const resolveDirectSource = vi.fn(async (name: string) =>
      name === 'DEMO_SUMDIST'
        ? { kind: 'table' as const, name }
        : { kind: 'cds' as const, name, ddlSource: 'DEMO_CDS_SUMDIST' },
    );
    const r = resolver({
      resolveDirectSource,
      readTableReplacement: vi.fn(async () => ({ name: 'DEMO_CDS_SUDI', ddlSource: 'DEMO_CDS_SUMDIST' })),
    });
    await expect(enforceBlockedDataSources(['DEMO_SUMDIST'], ['SCARR'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['DEMO_SUMDIST', 'DEMO_CDS_SUDI', 'DEMO_CDS_SUMDIST', 'SCARR'],
    });
  });

  it.each([
    { kind: 'classic-view' as const, name: 'V_USR_NAME' },
    { kind: 'structure' as const, name: 'SYST' },
    { kind: 'unknown' as const, name: 'MISSING' },
  ])('fails closed for unresolved $kind roots', async (resolved) => {
    const r = resolver({ resolveDirectSource: vi.fn(async () => resolved) });
    await expect(enforceBlockedDataSources([resolved.name], ['USR02'], r)).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
    });
  });

  it('fails closed on a real live CDS table-function graph', async () => {
    // Uses the captured live 758 response rather than a fabricated node type, so the refusal is
    // proven against the contract SAP actually returns.
    const graph = parseCdsDependencyGraph(loadFixture('cds-dependency-graph-758-table-function.xml'));
    const r = resolver({
      resolveDirectSource: vi.fn(async (name: string) => ({
        kind: 'cds' as const,
        name,
        ddlSource: 'CDS_WITH_TABLE_FUNCTION_3',
      })),
      readCdsDependencyGraph: vi.fn(async () => graph),
    });
    await expect(enforceBlockedDataSources(['CDS_WITH_TABLE_FUNCTION_3'], ['USR02'], r)).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
    });
  });

  it('allows a standard view whose only extra branch is access-control metadata', async () => {
    // Regression: the prototype refused the released standard view I_BUSINESSPARTNER because it
    // treated the auxiliary DCL branch as an unknown data node.
    const graph = parseCdsDependencyGraph(loadFixture('cds-dependency-graph-758-dcl.xml'));
    const r = resolver({
      resolveDirectSource: vi.fn(async (name: string) => ({
        kind: 'cds' as const,
        name,
        ddlSource: 'I_BUSINESSPARTNER',
      })),
      readCdsDependencyGraph: vi.fn(async () => graph),
      readTableReplacement: vi.fn(async () => undefined),
    });
    await expect(enforceBlockedDataSources(['I_BUSINESSPARTNER'], ['USR02'], r)).resolves.toBeUndefined();
  });

  it('still denies a blocked table reached through an access-controlled standard view', async () => {
    const graph = parseCdsDependencyGraph(loadFixture('cds-dependency-graph-758-dcl.xml'));
    const r = resolver({
      resolveDirectSource: vi.fn(async (name: string) => ({
        kind: 'cds' as const,
        name,
        ddlSource: 'I_BUSINESSPARTNER',
      })),
      readCdsDependencyGraph: vi.fn(async () => graph),
    });
    await expect(enforceBlockedDataSources(['I_BUSINESSPARTNER'], ['BUT000'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['I_BUSINESSPARTNER', 'BUT000'],
    });
  });

  it('fails closed when SAP returns a graph for a different root', async () => {
    const r = resolver({
      resolveDirectSource: vi.fn(async () => ({
        kind: 'cds' as const,
        name: 'EXPECTED_VIEW',
        ddlSource: 'EXPECTED_DDLS',
      })),
    });
    await expect(enforceBlockedDataSources(['EXPECTED_VIEW'], ['USR02'], r)).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
      sourcePath: ['EXPECTED_VIEW'],
    });
  });

  it('denies on an unexpected internal failure without leaking it to the client', async () => {
    const r = resolver({
      resolveDirectSource: vi.fn(() => {
        throw new TypeError('cannot read properties of undefined');
      }),
    });
    const result = enforceBlockedDataSources(['SCARR'], ['USR02'], r);
    // Fail closed, and the client never sees the internal detail...
    await expect(result).rejects.toMatchObject({ code: 'DATA_LINEAGE_UNRESOLVED' });
    await expect(result).rejects.not.toThrow(/cannot read properties/);
  });

  it('wraps resolver failures and never treats them as allow', async () => {
    const r = resolver({
      resolveDirectSource: vi.fn(async () => {
        throw new Error('search unavailable');
      }),
    });
    const result = enforceBlockedDataSources(['SCARR'], ['USR02'], r);
    await expect(result).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
    });
    await expect(result).rejects.not.toThrow(/search unavailable/i);
  });

  it('redacts SAP metadata error details before constructing a client-visible policy error', async () => {
    const r = resolver({
      resolveDirectSource: vi.fn(async () => {
        throw new AdtApiError(
          'locked by SECRETUSER in DEVK900001',
          423,
          '/sap/bc/adt/repository/informationsystem/search',
        );
      }),
    });
    const result = enforceBlockedDataSources(['SCARR'], ['USR02'], r);
    await expect(result).rejects.toThrow(/HTTP 423 during lineage resolution/i);
    await expect(result).rejects.not.toThrow(/SECRETUSER|DEVK900001|informationsystem/i);
  });

  it('fails closed on a table -> CDS -> same table replacement cycle', async () => {
    const r = resolver({
      readTableReplacement: vi.fn(async () => ({ name: 'VIEW_A', ddlSource: 'DDL_A' })),
      readCdsDependencyGraph: vi.fn(async () => ({
        name: 'VIEW_A',
        aliases: ['VIEW_A'],
        kind: 'CDS_VIEW' as const,
        accessControlled: false,
        children: [
          { name: 'TABLE_A', aliases: ['TABLE_A'], kind: 'TABLE' as const, accessControlled: false, children: [] },
        ],
      })),
    });
    await expect(enforceBlockedDataSources(['TABLE_A'], ['USR02'], r)).rejects.toThrow(/cycle/);
  });

  it('uses the DDLS name for lookup and SQL-view alias for graph identity', async () => {
    const r = resolver({
      readTableReplacement: vi.fn(async (name: string) =>
        name === 'DEMO_SUMDIST' ? { name: 'DEMO_CDS_SUDI', ddlSource: 'DIFFERENT_DDLS' } : undefined,
      ),
    });
    await expect(enforceBlockedDataSources(['DEMO_SUMDIST'], ['USR02'], r)).resolves.toBeUndefined();
    expect(r.readCdsDependencyGraph).toHaveBeenCalledWith('DIFFERENT_DDLS');
    expect(r.resolveDirectSource).toHaveBeenCalledTimes(1);
  });

  it.each(['DEMO_CDS_SUDI', 'DIFFERENT_DDLS'])('blocks either identity of a replacement: %s', async (blocked) => {
    const r = resolver({
      readTableReplacement: vi.fn(async () => ({ name: 'DEMO_CDS_SUDI', ddlSource: 'DIFFERENT_DDLS' })),
    });
    await expect(enforceBlockedDataSources(['DEMO_SUMDIST'], [blocked], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      matchedSource: blocked,
    });
    expect(r.readCdsDependencyGraph).not.toHaveBeenCalled();
  });

  it('bounds the number of direct sources before resolver traffic', async () => {
    const r = resolver();
    const sources = Array.from({ length: 65 }, (_, index) => `TABLE_${index}`);
    await expect(enforceBlockedDataSources(sources, ['USR02'], r)).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
    });
    expect(r.resolveDirectSource).not.toHaveBeenCalled();
  });
});

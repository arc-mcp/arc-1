import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  DataSourcePolicyError,
  type DataSourcePolicyResolver,
  enforceBlockedDataSources,
  extractReplacementObject,
  parseCdsDependencyGraph,
} from '../../../src/adt/data-source-policy.js';
import { AdtApiError } from '../../../src/adt/errors.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures/xml');
const loadFixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf8');

function resolver(overrides: Partial<DataSourcePolicyResolver> = {}): DataSourcePolicyResolver {
  return {
    resolveDirectSource: vi.fn(async (name: string) => ({ kind: 'table' as const, name })),
    readTableSource: vi.fn(async () => 'define table scarr { key mandt : abap.clnt; }'),
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

  it('rejects malformed or unbounded graphs', () => {
    expect(() => parseCdsDependencyGraph('<elementInfo/>')).toThrow(/root|name/i);
    const deep = `${'<elementInfo name="X"><properties><entry key="TYPE" value="CDS_VIEW"/></properties>'.repeat(70)}${'</elementInfo>'.repeat(70)}`;
    expect(() => parseCdsDependencyGraph(deep)).toThrow(/depth/i);
    expect(() => parseCdsDependencyGraph(' '.repeat(5_000_001))).toThrow(/input limit/i);
  });
});

describe('extractReplacementObject', () => {
  it('extracts and normalizes a replacement object', () => {
    expect(
      extractReplacementObject("@AbapCatalog.replacementObject: 'demo_cds_sumdist'\ndefine table demo_sumdist"),
    ).toBe('DEMO_CDS_SUMDIST');
  });

  it('returns undefined when the annotation is absent and fails on a malformed present annotation', () => {
    expect(extractReplacementObject('define table scarr')).toBeUndefined();
    expect(() => extractReplacementObject('@AbapCatalog.replacementObject: demo')).toThrow(/malformed/i);
  });

  it('ignores annotations in line comments, block comments, and unrelated string literals', () => {
    const source = `
// @AbapCatalog.replacementObject: 'SAFE_LINE'
/* @AbapCatalog.replacementObject: 'SAFE_BLOCK' */
@EndUserText.label: '@AbapCatalog.replacementObject: ''SAFE_LABEL'''
@ AbapCatalog /* active separator */ . replacementObject : 'blocked_view'
define table demo_sumdist`;
    expect(extractReplacementObject(source)).toBe('BLOCKED_VIEW');
    expect(extractReplacementObject("// @AbapCatalog.replacementObject: 'SAFE'\ndefine table scarr")).toBeUndefined();
  });

  it('fails closed for duplicate active annotations and incomplete lexical constructs', () => {
    expect(() =>
      extractReplacementObject(
        "@AbapCatalog.replacementObject: 'ONE'\n@AbapCatalog.replacementObject: 'TWO'\ndefine table demo",
      ),
    ).toThrow(/duplicated|malformed/i);
    expect(() => extractReplacementObject("/* @AbapCatalog.replacementObject: 'ONE'")).toThrow(/unterminated/i);
    expect(() => extractReplacementObject("@AbapCatalog.replacementObject: 'ONE")).toThrow(/unterminated/i);
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
    expect(r.readTableSource).not.toHaveBeenCalled();
  });

  it('allows an unrelated transparent table after checking replacement metadata', async () => {
    const r = resolver();
    await enforceBlockedDataSources(['SCARR'], ['USR02'], r);
    expect(r.resolveDirectSource).toHaveBeenCalledWith('SCARR');
    expect(r.readTableSource).toHaveBeenCalledWith('SCARR');
  });

  it('denies a blocked transitive CDS source with a dependency path', async () => {
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
  });

  it('scans all graph aliases before reading replacement metadata for an earlier table', async () => {
    const readTableSource = vi.fn(async () => {
      throw new Error('canonical table source unavailable');
    });
    const r = resolver({
      resolveDirectSource: vi.fn(async () => ({
        kind: 'cds' as const,
        name: 'DEMO_CDS_SUMDIST',
        ddlSource: 'DEMO_CDS_SUMDIST',
      })),
      readTableSource,
    });
    await expect(enforceBlockedDataSources(['DEMO_CDS_SUMDIST'], ['SPFLI'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['DEMO_CDS_SUMDIST', 'SPFLI'],
    });
    expect(readTableSource).not.toHaveBeenCalled();
  });

  it('preserves the graph path when canonical replacement metadata cannot be read', async () => {
    const r = resolver({
      resolveDirectSource: vi.fn(async () => ({
        kind: 'cds' as const,
        name: 'DEMO_CDS_SUMDIST',
        ddlSource: 'DEMO_CDS_SUMDIST',
      })),
      readTableSource: vi.fn(async () => {
        throw new Error('canonical table source unavailable');
      }),
    });
    await expect(enforceBlockedDataSources(['DEMO_CDS_SUMDIST'], ['USR02'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_UNRESOLVED',
      sourcePath: ['DEMO_CDS_SUMDIST', 'SCARR'],
    });
  });

  it('expands a transparent-table replacement object', async () => {
    const resolveDirectSource = vi.fn(async (name: string) =>
      name === 'DEMO_SUMDIST'
        ? { kind: 'table' as const, name }
        : { kind: 'cds' as const, name, ddlSource: 'DEMO_CDS_SUMDIST' },
    );
    const r = resolver({
      resolveDirectSource,
      readTableSource: vi.fn(
        async () => "@AbapCatalog.replacementObject: 'demo_cds_sumdist'\ndefine table demo_sumdist",
      ),
    });
    await expect(enforceBlockedDataSources(['DEMO_SUMDIST'], ['SCARR'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      sourcePath: ['DEMO_SUMDIST', 'DEMO_CDS_SUMDIST', 'SCARR'],
    });
  });

  it.each([
    { kind: 'classic-view' as const, name: 'V_USR_NAME' },
    { kind: 'structure' as const, name: 'SYST' },
    { kind: 'unknown' as const, name: 'MISSING' },
  ])('fails closed for unresolved $kind roots', async (resolved) => {
    const r = resolver({ resolveDirectSource: vi.fn(async () => resolved) });
    await expect(enforceBlockedDataSources([resolved.name], ['USR02'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_UNRESOLVED',
    });
  });

  it('fails closed on a CDS table-function node', async () => {
    const r = resolver({
      resolveDirectSource: vi.fn(async () => ({ kind: 'cds' as const, name: 'ZTF', ddlSource: 'ZTF' })),
      readCdsDependencyGraph: vi.fn(async () => ({
        name: 'ZTF',
        aliases: ['ZTF'],
        kind: 'CDS_TABLE_FUNCTION',
        children: [],
      })),
    });
    await expect(enforceBlockedDataSources(['ZTF'], ['USR02'], r)).rejects.toBeInstanceOf(DataSourcePolicyError);
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
      code: 'DATA_SOURCE_UNRESOLVED',
      sourcePath: ['EXPECTED_VIEW'],
    });
  });

  it('wraps resolver failures and never treats them as allow', async () => {
    const r = resolver({
      resolveDirectSource: vi.fn(async () => {
        throw new Error('search unavailable');
      }),
    });
    const result = enforceBlockedDataSources(['SCARR'], ['USR02'], r);
    await expect(result).rejects.toMatchObject({
      code: 'DATA_SOURCE_UNRESOLVED',
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

  it('fails closed on a replacement cycle', async () => {
    const r = resolver({
      readTableSource: vi.fn(async (name: string) =>
        name === 'TABLE_A' ? "@AbapCatalog.replacementObject: 'TABLE_B'" : "@AbapCatalog.replacementObject: 'TABLE_A'",
      ),
    });
    await expect(enforceBlockedDataSources(['TABLE_A'], ['USR02'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_UNRESOLVED',
    });
  });

  it('bounds the number of direct sources before resolver traffic', async () => {
    const r = resolver();
    const sources = Array.from({ length: 65 }, (_, index) => `TABLE_${index}`);
    await expect(enforceBlockedDataSources(sources, ['USR02'], r)).rejects.toMatchObject({
      code: 'DATA_SOURCE_UNRESOLVED',
    });
    expect(r.resolveDirectSource).not.toHaveBeenCalled();
  });
});

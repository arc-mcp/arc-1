import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../inventory.js', () => ({
  searchRepository: vi.fn(),
}));

import type { GraphImport } from '../graph/types.js';
import { type RepositoryObject, searchRepository } from '../inventory.js';
import { SapAuthenticationError, SapClient } from '../sap.js';
import { collectLiveGraph, discoverLiveObjects } from './live-collector.js';

function object(type: string, name: string, packageName: string): RepositoryObject {
  return { description: '', name, packageName, type, uri: `/sap/bc/adt/${name.toLowerCase()}` };
}

afterEach(() => {
  vi.mocked(searchRepository).mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('live collector last-good evidence', () => {
  function setup(sources: Array<string | Error>) {
    vi.stubEnv('ARC_GRAPH_SYSTEM_KEY', 'QUALITY-UNIT');
    vi.stubEnv('ARC_GRAPH_LIVE_QUERY', 'Z*');
    vi.stubEnv('ARC_GRAPH_LIVE_PACKAGES', 'ZAPP');
    vi.stubEnv('ARC_GRAPH_LIVE_MAX_OBJECTS', '500');
    vi.stubEnv('ARC_GRAPH_LIVE_CONCURRENCY', '1');
    vi.mocked(searchRepository).mockResolvedValue(
      sources.map((_source, index) => ({
        ...object('PROG/P', `ZQUALITY_${index}`, 'ZAPP'),
        uri: `/sap/bc/adt/programs/programs/zquality_${index}`,
      })),
    );
    let cursor = 0;
    const sap = {
      getText: vi.fn(async () => {
        const value = sources[cursor++];
        if (value instanceof Error) throw value;
        return { body: value!, status: 200, attempts: 1 };
      }),
      close: vi.fn(async () => undefined),
      metrics: () => ({ sapRequestAttempts: cursor, proxyTokenRequests: 0 }),
    };
    vi.spyOn(SapClient, 'create').mockResolvedValue(sap as unknown as SapClient);
    const store = {
      importGraph: vi.fn(async (_graph: GraphImport, _replace?: boolean) => ({ nodes: 0, observations: 0 })),
    };
    return { sap, store };
  }

  it('only replaces successful resource scopes and reports read/partial/failed parse outcomes separately', async () => {
    const { store, sap } = setup([
      'REPORT zquality_0. SELECT * FROM zorders INTO TABLE @DATA(rows).',
      'REPORT zquality_1. NOT_RECOGNIZED foo.',
      'NOT VALID ABAP ???',
      new Error('ARC_SOURCE_CANARY_SECRET backend failure'),
    ]);
    const result = await collectLiveGraph(store, 'transient-source');
    expect(result).toMatchObject({
      successfulSources: 1,
      failedSources: 3,
      failedReads: 1,
      failedParses: 1,
      partialParses: 1,
      collectionStatus: 'partial',
    });
    const graph = store.importGraph.mock.calls[0]![0];
    expect(graph.evidenceScopes?.filter((scope) => scope.sourceResource.startsWith('active:'))).toEqual([
      { evidenceOwner: 'PROG/P:ZQUALITY_0', sourceResource: 'active:PROG/P:ZQUALITY_0' },
    ]);
    expect(graph.observations).toHaveLength(5); // four catalog links plus one parsed SQL dependency
    expect(graph.collection?.sources.map((source) => source.status)).toEqual([
      'parsed',
      'partial',
      'failed',
      'read_failed',
    ]);
    expect(JSON.stringify(graph)).not.toContain('ARC_SOURCE_CANARY_SECRET');
    expect(sap.close).toHaveBeenCalledOnce();
  });

  it('allows valid empty extraction to clear old resource evidence', async () => {
    const { store } = setup(['REPORT zquality_0. DATA x TYPE string.']);
    const result = await collectLiveGraph(store, 'transient-source');
    expect(result).toMatchObject({ successfulSources: 1, failedSources: 0, collectionStatus: 'complete' });
    const graph = store.importGraph.mock.calls[0]![0];
    expect(graph.evidenceScopes?.some((scope) => scope.sourceResource.startsWith('active:'))).toBe(true);
    expect(graph.observations.every((edge) => edge.relation === 'belongs_to')).toBe(true);
  });

  it('keeps metadata-only collection separate from source evidence scopes', async () => {
    const { store, sap } = setup(['never fetched']);
    const result = await collectLiveGraph(store, 'metadata');
    expect(result.sourceOutcomes).toEqual([]);
    expect(sap.getText).not.toHaveBeenCalled();
    expect(
      store.importGraph.mock.calls[0]![0].evidenceScopes?.every((scope) => scope.sourceResource.startsWith('catalog:')),
    ).toBe(true);
  });

  it('counts dynamic targets without inventing static edges', async () => {
    const { store } = setup(['REPORT zquality_0. CALL FUNCTION function_name.']);
    const result = await collectLiveGraph(store, 'transient-source');
    expect(result).toMatchObject({ successfulSources: 1, dynamicTargets: 1 });
    expect(store.importGraph.mock.calls[0]![0].collection?.counters.dynamicTargets).toBe(1);
    expect(store.importGraph.mock.calls[0]![0].observations.every((edge) => edge.relation === 'belongs_to')).toBe(true);
  });

  it('stops on authentication failure instead of repeating bad credentials across the catalogue', async () => {
    const { store, sap } = setup([new SapAuthenticationError(), 'REPORT zquality_1.']);
    await expect(collectLiveGraph(store, 'transient-source')).rejects.toThrow('authentication failed');
    expect(sap.getText).toHaveBeenCalledOnce();
    expect(store.importGraph).not.toHaveBeenCalled();
    expect(sap.close).toHaveBeenCalledOnce();
  });
});

describe('discoverLiveObjects', () => {
  it('uses typed partitions when unsupported objects fill a mixed search result', async () => {
    vi.mocked(searchRepository).mockImplementation(async (_sap, _query, _limit, type) => {
      if (type === undefined) return [object('TABL/DT', 'ZT1', 'ZAPP'), object('TABL/DT', 'ZT2', 'ZAPP')];
      if (type === 'CLAS') return [object('CLAS/OC', 'ZCL_APP', 'ZAPP')];
      if (type === 'DDLS') return [object('DDLS/DF', 'ZI_APP', 'ZAPP')];
      return [];
    });
    const result = await discoverLiveObjects({} as SapClient, 'Z*', ['ZAPP'], 2);
    expect(result.objects.map((entry) => entry.name)).toEqual(['ZCL_APP', 'ZI_APP']);
    expect(result.requests).toBe(5);
    expect(result.saturatedSearches).toBeGreaterThan(0);
  });

  it('rejects unbounded or malformed scopes before contacting SAP', async () => {
    await expect(discoverLiveObjects({} as SapClient, 'Z*', Array(21).fill('ZAPP'), 500)).rejects.toThrow();
    await expect(discoverLiveObjects({} as SapClient, 'Z*', ['Z*BAD*'], 500)).rejects.toThrow();
    await expect(discoverLiveObjects({} as SapClient, 'Z*', ['ZAPP'], 501)).rejects.toThrow();
    expect(searchRepository).not.toHaveBeenCalled();
  });

  it('enumerates matching packages before reading their contents', async () => {
    vi.mocked(searchRepository).mockImplementation(async (_sap, query, _limit, objectType, packageName) => {
      if (objectType === 'DEVC' && query === 'Z*') {
        return [object('DEVC/K', 'ZAPP', 'ZAPP'), object('DEVC/K', 'STANDARD', 'STANDARD')];
      }
      if (packageName === 'ZAPP') {
        return [object('CLAS/OC', 'ZCL_APP', 'ZAPP'), object('TABL/DT', 'ZT_APP', 'ZAPP')];
      }
      return [];
    });

    const result = await discoverLiveObjects({} as SapClient, 'Z*', ['Z*'], 100);

    expect(result.objects.map((entry) => entry.name)).toEqual(['ZCL_APP']);
    expect(result.requests).toBe(2);
    expect(searchRepository).toHaveBeenNthCalledWith(1, expect.anything(), 'Z*', 1_000, 'DEVC');
    expect(searchRepository).toHaveBeenNthCalledWith(2, expect.anything(), 'Z*', 100, undefined, 'ZAPP');
  });

  it('supports exact packages without a package-enumeration request and stops at the object bound', async () => {
    vi.mocked(searchRepository).mockResolvedValue([
      object('CLAS/OC', 'ZCL_ONE', 'ZAPP'),
      object('PROG/P', 'ZTWO', 'ZAPP'),
    ]);

    const result = await discoverLiveObjects({} as SapClient, '*', ['ZAPP'], 1);

    expect(result.objects).toHaveLength(1);
    expect(result.requests).toBe(1);
    expect(result.saturatedSearches).toBe(1);
    expect(searchRepository).toHaveBeenCalledWith(expect.anything(), '*', 1, undefined, 'ZAPP');
  });
});

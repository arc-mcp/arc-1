import { afterEach, expect, it, vi } from 'vitest';
import type { GraphImport } from './types.js';

const state = vi.hoisted(() => ({
  imports: [] as Array<{ database: string; input: unknown }>,
  close: vi.fn(),
  existing: false,
}));
vi.mock('./store/pg.js', () => ({
  PgGraphStore: class {
    async stats() {
      return { nodes: state.existing || state.imports.length ? 1 : 0, observations: 0, unresolved: 0 };
    }
    async withCollectionLease(_key: string, operation: (store: unknown) => Promise<unknown>) {
      return operation(this);
    }
    async importGraph(input: unknown) {
      state.imports.push({ database: 'pg', input });
      return { nodes: 1, observations: 0 };
    }
    async close() {
      state.close();
    }
  },
}));
vi.mock('./store/hana.js', () => ({
  HanaGraphStore: class {
    async stats() {
      return { nodes: state.existing || state.imports.length ? 1 : 0, observations: 0, unresolved: 0 };
    }
    async importGraph(input: unknown) {
      state.imports.push({ database: 'hana', input });
      return { nodes: 1, observations: 0 };
    }
    async close() {
      state.close();
    }
  },
}));
vi.mock('./storage.js', () => ({
  pgStorage: async () => ({ totalBytes: 100, walPosition: '0/100' }),
  hanaStorage: async () => ({ diskBytes: 100 }),
  walBytesBetween: () => 0,
}));
vi.mock('../sap.js', () => ({
  SapClient: { create: async () => ({ close: async () => {}, metrics: () => ({ sapRequestAttempts: 1 }) }) },
}));
vi.mock('../collector/live-collector.js', () => ({ collectLiveGraph: vi.fn() }));

import { collectLiveGraph } from '../collector/live-collector.js';
import { runSoak } from './soak.js';

afterEach(() => {
  state.imports.length = 0;
  state.existing = false;
  state.close.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function setup() {
  vi.stubEnv('ARC_GRAPH_SYSTEM_KEY', 'SOAK-UNIT');
  vi.stubEnv('ARC_GRAPH_SOAK_PACKAGES', 'ZAPP');
  vi.stubEnv('ARC_GRAPH_SOAK_OBJECTS', '1');
  vi.stubEnv('ARC_GRAPH_SOAK_PASSES', '2');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const input: GraphImport = {
    systemKey: 'SOAK-UNIT',
    scope: 'ZAPP',
    extractorVersion: 'test',
    nodes: [{ systemKey: 'SOAK-UNIT', type: 'PROG', name: 'ZTEST' }],
    observations: [],
    collection: {
      status: 'complete',
      counters: {},
      sources: [{ name: 'ZTEST', type: 'PROG', status: 'parsed', reasons: [], dynamicTargets: 0 }],
    },
  };
  vi.mocked(collectLiveGraph).mockImplementation(async (store) => {
    await store.importGraph(input, true);
    return { discoveredObjects: 1, downloadedBytes: 100, sapRequestAttempts: 2, sourceOutcomes: [] } as never;
  });
  return { log, input };
}

it('compares the same metadata on both backends and repeats bounded source collection', async () => {
  const { log, input } = setup();
  await runSoak();
  expect(state.imports.map((i) => i.database)).toEqual(['pg', 'hana', 'pg', 'hana']);
  expect(state.imports.every((i) => i.input === input)).toBe(true);
  const summary = log.mock.calls.map(([s]) => JSON.parse(s as string)).find((e) => e.event === 'summary');
  expect(summary).toMatchObject({
    uniqueObjects: 1,
    sourceReads: 2,
    stableRefreshes: 1,
    batches: 2,
    sapRequestAttempts: 5,
  });
  expect(state.close).toHaveBeenCalledTimes(2);
});

it('refuses reuse of a populated key before collecting or publishing', async () => {
  setup();
  state.existing = true;
  await expect(runSoak()).rejects.toThrow('already contains data');
  expect(state.imports).toHaveLength(0);
  expect(state.close).toHaveBeenCalledTimes(2);
});

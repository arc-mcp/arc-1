import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtNetworkError, AdtResponseLimitError } from '../../../src/adt/errors.js';
import {
  normalizeRelationNetwork,
  type RelationObject,
  RelationProtocolError,
} from '../../../src/adt/repository-relations.js';
import { AdtRequestBudgetError, RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { type RelationProvider, walkRelations } from '../../../src/context/relation-walk.js';
import { relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const a = relationObject('Z_A'),
  b = relationObject('Z_B'),
  c = relationObject('Z_C'),
  d = relationObject('Z_D');
const options = { direction: 'outgoing' as const, depth: 3, maxResults: 50 };
function provider(
  graph: Record<string, RelationObject[]> = { Z_A: [b, c], Z_B: [d], Z_C: [d], Z_D: [a] },
): RelationProvider {
  return {
    options: {},
    lookup: vi.fn(async (node, direction) => {
      const context = direction === 'outgoing' ? 'ENV' : 'WUL';
      return normalizeRelationNetwork(relationXml(node, graph[node.name] ?? [], context), context, node);
    }),
  };
}
describe('bounded request-local relation traversal', () => {
  it('never hides observed authorization failure behind later body/retry exhaustion', async () => {
    const p = provider();
    p.options.attemptBudget = new RequestAttemptBudget(12);
    p.options.attemptBudget.authorizationFailureObserved = true;
    vi.mocked(p.lookup)
      .mockResolvedValueOnce(normalizeRelationNetwork(relationXml(a, [b]), 'ENV', a))
      .mockRejectedValueOnce(new AdtRequestBudgetError(12));
    await expect(walkRelations(a, p, options)).rejects.toBeInstanceOf(AdtRequestBudgetError);
  });
  it('prioritizes the root package before generic neighbors under a small node budget', async () => {
    const other = relationObject('A_SAP_CLASS', 'CLAS/OC', 'SAP');
    const result = await walkRelations(a, provider({ Z_A: [other, b] }), { ...options, maxResults: 2 });
    expect(result.nodes.map((node) => node.name)).toEqual(['Z_A', 'Z_B']);
    expect(result.truncationReasons).toEqual(['nodes']);
  });
  it.each(['outgoing', 'incoming'] as const)(
    'deduplicates diamond/cycle in %s and starts fresh next request',
    async (direction) => {
      const p = provider();
      const first = await walkRelations(a, p, { ...options, direction });
      expect(first.nodes).toHaveLength(4);
      expect(first.edges).toHaveLength(5);
      expect(first.expanded).toHaveLength(4);
      expect(first.coverage).toBe('unknown');
      expect(first.truncated).toBe(false);
      expect(await walkRelations(a, p, { ...options, direction })).toEqual(first);
      expect(p.lookup).toHaveBeenCalledTimes(8);
    },
  );
  it('reports depth as a scope boundary, not resource truncation', async () => {
    const result = await walkRelations(a, provider(), { ...options, depth: 1 });
    expect(result.truncated).toBe(false);
    expect(result.scopeBoundaries).toEqual([
      { uri: b.uri, reason: 'depth' },
      { uri: c.uri, reason: 'depth' },
    ]);
    expect(result.expanded).toEqual([a.uri]);
  });
  it('keeps type/package boundary nodes visible without expanding them', async () => {
    const ddl = { ...c, type: 'DDLS/DF', uri: '/sap/bc/adt/ddic/ddl/sources/z_c' };
    const p = provider({ Z_A: [{ ...b, package: 'SAP' }, ddl] });
    const result = await walkRelations(a, p, { ...options, expandPackages: ['ZTEST'] });
    expect(result.nodes).toHaveLength(3);
    expect(result.scopeBoundaries.map((item) => item.reason).sort()).toEqual(['package', 'type']);
    expect(p.lookup).toHaveBeenCalledTimes(1);
  });
  it('caps high fanout and never returns dangling edges', async () => {
    const p = provider({
      Z_A: Array.from({ length: 1000 }, (_, i) => relationObject(`Z_${String(i).padStart(4, '0')}`)),
    });
    const result = await walkRelations(a, p, { ...options, maxResults: 10 });
    expect(result.nodes).toHaveLength(10);
    expect(result.truncationReasons).toContain('nodes');
    expect(result.truncationReasons).toContain('expansions');
    const uris = new Set(result.nodes.map((node) => node.uri));
    expect(result.edges.every((edge) => uris.has(edge.from) && uris.has(edge.to))).toBe(true);
    expect(p.lookup).toHaveBeenCalledTimes(8);
  });
  it('caps dense cyclic edges at 100', async () => {
    const objects = Array.from({ length: 30 }, (_, i) => relationObject(`Z_${i}`));
    const p = provider(Object.fromEntries(objects.map((o) => [o.name, objects])));
    const result = await walkRelations(objects[0]!, p, options);
    expect(result.edges).toHaveLength(100);
    expect(result.truncationReasons).toContain('edges');
    expect(result.expanded).toHaveLength(8);
  });
  it.each([401, 403, 500])('does not turn HTTP %i into success-shaped partial output', async (status) => {
    const p = provider();
    vi.mocked(p.lookup).mockRejectedValueOnce(new AdtApiError('Denied', status, '/test'));
    await expect(walkRelations(a, p, options)).rejects.toMatchObject({ statusCode: status });
    const q = provider();
    vi.mocked(q.lookup).mockImplementation(async (node) => {
      if (node.name !== a.name) throw new AdtApiError('Denied', status, '/test');
      return normalizeRelationNetwork(relationXml(a, [b]), 'ENV', a);
    });
    await expect(walkRelations(a, q, options)).rejects.toMatchObject({ statusCode: status });
  });
  it.each([
    ['requests', new AdtRequestBudgetError(12)],
    ['bytes', new AdtResponseLimitError(1048576, 1048577, 'repository-relations')],
  ])('marks %s exhaustion partial only after verified expansion', async (reason, error) => {
    const p = provider();
    vi.mocked(p.lookup).mockRejectedValueOnce(error);
    await expect(walkRelations(a, p, options)).rejects.toBe(error);
    vi.mocked(p.lookup)
      .mockResolvedValueOnce(normalizeRelationNetwork(relationXml(a, [b]), 'ENV', a))
      .mockRejectedValueOnce(error);
    const result = await walkRelations(a, p, options);
    expect(result.truncationReasons).toEqual([reason]);
    expect(result.pending).toEqual([b.uri]);
  });
  it('preserves cancellation and protocol errors after successful evidence', async () => {
    for (const error of [new RelationProtocolError('bad context'), new AdtNetworkError('cancelled')]) {
      const p = provider();
      vi.mocked(p.lookup)
        .mockResolvedValueOnce(normalizeRelationNetwork(relationXml(a, [b]), 'ENV', a))
        .mockRejectedValueOnce(error);
      await expect(walkRelations(a, p, options)).rejects.toBe(error);
    }
  });
  it('reports a disappeared child without claiming complete coverage', async () => {
    const p = provider();
    vi.mocked(p.lookup)
      .mockResolvedValueOnce(normalizeRelationNetwork(relationXml(a, [b]), 'ENV', a))
      .mockRejectedValueOnce(new AdtApiError('Missing', 404, '/test'));
    const result = await walkRelations(a, p, options);
    expect(result.scopeBoundaries).toEqual([{ uri: b.uri, reason: 'missing' }]);
    expect(result.coverage).toBe('unknown');
  });
  it('fails closed if an identity changes across expansions', async () => {
    await expect(walkRelations(a, provider({ Z_A: [b], Z_B: [{ ...a, package: 'MOVED' }] }), options)).rejects.toThrow(
      'identity changed',
    );
  });
  it.each([0, 101, Infinity, NaN, 1.5])('rejects invalid node limit %s', async (maxResults) => {
    const p = provider();
    await expect(walkRelations(a, p, { ...options, maxResults })).rejects.toThrow('bounds');
    expect(p.lookup).not.toHaveBeenCalled();
  });
});

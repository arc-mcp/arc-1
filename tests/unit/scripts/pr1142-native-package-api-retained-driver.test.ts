import { describe, expect, it } from 'vitest';

const { packageApiOwners } = await import('../../../scripts/qualification/pr1142/native-package-api-profile.js');
const { PACKAGE_API_RETAINED_COMPLETED, PACKAGE_API_RETAINED_STAGES } = await import(
  '../../../scripts/qualification/pr1142/native-package-api-retained-fixed.js'
);

import { graph, retainedHarness } from './pr1142-native-package-api-retained-harness.js';

const owners = packageApiOwners(graph).map((o) => o.owner);
describe('fixed retained package/API tail', () => {
  it.each([false, true])('executes only the unfinished tail through actual HTTP (proxy=%s)', async (proxy) => {
    const h = await retainedHarness({ proxy });
    const result = await h.run();
    expect(result).toMatchObject({
      failure: false,
      created: [],
      retainedFromOriginal: owners,
      previouslyCompleted: PACKAGE_API_RETAINED_COMPLETED,
      completed: PACKAGE_API_RETAINED_STAGES,
      confirmedDeleted: [...owners].reverse(),
      remaining: [],
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: true,
      retainedBookkeeping: {
        createAttempted: false,
        adoptedExistingPair: true,
        request: 'A4HK906609',
        task: 'A4HK906610',
        classRecorded: true,
        apiRecorded: true,
      },
    });
    expect(h.client.safety).toMatchObject({
      allowTransportWrites: false,
      allowedTransports: ['A4HK906609'],
      multiTargetWrite: { allowedTransports: ['A4HK906609'], serverAllowedTransports: ['A4HK906609'] },
    });
    expect(
      h.calls.filter(
        (c) =>
          c.method === 'POST' &&
          [
            '/sap/bc/adt/cts/transports',
            '/sap/bc/adt/packages',
            '/sap/bc/adt/oo/classes',
            '/sap/bc/adt/oo/interfaces',
          ].includes(c.path),
      ),
    ).toEqual([]);
    expect(h.calls.some((c) => c.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
    expect(h.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual([
      graph.root.owner,
      graph.child.owner,
      ...[...owners].reverse(),
    ]);
  });
  it.each(['source', 'metadata', 'missing', 'request', 'task', 'recorded-package'] as const)(
    'refuses %s drift before mutation and retains all four owners',
    async (fault) => {
      const h = await retainedHarness();
      h.hooks.reply = (r) => {
        if (r.method !== 'GET') return;
        const path =
          fault === 'source'
            ? `${graph.clas.owner}/source/main`
            : fault === 'request'
              ? '/sap/bc/adt/cts/transportrequests/A4HK906609'
              : fault === 'task'
                ? '/sap/bc/adt/cts/transportrequests/A4HK906610'
                : fault === 'recorded-package'
                  ? '/sap/bc/adt/packages/ZARC1_DEMO'
                  : graph.root.owner.toLowerCase();
        if (r.path === path) return { statusCode: fault === 'missing' ? 404 : 200, data: 'changed' };
      };
      expect(await h.run()).toMatchObject({
        failure: true,
        mutationAttempted: false,
        completed: [],
        created: [],
        remaining: owners,
        inspectionRequired: owners,
      });
      expect(h.calls.every((c) => c.method === 'GET')).toBe(true);
    },
  );
  it('refuses opaque drift between raw reads and actual parser adoption', async () => {
    const h = await retainedHarness();
    let count = 0;
    h.hooks.reply = (r) =>
      r.method === 'GET' && r.path === graph.root.owner && ++count === 2
        ? { statusCode: 200, data: 'changed after initial observations' }
        : undefined;
    expect(await h.run()).toMatchObject({ failure: true, mutationAttempted: false, remaining: owners });
  });
  it('retains both unknown delete outcome and owning cleanup without replay', async () => {
    const h = await retainedHarness();
    h.hooks.reply = (r) => (r.method === 'DELETE' ? { statusCode: 500, data: 'ambiguous native failure' } : undefined);
    expect(await h.run()).toMatchObject({ failure: true, completed: [], remaining: owners, cleanupUnconfirmed: false });
    expect(h.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(h.calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
  });
  it('preserves prior successful removals and stops before the next parent when a deleted child reappears', async () => {
    const h = await retainedHarness();
    h.hooks.record = (r) => {
      if (r.stageComplete === 'delete-class') h.existing.add(graph.clas.owner);
    };
    const result = await h.run();
    expect(result.failure).toBe(true);
    expect(result.confirmedDeleted).toContain(graph.clas.owner);
    expect(result.remaining).toContain(graph.clas.owner);
    expect(h.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual([
      graph.root.owner,
      graph.child.owner,
      graph.clas.owner,
    ]);
    expect(result.completed).not.toContain('delete-interface');
  });
});

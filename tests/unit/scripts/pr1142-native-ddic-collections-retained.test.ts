import { expect, it, vi } from 'vitest';
import { fixtures, retained, retainedHarness } from './pr1142-native-ddic-collections-retained-harness.js';

const { COLLECTIONS_RETAINED_STAGES } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-collections-retained-fixed.js'
);
const { checkCollectionsRetainedRequest } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-collections-retained-runner.js'
);
const writes = (h: ReturnType<typeof retainedHarness>) =>
  h.world.calls.filter((c) => ['PUT', 'DELETE'].includes(c.method));
it.each([false, true])(
  'adopts exact actual receipts, saves MSAG active and reverse-deletes once; proxy=%s',
  async (proxy) => {
    const h = retainedHarness({ proxy });
    const r = await h.run();
    expect(r).toMatchObject({
      failure: false,
      completed: [...COLLECTIONS_RETAINED_STAGES],
      created: [],
      confirmedDeleted: [...fixtures].reverse().map((f) => f.owner),
      remaining: [],
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: true,
    });
    expect(writes(h).map((c) => [c.method, c.path.split('?')[0]])).toEqual([
      ['PUT', fixtures[2].owner],
      ...fixtures
        .slice()
        .reverse()
        .map((f) => ['DELETE', f.owner]),
    ]);
    expect(
      h.world.calls.some(
        (c) =>
          c.path.startsWith('/sap/bc/adt/activation?') ||
          (c.method === 'POST' &&
            ['/sap/bc/adt/ddic/structures', '/sap/bc/adt/ddic/tabletypes', '/sap/bc/adt/messageclass'].includes(
              c.path,
            )),
      ),
    ).toBe(false);
    expect(h.records.some((r) => r.adapter === 'update-MSAG' && r.result.state === 'saved-active')).toBe(true);
    expect(JSON.stringify(h.records)).not.toContain('native-lock');
  },
);
it.each(['TABL/DS', 'TTYP', 'MSAG'] as const)('refuses initial %s receipt drift before LOCK or write', async (type) => {
  const h = retainedHarness();
  const f = fixtures.find((f) => f.type === type)!;
  h.world.objects.get(f.owner)!.metadata = retained[type].metadata.replace(
    'adtcore:createdBy="MARIAN"',
    'adtcore:createdBy="OTHER"',
  );
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stoppedAt: 'preflight', remaining: fixtures.map((f) => f.owner) });
  expect(writes(h)).toHaveLength(0);
  expect(h.world.calls.some((c) => c.path.includes('_action=LOCK'))).toBe(false);
});
it('catches full canonical metadata drift appearing only under the MSAG update lock', async () => {
  const h = retainedHarness(),
    original = h.hooks.before!;
  let update = false;
  h.hooks.record = (r) => {
    if (r.stageStarted === 'update-MSAG') update = true;
  };
  h.hooks.before = (u, i) => {
    original(u, i);
    if (update && u.searchParams.get('_action') === 'LOCK')
      h.world.objects.get(fixtures[2].owner)!.metadata = retained.MSAG.metadata.replace(
        '2026-11-03T17:01:23Z',
        '2026-11-03T18:01:23Z',
      );
  };
  const r = await h.run();
  expect(r).toMatchObject({
    failure: true,
    stoppedAt: 'update-MSAG',
    cleanupUnconfirmed: false,
    remaining: fixtures.map((f) => f.owner),
  });
  expect(writes(h)).toHaveLength(0);
  expect(h.world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(2);
});
it.each(['msag-inactive', 'save-unknown', 'unlock', 'delete-unknown'])(
  'retains honest scope and never retries %s',
  async (fault) => {
    const h = retainedHarness();
    h.world.faults.add(fault);
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.remaining).toEqual(fixtures.map((f) => f.owner));
    expect(writes(h).filter((c) => c.method === 'PUT').length).toBeLessThanOrEqual(1);
    expect(writes(h).filter((c) => c.method === 'DELETE').length).toBeLessThanOrEqual(1);
    if (fault === 'msag-inactive' || fault === 'save-unknown')
      expect(writes(h).filter((c) => c.method === 'DELETE')).toHaveLength(0);
  },
);
it('requires current typed absence even after historical confirmations', async () => {
  const h = retainedHarness();
  h.hooks.record = (r) => {
    if (r.stageCompleted === 'delete-TABL/DS')
      h.world.objects.get(fixtures[2].owner)!.metadata = retained.MSAG.metadata;
  };
  const r = await h.run();
  expect(r).toMatchObject({
    failure: true,
    confirmedDeleted: fixtures
      .slice()
      .reverse()
      .map((f) => f.owner),
    remaining: [fixtures[2].owner],
    finalAbsenceConfirmed: false,
  });
  expect(writes(h).filter((c) => c.method === 'DELETE')).toHaveLength(3);
});
it.each(['stop', 'source', 'deadline'] as const)(
  'final synchronous %s proof refuses PUT and keeps own unlock',
  async (fault) => {
    const h = retainedHarness();
    let handoff = false;
    h.hooks.record = (r) => {
      if (r.stage === 'request' && r.method === 'PUT') handoff = true;
    };
    h.hooks.verify = () => {
      if (handoff) {
        handoff = false;
        if (fault === 'stop') h.stop();
        else if (fault === 'source') h.breakSource();
        else vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300_000);
      }
    };
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(writes(h)).toHaveLength(0);
    expect(h.world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(2);
  },
);
it.each(['create-MSAG', 'activate-MSAG', 'reactivate-MSAG', 'update-TTYP', 'create-TABL/DS'])(
  'refuses completed/unsupported stage %s before submission',
  (stage) => {
    expect(() =>
      checkCollectionsRetainedRequest(
        fixtures,
        fixtures[2],
        stage,
        'POST',
        `${fixtures[2].owner}?_action=LOCK&accessMode=MODIFY`,
      ),
    ).toThrow('replayed');
  },
);
it('rejects a different owner graph without any request', async () => {
  const h = retainedHarness();
  expect(() => h.run(fixtures.map((f) => ({ ...f, name: `${f.name}X` })))).toThrow('graph');
  expect(h.world.calls).toEqual([]);
});

import { setImmediate as immediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { Semaphore } from '../../../src/adt/semaphore.js';
import { fixtures, removalHarness, retained } from './pr1142-native-ddic-collections-removal-harness.js';

const { COLLECTIONS_REMOVAL_STAGES } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-collections-removal-fixed.js'
);
const { checkCollectionsRemovalRequest } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-collections-removal-runner.js'
);
const writes = (h: ReturnType<typeof removalHarness>) =>
  h.world.calls.filter((c) => ['PUT', 'DELETE'].includes(c.method));
it.each([false, true])(
  'adopts exact actual receipts, saves MSAG active and reverse-deletes once; proxy=%s',
  async (proxy) => {
    const h = removalHarness({ proxy });
    const r = await h.run();
    expect(r).toMatchObject({
      failure: false,
      completed: [...COLLECTIONS_REMOVAL_STAGES],
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
  const h = removalHarness();
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
  const h = removalHarness(),
    original = h.hooks.before!;
  let update = false;
  h.hooks.record = (r) => {
    if (r.stageStarted === 'update-MSAG') update = true;
  };
  h.hooks.before = (u, i) => {
    original(u, i);
    if (update && u.searchParams.get('_action') === 'LOCK')
      h.world.objects.get(fixtures[2].owner)!.metadata = retained.MSAG.metadata.replace(
        '2026-11-04T14:25:37Z',
        '2026-11-04T15:25:37Z',
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
  expect(h.world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
it.each(['msag-inactive', 'save-unknown', 'unlock', 'delete-unknown'])(
  'retains honest scope and never retries %s',
  async (fault) => {
    const h = removalHarness();
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
  const h = removalHarness();
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
    const h = removalHarness();
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
    expect(h.world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
  },
);
it.each(['stale-MSAG', 'create-MSAG', 'activate-MSAG', 'reactivate-MSAG', 'update-TTYP', 'create-TABL/DS'])(
  'refuses completed/unsupported stage %s before submission',
  (stage) => {
    expect(() =>
      checkCollectionsRemovalRequest(
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
  const h = removalHarness();
  expect(() => h.run(fixtures.map((f) => ({ ...f, name: `${f.name}X` })))).toThrow('graph');
  expect(h.world.calls).toEqual([]);
});
it('submits only the unfinished removal against actual four-row state, without old source changes or stale stage replay', async () => {
  const h = removalHarness();
  const r = await h.run();
  expect(r.failure).toBe(false);
  const saved = writes(h).filter((c) => c.method === 'PUT');
  expect(saved).toHaveLength(1);
  const { nativeXmlCharacterRoot } = await import('../../../src/adt/native-xml-evidence.js');
  const mc = 'http://www.sap.com/adt/MessageClass',
    root = nativeXmlCharacterRoot(saved[0].body, 'messageClass', mc);
  expect(root.children('deletedmessages', mc).map((r) => r.attribute('msgno', mc))).toEqual(['003']);
  expect(root.children('messages', mc).map((r) => [r.attribute('msgno', mc), r.attribute('msgtext', mc)])).toEqual([
    ['001', 'Updated collection &1'],
    ['002', 'Preserved message'],
    ['004', 'Added message'],
  ]);
  expect(r.completed).not.toContain('stale-MSAG');
});
it('refuses the old three-row pre-update state rather than adopting it', async () => {
  const h = removalHarness();
  const { readFileSync } = await import('node:fs');
  const old = JSON.parse(
    readFileSync(new URL('../../fixtures/ddic-collections/retained-v2-native.json', import.meta.url), 'utf8'),
  );
  h.world.objects.get(fixtures[2].owner)!.metadata = old.MSAG.metadata;
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stoppedAt: 'preflight', remaining: fixtures.map((f) => f.owner) });
  expect(writes(h)).toHaveLength(0);
});
it.each(['stop', 'source', 'deadline'] as const)(
  'revalidates %s after the actual removal semaphore wait',
  async (fault) => {
    const semaphore = new Semaphore(1),
      h = removalHarness({ semaphore });
    let queued = false;
    let waiter: Promise<void> | undefined;
    h.hooks.record = (r) => {
      if (r.stage === 'request' && r.method === 'PUT' && !queued) {
        queued = true;
        void semaphore.acquire();
        waiter = (async () => {
          for (let i = 0; i < 100 && semaphore.waiting === 0; i++) await immediate();
          if (fault === 'stop') h.stop();
          else if (fault === 'source') h.breakSource();
          else vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300000);
          semaphore.release();
        })();
      }
    };
    const result = await h.run();
    await waiter;
    expect(queued).toBe(true);
    expect(result).toMatchObject({ failure: true, remaining: fixtures.map((f) => f.owner), cleanupUnconfirmed: false });
    expect(writes(h)).toHaveLength(0);
    expect(h.world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
  },
);
it.each([false, true])('rechecks source after token wait, including proxy=%s', async (proxy) => {
  let h: ReturnType<typeof removalHarness>,
    putIntent = false;
  h = removalHarness({
    proxy,
    token: async () => {
      if (putIntent) {
        await immediate();
        h.breakSource();
      }
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'PUT') putIntent = true;
  };
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, remaining: fixtures.map((f) => f.owner), cleanupUnconfirmed: false });
  expect(writes(h)).toHaveLength(0);
  expect(h.world.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
});

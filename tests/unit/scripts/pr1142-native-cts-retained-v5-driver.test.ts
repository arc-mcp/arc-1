import { expect, it } from 'vitest';
import { retainedV5Harness } from './pr1142-native-cts-retained-v5-harness.js';

const base = '/sap/bc/adt/cts/transportrequests/';
const mutations = (h: ReturnType<typeof retainedV5Harness>) =>
  h.calls.filter((r) => !['GET', 'HEAD'].includes(r.method));
it.each([false, true])('adopts608 and submits only607 release via proxy=%s', async (proxy) => {
  const h = retainedV5Harness({ proxy }),
    r = await h.runV5();
  expect(r).toMatchObject({
    failure: false,
    completed: ['release-parent'],
    adoptedReleased: ['A4HK906608'],
    remaining: [],
    inspectionRequired: [],
  });
  expect(r.confirmedReleased).toEqual(['A4HK906608', 'A4HK906607']);
  expect(mutations(h).map((x) => [x.method, x.path])).toEqual([['POST', base + 'A4HK906607/newreleasejobs']]);
  h.assertSafe();
});
it('preflight has zero mutations and only parent607 remains modifiable', async () => {
  const h = retainedV5Harness(),
    r = await h.runV5({ preflight: true });
  expect(r).toMatchObject({
    failure: false,
    completed: [],
    remaining: ['A4HK906607'],
    inspectionRequired: [],
    current: { A4HK906608: 'released' },
  });
  expect(mutations(h)).toEqual([]);
  h.assertSafe();
});
it.each([false, true])(
  'actual full A→B→C reuses native bookkeeping proof, proxy=%s',
  async (proxy) => {
    const h = retainedV5Harness({ proxy });
    let prior = await h.runV5();
    expect(prior.failure).toBe(false);
    for (const round of ['B', 'C'] as const) {
      prior = await h.run(round, prior, { profile: 'retained-v5' });
      expect(prior).toMatchObject({ failure: false, remaining: [], inspectionRequired: [] });
    }
    expect(mutations(h).filter((x) => x.path === base + 'A4HK906608/newreleasejobs')).toEqual([]);
    expect(prior.releaseWitnesses).toHaveLength(2);
    h.assertSafe();
  },
  30000,
);
it.each([
  'timestamp',
  'status',
  'comment',
  'position',
  'foreign',
  'extra',
  'lock',
  'namespace',
  'class-present',
] as const)('initial %s refuses without607 release', async (fault) => {
  const h = retainedV5Harness();
  h.hooks.reply = (r) => {
    const out = h.reply(r);
    if (fault === 'class-present' && r.path === h.graph.classes[0].owner)
      return { statusCode: 200, data: h.metadata(r.path) };
    if (!out || r.method !== 'GET') return out;
    let b = out.data;
    if (fault === 'timestamp') b = b.replaceAll('20261105014315', '20261105014316');
    if (fault === 'status') b = b.replaceAll('tm:status="R"', 'tm:status="D"');
    if (fault === 'comment') b = b.replace('CORR', 'R3TR');
    if (fault === 'position') b = b.replaceAll('000002', '000003');
    if (fault === 'foreign') b = b.replace('014315 MARIAN', '014315 OTHER');
    if (fault === 'extra') b = b.replace('</tm:root>', '<tm:task tm:number="FOREIGN"/></tm:root>');
    if (fault === 'lock') b = b.replace('tm:lock_status=""', 'tm:lock_status="X"');
    if (fault === 'namespace') b = b.replace('http://www.sap.com/cts/adt/tm', 'urn:foreign');
    return { ...out, data: b };
  };
  const r = await h.runV5();
  expect(r.failure).toBe(true);
  expect(mutations(h)).toEqual([]);
  h.assertSafe();
});
it.each([false, true])('terminal drift preserves historical608 and newly confirmed607, proxy=%s', async (proxy) => {
  const h = retainedV5Harness({ proxy });
  h.hooks.record = (r) => {
    if (r.completedStep === 'release-parent') h.breakSource();
  };
  const r = await h.runV5();
  expect(r.failure).toBe(true);
  expect(r.confirmedReleased).toEqual(['A4HK906608', 'A4HK906607']);
  expect(r.inspectionRequired).toContain('A4HK906607');
  h.assertSafe();
});
it.each([false, true])('actual auth wait refuses late source/deadline, proxy=%s', async (proxy) => {
  let intent = false;
  const h = retainedV5Harness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (intent) h.breakSource();
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST') intent = true;
  };
  const r = await h.runV5({ freshUntil: Date.now() + 1500 });
  expect(intent).toBe(true);
  expect(r.failure).toBe(true);
  expect(mutations(h)).toEqual([]);
  h.assertSafe();
});
it.each([
  'report-missing',
  'report-pending',
  'report-foreign',
  'report-extra',
  'date',
  'task-time',
  'calendar',
  'locked',
  'foreign',
  'extra-comment',
  'parent-position',
  'late-regression',
  'no-task-witness',
] as const)(
  'B %s stops before parent release',
  async (fault) => {
    const h = retainedV5Harness();
    const a = await h.runV5();
    expect(a.failure).toBe(false);
    let selected = false;
    h.hooks.reply = (r) => {
      const out = h.reply(r);
      if (!out) return;
      const b = [...h.trees.values()].find((t) => t.description === h.graph.descriptions.B);
      if (!b || (!r.path.includes(b.parent) && !r.path.includes(b.task))) return out;
      let data = out.data;
      if (r.method === 'POST' && r.path.includes(b.task)) {
        if (fault === 'report-missing') data = '<t:root xmlns:t="http://www.sap.com/cts/adt/tm"/>';
        if (fault === 'report-pending') data = data.replace('chkrun:status="released"', 'chkrun:status="pending"');
        if (fault === 'report-foreign') data = data.replaceAll(b.task, 'A4HK906606');
        if (fault === 'report-extra') data = data.replace('</tm:root>', '<tm:extra/></tm:root>');
      }
      if (r.method === 'GET' && b.taskStatus === 'R') {
        if (r.path === base + b.task) selected = true;
        if (fault === 'task-time') data = data.replaceAll('20261105014315', '20261105014316');
        if (fault === 'calendar') data = data.replaceAll('20261105014315', '20260229014315');
        if (fault === 'no-task-witness' && r.path === base + b.task)
          data = data.replace('tm:object_type="T"', 'tm:object_type="R"');
        if (r.path === base + b.parent) {
          if (fault === 'date') data = data.replace('20261105 014315', '20261106 014315');
          if (fault === 'locked') data = data.replace('tm:lock_status=""', 'tm:lock_status="X"');
          if (fault === 'foreign') data = data.replace('014315 MARIAN', '014315 OTHER');
          if (fault === 'extra-comment')
            data = data.replace(
              '<tm:all_objects>',
              data.match(/<tm:abap_object[^>]*tm:pgmid="CORR"[\s\S]*?<\/tm:abap_object>/)![0] + '<tm:all_objects>',
            );
          if (fault === 'parent-position') data = data.replace('tm:position="000002"', 'tm:position="000003"');
          if (fault === 'late-regression' && selected) data = data.replaceAll('tm:status="R"', 'tm:status="D"');
        }
      }
      return { ...out, data };
    };
    const b = await h.run('B', a, { profile: 'retained-v5', freshUntil: Date.now() + 4000 });
    expect(b.failure).toBe(true);
    const own = b.requests[1]!;
    expect(h.calls.filter((x) => x.method === 'POST' && x.path === base + own.parent + '/newreleasejobs')).toEqual([]);
    expect(b.inspectionRequired).toContain(own.parent);
    h.assertSafe();
  },
  10000,
);
it.each([false, true])('actual semaphore queue cannot send after bound source change, proxy=%s', async (proxy) => {
  const { Semaphore } = await import('../../../src/adt/semaphore.js');
  const sem = new Semaphore(1);
  let armed = false,
    queued = false;
  const h = retainedV5Harness({ proxy, semaphore: sem });
  h.hooks.record = (r) => {
    if (!armed && r.stage === 'request' && r.method === 'POST') {
      armed = true;
      void sem.acquire();
      setImmediate(() => {
        queued = sem.waiting > 0;
        h.breakSource();
        sem.release();
      });
    }
  };
  const r = await h.runV5({ freshUntil: Date.now() + 1500 });
  expect(armed && queued).toBe(true);
  expect(r.failure).toBe(true);
  expect(mutations(h)).toEqual([]);
  expect(sem.inflight).toBe(0);
  h.assertSafe();
});
it.each([200, 404, 503])('final class %i remains inspection-required alongside old deletion', async (statusCode) => {
  const h = retainedV5Harness();
  let terminal = false;
  h.hooks.record = (r) => {
    if (r.completedStep === 'release-parent') terminal = true;
  };
  h.hooks.reply = (r) =>
    terminal && r.path === h.graph.classes[0].owner
      ? { statusCode, data: statusCode === 200 ? h.metadata(r.path) : 'unqualified' }
      : h.reply(r);
  const r = await h.runV5();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toContain(h.graph.classes[0].owner);
  expect(r.remaining).toContain(h.graph.classes[0].owner);
  expect(r.inspectionRequired).toContain(h.graph.classes[0].owner);
  expect(r.confirmedReleased).toEqual(['A4HK906608', 'A4HK906607']);
  h.assertSafe();
});
it.each(['missing', 'foreign', 'duplicate'] as const)(
  'B refuses %s inherited release proof before any native request',
  async (fault) => {
    const h = retainedV5Harness(),
      a = await h.runV5();
    expect(a.failure).toBe(false);
    const before = h.calls.length;
    if (fault === 'missing') delete a.releaseWitnesses;
    if (fault === 'foreign') a.releaseWitnesses![0].task = 'A4HK906606';
    if (fault === 'duplicate') a.releaseWitnesses!.push(a.releaseWitnesses![0]);
    await expect(h.run('B', a, { profile: 'retained-v5' })).rejects.toThrow();
    expect(h.calls).toHaveLength(before);
    h.assertSafe();
  },
);
it.each([false, true])('final synchronous proof cannot cross the actual send deadline, proxy=%s', async (proxy) => {
  const { vi } = await import('vitest');
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    let intent = false,
      ran = false;
    const h = retainedV5Harness({
      proxy,
      token: async () => {
        await Promise.resolve();
        if (intent)
          h.hooks.verify = () => {
            ran = true;
            vi.setSystemTime(Date.now() + 300001);
          };
        return 'synthetic-token';
      },
    });
    h.hooks.record = (r) => {
      if (r.stage === 'request' && r.method === 'POST') intent = true;
    };
    const out = await h.runV5({ freshUntil: Date.now() + 1500 });
    expect(intent && ran).toBe(true);
    expect(out.failure).toBe(true);
    expect(mutations(h)).toEqual([]);
    h.assertSafe();
  } finally {
    vi.useRealTimers();
  }
});
it.each([false, true])('late stop retains adopted608 without sending607, proxy=%s', async (proxy) => {
  let intent = false;
  const h = retainedV5Harness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (intent) h.stop();
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST') intent = true;
  };
  const out = await h.runV5({ freshUntil: Date.now() + 1500 });
  expect(out.failure).toBe(true);
  expect(out.confirmedReleased).toContain('A4HK906608');
  expect(mutations(h)).toEqual([]);
  h.assertSafe();
});
it.each([
  [false, '014714', false],
  [false, '014715', true],
  [true, '014714', false],
  [true, '014715', true],
] as const)(
  'frozen native second budget through proxy=%s timestamp=%s refuses=%s',
  async (proxy, clock, refused) => {
    const h = retainedV5Harness({ proxy }),
      a = await h.runV5();
    expect(a.failure).toBe(false);
    h.hooks.reply = (r) => {
      const out = h.reply(r),
        b = [...h.trees.values()].find((t) => t.description === h.graph.descriptions.B);
      if (
        !out ||
        !b ||
        r.method !== 'GET' ||
        b.taskStatus !== 'R' ||
        ![base + b.parent, base + b.task].includes(r.path)
      )
        return out;
      return {
        ...out,
        data: out.data
          .replaceAll('20261105014315', '20261105' + clock)
          .replaceAll('20261105 014315', '20261105 ' + clock)
          .replaceAll('20261105%20014315', '20261105%20' + clock),
      };
    };
    const result = await h.run('B', a, { profile: 'retained-v5' });
    expect(result.failure).toBe(refused);
    const b = result.requests.find((x) => x.round === 'B')!;
    expect(h.calls.filter((r) => r.method === 'POST' && r.path === base + b.parent + '/newreleasejobs')).toHaveLength(
      refused ? 0 : 1,
    );
    h.assertSafe();
  },
  30000,
);
it.each([false, true])(
  'first contradictory task witness is terminal even if later data would be good, proxy=%s',
  async (proxy) => {
    const h = retainedV5Harness({ proxy }),
      a = await h.runV5();
    let bad = 0;
    h.hooks.reply = (r) => {
      const out = h.reply(r),
        b = [...h.trees.values()].find((t) => t.description === h.graph.descriptions.B);
      if (out && b && r.method === 'GET' && r.path === base + b.task && b.taskStatus === 'R' && bad === 0) {
        bad++;
        return { ...out, data: out.data.replaceAll('20261105014315', '20260229014315') };
      }
      return out;
    };
    const result = await h.run('B', a, { profile: 'retained-v5' }),
      b = result.requests.find((x) => x.round === 'B')!;
    expect(bad).toBe(1);
    expect(result.failure).toBe(true);
    expect(result.releaseProofRefusal?.reason).toContain('calendar');
    expect(result.cleanupUnconfirmed).toBe(false);
    expect(
      h.calls.filter((r) => r.path.startsWith(h.graph.classes[1].owner) && r.path.includes('_action=UNLOCK')).length,
    ).toBeGreaterThan(0);
    expect(result.inspectionRequired).toEqual(expect.arrayContaining([b.parent, b.task]));
    expect(result.current[b.task]).toBe('unknown');
    expect(result.confirmedReleased).toContain('A4HK906608');
    expect(h.records.filter((r) => r.releaseProofRefusal)).toHaveLength(1);
    expect(h.calls.filter((r) => r.method === 'POST' && r.path === base + b.parent + '/newreleasejobs')).toEqual([]);
    h.assertSafe();
  },
);
it.each([false, true])('v5 cancellation still intersects the inherited caller signal, proxy=%s', async (proxy) => {
  const { requestContext } = await import('../../../src/server/context.js');
  const controller = new AbortController();
  let intent = false;
  const h = retainedV5Harness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (intent) controller.abort();
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST') intent = true;
  };
  const result = await requestContext.run({ requestId: 'v5-inherited-cancel', signal: controller.signal }, () =>
    h.runV5(),
  );
  expect(intent).toBe(true);
  expect(result.failure).toBe(true);
  expect(result.adoptedReleased).toEqual(['A4HK906608']);
  expect(mutations(h)).toEqual([]);
  h.assertSafe();
});

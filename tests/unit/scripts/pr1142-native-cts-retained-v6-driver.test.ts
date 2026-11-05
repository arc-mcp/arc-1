import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { inspectCtsTree } from '../../../scripts/qualification/pr1142/native-cts-evidence.js';
import { CTS_BASE, ctsSteps, retainedCtsRequest } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { CtsReleaseBookkeeping } from '../../../scripts/qualification/pr1142/native-cts-release-bookkeeping.js';
import { checkCtsRequest } from '../../../scripts/qualification/pr1142/native-cts-transport.js';
import { retainedV5Harness, v5Bodies } from './pr1142-native-cts-retained-v5-harness.js';
import { retainedV6Harness, v6Bodies } from './pr1142-native-cts-retained-v6-harness.js';

const mutations = (h: ReturnType<typeof retainedV6Harness>) =>
  h.calls.filter((r) => !['GET', 'HEAD'].includes(r.method));
const comment = /<tm:abap_object[^>]*tm:pgmid="CORR"[^>]*(?:\/>|>[\s\S]*?<\/tm:abap_object>)/;
function proof(xml: string, v6 = true) {
  const h = retainedV6Harness(),
    own = retainedCtsRequest('retained-v6');
  const p = new CtsReleaseBookkeeping(h.graph, [], [], v6 ? 'native-parent-state' : 'modifiable-parent');
  try {
    const tree = inspectCtsTree(xml, own.parent);
    p.observe(xml, CTS_BASE + own.parent, tree, own);
    p.assertTree(tree, own);
  } finally {
    h.assertSafe();
  }
}
it('reproduces actual v5 native failure and accepts finite D/R forms only under v6', () => {
  expect(() => proof(v6Bodies.parent, false)).toThrow('Unproven native release comment');
  expect(() => proof(v5Bodies.parent)).not.toThrow();
  expect(() => proof(v6Bodies.parent)).not.toThrow();
});
it.each([
  ['D with zero links', v6Bodies.parent.replace('tm:status="R"', 'tm:status="D"')],
  ['R with three links', v5Bodies.parent.replace('tm:status="D"', 'tm:status="R"')],
  ['N with zero links', v6Bodies.parent.replace('tm:status="R"', 'tm:status="N"')],
  [
    'partial links',
    v5Bodies.parent.replace(/<atom:link[^>]*rel="http:\/\/www.sap.com\/cts\/relations\/lockobject"[^>]*\/>/, ''),
  ],
  ['foreign comment', v6Bodies.parent.replace('014315 MARIAN', '014315 OTHER')],
  [
    'extra comment',
    v6Bodies.parent.replace('<tm:all_objects>', v6Bodies.parent.match(comment)![0] + '<tm:all_objects>'),
  ],
  ['locked', v6Bodies.parent.replace('tm:lock_status=""', 'tm:lock_status="X"')],
  ['unknown child', v6Bodies.parent.replace(comment, (s) => s.replace('/>', '><tm:extra/></tm:abap_object>'))],
  [
    'foreign link',
    v6Bodies.parent.replace(comment, (s) => s.replace('/>', '><atom:link href="/foreign"/></tm:abap_object>')),
  ],
  ['missing comment', v6Bodies.parent.replace(comment, '')],
  ['position', v6Bodies.parent.replace(comment, (c) => c.replace('tm:position="000001"', 'tm:position="000003"'))],
] as const)('refuses %s', (_name, body) => expect(() => proof(body)).toThrow());
it.each([false, true])(
  'actual read-only A adoption and B/C through proxy=%s',
  async (proxy) => {
    const h = retainedV6Harness({ proxy });
    const a = await h.runV6();
    expect(a).toMatchObject({
      failure: false,
      completed: ['adopt-released-a'],
      adoptedReleased: ['A4HK906607', 'A4HK906608'],
      remaining: [],
      inspectionRequired: [],
      dispatchedMutations: 0,
    });
    expect(a.confirmedReleased).toEqual(['A4HK906607', 'A4HK906608']);
    expect(mutations(h)).toEqual([]);
    let prior = a;
    for (const round of ['B', 'C'] as const) {
      prior = await h.run(round, prior, { profile: 'retained-v6' });
      expect(prior).toMatchObject({
        failure: false,
        completed: ctsSteps(round, 'retained-v6'),
        remaining: [],
        inspectionRequired: [],
      });
    }
    expect(mutations(h).filter((r) => r.path.includes('A4HK906607') || r.path.includes('A4HK906608'))).toEqual([]);
    h.assertSafe();
  },
  30000,
);
it.each([false, true])('GET-only A preflight via proxy=%s', async (proxy) => {
  const h = retainedV6Harness({ proxy }),
    r = await h.runV6({ preflight: true });
  expect(r).toMatchObject({
    failure: false,
    completed: [],
    adoptedReleased: ['A4HK906607', 'A4HK906608'],
    remaining: [],
  });
  expect(mutations(h)).toEqual([]);
  h.assertSafe();
});
it.each(['POST', 'PUT', 'DELETE'])('literal A adoption rejects %s including either release', (method) => {
  const h = retainedV6Harness(),
    own = retainedCtsRequest('retained-v6');
  for (const id of [own.parent, own.task])
    expect(() =>
      checkCtsRequest(
        h.graph,
        { round: 'A', step: 'adopt-released-a', requests: [own] },
        method,
        CTS_BASE + id + '/newreleasejobs',
      ),
    ).toThrow();
  h.assertSafe();
});
it.each(['parent', 'task', 'class', 'inventory'] as const)(
  'fresh %s drift refuses A without mutation',
  async (fault) => {
    const h = retainedV6Harness();
    h.hooks.reply = (r) => {
      const out = h.reply(r);
      if (
        out &&
        r.path.endsWith(fault === 'parent' ? 'A4HK906607' : 'A4HK906608') &&
        ['parent', 'task'].includes(fault)
      )
        return { ...out, data: out.data.replace('MARIAN', 'OTHER') };
      if (fault === 'class' && r.path === h.graph.classes[1].owner)
        return { statusCode: 200, data: h.metadata(r.path) };
      if (fault === 'inventory' && r.path === '/sap/bc/adt/activation/inactiveobjects')
        return { statusCode: 200, data: '<unqualified/>' };
      return out;
    };
    const r = await h.runV6();
    expect(r.failure).toBe(true);
    expect(mutations(h)).toEqual([]);
    expect(r.inspectionRequired.length > 0 || fault === 'inventory').toBe(true);
    h.assertSafe();
  },
);
it.each([200, 404, 503])('terminal class %i retains observed uncertainty after adoption', async (statusCode) => {
  const h = retainedV6Harness();
  let terminal = false;
  h.hooks.record = (r) => {
    if (r.completedStep === 'adopt-released-a') terminal = true;
  };
  h.hooks.reply = (r) =>
    terminal && r.path === h.graph.classes[0].owner
      ? { statusCode, data: statusCode === 200 ? h.metadata(r.path) : 'unknown' }
      : h.reply(r);
  const r = await h.runV6();
  expect(r.failure).toBe(true);
  expect(r.confirmedReleased).toEqual(['A4HK906607', 'A4HK906608']);
  expect(r.remaining).toContain(h.graph.classes[0].owner);
  expect(mutations(h)).toEqual([]);
  h.assertSafe();
});
it.each([false, true])('late native auth source change refuses read-only A, proxy=%s', async (proxy) => {
  let armed = false;
  const h = retainedV6Harness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (armed) h.breakSource();
      return 'synthetic';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.path === CTS_BASE + 'A4HK906607') armed = true;
  };
  const r = await h.runV6();
  expect(armed).toBe(true);
  expect(r.failure).toBe(true);
  expect(mutations(h)).toEqual([]);
  h.assertSafe();
});
it.each([false, true])('final binding drift retains adoption with inspection, proxy=%s', async (proxy) => {
  const h = retainedV6Harness({ proxy });
  h.hooks.record = (r) => {
    if (r.completedStep === 'adopt-released-a') h.breakSource();
  };
  const r = await h.runV6();
  expect(r.failure).toBe(true);
  expect(r.confirmedReleased).toEqual(['A4HK906607', 'A4HK906608']);
  expect(r.inspectionRequired).toContain('A4HK906607');
  expect(mutations(h)).toEqual([]);
  h.assertSafe();
});
it.each([false, true])('B first contradiction stays latched despite later good view, proxy=%s', async (proxy) => {
  const h = retainedV6Harness({ proxy }),
    a = await h.runV6();
  let bad = 0;
  h.hooks.reply = (r) => {
    const out = h.reply(r),
      b = [...h.trees.values()].find((t) => t.description === h.graph.descriptions.B);
    if (out && b && r.method === 'GET' && r.path === CTS_BASE + b.task && b.taskStatus === 'R' && !bad++) {
      return { ...out, data: out.data.replaceAll('20261105014315', '20260229014315') };
    }
    return out;
  };
  const b = await h.run('B', a, { profile: 'retained-v6' });
  expect(b.failure).toBe(true);
  expect(b.releaseProofRefusal?.reason).toContain('calendar');
  expect(h.records.filter((r) => r.releaseProofRefusal)).toHaveLength(1);
  expect(mutations(h).filter((r) => r.path === CTS_BASE + b.requests[1].parent + '/newreleasejobs')).toEqual([]);
  expect(b.cleanupUnconfirmed).toBe(false);
  h.assertSafe();
});
it.each([
  [false, '014714', false],
  [false, '014715', true],
  [true, '014714', false],
  [true, '014715', true],
] as const)(
  'B bound seconds proxy=%s clock=%s refuse=%s',
  async (proxy, clock, refused) => {
    const h = retainedV6Harness({ proxy }),
      a = await h.runV6();
    h.hooks.reply = (r) => {
      const out = h.reply(r),
        b = [...h.trees.values()].find((t) => t.description === h.graph.descriptions.B);
      if (
        !out ||
        !b ||
        r.method !== 'GET' ||
        b.taskStatus !== 'R' ||
        ![CTS_BASE + b.parent, CTS_BASE + b.task].includes(r.path)
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
    const b = await h.run('B', a, { profile: 'retained-v6' });
    expect(b.failure).toBe(refused);
    expect(mutations(h).filter((r) => r.path === CTS_BASE + b.requests[1].parent + '/newreleasejobs')).toHaveLength(
      refused ? 0 : 1,
    );
    h.assertSafe();
  },
  30000,
);

it.each([false, true])('actual B create semaphore wait revalidates source, proxy=%s', async (proxy) => {
  const { Semaphore } = await import('../../../src/adt/semaphore.js');
  const sem = new Semaphore(1);
  const h = retainedV6Harness({ proxy, semaphore: sem }),
    a = await h.runV6();
  let armed = false,
    queued = false;
  h.hooks.record = (r) => {
    if (!armed && r.stage === 'request' && r.method === 'POST' && r.path === '/sap/bc/adt/cts/transports') {
      armed = true;
      void sem.acquire();
      setImmediate(() => {
        queued = sem.waiting > 0;
        h.breakSource();
        sem.release();
      });
    }
  };
  const b = await h.run('B', a, { profile: 'retained-v6', freshUntil: Date.now() + 1500 });
  expect(armed && queued).toBe(true);
  expect(b.failure).toBe(true);
  expect(mutations(h)).toEqual([]);
  expect(b.unknownCreation).toBe(false);
  expect(b.cleanupUnconfirmed).toBe(false);
  expect(sem.inflight).toBe(0);
  h.assertSafe();
});
it.each([false, true])('actual B parent final proof cannot outlive deadline, proxy=%s', async (proxy) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    let armed = false,
      ran = false;
    const h = retainedV6Harness({
        proxy,
        token: async () => {
          await Promise.resolve();
          if (armed)
            h.hooks.verify = () => {
              ran = true;
              vi.setSystemTime(Date.now() + 300001);
            };
          return 'synthetic';
        },
      }),
      a = await h.runV6();
    h.hooks.record = (r) => {
      const b = [...h.trees.values()].find((t) => t.description === h.graph.descriptions.B);
      if (b && r.stage === 'request' && r.method === 'POST' && r.path === CTS_BASE + b.parent + '/newreleasejobs')
        armed = true;
    };
    const b = await h.run('B', a, { profile: 'retained-v6' });
    expect(armed && ran).toBe(true);
    expect(b.failure).toBe(true);
    expect(mutations(h).filter((r) => r.path === CTS_BASE + b.requests[1].parent + '/newreleasejobs')).toEqual([]);
    h.assertSafe();
  } finally {
    vi.useRealTimers();
  }
});
it('selected-task projection cannot become the full-parent proof', () => {
  const h = retainedV6Harness(),
    own = retainedCtsRequest('retained-v6'),
    p = new CtsReleaseBookkeeping(h.graph, [], [], 'native-parent-state');
  const tree = inspectCtsTree(v6Bodies.task, own.parent);
  p.observe(v6Bodies.task, CTS_BASE + own.task, tree, own);
  expect(() => p.observe(v6Bodies.task, CTS_BASE + own.parent, tree, own)).toThrow();
  h.assertSafe();
});

it.each([false, true])(
  'actual captured v5 parent report/readback preserves the consumed failure, proxy=%s',
  async (proxy) => {
    const h = retainedV5Harness({ proxy });
    const report = readFileSync(
      new URL('../../fixtures/qualification/cts-retained-v6/parent-release.xml', import.meta.url),
      'utf8',
    );
    h.hooks.reply = (r) => {
      if (r.method === 'POST' && r.path === CTS_BASE + 'A4HK906607/newreleasejobs')
        return { statusCode: 200, data: report };
      if (r.method === 'GET' && r.path === CTS_BASE + 'A4HK906607' && h.trees.get('A4HK906607')!.parentStatus === 'R')
        return { statusCode: 200, data: v6Bodies.parent };
      return h.reply(r);
    };
    const r = await h.runV5();
    expect(r).toMatchObject({
      failure: true,
      completed: [],
      dispatchedMutations: 1,
      adoptedReleased: ['A4HK906608'],
      releaseProofRefusal: { reason: 'Unproven native release comment.' },
    });
    expect(r.confirmedReleased).toEqual(['A4HK906608']);
    expect(h.calls.filter((x) => x.method === 'POST' && x.path.endsWith('newreleasejobs'))).toHaveLength(1);
    h.assertSafe();
  },
);

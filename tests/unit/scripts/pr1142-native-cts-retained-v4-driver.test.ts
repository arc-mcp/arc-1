import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { retainedV4Harness } from './pr1142-native-cts-retained-v4-harness.js';

const base = '/sap/bc/adt/cts/transportrequests/';
const posts = (h: ReturnType<typeof retainedV4Harness>) => h.calls.filter((r) => !['HEAD', 'GET'].includes(r.method));
it.each([false, true])('adopts actual deleted-record views and sends only608→607 releases, proxy=%s', async (proxy) => {
  const h = retainedV4Harness({ proxy }),
    r = await h.runV4();
  expect(r).toMatchObject({
    failure: false,
    completed: ['release-task', 'release-parent'],
    remaining: [],
    inspectionRequired: [],
    cleanupUnconfirmed: false,
    unknownCreation: false,
  });
  expect(r.confirmedDeleted).toEqual([h.graph.classes[0].owner]);
  expect(r.confirmedReleased).toEqual(['A4HK906608', 'A4HK906607']);
  expect(posts(h).map((r) => [r.method, r.path])).toEqual([
    ['POST', base + 'A4HK906608/newreleasejobs'],
    ['POST', base + 'A4HK906607/newreleasejobs'],
  ]);
  h.assertSafe();
});
it('GET-only preflight retains the nonempty pair but confirms current class absence', async () => {
  const h = retainedV4Harness(),
    r = await h.runV4({ preflight: true });
  expect(r).toMatchObject({
    failure: false,
    completed: [],
    inspectionRequired: [],
    current: { [h.graph.classes[0].owner]: 'absent', A4HK906607: 'modifiable', A4HK906608: 'modifiable' },
  });
  expect(r.remaining).toEqual(['A4HK906607', 'A4HK906608']);
  expect(posts(h)).toEqual([]);
  h.assertSafe();
});
it.each([
  'parent',
  'task',
  'target',
  'description',
  'position',
  'row',
  'foreign-row',
  'unknown-row',
  'missing-class',
  'untyped404',
  'unavailable',
] as const)('refuses initial %s counter-evidence without mutation', async (fault) => {
  const h = retainedV4Harness();
  h.hooks.reply = (r) => {
    const out = h.reply(r);
    if (r.path === h.graph.classes[0].owner) {
      if (fault === 'missing-class') return { statusCode: 200, data: h.metadata(r.path) };
      if (fault === 'untyped404') return { statusCode: 404, data: 'missing' };
      if (fault === 'unavailable') return { statusCode: 503, data: 'unavailable' };
    }
    if (!out || !r.path.startsWith(base)) return out;
    let data = out.data;
    if (fault === 'parent') data = data.replaceAll('tm:owner="MARIAN"', 'tm:owner="OTHER"');
    if (fault === 'task') data = data.replaceAll('Development/Correction', 'Unclassified');
    if (fault === 'target') data = data.replaceAll('tm:target=""', 'tm:target="FOREIGN"');
    if (fault === 'description') data = data.replace('ARC1 CTS A', 'Changed CTS A');
    if (fault === 'position') data = data.replaceAll('000001', '000002');
    if (fault === 'row') data = data.replaceAll('R3TR', 'LIMU');
    if (fault === 'foreign-row') data = data.replaceAll(h.graph.classes[0].name, 'ZFOREIGN');
    if (fault === 'unknown-row') data = data.replace('</tm:root>', '<tm:unknown/></tm:root>');
    return { ...out, data };
  };
  const r = await h.runV4();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toContain(h.graph.classes[0].owner);
  expect(r.inspectionRequired.length).toBeGreaterThan(0);
  expect(posts(h)).toEqual([]);
  h.assertSafe();
});
it.each([false, true])(
  'rechecks class immediately before each release and preserves contradictory residual, proxy=%s',
  async (proxy) => {
    const h = retainedV4Harness({ proxy });
    h.hooks.record = (r) => {
      if (r.completedStep === 'release-task') h.classes.get(h.graph.classes[0].owner)!.exists = true;
    };
    const r = await h.runV4();
    expect(r.failure).toBe(true);
    expect(r.completed).toEqual(['release-task']);
    expect(r.confirmedReleased).toEqual(['A4HK906608']);
    expect(r.confirmedDeleted).toContain(h.graph.classes[0].owner);
    expect(r.remaining).toContain(h.graph.classes[0].owner);
    expect(r.inspectionRequired).toContain(h.graph.classes[0].owner);
    expect(posts(h)).toHaveLength(1);
    h.assertSafe();
  },
);
it.each(
  [false, true].flatMap((proxy) =>
    ['source', 'history', 'stop', 'policy', 'expiry'].map((fault) => ({ proxy, fault })),
  ),
)('late token wait blocks $fault drift on proxy=$proxy', async ({ proxy, fault }) => {
  if (fault === 'expiry') vi.useFakeTimers({ toFake: ['Date'] });
  let intent = false;
  try {
    const h = retainedV4Harness({
      proxy,
      token: async () => {
        await Promise.resolve();
        if (intent) {
          if (fault === 'source') h.breakSource();
          if (fault === 'history')
            h.hooks.verify = () => {
              throw Error('history drift');
            };
          if (fault === 'stop') h.stop();
          if (fault === 'policy') h.client.safety.allowTransportWrites = false;
          if (fault === 'expiry') vi.setSystemTime(Date.now() + 300001);
        }
        return 'synthetic-token';
      },
    });
    h.hooks.record = (r) => {
      if (r.stage === 'request' && r.method === 'POST') intent = true;
    };
    // The shared release convergence may poll locally until its original deadline after a refused start.
    const r = await h.runV4({ freshUntil: Date.now() + 1500 });
    expect(intent).toBe(true);
    expect(r.failure).toBe(true);
    expect(posts(h)).toEqual([]);
    h.assertSafe();
  } finally {
    vi.useRealTimers();
  }
});
it.each([false, true])('keeps physical release facts but fails terminal source drift, proxy=%s', async (proxy) => {
  const h = retainedV4Harness({ proxy });
  h.hooks.record = (r) => {
    if (r.completedStep === 'release-parent') h.breakSource();
  };
  const r = await h.runV4();
  expect(r.failure).toBe(true);
  expect(r.confirmedReleased).toEqual(['A4HK906608', 'A4HK906607']);
  expect(r.confirmedDeleted).toContain(h.graph.classes[0].owner);
  expect(r.inspectionRequired).toEqual(expect.arrayContaining(['A4HK906607', 'A4HK906608']));
  expect(posts(h)).toHaveLength(2);
  h.assertSafe();
});
it.each([200, 404, 503])('later class state %i never disappears behind historical deletion', async (statusCode) => {
  const h = retainedV4Harness();
  let done = false;
  h.hooks.record = (r) => {
    if (r.completedStep === 'release-parent') done = true;
  };
  h.hooks.reply = (r) =>
    done && r.path === h.graph.classes[0].owner
      ? { statusCode, data: statusCode === 200 ? h.metadata(r.path) : 'uncertain' }
      : h.reply(r);
  const r = await h.runV4();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toContain(h.graph.classes[0].owner);
  expect(r.remaining).toContain(h.graph.classes[0].owner);
  expect(r.inspectionRequired).toContain(h.graph.classes[0].owner);
  h.assertSafe();
});
it.each(['valid', 'selected', 'partial', 'foreign'] as const)(
  'uses complete rich %s inventory before release',
  async (fault) => {
    const h = retainedV4Harness();
    let data = readFileSync(
      new URL('../../fixtures/xml/inactive-cts-native-shapes-a4h-758.xml', import.meta.url),
      'utf8',
    );
    if (fault === 'selected') data = data.replaceAll('DEVK900004', 'A4HK906608');
    if (fault === 'partial') data = data.replace('<ioc:inactiveObjects ', '<ioc:inactiveObjects ioc:hasMore="true" ');
    if (fault === 'foreign') data = data.replace('http://www.sap.com/abapxml/inactiveCtsObjects', 'urn:foreign');
    h.hooks.reply = (r) =>
      r.path === '/sap/bc/adt/activation/inactiveobjects' ? { statusCode: 200, data } : h.reply(r);
    const r = await h.runV4();
    expect(r.failure).toBe(fault !== 'valid');
    expect(posts(h)).toHaveLength(fault === 'valid' ? 2 : 0);
    h.assertSafe();
  },
);
it.each([false, true])('revalidates after a real semaphore wait, proxy=%s', async (proxy) => {
  const { Semaphore } = await import('../../../src/adt/semaphore.js');
  const semaphore = new Semaphore(1);
  let armed = false,
    queued = false;
  const h = retainedV4Harness({ proxy, semaphore });
  h.hooks.record = (r) => {
    if (!armed && r.stage === 'request' && r.method === 'POST') {
      armed = true;
      void semaphore.acquire();
      setImmediate(() => {
        queued = semaphore.waiting > 0;
        h.breakSource();
        semaphore.release();
      });
    }
  };
  const r = await h.runV4({ freshUntil: Date.now() + 1500 });
  expect(armed && queued).toBe(true);
  expect(r.failure).toBe(true);
  expect(posts(h)).toEqual([]);
  expect(semaphore.inflight).toBe(0);
  h.assertSafe();
});
it.each([false, true])(
  'synchronous final proof cannot cross the effective dispatch deadline, proxy=%s',
  async (proxy) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let intent = false,
        proof = false;
      const h = retainedV4Harness({
        proxy,
        token: async () => {
          await Promise.resolve();
          if (intent)
            h.hooks.verify = () => {
              proof = true;
              vi.setSystemTime(Date.now() + 300001);
            };
          return 'synthetic-token';
        },
      });
      h.hooks.record = (r) => {
        if (r.stage === 'request' && r.method === 'POST') intent = true;
      };
      const r = await h.runV4({ freshUntil: Date.now() + 1500 });
      expect(intent && proof).toBe(true);
      expect(r.failure).toBe(true);
      expect(posts(h)).toEqual([]);
      h.assertSafe();
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each([false, true])(
  'an uncertain acknowledged release is never replayed or reported complete, proxy=%s',
  async (proxy) => {
    const h = retainedV4Harness({ proxy });
    h.hooks.reply = (r) => (r.method === 'POST' ? { statusCode: 500, data: 'unknown outcome' } : h.reply(r));
    const r = await h.runV4({ freshUntil: Date.now() + 1500 });
    expect(r.failure).toBe(true);
    expect(r.completed).toEqual([]);
    expect(r.confirmedReleased).toEqual([]);
    expect(r.remaining).toEqual(expect.arrayContaining(['A4HK906607', 'A4HK906608']));
    expect(posts(h)).toHaveLength(1);
    h.assertSafe();
  },
);

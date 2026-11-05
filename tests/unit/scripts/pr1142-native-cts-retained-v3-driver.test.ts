import { expect, it } from 'vitest';
import { ctsSteps } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { CTS_RETAINED_V3_VIEWS } from '../../../scripts/qualification/pr1142/native-cts-retained-v3-evidence.js';
import { retainedV3Harness } from './pr1142-native-cts-retained-v3-harness.js';

it.each([false, true])(
  'adopts actual partial native views and completes only remaining A via direct/proxy=%s',
  async (proxy) => {
    const h = retainedV3Harness({ proxy }),
      r = await h.runV3();
    expect(r).toMatchObject({
      failure: false,
      completed: ctsSteps('A', 'retained-v3'),
      remaining: [],
      inspectionRequired: [],
      unknownCreation: false,
      cleanupUnconfirmed: false,
    });
    expect(
      h.calls.filter(
        (c) =>
          c.method === 'POST' &&
          (c.path === '/sap/bc/adt/cts/transports' || c.path.startsWith('/sap/bc/adt/oo/classes?')),
      ),
    ).toEqual([]);
    expect(h.calls.filter((c) => c.method === 'PUT' && !c.path.includes('/source/main'))).toHaveLength(1); // Remaining remove_object only.
    expect(h.calls.filter((c) => c.method === 'PUT' && c.path.includes('/source/main'))).toHaveLength(1);
    h.assertSafe();
  },
  120000,
);
it('preflight proves retained owner without a write or empty-class claim', async () => {
  const h = retainedV3Harness(),
    r = await h.runV3({ preflight: true });
  expect(r).toMatchObject({ failure: false, completed: [], dispatchedMutations: 0, inspectionRequired: [] });
  expect(r.remaining).toContain(h.graph.classes[0].owner);
  expect(h.calls.every((c) => ['HEAD', 'GET'].includes(c.method))).toBe(true);
  h.assertSafe();
});
it.each(CTS_RETAINED_V3_VIEWS.map(([path]) => path))(
  'refuses changed initial view %s before mutation',
  async (path) => {
    const h = retainedV3Harness();
    h.hooks.reply = (r) =>
      r.method === 'GET' && r.path === h.graph.classes[0].owner + path
        ? { statusCode: 200, data: 'changed' }
        : h.reply(r);
    const out = await h.runV3();
    expect(out.failure).toBe(true);
    expect(out.remaining).toContain(h.graph.classes[0].owner);
    expect(out.inspectionRequired).toContain(h.graph.classes[0].owner);
    expect(h.calls.filter((c) => !['HEAD', 'GET'].includes(c.method))).toEqual([]);
    h.assertSafe();
  },
);
it.each([false, true])('rechecks class receipts under own lock before first PUT on proxy=%s', async (proxy) => {
  const h = retainedV3Harness({ proxy });
  let locked = false;
  h.hooks.before = (r) => {
    h.initial(r);
    if (r.path.includes('_action=LOCK')) locked = true;
  };
  h.hooks.reply = (r) =>
    locked && r.method === 'GET' && r.path === h.graph.classes[0].owner + '?version=active'
      ? { statusCode: 200, data: 'changed active counterpart' }
      : h.reply(r);
  const r = await h.runV3();
  expect(r.failure).toBe(true);
  expect(r.remaining).toContain(h.graph.classes[0].owner);
  expect(h.calls.filter((c) => c.method === 'PUT')).toEqual([]);
  expect(h.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
  h.assertSafe();
});
it.each([false, true])(
  'final auth boundary still checks old source before the first retained PUT, proxy=%s',
  async (proxy) => {
    let intent = false;
    const h = retainedV3Harness({
      proxy,
      token: async () => {
        await Promise.resolve();
        if (intent) h.breakSource();
        return 'synthetic-token';
      },
    });
    h.hooks.record = (r) => {
      if (r.stage === 'request' && r.method === 'PUT' && r.path.startsWith(h.graph.classes[0].owner + '/source/main'))
        intent = true;
    };
    const out = await h.runV3();
    expect(intent).toBe(true);
    expect(out.failure).toBe(true);
    expect(h.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(out.remaining).toContain(h.graph.classes[0].owner);
    expect(h.calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
    h.assertSafe();
  },
);
it('keeps confirmed deletion historical when the final class read becomes uncertain', async () => {
  const h = retainedV3Harness();
  let released = false;
  h.hooks.record = (r) => {
    if (r.completedStep === 'release-parent') released = true;
  };
  h.hooks.reply = (r) =>
    released && r.path === h.graph.classes[0].owner ? { statusCode: 503, data: 'uncertain' } : h.reply(r);
  const out = await h.runV3();
  expect(out.failure).toBe(true);
  expect(out.confirmedDeleted).toContain(h.graph.classes[0].owner);
  expect(out.remaining).toContain(h.graph.classes[0].owner);
  expect(out.inspectionRequired).toContain(h.graph.classes[0].owner);
  h.assertSafe();
});
it.each([
  'missing',
  'duplicate',
  'foreign-owner',
  'foreign-parent',
  'unknown-child',
  'wrong-transport',
  'extra-owned-name',
] as const)('refuses %s in initial owned inventory before mutation', async (fault) => {
  const h = retainedV3Harness();
  h.hooks.reply = (r) => {
    const out = h.reply(r);
    if (!out || r.path !== '/sap/bc/adt/activation/inactiveobjects') return out;
    let data = out.data;
    if (fault === 'missing') data = data.replace(/<ns0:entry>[\s\S]*?<\/ns0:entry>/, '');
    if (fault === 'duplicate')
      data = data.replace(
        '</ns0:inactiveObjects>',
        data.match(/<ns0:entry>[\s\S]*?<\/ns0:entry>/)![0] + '</ns0:inactiveObjects>',
      );
    if (fault === 'foreign-owner') data = data.replace('ns0:user="MARIAN"', 'ns0:user="OTHER"');
    if (fault === 'foreign-parent')
      data = data.replace(
        'ns1:parentUri="' + h.graph.classes[0].owner + '"',
        'ns1:parentUri="/sap/bc/adt/oo/classes/foreign"',
      );
    if (fault === 'unknown-child') data = data.replace('</ns0:object>', '<ns0:unknown/></ns0:object>');
    if (fault === 'wrong-transport') data = data.replaceAll('A4HK906608', 'A4HK999999');
    if (fault === 'extra-owned-name')
      data = data.replace(
        '</ns0:inactiveObjects>',
        '<ns0:unknown>' + h.graph.suffix + '</ns0:unknown></ns0:inactiveObjects>',
      );
    return { ...out, data };
  };
  const out = await h.runV3();
  expect(out.failure).toBe(true);
  expect(out.remaining).toContain(h.graph.classes[0].owner);
  expect(h.calls.filter((c) => !['HEAD', 'GET'].includes(c.method))).toHaveLength(0);
  h.assertSafe();
});

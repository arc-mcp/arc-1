import { describe, expect, it, vi } from 'vitest';
import {
  CTS_RETAINED_SUFFIX,
  ctsFixtures,
  ctsOrigin,
  ctsSteps,
  retainedCtsRequest,
} from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { CTS_BASE, harness } from './pr1142-native-cts-harness.js';

describe.each(['retained', 'retained-v2'] as const)('fixed %s CTS profile', (profile) => {
  function retained(proxy = false, token?: () => Promise<string>) {
    const h = harness(ctsFixtures(CTS_RETAINED_SUFFIX), { proxy, token }),
      own = retainedCtsRequest();
    h.trees.set(own.parent, {
      parent: own.parent,
      task: own.task,
      description: own.description,
      parentStatus: 'D',
      taskStatus: 'D',
      taskOwner: 'MARIAN',
      taskType: 'Unclassified',
      taskExists: true,
      exists: true,
      objects: [],
    });
    return h;
  }
  it.each([false, true])('fresh retained A skips CREATE and preserves B/C sequences, proxy=%s', async (proxy) => {
    const h = retained(proxy),
      a = await h.run('A', undefined, { profile });
    expect(a).toMatchObject({ failure: false, completed: ctsSteps('A', profile), origin: ctsOrigin(profile)! });
    expect(a.requests[0].parent).toBe(ctsOrigin(profile)!.parent);
    expect(h.calls.some((r) => r.path === '/sap/bc/adt/cts/transports' && r.method === 'POST')).toBe(false);
    expect(h.records.find((r) => r.adoptedFrom)).toMatchObject({ adoptedFrom: ctsOrigin(profile)! });
    const b = await h.run('B', a, { profile }),
      c = await h.run('C', b, { profile });
    expect(b.failure).toBe(false);
    expect(c.failure).toBe(false);
    expect(c.remaining).toEqual([]);
    expect(h.calls.filter((r) => r.method === 'POST' && r.path === '/sap/bc/adt/cts/transports')).toHaveLength(2);
    h.assertSafe();
  });
  it('preflight proves and reports the held empty pair without mutation or false creation completion', async () => {
    const h = retained(),
      r = await h.run('A', undefined, { profile, preflight: true });
    expect(r).toMatchObject({
      failure: false,
      completed: [],
      inspectionRequired: [],
      remaining: ['A4HK906607', 'A4HK906608'],
    });
    expect(h.calls.every((r) => r.method === 'GET')).toBe(true);
    h.assertSafe();
  });
  it.each([
    'owner',
    'task',
    'description',
    'released',
    'missing-task',
    'row',
    'missing-parent',
    'unknown',
    'summary',
  ] as const)('refuses changed retained %s before any mutation', async (fault) => {
    const h = retained(),
      t = h.trees.get('A4HK906607')!;
    if (fault === 'owner') t.taskOwner = 'OTHER';
    if (fault === 'task') t.task = 'A4HK900001';
    if (fault === 'description') t.description = 'OTHER';
    if (fault === 'released') t.parentStatus = 'R';
    if (fault === 'missing-task') t.taskExists = false;
    if (fault === 'missing-parent') t.exists = false;
    if (fault === 'row')
      t.objects.push(
        '<t:abap_object t:pgmid="R3TR" t:type="CLAS" t:name="ZFOREIGN" t:position="000010" t:lock_status="X"/>',
      );
    if (fault === 'unknown')
      h.hooks.reply = (r) => (r.path === CTS_BASE + t.parent ? { statusCode: 403, data: 'Forbidden' } : undefined);
    if (fault === 'summary')
      h.hooks.reply = (r) =>
        r.path === CTS_BASE + t.parent
          ? {
              statusCode: 200,
              data: h
                .xml(t)
                .replace(
                  '</t:request>',
                  '<t:all_objects><t:abap_object t:pgmid="R3TR" t:type="CLAS" t:name="ZFOREIGN"/></t:all_objects></t:request>',
                ),
            }
          : undefined;
    const r = await h.run('A', undefined, { profile });
    expect(r.failure).toBe(true);
    expect(r.completed).toEqual([]);
    expect(r.inspectionRequired).toContain('A4HK906607');
    expect(h.calls.every((r) => r.method === 'GET')).toBe(true);
    h.assertSafe();
  });
  it('does not forget a transient initial contradiction when final reads become empty', async () => {
    const h = retained();
    let once = true;
    h.hooks.reply = (r) => {
      if (once && r.path === `${CTS_BASE}A4HK906607`) {
        once = false;
        return {
          statusCode: 200,
          data: h.xml(h.trees.get('A4HK906607')).replace('t:owner="MARIAN"', 't:owner="OTHER"'),
        };
      }
    };
    const r = await h.run('A', undefined, { profile });
    expect(r.failure).toBe(true);
    expect(r.inspectionRequired).toContain('A4HK906607');
    expect(h.calls.every((r) => r.method === 'GET')).toBe(true);
    h.assertSafe();
  });
  it('refuses a different graph before native reads', async () => {
    const h = harness();
    await expect(h.run('A', undefined, { profile })).rejects.toThrow();
    expect(h.calls).toEqual([]);
  });

  it.each([
    [false, 'source'],
    [true, 'source'],
    [false, 'expiry'],
    [true, 'expiry'],
  ] as const)('checks %s/%s after the real first-PUT authorization await before dispatch', async (proxy, fault) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const end = Date.now() + 5000;
      let armed = false;
      const h = retained(proxy, async () => {
        await Promise.resolve();
        if (armed) {
          if (fault === 'source') h.breakSource();
          else vi.setSystemTime(end + 1);
        }
        return 'synthetic-token';
      });
      const put = h.client.http.put.bind(h.client.http);
      vi.spyOn(h.client.http, 'put').mockImplementation((...args) => {
        armed = true;
        return put(...args);
      });
      const result = await h.run('A', undefined, { profile, freshUntil: end });
      expect(armed).toBe(true);
      expect(result.failure).toBe(true);
      expect(result.completed).toEqual([]);
      expect(result.inspectionRequired).toEqual(expect.arrayContaining(['A4HK906607', 'A4HK906608']));
      expect(h.calls.every((r) => r.method === 'GET' || r.method === 'HEAD')).toBe(true);
      h.assertSafe();
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([false, true])('retains the same pair after native target-user display refusal, proxy=%s', async (proxy) => {
    const h = retained(proxy);
    h.hooks.reply = (r) =>
      r.method === 'PUT' && r.path.includes('targetuser=ARC1_WG_RO')
        ? {
            statusCode: 400,
            data: '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt.tm"/><type id="ADT_TM_COMMON_EXCEPTION"/><message lang="EN">User ARC1_WG_RO is not authorized to display requests</message><properties><entry key="T100KEY-ID">SCTS_ADT_MSG</entry><entry key="T100KEY-NO">009</entry></properties></exc:exception>',
          }
        : undefined;
    const out = await h.run('A', undefined, { profile });
    expect(out).toMatchObject({
      failure: true,
      completed: [],
      dispatchedMutations: 1,
      remaining: ['A4HK906607', 'A4HK906608'],
    });
    expect(h.calls.filter((r) => ['POST', 'PUT', 'DELETE'].includes(r.method))).toHaveLength(1);
    expect(h.calls.find((r) => r.method === 'PUT')?.path).toContain('A4HK906608?targetuser=ARC1_WG_RO');
    expect(h.trees.get('A4HK906607')?.taskOwner).toBe('MARIAN');
    h.assertSafe();
  });
});

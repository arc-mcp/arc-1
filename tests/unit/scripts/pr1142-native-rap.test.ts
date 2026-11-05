import { expect, it, vi } from 'vitest';
import { rapFixtures, rapSettings } from '../../../scripts/qualification/pr1142/native-rap-fixtures.js';
import { checkRapRequest } from '../../../scripts/qualification/pr1142/native-rap-transport.js';
import { fixtures, RAP_STAGES, rapHarness } from './pr1142-native-rap-harness.js';

const { Semaphore } = await import('../../../src/adt/semaphore.js');
it.each([false, true])('composes fixed fresh RAP/pool/batch/publication/owned deletion (proxy=%s)', async (proxy) => {
  const h = rapHarness({ proxy });
  const result = await h.run();
  expect(h.world.unexpected).toEqual([]);
  expect(result).toMatchObject({
    failure: false,
    completed: [...RAP_STAGES],
    remaining: [],
    inspectionRequired: [],
    finalAbsenceConfirmed: true,
  });
  expect(result.confirmedDeleted).toEqual([...fixtures].reverse().map((f) => f.owner));
  expect(h.world.calls.filter((v) => v.method === 'POST' && /\/(?:un)?publishjobs\?/.test(v.path))).toHaveLength(2);
  expect(h.world.calls.filter((v) => v.method === 'DELETE')).toHaveLength(6);
  expect(h.parts.implementations).toMatch(/METHOD approve\./i);
  expect(result).toMatchObject({
    generatedCleanup: 'accepted-unverified',
    recording: 'native-governed-unverified',
    authentication: 'Basic-native-contract-only',
  });
  expect(h.world.calls.some((v) => /RFC|classrun|abapunit|testclasses\/run|G4BA|registry|sql/i.test(v.path))).toBe(
    false,
  );
  expect(h.records.filter((v) => v.ownSessionClosed !== undefined).every((v) => v.ownSessionClosed === true)).toBe(
    true,
  );
});
it('initializes an actually typed-absent own CCIMP under the same class lock', async () => {
  const h = rapHarness();
  delete h.parts.implementations;
  expect(await h.run()).toMatchObject({ failure: false });
  expect(
    h.world.calls.filter(
      (v) => v.method === 'POST' && v.path.startsWith(`${fixtures[2].owner}/includes/implementations?`),
    ),
  ).toHaveLength(1);
});
it.each(['pool-category', 'pool-reference', 'pool-author', 'bdef-source', 'view-marker'] as const)(
  'stops on changed %s before generation and retains actual owners',
  async (fault) => {
    const h = rapHarness();
    h.hooks.record = (v) => {
      if (v.stageStarted !== 'preview-generation') return;
      const pool = h.world.objects.get(fixtures[2].owner)!,
        view = h.world.objects.get(fixtures[1].owner)!;
      if (fault === 'pool-category') pool.metadata = pool.metadata.replace('behaviorPool', 'generalObjectType');
      if (fault === 'pool-reference') pool.metadata = pool.metadata.replaceAll('ZRRP_0123456789AB', 'ZR_FOREIGN');
      if (fault === 'pool-author') pool.metadata = pool.metadata.replace('createdBy="MARIAN"', 'createdBy="FOREIGN"');
      if (fault === 'bdef-source') h.world.objects.get(fixtures[3].owner)!.source += '\n// changed';
      if (fault === 'view-marker') view.metadata = view.metadata.replace(fixtures[1].description, 'foreign marker');
    };
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.confirmedDeleted).toEqual([]);
    expect(r.remaining).toEqual(expect.arrayContaining(fixtures.slice(0, 4).map((v) => v.owner)));
    expect(h.world.calls.some((v) => v.method === 'PUT' && v.path.includes('/includes/'))).toBe(false);
  },
);
it('rechecks the SRVD after adapter pre-reads and before the binding CREATE', async () => {
  const h = rapHarness();
  let armed = false;
  h.hooks.record = (v) => {
    if (v.stageStarted === 'create-binding') armed = true;
  };
  h.hooks.before = (u, r) => {
    if (armed && r.method === 'POST' && u.pathname.endsWith('/transportchecks'))
      h.world.objects.get(fixtures[4].owner)!.metadata = h.world.objects
        .get(fixtures[4].owner)!
        .metadata.replace(fixtures[4].description, 'foreign service');
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stoppedAt: 'create-binding' });
  expect(h.world.calls.some((v) => v.method === 'POST' && v.path === '/sap/bc/adt/businessservices/bindings')).toBe(
    false,
  );
});
it.each([false, true].flatMap((proxy) => (['source', 'stop', 'expiry'] as const).map((fault) => ({ proxy, fault }))))(
  'actual auth wait refuses $fault before generated PUT and still owns cleanup (proxy=$proxy)',
  async ({ proxy, fault }) => {
    let armed = false,
      entered!: () => void,
      release!: () => void;
    const waiting = new Promise<void>((r) => {
        entered = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const h = rapHarness({
      proxy,
      token: async () => {
        if (armed) {
          armed = false;
          entered();
          await gate;
        }
        return 'synthetic-token';
      },
    });
    h.hooks.record = (v) => {
      if (v.stage === 'request' && v.phase === 'apply-generation' && v.method === 'PUT') armed = true;
    };
    const work = h.run();
    await waiting;
    if (fault === 'source') h.breakSource();
    else if (fault === 'stop') h.stop();
    else vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
    release();
    const r = await work;
    expect(r).toMatchObject({ failure: true, stoppedAt: 'apply-generation', cleanupUnconfirmed: false });
    expect(h.world.calls.some((v) => v.method === 'PUT' && v.path.includes('/includes/'))).toBe(false);
    expect(h.records.filter((v) => v.ownSessionClosed !== undefined).at(-1)).toMatchObject({ ownSessionClosed: true });
  },
);
it.each([false, true])('the actual semaphore wait cannot extend publication freshness (proxy=%s)', async (proxy) => {
  const semaphore = new Semaphore(1),
    h = rapHarness({ semaphore, proxy });
  let blocked!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => {
    blocked = r;
  });
  h.hooks.record = (v) => {
    if (v.stage === 'request' && v.phase === 'publish' && v.method === 'POST')
      void semaphore.acquire().then(() => {
        release = () => semaphore.release();
        blocked();
      });
  };
  const work = h.run();
  await waiting;
  await new Promise((r) => setTimeout(r, 5));
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
  release();
  const r = await work;
  expect(r).toMatchObject({ failure: true, stoppedAt: 'publish' });
  expect(h.world.calls.some((v) => v.method === 'POST' && v.path.includes('/publishjobs?'))).toBe(false);
});
it.each([
  'unknown-status',
  'native-error',
  'missing-long-text',
  'readback-unknown',
  'generated-delete-unknown',
] as const)('retains submitted and recording uncertainty for %s without replay/cleanup', async (fault) => {
  const h = rapHarness(),
    original = h.hooks.reply!;
  let published = false;
  h.hooks.reply = (u, m, b) => {
    const native = original(u, m, b);
    if (m === 'POST' && u.pathname.endsWith('/publishjobs')) {
      published = true;
      if (fault === 'unknown-status') return { statusCode: 200, data: '' };
      if (fault === 'native-error')
        return { ...native!, data: native!.data.replace('<SEVERITY>OK', '<SEVERITY>ERROR') };
      if (fault === 'missing-long-text') return { ...native!, data: native!.data.replace('<LONG_TEXT/>', '') };
    }
    if (fault === 'readback-unknown' && published && m === 'GET' && u.pathname === fixtures[5].owner)
      return { statusCode: 503, data: 'unavailable' };
    if (fault === 'generated-delete-unknown' && m === 'DELETE' && u.pathname === fixtures[5].owner)
      return { statusCode: 503, data: 'unknown' };
    return native;
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, recording: 'native-governed-unverified', confirmedDeleted: [] });
  expect(r.remaining).toContain(fixtures[5].owner);
  expect(h.world.calls.filter((v) => v.method === 'POST' && v.path.includes('/publishjobs?'))).toHaveLength(1);
  expect(h.world.calls.filter((v) => v.method === 'DELETE').length).toBe(fault === 'generated-delete-unknown' ? 1 : 0);
  expect(r).toMatchObject({
    publicationOperations: expect.arrayContaining([expect.objectContaining({ action: 'publish', submitted: 1 })]),
  });
});
it('a subsequently present deleted binding stays in current residuals and prevents parent deletion', async () => {
  const h = rapHarness();
  let binding = '';
  h.hooks.record = (v) => {
    if (v.stageStarted === 'delete-generated-binding') binding = h.world.objects.get(fixtures[5].owner)!.metadata;
    if (v.stageStarted === 'delete-service') h.world.objects.get(fixtures[5].owner)!.metadata = binding;
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toEqual([fixtures[5].owner]);
  expect(r.remaining).toContain(fixtures[5].owner);
  expect(h.world.calls.filter((v) => v.method === 'DELETE')).toHaveLength(1);
});
it('an unpublish status failure retains the binding and never starts generated cleanup', async () => {
  const h = rapHarness(),
    original = h.hooks.reply!;
  h.hooks.reply = (u, m, b) => {
    const result = original(u, m, b);
    return m === 'POST' && u.pathname.endsWith('/unpublishjobs') ? { statusCode: 200, data: '' } : result;
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stoppedAt: 'unpublish', recording: 'native-governed-unverified' });
  expect(h.world.calls.filter((v) => v.method === 'DELETE')).toEqual([]);
  expect(r.remaining).toContain(fixtures[5].owner);
});
it('a changed unselected class include fails generation readback without activation', async () => {
  const h = rapHarness(),
    original = h.hooks.reply!;
  h.hooks.reply = (u, m, b) => {
    const result = original(u, m, b);
    if (m === 'PUT' && u.pathname.endsWith('/includes/implementations')) h.parts.macros = '* changed unrelated macro';
    return result;
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, stoppedAt: 'apply-generation' });
  expect(r.completed).not.toContain('batch-activate-pool-bdef');
});
it('a still-present implicit DTT survives in residuals even after confirmed parent deletion', async () => {
  const h = rapHarness(),
    original = h.hooks.reply!;
  let settings = '',
    deleting = false;
  h.hooks.before = (u, r) => {
    if (r.method === 'DELETE' && u.pathname === fixtures[0].owner) deleting = true;
  };
  h.hooks.reply = (u, m, b) => {
    const result = original(u, m, b);
    if (m === 'GET' && u.pathname === rapSettings(fixtures).owner) {
      if (deleting) return { statusCode: 200, data: settings };
      if (result?.statusCode === 200) settings = result.data;
    }
    return result;
  };
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, finalAbsenceConfirmed: false });
  expect(r.confirmedDeleted).toHaveLength(6);
  expect(r.remaining).toEqual([rapSettings(fixtures).owner]);
  expect(r.inspectionRequired).toEqual(r.remaining);
});
it('retains the table implicit settings as an explicit residual after a failed pool create', async () => {
  const h = rapHarness(),
    original = h.hooks.reply!;
  h.hooks.reply = (u, m, b) =>
    m === 'POST' && u.pathname === '/sap/bc/adt/oo/classes'
      ? { statusCode: 503, data: 'unknown create' }
      : original(u, m, b);
  const r = await h.run();
  expect(r).toMatchObject({ failure: true, confirmedDeleted: [] });
  expect(r.remaining).toContain(rapSettings(fixtures).owner);
  expect(r.remaining).toContain(fixtures[2].owner);
  expect(h.world.calls.filter((v) => v.method === 'POST' && v.path === '/sap/bc/adt/oo/classes')).toHaveLength(1);
});
it('refuses a caller-changed graph before any HTTP and does not select a second graph', async () => {
  const h = rapHarness(),
    changed = rapFixtures('0123456789AB');
  changed[0].packageName = 'FOREIGN';
  await expect(h.run(changed)).rejects.toThrow('Exact fresh');
  expect(h.world.calls).toEqual([]);
});
it.each([
  ['DELETE', '/sap/bc/adt/ddic/srvd/sources/foreign?lockHandle=x', 'delete-service'],
  ['POST', '/sap/bc/adt/businessservices/odatav4/publishjobs?servicename=FOREIGN&serviceversion=0001', 'publish'],
  [
    'POST',
    '/sap/bc/adt/businessservices/odatav4/publishjobs?servicename=ZBRP_0123456789AB&serviceversion=0002',
    'publish',
  ],
  ['POST', '/sap/bc/adt/programs/programs', 'create-table'],
  ['GET', '/sap/bc/adt/cts/transportrequests', 'publish'],
  ['GET', `${fixtures[5].owner}/source/main`, 'publish'],
  ['POST', '/sap/bc/adt/oo/classes/zbp_rp_0123456789ab/includes/macros?lockHandle=x', 'apply-generation'],
])('the stage fence refuses %s %s', (method, path, stage) =>
  expect(() => checkRapRequest(fixtures, stage, method, path, '')).toThrow(),
);
it('accepts bounded own class-include expansion in the two-owner batch but refuses foreign expansion', () => {
  const xml = (uri: string) =>
    `<c:objectReferences xmlns:c="http://www.sap.com/adt/core"><c:objectReference c:uri="${fixtures[2].owner}"/><c:objectReference c:uri="${fixtures[3].owner}"/><c:objectReference c:uri="${uri}" c:type="CLAS/I"/></c:objectReferences>`;
  const path = '/sap/bc/adt/activation?method=activate&preauditRequested=false';
  expect(() =>
    checkRapRequest(
      fixtures,
      'batch-activate-pool-bdef',
      'POST',
      path,
      xml(`${fixtures[2].owner}/includes/implementations`),
    ),
  ).not.toThrow();
  expect(() =>
    checkRapRequest(
      fixtures,
      'batch-activate-pool-bdef',
      'POST',
      path,
      xml('/sap/bc/adt/oo/classes/foreign/includes/implementations'),
    ),
  ).toThrow();
});

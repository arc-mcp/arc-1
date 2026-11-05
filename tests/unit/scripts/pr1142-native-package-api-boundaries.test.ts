import { setImmediate as immediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { packageApiInterface } from '../../../scripts/qualification/pr1142/native-package-api-profile.js';
import { Semaphore } from '../../../src/adt/semaphore.js';
import {
  apiXml,
  classMetadata,
  graph,
  packageApiHarness,
  packageMetadata,
  requestXml,
} from './pr1142-native-package-api-harness.js';

it.each(
  [false, true].flatMap((proxy) =>
    ['source', 'stop', 'request-timeout', 'baseline-timeout'].map((fault) => ({ proxy, fault })),
  ),
)('rechecks queued recorded API PUT $fault on proxy=$proxy', async ({ proxy, fault }) => {
  const semaphore = new Semaphore(1),
    h = packageApiHarness({ semaphore, proxy });
  const now = Date.now.bind(Date);
  let offset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  let queued = false;
  h.hooks.record = (r) => {
    if (r.recordedGuardVerified?.stage === 'release-api' && !queued) {
      queued = true;
      void semaphore.acquire();
      void (async () => {
        for (let n = 0; n < 100 && !semaphore.waiting; n++) await immediate();
        if (fault === 'source') h.breakSource();
        else if (fault === 'stop') h.stop();
        else offset = fault === 'request-timeout' ? 31_001 : 300_001;
        semaphore.release();
      })();
    }
  };
  const result = await h.run();
  expect(queued).toBe(true);
  expect(result).toMatchObject({ failure: true, stoppedAt: 'release-api' });
  expect(h.calls.filter((r) => r.method === 'PUT' && r.path.startsWith('/sap/bc/adt/apireleases/'))).toHaveLength(0);
  expect(result.remaining).toEqual([
    graph.root.owner,
    graph.child.owner,
    packageApiInterface(graph).owner,
    graph.clas.owner,
  ]);
});
it.each(['root', 'child'] as const)('rechecks the %s receipt between batch item saves', async (parent) => {
  const h = packageApiHarness();
  let saved = false;
  h.hooks.before = (r) => {
    if (r.method === 'PUT' && r.path.startsWith(packageApiInterface(graph).owner)) saved = true;
  };
  h.hooks.reply = (r) =>
    saved && r.path === graph[parent].owner
      ? {
          statusCode: 200,
          data: packageMetadata(graph[parent], parent === 'root').replace(
            'c:changedBy="MARIAN"',
            'c:changedBy="OTHER"',
          ),
        }
      : undefined;
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, stoppedAt: 'batch-create' });
  expect(h.calls.filter((r) => r.method === 'POST' && r.path === '/sap/bc/adt/oo/classes')).toHaveLength(0);
  expect(result.remaining).toContain(packageApiInterface(graph).owner);
});
it('preserves first batch create and an uncertain second item without activation or rollback', async () => {
  const h = packageApiHarness();
  h.hooks.reply = (r) =>
    r.method === 'POST' && r.path === '/sap/bc/adt/oo/classes'
      ? { statusCode: 500, data: 'ambiguous second create' }
      : undefined;
  const result = await h.run();
  expect(result).toMatchObject({
    failure: true,
    stoppedAt: 'batch-create',
    batchOutcome: {
      objects: [
        { type: 'INTF', create: { status: 'confirmed' }, activation: { status: 'not-attempted' } },
        { type: 'CLAS', create: { status: 'failed' }, activation: { status: 'not-attempted' } },
      ],
    },
  });
  expect(result.created).toContain(packageApiInterface(graph).owner);
  expect(result.remaining).toContain(graph.clas.owner);
  expect(h.calls.some((r) => r.method === 'DELETE' || r.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
});
it('refuses a foreign batch activation reference after both local saves', async () => {
  const h = packageApiHarness();
  h.hooks.reply = (r) =>
    r.method === 'POST' && r.path.includes('preauditRequested=true')
      ? {
          statusCode: 200,
          data: '<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects"><i:entry><i:object><i:ref xmlns:c="http://www.sap.com/adt/core" c:uri="/sap/bc/adt/oo/classes/other" c:name="OTHER"/></i:object></i:entry></i:inactiveObjects>',
        }
      : undefined;
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, stoppedAt: 'batch-create' });
  expect(result.created).toContain(graph.clas.owner);
  expect(result.created).toContain(packageApiInterface(graph).owner);
  expect(h.calls.some((r) => r.path.includes('preauditRequested=false') || r.method === 'DELETE')).toBe(false);
});
it('keeps failed owning closure after a batch save in the final partial outcome', async () => {
  const h = packageApiHarness();
  h.hooks.reply = (r) =>
    r.path === '/sap/bc/adt/core/http/sessions' ? { statusCode: 500, data: 'unconfirmed close' } : undefined;
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, stoppedAt: 'batch-create', cleanupUnconfirmed: true });
  expect(result.owningSessionClosures?.some((r) => r.closed === false)).toBe(true);
  expect(h.calls.filter((r) => r.method === 'POST' && r.path === '/sap/bc/adt/oo/classes')).toHaveLength(0);
});
it.each([false, true])('checks expiry after actual asynchronous auth on proxy=%s', async (proxy) => {
  const now = Date.now.bind(Date);
  let ready = false,
    offset = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  const h = packageApiHarness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (ready) offset = 300_001;
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.recordedGuardVerified?.stage === 'move-class') ready = true;
  };
  expect(await h.run()).toMatchObject({ failure: true, stoppedAt: 'move-class' });
  expect(ready).toBe(true);
  expect(h.calls.filter((r) => r.method === 'POST' && r.path.startsWith('/sap/bc/adt/refactorings'))).toHaveLength(0);
});
it('keeps unknown native400 separate from PAK051 and preserves safe diagnostics without secret handles', async () => {
  const h = packageApiHarness();
  h.hooks.reply = (r) =>
    r.method === 'DELETE' && r.path.startsWith(graph.root.owner)
      ? {
          statusCode: 400,
          data: '<e:exception xmlns:e="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceError"/><message lang="EN">Different native refusal</message></e:exception>',
        }
      : undefined;
  const result = await h.run();
  expect(result).toMatchObject({
    failure: true,
    stoppedAt: 'refuse-root-child',
    expectedRefusals: [],
    cleanupUnconfirmed: false,
  });
  expect(h.records.some((r) => r.nativeDeleteDiagnostic?.status === 400)).toBe(true);
  expect(JSON.stringify(h.records)).not.toContain('SECRET-HANDLE');
  expect(h.calls.filter((r) => r.method === 'DELETE')).toHaveLength(1);
});
it.each(['class-record', 'api-record', 'extra-member', 'foreign-record'] as const)(
  'refuses %s recording drift',
  async (fault) => {
    const h = packageApiHarness();
    let moved = false,
      released = false;
    h.hooks.before = (r) => {
      if (r.path.includes('step=execute')) moved = true;
      if (r.method === 'PUT' && r.path.includes('/apireleases/')) released = true;
    };
    h.hooks.reply = (r) => {
      if (r.path !== '/sap/bc/adt/cts/transportrequests/A4HK999991' || !moved) return;
      let body = requestXml(graph, true, released);
      if (fault === 'class-record') body = body.replace(/<tm:abap_object[^>]*tm:type="CLAS"[^>]*\/>/, '');
      if (fault === 'api-record' && released) body = body.replace(/<tm:abap_object[^>]*tm:type="APIS"[^>]*\/>/, '');
      if (fault === 'extra-member')
        body = body.replace(
          '</tm:request>',
          '<tm:task tm:number="A4HK999993" tm:owner="OTHER" tm:type="Unclassified" tm:status="D" tm:target=""/></tm:request>',
        );
      if (fault === 'foreign-record') body = body.replace(`tm:name="${graph.clas.name}"`, 'tm:name="ZCL_OTHER"');
      return { statusCode: 200, data: body };
    };
    const result = await h.run();
    expect(result.failure).toBe(true);
    expect(result.remaining).toContain(graph.clas.owner);
    expect(h.calls.filter((r) => r.method === 'DELETE' && r.path.startsWith(graph.clas.owner))).toHaveLength(0);
  },
);
it('retains successful historical deletion but stops before parent DELETE on a revived class', async () => {
  const h = packageApiHarness();
  let deleted = false,
    reads = 0;
  h.hooks.before = (r) => {
    if (r.method === 'DELETE' && r.path.startsWith(graph.clas.owner)) deleted = true;
  };
  h.hooks.reply = (r) =>
    deleted && r.method === 'GET' && r.path === graph.clas.owner && ++reads > 2
      ? { statusCode: 200, data: classMetadata(true).replace(graph.child.name, 'ZARC1_DEMO') }
      : undefined;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.confirmedDeleted).toContain(graph.clas.owner);
  expect(result.remaining).toContain(graph.clas.owner);
  expect(result.inspectionRequired).toContain(graph.clas.owner);
  expect(h.calls.filter((r) => r.method === 'DELETE' && r.path.startsWith(graph.child.owner))).toHaveLength(1); // planned refusal only
});
it('does not delete a class when another API contract remains released', async () => {
  const h = packageApiHarness();
  let revoked = false;
  h.hooks.before = (r) => {
    if (r.method === 'PUT' && r.path.includes('/apireleases/') && r.body.includes('ars:state="NOT_RELEASED"'))
      revoked = true;
  };
  h.hooks.reply = (r) =>
    revoked && r.method === 'GET' && r.path.includes('/apireleases/')
      ? {
          statusCode: 200,
          data: apiXml().replace(/(<ars:c4Release[\s\S]*?<ars:status ars:state=)"NOT_RELEASED"/, '$1"RELEASED"'),
        }
      : undefined;
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, stoppedAt: 'revoke-api' });
  expect(h.calls.filter((r) => r.method === 'DELETE' && r.path.startsWith(graph.clas.owner))).toHaveLength(0);
});
it('retains uncertain move execution without API writes or destructive cleanup', async () => {
  const h = packageApiHarness();
  h.hooks.reply = (r) =>
    r.method === 'POST' && r.path === '/sap/bc/adt/refactorings?step=execute'
      ? { statusCode: 200, data: '' }
      : undefined;
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, stoppedAt: 'move-class' });
  expect(result.retainedBookkeeping?.operations).toMatchObject([
    { stage: 'move-class', result: { ok: false, state: 'move-unverified' } },
  ]);
  expect(h.calls.filter((r) => r.method === 'POST' && r.path.includes('/refactorings'))).toHaveLength(2);
  expect(h.calls.some((r) => r.path.includes('/apireleases/'))).toBe(false);
  expect(h.calls.filter((r) => r.method === 'DELETE')).toHaveLength(2);
});
it('preserves a submitted API release with failed readback and does not auto-revoke', async () => {
  const h = packageApiHarness();
  let submitted = false;
  h.hooks.before = (r) => {
    if (r.method === 'PUT' && r.path.includes('/apireleases/')) submitted = true;
  };
  h.hooks.reply = (r) =>
    submitted && r.method === 'GET' && r.path.includes('/apireleases/')
      ? { statusCode: 500, data: 'unknown readback' }
      : undefined;
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, stoppedAt: 'release-api' });
  expect(result.retainedBookkeeping?.operations).toMatchObject([
    { stage: 'move-class', result: { ok: true } },
    { stage: 'release-api', result: { ok: false, state: 'state-change-unconfirmed' } },
  ]);
  expect(h.calls.filter((r) => r.method === 'PUT' && r.path.includes('/apireleases/'))).toHaveLength(1);
  expect(h.calls.filter((r) => r.method === 'DELETE')).toHaveLength(2);
});

it('keeps historical deleted owners but reports an unverified terminal CTS read', async () => {
  const h = packageApiHarness();
  let afterDelete = false;
  h.hooks.record = (r) => {
    if (r.adapter === 'delete-root') afterDelete = true;
  };
  h.hooks.reply = (r) =>
    afterDelete && r.method === 'GET' && r.path === '/sap/bc/adt/cts/transportrequests/A4HK999991'
      ? { statusCode: 500, data: 'unavailable' }
      : undefined;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.confirmedDeleted).toHaveLength(4);
  expect(result.remaining).toEqual([]);
  expect(result.retainedBookkeeping).toMatchObject({
    membershipVerified: false,
    inspectionRequired: ['A4HK999991', 'A4HK999992'],
    classRecorded: true,
    apiRecorded: true,
  });
});

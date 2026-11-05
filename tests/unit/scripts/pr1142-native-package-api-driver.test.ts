import { describe, expect, it } from 'vitest';
import {
  PACKAGE_API_STAGES,
  packageApiInterface,
} from '../../../scripts/qualification/pr1142/native-package-api-profile.js';
import { graph, packageApiHarness, requestXml } from './pr1142-native-package-api-harness.js';

describe('fixed native package/API recorded graph', () => {
  it.each([false, true])('uses real helpers and HTTP for the complete graph (proxy=%s)', async (proxy) => {
    const h = packageApiHarness({ proxy });
    const result = await h.run();
    expect(result).toMatchObject({
      failure: false,
      completed: PACKAGE_API_STAGES,
      confirmedDeleted: [graph.clas.owner, packageApiInterface(graph).owner, graph.child.owner, graph.root.owner],
      remaining: [],
      finalAbsenceConfirmed: true,
      retainedBookkeeping: {
        request: 'A4HK999991',
        task: 'A4HK999992',
        disposition: 'retained-request-and-task-with-native-records',
      },
    });
    expect(h.calls.filter((c) => c.method === 'POST' && c.path === '/sap/bc/adt/cts/transports')).toHaveLength(1);
    expect(h.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/refactorings'))).toHaveLength(2);
    expect(h.calls.filter((c) => c.method === 'PUT' && c.path.startsWith('/sap/bc/adt/apireleases/'))).toHaveLength(2);
    expect(h.records.filter((r) => r.nativeDeleteDiagnostic)).toHaveLength(2);
    expect(result.expectedRefusals).toHaveLength(2);
    expect(h.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual([
      graph.root.owner,
      graph.child.owner,
      graph.clas.owner,
      packageApiInterface(graph).owner,
      graph.child.owner,
      graph.root.owner,
    ]);
    expect(h.calls.some((c) => /A4HK90660[5-8]/.test(c.path))).toBe(false);
  });
  it('retains uncertain request creation without another POST or any repository fixture', async () => {
    const h = packageApiHarness();
    h.hooks.reply = (r) =>
      r.path === '/sap/bc/adt/cts/transports' ? { statusCode: 500, data: 'synthetic unknown create' } : undefined;
    const result = await h.run();
    expect(result).toMatchObject({
      failure: true,
      stoppedAt: 'create-request',
      created: [],
      completed: [],
      retainedBookkeeping: { createAttempted: true },
    });
    expect(h.calls.filter((c) => c.method === 'POST' && c.path === '/sap/bc/adt/cts/transports')).toHaveLength(1);
    expect(h.existing.size).toBe(0);
  });
  it.each(['missing-task', 'foreign-task', 'foreign-target', 'old-request', 'foreign-client'])(
    'stops on %s native request evidence',
    async (fault) => {
      const h = packageApiHarness();
      h.hooks.reply = (r) => {
        if (fault === 'old-request' && r.path === '/sap/bc/adt/cts/transports')
          return { statusCode: 200, data: '/com.sap.cts/object_record/A4HK906605' };
        if (r.path !== '/sap/bc/adt/cts/transportrequests/A4HK999991') return;
        let xml = requestXml();
        if (fault === 'missing-task') xml = xml.replace(/<tm:task[\s\S]*?<\/tm:task>/, '');
        if (fault === 'foreign-task') xml = xml.replace(/(<tm:task[^>]*tm:owner=)"MARIAN"/, '$1"OTHER"');
        if (fault === 'foreign-target') xml = xml.replace('tm:target=""', 'tm:target="PRD"');
        if (fault === 'foreign-client') xml = xml.replace('tm:source_client="001"', 'tm:source_client="002"');
        return { statusCode: 200, data: xml };
      };
      expect(await h.run()).toMatchObject({ failure: true, stoppedAt: 'create-request', created: [] });
      expect(h.existing.size).toBe(0);
    },
  );
});

it.each(['parent', 'task'])('requires an explicit empty native %s target', async (which) => {
  const h = packageApiHarness();
  h.hooks.reply = (r) => {
    if (r.method !== 'GET' || r.path !== '/sap/bc/adt/cts/transportrequests/A4HK999991') return;
    const body = requestXml(graph);
    let count = 0;
    return {
      statusCode: 200,
      data: body.replace(/ tm:target=""/g, (match) => (++count === (which === 'parent' ? 1 : 2) ? '' : match)),
    };
  };
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.stoppedAt).toBe('create-request');
  expect(result.created).toEqual([]);
  expect(h.calls.filter((r) => r.method === 'POST' && r.path === '/sap/bc/adt/cts/transports')).toHaveLength(1);
});

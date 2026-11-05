import { describe, expect, it } from 'vitest';
import {
  PACKAGE_API_MOVED_COMPLETED,
  PACKAGE_API_MOVED_STAGES,
} from '../../../scripts/qualification/pr1142/native-package-api-moved-fixed.js';
import { packageApiOwners } from '../../../scripts/qualification/pr1142/native-package-api-profile.js';
import { graph, movedHarness } from './pr1142-native-package-api-moved-harness.js';

const owners = packageApiOwners(graph).map((o) => o.owner);
describe('fixed already-moved package API tail', () => {
  it.each([false, true])(
    'composes actual native receipt readers, API changes and reverse deletion (proxy=%s)',
    async (proxy) => {
      const h = movedHarness({ proxy });
      const result = await h.run();
      expect(result).toMatchObject({
        failure: false,
        created: [],
        retainedFromOriginal: owners,
        previouslyCompleted: PACKAGE_API_MOVED_COMPLETED,
        observedRetainedWrites: ['move-class'],
        completed: PACKAGE_API_MOVED_STAGES,
        confirmedDeleted: [...owners].reverse(),
        remaining: [],
        finalAbsenceConfirmed: true,
        retainedBookkeeping: {
          request: 'A4HK906609',
          task: 'A4HK906611',
          originalTask: 'A4HK906610',
          classRecorded: true,
          apiRecorded: true,
          createAttempted: false,
        },
      });
      expect(h.client.safety).toMatchObject({
        allowTransportWrites: false,
        allowedTransports: ['A4HK906609'],
        multiTargetWrite: { allowedTransports: ['A4HK906609'], serverAllowedTransports: ['A4HK906609'] },
      });
      expect(h.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual(
        [...owners].reverse(),
      );
      expect(h.calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
      expect(
        h.calls.some((c) => /refactorings|activation\?|\/cts\/transports$|\/tasks$|newreleasejobs/.test(c.path)),
      ).toBe(false);
      expect(h.records.some((r) => r.stageStarted === 'move-class' || r.stageStarted?.startsWith('refuse-'))).toBe(
        false,
      );
    },
  );
  it.each(['class', 'source', 'task', 'api', 'target'] as const)(
    'refuses current %s drift before any mutation',
    async (fault) => {
      const h = movedHarness();
      const path =
        fault === 'class'
          ? graph.clas.owner
          : fault === 'source'
            ? `${graph.clas.owner}/source/main`
            : fault === 'task'
              ? '/sap/bc/adt/cts/transportrequests/A4HK906611'
              : fault === 'api'
                ? `/sap/bc/adt/apireleases/${encodeURIComponent(graph.clas.owner)}`
                : '/sap/bc/adt/packages/ZARC1_DEMO';
      h.hooks.reply = (r) => (r.method === 'GET' && r.path === path ? { statusCode: 200, data: 'changed' } : undefined);
      expect(await h.run()).toMatchObject({
        failure: true,
        mutationAttempted: false,
        completed: [],
        remaining: owners,
      });
      expect(h.calls.every((c) => c.method === 'GET')).toBe(true);
    },
  );
  it.each([false, true])('retains uncertain API PUT without replay (proxy=%s)', async (proxy) => {
    const h = movedHarness({ proxy });
    h.hooks.reply = (r) => (r.method === 'PUT' ? { statusCode: 503, data: 'unknown' } : undefined);
    expect(await h.run()).toMatchObject({ failure: true, completed: [], remaining: owners, confirmedDeleted: [] });
    expect(h.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(h.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });
  it.each([
    'new-task',
    'foreign-row',
    'aggregate-only',
    'target',
    'task-owner',
    'task-parent',
    'original-task-object',
    'limu',
  ] as const)('refuses %s after initial adoption before an API PUT', async (fault) => {
    const h = movedHarness();
    let active = false;
    h.hooks.record = (r) => {
      if (r.stageStarted === 'release-api') active = true;
    };
    h.hooks.reply = (r) => {
      if (!active || r.method !== 'GET' || r.path !== '/sap/bc/adt/cts/transportrequests/A4HK906609') return;
      let xml = h.nativeReply(r)!.data;
      const row =
        '<tm:abap_object tm:pgmid="R3TR" tm:type="CLAS" tm:name="ZFOREIGN" tm:position="000099" tm:lock_status="X"/>';
      if (fault === 'new-task')
        xml = xml.replace(
          '</tm:request>',
          '<tm:task tm:number="A4HK906612" tm:parent="A4HK906609" tm:owner="MARIAN" tm:status="D" tm:type="Development/Correction" tm:target=""/></tm:request>',
        );
      if (fault === 'foreign-row') xml = xml.replace('</tm:task>', `${row}</tm:task>`);
      if (fault === 'aggregate-only') xml = xml.replace('</tm:all_objects>', `${row}</tm:all_objects>`);
      if (fault === 'target') xml = xml.replace('tm:target=""', 'tm:target="OTHER"');
      if (fault === 'task-owner')
        xml = xml.replace(
          'tm:number="A4HK906611" tm:parent="A4HK906609" tm:owner="MARIAN"',
          'tm:number="A4HK906611" tm:parent="A4HK906609" tm:owner="OTHER"',
        );
      if (fault === 'task-parent')
        xml = xml.replace(
          'tm:number="A4HK906611" tm:parent="A4HK906609"',
          'tm:number="A4HK906611" tm:parent="A4HK999999"',
        );
      if (fault === 'original-task-object')
        xml = xml.replace(/(<tm:task tm:number="A4HK906610"[\s\S]*?)(<\/tm:task>)/, `$1${row}$2`);
      if (fault === 'limu') xml = xml.replaceAll('tm:pgmid="R3TR"', 'tm:pgmid="LIMU"');
      return { statusCode: 200, data: xml };
    };
    expect(await h.run()).toMatchObject({ failure: true, completed: [], remaining: owners });
    expect(active).toBe(true);
    expect(h.calls.filter((c) => c.method === 'PUT' || c.method === 'DELETE')).toHaveLength(0);
  });
});

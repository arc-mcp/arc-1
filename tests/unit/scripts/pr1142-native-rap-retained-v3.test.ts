import { expect, it, vi } from 'vitest';
import {
  RAP_RETAINED_V3_OBSERVED_WRITES,
  RAP_RETAINED_V3_STAGES,
} from '../../../scripts/qualification/pr1142/native-rap-retained-v3-fixed.js';
import { retainedFixtures as f, retainedV3Harness, retainedV3Rows } from './pr1142-native-rap-retained-harness.js';

const { rapRetainedV3Preflight } = await import('../../../scripts/qualification/pr1142/native-rap-retained-runner.js');
const { documentNodes } = await import('../../../scripts/qualification/pr1142/native-rap-documents-evidence.js');
const { checkRapRequest } = await import('../../../scripts/qualification/pr1142/native-rap-transport.js');
it.each([false, true])(
  'continues the actual stored document through the shared native graph without a document PUT, proxy=%s',
  async (proxy) => {
    const h = retainedV3Harness(proxy),
      r = await h.run();
    expect(r).toMatchObject({
      failure: false,
      completed: RAP_RETAINED_V3_STAGES,
      remaining: [],
      finalAbsenceConfirmed: true,
      created: [f[4].owner, f[5].owner],
      observedRetainedWrites: RAP_RETAINED_V3_OBSERVED_WRITES,
      previousClaim: 'consumed-failed',
    });
    expect(r.confirmedDeleted).toEqual([...f].reverse().map((v) => v.owner));
    expect(h.world.calls.some((c) => c.method === 'PUT' && c.path.startsWith(f[6].owner))).toBe(false);
    expect(
      h.world.calls.filter(
        (c) =>
          c.method === 'POST' &&
          [
            '/sap/bc/adt/ddic/tables',
            '/sap/bc/adt/ddic/ddl/sources',
            '/sap/bc/adt/oo/classes',
            '/sap/bc/adt/bo/behaviordefinitions',
            '/sap/bc/adt/documentation/ktd/documents',
          ].includes(c.path.split('?')[0]),
      ),
    ).toEqual([]);
    expect(r.completed[0]).toBe('activate-document-updated');
    expect(r.completed.some((v) => v.startsWith('update-document'))).toBe(false);
    expect(r.previousCompleted).not.toContain('update-document-update');
    expect(r.generatedCleanup).toBe('accepted-unverified');
    expect(r.recording).toBe('native-governed-unverified');
  },
);
it('GET-only preflight proves exact final draft, unchanged active counterpart and all other owners', async () => {
  const h = retainedV3Harness();
  await rapRetainedV3Preflight(h.client, f, (v) => h.records.push(v), h.verify);
  expect(h.world.calls.every((c) => c.method === 'GET')).toBe(true);
  const doc = documentNodes(f[6], retainedV3Rows.find((r) => r.path === f[6].owner)!.body);
  expect(doc.nodes.get(doc.ids[2])).toMatchObject({
    text: 'Owned update documentation.',
    shortText: 'Update an owned RAP item',
  });
  expect(doc.nodes.get(doc.ids[1])).toMatchObject({
    text: 'Owned create documentation.',
    shortText: 'Create an owned RAP item',
  });
  expect(doc.evidence.version).toBe('inactive');
});
it.each(['draft', 'shorttext', 'derived-label', 'active', 'class', 'post-read'] as const)(
  'refuses retained %s drift before mutation',
  async (fault) => {
    const h = retainedV3Harness(),
      d = h.world.objects.get(f[6].owner)!;
    if (fault === 'draft') d.metadata += ' ';
    if (fault === 'shorttext') d.metadata = d.metadata.replace('VXBkYXRlIGFuIG93bmVkIFJBUCBpdGVt', 'V3Jvbmc=');
    if (fault === 'derived-label')
      d.metadata = d.metadata.replace('Update an owned RAP item', 'Different derived label');
    if (fault === 'active') h.activeDocuments.set(f[6].owner, h.activeDocuments.get(f[6].owner)! + ' ');
    if (fault === 'class') h.world.objects.get(f[2].owner)!.source += '\nforeign';
    if (fault === 'post-read') {
      let n = 0;
      h.hooks.record = (row) => {
        if (row.retainedRead && ++n === 38) d.metadata += ' ';
      };
    }
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.mutationDispatched).toBe(false);
    expect(r.remaining).toHaveLength(6);
    expect(h.world.calls.every((c) => c.method === 'GET')).toBe(true);
  },
);
it.each(['source', 'stop', 'metadata'] as const)(
  'refuses %s change between activation preaudit and submission',
  async (fault) => {
    const h = retainedV3Harness(),
      reply = h.hooks.reply!;
    let armed = false;
    h.hooks.reply = (u, m, b) => {
      const result = reply(u, m, b);
      if (
        !armed &&
        m === 'POST' &&
        u.pathname === '/sap/bc/adt/activation' &&
        u.searchParams.get('preauditRequested') === 'true'
      ) {
        armed = true;
        if (fault === 'source') h.breakSource();
        if (fault === 'stop') h.stop();
        if (fault === 'metadata')
          h.world.objects.get(f[6].owner)!.metadata = h.world.objects
            .get(f[6].owner)!
            .metadata.replace('Documentation for', 'Concurrent documentation for');
      }
      return result;
    };
    const r = await h.run();
    expect(armed).toBe(true);
    expect(r.failure).toBe(true);
    expect(r.remaining).toHaveLength(6);
    expect(
      h.world.calls.filter(
        (c) =>
          c.method === 'POST' &&
          c.path.startsWith('/sap/bc/adt/activation') &&
          !c.path.includes('preauditRequested=true'),
      ),
    ).toHaveLength(0);
    expect(h.world.calls.some((c) => c.method === 'PUT' || c.method === 'DELETE')).toBe(false);
  },
);
it.each([false, true])('retains all owners after uncertain activation and never replays, proxy=%s', async (proxy) => {
  const h = retainedV3Harness(proxy),
    reply = h.hooks.reply!;
  h.hooks.reply = (u, m, b) =>
    m === 'POST' && u.pathname === '/sap/bc/adt/activation' && u.searchParams.get('preauditRequested') !== 'true'
      ? { statusCode: 503, data: 'unknown', responseOptions: { headers: { 'content-type': 'text/plain' } } }
      : reply(u, m, b);
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.completed).toEqual([]);
  expect(r.remaining).toHaveLength(6);
  expect(r.confirmedDeleted).toEqual([]);
  expect(
    h.world.calls.filter(
      (c) =>
        c.method === 'POST' &&
        c.path.startsWith('/sap/bc/adt/activation') &&
        !c.path.includes('preauditRequested=true'),
    ),
  ).toHaveLength(1);
  expect(h.world.calls.some((c) => c.method === 'PUT' || c.method === 'DELETE')).toBe(false);
});
it('keeps later contradictory presence distinct from historical deletion', async () => {
  const h = retainedV3Harness(),
    reply = h.hooks.reply!;
  let deletionConfirmed = false;
  h.hooks.record = (row) => {
    if (row.stageCompleted === 'delete-document') deletionConfirmed = true;
  };
  h.hooks.reply = (u, m, b) =>
    deletionConfirmed && m === 'GET' && u.pathname === f[6].owner
      ? {
          statusCode: 200,
          data: retainedV3Rows.find((r) => r.path === f[6].owner)!.body,
          responseOptions: { headers: { 'content-type': 'application/xml' } },
        }
      : reply(u, m, b);
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toContain(f[6].owner);
  expect(r.remaining).toContain(f[6].owner);
  expect(r.inspectionRequired).toContain(f[6].owner);
  expect(h.world.calls.filter((c) => c.method === 'DELETE' && c.path.startsWith(f[6].owner))).toHaveLength(1);
});
it('remaining stages cannot authorize prior creates, document PUTs or generated-handler saves', () => {
  for (const stage of RAP_RETAINED_V3_STAGES) {
    expect(() => checkRapRequest(f, stage, 'PUT', f[6].owner + '?lockHandle=owned', 'old', new Map(), 'old')).toThrow();
    expect(() =>
      checkRapRequest(
        f,
        stage,
        'PUT',
        f[2].owner + '/includes/implementations?lockHandle=owned',
        'old',
        new Map([['implementations', 'old']]),
      ),
    ).toThrow();
    expect(() => checkRapRequest(f, stage, 'POST', '/sap/bc/adt/documentation/ktd/documents', 'old')).toThrow();
  }
});

it.each(
  [false, true].flatMap((proxy) => (['source', 'stop', 'deadline'] as const).map((fault) => [proxy, fault] as const)),
)('rechecks %s/%s at actual activation dispatch', async (proxy, fault) => {
  const h = retainedV3Harness(proxy);
  let armed = false,
    restoreClock = () => {};
  h.hooks.record = (row) => {
    if (
      !armed &&
      row.stage === 'request' &&
      row.method === 'POST' &&
      String(row.path).startsWith('/sap/bc/adt/activation')
    ) {
      armed = true;
      if (fault === 'source') h.breakSource();
      if (fault === 'stop') h.stop();
      if (fault === 'deadline') {
        const expired = Date.now() + 300000,
          spy = vi.spyOn(Date, 'now').mockReturnValue(expired);
        restoreClock = () => spy.mockRestore();
      }
    }
  };
  try {
    const r = await h.run();
    expect(armed).toBe(true);
    expect(r.failure).toBe(true);
    expect(r.remaining).toHaveLength(6);
    expect(h.world.calls.some((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/activation'))).toBe(false);
    expect(h.world.calls.some((c) => c.method === 'PUT' || c.method === 'DELETE')).toBe(false);
  } finally {
    restoreClock();
  }
});

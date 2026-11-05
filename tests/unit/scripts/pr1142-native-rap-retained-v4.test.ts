import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  RAP_RETAINED_V4_COMPLETED,
  RAP_RETAINED_V4_READS,
  RAP_RETAINED_V4_STAGES,
} from '../../../scripts/qualification/pr1142/native-rap-retained-v4-fixed.js';
import { retainedFixtures as f, retainedV4Harness, retainedV4Rows } from './pr1142-native-rap-retained-harness.js';

const { rapRetainedV4Preflight } = await import('../../../scripts/qualification/pr1142/native-rap-retained-runner.js');
const { checkRapRequest } = await import('../../../scripts/qualification/pr1142/native-rap-transport.js');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
it('binds all47 captured successful views, including three identical case aliases, never error bodies', () => {
  expect(retainedV4Rows).toHaveLength(47);
  expect(new Set(retainedV4Rows.map((v) => v.path.toLowerCase())).size).toBe(44);
  for (const row of retainedV4Rows) {
    const expected = RAP_RETAINED_V4_READS.find((v) => v.path === row.path)!;
    expect(hash(row.body)).toBe(expected.sha256);
    expect(Buffer.byteLength(row.body)).toBe(expected.bytes);
  }
  expect(RAP_RETAINED_V4_STAGES[0]).toBe('publish');
  expect(RAP_RETAINED_V4_STAGES.some((s) => /create|activate|update|generation/.test(s))).toBe(false);
});
it.each([false, true])(
  'adopts actual active generated binding and completes only remaining tail, proxy=%s',
  async (proxy) => {
    const h = retainedV4Harness(proxy),
      r = await h.run();
    expect(r).toMatchObject({
      failure: false,
      completed: RAP_RETAINED_V4_STAGES,
      remaining: [],
      created: [],
      previousCompleted: RAP_RETAINED_V4_COMPLETED,
      observedRetainedActivations: ['activate-binding'],
      previousClaim: 'consumed-failed',
      finalAbsenceConfirmed: true,
      recording: 'native-governed-unverified',
      generatedCleanup: 'accepted-unverified',
    });
    expect(r.confirmedDeleted).toEqual([...f].reverse().map((v) => v.owner));
    expect(
      h.world.calls.filter(
        (c) => c.method === 'PUT' || (c.method === 'POST' && c.path.startsWith('/sap/bc/adt/activation')),
      ),
    ).toEqual([]);
    expect(h.records.filter((v) => v.retainedRead)).toHaveLength(47);
    expect(h.world.calls.filter((c) => c.method === 'POST' && c.path.includes('/publishjobs'))).toHaveLength(1);
    expect(h.world.calls.filter((c) => c.method === 'POST' && c.path.includes('/unpublishjobs'))).toHaveLength(1);
  },
);
it('preflight is GET-only and reconciles every current view through real production readers', async () => {
  const h = retainedV4Harness();
  await rapRetainedV4Preflight(h.client, f, (v) => h.records.push(v), h.verify);
  expect(h.world.calls.every((c) => c.method === 'GET')).toBe(true);
  expect(h.records.filter((v) => v.retainedRead)).toHaveLength(47);
});
it.each(['binding-published', 'binding-generated', 'binding-creator', 'document-shorttext', 'source', 'late'] as const)(
  'refuses %s counter-evidence before any mutation',
  async (fault) => {
    const h = retainedV4Harness(),
      binding = h.world.objects.get(f[5].owner)!,
      doc = h.world.objects.get(f[6].owner)!;
    if (fault === 'binding-published')
      binding.metadata = binding.metadata.replace('srvb:published="false"', 'srvb:published="true"');
    if (fault === 'binding-generated')
      binding.metadata = binding.metadata.replace('srvb:bindingCreated="true"', 'srvb:bindingCreated="false"');
    if (fault === 'binding-creator')
      binding.metadata = binding.metadata.replace('adtcore:createdBy="MARIAN"', 'adtcore:createdBy="OTHER"');
    if (fault === 'document-shorttext') doc.metadata += ' ';
    if (fault === 'source') h.world.objects.get(f[4].owner)!.source += '\nforeign';
    if (fault === 'late') {
      let n = 0;
      h.hooks.record = (v) => {
        if (v.retainedRead && ++n === 47) binding.metadata += ' ';
      };
    }
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.mutationDispatched).toBe(false);
    expect(r.remaining).toHaveLength(8);
    expect(h.world.calls.every((c) => c.method === 'GET')).toBe(true);
  },
);
it.each(
  [false, true].flatMap((proxy) => (['source', 'stop', 'deadline'] as const).map((fault) => [proxy, fault] as const)),
)('rechecks %s/%s at actual publication dispatch', async (proxy, fault) => {
  const h = retainedV4Harness(proxy);
  let armed = false,
    restore = () => {};
  h.hooks.record = (v) => {
    if (!armed && v.stage === 'request' && v.method === 'POST' && String(v.path).includes('/publishjobs')) {
      armed = true;
      if (fault === 'source') h.breakSource();
      if (fault === 'stop') h.stop();
      if (fault === 'deadline') {
        const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300000);
        restore = () => spy.mockRestore();
      }
    }
  };
  try {
    const r = await h.run();
    expect(armed).toBe(true);
    expect(r.failure).toBe(true);
    expect(r.remaining).toHaveLength(8);
    expect(h.world.calls.filter((c) => c.method === 'POST' && c.path.includes('/publishjobs'))).toEqual([]);
    expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
  } finally {
    restore();
  }
});
it.each([false, true])(
  'retains all owners after uncertain publication without replay or cleanup, proxy=%s',
  async (proxy) => {
    const h = retainedV4Harness(proxy),
      reply = h.hooks.reply!;
    h.hooks.reply = (u, m, b) =>
      m === 'POST' && u.pathname.endsWith('/publishjobs')
        ? { statusCode: 503, data: 'uncertain', responseOptions: { headers: { 'content-type': 'text/plain' } } }
        : reply(u, m, b);
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.mutationDispatched).toBe(true);
    expect(r.remaining).toHaveLength(8);
    expect(r.confirmedDeleted).toEqual([]);
    expect(h.world.calls.filter((c) => c.method === 'POST' && c.path.includes('/publishjobs'))).toHaveLength(1);
    expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
  },
);
it.each(['present', 'uncertain'] as const)(
  'preserves historical deletion and current terminal %s residual',
  async (fault) => {
    const h = retainedV4Harness(),
      reply = h.hooks.reply!;
    let final = false;
    h.hooks.record = (v) => {
      if (v.stageCompleted === 'delete-table') final = true;
    };
    h.hooks.reply = (u, m, b) =>
      final && m === 'GET' && u.pathname.toLowerCase() === f[0].owner.toLowerCase()
        ? {
            statusCode: fault === 'present' ? 200 : 503,
            data:
              fault === 'present'
                ? retainedV4Rows.find((v) => v.path.toLowerCase() === f[0].owner.toLowerCase())!.body
                : 'uncertain',
            responseOptions: { headers: { 'content-type': 'application/xml' } },
          }
        : reply(u, m, b);
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.confirmedDeleted).toContain(f[0].owner);
    expect(r.remaining).toContain(f[0].owner);
    expect(r.inspectionRequired).toContain(f[0].owner);
    expect(
      h.world.calls.filter((c) => c.method === 'DELETE' && c.path.toLowerCase().startsWith(f[0].owner.toLowerCase())),
    ).toHaveLength(1);
  },
);
it('no remaining stage can authorize prior activation, document PUT or collection create', () => {
  for (const stage of RAP_RETAINED_V4_STAGES) {
    expect(() => checkRapRequest(f, stage, 'PUT', f[6].owner + '?lockHandle=own', 'old', new Map(), 'old')).toThrow();
    expect(() =>
      checkRapRequest(f, stage, 'POST', '/sap/bc/adt/activation?method=activate&preauditRequested=true', 'old'),
    ).toThrow();
    expect(() => checkRapRequest(f, stage, 'POST', '/sap/bc/adt/businessservices/bindings', 'old')).toThrow();
  }
});

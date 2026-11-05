import { expect, it } from 'vitest';

import { RAP_APPROVE_TEXT } from '../../../scripts/qualification/pr1142/native-rap-retained-fixed.js';
import { RAP_RETAINED_V2_STAGES as RAP_RETAINED_STAGES } from '../../../scripts/qualification/pr1142/native-rap-retained-v2-fixed.js';

import {
  retainedFixtures as f,
  retainedV2Harness as retainedHarness,
  retainedV2Rows as retainedRows,
} from './pr1142-native-rap-retained-harness.js';

const { rapRetainedV2Preflight: rapRetainedPreflight } = await import(
  '../../../scripts/qualification/pr1142/native-rap-retained-runner.js'
);
const { documentNodes } = await import('../../../scripts/qualification/pr1142/native-rap-documents-evidence.js');
it.each([false, true])('runs captured retained graph through actual factory/client/driver; proxy=%s', async (proxy) => {
  const h = retainedHarness(proxy),
    r = await h.run();
  expect(r).toMatchObject({
    failure: false,
    completed: RAP_RETAINED_STAGES,
    remaining: [],
    finalAbsenceConfirmed: true,
    created: [f[4].owner, f[5].owner],
    observedRetainedWrites: ['update-document-create'],
    previousClaim: 'consumed-failed',
  });
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
  ).toHaveLength(0);
  const puts = h.world.calls.filter((c) => c.method === 'PUT' && c.path.startsWith(f[6].owner));
  expect(puts).toHaveLength(1);
  expect(r.completed).not.toContain('update-document-root');
  expect(r.completed).not.toContain('update-document-create');
  expect(r.completed).not.toContain('activate-document');
  expect(r.previousCompleted).toContain('activate-document');
  expect(r.previousCompleted).not.toContain('update-document-create');
  const initial = documentNodes(f[6], puts[0].body),
    last = documentNodes(f[6], puts[0].body),
    approve = `${f[3].owner}/source/main#type=BDEF/BAC;name=${f[3].name}.approve`;
  expect(initial.nodes.get(approve)?.text).toBe(RAP_APPROVE_TEXT);
  expect(last.nodes.get(approve)?.text).toBe(RAP_APPROVE_TEXT);
  expect(last.nodes.get(f[6].name)?.shortText).toBe('');
  expect(h.records.filter((v) => v.ownedDocumentParentTransition)).toEqual([
    expect.objectContaining({ relationPresent: false }),
  ]);
});
it.each(['active-content', 'active-state', 'draft-content'])(
  'refuses changed retained %s before any mutation',
  async (fault) => {
    const h = retainedHarness();
    if (fault === 'draft-content') h.world.objects.get(f[6].owner)!.metadata += ' ';
    else {
      const active = h.activeDocuments.get(f[6].owner)!;
      h.activeDocuments.set(
        f[6].owner,
        fault === 'active-state'
          ? active.replace('adtcore:version="active"', 'adtcore:version="inactive"')
          : `${active} `,
      );
    }
    const result = await h.run();
    expect(result.failure).toBe(true);
    expect(result.mutationDispatched).toBe(false);
    expect(result.remaining).toHaveLength(6);
    expect(h.world.calls.every((call) => call.method === 'GET')).toBe(true);
  },
);
it('performs a GET-only current proof with distinct observed active and inactive SKTD views', async () => {
  const h = retainedHarness();
  await rapRetainedPreflight(h.client, f, (v) => h.records.push(v), h.verify);
  expect(h.world.calls.every((c) => c.method === 'GET')).toBe(true);
  const doc = documentNodes(f[6], retainedRows.find((v) => v.path === `${f[6].owner}?version=active`)!.body);
  expect(doc.evidence.version).toBe('active');
});
it.each(['metadata', 'source', 'version', 'author', 'mandatory-action'])(
  'refuses %s drift without mutation and retains all known resources',
  async (fault) => {
    const h = retainedHarness(),
      doc = h.world.objects.get(f[6].owner)!;
    if (fault === 'metadata') doc.metadata = doc.metadata.replace('Documentation for', 'Changed documentation for');
    if (fault === 'source') h.world.objects.get(f[0].owner)!.source += '\nforeign';
    if (fault === 'version')
      doc.metadata = doc.metadata.replace('adtcore:version="inactive"', 'adtcore:version="active"');
    if (fault === 'author')
      doc.metadata = doc.metadata.replace('adtcore:createdBy="MARIAN"', 'adtcore:createdBy="OTHER"');
    if (fault === 'mandatory-action')
      doc.metadata = doc.metadata.replace('longTextObligation="mandatory"', 'longTextObligation="optional"');
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.mutationDispatched).toBe(false);
    expect(r.remaining).toHaveLength(6);
    expect(h.world.calls.every((c) => c.method === 'GET')).toBe(true);
  },
);
it('retains prior objects and the attempted document after an uncertain first PUT; never recreates', async () => {
  const h = retainedHarness(),
    reply = h.hooks.reply!;
  h.hooks.reply = (u, m, b) =>
    m === 'PUT' && u.pathname === f[6].owner
      ? { statusCode: 503, data: 'unknown', responseOptions: { headers: { 'content-type': 'text/plain' } } }
      : reply(u, m, b);
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.created).toEqual([]);
  expect(r.remaining).toHaveLength(6);
  expect(r.completed).toEqual([]);
  expect(h.world.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
});
it.each(['source', 'stop', 'metadata'])(
  'rejects %s drift after own lock with no PUT and own cleanup',
  async (fault) => {
    const h = retainedHarness();
    let armed = false;
    h.hooks.before = (u, init) => {
      if (!armed && init.method === 'POST' && u.pathname === f[6].owner && u.searchParams.get('_action') === 'LOCK') {
        armed = true;
        if (fault === 'source') h.breakSource();
        if (fault === 'stop') h.stop();
        if (fault === 'metadata')
          h.world.objects.get(f[6].owner)!.metadata = h.world.objects
            .get(f[6].owner)!
            .metadata.replace('Documentation for', 'changed Documentation for');
      }
    };
    const r = await h.run();
    expect(armed).toBe(true);
    expect(r.failure).toBe(true);
    expect(r.remaining).toHaveLength(6);
    expect(h.world.calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(h.world.calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
    expect(r.cleanupUnconfirmed).toBe(false);
  },
);

it.each([200, 503])('includes unexpectedly present/uncertain uncreated service in residuals (%s)', async (status) => {
  const h = retainedHarness(),
    reply = h.hooks.reply!;
  h.hooks.reply = (u, m, b) =>
    m === 'GET' && u.pathname === f[4].owner
      ? { statusCode: status, data: 'unexpected', responseOptions: { headers: { 'content-type': 'application/xml' } } }
      : reply(u, m, b);
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.remaining).toContain(f[4].owner);
  expect(r.inspectionRequired).toContain(f[4].owner);
  expect(r.mutationDispatched).toBe(false);
});
it('rejects post-read opaque drift before adopting production snapshots', async () => {
  const h = retainedHarness();
  let reads = 0;
  h.hooks.record = (row) => {
    if (row.retainedRead && ++reads === 38) {
      const p = h.world.objects.get(f[3].owner)!;
      p.metadata = p.metadata.replace(
        '</blue:blueSource>',
        '<opaque xmlns="urn:foreign">changed</opaque></blue:blueSource>',
      );
    }
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.mutationDispatched).toBe(false);
  expect(r.remaining).toHaveLength(6);
});

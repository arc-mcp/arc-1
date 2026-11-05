import { expect, it } from 'vitest';
import { graph, recoveryHarness } from './pr1142-native-package-recovery-harness.js';

const { packageGetOnlyPreflight } = await import('../../../scripts/qualification/pr1142/native-package-runner.js');
const { inspectRetainedPackages } = await import(
  '../../../scripts/qualification/pr1142/native-package-recovery-preflight.js'
);
const deletes = (h: ReturnType<typeof recoveryHarness>) => h.calls.filter((r) => r.method === 'DELETE');

it.each([false, true])('removes only the retained graph in dependency order through proxy=%s', async (proxy) => {
  const h = recoveryHarness({ proxy }),
    result = await h.run();
  expect(
    result,
    JSON.stringify(h.records.filter((r) => r.ownedSnapshot || r.ownedRead).map(({ body, ...r }) => r)),
  ).toMatchObject({
    failure: false,
    created: [],
    completed: ['delete-class', 'delete-child', 'delete-root'],
    remaining: [],
    expectedRefusals: [],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: true,
  });
  expect(result.confirmedDeleted).toEqual([graph.clas.owner, graph.child.owner, graph.root.owner]);
  expect(deletes(h).map((r) => r.path.split('?')[0])).toEqual(result.confirmedDeleted);
  expect(h.calls.filter((r) => r.path.includes('_action=LOCK'))).toHaveLength(3);
  expect(h.calls.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(3);
  expect(h.calls.filter((r) => r.path === '/sap/bc/adt/core/http/sessions')).toHaveLength(3);
  expect(
    h.calls.filter(
      (r) =>
        r.method === 'PUT' ||
        (r.method === 'POST' &&
          ['/sap/bc/adt/packages', '/sap/bc/adt/oo/classes', '/sap/bc/adt/activation'].includes(r.path)),
    ),
  ).toEqual([]);
  expect(JSON.stringify(h.records)).not.toMatch(/SECRET-HANDLE|SECRET-SESSION|UNRELATED_DRAFT/);
});
it('uses six bounded GETs to verify retained source/metadata and inventory without a write', async () => {
  const h = recoveryHarness();
  h.client.safety.allowWrites = false;
  await packageGetOnlyPreflight(
    h.client,
    graph,
    (r) => h.records.push(r),
    () => {},
    (client, options) => inspectRetainedPackages(client, graph, options, (r) => h.records.push(r)),
  );
  expect(h.calls).toHaveLength(6);
  expect(h.calls.every((r) => r.method === 'GET')).toBe(true);
  expect(JSON.stringify(h.records)).not.toContain('UNRELATED_DRAFT');
});
it.each(['source', 'parent', 'author', 'description', 'child', 'inactive'] as const)(
  'refuses retained %s drift before any DELETE',
  async (fault) => {
    const h = recoveryHarness();
    if (fault === 'source')
      h.hooks.reply = (r) =>
        r.method === 'GET' && r.path.includes('/source/main')
          ? { statusCode: 200, data: `${graph.clas.source}changed` }
          : undefined;
    else {
      const owner = fault === 'parent' ? graph.child : fault === 'inactive' ? graph.clas : graph.root;
      h.metadata[owner.owner] = h.metadata[owner.owner].replace(
        fault === 'parent'
          ? graph.root.name
          : fault === 'author'
            ? 'MARIAN'
            : fault === 'description'
              ? owner.description
              : fault === 'child'
                ? graph.child.name
                : 'adtcore:version="active"',
        fault === 'inactive' ? 'adtcore:version="inactive"' : 'CHANGED',
      );
    }
    expect((await h.run()).failure).toBe(true);
    expect(deletes(h)).toEqual([]);
  },
);
it('preserves confirmed class deletion when child DELETE is rejected; no parent replay or invented refusal', async () => {
  const h = recoveryHarness();
  h.hooks.reply = (r) =>
    r.method === 'DELETE' && r.path.startsWith(graph.child.owner)
      ? { statusCode: 400, data: '<unknown>synthetic rejection</unknown>' }
      : undefined;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.confirmedDeleted).toEqual([graph.clas.owner]);
  expect(result.remaining).toEqual([graph.root.owner, graph.child.owner]);
  expect(result.expectedRefusals).toEqual([]);
  expect(deletes(h)).toHaveLength(2);
  expect(result.cleanupUnconfirmed).toBe(false);
  expect(
    h.records.some(
      (r) => r.nativeDeleteDiagnostic?.status === 400 && r.nativeDeleteDiagnostic.shape === 'unrecognized',
    ),
  ).toBe(true);
});
it('does not interpret generic service 404 as post-delete absence', async () => {
  const h = recoveryHarness();
  let sent = false;
  h.hooks.before = (r) => {
    if (r.method === 'DELETE') sent = true;
  };
  h.hooks.reply = (r) =>
    sent && r.method === 'GET' && r.path.startsWith(graph.clas.owner)
      ? { statusCode: 404, data: 'unavailable service' }
      : undefined;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.confirmedDeleted).toEqual([]);
  expect(result.adapterReportedDeleted).toEqual([]);
  expect(deletes(h)).toHaveLength(1);
});
it('retains confirmed facts when final inventory is uncertain', async () => {
  const h = recoveryHarness();
  h.hooks.reply = (r) =>
    h.existing.size === 0 && r.path.endsWith('/inactiveobjects') ? { statusCode: 200, data: '<wrong/>' } : undefined;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.confirmedDeleted).toHaveLength(3);
  expect(result.remaining).toEqual([]);
  expect(result.finalAbsenceConfirmed).toBe(false);
});
it('stops after an unconfirmed owning unlock', async () => {
  const h = recoveryHarness();
  h.hooks.reply = (r) => (r.path.includes('_action=UNLOCK') ? { statusCode: 500, data: 'unlock failed' } : undefined);
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.cleanupUnconfirmed).toBe(true);
  expect(deletes(h)).toHaveLength(1);
});

it('refuses a stale positive child reference after confirmed child deletion', async () => {
  const h = recoveryHarness();
  h.hooks.reply = (r) =>
    !h.existing.has(graph.child.owner) && r.method === 'GET' && r.path === graph.root.owner
      ? { statusCode: 200, data: h.metadata[graph.root.owner] }
      : undefined;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.confirmedDeleted).toEqual([graph.clas.owner, graph.child.owner]);
  expect(deletes(h)).toHaveLength(2);
  expect(result.remaining).toEqual([graph.root.owner]);
});

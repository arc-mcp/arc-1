import { expect, it } from 'vitest';
import { graph, harness, nonempty, packageMetadata } from './pr1142-native-package-harness.js';

it('qualifies the actual private writers and owning native refusal/changed-state cleanup with no sockets', async () => {
  const h = harness(),
    result = await h.run();
  expect(result, JSON.stringify({ result, last: h.records.slice(-8), calls: h.calls.slice(-8) })).toMatchObject({
    failure: false,
    finalAbsenceConfirmed: true,
    remaining: [],
    cleanupUnconfirmed: false,
  });
  expect(result.expectedRefusals).toHaveLength(2);
  expect(result.confirmedDeleted).toEqual([graph.clas.owner, graph.child.owner, graph.root.owner]);
  expect(h.calls.filter((r) => r.method === 'DELETE').map((r) => r.path.split('?')[0])).toEqual([
    graph.root.owner,
    graph.child.owner,
    graph.clas.owner,
    graph.child.owner,
    graph.root.owner,
  ]);
  expect(h.existing.size).toBe(0);
  expect(JSON.stringify(h.records)).not.toMatch(/SECRET-HANDLE|SECRET-SESSION|SYNTHETIC-PASSWORD|UNRELATED_DRAFT/);
});
it('diagnoses package snapshot input', async () => {
  const h = harness();
  h.existing.add(graph.root.owner);
  const { packageSnapshot } = await import('../../../scripts/qualification/pr1142/native-package-evidence.js');
  await packageSnapshot(
    h.client,
    graph.root,
    graph,
    { deadline: Date.now() + 10000, noReplay: true, retryTransientErrors: false },
    () => {},
  );
});

it.each([403, 500])('stops on an unclassified native DELETE %s after owning cleanup without retry', async (status) => {
  const h = harness();
  h.hooks.reply = (r) =>
    r.method === 'DELETE' ? { statusCode: status, data: 'Unclassified SECRET-HANDLE' } : undefined;
  const result = await h.run();
  expect(result).toMatchObject({
    failure: true,
    stoppedAt: 'refuse-root-child',
    expectedRefusals: [],
    cleanupUnconfirmed: false,
  });
  expect(h.calls.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  expect(h.existing.size).toBe(3);
  expect(result.remaining).toHaveLength(3);
  expect(JSON.stringify(h.records)).not.toContain('SECRET-HANDLE');
});
it('does not treat the native message alone as survivor evidence', async () => {
  const h = harness();
  h.hooks.before = (r) => {
    if (r.method === 'DELETE' && r.path.startsWith(graph.root.owner)) h.existing.delete(graph.root.owner);
  };
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.expectedRefusals).toEqual([]);
  expect(h.calls.filter((r) => r.method === 'DELETE')).toHaveLength(1);
});
it('stops after uncertain UNLOCK on an otherwise expected native nonempty refusal', async () => {
  const h = harness();
  let negative = false;
  h.hooks.before = (r) => {
    if (r.method === 'DELETE') negative = true;
  };
  h.hooks.reply = (r) =>
    negative && r.path.includes('_action=UNLOCK') ? { statusCode: 503, data: 'unconfirmed' } : undefined;
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, cleanupUnconfirmed: true, expectedRefusals: [] });
  expect(h.calls.filter((r) => r.method === 'DELETE')).toHaveLength(1);
});
it('refuses metadata drift before the first negative DELETE', async () => {
  const h = harness();
  let negative = false;
  h.hooks.record = (r) => {
    if (r.stageStarted === 'refuse-root-child') negative = true;
  };
  h.hooks.reply = (r) =>
    negative && r.method === 'GET' && r.path === graph.root.owner
      ? { statusCode: 200, data: packageMetadata(graph.root, true).replace('ARC1 PK root', 'Foreign change') }
      : undefined;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(h.calls.filter((r) => r.method === 'DELETE')).toHaveLength(0);
  expect(h.existing.size).toBe(3);
});
it('checks source again after the cold CSRF wait before first CREATE dispatch', async () => {
  const h = harness();
  h.hooks.before = (r) => {
    if (r.method === 'HEAD') h.breakSource();
  };
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(h.calls.some((r) => r.method === 'POST')).toBe(false);
});
it('keeps owning UNLOCK and session close available after cancellation following LOCK', async () => {
  const h = harness();
  h.hooks.before = (r) => {
    if (r.path.includes('_action=LOCK')) h.stop();
  };
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, stopped: true, cleanupUnconfirmed: false });
  expect(h.calls.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  expect(h.calls.some((r) => r.path === '/sap/bc/adt/core/http/sessions')).toBe(true);
  expect(h.calls.some((r) => r.method === 'PUT' || r.method === 'DELETE')).toBe(false);
});
it('retains confirmed deletions while failing a source change during terminal inventory', async () => {
  const h = harness();
  h.hooks.before = (r) => {
    if (r.path === '/sap/bc/adt/activation/inactiveobjects' && h.calls.some((c) => c.method === 'DELETE'))
      h.breakSource();
  };
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, finalAbsenceConfirmed: false, stoppedAt: 'terminal-binding' });
  expect(result.confirmedDeleted).toHaveLength(3);
  expect(result.inspectionRequired).toHaveLength(3);
  expect(h.existing.size).toBe(0);
});
it('refuses a repeated class CREATE after a native 415', async () => {
  const h = harness();
  h.hooks.reply = (r) =>
    r.method === 'POST' && r.path === '/sap/bc/adt/oo/classes' ? { statusCode: 415, data: 'unsupported' } : undefined;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(h.calls.filter((r) => r.method === 'POST' && r.path === '/sap/bc/adt/oo/classes')).toHaveLength(1);
  expect(h.calls.some((r) => r.method === 'DELETE')).toBe(false);
});
it('does not expose a handle echoed in a typed native negative response', async () => {
  const h = harness();
  h.hooks.reply = (r) =>
    r.method === 'DELETE' && h.existing.has(graph.child.owner) && r.path.startsWith(graph.root.owner)
      ? {
          statusCode: 500,
          data: nonempty(graph.root).replace(
            `Package ${graph.root.name} still contains development objects or other packages.`,
            'Echo SECRET-HANDLE',
          ),
        }
      : undefined;
  expect((await h.run()).failure).toBe(false);
  expect(JSON.stringify(h.records)).not.toContain('SECRET-HANDLE');
});
it('keeps actual native refusal separate from the production browser shortcut', async () => {
  const h = harness();
  await h.run();
  const first = h.calls.findIndex((r) => r.method === 'DELETE'),
    second = h.calls.findIndex((r, i) => i > first && r.method === 'DELETE');
  expect(h.calls.slice(0, second).some((r) => r.path.includes('nodestructure'))).toBe(false);
  expect(h.calls.slice(second).some((r) => r.path.includes('nodestructure'))).toBe(true);
});
it('retains separate owning cleanup capacity after the main response budget is exhausted', async () => {
  const h = harness();
  let locked = false;
  h.hooks.before = (r) => {
    if (r.path.includes('_action=LOCK')) locked = true;
  };
  h.hooks.reply = (r) =>
    locked && r.method === 'GET' && r.path === graph.clas.owner
      ? { statusCode: 200, data: 'x'.repeat(2 * 1024 * 1024) }
      : undefined;
  const result = await h.run();
  expect(result).toMatchObject({ failure: true, cleanupUnconfirmed: false });
  expect(h.calls.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  expect(h.calls.at(-1)?.path).toBe('/sap/bc/adt/core/http/sessions');
  expect(h.calls.some((r) => r.method === 'DELETE')).toBe(false);
});

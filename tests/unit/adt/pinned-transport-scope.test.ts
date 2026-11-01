import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { preparePinnedTransport } from '../../../src/adt/pinned-transport-scope.js';
import { checkTransport, type SafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import {
  checkRecursiveTransportReleaseScope,
  createTransport,
  deleteTransport,
  reassignTransport,
  releaseTransport,
  releaseTransportAndWait,
  releaseTransportRecursive,
  removeObjectFromTransport,
} from '../../../src/adt/transport.js';

const parent = 'DEVK900001';
const task = 'DEVK900002';
const other = 'DEVK900003';
const envelope = (body: string) => `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm">${body}</tm:root>`;
const tree = (tasks = `<tm:task tm:number="${task}" tm:status="D"/>`, type = 'K', status = 'D') =>
  envelope(`<tm:request tm:number="${parent}" tm:type="${type}" tm:status="${status}">${tasks}</tm:request>`);
const response = (body: string) => ({ statusCode: 200, headers: {}, body });
function setup(body = tree(), overrides: Partial<SafetyConfig> = {}) {
  const safety: SafetyConfig = {
    ...unrestrictedSafetyConfig(),
    multiTargetWrite: {
      enabled: true,
      target: 'DEV/001',
      allowedPackages: ['$TMP'],
      allowedTransports: [parent],
      serverAllowedTransports: [parent],
    },
    ...overrides,
  };
  const http = {
    get: vi.fn().mockResolvedValue(response(body)),
    post: vi.fn().mockResolvedValue(response('')),
    put: vi.fn().mockResolvedValue(response('')),
    delete: vi.fn().mockResolvedValue(response('')),
  } as unknown as AdtHttpClient;
  const signal = new AbortController();
  const context = pinnedMutationContext(
    safety,
    { deadline: Date.now() + 300_000, signal: signal.signal },
    { unlockFailed: false },
  );
  return { safety, http, context, signal };
}

describe('pinned CTS request scope', () => {
  it('does not treat the empty read whitelist as write authority', async () => {
    const { safety, http } = setup();
    expect(() => checkTransport(safety, 'OTHER', 'GetTransport', false)).not.toThrow();
    for (const [id, op] of [
      ['', 'CreateTransport'],
      [parent, 'ReleaseTransport'],
      [task, 'DeleteTransport'],
    ])
      expect(() => checkTransport(safety, id, op, true, http)).toThrow('Missing verified');
    await expect(createTransport(http, safety, 'test')).rejects.toThrow('Missing verified');
    expect(http.post).not.toHaveBeenCalled();
    expect(() => checkRecursiveTransportReleaseScope(safety)).toThrow('Missing verified');
  });

  it('requires capability before reading native membership', async () => {
    for (const missing of ['allowWrites', 'allowTransportWrites', 'destination'] as const) {
      const { http, safety } = setup();
      if (missing === 'destination') safety.multiTargetWrite = { ...safety.multiTargetWrite!, allowedTransports: [] };
      else safety[missing] = false;
      const context = pinnedMutationContext(safety, { deadline: Date.now() + 300_000 }, { unlockFailed: false });
      await expect(preparePinnedTransport(http, safety, context, 'delete', parent)).rejects.toThrow();
      expect(http.get).not.toHaveBeenCalled();
    }
  });

  it('authorizes the native parent against both policies and submits only verified tasks', async () => {
    const { http, safety, context } = setup();
    const prepared = await preparePinnedTransport(http, safety, context, 'reassign', task);
    expect(prepared.parentId).toBe(parent);
    expect(prepared.verifiedIds).toEqual([parent, task]);
    await reassignTransport(prepared.http, prepared.safety, task, 'DEVUSER');
    expect(http.put).toHaveBeenCalledTimes(1);
    expect(vi.mocked(http.put).mock.calls[0][0]).toContain(task);
    expect(vi.mocked(http.put).mock.calls[0][4]).toMatchObject(context.requestPolicy);
    expect(() => checkTransport(prepared.safety, other, 'ReassignTransport', true, prepared.http)).toThrow(
      'outside verified',
    );
    expect(() => checkTransport(prepared.safety, task, 'DeleteTransport', true, prepared.http)).toThrow('action scope');
  });

  it.each(['global', 'destination', 'task-only'] as const)('refuses a denied canonical parent: %s', async (where) => {
    const { http, safety } = setup();
    safety.multiTargetWrite = {
      ...safety.multiTargetWrite!,
      ...(where === 'global'
        ? { serverAllowedTransports: [other] }
        : { allowedTransports: [where === 'task-only' ? task : other] }),
    };
    const context = pinnedMutationContext(safety, { deadline: Date.now() + 300_000 }, { unlockFailed: false });
    await expect(preparePinnedTransport(http, safety, context, 'delete', task)).rejects.toThrow(
      'both server and destination',
    );
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('does not accept fabricated, copied, differently scoped or raw-HTTP membership', async () => {
    const { http, safety, context } = setup();
    const prepared = await preparePinnedTransport(http, safety, context, 'delete', parent);
    for (const candidate of [safety, { ...prepared.safety }, JSON.parse(JSON.stringify(prepared.safety))])
      expect(() => checkTransport(candidate, parent, 'DeleteTransport', true, prepared.http)).toThrow(
        'Missing verified',
      );
    expect(() => checkTransport(prepared.safety, parent, 'DeleteTransport', true, http)).toThrow('Missing verified');
    const foreign = setup();
    await expect(preparePinnedTransport(foreign.http, foreign.safety, context, 'delete', parent)).rejects.toThrow(
      'mismatched',
    );
  });

  it('resolves sibling task evidence through a separate parent read, sharing one request budget', async () => {
    const { http, safety, context } = setup();
    vi.mocked(http.get)
      .mockResolvedValueOnce(response(envelope(`<tm:task tm:number="${task}" tm:parent="${parent}" tm:status="D"/>`)))
      .mockResolvedValueOnce(response(tree()));
    const prepared = await preparePinnedTransport(http, safety, context, 'delete', task);
    expect(prepared.verifiedIds).toEqual([parent, task]);
    expect(http.get).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(http.get).mock.calls) expect(call[2]).toMatchObject(context.requestPolicy);
  });

  it('does not equate management membership with a modifiable Workbench recording', async () => {
    const { http, safety, context } = setup(tree('', 'W', 'R'));
    const prepared = await preparePinnedTransport(http, safety, context, 'release', parent);
    expect(prepared.verifiedIds).toEqual([parent]); // Native type/state belongs to the operation adapter.
  });

  it.each([
    ['missing', envelope('')],
    ['wrong parent', tree(`<tm:task tm:number="${task}" tm:parent="OTHER"/>`)],
    ['duplicate task', tree(`<tm:task tm:number="${task}"/><tm:task tm:number="${task}"/>`)],
    ['task equals parent', tree(`<tm:task tm:number="${parent}"/>`)],
    ['duplicate parent', envelope(`<tm:request tm:number="${parent}"/><tm:request tm:number="${parent}"/>`)],
    ['invalid task id', tree('<tm:task tm:number="../escape"/>')],
    ['oversized', 'x'.repeat(1024 * 1024 + 1)],
    ['too many tasks', tree(Array.from({ length: 257 }, (_, i) => `<tm:task tm:number="T${i}"/>`).join(''))],
  ])('refuses ambiguous/unbounded native evidence: %s', async (_label, body) => {
    const { http, safety, context } = setup(body);
    await expect(preparePinnedTransport(http, safety, context, 'delete', parent)).rejects.toThrow();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('refuses a task which disappears from its independently fetched parent', async () => {
    const { http, safety, context } = setup();
    vi.mocked(http.get)
      .mockResolvedValueOnce(response(envelope(`<tm:task tm:number="${task}" tm:parent="${parent}"/>`)))
      .mockResolvedValueOnce(response(tree('')));
    await expect(preparePinnedTransport(http, safety, context, 'delete', task)).rejects.toThrow('absent');
  });

  it.each([
    [[], ['*'], true],
    [['*'], ['*'], true],
    [['DEV*'], ['*'], false],
    [[], ['DEV*'], false],
    [[], [parent], false],
    [[], [], false],
    [['*', '__ARC1_DENY_ALL__'], ['*'], false],
    [[], ['*', '__ARC1_DENY_ALL__'], false],
  ] as const)(
    'requires pre-ID create admission: global=%j destination=%j allowed=%s',
    async (global, destination, allowed) => {
      const { http, safety } = setup();
      safety.multiTargetWrite = {
        ...safety.multiTargetWrite!,
        serverAllowedTransports: global,
        allowedTransports: destination,
      };
      const context = pinnedMutationContext(safety, { deadline: Date.now() + 300_000 }, { unlockFailed: false });
      const pending = preparePinnedTransport(http, safety, context, 'create');
      if (!allowed) await expect(pending).rejects.toThrow();
      else {
        const prepared = await pending;
        expect(() => checkTransport(prepared.safety, '', 'CreateTransport', true, prepared.http)).not.toThrow();
        expect(() => checkTransport(prepared.safety, parent, 'DeleteTransport', true, prepared.http)).toThrow();
      }
      expect(http.get).not.toHaveBeenCalled();
      expect(http.post).not.toHaveBeenCalled();
    },
  );

  it('keeps recursive release legacy restrictions, but accepts a verified pinned exact parent', async () => {
    expect(() =>
      checkRecursiveTransportReleaseScope({ ...unrestrictedSafetyConfig(), allowedTransports: [parent] }),
    ).toThrow('restrictive');
    const { http, safety, context } = setup();
    const prepared = await preparePinnedTransport(http, safety, context, 'release_recursive', parent);
    expect(() => checkRecursiveTransportReleaseScope(prepared.safety)).not.toThrow();
    await expect(preparePinnedTransport(http, safety, context, 'release_recursive', task)).rejects.toThrow(
      'canonical parent',
    );
    expect(() => checkTransport(prepared.safety, task, 'ReleaseTransportRecursive', true, prepared.http)).toThrow(
      'canonical parent',
    );
    expect(() => checkTransport(prepared.safety, task, 'ReleaseTransport', true, prepared.http)).not.toThrow();
  });

  it('refuses newly observed children before any recursive-release submission', async () => {
    const { http, safety, context } = setup();
    const prepared = await preparePinnedTransport(http, safety, context, 'release_recursive', parent);
    vi.mocked(http.get).mockResolvedValue(
      response(tree(`<tm:task tm:number="${task}" tm:status="D"/><tm:task tm:number="${other}" tm:status="D"/>`)),
    );
    await expect(releaseTransportRecursive(prepared.http, prepared.safety, parent)).rejects.toThrow('outside verified');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('keeps child deletion inside the original membership when the request changes mid-call', async () => {
    const { http, safety, context } = setup();
    const prepared = await preparePinnedTransport(http, safety, context, 'delete', parent);
    vi.mocked(http.get).mockResolvedValue(
      response(tree(`<tm:task tm:number="${task}" tm:status="D"/><tm:task tm:number="${other}" tm:status="D"/>`)),
    );
    await expect(deleteTransport(prepared.http, prepared.safety, parent, true)).rejects.toThrow('outside verified');
    expect(http.delete).not.toHaveBeenCalled();
  });

  it.each(['delete', 'cleanup', 'reassign'] as const)(
    'validates all children before the first irreversible operation: %s',
    async (action) => {
      const { http, safety, context } = setup();
      const prepared = await preparePinnedTransport(
        http,
        safety,
        context,
        action === 'reassign' ? action : 'delete',
        parent,
      );
      vi.mocked(http.get).mockResolvedValue(
        response(
          tree(
            `<tm:task tm:number="${task}" tm:status="D"><tm:abap_object tm:pgmid="LIMU" tm:type="REPS" tm:name="ZPROG" tm:position="000001" tm:lock_status="X"/></tm:task><tm:task tm:number="${other}" tm:status="D"/>`,
          ),
        ),
      );
      const operation =
        action === 'reassign'
          ? reassignTransport(prepared.http, prepared.safety, parent, 'DEVUSER', true)
          : deleteTransport(prepared.http, prepared.safety, parent, action === 'delete', true);
      await expect(operation).rejects.toThrow('outside verified');
      expect(http.delete).not.toHaveBeenCalled();
      expect(http.put).not.toHaveBeenCalled();
    },
  );

  it.each(['delete', 'reassign', 'release', 'remove_object'] as const)(
    'cannot widen a selected task to its parent or sibling: %s',
    async (action) => {
      const { http, safety, context } = setup(tree(`<tm:task tm:number="${task}"/><tm:task tm:number="${other}"/>`));
      const prepared = await preparePinnedTransport(http, safety, context, action, task);
      const operation = {
        delete: 'DeleteTransport',
        reassign: 'ReassignTransport',
        release: 'ReleaseTransport',
        remove_object: 'RemoveTransportObject',
      }[action];
      for (const id of [parent, other])
        expect(() => checkTransport(prepared.safety, id, operation, true, prepared.http)).toThrow('selected resource');
    },
  );

  it.each(
    (['delete', 'reassign'] as const).flatMap((action) =>
      (['added', 'omitted', 'conflict', 'duplicate'] as const).map((shape) => ({ action, shape })),
    ),
  )('refuses $shape second-read membership before any $action mutation', async ({ action, shape }) => {
    const { http, safety, context } = setup();
    const prepared = await preparePinnedTransport(http, safety, context, action, parent);
    const body =
      shape === 'omitted'
        ? tree('')
        : envelope(
            `<tm:request tm:number="${parent}"><tm:task tm:number="${task}" tm:status="D"/></tm:request>` +
              `<tm:task tm:number="${shape === 'added' ? other : task}" tm:parent="${shape === 'conflict' ? other : parent}" tm:status="D"/>`,
          );
    vi.mocked(http.get).mockResolvedValue(response(body));
    await expect(
      action === 'delete'
        ? deleteTransport(prepared.http, prepared.safety, parent, true, true)
        : reassignTransport(prepared.http, prepared.safety, parent, 'DEVUSER', true),
    ).rejects.toThrow(/outside verified|omitted verified|duplicate|conflicting/);
    expect(http.put).not.toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
  });

  it('accepts a nested task whose parent attribute is explicitly empty', async () => {
    const { http, safety, context } = setup(tree(`<tm:task tm:number="${task}" tm:parent=""/>`));
    expect((await preparePinnedTransport(http, safety, context, 'delete', parent)).verifiedIds).toEqual([parent, task]);
  });

  it('distinguishes a cancelled unsent task from the earlier release submission', async () => {
    const { http, safety, context, signal } = setup(
      tree(`<tm:task tm:number="${task}" tm:status="D"/><tm:task tm:number="${other}" tm:status="D"/>`),
    );
    const prepared = await preparePinnedTransport(http, safety, context, 'release_recursive', parent);
    vi.mocked(http.post).mockImplementation(async () => {
      signal.abort();
      return response('');
    });
    const result = await releaseTransportRecursive(prepared.http, prepared.safety, parent);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(result.submissions).toHaveLength(2);
    expect(result.submissions[0].notSubmitted).toBeUndefined();
    expect(result.submissions[1]).toMatchObject({ id: other, notSubmitted: true });
    expect(result.lastReadError).toContain('admission refused before submission');
  });

  it('separates a parent-only release and delete cleanup from other submissions', async () => {
    const { http, safety, context } = setup();
    const release = await preparePinnedTransport(http, safety, context, 'release', parent);
    await expect(releaseTransport(release.http, release.safety, task)).rejects.toThrow('selected resource');
    const deletion = await preparePinnedTransport(http, safety, context, 'delete', parent);
    await expect(
      removeObjectFromTransport(deletion.http, deletion.safety, parent, 'LIMU', 'REPS', 'ZPROG'),
    ).rejects.toThrow('action scope');
  });

  it('refuses conflicting root-level parent evidence for a nested task', async () => {
    const { http, safety, context } = setup(
      envelope(
        `<tm:request tm:number="${parent}"><tm:task tm:number="${task}"/></tm:request><tm:task tm:number="${task}" tm:parent="${other}"/>`,
      ),
    );
    await expect(preparePinnedTransport(http, safety, context, 'delete', parent)).rejects.toThrow(
      'conflicting parents',
    );
  });

  it('accepts standalone task evidence only after independently reading its parent tree', async () => {
    const { http, safety, context } = setup();
    vi.mocked(http.get).mockResolvedValueOnce(
      response(`<tm:task xmlns:tm="http://www.sap.com/cts/adt/tm" tm:number="${task}" tm:parent="${parent}"/>`),
    );
    const prepared = await preparePinnedTransport(http, safety, context, 'reassign', task);
    expect(prepared.verifiedIds).toEqual([parent, task]);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('recognizes the committed A4H native fixture as membership evidence without qualifying its release state', async () => {
    const body = readFileSync(new URL('../../fixtures/xml/transport-released-a4h-758.xml', import.meta.url), 'utf8');
    const { http, safety, context } = setup(body, {
      multiTargetWrite: {
        enabled: true,
        target: 'A4H/001',
        allowedPackages: ['$TMP'],
        allowedTransports: ['A4HK906291'],
        serverAllowedTransports: ['A4HK906291'],
      },
    });
    expect((await preparePinnedTransport(http, safety, context, 'reassign', 'A4HK906291')).verifiedIds).toEqual([
      'A4HK906291',
      'A4HK906292',
    ]);
  });

  it.each(['delete', 'reassign'] as const)(
    'refuses a second-read parser that omits root-level tasks: %s',
    async (action) => {
      const { http, safety, context } = setup(
        envelope(`<tm:request tm:number="${parent}"/><tm:task tm:number="${task}" tm:parent="${parent}"/>`),
      );
      const prepared = await preparePinnedTransport(http, safety, context, action, parent);
      await expect(
        action === 'delete'
          ? deleteTransport(prepared.http, prepared.safety, parent, true)
          : reassignTransport(prepared.http, prepared.safety, parent, 'DEVUSER', true),
      ).rejects.toThrow('omitted verified');
      expect(http.put).not.toHaveBeenCalled();
      expect(http.delete).not.toHaveBeenCalled();
    },
  );

  it('stops release convergence on context cancellation even when no wait signal was supplied', async () => {
    const { http, safety, context, signal } = setup();
    const prepared = await preparePinnedTransport(http, safety, context, 'release', parent);
    vi.mocked(http.post).mockImplementation(async () => {
      signal.abort();
      return response('');
    });
    const sleep = vi.fn().mockRejectedValue(new Error('Unexpected wait after cancellation'));
    const result = await releaseTransportAndWait(prepared.http, prepared.safety, parent, { sleep });
    expect(result.outcome).toBe('unknown');
    expect(result.lastReadError).toContain('aborted');
    expect(result.submissions).toHaveLength(1);
    expect(result.submissions[0].notSubmitted).toBeUndefined();
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('caps the convergence loop by the context deadline and clock', async () => {
    vi.useFakeTimers();
    try {
      const { http, safety } = setup();
      const start = Date.now();
      const context = pinnedMutationContext(safety, { deadline: start + 15 }, { unlockFailed: false });
      const prepared = await preparePinnedTransport(http, safety, context, 'release', parent);
      const sleep = vi.fn(async () => {
        vi.setSystemTime(start + 20);
      });
      const result = await releaseTransportAndWait(prepared.http, prepared.safety, parent, {
        deadline: start + 300_000,
        now: () => start,
        sleep,
      });
      expect(result.verified).toBe(false);
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(http.post).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('checks full CTS object membership then bounds the remove-object PUT', async () => {
    const { http, safety, context } = setup(
      tree(
        `<tm:task tm:number="${task}" tm:status="D"><tm:abap_object tm:pgmid="LIMU" tm:type="REPS" tm:name="ZPROG" tm:position="000001"/></tm:task>`,
      ),
    );
    const prepared = await preparePinnedTransport(http, safety, context, 'remove_object', parent);
    await expect(
      removeObjectFromTransport(prepared.http, prepared.safety, parent, 'R3TR', 'REPS', 'ZPROG'),
    ).rejects.toThrow('not in transport');
    expect(http.put).not.toHaveBeenCalled();
    await removeObjectFromTransport(prepared.http, prepared.safety, parent, 'LIMU', 'REPS', 'ZPROG');
    expect(vi.mocked(http.put).mock.calls[0][4]).toMatchObject(context.requestPolicy);
  });

  it('cannot reuse verified membership after cancellation', async () => {
    const { http, safety, context, signal } = setup();
    const prepared = await preparePinnedTransport(http, safety, context, 'release', parent);
    signal.abort();
    await expect(releaseTransport(prepared.http, prepared.safety, parent)).rejects.toThrow();
    expect(http.post).not.toHaveBeenCalled();
  });
});

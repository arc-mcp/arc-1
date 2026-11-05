import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertRetainedObservation,
  retainedDescriptor,
  retainedPlan,
} from '../../../scripts/qualification/pr1142/current-retained-history.mjs';
import { verifyCurrentCatalog } from '../../../scripts/qualification/pr1142/current-workflow-catalog.mjs';
import {
  currentPlan,
  makeCurrentManifest,
  sha,
  validateCurrentBindings,
  validateCurrentManifest,
  verifyCurrentRecording,
} from '../../../scripts/qualification/pr1142/current-workflow-contract.mjs';
import { readCurrentControls } from '../../../scripts/qualification/pr1142/current-workflow-controls.mjs';
import { loginScope } from '../../../scripts/qualification/pr1142/login-scopes.mjs';
import { McpSession } from '../../../scripts/qualification/pr1142/mcp-checks.mjs';
import { qualify } from '../../../scripts/qualification/pr1142/qualification.mjs';
import { currentPpCatalog } from '../../helpers/current-pp-catalog.js';
import { fixture, retainedFixture } from './pr1142-current-workflow-harness.js';

afterEach(() => vi.unstubAllGlobals());

describe('current PP named profiles and exact contracts', () => {
  it.each([
    ['read', 'read'],
    ['read-write', 'read write'],
    ['read-write-transports', 'read write transports'],
  ])('accepts only named profile %s', (scopeProfile, expected) => expect(loginScope({ scopeProfile })).toBe(expected));
  it.each([
    { scopeProfile: 'admin' },
    { scopeProfile: '__proto__' },
    { scopeProfile: 'read', readOnly: false },
    { scopes: 'read write transports admin' },
    { scope: 'write' },
  ])('refuses scope pollution %j', (value) => expect(() => loginScope(value)).toThrow());
  it('preserves legacy login behavior', () => {
    expect(loginScope({})).toBe('read write');
    expect(loginScope({ readOnly: true })).toBe('read');
  });
  it('binds the four fixed fixtures and exact recorded context', () => {
    const f = fixture();
    expect(validateCurrentManifest(f.manifest, f.config, f.run.sourceRevision)).toBe(sha(f.manifest));
    f.manifest.fixtures[0].package = '$TMP';
    expect(() => validateCurrentManifest(f.manifest, f.config, f.run.sourceRevision)).toThrow();
  });
  it.each(['$TMP', 'ZARC1/**', '*', '/NAMESPACE/PACKAGE'])('refuses an unqualified or wildcard package %s', (pkg) => {
    const f = fixture();
    f.manifest.bindings.recording.package = pkg;
    expect(() => validateCurrentBindings(f.manifest.bindings, f.run.sourceRevision)).toThrow();
  });
  it('does not confuse an unrelated task with the exact task', () => {
    const f = fixture();
    f.request.tasks[0].id = 'A4HK900003';
    expect(() => verifyCurrentRecording(f.request, f.manifest)).toThrow();
  });
  it('does not accept a recording entry for a wrong native object type', () => {
    const f = fixture();
    f.request.tasks[0].objects.push({ pgmid: 'R3TR', type: 'PROG', name: f.manifest.fixtures[0].name });
    expect(() => verifyCurrentRecording(f.request, f.manifest, [f.manifest.fixtures[0]])).toThrow();
  });
});

describe('production recording-only catalog composition', () => {
  it.each([['read', 'write', 'transports'], ['read', 'write'], ['read']])(
    'keeps management closed for %j',
    (...scopes) => {
      const { config, tools } = currentPpCatalog(scopes);
      expect(config.allowTransportWrites).toBe(false);
      expect(config.multiTargetWrite?.allowedTransports).toEqual(['A4HK900001']);
      expect(config.multiTargetWrite?.serverAllowedTransports).toEqual(['A4HK900001']);
      const actor = {
        label: scopes.includes('transports') ? 'writerA' : scopes.includes('write') ? 'writerB' : 'readerA',
        write: scopes.includes('write'),
      };
      expect(() => verifyCurrentCatalog(tools, actor, fixture().manifest)).not.toThrow();
    },
  );
  it('does not mistake a management-enabled catalog for proof of authorization to create a fresh request', () => {
    const { config, tools } = currentPpCatalog(['read', 'write', 'transports'], { management: true });
    expect(config.multiTargetWrite?.allowedTransports).toEqual(['A4HK900001']);
    const actions = (tools.find((t) => t.name === 'SAPTransport')!.inputSchema.properties as any).action.enum;
    expect(actions).toEqual(
      expect.arrayContaining(['create', 'release', 'release_recursive', 'delete', 'reassign', 'remove_object']),
    );
    expect(() => verifyCurrentCatalog(tools, { label: 'writerA', write: true }, fixture().manifest)).toThrow(
      'CURRENT_RECORDING_ONLY_CATALOG_MISMATCH',
    );
  });
  it.each(['missing', 'duplicate', 'no-get', 'malformed'])('refuses a %s transport catalog', (variant) => {
    const { tools } = currentPpCatalog(['read', 'write', 'transports']);
    const index = tools.findIndex((t) => t.name === 'SAPTransport');
    if (variant === 'missing') tools.splice(index, 1);
    else if (variant === 'duplicate') tools.push(structuredClone(tools[index]));
    else (tools[index].inputSchema.properties as any).action.enum = variant === 'no-get' ? ['list'] : 'get';
    expect(() => verifyCurrentCatalog(tools, { label: 'writerA', write: true }, fixture().manifest)).toThrow(
      'CURRENT_RECORDING_ONLY_CATALOG_MISMATCH',
    );
  });
});

describe('real qualifier entry → McpSession → bounded HTTP composition', () => {
  it('completes two writers, substantive test include, PROG/INCL/text, recording, negatives and reverse cleanup', async () => {
    const f = fixture();
    const result: any = await qualify(f.context);
    expect(
      result,
      JSON.stringify({ phase: f.result()?.failedPhase, error: f.result()?.error, last: f.calls.at(-1) }),
    ).toMatchObject({ failure: false, remaining: [], qualifiedForMerge: false });
    expect(f.sources.size).toBe(0);
    expect(
      f.calls.some(
        (c) =>
          c.tool === 'SAPWrite' &&
          c.args.include === 'testclasses' &&
          c.args.source.includes('cl_abap_unit_assert=>assert_equals'),
      ),
    ).toBe(true);
    expect(f.calls.some((c) => c.tool === 'SAPDiagnose')).toBe(false);
    expect(f.calls.filter((c) => c.args.action === 'delete').map((c) => c.args.name)).toEqual(
      [...f.manifest.fixtures].reverse().map((x: any) => x.name),
    );
    expect(f.calls.filter((c) => c.tool === 'SAPTransport').every((c) => c.args.action === 'get')).toBe(true);
    expect(f.result().recordingEntriesAfterDeletion).toHaveLength(3);
    expect(f.result().outstanding.join(' ')).toContain('Basic');
  });
  it.each(
    ['writerA', 'writerB', 'readerA'].flatMap((actor) =>
      ['create', 'release', 'release_recursive', 'delete', 'reassign', 'remove_object'].map((action) => [
        actor,
        action,
      ]),
    ),
  )('refuses management action %s / %s before any fixture attempt', async (actor, action) => {
    const f = fixture();
    f.changed.catalogMutation = (tools, label) => {
      if (label === actor) tools.find((t) => t.name === 'SAPTransport').inputSchema.properties.action.enum.push(action);
    };
    const result: any = await qualify(f.context);
    expect(result.failure).toBe(true);
    expect(f.result().error.code).toBe('CURRENT_RECORDING_ONLY_CATALOG_MISMATCH');
    expect(f.result().operations).toEqual([]);
    expect(f.result().fixtures.every((owner: any) => !owner.attempted)).toBe(true);
    expect(f.result().firstMutationMayHaveBeenSubmitted).toBe(false);
    expect(f.attempts).toEqual([]);
    expect(f.files.has('current-workflow-claim.json')).toBe(true);
  });
  it.each(['SAPWrite', 'SAPActivate'])('refuses a missing writer %s catalog before writes', async (name) => {
    const f = fixture();
    f.changed.catalogMutation = (tools, label) => {
      if (label === 'writerA')
        tools.splice(
          tools.findIndex((t) => t.name === name),
          1,
        );
    };
    await qualify(f.context);
    expect(f.result().error.code).toBe('CURRENT_WRITE_CATALOG_MISMATCH');
    expect(f.attempts).toEqual([]);
  });
  it('requires the actual exact request read schema, not merely a get enum', async () => {
    const f = fixture();
    f.changed.catalogMutation = (tools, label) => {
      if (label === 'writerA')
        tools.find((t) => t.name === 'SAPTransport').inputSchema.properties.id = { const: 'A4HK999999' };
    };
    await qualify(f.context);
    expect(f.result().error.code).toBe('CURRENT_WORKFLOW_SCHEMA_UNAVAILABLE');
    expect(f.attempts).toEqual([]);
  });
  it('permanently consumes a claim and never replays a completed plan', async () => {
    const f = fixture();
    await qualify(f.context);
    const count = f.fetch.mock.calls.length;
    await expect(qualify(f.context)).rejects.toThrow('EEXIST');
    expect(f.fetch).toHaveBeenCalledTimes(count);
  });
  it('retains the completed primary and attempted secondary on failure, with no opportunistic cleanup', async () => {
    const f = fixture();
    f.changed.refuseAt = '_CB_';
    const result: any = await qualify(f.context);
    expect(result.failure).toBe(true);
    expect(result.remaining).toHaveLength(2);
    expect(f.calls.some((c) => c.args.action === 'delete')).toBe(false);
  });
  it('catches a stale-write guard regression instead of calling it success', async () => {
    const f = fixture();
    f.changed.acceptStale = true;
    const result: any = await qualify(f.context);
    expect(result.failure).toBe(true);
    expect(f.result().failedPhase).toContain('stale-');
    expect(f.calls.some((c) => c.args.action === 'delete')).toBe(false);
  });
  it('stops after deployed/source binding drift without replay or cleanup', async () => {
    const f = fixture();
    f.changed.driftAfter = 'create';
    const result: any = await qualify(f.context);
    expect(result.failure).toBe(true);
    expect(f.attempts).toHaveLength(1);
    expect(f.result().terminalBindingError).toBeDefined();
  });
  it('preserves server-confirmed deletion when independent absence is unavailable', async () => {
    const f = fixture();
    f.changed.nativeAbsentFail = true;
    const result: any = await qualify(f.context);
    expect(result.failure).toBe(true);
    expect(f.result().fixtures.at(-1).deletionAcknowledged).toBe(true);
    expect(result.remaining.at(-1).state).toContain('server-confirmed-deleted');
    expect(f.calls.filter((c) => c.args.action === 'delete')).toHaveLength(1);
  });
  it.each(['writerA', 'writerB', 'readerA'])('requires the exact fresh raw scope profile for %s', async (label) => {
    const f = fixture();
    f.scopes[label] = ['admin'];
    await expect(qualify(f.context)).rejects.toThrow('CURRENT_ACTOR_OR_SCOPE_MISMATCH');
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.files.has('current-workflow-claim.json')).toBe(false);
  });
  it('rejects arbitrary RPC/action payload before authentication or HTTP', async () => {
    const f = fixture();
    f.context.action.calls = [{ name: 'SAPWrite' }];
    await expect(qualify(f.context)).rejects.toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('rejects stale baseline at the actual client send', async () => {
    const f = fixture();
    let now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const original = f.context.currentDependencies.write;
    f.context.currentDependencies.write = async (...args: any[]) => {
      await original(...args);
      if (args[0].endsWith('current-workflow-result.json') && args[1].operations?.length === 1) now += 300001;
    };
    try {
      const result: any = await qualify(f.context);
      expect(result.failure).toBe(true);
      expect(f.attempts).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
  it('refuses changed baseline receipts after a submitted create, without cleanup', async () => {
    const f = fixture();
    f.context.currentDependencies.controls = async () => ({
      sha256: f.attempts.length ? 'changed' : 'f'.repeat(64),
      freshUntil: Date.parse(f.run.preparedAt) + 301000,
    });
    const result: any = await qualify(f.context);
    expect(result.failure).toBe(true);
    expect(f.attempts).toHaveLength(1);
    expect(f.calls.some((c) => c.args.action === 'delete')).toBe(false);
  });
  it('refuses an owner changed immediately before cleanup', async () => {
    const f = fixture(),
      original = f.native.getMockImplementation()!;
    f.native.mockImplementation(async (mode, name) => {
      if (f.native.mock.calls.length === 6) f.changed.driftNative = true;
      return original(mode, name);
    });
    const result: any = await qualify(f.context);
    expect(result.failure).toBe(true);
    expect(f.result().error.code).toBe('CURRENT_OWNER_CHANGED_BEFORE_DELETE');
    expect(f.calls.some((c) => c.args.action === 'delete')).toBe(false);
  });
  it('propagates abort through a pending real client fetch without replay', async () => {
    const c = new AbortController();
    const fetch = vi.fn(async (_url: any, init: any) => {
      c.abort();
      init.signal.throwIfAborted();
    });
    vi.stubGlobal('fetch', fetch);
    const client = new McpSession(
      new URL('https://current-pp.invalid'),
      'synthetic',
      () => {},
      'abort',
      true,
      undefined,
      { deadline: Date.now() + 10000, signal: c.signal },
    );
    await expect(client.request('tools/list')).rejects.toThrow('HTTP_REQUEST_FAILED');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it('checks real baseline bytes, filters, actor identities and immutable receipt hashes', async () => {
  const f = fixture(),
    image = Buffer.from([255, 216, 1, 2, 255, 217]);
  const receipt = {
    version: 1,
    runId: f.run.runId,
    sourceRevision: f.run.sourceRevision,
    manifestSha256: sha(f.manifest),
    client: '001',
    table: '*',
    inspectedByOperator: true,
    images: [
      { file: 'sm12-suffix.jpg', user: '*', argument: `*${f.manifest.marker.slice(0, 12)}*` },
      { file: 'sm12-writerA.jpg', user: 'PRIMARY', argument: '*' },
      { file: 'sm12-writerB.jpg', user: 'SECONDARY', argument: '*' },
    ].map((x) => ({
      ...x,
      observedAt: new Date().toISOString(),
      count: 0,
      complete: true,
      error: false,
      sha256: sha(image),
    })),
  };
  const stat = async () => ({
    isFile: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid!(),
    mode: 0o600,
    size: image.length,
  });
  const read = () =>
    readCurrentControls(
      '/private/test',
      f.manifest,
      sha(f.manifest),
      f.run,
      async () => receipt,
      (async () => image) as any,
      stat as any,
    );
  expect((await read()).sha256).toBe(sha(receipt));
  receipt.images[2].user = 'PRIMARY';
  await expect(read()).rejects.toThrow('CONTROL_FILTER_OR_CHRONOLOGY');
});

describe('fixed retained PP entry and actual shared McpSession composition', () => {
  it('performs only the remaining PROG workflow and reverse PP cleanup, preserving the prior three owners', async () => {
    const f = await retainedFixture();
    const result: any = await qualify(f.context);
    expect(result, JSON.stringify(f.result())).toMatchObject({ plan: retainedPlan, failure: false, remaining: [] });
    const program = f.manifest.fixtures[3];
    expect(f.calls.filter((c) => c.args.action === 'create').map((c) => c.args.name)).toEqual([program.name]);
    expect(
      f.calls
        .filter((c) => c.tool === 'SAPActivate')
        .every((c) => c.args.name === program.name || c.args.objects?.every((o: any) => o.name === program.name)),
    ).toBe(true);
    expect(f.calls.some((c) => ['edit_method', 'edit_class_definition'].includes(c.args.action))).toBe(false);
    expect(f.native.mock.calls.slice(0, 4)).toEqual([
      ...f.manifest.fixtures.slice(0, 3).map((o: any) => ['identity', o.name]),
      ['absence', program.name],
    ]);
    expect(f.calls.filter((c) => c.args.action === 'delete').map((c) => [c.label, c.args.name])).toEqual(
      [...f.manifest.fixtures].reverse().map((o: any) => [o.actor, o.name]),
    );
    expect(
      f
        .result()
        .fixtures.slice(0, 3)
        .every((o: any) => o.retainedFrom === retainedDescriptor.originalRunId),
    ).toBe(true);
    expect(f.result().verifiedActors).toHaveLength(3);
    expect(f.context.currentDependencies.retainedSendProof).toHaveBeenCalled();
  });
  it.each(['source', 'metadata', 'creator', 'include-provenance'])(
    'refuses changed retained %s before any new mutation and retains all three',
    async (variant) => {
      const f = await retainedFixture();
      const owner = f.manifest.fixtures[variant === 'include-provenance' ? 2 : 0];
      if (variant === 'source') f.history.expected[owner.name].sourceHash = 'changed';
      if (variant === 'metadata') f.history.expected[owner.name].metadataHash = 'changed';
      if (variant === 'creator') f.history.expected[owner.name].identity.createdBy = 'OTHER';
      if (variant === 'include-provenance') {
        const native = f.native.getMockImplementation()!;
        f.native.mockImplementation(async (mode: string, name: string) => {
          const value: any = await native(mode, name);
          if (mode === 'identity' && name === owner.name)
            value.fixtures[0].ownedCreate = { ...value.fixtures[0].ownedCreate, runId: 'foreign' };
          return value;
        });
      }
      const result: any = await qualify(f.context);
      expect(result.failure).toBe(true);
      expect(result.remaining.map((o: any) => o.name)).toEqual(f.manifest.fixtures.slice(0, 3).map((o: any) => o.name));
      expect(f.result().operations).toEqual([]);
      expect(f.attempts).toEqual([]);
    },
  );
  it('refuses a present unattempted program without deleting or rewriting it', async () => {
    const f = await retainedFixture();
    f.sources.set(f.manifest.fixtures[3].name, { source: 'foreign' });
    await qualify(f.context);
    expect(f.result().error.code).toBe('RETAINED_PROGRAM_NOT_ABSENT');
    expect(f.attempts).toEqual([]);
  });
  it.each(['root', 'origin', 'marker', 'recording', 'actors'])(
    'refuses changed fixed %s before claiming',
    async (variant) => {
      const f = await retainedFixture();
      if (variant === 'root') f.config.root += '-other';
      if (variant === 'origin') (f.run as any).retained = { ...retainedDescriptor, originalRunId: 'foreign' };
      if (variant === 'marker')
        Object.assign(f.manifest, makeCurrentManifest('E'.repeat(32), f.manifest.bindings, f.config));
      if (variant === 'recording') f.manifest.bindings.recording.task = 'A4HK999999';
      if (variant === 'actors') f.history.manifest.actors[0].email = 'foreign@example.invalid';
      await expect(qualify(f.context)).rejects.toThrow();
      expect(f.files.has('current-workflow-claim.json')).toBe(false);
      expect(f.fetch).not.toHaveBeenCalled();
    },
  );
  it('rejects a replay after the single claim even when the previous continuation succeeded', async () => {
    const f = await retainedFixture();
    expect(((await qualify(f.context)) as any).failure).toBe(false);
    const count = f.calls.length;
    await expect(qualify(f.context)).rejects.toThrow('EEXIST');
    expect(f.calls).toHaveLength(count);
  });
  it('retains conservative owner diagnostics on a refused new program attempt', async () => {
    const f = await retainedFixture();
    f.changed.refuseAt = '_P_';
    await qualify(f.context);
    expect(f.result().remaining).toHaveLength(4);
    expect(f.result().firstMutationMayHaveBeenSubmitted).toBe(true);
    expect(f.calls.some((c) => c.args.action === 'delete')).toBe(false);
  });
  it('preserves historical retained owners if terminal source verification fails', async () => {
    const f = await retainedFixture();
    let broken = false;
    f.context.currentDependencies.retainedHistory = () => {
      if (broken) throw new Error('history changed');
      return f.history;
    };
    f.context.currentDependencies.retainedSendProof = () => {
      broken = true;
      throw new Error('history changed');
    };
    await expect(qualify(f.context)).rejects.toThrow();
    expect(f.attempts).toEqual([]);
  });
  it('keeps the ordinary new-run plan from entering the reserved continuation root', async () => {
    const f = await retainedFixture();
    f.context.action.plan = currentPlan;
    await expect(qualify(f.context)).rejects.toThrow('RETAINED_FIXED_ROOT_REQUIRED');
    expect(f.attempts).toEqual([]);
  });
  it('keeps an explicit known native creator from being substituted for the missing-creator proof', async () => {
    const f = await retainedFixture();
    const owner = f.manifest.fixtures[2];
    const value = structuredClone(f.history.expected[owner.name]);
    value.identity.createdBy = 'PRIMARY';
    expect(() => assertRetainedObservation(f.history, owner, { fixtures: [value] })).toThrow(
      'RETAINED_FRESH_OWNER_CHANGED',
    );
  });
});

describe('retained final MCP dispatch boundaries', () => {
  it.each(['history', 'source', 'stop', 'deadline', 'baseline'])(
    'refuses %s changed after asynchronous proof and before the first program dispatch',
    async (fault) => {
      const f = await retainedFixture(),
        controller = new AbortController();
      f.context.signal = controller.signal;
      let late = false,
        now = Date.now();
      const load = f.context.currentDependencies.load;
      f.context.currentDependencies.load = async (path: string) => {
        const value = await load(path);
        if (
          path.endsWith('/deployment-receipt.json') &&
          f.result()?.operations.at(-1)?.phase === `create-${f.manifest.fixtures[3].name}`
        )
          late = true;
        return value;
      };
      f.context.currentDependencies.retainedSendProof = () => {
        if (!late) return;
        if (fault === 'history' || fault === 'source') throw new Error(`${fault} changed`);
        if (fault === 'stop') controller.abort();
        if (fault === 'deadline' || fault === 'baseline')
          vi.spyOn(Date, 'now').mockReturnValue(now + (fault === 'deadline' ? 600000 : 310000));
      };
      try {
        const result: any = await qualify(f.context);
        expect(result.failure).toBe(true);
        expect(f.attempts).toEqual([]);
        expect(f.result().firstMutationMayHaveBeenSubmitted).toBe(false);
        expect(f.result().remaining).toHaveLength(4);
        expect(f.calls.some((c) => c.args.action === 'delete')).toBe(false);
      } finally {
        vi.restoreAllMocks();
      }
    },
  );
  it('rechecks immutable bindings after the final awaited evidence read and preserves confirmed deletion facts', async () => {
    const f = await retainedFixture();
    let finalDrift = false;
    const load = f.context.currentDependencies.load;
    f.context.currentDependencies.load = async (path: string) => {
      const value = await load(path);
      if (path.endsWith('/deployment-receipt.json') && f.result()?.fixtures.every((o: any) => o.deleted))
        finalDrift = true;
      return value;
    };
    f.context.currentDependencies.retainedSendProof = () => {
      if (finalDrift) throw new Error('terminal source drift');
    };
    const result: any = await qualify(f.context);
    expect(result.failure).toBe(true);
    expect(result.remaining).toEqual([]);
    expect(f.result().fixtures.every((o: any) => o.deleted)).toBe(true);
    expect(f.result().terminalBindingError).toBeDefined();
  });
});

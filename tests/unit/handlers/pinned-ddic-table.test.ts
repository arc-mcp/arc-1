import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import {
  blueSource,
  config,
  context,
  createWorld,
  fixture,
  install,
  nativeClient,
  puts,
  type World,
} from './pinned-ddic-harness.js';

const { createPinnedDdicContext } = await import('../../../src/handlers/write/pinned-ddic-context.js');
const { executePinnedSourceWrite } = await import('../../../src/handlers/write/pinned-source-write.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const original = "@EndUserText.label : 't'\ndefine table ztest {\n  key client : abap.clnt not null;\n}\n";
const replacement =
  "@EndUserText.label : 't'\ndefine table ztest {\n  key client : abap.clnt not null;\n  v : abap.char(1);\n}\n";
const tablePath = '/sap/bc/adt/ddic/tables/ZTEST';
const structurePath = '/sap/bc/adt/ddic/structures/ZTEST';
const settingsPath = '/sap/bc/adt/ddic/db/settings/ztest';

let world: World;
beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  world = createWorld();
  install(world);
});
afterEach(() => {
  expect(world.unexpected).toEqual([]);
  resetCachedFeatures();
});

function seedTable(type: 'TABL/DT' | 'TABL/DS' = 'TABL/DT') {
  const path = type === 'TABL/DT' ? tablePath : structurePath;
  world.objects.set(path, { metadata: blueSource('ZTEST', type, 'ZTEAM'), nativeType: type, source: original });
  world.search = [{ type, name: 'ZTEST' }];
  return path;
}

async function run(args: Record<string, unknown>) {
  const client = nativeClient();
  const mutation = context(client, world.abort);
  const ctx = await createPinnedDdicContext(client, args, config, mutation);
  const result = await executePinnedSourceWrite(ctx);
  return { result, payload: JSON.parse(result.content[0]!.text), cleanup: mutation.cleanup };
}

describe('table source', () => {
  it.each(['TABL/DT', 'TABL/DS'] as const)('updates %s through the shared hashed source lifecycle', async (type) => {
    const path = seedTable(type);
    const snapshot = await handleToolCall(nativeClient(), config, 'SAPRead', {
      type: 'TABL',
      name: 'ZTEST',
      format: 'editable',
    });
    expect(snapshot.isError, snapshot.content[0]!.text).toBeUndefined();
    expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
    const { result, payload, cleanup } = await run({
      action: 'update',
      type,
      name: 'ZTEST',
      source: replacement,
      expectedSourceHash: JSON.parse(snapshot.content[0]!.text).sourceHash,
    });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ type, state: 'saved-inactive', sourceHash: sourceHash(replacement) });
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    expect(puts(world)[0]!.path.split('?')[0]).toBe(`${path}/source/main`);
    expect(world.calls.some((call) => call.path.includes('/activation'))).toBe(false);
  });

  it.each([
    ['TABL/DS', 'structure', 'structures'],
    ['TABL/DT', 'table', 'tables'],
  ] as const)(
    'verifies the captured native %s readback and returns its stored hash',
    async (type, kind, collection) => {
      const native = JSON.parse(fixture(`adt/${kind}-source-a4h-readback.json`));
      world.objects.set(`/sap/bc/adt/ddic/${collection}/${native.name}`, { metadata: '', nativeType: type });
      world.sourceOnSave = (body) => {
        expect(body).toBe(native.requested);
        return native.readback;
      };
      const { result, payload, cleanup } = await run({
        action: 'create',
        type,
        name: native.name,
        package: '$TMP',
        source: native.requested,
      });
      expect(result.isError, result.content[0]!.text).toBeUndefined();
      expect(payload).toMatchObject({ state: 'saved-inactive', sourceHash: native.readbackSha256 });
      expect(payload.sourceHash).not.toBe(native.requestedSha256);
      expect(puts(world)).toHaveLength(1);
      expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    },
  );

  it('refuses the pre-alignment raw hash even when the captured table sources compare equivalent', async () => {
    const native = JSON.parse(fixture('adt/table-source-a4h-readback.json'));
    world.objects.set(`/sap/bc/adt/ddic/tables/${native.name}`, {
      metadata: blueSource(native.name, 'TABL/DT', 'ZTEAM'),
      nativeType: 'TABL/DT',
      source: native.readback,
    });
    world.search = [{ type: 'TABL/DT', name: native.name }];
    const { payload, cleanup } = await run({
      action: 'update',
      type: 'TABL/DT',
      name: native.name,
      source: native.requested,
      expectedSourceHash: native.requestedSha256,
    });
    expect(payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  });

  it.each(['TABL/DT', 'TABL/DS'] as const)(
    'updates %s after native normalization, keeping the exact stale hash boundary',
    async (type) => {
      const path = seedTable(type),
        object = world.objects.get(path)!;
      const normalize = (source: string) => source.replace('{\n', '{\n\n').replace('\n}', '\n\n}').trimEnd();
      object.source = normalize(original);
      world.sourceOnSave = normalize;
      const stale = await run({
        action: 'update',
        type,
        name: 'ZTEST',
        source: replacement,
        expectedSourceHash: sourceHash(original),
      });
      expect(stale.payload.state).toBe('unchanged');
      expect(puts(world)).toEqual([]);
      const saved = await run({
        action: 'update',
        type,
        name: 'ZTEST',
        source: replacement,
        expectedSourceHash: sourceHash(object.source),
      });
      expect(saved.result.isError, saved.result.content[0]!.text).toBeUndefined();
      expect(saved.payload.sourceHash).toBe(sourceHash(normalize(replacement)));
      expect(saved.payload.sourceHash).not.toBe(sourceHash(replacement));
      expect(puts(world)).toHaveLength(1);
      expect(saved.cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    },
  );
  it.each(["'unterminated", '/* unterminated', '`unknown literal`'])(
    'refuses uncertain DDL boundary %s before source PUT',
    async (suffix) => {
      seedTable();
      const result = await run({
        action: 'update',
        type: 'TABL/DT',
        name: 'ZTEST',
        source: replacement + suffix,
        expectedSourceHash: sourceHash(original),
      });
      expect(result.payload).toMatchObject({ state: 'unchanged', phase: 'source-verification-preflight' });
      expect(puts(world)).toEqual([]);
      expect(result.cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    },
  );
  it('retains a submitted save when native content changes beyond empty code lines', async () => {
    seedTable();
    world.sourceOnSave = (body) => body.replace('char(1)', 'char(2)').replace('{\n', '{\n\n');
    const result = await run({
      action: 'update',
      type: 'TABL/DT',
      name: 'ZTEST',
      source: replacement,
      expectedSourceHash: sourceHash(original),
    });
    expect(result.payload).toMatchObject({ state: 'source-save-unknown', phase: 'source-readback', retryable: false });
    expect(puts(world)).toHaveLength(1);
    expect(result.cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  });

  it('retains a newly created owner when DDL proof refuses before its source PUT', async () => {
    world.objects.set(`${structurePath.replace('ZTEST', 'ZNEW')}`, { metadata: '', nativeType: 'TABL/DS' });
    const { payload, cleanup } = await run({
      action: 'create',
      type: 'TABL/DS',
      name: 'ZNEW',
      package: '$TMP',
      source: replacement + '/* unclosed',
    });
    expect(payload).toMatchObject({
      state: 'created-source-not-confirmed',
      phase: 'source-verification-preflight',
      retryable: false,
    });
    expect(puts(world)).toEqual([]);
    expect(
      world.calls.filter((call) => call.method === 'POST' && call.path.startsWith('/sap/bc/adt/ddic/structures?')),
    ).toHaveLength(1);
    expect(world.calls.some((call) => call.method === 'DELETE')).toBe(false);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  });

  it('resolves a bare TABL from native evidence and reports the actual subtype', async () => {
    const path = seedTable('TABL/DS');
    const { payload } = await run({
      action: 'update',
      type: 'TABL',
      name: 'ZTEST',
      source: replacement,
      expectedSourceHash: sourceHash(original),
    });
    expect(payload.type).toBe('TABL/DS');
    expect(puts(world)[0]!.path.split('?')[0]).toBe(`${path}/source/main`);
  });

  it('refuses a caller subtype that disagrees with native evidence before any write', async () => {
    seedTable('TABL/DT');
    await expect(
      run({
        action: 'update',
        type: 'TABL/DS',
        name: 'ZTEST',
        source: replacement,
        expectedSourceHash: sourceHash(original),
      }),
    ).rejects.toThrow(/natively TABL\/DT/);
    expect(world.calls.some((call) => call.path.includes('_action=LOCK'))).toBe(false);
  });

  it('refuses when metadata at the resolved collection contradicts the search subtype', async () => {
    world.objects.set(tablePath, {
      metadata: blueSource('ZTEST', 'TABL/DS', 'ZTEAM'),
      nativeType: 'TABL/DS',
      source: original,
    });
    world.search = [{ type: 'TABL/DT', name: 'ZTEST' }];
    const { payload } = await run({
      action: 'update',
      type: 'TABL',
      name: 'ZTEST',
      source: replacement,
      expectedSourceHash: sourceHash(original),
    });
    expect(payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
  });

  it('requires its hash, rejects a stale one under the lock and refuses a whitespace create source', async () => {
    seedTable();
    await expect(run({ action: 'update', type: 'TABL/DT', name: 'ZTEST', source: replacement })).rejects.toThrow(
      /expectedSourceHash/,
    );
    const stale = await run({
      action: 'update',
      type: 'TABL/DT',
      name: 'ZTEST',
      source: replacement,
      expectedSourceHash: 'a'.repeat(64),
    });
    expect(stale.payload.state).toBe('unchanged');
    expect(stale.cleanup.sessionClosed).toBe(true);
    expect(puts(world)).toEqual([]);
    await expect(
      run({ action: 'create', type: 'TABL/DT', name: 'ZNEW', package: 'ZTEAM', source: ' ' }),
    ).rejects.toThrow(/whitespace/);
  });

  it.each(['package-drift', 'identity-drift', 'cancel'])('refuses %s before the source save', async (fault) => {
    seedTable();
    world.faults.add(fault);
    if (fault === 'cancel') world.abort = new AbortController();
    const { payload, cleanup } = await run({
      action: 'update',
      type: 'TABL/DT',
      name: 'ZTEST',
      source: replacement,
      expectedSourceHash: sourceHash(original),
    });
    expect(payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
    expect(cleanup.unlockFailed).toBe(false);
  });

  it.each([
    { type: 'TABL/DT', collection: '/sap/bc/adt/ddic/tables' },
    { type: 'TABL/DS', collection: '/sap/bc/adt/ddic/structures' },
    { type: 'TABL', collection: '/sap/bc/adt/ddic/tables' },
  ])('creates $type with its subtype body, _package and source save', async ({ type, collection }) => {
    world.objects.set(`${collection}/ZNEW`, { metadata: '', nativeType: type === 'TABL/DS' ? 'TABL/DS' : 'TABL/DT' });
    const { result, payload } = await run({
      action: 'create',
      type,
      name: 'ZNEW',
      package: 'ZTEAM',
      source: replacement,
    });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload.state).toBe('saved-inactive');
    const post = world.calls.find((call) => call.method === 'POST' && call.path.startsWith(`${collection}?`));
    expect(post!.path).toContain('_package=ZTEAM');
    expect(post!.body).toContain(`adtcore:type="${type === 'TABL/DS' ? 'TABL/DS' : 'TABL/DT'}"`);
    expect(post!.body).not.toContain('adtcore:responsible');
  });

  it('reports a created stub truthfully when its source save fails, without a second POST', async () => {
    world.objects.set(`${'/sap/bc/adt/ddic/tables'}/ZNEW`, { metadata: '', nativeType: 'TABL/DT' });
    world.faults.add('save-unknown');
    const { payload } = await run({
      action: 'create',
      type: 'TABL/DT',
      name: 'ZNEW',
      package: 'ZTEAM',
      source: replacement,
    });
    expect(payload).toMatchObject({ state: 'created-source-unknown', retryable: false });
    expect(
      world.calls.filter((call) => call.method === 'POST' && call.path.startsWith('/sap/bc/adt/ddic/tables?')),
    ).toHaveLength(1);
  });

  it('deletes through the shared owner path with typed absence', async () => {
    const path = seedTable();
    const { payload } = await run({ action: 'delete', type: 'TABL', name: 'ZTEST' });
    expect(payload).toMatchObject({ ok: true, state: 'deleted', type: 'TABL/DT' });
    expect(world.calls.find((call) => call.method === 'DELETE')!.path.split('?')[0]).toBe(path);
  });
});

describe('technical settings', () => {
  const settings = () => fixture('table-settings-758.xml');
  function seed() {
    world.objects.set(settingsPath, { metadata: settings(), nativeType: 'TABL/DTT' });
    world.objects.set('/sap/bc/adt/ddic/tables/ztest', {
      metadata: blueSource('ZTEST', 'TABL/DT', 'ZTEAM'),
      nativeType: 'TABL/DT',
    });
  }
  const discovery = new Map([
    [settingsPath.replace(/\/[^/]+$/, ''), ['application/vnd.sap.adt.table.settings.v2+xml']],
  ]);
  async function runSettings(extra: Record<string, unknown> = {}, map = discovery) {
    const client = nativeClient(map);
    const mutation = context(client, world.abort);
    const ctx = await createPinnedDdicContext(
      client,
      { action: 'update', type: 'TABL/DTT', name: 'ZTEST', source: '{"dataClass":"APPL1"}', ...extra },
      config,
      mutation,
    );
    const result = await executePinnedSourceWrite(ctx);
    return { result, payload: JSON.parse(result.content[0]!.text), cleanup: mutation.cleanup };
  }

  it('patches only the requested field in the draft-visible document under the settings lock', async () => {
    seed();
    const snapshot = await handleToolCall(nativeClient(), config, 'SAPRead', {
      type: 'TABL/DTT',
      name: 'ZTEST',
      format: 'editable',
    });
    expect(snapshot.isError, snapshot.content[0]!.text).toBeUndefined();
    expect(JSON.parse(snapshot.content[0]!.text).metadataHash).toMatch(/^[a-f0-9]{64}$/);
    expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
    const { result, payload, cleanup } = await runSettings({
      expectedMetadataHash: JSON.parse(snapshot.content[0]!.text).metadataHash,
    });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ type: 'TABL/DTT', state: 'saved-inactive', nativeVersion: 'inactive' });
    expect(cleanup.sessionClosed).toBe(true);
    const [put] = puts(world);
    expect(put!.body).toContain('<ts:dataClassCategory>APPL1</ts:dataClassCategory>');
    expect(put!.body).toContain('<ts:storageType/>');
    expect(put!.body).toContain('ts:granularity="2"');
    expect(put!.locked).toBe(true);
    expect(put!.path.split('?')[0]).toBe(settingsPath);
    const lock = world.calls.find((call) => call.path.includes('_action=LOCK'));
    expect(lock!.path.split('?')[0]).toBe(settingsPath);
  });

  it('reports unchanged without a save when the patch already matches', async () => {
    seed();
    const { payload } = await runSettings({ source: '{"dataClass":"APPL0"}' });
    expect(payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
  });

  it('directs new settings to their parent activation', async () => {
    seed();
    world.objects.get(settingsPath)!.metadata = settings().replace(
      'adtcore:version="inactive"',
      'adtcore:version="new"',
    );
    world.savedVersion = 'new';
    const { payload } = await runSettings();
    expect(payload).toMatchObject({ nativeVersion: 'new', state: 'saved-inactive' });
    expect(payload.next).toMatch(/activate TABL/);
  });

  it('refuses a denied parent package before locking', async () => {
    seed();
    world.objects.get('/sap/bc/adt/ddic/tables/ztest')!.metadata = blueSource('ZTEST', 'TABL/DT', 'ZDENIED');
    const { payload } = await runSettings();
    expect(payload.state).toBe('unchanged');
    expect(world.calls.some((call) => call.path.includes('_action=LOCK'))).toBe(false);
  });

  it('honors the stored precondition and refuses an unsupported patch and service absence', async () => {
    seed();
    const stale = await runSettings({ expectedMetadataHash: 'b'.repeat(64) });
    expect(stale.payload).toMatchObject({ state: 'unchanged', phase: 'metadata-read' });
    const invalid = await runSettings({ source: '{"storageType":"X"}' });
    expect(invalid.payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
    const absent = await runSettings({}, new Map([['/sap/bc/adt/programs/programs', ['application/*']]]));
    expect(absent.result.isError).toBe(true);
    expect(puts(world)).toEqual([]);
  });

  it.each(['create', 'delete'])('refuses %s of technical settings before HTTP', async (action) => {
    await expect(
      run({ action, type: 'TABL/DTT', name: 'ZTEST', ...(action === 'create' ? { source: '{}' } : {}) }),
    ).rejects.toThrow(/update only|allowlist/);
    expect(world.calls).toEqual([]);
  });

  it.each([
    { fault: 'save-unknown', state: 'metadata-save-unknown' },
    { fault: 'save-rejected', state: 'metadata-save-rejected' },
    { fault: 'readback', state: 'metadata-save-unknown' },
  ])('reports $fault once', async ({ fault, state }) => {
    seed();
    world.faults.add(fault);
    const { payload } = await runSettings();
    expect(payload).toMatchObject({ state, retryable: false });
    expect(puts(world)).toHaveLength(1);
  });
});

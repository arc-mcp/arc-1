import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SDO_REGISTRY, SDO_TYPES } from '../../../src/adt/server-driven.js';
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
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const DOCUMENT = (name: string, code: string, pkg: string, version = 'inactive') => {
  const entry = SDO_REGISTRY[code as keyof typeof SDO_REGISTRY];
  return entry.metadataRootQName === 'blue:blueSource'
    ? blueSource(name, entry.createType, pkg, version)
    : `<?xml version="1.0"?><dtdc:dtdcSource xmlns:dtdc="${entry.metadataNamespace}" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="${entry.createType}" adtcore:version="${version}"><adtcore:packageRef adtcore:type="DEVC/K" adtcore:name="${pkg}"/></dtdc:dtdcSource>`;
};
const ordinary = SDO_TYPES.filter((code) => code !== 'TABL/DTI' && code !== 'UIAD');
const jsonSource = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ formatVersion: '1', header: { description: 'x', originalLanguage: 'en' }, ...extra });
const sourceFor = (code: string, extra: Record<string, unknown> = {}) =>
  SDO_REGISTRY[code as keyof typeof SDO_REGISTRY].sourceFormat === 'json'
    ? jsonSource(extra)
    : 'define type ztest : abap.char(1);\n';
const pathFor = (code: string, name = 'ZTEST') => `${SDO_REGISTRY[code as keyof typeof SDO_REGISTRY].href}/${name}`;
const discovery = (codes: readonly string[] = SDO_TYPES) =>
  new Map<string, string[]>([
    ...codes.map((code): [string, string[]] => [
      SDO_REGISTRY[code as keyof typeof SDO_REGISTRY].href,
      [SDO_REGISTRY[code as keyof typeof SDO_REGISTRY].metadataContentType],
    ]),
    ['/sap/bc/adt/deletion/check', ['application/vnd.sap.adt.deletion.check.request.v1+xml']],
  ]);

let world: World;
beforeEach(() => {
  vi.restoreAllMocks();
  world = createWorld();
  install(world);
});
afterEach(() => {
  expect(world.unexpected).toEqual([]);
});

function seed(code: string, name = 'ZTEST', version = 'inactive', source = sourceFor(code)) {
  const entry = SDO_REGISTRY[code as keyof typeof SDO_REGISTRY];
  world.objects.set(pathFor(code, name), {
    metadata: DOCUMENT(name, code, 'ZTEAM', version),
    nativeType: entry.createType,
    source,
  });
}

async function run(args: Record<string, unknown>, map: Map<string, string[]> | undefined = discovery()) {
  const client = nativeClient(map);
  const mutation = context(client, world.abort);
  const ctx = await createPinnedDdicContext(client, args, config, mutation);
  const result = await executePinnedSourceWrite(ctx);
  return { result, payload: JSON.parse(result.content[0]!.text), cleanup: mutation.cleanup };
}

const updateArgs = (code: string, source: string, stored = sourceFor(code)) => ({
  action: 'update',
  type: code,
  name: 'ZTEST',
  source,
  expectedSourceHash: sourceHash(stored),
});

describe('server-driven update', () => {
  it.each(ordinary)('%s saves with its registry MIME under the owning lock', async (code) => {
    const immediate = code === 'APLO';
    seed(code, 'ZTEST', immediate ? 'active' : 'inactive');
    const source = sourceFor(code, { added: 1 });
    const replacement = source === sourceFor(code) ? `${source}// changed\n` : source;
    const snapshot = await handleToolCall(nativeClient(), config, 'SAPRead', {
      type: code,
      name: 'ZTEST',
      format: 'editable',
    });
    expect(snapshot.isError, snapshot.content[0]!.text).toBeUndefined();
    expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
    const { result, payload, cleanup } = await run({
      ...updateArgs(code, replacement),
      expectedSourceHash: JSON.parse(snapshot.content[0]!.text).sourceHash,
    });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ type: code, state: immediate ? 'saved-active' : 'saved-inactive' });
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
    const [put] = puts(world);
    expect(puts(world)).toHaveLength(1);
    expect(put!.locked).toBe(true);
    expect(put!.path.split('?')[0]).toBe(`${pathFor(code)}/source/main`);
    expect(String(put!.contentType)).toContain(
      SDO_REGISTRY[code as keyof typeof SDO_REGISTRY].sourceFormat === 'json' ? 'application/json' : 'text/plain',
    );
    expect(world.calls.some((call) => call.path.includes('/activation'))).toBe(false);
  });

  it('accepts AFF defaults SAP adds', async () => {
    seed('DESD');
    world.sourceOnSave = (body) => JSON.stringify({ ...JSON.parse(body), sapDefault: 'y' });
    const { result, payload } = await run(updateArgs('DESD', jsonSource({ a: 1 })));
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload.state).toBe('saved-inactive');
  });

  it.each([
    { label: 'changed', onSave: (body: string) => body.replace('"a":1', '"a":2') },
    { label: 'dropped', onSave: (body: string) => body.replace(',"a":1', '') },
    { label: 'reordered array', onSave: (body: string) => body.replace('[1,2]', '[2,1]') },
  ])('reports a submitted value SAP $label as unconfirmed', async ({ onSave }) => {
    seed('DESD');
    world.sourceOnSave = onSave;
    const { payload } = await run(updateArgs('DESD', jsonSource({ a: 1, list: [1, 2] })));
    expect(payload).toMatchObject({ state: 'source-save-unknown', retryable: false });
  });

  it('only forgives a native description rewrite on secondary indexes', async () => {
    seed('DESD');
    world.sourceOnSave = (body) => body.replace('"description":"x"', '"description":"stored"');
    const { payload } = await run(updateArgs('DESD', jsonSource()));
    expect(payload.state).toBe('source-save-unknown');
  });

  it('refuses a stale source hash under the lock', async () => {
    seed('DRTY');
    const { payload, cleanup } = await run({
      ...updateArgs('DRTY', sourceFor('DRTY')),
      expectedSourceHash: 'c'.repeat(64),
    });
    expect(payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
    expect(cleanup.sessionClosed).toBe(true);
  });

  it.each([
    { label: 'missing hash', args: { expectedSourceHash: undefined }, reason: /expectedSourceHash/ },
    { label: 'missing source', args: { source: undefined }, reason: /non-empty source/ },
    { label: 'package move', args: { package: 'ZTEAM' }, reason: /allowlist/ },
    { label: 'surprise field', args: { lintBeforeWrite: false }, reason: /allowlist/ },
  ])('refuses $label before HTTP', async ({ args, reason }) => {
    await expect(run({ ...updateArgs('DESD', jsonSource()), ...args })).rejects.toThrow(reason);
    expect(world.calls).toEqual([]);
  });

  it('refuses invalid AFF JSON and a type absent from discovery before locking', async () => {
    seed('DESD');
    const invalid = await run(updateArgs('DESD', '{not json'));
    expect(invalid.payload).toMatchObject({ state: 'unchanged' });
    const absent = await run(updateArgs('DESD', jsonSource()), discovery(['DRTY']));
    expect(absent.payload.state).toBe('unchanged');
    expect(absent.payload.phase).toBe('discovery');
    expect(world.calls.some((call) => call.path.includes('_action=LOCK'))).toBe(false);
  });

  it('refuses when discovery is unreachable instead of assuming support', async () => {
    seed('DESD');
    const { payload } = await run(updateArgs('DESD', jsonSource()), new Map());
    expect(payload).toMatchObject({ state: 'unchanged', phase: 'discovery' });
    expect(payload.message).toMatch(/could not be established/);
    expect(puts(world)).toEqual([]);
  });

  it.each([
    { fault: 'save-unknown', state: 'source-save-unknown', error: 'PINNED_WRITE_INCOMPLETE' },
    { fault: 'save-rejected', state: 'source-save-rejected', error: 'PINNED_WRITE_REFUSED' },
    { fault: 'readback', state: 'source-save-unknown', error: 'PINNED_WRITE_INCOMPLETE' },
  ])('reports $fault once and cleans up', async ({ fault, state, error }) => {
    seed('DRTY');
    world.faults.add(fault);
    const { payload, cleanup } = await run(updateArgs('DRTY', `${sourceFor('DRTY')}// x\n`));
    expect(payload).toMatchObject({ state, error, retryable: false });
    expect(puts(world)).toHaveLength(1);
    expect(cleanup).toMatchObject({ unlockFailed: false, sessionClosed: true });
  });

  it.each(['package-drift', 'identity-drift', 'cancel'])('refuses %s under the lock', async (fault) => {
    seed('DESD');
    world.faults.add(fault);
    if (fault === 'cancel') world.abort = new AbortController();
    const { payload, cleanup } = await run(updateArgs('DESD', jsonSource()));
    expect(payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
    expect(cleanup.unlockFailed).toBe(false);
  });

  it('reports an immediately active type that SAP did not leave active', async () => {
    seed('APLO', 'ZTEST', 'inactive');
    const { payload } = await run(updateArgs('APLO', jsonSource()));
    expect(payload).toMatchObject({ error: 'PINNED_WRITE_INCOMPLETE', phase: 'immediate-active-verification' });
  });

  it('records a transportable save on the verified request parent', async () => {
    seed('DESD');
    world.transported = true;
    const { payload } = await run({ ...updateArgs('DESD', jsonSource({ a: 1 })), transport: 'A4HK900002' });
    expect(payload.transport).toBe('A4HK900001');
    expect(puts(world)[0]!.path).toContain('corrNr=A4HK900001');
  });
});

describe('secondary indexes', () => {
  const indexPath = '/sap/bc/adt/ddic/db/indexes/ztest~001';
  const parentPath = '/sap/bc/adt/ddic/tables/ZTEST';
  function seedIndex(source = '{"formatVersion":"1","header":{"description":"a"},"fields":["CLIENT"]}') {
    world.objects.set(indexPath, {
      metadata: fixture('table-index-metadata-758.xml').replace('adtcore:name="$TMP"', 'adtcore:name="ZTEAM"'),
      nativeType: 'TABL/DTI',
      source,
    });
    world.objects.set(parentPath, { metadata: blueSource('ZTEST', 'TABL/DT', 'ZTEAM'), nativeType: 'TABL/DT' });
  }

  it('reads the explicit draft and treats a native description rewrite as saved', async () => {
    const stored = '{"formatVersion":"1","header":{"description":"a"},"fields":["CLIENT"]}';
    seedIndex(stored);
    const requested = '{"formatVersion":"1","header":{"description":"edited"},"fields":["CLIENT","STATUS"]}';
    const snapshot = await handleToolCall(nativeClient(), config, 'SAPRead', {
      type: 'TABL/DTI',
      name: 'ZTEST~001',
      format: 'editable',
    });
    expect(snapshot.isError, snapshot.content[0]!.text).toBeUndefined();
    expect(JSON.parse(snapshot.content[0]!.text)).toMatchObject({ metadataView: 'inactive', sourceView: 'inactive' });
    expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
    world.calls.length = 0;
    // The native PUT stores the definition but ignores the description edit (758 evidence).
    world.sourceOnSave = (body) => body.replace('"description":"edited"', '"description":"a"');
    const { result } = await run({
      action: 'update',
      type: 'TABL/DTI',
      name: 'ZTEST~001',
      source: requested,
      expectedSourceHash: JSON.parse(snapshot.content[0]!.text).sourceHash,
    });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    const draftReads = world.calls.filter(
      (call) => call.method === 'GET' && call.path.includes('/source/main') && call.path.includes('version=inactive'),
    );
    expect(draftReads.map((call) => call.locked)).toEqual([true, true]);
  });

  it('refuses a stale index definition and an index whose parent left the allowed package', async () => {
    seedIndex();
    const stale = await run({
      action: 'update',
      type: 'TABL/DTI',
      name: 'ZTEST~001',
      source: '{"a":1}',
      expectedSourceHash: 'd'.repeat(64),
    });
    expect(stale.payload.state).toBe('unchanged');
    expect(puts(world)).toEqual([]);
    world.objects.get(parentPath)!.metadata = blueSource('ZTEST', 'TABL/DT', 'ZDENIED');
    const denied = await run({
      action: 'update',
      type: 'TABL/DTI',
      name: 'ZTEST~001',
      source: '{"a":1}',
      expectedSourceHash: 'd'.repeat(64),
    });
    expect(denied.payload.state).toBe('unchanged');
    expect(world.calls.filter((call) => call.path.includes('_action=LOCK'))).toHaveLength(1);
  });

  it('creates with the parent table package and container, refusing a mismatched caller package', async () => {
    world.objects.set(indexPath, { metadata: '', nativeType: 'TABL/DTI' });
    world.objects.set(parentPath, { metadata: blueSource('ZTEST', 'TABL/DT', 'ZTEAM'), nativeType: 'TABL/DT' });
    const mismatched = await run({
      action: 'create',
      type: 'TABL/DTI',
      name: 'ZTEST~001',
      package: '$TMP',
      source: '{}',
    });
    expect(mismatched.payload.state).toBe('unchanged');
    expect(mismatched.payload.message).toMatch(/inherits package ZTEAM/);
    const { result, payload } = await run({ action: 'create', type: 'TABL/DTI', name: 'ZTEST~001', source: '{"a":1}' });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload.state).toBe('saved-inactive');
    const post = world.calls.find(
      (call) => call.method === 'POST' && call.path.startsWith('/sap/bc/adt/ddic/db/indexes?'),
    );
    expect(post!.body).toContain('adtcore:containerRef adtcore:name="ZTEST"');
    expect(post!.body).toContain('adtcore:packageRef adtcore:name="ZTEAM"');
  });

  it('refuses an index under a structure parent', async () => {
    world.objects.set(indexPath, { metadata: '', nativeType: 'TABL/DTI' });
    world.objects.set(parentPath, { metadata: blueSource('ZTEST', 'TABL/DS', 'ZTEAM'), nativeType: 'TABL/DS' });
    const { payload } = await run({ action: 'create', type: 'TABL/DTI', name: 'ZTEST~001' });
    expect(payload.state).toBe('unchanged');
    expect(
      world.calls.some((call) => call.method === 'POST' && call.path.startsWith('/sap/bc/adt/ddic/db/indexes')),
    ).toBe(false);
  });
});

describe('server-driven create', () => {
  it.each(ordinary)('%s posts its registry body and saves the supplied source', async (code) => {
    if (code === 'APLO') return;
    world.objects.set(pathFor(code), {
      metadata: '',
      nativeType: SDO_REGISTRY[code as keyof typeof SDO_REGISTRY].createType,
    });
    const source =
      code === 'SAJC'
        ? jsonSource({ generalInformation: { className: 'ZCL_JOB' } })
        : code === 'SAJT'
          ? jsonSource({ generalInformation: { catalogName: 'ZCAT' } })
          : sourceFor(code);
    const { result, payload } = await run({ action: 'create', type: code, name: 'ZTEST', package: 'zteam', source });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload.state).toBe('saved-inactive');
    const entry = SDO_REGISTRY[code as keyof typeof SDO_REGISTRY];
    const post = world.calls.find((call) => call.method === 'POST' && call.path.split('?')[0] === entry.href);
    expect(String(post!.contentType)).toContain(entry.metadataContentType);
    expect(post!.body).toContain(`adtcore:type="${entry.createType}"`);
    expect(post!.body).toContain('adtcore:packageRef adtcore:name="ZTEAM"');
    if (code === 'SAJC') expect(post!.body).toContain('className');
    expect(puts(world)).toHaveLength(1);
  });

  it('reports an immediately active create and its name limit', async () => {
    await expect(
      run({ action: 'create', type: 'APLO', name: 'Z'.repeat(21), package: 'ZTEAM' }),
    ).resolves.toMatchObject({
      payload: { state: 'unchanged' },
    });
    expect(world.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it.each(['SAJC', 'SAJT'])('%s requires its creation reference before the POST', async (code) => {
    world.objects.set(pathFor(code), { metadata: '', nativeType: code });
    const { payload } = await run({
      action: 'create',
      type: code,
      name: 'ZTEST',
      package: 'ZTEAM',
      source: jsonSource(),
    });
    expect(payload.state).toBe('unchanged');
    expect(world.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('reads a metadata-only shell back without a source save', async () => {
    world.objects.set(pathFor('DESD'), { metadata: '', nativeType: 'DESD/TYP' });
    const { payload } = await run({ action: 'create', type: 'DESD', name: 'ZTEST', package: 'ZTEAM' });
    expect(payload.state).toBe('created');
    expect(puts(world)).toEqual([]);
  });

  it('requires an explicit package and refuses a denied one before recording', async () => {
    await expect(run({ action: 'create', type: 'DESD', name: 'ZTEST' })).rejects.toThrow(/explicit package/);
    const { payload } = await run({ action: 'create', type: 'DESD', name: 'ZTEST', package: 'ZDENIED' });
    expect(payload.state).toBe('unchanged');
    expect(world.calls.some((call) => call.path.includes('/transportchecks'))).toBe(false);
  });

  it('keeps a created object truthful when its source save fails', async () => {
    world.objects.set(pathFor('DESD'), { metadata: '', nativeType: 'DESD/TYP' });
    world.faults.add('save-unknown');
    const { payload } = await run({
      action: 'create',
      type: 'DESD',
      name: 'ZTEST',
      package: 'ZTEAM',
      source: jsonSource(),
    });
    expect(payload).toMatchObject({ state: 'created-source-unknown', retryable: false });
    expect(
      world.calls.filter((call) => call.method === 'POST' && call.path.split('?')[0] === SDO_REGISTRY.DESD.href),
    ).toHaveLength(1);
  });

  it.each([
    { fault: 'create-rejected', state: 'creation-rejected' },
    { fault: 'create-unknown', state: 'creation-unknown' },
  ])('preserves $fault', async ({ fault, state }) => {
    world.objects.set(pathFor('DESD'), { metadata: '', nativeType: 'DESD/TYP' });
    world.faults.add(fault);
    const { payload } = await run({ action: 'create', type: 'DESD', name: 'ZTEST', package: 'ZTEAM' });
    expect(payload.state).toBe(state);
  });
});

describe('UIAD', () => {
  const uiad = jsonSource({
    header: { description: 'x', originalLanguage: 'en', abapLanguageVersion: 'cloudDevelopment' },
  });
  function seedUiad(configuration: unknown) {
    seed('UIAD', 'ZTEST', 'active', uiad);
    world.objects.set(`${pathFor('UIAD')}/configuration`, {
      metadata: JSON.stringify(configuration),
      nativeType: 'x',
    });
  }

  it('refuses a read-only descriptor before locking', async () => {
    seedUiad({ 'sap.adt.readonly': true });
    const { payload } = await run(updateArgs('UIAD', uiad, uiad));
    expect(payload.state).toBe('unchanged');
    expect(payload.message).toMatch(/read-only/);
    expect(world.calls.some((call) => call.path.includes('_action=LOCK'))).toBe(false);
  });

  it('saves an editable descriptor as immediately active with its validation summary', async () => {
    seedUiad({ 'sap.adt.readonly': false });
    const snapshot = await handleToolCall(nativeClient(), config, 'SAPRead', {
      type: 'UIAD',
      name: 'ZTEST',
      format: 'editable',
    });
    expect(snapshot.isError, snapshot.content[0]!.text).toBeUndefined();
    expect(world.calls.every((call) => call.method === 'GET')).toBe(true);
    const { result, payload } = await run({
      ...updateArgs('UIAD', uiad, uiad),
      expectedSourceHash: JSON.parse(snapshot.content[0]!.text).sourceHash,
    });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ state: 'saved-active', immediateActivation: true });
    expect(payload.validation).toBeDefined();
  });
});

describe('server-driven delete', () => {
  it.each(ordinary)('%s runs the advertised deletion check under the lock and proves absence', async (code) => {
    seed(code);
    const { result, payload, cleanup } = await run({ action: 'delete', type: code, name: 'ZTEST' });
    expect(result.isError, result.content[0]!.text).toBeUndefined();
    expect(payload).toMatchObject({ ok: true, state: 'deleted' });
    expect(cleanup.sessionClosed).toBe(true);
    const check = world.calls.findIndex((call) => call.path.startsWith('/sap/bc/adt/deletion/check'));
    const remove = world.calls.findIndex((call) => call.method === 'DELETE');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(remove);
    expect(world.calls[check]!.locked).toBe(true);
  });

  it('refuses when SAP does not confirm deletability and reports its reason without a DELETE', async () => {
    seed('DRTY');
    world.faults.add('undeletable');
    const { payload } = await run({ action: 'delete', type: 'DRTY', name: 'ZTEST' });
    expect(payload).toMatchObject({ state: 'unchanged', phase: 'deletion-check' });
    expect(payload.message).toMatch(/can be deleted/);
    expect(world.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('skips only a check that discovery proves unadvertised', async () => {
    seed('DRTY');
    const map = discovery();
    map.delete('/sap/bc/adt/deletion/check');
    const { payload } = await run({ action: 'delete', type: 'DRTY', name: 'ZTEST' }, map);
    expect(payload.state).toBe('deleted');
    expect(world.calls.some((call) => call.path.startsWith('/sap/bc/adt/deletion/check'))).toBe(false);
  });

  it('requests its typed absence read with the registry metadata MIME', async () => {
    seed('EVTO');
    await run({ action: 'delete', type: 'EVTO', name: 'ZTEST' });
    const after = world.calls
      .slice(world.calls.findIndex((call) => call.method === 'DELETE'))
      .find((call) => call.method === 'GET');
    expect(after!.accept).toBe(SDO_REGISTRY.EVTO.metadataContentType);
  });
});

describe('public boundary', () => {
  it.each(SDO_TYPES)('keeps public %s mutations and activation closed', async (code) => {
    for (const [tool, args] of [
      ['SAPWrite', { action: 'create', package: 'ZTEAM' }],
      ['SAPWrite', { action: 'update', source: jsonSource() }],
      ['SAPWrite', { action: 'delete' }],
      ['SAPActivate', { action: 'activate' }],
    ] as const) {
      const name = code === 'TABL/DTI' ? 'ZTEST~001' : 'ZTEST';
      const result = await handleToolCall(nativeClient(discovery()), config, tool, { type: code, name, ...args });
      expect(result.isError).toBe(true);
    }
    expect(
      world.calls.filter((call) => call.method === 'POST' || call.method === 'PUT' || call.method === 'DELETE'),
    ).toEqual([]);
  });
});

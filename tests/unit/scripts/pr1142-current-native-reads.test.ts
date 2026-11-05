import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  currentOwner,
  makeCurrentManifest,
  sha,
} from '../../../scripts/qualification/pr1142/current-workflow-contract.mjs';
import { observeCurrentNative } from '../../../scripts/qualification/pr1142/current-workflow-native-reads.mjs';
import { AdtApiError } from '../../../src/adt/errors.js';

const core = 'http://www.sap.com/adt/core';
const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/></exc:exception>';
function setup(index = 0) {
  const manifest: any = makeCurrentManifest(
    '0123456789ABCDEF0123456789ABCDEF',
    { recording: { package: 'ZARC1_DEMO', request: 'A4HK900001', task: 'A4HK900002', owner: 'PRIMARY' } },
    {
      target: 'PR1142/001',
      actors: [
        { label: 'writerA', sapUser: 'PRIMARY' },
        { label: 'writerB', sapUser: 'SECONDARY' },
      ],
    },
  );
  const f = manifest.fixtures[index],
    owner = currentOwner(f),
    creator = f.actor === 'writerA' ? 'PRIMARY' : 'SECONDARY';
  const [element, namespace, type] =
    f.type === 'CLAS'
      ? ['abapClass', 'http://www.sap.com/adt/oo/classes', 'CLAS/OC']
      : f.type === 'PROG'
        ? ['abapProgram', 'http://www.sap.com/adt/programs/programs', 'PROG/P']
        : ['abapInclude', 'http://www.sap.com/adt/programs/includes', 'PROG/I'];
  let metadata = `<n:${element} xmlns:n="${namespace}" xmlns:c="${core}" c:name="${f.name}" c:type="${type}" c:version="active" c:createdBy="${creator}" c:changedBy="${creator}" c:createdAt="2026-11-03T00:00:00Z" c:masterSystem="A4H"><c:packageRef c:name="${f.package}" c:type="DEVC/K"/>${f.type === 'CLAS' && index === 0 ? '<n:include n:includeType="testclasses" c:changedBy="PRIMARY" c:version="active"/>' : ''}</n:${element}>`;
  const source = `" ${manifest.marker}\nowned source`,
    tests = `" ${manifest.marker}\nowned tests`,
    changed = { source: false, metadata: false, part: false, errorBody: '', missing: false, foreignRecording: false };
  let metadataReads = 0;
  const get = vi.fn(async (path: string) => {
    if (changed.missing) throw new AdtApiError('missing', 404, path, changed.errorBody || absent);
    let body: string;
    if (path === owner) {
      metadataReads++;
      body =
        changed.metadata && metadataReads > 1
          ? metadata.replace('createdBy="PRIMARY"', 'createdBy="FOREIGN"')
          : metadata;
    } else if (path.includes('/includes/testclasses')) body = tests;
    else if (path.startsWith(`${owner}/source/main`))
      body = changed.source && path.includes('version=active') ? 'foreign source' : source;
    else if (path.startsWith('/sap/bc/adt/textelements/programs/')) {
      if (path.includes('/source/'))
        body = changed.part && path.endsWith('version=active') ? 'foreign text' : '001=owned text';
      else
        body = `<t:textElement xmlns:t="http://www.sap.com/adt/textelements" xmlns:c="${core}" c:name="${f.name}" c:type="PROG/PX" c:version="active"/>`;
    } else throw new Error(`Unexpected GET ${path}`);
    return { body, statusCode: 200 };
  });
  const readTransport = vi.fn(async () => ({
    id: 'A4HK900001',
    owner: 'PRIMARY',
    type: 'K',
    status: 'D',
    tasks: [
      {
        id: 'A4HK900002',
        owner: 'PRIMARY',
        status: 'D',
        objects: changed.foreignRecording
          ? []
          : [{ pgmid: 'R3TR', type: f.type === 'INCL' ? 'PROG' : f.type, name: f.name }],
      },
    ],
  }));
  return {
    manifest,
    f,
    owner,
    source,
    tests,
    changed,
    get,
    readTransport,
    metadata: (change: (value: string) => string) => {
      metadata = change(metadata);
    },
    observe: (mode = 'identity', proveCreatedOwner: any = undefined) =>
      observeCurrentNative({ manifest, mode, name: f.name, http: { get }, readTransport, proveCreatedOwner }),
  };
}
describe('current fixed native readback over real namespace/CTS parsers', () => {
  it.each([0, 1, 2, 3])(
    'verifies owner %i using GET only, native creator/state, exact active source and recording',
    async (index) => {
      const f = setup(index),
        result = await f.observe();
      expect(result.fixtures[0]).toMatchObject({ name: f.f.name, sourceHash: sha(f.source) });
      expect(f.get.mock.calls.every(([path]) => path.startsWith('/sap/bc/adt/'))).toBe(true);
      if (index === 3)
        expect((result.fixtures[0] as any).textPool.parts).toEqual({
          symbols: sha('001=owned text'),
          selections: sha('001=owned text'),
          headings: sha('001=owned text'),
        });
    },
  );
  it.each([
    ['version="active"', 'version="inactive"'],
    ['createdBy="PRIMARY"', 'createdBy="FOREIGN"'],
    ['changedBy="PRIMARY"', 'changedBy="FOREIGN"'],
    ['masterSystem="A4H"', 'masterSystem="OTHER"'],
    ['c:name="ZARC1_DEMO"', 'c:name="$TMP"'],
    [`xmlns:c="${core}"`, 'xmlns:c="urn:foreign"'],
  ])('refuses identity drift %s', async (before, after) => {
    const f = setup();
    f.metadata((x) => x.replace(before, after));
    await expect(f.observe()).rejects.toThrow();
  });
  it('refuses mixed active/default source observations', async () => {
    const f = setup();
    f.changed.source = true;
    await expect(f.observe()).rejects.toThrow('CURRENT_NATIVE_SOURCE_NOT_ACTIVE');
  });
  it('refuses metadata changes across source awaits', async () => {
    const f = setup();
    f.changed.metadata = true;
    await expect(f.observe()).rejects.toThrow('CURRENT_NATIVE_METADATA_CHANGED_DURING_READ');
  });
  it('refuses an unconfirmed recording entry', async () => {
    const f = setup();
    f.changed.foreignRecording = true;
    await expect(f.observe()).rejects.toThrow('FIXTURE_RECORDING_NOT_CONFIRMED');
  });
  it('verifies all text-pool parts rather than inferring pool state from main source', async () => {
    const f = setup(3);
    f.changed.part = true;
    await expect(f.observe()).rejects.toThrow('CURRENT_TEXT_PART_NOT_ACTIVE');
  });
  it('accepts only the typed, correctly namespaced native absence envelope', async () => {
    const f = setup();
    f.changed.missing = true;
    expect((await f.observe('absence')).fixtures[0]).toMatchObject({
      absent: true,
      absence: 'ExceptionResourceNotFound',
    });
    expect(f.readTransport).not.toHaveBeenCalled();
  });
  it.each([
    '<html><type id="ExceptionResourceNotFound"/></html>',
    absent.replace('communicationframework', 'foreign'),
    absent.replace('<namespace id="com.sap.adt"/>', ''),
    absent.replace('ExceptionResourceNotFound', 'ExceptionNoAuthorization'),
  ])('refuses ambiguous/generic 404 %s', async (body) => {
    const f = setup();
    f.changed.missing = true;
    f.changed.errorBody = body;
    await expect(f.observe('absence')).rejects.toThrow();
  });
  it('refuses arbitrary native modes before GET', async () => {
    const f = setup();
    await expect(f.observe('cleanup')).rejects.toThrow('UNKNOWN_CURRENT_NATIVE_MODE');
    expect(f.get).not.toHaveBeenCalled();
  });
});

describe('native program/include creator absence', () => {
  const proof = (f: any) => ({
    kind: 'verified-pp-create',
    runId: 'owned-test-run',
    sourceRevision: 'a'.repeat(40),
    name: f.name,
    type: f.type,
    actor: f.actor,
    createReceiptHash: 'b'.repeat(64),
    initialSourceHash: 'c'.repeat(64),
  });
  it('accepts the actual owned A4H include metadata without inventing a native creator', async () => {
    const f = setup(2);
    const captured = readFileSync(
      new URL('../../fixtures/xml/pr1142-owned-include-active.xml', import.meta.url),
      'utf8',
    );
    expect(sha(captured)).toBe('233c1574592fa69c594061d3b476d1ff773e24303e6738937a746c30487950d8');
    f.metadata(() =>
      captured
        .replaceAll('ZARC1_PP_I_C0F4DEE08D0A', f.f.name)
        .replaceAll('zarc1_pp_i_c0f4dee08d0a', f.f.name.toLowerCase())
        .replaceAll('MARIAN', 'PRIMARY'),
    );
    const result = await f.observe('identity', async () => proof(f.f));
    expect(result.fixtures[0]).toMatchObject({
      identity: { createdBy: null, changedBy: 'PRIMARY' },
      nativeCreatorEvidence: 'unavailable',
    });
  });
  it.each([2, 3])('reports missing native creator honestly for owner %i with owned PP provenance', async (index) => {
    const f = setup(index);
    f.metadata((x) => x.replace(' c:createdBy="PRIMARY"', ' c:responsible="PRIMARY"'));
    const prove = vi.fn(async () => proof(f.f));
    const result = await f.observe('identity', prove);
    expect(prove).toHaveBeenCalledOnce();
    expect(result.fixtures[0]).toMatchObject({
      identity: { createdBy: null, changedBy: 'PRIMARY', version: 'active' },
      nativeCreatorEvidence: 'unavailable',
      ownedCreate: proof(f.f),
      sourceHash: sha(f.source),
    });
    expect(f.readTransport).toHaveBeenCalledOnce();
    expect(f.get.mock.calls.filter(([path]) => path === f.owner)).toHaveLength(2);
  });
  it.each([2, 3])('does not use responsible without provenance for owner %i', async (index) => {
    const f = setup(index);
    f.metadata((x) => x.replace(' c:createdBy="PRIMARY"', ' c:responsible="PRIMARY"'));
    await expect(f.observe()).rejects.toThrow('CURRENT_OWNED_CREATE_PROOF_REQUIRED');
    expect(f.get).toHaveBeenCalledOnce();
    expect(f.readTransport).not.toHaveBeenCalled();
  });
  it.each(['', 'FOREIGN'])('refuses present creator %j even with valid responsibility/provenance', async (value) => {
    const f = setup(2),
      prove = vi.fn(async () => proof(f.f));
    f.metadata((x) => x.replace('c:createdBy="PRIMARY"', `c:createdBy="${value}" c:responsible="PRIMARY"`));
    await expect(f.observe('identity', prove)).rejects.toThrow('CURRENT_NATIVE_IDENTITY_MISMATCH');
    expect(prove).not.toHaveBeenCalled();
    expect(f.get).toHaveBeenCalledOnce();
  });
  it('keeps CLAS creator mandatory even with a successful PP create proof', async () => {
    const f = setup(),
      prove = vi.fn(async () => proof(f.f));
    f.metadata((x) => x.replace(' c:createdBy="PRIMARY"', ''));
    await expect(f.observe('identity', prove)).rejects.toThrow('CURRENT_NATIVE_IDENTITY_MISMATCH');
    expect(prove).not.toHaveBeenCalled();
  });
  it.each(['name', 'type', 'actor', 'createReceiptHash'])(
    'refuses a mismatched %s proof before source reads',
    async (key) => {
      const f = setup(2);
      f.metadata((x) => x.replace(' c:createdBy="PRIMARY"', ''));
      await expect(f.observe('identity', async () => ({ ...proof(f.f), [key]: 'foreign' }))).rejects.toThrow(
        'CURRENT_OWNED_CREATE_PROOF_MISMATCH',
      );
      expect(f.get).toHaveBeenCalledOnce();
    },
  );
  it('still refuses active-source and recording mismatches with unknown creator', async () => {
    const f = setup(2);
    f.metadata((x) => x.replace(' c:createdBy="PRIMARY"', ''));
    f.changed.source = true;
    await expect(f.observe('identity', async () => proof(f.f))).rejects.toThrow('CURRENT_NATIVE_SOURCE_NOT_ACTIVE');
    f.changed.source = false;
    f.changed.foreignRecording = true;
    await expect(f.observe('identity', async () => proof(f.f))).rejects.toThrow('FIXTURE_RECORDING_NOT_CONFIRMED');
  });
});

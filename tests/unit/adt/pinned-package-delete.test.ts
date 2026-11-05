import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { managedHarness, nativeAbsent, packageXml } from './pinned-managed-harness.js';

// Load native modules only after the shared harness has registered mock fetch.
const { deletePinnedPackage } = await import('../../../src/adt/pinned-package.js');
const { PackageTreeNoEvidenceError } = await import('../../../src/adt/package-browser.js');
const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');
const owner = '/sap/bc/adt/packages/%24NEW';
const environment = { cloud: false, abapRelease: '758' };
let harness: ReturnType<typeof managedHarness>;
let exists: boolean, locked: boolean;
let metadata: string, lockedMetadata: string | undefined;
let browser: string, deleteStatus: number, readback: string, unlockStatus: number, closeStatus: number;
let recording: string | undefined, lockedRecording: string | undefined;
let beforeDelete: (() => void) | undefined, afterDelete: (() => void) | undefined;
const localInfo =
  '<DATA><DEVCLASS>$NEW</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RECORDING/><LOCKS/><RESULT>S</RESULT></DATA>';
const recordedInfo = localInfo
  .replace('LOCAL', 'HOME')
  .replace('<RECORDING/>', '<RECORDING>X</RECORDING>')
  .replace(
    '<LOCKS/>',
    '<LOCKS><CTS_OBJECT_LOCK><LOCK_HOLDER><REQ_HEADER><TRKORR>A4HK900001</TRKORR></REQ_HEADER></LOCK_HOLDER></CTS_OBJECT_LOCK></LOCKS>',
  );

beforeEach(() => {
  vi.restoreAllMocks();
  exists = true;
  locked = false;
  metadata = packageXml('$NEW');
  lockedMetadata = undefined;
  browser = 'incomplete';
  deleteStatus = 204;
  readback = nativeAbsent;
  unlockStatus = 200;
  closeStatus = 200;
  recording = undefined;
  lockedRecording = undefined;
  beforeDelete = undefined;
  afterDelete = undefined;
  harness = managedHarness((r) => {
    if (r.path.includes('_action=LOCK')) {
      locked = true;
      return undefined;
    }
    if (r.path.includes('_action=UNLOCK')) return mockResponse(unlockStatus, unlockStatus === 404 ? nativeAbsent : '');
    if (r.path === '/sap/bc/adt/core/http/sessions') return mockResponse(closeStatus, '');
    if (r.path === '/sap/bc/adt/cts/transportrequests/A4HK900001')
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"/></tm:root>',
      );
    if (r.path.includes('transportchecks')) {
      const body = locked ? (lockedRecording ?? recording) : recording;
      if (locked) beforeDelete?.();
      return body ? mockResponse(200, body) : undefined;
    }
    if (r.method === 'GET' && r.path === owner)
      return exists ? mockResponse(200, locked ? (lockedMetadata ?? metadata) : metadata) : mockResponse(404, readback);
    if (r.method === 'DELETE' && r.path.startsWith(`${owner}?`)) {
      if (deleteStatus === 0) throw new Error('PRIVATE lost connection');
      if (deleteStatus === 204) exists = false;
      afterDelete?.();
      return mockResponse(
        deleteStatus,
        deleteStatus === 204 ? '' : 'Native refusal PRIVATE_DIAGNOSTIC',
        deleteStatus === 403 ? { 'x-csrf-token': 'Required' } : {},
      );
    }
    return undefined;
  });
  harness.client.getDirectPackageContents = vi.fn(async () => {
    if (browser === 'incomplete') throw new PackageTreeNoEvidenceError('No complete browser evidence');
    if (browser === '403') throw new AdtApiError('denied', 403, '/browser');
    return {
      objects: browser === 'empty' ? [] : [{ type: browser, name: 'ZCHILD', uri: '/sap/bc/adt/packages/ZCHILD' }],
      listing: {},
    } as any;
  });
});
const deleteContext = (signal?: AbortSignal, client = harness.client, bytes = 4 * 1024 * 1024) =>
  pinnedMutationContext(
    client.safety,
    { deadline: Date.now() + 30_000, signal, responseBudget: new DataResponseBudget(bytes, 'package-delete', true) },
    { unlockFailed: false },
  );
const run = (input = { name: '$NEW' }, env = environment, context = deleteContext()) =>
  deletePinnedPackage(harness.client, context, input, env);
const deletes = () => harness.calls.filter((r) => r.method === 'DELETE');
const locks = () => harness.calls.filter((r) => r.path.includes('_action=LOCK'));
const unlocks = () => harness.calls.filter((r) => r.path.includes('_action=UNLOCK'));

describe('private local package native DELETE', () => {
  it.each(['empty', 'incomplete'])(
    'uses native eligibility despite %s browser evidence and verifies typed absence',
    async (kind) => {
      browser = kind;
      const result = await run();
      expect(result).toMatchObject({
        ok: true,
        state: 'deleted',
        contentEvidence: 'native-delete-contract',
        recording: { local: true },
        retryable: false,
      });
      expect(deletes()).toHaveLength(1);
      expect(locks()).toHaveLength(1);
      expect(unlocks()).toHaveLength(1);
      expect(deletes()[0].path).not.toContain('corrNr');
      expect(deletes()[0].headers.get('cookie')).toContain('SECRET_SESSION');
      expect(unlocks()[0].headers.get('cookie')).toContain('SECRET_SESSION');
      expect(harness.calls.filter((r) => r.path.includes('transportchecks'))).toHaveLength(2);
      expect(harness.client.getDirectPackageContents).toHaveBeenCalledTimes(2);
      expect(harness.calls.filter((r) => r.path === owner && r.method === 'GET')).toHaveLength(3);
      expect(JSON.stringify(result)).not.toMatch(/SECRET_HANDLE|SECRET_SESSION|PRIVATE_DIAGNOSTIC/);
    },
  );
  it('uses actual native local evidence rather than requiring a dollar-name', async () => {
    const selected = '/sap/bc/adt/packages/ZTEAM';
    const h = managedHarness((r) => {
      if (r.method === 'DELETE' && r.path.startsWith(`${selected}?`)) {
        exists = false;
        return mockResponse(204, '');
      }
      if (r.method === 'GET' && r.path === selected)
        return exists ? mockResponse(200, packageXml('ZTEAM')) : mockResponse(404, nativeAbsent);
      return undefined;
    });
    h.client.getDirectPackageContents = async () => {
      throw new PackageTreeNoEvidenceError('unknown');
    };
    expect(
      await deletePinnedPackage(h.client, deleteContext(undefined, h.client), { name: 'ZTEAM' }, environment),
    ).toMatchObject({
      ok: true,
      state: 'deleted',
    });
    expect(h.calls.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  });
  it('preserves namespace-aware native aliases without lexical false matches', async () => {
    metadata = metadata
      .replaceAll('<p:', '<pkg:')
      .replaceAll('</p:', '</pkg:')
      .replaceAll(' p:', ' pkg:')
      .replace('xmlns:p=', 'xmlns:pkg=')
      .replaceAll('"', "'")
      .replace(
        "pkg:recordChanges='false'",
        `pkg:recordChanges='false' xmlns:x='urn:opaque' x:note='pkg:recordChanges="true"'`,
      );
    expect(await run()).toMatchObject({ ok: true, state: 'deleted' });
  });
  it('stops if content appears only under the lock', async () => {
    harness.client.getDirectPackageContents = vi.fn(async () => {
      if (!locked) throw new PackageTreeNoEvidenceError('unknown');
      return {
        objects: [{ type: 'DEVC/K', name: '$CHILD', uri: '/sap/bc/adt/packages/%24CHILD' }],
        listing: {},
      } as any;
    });
    expect(await run()).toMatchObject({ state: 'unchanged', phase: 'locked-policy' });
    expect(deletes()).toHaveLength(0);
    expect(unlocks()).toHaveLength(1);
  });
  it.each(['CLAS/OC', 'DEVC/K', 'PINF/PI', '403'])(
    'refuses known content or browser access failure %s before lock',
    async (kind) => {
      browser = kind;
      expect(await run()).toMatchObject({ ok: false, state: 'unchanged' });
      expect(locks()).toHaveLength(0);
      expect(deletes()).toHaveLength(0);
    },
  );
  it.each([
    ['component', (s: string) => s.replace('p:name="LOCAL"', 'p:name="HOME"')],
    ['recording', (s: string) => s.replace('p:recordChanges="false"', 'p:recordChanges="true"')],
    ['missing recording', (s: string) => s.replace('p:recordChanges="false"', '')],
    ['padded recording', (s: string) => s.replace('p:recordChanges="false"', 'p:recordChanges=" false "')],
    ['nondevelopment', (s: string) => s.replace('p:packageType="development"', 'p:packageType="structure"')],
    ['transport layer', (s: string) => s.replace('<p:transportLayer p:name=""', '<p:transportLayer p:name="ZDEV"')],
    ['wrong owner', (s: string) => s.replace('adtcore:name="$NEW"', 'adtcore:name="$OTHER"')],
    ['foreign recording namespace', (s: string) => s.replace('p:recordChanges=', 'adtcore:recordChanges=')],
    [
      'ambiguous recording',
      (s: string) => s.replace('p:recordChanges="false"', 'p:recordChanges="false" adtcore:recordChanges="false"'),
    ],
  ])('refuses %s metadata both before and under the lock', async (_label, transform) => {
    metadata = transform(packageXml('$NEW'));
    expect(await run()).toMatchObject({ state: 'unchanged' });
    expect(locks()).toHaveLength(0);
    metadata = packageXml('$NEW');
    lockedMetadata = transform(metadata);
    expect(await run()).toMatchObject({ state: 'unchanged', phase: 'locked-policy' });
    expect(deletes()).toHaveLength(0);
    expect(unlocks()).toHaveLength(1);
  });
  it.each(['server', 'destination'])('enforces the %s package allowlist', async (side) => {
    if (side === 'server') harness.client.safety.allowedPackages = ['$TMP'];
    else
      harness.client.safety.multiTargetWrite = {
        ...harness.client.safety.multiTargetWrite!,
        allowedPackages: ['$TMP'],
      };
    expect(await run()).toMatchObject({ state: 'unchanged' });
    expect(locks()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });
  it.each([
    { name: '$TMP' },
    { name: '../$NEW' },
    { name: '$NEW', transport: 'A4HK900001' },
    { name: '$NEW', transport: '' },
    { name: '$NEW', force: true },
  ])('refuses protected/unsafe/recorded input before requests: %j', async (input) => {
    expect(await run(input)).toMatchObject({ state: 'unchanged', phase: 'validation' });
    expect(harness.calls).toHaveLength(0);
  });
  it.each([
    { cloud: true, abapRelease: '758' },
    { cloud: false, abapRelease: '750' },
    { cloud: false, abapRelease: '' },
  ])('keeps unqualified environment %j closed', async (env) => {
    expect(await run({ name: '$NEW' }, env)).toMatchObject({ state: 'unchanged', phase: 'validation' });
    expect(harness.calls).toHaveLength(0);
  });
  it('refuses nonlocal recording before and under lock, even if metadata claims local', async () => {
    recording = recordedInfo;
    expect(await run()).toMatchObject({
      state: 'unchanged',
      message: expect.stringContaining('fresh native local recording'),
    });
    expect(locks()).toHaveLength(0);
    recording = undefined;
    lockedRecording = recordedInfo;
    expect(await run()).toMatchObject({ state: 'unchanged', phase: 'locked-policy' });
    expect(deletes()).toHaveLength(0);
    expect(unlocks()).toHaveLength(1);
  });
  it.each([400, 403, 409, 412, 423, 429, 500, 503])(
    'reports submitted HTTP %s without replay or no-side-effects claims',
    async (status) => {
      deleteStatus = status;
      const result = await run();
      expect(result).toMatchObject({
        ok: false,
        state: status < 429 ? 'delete-rejected' : 'delete-unconfirmed',
        retryable: false,
      });
      expect(result.warnings).toContain('bookkeeping');
      expect(deletes()).toHaveLength(1);
      expect(unlocks()).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_DIAGNOSTIC');
    },
  );
  it('does not retry a lost DELETE response or expose its diagnostics', async () => {
    deleteStatus = 0;
    const result = await run();
    expect(result).toMatchObject({ state: 'delete-unconfirmed', retryable: false });
    expect(deletes()).toHaveLength(1);
    expect(unlocks()).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE lost connection');
  });
  it.each(['<html>Missing</html>', '<error>not found</error>'])(
    'does not turn an untyped absence into confirmation',
    async (body) => {
      readback = body;
      expect(await run()).toMatchObject({ state: 'delete-unconfirmed', phase: 'absence-readback' });
      expect(deletes()).toHaveLength(1);
    },
  );
  it('retains successful deletion when cleanup fails', async () => {
    unlockStatus = 500;
    expect(await run()).toMatchObject({ ok: false, state: 'deleted', cleanupFailed: true, cleanupPhase: 'unlock' });
    expect(deletes()).toHaveLength(1);
  });
  it('resolves typed missing unlock only with owning-session closure', async () => {
    unlockStatus = 404;
    expect(await run()).toMatchObject({
      ok: true,
      state: 'deleted',
      removedLocksAfterDelete: [{ uri: owner, statusCode: 404 }],
    });
    closeStatus = 500;
    exists = true;
    expect(await run()).toMatchObject({ ok: false, state: 'deleted', cleanupFailed: true });
  });
  it('stops at cancellation under lock and still cleans up in its owning session', async () => {
    const abort = new AbortController();
    beforeDelete = () => abort.abort();
    expect(await run({ name: '$NEW' }, environment, deleteContext(abort.signal))).toMatchObject({
      state: 'unchanged',
    });
    expect(deletes()).toHaveLength(0);
    expect(unlocks()).toHaveLength(1);
    expect(unlocks()[0].headers.get('cookie')).toContain('SECRET_SESSION');
  });
  it('keeps cancellation after DELETE uncertain and never retries', async () => {
    const abort = new AbortController();
    afterDelete = () => abort.abort();
    expect(await run({ name: '$NEW' }, environment, deleteContext(abort.signal))).toMatchObject({
      state: 'delete-unconfirmed',
    });
    expect(deletes()).toHaveLength(1);
    expect(unlocks()).toHaveLength(1);
  });
  it('refuses a read-only ceiling before any native read or lock', async () => {
    harness.client.safety.allowWrites = false;
    expect(await run()).toMatchObject({ state: 'unchanged', phase: 'validation' });
    expect(harness.calls).toHaveLength(0);
  });
  it('keeps resource responses bounded before parsing and locking', async () => {
    metadata = metadata.replace('</p:package>', `<p:opaque>${'x'.repeat(1024 * 1024)}</p:opaque></p:package>`);
    expect(await run()).toMatchObject({ state: 'unchanged' });
    expect(locks()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });
  it('requires a bounded all-response context and stops when its budget is exhausted', async () => {
    expect(await run({ name: '$NEW' }, environment, harness.context())).toMatchObject({
      state: 'unchanged',
      phase: 'validation',
    });
    expect(
      await run({ name: '$NEW' }, environment, deleteContext(undefined, harness.client, 9 * 1024 * 1024)),
    ).toMatchObject({ state: 'unchanged', phase: 'validation' });
    expect(harness.calls).toHaveLength(0);
    expect(await run({ name: '$NEW' }, environment, deleteContext(undefined, harness.client, 100))).toMatchObject({
      state: 'unchanged',
    });
    expect(locks()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });
  it('refuses expired and mismatched registered contexts without requests', async () => {
    const expired = pinnedMutationContext(
      harness.client.safety,
      { deadline: Date.now() - 1, responseBudget: new DataResponseBudget(1024, 'expired', true) },
      { unlockFailed: false },
    );
    expect(await run({ name: '$NEW' }, environment, expired)).toMatchObject({ state: 'unchanged' });
    const old = deleteContext();
    harness.client.safety.multiTargetWrite = { ...harness.client.safety.multiTargetWrite! };
    expect(await run({ name: '$NEW' }, environment, old)).toMatchObject({ state: 'unchanged' });
    expect(harness.calls).toHaveLength(0);
  });
});

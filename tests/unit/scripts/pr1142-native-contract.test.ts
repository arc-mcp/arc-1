import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { nextContractActiveReceipt } from '../../../scripts/qualification/pr1142/native-contract-inventory.js';
import {
  checkContractMutation,
  contractFunctionMetadataHash,
  contractIdentity,
  contractMetadataHash,
  contractRequestPolicy,
  contractSelection,
  isNativeContractOrigin,
  observeContractHttp,
} from '../../../scripts/qualification/pr1142/native-contract-transport.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtRequestNotSentError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { buildCreateXml } from '../../../src/handlers/write-helpers.js';

it.each([
  'version="active"',
  'xmlns:foreign="urn:foreign" foreign:version="active"',
  'xmlns:other="http://www.sap.com/adt/core" other:version="active" adtcore:version="inactive"',
  'xmlns:foreign="urn:foreign" foreign:version="active" adtcore:version="inactive"',
  'xmlns:version="active"',
])('rejects an unqualified, foreign or duplicate native version: %s', (version) => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../fixtures/adt/function-metadata-a4h-activation.json', import.meta.url), 'utf8'),
  );
  const xml = fixture.saved.xml.replace('adtcore:version="inactive"', version);
  expect(xml).not.toBe(fixture.saved.xml);
  expect(() => contractIdentity(xml, false, contractSelection(fixture.suffix), fixture.marker)).toThrow();
});

it('replays retained native post-create and post-save active metadata with the narrowed comparator', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../fixtures/adt/function-metadata-a4h-activation.json', import.meta.url), 'utf8'),
  );
  const selection = contractSelection(fixture.suffix);
  const active = [fixture.postCreateActive, fixture.postSaveActive].map((row) => {
    expect(createHash('sha256').update(row.xml).digest('hex')).toBe(row.sha256);
    expect(contractIdentity(row.xml, false, selection, fixture.marker).nativeVersion).toBe('active');
    expect(row.xml).toContain('source/main?version=inactive');
    return { hash: row.sourceHash, metadataHash: contractFunctionMetadataHash(row.xml, selection) };
  });
  expect(active[1]).toEqual(active[0]);
  const initial = nextContractActiveReceipt(undefined, active[0], active[0].hash);
  expect(nextContractActiveReceipt(initial, active[1], 'f'.repeat(64))).toEqual({
    metadataHash: active[0].metadataHash,
    sourceHashes: [active[0].hash, 'f'.repeat(64)],
  });
});

const selected = contractSelection('0123456789ABCDEF');
const core = 'http://www.sap.com/adt/core';
afterEach(() => vi.restoreAllMocks());

it('refuses unsafe TLS at the real entrypoint before reading credentials or starting a probe', () => {
  const path = fileURLToPath(
    new URL('../../../scripts/qualification/pr1142/native-function-contract.ts', import.meta.url),
  );
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', path, '--execute-reviewed-active-delete', '0'.repeat(40)],
    {
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  expect(child.status).toBe(1);
  expect(child.stderr).toContain('TLS_VERIFICATION_REQUIRED');
  expect(child.stderr).not.toContain('Requires --execute-reviewed-revision');
});

it('binds stored credentials to the documented origin, excluding userinfo and other endpoints', () => {
  expect(isNativeContractOrigin('https://a4h.marianzeis.de')).toBe(true);
  expect(isNativeContractOrigin('https://a4h.marianzeis.de:443/')).toBe(true);
  for (const value of [
    undefined,
    'bad URL',
    'http://a4h.marianzeis.de',
    'https://other.example',
    'https://a4h.marianzeis.de:50001',
    'https://u:p@a4h.marianzeis.de',
    'https://a4h.marianzeis.de/other',
    'https://a4h.marianzeis.de/?other',
  ])
    expect(isNativeContractOrigin(value)).toBe(false);
});

it('keeps fresh fixture identifiers within native group/module limits', () => {
  expect(selected.group.length).toBeLessThanOrEqual(26);
  expect(selected.module.length).toBeLessThanOrEqual(30);
  expect(() => contractSelection('other')).toThrow('fresh 16-hex');
});
it.each([
  ['GET', 'https://foreign.example/sap/bc/adt/discovery'],
  ['GET', '/sap/bc/adt/../../admin'],
  ['PUT', `${selected.groupUrl}/source/main`],
  ['DELETE', '/sap/bc/adt/functions/groups/zforeign'],
  ['POST', '/sap/bc/adt/activation?method=activate&preauditRequested=false'],
])('refuses unplanned %s %s', (method, path) => {
  expect(() => checkContractMutation(selected, method, path)).toThrow();
});
it('allows only one selected initial activation reference with matching identity', () => {
  const body = `<c:objectReferences xmlns:c="${core}"><c:objectReference c:uri="${selected.moduleUrl}" c:name="${selected.module}"/></c:objectReferences>`;
  const path = '/sap/bc/adt/activation?method=activate&preauditRequested=true';
  expect(() => checkContractMutation(selected, 'POST', path, body)).not.toThrow();
  expect(() =>
    checkContractMutation(selected, 'POST', path, body.replace(selected.moduleUrl, selected.groupUrl)),
  ).toThrow('outside');
  expect(() =>
    checkContractMutation(selected, 'POST', path, body.replace(`c:name="${selected.module}"`, 'c:name="ZFOREIGN"')),
  ).toThrow('outside');
});
it('checks both module identity and its creation container', () => {
  const body = `<f:abapFunctionModule xmlns:f="http://www.sap.com/adt/functions/fmodules" xmlns:c="${core}" c:name="${selected.module}"><c:containerRef c:name="${selected.group}" c:type="FUGR/F" c:uri="${selected.groupUrl}"/></f:abapFunctionModule>`;
  expect(() => checkContractMutation(selected, 'POST', `${selected.groupUrl}/fmodules`, body)).not.toThrow();
  expect(() =>
    checkContractMutation(
      selected,
      'POST',
      `${selected.groupUrl}/fmodules`,
      body.replace(selected.groupUrl, '/sap/bc/adt/functions/groups/zforeign'),
    ),
  ).toThrow('outside');
});
it('preserves tighter deadlines and forbids replay', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  expect(contractRequestPolicy()).toMatchObject({ deadline: 31000, noReplay: true, retryTransientErrors: false });
  expect(() => contractRequestPolicy({ deadline: NaN })).toThrow('must be finite');
  expect(contractRequestPolicy({ deadline: 2000, noReplay: false, retryTransientErrors: true })).toMatchObject({
    deadline: 2000,
    noReplay: true,
    retryTransientErrors: false,
  });
});
it('ignores native version, timestamp and ETag changes without ignoring owner properties', () => {
  const xml =
    '<f adtcore:version="inactive" adtcore:changedAt="old" adtcore:changedBy="MARIAN" processingType="normal"><link href="source/main" etag="202611020447060001"/></f>';
  expect(contractMetadataHash(xml.replace('inactive', 'active').replace('old', 'new'))).toBe(contractMetadataHash(xml));
  expect(contractMetadataHash(xml.replace('normal', 'rfc'))).not.toBe(contractMetadataHash(xml));
  expect(contractMetadataHash(xml.replace('MARIAN', 'FOREIGN'))).not.toBe(contractMetadataHash(xml));
  expect(contractMetadataHash(xml.replace('202611020447060001', '202611020447060011'))).toBe(contractMetadataHash(xml));
  expect(contractMetadataHash(xml.replace('source/main', 'source/foreign'))).not.toBe(contractMetadataHash(xml));
});
it('uses native FUNC last-changer evidence without inventing a creator field', () => {
  const xml = `<f:abapFunctionModule xmlns:f="http://www.sap.com/adt/functions/fmodules" xmlns:c="${core}" c:name="${selected.module}" c:type="FUGR/FF" c:description="fixture" c:changedBy="MARIAN"><c:containerRef c:name="${selected.group}" c:type="FUGR/F" c:uri="${selected.groupUrl}" c:packageName="$TMP"/></f:abapFunctionModule>`;
  expect(contractIdentity(xml, false, selected, 'fixture')).toEqual({
    creator: undefined,
    changedBy: 'MARIAN',
    nativeVersion: undefined,
  });
  expect(() => contractIdentity(xml.replace('MARIAN', 'FOREIGN'), false, selected, 'fixture')).toThrow(
    'reported author',
  );
  expect(() => contractIdentity(xml.replace('$TMP', 'ZFOREIGN'), false, selected, 'fixture')).toThrow(
    'container/package',
  );
});
it('omits credentials and lock handles from witness receipts, including owning sessions', async () => {
  const post = vi.fn().mockResolvedValue({
    statusCode: 200,
    headers: { 'set-cookie': 'SECRET_COOKIE' },
    body: '<LOCK_HANDLE>SECRET_HANDLE</LOCK_HANDLE>',
  });
  const native = {
    post,
    withStatefulSession: async (fn: (http: AdtHttpClient) => Promise<unknown>) =>
      fn(native as unknown as AdtHttpClient),
  };
  const records: unknown[] = [];
  const http = observeContractHttp(
    native as unknown as AdtHttpClient,
    selected,
    (row) => records.push(row),
    async () => {},
  );
  await http.withStatefulSession((session) =>
    session.post(`${selected.groupUrl}?_action=UNLOCK&lockHandle=SECRET_HANDLE`, undefined, undefined, {
      Authorization: 'SECRET_AUTH',
    }),
  );
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][3]).toEqual({ Authorization: 'SECRET_AUTH' });
  expect(post.mock.calls[0][4]).toMatchObject({ noReplay: true, retryTransientErrors: false });
  expect(records).toHaveLength(2);
  expect(JSON.stringify(records)).not.toContain('SECRET_');
});
it('does not send DELETE when its owning-session receipt guard refuses', async () => {
  const remove = vi.fn();
  const guard = vi.fn().mockRejectedValue(new Error('Changed fixture'));
  const native = { delete: remove } as unknown as AdtHttpClient;
  const http = observeContractHttp(native, selected, () => {}, guard);
  await expect(http.delete(selected.moduleUrl)).rejects.toThrow('Changed fixture');
  expect(guard).toHaveBeenCalledWith(
    expect.anything(),
    selected.moduleUrl,
    expect.objectContaining({ noReplay: true }),
  );
  expect(remove).not.toHaveBeenCalled();
});
it('accepts the actual shared group and module creation builders', () => {
  const group = buildCreateXml('FUGR', selected.group, '$TMP', 'fixture');
  const module = buildCreateXml('FUNC', selected.module, '$TMP', 'fixture', { group: selected.group });
  expect(() => checkContractMutation(selected, 'POST', '/sap/bc/adt/functions/groups', group)).not.toThrow();
  expect(() => checkContractMutation(selected, 'POST', `${selected.groupUrl}/fmodules`, module)).not.toThrow();
  expect(() =>
    checkContractMutation(selected, 'POST', '/sap/bc/adt/functions/groups', group.replace('$TMP', 'ZFOREIGN')),
  ).toThrow();
});
it('requires group creator, identity, marker and package evidence', () => {
  const xml = `<f:abapFunctionGroup xmlns:f="http://www.sap.com/adt/functions/groups" xmlns:c="${core}" c:name="${selected.group}" c:type="FUGR/F" c:description="fixture" c:createdBy="MARIAN"><c:packageRef c:name="$TMP"/></f:abapFunctionGroup>`;
  expect(contractIdentity(xml, true, selected, 'fixture')).toEqual({
    creator: 'MARIAN',
    changedBy: undefined,
    nativeVersion: undefined,
  });
  for (const [from, to] of [
    ['MARIAN', 'FOREIGN'],
    ['$TMP', 'ZFOREIGN'],
    [selected.group, 'ZFOREIGN'],
    ['fixture', 'other'],
  ])
    expect(() => contractIdentity(xml.replace(from, to), true, selected, 'fixture')).toThrow();
});
it.each([20000, 55000, 55001, 61000])(
  'refreshes DELETE after a guard without extending the outer deadline (%s)',
  async (elapsed) => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const remove = vi.fn().mockResolvedValue({ statusCode: 204, headers: {}, body: '' });
    const get = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: 'guard evidence' });
    const rows: unknown[] = [];
    let guardPolicy: import('../../../src/adt/http.js').AdtRequestOptions | undefined;
    const observed = observeContractHttp(
      { get, delete: remove } as unknown as AdtHttpClient,
      selected,
      (row) => rows.push(row),
      async (session, path, policy) => {
        guardPolicy = policy;
        await session.get(path, undefined, policy);
        now += elapsed;
      },
    );
    const call = observed.delete(selected.moduleUrl, undefined, { deadline: 61000 });
    if (elapsed <= 55000) {
      await expect(call).resolves.toMatchObject({ statusCode: 204 });
      expect(remove.mock.calls[0][2].responseBudget).toBe(guardPolicy?.responseBudget);
      expect(remove.mock.calls[0][2]).toMatchObject({
        deadline: elapsed === 20000 ? 51000 : 61000,
      });
      const finalAllowance = remove.mock.calls[0][2].attemptBudget;
      expect(finalAllowance.limit).toBe(guardPolicy?.attemptBudget?.limit);
      finalAllowance.consume();
      expect(guardPolicy?.attemptBudget?.used).toBe(1);
      finalAllowance.authorizationFailureObserved = true;
      expect(guardPolicy?.attemptBudget?.authorizationFailureObserved).toBe(true);
    } else {
      await expect(call).rejects.toBeInstanceOf(AdtRequestNotSentError);
      expect(remove).not.toHaveBeenCalled();
      expect(rows).toContainEqual(
        expect.objectContaining({ stage: 'refused-before-send', method: 'DELETE', reason: expect.any(String) }),
      );
      expect(rows).not.toContainEqual(expect.objectContaining({ stage: 'request', method: 'DELETE' }));
    }
    expect(rows).toContainEqual(expect.objectContaining({ stage: 'response', method: 'GET', body: 'guard evidence' }));
  },
);

it('refuses an ignored copied script tree that inherits the parent Git HEAD', () => {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const copied = mkdtempSync(join(repo, 'node_modules/pr1142-root-check-'));
  const destination = join(copied, 'scripts/qualification/pr1142');
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(copied, 'package.json'), JSON.stringify({ type: 'module' }));
  try {
    symlinkSync(join(repo, 'src'), join(copied, 'src'));
    for (const name of [
      'native-function-contract.ts',
      'native-function-contract-run.ts',
      'native-qualification-runtime.ts',
      'native-contract-transport.ts',
      'native-contract-absence.ts',
      'native-lock-binding.ts',
      'safe-io.mjs',
      'run-manifest.mjs',
    ]) {
      const original = join(repo, 'scripts/qualification/pr1142', name);
      if (name === 'native-function-contract.ts') copyFileSync(original, join(destination, name));
      else symlinkSync(original, join(destination, name));
    }
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(destination, 'native-function-contract.ts'),
        '--execute-reviewed-active-delete',
        '0'.repeat(40),
      ],
      {
        env: Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'NODE_OPTIONS'),
        ),
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    expect(child.status).toBe(1);
    expect(child.stderr).toContain('REAL_GIT_WORKSPACE_ROOT_REQUIRED');
    expect(child.stderr).not.toContain('Requires --execute-reviewed-revision');
  } finally {
    rmSync(copied, { recursive: true, force: true });
  }
});

it('caps every native response, retaining a stricter shared allowance', () => {
  const budget = new DataResponseBudget(128, 'test', true);
  expect(contractRequestPolicy().responseBudget).toMatchObject({ limitBytes: 2097152, countAllResponses: true });
  expect(contractRequestPolicy({ responseBudget: budget }).responseBudget).toBe(budget);
  expect(() => contractRequestPolicy({ responseBudget: new DataResponseBudget(2097153, 'test', true) })).toThrow(
    'at most 2 MiB',
  );
  expect(() => contractRequestPolicy({ responseBudget: new DataResponseBudget(128) })).toThrow('all-response');
});

it('replays the actual native metadata transition without ignoring foreign or modified links', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../../fixtures/adt/function-metadata-a4h-activation.json', import.meta.url), 'utf8'),
  );
  const selected = contractSelection(fixture.suffix);
  for (const row of [fixture.saved, fixture.active]) {
    expect(createHash('sha256').update(row.xml).digest('hex')).toBe(row.sha256);
    expect(contractIdentity(row.xml, false, selected, fixture.marker).nativeVersion).toBe(
      row === fixture.saved ? 'inactive' : 'active',
    );
  }
  expect(contractMetadataHash(fixture.saved.xml)).not.toBe(contractMetadataHash(fixture.active.xml));
  const expected = contractFunctionMetadataHash(fixture.active.xml, selected);
  expect(contractFunctionMetadataHash(fixture.saved.xml, selected)).toBe(expected);
  for (const variant of [
    fixture.saved.xml.replace('version=active', 'version=foreign'),
    fixture.saved.xml.replace('version=active', 'version=inactive'),
    fixture.saved.xml.replace(/(<atom:link[^>]+objectstates[^>]+xmlns:atom=")[^"]+/, '$1http://foreign.invalid'),
    fixture.saved.xml.replace(/<atom:link[^>]+objectstates[^>]+\/>/, (link: string) => link + link),
    fixture.saved.xml.replace('relations/objectstates', 'relations/foreign'),
    fixture.saved.xml.replace('title="Reference', 'foreign="changed" title="Reference'),
    fixture.active.xml.replace('processingType="normal"', 'processingType="rfc"'),
  ])
    expect(contractFunctionMetadataHash(variant, selected)).not.toBe(expected);
});

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { getOnlyReader, runNativeDeclarativeAbsencePreflight } = await import(
  '../../../scripts/qualification/pr1142/native-declarative-preflight.js'
);
const { declarativeOwnerAbsent } = await import('../../../scripts/qualification/pr1142/native-declarative-evidence.js');
const { declarativeFixtures } = await import('../../../scripts/qualification/pr1142/native-declarative-fixtures.js');
const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Resource does not exist.</message></exc:exception>';
const revision = 'a'.repeat(40);
const args = ['--execute-reviewed-absence-preflight', revision];
const password = 'FIXTURE-PASSWORD';
let parent: string;
let dependencies: NonNullable<Parameters<typeof runNativeDeclarativeAbsencePreflight>[1]>;
let answer: (path: string) => ReturnType<typeof mockResponse>;
const inventory = () =>
  mockResponse(200, '<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects"/>', {
    'content-type': 'application/xml',
  });
beforeEach(() => {
  vi.resetAllMocks();
  parent = mkdtempSync(join(tmpdir(), 'pr1142-declarative-preflight-'));
  answer = (path) => (path.endsWith('/inactiveobjects') ? inventory() : mockResponse(404, absent));
  mockFetch.mockImplementation(async (url) => answer(new URL(String(url)).pathname));
  vi.spyOn(process, 'umask').mockReturnValue(0o022);
  dependencies = {
    validateRuntime: vi.fn(),
    bind: vi.fn(async () => ({
      repo: parent,
      root: join(parent, 'preflight'),
      verifySource: vi.fn(),
      evidence: {
        revision,
        entryHash: 'a'.repeat(64),
        packageLockHash: 'b'.repeat(64),
        node: process.version,
        repo: parent,
        dependencyLimit: 'fixture',
      },
    })),
    readEnv: vi.fn(() => ({
      SAP_URL: 'https://a4h.marianzeis.de',
      SAP_CLIENT: '001',
      SAP_USER: 'MARIAN',
      SAP_PASSWORD: password,
    })),
    createClient: vi.fn((input) => new AdtClient(input)),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(parent, { recursive: true, force: true });
});
function journal(root: string) {
  return readdirSync(join(root, 'run'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(root, 'run', name), 'utf8')).value);
}

it('sends only GET requests, for every owner type on fresh names, and records no credential', async () => {
  const result = await runNativeDeclarativeAbsencePreflight(args, dependencies);
  expect(result).toMatchObject({ failure: false, mutationAttempted: false, inventory: 'valid-without-suffix' });
  expect(result.owners.map((owner: { type: string }) => owner.type)).toEqual([
    'DDLS',
    'DDLS',
    'DCLS',
    'DDLX',
    'BDEF',
    'SRVD',
  ]);
  expect(result.owners.every((owner: { result: string }) => owner.result === 'typed-absent')).toBe(true);
  expect(mockFetch.mock.calls).toHaveLength(7);
  expect(mockFetch.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  expect(dependencies.createClient).toHaveBeenCalledWith(
    expect.objectContaining({
      baseUrl: 'https://a4h.marianzeis.de',
      client: '001',
      insecure: false,
      safety: expect.objectContaining({ allowWrites: false }),
    }),
  );
  const persisted = readFileSync(join(result.root, 'result.json'), 'utf8') + JSON.stringify(journal(result.root));
  expect(persisted).not.toContain(password);
  expect(readFileSync(join(result.root, 'manifest.json'), 'utf8')).not.toContain(password);
});
it('claims nothing of the one-run experiment and can sample again with a fresh suffix', async () => {
  const first = await runNativeDeclarativeAbsencePreflight(args, dependencies);
  const second = await runNativeDeclarativeAbsencePreflight(args, dependencies);
  expect(first.root).not.toBe(second.root);
  expect(first.owners[0].owner).not.toBe(second.owners[0].owner);
  expect(readdirSync(join(parent, 'preflight')).sort()).toEqual(
    [first.root, second.root].map((root) => root.split('/').at(-1)).sort(),
  );
  expect(existsSync(join(parent, 'pr1142-native-declarative-v1'))).toBe(false);
});
it('reports every type after a refusal and retains the native answer that decided it', async () => {
  answer = (path) =>
    path.includes('/bo/behaviordefinitions/')
      ? mockResponse(404, '<html>plain not found</html>')
      : path.includes('/ddic/srvd/')
        ? mockResponse(403, '<e:x xmlns:e="urn:x"><type id="ExceptionNotAuthorized"/></e:x>')
        : path.endsWith('/inactiveobjects')
          ? inventory()
          : mockResponse(404, absent);
  const result = await runNativeDeclarativeAbsencePreflight(args, dependencies);
  expect(result.failure).toBe(true);
  expect(result.owners.map(({ type, result: row, status }: any) => [type, row, status])).toEqual([
    ['DDLS', 'typed-absent', undefined],
    ['DDLS', 'typed-absent', undefined],
    ['DCLS', 'typed-absent', undefined],
    ['DDLX', 'typed-absent', undefined],
    ['BDEF', 'absence-not-typed', 404],
    ['SRVD', 'absence-not-typed', 403],
  ]);
  const rows = journal(result.root);
  const bdef = rows.find((row) => row.read?.includes('/bo/behaviordefinitions/'));
  expect(bdef).toMatchObject({ failure: 'http-error', status: 404 });
  expect(bdef.body).toBeUndefined();
  expect(rows.find((row) => row.read?.includes('/ddic/srvd/'))).toMatchObject({
    exceptionType: 'ExceptionNotAuthorized',
    status: 403,
    body: expect.stringContaining('ExceptionNotAuthorized'),
  });
  expect(mockFetch.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
});
it('does not treat a live owner or a bad inventory as a passed prerequisite', async () => {
  answer = (path) =>
    path.endsWith('/inactiveobjects')
      ? mockResponse(200, '<other/>', { 'content-type': 'text/html' })
      : mockResponse(200, '<x/>');
  const result = await runNativeDeclarativeAbsencePreflight(args, dependencies);
  expect(result.failure).toBe(true);
  expect(result.owners.every((owner: { result: string }) => owner.result === 'absence-owner-present')).toBe(true);
  expect(result.inventory).toBe('inventory-media');
});
it.each([204, 302, 307])('does not label an untyped successful response %s as owner presence', async (statusCode) => {
  const record = vi.fn();
  const get = vi.fn().mockResolvedValue({ statusCode, body: '', headers: {} });
  await expect(
    declarativeOwnerAbsent({ get } as never, declarativeFixtures('A'.repeat(16))[0], record, {}),
  ).rejects.toMatchObject({ reason: 'absence-not-typed', evidence: { status: statusCode } });
  expect(record).toHaveBeenCalledWith(expect.objectContaining({ status: statusCode }));
  expect(get).toHaveBeenCalledTimes(1);
});
it('stops reading when the source binding stops holding', async () => {
  const bind = dependencies.bind;
  dependencies.bind = vi.fn(async (...input: Parameters<typeof bind>) => ({
    ...(await bind(...input)),
    verifySource: () => {
      throw new Error('private path');
    },
  }));
  const result = await runNativeDeclarativeAbsencePreflight(args, dependencies);
  expect(result.failure).toBe(true);
  expect(result.inventory).toBe('source-binding');
  expect(result.owners.every((owner: { result: string }) => owner.result === 'source-binding')).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
  expect(readFileSync(join(result.root, 'result.json'), 'utf8')).not.toContain('private path');
});
it.each([
  [
    'configuration-env-invalid',
    { SAP_URL: 'https://other.example', SAP_USER: 'MARIAN', SAP_CLIENT: '001', SAP_PASSWORD: password },
  ],
  ['configuration-env-invalid', { SAP_URL: 'https://a4h.marianzeis.de', SAP_USER: 'MARIAN', SAP_CLIENT: '001' }],
])('refuses %s before constructing a client', async (reason, env) => {
  dependencies.readEnv = vi.fn(() => env as Record<string, string>);
  await expect(runNativeDeclarativeAbsencePreflight(args, dependencies)).rejects.toMatchObject({ reason });
  expect(dependencies.createClient).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
  const [sample] = readdirSync(join(parent, 'preflight'));
  const result = readFileSync(join(parent, 'preflight', sample, 'result.json'), 'utf8');
  expect(JSON.parse(result)).toMatchObject({
    failure: true,
    mutationAttempted: false,
    reason,
    invalidFields: ['SAP_PASSWORD' in env ? 'SAP_URL' : 'SAP_PASSWORD'],
  });
  expect(result).not.toContain(password);
  expect(result).not.toContain('https://other.example');
});
it('journals an unreadable credentials file with a fixed reason', async () => {
  dependencies.readEnv = vi.fn(() => {
    throw new Error('ENOENT private path');
  });
  await expect(runNativeDeclarativeAbsencePreflight(args, dependencies)).rejects.toMatchObject({
    reason: 'configuration-env-unreadable',
  });
  const [sample] = readdirSync(join(parent, 'preflight'));
  const result = readFileSync(join(parent, 'preflight', sample, 'result.json'), 'utf8');
  expect(JSON.parse(result)).toMatchObject({
    failure: true,
    mutationAttempted: false,
    reason: 'configuration-env-unreadable',
  });
  expect(result).not.toContain('private path');
});
it.each([
  { selected: [] },
  { selected: ['--execute-reviewed-declarative', revision] },
  { selected: ['--execute-reviewed-absence-preflight', 'short'] },
])('rejects %j before binding or credentials', async ({ selected }) => {
  await expect(runNativeDeclarativeAbsencePreflight(selected, dependencies)).rejects.toThrow('Requires');
  expect(dependencies.bind).not.toHaveBeenCalled();
  expect(dependencies.readEnv).not.toHaveBeenCalled();
});
it('validates the runtime before binding or credentials', async () => {
  dependencies.validateRuntime = () => {
    throw new Error('invalid runtime');
  };
  await expect(runNativeDeclarativeAbsencePreflight(args, dependencies)).rejects.toThrow('invalid runtime');
  expect(dependencies.bind).not.toHaveBeenCalled();
});
it('exposes only GET, and refuses identity overrides or foreign paths', () => {
  const get = vi.fn();
  const reader = getOnlyReader({ get } as never);
  expect(Object.keys(reader)).toEqual(['get']);
  for (const path of [
    '/sap/bc/adt/x?sap-client=100',
    '/sap/bc/adt/x?sap-user=OTHER',
    'https://other.example/sap/bc/adt/x',
    '/foreign',
  ])
    expect(() => reader.get(path)).toThrow();
  expect(get).not.toHaveBeenCalled();
});

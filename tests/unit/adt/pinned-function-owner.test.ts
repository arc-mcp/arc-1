import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mutationClient } from '../../../src/adt/mutation-client.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from '../handlers/setup-undici-mock.js';

const { readPinnedFunctionOwner, pinnedFunctionSelection } = await import('../../../src/adt/pinned-function-owner.js');
const observed = JSON.parse(
  readFileSync(new URL('../../fixtures/function-owners/a4h-758.json', import.meta.url), 'utf8'),
).observations as { label: string; path: string; metadataXml: string }[];
const native = (label: string) => observed.find((row) => row.label === label)!;
let responses = new Map<string, string>();
const requests: { path: string; method: string; accept: string; cacheControl: string }[] = [];
const unexpected: string[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  requests.length = 0;
  unexpected.length = 0;
  responses = new Map(observed.map((row) => [row.path, row.metadataXml]));
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const path = new URL(String(url)).pathname;
    const headers = new Headers(init.headers);
    requests.push({
      path,
      method: init.method ?? 'GET',
      accept: headers.get('Accept') ?? '',
      cacheControl: headers.get('Cache-Control') ?? '',
    });
    const body = responses.get(path);
    if (body === undefined) unexpected.push(path);
    return mockResponse(body === undefined ? 500 : 200, body ?? 'Unexpected request');
  });
});
afterEach(() => expect(unexpected).toEqual([]));
function client(allowedPackages = ['SUSR', '/AIF/INTERFACE_MONITOR'], destination = allowedPackages) {
  const original = new AdtClient({
    baseUrl: 'https://sap.example',
    username: 'test',
    password: 'test',
    safety: {
      ...defaultSafetyConfig(),
      allowedPackages,
      multiTargetWrite: {
        enabled: true,
        target: 'A4H/001',
        allowedPackages: destination,
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    },
  });
  return mutationClient(
    original,
    pinnedMutationContext(original.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false }),
  );
}

it.each([
  ['group', 'FUGR', 'SU_USER', 'SU_USER', 'SUSR', 1],
  ['module', 'FUNC', 'BAPI_USER_GETLIST', 'SU_USER', 'SUSR', 2],
  ['include', 'INCL', 'LSU_USERTOP', 'SU_USER', 'SUSR', 2],
  ['namespaced-group', 'FUGR', '/AIF/ADV_MSG_SUM_UI', '/AIF/ADV_MSG_SUM_UI', '/AIF/INTERFACE_MONITOR', 1],
  ['namespaced-include', 'INCL', '/AIF/LADV_MSG_SUM_UIF01', '/AIF/ADV_MSG_SUM_UI', '/AIF/INTERFACE_MONITOR', 2],
])(
  'verifies captured native %s through independent parent metadata',
  async (label, type, name, group, packageName, count) => {
    const resource = native(String(label)).path;
    expect(await readPinnedFunctionOwner(client(), resource)).toMatchObject({
      type,
      name,
      group,
      packageName,
      objectUrl: resource,
    });
    expect(requests).toHaveLength(Number(count));
    expect(
      requests.every((r) => r.method === 'GET' && r.accept === 'application/*' && r.cacheControl === 'no-cache'),
    ).toBe(true);
    expect(requests[0]!.path).toBe(resource.split('/fmodules/')[0]!.split('/includes/')[0]);
  },
);

it.each([
  ['server', ['$TMP'], ['SUSR']],
  ['destination', ['SUSR'], ['$TMP']],
  ['missing destination', ['SUSR'], []],
])('enforces the %s package restriction before reading child metadata', async (_label, global, destination) => {
  await expect(readPinnedFunctionOwner(client(global, destination), native('module').path)).rejects.toThrow(/package/i);
  expect(requests.map((r) => r.path)).toEqual([native('group').path]);
});

it.each([
  ['parent name', 'group', 'adtcore:name="SU_USER"', 'adtcore:name="ZOTHER"'],
  ['parent type', 'group', 'adtcore:type="FUGR/F"', 'adtcore:type="PROG/P"'],
  ['parent package type', 'group', 'adtcore:type="DEVC/K"', 'adtcore:type="CLAS/OC"'],
  ['child name', 'module', 'adtcore:name="BAPI_USER_GETLIST"', 'adtcore:name="ZOTHER"'],
  ['child type', 'module', 'adtcore:type="FUGR/FF"', 'adtcore:type="FUGR/I"'],
  ['container name', 'module', 'adtcore:name="SU_USER"', 'adtcore:name="ZOTHER"'],
  ['container type', 'module', 'adtcore:type="FUGR/F"', 'adtcore:type="PROG/P"'],
  ['container URI', 'module', '/groups/su_user"', '/groups/zother"'],
  ['container package', 'module', 'adtcore:packageName="SUSR"', 'adtcore:packageName="$TMP"'],
  ['missing container package', 'module', 'adtcore:packageName="SUSR"', ''],
  ['foreign container binding', 'module', '<adtcore:containerRef', '<adtcore:containerRef xmlns:adtcore="urn:foreign"'],
  ['standalone include root', 'include', 'abapFunctionGroupInclude', 'abapInclude'],
  [
    'standalone include namespace',
    'include',
    'http://www.sap.com/adt/functions/fincludes',
    'http://www.sap.com/adt/programs/includes',
  ],
  ['standalone include type', 'include', 'adtcore:type="FUGR/I"', 'adtcore:type="PROG/I"'],
])('refuses inconsistent %s evidence', async (_label, label, before, after) => {
  const fixture = native(label);
  responses.set(fixture.path, fixture.metadataXml.replaceAll(before, after));
  await expect(readPinnedFunctionOwner(client(), native(label === 'group' ? 'module' : label).path)).rejects.toThrow();
  expect(requests.every((r) => r.method === 'GET')).toBe(true);
});

it('does not reuse a parent package from an earlier check', async () => {
  const active = client();
  await readPinnedFunctionOwner(active, native('module').path);
  responses.set(
    native('group').path,
    native('group').metadataXml.replace('adtcore:name="SUSR"', 'adtcore:name="ZDENIED"'),
  );
  await expect(readPinnedFunctionOwner(active, native('module').path)).rejects.toThrow(/ZDENIED/);
  expect(requests.map((r) => r.path)).toEqual([native('group').path, native('module').path, native('group').path]);
});

it.each([
  '/sap/bc/adt/functions/groups/%73u_user',
  '/sap/bc/adt/functions/groups/su_user?version=inactive',
  '/sap/bc/adt/functions/groups/su_user/source/main',
  '/sap/bc/adt/functions/groups/su_user/includes/%ZZ',
  '/sap/bc/adt/functions/groups/su_user/includes/%2e%2e',
  '/sap/bc/adt/functions/groups/su_user/includes/lx%2Fy',
])('refuses noncanonical selected URI before a native request: %s', async (uri) => {
  await expect(readPinnedFunctionOwner(client(), uri)).rejects.toThrow();
  expect(requests).toEqual([]);
});
it('does not claim ownership of other repository families', async () => {
  expect(await readPinnedFunctionOwner(client(), '/sap/bc/adt/programs/includes/lsu_usertop')).toBeUndefined();
  expect(requests).toEqual([]);
});
it('builds exact namespaced group and child paths without allowing another parent on FUGR', () => {
  expect(pinnedFunctionSelection('INCL', '/NS/LZGROUPF01', '/NS/ZGROUP').objectUrl).toBe(
    '/sap/bc/adt/functions/groups/%2Fns%2Fzgroup/includes/%2Fns%2Flzgroupf01',
  );
  expect(() => pinnedFunctionSelection('FUNC', 'ZFUNCTION')).toThrow();
  expect(() => pinnedFunctionSelection('FUGR', 'ZGROUP', 'ZOTHER')).toThrow();
  expect(() => pinnedFunctionSelection('INCL', 'LZGROUPF01', 'ZGROUP/../OTHER')).toThrow();
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdtResponseLimitError } from '../../../src/adt/errors.js';
import { mutationClient } from '../../../src/adt/mutation-client.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import fixture from '../../fixtures/declarative-owners/native-metadata.json';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from '../handlers/setup-undici-mock.js';

const { readPinnedDeclarativeOwner, pinnedDeclarativeSelection } = await import(
  '../../../src/adt/pinned-repository-owner.js'
);
const rows = fixture.observations;
const calls: string[] = [];
let responses: Map<string, string>,
  status = 200;
beforeEach(() => {
  vi.resetAllMocks();
  calls.length = 0;
  status = 200;
  responses = new Map(rows.map((row) => [row.path, row.metadataXml]));
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    expect(init.method ?? 'GET').toBe('GET');
    const path = new URL(String(url)).pathname;
    calls.push(path);
    const body = responses.get(path);
    expect(body).toBeDefined();
    return mockResponse(status, body!);
  });
});
afterEach(() => expect(calls.length).toBeLessThanOrEqual(2));
function client(server = ['$TMP', 'Z_RAP_VB_BC26'], destination = server) {
  const native = new AdtClient({
    baseUrl: 'https://sap.example',
    safety: {
      ...defaultSafetyConfig(),
      allowedPackages: server,
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
    native,
    pinnedMutationContext(native.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false }),
  );
}
it.each(rows)('verifies captured $type native owner and its own package', async (row) => {
  expect(await readPinnedDeclarativeOwner(client(), row.path)).toBe(row.packageName);
  expect(calls).toEqual([row.path]);
});
it.each([
  { server: ['ZDENIED'], destination: ['$TMP'] },
  { server: ['$TMP'], destination: ['ZDENIED'] },
  { server: ['$TMP'], destination: [] },
])('keeps package ceilings independent: %j', async ({ server, destination }) => {
  await expect(readPinnedDeclarativeOwner(client(server, destination), rows[0]!.path)).rejects.toThrow(/package/i);
});
it.each([
  'name',
  'type',
  'package',
  'package-type',
  'root-namespace',
  'core-namespace',
  'container',
  'duplicate-package',
])('refuses inconsistent %s metadata', async (fault) => {
  const row = rows[0]!;
  let xml = row.metadataXml;
  if (fault === 'name') xml = xml.replace(`adtcore:name="${row.name}"`, 'adtcore:name="ZOTHER"');
  if (fault === 'type') xml = xml.replace('DDLS/DF', 'DCLS/DL');
  if (fault === 'package') xml = xml.replace('adtcore:name="$TMP"', 'adtcore:name="ZDENIED"');
  if (fault === 'package-type') xml = xml.replace('DEVC/K', 'CLAS/OC');
  if (fault === 'root-namespace') xml = xml.replace('http://www.sap.com/adt/ddic/ddlsources', 'urn:foreign');
  if (fault === 'core-namespace') xml = xml.replace('http://www.sap.com/adt/core', 'urn:foreign');
  if (fault === 'container') xml = xml.replace('</ddl:ddlSource>', '<adtcore:containerRef/></ddl:ddlSource>');
  if (fault === 'duplicate-package')
    xml = xml.replace(
      '</ddl:ddlSource>',
      '<adtcore:packageRef adtcore:type="DEVC/K" adtcore:name="$TMP"/></ddl:ddlSource>',
    );
  expect(xml).not.toBe(row.metadataXml);
  responses.set(row.path, xml);
  await expect(readPinnedDeclarativeOwner(client(), row.path)).rejects.toThrow();
});
it.each([200, 503])('bounds the entire native response, status %s', async (code) => {
  status = code;
  responses.set(rows[0]!.path, 'x'.repeat(1024 * 1024 + 1));
  await expect(readPinnedDeclarativeOwner(client(), rows[0]!.path)).rejects.toBeInstanceOf(AdtResponseLimitError);
});
it.each(['ztest?other=1', '%7atest', '%2e%2e', 'ztest/source/main', '%ZZ', 'ztest#fragment'])(
  'refuses a noncanonical selector before HTTP: %s',
  async (segment) => {
    await expect(readPinnedDeclarativeOwner(client(), `/sap/bc/adt/ddic/ddl/sources/${segment}`)).rejects.toThrow();
    expect(calls).toEqual([]);
  },
);
it('verifies namespace encoding and does not claim other object families', async () => {
  expect(pinnedDeclarativeSelection('DDLS', '/ARC1/ZVIEW').objectUrl).toBe(
    '/sap/bc/adt/ddic/ddl/sources/%2Farc1%2Fzview',
  );
  expect(await readPinnedDeclarativeOwner(client(), '/sap/bc/adt/oo/classes/zclass')).toBeUndefined();
  expect(calls).toEqual([]);
});
it('fetches package evidence again rather than reusing the first result', async () => {
  const native = client(),
    row = rows[0]!;
  await readPinnedDeclarativeOwner(native, row.path);
  responses.set(row.path, row.metadataXml.replace('adtcore:name="$TMP"', 'adtcore:name="ZDENIED"'));
  await expect(readPinnedDeclarativeOwner(native, row.path)).rejects.toThrow(/package/i);
  expect(calls).toHaveLength(2);
});

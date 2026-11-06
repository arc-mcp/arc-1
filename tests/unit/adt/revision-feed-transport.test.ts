import { beforeEach, expect, it, vi } from 'vitest';
import { canonicalRevisionSourcePath } from '../../../src/adt/path-safety.js';
import { parseRevisionFeed } from '../../../src/adt/xml-parser.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { mockFetch } from '../handlers/setup-undici-mock.js';

const { AdtHttpClient } = await import('../../../src/adt/http.js');
const config = { baseUrl: 'https://sap.test', client: '123', language: 'DE', disableSaml: true };

beforeEach(() => {
  vi.resetAllMocks();
  mockFetch.mockResolvedValue(mockResponse(200, '<feed/>'));
});

it.each([
  '/sap/bc/adt/programs/programs/ZREPORT/source/main/versions',
  '/sap/bc/adt/oo/classes/ZCLASS/includes/definitions/versions',
  '/sap/bc/adt/oo/interfaces/ZINTERFACE/source/main/versions',
  '/sap/bc/adt/ddic/ddl/sources/ZVIEW/versions',
  '/sap/bc/adt/functions/groups/ZGROUP/fmodules/ZFUNCTION/source/main/versions',
])('keeps %s query-free so SAP can append a revision source path', async (path) => {
  // NW750 appends its source suffix to the complete request URI, including any query.
  mockFetch.mockImplementationOnce(async (url) => {
    const request = new URL(String(url));
    const src = `${request.pathname}${request.search}/19700101091123/00000/content`;
    return mockResponse(200, `<feed><entry><content src="${src.replaceAll('&', '&amp;')}"/></entry></feed>`);
  });
  const response = await new AdtHttpClient(config).get(path, { Accept: 'application/atom+xml;type=feed' });
  const [url, options] = mockFetch.mock.calls[0]!;
  expect(String(url)).toBe(`${config.baseUrl}${path}`);
  expect(options?.headers).toMatchObject({
    'sap-client': '123',
    'sap-language': 'DE',
    'X-SAP-SAML2': 'disabled',
    Accept: 'application/atom+xml;type=feed',
  });
  expect(canonicalRevisionSourcePath(parseRevisionFeed(response.body).revisions[0]!.uri)).toBe(
    `${path}/19700101091123/00000/content`,
  );
});

it('does not invent missing client, language or SAML settings', async () => {
  await new AdtHttpClient({ baseUrl: config.baseUrl }).get(
    '/sap/bc/adt/programs/programs/ZREPORT/source/main/versions',
  );
  const [, options] = mockFetch.mock.calls[0]!;
  expect(options?.headers).not.toHaveProperty('sap-client');
  expect(options?.headers).not.toHaveProperty('sap-language');
  expect(options?.headers).not.toHaveProperty('X-SAP-SAML2');
});

it.each([
  '/sap/bc/adt/programs/programs/ZREPORT/source/main/versions/19700101091123/00000/content',
  '/sap/bc/adt/programs/programs/ZREPORT/source/main/versions?filter=active',
  '/other/versions',
])('preserves ordinary query context for %s', async (path) => {
  await new AdtHttpClient(config).get(path);
  const [url, options] = mockFetch.mock.calls[0]!;
  expect(new URL(String(url)).searchParams.get('sap-client')).toBe('123');
  expect(new URL(String(url)).searchParams.get('sap-language')).toBe('DE');
  expect(new URL(String(url)).searchParams.get('saml2')).toBe('disabled');
  expect(options?.headers).not.toHaveProperty('sap-client');
});

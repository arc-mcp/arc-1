import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedDiscovery } = await import('../../../src/handlers/feature-cache.js');
const fixture = readFileSync(new URL('../../fixtures/xml/syntax-check-nw750.xml', import.meta.url), 'utf8');
const reader = { token: 'test', clientId: 'reader', scopes: ['read'] };
const client = () => new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });

beforeEach(() => {
  resetCachedFeatures();
  mockFetch.mockReset();
});

// 7.50 search appends a localized suffix to the name; the resolver strips it.
const searchXml = (type: string, name: string) =>
  `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/x/y" adtcore:type="${type}" adtcore:name="${name} (Structure)"/></adtcore:objectReferences>`;

function respond(
  tableStatus: number,
  structureStatus = 200,
  searchType = 'TABL/DS',
  check = fixture,
  searchStatus = 200,
) {
  mockFetch.mockImplementation(async (url, options) => {
    if (options?.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 't' });
    if (options?.method === 'POST') {
      expect(String(url)).toContain('/checkruns');
      return mockResponse(200, check);
    }
    if (String(url).includes('/informationsystem/search'))
      return mockResponse(searchStatus, searchXml(searchType, new URL(String(url)).searchParams.get('query') ?? ''));
    expect(options?.method).toBe('GET');
    expect(String(url)).toMatch(/\/ddic\/(tables|structures)\//);
    return mockResponse(String(url).includes('/tables/') ? tableStatus : structureStatus, '');
  });
}

async function check(tool: string, type: string, options: Record<string, unknown> = {}, current = client()) {
  return handleToolCall(
    current,
    DEFAULT_CONFIG,
    tool,
    {
      ...(tool === 'SAPRead' ? { type: 'SYNTAX', objectType: type } : { action: 'syntax', type }),
      name: 'BAPIRET2',
      ...options,
    },
    reader,
  );
}

it.each(['SAPRead', 'SAPDiagnose'])('resolves structures through %s with bare and slash types', async (tool) => {
  for (const type of ['TABL', 'TABL/DS']) {
    for (const options of [{}, { source: 'define structure bapiret2 {}', version: 'inactive' }]) {
      mockFetch.mockClear();
      respond(404);
      const result = await check(tool, type, options);
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toMatchObject({ checked: true });
      const posts = mockFetch.mock.calls.filter(([, o]) => o?.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(posts[0]![1]?.body).toContain('adtcore:uri="/sap/bc/adt/ddic/structures/BAPIRET2"');
      expect(posts[0]![1]?.body).toContain(`chkrun:version="${options.version ?? 'active'}"`);
      if (options.source) expect(posts[0]![1]?.body).toContain(Buffer.from(options.source).toString('base64'));
    }
  }
});

it.each([200, 403, 500])('keeps table routing on metadata status %s', async (status) => {
  respond(status);
  await check('SAPRead', 'TABL', { source: 'define table ztab {}' });
  expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/structures/'))).toBe(false);
  expect(mockFetch.mock.calls.find(([, o]) => o?.method === 'POST')![1]?.body).toContain(
    'adtcore:uri="/sap/bc/adt/ddic/tables/BAPIRET2"',
  );
});

it('does not validate unsaved text when both metadata roots are absent', async () => {
  respond(404, 404);
  const result = await check('SAPRead', 'TABL', { source: 'define structure bapiret2 {}' });
  expect(JSON.parse(result.content[0].text)).toMatchObject({ checked: false, hasErrors: true });
  expect(mockFetch.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
});

it('encodes namespace names and rechecks routing on each call', async () => {
  const current = client();
  respond(200);
  await check('SAPRead', 'TABL', { name: '/NS/STRUCT' }, current);
  mockFetch.mockClear();
  respond(404);
  await check('SAPRead', 'TABL/DS', { name: '/NS/STRUCT' }, current);
  expect(mockFetch.mock.calls.find(([, o]) => o?.method === 'POST')![1]?.body).toContain(
    'adtcore:uri="/sap/bc/adt/ddic/structures/%2FNS%2FSTRUCT"',
  );
});

const posts = () => mockFetch.mock.calls.filter(([, o]) => o?.method === 'POST');
const searches = () => mockFetch.mock.calls.filter(([url]) => String(url).includes('/informationsystem/search'));

it('refuses a transparent table served as a structure where /ddic/tables/ is absent (7.50)', async () => {
  respond(404, 200, 'TABL/DT');
  const result = JSON.parse((await check('SAPRead', 'TABL')).content[0].text);
  expect(result).toMatchObject({ checked: false, hasErrors: true });
  expect(result.statusText).toContain('not confirmed as a structure');
  expect(posts()).toHaveLength(0);
});

it('refuses when the search fails and only the structure fallback answers (7.50, discovery loaded)', async () => {
  setCachedDiscovery(new Map([['/sap/bc/adt/oo/classes', ['application/xml']]]));
  respond(404, 200, 'TABL/DS', fixture, 500);
  const result = JSON.parse((await check('SAPRead', 'TABL')).content[0].text);
  expect(result).toMatchObject({ checked: false });
  expect(result.statusText).toContain('(SAP_BASIS 7.50/7.51)');
  expect(posts()).toHaveLength(0);
});

it('fails closed with a discovery hint when the re-probe errors and discovery is not loaded', async () => {
  respond(404, 200, 'TABL/DS', fixture, 500);
  const before = mockFetch.getMockImplementation()!;
  let tableProbes = 0; // the first /tables/ probe 404s; the resolver's re-probe fails
  mockFetch.mockImplementation(async (url, options) =>
    String(url).includes('/ddic/tables/') && ++tableProbes > 1 ? mockResponse(500, '') : before(url, options),
  );
  const result = JSON.parse((await check('SAPRead', 'TABL')).content[0].text);
  expect(result.statusText).toContain('discovery is not loaded');
  expect(posts()).toHaveLength(0);
});

it('skips the subtype search when discovery advertises /ddic/tables/', async () => {
  setCachedDiscovery(new Map([['/sap/bc/adt/ddic/tables', ['application/xml']]]));
  respond(404, 200, 'TABL/DT');
  expect(JSON.parse((await check('SAPRead', 'TABL')).content[0].text)).toMatchObject({ checked: true });
  expect(searches()).toHaveLength(0);
  expect(posts()[0]![1]?.body).toContain('adtcore:uri="/sap/bc/adt/ddic/structures/BAPIRET2"');
});

it('suggests version="inactive" only for a default-version stored check SAP did not process', async () => {
  const unprocessed =
    '<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:status="notProcessed" chkrun:statusText="Error while importing object BAPIRET2 from the database"/></chkrun:checkRunReports>';
  const text = async (options: Record<string, unknown>) => {
    respond(404, 200, 'TABL/DS', unprocessed);
    return JSON.parse((await check('SAPRead', 'TABL', options)).content[0].text).messages[0].text as string;
  };
  expect(await text({})).toContain('re-run with version="inactive"');
  expect(await text({ version: 'active' })).not.toContain('version="inactive"');
  expect(await text({ source: 'define structure bapiret2 {}' })).not.toContain('version="inactive"');
  respond(404, 404, 'TABL/DS', unprocessed);
  const missing = JSON.parse((await check('SAPRead', 'TABL')).content[0].text).messages[0].text as string;
  expect(missing).not.toContain('version="inactive"');
});

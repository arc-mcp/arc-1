import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const fixture = readFileSync(new URL('../../fixtures/xml/syntax-check-nw750.xml', import.meta.url), 'utf8');
const reader = { token: 'test', clientId: 'reader', scopes: ['read'] };
const client = () => new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });

beforeEach(() => {
  resetCachedFeatures();
  mockFetch.mockReset();
});

function respond(tableStatus: number, structureStatus = 200) {
  mockFetch.mockImplementation(async (url, options) => {
    if (options?.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 't' });
    if (options?.method === 'POST') {
      expect(String(url)).toContain('/checkruns');
      return mockResponse(200, fixture);
    }
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

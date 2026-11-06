import { afterEach, expect, it, vi } from 'vitest';
import { defaultFeatureConfig } from '../../../src/adt/config.js';
import { createObject } from '../../../src/adt/crud.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { probeFeatures } from '../../../src/adt/features.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const fetch = vi.hoisted(() => vi.fn());
vi.mock('undici', async (original) => ({ ...(await original<typeof import('undici')>()), fetch }));
const { AdtClient } = await import('../../../src/adt/client.js');
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const config = { baseUrl: 'http://sap.example', safety: unrestrictedSafetyConfig() };
const client = () => new AdtClient(config);
const http = () => new AdtHttpClient(config);
const noHandler = `<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
<namespace id="com.sap.adt"/><type id="ExceptionContentHandlerNotFound"/>
<message>No content handler found for content type 'application/*'</message></exc:exception>`;

afterEach(() => vi.resetAllMocks());

it.each(['metadata', 'source', 'query', 'create'] as const)(
  'rejects an empty HTML ADT response instead of false %s success',
  async (operation) => {
    fetch.mockResolvedValue(mockResponse(200, '', { 'content-type': 'text/html', 'x-csrf-token': 'TOKEN' }));
    const sap = client();
    const call =
      operation === 'metadata'
        ? sap.getDataElement('XUBNAME')
        : operation === 'source'
          ? sap.http.get('/sap/bc/adt/ddic/tables/t000/source/main')
          : operation === 'query'
            ? sap.runQuery('SELECT COUNT(*) AS cnt FROM t000')
            : createObject(sap.http, config.safety, '/sap/bc/adt/ddic/tables', '<table/>');
    await expect(call).rejects.toMatchObject({ statusCode: 200, message: expect.stringContaining('empty HTML') });
  },
);

it.each([
  ['GET', '/sap/bc/adt/oo/classes/z/source/main', 200, 'text/plain', ''],
  ['GET', '/sap/bc/adt/repository/informationsystem/search', 200, 'application/xml', '<objectReferences/>'],
  ['GET', '/sap/opu/odata/example', 200, 'text/html', ''],
  ['HEAD', '/sap/bc/adt/discovery', 200, 'text/html', ''],
  ['DELETE', '/sap/bc/adt/oo/classes/z', 204, 'text/html', ''],
] as const)('preserves valid %s responses on %s', async (method, path, status, type, body) => {
  fetch.mockResolvedValue(mockResponse(status, body, { 'content-type': type, 'x-csrf-token': 'TOKEN' }));
  const sap = http();
  if (method === 'DELETE') fetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
  const call = method === 'HEAD' ? sap.head(path) : method === 'DELETE' ? sap.delete(path) : sap.get(path);
  await expect(call).resolves.toMatchObject({ statusCode: status, body });
});

it.each([201, 400])(
  'negotiates after a CSRF retry, preserving cookies and bounded attempts (final %s)',
  async (status) => {
    fetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'STALE' }));
    fetch.mockResolvedValueOnce(mockResponse(403, 'CSRF token required'));
    fetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'FRESH' }, ['SAP_SESSIONID=new; Path=/']));
    fetch.mockResolvedValueOnce(mockResponse(400, noHandler));
    fetch.mockResolvedValueOnce(mockResponse(status, status === 201 ? '<class/>' : noHandler));
    const call = http().post('/sap/bc/adt/oo/classes', '<class/>', 'application/*');
    if (status === 201) await expect(call).resolves.toMatchObject({ statusCode: 201 });
    else await expect(call).rejects.toBeInstanceOf(AdtApiError);
    expect(fetch).toHaveBeenCalledTimes(5);
    const final = fetch.mock.calls[4]?.[1];
    expect(final.headers).toMatchObject({
      'Content-Type': 'application/vnd.sap.adt.oo.classes+xml',
      'X-CSRF-Token': 'FRESH',
      Cookie: expect.stringContaining('SAP_SESSIONID=new'),
    });
  },
);

it('returns canonical ordinary search names only when the ADT URI confirms the identity', async () => {
  fetch.mockResolvedValue(
    mockResponse(
      200,
      `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
    <adtcore:objectReference adtcore:name="/UI2/CL_JSON (Klasse)" adtcore:type="CLAS/OC" adtcore:uri="/sap/bc/adt/oo/classes/%2fui2%2fcl_json"/>
    <adtcore:objectReference adtcore:name="ZOTHER (Class)" adtcore:type="CLAS/OC" adtcore:uri="/sap/bc/adt/oo/classes/zwrong"/>
  </adtcore:objectReferences>`,
    ),
  );
  expect((await client().searchObject('*')).map((result) => result.objectName)).toEqual([
    '/UI2/CL_JSON',
    'ZOTHER (Class)',
  ]);
});

it.each([false, true])(
  'preserves the honest empty-response explanation with minimalErrors=%s',
  async (minimalErrors) => {
    fetch.mockResolvedValue(mockResponse(200, '', { 'content-type': 'text/html' }));
    const result = await handleToolCall(client(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPRead', {
      type: 'DTEL',
      name: 'XUBNAME',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('does not establish an empty result');
    expect(result.content[0]?.text).toContain('read back any attempted changes');
  },
);

it('does not infer feature availability from a rejected HTTP 200 response', async () => {
  fetch.mockResolvedValue(mockResponse(200, '', { 'content-type': 'text/html' }));
  const result = await probeFeatures(http(), defaultFeatureConfig());
  expect(result.rap).toMatchObject({ available: false, message: expect.stringContaining('cannot determine') });
});

it('rejects whitespace-only HTML while preserving an empty JSON result', async () => {
  fetch.mockResolvedValueOnce(mockResponse(200, ' \r\n', { 'content-type': 'TEXT/HTML; charset=utf-8' }));
  await expect(http().get('/sap/bc/adt/ddic/dataelements/xubname')).rejects.toThrow('empty HTML');
  fetch.mockResolvedValueOnce(mockResponse(200, '[]', { 'content-type': 'application/json' }));
  await expect(http().get('/sap/bc/adt/example')).resolves.toMatchObject({ body: '[]' });
});

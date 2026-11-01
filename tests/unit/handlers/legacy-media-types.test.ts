import { beforeEach, describe, expect, it, vi } from 'vitest';
import { legacyContentHandlerFallback } from '../../../src/adt/legacy-content-handler.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { postCreate } = await import('../../../src/adt/create-request.js');

// Structured response captured by the SAP_BASIS 740 SP04 reporter in #907.
const noHandler = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <namespace id="com.sap.adt"/><type id="ExceptionContentHandlerNotFound"/>
  <message lang="EN">No content handler found for content type '*/*'</message>
  <localizedMessage lang="EN">No content handler found for content type '*/*'</localizedMessage>
  <properties/>
</exc:exception>`;
const classUrl = '/sap/bc/adt/oo/classes/ZCL_ISSUE907';
const classType = 'application/vnd.sap.adt.oo.classes+xml';
const classSource = `CLASS zcl_issue907 DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS answer RETURNING VALUE(result) TYPE i.
ENDCLASS.
CLASS zcl_issue907 IMPLEMENTATION.
  METHOD answer.
    result = 1.
  ENDMETHOD.
ENDCLASS.`;

function client(allowedPackages = ['$TMP']) {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: { ...defaultSafetyConfig(), allowWrites: true, allowedPackages },
  });
}

function headers(index: number): Record<string, string> {
  return mockFetch.mock.calls[index]?.[1]?.headers ?? {};
}

describe('legacy repository content handlers (#907)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('retries class metadata once without leaking its Accept into source or later metadata reads', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(400, noHandler))
      .mockResolvedValueOnce(mockResponse(200, '<metadata/>'))
      .mockResolvedValueOnce(mockResponse(200, classSource))
      .mockResolvedValueOnce(mockResponse(400, noHandler))
      .mockResolvedValueOnce(mockResponse(200, '<freshMetadata/>'));
    const http = client().http;
    const url = '/sap/bc/adt/oo/classes/%2FNS%2FCL_TEST?version=inactive';
    expect((await http.get(url)).body).toBe('<metadata/>');
    await http.get('/sap/bc/adt/oo/classes/%2FNS%2FCL_TEST/source/main');
    expect((await http.get(url)).body).toBe('<freshMetadata/>');
    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(headers(0).Accept).toBe('*/*');
    expect(headers(1)).toEqual({ ...headers(0), Accept: classType });
    expect(mockFetch.mock.calls[1]?.[0]).toBe(mockFetch.mock.calls[0]?.[0]);
    expect(headers(2).Accept).toBe('*/*');
    expect(headers(3).Accept).toBe('*/*');
    expect(headers(4).Accept).toBe(classType);
  });

  it.each([
    ['CLAS', '/sap/bc/adt/oo/classes', classType],
    ['PROG', '/sap/bc/adt/programs/programs', 'application/vnd.sap.adt.programs.programs+xml'],
  ])('recovers a %s create with the original body, URL, auth, cookies and CSRF token', async (type, url, mime) => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }, ['SESSION=test; Path=/']))
      .mockResolvedValueOnce(mockResponse(400, noHandler.replaceAll('*/*', 'application/*')))
      .mockResolvedValueOnce(mockResponse(201, '<created/>'));
    const result = await handleToolCall(client(['ZISSUE907']), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type,
      name: type === 'CLAS' ? 'ZCL_ISSUE907' : 'ZISSUE907',
      package: 'ZISSUE907',
      transport: 'NPLK900907',
    });
    expect(result.isError).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const createUrl = new URL(String(mockFetch.mock.calls[1]?.[0]));
    expect(createUrl.pathname).toBe(url);
    expect(createUrl.searchParams.get('corrNr')).toBe('NPLK900907');
    expect(mockFetch.mock.calls[2]?.[0]).toBe(mockFetch.mock.calls[1]?.[0]);
    expect(mockFetch.mock.calls[2]?.[1]?.body).toBe(mockFetch.mock.calls[1]?.[1]?.body);
    expect(headers(1)['Content-Type']).toBe('application/*');
    expect(headers(2)).toEqual({ ...headers(1), 'Content-Type': mime });
    expect(headers(2)['X-CSRF-Token']).toBe('T');
    expect(headers(2).Cookie).toContain('SESSION=test');
  });

  it('does not retry a second time when the fallback also fails', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(400, noHandler)).mockResolvedValueOnce(mockResponse(406, noHandler));
    await expect(client().http.get(classUrl)).rejects.toMatchObject({ statusCode: 406 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('preserves an unknown create outcome if the fallback fails with a server error', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
      .mockResolvedValueOnce(mockResponse(400, noHandler))
      .mockResolvedValueOnce(mockResponse(500, 'Connection to backend lost'));
    await expect(
      postCreate(client().http, '/sap/bc/adt/oo/classes', '<class/>', 'application/*'),
    ).rejects.toMatchObject({
      statusCode: 500,
      creationOutcome: 'unknown',
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['GET', '/sap/bc/adt/oo/classes', { Accept: '*/*' }],
    ['GET', `${classUrl}/source/main`, { Accept: '*/*' }], // sub-resources keep their own types
    ['GET', classUrl, { Accept: 'application/vnd.sap.adt.oo.classes.v4+xml' }], // discovered/explicit type
    ['POST', classUrl, { Accept: '*/*', 'Content-Type': 'application/*' }], // lock/unlock/action calls on the object
    ['POST', '/sap/bc/adt/oo/interfaces', { 'Content-Type': 'application/*' }],
    ['POST', '/sap/bc/adt/oo/classes', { 'Content-Type': 'application/vnd.sap.adt.oo.classes.v4+xml' }],
  ])('leaves %s %s %j unchanged', (method, path, requestHeaders) => {
    expect(legacyContentHandlerFallback(400, noHandler, method, path, requestHeaders)).toBeUndefined();
  });

  it('matches only the structured ExceptionContentHandlerNotFound 400', () => {
    const otherError = noHandler.replace('ExceptionContentHandlerNotFound', 'ExceptionInvalidData');
    expect(legacyContentHandlerFallback(400, otherError, 'GET', classUrl, { Accept: '*/*' })).toBeUndefined();
    expect(legacyContentHandlerFallback(406, noHandler, 'GET', classUrl, { Accept: '*/*' })).toBeUndefined();
    expect(
      legacyContentHandlerFallback(400, 'No content handler found', 'GET', classUrl, { Accept: '*/*' }),
    ).toBeUndefined();
  });

  it.each(['$TMP', 'ZPRIVATE', ''])('resolves the real package (%s) before a class update', async (pkg) => {
    mockFetch.mockImplementation((url, opts) => {
      const path = new URL(String(url)).pathname.toLowerCase();
      if (opts?.method === 'GET' && path === classUrl.toLowerCase()) {
        return Promise.resolve(
          opts.headers.Accept === classType
            ? mockResponse(
                200,
                `<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${pkg}"/></class:abapClass>`,
              )
            : mockResponse(400, noHandler),
        );
      }
      if (String(url).includes('_action=LOCK')) {
        return Promise.resolve(mockResponse(200, '<DATA><LOCK_HANDLE>LH</LOCK_HANDLE></DATA>'));
      }
      return Promise.resolve(
        mockResponse(200, path.endsWith('/source/main') ? classSource : '', { 'x-csrf-token': 'T' }),
      );
    });
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'CLAS',
      name: 'ZCL_ISSUE907',
      source: classSource,
      package: '$TMP',
      lintBeforeWrite: false,
    });
    const metadataCalls = mockFetch.mock.calls.filter(
      ([url]) => new URL(String(url)).pathname.toLowerCase() === classUrl.toLowerCase(),
    );
    expect(metadataCalls[0]?.[1]?.headers.Accept).toBe('*/*');
    expect(metadataCalls[1]?.[1]?.headers.Accept).toBe(classType);
    if (pkg === '$TMP') {
      expect(result.isError, JSON.stringify(result)).toBeUndefined();
      expect(mockFetch.mock.calls.some(([, opts]) => opts?.method !== 'GET')).toBe(true);
    } else {
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(pkg || 'Fail-closed');
      expect(mockFetch.mock.calls.every(([, opts]) => opts?.method === 'GET')).toBe(true);
    }
  });
});

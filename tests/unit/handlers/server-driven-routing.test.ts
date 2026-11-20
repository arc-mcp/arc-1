import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { getServerDrivenObject, SDO_REGISTRY, serverDrivenObjectUrl } from '../../../src/adt/server-driven.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { isDiscoveryRequest, mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { objectBasePath, objectUrlForType, sourceUrlForType } = await import('../../../src/handlers/object-types.js');
const uri = '/sap/bc/adt/ddic/dsfd/sources/CALENDAR_OPERATION';
const client = () => new AdtClient({ baseUrl: 'http://sap:8000', safety: defaultSafetyConfig() });

beforeEach(() => {
  vi.resetAllMocks();
  mockFetch.mockImplementation(async (url: string, opts: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (opts.method === 'POST' && path.endsWith('/worklists')) return mockResponse(200, 'WL');
    if (opts.method === 'POST' && path.endsWith('/runs'))
      return mockResponse(201, '', { location: '/sap/bc/adt/atc/runs/RUN' });
    if (path.endsWith('/customizing'))
      return mockResponse(200, '<customizing><property name="systemCheckVariant" value="DEFAULT"/></customizing>');
    if (path.includes('/runs/')) return mockResponse(200, '<run status="Completed"/>');
    if (path.includes('/worklists/'))
      return mockResponse(200, '<worklist id="WL" objectSetIsComplete="true"><objects/></worklist>');
    if (path.endsWith('/checkruns'))
      return mockResponse(200, '<checkRunReports><checkReport><checkMessages/></checkReport></checkRunReports>');
    return mockResponse(
      200,
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><CORRNR>DEVK900001</CORRNR><DEVCLASS>ZPKG</DEVCLASS><RECORDING>X</RECORDING></DATA></asx:values></asx:abap>',
      { 'x-csrf-token': 'T' },
    );
  });
});

describe('shared server-driven routing', () => {
  it.each([200, 403])('reads COTA using one caller discovery GET when cold (HTTP %i)', async (status) => {
    const caller = client();
    const href = '/sap/bc/adt/conn/commtargets';
    const v2 = 'application/vnd.sap.adt.blues.v2+xml';
    const doc = `<app:service xmlns:app="http://www.w3.org/2007/app"><app:workspace><app:collection href="${href}"><app:accept>${v2}</app:accept></app:collection></app:workspace></app:service>`;
    mockFetch.mockImplementation(async (url) =>
      isDiscoveryRequest(url)
        ? mockResponse(status, status === 200 ? doc : '')
        : mockResponse(
            200,
            new URL(url).pathname.endsWith('/source/main') ? '{}' : '<blue:blueSource adtcore:type="COTA/TYP"/>',
          ),
    );
    const result = await handleToolCall(caller, DEFAULT_CONFIG, 'SAPRead', { type: 'COTA', name: 'ZOBJ' });
    expect(result.isError).toBeFalsy();
    expect(mockFetch.mock.calls.filter(([url]) => isDiscoveryRequest(url))).toHaveLength(1);
    const meta = mockFetch.mock.calls.find(([url]) => new URL(url).pathname === `${href}/ZOBJ`);
    expect(meta?.[1].headers.Accept).toBe(status === 200 ? v2 : 'application/vnd.sap.adt.blues.v1+xml');
    expect(caller.http.hasDiscoveryData()).toBe(false);

    // Direct ADT callers have no preceding handler support check.
    mockFetch.mockClear();
    await getServerDrivenObject(caller.http, caller.safety, 'COTA', 'ZOBJ');
    expect(mockFetch.mock.calls.filter(([url]) => isDiscoveryRequest(url))).toHaveLength(1);
    expect(mockFetch.mock.calls.find(([url]) => new URL(url).pathname === `${href}/ZOBJ`)?.[1].headers.Accept).toBe(
      meta?.[1].headers.Accept,
    );
  });

  it('derives every registered path and encodes namespaced names', () => {
    for (const [type, entry] of Object.entries(SDO_REGISTRY)) {
      expect(objectBasePath(type)).toBe(`${entry.href}/`);
      const name = type === 'TABL/DTI' ? '/TEST/NAME~001' : '/TEST/NAME';
      expect(objectUrlForType(type, name)).toBe(serverDrivenObjectUrl(type, name));
      const encodedName = encodeURIComponent('lowercaseName' in entry ? name.toLowerCase() : name);
      expect(sourceUrlForType(type, name)).toBe(`${entry.href}/${encodedName}/source/main`);
    }
  });

  it.each(['syntax', 'atc', 'check', 'history'])('%s submits a DSFD URI through dispatch', async (action) => {
    const diagnose = action === 'syntax' || action === 'atc';
    const result = await handleToolCall(client(), DEFAULT_CONFIG, diagnose ? 'SAPDiagnose' : 'SAPTransport', {
      action,
      type: 'DSFD',
      name: 'CALENDAR_OPERATION',
      ...(diagnose ? {} : { package: 'ZPKG', operation: 'modify' }),
    });
    const requests = mockFetch.mock.calls;
    expect(requests.some(([url, opts]) => String(url).includes(uri) || String(opts.body).includes(uri))).toBe(true);
    expect(requests.some(([url, opts]) => `${url} ${opts.body}`.includes('/programs/programs/'))).toBe(false);
    if (action === 'atc') {
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]!.text as string).complete).toBe(false);
    } else expect(result.isError).toBeUndefined();
  });

  it.each([
    { action: 'unittest', type: 'DSFD', name: 'CALENDAR_OPERATION' },
    { action: 'atc', objects: [{ type: 'DSFD', name: 'CALENDAR_OPERATION' }] },
    { action: 'object_state', type: 'DSFD', name: 'CALENDAR_OPERATION' },
  ])('refuses unsupported $action without a SAP request', async (args) => {
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPDiagnose', args);
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('explains how to compare SDO versions with minimalErrors=%s', async (minimalErrors) => {
    const result = await handleToolCall(client(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPRead', {
      action: 'diff',
      type: 'DRTY',
      name: 'ZORDER_TYPE',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('read version="active" and version="inactive" separately');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const collection = '/sap/bc/adt/ddic/drty/sources';
const object = `${collection}/ZARC1_TYPE`;
const mime = 'application/vnd.sap.adt.blues.v1+xml';
const source = "@EndUserText.label: 'Example'\ndefine type ZARC1_TYPE : abap.int4;";

function backend(pkg = '$TMP') {
  const requests: { method: string; url: URL; body: unknown; headers: Headers }[] = [];
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const parsed = new URL(url);
    requests.push({ method, url: parsed, body: init?.body, headers: new Headers(init?.headers) });
    const headers = { 'x-csrf-token': 'TOKEN' };
    if (method === 'HEAD') return mockResponse(200, '', headers);
    if (method === 'GET' && parsed.pathname === object) {
      return mockResponse(
        200,
        `<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZARC1_TYPE" adtcore:type="DRTY/STY" adtcore:version="inactive"><adtcore:packageRef adtcore:name="${pkg}"/></blue:blueSource>`,
        headers,
      );
    }
    if (method === 'GET' && parsed.pathname === `${object}/source/main`) return mockResponse(200, source, headers);
    if (method === 'POST' && parsed.searchParams.get('_action') === 'LOCK') {
      return mockResponse(
        200,
        '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH</LOCK_HANDLE><CORRNR></CORRNR></DATA></asx:values></asx:abap>',
        headers,
      );
    }
    if (method === 'POST' && parsed.pathname === collection) return mockResponse(201, '', headers);
    if (method === 'POST' && parsed.searchParams.get('_action') === 'UNLOCK') return mockResponse(200, '', headers);
    if (method === 'PUT' && parsed.pathname === `${object}/source/main`) return mockResponse(200, '', headers);
    if (method === 'GET' && parsed.pathname.endsWith('/discovery')) return mockResponse(200, '', headers);
    throw new Error(`Unexpected ${method} ${parsed.pathname}`);
  });
  return requests;
}

function client() {
  const result = createClient().withSafety({ ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] });
  result.http.setDiscoveryMap(new Map([[collection, [mime]]]));
  return result;
}

const config = { ...DEFAULT_CONFIG, allowWrites: true, allowedPackages: ['$TMP'] };
beforeEach(() => {
  mockFetch.mockReset();
});

describe('DRTY dispatcher contract', () => {
  it('reads metadata and raw DDL from the DRTY endpoint', async () => {
    const requests = backend();
    const result = await handleToolCall(client(), config, 'SAPRead', { type: 'drty', name: 'ZARC1_TYPE' });
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      type: 'DRTY/STY',
      package: '$TMP',
      version: 'inactive',
      source,
    });
    expect(requests.filter((r) => r.url.pathname.startsWith(collection)).map((r) => r.url.pathname)).toEqual([
      object,
      `${object}/source/main`,
    ]);
    expect(requests.every((r) => !r.url.searchParams.has('version'))).toBe(true);
  });

  it.each(['create', 'update'])('%s writes DDL text under a stateful lock', async (action) => {
    const requests = backend();
    const result = await handleToolCall(client(), config, 'SAPWrite', {
      action,
      type: 'DRTY',
      name: 'ZARC1_TYPE',
      package: '$TMP',
      source,
    });
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(result.content[0].text).toContain('SAPActivate');
    const writes = requests.filter((r) => r.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ body: source });
    expect(writes[0].url.pathname).toBe(`${object}/source/main`);
    expect(writes[0].headers.get('content-type')).toContain('text/plain');
    expect(writes[0].headers.get('x-sap-adt-sessiontype')).toBe('stateful');
    expect(writes[0].url.searchParams.get('lockHandle')).toBe('LH');
    const lockIndex = requests.findIndex((r) => r.url.searchParams.get('_action') === 'LOCK');
    const unlockIndex = requests.findIndex((r) => r.url.searchParams.get('_action') === 'UNLOCK');
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(requests.indexOf(writes[0]));
    expect(unlockIndex).toBeGreaterThan(requests.indexOf(writes[0]));
    if (action === 'create') {
      const create = requests.find((r) => r.method === 'POST' && r.url.pathname === collection)!;
      expect(create.headers.get('content-type')).toContain(mime);
      expect(create.body).toContain('adtcore:type="DRTY/STY"');
      expect(create.body).toContain('adtcore:packageRef adtcore:name="$TMP"');
    }
  });

  it.each(['SAPRead', 'SAPWrite', 'SAPActivate'])(
    '%s refuses an absent collection without contacting it',
    async (tool) => {
      const c = client();
      c.http.setDiscoveryMap(new Map([['/sap/bc/adt/programs/programs', ['application/xml']]]));
      const result = await handleToolCall(c, config, tool, {
        ...(tool === 'SAPWrite' ? { action: 'create', source } : {}),
        type: 'DRTY',
        name: 'ZARC1_TYPE',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('does not advertise');
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each(['update', 'delete'])('%s checks the existing object package, not the supplied package', async (action) => {
    const requests = backend('SAP_PACKAGE');
    const result = await handleToolCall(client(), config, 'SAPWrite', {
      action,
      type: 'DRTY',
      name: 'ZARC1_TYPE',
      package: '$TMP',
      source,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('SAP_PACKAGE');
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });

  it('retains the write-disabled ceiling', async () => {
    const c = client().withSafety({ ...unrestrictedSafetyConfig(), allowWrites: false });
    const result = await handleToolCall(c, { ...config, allowWrites: false }, 'SAPWrite', {
      action: 'create',
      type: 'DRTY',
      name: 'ZARC1_TYPE',
      source,
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

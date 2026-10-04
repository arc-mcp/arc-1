/**
 * SAPRead / SAPWrite handler tests for DDIC lock objects (ENQU).
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

const EMEKKOE = readFileSync(new URL('../../fixtures/xml/lockobject-emekkoe.xml', import.meta.url), 'utf8');
const ENQU_URL = '/sap/bc/adt/ddic/lockobjects/sources';
const LOCKOBJECT_CT = 'application/vnd.sap.adt.lockobjects.v1+xml';

interface Call {
  method: string;
  url: string;
  body?: string;
  accept?: string;
  contentType?: string;
}

/** Mock SAP: GET returns `metadata`, LOCK returns a handle, everything else 200. Records every call. */
function mockSap(metadata = EMEKKOE): Call[] {
  const calls: Call[] = [];
  mockFetch.mockReset();
  mockFetch.mockImplementation(
    (url: string | URL, opts?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
      const method = opts?.method ?? 'GET';
      const headers = (opts?.headers ?? {}) as Record<string, string>;
      const urlStr = String(url);
      calls.push({
        method,
        url: urlStr,
        body: typeof opts?.body === 'string' ? opts.body : undefined,
        accept: headers.Accept ?? headers.accept,
        contentType: headers['Content-Type'] ?? headers['content-type'],
      });
      if (method === 'POST' && urlStr.includes('_action=LOCK')) {
        return Promise.resolve(
          mockResponse(200, '<asx:values><LOCK_HANDLE>LH_ENQU</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
            'x-csrf-token': 'T',
          }),
        );
      }
      if (method === 'GET' && urlStr.includes(ENQU_URL)) {
        return Promise.resolve(mockResponse(200, metadata, { 'x-csrf-token': 'T' }));
      }
      return Promise.resolve(mockResponse(201, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
    },
  );
  return calls;
}

describe('ENQU (lock object) handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
  });

  it('SAPRead returns the lock object as JSON with the lockobjects Accept', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'ENQU', name: 'EMEKKOE' });
    expect(result.isError).toBeUndefined();
    const json = JSON.parse(result.content[0].text);
    expect(json.primaryTable).toEqual({ tableName: 'EKKO', lockMode: 'E' });
    expect(json.secondaryTables).toEqual([{ tableName: 'EKPO', lockMode: 'E' }]);
    const get = calls.find((c) => c.method === 'GET' && c.url.includes(`${ENQU_URL}/EMEKKOE`));
    expect(get?.accept).toBe(LOCKOBJECT_CT);
    // Omitted version = SAP's developer view, so a pending draft is visible.
    expect(get?.url).not.toContain('version=');
  });

  it('SAPRead accepts the ADT slash type ENQU/DL and forwards an explicit version', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'ENQU/DL',
      name: 'EMEKKOE',
      version: 'inactive',
    });
    expect(result.isError).toBeUndefined();
    expect(calls.some((c) => c.url.includes(`${ENQU_URL}/EMEKKOE?version=inactive`))).toBe(true);
  });

  it('SAPWrite create POSTs the full definition to the collection and hints activation', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'ENQU',
      name: 'EZTEST',
      package: '$TMP',
      description: 'Test lock',
      source: JSON.stringify({ primaryTable: { tableName: 'ZTAB', lockMode: 'X' } }),
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('SAPActivate(type="ENQU", name="EZTEST")');
    const post = calls.find((c) => c.method === 'POST' && c.url.includes(ENQU_URL) && !c.url.includes('_action'));
    expect(post?.contentType).toContain(LOCKOBJECT_CT);
    expect(post?.body).toContain('<enqu:tableName>ZTAB</enqu:tableName><enqu:lockMode>X</enqu:lockMode>');
    expect(post?.body).toContain('adtcore:description="Test lock"');
    // The create POST carries everything; no follow-up PUT is needed (live-verified 8.16).
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('SAPWrite create without a primary table fails before any HTTP call', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'ENQU',
      name: 'EZTEST',
      package: '$TMP',
      description: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('primaryTable is required');
    expect(calls.some((c) => c.method === 'POST' && c.url.includes(ENQU_URL))).toBe(false);
  });

  it('SAPWrite update merges a partial definition over the stored one under a lock', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'ENQU',
      name: 'EMEKKOE',
      source: JSON.stringify({ allowRFC: true }),
    });
    expect(result.isError).toBeUndefined();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toContain(`${ENQU_URL}/EMEKKOE?lockHandle=LH_ENQU`);
    expect(put?.contentType).toContain(LOCKOBJECT_CT);
    // Changed key applied; stored tables, parameters and description kept.
    expect(put?.body).toContain('<enqu:allowRFC>true</enqu:allowRFC>');
    expect(put?.body).toContain('<enqu:secondaryTable><enqu:tableName>EKPO</enqu:tableName>');
    expect(put?.body).toContain('<enqu:parameterWanted>false</enqu:parameterWanted><enqu:parameterName>EBELN');
    expect(put?.body).toContain('adtcore:description="Purchasing Document Exclusive"');
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('_action=UNLOCK'))).toBe(true);
    // The merge base is the developer view: an explicit version would drop an unactivated draft.
    const reads = calls.filter((c) => c.method === 'GET' && c.url.includes(`${ENQU_URL}/EMEKKOE`));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((c) => !c.url.includes('version='))).toBe(true);
  });

  it('SAPWrite update refuses a table change without lockParameters and never PUTs', async () => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'ENQU',
      name: 'EMEKKOE',
      source: JSON.stringify({ primaryTable: { tableName: 'EBAN', lockMode: 'E' } }),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('requires "lockParameters"');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it.each([
    { lockParameters: [] },
    { primaryTable: { tableName: 'EKKO' } },
    { lockParameters: [{ parameterName: 'EBELN', tableName: 'EKKO', fieldName: 'EBELN' }] },
  ])('refuses an unsafe partial update without writing: %j', async (definition) => {
    const calls = mockSap();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'ENQU',
      name: 'EMEKKOE',
      source: JSON.stringify(definition),
    });
    expect(result.isError).toBe(true);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    const locked = calls.some((c) => c.url.includes('_action=LOCK'));
    expect(calls.some((c) => c.url.includes('_action=UNLOCK'))).toBe(locked);
  });

  it.each(['create', 'batch_create'] as const)(
    'refuses ENQU %s when discovery does not advertise the lock-object collection',
    async (action) => {
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      mockFetch.mockReset();
      const entry = {
        type: 'ENQU',
        name: 'EZTEST',
        source: JSON.stringify({ primaryTable: { tableName: 'ZTAB', lockMode: 'E' } }),
      };
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action,
        package: '$TMP',
        ...(action === 'create' ? entry : { objects: [entry] }),
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Lock object (ENQU) writes are not available');
      expect(mockFetch.mock.calls).toHaveLength(0);
    },
  );

  const source = JSON.stringify({ primaryTable: { tableName: 'ZTAB', lockMode: 'E' } });
  it.each([
    ['create', { action: 'create', type: 'ENQU', name: 'EZTEST', package: 'ZOTHER', source }, 'ZOTHER'],
    [
      'batch_create',
      { action: 'batch_create', package: 'ZOTHER', objects: [{ type: 'ENQU', name: 'EZTEST', source }] },
      'ZOTHER',
    ],
    // Update is checked against the stored package (ME in the fixture), not an argument.
    ['update', { action: 'update', type: 'ENQU', name: 'EMEKKOE', source: JSON.stringify({ allowRFC: true }) }, 'ME'],
  ])('refuses ENQU %s outside the package allowlist before any write', async (_action, args, pkg) => {
    const calls = mockSap();
    const client = createClient();
    const restricted = client.withSafety({ ...client.safety, allowedPackages: ['$TMP'] });
    const result = await handleToolCall(restricted, DEFAULT_CONFIG, 'SAPWrite', args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(`'${pkg}'`);
    expect(calls.filter((c) => c.method === 'POST' || c.method === 'PUT')).toHaveLength(0);
  });
});

import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { AdtResponseLimitError } from '../../../src/adt/errors.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const batch = readFileSync(new URL('../../fixtures/xml/syntax-batch-758.xml', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../fixtures/xml/dumps-schema-758.xml', import.meta.url), 'utf8');
const reader = { token: 'test', clientId: 'reader', scopes: ['read'] };
const client = () => new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });
const objects = [
  { type: 'clas/oc', name: 'zcl_arc1_td_calc' },
  { type: 'prog/p', name: 'zarc1_td_report' },
];
beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url, options) =>
    mockResponse(200, options?.method === 'POST' ? batch : String(url).includes('/feeds') ? schema : '<feed/>', {
      'x-csrf-token': 't',
    }),
  );
});
it.each(['SAPRead', 'SAP'])('ignores an empty batch placeholder on an ordinary %s read', async (tool) => {
  const adt = client();
  const getProgram = vi.spyOn(adt, 'getProgram').mockResolvedValue({
    source: 'REPORT zdemo.',
    notModified: false,
    statusCode: 200,
  });
  const params = { type: 'PROG', name: 'ZDEMO', version: 'active', objects: [] };
  const args = tool === 'SAPRead' ? params : { action: 'read', params };
  const result = await handleToolCall(adt, DEFAULT_CONFIG, tool, args, reader);
  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toBe('REPORT zdemo.');
  expect(getProgram).toHaveBeenCalledTimes(1);
});
it('keeps an explicit single-object syntax check when objects is an empty placeholder', async () => {
  const result = await handleToolCall(
    client(),
    DEFAULT_CONFIG,
    'SAPRead',
    { type: 'SYNTAX', objectType: 'PROG', name: 'ZDEMO', objects: [] },
    reader,
  );
  expect(result.isError).toBeUndefined();
  expect(JSON.parse(result.content[0].text)).toMatchObject({ checked: true });
  expect(JSON.parse(result.content[0].text)).not.toHaveProperty('requestedObjectCount');
});
it('treats empty optional filters as omitted on diagnostic calls', async () => {
  for (const args of [{ action: 'feed_schema' }, { action: 'syntax', objects }, { action: 'dumps' }]) {
    mockFetch.mockClear();
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPDiagnose', { ...args, filters: [] }, reader);
    expect(result.isError).toBeUndefined();
    if (args.action === 'dumps') {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const url = new URL(String(mockFetch.mock.calls[0]?.[0]));
      expect(url.pathname).toBe('/sap/bc/adt/runtime/dumps');
      expect(url.searchParams.has('$query')).toBe(false);
    }
  }
});
it.each([
  { action: 'feed_schema' },
  { action: 'syntax', objects },
  { action: 'activation_log', type: 'DOMA', name: 'ZDOMAIN' },
  { action: 'dumps', filters: [{ attribute: 'user', operator: 'equals', values: ['X'] }] },
])('accepts harmless filler but rejects meaningful unrelated options for $action', async (args) => {
  mockFetch.mockImplementation(async (url, options) =>
    mockResponse(
      200,
      options?.method === 'POST'
        ? batch
        : String(url).includes('/feeds')
          ? schema
          : String(url).includes('/ddic/domains/')
            ? '<domain name="ZDOMAIN"/>'
            : '<feed/>',
      { 'x-csrf-token': 't' },
    ),
  );
  const result = await handleToolCall(
    client(),
    DEFAULT_CONFIG,
    'SAPDiagnose',
    {
      ...args,
      coverage: false,
      includeFullText: false,
      sections: [],
      maxResults: 0,
    },
    reader,
  );
  expect(result.isError).toBeUndefined();
  mockFetch.mockClear();
  const invalid = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPDiagnose', { ...args, coverage: true }, reader);
  expect(invalid.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it.each(['SAPRead', 'SAPDiagnose'])(
  'runs one native batch through %s with read scope and normalized aliases',
  async (tool) => {
    const args = tool === 'SAPRead' ? { type: 'SYNTAX', objects } : { action: 'syntax', objects };
    const result = await handleToolCall(client(), DEFAULT_CONFIG, tool, args, reader);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      status: 'passed',
      checkedObjectCount: 2,
      requestedVersion: 'active',
    });
    const posts = mockFetch.mock.calls.filter(([, o]) => o?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[1]?.body).toContain('ZCL_ARC1_TD_CALC');
    expect(posts[0]?.[1]?.body).not.toContain('artifacts');
  },
);
it.each([
  ['SAPRead', { type: 'SYNTAX', objects: [] }],
  ['SAPRead', { type: 'CLAS', objects }],
  ['SAPRead', { type: 'SYNTAX', objects, source: 'REPORT x.' }],
  ['SAPRead', { type: 'SYNTAX', objects, objectType: 'PROG' }],
  ['SAPRead', { type: 'SYNTAX', objects, version: 'auto' }],
  ['SAPRead', { type: 'SYNTAX', objects: Array(21).fill(objects[0]) }],
  ['SAPRead', { type: 'SYNTAX', objects: [objects[0], objects[0]] }],
  ['SAPRead', { type: 'SYNTAX', objects: [{ type: 'TABL', name: 'T000' }] }],
  ['SAPDiagnose', { action: 'syntax', objects, source: 'REPORT x.' }],
  ['SAPDiagnose', { action: 'syntax', objects: [{ type: 'DOMA', name: 'SPRAS' }] }],
  ['SAPDiagnose', { action: 'feed_schema', url: '/arbitrary' }],
  ['SAPDiagnose', { action: 'feed_schema', filters: [{ attribute: 'user', operator: 'equals', values: ['X'] }] }],
  ['SAPDiagnose', { action: 'activation_log', type: 'CLAS', name: 'X' }],
  ['SAPDiagnose', { action: 'activation_log', type: 'DOMA', name: '../X' }],
  ['SAPDiagnose', { action: 'dumps', id: 'x', filters: [{ attribute: 'user', operator: 'equals', values: ['X'] }] }],
] as const)('refuses ambiguous or invalid %s input before SAP: %j', async (tool, args) => {
  const result = await handleToolCall(client(), DEFAULT_CONFIG, tool, args, reader);
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it('applies deny-action rules before syntax batches and schema reads', async () => {
  for (const [tool, args, rule] of [
    ['SAPRead', { type: 'SYNTAX', objects }, 'SAPDiagnose.syntax'],
    ['SAPDiagnose', { action: 'feed_schema' }, 'SAPDiagnose.feed_schema'],
  ] as const) {
    const result = await handleToolCall(client(), { ...DEFAULT_CONFIG, denyActions: [rule] }, tool, args, reader);
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  }
});
it('compiles advertised filters while retaining legacy user and time bounds', async () => {
  const result = await handleToolCall(
    client(),
    DEFAULT_CONFIG,
    'SAPDiagnose',
    {
      action: 'dumps',
      user: ' DEVELOPER ',
      from: '2026-10-17',
      to: '2026-10-17T23:59:59Z',
      maxResults: 1,
      filters: [{ attribute: 'runtimeError', operator: 'equals', values: ['NO_MATCH'] }],
    },
    reader,
  );
  expect(result.isError).toBeUndefined();
  const urls = mockFetch.mock.calls.map(([url]) => String(url));
  expect(urls.some((u) => u.includes('/feeds'))).toBe(true);
  const url = new URL(urls.find((u) => u.includes('/runtime/dumps'))!);
  expect(url.searchParams.get('$query')).toBe('and(equals(runtimeError,NO_MATCH),equals(user,DEVELOPER))');
  expect(url.searchParams.get('from')).toBe('20261017000000');
  expect(url.searchParams.get('to')).toBe('20261017235959');
  expect(JSON.parse(result.content[0].text)).toEqual([]);
});
it('rejects filter grammar injection after schema discovery without reading dumps', async () => {
  const result = await handleToolCall(
    client(),
    DEFAULT_CONFIG,
    'SAPDiagnose',
    { action: 'dumps', filters: [{ attribute: 'user', operator: 'equals', values: ['X),equals(user,Y)'] }] },
    reader,
  );
  expect(result.isError).toBe(true);
  expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/runtime/dumps'))).toBe(false);
});
it('enforces the native response byte cap through HTTP and dispatch', async () => {
  mockFetch.mockImplementation(async (_url, options) =>
    mockResponse(
      200,
      options?.method === 'POST' ? `<checkRunReports>${' '.repeat(512 * 1024)}</checkRunReports>` : '',
      { 'x-csrf-token': 't' },
    ),
  );
  const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPRead', { type: 'SYNTAX', objects }, reader);
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('DATA_RESPONSE_TOO_LARGE');
  expect(mockFetch.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(1);
});
it('bounds legacy unfiltered dump lists without schema discovery', async () => {
  mockFetch.mockResolvedValue(mockResponse(200, `<feed>${' '.repeat(2 * 1024 * 1024)}</feed>`));
  const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPDiagnose', { action: 'dumps' }, reader);
  expect(result.isError).toBe(true);
  const reply = JSON.parse(result.content[0].text);
  expect(reply).toMatchObject({ error: 'DATA_RESPONSE_TOO_LARGE', limitBytes: 2 * 1024 * 1024, retryable: false });
  expect(reply.message).toContain('from/to');
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/runtime/dumps');
});
it('keeps the compatibility batch available through hyperfocused read delegation', async () => {
  const result = await handleToolCall(
    client(),
    DEFAULT_CONFIG,
    'SAP',
    { action: 'read', type: 'SYNTAX', params: { objects } },
    reader,
  );
  expect(result.isError).toBeUndefined();
  expect(JSON.parse(result.content[0].text)).toMatchObject({ status: 'passed', checkedObjectCount: 2 });
});

it('reads a namespaced Dictionary log through the real dispatcher', async () => {
  const objectUri = '/sap/bc/adt/ddic/domains/%2FABC%2FDOMAIN';
  const logUri = '/sap/bc/adt/ddic/logs/db/ACTDOMA%2FABC%2FDOMAIN';
  mockFetch.mockImplementation(async (url) =>
    mockResponse(
      200,
      String(url).includes('/ddic/domains/')
        ? `<domain name="/ABC/DOMAIN"><link rel="http://www.sap.com/adt/relations/ddic/activationlog" type="application/vnd.sap.adt.logs+xml" href="${logUri}"/></domain>`
        : `<log><entry><link rel="object" href="${objectUri}"/></entry></log>`,
    ),
  );
  const result = await handleToolCall(
    client(),
    DEFAULT_CONFIG,
    'SAPDiagnose',
    { action: 'activation_log', type: 'DOMA', name: '/ABC/DOMAIN' },
    reader,
  );
  expect(result.isError).toBeUndefined();
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    status: 'available',
    relation: { uri: logUri },
    log: { entries: [{ references: [{ uri: objectUri, relation: 'object' }] }] },
  });
  expect(mockFetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([objectUri, logUri]);
});

it.each([false, true])('gives diagnostic-specific response-limit advice (minimal=%s)', async (minimalErrors) => {
  for (const [family, args, expectedHint] of [
    ['syntax-batch', { action: 'syntax', objects }, /smaller batch/i],
    ['feed-schema', { action: 'feed_schema' }, /schema.*SAP ADT/i],
    ['dumps', { action: 'dumps' }, /from\/to/],
    ['ddic-activation-log', { action: 'activation_log', type: 'DOMA', name: 'ZDOMAIN' }, /log.*SAP ADT/i],
  ] as const) {
    const adt = client();
    const error = new AdtResponseLimitError(512 * 1024, 512 * 1024 + 1, family);
    vi.spyOn(adt.http, 'get').mockRejectedValue(error);
    vi.spyOn(adt.http, 'post').mockRejectedValue(error);
    const result = await handleToolCall(adt, { ...DEFAULT_CONFIG, minimalErrors }, 'SAPDiagnose', args, reader);
    expect(result.isError).toBe(true);
    const reply = JSON.parse(result.content[0].text);
    expect(reply).toMatchObject({ error: 'DATA_RESPONSE_TOO_LARGE', retryable: false, limitBytes: 512 * 1024 });
    expect(reply.message).toMatch(expectedHint);
    expect(reply.message).not.toMatch(/data-preview|maxRows|WHERE/);
  }
});

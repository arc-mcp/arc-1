import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { multiTargetToolDefinitions } = await import('../../../src/server/multi-target-tools.js');
const schema = readFileSync(new URL('../../fixtures/xml/dumps-schema-758.xml', import.meta.url), 'utf8');
const reader = { token: 'test', clientId: 'reader', scopes: ['read'] };
const filter = { attribute: 'runtimeError', operator: 'equals', values: ['TIME_OUT'] };
const client = () => new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });
const call = (args: Record<string, unknown>, config = DEFAULT_CONFIG, auth = reader) =>
  handleToolCall(client(), config, 'SAPDiagnose', args, auth);
const payload = (result: Awaited<ReturnType<typeof call>>) => JSON.parse(result.content[0]!.text!);
const paths = () => mockFetch.mock.calls.map(([url]) => new URL(String(url)));
const stamp = (s: string) => s.replace(/[-:T]/g, '').slice(0, 14);
const rows = Array.from({ length: 220 }, (_, i) => ({
  id: `D${i}`,
  time: new Date(Date.UTC(2026, 9, 17, 12) - i * 60_000).toISOString(),
}));
const feed = (data: typeof rows, padding = '') =>
  `<feed>${data.map((d) => `<entry><id>/sap/bc/adt/runtime/dump/${d.id}</id><published>${d.time}</published><author><name>EVAL_USER</name></author><category label="Runtime Error" term="TIME_OUT"/></entry>`).join('')}${padding}</feed>`;
beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  // A known release keeps these tests on the list's own requests; dump-list-window.test.ts covers the
  // release read for an unknown release.
  setCachedFeatures({ abapRelease: '758' });
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url) =>
    mockResponse(200, new URL(String(url)).pathname === '/sap/bc/adt/feeds' ? schema : '<feed/>'),
  );
});
it('queries directly with a known filter, user conjunction and inclusive date bounds', async () => {
  const result = await call({
    action: 'dumps',
    filters: [filter],
    user: ' EVAL_USER ',
    from: '2026-10-17',
    to: '2026-10-17T23:59:59Z',
    maxResults: 1,
  });
  expect(result.isError).toBeUndefined();
  expect(payload(result)).toEqual([]);
  expect(paths().map((u) => u.pathname)).toEqual(['/sap/bc/adt/feeds', '/sap/bc/adt/runtime/dumps']);
  expect(paths()[1]!.searchParams.get('$query')).toBe('and(equals(runtimeError,TIME_OUT),equals(user,EVAL_USER))');
  expect(paths()[1]!.searchParams.get('from')).toBe('20261017000000');
  expect(paths()[1]!.searchParams.get('to')).toBe('20261017235959');
});
it('returns only requested-day rows and keeps the predicate on every paginated request', async () => {
  const all = [
    { id: 'NEXT_DAY', time: '2026-10-18T01:00:00Z' },
    ...rows,
    { id: 'PREVIOUS_DAY', time: '2026-10-16T23:59:59Z' },
  ];
  mockFetch.mockImplementation(async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/sap/bc/adt/feeds') return mockResponse(200, schema);
    expect(u.searchParams.get('$query')).toBe('and(equals(runtimeError,TIME_OUT))');
    expect(u.searchParams.get('from')).toBe('20261017000000');
    const visible = all
      .filter((d) => stamp(d.time) >= u.searchParams.get('from')! && stamp(d.time) <= u.searchParams.get('to')!)
      .slice(0, Number(u.searchParams.get('$top')));
    return mockResponse(200, feed(visible));
  });
  const result = await call({
    action: 'dumps',
    filters: [filter],
    from: '2026-10-17',
    to: '2026-10-17T23:59:59Z',
    maxResults: 205,
  });
  expect(result.isError).toBeUndefined();
  expect(payload(result).map((d: { id: string }) => d.id)).toEqual(rows.slice(0, 205).map((d) => d.id));
  expect(paths()).toHaveLength(4); // One schema + three pages, inclusive cursor deduplicated.
  expect(paths()[2]!.searchParams.get('to')).toBe(stamp(rows[99]!.time));
});
it('keeps same-second paging uncertainty explicit', async () => {
  mockFetch.mockImplementation(async (url) =>
    mockResponse(
      200,
      String(url).includes('/feeds')
        ? schema
        : feed(rows.slice(0, 100).map((d) => ({ ...d, time: '2026-10-17T12:00:00Z' }))),
    ),
  );
  const result = await call({ action: 'dumps', filters: [filter], maxResults: 150 });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('share that second');
  expect(paths()).toHaveLength(3);
});
it('recovers an invalid operator through optional schema discovery without a broader query', async () => {
  const invalid = await call({ action: 'dumps', filters: [{ ...filter, operator: '=' }] });
  expect(invalid.isError).toBe(true);
  expect(invalid.content[0]!.text).toContain('feed_schema');
  expect(paths().every((u) => u.pathname === '/sap/bc/adt/feeds')).toBe(true);
  expect(payload(await call({ action: 'feed_schema' })).attributes).toContainEqual(
    expect.objectContaining({ id: 'runtimeError' }),
  );
  expect((await call({ action: 'dumps', filters: [filter] })).isError).toBeUndefined();
});
it.each([
  ['unavailable', 200, '<feed/>'],
  ['denied', 403, 'Forbidden'],
])('does not fall back when schema is %s', async (_name, status, body) => {
  mockFetch.mockResolvedValue(mockResponse(Number(status), String(body)));
  expect((await call({ action: 'dumps', filters: [filter] })).isError).toBe(true);
  expect(paths().every((u) => u.pathname === '/sap/bc/adt/feeds')).toBe(true);
});
it.each([
  { action: 'dumps', id: 'D0', filters: [filter] },
  { action: 'syntax', filters: [filter] },
  { action: 'feed_schema', url: '/arbitrary' },
  { action: 'feed_schema', filters: [filter] },
  { action: 'dumps', filters: [filter], includeFullText: true },
  { action: 'dumps', filters: Array(9).fill(filter) },
  { action: 'dumps', filters: [{ ...filter, extra: 'ignored?' }] },
  { action: 'dumps', filters: [filter], from: 'invalid' },
])('refuses invalid or ambiguous arguments before I/O: %j', async (args) => {
  expect((await call(args)).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it.each(['X),equals(user,ADMIN)', 'x\\y', "x'y", 'x"y', ' x'])(
  'rejects grammar value %s without listing',
  async (value) => {
    expect((await call({ action: 'dumps', filters: [{ ...filter, values: [value] }] })).isError).toBe(true);
    expect(paths().every((u) => u.pathname === '/sap/bc/adt/feeds')).toBe(true);
  },
);
it('counts a legacy user conjunction toward the eight-term limit', async () => {
  expect((await call({ action: 'dumps', user: 'EVAL_USER', filters: Array(8).fill(filter) })).isError).toBe(true);
  expect(paths().every((u) => u.pathname === '/sap/bc/adt/feeds')).toBe(true);
});
it.each(['dumps', 'feed_schema'])('enforces read scope and deny actions for %s before I/O', async (action) => {
  const args = action === 'dumps' ? { action, filters: [filter] } : { action };
  expect((await call(args, DEFAULT_CONFIG, { ...reader, scopes: [] })).isError).toBe(true);
  expect((await call(args, { ...DEFAULT_CONFIG, denyActions: [`SAPDiagnose.${action}`] })).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it('keeps unfiltered wire behavior and request count, including empty filter placeholders', async () => {
  for (const filters of [undefined, [], null]) {
    mockFetch.mockClear();
    expect((await call({ action: 'dumps', filters, user: ' EVAL_USER ', maxResults: 0 })).isError).toBeUndefined();
    expect(paths()).toHaveLength(1);
    expect(paths()[0]!.pathname).toBe('/sap/bc/adt/runtime/dumps');
    expect(paths()[0]!.searchParams.get('$query')).toBe('and(equals(user,EVAL_USER))');
    expect(paths()[0]!.searchParams.get('$top')).toBe('50'); // Handler's existing 0-placeholder behavior.
  }
});
it('accepts harmless fillers but rejects meaningful unrelated options', async () => {
  expect(
    (await call({ action: 'feed_schema', coverage: false, includeFullText: false, sections: [], maxResults: 0 }))
      .isError,
  ).toBeUndefined();
  mockFetch.mockClear();
  expect((await call({ action: 'feed_schema', coverage: true })).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it('reads schemas through each call identity without caching', async () => {
  await call({ action: 'dumps', filters: [filter] });
  await call({ action: 'dumps', filters: [filter] }, DEFAULT_CONFIG, { ...reader, clientId: 'other' });
  expect(paths().filter((u) => u.pathname === '/sap/bc/adt/feeds')).toHaveLength(2);
});
it.each([false, true])(
  'uses one cumulative byte budget across schema and pages (minimal=%s)',
  async (minimalErrors) => {
    mockFetch.mockImplementation(async (url) =>
      mockResponse(200, String(url).includes('/feeds') ? schema : feed(rows.slice(0, 100), ' '.repeat(1100 * 1024))),
    );
    const result = await call(
      { action: 'dumps', filters: [filter], maxResults: 150 },
      { ...DEFAULT_CONFIG, minimalErrors },
    );
    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({
      error: 'DATA_RESPONSE_TOO_LARGE',
      limitBytes: 2 * 1024 * 1024,
      retryable: false,
    });
    expect(payload(result).message).toContain('from/to');
    expect(paths()).toHaveLength(3);
  },
);
it.each([false, true])(
  'bounds standalone schema responses with useful limit advice (minimal=%s)',
  async (minimalErrors) => {
    mockFetch.mockResolvedValue(mockResponse(200, `<feed>${' '.repeat(256 * 1024)}</feed>`));
    const result = await call({ action: 'feed_schema' }, { ...DEFAULT_CONFIG, minimalErrors });
    expect(result.isError).toBe(true);
    expect(payload(result).message).toContain('schema in SAP ADT');
    expect(payload(result).message).not.toContain('WHERE');
  },
);
it('cancels before schema I/O', async () => {
  await requestContext.run({ requestId: 'filter-cancel', signal: AbortSignal.abort() }, async () => {
    expect((await call({ action: 'dumps', filters: [filter] })).isError).toBe(true);
  });
  expect(mockFetch).not.toHaveBeenCalled();
});
it('does not reset the deadline between schema and list', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mockFetch.mockImplementation(async () => {
    now = 31001;
    return mockResponse(200, schema);
  });
  expect((await call({ action: 'dumps', filters: [filter] })).isError).toBe(true);
  expect(paths()).toHaveLength(1);
});
it('exposes only read operations in BTP and multi-target catalogs', async () => {
  const { getToolDefinitions } = await import('../../../src/handlers/tools.js');
  const { btp, features } = await import('./handler-test-config.js');
  const definitions = getToolDefinitions(btp(), false, features());
  const multi = multiTargetToolDefinitions(definitions, btp());
  for (const catalog of [definitions, multi]) {
    const tool = catalog.find((t) => t.name === 'SAPDiagnose')!;
    const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(properties.action!.enum).toContain('feed_schema');
    expect(properties.filters).toBeDefined();
  }
});
it('keeps the exact legacy HTTP call shape without a response budget', async () => {
  const adt = client();
  const get = vi.spyOn(adt.http, 'get');
  const result = await handleToolCall(adt, DEFAULT_CONFIG, 'SAPDiagnose', { action: 'dumps', filters: [] }, reader);
  expect(result.isError).toBeUndefined();
  expect(get).toHaveBeenCalledExactlyOnceWith('/sap/bc/adt/runtime/dumps?$top=50', {
    Accept: 'application/atom+xml;type=feed',
  });
});
it('uses the same query encoder as legacy calls before HTTP adds SAP context', async () => {
  const adt = client();
  const get = vi.spyOn(adt.http, 'get');
  await handleToolCall(adt, DEFAULT_CONFIG, 'SAPDiagnose', { action: 'dumps', filters: [filter] }, reader);
  expect(get.mock.calls[1]![0]).toBe('/sap/bc/adt/runtime/dumps?$top=50&$query=and(equals(runtimeError%2CTIME_OUT))');
  // The shared HTTP client then normalizes both legacy and typed query keys with URLSearchParams.
  expect(paths()[1]!.searchParams.get('$query')).toBe('and(equals(runtimeError,TIME_OUT))');
});
it.each(['EVAL*', 'EVAL USER'])('narrows the typed user grammar without changing legacy user %s', async (user) => {
  expect((await call({ action: 'dumps', user, filters: [filter] })).isError).toBe(true);
  expect(paths().every((u) => u.pathname === '/sap/bc/adt/feeds')).toBe(true);
  mockFetch.mockClear();
  expect((await call({ action: 'dumps', user })).isError).toBeUndefined();
  expect(paths()).toHaveLength(1);
  expect(paths()[0]!.pathname).toBe('/sap/bc/adt/runtime/dumps');
});
it('denying explicit discovery does not deny internal validation for an allowed dump read', async () => {
  const config = { ...DEFAULT_CONFIG, denyActions: ['SAPDiagnose.feed_schema'] };
  expect((await call({ action: 'feed_schema' }, config)).isError).toBe(true);
  expect(paths()).toHaveLength(0);
  expect((await call({ action: 'dumps', filters: [filter] }, config)).isError).toBeUndefined();
  expect(paths()).toHaveLength(2);
});
it('passes typed filters through the hyperfocused diagnose wrapper', async () => {
  const result = await handleToolCall(
    client(),
    DEFAULT_CONFIG,
    'SAP',
    { action: 'diagnose', params: { action: 'dumps', filters: [filter] } },
    reader,
  );
  expect(result.isError).toBeUndefined();
  expect(paths()).toHaveLength(2);
  expect(paths()[1]!.searchParams.get('$query')).toBe('and(equals(runtimeError,TIME_OUT))');
});
it('cancels between pages without a further request', async () => {
  const controller = new AbortController();
  mockFetch.mockImplementation(async (url) => {
    if (String(url).includes('/feeds')) return mockResponse(200, schema);
    controller.abort();
    return mockResponse(200, feed(rows.slice(0, 100)));
  });
  await requestContext.run({ requestId: 'filter-mid-page', signal: controller.signal }, async () => {
    expect((await call({ action: 'dumps', filters: [filter], maxResults: 150 })).isError).toBe(true);
  });
  expect(paths()).toHaveLength(2);
});
it.each(['feed_schema', 'dumps'])('ignores all harmless cross-action defaults for %s', async (action) => {
  const result = await call({
    action,
    ...(action === 'dumps' ? { filters: [filter] } : {}),
    includeSubpackages: false,
    includeReportXml: false,
    packages: [],
    packageTrees: [],
    objects: [],
    sections: [],
  });
  expect(result.isError).toBeUndefined();
});

import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { getToolDefinitions } = await import('../../../src/handlers/tools.js');
const { multiTargetToolDefinitions } = await import('../../../src/server/multi-target-tools.js');
const reader = { token: 'test', clientId: 'reader', scopes: ['read'] };
const objects = [
  { type: 'CLAS', name: 'ZCL_DEMO' },
  { type: 'PROG', name: 'ZDEMO' },
];
const args = { action: 'syntax', objects };
const client = () => new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });
const call = (input: Record<string, unknown> = args, config = DEFAULT_CONFIG, auth = reader) =>
  handleToolCall(client(), config, 'SAPDiagnose', input, auth);
const payload = (result: Awaited<ReturnType<typeof call>>) => JSON.parse(result.content[0]!.text!);
const posts = () => mockFetch.mock.calls.filter(([, opts]) => opts?.method === 'POST');
const reports = (body: string) =>
  `<checkRunReports>${[...body.matchAll(/adtcore:uri="([^"]+)"/g)]
    .reverse()
    .map(([, uri]) => `<checkReport reporter="abapCheckRun" triggeringUri="${uri}" status="processed"/>`)
    .join('')}</checkRunReports>`;
beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (_url, opts) =>
    mockResponse(200, opts?.method === 'POST' ? reports(String(opts.body)) : '', { 'x-csrf-token': 't' }),
  );
});
it.each(['active', 'inactive'])('checks an explicit %s list in one bounded native POST', async (version) => {
  const result = await call({ ...args, version });
  expect(result.isError).toBeUndefined();
  expect(payload(result)).toMatchObject({ status: 'passed', requestedVersion: version, checkedObjectCount: 2 });
  expect(payload(result).results.map((o: { name: string }) => o.name)).toEqual(['ZCL_DEMO', 'ZDEMO']);
  expect(posts()).toHaveLength(1);
  expect(String(posts()[0]![0])).toContain('/sap/bc/adt/checkruns');
  expect(posts()[0]![1]!.body).toContain(`chkrun:version="${version}"`);
  expect(posts()[0]![1]!.body).not.toContain('<chkrun:artifacts>');
});
it('normalizes ASCII names and slash aliases without accepting supplied URLs', async () => {
  const result = await call({ action: 'syntax', objects: [{ type: 'clas/oc', name: ' /arc/zcl_demo ' }] });
  expect(payload(result).results[0]).toMatchObject({ type: 'CLAS', name: '/ARC/ZCL_DEMO', status: 'passed' });
  expect(posts()[0]![1]!.body).toContain('%2FARC%2FZCL_DEMO');
});
it.each([
  { objects: [] },
  { objects: Array(21).fill(objects[0]) },
  { objects: [objects[0], objects[0]] },
  { objects: [{ type: 'CLAS', name: 'zcl_demo' }, objects[0]] },
  { objects: [{ type: 'FUGR', name: 'ZGROUP' }] },
  { objects: [{ type: 'CLAS', name: 'ZCL_ß' }] },
  { objects: [{ type: 'CLAS', name: 'ZCL_ﬁle' }] },
  { objects: [{ type: 'CLAS', name: '../Z' }] },
  { objects: [{ type: 'CLAS', name: 'Z', uri: '/sap/bc/adt/elsewhere' }] },
  { name: 'Z' },
  { objectType: 'CLAS' },
  { source: 'REPORT z.' },
  { version: 'auto' },
  { include: 'main' },
  { objects: [{ type: 'CLAS', name: 'Z'.repeat(41) }] },
  { type: 'CLAS', name: 'Z' },
])('rejects invalid/ambiguous input before SAP I/O: %j', async (extra) => {
  expect((await call({ ...args, ...extra })).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it('checks twenty objects and preserves harmless cross-action placeholders', async () => {
  const result = await call({
    ...args,
    objects: Array.from({ length: 20 }, (_, i) => ({ type: 'CLAS', name: `ZCL_${i}` })),
    maxResults: 0,
    coverage: false,
  });
  expect(payload(result).checkedObjectCount).toBe(20);
  expect(posts()).toHaveLength(1);
});
it.each(['SAPDiagnose', 'SAPDiagnose.syntax', 'SAPDiagnose.synt*', 'SAPDiagnose.*'])(
  'honors the existing syntax denial %s',
  async (denial) => {
    expect((await call(args, { ...DEFAULT_CONFIG, denyActions: [denial] })).isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  },
);
it('requires read scope', async () => {
  expect((await call(args, DEFAULT_CONFIG, { ...reader, scopes: [] })).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it('keeps missing reports visible and does not silently retry them', async () => {
  mockFetch.mockImplementation(async (_url, opts) =>
    mockResponse(200, opts?.method === 'POST' ? '<checkRunReports/>' : '', { 'x-csrf-token': 't' }),
  );
  const result = await call();
  expect(result.isError).toBeUndefined();
  expect(payload(result)).toMatchObject({ status: 'incomplete', checkedObjectCount: 0 });
  expect(payload(result).results).toHaveLength(2);
  expect(posts()).toHaveLength(1);
});
it.each([false, true])('bounds response bytes with syntax-specific advice (minimal=%s)', async (minimalErrors) => {
  mockFetch.mockImplementation(async (_url, opts) =>
    mockResponse(200, opts?.method === 'POST' ? `<checkRunReports>${' '.repeat(512 * 1024)}</checkRunReports>` : '', {
      'x-csrf-token': 't',
    }),
  );
  const result = await call(args, { ...DEFAULT_CONFIG, minimalErrors });
  expect(result.isError).toBe(true);
  expect(payload(result).message).toContain('fewer objects');
  expect(payload(result).message).not.toContain('WHERE');
});
it('cancels before any SAP request', async () => {
  await requestContext.run({ requestId: 'batch-cancel', signal: AbortSignal.abort() }, async () =>
    expect((await call()).isError).toBe(true),
  );
  expect(mockFetch).not.toHaveBeenCalled();
});
it('shares the deadline with the CSRF fetch', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mockFetch.mockImplementation(async () => {
    now = 32000;
    return mockResponse(200, '', { 'x-csrf-token': 't' });
  });
  expect((await call()).isError).toBe(true);
  expect(posts()).toHaveLength(0);
});
it('keeps BTP programs excluded and exposes the read-only batch on multi-target routes', async () => {
  const config = { ...DEFAULT_CONFIG, systemType: 'btp' as const };
  expect((await call(args, config)).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
  const defs = getToolDefinitions(config);
  for (const catalog of [defs, multiTargetToolDefinitions(defs, config)]) {
    const props = catalog.find((t) => t.name === 'SAPDiagnose')!.inputSchema.properties as Record<string, any>;
    expect(props.objects.items.properties.type.enum).not.toContain('PROG');
  }
});
it('supports the hyperfocused read wrapper', async () => {
  const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAP', { action: 'diagnose', params: args }, reader);
  expect(payload(result).status).toBe('passed');
  expect(posts()).toHaveLength(1);
});
it('keeps SAPRead single-object syntax unchanged', async () => {
  const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPRead', { type: 'SYNTAX', objects }, reader);
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});

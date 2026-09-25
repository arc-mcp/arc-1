import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { getToolDefinitions } = await import('../../../src/handlers/tools.js');
const { filterToolsByAuthScope } = await import('../../../src/server/tool-auth.js');
const { logger } = await import('../../../src/server/logger.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { validateDenyActions } = await import('../../../src/server/deny-actions.js');
const fixture = readFileSync(new URL('../../fixtures/xml/syntax-check-nw750.xml', import.meta.url), 'utf8');
const args = { type: 'SYNTAX', objectType: 'PROG', name: 'ZTEST' };
const reader = { token: 'test', clientId: 'reader', scopes: ['read'] };
const client = () => new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });

beforeEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (_url, options) => {
    expect(['HEAD', 'POST']).toContain(options?.method);
    if (options?.method === 'POST') expect(String(_url)).toContain('/sap/bc/adt/checkruns');
    return mockResponse(200, options?.method === 'POST' ? fixture : '', { 'x-csrf-token': 't' });
  });
});

describe('read-only syntax entry point', () => {
  it.each([
    { label: 'stored active', options: {} },
    { label: 'stored draft', options: { version: 'inactive' } },
    { label: 'unsaved text', options: { source: "REPORT ztest. WRITE 'unsaved'." } },
    { label: 'empty source treated as omitted', options: { source: '' } },
  ])('preserves the legacy request and result for $label without write scope', async ({ options }) => {
    const audit = vi.spyOn(logger, 'emitAudit');
    const current = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPRead', { ...args, ...options }, reader);
    const sent = mockFetch.mock.calls.filter(([, o]) => o?.method === 'POST');
    expect(sent).toHaveLength(1);
    expect(current.isError).toBeUndefined();
    expect(JSON.parse(current.content[0].text)).toMatchObject({ checked: true, hasErrors: true });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'tool_call_end', tool: 'SAPRead' }));
    mockFetch.mockClear();
    const legacy = await handleToolCall(
      client(),
      DEFAULT_CONFIG,
      'SAPDiagnose',
      {
        action: 'syntax',
        type: 'PROG',
        name: args.name,
        ...options,
      },
      reader,
    );
    expect(current).toEqual(legacy);
    const legacySent = mockFetch.mock.calls.filter(([, o]) => o?.method === 'POST');
    expect(legacySent[0][0]).toEqual(sent[0][0]);
    expect(legacySent[0][1]?.body).toEqual(sent[0][1]?.body);
    expect(sent[0][1]?.body).toContain(`chkrun:version="${options.version ?? 'active'}"`);
    if (options.source?.trim()) {
      expect(sent[0][1]?.body).toContain('<chkrun:artifacts>');
      expect(sent[0][1]?.body).toContain(Buffer.from(options.source).toString('base64'));
    } else {
      expect(sent[0][1]?.body).not.toContain('<chkrun:artifacts>');
      expect(String(sent[0][0])).not.toContain('reporters=');
    }
  });

  it.each(['SAPDiagnose', 'SAPDiagnose.syntax', 'SAPDiagnose.synt*', 'SAPRead.SYNTAX'])(
    'honors %s in both dispatch and listing',
    async (denial) => {
      validateDenyActions([denial]);
      const config = { ...DEFAULT_CONFIG, denyActions: [denial] };
      const result = await handleToolCall(
        client(),
        config,
        'SAPRead',
        { ...args, type: 'syntax', objectType: 'prog/p' },
        reader,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('denied by server policy');
      expect(mockFetch).not.toHaveBeenCalled();
      const tools = filterToolsByAuthScope(getToolDefinitions(config), ['read'], config.denyActions);
      const schema = tools.find((t) => t.name === 'SAPRead')?.inputSchema as {
        properties: { type: { enum: string[] } };
      };
      expect(schema.properties.type.enum).not.toContain('SYNTAX');
      expect(schema.properties.type.enum).toContain('CLAS');
    },
  );

  it('requires read scope before contacting SAP', async () => {
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPRead', args, { ...reader, scopes: [] });
    expect(result.content[0].text).toContain('Insufficient scope');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    { name: undefined },
    { objectType: undefined },
    { version: 'auto' },
    { action: 'diff' },
    { action: 'trace_start' },
    { include: 'testclasses' },
    { format: 'structured' },
    { type: 'PROG', source: 'REPORT ztest.' },
    { objectType: 'NO_SUCH_TYPE' },
  ])('refuses ambiguous/unsupported input before SAP: %j', async (invalid) => {
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPRead', { ...args, ...invalid }, reader);
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps not-processed evidence fail-closed', async () => {
    mockFetch.mockResolvedValue(
      mockResponse(
        200,
        '<checkRunReports><checkReport status="notProcessed" statusText="Object missing"/></checkRunReports>',
        { 'x-csrf-token': 't' },
      ),
    );
    const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPRead', args, reader);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ checked: false, hasErrors: true });
    expect(result.content[0].text).toContain('Not checked');
  });

  it.each(['onprem', 'btp'] as const)(
    'advertises the alias as read-only in %s, retaining mixed diagnose hints',
    (systemType) => {
      const tools = getToolDefinitions({ ...DEFAULT_CONFIG, systemType, allowWrites: true });
      const read = tools.find((t) => t.name === 'SAPRead');
      expect(read?.annotations?.readOnlyHint).toBe(true);
      expect(JSON.stringify(read?.inputSchema)).toContain('SYNTAX');
      expect(tools.find((t) => t.name === 'SAPDiagnose')?.annotations?.readOnlyHint).toBe(false);
    },
  );
});

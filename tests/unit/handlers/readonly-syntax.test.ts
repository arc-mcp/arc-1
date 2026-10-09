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
    expect(['GET', 'HEAD', 'POST']).toContain(options?.method);
    if (options?.method === 'POST') expect(String(_url)).toContain('/sap/bc/adt/checkruns');
    // Unsaved-source checks first confirm the object exists via its metadata root.
    if (options?.method === 'GET') expect(String(_url)).not.toContain('/checkruns');
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

  it.each(['SAPDiagnose', 'SAPDiagnose.syntax', 'SAPDiagnose.synt*', 'SAPRead.SYNTAX', 'SAP.diagnose'])(
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

  it.each(['CLAS', 'clas/oc'])('checks the class URI for objectType=%s', async (objectType) => {
    const result = await handleToolCall(
      client(),
      DEFAULT_CONFIG,
      'SAPRead',
      { ...args, objectType, name: 'ZCL_X' },
      reader,
    );
    expect(result.isError).toBeUndefined();
    const sends = mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(sends).toHaveLength(1);
    expect(sends[0]![1]?.body).toContain('adtcore:uri="/sap/bc/adt/oo/classes/ZCL_X"');
  });

  it.each(['read', 'diagnose'])('preserves SAP.diagnose denial through hyperfocused %s', async (action) => {
    const result = await handleToolCall(
      client(),
      { ...DEFAULT_CONFIG, denyActions: ['SAP.diagnose'] },
      'SAP',
      {
        action,
        type: action === 'read' ? 'SYNTAX' : 'PROG',
        name: 'ZTEST',
        params: action === 'read' ? { objectType: 'PROG' } : { action: 'syntax' },
      },
      reader,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('denied by server policy');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('accepts harmless strict-client defaults without changing the syntax request', async () => {
    const baseline = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPRead', args, reader);
    const before = mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST')[0]![1]?.body;
    mockFetch.mockClear();
    const result = await handleToolCall(
      client(),
      DEFAULT_CONFIG,
      'SAPRead',
      {
        ...args,
        force_refresh: false,
        expand_includes: false,
        includeSignature: false,
        format: 'text',
        maxResults: 0,
        columns: [],
        where: [],
      },
      reader,
    );
    expect(result).toEqual(baseline);
    expect(mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST')[0]![1]?.body).toEqual(before);
  });

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
    { force_refresh: true },
    { columns: ['NAME'] },
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

  describe('unsaved source for an object that may not exist', () => {
    // SAP checks unsaved text for an absent PROG as a standalone include with fixed-point arithmetic
    // off and reports it as processed (live on SAP_BASIS 750 and 758) — so ARC-1 must ask first.
    const unsaved = { ...args, source: 'REPORT ztest.\nSELECT SINGLE land1 FROM t005 INTO @DATA(lv_land).' };
    const answerMetadata = (status: number) =>
      mockFetch.mockImplementation(async (_url, options) =>
        options?.method === 'GET'
          ? mockResponse(status, '', {})
          : mockResponse(200, options?.method === 'POST' ? fixture : '', { 'x-csrf-token': 't' }),
      );
    const posts = () => mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST');
    const gets = () => mockFetch.mock.calls.filter(([, options]) => options?.method === 'GET');

    it.each(['SAPRead', 'SAPDiagnose'])(
      'reports not checked without sending the text when %s finds no object',
      async (tool) => {
        answerMetadata(404);
        const toolArgs =
          tool === 'SAPRead' ? unsaved : { action: 'syntax', type: 'PROG', name: 'ZTEST', source: unsaved.source };
        const result = await handleToolCall(client(), DEFAULT_CONFIG, tool, toolArgs, reader);
        const body = JSON.parse(result.content[0].text);
        expect(body).toMatchObject({
          checked: false,
          hasErrors: true,
          statusText: 'PROG ZTEST was not found at /sap/bc/adt/programs/programs/ZTEST',
        });
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0].text).toContain('Not checked');
        expect(String(gets()[0]?.[0])).toContain('/sap/bc/adt/programs/programs/ZTEST');
        expect(posts()).toHaveLength(0);
      },
    );

    it.each([403, 500])('leaves the verdict to SAP when the existence probe fails with %i', async (status) => {
      answerMetadata(status);
      const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPRead', unsaved, reader);
      expect(JSON.parse(result.content[0].text)).toMatchObject({ checked: true, hasErrors: true });
      expect(posts()).toHaveLength(1);
    });

    it('sends the text once the object root answers', async () => {
      const result = await handleToolCall(client(), DEFAULT_CONFIG, 'SAPRead', unsaved, reader);
      expect(JSON.parse(result.content[0].text)).toMatchObject({ checked: true });
      expect(gets()).toHaveLength(1);
      expect(posts()).toHaveLength(1);
    });

    it.each([{}, { version: 'inactive' }])('does not probe stored-version checks %j', async (options) => {
      await handleToolCall(client(), DEFAULT_CONFIG, 'SAPRead', { ...args, ...options }, reader);
      expect(gets()).toHaveLength(0);
      expect(posts()).toHaveLength(1);
    });
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

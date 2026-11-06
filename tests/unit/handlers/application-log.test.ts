import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { APPLICATION_LOG_PROPERTY, ApplicationLogInputSchema } from '../../../src/handlers/application-log-input.js';
import { SAPQuerySchema, SAPQuerySchemaBtp } from '../../../src/handlers/query-input.js';
import { createQueryDefinition, pruneQueryDefinition } from '../../../src/handlers/query-tool.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

vi.mock('../../../src/adt/application-log.js', () => ({ readApplicationLog: vi.fn() }));
const { readApplicationLog } = await import('../../../src/adt/application-log.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { filterToolsByAuthScope } = await import('../../../src/server/server.js');

const config = { ...DEFAULT_CONFIG, systemType: 'onprem' as const, allowDataPreview: true, allowFreeSQL: false };
const logNumber = '00000000000000000001';
const args = { action: 'application_log', applicationLog: { logNumber } };
const auth = (scopes: string[]) => ({ token: 'test', clientId: 'test', scopes, expiresAt: 9_999_999_999 });
function client() {
  return new AdtClient({
    baseUrl: 'https://sap.invalid',
    client: '001',
    safety: { ...defaultSafetyConfig(), allowDataPreview: true },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
});

describe('application_log exact nested input', () => {
  it('aligns wire limits with runtime and preserves leading zeroes', () => {
    expect(ApplicationLogInputSchema.parse({ logNumber, maxRows: 100, offset: 5000 })).toEqual({
      logNumber,
      maxRows: 100,
      offset: 5000,
    });
    expect(APPLICATION_LOG_PROPERTY.properties.logNumber.pattern).toBe('^\\d{20}$');
    expect(APPLICATION_LOG_PROPERTY.properties.maxRows.maximum).toBe(100);
    expect(SAPQuerySchema.safeParse(args).success).toBe(true);
    expect(ApplicationLogInputSchema.parse({ logNumber, maxRows: null, offset: null })).toEqual({ logNumber });
    expect(ApplicationLogInputSchema.safeParse({ logNumber: null }).success).toBe(false);
    expect(SAPQuerySchemaBtp.safeParse(args).success).toBe(false);
  });
  it.each([
    { logNumber: 1 },
    { logNumber: '1' },
    { logNumber: `${logNumber}\n` },
    { logNumber: `${logNumber}'` },
    { logNumber, maxRows: 0 },
    { logNumber, maxRows: 101 },
    { logNumber, offset: -1 },
    { logNumber, offset: 5001 },
    { logNumber, offset: 0.5 },
    { logNumber, search: 'secret' },
  ])('rejects malformed or unbounded controls %j', (applicationLog) => {
    expect(SAPQuerySchema.safeParse({ action: 'application_log', applicationLog }).success).toBe(false);
  });
  it.each([
    { action: 'application_log' },
    { ...args, sql: 'SELECT * FROM balhdr' },
    { ...args, maxRows: 1 },
    { ...args, longText: { mode: 'discover', object: 'TEXT', namePrefix: 'Z' } },
    { sql: 'SELECT * FROM balhdr', applicationLog: { logNumber } },
  ])('rejects missing or mixed action args %j', (input) => {
    expect(SAPQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('application_log authorization and dispatch', () => {
  it('dispatches native results without SQL or writes, including hyperfocused calls', async () => {
    const sap = client();
    const sql = vi.spyOn(sap, 'runQueryBatch');
    const result = { logNumber, messages: [{ text: 'Native localized message' }] };
    vi.mocked(readApplicationLog).mockResolvedValue(result as Awaited<ReturnType<typeof readApplicationLog>>);
    for (const hyperfocused of [false, true]) {
      const output = await handleToolCall(
        sap,
        { ...config, toolMode: hyperfocused ? 'hyperfocused' : 'standard' },
        hyperfocused ? 'SAP' : 'SAPQuery',
        hyperfocused ? { action: 'query', params: args } : args,
        auth(['data']),
      );
      expect(output.isError).not.toBe(true);
      expect(JSON.parse(output.content[0]!.text)).toEqual(result);
    }
    expect(readApplicationLog).toHaveBeenCalledTimes(2);
    expect(sql).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    { ...config, allowDataPreview: false },
    { ...config, denyActions: ['SAPQuery.application_log'] },
    { ...config, systemType: 'btp' as const },
  ])('rejects disabled, denied or unsupported calls before native access', async (settings) => {
    const sap = client();
    sap.safety.allowDataPreview = settings.allowDataPreview;
    const output = await handleToolCall(sap, settings, 'SAPQuery', args, auth(['admin']));
    expect(output.isError).toBe(true);
    expect(readApplicationLog).not.toHaveBeenCalled();
  });
  it('requires data scope and rejects malformed input before native access', async () => {
    for (const [input, scopes] of [
      [args, ['read']],
      [{ ...args, sql: 'SELECT * FROM balhdr' }, ['admin']],
    ] as const) {
      expect((await handleToolCall(client(), config, 'SAPQuery', input, auth([...scopes]))).isError).toBe(true);
    }
    expect(readApplicationLog).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('rejects detected BTP and preserves native errors without fallbacks', async () => {
    setCachedFeatures({ systemType: 'btp' });
    expect((await handleToolCall(client(), config, 'SAPQuery', args)).isError).toBe(true);
    expect(readApplicationLog).not.toHaveBeenCalled();
    resetCachedFeatures();
    vi.mocked(readApplicationLog).mockRejectedValue(new AdtApiError('Native authorization denied', 403, 'Forbidden'));
    const output = await handleToolCall(client(), config, 'SAPQuery', args);
    expect(output.isError).toBe(true);
    expect(output.content[0]!.text).toContain('Native authorization denied');
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'gives service setup guidance for a missing Gateway service (cookies: %s)',
    async (cookies) => {
      // Live 7.50/8.16 return HTTP 403 for missing service registration, not just authorization failures.
      const body = JSON.stringify({
        error: {
          code: '/IWFND/MED/170',
          message: { lang: 'en', value: 'No service found for APL_LOG_MANAGEMENT_SRV' },
        },
      });
      const sap = client();
      const sql = vi.spyOn(sap, 'runQueryBatch');
      vi.mocked(readApplicationLog).mockRejectedValue(
        new AdtApiError(body, 403, '/sap/opu/odata/sap/APL_LOG_MANAGEMENT_SRV/ApplicationLogOverviewSet', body),
      );
      const output = await handleToolCall(
        sap,
        { ...config, ...(cookies ? { cookieString: 'test-session' } : {}) },
        'SAPQuery',
        args,
        auth(['data']),
      );
      expect(output.isError).toBe(true);
      expect(output.content[0]!.text).toContain('No service found');
      expect(output.content[0]!.text).toContain('/IWFND/MAINT_SERVICE');
      expect(output.content[0]!.text).not.toMatch(
        /not_found_or_not_visible|authorization error|lack.*permissions|cookies have expired|SAP_PASSWORD/i,
      );
      expect(sql).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );
  it('prunes visibility and requirements without leaving SQL access', () => {
    const definition = createQueryDefinition({ ...config, allowFreeSQL: true })!;
    const dataOnly = filterToolsByAuthScope([definition], ['data'])[0]!;
    const properties = dataOnly.inputSchema.properties as Record<string, unknown>;
    expect(properties.applicationLog).toEqual(APPLICATION_LOG_PROPERTY);
    expect(properties.sql).toBeUndefined();
    const onlyLog = pruneQueryDefinition(definition, ['application_log']);
    expect(onlyLog.inputSchema.required).toEqual(['action', 'applicationLog']);
    expect((onlyLog.inputSchema.properties as Record<string, unknown>).longText).toBeUndefined();
    expect(createQueryDefinition({ ...config, systemType: 'btp' })).toBeUndefined();
    expect(createQueryDefinition({ ...config, allowDataPreview: false })).toBeUndefined();
    expect(filterToolsByAuthScope([definition], ['read'])).toEqual([]);
  });
  it('omits the action and its fields under any configured table blocklist', () => {
    const definition = createQueryDefinition({ ...config, blockedDataSources: ['UNRELATED_TABLE'] })!;
    expect(JSON.stringify(definition)).not.toMatch(/application_log|applicationLog|SLG1/);
    expect(definition.inputSchema.required).toEqual(['action', 'longText']);
    const sqlEnabled = createQueryDefinition({ ...config, allowFreeSQL: true, blockedDataSources: ['BALHDR'] })!;
    expect(JSON.stringify(sqlEnabled)).not.toMatch(/application_log|applicationLog|SLG1/);
    expect(sqlEnabled.inputSchema.required).toEqual([]);
  });
});

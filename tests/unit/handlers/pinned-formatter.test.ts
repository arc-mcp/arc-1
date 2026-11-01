import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handleSAPLint } = await import('../../../src/handlers/lint.js');
const { unrestrictedSafetyConfig } = await import('../../../src/adt/safety.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { FORMATTER_SETTINGS_PATH, FORMATTER_SETTINGS_CONTENT_TYPE } = await import(
  '../../../src/adt/pinned-formatter.js'
);

const original =
  '<p:PrettyPrinterSettings xmlns:p="http://www.sap.com/adt/prettyprintersettings" p:indentation="true" p:style="keywordUpper" extra="keep"/>';
function fixture() {
  const policy = {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  };
  const config = {
    ...DEFAULT_CONFIG,
    targetId: policy.target,
    allowWrites: true,
    ppEnabled: true,
    ppStrict: true,
    multiTargetWrite: policy,
  };
  const client = new AdtClient({
    baseUrl: 'https://sap.example',
    username: 'unverified@example.com',
    safety: { ...unrestrictedSafetyConfig(), allowTransportWrites: false, multiTargetWrite: policy },
  });
  let body = original;
  const calls: Array<{ method: string; path: string; body?: string }> = [];
  mockFetch.mockImplementation(async (url: string | URL, init?: { method?: string; body?: string }) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body });
    if (path === '/sap/bc/adt/core/discovery' && method === 'HEAD')
      return mockResponse(200, '', { 'x-csrf-token': 'test-token' });
    if (path === FORMATTER_SETTINGS_PATH && method === 'GET')
      return mockResponse(200, body, { 'content-type': FORMATTER_SETTINGS_CONTENT_TYPE });
    if (path === FORMATTER_SETTINGS_PATH && method === 'PUT') {
      body = String(init?.body);
      return mockResponse(204, '');
    }
    if (path === '/sap/bc/adt/abapsource/prettyprinter' && method === 'POST') return mockResponse(200, 'REPORT ztest.');
    throw new Error(`Unexpected native request ${method} ${path}`);
  });
  return { client, config, calls };
}

beforeEach(() => {
  mockFetch.mockReset();
  resetCachedFeatures();
});

describe('pinned formatter handler through shared dispatch', () => {
  it.each([false, 'false', 0, 'off'])(
    'normalizes indentation=%j and returns a verified partial-patch outcome',
    async (indentation) => {
      const { client, config, calls } = fixture();
      const get = vi.spyOn(client.http, 'get');
      const put = vi.spyOn(client.http, 'put');
      const result = await handleToolCall(client, config, 'SAPLint', { action: 'set_formatter_settings', indentation });
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        ok: true,
        state: 'updated',
        target: 'A4H/001',
        action: 'set_formatter_settings',
        settings: { indentation: false, style: 'keywordUpper' },
        retryable: false,
      });
      expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
      expect(calls.find((call) => call.method === 'PUT')!.body).toContain('extra="keep"');
      const policy = put.mock.calls[0][4]!;
      expect(policy).toMatchObject({ noReplay: true, retryTransientErrors: false });
      expect(policy.deadline).toBeGreaterThan(Date.now());
      expect(policy.deadline).toBeLessThanOrEqual(Date.now() + 30000);
      for (const call of get.mock.calls) expect(call[2]?.deadline).toBe(policy.deadline);
    },
  );

  it('returns strict native settings and formatted text without saving repository source', async () => {
    const { client, config, calls } = fixture();
    const settings = await handleToolCall(client, config, 'SAPLint', { action: 'get_formatter_settings' });
    expect(settings.isError).toBeUndefined();
    expect(JSON.parse(settings.content[0].text)).toEqual({ indentation: true, style: 'keywordUpper' });
    const formatted = await handleToolCall(client, config, 'SAPLint', { action: 'format', source: 'report ztest.' });
    expect(formatted.isError).toBeUndefined();
    expect(formatted.content[0].text).toBe('REPORT ztest.');
    expect(calls.filter((call) => call.method === 'PUT' || call.method === 'DELETE')).toHaveLength(0);
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      '/sap/bc/adt/abapsource/prettyprinter',
    ]);
  });

  it.each(['scope', 'deny-action'] as const)('refuses a formatter mutation before SAP for %s', async (reason) => {
    const { client, config, calls } = fixture();
    if (reason === 'deny-action') config.denyActions = ['SAPLint.set_formatter_settings'];
    const result = await handleToolCall(
      client,
      config,
      'SAPLint',
      { action: 'set_formatter_settings', style: 'none' },
      { token: 'test', clientId: 'test', scopes: reason === 'scope' ? ['read'] : ['read', 'write'] },
    );
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it.each(['read-only', 'wrong-target', 'missing-target', 'non-strict'] as const)(
    'does not fall back to the legacy handler for %s context',
    async (reason) => {
      const { client, config, calls } = fixture();
      if (reason === 'read-only') client.safety.allowWrites = false;
      if (reason === 'wrong-target') config.targetId = 'OTHER/001';
      if (reason === 'missing-target') config.targetId = '';
      if (reason === 'non-strict') config.ppStrict = false;
      for (const args of [
        { action: 'set_formatter_settings', style: 'none' },
        { action: 'get_formatter_settings' },
        { action: 'format', source: 'report ztest.' },
      ]) {
        await expect(handleSAPLint(client, args, config)).rejects.toThrow('unavailable');
      }
      expect(calls).toHaveLength(0);
    },
  );

  it('reports a failed read-back as an incomplete mutation, not a successful guessed preference', async () => {
    const { client, config } = fixture();
    vi.spyOn(client.http, 'get').mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': FORMATTER_SETTINGS_CONTENT_TYPE },
      body: original,
    });
    const result = await handleToolCall(client, config, 'SAPLint', { action: 'set_formatter_settings', style: 'none' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'PINNED_WRITE_INCOMPLETE',
      state: 'update-unconfirmed',
      retryable: false,
    });
  });
});

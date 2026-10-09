import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAPWriteSchemaBtp } from '../../../src/handlers/schemas.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const config = { ...DEFAULT_CONFIG, systemType: 'btp' as const };
const input = { action: 'edit_text_symbols', type: 'CLAS', name: 'ZCL_TEXT', source: '' };
const lock = '<asx:values><LOCK_HANDLE>LH</LOCK_HANDLE></asx:values>';
const mutations = () =>
  mockFetch.mock.calls.filter(([, init]) => ['POST', 'PUT', 'DELETE'].includes(init?.method ?? 'GET'));
describe('Cloud class text symbols', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(mockResponse(200, url.includes('_action=LOCK') ? lock : '', { 'x-csrf-token': 'T' })),
    );
  });
  it.each([undefined, 'symbols'])(
    'exposes and dispatches the class pool with part=%s, including clear',
    async (textPart) => {
      expect(SAPWriteSchemaBtp.parse({ ...input, textPart })).toMatchObject(input);
      const result = await handleToolCall(createClient(), config, 'SAPWrite', { ...input, textPart });
      expect(result.isError, JSON.stringify(result)).toBeUndefined();
      const writes = mutations();
      expect(writes).toHaveLength(4);
      expect(writes[1]?.[1]?.body).toBe('');
      expect(writes[1]?.[0]).toContain('/textelements/classes/ZCL_TEXT/source/symbols');
      expect(writes[2]?.[0]).toContain('_action=UNLOCK');
      expect(writes[3]?.[1]?.body).toContain('/textelements/classes/ZCL_TEXT');
      expect(String(writes[3]?.[1]?.body).match(/<adtcore:objectReference /g)).toHaveLength(1);
    },
  );
  it.each([
    { type: 'PROG' },
    { type: 'FUGR' },
    { type: 'INTF' },
    { type: undefined },
    { textPart: 'selections' },
    { textPart: 'headings' },
  ])('refuses unsupported input %j before HTTP', async (patch) => {
    const result = await handleToolCall(createClient(), config, 'SAPWrite', { ...input, ...patch });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['write ceiling', 'deny action', 'package', 'discovery'] as const)('preserves the %s gate', async (gate) => {
    const client = createClient();
    const cfg = { ...config };
    if (gate === 'write ceiling') client.safety.allowWrites = false;
    if (gate === 'deny action') cfg.denyActions = ['SAPWrite.edit_text_symbols'];
    if (gate === 'package') {
      client.safety.allowedPackages = ['ZALLOWED'];
      mockFetch.mockResolvedValue(mockResponse(200, '<object><packageRef name="ZOTHER"/></object>'));
    }
    if (gate === 'discovery') client.http.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/xml']]]));
    const result = await handleToolCall(client, cfg, 'SAPWrite', input);
    expect(result.isError).toBe(true);
    expect(mutations()).toHaveLength(0);
  });
  it('retains the saved-but-unconfirmed hint after failed pool activation', async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        mockResponse(
          200,
          url.includes('/activation')
            ? '<messages><msg type="E"><shortText><txt>Activation refused</txt></shortText></msg></messages>'
            : url.includes('_action=LOCK')
              ? lock
              : '',
          { 'x-csrf-token': 'T' },
        ),
      ),
    );
    const result = await handleToolCall(createClient(), config, 'SAPWrite', {
      ...input,
      source: '@MaxLength:20\n001=Test',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Text elements were saved, but activation was not confirmed.');
    expect(mutations().some(([url]) => url.includes('_action=UNLOCK'))).toBe(true);
  });
  it('requires write scope even when the server allows writes', async () => {
    const result = await handleToolCall(createClient(), config, 'SAPWrite', input, {
      token: 'test',
      clientId: 'reader',
      scopes: ['read'],
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

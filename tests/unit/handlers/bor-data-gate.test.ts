import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

it('refuses BOR method lookup without SQL permission before any SAP request', async () => {
  const client = new AdtClient({ baseUrl: 'https://sap.example', safety: defaultSafetyConfig() });
  const result = await handleToolCall(
    client,
    DEFAULT_CONFIG,
    'SAPRead',
    { type: 'SOBJ', name: 'BUS2032' },
    { token: 'test', clientId: 'reader', scopes: ['read'] },
  );
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain('allowFreeSQL=false');
  expect(mockFetch).not.toHaveBeenCalled();
});

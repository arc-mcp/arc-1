import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { parseDiscoveryDocument } = await import('../../../src/adt/xml-parser.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

it('allows DOMA create with a listed empty-accept collection from a display-only startup user', async () => {
  const discoveryMap = parseDiscoveryDocument(
    readFileSync(new URL('../../fixtures/xml/discovery-display-only.xml', import.meta.url), 'utf8'),
  );
  setCachedFeatures({ ...featuresOff(), abapRelease: '758', systemType: 'onprem', discoveryMap });
  try {
    const client = createClient();
    client.http.setDiscoveryMap(discoveryMap);
    mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'DOMA',
      name: 'ZD_950',
      package: '$TMP',
      dataType: 'CHAR',
      length: 1,
    });
    expect(result.isError).toBeUndefined();
    expect(
      mockFetch.mock.calls.some(
        ([url, options]) => options?.method === 'POST' && new URL(String(url)).pathname === '/sap/bc/adt/ddic/domains',
      ),
    ).toBe(true);
  } finally {
    resetCachedFeatures();
  }
});

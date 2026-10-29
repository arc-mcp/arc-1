/** Native SHLP contract on live on-prem SAP; read-only, no fixture creation. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { defaultSafetyConfig } from '../../src/adt/safety.js';
import { SEARCH_HELP_COLLECTION } from '../../src/adt/search-help.js';
import { parseDiscoveryDocument } from '../../src/adt/xml-parser.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient } from './helpers.js';

describe('Native partial SHLP integration', () => {
  let client: AdtClient;
  const config = { ...DEFAULT_CONFIG, systemType: 'onprem' as const };
  beforeAll(async () => {
    client = getTestClient().withSafety(defaultSafetyConfig());
    const discovery = await client.http.get('/sap/bc/adt/discovery', { Accept: 'application/atomsvc+xml' });
    client.http.setDiscoveryMap(parseDiscoveryDocument(discovery.body));
  });
  const invoke = (tool: string, name: string, args: Record<string, unknown> = {}) =>
    handleToolCall(client, config, tool, { type: 'SHLP/DH', name, ...args });
  const payload = (result: Awaited<ReturnType<typeof invoke>>) =>
    JSON.parse(result.content.map((item) => ('text' in item ? item.text : '')).join(''));

  describe.each(['SAPRead', 'SAPContext'])('%s', (tool) => {
    it.for(['SCUSTOM', 'SFLIGHT_COMPLEX'])('returns explicitly partial active metadata for %s', async (name, ctx) => {
      requireOrSkip(ctx, client.http.hasDiscoveryCollection(SEARCH_HELP_COLLECTION), SkipReason.BACKEND_UNSUPPORTED);
      const result = await invoke(tool, name);
      const metadata = payload(result);
      requireOrSkip(ctx, metadata.availability !== 'not_available', `${SkipReason.NO_FIXTURE}: ${name}`);
      expect(result.isError).toBeUndefined();
      expect(metadata).toMatchObject({
        availability: 'available',
        name,
        type: 'SHLP',
        nativeType: 'SHLP/DH',
        completeness: 'partial',
        sourceVersion: 'active',
        language: { effective: null },
      });
      expect(metadata.parameters.length).toBeGreaterThan(0);
      expect(metadata.missing).toContain('collectiveInclusions');
      expect(metadata.missing).toContain('searchHelpExit');
      expect(client.safety.allowWrites).toBe(false);
      expect(client.safety.allowDataPreview).toBe(false);
      expect(client.safety.allowFreeSQL).toBe(false);
    });
    it('treats an unconfirmed name as unavailable, never a successful empty definition', async (ctx) => {
      requireOrSkip(ctx, client.http.hasDiscoveryCollection(SEARCH_HELP_COLLECTION), SkipReason.BACKEND_UNSUPPORTED);
      const result = await invoke(tool, 'ZZ_ARC_SHLP_ABSENT_20261029');
      expect(result.isError).toBe(true);
      expect(payload(result)).toMatchObject({ availability: 'not_available', type: 'SHLP' });
    });
  });
  it('rejects unsupported inactive reads before any HTTP request', async () => {
    const get = vi.spyOn(client.http, 'get');
    try {
      expect((await invoke('SAPRead', 'SCUSTOM', { version: 'inactive' })).isError).toBe(true);
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
  });
});

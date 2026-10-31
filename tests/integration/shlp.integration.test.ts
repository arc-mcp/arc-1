/** Native SHLP contract on live on-prem SAP; read-only, no fixture creation. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { parseFmSignature } from '../../src/adt/fm-signature.js';
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
  it('qualifies active selection from the native SHLP provider and Dictionary read contract', async () => {
    const [{ source: provider }, { source: dictionary }, { source: common }] = await Promise.all([
      client.getClass('CL_DADT_SHLP_INFO_PROVIDER', undefined, { version: 'active' }),
      client.getFunction('SDIF', 'DDIF_SHLP_GET', { version: 'active' }),
      client.getInclude('LSDIFF00', { version: 'active' }),
    ]);
    const method = provider.match(/\bMETHOD\s+get_search_help_data\.[\s\S]*?\bENDMETHOD\./i)?.[0];
    expect(method).toBeDefined();
    const call = method?.match(/CALL FUNCTION 'DDIF_SHLP_GET'[\s\S]*?EXCEPTIONS/i)?.[0];
    expect(call).toBeDefined();
    expect(call).not.toMatch(/\bstate\s*=/i);
    expect(parseFmSignature(dictionary).params.find((p) => p.name === 'STATE')?.default).toBe("'A'");
    const stateMapping = common.match(/\bform get_readstate\b[\s\S]*?endform\./i)?.[0];
    expect(stateMapping).toMatch(/if state ca 'AM'\.\s*readstate = state\./i);
    expect(dictionary).toMatch(/get_state-SHHD = readstate/i);
    expect(dictionary).toMatch(/get_state-SHFD = readstate/i);
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

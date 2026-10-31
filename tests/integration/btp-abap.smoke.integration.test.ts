/**
 * BTP ABAP Smoke Integration Tests (BROWSER OAUTH)
 *
 * Read-only smoke tests using a service key from TEST_BTP_SERVICE_KEY (inline JSON)
 * or TEST_BTP_SERVICE_KEY_FILE. The first request requires browser OAuth login,
 * unless TEST_BTP_ACCESS_TOKEN supplies an already-acquired named-user token.
 *
 * These tests verify core BTP ABAP contracts:
 * - Connectivity and auth chain
 * - System info shape
 * - Released object read access
 * - Search functionality
 * - BTP-specific restricted ABAP behavior
 *
 * For extended local-only tests, see btp-abap.integration.test.ts.
 */

import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../src/adt/client.js';
import { defaultFeatureConfig } from '../../src/adt/config.js';
import { probeFeatures } from '../../src/adt/features.js';
import {
  type BTPServiceKey,
  createBearerTokenProvider,
  loadServiceKeyFile,
  parseServiceKey,
} from '../../src/adt/oauth.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedFeatures } from '../../src/handlers/feature-cache.js';
import { getToolDefinitions } from '../../src/handlers/tools.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { hasBtpCredentials } from './helpers.js';

// Load .env before anything else
config();

/** Create an ADT client from BTP service key (file or inline JSON) */
function getBtpSmokeClient(): AdtClient {
  let serviceKey: BTPServiceKey;

  const inlineKey = process.env.TEST_BTP_SERVICE_KEY;
  if (inlineKey) {
    serviceKey = parseServiceKey(inlineKey);
  } else {
    const keyFile = process.env.TEST_BTP_SERVICE_KEY_FILE || process.env.SAP_BTP_SERVICE_KEY_FILE || '';
    serviceKey = loadServiceKeyFile(keyFile);
  }

  const presetToken = process.env.TEST_BTP_ACCESS_TOKEN;
  const bearerTokenProvider = presetToken ? async () => presetToken : createBearerTokenProvider(serviceKey);

  return new AdtClient({
    baseUrl: serviceKey.url,
    client: serviceKey.abap?.sapClient || '100',
    language: 'EN',
    safety: unrestrictedSafetyConfig(),
    bearerTokenProvider,
  });
}

// Skip entire suite if no BTP credentials.
// In workflows that do not inject TEST_BTP_SERVICE_KEY* secrets, this skip is expected.
const describeIf = hasBtpCredentials() ? describe : describe.skip;

describeIf('BTP ABAP smoke', { timeout: 30_000 }, () => {
  let client: AdtClient;

  beforeAll(() => {
    client = getBtpSmokeClient();
  });

  afterAll(() => resetCachedFeatures());

  // ─── Connectivity ───────────────────────────────────────────────

  it('connects to BTP ABAP and gets CSRF token', async () => {
    // The client constructor should have established connectivity
    // A simple read verifies the full auth chain works
    const info = await client.getSystemInfo();
    expect(info).toBeTruthy();
  });

  // ─── System Info Shape ──────────────────────────────────────────

  it('returns system info with expected fields', async () => {
    const info = await client.getSystemInfo();
    const parsed = JSON.parse(info);
    expect(typeof parsed.user).toBe('string');
    expect(Array.isArray(parsed.collections)).toBe(true);
    expect(parsed.collections.length).toBeGreaterThan(0);
  });

  // ─── Released Object Read ──────────────────────────────────────

  it('reads a released SAP class', async () => {
    const { source } = await client.getClass('CL_ABAP_RANDOM');
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(0);
  });

  // ─── Released Object Search ─────────────────────────────────────

  it('searches for released objects', async () => {
    const results = await client.searchObject('CL_ABAP_*', 5);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('objectName');
  });

  // ─── BTP-Specific Behavior ─────────────────────────────────────

  it('classic programs are READABLE on BTP (read access; create is refused)', async () => {
    // Standard classic reports are fully readable via ADT on the ABAP Environment (live-verified —
    // RSHOWTIM returns its REPORT source). The earlier "not accessible" assertion was wrong: Clean
    // Core restricts *consuming/modifying* classic objects, not reading their source. The
    // write-is-refused half is covered by the full suite (btp-abap.integration.test.ts).
    const { source } = await client.getProgram('RSHOWTIM');
    expect(typeof source).toBe('string');
    expect(source).toMatch(/\bREPORT\b|\bMESSAGE\b/i);
  });

  it('keeps SHLP out of the BTP read/context tool schemas', () => {
    const tools = getToolDefinitions({ ...DEFAULT_CONFIG, systemType: 'btp' });
    for (const name of ['SAPRead', 'SAPContext']) {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema;
      expect(schema).toMatchObject({ properties: { type: { enum: expect.any(Array) } } });
      expect(schema).not.toMatchObject({ properties: { type: { enum: expect.arrayContaining(['SHLP']) } } });
    }
  });
  it.each(['btp', 'auto'] as const)(
    'refuses SHLP on the BTP client in %s mode before any metadata request',
    async (systemType) => {
      if (systemType === 'auto') {
        const features = await probeFeatures(client.http, defaultFeatureConfig(), 'auto');
        expect(features.systemType).toBe('btp');
        expect(features.systemTypeSource).toBe('probe');
        setCachedFeatures(features);
      }
      const get = vi.spyOn(client.http, 'get');
      try {
        for (const tool of ['SAPRead', 'SAPContext']) {
          const result = await handleToolCall(client, { ...DEFAULT_CONFIG, systemType }, tool, {
            type: 'SHLP/DH',
            name: 'SCUSTOM',
          });
          expect(result.isError).toBe(true);
        }
        expect(get).not.toHaveBeenCalled();
      } finally {
        get.mockRestore();
      }
    },
  );
});

/**
 * BTP ABAP Smoke Integration Tests (CI-CAPABLE)
 *
 * Deterministic, non-interactive tests that can run in CI with a service key
 * injected via TEST_BTP_SERVICE_KEY (inline JSON) or TEST_BTP_SERVICE_KEY_FILE.
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
import { beforeAll, describe, expect, it } from 'vitest';
import { AdtClient } from '../../src/adt/client.js';
import {
  type BTPServiceKey,
  createBearerTokenProvider,
  loadServiceKeyFile,
  parseServiceKey,
} from '../../src/adt/oauth.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';
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

  const bearerTokenProvider = createBearerTokenProvider(serviceKey);

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
});

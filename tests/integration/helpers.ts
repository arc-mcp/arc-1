/**
 * Integration test helpers for ARC-1.
 *
 * Integration tests run against a live SAP system.
 * Missing SAP credentials are treated as a test setup error (hard fail).
 *
 * Credentials (resolved in priority order):
 *   TEST_SAP_URL      > SAP_URL
 *   TEST_SAP_USER     > SAP_USER
 *   TEST_SAP_PASSWORD > SAP_PASSWORD
 *   TEST_SAP_CLIENT   > SAP_CLIENT   (default: 100)
 *   TEST_SAP_LANGUAGE > SAP_LANGUAGE  (default: EN)
 *   TEST_SAP_INSECURE > SAP_INSECURE (default: false)
 *
 * Using TEST_SAP_* lets a running MCP server and integration tests
 * point at different users/systems simultaneously.
 */

import { config } from 'dotenv';
import { AdtClient } from '../../src/adt/client.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';

// Load .env before anything else
config();

/** Check if SAP credentials are configured */
export function hasSapCredentials(): boolean {
  return !!(process.env.TEST_SAP_URL || process.env.SAP_URL);
}

/** Assert SAP credentials are configured; throw with actionable setup message if not. */
export function requireSapCredentials(): void {
  const url = process.env.TEST_SAP_URL || process.env.SAP_URL;
  const user = process.env.TEST_SAP_USER || process.env.SAP_USER;
  const password = process.env.TEST_SAP_PASSWORD || process.env.SAP_PASSWORD;

  if (!url || !user || !password) {
    throw new Error(
      [
        'Integration test setup error: SAP credentials are required.',
        'Set TEST_SAP_URL, TEST_SAP_USER, TEST_SAP_PASSWORD (or SAP_URL, SAP_USER, SAP_PASSWORD).',
      ].join(' '),
    );
  }
}

/** Check if BTP service key is configured (file path or inline JSON) */
export function hasBtpCredentials(): boolean {
  return !!(
    process.env.TEST_BTP_SERVICE_KEY_FILE ||
    process.env.TEST_BTP_SERVICE_KEY ||
    process.env.SAP_BTP_SERVICE_KEY_FILE
  );
}

/** Skip reason message */
export const SKIP_REASON = 'No SAP credentials configured (set TEST_SAP_URL or SAP_URL in .env)';

/**
 * Create an ADT client configured for integration tests.
 *
 * @param languageOverride - optional SAP language to use instead of the env
 *   default (e.g. 'DE' for the issue #343 master-language round-trip test).
 */
export function getTestClient(languageOverride?: string): AdtClient {
  requireSapCredentials();

  const url = process.env.TEST_SAP_URL || process.env.SAP_URL || '';
  const username = process.env.TEST_SAP_USER || process.env.SAP_USER || '';
  const password = process.env.TEST_SAP_PASSWORD || process.env.SAP_PASSWORD || '';
  const client = process.env.TEST_SAP_CLIENT || process.env.SAP_CLIENT || '100';
  const language = languageOverride || process.env.TEST_SAP_LANGUAGE || process.env.SAP_LANGUAGE || 'EN';
  const insecure = (process.env.TEST_SAP_INSECURE || process.env.SAP_INSECURE) === 'true';
  const disableSaml = (process.env.TEST_SAP_DISABLE_SAML || process.env.SAP_DISABLE_SAML) === 'true';

  return new AdtClient({
    baseUrl: url,
    username,
    password,
    client,
    language,
    insecure,
    disableSaml,
    safety: unrestrictedSafetyConfig(),
  });
}

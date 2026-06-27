/**
 * BTP ABAP tool-level dispatch integration tests (LOCAL-ONLY).
 *
 * Every other BTP test drives the AdtClient facade directly. These drive `handleToolCall` — the real
 * MCP entry point — against a LIVE BTP client, so the dispatch layer (scope policy via ACTION_POLICY +
 * the package allowlist) is exercised end-to-end on the ABAP Environment, not just on mocked on-prem
 * clients (cf. tests/unit/handlers/action-policy-integration.test.ts).
 *
 * Auth: a pre-acquired dev JWT via TEST_BTP_ACCESS_TOKEN runs this headless; otherwise the first call
 * triggers the interactive browser login (see btp-abap.integration.test.ts header). The scope- and
 * package-denial tests are decided BEFORE any SAP call, so they pass without a live token; only the
 * read test reaches SAP. Skipped entirely without BTP credentials.
 */
import { config } from 'dotenv';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdtClient } from '../../src/adt/client.js';
import { createBearerTokenProvider, loadServiceKeyFile } from '../../src/adt/oauth.js';
import { type SafetyConfig, unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { hasBtpCredentials } from './helpers.js';

// Load .env before anything else
config();

// safetyOverride lets a test pin the server *ceiling* baked into the client — the package allowlist is
// enforced via the client's SafetyConfig (what buildAdtConfig derives from SAP_ALLOWED_PACKAGES), not
// the per-call ServerConfig.
function getBtpTestClient(safetyOverride?: Partial<SafetyConfig>): AdtClient {
  const keyFile = process.env.TEST_BTP_SERVICE_KEY_FILE || process.env.SAP_BTP_SERVICE_KEY_FILE || '';
  const serviceKey = loadServiceKeyFile(keyFile);
  // A pre-acquired dev JWT (TEST_BTP_ACCESS_TOKEN) skips the interactive browser login.
  const presetToken = process.env.TEST_BTP_ACCESS_TOKEN;
  const bearerTokenProvider = presetToken ? async () => presetToken : createBearerTokenProvider(serviceKey);
  return new AdtClient({
    baseUrl: serviceKey.url,
    client: serviceKey.abap?.sapClient || '100',
    language: 'EN',
    safety: { ...unrestrictedSafetyConfig(), ...safetyOverride },
    bearerTokenProvider,
  });
}

const auth = (scopes: string[]) => ({
  token: 'test',
  clientId: 'test',
  scopes,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});

const describeIf = hasBtpCredentials() ? describe : describe.skip;

describeIf('BTP tool-level dispatch (handleToolCall)', { timeout: 60_000 }, () => {
  // Build the client in beforeAll, not in the describe body: Vitest still executes the describe
  // callback during collection even when the suite is describe.skip (no BTP creds), and constructing
  // the client there would call loadServiceKeyFile('') and fail collection instead of skipping.
  let client: AdtClient;
  beforeAll(() => {
    client = getBtpTestClient();
  });

  it('reads a released class through handleToolCall (dispatch + live BTP client)', async () => {
    const result = await handleToolCall(
      client,
      { ...DEFAULT_CONFIG, systemType: 'btp' },
      'SAPRead',
      { type: 'CLAS', name: 'CL_ABAP_RANDOM' },
      auth(['read']),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text ?? '').toMatch(/class|method|endclass/i);
  });

  it('enforces scope on BTP: SAPWrite.create is denied for a read-only token', async () => {
    // allowWrites:true so SAPWrite is reachable — the denial must be the WRITE scope check, decided
    // before any SAP call (no object is created).
    const result = await handleToolCall(
      client,
      { ...DEFAULT_CONFIG, systemType: 'btp', allowWrites: true },
      'SAPWrite',
      { action: 'create', type: 'CLAS', name: 'ZCL_ARC1_SCOPE_DENY', package: 'ZLOCAL', description: 'x' },
      auth(['read']),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? '').toMatch(/Insufficient scope: 'write'/);
  });

  it('enforces the package allowlist on BTP (fail-closed, before any write)', async () => {
    // The allowlist is the server ceiling, baked into the CLIENT's SafetyConfig (what buildAdtConfig
    // derives from SAP_ALLOWED_PACKAGES) — not the per-call config. Restrict the client to one package,
    // then create into a different one → checkPackage (src/handlers/write/create.ts) refuses before SAP.
    const restricted = getBtpTestClient({ allowedPackages: ['ZARC1_ALLOWED_ONLY'] });
    const result = await handleToolCall(
      restricted,
      { ...DEFAULT_CONFIG, systemType: 'btp', allowWrites: true },
      'SAPWrite',
      { action: 'create', type: 'CLAS', name: 'ZCL_ARC1_PKG_DENY', package: 'ZNOT_ALLOWED', description: 'x' },
      auth(['read', 'write']),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text ?? '').toMatch(/package 'ZNOT_ALLOWED'.*blocked by safety configuration/i);
  });
});

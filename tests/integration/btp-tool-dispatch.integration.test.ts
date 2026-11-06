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
 * package-denial tests are decided BEFORE any SAP call, so they pass without a live token; the read and
 * ENHO tests reach SAP. Skipped entirely without BTP credentials.
 */
import { config } from 'dotenv';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdtClient } from '../../src/adt/client.js';
import { createBearerTokenProvider, loadServiceKeyFile } from '../../src/adt/oauth.js';
import { type SafetyConfig, unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { generateUniqueName } from './crud-harness.js';
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

  // BAdI implementation (ENHO/XHB) lifecycle. The BAdI must be C1-released with useInSAPCloudPlatform, and
  // the class must already implement its interface and be active (it is referenced, not changed):
  //   TEST_BTP_ENHO_PACKAGE, TEST_BTP_ENHO_SPOT, TEST_BTP_ENHO_BADI, TEST_BTP_ENHO_CLASS
  //   TEST_BTP_ENHO_FILTER (optional, for a filter-dependent BAdI, e.g. "RECEIVER_COUNTRY = 'DE'")
  it('creates, updates, activates and deletes a BAdI implementation on BTP', async (ctx) => {
    const pkg = process.env.TEST_BTP_ENHO_PACKAGE;
    const spot = process.env.TEST_BTP_ENHO_SPOT;
    const badi = process.env.TEST_BTP_ENHO_BADI;
    const implementingClass = process.env.TEST_BTP_ENHO_CLASS;
    const filter = process.env.TEST_BTP_ENHO_FILTER;
    requireOrSkip(
      ctx,
      pkg && spot && badi && implementingClass,
      `${SkipReason.NO_FIXTURE}: TEST_BTP_ENHO_PACKAGE/SPOT/BADI/CLASS not set`,
    );
    const btpConfig = { ...DEFAULT_CONFIG, systemType: 'btp' as const, allowWrites: true };
    const call = async (tool: string, args: Record<string, unknown>) => {
      const result = await handleToolCall(client, btpConfig, tool, args, auth(['read', 'write']));
      expect(result.isError, JSON.stringify(result)).toBeFalsy();
      return result.content[0]?.text ?? '';
    };
    const name = generateUniqueName('ZARC1_EB');
    const entry = { name: `${name}_I`.slice(0, 30), badiDefinition: badi, implementingClass };
    let created = false;
    try {
      await call('SAPWrite', {
        action: 'create',
        type: 'ENHO',
        name,
        package: pkg,
        description: 'ARC-1 BTP ENHO test',
        source: JSON.stringify({
          enhancementSpot: spot,
          badiImplementations: [{ ...entry, ...(filter ? { filter } : {}) }],
        }),
      });
      created = true;
      const read = JSON.parse(await call('SAPRead', { type: 'ENHO', name }));
      expect(read.badiImplementations[0]).toMatchObject({ name: entry.name, badiDefinition: badi, active: true });
      if (filter) expect(read.badiImplementations[0].filter).toBe(filter);
      await call('SAPActivate', { type: 'ENHO', name });

      // Round trip with one flag changed; the ABAP-for-Cloud language version must survive the PUT.
      read.badiImplementations[0].active = false;
      await call('SAPWrite', { action: 'update', type: 'ENHO', name, source: JSON.stringify(read) });
      const updated = JSON.parse(await call('SAPRead', { type: 'ENHO', name }));
      expect(updated.badiImplementations[0]).toMatchObject({ name: entry.name, active: false });
      if (filter) expect(updated.badiImplementations[0].filter).toBe(filter);
      const raw = await client.http.get(`/sap/bc/adt/enhancements/enhoxhb/${name.toLowerCase()}`, {
        Accept: 'application/vnd.sap.adt.enh.enhoxhb.v4+xml',
      });
      expect(raw.body).toContain('adtcore:abapLanguageVersion="cloudDevelopment"');
      await call('SAPActivate', { type: 'ENHO', name });

      await call('SAPWrite', { action: 'delete', type: 'ENHO', name });
      created = false;
    } finally {
      // best-effort-cleanup: npm run test:cleanup sweeps ZARC1* leftovers.
      if (created) {
        await handleToolCall(
          client,
          btpConfig,
          'SAPWrite',
          { action: 'delete', type: 'ENHO', name },
          auth(['read', 'write']),
        ).catch(() => undefined);
      }
    }
  }, 180_000);
});

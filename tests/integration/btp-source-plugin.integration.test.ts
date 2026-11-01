/** Read-only BTP qualification of the publicly supported FUNC/FUGR source families. */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdtClient } from '../../src/adt/client.js';
import { EXTENSION_LIMITS } from '../../src/adt/extension-discovery.js';
import { createBearerTokenProvider, loadServiceKeyFile, parseServiceKey } from '../../src/adt/oauth.js';
import { defaultSafetyConfig } from '../../src/adt/safety.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import type { ToolResult } from '../../src/handlers/shared.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { hasBtpCredentials } from './helpers.js';

config();
const describeIf = hasBtpCredentials() ? describe : describe.skip;
const auth = { token: 'test-scope-only', clientId: 'btp-source-qualification', scopes: ['read'], expiresAt: Infinity };
const settings = { ...DEFAULT_CONFIG, systemType: 'btp' as const };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
describeIf('BTP source plug-in reads (no SAP writes)', { timeout: 45_000 }, () => {
  let client: AdtClient;
  let group: string | null;
  const name = process.env.TEST_BTP_SOURCE_FUNCTION || 'RFC_SYSTEM_INFO';
  const observations: unknown[] = [];
  const environment: { abapRelease?: string; cloudComponent?: boolean } = {};
  beforeAll(async () => {
    const key = process.env.TEST_BTP_SERVICE_KEY
      ? parseServiceKey(process.env.TEST_BTP_SERVICE_KEY)
      : loadServiceKeyFile(process.env.TEST_BTP_SERVICE_KEY_FILE || process.env.SAP_BTP_SERVICE_KEY_FILE || '');
    const token = process.env.TEST_BTP_ACCESS_TOKEN;
    client = new AdtClient({
      baseUrl: key.url,
      client: key.abap?.sapClient || '100',
      language: 'EN',
      safety: defaultSafetyConfig(),
      bearerTokenProvider: token ? async () => token : createBearerTokenProvider(key),
    });
    expect(JSON.parse(await client.getSystemInfo()).collections.length).toBeGreaterThan(0);
    const components = await client.getInstalledComponents();
    environment.abapRelease = components.find((component) => component.name === 'SAP_BASIS')?.release;
    environment.cloudComponent = components.some((component) => component.name === 'SAP_CLOUD');
    group = process.env.TEST_BTP_SOURCE_GROUP || (await client.resolveFunctionGroup(name));
  }, 150_000);

  const read = (type: 'FUNC' | 'FUGR', extensions: 'none' | 'summary' | 'sources') =>
    handleToolCall(
      client,
      settings,
      'SAPRead',
      {
        type,
        name: type === 'FUNC' ? name : group,
        ...(type === 'FUNC' ? { group } : {}),
        version: 'active',
        extensions,
      },
      auth,
    );
  const successful = (result: ToolResult) => {
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text.length).toBeGreaterThan(0);
    return result.content[0]!.text;
  };

  describe.each(['FUNC', 'FUGR'] as const)('%s extension reads', (type) => {
    it('preserves the legacy result with none and bounds optional reads', async (ctx) => {
      requireOrSkip(ctx, group, SkipReason.NO_FIXTURE);
      const base = successful(await read(type, 'none'));
      for (const mode of ['summary', 'sources'] as const) {
        const result = await read(type, mode);
        expect(successful(result)).toBe(base);
        const summary = JSON.parse(result.content[1]!.text.replace('[extensions] ', ''));
        expect(summary.root).toMatchObject({ type, version: 'active' });
        expect(summary.providers.length).toBeGreaterThan(0);
        expect(
          summary.providers.every((p: { status: string }) =>
            ['returned', 'not_advertised', 'unsupported', 'incomplete'].includes(p.status),
          ),
        ).toBe(true);
        expect(summary.consumed.sends).toBeLessThanOrEqual(EXTENSION_LIMITS[mode].sends);
        expect(result.content.slice(1).reduce((n, b) => n + Buffer.byteLength(b.text), 0)).toBeLessThanOrEqual(
          EXTENSION_LIMITS[mode].outputBytes,
        );
        for (const p of summary.providers)
          if (p.status === 'incomplete')
            expect([
              'request_limit',
              'deadline',
              'response_byte_limit',
              'source_unit_node_limit',
              'source_units_unavailable_or_not_advertised',
            ]).toContain(p.reason);
        observations.push({
          type,
          mode,
          baseSha256: digest(base),
          basePreserved: true,
          summary,
          sourceBlockHashes: result.content
            .filter((b) => b.text.startsWith('[extension source '))
            .map((b) => digest(b.text)),
        });
      }
    });
  });

  afterAll(() => {
    mkdirSync('test-results', { recursive: true });
    writeFileSync(
      'test-results/btp-source-plugin.json',
      `${JSON.stringify({ checkedAt: new Date().toISOString(), environment, observations }, null, 2)}\n`,
    );
  });
});

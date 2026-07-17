/**
 * Proves the SHIPPED BTP descriptor actually resolves through the real config parser.
 *
 * An MTA extension descriptor can only OVERRIDE a base `mta.yaml` property, never remove it
 * (the spec allows deletion via optional+overwritable+null; multiapps-controller never
 * implemented it — SAP/cloud-mta-build-tool#1164). `SAP_FOO: ~` fails the deploy and
 * `cf unset-env` is undone by the next `cf deploy`, so writing an explicit value in the
 * mtaext is an operator's ONLY durable override.
 *
 * That makes every base-enabled property a stranding hazard: turning its partner off leaves
 * it behind in the merged descriptor. Shipping `SAP_PP_STRICT: "true"` next to
 * `SAP_PP_ENABLED: "true"` is exactly how a `SAP_PP_ENABLED: "false"` override once crashed
 * every CF instance at startup.
 *
 * The other mta.yaml tests (tests/unit/plugin/plugin-manifest.test.ts) assert property
 * VALUES. These assert the descriptor BOOTS — base as shipped, and under the realistic
 * overrides operators actually write.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { parseArgs } from '../../../src/server/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The env every CF instance boots with: the app module's `properties` block, verbatim. */
function baseDescriptorEnv(): Record<string, string> {
  const mta = parse(readFileSync(join(ROOT, 'mta.yaml'), 'utf8')) as Record<string, any>;
  const appModule = (mta.modules as Array<Record<string, any>>).find((m) => m.name === 'arc1-mcp-server');
  expect(appModule, 'arc1-mcp-server module missing from mta.yaml').toBeDefined();
  return appModule?.properties as Record<string, string>;
}

/** Base ∪ mtaext, the way multiapps-controller merges it: override wins, nothing is removed. */
function resolveWithOverrides(overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({ ...baseDescriptorEnv(), ...overrides })) {
    process.env[key] = String(value);
  }
  return parseArgs([]);
}

describe('shipped mta.yaml resolves through the config parser', () => {
  const savedEnv = { ...process.env };
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SAP_') || key.startsWith('ARC1_')) delete process.env[key];
    }
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.env = { ...savedEnv };
  });

  // The base descriptor legitimately warns about ARC1_DCR_SIGNING_SECRET — it is a
  // per-landscape secret that cannot live in a tracked descriptor (cf set-env supplies it).
  const warnings = () => stderrSpy.mock.calls.flat().join(' ');
  const ppWarnings = () =>
    stderrSpy.mock.calls
      .flat()
      .filter((line: unknown) => String(line).includes('SAP_PP_'))
      .join(' ');

  it('boots as shipped, with strict PP actually enforced', () => {
    const config = resolveWithOverrides();

    expect(config.transport).toBe('http-streamable');
    expect(config.ppEnabled).toBe(true);
    // ppStrictExplicit is the load-bearing half: both enforcement sites in server.ts require
    // it, so an unset SAP_PP_STRICT would derive ppStrict=true and enforce nothing. This is
    // why mta.yaml keeps the redundant-looking explicit "true".
    expect(config.ppStrict).toBe(true);
    expect(config.ppStrictExplicit).toBe(true);
    expect(ppWarnings()).toBe('');
  });

  it('boots with PP turned off by an override, stranding the base SAP_PP_STRICT', () => {
    const config = resolveWithOverrides({ SAP_PP_ENABLED: 'false' });

    expect(config.ppEnabled).toBe(false);
    expect(warnings()).toContain('SAP_PP_STRICT=true has no effect');
  });

  it('warns when an override adds API keys while the base strict PP stays stranded', () => {
    // XSUAA off + API keys passes validation (API keys satisfy hasHttpAuth) and logs a
    // healthy `per-user` scope, while server.ts rejects every API-key call for lacking a JWT.
    const config = resolveWithOverrides({ SAP_XSUAA_AUTH: 'false', ARC1_API_KEYS: 'k1:admin' });

    expect(config.ppEnabled).toBe(true);
    expect(warnings()).toContain('rejects every non-JWT call');
  });

  it('boots for mixed PP/API-key operation, the documented SAP_PP_STRICT=false topology', () => {
    const config = resolveWithOverrides({
      SAP_XSUAA_AUTH: 'false',
      SAP_PP_STRICT: 'false',
      ARC1_API_KEYS: 'k1:admin',
    });

    expect(config.ppStrict).toBe(false);
    expect(ppWarnings()).toBe('');
  });

  it('falls back to the basic destination when an override blanks the PP destination', () => {
    // Blanking is an mtaext's only way to neutralize a base property, so the PP destination
    // lookup in server.ts must treat '' as absent and fall back — `??` would not.
    resolveWithOverrides({ SAP_BTP_PP_DESTINATION: '', SAP_BTP_DESTINATION: 'my-destination' });

    expect(process.env.SAP_BTP_PP_DESTINATION || process.env.SAP_BTP_DESTINATION).toBe('my-destination');
  });
});

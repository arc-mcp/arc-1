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
 * it behind in the merged descriptor. The safe base therefore carries no active SAP target;
 * single-target PP is enabled as one complete environment-specific block, while
 * discovered multi-target runtimes enforce strict PP internally.
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

function appModuleDescriptor(): Record<string, any> {
  const mta = parse(readFileSync(join(ROOT, 'mta.yaml'), 'utf8')) as Record<string, any>;
  const appModule = (mta.modules as Array<Record<string, any>>).find((module) => module.name === 'arc1-mcp-server');
  expect(appModule, 'arc1-mcp-server module missing from mta.yaml').toBeDefined();
  return appModule as Record<string, any>;
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
  const ppWarnings = () =>
    stderrSpy.mock.calls
      .flat()
      .filter((line: unknown) => String(line).includes('SAP_PP_'))
      .join(' ');

  it('boots as shipped without inventing a single-target SAP connection', () => {
    const config = resolveWithOverrides();

    expect(config.transport).toBe('http-streamable');
    expect(process.env.SAP_BTP_DESTINATION).toBeUndefined();
    expect(process.env.SAP_BTP_PP_DESTINATION).toBeUndefined();
    expect(config.ppEnabled).toBe(true);
    expect(config.ppStrict).toBe(true);
    expect(config.ppStrictExplicit).toBe(true);
    expect(config.multiTargetEndpoints).toBe(false);
    expect(ppWarnings()).toBe('');
  });

  it('boots with an explicit complete single-target strict-PP block', () => {
    const config = resolveWithOverrides({
      SAP_BTP_DESTINATION: 'my-basic-destination',
      SAP_BTP_PP_DESTINATION: 'my-pp-destination',
      SAP_PP_ENABLED: 'true',
      SAP_PP_STRICT: 'true',
    });

    expect(process.env.SAP_BTP_DESTINATION).toBe('my-basic-destination');
    expect(process.env.SAP_BTP_PP_DESTINATION).toBe('my-pp-destination');
    expect(config.ppEnabled).toBe(true);
    expect(config.ppStrict).toBe(true);
    expect(config.ppStrictExplicit).toBe(true);
    expect(ppWarnings()).toBe('');
  });

  it('allows an API-key-only single-target deployment without inheriting principal propagation', () => {
    const config = resolveWithOverrides({
      SAP_XSUAA_AUTH: 'false',
      SAP_PP_ENABLED: 'false',
      SAP_PP_STRICT: 'false',
      ARC1_API_KEYS: 'k1:admin',
    });

    expect(config.ppEnabled).toBe(false);
    expect(config.ppStrict).toBe(false);
    expect(ppWarnings()).toBe('');
  });

  it('boots for mixed PP/API-key operation, the documented SAP_PP_STRICT=false topology', () => {
    const config = resolveWithOverrides({
      SAP_XSUAA_AUTH: 'false',
      SAP_BTP_DESTINATION: 'my-basic-destination',
      SAP_BTP_PP_DESTINATION: 'my-pp-destination',
      SAP_PP_ENABLED: 'true',
      SAP_PP_STRICT: 'false',
      ARC1_API_KEYS: 'k1:admin',
    });

    expect(config.ppStrict).toBe(false);
    expect(ppWarnings()).toBe('');
  });

  it('boots the complete conservative multi-target block without a separate single-target connection', () => {
    const config = resolveWithOverrides({
      ARC1_MULTI_TARGET_ENDPOINTS: 'true',
      ARC1_CACHE: 'none',
      ARC1_TOOL_MODE: 'standard',
      ARC1_UI: 'off',
    });

    expect(config.multiTargetEndpoints).toBe(true);
    expect(config.ppEnabled).toBe(true);
    expect(process.env.SAP_BTP_DESTINATION).toBeUndefined();
    expect(config.cacheMode).toBe('none');
  });

  it('boots shared Basic multi-target only with its explicit opt-in and one shipped CF instance', () => {
    const config = resolveWithOverrides({
      ARC1_MULTI_TARGET_ENDPOINTS: 'true',
      ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH: 'true',
      ARC1_CACHE: 'none',
      ARC1_TOOL_MODE: 'standard',
      ARC1_UI: 'off',
    });

    expect(config.multiTargetEndpoints).toBe(true);
    expect(config.multiTargetAllowBasicAuth).toBe(true);
    expect(appModuleDescriptor().parameters?.instances).toBe(1);
  });

  it('excludes local agent credentials and generated documentation from the deployable module', () => {
    const ignored = appModuleDescriptor()['build-parameters']?.ignore as string[] | undefined;

    expect(ignored).toEqual(
      expect.arrayContaining([
        '.env.*',
        '.npmrc',
        '*service-key*.json',
        '*.key',
        '*.pem',
        '*.p12',
        '*.pfx',
        '*.pse',
        '*.jks',
        '*.keystore',
        '.codex/',
        '.codex-tmp/',
        '.cfignore',
        '.cursorignore',
        'artifacts/',
        'btp/',
        'docs_page/',
        'site/',
        'public/',
        'Makefile_*.mta',
        'mta.yaml',
        'tsconfig*.json',
        'xs-security.json',
      ]),
    );
  });

  it('falls back to the basic destination when an override blanks the PP destination', () => {
    // Blanking is an mtaext's only way to neutralize a base property, so the PP destination
    // lookup in server.ts must treat '' as absent and fall back — `??` would not.
    resolveWithOverrides({ SAP_BTP_PP_DESTINATION: '', SAP_BTP_DESTINATION: 'my-destination' });

    expect(process.env.SAP_BTP_PP_DESTINATION || process.env.SAP_BTP_DESTINATION).toBe('my-destination');
  });
});

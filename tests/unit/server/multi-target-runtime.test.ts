import type { Destination } from '@arc-mcp/xsuaa-auth/btp';
import { describe, expect, it } from 'vitest';
import { isPackageAllowed } from '../../../src/adt/safety.js';
import {
  canonicalDestinationUrl,
  opaqueDestinationValue,
  projectMultiTargetDestination,
} from '../../../src/server/destination-discovery.js';
import {
  DestinationRegistry,
  evaluateStandaloneTargetDescriptor,
  targetSafety,
} from '../../../src/server/destination-registry.js';
import {
  buildAggregateToolSurfaceConfig,
  buildMultiTargetConfig,
  TargetConfigChangedError,
  validateTargetDrift,
} from '../../../src/server/multi-target-runtime.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const rawUrl = 'http://a4h.internal:50000';

function registryTarget() {
  const canonicalUrl = canonicalDestinationUrl(rawUrl) as string;
  return DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: 'ARC1_A4H_100_PP',
          type: 'HTTP',
          urlState: 'valid',
          urlFingerprint: opaqueDestinationValue(canonicalUrl),
          authentication: 'PrincipalPropagation',
          proxyType: 'OnPremise',
          sapSysId: 'A4H',
          sapClient: '100',
          description: 'A4H development',
          sapLanguage: 'EN',
          hasCloudConnectorLocationId: true,
          cloudConnectorLocationIdFingerprint: opaqueDestinationValue('LOC_A'),
          arcProperties: {
            'arc1.enabled': 'true',
            'arc1.allow_data_preview': 'true',
            'arc1.allow_free_sql': 'false',
          },
        },
      ],
      instanceNames: [],
      scannedCount: 1,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    { ...DEFAULT_CONFIG, allowDataPreview: true },
  ).targets[0];
}

function destination(overrides: Record<string, unknown> = {}): Destination {
  // Merge originalProperties overrides instead of letting the trailing spread replace them wholesale.
  const { originalProperties: originalOverrides, ...rest } = overrides;
  const originalProperties = {
    Name: 'ARC1_A4H_100_PP',
    Type: 'HTTP',
    URL: rawUrl,
    Authentication: 'PrincipalPropagation',
    ProxyType: 'OnPremise',
    'sap-sysid': 'A4H',
    'sap-client': '100',
    'sap-language': 'EN',
    Description: 'A4H development',
    'arc1.enabled': 'true',
    'arc1.allow_data_preview': 'true',
    'arc1.allow_free_sql': 'false',
    ...((originalOverrides as Record<string, unknown> | undefined) ?? {}),
  };
  return {
    Name: 'ARC1_A4H_100_PP',
    Type: 'HTTP',
    URL: rawUrl,
    Authentication: 'PrincipalPropagation',
    ProxyType: 'OnPremise',
    User: '',
    Password: '',
    'sap-client': '100',
    CloudConnectorLocationId: 'LOC_A',
    originalProperties,
    ...rest,
  } as Destination;
}

describe('multi-target runtime isolation', () => {
  it('builds from safe defaults without inheriting single-target credentials or write capability', () => {
    const config = buildMultiTargetConfig(
      {
        ...DEFAULT_CONFIG,
        url: 'https://single-target.example',
        username: 'single-target-user',
        password: 'single-target-password',
        cookieString: 'secret-cookie',
        insecure: true,
        gzipDataPreviewBody: true,
        userAgent: 'arc-1/team-dev',
        blockedDataSources: ['USR02'],
        disableSaml2: true,
        btpServiceKey: 'secret-key',
        allowWrites: true,
        allowTransportWrites: true,
        allowGitWrites: true,
        plugins: ['/tmp/plugin.js'],
        cacheMode: 'none',
      },
      registryTarget(),
      'pinned',
    );

    expect(config).toMatchObject({
      url: '',
      username: '',
      password: '',
      client: '100',
      insecure: false,
      gzipDataPreviewBody: true,
      userAgent: 'arc-1/team-dev',
      blockedDataSources: ['USR02'],
      disableSaml2: false,
      allowWrites: false,
      allowTransportWrites: false,
      allowGitWrites: false,
      ppEnabled: true,
      ppStrict: true,
      cacheMode: 'none',
      plugins: [],
      targetId: 'A4H/100',
    });
    expect(config.cookieString).toBeUndefined();
    expect(config.btpServiceKey).toBeUndefined();
  });

  it('builds aggregate capability directly without inventing a target identity', () => {
    const config = buildAggregateToolSurfaceConfig(
      { ...DEFAULT_CONFIG, client: '321', language: 'DE', allowDataPreview: true },
      [registryTarget()],
    );

    expect(config).toMatchObject({
      client: '321',
      language: 'DE',
      allowWrites: false,
      allowDataPreview: true,
      allowFreeSQL: false,
    });
    expect(config.destinationName).toBeUndefined();
    expect(config.targetId).toBeUndefined();
    expect(config).toMatchObject({ ppEnabled: true, ppStrict: true, disableSaml2: false });
  });

  it('preserves configured data-result limits for pinned and aggregate runtimes', () => {
    const base = {
      ...DEFAULT_CONFIG,
      maxDataPreviewResponseBytes: 1024 * 1024,
      maxConcurrentDataResults: 4,
    };

    for (const config of [
      buildMultiTargetConfig(base, registryTarget(), 'pinned'),
      buildAggregateToolSurfaceConfig(base, []),
    ]) {
      expect(config).toMatchObject({
        maxDataPreviewResponseBytes: 1024 * 1024,
        maxConcurrentDataResults: 4,
      });
    }
  });

  it('switches only a selected Basic target to the shared non-PP runtime', () => {
    const basicTarget = {
      ...registryTarget(),
      destinationName: 'ARC1_A4H_100_BASIC',
      authentication: 'BasicAuthentication' as const,
      identity: 'shared' as const,
    };

    const config = buildMultiTargetConfig(DEFAULT_CONFIG, basicTarget, 'pinned');

    expect(config).toMatchObject({
      ppEnabled: false,
      ppStrict: false,
      ppStrictExplicit: true,
      ppAllowSharedCookies: false,
      disableSaml2: true,
      targetId: 'A4H/100',
    });
  });

  it('provides a typed configuration-change error for callers', () => {
    const error = new TargetConfigChangedError('A4H/100', 'Restart ARC-1.');
    expect(error).toMatchObject({ name: 'TargetConfigChangedError', code: 'TARGET_CONFIG_CHANGED', target: 'A4H/100' });
  });

  it('accepts an unchanged fresh destination and returns the canonical URL', () => {
    const result = validateTargetDrift(destination(), registryTarget(), { ...DEFAULT_CONFIG, allowDataPreview: true });
    expect(result).toEqual({ ok: true, url: canonicalDestinationUrl(rawUrl) });
  });

  it.each([
    ['URL', { URL: 'http://changed.internal:50000' }],
    ['client', { 'sap-client': '200', originalProperties: { 'sap-client': '200' } }],
    ['location', { CloudConnectorLocationId: 'LOC_B' }],
    ['policy', { originalProperties: { 'arc1.allow_data_preview': 'false' } }],
    ['description', { originalProperties: { Description: 'A4H production' } }],
    ['target alias', { originalProperties: { 'arc1.target_alias': 'A4H-2025' } }],
    ['unknown ARC key', { originalProperties: { 'arc1.typo': 'true' } }],
    ['wrong-case ARC key', { originalProperties: { 'ARC1.Enabled': 'true' } }],
  ])('rejects %s drift until restart', (_label, overrides) => {
    expect(
      validateTargetDrift(destination(overrides), registryTarget(), { ...DEFAULT_CONFIG, allowDataPreview: true }),
    ).toMatchObject({ ok: false, code: 'TARGET_CONFIG_CHANGED' });
  });

  it('reports TARGET_CONFIG_CHANGED when arc1.allow_writes changes after startup', () => {
    const startup = destination({
      originalProperties: { 'arc1.allow_writes': 'true', 'arc1.allowed_packages': '$TMP' },
    });
    const projected = projectMultiTargetDestination(startup);
    if (!projected) throw new Error('expected a projected destination');
    const target = evaluateStandaloneTargetDescriptor(projected, DEFAULT_CONFIG);
    if (!target) throw new Error('expected an accepted target');
    const changed = destination({
      originalProperties: { 'arc1.allow_writes': 'false', 'arc1.allowed_packages': '$TMP' },
    });
    expect(validateTargetDrift(changed, target, DEFAULT_CONFIG)).toMatchObject({
      ok: false,
      code: 'TARGET_CONFIG_CHANGED',
    });
    expect(validateTargetDrift(startup, target, DEFAULT_CONFIG)).toMatchObject({ ok: true });
  });
});

describe('ADR-0008 route-bound write ceiling', () => {
  const writable = (identity: 'per-user' | 'shared' = 'per-user') => ({
    ...registryTarget(),
    identity,
    authentication: identity === 'per-user' ? ('PrincipalPropagation' as const) : ('BasicAuthentication' as const),
    effectivePolicy: {
      allowDataPreview: false,
      allowFreeSQL: false,
      allowWrites: true,
      allowedPackages: ['ZTEAM*'],
      allowTransportWrites: true,
      allowGitWrites: true,
    },
  });

  it('maps the effective policy only on the pinned route', () => {
    expect(buildMultiTargetConfig(DEFAULT_CONFIG, writable(), 'pinned')).toMatchObject({
      allowWrites: true,
      allowTransportWrites: true,
      allowGitWrites: true,
      allowedPackages: ['ZTEAM*'],
    });
  });

  it('keeps the aggregate route mutation-free even for a writable target', () => {
    expect(buildMultiTargetConfig(DEFAULT_CONFIG, writable(), 'aggregate')).toMatchObject({
      allowWrites: false,
      allowTransportWrites: false,
      allowGitWrites: false,
      allowedPackages: ['$TMP'],
    });
  });

  it('never grants writes to a shared identity, even if a descriptor claims it', () => {
    expect(buildMultiTargetConfig(DEFAULT_CONFIG, writable('shared'), 'pinned').allowWrites).toBe(false);
  });

  it('never maps an empty package list to "all packages"', () => {
    const target = { ...writable(), effectivePolicy: { ...writable().effectivePolicy, allowedPackages: [] } };
    expect(() => buildMultiTargetConfig(DEFAULT_CONFIG, target, 'pinned')).toThrow(/allowedPackages/);
  });

  it('matches a lower-case destination package pattern against SAP upper-case package names', () => {
    // arc1.allowed_packages is validated case-insensitively; safety.ts upper-cases both sides.
    const target = { ...writable(), effectivePolicy: { ...writable().effectivePolicy, allowedPackages: ['zteam*'] } };
    const safety = targetSafety(target, [], 'pinned');
    expect(isPackageAllowed(safety, 'ZTEAM_CORE')).toBe(true);
    expect(isPackageAllowed(safety, 'ZOTHER')).toBe(false);
  });

  it('keeps the aggregate tools/list union mutation-free', () => {
    expect(
      buildAggregateToolSurfaceConfig({ ...DEFAULT_CONFIG, multiTargetAllowWrites: true }, [writable()]).allowWrites,
    ).toBe(false);
  });
});

import type { Destination } from '@arc-mcp/xsuaa-auth/btp';
import { describe, expect, it } from 'vitest';
import { canonicalDestinationUrl, opaqueDestinationValue } from '../../../src/server/destination-discovery.js';
import { DestinationRegistry } from '../../../src/server/destination-registry.js';
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
    ...((overrides.originalProperties as Record<string, unknown> | undefined) ?? {}),
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
    ...overrides,
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
        disableSaml2: true,
        btpServiceKey: 'secret-key',
        allowWrites: true,
        allowTransportWrites: true,
        allowGitWrites: true,
        plugins: ['/tmp/plugin.js'],
        cacheMode: 'none',
      },
      registryTarget(),
    );

    expect(config).toMatchObject({
      url: '',
      username: '',
      password: '',
      client: '100',
      insecure: false,
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

  it('switches only a selected Basic target to the shared non-PP runtime', () => {
    const basicTarget = {
      ...registryTarget(),
      destinationName: 'ARC1_A4H_100_BASIC',
      authentication: 'BasicAuthentication' as const,
      identity: 'shared' as const,
    };

    const config = buildMultiTargetConfig(DEFAULT_CONFIG, basicTarget);

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
});

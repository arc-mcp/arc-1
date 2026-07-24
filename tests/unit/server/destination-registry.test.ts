import { describe, expect, it } from 'vitest';
import type { DestinationDiscoveryResult, DiscoveredDestination } from '../../../src/server/destination-discovery.js';
import { canonicalDestinationUrl, opaqueDestinationValue } from '../../../src/server/destination-discovery.js';
import { DestinationRegistry, MULTI_TARGET_MAX, targetSafety } from '../../../src/server/destination-registry.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

function destination(overrides: Partial<DiscoveredDestination> = {}): DiscoveredDestination {
  const url = canonicalDestinationUrl('http://a4h.internal:50000') as string;
  return {
    name: 'ARC1_A4H_100_PP',
    type: 'HTTP',
    urlState: 'valid',
    urlFingerprint: opaqueDestinationValue(url),
    authentication: 'PrincipalPropagation',
    proxyType: 'OnPremise',
    sapSysId: 'A4H',
    sapClient: '100',
    description: 'A4H development',
    hasCloudConnectorLocationId: false,
    arcProperties: { 'arc1.enabled': 'true' },
    ...overrides,
  };
}

function discovery(
  subaccount: readonly DiscoveredDestination[],
  instanceNames: readonly string[] = [],
): DestinationDiscoveryResult {
  return {
    subaccount,
    instanceNames,
    scannedCount: subaccount.length,
    unrelatedCount: 0,
    arcAdjacentWithoutMarkerCount: 0,
  };
}

describe('DestinationRegistry', () => {
  it('accepts the minimum config and applies the instance policy ceiling', () => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([
        destination({
          arcProperties: {
            'arc1.enabled': 'true',
            'arc1.allow_data_preview': 'true',
            'arc1.allow_free_sql': 'true',
          },
        }),
      ]),
      { ...DEFAULT_CONFIG, allowDataPreview: true, allowFreeSQL: false },
    );

    expect(registry.failure).toBeUndefined();
    expect(registry.targets).toHaveLength(1);
    expect(registry.targets[0]).toMatchObject({
      target: 'A4H/100',
      description: 'A4H development',
      requestedPolicy: { allowDataPreview: true, allowFreeSQL: true },
      effectivePolicy: { allowDataPreview: true, allowFreeSQL: false },
      authentication: 'PrincipalPropagation',
      identity: 'per-user',
    });
    expect(targetSafety(registry.targets[0])).toMatchObject({
      allowWrites: false,
      allowDataPreview: true,
      allowFreeSQL: false,
      allowTransportWrites: false,
      allowGitWrites: false,
    });
  });

  it('uses an optional route alias without changing the real SAP SID or client', () => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([
        destination({ name: 'A4H_2023' }),
        destination({
          name: 'A4H_2025',
          description: 'ABAP Platform 2025',
          arcProperties: { 'arc1.enabled': 'true', 'arc1.target_alias': 'A4H-2025' },
        }),
      ]),
      DEFAULT_CONFIG,
    );

    expect(registry.targets.map((target) => target.target)).toEqual(['A4H-2025/100', 'A4H/100']);
    expect(registry.targets[0]).toMatchObject({ sid: 'A4H', client: '100' });
    expect(registry.diagnostics.find((entry) => entry.target === 'A4H-2025/100')?.arcConfig).toMatchObject({
      targetAlias: 'A4H-2025',
    });
  });

  it('warns through fallback semantics for missing/invalid descriptions', () => {
    const targets = DestinationRegistry.fromDiscovery(
      discovery([
        destination({ description: undefined }),
        destination({ name: 'B', sapClient: '200', description: 'x'.repeat(161) }),
      ]),
      DEFAULT_CONFIG,
    ).targets;
    expect(targets.map((target) => target.description)).toEqual(['A4H/100', 'A4H/200']);
  });

  it.each([
    [{ sapSysId: 'A-4' }, 'INVALID_SYSID'],
    [{ arcProperties: { 'arc1.enabled': 'true', 'arc1.target_alias': 'a4h-2025' } }, 'INVALID_TARGET_ALIAS'],
    [{ arcProperties: { 'arc1.enabled': 'true', 'arc1.target_alias': 'A4H_2025' } }, 'INVALID_TARGET_ALIAS'],
    [{ arcProperties: { 'arc1.enabled': 'true', 'arc1.target_alias': 'A4H-2025-' } }, 'INVALID_TARGET_ALIAS'],
    [{ sapClient: '10' }, 'INVALID_CLIENT'],
    [{ type: 'RFC' }, 'UNSUPPORTED_TYPE'],
    [{ urlState: 'invalid', urlFingerprint: undefined }, 'INVALID_URL'],
    [{ authentication: 'BasicAuthentication' }, 'BASIC_AUTH_DISABLED'],
    [{ proxyType: 'Internet' }, 'UNSUPPORTED_PROXY'],
    [{ sapLanguage: 'ENG' }, 'INVALID_LANGUAGE'],
    [{ arcProperties: { 'ARC1.Enabled': 'true' } }, 'ARC1_ENABLED_MISSING'],
    [{ arcProperties: { 'arc1.enabled': 'yes' } }, 'ARC1_ENABLED_INVALID'],
    [{ arcProperties: { 'arc1.enabled': 'true', 'arc1.typo': 'true' } }, 'UNKNOWN_ARC1_PROPERTY'],
    [{ arcProperties: { 'arc1.enabled': 'true', 'arc1.allow_writes': 'true' } }, 'UNSUPPORTED_V1_WRITE_CONFIG'],
  ])('quarantines invalid config %#', (overrides, code) => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([destination(overrides as Partial<DiscoveredDestination>)]),
      DEFAULT_CONFIG,
    );
    expect(registry.targets).toHaveLength(0);
    expect(registry.diagnostics[0]).toMatchObject({ code });
    expect(['ignored', 'quarantined']).toContain(registry.diagnostics[0].status);
  });

  it('accepts mixed PP and opt-in OnPremise Basic targets and derives identity', () => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([
        destination(),
        destination({
          name: 'ARC1_A4H_200_BASIC',
          sapClient: '200',
          authentication: 'BasicAuthentication',
          preemptive: ' true ',
        }),
      ]),
      { ...DEFAULT_CONFIG, multiTargetAllowBasicAuth: true },
    );

    expect(registry.targets).toHaveLength(2);
    expect(
      registry.targets.map(({ target, authentication, identity }) => ({ target, authentication, identity })),
    ).toEqual([
      { target: 'A4H/100', authentication: 'PrincipalPropagation', identity: 'per-user' },
      { target: 'A4H/200', authentication: 'BasicAuthentication', identity: 'shared' },
    ]);
  });

  it.each([undefined, 'true', ' TRUE '])('accepts Basic Preemptive=%s', (preemptive) => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([destination({ authentication: 'BasicAuthentication', preemptive })]),
      { ...DEFAULT_CONFIG, multiTargetAllowBasicAuth: true },
    );
    expect(registry.targets[0]).toMatchObject({ authentication: 'BasicAuthentication', identity: 'shared' });
  });

  it.each(['false', 'no', '', '1'])('quarantines Basic Preemptive=%j', (preemptive) => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([destination({ authentication: 'BasicAuthentication', preemptive })]),
      { ...DEFAULT_CONFIG, multiTargetAllowBasicAuth: true },
    );
    expect(registry.targets).toEqual([]);
    expect(registry.diagnostics[0]).toMatchObject({ code: 'BASIC_PREEMPTIVE_DISABLED' });
  });

  it('keeps Basic OnPremise-only after the instance opt-in', () => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([destination({ authentication: 'BasicAuthentication', proxyType: 'Internet' })]),
      { ...DEFAULT_CONFIG, multiTargetAllowBasicAuth: true },
    );
    expect(registry.targets).toEqual([]);
    expect(registry.diagnostics[0]).toMatchObject({ code: 'UNSUPPORTED_PROXY' });
  });

  it('does not let destination properties override derived identity', () => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([
        destination({
          authentication: 'BasicAuthentication',
          arcProperties: { 'arc1.enabled': 'true', 'arc1.identity': 'per-user' },
        }),
      ]),
      { ...DEFAULT_CONFIG, multiTargetAllowBasicAuth: true },
    );
    expect(registry.targets).toEqual([]);
    expect(registry.diagnostics[0]).toMatchObject({ code: 'UNKNOWN_ARC1_PROPERTY' });
  });

  it('keeps explicitly disabled targets out without treating them as accepted', () => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([destination({ arcProperties: { 'arc1.enabled': ' false ' } })]),
      DEFAULT_CONFIG,
    );
    expect(registry.targets).toEqual([]);
    expect(registry.diagnostics[0]).toMatchObject({ status: 'disabled', code: 'ARC1_DISABLED' });
  });

  it('quarantines every duplicate target claimant', () => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([destination({ name: 'ONE' }), destination({ name: 'TWO' })]),
      DEFAULT_CONFIG,
    );
    expect(registry.targets).toEqual([]);
    expect(registry.diagnostics.map((entry) => entry.code)).toEqual(['DUPLICATE_TARGET', 'DUPLICATE_TARGET']);
  });

  it('quarantines duplicate public aliases even when the real SIDs differ', () => {
    const alias = { 'arc1.enabled': 'true', 'arc1.target_alias': 'SHARED-TARGET' };
    const registry = DestinationRegistry.fromDiscovery(
      discovery([
        destination({ name: 'ONE', arcProperties: alias }),
        destination({ name: 'TWO', sapSysId: 'NPL', arcProperties: alias }),
      ]),
      DEFAULT_CONFIG,
    );
    expect(registry.targets).toEqual([]);
    expect(registry.diagnostics.map((entry) => entry.code)).toEqual(['DUPLICATE_TARGET', 'DUPLICATE_TARGET']);
  });

  it('quarantines shared Basic aliases that claim the same physical SAP client', () => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([
        destination({
          name: 'BASIC_ONE',
          authentication: 'BasicAuthentication',
          arcProperties: { 'arc1.enabled': 'true', 'arc1.target_alias': 'A4H-ONE' },
        }),
        destination({
          name: 'BASIC_TWO',
          authentication: 'BasicAuthentication',
          arcProperties: { 'arc1.enabled': 'true', 'arc1.target_alias': 'A4H-TWO' },
        }),
      ]),
      { ...DEFAULT_CONFIG, multiTargetAllowBasicAuth: true },
    );

    expect(registry.targets).toEqual([]);
    expect(registry.diagnostics.map((entry) => entry.code)).toEqual([
      'DUPLICATE_BASIC_CONNECTION',
      'DUPLICATE_BASIC_CONNECTION',
    ]);
  });

  it('quarantines every duplicate destination-name claimant', () => {
    const registry = DestinationRegistry.fromDiscovery(
      discovery([destination(), destination({ sapClient: '200' })]),
      DEFAULT_CONFIG,
    );
    expect(registry.targets).toEqual([]);
    expect(registry.diagnostics.every((entry) => entry.code === 'DUPLICATE_DESTINATION_NAME')).toBe(true);
  });

  it('quarantines a subaccount destination shadowed at instance level', () => {
    const registry = DestinationRegistry.fromDiscovery(discovery([destination()], ['ARC1_A4H_100_PP']), DEFAULT_CONFIG);
    expect(registry.targets).toEqual([]);
    expect(registry.diagnostics[0].code).toBe('SHADOWED_BY_INSTANCE');
  });

  it('disables the entire registry above the target limit without choosing a subset', () => {
    const entries = Array.from({ length: MULTI_TARGET_MAX + 1 }, (_, index) => {
      const sid = `A${Math.floor(index / 10) % 10}${index % 10}`;
      return destination({ name: `DEST_${index}`, sapSysId: sid, sapClient: String(index % 1000).padStart(3, '0') });
    });
    const registry = DestinationRegistry.fromDiscovery(discovery(entries), DEFAULT_CONFIG);
    expect(registry.targets).toEqual([]);
    expect(registry.failure?.code).toBe('TARGET_LIMIT_EXCEEDED');
  });

  it('computes a stable revision independent of discovery order', () => {
    const one = destination({ name: 'ONE', sapClient: '100' });
    const two = destination({ name: 'TWO', sapClient: '200' });
    const a = DestinationRegistry.fromDiscovery(discovery([one, two]), DEFAULT_CONFIG);
    const b = DestinationRegistry.fromDiscovery(discovery([two, one]), DEFAULT_CONFIG);
    expect(a.revision).toBe(b.revision);
  });

  it('computes a stable revision and diagnostic order for duplicate destination names', () => {
    const one = destination({ name: 'DUPLICATE', sapClient: '100' });
    const two = destination({ name: 'DUPLICATE', sapClient: '200' });
    const a = DestinationRegistry.fromDiscovery(discovery([one, two]), DEFAULT_CONFIG);
    const b = DestinationRegistry.fromDiscovery(discovery([two, one]), DEFAULT_CONFIG);

    expect(a.revision).toBe(b.revision);
    expect(a.diagnostics).toEqual(b.diagnostics);
    expect(a.diagnostics.map((entry) => entry.client)).toEqual(['100', '200']);
  });

  it('computes a stable failure revision above the target limit', () => {
    const entries = Array.from({ length: MULTI_TARGET_MAX + 1 }, (_, index) =>
      destination({
        name: `LIMIT_${String(index).padStart(3, '0')}`,
        sapSysId: `A${Math.floor(index / 10) % 10}${index % 10}`,
        sapClient: String(index % 1000).padStart(3, '0'),
      }),
    );
    const forward = DestinationRegistry.fromDiscovery(discovery(entries), DEFAULT_CONFIG);
    const reverse = DestinationRegistry.fromDiscovery(discovery([...entries].reverse()), DEFAULT_CONFIG);

    expect(forward.failure?.code).toBe('TARGET_LIMIT_EXCEEDED');
    expect(forward.revision).toBe(reverse.revision);
    expect(forward.diagnostics).toEqual(reverse.diagnostics);
  });

  it('retains no secret fields or raw destination graph', () => {
    const sentinel = 'SENTINEL_SECRET_5de848';
    const raw = destination({
      arcProperties: { 'arc1.enabled': 'true' },
    }) as DiscoveredDestination & { Password?: string; authTokens?: unknown };
    raw.Password = sentinel;
    raw.authTokens = [{ value: sentinel }];
    const registry = DestinationRegistry.fromDiscovery(discovery([raw]), DEFAULT_CONFIG);
    expect(JSON.stringify(registry)).not.toContain(sentinel);
    expect(JSON.stringify(registry)).not.toContain('a4h.internal');
    expect(Object.keys(registry.targets[0])).not.toContain('Password');
  });

  it('keeps Basic fingerprints and registry revisions independent of credential values', () => {
    const withCredentials = (user: string, password: string) => {
      const raw = destination({ authentication: 'BasicAuthentication' }) as DiscoveredDestination & {
        User?: string;
        Password?: string;
      };
      raw.User = user;
      raw.Password = password;
      return raw;
    };
    const first = DestinationRegistry.fromDiscovery(discovery([withCredentials('ONE', 'SENTINEL_ONE')]), {
      ...DEFAULT_CONFIG,
      multiTargetAllowBasicAuth: true,
    });
    const second = DestinationRegistry.fromDiscovery(discovery([withCredentials('TWO', 'SENTINEL_TWO')]), {
      ...DEFAULT_CONFIG,
      multiTargetAllowBasicAuth: true,
    });

    expect(first.targets[0].fingerprint).toBe(second.targets[0].fingerprint);
    expect(first.revision).toBe(second.revision);
    expect(JSON.stringify(first)).not.toContain('SENTINEL_ONE');
    expect(JSON.stringify(second)).not.toContain('SENTINEL_TWO');
  });
});

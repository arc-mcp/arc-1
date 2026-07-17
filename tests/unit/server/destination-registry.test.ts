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
    });
    expect(targetSafety(registry.targets[0])).toMatchObject({
      allowWrites: false,
      allowDataPreview: true,
      allowFreeSQL: false,
      allowTransportWrites: false,
      allowGitWrites: false,
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
    [{ sapClient: '10' }, 'INVALID_CLIENT'],
    [{ type: 'RFC' }, 'UNSUPPORTED_TYPE'],
    [{ urlState: 'invalid', urlFingerprint: undefined }, 'INVALID_URL'],
    [{ authentication: 'BasicAuthentication' }, 'UNSUPPORTED_AUTH'],
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
});

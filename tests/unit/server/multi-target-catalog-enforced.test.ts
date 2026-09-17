import type { Destination } from '@arc-mcp/xsuaa-auth/btp';
import { describe, expect, it } from 'vitest';
import {
  type DiscoveredDestination,
  projectMultiTargetDestination,
} from '../../../src/server/destination-discovery.js';
import { DestinationRegistry, evaluateStandaloneTargetDescriptor } from '../../../src/server/destination-registry.js';
import { buildTargetCatalog } from '../../../src/server/multi-target-catalog.js';
import {
  buildEnforcedTargetCatalogResult as buildTargetCatalogResult,
  TARGET_CATALOG_MAX_RESULT_BYTES,
  type TargetCatalogEnforcement,
} from '../../../src/server/multi-target-catalog-enforced.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const enforced = { authorizationMode: 'xsuaa-attribute' } as const;
const config = { ...DEFAULT_CONFIG, multiTargetAllowBasicAuth: true };
function destination(index: number, overrides: Partial<DiscoveredDestination> = {}): DiscoveredDestination {
  return {
    name: `DEST_${String(index).padStart(3, '0')}`,
    type: 'HTTP',
    urlState: 'valid',
    urlFingerprint: `fingerprint-${index}`,
    authentication: 'PrincipalPropagation',
    proxyType: 'OnPremise',
    sapSysId: 'A4H',
    sapClient: String(index).padStart(3, '0'),
    description: `Development client ${index}`,
    hasCloudConnectorLocationId: false,
    arcProperties: { 'arc1.enabled': 'true' },
    ...overrides,
  };
}
function registry(entries: readonly DiscoveredDestination[], strict = true): DestinationRegistry {
  return DestinationRegistry.fromDiscovery(
    {
      subaccount: entries,
      instanceNames: [],
      scannedCount: entries.length,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    config,
    strict ? enforced : {},
  );
}
function access(targets: string[] = ['A4H/001', 'A4H/100']): TargetCatalogEnforcement {
  return {
    allowsTarget: (target) => targets.includes(target),
    authorization: {
      mode: 'xsuaa-attribute',
      grantMode: 'exact',
      status: 'valid',
      exactGrantCount: targets.length,
    },
  };
}
function payload(snapshot: DestinationRegistry, options: Partial<Parameters<typeof buildTargetCatalogResult>[1]> = {}) {
  const result = buildTargetCatalogResult(snapshot, { admin: true, enforcement: access(), ...options });
  return { result, view: JSON.parse(result.content[0].text) };
}

describe('opted-in complete target catalog', () => {
  it('filters readers, but gives Admin the complete inventory with separate execution grants', () => {
    const snapshot = registry([
      destination(100),
      destination(1),
      destination(2),
      destination(3, {
        arcProperties: { 'arc1.enabled': 'false' },
      }),
      destination(4, { sapSysId: 'invalid' }),
      destination(5, { arcProperties: { 'ARC1.Enabled': 'true' } }),
    ]);
    const reader = payload(snapshot, { admin: false }).view;
    expect(reader).toEqual([
      { target: 'A4H/001', description: 'Development client 1', identity: 'per-user' },
      { target: 'A4H/100', description: 'Development client 100', identity: 'per-user' },
    ]);
    const { result, view } = payload(snapshot);
    expect(result.isError).toBeUndefined();
    expect(view.targets.map((entry: { target: string; granted: boolean }) => [entry.target, entry.granted])).toEqual([
      ['A4H/001', true],
      ['A4H/002', false],
      ['A4H/100', true],
    ]);
    expect(view.admin.destinations).toHaveLength(6);
    expect(view.admin).toMatchObject({
      state: 'degraded',
      countsComplete: true,
      authorization: { mode: 'xsuaa-attribute', grantMode: 'exact', exactGrantCount: 2, status: 'valid' },
    });
    for (const key of ['diagnosticOffset', 'diagnosticNextOffset', 'diagnosticReturned', 'diagnosticsTruncated'])
      expect(view.admin).not.toHaveProperty(key);
  });

  it('keeps complete counts and authorization unchanged when filtering the full diagnostic set', () => {
    const snapshot = registry(Array.from({ length: 100 }, (_, i) => destination(i)));
    const full = payload(snapshot).view;
    const filtered = payload(snapshot, { query: '  DEST_099  ' }).view;
    expect(filtered.admin.destinations).toHaveLength(1);
    expect(filtered.admin.destinations[0].destinationName).toBe('DEST_099');
    expect(filtered.admin.counts).toEqual(full.admin.counts);
    expect(filtered.admin.authorization).toEqual(full.admin.authorization);
    expect(filtered.targets).toEqual([]);
  });

  it('does not give Admin without grants execution access or leak unknown grant IDs', () => {
    const snapshot = registry([destination(1)]);
    const absent: TargetCatalogEnforcement = {
      allowsTarget: () => false,
      authorization: { mode: 'xsuaa-attribute', grantMode: 'none', status: 'TARGET_GRANT_MISSING' },
    };
    expect(payload(snapshot, { enforcement: absent }).view).toMatchObject({
      targets: [{ target: 'A4H/001', granted: false }],
      admin: { authorization: absent.authorization },
    });
    const unknown = payload(snapshot, { enforcement: access(['ZZZ/999']) });
    expect(unknown.view.admin.authorization.exactGrantCount).toBe(1);
    expect(JSON.stringify(unknown.result)).not.toContain('ZZZ/999');
    const star: TargetCatalogEnforcement = {
      allowsTarget: () => true,
      authorization: { mode: 'xsuaa-attribute', grantMode: 'all', status: 'valid' },
    };
    expect(payload(snapshot, { enforcement: star }).view.targets[0].granted).toBe(true);
    expect(payload(snapshot, { enforcement: star }).view.admin.authorization).not.toHaveProperty('exactGrantCount');
  });

  it('returns all 256 healthy rows below the complete wire budget with stable ordering', () => {
    const entries = Array.from({ length: 256 }, (_, i) => destination(i));
    const snapshot = registry(entries);
    const { result, view } = payload(snapshot);
    expect(snapshot.available).toBe(true);
    expect(view.targets).toHaveLength(256);
    expect(view.admin.destinations).toHaveLength(256);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(TARGET_CATALOG_MAX_RESULT_BYTES);
    const reversed = registry([...entries].reverse());
    expect(reversed.revision).toBe(snapshot.revision);
    expect(payload(reversed).view.admin.destinations).toEqual(view.admin.destinations);
  });

  it('includes every passive Basic exception and filters exceptions without changing global counts', () => {
    const snapshot = registry(
      Array.from({ length: 30 }, (_, i) => destination(i, { authentication: 'BasicAuthentication' })),
    );
    const runtimeAuth = () => ({ status: 'authentication_failed', checkedAt: '2026-09-15T12:00:00.000Z' });
    const full = payload(snapshot, { runtimeAuth }).view.admin.sharedAuthentication;
    expect(full.exceptions).toHaveLength(30);
    expect(full).toEqual({ targets: 30, statusCounts: { authentication_failed: 30 }, exceptions: expect.any(Array) });
    const filtered = payload(snapshot, { runtimeAuth, query: 'client 29' }).view.admin.sharedAuthentication;
    expect(filtered.statusCounts).toEqual(full.statusCounts);
    expect(filtered.targets).toBe(30);
    expect(filtered.exceptions).toHaveLength(1);
    expect(filtered.exceptions[0].target).toBe('A4H/029');
  });

  it('counts disabled, malformed and wrong-case ARC candidates in the strict deployment bound only', () => {
    const entries = Array.from({ length: 257 }, (_, i) =>
      destination(i, { arcProperties: i % 2 ? { 'arc1.enabled': 'false' } : { 'ARC1.Enabled': 'true' } }),
    );
    const snapshot = registry(entries);
    expect(snapshot.targets).toHaveLength(0);
    expect(snapshot.diagnostics).toHaveLength(0);
    const { result, view } = payload(snapshot);
    expect(result.isError).toBe(true);
    expect(view.admin).toMatchObject({
      state: 'error',
      countsComplete: false,
      arcRelatedAtLeast: 257,
      failure: { code: 'TARGET_LIMIT_EXCEEDED' },
      destinations: [],
    });
    expect(view.admin).not.toHaveProperty('counts');
    expect(registry(entries, false).available).toBe(true);
    expect(payload(snapshot, { admin: false }).view).toEqual([]);
  });

  it('omits unknown totals for discovery failure, keeping the actual caller authorization', () => {
    const snapshot = DestinationRegistry.unavailable(
      { code: 'REGISTRY_DISCOVERY_ERROR', message: 'Discovery failed.' },
      enforced,
    );
    const { result, view } = payload(snapshot);
    expect(result.isError).toBe(true);
    expect(view.admin).toMatchObject({ countsComplete: false, authorization: { exactGrantCount: 2 } });
    expect(view.admin).not.toHaveProperty('counts');
    expect(view.admin).not.toHaveProperty('arcRelatedAtLeast');
  });

  it('does not retain invalid fields or unknown property names, without changing validation decisions', () => {
    const source = destination(1, {
      name: 'SECRET_NAME/'.repeat(20_000),
      type: 'SECRET_TYPE'.repeat(20_000),
      arcProperties: { 'arc1.enabled': 'true', ['arc1.SECRET_KEY'.repeat(10_000)]: 'SECRET_VALUE' },
    });
    const snapshot = registry([source]);
    expect(snapshot.targets).toHaveLength(0);
    expect(snapshot.diagnostics[0].code).toBe('UNKNOWN_ARC1_PROPERTY');
    const { view, result } = payload(snapshot);
    expect(view.admin.destinations[0]).not.toHaveProperty('destinationName');
    expect(view.admin.destinations[0]).not.toHaveProperty('type');
    expect(view.admin.destinations[0].arcConfig).toEqual({ enabled: true, unknownPropertyCount: 1 });
    expect(JSON.stringify(snapshot)).not.toMatch(/SECRET_NAME|SECRET_TYPE|SECRET_KEY|SECRET_VALUE/);
    expect(JSON.stringify(result)).not.toMatch(/SECRET_NAME|SECRET_TYPE|SECRET_KEY|SECRET_VALUE/);
  });

  it('keeps explicit write and unknown-key facts after strict discovery projection and during drift checks', () => {
    const source = projectMultiTargetDestination(
      {
        Name: 'DEST_001',
        Type: 'HTTP',
        Authentication: 'PrincipalPropagation',
        ProxyType: 'OnPremise',
        URL: 'https://sap.invalid',
        User: '',
        Password: '',
        originalProperties: {
          'arc1.enabled': 'true',
          'arc1.SECRET_KEY': 'SECRET_VALUE',
          'arc1.allow_writes': 'false',
          'sap-sysid': 'A4H',
          'sap-client': '001',
        },
      } as Destination,
      enforced,
    )!;
    expect(source.arcProperties).toEqual({ 'arc1.enabled': 'true' });
    expect(source.arcValidation).toEqual({ unknownPropertyCount: 2, hasWriteProperty: true });
    expect(JSON.stringify(source)).not.toMatch(/SECRET_KEY|SECRET_VALUE|allow_writes/);
    expect(registry([source]).diagnostics[0].code).toBe('UNSUPPORTED_V1_WRITE_CONFIG');
    expect(evaluateStandaloneTargetDescriptor(source, config)).toBeUndefined();
  });

  it('rejects a complete oversized safe snapshot and never accepts a shortened partial inventory', () => {
    const snapshot = registry(
      Array.from({ length: 256 }, (_, i) =>
        destination(i, {
          name: `${String(i).padStart(3, '0')}${'A'.repeat(197)}`,
          description: '"'.repeat(160),
          authentication: 'BasicAuthentication',
        }),
      ),
    );
    expect(snapshot.failure?.code).toBe('CATALOG_SIZE_LIMIT_EXCEEDED');
    expect(snapshot.targets).toEqual([]);
    expect(payload(snapshot).result.isError).toBe(true);
  });

  it('retains legacy output and paging without introducing authorization or count metadata', () => {
    const snapshot = registry(
      Array.from({ length: 70 }, (_, i) => destination(i)),
      false,
    );
    const legacy = buildTargetCatalog(snapshot, { admin: true, query: 'DEST_', offset: 50 }) as Record<string, any>;
    expect(legacy.admin.destinations).toHaveLength(20);
    expect(legacy.admin.diagnosticOffset).toBe(50);
    expect(legacy.admin).not.toHaveProperty('authorization');
    expect(legacy.admin).not.toHaveProperty('countsComplete');
  });

  it('fails the defensive serialization guard without mutating a previously accepted registry', () => {
    const snapshot = registry(
      Array.from({ length: 256 }, (_, i) =>
        destination(i, {
          name: `${String(i).padStart(3, '0')}${'A'.repeat(197)}`,
          description: '"'.repeat(160),
          authentication: 'BasicAuthentication',
        }),
      ),
      false,
    );
    const { result, view } = payload(snapshot, {
      runtimeAuth: () => ({
        status: 'temporarily_unavailable',
        checkedAt: '2026-09-15T12:00:00.000Z',
      }),
    });
    expect(result.isError).toBe(true);
    expect(view.admin.failure.code).toBe('CATALOG_SIZE_LIMIT_EXCEEDED');
    expect(view.targets).toEqual([]);
    expect(view.admin.destinations).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(TARGET_CATALOG_MAX_RESULT_BYTES);
    expect(snapshot.available).toBe(true);
    expect(snapshot.targets).toHaveLength(256);
  });

  it('projects passive state through fixed categories and timestamps, not arbitrary callback fields', () => {
    const snapshot = registry([destination(1, { authentication: 'BasicAuthentication' })]);
    const { result, view } = payload(snapshot, {
      runtimeAuth: () => ({
        status: 'SECRET_STATUS'.repeat(1_000),
        checkedAt: 'SECRET_TIME',
        password: 'SECRET_PASSWORD',
      }),
    });
    expect(view.admin.sharedAuthentication.exceptions).toEqual([
      { target: 'A4H/001', status: 'temporarily_unavailable' },
    ]);
    expect(JSON.stringify(result)).not.toContain('SECRET_');
  });
});

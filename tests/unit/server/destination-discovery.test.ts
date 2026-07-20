import type { Destination } from '@arc-mcp/xsuaa-auth/btp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listDestinationsAtLevel = vi.fn();
vi.mock('@arc-mcp/xsuaa-auth/btp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arc-mcp/xsuaa-auth/btp')>()),
  listDestinationsAtLevel,
}));

const { discoverDestinations, projectMultiTargetDestination } = await import(
  '../../../src/server/destination-discovery.js'
);

function reachableStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value as Record<string, unknown>).flatMap((entry) => reachableStrings(entry, seen));
}

const btpConfig = {
  destinationUrl: 'https://dest.example',
  destinationClientId: 'id',
  destinationSecret: 'secret',
  destinationTokenUrl: 'https://token.example',
  xsuaaUrl: '',
  xsuaaClientId: '',
  xsuaaSecret: '',
  connectivityProxyHost: '',
  connectivityProxyPort: '',
  connectivityClientId: '',
  connectivitySecret: '',
  connectivityTokenUrl: '',
};

describe('discoverDestinations', () => {
  beforeEach(() => listDestinationsAtLevel.mockReset());

  it('projects ARC-related subaccount entries and instance names only', async () => {
    listDestinationsAtLevel.mockImplementation(async (_config, level: string) =>
      level === 'subaccount'
        ? [
            {
              Name: 'ARC1_A4H_100_PP',
              Type: 'HTTP',
              URL: 'http://a4h.internal:50000',
              Authentication: 'PrincipalPropagation',
              ProxyType: 'OnPremise',
              User: 'SENTINEL_USER',
              Password: 'SENTINEL_PASSWORD',
              Preemptive: 'true',
              CloudConnectorLocationId: 'SENTINEL_LOCATION',
              'sap-client': '100',
              originalProperties: {
                Name: 'ARC1_A4H_100_PP',
                Type: 'HTTP',
                URL: 'http://a4h.internal:50000',
                Authentication: 'PrincipalPropagation',
                ProxyType: 'OnPremise',
                User: 'SENTINEL_USER',
                Password: 'SENTINEL_PASSWORD',
                Preemptive: 'true',
                'sap-sysid': 'A4H',
                'sap-client': '100',
                Description: 'A4H dev',
                'arc1.enabled': 'true',
                'arc1.target_alias': 'A4H-2025',
                'arc1.unknown_secret': 'SENTINEL_ARC_PROPERTY',
              },
            },
            {
              Name: 'UNRELATED',
              Type: 'HTTP',
              URL: 'https://unrelated',
              Authentication: 'NoAuthentication',
              ProxyType: 'Internet',
              User: '',
              Password: 'UNRELATED_SECRET',
              originalProperties: { Name: 'UNRELATED', 'sap-sysid': 'ZZZ' },
            },
          ]
        : [
            {
              Name: 'INSTANCE_NAME',
              URL: 'https://must-not-survive',
              Authentication: 'BasicAuthentication',
              ProxyType: 'Internet',
              User: 'user',
              Password: 'INSTANCE_SECRET',
              originalProperties: { Name: 'INSTANCE_NAME', Password: 'INSTANCE_SECRET' },
            },
          ],
    );

    const result = await discoverDestinations(btpConfig);
    expect(result.subaccount).toEqual([
      expect.objectContaining({
        name: 'ARC1_A4H_100_PP',
        sapSysId: 'A4H',
        sapClient: '100',
        preemptive: 'true',
        arcProperties: expect.objectContaining({ 'arc1.target_alias': 'A4H-2025' }),
      }),
    ]);
    expect(result.instanceNames).toEqual(['INSTANCE_NAME']);
    expect(result.scannedCount).toBe(2);
    expect(result.unrelatedCount).toBe(0);
    expect(result.arcAdjacentWithoutMarkerCount).toBe(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SENTINEL_PASSWORD');
    expect(serialized).not.toContain('SENTINEL_USER');
    expect(serialized).not.toContain('INSTANCE_SECRET');
    expect(serialized).not.toContain('UNRELATED_SECRET');
    expect(serialized).not.toContain('must-not-survive');
    expect(serialized).not.toContain('a4h.internal');
    expect(serialized).not.toContain('SENTINEL_LOCATION');
    expect(serialized).not.toContain('SENTINEL_ARC_PROPERTY');
    const reachable = reachableStrings(result);
    expect(reachable).not.toContain('SENTINEL_PASSWORD');
    expect(reachable).not.toContain('SENTINEL_USER');
    expect(reachable).not.toContain('SENTINEL_LOCATION');
    expect(reachable).not.toContain('SENTINEL_ARC_PROPERTY');
    expect(reachable).not.toContain('http://a4h.internal:50000');
    expect(Object.keys(result.subaccount[0])).not.toContain('User');
    expect(Object.keys(result.subaccount[0])).not.toContain('Password');
    expect(Object.keys(result.subaccount[0])).not.toContain('hasUser');
    expect(Object.keys(result.subaccount[0])).not.toContain('hasPassword');
  });

  it('preserves explicit non-string Preemptive values for fail-closed registry validation', () => {
    const projected = projectMultiTargetDestination({
      Name: 'ARC1_BASIC',
      Type: 'HTTP',
      URL: 'https://sap.internal',
      Authentication: 'BasicAuthentication',
      ProxyType: 'OnPremise',
      User: 'SENTINEL_USER',
      Password: 'SENTINEL_PASSWORD',
      originalProperties: {
        'arc1.enabled': 'true',
        Preemptive: false,
      },
    } as unknown as Destination);

    expect(projected?.preemptive).toBe('false');
    expect(JSON.stringify(projected)).not.toContain('SENTINEL_USER');
    expect(JSON.stringify(projected)).not.toContain('SENTINEL_PASSWORD');
  });
});

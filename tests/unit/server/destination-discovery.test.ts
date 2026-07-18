import { beforeEach, describe, expect, it, vi } from 'vitest';

const listDestinationsAtLevel = vi.fn();
vi.mock('@arc-mcp/xsuaa-auth/btp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@arc-mcp/xsuaa-auth/btp')>()),
  listDestinationsAtLevel,
}));

const { discoverDestinations } = await import('../../../src/server/destination-discovery.js');

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
              User: '',
              Password: 'SENTINEL_PASSWORD',
              CloudConnectorLocationId: 'SENTINEL_LOCATION',
              'sap-client': '100',
              originalProperties: {
                Name: 'ARC1_A4H_100_PP',
                Type: 'HTTP',
                URL: 'http://a4h.internal:50000',
                Authentication: 'PrincipalPropagation',
                ProxyType: 'OnPremise',
                Password: 'SENTINEL_PASSWORD',
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
        arcProperties: expect.objectContaining({ 'arc1.target_alias': 'A4H-2025' }),
      }),
    ]);
    expect(result.instanceNames).toEqual(['INSTANCE_NAME']);
    expect(result.scannedCount).toBe(2);
    expect(result.unrelatedCount).toBe(0);
    expect(result.arcAdjacentWithoutMarkerCount).toBe(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SENTINEL_PASSWORD');
    expect(serialized).not.toContain('INSTANCE_SECRET');
    expect(serialized).not.toContain('UNRELATED_SECRET');
    expect(serialized).not.toContain('must-not-survive');
    expect(serialized).not.toContain('a4h.internal');
    expect(serialized).not.toContain('SENTINEL_LOCATION');
    expect(serialized).not.toContain('SENTINEL_ARC_PROPERTY');
    const reachable = reachableStrings(result);
    expect(reachable).not.toContain('SENTINEL_PASSWORD');
    expect(reachable).not.toContain('SENTINEL_LOCATION');
    expect(reachable).not.toContain('SENTINEL_ARC_PROPERTY');
    expect(reachable).not.toContain('http://a4h.internal:50000');
  });
});

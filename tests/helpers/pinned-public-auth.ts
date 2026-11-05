import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/** Verified middleware output for offline public-route tests, never a real token or principal. */
export function pinnedPublicAuth(scopes = ['read', 'write', 'transports'], target = 'A4H/001'): AuthInfo {
  return {
    token: 'synthetic-verified-token',
    clientId: 'synthetic-client',
    scopes,
    extra: {
      arc1VerifiedRawScopes: [...scopes],
      userName: 'SYNTHETIC',
      xsuaaUserAttributes: { arc1_targets: [target], arc1_write_targets: [target] },
      xsuaaUserAttributeStatus: { arc1_targets: 'valid', arc1_write_targets: 'valid' },
    },
  };
}

/** Older lifecycle fixtures omitted middleware. Add valid defaults only; preserve explicit denial cases. */
export function withVerifiedPinnedDefaults(invoke: typeof import('../../src/handlers/dispatch.js').handleToolCall) {
  return (...args: Parameters<typeof invoke>) => {
    if (args[1].targetId) {
      args[4] ??= pinnedPublicAuth(undefined, args[1].targetId);
      args[7] ??= true;
    }
    return invoke(...args);
  };
}

/** Exercise the real destination and role projection; the legacy transport allowlist stays empty. */
export async function pinnedPublicRuntime(
  serverRequests = ['A4HK900001'],
  destinationRequests = ['A4HK900001'],
  auth = pinnedPublicAuth(),
) {
  const { DEFAULT_CONFIG } = await import('../../src/server/types.js');
  const { DestinationRegistry } = await import('../../src/server/destination-registry.js');
  const { projectMultiTargetRequest } = await import('../../src/server/multi-target-request-projection.js');
  const { buildMultiTargetConfig } = await import('../../src/server/multi-target-runtime.js');
  const base = {
    ...DEFAULT_CONFIG,
    multiTargetEndpoints: true,
    multiTargetAuthorization: 'xsuaa-attribute' as const,
    allowWrites: true,
    allowTransportWrites: true,
    allowedPackages: ['$TMP', 'ZTEAM'],
    allowedTransports: serverRequests,
  };
  const registry = DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: 'SYNTHETIC_PP',
          type: 'HTTP',
          urlState: 'valid',
          urlFingerprint: 'synthetic',
          authentication: 'PrincipalPropagation',
          proxyType: 'OnPremise',
          sapSysId: 'A4H',
          sapClient: '001',
          hasCloudConnectorLocationId: false,
          arcProperties: {
            'arc1.enabled': 'true',
            'arc1.allow_writes': 'true',
            'arc1.allowed_packages': '$TMP,ZTEAM',
            'arc1.allowed_transports': destinationRequests.join(','),
          },
        },
      ],
      instanceNames: [],
      scannedCount: 1,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    base,
  );
  return buildMultiTargetConfig(base, registry.targets[0], {
    mode: 'pinned',
    authorization: projectMultiTargetRequest(registry, auth),
  });
}

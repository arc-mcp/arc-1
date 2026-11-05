/** Qualification-local policy/context only. It neither changes the app nor proves Principal Propagation. */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { AdtClient } from '../../../src/adt/client.js';
import { fetchDiscoveryDocument } from '../../../src/adt/discovery.js';
import { cacheFeatureEvidence, setCachedDiscovery } from '../../../src/handlers/feature-cache.js';
import { ddicConfig } from './native-ddic-workflow.js';
export function rapConfig(generated = false, publication = false) {
  const base = ddicConfig();
  return {
    ...base,
    multiTargetEndpoints: true,
    multiTargetAuthorization: 'xsuaa-attribute' as const,
    ppEnabled: true,
    ppStrict: true,
    allowedPackages: generated ? ['*'] : ['$TMP'],
    multiTargetWrite: {
      ...base.multiTargetWrite,
      allowedPackages: generated ? ['*'] : ['$TMP'],
      allowedTransports: generated || publication ? ['*'] : [],
      serverAllowedTransports: generated || publication ? ['*'] : [],
    },
  };
}
export function rapInternalIdentity(): AuthInfo {
  return {
    token: 'fixed-native-qualification-context-not-an-oauth-token',
    clientId: 'fixed-native-qualification',
    scopes: ['read', 'write'],
    extra: {
      arc1VerifiedRawScopes: ['read', 'write'],
      xsuaaUserAttributes: { arc1_targets: ['A4H/001'], arc1_write_targets: ['A4H/001'] },
      xsuaaUserAttributeStatus: { arc1_targets: 'valid', arc1_write_targets: 'valid' },
    },
  };
}
export async function rapCapabilities(client: AdtClient, documents = false) {
  const { map } = await fetchDiscoveryDocument(client.http);
  for (const path of [
    '/sap/bc/adt/ddic/tables',
    '/sap/bc/adt/ddic/ddl/sources',
    '/sap/bc/adt/bo/behaviordefinitions',
    '/sap/bc/adt/businessservices/bindings',
    ...(documents ? ['/sap/bc/adt/documentation/ktd/documents'] : []),
  ])
    if (!map.has(path)) throw new Error('RAP native discovery contract unavailable.');
  client.http.setDiscoveryMap(map);
  setCachedDiscovery(map, 'A4H/001');
  cacheFeatureEvidence(
    {
      rap: {
        id: 'rap',
        mode: 'auto',
        available: true,
        message: 'The native discovery response advertises the fixed RAP collections.',
      },
    },
    false,
    'A4H/001',
  );
}

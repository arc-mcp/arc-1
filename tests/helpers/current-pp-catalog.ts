import { getToolDefinitions } from '../../src/handlers/tools.js';
import { DestinationRegistry } from '../../src/server/destination-registry.js';
import { projectMultiTargetRequest } from '../../src/server/multi-target-request-projection.js';
import { buildMultiTargetConfig } from '../../src/server/multi-target-runtime.js';
import { finalizeMultiTargetToolAnnotations, multiTargetToolDefinitions } from '../../src/server/multi-target-tools.js';
import { filterToolsByAuthScope } from '../../src/server/tool-auth.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { pinnedPublicAuth } from './pinned-public-auth.js';

/** Actual selected-target configuration and tools/list projection, with synthetic verified middleware. */
export function currentPpCatalog(
  scopes: string[],
  options: { destinationWrites?: boolean; management?: boolean; requests?: string[] } = {},
) {
  const base = {
    ...DEFAULT_CONFIG,
    multiTargetEndpoints: true,
    multiTargetAuthorization: 'xsuaa-attribute' as const,
    allowWrites: true,
    allowTransportWrites: options.management ?? false,
    allowedPackages: ['$TMP', 'ZARC1_PP'],
    allowedTransports: options.requests ?? ['A4HK900001'],
  };
  const registry = DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: 'CURRENT_PP_SYNTHETIC',
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
            'arc1.allow_writes': String(options.destinationWrites ?? true),
            'arc1.allowed_packages': '$TMP,ZARC1_PP',
            'arc1.allowed_transports': base.allowedTransports.join(','),
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
  const projection = projectMultiTargetRequest(registry, pinnedPublicAuth(scopes));
  const config = buildMultiTargetConfig(base, registry.targets[0], { mode: 'pinned', authorization: projection });
  const tools = finalizeMultiTargetToolAnnotations(
    filterToolsByAuthScope(
      multiTargetToolDefinitions(getToolDefinitions(config), config),
      [...projection.scopes],
      config.denyActions,
    ),
  );
  return { config, tools };
}

/** Reject alternate independent connections before any startup authentication or network contact. */

import type { BTPConfig } from '@arc-mcp/xsuaa-auth/btp';
import { DestinationRegistry } from './destination-registry.js';
import { logger } from './logger.js';
import { MULTI_TARGET_MAX } from './multi-target-identity.js';
import type { ServerConfig } from './types.js';

/** Registry discovery uses the same mode as request enforcement and its catalog limits. */
export async function discoverMultiTargetRegistry(
  config: ServerConfig,
  btpConfig: BTPConfig,
): Promise<DestinationRegistry> {
  logger.info(
    config.multiTargetAuthorization === 'xsuaa-attribute'
      ? `Multi-target authorization enforced; catalog bounded to ${MULTI_TARGET_MAX} ARC-related destinations.`
      : 'Legacy multi-target authorization: per-target grants are not enforced.',
    { mode: config.multiTargetAuthorization ?? 'legacy' },
  );
  const options = { authorizationMode: config.multiTargetAuthorization };
  try {
    const { discoverDestinations } = await import('./destination-discovery.js');
    return DestinationRegistry.fromDiscovery(await discoverDestinations(btpConfig, options), config, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Destination discovery failed.';
    logger.error('Multi-target destination discovery failed', { error: message });
    return DestinationRegistry.unavailable({ code: 'REGISTRY_DISCOVERY_ERROR', message }, options);
  }
}

export function assertMultiTargetAuthorizationStartup(
  config: ServerConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (config.multiTargetAuthorization !== 'xsuaa-attribute') return;
  if (!config.multiTargetEndpoints) {
    throw new Error('ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute requires ARC1_MULTI_TARGET_ENDPOINTS=true.');
  }
  if (
    config.url ||
    config.username ||
    config.password ||
    config.destinationName ||
    config.btpServiceKey ||
    config.btpServiceKeyFile ||
    env.SAP_BTP_DESTINATION ||
    env.SAP_BTP_PP_DESTINATION
  ) {
    throw new Error(
      'Enforced multi-target authorization requires a multi-only deployment. Remove single-target connection settings; use a separate application and XSUAA identity for single-target access.',
    );
  }
}

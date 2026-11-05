import { PINNED_MUTATION_CAPABILITIES } from './pinned-mutation-capabilities.js';
import type { ServerConfig } from './types.js';

export const MULTI_TARGET_SCOPES_SUPPORTED = Object.freeze(['read', 'data', 'sql', 'admin']);

/** Instance-only projection: unauthenticated OAuth metadata must never look up a destination. */
export function pinnedProtectedResourceScopes(config: ServerConfig): readonly string[] {
  if (!config.allowWrites || config.multiTargetAuthorization !== 'xsuaa-attribute')
    return MULTI_TARGET_SCOPES_SUPPORTED;
  const transportAdmitted = PINNED_MUTATION_CAPABILITIES.some((capability) => capability.tool === 'SAPTransport');
  return [
    ...MULTI_TARGET_SCOPES_SUPPORTED,
    'write',
    ...(config.allowTransportWrites && transportAdmitted ? ['transports'] : []),
  ];
}

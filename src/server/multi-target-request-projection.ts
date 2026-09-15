/** Caller-specific, immutable authorization input created before the MCP handshake. */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { hasRequiredScope } from '../authz/policy.js';
import type { DestinationRegistry, TargetDescriptor } from './destination-registry.js';
import { parseTargetGrant, projectGrantedTargets, type TargetGrant } from './multi-target-authorization.js';

export interface MultiTargetRequestProjection {
  readonly grant: TargetGrant;
  readonly targets: readonly TargetDescriptor[];
  readonly scopes: readonly string[];
  readonly read: boolean;
  readonly admin: boolean;
}

/** AuthInfo must originate from the route's XSUAA-only verifier, never a decoded JWT. */
export function projectMultiTargetRequest(
  registry: DestinationRegistry,
  authInfo?: AuthInfo,
): MultiTargetRequestProjection {
  const scopes = [...(authInfo?.scopes ?? [])];
  const read = hasRequiredScope(scopes, 'read');
  const grant = parseTargetGrant(authInfo);
  return Object.freeze({
    grant,
    scopes: Object.freeze(scopes),
    read,
    admin: read && hasRequiredScope(scopes, 'admin'),
    targets: read && registry.available ? projectGrantedTargets(registry.targets, grant) : Object.freeze([]),
  });
}

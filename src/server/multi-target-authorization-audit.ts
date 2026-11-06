/** Operator-only grant failure evidence; never serialize claims or role names. */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { logger } from './logger.js';
import type { TargetGrant } from './multi-target-authorization.js';

export function auditTargetGrantDenial(
  grant: TargetGrant,
  authInfo: AuthInfo | undefined,
  requestId: string,
  tool: string,
  target?: string,
): void {
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: 'warn',
    event: 'target_resolution_failed',
    requestId,
    user: authInfo?.extra?.userName as string | undefined,
    clientId: authInfo?.clientId,
    tool,
    target,
    errorCode: grant.mode === 'none' ? grant.status : 'TARGET_NOT_GRANTED',
    targetAccessMode: 'xsuaa-attribute',
    grantMode: grant.mode,
    ...(grant.mode === 'exact' ? { exactGrantCount: grant.exactGrantCount } : {}),
  });
}

/** Secret-free startup summary for the configured MCP and SAP identity topology. */

import { logger } from './logger.js';
import type { ServerConfig } from './types.js';

export function logAuthSummary(config: ServerConfig): void {
  const mcpMethods: string[] = [];
  const hasApiKeys = !!config.apiKeys?.length;
  if (hasApiKeys) mcpMethods.push('api-keys');
  if (config.oidcIssuer && config.oidcAudience) mcpMethods.push('oidc');
  if (config.xsuaaAuth) mcpMethods.push('xsuaa');
  if (mcpMethods.length === 0) mcpMethods.push('none');

  const hasCookie = !!(config.cookieFile || config.cookieString);
  const hasBearer = !!(config.btpServiceKey || config.btpServiceKeyFile);
  const hasDestination = !!process.env.SAP_BTP_DESTINATION;
  const hasBasic = !!(config.username && config.password);

  let sapMethod = 'none';
  if (config.multiTargetEndpoints) {
    const multiIdentity = config.multiTargetAllowBasicAuth ? 'destination+pp/basic-shared' : 'destination+pp';
    sapMethod = hasDestination ? `${multiIdentity} (single-target + multi-target)` : `${multiIdentity} (multi-target)`;
  } else if (config.ppEnabled) {
    if (hasDestination) sapMethod = 'destination+pp';
    else if (hasCookie) sapMethod = 'cookie+pp';
    else sapMethod = 'pp';
  } else if (hasBearer) {
    sapMethod = 'bearer';
  } else if (hasDestination) {
    sapMethod = 'destination';
  } else if (hasBasic && hasCookie) {
    sapMethod = 'basic+cookie';
  } else if (hasCookie) {
    sapMethod = 'cookie';
  } else if (hasBasic) {
    sapMethod = 'basic';
  }

  const strictPpOnly = config.ppEnabled && config.ppStrictExplicit && config.ppStrict;
  const mixedSapIdentity = config.ppEnabled && hasApiKeys && !strictPpOnly;
  const scope =
    config.multiTargetEndpoints && config.multiTargetAllowBasicAuth
      ? 'per-target: PP per-user or Basic shared'
      : mixedSapIdentity
        ? 'mixed: JWT per-user, API keys shared'
        : config.ppEnabled
          ? 'per-user'
          : 'shared';
  const samlSuffix = config.disableSaml2 ? ' disable-saml=on' : '';
  logger.info(`auth: MCP=[${mcpMethods.join(',')}] SAP=${sapMethod} (${scope})${samlSuffix}`);

  if (mixedSapIdentity) {
    logger.warn(
      'auth topology: PP and API-key calls use different SAP identities. Mixed mode is supported. ' +
        'Separate instances are recommended for clearer SAP identity and audit boundaries; set SAP_PP_STRICT=true ' +
        'on the PP instance when using that topology.',
    );
  } else if (strictPpOnly && hasApiKeys) {
    logger.warn(
      'auth topology: ARC1_API_KEYS is configured but SAP_PP_STRICT=true rejects API-key MCP tool calls. ' +
        'Set SAP_PP_STRICT=false for supported mixed operation, or remove/move the keys for a strict PP topology.',
    );
  }
}

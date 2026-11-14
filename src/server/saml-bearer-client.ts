/**
 * PROTOTYPE: per-user ADT client backed by a locally issued SAML 2.0 bearer assertion.
 *
 * Used by `createServer` for JWT-authenticated calls when the local SAML issuer is configured.
 * No BTP destination, no Cloud Connector and no shared-credential fallback: a failure here is a
 * tool error for the JWT-authenticated call, mirroring the destination-based PP branch.
 */
import { AdtClient } from '../adt/client.js';
import type { AdtClientConfig } from '../adt/config.js';
import {
  buildSamlBearerAssertion,
  loadSamlBearerIdp,
  resolveSamlNameId,
  type SamlBearerIdp,
} from '../adt/saml-bearer.js';
import { logger } from './logger.js';
import type { ServerConfig } from './types.js';

export const SAML_BEARER_DESTINATION_LABEL = 'local-saml-bearer';

/** Load the issuer once at startup and log its (non-secret) trust parameters. */
export function loadSamlBearerIssuer(config: ServerConfig): SamlBearerIdp | undefined {
  const idp = loadSamlBearerIdp(config);
  if (idp) {
    logger.info('Principal propagation: local SAML bearer issuer enabled (prototype)', {
      issuer: idp.issuer,
      audience: idp.audience,
      recipient: idp.recipient,
      nameIdClaim: idp.nameIdClaim,
      nameIdFormat: idp.nameIdFormat,
      ttlSeconds: idp.ttlSeconds,
    });
  }
  return idp;
}

export interface SamlBearerClientRequest {
  idp: SamlBearerIdp;
  /** Verified user JWT (signature already checked by the HTTP auth middleware). */
  token: string;
  requestId: string;
  /** Fallback audit user label when the NameID cannot be resolved. */
  fallbackUser?: string;
  /** Builds the per-user base config (`buildAdtConfig(..., { perUser: true })`). */
  buildPerUserAdtConfig: () => Partial<AdtClientConfig>;
}

export type SamlBearerClientResult =
  | { ok: true; client: AdtClient; nameId: string }
  | { ok: false; error: { content: Array<{ type: 'text'; text: string }>; isError: true } };

/** Mint a fresh assertion for the caller and build a request-local per-user client. */
export function createSamlBearerPerUserClient(request: SamlBearerClientRequest): SamlBearerClientResult {
  const { idp, token, requestId, buildPerUserAdtConfig } = request;
  let user = request.fallbackUser;
  try {
    const nameId = resolveSamlNameId(token, idp.nameIdClaim);
    user = nameId;
    const assertion = buildSamlBearerAssertion(idp, nameId);
    const adtConfig = buildPerUserAdtConfig();
    adtConfig.samlAuthorization = assertion.authorization;
    adtConfig.username = nameId; // display only; SAP derives the identity from the assertion
    adtConfig.password = undefined;
    adtConfig.http = undefined; // never reuse a transport that may carry another identity's cookies
    const client = new AdtClient(adtConfig);
    logger.emitAudit({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'auth_pp_created',
      requestId,
      user,
      destination: SAML_BEARER_DESTINATION_LABEL,
      success: true,
      transportReuse: 'request-local',
    });
    return { ok: true, client, nameId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.emitAudit({
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'auth_pp_created',
      requestId,
      user,
      destination: SAML_BEARER_DESTINATION_LABEL,
      success: false,
      errorMessage,
    });
    return {
      ok: false,
      error: { content: [{ type: 'text', text: `Principal propagation failed: ${errorMessage}` }], isError: true },
    };
  }
}

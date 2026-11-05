import { postToken } from './oauth-requests.mjs';
import { HarnessError, validateBaseUrl } from './safe-io.mjs';

/** The assertion must first be validated as a user of the primary application by the caller. */
export async function exchangeForeignUser({ assertion, primary, foreign, expected, auth, xssec }) {
  for (const field of ['clientid', 'clientsecret', 'url', 'xsappname', 'uaadomain']) {
    if (typeof foreign?.[field] !== 'string' || !foreign[field]) throw new HarnessError('INVALID_FOREIGN_CREDENTIALS');
  }
  // This fixture is intentionally same-tenant only; never send a user assertion to another host.
  if (
    validateBaseUrl(primary.url).origin !== validateBaseUrl(foreign.url).origin ||
    primary.xsappname === foreign.xsappname ||
    primary.clientid === foreign.clientid
  )
    throw new HarnessError('DISTINCT_SAME_TENANT_APPLICATION_REQUIRED');
  if (
    !expected ||
    typeof expected.email !== 'string' ||
    !expected.email.trim() ||
    typeof expected.origin !== 'string' ||
    !expected.origin.trim() ||
    !Array.isArray(expected.scopes) ||
    expected.scopes.length > 7 ||
    expected.scopes.some((scope) => !['read', 'data', 'sql', 'admin', 'write', 'git', 'transports'].includes(scope)) ||
    !Array.isArray(expected.grantValues) ||
    !expected.grantValues.length ||
    expected.grantValues.length > 256 ||
    expected.grantValues.some((value) => typeof value !== 'string' || !value)
  )
    throw new HarnessError('FOREIGN_IDENTITY_AND_GRANTS_REQUIRED');
  const token = await postToken(
    new URL('/oauth/token', foreign.url),
    {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    },
    { Authorization: `Basic ${Buffer.from(`${foreign.clientid}:${foreign.clientsecret}`).toString('base64')}` },
  );
  // Verify with the actual issuing application's service, not just a decoded token or a 401 on ARC.
  const context = await new xssec.XsuaaService(foreign).createSecurityContext(token.access_token);
  const verified = await auth.createXsuaaTokenVerifier(foreign, {
    requireUserToken: true,
    userAttributeNames: ['arc1_targets'],
  })(token.access_token);
  const values = verified.extra?.xsuaaUserAttributes?.arc1_targets;
  const sorted = (array) => JSON.stringify([...new Set(array)].sort());
  if (
    context.getEmail() !== expected.email ||
    context.getOrigin() !== expected.origin ||
    verified.extra?.xsuaaUserAttributeStatus?.arc1_targets !== 'valid' ||
    !Array.isArray(values) ||
    sorted(verified.scopes ?? []) !== sorted(expected.scopes) ||
    sorted(values) !== sorted(expected.grantValues)
  )
    throw new HarnessError('FOREIGN_USER_FIXTURE_MISMATCH');
  return {
    token,
    sourceEvidence: {
      distinctApplication: true,
      verifiedUser: true,
      expectedIdentityMatched: true,
      exactAttributeValuesMatched: true,
      exactLocalScopesMatched: true,
      attributeCount: values.length,
    },
  };
}

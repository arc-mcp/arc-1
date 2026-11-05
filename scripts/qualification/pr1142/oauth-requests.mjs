import { boundedFetch, HarnessError, validateBaseUrl } from './safe-io.mjs';

const LOCAL_SCOPES = new Set(['read', 'data', 'sql', 'admin', 'write', 'git', 'transports']);

export async function postToken(url, params, headers = {}) {
  const response = await boundedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params),
  });
  if (response.status !== 200 || typeof response.json?.access_token !== 'string' || !response.json.access_token)
    throw new HarnessError('OAUTH_TOKEN_EXCHANGE_FAILED', response.status);
  if (typeof response.json.token_type !== 'string' || response.json.token_type.toLowerCase() !== 'bearer')
    throw new HarnessError('UNSUPPORTED_TOKEN_TYPE');
  // Keep only supported fields, in memory. Provider extensions never enter a report.
  return {
    access_token: response.json.access_token,
    ...(typeof response.json.refresh_token === 'string' ? { refresh_token: response.json.refresh_token } : {}),
  };
}

export async function clientCredentialsToken(credentials, scopes) {
  const base = validateBaseUrl(credentials.url);
  if (
    scopes !== undefined &&
    (!Array.isArray(scopes) || scopes.length > LOCAL_SCOPES.size || scopes.some((scope) => !LOCAL_SCOPES.has(scope)))
  )
    throw new HarnessError('INVALID_MACHINE_SCOPES');
  // Omit scope by default: request the real authorities configured on this service client.
  // Asking for admin here does not manufacture the corresponding XSUAA client authority.
  return postToken(
    new URL('/oauth/token', base),
    {
      grant_type: 'client_credentials',
      ...(scopes?.length ? { scope: scopes.map((scope) => `${credentials.xsappname}.${scope}`).join(' ') } : {}),
    },
    {
      Authorization: `Basic ${Buffer.from(`${credentials.clientid}:${credentials.clientsecret}`).toString('base64')}`,
    },
  );
}

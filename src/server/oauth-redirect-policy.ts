/**
 * Redirect patterns for ARC-1's pre-registered XSUAA client.
 *
 * These are CLIENT callbacks. They are deliberately separate from XSUAA's
 * upstream callback allowlist in mta.yaml/xs-security.json: the OAuth proxy
 * sends XSUAA ARC-1's own `/oauth/callback` and carries the client's callback
 * inside signed state. ARC-1 is therefore the authority for this list.
 *
 * DCR clients are not broadened by these patterns. Their exact redirect URIs
 * are embedded in the HMAC-signed client_id and checked again at callback time.
 */
export const ARC1_MANUAL_CLIENT_REDIRECT_URI_PATTERNS = [
  'http://localhost:*/**',
  'https://claude.ai/api/mcp/auth_callback',
  'https://callback.mistral.ai/v1/integrations_auth/oauth2_callback',
  'cursor://anysphere.cursor-retrieval/**',
  'cursor://anysphere.cursor-mcp/**',
  'vscode://vscode.microsoft-authentication/**',
  'https://global.consent.azure-apim.net/redirect/**',
] as const;

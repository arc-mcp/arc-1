import { createHash } from 'node:crypto';

// Callback unit tests supply the same browser binding produced by real approval.
// The production authorize/consent/callback chain is covered separately.
const nonce = 'n'.repeat(43);
export const TEST_BROWSER_BINDING = {
  cookieName: '__Host-mcp-oauth-state-0123456789abcdef-0123456789abcdef',
  digest: createHash('sha256').update(nonce).digest('base64url'),
};
export const TEST_BROWSER_COOKIE = `${TEST_BROWSER_BINDING.cookieName}=${nonce}`;

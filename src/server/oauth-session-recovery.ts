import type { XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import type { RequestHandler, Response } from 'express';

export const OAUTH_LOGGED_OUT_PATH = '/oauth/logged-out';

const CALLBACK_PAGE_TITLE = '<title>Sign-in failed</title>';
const INVALID_SCOPE_MARKER = '<code>invalid_scope</code>';
const CALLBACK_RETURN_LINK = 'Return to your application';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the XSUAA session logout URL used after an administrator grants a
 * missing role collection. Every component comes from trusted server-side
 * configuration; callback query parameters never influence this URL.
 */
export function buildXsuaaSessionRefreshUrl(
  credentials: Pick<XsuaaCredentials, 'url' | 'clientid'>,
  loggedOutUrl: string,
): string {
  const logoutUrl = new URL('/logout.do', credentials.url);
  logoutUrl.searchParams.set('client_id', credentials.clientid);
  logoutUrl.searchParams.set('redirect', loggedOutUrl);
  return logoutUrl.toString();
}

/**
 * Decorate only the auth package's validated loopback invalid_scope page.
 *
 * The package remains responsible for state verification, client binding, and
 * deciding whether a callback is a loopback. ARC-1 adds presentation only after
 * those checks produced the package's exact terminal page. If package markup
 * changes, the recovery action disappears safely and the original response is
 * sent unchanged.
 */
export function withInvalidScopeSessionRecovery(
  callbackHandler: RequestHandler,
  sessionRefreshUrl: string,
): RequestHandler {
  const escapedRefreshUrl = escapeHtml(sessionRefreshUrl);
  const recoveryMarkup =
    `<hr><p><strong>Was a role just assigned?</strong> ` +
    `Refresh your XSUAA access, then start sign-in again from your MCP client.</p>` +
    `<p><a href="${escapedRefreshUrl}">Role assigned? Refresh access</a></p>`;

  return (req, res, next) => {
    const originalSend = res.send;
    res.send = function sendWithSessionRecovery(this: Response, body: Parameters<Response['send']>[0]) {
      const isValidatedInvalidScopePage =
        req.query.error === 'invalid_scope' &&
        res.statusCode === 400 &&
        typeof body === 'string' &&
        body.includes(CALLBACK_PAGE_TITLE) &&
        body.includes(INVALID_SCOPE_MARKER) &&
        body.includes(CALLBACK_RETURN_LINK) &&
        body.includes('</body>');

      const responseBody = isValidatedInvalidScopePage ? body.replace('</body>', `${recoveryMarkup}</body>`) : body;
      return originalSend.call(this, responseBody);
    } as Response['send'];

    return callbackHandler(req, res, next);
  };
}

/** Public, fixed landing page after XSUAA clears the browser session. */
export function createOAuthLoggedOutHandler(): RequestHandler {
  return (_req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .status(200)
      .type('html')
      .send(
        '<!doctype html><html><head><meta charset="utf-8"><title>Access refreshed</title></head>' +
          '<body style="font-family:sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem;line-height:1.5">' +
          '<h1>Access refreshed</h1>' +
          '<p>Your XSUAA browser session was cleared. Return to your MCP client and connect or retry sign-in.</p>' +
          '<p>You may be asked to sign in again. ARC-1 does not revoke access tokens already issued to other sessions.</p>' +
          '</body></html>',
      );
  };
}

/**
 * App public-URL resolution for ARC-1's OAuth metadata.
 *
 * This stays ARC-1-local (it is NOT a principal-propagation concern, so it does
 * not belong in `@arc-mcp/xsuaa-auth/btp`). The package ships its own
 * `resolveAppUrl`, but its fallback behavior differs (it can fall back to a
 * bind-host:port) — ARC-1 deliberately returns `undefined` when neither
 * ARC1_PUBLIC_URL nor VCAP_APPLICATION is set, and the caller in `http.ts`
 * applies its own `http://<bindHost>:<port>` fallback. Keeping `getAppUrl`
 * verbatim here preserves that behavior exactly (SPEC §10 — `getAppUrl` is
 * consumer-owned).
 */

/**
 * Get the app's public URL.
 *
 * Priority:
 *   1. ARC1_PUBLIC_URL env var — set this when the app is reached through a
 *      reverse proxy on a different hostname (e.g. SAP Integration Suite API
 *      Management). The value flows into every absolute URL the OAuth metadata
 *      endpoints emit (issuer, authorize, token, register, revoke, resource).
 *      May include a base-path component (e.g. https://api.example.com/arc1) —
 *      the path is preserved verbatim.
 *   2. VCAP_APPLICATION.application_uris[0] — set automatically by CF, points
 *      to the app's CF route.
 *   3. undefined — caller falls back to bind-host:port.
 *
 * The trailing slash, if present, is stripped so callers can do `${url}/path`
 * consistently.
 */
export function getAppUrl(): string | undefined {
  const override = process.env.ARC1_PUBLIC_URL?.trim();
  if (override) {
    return override.replace(/\/$/, '');
  }

  const vcapApp = process.env.VCAP_APPLICATION;
  if (!vcapApp) return undefined;

  try {
    const app = JSON.parse(vcapApp);
    const uris = app.application_uris ?? app.uris;
    if (Array.isArray(uris) && uris.length > 0) {
      return `https://${uris[0]}`;
    }
  } catch {
    // Not valid JSON
  }
  return undefined;
}

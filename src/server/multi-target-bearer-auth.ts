/** Explicit principal-error adapter; the MCP SDK otherwise maps custom verifier errors to 500. */
import { type Verifier, XsuaaUserTokenRequiredError } from '@arc-mcp/xsuaa-auth';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { RequestHandler } from 'express';

export function requireXsuaaUserBearerAuth(verifier: Verifier, resourceMetadataUrl: string): RequestHandler {
  return async (req, res, next) => {
    // Keep the SDK's header parsing and token-expiry checks authoritative. Only valid-looking
    // headers need preverification so the typed principal rejection can retain HTTP 403.
    const [kind, token] = req.headers.authorization?.split(' ') ?? [];
    if (kind?.toLowerCase() !== 'bearer' || !token) {
      await requireBearerAuth({ verifier: { verifyAccessToken: verifier }, resourceMetadataUrl })(req, res, next);
      return;
    }
    try {
      const auth = await verifier(token);
      await requireBearerAuth({
        verifier: { verifyAccessToken: async () => auth },
        resourceMetadataUrl,
      })(req, res, next);
    } catch (error) {
      if (error instanceof XsuaaUserTokenRequiredError) {
        res.status(403).json({ error: 'forbidden', error_description: 'A supported XSUAA user token is required.' });
        return;
      }
      // Preserve SDK 401/500 classification without performing signature verification twice.
      await requireBearerAuth({
        verifier: {
          verifyAccessToken: async () => {
            throw error;
          },
        },
        resourceMetadataUrl,
      })(req, res, next);
    }
  };
}

/** Cache policy at the final Node response boundary, including SDK-owned SSE headers. */
import type { Response } from 'express';
import onHeaders from 'on-headers';

const protectedResponses = new WeakSet<Response>();

export function protectPrivateMcpResponse(res: Response): void {
  if (protectedResponses.has(res)) return;
  protectedResponses.add(res);
  res.set('Cache-Control', 'private, no-store');
  onHeaders(res, function () {
    // The MCP SDK writes its own no-cache/no-transform with writeHead(). Preserve
    // its streaming requirement while preventing storage of caller-specific schemas.
    this.setHeader('Cache-Control', 'private, no-store, no-transform');
  });
}

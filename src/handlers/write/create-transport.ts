import type { AdtClient } from '../../adt/client.js';
import { AdtApiError, AdtSafetyError } from '../../adt/errors.js';
import { getTransportInfo } from '../../adt/transport.js';
import { logger } from '../../server/logger.js';

/** Shared single/batch preflight. Package authorization must precede this lookup. */
export async function resolveCreateTransport(
  client: AdtClient,
  objectUrl: string,
  packageName: string,
  minimalErrors: boolean,
): Promise<{ transport?: string; error?: string }> {
  // SAP reserves $-prefixed names for temporary local packages, not only $TMP.
  if (packageName.startsWith('$')) return {};
  let info: Awaited<ReturnType<typeof getTransportInfo>>;
  try {
    info = await getTransportInfo(client.http, client.safety, objectUrl, packageName, 'I');
  } catch (error) {
    if (error instanceof AdtSafetyError || (error instanceof AdtApiError && [401, 403].includes(error.statusCode))) {
      throw error;
    }
    // Optional on older systems; the create endpoint still enforces CTS requirements.
    logger.warn('SAPWrite transport preflight unavailable; continuing without auto transport', {
      package: packageName,
      ...(error instanceof AdtApiError ? { statusCode: error.statusCode } : {}),
    });
    return {};
  }
  if (info.lockedTransport) return { transport: info.lockedTransport };
  if (info.isLocal || !info.recording) return {};
  const existing =
    !minimalErrors && info.existingTransports.length
      ? `\nExisting transports: ${info.existingTransports
          .slice(0, 10)
          .map((item) => `${item.id}: ${item.description} (${item.owner})`)
          .join(', ')}`
      : '';
  return {
    error: `Package "${packageName}" requires a transport number for object creation, but none was provided. Use SAPTransport(action="list") or SAPTransport(action="create"), then retry with transport="<transport_id>".${existing}`,
  };
}

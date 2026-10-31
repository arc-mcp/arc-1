import {
  type ApiCatalogType,
  apiCatalogAvailable,
  apiCatalogObjectUrl,
  apiCatalogUnavailableMessage,
  createApiCatalogObject,
  deleteApiCatalogObject,
  needsFollowUpSave,
  parseApiCatalogSource,
  updateApiCatalogObject,
} from '../../adt/api-packages.js';
import type { AdtClient } from '../../adt/client.js';
import { AdtError } from '../../adt/errors.js';
import { checkPackage } from '../../adt/safety.js';
import type { CachingLayer } from '../../cache/caching-layer.js';
import type { ServerConfig } from '../../server/types.js';
import { type CacheSecurityContext, invalidateInactiveList } from '../cache-security.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';
import { resolveCreateTransport } from './create-transport.js';

const METADATA_ACCEPT = 'application/vnd.sap.adt.blues.v1+xml';

/**
 * SAPWrite for API packages (SOD1) and API package assignments (SOD2). `source` is the SAPRead JSON
 * (or only the fields to change); saves are active, there is nothing to activate. Delete goes through
 * SAP's deletion framework and refuses objects with dependent KTDs. Errors propagate to the
 * dispatcher, which renders AdtError messages with their extraHint.
 */
export async function writeApiCatalogObject(
  client: AdtClient,
  action: string,
  type: ApiCatalogType,
  name: string,
  args: Record<string, unknown>,
  config: ServerConfig,
  cachingLayer: CachingLayer | undefined,
  cacheSecurity: CacheSecurityContext,
): Promise<ToolResult> {
  if (action !== 'create' && action !== 'update' && action !== 'delete')
    return errorResult(`SAPWrite type=${type} supports create, update and delete.`);
  if (!apiCatalogAvailable(client.http, type)) return errorResult(apiCatalogUnavailableMessage(type));
  const url = apiCatalogObjectUrl(type, name);
  const label = `Operations on ${type} '${name}'`;
  let transport = args.transport as string | undefined;
  const invalidate = () => {
    cachingLayer?.invalidate(type, name, 'all');
    invalidateInactiveList(cachingLayer, client, cacheSecurity);
  };

  if (action === 'delete') {
    await enforceAllowedPackageForObjectUrl(client, url, label, METADATA_ACCEPT);
    try {
      const result = await deleteApiCatalogObject(client.http, client.safety, type, name, transport);
      return textResult(`Deleted ${type} ${name}${result.transport ? ` (transport ${result.transport})` : ''}.`);
    } finally {
      invalidate();
    }
  }

  const source = typeof args.source === 'string' ? args.source : '';
  if (!source.trim() && !(action === 'update' && typeof args.description === 'string'))
    return errorResult(
      `SAPWrite ${action} for ${type} needs source: a JSON object with the fields to set (the SAPRead answer works).`,
    );
  const { definition, ignored } = source.trim()
    ? parseApiCatalogSource(type, source, action)
    : { definition: {}, ignored: [] as string[] };
  if (typeof args.description === 'string' && definition.description === undefined)
    definition.description = args.description;
  const ignoredNote = ignored.length ? ` Read-only fields were not changed: ${ignored.join(', ')}.` : '';

  if (action === 'update') {
    await enforceAllowedPackageForObjectUrl(client, url, label, METADATA_ACCEPT);
    if (Object.keys(definition).length === 0)
      return errorResult(`SAPWrite update for ${type} ${name}: source changes nothing.${ignoredNote}`);
    try {
      await updateApiCatalogObject(client.http, client.safety, type, name, definition, transport);
    } finally {
      invalidate();
    }
    return textResult(`Saved ${type} ${name}. The change is active; no activation is needed.${ignoredNote}`);
  }

  const pkg = String(args.package ?? '$TMP');
  await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver());
  if (!transport) {
    const resolved = await resolveCreateTransport(client, url, pkg, config.minimalErrors);
    if (resolved.error) return errorResult(resolved.error);
    transport = resolved.transport;
  }
  try {
    await createApiCatalogObject(client.http, client.safety, type, name, {
      package: pkg,
      description: definition.description ?? name,
      definition,
      transport,
    });
    if (needsFollowUpSave(type, definition)) {
      try {
        await updateApiCatalogObject(client.http, client.safety, type, name, definition, transport);
      } catch (cause) {
        const err =
          cause instanceof AdtError ? cause : new AdtError(cause instanceof Error ? cause.message : String(cause));
        const created = `${type} ${name} was created in package ${pkg}, but saving the remaining fields failed. Check it with SAPRead(type="${type}", name="${name}") and use SAPWrite(action="update") — do not repeat create.`;
        err.extraHint = err.extraHint ? `${err.extraHint}\n${created}` : created;
        throw err;
      }
    }
  } finally {
    invalidate();
  }
  return textResult(
    `Created ${type} ${name} in package ${pkg}${transport ? ` (transport ${transport})` : ''}. ` +
      `It is active; no activation is needed.${ignoredNote}`,
  );
}

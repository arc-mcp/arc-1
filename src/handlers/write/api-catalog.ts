import { getApiPackageAssignment } from '../../adt/api-package-assignment.js';
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
import { AdtApiError, AdtSafetyError } from '../../adt/errors.js';
import { checkPackage } from '../../adt/safety.js';
import type { CachingLayer } from '../../cache/caching-layer.js';
import type { ServerConfig } from '../../server/types.js';
import { type CacheSecurityContext, invalidateInactiveList } from '../cache-security.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';
import { resolveCreateTransport } from './create-transport.js';
import { postCreateError } from './post-create-error.js';

const METADATA_ACCEPT = 'application/vnd.sap.adt.blues.v1+xml';

async function verifyDeletePackage(client: AdtClient, type: ApiCatalogType, name: string, url: string) {
  let pkg: string | undefined;
  try {
    pkg = await client.resolveObjectPackage(url, METADATA_ACCEPT);
  } catch (error) {
    if (type !== 'SOD2' || !(error instanceof AdtApiError && error.isServerError)) throw error;
    // SAP can register an assignment whose API object fails during metadata construction.
    const [entry] = await client.lookupObjects([name], { objectTypes: [type] }).catch(() => []);
    const matches = entry?.matches ?? [];
    const hit = matches[0];
    if (matches.length === 1 && hit?.objectType === type && hit.objectName === name.toUpperCase() && hit.uri === url)
      pkg = hit.packageName;
  }
  if (!pkg?.trim())
    throw new AdtSafetyError(
      `Cannot delete ${type} ${name}: SAP did not establish a verified package for this object.`,
    );
  await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver());
}

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
    await verifyDeletePackage(client, type, name, url);
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
      await updateApiCatalogObject(client.http, client.safety, type, name, definition, transport, config.minimalErrors);
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
  } catch (error) {
    invalidate();
    throw error;
  }
  let recovery =
    'SAP cannot read its metadata. Inspect the referenced API object or remove the assignment with SAPWrite(action="delete").';
  try {
    if (type === 'SOD2') await getApiPackageAssignment(client.http, client.safety, name);
    recovery = 'Saving the remaining fields failed. Check it with SAPRead and use SAPWrite(action="update").';
    if (needsFollowUpSave(type, definition))
      await updateApiCatalogObject(client.http, client.safety, type, name, definition, transport, config.minimalErrors);
  } catch (cause) {
    throw postCreateError(
      { config, invalidateWrittenObject: invalidate },
      cause,
      type,
      name,
      `${type} ${name} was created in package ${pkg}. ${recovery} Do not repeat create.`,
    );
  }
  invalidate();
  return textResult(
    `Created ${type} ${name} in package ${pkg}${transport ? ` (transport ${transport})` : ''}. ` +
      `It is active; no activation is needed.${ignoredNote}`,
  );
}

import type { AdtClient } from '../adt/client.js';
import {
  findInterfaceImplementersViaSeoMetaRel,
  findReferences,
  findWhereUsed,
  type ReferenceResult,
  type WhereUsedResult,
} from '../adt/codeintel.js';
import { AdtApiError } from '../adt/errors.js';
import { isOperationAllowed, OperationType } from '../adt/safety.js';
import { normalizeObjectType, objectUrlForType } from './object-types.js';

export type LiveUsageResult = WhereUsedResult | ReferenceResult;

export interface LiveUsageLookup {
  results: LiveUsageResult[];
  fallbackUsed: boolean;
  ignoredObjectType?: string;
}

/** Resolve the canonical ADT object URI used by the where-used APIs. */
export async function resolveWhereUsedUri(
  client: AdtClient,
  objectType: string,
  objectName: string,
): Promise<string | null> {
  const type = normalizeObjectType(objectType);
  const name = objectName.toUpperCase();
  if (type === 'FUNC') {
    const group = await client.resolveFunctionGroup(name);
    return group
      ? `/sap/bc/adt/functions/groups/${encodeURIComponent(group)}/fmodules/${encodeURIComponent(name)}`
      : null;
  }
  if (type === 'TABL') {
    return client.resolveTablObjectUrl(name);
  }
  return objectUrlForType(type, name);
}

/**
 * Run the live SAP-authorized where-used lookup shared by SAPNavigate.references and
 * SAPContext.usages. Older systems fall back to the simple references endpoint.
 */
export async function lookupLiveUsages(client: AdtClient, uri: string, objectType?: string): Promise<LiveUsageLookup> {
  let results: LiveUsageResult[];
  try {
    results = await findWhereUsed(client.http, client.safety, uri, objectType);
  } catch (err) {
    if (!(err instanceof AdtApiError) || ![404, 405, 415, 501].includes(err.statusCode)) throw err;
    results = await findReferences(client.http, client.safety, uri);
    return {
      results,
      fallbackUsed: true,
      ignoredObjectType: objectType,
    };
  }

  await augmentInterfaceImplementers(client, uri, objectType, results as WhereUsedResult[]);
  return { results, fallbackUsed: false };
}

async function augmentInterfaceImplementers(
  client: AdtClient,
  uri: string,
  objectType: string | undefined,
  results: WhereUsedResult[],
): Promise<void> {
  const intfMatch = uri.match(/\/sap\/bc\/adt\/oo\/interfaces\/([^/?]+)/i);
  if (!intfMatch || (objectType && !/^CLAS/i.test(objectType))) return;

  const interfaceName = decodeURIComponent(intfMatch[1]!).toUpperCase();
  const canFreeSQL = isOperationAllowed(client.safety, OperationType.FreeSQL);
  const canQuery = isOperationAllowed(client.safety, OperationType.Query);

  try {
    let implementers: WhereUsedResult[] = [];
    if (canFreeSQL) {
      implementers = await findInterfaceImplementersViaSeoMetaRel(
        (sql, max) => client.runQuery(sql, max),
        interfaceName,
      );
    } else if (canQuery) {
      implementers = await findInterfaceImplementersViaSeoMetaRel(
        (_sql, max) => client.getTableContents('SEOMETAREL', max, `REFCLSNAME = '${interfaceName}' AND RELTYPE = '1'`),
        interfaceName,
      );
    }

    const existingNames = new Set(results.map((result) => result.name?.toUpperCase()).filter(Boolean));
    results.push(...implementers.filter((result) => !existingNames.has(result.name.toUpperCase())));
  } catch {
    // Best-effort augmentation: retain the native where-used response when SEOMETAREL is unavailable.
  }
}

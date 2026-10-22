/** Direct native package contents; never used as write-authorization evidence. */
import { XMLValidator } from 'fast-xml-parser';
import { getCurrentContext } from '../server/context.js';
import { DataResponseBudget } from './data-result-context.js';
import { AdtError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { DIRECT_PACKAGE_NAME, DIRECT_PACKAGE_TYPE } from './package-contents.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import { RequestAttemptBudget } from './request-attempt-budget.js';
import { clampUrlLimit } from './result-limits.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { parseXml } from './xml-parser.js';

export interface PackageObject {
  type: string;
  name: string;
  uri: string;
}
interface Folder {
  type: string;
  id: string;
}
const invalid = () => new AdtError('Invalid native package-tree response; no listing was returned.');
const ambiguous = () =>
  new AdtError(
    'SAP returned no package-tree evidence. The package may be empty, missing or inaccessible. ' +
      'Verify the exact package name in SAP ADT; this response cannot establish an empty package.',
  );

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function rows(value: unknown, key: string): Record<string, unknown>[] {
  if (value === '') return [];
  const container = record(value);
  if (!Object.hasOwn(container, key)) throw invalid();
  return (Array.isArray(container[key]) ? container[key] : [container[key]]).map(record);
}
function scalar(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw invalid();
  return value;
}
function parseTree(xml: string, root: boolean) {
  if (!xml.trim()) throw root ? ambiguous() : invalid();
  if (XMLValidator.validate(xml) !== true || /<!DOCTYPE/i.test(xml)) throw invalid();
  const values = record(record(parseXml(xml).abap).values).DATA;
  if (!Array.isArray(values) || values.length !== 1) throw invalid();
  const data = record(values[0]);
  const objects = rows(data.TREE_CONTENT, 'SEU_ADT_REPOSITORY_OBJ_NODE').map((node): PackageObject => {
    const type = scalar(node.OBJECT_TYPE);
    const name = scalar(node.OBJECT_NAME);
    const uri = scalar(node.OBJECT_URI, true);
    if (!DIRECT_PACKAGE_TYPE.test(type) || (!root && type === 'DEVC/K')) throw invalid();
    if (uri && !canonicalHostRelativeAdtPath(uri, '/sap/bc/adt/', { allowRawEncodedSlash: true })) throw invalid();
    return { type, name, uri };
  });
  // Expansion OBJECT_TYPES contains object IDs too; only root IDs may drive a request.
  const folders = root
    ? rows(data.OBJECT_TYPES, 'SEU_ADT_OBJECT_TYPE_INFO').map((node): Folder => {
        const type = scalar(node.OBJECT_TYPE);
        const id = scalar(node.NODE_ID);
        if (!DIRECT_PACKAGE_TYPE.test(type) || !/^\d{6}$/.test(id) || id === '000000') throw invalid();
        return { type, id };
      })
    : [];
  if (root && !objects.length && !folders.length) throw ambiguous();
  return { objects, folders };
}

export async function getDirectPackageContents(
  http: AdtHttpClient,
  safety: SafetyConfig,
  packageName: string,
  maxResults?: number,
  objectType?: string,
) {
  checkOperation(safety, OperationType.Read, 'GetPackage');
  if (!DIRECT_PACKAGE_NAME.test(packageName))
    throw new AdtError('Direct package browsing requires an exact package name (1–30 characters).');
  if (objectType !== undefined && !DIRECT_PACKAGE_TYPE.test(objectType))
    throw new AdtError('Use an exact advertised package folder type, for example CLAS/OC.');
  const request: AdtRequestOptions = {
    deadline: Date.now() + 10_000,
    signal: getCurrentContext()?.signal,
    responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'package-browser'),
    attemptBudget: new RequestAttemptBudget(8),
    retryTransientErrors: false,
  };
  const encoded = encodeURIComponent(packageName.toUpperCase());
  const path =
    '/sap/bc/adt/repository/nodestructure' +
    `?parent_type=DEVC%2FK&parent_name=${encoded}&parent_tech_name=${encoded}&withShortDescriptions=false`;
  const read = async (ids: string[], root: boolean) => {
    throwIfRequestCancelled(request);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA>' +
      ids.map((id) => `<TV_NODEKEY>${id}</TV_NODEKEY>`).join('') +
      '</DATA></asx:values></asx:abap>';
    const response = await http.post(
      path,
      body,
      'application/vnd.sap.as+xml; charset=UTF-8; dataname=null',
      { Accept: 'application/vnd.sap.as+xml' },
      request,
    );
    throwIfRequestCancelled(request);
    return parseTree(response.body, root);
  };
  const root = await read(['000000'], true);
  if (objectType && !root.folders.some((folder) => folder.type === objectType)) {
    throw new AdtError(
      `Package folder ${objectType} is not advertised. Available types: ${[...new Set(root.folders.map((folder) => folder.type))].join(', ') || 'none'}.`,
    );
  }
  const ids: string[] = [];
  for (const folder of root.folders) {
    if (folder.type === 'DEVC/K' || (objectType && folder.type !== objectType)) continue;
    if (!ids.includes(folder.id) && ids.length < 16) ids.push(folder.id);
  }
  const unexpandedTypes = [
    ...new Set(
      root.folders
        .filter((folder) => folder.type !== 'DEVC/K' && !ids.includes(folder.id))
        .map((folder) => folder.type),
    ),
  ];
  const expanded = ids.length ? (await read(ids, false)).objects : [];
  if (!ids.length && !root.objects.length) throw ambiguous();
  if (ids.length && !expanded.length) throw invalid();
  const unique = new Map<string, PackageObject>();
  for (const object of [...(!objectType || objectType === 'DEVC/K' ? root.objects : []), ...expanded]) {
    unique.set(JSON.stringify([object.type, object.name, object.uri]), object);
  }
  const effectiveLimit = clampUrlLimit(maxResults, 200);
  const objects = [...unique.values()].slice(0, effectiveLimit);
  throwIfRequestCancelled(request);
  const limitReached = objects.length >= effectiveLimit;
  return {
    objects,
    listing: {
      scope: 'direct' as const,
      coverage: 'adt-nodestructure' as const,
      completeness: 'unknown' as const,
      total: null,
      returned: objects.length,
      effectiveLimit,
      limitReached,
      possiblyTruncated: limitReached || unexpandedTypes.length > 0,
      unexpandedTypes,
      note:
        'Direct package contents only; subpackages are not visited. Descriptions are omitted. ' +
        'This is not a complete inventory or snapshot. Narrow with an advertised objectType; maxResults only caps returned entries.',
    },
  };
}

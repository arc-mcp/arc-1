/** Bounded package selection for whole-package ABAP Unit runs. */

import type { AdtHttpClient } from './http.js';
import type { AdtRequestOptions } from './http-deadline.js';
import { ADT_ROOT_PATH, canonicalHostRelativeAdtPath } from './path-safety.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { parseSearchResults } from './xml-parser.js';

export const AUNIT_PACKAGE_SEARCH_LIMIT = 1000;

export interface AunitPackageObject {
  type: 'CLAS' | 'PROG' | 'FUGR';
  name: string;
  packageName: string;
  uri: string;
}

export interface AunitPackageSelection {
  packageName: string;
  includeSubpackages: boolean;
  objects: AunitPackageObject[];
  membership: string[];
  complete: boolean;
  incompleteReason?: string;
}

const AUNIT_OBJECT_PREFIXES: Record<AunitPackageObject['type'], string> = {
  CLAS: '/sap/bc/adt/oo/classes/',
  PROG: '/sap/bc/adt/programs/programs/',
  FUGR: '/sap/bc/adt/functions/groups/',
};

function aunitType(value: string): AunitPackageObject['type'] | undefined {
  const type = value.toUpperCase().split('/')[0];
  return type === 'CLAS' || type === 'PROG' || type === 'FUGR' ? type : undefined;
}

/** Resolve the exact executable roots represented by SAP's package search response. */
export async function resolveAunitPackageSelection(
  http: AdtHttpClient,
  safety: SafetyConfig,
  packageName: string,
  includeSubpackages: boolean,
  requestOptions?: AdtRequestOptions,
): Promise<AunitPackageSelection> {
  checkOperation(safety, OperationType.Test, 'ResolveAunitPackage');
  const normalizedPackage = packageName.trim().toUpperCase();
  if (!normalizedPackage) throw new Error('ABAP Unit package name must not be empty.');

  // Distinguish an existing empty package from an unknown package before treating zero rows as a
  // sound empty selection. The package metadata read is also authorization evidence for the scope.
  await http.get(`/sap/bc/adt/packages/${encodeURIComponent(normalizedPackage)}`, undefined, requestOptions);
  const response = await http.get(
    `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=*&packageName=${encodeURIComponent(normalizedPackage)}&maxResults=${AUNIT_PACKAGE_SEARCH_LIMIT}`,
    undefined,
    requestOptions,
  );
  const references = parseSearchResults(response.body);
  const inScope = references.filter(
    (reference) => includeSubpackages || reference.packageName.trim().toUpperCase() === normalizedPackage,
  );
  const membership = [
    ...new Set(
      inScope.map((reference) =>
        [
          reference.objectType.toUpperCase(),
          reference.objectName.toUpperCase(),
          reference.packageName.toUpperCase(),
          reference.uri,
        ].join('\u0000'),
      ),
    ),
  ].sort();

  const objects: AunitPackageObject[] = [];
  const seen = new Set<string>();
  let invalidObjectReference = false;
  for (const reference of inScope) {
    const type = aunitType(reference.objectType);
    if (!type) continue;
    const objectName = reference.objectName.trim().toUpperCase();
    const canonical = canonicalHostRelativeAdtPath(reference.uri, ADT_ROOT_PATH, {
      allowRawEncodedSlash: true,
    });
    const expectedUri = `${AUNIT_OBJECT_PREFIXES[type]}${encodeURIComponent(objectName)}`;
    if (!objectName || !canonical || canonical.includes('?') || canonical.toUpperCase() !== expectedUri.toUpperCase()) {
      invalidObjectReference = true;
      continue;
    }
    const key = `${type}\u0000${objectName}\u0000${canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);
    objects.push({
      type,
      name: objectName,
      packageName: reference.packageName.toUpperCase(),
      uri: canonical,
    });
  }
  objects.sort((left, right) =>
    `${left.type}\u0000${left.name}\u0000${left.uri}`.localeCompare(
      `${right.type}\u0000${right.name}\u0000${right.uri}`,
    ),
  );

  const truncated = references.length >= AUNIT_PACKAGE_SEARCH_LIMIT;
  const incompleteReason = truncated
    ? `Package selection reached the ${AUNIT_PACKAGE_SEARCH_LIMIT.toLocaleString('en-US')}-row repository-search bound.`
    : invalidObjectReference
      ? 'One or more executable package objects had a missing or non-canonical ADT URI.'
      : undefined;
  return {
    packageName: normalizedPackage,
    includeSubpackages,
    objects,
    membership,
    complete: incompleteReason === undefined,
    ...(incompleteReason ? { incompleteReason } : {}),
  };
}

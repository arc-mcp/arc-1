import { XMLParser } from 'fast-xml-parser';
import type { SapClient } from './sap.js';

export interface RepositoryObject {
  type: string;
  name: string;
  packageName: string;
  description: string;
  uri: string;
}

const parser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  removeNSPrefix: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseRepositoryObjects(xml: string): RepositoryObject[] {
  const parsed = parser.parse(xml) as {
    objectReferences?: { objectReference?: Array<Record<string, unknown>> | Record<string, unknown> };
  };
  return asArray(parsed.objectReferences?.objectReference).map((ref) => ({
    type: String(ref['@_type'] ?? ''),
    name: String(ref['@_name'] ?? ''),
    packageName: String(ref['@_packageName'] ?? ''),
    description: String(ref['@_description'] ?? ''),
    uri: String(ref['@_uri'] ?? ''),
  }));
}

export async function searchRepository(
  client: SapClient,
  query: string,
  maxResults: number,
  objectType?: string,
  packageName?: string,
): Promise<RepositoryObject[]> {
  const params = new URLSearchParams({ operation: 'quickSearch', query, maxResults: String(maxResults) });
  if (objectType) params.set('objectType', objectType);
  if (packageName) params.set('packageName', packageName);
  try {
    const response = await client.getText('/sap/bc/adt/repository/informationsystem/search', params);
    return parseRepositoryObjects(response.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Repository search ${query} (${maxResults}) failed: ${message}`);
  }
}

/** Native function-group ownership; child container hints never replace a fresh parent package check. */
import type { AdtClient } from './client.js';
import { AdtSafetyError } from './errors.js';
import { nativeXmlRoot } from './native-xml-evidence.js';
import { checkPackage } from './safety.js';

const core = 'http://www.sap.com/adt/core';
const base = '/sap/bc/adt/functions/groups/';
const slashCase = (uri: string) => uri.replace(/%2f/gi, '%2F');

export interface PinnedFunctionSelection {
  type: 'FUGR' | 'FUNC' | 'INCL';
  name: string;
  group: string;
  groupUrl: string;
  objectUrl: string;
}

export function assertPinnedFunctionIdentifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 40 || !/^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*$/.test(value))
    throw new AdtSafetyError('Function resources require explicit bounded uppercase names.');
}

export function pinnedFunctionSelection(type: unknown, name: unknown, group?: unknown): PinnedFunctionSelection {
  assertPinnedFunctionIdentifier(name);
  if (type !== 'FUGR' && type !== 'FUNC' && type !== 'INCL')
    throw new AdtSafetyError('Select a function group, function module, or group-owned include.');
  if (type === 'FUGR') {
    if (group !== undefined) throw new AdtSafetyError('A function group cannot select another parent group.');
    group = name;
  }
  assertPinnedFunctionIdentifier(group);
  const groupUrl = `${base}${encodeURIComponent(group.toLowerCase())}`;
  const objectUrl =
    type === 'FUGR'
      ? groupUrl
      : `${groupUrl}/${type === 'FUNC' ? 'fmodules' : 'includes'}/${encodeURIComponent(name.toLowerCase())}`;
  return { type, name, group, groupUrl, objectUrl };
}

function selectionForResource(resource: string): PinnedFunctionSelection | undefined {
  if (!resource.startsWith(base)) return undefined;
  const match = /^\/sap\/bc\/adt\/functions\/groups\/([^/?#]+)(?:\/(fmodules|includes)\/([^/?#]+))?$/.exec(resource);
  if (!match) throw new AdtSafetyError('The selected function resource URI is not canonical.');
  let group: string, name: string;
  try {
    group = decodeURIComponent(match[1]!).toUpperCase();
    name = decodeURIComponent(match[3] ?? match[1]!).toUpperCase();
  } catch {
    throw new AdtSafetyError('The selected function resource URI is not canonical.');
  }
  const selected = pinnedFunctionSelection(
    match[2] === 'fmodules' ? 'FUNC' : match[2] === 'includes' ? 'INCL' : 'FUGR',
    name,
    match[2] ? group : undefined,
  );
  if (slashCase(resource) !== selected.objectUrl)
    throw new AdtSafetyError('The selected function resource URI is not canonical.');
  return selected;
}

export interface PinnedFunctionOwnerEvidence extends PinnedFunctionSelection {
  packageName: string;
}

export async function readPinnedFunctionOwner(
  client: AdtClient,
  resource: string,
): Promise<PinnedFunctionOwnerEvidence | undefined> {
  const selected = selectionForResource(resource);
  if (!selected) return undefined;
  const headers = { Accept: 'application/*', 'Cache-Control': 'no-cache' };
  const parentResponse = await client.http.get(selected.groupUrl, headers);
  const parent = nativeXmlRoot(parentResponse.body, 'abapFunctionGroup', 'http://www.sap.com/adt/functions/groups');
  const pkg = parent.child('packageRef', core);
  const packageName = pkg?.attribute('name', core);
  if (
    parent.attribute('name', core) !== selected.group ||
    parent.attribute('type', core) !== 'FUGR/F' ||
    parent.hasChild('containerRef') ||
    pkg?.attribute('type', core) !== 'DEVC/K' ||
    !packageName
  )
    throw new AdtSafetyError('The native function group identity and package could not be verified.');
  await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());
  if (selected.type !== 'FUGR') {
    const response = await client.http.get(selected.objectUrl, headers);
    const module = selected.type === 'FUNC';
    const child = nativeXmlRoot(
      response.body,
      module ? 'abapFunctionModule' : 'abapFunctionGroupInclude',
      `http://www.sap.com/adt/functions/${module ? 'fmodules' : 'fincludes'}`,
    );
    const container = child.child('containerRef', core);
    const ownPackage = child.child('packageRef', core);
    if (
      child.attribute('name', core) !== selected.name ||
      child.attribute('type', core) !== (module ? 'FUGR/FF' : 'FUGR/I') ||
      container?.attribute('name', core) !== selected.group ||
      container.attribute('type', core) !== 'FUGR/F' ||
      slashCase(container.attribute('uri', core) ?? '') !== selected.groupUrl ||
      container.attribute('packageName', core) !== packageName ||
      (ownPackage &&
        (ownPackage.attribute('name', core) !== packageName || ownPackage.attribute('type', core) !== 'DEVC/K'))
    )
      throw new AdtSafetyError('The native function child does not belong to the verified parent group and package.');
  }
  return { ...selected, packageName };
}

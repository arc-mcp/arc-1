/** Private native-protocol evidence. This is not a PP/authentication qualification transport. */
import { createHash } from 'node:crypto';
import { observeNativeHttp } from './native-observed-http.js';
export { nativeRequestPolicy as contractRequestPolicy } from './native-observed-http.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';

export interface NativeContractSelection {
  group: string;
  module: string;
  groupUrl: string;
  moduleUrl: string;
}

export { isNativeContractOrigin } from './native-qualification-runtime.js';

export function contractSelection(suffix: string): NativeContractSelection {
  if (!/^[A-F0-9]{16}$/.test(suffix)) throw new Error('A fresh 16-hex fixture suffix is required.');
  const group = `ZARC1_NG_${suffix}`,
    module = `ZARC1_NF_${suffix}`;
  const groupUrl = `/sap/bc/adt/functions/groups/${group.toLowerCase()}`;
  return { group, module, groupUrl, moduleUrl: `${groupUrl}/fmodules/${module.toLowerCase()}` };
}

export function checkContractMutation(selection: NativeContractSelection, method: string, path: string, body?: string) {
  if (!path.startsWith('/sap/bc/adt/') || path.includes('#'))
    throw new Error('Only relative native ADT paths are permitted.');
  const uri = new URL(path, 'https://a4h.marianzeis.de');
  if (uri.origin !== 'https://a4h.marianzeis.de') throw new Error('Foreign native-contract origin.');
  if (!uri.pathname.startsWith('/sap/bc/adt/')) throw new Error('Native ADT path normalization escaped its scope.');
  if (method === 'GET' || method === 'HEAD') return;
  const owners = new Set([selection.groupUrl, selection.moduleUrl]);
  const pool = `/sap/bc/adt/textelements/functiongroups/${selection.group}`;
  if (method === 'POST' && uri.pathname === '/sap/bc/adt/cts/transportchecks') return;
  if (
    method === 'POST' &&
    ['LOCK', 'UNLOCK'].includes(uri.searchParams.get('_action') ?? '') &&
    (owners.has(uri.pathname) || uri.pathname.toUpperCase() === pool.toUpperCase())
  )
    return;
  if (method === 'DELETE' && owners.has(uri.pathname)) return;
  if (method === 'PUT' && uri.pathname === `${selection.moduleUrl}/source/main`) return;
  const core = 'http://www.sap.com/adt/core';
  if (
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/activation' &&
    uri.searchParams.get('method') === 'activate' &&
    uri.searchParams.get('preauditRequested') === 'true'
  ) {
    const refs = nativeXmlRoot(body ?? '', 'objectReferences', core).children('objectReference', core);
    if (
      refs.length === 1 &&
      refs[0].attribute('uri', core) === selection.moduleUrl &&
      refs[0].attribute('name', core) === selection.module
    )
      return;
  }
  if (method === 'POST' && uri.pathname === '/sap/bc/adt/functions/groups') {
    const root = nativeXmlRoot(body ?? '', 'abapFunctionGroup', 'http://www.sap.com/adt/functions/groups');
    if (
      root.attribute('name', core) === selection.group &&
      root.child('packageRef', core)?.attribute('name', core) === '$TMP'
    )
      return;
  }
  if (method === 'POST' && uri.pathname === `${selection.groupUrl}/fmodules`) {
    const root = nativeXmlRoot(body ?? '', 'abapFunctionModule', 'http://www.sap.com/adt/functions/fmodules');
    const container = root.child('containerRef', core);
    if (
      root.attribute('name', core) === selection.module &&
      container?.attribute('name', core) === selection.group &&
      container.attribute('uri', core) === selection.groupUrl &&
      container.attribute('type', core) === 'FUGR/F'
    )
      return;
  }
  throw new Error('Mutation outside the native-contract fixture or unapproved activation confirmation.');
}

/** Native save/activation changes version, timestamp and source ETags; identity and source hashes remain separate guards. */
export function contractMetadataHash(xml: string): string {
  return createHash('sha256')
    .update(xml.replace(/\s+(?:adtcore:(?:version|changedAt)|etag)="[^"]*"/g, ''))
    .digest('hex');
}

/** Observed native metadata loses this exact owned alternate-version link once the draft is activated. */
export function contractFunctionMetadataHash(xml: string, selection: NativeContractSelection): string {
  const reference = `<atom:link href="${selection.moduleUrl}/source/main?version=active" rel="http://www.sap.com/adt/relations/objectstates" title="Reference to active or inactive version" xmlns:atom="http://www.w3.org/2005/Atom"/>`;
  // Only the one observed saved-to-active transition; retain reverse links and duplicates.
  if (xml.split(reference).length === 2) xml = xml.replace(reference, '');
  return contractMetadataHash(xml);
}

/** FUNC metadata exposes changedBy on A4H, but does not promise a createdBy field. */
export function contractIdentity(xml: string, group: boolean, selection: NativeContractSelection, marker: string) {
  const core = 'http://www.sap.com/adt/core';
  const root = nativeXmlRoot(
    xml,
    group ? 'abapFunctionGroup' : 'abapFunctionModule',
    `http://www.sap.com/adt/functions/${group ? 'groups' : 'fmodules'}`,
  );
  const creator = root.attribute('createdBy', core),
    changedBy = root.attribute('changedBy', core);
  if (
    root.attribute('name', core) !== (group ? selection.group : selection.module) ||
    root.attribute('type', core) !== (group ? 'FUGR/F' : 'FUGR/FF') ||
    root.attribute('description', core) !== marker ||
    (group ? creator !== 'MARIAN' : !!creator && creator !== 'MARIAN') ||
    (changedBy && changedBy !== 'MARIAN')
  )
    throw new Error('Native fixture identity, description or reported author does not match this run.');
  if (group) {
    if (root.child('packageRef', core)?.attribute('name', core) !== '$TMP') throw new Error('Foreign fixture package.');
  } else {
    const parent = root.child('containerRef', core);
    if (
      parent?.attribute('name', core) !== selection.group ||
      parent.attribute('uri', core) !== selection.groupUrl ||
      parent.attribute('type', core) !== 'FUGR/F' ||
      parent.attribute('packageName', core) !== '$TMP'
    )
      throw new Error('Foreign fixture container/package.');
  }
  return { creator, changedBy, nativeVersion: root.attribute('version', core) };
}

/** Preserve the historical function experiment's exact request/receipt contract. */
export function observeContractHttp(
  http: AdtHttpClient,
  selection: NativeContractSelection,
  record: (value: unknown) => void,
  beforeDelete: (session: AdtHttpClient, path: string, policy: AdtRequestOptions) => Promise<void>,
): AdtHttpClient {
  return observeNativeHttp(http, (method, path, body) => checkContractMutation(selection, method, path, body), record, beforeDelete);
}

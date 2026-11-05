/** Exact stage/resource/body fence; re-evaluated by the shared observer at actual dispatch. */

import { buildServiceBindingXml } from '../../../src/adt/ddic-xml.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { buildKtdCreateXml } from '../../../src/handlers/write/ktd-create.js';
import { buildCreateXml } from '../../../src/handlers/write-helpers.js';
import { type RapFixture, rapSettings } from './native-rap-fixtures.js';

const core = 'http://www.sap.com/adt/core';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const rapStageOwners = (f: readonly RapFixture[], stage?: string) => {
  if (stage?.includes('document')) return f[6]?.type === 'SKTD' ? [f[6]] : [];
  if (stage?.includes('pool-bdef')) return [f[2], f[3]];
  if (stage?.endsWith('generation') || stage === 'delete-pool') return [f[2]];
  const i = ['table', 'view', 'pool', 'bdef', 'service', 'binding'].findIndex((k) => stage?.endsWith(k));
  return i >= 0 ? [f[i]] : stage === 'publish' || stage === 'unpublish' ? [f[5]] : [];
};
export function rapUnlock(f: readonly RapFixture[], method: string, path: string) {
  const u = new URL(path, 'https://a4h.marianzeis.de');
  return (
    method === 'POST' &&
    f.some((v) => same(v.owner, u.pathname)) &&
    u.searchParams.get('_action') === 'UNLOCK' &&
    !!u.searchParams.get('lockHandle') &&
    [...u.searchParams.keys()].every((k) => ['_action', 'lockHandle'].includes(k))
  );
}
export function checkRapRequest(
  f: readonly RapFixture[],
  stage: string | undefined,
  method: string,
  path: string,
  body?: string,
  generated: ReadonlyMap<string, string> = new Map(),
  documentPut?: string,
): void {
  if (!path.startsWith('/sap/bc/adt/') || /[#\\]/.test(path)) throw new Error('Fixed RAP path required.');
  const u = new URL(path, 'https://a4h.marianzeis.de'),
    keys = [...u.searchParams.keys()];
  if (u.pathname !== path.split('?')[0] || new Set(keys).size !== keys.length)
    throw new Error('Exact RAP query required.');
  const only = (...allowed: string[]) => keys.every((k) => allowed.includes(k));
  const owners = rapStageOwners(f, stage),
    owner = f.find((v) => same(v.owner, u.pathname));
  const source = f.find(
    (v) => v.type !== 'SKTD' && v.create.source !== undefined && same(`${v.owner}/source/main`, u.pathname),
  );
  const part = ['definitions', 'implementations', 'macros', 'testclasses'].find((k) =>
    same(`${f[2].owner}/includes/${k}`, u.pathname),
  );
  if (method === 'GET') {
    if (['/sap/bc/adt/discovery', '/sap/bc/adt/activation/inactiveobjects'].includes(path)) return;
    if (
      (owner || source || part || same(rapSettings(f).owner, u.pathname)) &&
      only('version') &&
      (!keys.length || ['active', 'inactive'].includes(u.searchParams.get('version') ?? ''))
    )
      return;
    if (same(u.pathname, '/sap/bc/adt/packages/%24tmp') && !keys.length) return;
    if (
      u.pathname === '/sap/bc/adt/repository/informationsystem/search' &&
      only('operation', 'query', 'maxResults') &&
      keys.length === 3 &&
      u.searchParams.get('operation') === 'quickSearch' &&
      u.searchParams.get('maxResults') === '5' &&
      f.some((v) => v.name === u.searchParams.get('query'))
    )
      return;
    throw new Error('GET outside fixed RAP graph.');
  }
  if (method === 'HEAD' && owner && !keys.length) return;
  if (rapUnlock(f, method, path)) return;
  if (!stage || !owners.length) throw new Error('No fixed RAP stage.');
  if (method === 'POST' && path === '/sap/bc/adt/cts/transportchecks') {
    const root = nativeXmlRoot(body ?? '', 'abap', 'http://www.sap.com/abapxml');
    for (const v of owners)
      for (const uri of [v.owner, v.owner.replace(/[^/]+$/, v.name)])
        for (const operation of ['', 'I']) {
          const expected = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${uri}</URI><OPERATION>${operation}</OPERATION></DATA></a:values></a:abap>`;
          if (
            JSON.stringify(root.canonicalValue({})) ===
            JSON.stringify(nativeXmlRoot(expected, 'abap', 'http://www.sap.com/abapxml').canonicalValue({}))
          )
            return;
        }
  }
  if (
    method === 'POST' &&
    owner &&
    owners.includes(owner) &&
    only('_action', 'accessMode') &&
    keys.length === 2 &&
    u.searchParams.get('_action') === 'LOCK' &&
    u.searchParams.get('accessMode') === 'MODIFY'
  )
    return;
  if (
    method === 'DELETE' &&
    stage.startsWith('delete-') &&
    owner &&
    owners.includes(owner) &&
    only('lockHandle') &&
    keys.length === 1 &&
    u.searchParams.get('lockHandle')
  )
    return;
  if (
    stage.startsWith('create-') &&
    method === 'POST' &&
    only('_package') &&
    [null, '$TMP'].includes(u.searchParams.get('_package'))
  ) {
    const selected = owners.find((v) => same(v.owner.slice(0, v.owner.lastIndexOf('/')), u.pathname));
    if (selected) {
      const xml =
        selected.type === 'SKTD'
          ? buildKtdCreateXml(selected.name, '$TMP', 'BDEF/BDO', selected.name, '', 'EN')
          : selected.type === 'SRVB'
            ? buildServiceBindingXml({
                name: selected.name,
                package: '$TMP',
                description: selected.description,
                serviceDefinition: f[4].name,
                bindingType: 'ODATA',
                odataVersion: 'V4',
                category: '1',
                version: '0001',
                language: 'EN',
              })
            : buildCreateXml(selected.type, selected.name, '$TMP', selected.description, selected.create, 'EN');
      if (body === xml) return;
    }
  }
  if (
    method === 'PUT' &&
    owner?.type === 'SKTD' &&
    owners.includes(owner) &&
    ['create-document', 'update-document-root', 'update-document-create', 'update-document-update'].includes(stage) &&
    only('lockHandle') &&
    keys.length === 1 &&
    u.searchParams.get('lockHandle') &&
    typeof documentPut === 'string' &&
    body === documentPut
  )
    return;
  if (
    method === 'PUT' &&
    source &&
    owners.includes(source) &&
    stage.startsWith('create-') &&
    only('lockHandle') &&
    keys.length === 1 &&
    u.searchParams.get('lockHandle') &&
    body === source.create.source
  )
    return;
  if (
    stage === 'apply-generation' &&
    (part === 'definitions' || part === 'implementations') &&
    only('lockHandle') &&
    keys.length === 1 &&
    u.searchParams.get('lockHandle')
  ) {
    if (method === 'PUT' && body === generated.get(part)) return;
    if (method === 'POST' && !body && generated.has(part)) return;
  }
  if (
    method === 'POST' &&
    stage.includes('activate-') &&
    u.pathname === '/sap/bc/adt/activation' &&
    only('method', 'preauditRequested') &&
    keys.length === 2 &&
    u.searchParams.get('method') === 'activate' &&
    ['true', 'false'].includes(u.searchParams.get('preauditRequested') ?? '')
  ) {
    const refs = nativeXmlRoot(body ?? '', 'objectReferences', core).children('objectReference', core);
    const assignments = refs.map((r) =>
      owners.find(
        (v) =>
          same(v.owner, r.attribute('uri', core) ?? '') ||
          (v.type === 'CLAS' &&
            ['definitions', 'implementations', 'macros', 'testclasses'].some((k) =>
              same(`${v.owner}/includes/${k}`, r.attribute('uri', core) ?? ''),
            )),
      ),
    );
    if (
      refs.length >= owners.length &&
      refs.length <= owners.length + 4 &&
      new Set(refs.map((r) => r.attribute('uri', core)?.toLowerCase())).size === refs.length &&
      assignments.every(Boolean) &&
      owners.every((v) => assignments.includes(v)) &&
      refs.every((r, i) => {
        const v = assignments[i]!;
        const include = !same(v.owner, r.attribute('uri', core) ?? '');
        const nativeType = include
          ? 'CLAS/I'
          : {
              'TABL/DT': 'TABL/DT',
              DDLS: 'DDLS/DF',
              CLAS: 'CLAS/OC',
              BDEF: 'BDEF/BDO',
              SRVD: 'SRVD/SRV',
              SRVB: 'SRVB/SVB',
              SKTD: 'SKTD/TYP',
            }[v.type];
        return (
          (include || r.attribute('name', core) === undefined || r.attribute('name', core) === v.name) &&
          (r.attribute('type', core) === undefined || r.attribute('type', core) === nativeType)
        );
      })
    )
      return;
  }
  if (
    method === 'POST' &&
    (stage === 'publish' || stage === 'unpublish') &&
    u.pathname === `/sap/bc/adt/businessservices/odatav4/${stage}jobs` &&
    only('servicename', 'serviceversion') &&
    keys.length === 2 &&
    u.searchParams.get('servicename') === f[5].name &&
    u.searchParams.get('serviceversion') === '0001'
  ) {
    const expected = `<adtcore:objectReferences xmlns:adtcore="${core}"><adtcore:objectReference adtcore:name="${f[5].name}"/></adtcore:objectReferences>`;
    if (body === expected) return;
  }
  throw new Error(`Request outside fixed RAP stage ${stage}: ${method} ${u.pathname}`);
}

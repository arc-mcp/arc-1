/** Only the exact compiled table graph and native discovery/deletion-check routes. */
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { parseTableSettings } from '../../../src/adt/table-settings.js';
import type { TableFixture } from './native-ddic-table-fixtures.js';
import { checkDdicRequest } from './native-ddic-transport.js';
export function checkTableRequest(
  fixtures: readonly TableFixture[],
  selected: TableFixture | undefined,
  stage: string | undefined,
  method: string,
  path: string,
  body?: string,
) {
  if (!path.startsWith('/sap/bc/adt/') || /[#\\]/.test(path)) throw new Error('Fixed native table path required.');
  const url = new URL(path, 'https://a4h.marianzeis.de'),
    keys = [...url.searchParams.keys()];
  if (url.pathname !== path.split('?')[0] || new Set(keys).size !== keys.length)
    throw new Error('Exact table path/query required.');
  const table = fixtures[0],
    child = fixtures.find((f) => ['TABL/DT', 'TABL/DTI'].includes(f.type) && url.pathname === `${f.owner}/source/main`);
  if (method === 'GET') {
    if (path === '/sap/bc/adt/discovery') return;
    if (
      url.pathname === table.owner.toLowerCase() &&
      keys.every((k) => k === 'version') &&
      (!keys.length || ['active', 'inactive'].includes(url.searchParams.get('version') ?? ''))
    )
      return;
    if (
      child &&
      keys.every((k) => k === 'version') &&
      (!keys.length || ['active', 'inactive'].includes(url.searchParams.get('version') ?? ''))
    )
      return;
    if (
      selected?.type === 'TABL/DT' &&
      stage &&
      !stage.startsWith('create-') &&
      url.pathname === '/sap/bc/adt/repository/informationsystem/search' &&
      keys.length === 3 &&
      keys.every((k) => ['operation', 'query', 'maxResults'].includes(k)) &&
      url.searchParams.get('operation') === 'quickSearch' &&
      url.searchParams.get('query') === selected.name &&
      url.searchParams.get('maxResults') === '5'
    )
      return;
  }
  if (
    method === 'PUT' &&
    child &&
    selected === child &&
    stage &&
    ['create-', 'update-'].some((p) => stage.startsWith(p)) &&
    keys.length === 1 &&
    keys[0] === 'lockHandle' &&
    url.searchParams.get('lockHandle') &&
    body === (stage.startsWith('create-') ? child.create.source : child.update.source)
  )
    return;
  const core = 'http://www.sap.com/adt/core';
  if (
    selected?.type === 'TABL/DTT' &&
    method === 'PUT' &&
    url.pathname === selected.owner &&
    stage === 'update-TABL/DTT' &&
    keys.length === 1 &&
    keys[0] === 'lockHandle' &&
    url.searchParams.get('lockHandle')
  ) {
    const root = nativeXmlRoot(body ?? '', 'tableSettings', 'http://www.sap.com/dictionary/table/settings', true);
    const parent = root.child('containerRef', core);
    if (
      root.attribute('name', core) === selected.name &&
      root.attribute('type', core) === 'TABL/DTT' &&
      parent?.attribute('name', core) === table.name &&
      parent.attribute('type', core) === 'TABL/DT' &&
      parent.attribute('uri', core) === table.owner.toLowerCase() &&
      parseTableSettings(body!, selected.name).source.sizeCategory === 2
    )
      return;
  }
  if (selected?.type === 'TABL/DTI' && method === 'POST') {
    if (
      stage === 'create-TABL/DTI' &&
      url.pathname === '/sap/bc/adt/ddic/db/indexes' &&
      keys.every((k) => k === '_package') &&
      [null, '$TMP'].includes(url.searchParams.get('_package'))
    ) {
      const root = nativeXmlRoot(body ?? '', 'blueSource', 'http://www.sap.com/wbobj/blue', true),
        parent = root.child('containerRef', core);
      if (
        root.attribute('name', core) === selected.name &&
        root.attribute('type', core) === 'TABL/DTI' &&
        root.attribute('description', core) === selected.description &&
        root.child('packageRef', core)?.attribute('name', core) === '$TMP' &&
        parent?.attribute('name', core) === table.name &&
        parent.attribute('type', core) === 'TABL/DT' &&
        parent.attribute('uri', core) === table.owner.toLowerCase()
      )
        return;
    }
    if (stage === 'delete-TABL/DTI' && path === '/sap/bc/adt/deletion/check') {
      const root = nativeXmlRoot(body ?? '', 'checkRequest', 'http://www.sap.com/adt/deletion', true),
        objects = root.children('object', 'http://www.sap.com/adt/deletion');
      let handles = 0;
      const canonical = root.canonicalValue({
        omitChild: (name, namespace, child) => {
          if (name !== 'lockHandle' || namespace !== 'http://www.sap.com/adt/deletion') return false;
          const value = child.canonicalValue({}) as [string, unknown][];
          if (
            value.length !== 1 ||
            value[0][0] !== 'text' ||
            typeof value[0][1] !== 'string' ||
            !value[0][1] ||
            value[0][1].length > 8192
          )
            throw new Error('Bounded native lock handle required.');
          handles++;
          return true;
        },
      });
      const expected = nativeXmlRoot(
        `<del:checkRequest xmlns:del="http://www.sap.com/adt/deletion" xmlns:adtcore="${core}"><del:object adtcore:uri="${selected.owner}"/></del:checkRequest>`,
        'checkRequest',
        'http://www.sap.com/adt/deletion',
      );
      if (
        objects.length === 1 &&
        handles === 1 &&
        JSON.stringify(canonical) === JSON.stringify(expected.canonicalValue({}))
      )
        return;
    }
  }
  if (
    selected?.type === 'TABL/DTT' &&
    ['POST', 'DELETE'].includes(method) &&
    !url.searchParams.has('_action') &&
    !['/sap/bc/adt/activation', '/sap/bc/adt/cts/transportchecks'].includes(url.pathname)
  )
    throw new Error('Settings have no independent create/delete authority.');
  checkDdicRequest(fixtures, selected, stage, method, path, body);
}

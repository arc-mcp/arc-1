import { readFileSync } from 'node:fs';
import { TABLE_STAGES, tableFixtures } from '../../../scripts/qualification/pr1142/native-ddic-table-fixtures.js';
import { ddicHarness } from './pr1142-native-ddic-harness.js';

const { runNativeTableGraph } = await import('../../../scripts/qualification/pr1142/native-ddic-table-driver.js');

export { TABLE_PROTOCOL } from '../../../scripts/qualification/pr1142/native-ddic-table-fixtures.js';
export { TABLE_STAGES };
export const fixtures = tableFixtures('0123456789AB');
const settingsTemplate = readFileSync(new URL('../../fixtures/table-settings-758.xml', import.meta.url), 'utf8');
const core = 'http://www.sap.com/adt/core';
export function tableHarness(options: Parameters<typeof ddicHarness>[0] = {}) {
  const h = ddicHarness({ ...options, fixtures, execute: runNativeTableGraph });
  let rows = fixtures;
  const useFixtures = h.useFixtures;
  h.useFixtures = (next = fixtures) => {
    rows = next;
    useFixtures(next);
  };
  const response = (data: string, statusCode = 200) => ({
    statusCode,
    data,
    responseOptions: { headers: { 'content-type': 'application/xml' } },
  });
  h.hooks.reply = (url, method, body) => {
    const [table, settings, lock, index] = rows;
    if (url.pathname === '/sap/bc/adt/discovery') {
      const services = [
        ['/sap/bc/adt/ddic/tables', 'application/vnd.sap.adt.blues.v1+xml'],
        ['/sap/bc/adt/ddic/db/settings', 'application/vnd.sap.adt.table.settings.v2+xml'],
        ['/sap/bc/adt/ddic/db/indexes', 'application/vnd.sap.adt.blues.v1+xml'],
        ['/sap/bc/adt/ddic/lockobjects/sources', 'application/vnd.sap.adt.lockobjects.v1+xml'],
        ['/sap/bc/adt/deletion/check', 'application/vnd.sap.adt.deletion.check.request.v1+xml'],
      ];
      return response(
        `<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom"><app:workspace><atom:title>Table graph</atom:title>${services.map(([path, mime]) => `<app:collection href="${path}"><atom:title>Native synthetic service</atom:title><app:accept>${mime}</app:accept></app:collection>`).join('')}</app:workspace></app:service>`,
      );
    }
    if (method === 'GET' && url.pathname === table.owner.toLowerCase()) {
      const o = h.world.objects.get(table.owner)!;
      return o.metadata
        ? response(o.metadata)
        : response(
            '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/></exc:exception>',
            404,
          );
    }
    if (
      method === 'POST' &&
      url.pathname === '/sap/bc/adt/activation' &&
      url.searchParams.get('preauditRequested') === 'false'
    ) {
      if (body.includes(table.owner))
        h.world.objects.get(settings.owner)!.metadata = settingsTemplate
          .replaceAll('ZTEST', table.name)
          .replaceAll('ztest', table.name.toLowerCase())
          .replaceAll('TEST_USER', 'MARIAN')
          .replace('ARC1 settings qualification', settings.description)
          .replace('version="inactive"', 'version="active"');
      if (body.includes(lock.owner)) {
        const object = h.world.objects.get(lock.owner)!;
        const parameters = ['CLIENT', 'ID']
          .map(
            (name) =>
              `<enqu:lockParameter><enqu:parameterWanted>true</enqu:parameterWanted><enqu:parameterName>${name}</enqu:parameterName><enqu:tableName>${table.name}</enqu:tableName><enqu:fieldName>${name}</enqu:fieldName></enqu:lockParameter>`,
          )
          .join('');
        object.metadata = object.metadata.replace(
          /<enqu:lockParameters\s*\/>|<enqu:lockParameters>.*?<\/enqu:lockParameters>/s,
          `<enqu:lockParameters>${parameters}</enqu:lockParameters>`,
        );
      }
    }
    if (method === 'POST' && url.pathname === '/sap/bc/adt/deletion/check')
      return response(
        `<del:checkResponse xmlns:del="http://www.sap.com/adt/deletion" xmlns:adtcore="${core}"><del:object adtcore:uri="${index.owner}" del:isDeletable="true"/></del:checkResponse>`,
      );
    if (method === 'DELETE' && url.pathname === table.owner && !h.world.faults.has('delete-unknown')) {
      h.world.objects.get(table.owner)!.metadata = '';
      h.world.objects.get(settings.owner)!.metadata = '';
      return response('');
    }
    return undefined;
  };
  return h;
}

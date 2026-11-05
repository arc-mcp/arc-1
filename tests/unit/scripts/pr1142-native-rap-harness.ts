/** Synthetic native wire composition through the real factory, AdtClient, helpers and dispatchers. */
import { readFileSync } from 'node:fs';
import { rapDocumentFixtures } from '../../../scripts/qualification/pr1142/native-rap-documents-fixtures.js';
import { RAP_STAGES, rapFixtures, rapSettings } from '../../../scripts/qualification/pr1142/native-rap-fixtures.js';
import { buildServiceBindingXml } from '../../../src/adt/ddic-xml.js';
import { ddicHarness } from './pr1142-native-ddic-harness.js';

const { runNativeRap, runNativeRapDocuments } = await import(
  '../../../scripts/qualification/pr1142/native-rap-driver.js'
);

export { RAP_PROTOCOL } from '../../../scripts/qualification/pr1142/native-rap-fixtures.js';
export { RAP_STAGES };
export const fixtures = rapFixtures('0123456789AB');
const core = 'http://www.sap.com/adt/core';
export const documentParentLink = (owner: string) =>
  `<link xmlns="http://www.w3.org/2005/Atom" href="${owner}" rel="http://www.sap.com/adt/relations/dita/documentation" type="application/vnd.sap.adt.sktdv2+xml" title="DITA Documentation"/>`;
const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/></exc:exception>';
const settingsTemplate = readFileSync(new URL('../../fixtures/table-settings-758.xml', import.meta.url), 'utf8');
const classTemplate = readFileSync(
  new URL('../../fixtures/xml/class-metadata-behaviorpool.xml', import.meta.url),
  'utf8',
);
const packageTemplate = readFileSync(
  new URL('../../fixtures/xml/package-local-root-native.xml', import.meta.url),
  'utf8',
);
export function rapHarness(options: Parameters<typeof ddicHarness>[0] & { documents?: boolean } = {}) {
  const { documents, ...native } = options;
  const fixtures = documents ? rapDocumentFixtures('0123456789AB') : rapFixtures('0123456789AB');
  const h = ddicHarness({ ...native, fixtures, execute: documents ? runNativeRapDocuments : runNativeRap });
  const activeDocuments = new Map<string, string>();
  let rows = fixtures;
  const parts: Record<string, string> = {
    definitions: '* native placeholder',
    implementations: '* native placeholder',
  };
  const response = (data = '', statusCode = 200, type = 'application/xml') => ({
    statusCode,
    data,
    responseOptions: { headers: { 'content-type': type } },
  });
  const use = h.useFixtures;
  const useFixtures = (next = fixtures) => {
    rows = next;
    use(next);
    const types = ['TABL/DT', 'DDLS/DF', 'CLAS/OC', 'BDEF/BDO', 'SRVD/SRV', 'SRVB/SVB', 'SKTD/TYP'];
    rows.forEach((f, i) => {
      h.world.objects.get(f.owner)!.nativeType = types[i];
    });
  };
  useFixtures();
  h.useFixtures = useFixtures;
  const store = (xml: string) =>
    xml
      .replace(
        /(<\w+:\w+)(?=\s)/,
        '$1 adtcore:version="inactive" adtcore:createdBy="MARIAN" adtcore:changedBy="MARIAN"',
      )
      .replace(/(<adtcore:packageRef\b)(?![^>]*adtcore:type=)/, '$1 adtcore:type="DEVC/K"')
      .replace('adtcore:masterSystem="H00"', 'adtcore:masterSystem="A4H"');
  h.hooks.reply = (u, method, body) => {
    const [table, view, pool, , service, binding] = rows;
    const path = u.pathname,
      item = rows.find((f) => f.owner.toLowerCase() === path.toLowerCase());
    if (path === '/sap/bc/adt/discovery')
      return response(
        `<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom"><app:workspace><atom:title>RAP native model</atom:title>${rows.map((f) => `<app:collection href="${f.owner.slice(0, f.owner.lastIndexOf('/'))}"><atom:title>Native synthetic collection</atom:title><app:accept>application/xml</app:accept></app:collection>`).join('')}</app:workspace></app:service>`,
      );
    if (path.toLowerCase() === '/sap/bc/adt/packages/%24tmp')
      return response(packageTemplate.replaceAll('$NEW', '$TMP'));
    if (method === 'POST' && path === '/sap/bc/adt/activation') {
      const matches = [...body.matchAll(/adtcore:uri="([^"]+)"/g)].map((v) => v[1]);
      if (!matches.length) return response('bad activation', 599);
      if (u.searchParams.get('preauditRequested') === 'true')
        return response(
          `<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="${core}">${matches
            .map((uri) => {
              const f = rows.find((v) => v.owner.toLowerCase() === uri.toLowerCase())!;
              return `<i:entry><i:object i:deleted="false"><i:ref adtcore:uri="${uri}" adtcore:name="${f.name}"/></i:object></i:entry>`;
            })
            .join('')}</i:inactiveObjects>`,
        );
      for (const uri of matches) {
        const f = rows.find((v) => v.owner.toLowerCase() === uri.toLowerCase())!;
        const o = h.world.objects.get(f.owner)!;
        o.metadata = o.metadata.replaceAll('adtcore:version="inactive"', 'adtcore:version="active"');
        if (f.type === 'SKTD') o.metadata = o.metadata.replaceAll('adtcore:version="new"', 'adtcore:version="active"');
        if (f.type === 'SKTD') activeDocuments.set(f.owner, o.metadata);
      }
      return response(
        '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
      );
    }
    if (method === 'POST' && path.endsWith('/publishjobs')) {
      const o = h.world.objects.get(binding.owner)!;
      o.metadata = o.metadata
        .replace('srvb:published="false"', 'srvb:published="true"')
        .replace('srvb:bindingCreated="false"', 'srvb:bindingCreated="true"');
      return response(
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Published</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>',
      );
    }
    if (method === 'POST' && path.endsWith('/unpublishjobs')) {
      const o = h.world.objects.get(binding.owner)!;
      o.metadata = o.metadata.replace('srvb:published="true"', 'srvb:published="false"');
      return response(
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Unpublished</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>',
      );
    }
    if (
      method === 'POST' &&
      !u.search &&
      rows.some((v) => v.owner.slice(0, v.owner.lastIndexOf('/')).toLowerCase() === path.toLowerCase())
    ) {
      const f = rows.find(
        (v) =>
          body.includes(`adtcore:name="${v.name}"`) &&
          v.owner.slice(0, v.owner.lastIndexOf('/')).toLowerCase() === path.toLowerCase(),
      )!;
      const o = h.world.objects.get(f.owner)!;
      if (f.type === 'SKTD') {
        const parent = h.world.objects.get(rows[3].owner)!;
        parent.metadata = parent.metadata.replace(/(<[^!?][^>]*>)/, `$1${documentParentLink(f.owner)}`);
        const ids = [
          f.name,
          ...['create', 'update', 'delete'].map(
            (op) =>
              `/sap/bc/adt/bo/behaviordefinitions/${f.name.toLowerCase()}/source/main#type=BDEF/BSO;name=${f.name}.${op}`,
          ),
        ];
        o.metadata = store(body).replace(
          '</sktd:docu>',
          `${ids.map((id) => `<sktd:element sktd:longTextObligation="optional" sktd:canHaveDocumentation="true"><sktd:id>${id}</sktd:id><sktd:text></sktd:text><sktd:shortText sktd:text="" sktd:obligation="optional"/><x:opaque xmlns:x="urn:synthetic:opaque" x:value="001"> keep </x:opaque></sktd:element>`).join('')}</sktd:docu>`,
        );
      } else if (f.type === 'CLAS') {
        o.metadata = classTemplate
          .replaceAll('ZBP_DM_PROJECT', pool.name)
          .replaceAll('zbp_dm_project', pool.name.toLowerCase())
          .replaceAll('ZR_DM_PROJECT', view.name)
          .replaceAll('zr_dm_project', view.name.toLowerCase())
          .replaceAll('ZDEMO_MIG_RAP', '$TMP')
          .replaceAll('zdemo_mig_rap', '%24tmp')
          .replaceAll('DEVELOPER', 'MARIAN')
          .replace(/adtcore:description="[^"]*"/, `adtcore:description="${pool.description}"`)
          .replace(/adtcore:version="[^"]*"/g, 'adtcore:version="inactive"')
          .replace(/<class:include\b[\s\S]*?<\/class:include>/g, '')
          .replace(/<atom:link\b[^>]*\/>/g, '');
        o.source = '';
      } else if (f.type === 'SRVB')
        o.metadata = store(
          buildServiceBindingXml({
            name: binding.name,
            package: '$TMP',
            description: binding.description,
            serviceDefinition: service.name,
            bindingType: 'ODATA',
            category: '1',
            odataVersion: 'V4',
            version: '0001',
            language: 'EN',
          }),
        )
          .replace('<srvb:serviceBinding ', '<srvb:serviceBinding srvb:published="false" srvb:bindingCreated="false" ')
          .replace('<srvb:implementation adtcore:name=""', `<srvb:implementation adtcore:name="${binding.name}"`);
      else {
        o.metadata = store(body);
        o.source = '';
      }
      return response(o.metadata, 201);
    }
    const sourceOwner = rows.find((f) => `${f.owner}/source/main`.toLowerCase() === path.toLowerCase());
    if (sourceOwner) {
      const o = h.world.objects.get(sourceOwner.owner)!;
      if (!o.metadata) return response(absent, 404);
      if (method === 'GET') return response(o.source ?? '', 200, 'text/plain');
      if (method === 'PUT') {
        o.source = body;
        o.metadata = o.metadata.replaceAll('adtcore:version="active"', 'adtcore:version="inactive"');
        return response();
      }
    }
    const part = ['definitions', 'implementations', 'macros', 'testclasses'].find(
      (k) => `${pool.owner}/includes/${k}`.toLowerCase() === path.toLowerCase(),
    );
    if (part) {
      if (!h.world.objects.get(pool.owner)!.metadata || !Object.hasOwn(parts, part)) {
        if (method === 'POST') {
          parts[part] = '';
          return response('', 201);
        }
        return response(absent, 404);
      }
      if (method === 'GET') return response(parts[part], 200, 'text/plain');
      if (method === 'PUT') {
        parts[part] = body;
        h.world.objects.get(pool.owner)!.metadata = h.world.objects
          .get(pool.owner)!
          .metadata.replaceAll('adtcore:version="active"', 'adtcore:version="inactive"');
        return response();
      }
    }
    if (method === 'PUT' && item?.type === 'SKTD') {
      h.world.objects.get(item.owner)!.metadata = body.replaceAll(
        'adtcore:version="active"',
        'adtcore:version="inactive"',
      );
      return response();
    }
    if (method === 'DELETE' && item?.type === 'SKTD') {
      const parent = h.world.objects.get(rows[3].owner)!;
      parent.metadata = parent.metadata.replace(documentParentLink(item.owner), '');
      h.world.objects.get(item.owner)!.metadata = '';
      return response();
    }
    if (method === 'GET' && item) {
      const o = h.world.objects.get(item.owner)!;
      if (!o.metadata) return response(absent, 404);
      if (item.type === 'SKTD' && u.searchParams.get('version') === 'active' && activeDocuments.has(item.owner))
        return response(activeDocuments.get(item.owner));
      if (item === pool) {
        const version = /adtcore:version="([^"]+)"/.exec(o.metadata)?.[1];
        return response(
          o.metadata.replace(
            '</class:abapClass>',
            `${['main', ...Object.keys(parts)].map((k) => `<class:include class:includeType="${k}" abapsource:sourceUri="${k === 'main' ? 'source/main' : `includes/${k}`}" adtcore:name="" adtcore:type="CLAS/I" adtcore:version="${version}"/>`).join('')}</class:abapClass>`,
          ),
        );
      }
      return response(o.metadata);
    }
    if (method === 'GET' && path === rapSettings(rows).owner)
      return h.world.objects.get(table.owner)!.metadata.includes('adtcore:version="active"')
        ? response(
            settingsTemplate
              .replaceAll('ZTEST', table.name)
              .replaceAll('ztest', table.name.toLowerCase())
              .replaceAll('TEST_USER', 'MARIAN')
              .replace('ARC1 settings qualification', table.description)
              .replace('version="inactive"', 'version="active"'),
          )
        : response(absent, 404);
    return undefined;
  };
  return { ...h, parts, activeDocuments };
}

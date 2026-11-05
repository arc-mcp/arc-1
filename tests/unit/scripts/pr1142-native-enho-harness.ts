/** Synthetic HTTP world on .invalid using every real client dispatcher. Not native fixture evidence. */
import { readFileSync } from 'node:fs';
import {
  ENHO_BADI,
  ENHO_INTERFACE,
  ENHO_INTERFACE_URI,
  ENHO_SPOT,
  ENHO_SPOT_URI,
  enhoFixtures,
} from '../../../scripts/qualification/pr1142/native-enho-fixtures.js';
import { ddicHarness } from './pr1142-native-ddic-harness.js';

const { runNativeEnho } = await import('../../../scripts/qualification/pr1142/native-enho-driver.js');
export const fixtures = enhoFixtures('0123456789AB');
const core = 'http://www.sap.com/adt/core',
  ns = 'http://www.sap.com/adt/enhancements/enhs';
const classTemplate = readFileSync(new URL('../../fixtures/xml/class-metadata.xml', import.meta.url), 'utf8');
const packageTemplate = readFileSync(
  new URL('../../fixtures/xml/package-local-root-native.xml', import.meta.url),
  'utf8',
);
const spot = `<enhs:objectData xmlns:enhs="${ns}" xmlns:adtcore="${core}" adtcore:name="${ENHO_SPOT}" adtcore:type="ENHS/XSB" adtcore:version="active"><adtcore:packageRef adtcore:name="SADT_REST" adtcore:type="DEVC/K"/><enhs:contentCommon enhs:toolType="BADI_DEF" enhs:internal="false"/><enhs:contentSpecific><enhs:badiTechnology><enhs:badiDefinitions><enhs:badiDefinition enhs:name="${ENHO_BADI}" enhs:singleUse="false" enhs:useFallbackClass="false" enhs:internalUse="false" enhs:amdp="false" enhs:customLogicRegistered="false"><enhs:interface adtcore:name="${ENHO_INTERFACE}" adtcore:type="INTF/OI" adtcore:uri="${ENHO_INTERFACE_URI}"/><enhs:filters><enhs:filter enhs:filterName="URI" enhs:filterType="S"/></enhs:filters></enhs:badiDefinition></enhs:badiDefinitions></enhs:badiTechnology></enhs:contentSpecific></enhs:objectData>`;
const iface = `<intf:abapInterface xmlns:intf="http://www.sap.com/adt/oo/interfaces" xmlns:adtcore="${core}" adtcore:name="${ENHO_INTERFACE}" adtcore:type="INTF/OI" adtcore:version="active"><adtcore:packageRef adtcore:name="SADT_REST" adtcore:type="DEVC/K"/></intf:abapInterface>`;
const declaration =
  'interface IF_ADT_DISCOVERY_PROVIDER public . interfaces IF_BADI_INTERFACE . methods REGISTER_WORKSPACES importing !REGISTRY type ref to IF_ADT_DISCOVERY_REGISTRY . endinterface.';
export function enhoHarness(
  options: Parameters<typeof ddicHarness>[0] = {},
  graph = fixtures,
  execute = runNativeEnho,
) {
  const fixtures = graph;
  const h = ddicHarness({ ...options, fixtures, execute });
  let rows = fixtures,
    active: string | undefined;
  const dependency = { spot, iface, source: declaration };
  const use = h.useFixtures;
  h.useFixtures = (next = fixtures) => {
    rows = next;
    use(next);
    rows.forEach((f) => {
      h.world.objects.get(f.owner)!.nativeType = f.type === 'CLAS' ? 'CLAS/OC' : 'ENHO/XHB';
    });
  };
  h.useFixtures();
  const response = (data = '', statusCode = 200, type = 'application/xml') => ({
    statusCode,
    data,
    responseOptions: { headers: { 'content-type': type } },
  });
  const store = (body: string, version = 'inactive') =>
    body
      .replace(/(<enho:objectData\b)/, '$1 adtcore:createdBy="MARIAN" adtcore:changedBy="MARIAN"')
      .replace(/ adtcore:(?:version|createdBy|changedBy)="[^"]*"/g, '')
      .replace(
        '<enho:objectData ',
        `<enho:objectData adtcore:version="${version}" adtcore:createdBy="MARIAN" adtcore:changedBy="MARIAN" `,
      )
      .replace(/(<adtcore:packageRef\b)(?![^>]*adtcore:type=)/, '$1 adtcore:type="DEVC/K"');
  const render = (body: string) => {
    const cls = rows[0];
    let value = store(body)
      .replace(/<enho:badiImplementation\b[^>]*>/g, (open) => {
        open = open.replace(/ enho:runtimeBehaviorShorttext="[^"]*"/g, '');
        if (!open.includes('enho:customizingLock=')) open = open.replaceAll('>', ' enho:customizingLock="">');
        return open.replaceAll('>', ' enho:runtimeBehaviorShorttext="Synthetic disabled state">');
      })
      .replaceAll(
        `/sap/bc/adt/vit/wb/object_type/enhsxb/object_name/${ENHO_SPOT}`,
        `${ENHO_SPOT_URI}#type=enhs%2fxb;name=${ENHO_BADI.toLowerCase()}`,
      );
    if (!value.includes('enhcore:element_usage="USEO"'))
      for (const [name, type, uri] of [
        [cls.name, 'CLAS/OC', cls.owner],
        [ENHO_INTERFACE, 'INTF/OI', ENHO_INTERFACE_URI],
      ])
        value = value.replace(
          '</enho:usages>',
          `<enhcore:referencedObject enhcore:program_id="R3TR" enhcore:element_usage="USEO" enhcore:upgrade="false" enhcore:automatic_transport="false"><enhcore:objectReference adtcore:name="${name}" adtcore:type="${type}" adtcore:uri="${uri}"/><enhcore:mainObjectReference adtcore:name="${name}" adtcore:type="${type}" adtcore:uri="${uri}"/></enhcore:referencedObject></enho:usages>`,
        );
    return value;
  };
  h.hooks.reply = (u, method, body) => {
    const path = u.pathname,
      item = rows.find((v) => v.owner.toLowerCase() === path.toLowerCase());
    if (path === '/sap/bc/adt/discovery')
      return response(
        `<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom"><app:workspace><atom:title>Synthetic enhancement model</atom:title>${['/sap/bc/adt/oo/classes', '/sap/bc/adt/enhancements/enhoxhb', '/sap/bc/adt/enhancements/enhsxsb'].map((p) => `<app:collection href="${p}"><atom:title>Native collection model</atom:title><app:accept>application/xml</app:accept></app:collection>`).join('')}</app:workspace></app:service>`,
      );
    if (path === ENHO_SPOT_URI) return response(dependency.spot);
    if (path === ENHO_INTERFACE_URI) return response(dependency.iface);
    if (path === `${ENHO_INTERFACE_URI}/source/main`) return response(dependency.source, 200, 'text/plain');
    if (path.toLowerCase() === '/sap/bc/adt/packages/%24tmp')
      return response(packageTemplate.replaceAll('$NEW', '$TMP'));
    if (method === 'POST' && !u.searchParams.has('_action')) {
      const created = rows.find(
        (f) => f.owner.slice(0, f.owner.lastIndexOf('/')) === path && !h.world.objects.get(f.owner)!.metadata,
      );
      if (created) {
        const o = h.world.objects.get(created.owner)!;
        if (h.world.faults.has('create-unknown')) return response('', 503);
        if (created.type === 'CLAS') {
          o.metadata = classTemplate
            .replaceAll('ZCL_EXAMPLE', created.name)
            .replaceAll('DEVELOPER', 'MARIAN')
            .replaceAll('NPL', 'A4H')
            .replaceAll('Example test class', created.description)
            .replace('adtcore:version="active"', 'adtcore:version="inactive"');
          o.source = '* Synthetic generated empty class';
        } else
          o.metadata = store(
            body.replace(/<enho:badiImplementations(?:\/>|>[\s\S]*?<\/enho:badiImplementations>)/, ''),
            'new',
          );
        return response(o.metadata, 201);
      }
    }
    if (method === 'POST' && path === '/sap/bc/adt/activation') {
      const owner = /adtcore:uri="([^"]+)"/.exec(body)?.[1],
        f = rows.find((v) => v.owner === owner);
      if (!f) return response('Unexpected activation', 599);
      if (u.searchParams.get('preauditRequested') === 'true')
        return response(
          `<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="${core}"><i:entry><i:object i:deleted="false"><i:ref adtcore:uri="${f.owner}" adtcore:name="${f.name}"/></i:object></i:entry></i:inactiveObjects>`,
        );
      const o = h.world.objects.get(f.owner)!;
      o.metadata = o.metadata
        .replaceAll('adtcore:version="inactive"', 'adtcore:version="active"')
        .replaceAll('adtcore:version="new"', 'adtcore:version="active"');
      if (f.type === 'ENHO') active = o.metadata;
      return response(
        '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
      );
    }
    if (item?.type === 'ENHO' && method === 'PUT') {
      if (h.world.faults.has('save-unknown')) return response('', 503);
      h.world.objects.get(item.owner)!.metadata = render(body);
      return response();
    }
    if (
      item?.type === 'ENHO' &&
      method === 'GET' &&
      u.searchParams.get('version') === 'active' &&
      active &&
      h.world.objects.get(item.owner)!.metadata
    )
      return response(active);
    return undefined;
  };
  return {
    ...h,
    dependency,
    activeDocument: () => active,
    changeActive: (value: string) => {
      active = value;
    },
  };
}

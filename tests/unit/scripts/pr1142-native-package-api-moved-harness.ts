/** Actual owned preflight bodies; only future API/CTS transition bodies are synthetic. */

import { apiDocumentPath } from '../../../scripts/qualification/pr1142/native-package-api-profile.js';
import { PACKAGE_API_RETAINED_GRAPH as graph } from '../../../scripts/qualification/pr1142/native-package-api-retained-fixed.js';
import bodies from '../../fixtures/json/package-api-moved-state.json';
import { packageApiHarness } from './pr1142-native-package-api-harness.js';

export { graph };
export function movedHarness(
  options: {
    proxy?: boolean;
    semaphore?: import('../../../src/adt/semaphore.js').Semaphore;
    token?: () => Promise<string>;
  } = {},
) {
  const body = (path: string) => {
    const value = bodies.find((r) => r.path === path)?.body;
    if (!value) throw new Error(`Missing captured body ${path}`);
    return value;
  };
  const metadata = Object.fromEntries(
    bodies
      .filter(
        (r) =>
          /\/packages\/|\/oo\/(?:classes|interfaces)\//.test(r.path) &&
          !r.path.includes('source') &&
          !r.path.includes('?'),
      )
      .map((r) => [r.path, r.body]),
  );
  const h = packageApiHarness({
    ...options,
    graph,
    movedApi: true,
    retainedApi: true,
    retained: {
      metadata,
      source: body(`${graph.clas.owner}/source/main`),
      intfSource: body(`/sap/bc/adt/oo/interfaces/zif_arc1_pk_${graph.suffix.toLowerCase()}/source/main`),
    },
  });
  const request = '/sap/bc/adt/cts/transportrequests/A4HK906609',
    api = apiDocumentPath(graph);
  let released = false,
    touched = false;
  const apiName = /<ars:transportObject[^>]+adtcore:name="([^"]+)"/.exec(body(api))![1];
  const apiRow = `<tm:abap_object tm:pgmid="R3TR" tm:type="APIS" tm:name="${apiName}" tm:position="000002" tm:lock_status="X"/>`;
  const nativeReply = (r: (typeof h.calls)[number]) => {
    if (r.path.startsWith(api)) {
      if (r.method === 'PUT') {
        released = r.body.includes('ars:state="RELEASED"');
        touched = true;
      }
      let xml = body(api);
      if (released)
        xml = xml
          .replace('ars:isAnyContractReleased="false"', 'ars:isAnyContractReleased="true"')
          .replace(/(<ars:c1Release[\s\S]*?<ars:status ars:state=)"NOT_RELEASED"/, '$1"RELEASED"')
          .replace(/(<ars:c1Release[^>]*ars:useInSAPCloudPlatform=)"false"/, '$1"true"');
      return { statusCode: 200, data: xml };
    }
    if (r.method !== 'GET') return;
    if (r.path === '/sap/bc/adt/packages/ZARC1_DEMO') return { statusCode: 200, data: body(r.path) };
    if (/^\/sap\/bc\/adt\/cts\/transportrequests\/A4HK9066(?:09|10|11)$/.test(r.path)) {
      let xml = body(r.path);
      if (touched && r.path === request)
        xml = xml
          .replace('</tm:all_objects>', `${apiRow}</tm:all_objects>`)
          .replace(/(<tm:task tm:number="A4HK906611"[\s\S]*?)(<\/tm:task>)/, `$1${apiRow}$2`);
      return { statusCode: 200, data: xml };
    }
  };
  let override: typeof h.hooks.reply;
  h.hooks.reply = (r) => override?.(r) ?? nativeReply(r);
  const hooks = new Proxy(h.hooks, {
    set(t, key, value) {
      if (key === 'reply') override = value;
      else Reflect.set(t, key, value);
      return true;
    },
    get(t, key) {
      return key === 'reply' ? override : Reflect.get(t, key);
    },
  });
  return { ...h, hooks, nativeReply };
}

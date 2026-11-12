import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

// Response shapes captured from SAP_BASIS 758 (object names replaced).
function binding(version: string, contents: string, type = 'ODATA', category = '0'): string {
  return `<?xml version="1.0" encoding="utf-8"?><srvb:serviceBinding srvb:published="true" adtcore:name="ZUI_DEMO" adtcore:type="SRVB/SVB" xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core"><srvb:services srvb:name="ZUI_DEMO">${contents}</srvb:services><srvb:binding srvb:type="${type}" srvb:version="${version}" srvb:category="${category}"><srvb:implementation adtcore:name="ZUI_DEMO"/></srvb:binding></srvb:serviceBinding>`;
}

function content(version = '0001'): string {
  return `<srvb:content srvb:version="${version}" srvb:releaseState="NOT_RELEASED"><srvb:serviceDefinition adtcore:uri="/sap/bc/adt/ddic/srvd/sources/zui_def" adtcore:type="SRVD/SRV" adtcore:name="ZUI_DEF"/></srvb:content>`;
}

const SERVICE_INFO_NS = 'xmlns:serviceInfo="http://www.sap.com/categories/serviceinformation"';

const V4_PUBLISHED = `<?xml version="1.0" encoding="utf-8"?><odatav4:serviceGroup odatav4:published="true" odatav4:serviceUrlPrefix="/sap/opu/odata4/sap/zui_demo/srvd/" adtcore:name="ZUI_DEMO" xmlns:odatav4="http://www.sap.com/categories/odatav4" xmlns:adtcore="http://www.sap.com/adt/core"><odatav4:services odatav4:repositoryId="SRVD" odatav4:serviceId="ZUI_DEMO" odatav4:serviceVersion="0001" odatav4:serviceUrl="/sap/opu/odata4/sap/zui_demo/srvd/sap/zui_demo/0001/" odatav4:annotationUrl="" odatav4:created="true"><serviceInfo:serviceInformation serviceInfo:name="ZUI_DEMO" serviceInfo:version="0001" ${SERVICE_INFO_NS}><serviceInfo:collection serviceInfo:name="Orders" serviceInfo:isLeading="false" serviceInfo:isRoot="true"><serviceInfo:navigation serviceInfo:name="_Item" serviceInfo:target="Items"/></serviceInfo:collection><serviceInfo:collection serviceInfo:name="Items" serviceInfo:isLeading="false" serviceInfo:isRoot="false"><serviceInfo:navigation serviceInfo:name="_Order" serviceInfo:target="Orders"/></serviceInfo:collection></serviceInfo:serviceInformation></odatav4:services></odatav4:serviceGroup>`;

const V4_UNPUBLISHED = `<?xml version="1.0" encoding="utf-8"?><odatav4:serviceGroup odatav4:published="false" odatav4:serviceUrlPrefix="/sap/opu/odata4/sap/zui_demo/srvd_a2x/" adtcore:name="ZUI_DEMO" xmlns:odatav4="http://www.sap.com/categories/odatav4" xmlns:adtcore="http://www.sap.com/adt/core"><odatav4:services odatav4:repositoryId="SRVD_A2X" odatav4:serviceId="ZUI_DEMO" odatav4:serviceVersion="0001" odatav4:serviceUrl="" odatav4:annotationUrl="" odatav4:created="true"><serviceInfo:serviceInformation ${SERVICE_INFO_NS}/></odatav4:services></odatav4:serviceGroup>`;

function v2Document(serviceVersion = '0001'): string {
  return `<?xml version="1.0" encoding="utf-8"?><odatav2:serviceList xmlns:odatav2="http://www.sap.com/categories/odatav2"><odatav2:services odatav2:repositoryId="" odatav2:serviceId="ZUI_DEMO" odatav2:serviceVersion="${serviceVersion}" odatav2:serviceUrl="/sap/opu/odata/sap/ZUI_DEMO" odatav2:annotationUrl="" odatav2:published="true" odatav2:created="true"><serviceInfo:serviceInformation serviceInfo:name="ZUI_DEMO" serviceInfo:version="${serviceVersion}" ${SERVICE_INFO_NS}><serviceInfo:collection serviceInfo:name="Orders" serviceInfo:isLeading="false" serviceInfo:isRoot="true"/></serviceInfo:serviceInformation></odatav2:services></odatav2:serviceList>`;
}

const V2_UNPUBLISHED = `<?xml version="1.0" encoding="utf-8"?><odatav2:serviceList xmlns:odatav2="http://www.sap.com/categories/odatav2"><odatav2:services odatav2:repositoryId="" odatav2:serviceId="ZUI_DEMO" odatav2:serviceVersion="0001" odatav2:serviceUrl="" odatav2:annotationUrl="" odatav2:published="false" odatav2:created="true"><serviceInfo:serviceInformation ${SERVICE_INFO_NS}/></odatav2:services></odatav2:serviceList>`;

function respond(bindingXml: string, documents: Record<string, string> = {}): void {
  mockFetch.mockImplementation((url: string) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/core/discovery')) return Promise.resolve(mockResponse(200, ''));
    if (parsed.pathname.includes('/businessservices/bindings/')) return Promise.resolve(mockResponse(200, bindingXml));
    const version = parsed.searchParams.get('serviceversion') ?? '';
    const document = documents[version];
    return Promise.resolve(document === undefined ? mockResponse(404, 'Not found') : mockResponse(200, document));
  });
}

async function read(args: Record<string, unknown> = {}) {
  return handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
    type: 'SRVB',
    name: 'ZUI_DEMO',
    include: 'service_info',
    ...args,
  });
}

function infoRequests(): URL[] {
  return mockFetch.mock.calls
    .map(([url]) => new URL(String(url)))
    .filter((url) => /\/businessservices\/odatav[24]\//.test(url.pathname));
}

beforeEach(() => vi.resetAllMocks());

describe('SAPRead SRVB include=service_info', () => {
  it('returns URL, entity sets and navigations of a published V4 service', async () => {
    respond(binding('V4', content()), { '0001': V4_PUBLISHED });

    const result = await read();

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      name: 'ZUI_DEMO',
      bindingType: 'ODATA',
      odataVersion: 'V4',
      bindingCategory: 'UI',
      services: [
        {
          serviceName: 'ZUI_DEMO',
          serviceVersion: '0001',
          serviceDefinition: 'ZUI_DEF',
          releaseState: 'NOT_RELEASED',
          published: true,
          serviceUrl: '/sap/opu/odata4/sap/zui_demo/srvd/sap/zui_demo/0001/',
          entitySets: [
            { name: 'Orders', isRoot: true, navigations: [{ name: '_Item', target: 'Items' }] },
            { name: 'Items', isRoot: false, navigations: [{ name: '_Order', target: 'Orders' }] },
          ],
        },
      ],
    });
  });

  it('sends the query parameters SAP requires to the collection of the OData version', async () => {
    respond(binding('V4', content()), { '0001': V4_PUBLISHED });
    await read();
    const [request] = infoRequests();
    expect(request?.pathname).toBe('/sap/bc/adt/businessservices/odatav4/ZUI_DEMO');
    expect(Object.fromEntries(request?.searchParams ?? [])).toMatchObject({
      servicename: 'ZUI_DEMO',
      serviceversion: '0001',
      srvdname: 'ZUI_DEF',
    });
  });

  it('reads the V2 document and reports a Web API binding category', async () => {
    respond(binding('V2', content(), 'ODATA', '1'), { '0001': v2Document() });

    const info = JSON.parse((await read()).content[0]!.text);

    expect(infoRequests()[0]?.pathname).toBe('/sap/bc/adt/businessservices/odatav2/ZUI_DEMO');
    expect(info.bindingCategory).toBe('Web API');
    expect(info.services[0]).toMatchObject({
      published: true,
      serviceUrl: '/sap/opu/odata/sap/ZUI_DEMO',
      entitySets: [{ name: 'Orders', isRoot: true, navigations: [] }],
    });
  });

  it.each([
    ['V4', V4_UNPUBLISHED],
    ['V2', V2_UNPUBLISHED],
  ])('reports an unpublished %s service as unknown entity sets, not an empty list', async (version, document) => {
    respond(binding(version, content()), { '0001': document });

    const [service] = JSON.parse((await read()).content[0]!.text).services;

    expect(service.published).toBe(false);
    expect(service).not.toHaveProperty('entitySets');
    expect(service).not.toHaveProperty('serviceUrl');
    expect(service.note).toContain('publish_srvb');
  });

  it.each(['', 'unknown'])('keeps an unknown publication state (%s) separate from unpublished', async (state) => {
    respond(binding('V4', content()), { '0001': V4_PUBLISHED.replace('published="true"', `published="${state}"`) });
    const [service] = JSON.parse((await read()).content[0]!.text).services;
    expect(service).not.toHaveProperty('published');
    expect(service).not.toHaveProperty('entitySets');
    expect(service.serviceUrl).toContain('/sap/opu/odata4/');
    expect(service.note).toContain('unknown');
    expect(service.note).not.toContain('publish_srvb');
  });

  it.each([403, 500])('propagates native HTTP %s without invented service information', async (status) => {
    respond(binding('V4', content()));
    const original = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((...args) =>
      String(args[0]).includes('/odatav4/')
        ? Promise.resolve(mockResponse(status, 'Native read failed'))
        : original(...args),
    );
    const result = await read();
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).not.toContain('entitySets');
  });

  it('reads publication changes again instead of caching the service document', async () => {
    respond(binding('V4', content()), { '0001': V4_UNPUBLISHED });
    expect(JSON.parse((await read()).content[0]!.text).services[0].published).toBe(false);
    respond(binding('V4', content()), { '0001': V4_PUBLISHED });
    expect(JSON.parse((await read()).content[0]!.text).services[0].published).toBe(true);
    expect(infoRequests()).toHaveLength(2);
  });

  it('reads every declared service version', async () => {
    respond(binding('V2', content('0001') + content('0002')), {
      '0001': v2Document('0001'),
      '0002': v2Document('0002'),
    });

    const { services } = JSON.parse((await read()).content[0]!.text);

    expect(services.map((service: { serviceVersion: string }) => service.serviceVersion)).toEqual(['0001', '0002']);
    expect(infoRequests()).toHaveLength(2);
  });

  it('does not request service information for a binding that is not OData V2 or V4', async () => {
    respond(binding('', content(), 'INA'));

    const info = JSON.parse((await read()).content[0]!.text);

    expect(infoRequests()).toHaveLength(0);
    expect(info.note).toContain('only for OData');
    expect(info.services[0]).not.toHaveProperty('published');
  });

  it('fails when SAP omits the requested service instead of reporting no entity sets', async () => {
    respond(binding('V2', content()), { '0001': v2Document('0009') });

    const result = await read();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('no service information');
  });

  it('propagates a failed service information read', async () => {
    respond(binding('V4', content()));
    expect((await read()).isError).toBe(true);
  });

  it('encodes the binding name and service parameters', async () => {
    const namespaced = binding('V4', content())
      .replaceAll('adtcore:name="ZUI_DEMO"', 'adtcore:name="/NS/DEMO"')
      .replaceAll('srvb:name="ZUI_DEMO"', 'srvb:name="/NS/DEMO"');
    respond(namespaced, { '0001': V4_PUBLISHED.replaceAll('serviceId="ZUI_DEMO"', 'serviceId="/NS/DEMO"') });

    await read({ name: '/NS/DEMO' });

    const url = String(mockFetch.mock.calls.map(([called]) => called).find((u) => String(u).includes('/odatav4/')));
    expect(url).toContain('/odatav4/%2FNS%2FDEMO?');
    expect(url).toContain('servicename=%2FNS%2FDEMO');
  });

  it.each([{ type: 'CLAS' }, { action: 'diff' }, { version: 'active' }, { grep: 'x' }, { format: 'structured' }])(
    'refuses %j before requesting SAP',
    async (options) => {
      const result = await read(options);
      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it('leaves the plain SRVB read unchanged', async () => {
    respond(binding('V4', content()));

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'SRVB', name: 'ZUI_DEMO' });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ odataVersion: 'V4', serviceDefinition: 'ZUI_DEF' });
    expect(infoRequests()).toHaveLength(0);
  });
});

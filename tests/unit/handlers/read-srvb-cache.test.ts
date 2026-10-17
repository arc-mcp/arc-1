import { beforeEach, describe, expect, it } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const NO_DRAFTS = `<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"/>`;
const SRVB_DRAFT = `<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:user="admin" ioc:deleted="false"><ioc:ref adtcore:uri="/sap/bc/adt/businessservices/bindings/zui_travel_o4" adtcore:type="SRVB/SVB" adtcore:name="ZUI_TRAVEL_O4"/></ioc:object></ioc:entry></ioc:inactiveObjects>`;
const SRVB_XML = `<?xml version="1.0"?><srvb:serviceBinding srvb:contract="C1" srvb:published="true" srvb:bindingCreated="true"
  adtcore:name="ZUI_TRAVEL_O4" adtcore:type="SRVB/SVB" adtcore:description="Travel UI"
  adtcore:language="EN" xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings"
  xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:packageRef adtcore:name="ZTRAVEL"/>
  <srvb:services srvb:name="ZUI_TRAVEL">
    <srvb:content srvb:version="0001" srvb:releaseState="NOT_RELEASED">
      <srvb:serviceDefinition adtcore:name="ZSD_TRAVEL"/>
    </srvb:content>
  </srvb:services>
  <srvb:binding srvb:type="ODATA" srvb:version="V4" srvb:category="0">
    <srvb:implementation adtcore:name="ZUI_TRAVEL_O4"/>
  </srvb:binding>
</srvb:serviceBinding>`;

const readSrvb = (layer: CachingLayer) =>
  handleToolCall(
    createClient(),
    DEFAULT_CONFIG,
    'SAPRead',
    { type: 'SRVB', name: 'ZUI_TRAVEL_O4' },
    undefined,
    undefined,
    layer,
  );

// SRVB answers are JSON; a text prefix would make them unparseable.
describe('SAPRead SRVB keeps JSON parseable with cache and draft notes', () => {
  beforeEach(() => mockFetch.mockReset());

  it('reports a 304 revalidation as a "cached" field instead of a text prefix', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, NO_DRAFTS))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML, { etag: 'e1' }))
      .mockResolvedValueOnce(mockResponse(304, '', { etag: 'e1' }));
    const layer = new CachingLayer(new MemoryCache());

    const first = await readSrvb(layer);
    const firstJson = JSON.parse(first.content[0]!.text);
    expect(firstJson.cached).toBeUndefined();
    expect(firstJson.name).toBe('ZUI_TRAVEL_O4');

    const second = await readSrvb(layer);
    expect(second.isError).toBeUndefined();
    const secondJson = JSON.parse(second.content[0]!.text);
    expect(secondJson.cached).toBe('revalidated');
    expect({ ...secondJson, cached: undefined }).toEqual({ ...firstJson, cached: undefined });
  });

  it('keeps draft and revalidation notes together in JSON without caching the notes', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, SRVB_DRAFT))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML, { etag: 'e1' }))
      .mockResolvedValueOnce(mockResponse(304, '', { etag: 'e1' }));

    const cache = new MemoryCache();
    const layer = new CachingLayer(cache);
    const result = await readSrvb(layer);
    expect(result.isError).toBeUndefined();
    const json = JSON.parse(result.content[0]!.text);
    expect(json.warning).toContain('unactivated draft');
    expect(json.odataVersion).toBe('V4');
    const second = JSON.parse((await readSrvb(layer)).content[0]!.text);
    expect(second).toEqual({ ...json, cached: 'revalidated' });
    const stored = JSON.parse(cache.getSource('SRVB', 'ZUI_TRAVEL_O4')!.source);
    expect(stored.warning).toBeUndefined();
    expect(stored.cached).toBeUndefined();
  });
});

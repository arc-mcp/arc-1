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

const readSrvb = (layer?: CachingLayer, args: Record<string, unknown> = {}) =>
  handleToolCall(
    createClient(),
    DEFAULT_CONFIG,
    'SAPRead',
    { type: 'SRVB', name: 'ZUI_TRAVEL_O4', ...args },
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

  it.each([
    { requested: 'inactive', hasDraft: true, selected: 'inactive', warns: false },
    { requested: 'inactive', hasDraft: false, selected: 'inactive', warns: true },
    { requested: 'auto', hasDraft: true, selected: 'inactive', warns: false },
    { requested: 'auto', hasDraft: false, selected: 'active', warns: false },
  ] as const)('keeps $requested reads parseable with hasDraft=$hasDraft', async (testCase) => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, testCase.hasDraft ? SRVB_DRAFT : NO_DRAFTS))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML, { etag: 'e1' }))
      .mockResolvedValueOnce(mockResponse(304, '', { etag: 'e1' }));
    const cache = new MemoryCache();
    const layer = new CachingLayer(cache);
    const args = { version: testCase.requested };

    const first = JSON.parse((await readSrvb(layer, args)).content[0]!.text);
    expect(first.name).toBe('ZUI_TRAVEL_O4');
    expect(first.cached).toBeUndefined();
    if (testCase.warns) expect(first.warning).toContain('No inactive draft exists');
    else expect(first.warning).toBeUndefined();

    const second = JSON.parse((await readSrvb(layer, args)).content[0]!.text);
    expect(second).toEqual({ ...first, cached: 'revalidated' });
    const [, initial, revalidation] = mockFetch.mock.calls;
    expect(new URL(String(initial![0])).searchParams.get('version')).toBe(testCase.selected);
    expect(new URL(String(revalidation![0])).searchParams.get('version')).toBe(testCase.selected);
    expect(revalidation![1].headers['If-None-Match']).toBe('e1');
    const stored = cache.getSource('SRVB', 'ZUI_TRAVEL_O4', testCase.selected)!;
    expect(stored.etag).toBe('e1');
    expect(JSON.parse(stored.source)).toEqual({ ...first, warning: undefined });
  });

  it('keeps active and inactive metadata and validators separate', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, SRVB_DRAFT))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML, { etag: 'active-etag' }))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML.replace('Travel UI', 'Draft UI'), { etag: 'draft-etag' }))
      .mockResolvedValueOnce(mockResponse(304, ''))
      .mockResolvedValueOnce(mockResponse(304, ''));
    const layer = new CachingLayer(new MemoryCache());
    await readSrvb(layer);
    await readSrvb(layer, { version: 'inactive' });
    const active = JSON.parse((await readSrvb(layer)).content[0]!.text);
    const inactive = JSON.parse((await readSrvb(layer, { version: 'inactive' })).content[0]!.text);

    expect(active).toMatchObject({ description: 'Travel UI', cached: 'revalidated' });
    expect(active.warning).toContain('unactivated draft');
    expect(inactive).toMatchObject({ description: 'Draft UI', cached: 'revalidated' });
    expect(inactive.warning).toBeUndefined();
    expect(mockFetch.mock.calls[3]![1].headers['If-None-Match']).toBe('active-etag');
    expect(mockFetch.mock.calls[4]![1].headers['If-None-Match']).toBe('draft-etag');
  });

  it('drops an obsolete draft warning while revalidating the same cached body', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, SRVB_DRAFT))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML, { etag: 'e1' }))
      .mockResolvedValueOnce(mockResponse(200, NO_DRAFTS))
      .mockResolvedValueOnce(mockResponse(304, ''));
    const cache = new MemoryCache();
    const layer = new CachingLayer(cache);
    expect(JSON.parse((await readSrvb(layer)).content[0]!.text).warning).toContain('unactivated draft');
    const stored = cache.getSource('SRVB', 'ZUI_TRAVEL_O4')!;
    layer.inactiveLists.invalidate('admin');

    const result = JSON.parse((await readSrvb(layer)).content[0]!.text);
    expect(result).toEqual({ ...JSON.parse(stored.source), cached: 'revalidated' });
    expect(result.warning).toBeUndefined();
    expect(cache.getSource('SRVB', 'ZUI_TRAVEL_O4')).toEqual(stored);
  });

  it.each([undefined, 'e1'])('returns a changed 200 without a cache marker (previous ETag: %s)', async (etag) => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, NO_DRAFTS))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML, etag ? { etag } : {}))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML.replace('Travel UI', 'Updated UI'), { etag: 'e2' }));
    const cache = new MemoryCache();
    const layer = new CachingLayer(cache);
    await readSrvb(layer);
    const result = JSON.parse((await readSrvb(layer)).content[0]!.text);

    expect(result.description).toBe('Updated UI');
    expect(result.cached).toBeUndefined();
    expect(mockFetch.mock.calls[2]![1].headers['If-None-Match']).toBe(etag);
    const stored = cache.getSource('SRVB', 'ZUI_TRAVEL_O4')!;
    expect(stored.etag).toBe('e2');
    expect(JSON.parse(stored.source)).toEqual(result);
  });

  it('force-refreshes both versions and the draft list before resolving auto', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(200, SRVB_DRAFT))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML, { etag: 'active-etag' }))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML.replace('Travel UI', 'Draft UI'), { etag: 'draft-etag' }))
      .mockResolvedValueOnce(mockResponse(200, NO_DRAFTS))
      .mockResolvedValueOnce(mockResponse(200, SRVB_XML.replace('Travel UI', 'Activated UI'), { etag: 'new-etag' }));
    const cache = new MemoryCache();
    const layer = new CachingLayer(cache);
    await readSrvb(layer);
    await readSrvb(layer, { version: 'inactive' });
    const result = JSON.parse((await readSrvb(layer, { version: 'auto', force_refresh: true })).content[0]!.text);

    expect(result.description).toBe('Activated UI');
    expect(result.warning).toBeUndefined();
    expect(result.cached).toBeUndefined();
    expect(String(mockFetch.mock.calls[3]![0])).toContain('/inactiveobjects');
    const refresh = mockFetch.mock.calls[4]!;
    expect(new URL(String(refresh[0])).searchParams.get('version')).toBe('active');
    expect(refresh[1].headers['If-None-Match']).toBeUndefined();
    expect(cache.getSource('SRVB', 'ZUI_TRAVEL_O4', 'inactive')).toBeNull();
    expect(JSON.parse(cache.getSource('SRVB', 'ZUI_TRAVEL_O4')!.source)).toEqual(result);
  });

  it('keeps the inactive fallback warning in JSON when caching is disabled', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, NO_DRAFTS)).mockResolvedValueOnce(mockResponse(200, SRVB_XML));

    const result = JSON.parse((await readSrvb(undefined, { version: 'inactive' })).content[0]!.text);
    expect(result.name).toBe('ZUI_TRAVEL_O4');
    expect(result.warning).toContain('No inactive draft exists');
    expect(result.cached).toBeUndefined();
  });
});

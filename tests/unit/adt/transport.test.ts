import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import {
  CTS_ACCEPT_TREE,
  CTS_CONTENT_TYPE_ORGANIZER,
  CTS_NAMESPACE_TM,
  createTransport,
  createTransportWithTarget,
  deleteTransport,
  getObjectTransports,
  getTransport,
  getTransportInfo,
  listTransportLayers,
  listTransports,
  listTransportTargets,
  reassignTransport,
  releaseTransport,
  releaseTransportRecursive,
  supportsExplicitTransportTarget,
} from '../../../src/adt/transport.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures/xml');
const loadFixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf-8');

function mockHttp(responseBody = ''): AdtHttpClient {
  return {
    get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: responseBody }),
    post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: responseBody }),
    put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    delete: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    fetchCsrfToken: vi.fn(),
    withStatefulSession: vi.fn(),
  } as unknown as AdtHttpClient;
}

const enabledSafety = { ...unrestrictedSafetyConfig(), allowTransportWrites: true };

describe('Transport Management', () => {
  // ─── listTransports ────────────────────────────────────────────────

  describe('listTransports', () => {
    it('works when transports are enabled', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEVELOPER" tm:desc="Test transport" tm:status="D" tm:type="K"/>
      </tm:root>`;
      const http = mockHttp(xml);
      const transports = await listTransports(http, enabledSafety);
      expect(transports).toHaveLength(1);
      expect(transports[0]?.id).toBe('DEVK900001');
      expect(transports[0]?.owner).toBe('DEVELOPER');
      expect(transports[0]?.description).toBe('Test transport');
      expect(transports[0]?.status).toBe('D');
      expect(transports[0]?.type).toBe('K');
    });

    it('handles multiple transports', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV1" tm:desc="First" tm:status="D" tm:type="K"/>
        <tm:request tm:number="DEVK900002" tm:owner="DEV2" tm:desc="Second" tm:status="R" tm:type="K"/>
        <tm:request tm:number="DEVK900003" tm:owner="DEV1" tm:desc="Third" tm:status="D" tm:type="W"/>
      </tm:root>`;
      const http = mockHttp(xml);
      const transports = await listTransports(http, enabledSafety);
      expect(transports).toHaveLength(3);
      expect(transports[1]?.status).toBe('R'); // Released
    });

    it('filters by user when provided', async () => {
      const http = mockHttp('<tm:root xmlns:tm="http://www.sap.com/cts/transports"/>');
      await listTransports(http, enabledSafety, 'TESTUSER');
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('user=TESTUSER');
    });

    it('does not add user param for wildcard', async () => {
      const http = mockHttp('<tm:root xmlns:tm="http://www.sap.com/cts/transports"/>');
      await listTransports(http, enabledSafety, '*');
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).not.toContain('user=');
    });

    it('sends requestType=KWT and target=true (sapcli pattern)', async () => {
      const http = mockHttp('<tm:root xmlns:tm="http://www.sap.com/cts/transports"/>');
      await listTransports(http, enabledSafety);
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('requestType=KWT');
      expect(url).toContain('target=true');
    });

    it('sends requestStatus=DR by default', async () => {
      const http = mockHttp('<tm:root xmlns:tm="http://www.sap.com/cts/transports"/>');
      await listTransports(http, enabledSafety);
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('requestStatus=DR');
    });

    it('sends requestStatus=D when status filter is D', async () => {
      const http = mockHttp('<tm:root xmlns:tm="http://www.sap.com/cts/transports"/>');
      await listTransports(http, enabledSafety, undefined, 'D');
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('requestStatus=D');
    });

    it('filters status client-side as fallback', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV1" tm:desc="Modifiable" tm:status="D" tm:type="K"/>
        <tm:request tm:number="DEVK900002" tm:owner="DEV2" tm:desc="Released" tm:status="R" tm:type="K"/>
      </tm:root>`;
      const http = mockHttp(xml);
      const transports = await listTransports(http, enabledSafety, undefined, 'D');
      expect(transports).toHaveLength(1);
      expect(transports[0]?.status).toBe('D');
    });

    it('status=* returns all statuses', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV1" tm:desc="Modifiable" tm:status="D" tm:type="K"/>
        <tm:request tm:number="DEVK900002" tm:owner="DEV2" tm:desc="Released" tm:status="R" tm:type="K"/>
      </tm:root>`;
      const http = mockHttp(xml);
      const transports = await listTransports(http, enabledSafety, undefined, '*');
      expect(transports).toHaveLength(2);
    });

    it('handles empty response', async () => {
      const http = mockHttp('<tm:root xmlns:tm="http://www.sap.com/cts/transports"/>');
      const transports = await listTransports(http, enabledSafety);
      expect(transports).toEqual([]);
    });

    it('extracts tasks from transport requests', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEVELOPER" tm:desc="Test transport" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T" tm:owner="DEV1" tm:desc="Task 1" tm:status="D"/>
          <tm:task tm:number="DEVK900002T" tm:owner="DEV2" tm:desc="Task 2" tm:status="R"/>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      const transports = await listTransports(http, enabledSafety);
      expect(transports).toHaveLength(1);
      expect(transports[0]?.tasks).toHaveLength(2);
      expect(transports[0]?.tasks[0]).toEqual({
        id: 'DEVK900001T',
        description: 'Task 1',
        owner: 'DEV1',
        status: 'D',
        objects: [],
      });
      expect(transports[0]?.tasks[1]).toEqual({
        id: 'DEVK900002T',
        description: 'Task 2',
        owner: 'DEV2',
        status: 'R',
        objects: [],
      });
    });

    it('parses attributes in different order', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:desc="Reversed order" tm:type="K" tm:status="D" tm:owner="DEVELOPER" tm:number="DEVK900099"/>
      </tm:root>`;
      const http = mockHttp(xml);
      const transports = await listTransports(http, enabledSafety);
      expect(transports).toHaveLength(1);
      expect(transports[0]?.id).toBe('DEVK900099');
      expect(transports[0]?.owner).toBe('DEVELOPER');
      expect(transports[0]?.description).toBe('Reversed order');
      expect(transports[0]?.status).toBe('D');
      expect(transports[0]?.type).toBe('K');
    });
  });

  // ─── getTransport ──────────────────────────────────────────────────

  describe('getTransport', () => {
    it('returns transport details', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="A4HK900100" tm:owner="DEVELOPER" tm:desc="My transport" tm:status="D" tm:type="K"/>
      </tm:root>`;
      const http = mockHttp(xml);
      const transport = await getTransport(http, enabledSafety, 'A4HK900100');
      expect(transport).not.toBeNull();
      expect(transport?.id).toBe('A4HK900100');
    });

    it('returns null when transport not found (Issue #26)', async () => {
      const http = mockHttp('<tm:root xmlns:tm="http://www.sap.com/cts/transports"/>');
      const transport = await getTransport(http, enabledSafety, 'NONEXISTENT');
      expect(transport).toBeNull();
    });

    it('parses an empty target as "Local Change Requests" (no transport route)', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="A4HK900100" tm:owner="DEVELOPER" tm:desc="My transport" tm:status="D" tm:type="K" tm:target="" tm:target_desc="Local Change Requests"/>
      </tm:root>`;
      const http = mockHttp(xml);
      const transport = await getTransport(http, enabledSafety, 'A4HK900100');
      expect(transport?.target).toBe('');
      expect(transport?.targetDesc).toBe('Local Change Requests');
    });

    it('parses a real transport target and description', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900200" tm:owner="DEVELOPER" tm:desc="Routed transport" tm:status="D" tm:type="K" tm:target="QAS" tm:target_desc="System QAS"/>
      </tm:root>`;
      const http = mockHttp(xml);
      const transport = await getTransport(http, enabledSafety, 'DEVK900200');
      expect(transport?.target).toBe('QAS');
      expect(transport?.targetDesc).toBe('System QAS');
    });
  });

  // ─── createTransport ───────────────────────────────────────────────

  describe('createTransport', () => {
    it('is blocked when transports not enabled', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowTransportWrites: false };
      await expect(createTransport(http, safety, 'Test')).rejects.toThrow(AdtSafetyError);
    });

    it('creates transport when fully enabled', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEVK900002');
      const id = await createTransport(http, enabledSafety, 'New transport');
      expect(id).toBe('DEVK900002');
    });

    it('sends correct CreateCorrectionRequest body with explicit package', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'My description', 'ZPACKAGE');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('xmlns:asx="http://www.sap.com/abapxml"');
      expect(body).toContain('<DEVCLASS>ZPACKAGE</DEVCLASS>');
      expect(body).toContain('<REQUEST_TEXT>My description</REQUEST_TEXT>');
      expect(body).toContain('<REF/>');
      expect(body).toContain('<OPERATION>I</OPERATION>');
    });

    it('defaults DEVCLASS to $TMP when targetPackage is undefined', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'desc');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('<DEVCLASS>$TMP</DEVCLASS>');
    });

    it('defaults DEVCLASS to $TMP when targetPackage is empty string', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'desc', '');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('<DEVCLASS>$TMP</DEVCLASS>');
    });

    it('explicit package overrides $TMP default', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'desc', 'ZTEST');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('<DEVCLASS>ZTEST</DEVCLASS>');
      expect(body).not.toContain('<DEVCLASS>$TMP</DEVCLASS>');
    });

    it('includes <REF> when objectUrl is provided', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'desc', 'ZPACKAGE', '/sap/bc/adt/oo/classes/zcl_foo');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('<REF>/sap/bc/adt/oo/classes/zcl_foo</REF>');
      expect(body).not.toContain('<REF/>');
    });

    it('escapes special characters in description and package', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'Test with "quotes" & <brackets>', 'Z&PKG');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('&amp;');
      expect(body).toContain('&lt;');
      expect(body).toContain('&quot;');
    });

    it('extracts transport ID as the last path segment of the response', async () => {
      const http = mockHttp('/com.sap.cts/object_record/A4HK900100');
      const id = await createTransport(http, enabledSafety, 'Test');
      expect(id).toBe('A4HK900100');
    });

    it('returns empty string when response body is empty', async () => {
      const http = mockHttp('');
      const id = await createTransport(http, enabledSafety, 'Test');
      expect(id).toBe('');
    });

    it('posts to bare /cts/transports URL when no transportLayer given', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'desc', 'ZPACKAGE');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toBe('/sap/bc/adt/cts/transports');
    });

    it('appends ?transportLayer= query param when transportLayer is provided', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'desc', 'ZPACKAGE', undefined, 'ZDEV');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toBe('/sap/bc/adt/cts/transports?transportLayer=ZDEV');
    });

    it('URL-encodes the transportLayer value', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'desc', 'ZPACKAGE', undefined, '/ABC/ DEV');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toBe('/sap/bc/adt/cts/transports?transportLayer=%2FABC%2F%20DEV');
    });

    it('ignores a whitespace-only transportLayer (no query param)', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'desc', 'ZPACKAGE', undefined, '   ');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toBe('/sap/bc/adt/cts/transports');
    });
  });

  // ─── createTransportWithTarget ─────────────────────────────────────

  describe('createTransportWithTarget', () => {
    // Verbatim response shape captured live from a4h (S/4HANA 2023).
    const okXml = `<?xml version="1.0" encoding="utf-8"?><tm:root tm:useraction="newrequest" xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK905900" tm:desc="d" tm:type="K" tm:target="/TRG/" tm:target_desc="Group TRG"><tm:task/></tm:request></tm:root>`;

    it('is blocked when transports not enabled', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowTransportWrites: false };
      await expect(createTransportWithTarget(http, safety, 'Test', '/TRG/')).rejects.toThrow(AdtSafetyError);
    });

    it('POSTs the tm:root/newrequest body with tm:target to /cts/transportrequests', async () => {
      const http = mockHttp(okXml);
      await createTransportWithTarget(http, enabledSafety, 'My req', '/TRG/', 'MARIAN');
      const [url, body, contentType] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
      expect(url).toBe('/sap/bc/adt/cts/transportrequests');
      expect(contentType).toBe('text/plain');
      expect(body).toContain('tm:useraction="newrequest"');
      expect(body).toContain('tm:target="/TRG/"');
      expect(body).toContain('tm:type="K"');
      expect(body).toContain('tm:desc="My req"');
      expect(body).toContain('tm:owner="MARIAN"');
    });

    it('omits tm:owner when no owner is given', async () => {
      const http = mockHttp(okXml);
      await createTransportWithTarget(http, enabledSafety, 'd', 'C11');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('<tm:task/>');
      expect(body).not.toContain('tm:owner');
    });

    it('escapes special characters in description and target', async () => {
      const http = mockHttp(okXml);
      await createTransportWithTarget(http, enabledSafety, 'A "B" & <C>', '/A&B/');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('&quot;');
      expect(body).toContain('&amp;');
      expect(body).toContain('&lt;');
    });

    it('extracts the new request number from the tm:root response', async () => {
      const http = mockHttp(okXml);
      const id = await createTransportWithTarget(http, enabledSafety, 'd', '/TRG/');
      expect(id).toBe('A4HK905900');
    });
  });

  // ─── listTransportLayers ───────────────────────────────────────────

  describe('listTransportLayers', () => {
    // Verbatim shape captured live from a4h (S/4HANA 2023).
    const layersXml = `<?xml version="1.0" encoding="utf-8"?><nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"><nameditem:totalItemCount>3</nameditem:totalItemCount><nameditem:namedItem><nameditem:name/><nameditem:description>Transport Layer for Local Developments (No Transport)</nameditem:description><nameditem:data/></nameditem:namedItem><nameditem:namedItem><nameditem:name>SAP</nameditem:name><nameditem:description>Transport Layer for SAP Standard Objects</nameditem:description><nameditem:data/></nameditem:namedItem><nameditem:namedItem><nameditem:name>ZDEV</nameditem:name><nameditem:description>gCTS generated&lt;p&gt;Target: &lt;b&gt;DEV&lt;/b&gt;&lt;/p&gt;</nameditem:description><nameditem:data>DEV</nameditem:data></nameditem:namedItem></nameditem:namedItemList>`;

    it('GETs the transportlayers value-help endpoint', async () => {
      const http = mockHttp(layersXml);
      await listTransportLayers(http, enabledSafety);
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toBe('/sap/bc/adt/packages/valuehelps/transportlayers');
    });

    it('parses name, description and resolved target', async () => {
      const http = mockHttp(layersXml);
      const layers = await listTransportLayers(http, enabledSafety);
      expect(layers).toHaveLength(3);
      // Empty-name entry = the local/no-transport layer; no target key.
      expect(layers[0]).toEqual({ name: '', description: 'Transport Layer for Local Developments (No Transport)' });
      expect(layers[1]).toEqual({ name: 'SAP', description: 'Transport Layer for SAP Standard Objects' });
      expect(layers[2].name).toBe('ZDEV');
      expect(layers[2].target).toBe('DEV');
      // Embedded HTML in the description is stripped.
      expect(layers[2].description).toBe('gCTS generated Target: DEV');
    });

    it('returns an empty array when no layers are defined', async () => {
      const http = mockHttp(
        '<?xml version="1.0"?><nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"><nameditem:totalItemCount>0</nameditem:totalItemCount></nameditem:namedItemList>',
      );
      const layers = await listTransportLayers(http, enabledSafety);
      expect(layers).toEqual([]);
    });

    it('decodes standard XML entities (&apos; / &amp;) in description and target', async () => {
      // name is an identifier passed back verbatim; description/data go through clean().
      const xml = `<?xml version="1.0" encoding="utf-8"?><nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"><nameditem:totalItemCount>1</nameditem:totalItemCount><nameditem:namedItem><nameditem:name>ZDEV</nameditem:name><nameditem:description>Smith &amp; O&apos;Hara&apos;s layer</nameditem:description><nameditem:data>O&apos;HARA</nameditem:data></nameditem:namedItem></nameditem:namedItemList>`;
      const http = mockHttp(xml);
      const layers = await listTransportLayers(http, enabledSafety);
      expect(layers[0].name).toBe('ZDEV');
      expect(layers[0].description).toBe("Smith & O'Hara's layer");
      expect(layers[0].target).toBe("O'HARA");
    });

    it('is allowed read-only (does not require allowTransportWrites)', async () => {
      const http = mockHttp(layersXml);
      const readOnly = { ...unrestrictedSafetyConfig(), allowTransportWrites: false };
      await expect(listTransportLayers(http, readOnly)).resolves.toHaveLength(3);
    });
  });

  // ─── listTransportTargets ──────────────────────────────────────────

  describe('listTransportTargets', () => {
    // Verbatim shape captured live from a4h's official target value help.
    const targetsXml = `<?xml version="1.0" encoding="utf-8"?><nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"><nameditem:totalItemCount>2</nameditem:totalItemCount><nameditem:namedItem><nameditem:name>DEV</nameditem:name><nameditem:description>gCTS generated</nameditem:description><nameditem:data/></nameditem:namedItem><nameditem:namedItem><nameditem:name/><nameditem:description>blank ignored</nameditem:description><nameditem:data/></nameditem:namedItem></nameditem:namedItemList>`;

    it('GETs the official target value-help endpoint', async () => {
      const http = mockHttp(targetsXml);
      await listTransportTargets(http, enabledSafety);
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toBe('/sap/bc/adt/cts/transportrequests/valuehelp/target?maxItemCount=200');
    });

    it('parses target name + description and drops blank-name entries', async () => {
      const http = mockHttp(targetsXml);
      const targets = await listTransportTargets(http, enabledSafety);
      expect(targets).toEqual([{ name: 'DEV', description: 'gCTS generated' }]);
    });
  });

  // ─── supportsExplicitTransportTarget (discovery gate) ──────────────

  describe('supportsExplicitTransportTarget', () => {
    const fakeHttp = (hasData: boolean, accept?: string) =>
      ({ hasDiscoveryData: () => hasData, discoveryAcceptFor: () => accept }) as unknown as AdtHttpClient;

    it('returns undefined when discovery has not been loaded', () => {
      expect(supportsExplicitTransportTarget(fakeHttp(false))).toBeUndefined();
    });

    it('returns true when cts/transportrequests advertises the transportorganizer accept type', () => {
      expect(supportsExplicitTransportTarget(fakeHttp(true, 'application/vnd.sap.adt.transportorganizer.v1+xml'))).toBe(
        true,
      );
    });

    it('returns false when discovery is loaded but the capability is absent (NW 7.50)', () => {
      expect(supportsExplicitTransportTarget(fakeHttp(true, undefined))).toBe(false);
      expect(supportsExplicitTransportTarget(fakeHttp(true, 'application/vnd.sap.as+xml'))).toBe(false);
    });
  });

  // ─── releaseTransport ──────────────────────────────────────────────

  describe('releaseTransport', () => {
    it('is blocked when transports not enabled', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowTransportWrites: false };
      await expect(releaseTransport(http, safety, 'DEVK900001')).rejects.toThrow(AdtSafetyError);
    });

    it('posts to newreleasejobs endpoint', async () => {
      const http = mockHttp();
      await releaseTransport(http, enabledSafety, 'DEVK900001');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('/sap/bc/adt/cts/transportrequests/DEVK900001/newreleasejobs');
    });

    it('encodes transport ID in URL', async () => {
      const http = mockHttp();
      await releaseTransport(http, enabledSafety, 'A4HK900100');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('A4HK900100');
    });
  });

  // ─── deleteTransport ───────────────────────────────────────────────

  describe('deleteTransport', () => {
    it('is blocked when transports not enabled', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowTransportWrites: false };
      await expect(deleteTransport(http, safety, 'DEVK900001')).rejects.toThrow(AdtSafetyError);
    });

    it('sends DELETE to correct URL', async () => {
      const http = mockHttp();
      await deleteTransport(http, enabledSafety, 'DEVK900001');
      const url = (http.delete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toBe('/sap/bc/adt/cts/transportrequests/DEVK900001');
    });

    it('encodes transport ID in URL', async () => {
      const http = mockHttp();
      await deleteTransport(http, enabledSafety, 'A4HK900100');
      const url = (http.delete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('A4HK900100');
    });

    it('recursive checks allowedTransports per child task', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900099" tm:owner="DEV1" tm:desc="Task 1" tm:status="D"/>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      // Only parent ID is allowed, child is not
      const safety = { ...enabledSafety, allowedTransports: ['DEVK900001'] };
      await expect(deleteTransport(http, safety, 'DEVK900001', true)).rejects.toThrow(AdtSafetyError);
    });

    it('recursive deletes unreleased tasks before parent', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="D"/>
          <tm:task tm:number="DEVK900001T2" tm:owner="DEV2" tm:desc="Task 2" tm:status="D"/>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      await deleteTransport(http, enabledSafety, 'DEVK900001', true);
      const deleteCalls = (http.delete as ReturnType<typeof vi.fn>).mock.calls;
      expect(deleteCalls).toHaveLength(3);
      expect(deleteCalls[0]?.[0]).toContain('DEVK900001T1');
      expect(deleteCalls[1]?.[0]).toContain('DEVK900001T2');
      expect(deleteCalls[2]?.[0]).toContain('DEVK900001');
    });

    it('recursive skips already-released tasks', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="R"/>
          <tm:task tm:number="DEVK900001T2" tm:owner="DEV2" tm:desc="Task 2" tm:status="D"/>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      await deleteTransport(http, enabledSafety, 'DEVK900001', true);
      const deleteCalls = (http.delete as ReturnType<typeof vi.fn>).mock.calls;
      expect(deleteCalls).toHaveLength(2); // Only T2 + parent
      expect(deleteCalls[0]?.[0]).toContain('DEVK900001T2');
      expect(deleteCalls[1]?.[0]).toContain('DEVK900001');
    });

    it('does not fetch or PUT when removeLockedObjects is false (backward compatible)', async () => {
      const http = mockHttp();
      await deleteTransport(http, enabledSafety, 'DEVK900001');
      expect((http.get as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
      expect((http.put as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('removeLockedObjects strips locked objects via a removeobject PUT, then deletes the request', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="D">
            <tm:abap_object tm:pgmid="R3TR" tm:type="DEVC" tm:name="ZGHOST" tm:wbtype="DEVC/K" tm:obj_desc="Package" tm:lock_status="X" tm:position="000001"/>
          </tm:task>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      await deleteTransport(http, enabledSafety, 'DEVK900001', false, true);

      const putCalls = (http.put as ReturnType<typeof vi.fn>).mock.calls;
      expect(putCalls).toHaveLength(1);
      // PUT (not POST) to the TASK URI — POST silently no-ops on the SAP side.
      expect(putCalls[0]?.[0]).toBe('/sap/bc/adt/cts/transportrequests/DEVK900001T1');
      const body = putCalls[0]?.[1] as string;
      expect(body).toContain('tm:useraction="removeobject"');
      expect(body).toContain('tm:number="DEVK900001T1"');
      expect(body).toContain('tm:pgmid="R3TR"');
      expect(body).toContain('tm:type="DEVC"');
      expect(body).toContain('tm:name="ZGHOST"');
      expect(body).toContain('tm:position="000001"');
      expect(putCalls[0]?.[2]).toBe(CTS_CONTENT_TYPE_ORGANIZER);

      const deleteCalls = (http.delete as ReturnType<typeof vi.fn>).mock.calls;
      // recursive=false → only the request itself is deleted, after the lock is cleared.
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0]?.[0]).toBe('/sap/bc/adt/cts/transportrequests/DEVK900001');
    });

    it('removeLockedObjects only touches locked objects, not unlocked ones', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="D">
            <tm:abap_object tm:pgmid="R3TR" tm:type="DEVC" tm:name="ZGHOST" tm:lock_status="X" tm:position="000001"/>
            <tm:abap_object tm:pgmid="R3TR" tm:type="CLAS" tm:name="ZCL_OK" tm:lock_status="" tm:position="000002"/>
          </tm:task>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      await deleteTransport(http, enabledSafety, 'DEVK900001', false, true);

      const putCalls = (http.put as ReturnType<typeof vi.fn>).mock.calls;
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.[1]).toContain('tm:name="ZGHOST"');
      expect(putCalls[0]?.[1]).not.toContain('ZCL_OK');
    });

    it('removeLockedObjects + recursive strips the lock, then deletes the task, then the request', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="D">
            <tm:abap_object tm:pgmid="R3TR" tm:type="DEVC" tm:name="ZGHOST" tm:lock_status="X" tm:position="000001"/>
          </tm:task>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      await deleteTransport(http, enabledSafety, 'DEVK900001', true, true);

      // The locked object must be stripped (PUT removeobject) BEFORE the task is deleted,
      // otherwise ADT refuses to delete the task ("...contains locked objects").
      const putCalls = (http.put as ReturnType<typeof vi.fn>).mock.calls;
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.[0]).toBe('/sap/bc/adt/cts/transportrequests/DEVK900001T1');
      expect(putCalls[0]?.[1]).toContain('tm:useraction="removeobject"');

      const deleteCalls = (http.delete as ReturnType<typeof vi.fn>).mock.calls;
      expect(deleteCalls).toHaveLength(2);
      expect(deleteCalls[0]?.[0]).toBe('/sap/bc/adt/cts/transportrequests/DEVK900001T1');
      expect(deleteCalls[1]?.[0]).toBe('/sap/bc/adt/cts/transportrequests/DEVK900001');
    });
  });

  // ─── reassignTransport ────────────────────────────────────────────

  describe('reassignTransport', () => {
    it('is blocked when transports not enabled', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowTransportWrites: false };
      await expect(reassignTransport(http, safety, 'DEVK900001', 'NEWUSER')).rejects.toThrow(AdtSafetyError);
    });

    it('sends PUT with correct XML body', async () => {
      const http = mockHttp();
      await reassignTransport(http, enabledSafety, 'DEVK900001', 'NEWUSER');
      const body = (http.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('tm:useraction="changeowner"');
      expect(body).toContain('tm:targetuser="NEWUSER"');
      expect(body).toContain('tm:number="DEVK900001"');
    });

    it('escapes special characters in owner name', async () => {
      const http = mockHttp();
      await reassignTransport(http, enabledSafety, 'DEVK900001', 'USER<&>');
      const body = (http.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('&lt;');
      expect(body).toContain('&amp;');
    });

    it('uses correct CTS_CONTENT_TYPE_ORGANIZER media type', async () => {
      const http = mockHttp();
      await reassignTransport(http, enabledSafety, 'DEVK900001', 'NEWUSER');
      const calls = (http.put as ReturnType<typeof vi.fn>).mock.calls[0];
      const contentType = calls?.[2] as string;
      const headers = calls?.[3] as Record<string, string>;
      expect(contentType).toBe(CTS_CONTENT_TYPE_ORGANIZER);
      expect(headers.Accept).toBe(CTS_CONTENT_TYPE_ORGANIZER);
    });

    it('recursive reassigns unreleased tasks before parent', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="D"/>
          <tm:task tm:number="DEVK900001T2" tm:owner="DEV2" tm:desc="Task 2" tm:status="D"/>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      await reassignTransport(http, enabledSafety, 'DEVK900001', 'NEWUSER', true);
      const putCalls = (http.put as ReturnType<typeof vi.fn>).mock.calls;
      // get call uses http.get, put calls are: task1, task2, parent
      expect(putCalls).toHaveLength(3);
      expect(putCalls[0]?.[0] as string).toContain('DEVK900001T1');
      expect(putCalls[1]?.[0] as string).toContain('DEVK900001T2');
      expect(putCalls[2]?.[0] as string).toContain('DEVK900001');
    });

    it('recursive skips already-released tasks', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="R"/>
          <tm:task tm:number="DEVK900001T2" tm:owner="DEV2" tm:desc="Task 2" tm:status="D"/>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      await reassignTransport(http, enabledSafety, 'DEVK900001', 'NEWUSER', true);
      const putCalls = (http.put as ReturnType<typeof vi.fn>).mock.calls;
      expect(putCalls).toHaveLength(2); // Only T2 + parent
      expect(putCalls[0]?.[0] as string).toContain('DEVK900001T2');
      expect(putCalls[1]?.[0] as string).toContain('DEVK900001');
    });
  });

  // ─── createTransport with type ────────────────────────────────────

  // K/W/T transport type is no longer driven by the request body — the
  // CreateCorrectionRequest endpoint infers the type from the target
  // package's transport route in TADIR. The legacy `transportType`
  // parameter has been removed from createTransport's signature, so per-type
  // body assertions no longer reflect reality.

  // ─── releaseTransportRecursive ────────────────────────────────────

  describe('releaseTransportRecursive', () => {
    it('is blocked when transports not enabled', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowTransportWrites: false };
      await expect(releaseTransportRecursive(http, safety, 'DEVK900001')).rejects.toThrow(AdtSafetyError);
    });

    it('releases unreleased tasks before parent', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="D"/>
          <tm:task tm:number="DEVK900001T2" tm:owner="DEV2" tm:desc="Task 2" tm:status="D"/>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      const result = await releaseTransportRecursive(http, enabledSafety, 'DEVK900001');
      const postCalls = (http.post as ReturnType<typeof vi.fn>).mock.calls;
      // Posts: task1 release, task2 release, parent release
      expect(postCalls).toHaveLength(3);
      expect(postCalls[0]?.[0] as string).toContain('DEVK900001T1');
      expect(postCalls[1]?.[0] as string).toContain('DEVK900001T2');
      expect(postCalls[2]?.[0] as string).toContain('DEVK900001');
      expect(result.released).toEqual(['DEVK900001T1', 'DEVK900001T2', 'DEVK900001']);
    });

    it('skips already-released tasks', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="R"/>
          <tm:task tm:number="DEVK900001T2" tm:owner="DEV2" tm:desc="Task 2" tm:status="D"/>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      const result = await releaseTransportRecursive(http, enabledSafety, 'DEVK900001');
      expect(result.released).toEqual(['DEVK900001T2', 'DEVK900001']);
    });

    it('returns list of all released IDs in order', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K"/>
      </tm:root>`;
      const http = mockHttp(xml);
      const result = await releaseTransportRecursive(http, enabledSafety, 'DEVK900001');
      expect(result.released).toEqual(['DEVK900001']);
    });

    it('skips already-released parent (retry-safe)', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="R" tm:type="K"/>
      </tm:root>`;
      const http = mockHttp(xml);
      const result = await releaseTransportRecursive(http, enabledSafety, 'DEVK900001');
      // Parent already released — no release calls, empty result
      expect(result.released).toEqual([]);
      expect((http.post as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });
  });

  // ─── Transport object parsing ─────────────────────────────────────

  describe('transport object parsing', () => {
    it('parses tm:abap_object elements from tasks', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="D">
            <tm:abap_object tm:pgmid="R3TR" tm:type="PROG" tm:name="ZTEST_PROGRAM" tm:wbtype="PR" tm:obj_desc="Test program" tm:lock_status="X" tm:position="000001"/>
          </tm:task>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      const transports = await listTransports(http, enabledSafety);
      const objects = transports[0]?.tasks[0]?.objects;
      expect(objects).toHaveLength(1);
      expect(objects?.[0]).toEqual({
        pgmid: 'R3TR',
        type: 'PROG',
        name: 'ZTEST_PROGRAM',
        wbtype: 'PR',
        description: 'Test program',
        locked: true,
        position: '000001',
      });
    });

    it('tasks without objects return empty array', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="D"/>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      const transports = await listTransports(http, enabledSafety);
      expect(transports[0]?.tasks[0]?.objects).toEqual([]);
    });

    it('lock_status X parses as locked true, missing as false', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900001T1" tm:owner="DEV1" tm:desc="Task 1" tm:status="D">
            <tm:abap_object tm:pgmid="R3TR" tm:type="PROG" tm:name="ZLOCKED" tm:lock_status="X" tm:position="000001"/>
            <tm:abap_object tm:pgmid="R3TR" tm:type="PROG" tm:name="ZUNLOCKED" tm:position="000002"/>
          </tm:task>
        </tm:request>
      </tm:root>`;
      const http = mockHttp(xml);
      const transports = await listTransports(http, enabledSafety);
      const objects = transports[0]?.tasks[0]?.objects;
      expect(objects?.[0]?.locked).toBe(true);
      expect(objects?.[1]?.locked).toBe(false);
    });
  });

  // ─── Media Type & Namespace Assertions ─────────────────────────────

  describe('CTS media types and namespaces', () => {
    it('listTransports sends tree Accept header', async () => {
      const http = mockHttp('<tm:root xmlns:tm="http://www.sap.com/cts/transports"/>');
      await listTransports(http, enabledSafety);
      const headers = (http.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<string, string>;
      expect(headers.Accept).toBe(CTS_ACCEPT_TREE);
    });

    it('getTransport sends organizer Accept header', async () => {
      const http = mockHttp('<tm:root xmlns:tm="http://www.sap.com/cts/transports"/>');
      await getTransport(http, enabledSafety, 'DEVK900001');
      const headers = (http.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<string, string>;
      expect(headers.Accept).toBe(CTS_CONTENT_TYPE_ORGANIZER);
    });

    it('createTransport sends CreateCorrectionRequest Content-Type and text/plain Accept', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'Test');
      const calls = (http.post as ReturnType<typeof vi.fn>).mock.calls[0];
      const contentType = calls?.[2] as string;
      const headers = calls?.[3] as Record<string, string>;
      expect(contentType).toContain('application/vnd.sap.as+xml');
      expect(contentType).toContain('dataname=com.sap.adt.CreateCorrectionRequest');
      expect(headers.Accept).toBe('text/plain');
    });

    it('createTransport uses asx:abap envelope in payload', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'Test');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('xmlns:asx="http://www.sap.com/abapxml"');
      expect(body).not.toContain(CTS_NAMESPACE_TM);
    });

    it('releaseTransport sends organizer Accept header', async () => {
      const http = mockHttp();
      await releaseTransport(http, enabledSafety, 'DEVK900001');
      const headers = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[3] as Record<string, string>;
      expect(headers.Accept).toBe(CTS_CONTENT_TYPE_ORGANIZER);
    });

    it('createTransport endpoint is /sap/bc/adt/cts/transports (CreateCorrectionRequest)', async () => {
      const http = mockHttp('/com.sap.cts/object_record/DEV123');
      await createTransport(http, enabledSafety, 'Test');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toBe('/sap/bc/adt/cts/transports');
    });

    it('response parsing handles both old and new namespace attributes', async () => {
      // Responses may use either namespace — parser should handle both
      const xmlOldNs = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Old ns" tm:status="D" tm:type="K"/>
      </tm:root>`;
      const http = mockHttp(xmlOldNs);
      const transports = await listTransports(http, enabledSafety);
      expect(transports).toHaveLength(1);
      expect(transports[0]?.id).toBe('DEVK900001');

      // New namespace
      const xmlNewNs = `<tm:root xmlns:tm="${CTS_NAMESPACE_TM}">
        <tm:request tm:number="DEVK900002" tm:owner="DEV" tm:desc="New ns" tm:status="D" tm:type="K"/>
      </tm:root>`;
      const http2 = mockHttp(xmlNewNs);
      const transports2 = await listTransports(http2, enabledSafety);
      expect(transports2).toHaveLength(1);
      expect(transports2[0]?.id).toBe('DEVK900002');
    });

    it('exported constants have correct values', () => {
      expect(CTS_ACCEPT_TREE).toBe('application/vnd.sap.adt.transportorganizertree.v1+xml');
      expect(CTS_CONTENT_TYPE_ORGANIZER).toBe('application/vnd.sap.adt.transportorganizer.v1+xml');
      expect(CTS_NAMESPACE_TM).toBe('http://www.sap.com/cts/adt/tm');
    });
  });

  // ─── getTransportInfo ─────────────────────────────────────────────

  describe('getTransportInfo', () => {
    it('posts to /sap/bc/adt/cts/transportchecks endpoint', async () => {
      const xml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
        <asx:values><DATA>
          <RECORDING/>
          <DLVUNIT>LOCAL</DLVUNIT>
          <DEVCLASS>$TMP</DEVCLASS>
        </DATA></asx:values>
      </asx:abap>`;
      const http = mockHttp(xml);
      await getTransportInfo(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_test', '$TMP');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toBe('/sap/bc/adt/cts/transportchecks');
    });

    it('sends correct content type and accept headers', async () => {
      const xml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING/>
        <DLVUNIT>LOCAL</DLVUNIT>
        <DEVCLASS>$TMP</DEVCLASS>
      </DATA></asx:values></asx:abap>`;
      const http = mockHttp(xml);
      await getTransportInfo(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_test', '$TMP');
      const calls = (http.post as ReturnType<typeof vi.fn>).mock.calls[0];
      const contentType = calls?.[2] as string;
      expect(contentType).toContain('application/vnd.sap.as+xml');
      expect(contentType).toContain('dataname=com.sap.adt.transport.service.checkData');
    });

    it('includes object URI and devclass in request body', async () => {
      const xml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING/>
        <DLVUNIT>LOCAL</DLVUNIT>
        <DEVCLASS>$TMP</DEVCLASS>
      </DATA></asx:values></asx:abap>`;
      const http = mockHttp(xml);
      await getTransportInfo(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_test', 'Z_MY_PKG');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('<URI>/sap/bc/adt/oo/classes/zcl_test</URI>');
      expect(body).toContain('<DEVCLASS>Z_MY_PKG</DEVCLASS>');
      expect(body).toContain('<OPERATION>I</OPERATION>');
    });

    it('parses local package response (no transport needed)', async () => {
      const xml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
        <asx:values><DATA>
          <PGMID>R3TR</PGMID>
          <OBJECT>CLAS</OBJECT>
          <OBJECTNAME>ZCL_TEST</OBJECTNAME>
          <DEVCLASS>$TMP</DEVCLASS>
          <DLVUNIT>LOCAL</DLVUNIT>
          <RECORDING/>
          <KORRFLAG/>
        </DATA></asx:values>
      </asx:abap>`;
      const http = mockHttp(xml);
      const info = await getTransportInfo(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_test', '$TMP');
      expect(info.isLocal).toBe(true);
      expect(info.recording).toBe(false);
      expect(info.deliveryUnit).toBe('LOCAL');
      expect(info.devclass).toBe('$TMP');
      expect(info.existingTransports).toEqual([]);
      expect(info.lockedTransport).toBeUndefined();
    });

    it('parses transportable package response (transport required)', async () => {
      const xml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
        <asx:values><DATA>
          <PGMID>R3TR</PGMID>
          <OBJECT>DDLS</OBJECT>
          <OBJECTNAME>ZI_TRAVEL</OBJECTNAME>
          <DEVCLASS>Z_RAP_VB_1</DEVCLASS>
          <DLVUNIT>SAP</DLVUNIT>
          <RECORDING>X</RECORDING>
          <KORRFLAG>X</KORRFLAG>
          <TRANSPORTS>
            <headers>
              <TRKORR>A4HK900502</TRKORR>
              <AS4TEXT>RAP development</AS4TEXT>
              <AS4USER>DEVELOPER</AS4USER>
            </headers>
            <headers>
              <TRKORR>A4HK900503</TRKORR>
              <AS4TEXT>CDS views</AS4TEXT>
              <AS4USER>DEVELOPER</AS4USER>
            </headers>
          </TRANSPORTS>
        </DATA></asx:values>
      </asx:abap>`;
      const http = mockHttp(xml);
      const info = await getTransportInfo(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/ddic/ddl/sources/zi_travel',
        'Z_RAP_VB_1',
      );
      expect(info.isLocal).toBe(false);
      expect(info.recording).toBe(true);
      expect(info.deliveryUnit).toBe('SAP');
      expect(info.devclass).toBe('Z_RAP_VB_1');
      expect(info.existingTransports).toHaveLength(2);
      expect(info.existingTransports[0]).toEqual({
        id: 'A4HK900502',
        description: 'RAP development',
        owner: 'DEVELOPER',
      });
    });

    it('parses locked transport from response', async () => {
      const xml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
        <asx:values><DATA>
          <DEVCLASS>Z_MY_PKG</DEVCLASS>
          <DLVUNIT>SAP</DLVUNIT>
          <RECORDING>X</RECORDING>
          <LOCKS>
            <HEADER>
              <TRKORR>A4HK900999</TRKORR>
              <AS4TEXT>Locked transport</AS4TEXT>
            </HEADER>
          </LOCKS>
        </DATA></asx:values>
      </asx:abap>`;
      const http = mockHttp(xml);
      const info = await getTransportInfo(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/zcl_test',
        'Z_MY_PKG',
      );
      expect(info.lockedTransport).toBe('A4HK900999');
    });

    it('does not require allowTransportWrites for read-only transport info', async () => {
      const xml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING/>
        <DLVUNIT>LOCAL</DLVUNIT>
        <DEVCLASS>$TMP</DEVCLASS>
      </DATA></asx:values></asx:abap>`;
      const http = mockHttp(xml);
      const safety = { ...unrestrictedSafetyConfig(), allowTransportWrites: false };
      // Should NOT throw — transportInfo is a read operation
      const info = await getTransportInfo(http, safety, '/sap/bc/adt/oo/classes/zcl_test', '$TMP');
      expect(info.isLocal).toBe(true);
    });

    it('defaults operation to I (insert)', async () => {
      const xml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING/>
        <DLVUNIT>LOCAL</DLVUNIT>
        <DEVCLASS>$TMP</DEVCLASS>
      </DATA></asx:values></asx:abap>`;
      const http = mockHttp(xml);
      await getTransportInfo(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_test', '$TMP');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('<OPERATION>I</OPERATION>');
    });

    it('handles empty transport list', async () => {
      const xml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <DEVCLASS>Z_MY_PKG</DEVCLASS>
        <DLVUNIT>SAP</DLVUNIT>
        <RECORDING>X</RECORDING>
      </DATA></asx:values></asx:abap>`;
      const http = mockHttp(xml);
      const info = await getTransportInfo(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/zcl_test',
        'Z_MY_PKG',
      );
      expect(info.existingTransports).toEqual([]);
      expect(info.recording).toBe(true);
    });
  });

  // ─── getObjectTransports ──────────────────────────────────────────

  describe('getObjectTransports', () => {
    it('calls /transports endpoint with XML accept header', async () => {
      const http = mockHttp(loadFixture('object-transports-related.xml'));
      await getObjectTransports(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_test');

      const call = (http.get as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call?.[0]).toBe('/sap/bc/adt/oo/classes/zcl_test/transports');
      expect(call?.[1]).toEqual({ Accept: 'application/vnd.sap.as+xml' });
    });

    it('returns empty arrays for empty response body', async () => {
      const http = mockHttp(loadFixture('object-transports-empty.xml'));
      const result = await getObjectTransports(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_test');
      expect(result).toEqual({ relatedTransports: [], candidateTransports: [] });
      expect(result.lockedTransport).toBeUndefined();
    });

    it('extracts locked transport from lock.result2 payload', async () => {
      const http = mockHttp(loadFixture('object-transports-related.xml'));
      const result = await getObjectTransports(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_test');
      expect(result.lockedTransport).toBe('A4HK900123');
      // /transports only reports the current lock — candidate transports
      // come from the transportchecks fallback in the SAPTransport handler, not here.
      expect(result.candidateTransports).toEqual([]);
    });

    it('maps locked transport into relatedTransports with owner and description', async () => {
      const http = mockHttp(loadFixture('object-transports-related.xml'));
      const result = await getObjectTransports(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_test');
      expect(result.relatedTransports).toHaveLength(1);
      expect(result.relatedTransports[0]).toEqual({
        id: 'A4HK900123',
        description: 'Refactor ZCL_ORDER',
        owner: 'DEVELOPER',
        status: 'D',
      });
    });

    it('returns empty arrays when SAP returns 404 (object type lacks /transports subresource)', async () => {
      // Non-CLAS object types (TABL, DDLS, BDEF, PROG, INTF, FUGR) do not
      // expose /transports on NetWeaver. The 404 must be swallowed so the
      // caller can fall back to transportchecks instead of failing.
      const http = {
        get: vi
          .fn()
          .mockRejectedValue(new AdtApiError('not found', 404, '/sap/bc/adt/ddic/tables/zfb_club/transports')),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        fetchCsrfToken: vi.fn(),
        withStatefulSession: vi.fn(),
      } as unknown as AdtHttpClient;

      const result = await getObjectTransports(http, unrestrictedSafetyConfig(), '/sap/bc/adt/ddic/tables/zfb_club');
      expect(result).toEqual({ relatedTransports: [], candidateTransports: [] });
      expect(result.lockedTransport).toBeUndefined();
    });

    it('rethrows non-404 API errors', async () => {
      const http = {
        get: vi.fn().mockRejectedValue(new AdtApiError('forbidden', 403, '/sap/bc/adt/oo/classes/zcl_test/transports')),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        fetchCsrfToken: vi.fn(),
        withStatefulSession: vi.fn(),
      } as unknown as AdtHttpClient;

      await expect(
        getObjectTransports(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_test'),
      ).rejects.toThrow(AdtApiError);
    });

    it('is read-only safe — works even when allowWrites=false', async () => {
      const xml = loadFixture('object-transports-related.xml');
      const readOnlySafety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(
        getObjectTransports(mockHttp(xml), readOnlySafety, '/sap/bc/adt/oo/classes/zcl_test'),
      ).resolves.toBeDefined();
    });
  });
});

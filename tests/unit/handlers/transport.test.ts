/**
 * SAPTransport + SAPWrite transport-behavior unit tests — split from the former intent.test.ts monolith.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const loadFixture = (name: string) => readFileSync(join(import.meta.dirname, '../../fixtures/xml', name), 'utf-8');

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('SAPTransport + SAPWrite transport behavior', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

  describe('SAPTransport handler routing', () => {
    function createTransportClient(): InstanceType<typeof AdtClient> {
      return new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowTransportWrites: true },
      });
    }

    it('delete action calls deleteTransport with correct ID', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'delete',
        id: 'DEVK900001',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Deleted transport request: DEVK900001');
    });

    it('delete without ID returns error', async () => {
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'delete',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Transport ID is required');
    });

    it('reassign action calls reassignTransport with ID and owner', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'reassign',
        id: 'DEVK900001',
        owner: 'NEWUSER',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Reassigned transport DEVK900001 to NEWUSER');
    });

    it('reassign without owner returns error', async () => {
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'reassign',
        id: 'DEVK900001',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Owner is required');
    });

    it('release_recursive action calls releaseTransportRecursive', async () => {
      const transportXml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K"/>
      </tm:root>`;
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' })) // CSRF
        .mockResolvedValueOnce(mockResponse(200, transportXml, {})) // getTransport
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' })) // CSRF
        .mockResolvedValue(mockResponse(200, '', {})); // release
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'release_recursive',
        id: 'DEVK900001',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('DEVK900001');
    });

    // ─── Pre-release inactive-objects check (FEAT-63) ─────────────────
    // Rich inactive-objects shape (live-verified on a4h 758): object on task DEVK900002, whose
    // parent request is DEVK900001 → releasing DEVK900001 must be blocked.
    const inactiveXmlMatching = `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactivectsobjects" xmlns:adtcore="http://www.sap.com/adt/core">
      <ioc:entry>
        <ioc:object ioc:user="DEV" ioc:deleted="false">
          <ioc:ref adtcore:uri="/sap/bc/adt/bo/behaviordefinitions/zc_test" adtcore:type="BDEF/BDO" adtcore:name="ZC_TEST"/>
        </ioc:object>
        <ioc:transport><ioc:ref adtcore:name="DEVK900002" adtcore:parentUri="/sap/bc/adt/cts/transportrequests/DEVK900001"/></ioc:transport>
      </ioc:entry>
    </ioc:inactiveObjects>`;
    const inactiveXmlOther = inactiveXmlMatching
      .replace(/DEVK900001/g, 'DEVK999999')
      .replace('DEVK900002', 'DEVK999998');

    it('release: blocks when the transport contains inactive objects (no release sent)', async () => {
      mockFetch.mockImplementation((url: unknown) =>
        Promise.resolve(
          String(url).includes('inactiveobjects')
            ? mockResponse(200, inactiveXmlMatching, {})
            : mockResponse(200, '', { 'x-csrf-token': 'T' }),
        ),
      );
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'release',
        id: 'DEVK900001',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('cannot be released');
      expect(result.content[0]?.text).toContain('ZC_TEST');
      // The release pipeline must never be invoked when blocked.
      const calledRelease = mockFetch.mock.calls.some((c: unknown[]) => String(c[0]).includes('newreleasejobs'));
      expect(calledRelease).toBe(false);
    });

    it('release: proceeds when the inactive-objects probe fails (graceful degradation)', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      mockFetch.mockImplementation((url: unknown) =>
        Promise.resolve(
          String(url).includes('inactiveobjects')
            ? mockResponse(500, 'boom', {})
            : mockResponse(200, '', { 'x-csrf-token': 'T' }),
        ),
      );
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'release',
        id: 'DEVK900001',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Released transport request: DEVK900001');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('release: proceeds when inactive objects belong to a different transport', async () => {
      mockFetch.mockImplementation((url: unknown) =>
        Promise.resolve(
          String(url).includes('inactiveobjects')
            ? mockResponse(200, inactiveXmlOther, {})
            : mockResponse(200, '', { 'x-csrf-token': 'T' }),
        ),
      );
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'release',
        id: 'DEVK900001',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Released transport request: DEVK900001');
    });

    // P2 (Codex review): the transport-write safety ceiling must be enforced BEFORE the diagnostic
    // inactive-objects read. Otherwise an unauthorized caller whose transport happens to contain
    // inactive objects gets a misleading "activate them first" instead of the real "writes blocked",
    // and we waste an ADT round-trip on a release we will refuse.
    it('release: enforces allowTransportWrites BEFORE the inactive-objects probe', async () => {
      mockFetch.mockImplementation((url: unknown) =>
        Promise.resolve(
          String(url).includes('inactiveobjects')
            ? mockResponse(200, inactiveXmlMatching, {}) // transport DOES contain inactive objects
            : mockResponse(200, '', { 'x-csrf-token': 'T' }),
        ),
      );
      const noWriteClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowTransportWrites: false },
      });
      const result = await handleToolCall(noWriteClient, DEFAULT_CONFIG, 'SAPTransport', {
        action: 'release',
        id: 'DEVK900001',
      });
      expect(result.isError).toBe(true);
      // The real reason — not the misleading inactive-objects remediation.
      expect(result.content[0]?.text).toContain('allowTransportWrites=false');
      expect(result.content[0]?.text).not.toContain('cannot be released');
      // The diagnostic read must NOT run for a release refused on safety grounds.
      const probedInactive = mockFetch.mock.calls.some((c: unknown[]) => String(c[0]).includes('inactiveobjects'));
      expect(probedInactive).toBe(false);
    });

    // ─── Release check report (issue #433 item 1) ─────────────────────
    // inactiveXmlOther belongs to DEVK999999, so it never blocks the A4HK90630x releases below.
    const releaseMock = (reportBody: string) => (url: unknown) =>
      Promise.resolve(
        String(url).includes('newreleasejobs')
          ? mockResponse(200, reportBody, {})
          : String(url).includes('inactiveobjects')
            ? mockResponse(200, inactiveXmlOther, {})
            : mockResponse(200, '', { 'x-csrf-token': 'T' }),
      );

    it('release: confirms success when the check report says released', async () => {
      mockFetch.mockImplementation(releaseMock(loadFixture('transport-release-report-success.xml')));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'release',
        id: 'A4HK906303',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Released transport request: A4HK906303');
    });

    it('release: reports a BLOCKED release even though SAP returned HTTP 200', async () => {
      mockFetch.mockImplementation(releaseMock(loadFixture('transport-release-report-blocked.xml')));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'release',
        id: 'A4HK906307',
      });
      // The core fix: a status≠released report surfaces as an error, not a false success.
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('was NOT released');
      expect(result.content[0]?.text).toContain('aborted'); // handler wording for the HTTP-200-but-failed case
      expect(result.content[0]?.text).toContain('unclassified'); // the real finding's shortText
    });

    it('create with package passes DEVCLASS through', async () => {
      // CreateCorrectionRequest endpoint returns a path like /com.sap.cts/object_record/<id>
      mockFetch.mockResolvedValue(mockResponse(200, '/com.sap.cts/object_record/DEVK900099', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Workbench transport',
        package: 'ZTEST',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('DEVK900099');
      // Verify the package was sent as DEVCLASS in the asx:abap body
      const fetchBody = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof (c[1] as { body?: string })?.body === 'string' && (c[1] as { body: string }).body.includes('DEVCLASS'),
      );
      expect(fetchBody?.[1]?.body).toContain('<DEVCLASS>ZTEST</DEVCLASS>');
      expect(fetchBody?.[1]?.body).toContain('<OPERATION>I</OPERATION>');
    });

    it('create without package defaults DEVCLASS to $TMP', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '/com.sap.cts/object_record/DEVK900099', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Default transport',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('DEVK900099');
      const fetchBody = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof (c[1] as { body?: string })?.body === 'string' && (c[1] as { body: string }).body.includes('DEVCLASS'),
      );
      expect(fetchBody?.[1]?.body).toContain('<DEVCLASS>$TMP</DEVCLASS>');
    });

    it('create with explicit target uses the tm:root/newrequest endpoint and reports the target', async () => {
      const tmRoot = `<?xml version="1.0" encoding="utf-8"?><tm:root tm:useraction="newrequest" xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900100" tm:owner="admin" tm:desc="d" tm:status="D" tm:type="K" tm:target="/TRG/" tm:target_desc="Group TRG"><tm:task/></tm:request></tm:root>`;
      mockFetch.mockResolvedValue(mockResponse(200, tmRoot, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Targeted transport',
        target: '/TRG/',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('A4HK900100');
      expect(result.content[0]?.text).toContain('/TRG/');
      // The request must go to /cts/transportrequests with a tm:target attribute.
      const call = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof (c[1] as { body?: string })?.body === 'string' &&
          (c[1] as { body: string }).body.includes('tm:useraction'),
      );
      expect(String(call?.[0])).toContain('/sap/bc/adt/cts/transportrequests');
      expect(call?.[1]?.body).toContain('tm:target="/TRG/"');
    });

    it('create with an unknown target (400) returns the friendly "does not exist" guidance', async () => {
      mockFetch.mockImplementation((_url: string, opts: { method?: string; body?: string } = {}) => {
        if (typeof opts.body === 'string' && opts.body.includes('tm:useraction')) {
          return Promise.resolve(
            mockResponse(400, "<msg>Target '/ZZNOPE/' does not exist</msg>", { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Bad target',
        target: '/ZZNOPE/',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('does not exist on this system');
      expect(result.content[0]?.text).toContain('extended transport control');
    });

    it('create with an unknown target (404) is also converted to the friendly guidance', async () => {
      mockFetch.mockImplementation((_url: string, opts: { method?: string; body?: string } = {}) => {
        if (typeof opts.body === 'string' && opts.body.includes('tm:useraction')) {
          return Promise.resolve(mockResponse(404, 'Target does not exist', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Bad target',
        target: 'NOPE',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('does not exist on this system');
    });

    it('create with target on NW 7.50/7.51 ("user action is not supported") gives release guidance', async () => {
      // NW 7.50–7.51 reject the tm:root/newrequest endpoint (CL_ADT_TM_RESOURCE ignores
      // tm:useraction). Verified live on npl 7.50 SP02 per src/adt/transport.ts. The raw
      // 400 must be converted to actionable release guidance, not surfaced cryptically.
      mockFetch.mockImplementation((_url: string, opts: { method?: string; body?: string } = {}) => {
        if (typeof opts.body === 'string' && opts.body.includes('tm:useraction')) {
          return Promise.resolve(mockResponse(400, 'user action  is not supported', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Targeted on old release',
        target: '/TRG/',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('does not support setting an explicit transport target');
      expect(result.content[0]?.text).toContain('7.50');
      expect(result.content[0]?.text).toContain('SE09/SE10');
      // It must NOT mislabel this as "target does not exist".
      expect(result.content[0]?.text).not.toContain('does not exist on this system');
    });

    it('create with an empty target is rejected as a caller mistake (no SAP call)', async () => {
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Blank target',
        target: '   ',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"target" was provided but is empty');
      // It must NOT fall through to creating a transport.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('discovery-gate: target create fails fast (no POST) when discovery lacks the TM capability (NW 7.50)', async () => {
      const client = createTransportClient();
      // Discovery loaded, but cts/transportrequests does NOT advertise the transportorganizer accept type.
      client.http.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/xml']]]));
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Targeted on unsupported release',
        target: '/TRG/',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('does not support setting an explicit transport target');
      expect(result.content[0]?.text).toContain('SE09/SE10');
      // Gated before any HTTP call.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('discovery-gate: target create proceeds when discovery advertises the TM capability', async () => {
      const client = createTransportClient();
      client.http.setDiscoveryMap(
        new Map([['/sap/bc/adt/cts/transportrequests', ['application/vnd.sap.adt.transportorganizer.v1+xml']]]),
      );
      const tmRoot = `<?xml version="1.0" encoding="utf-8"?><tm:root tm:useraction="newrequest" xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900200" tm:owner="admin" tm:desc="d" tm:status="D" tm:type="K" tm:target="DEV" tm:target_desc="gCTS"><tm:task/></tm:request></tm:root>`;
      mockFetch.mockResolvedValue(mockResponse(200, tmRoot, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Targeted on supported release',
        target: 'DEV',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('A4HK900200');
      expect(result.content[0]?.text).toContain('DEV');
    });

    it('targets action lists the system transport targets', async () => {
      const targetsXml = `<?xml version="1.0" encoding="utf-8"?><nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"><nameditem:totalItemCount>1</nameditem:totalItemCount><nameditem:namedItem><nameditem:name>DEV</nameditem:name><nameditem:description>gCTS generated</nameditem:description><nameditem:data/></nameditem:namedItem></nameditem:namedItemList>`;
      mockFetch.mockResolvedValue(mockResponse(200, targetsXml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'targets',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('transportTargets');
      expect(result.content[0]?.text).toContain('DEV');
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/cts/transportrequests/valuehelp/target');
    });

    it('targets action on NW 7.50/7.51 (value-help 404) reports discovery unavailable', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('/valuehelp/target')) {
          return Promise.resolve(mockResponse(404, 'No suitable resource found', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'targets',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on this SAP release');
    });

    it('targets action is discovery-gated (NW 7.50 returns HTTP 200 empty, not 404)', async () => {
      // Live on npl 7.50 the value help returns 200 with an empty list — so the gate, not the
      // HTTP status, must decide. Discovery loaded without the TM capability => unavailable.
      const client = createTransportClient();
      client.http.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/xml']]]));
      const emptyList = `<?xml version="1.0" encoding="utf-8"?><nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"><nameditem:totalItemCount>0</nameditem:totalItemCount></nameditem:namedItemList>`;
      mockFetch.mockResolvedValue(mockResponse(200, emptyList, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', { action: 'targets' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on this SAP release');
      // Gated before hitting the value help.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('create with transportLayer sends the ?transportLayer= query param', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '/com.sap.cts/object_record/DEVK900099', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Layer override',
        package: 'ZTEST',
        transportLayer: 'ZDEV',
      });
      expect(result.isError).toBeUndefined();
      const call = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('/cts/transports?'),
      );
      expect(String(call?.[0])).toContain('transportLayer=ZDEV');
    });

    it('layers action lists the system transport layers', async () => {
      const layersXml = `<?xml version="1.0" encoding="utf-8"?><nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"><nameditem:totalItemCount>2</nameditem:totalItemCount><nameditem:namedItem><nameditem:name>SAP</nameditem:name><nameditem:description>SAP layer</nameditem:description><nameditem:data/></nameditem:namedItem><nameditem:namedItem><nameditem:name>ZDEV</nameditem:name><nameditem:description>gCTS</nameditem:description><nameditem:data>DEV</nameditem:data></nameditem:namedItem></nameditem:namedItemList>`;
      mockFetch.mockResolvedValue(mockResponse(200, layersXml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'layers',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('transportLayers');
      expect(result.content[0]?.text).toContain('ZDEV');
      expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/packages/valuehelps/transportlayers');
    });

    it('layers action on NW 7.50/7.51 (value-help 404) reports discovery unavailable', async () => {
      // The transport-layer value help is 7.52+; NW 7.50 returns 404 "No suitable resource
      // found" (verified live on npl 7.50). Surface that, not a raw 404.
      mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('/packages/valuehelps/transportlayers')) {
          return Promise.resolve(mockResponse(404, 'No suitable resource found', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'layers',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on this SAP release');
    });

    it('list defaults to current SAP user and modifiable status', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="admin" tm:desc="Test" tm:status="D" tm:type="K"/>
      </tm:root>`;
      mockFetch.mockResolvedValue(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'list',
      });
      expect(result.isError).toBeUndefined();
      // Verify the URL includes user=admin (the client username) and requestType=KWT
      const fetchUrl = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('transportrequests'),
      );
      expect(fetchUrl?.[0]).toContain('user=admin');
      expect(fetchUrl?.[0]).toContain('requestType=KWT');
    });

    it('list with status=* returns all statuses', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="admin" tm:desc="Modifiable" tm:status="D" tm:type="K"/>
        <tm:request tm:number="DEVK900002" tm:owner="admin" tm:desc="Released" tm:status="R" tm:type="K"/>
      </tm:root>`;
      mockFetch.mockResolvedValue(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'list',
        status: '*',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.total).toBe(2);
      expect(parsed.transports).toHaveLength(2);
    });

    const LIST_WITH_OBJECTS_XML = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="admin" tm:desc="Feature X" tm:status="D" tm:type="K">
          <tm:task tm:number="DEVK900002" tm:owner="admin" tm:desc="Task" tm:status="D">
            <tm:abap_object tm:pgmid="R3TR" tm:type="CLAS" tm:name="ZCL_A" tm:wbtype="CLAS/OC" tm:obj_desc="Class A"/>
            <tm:abap_object tm:pgmid="R3TR" tm:type="PROG" tm:name="ZREPORT_B" tm:wbtype="PROG/P" tm:obj_desc="Report B"/>
          </tm:task>
        </tm:request>
      </tm:root>`;

    it('list summary=true omits object lists and keeps an objectCount', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, LIST_WITH_OBJECTS_XML, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'list',
        summary: true,
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text).transports;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('DEVK900001');
      expect(parsed[0].description).toBe('Feature X');
      expect(parsed[0].objectCount).toBe(2);
      expect(parsed[0].tasks[0].objectCount).toBe(2);
      // objects[] must be gone — no object names or keys anywhere in the payload
      const text = result.content[0]!.text;
      expect(text).not.toContain('ZCL_A');
      expect(text).not.toContain('pgmid');
      expect(parsed[0].tasks[0].objects).toBeUndefined();
    });

    it('list summary=false keeps full object lists (opt-in)', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, LIST_WITH_OBJECTS_XML, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'list',
        summary: false,
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text).transports;
      expect(parsed[0].tasks[0].objects).toHaveLength(2);
      expect(result.content[0]!.text).toContain('ZCL_A');
      expect(parsed[0].objectCount).toBeUndefined(); // count is summary-only
    });

    it('list caps at 50 by default and reports the true backlog total', async () => {
      // 108 open requests measured at 97 KB (~24k tokens) live; the payload scales with the backlog.
      const rows = Array.from(
        { length: 120 },
        (_, i) =>
          `<tm:request tm:number="DEVK9${String(i).padStart(5, '0')}" tm:owner="admin" tm:desc="R${i}" tm:status="D" tm:type="K"/>`,
      ).join('');
      mockFetch.mockResolvedValue(
        mockResponse(200, `<tm:root xmlns:tm="http://www.sap.com/cts/transports">${rows}</tm:root>`, {
          'x-csrf-token': 'T',
        }),
      );
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', { action: 'list' });
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.total).toBe(120);
      expect(parsed.shown).toBe(50);
      expect(parsed.truncated).toBe(true);
      expect(parsed.transports).toHaveLength(50);
      expect(parsed.hint).toContain('maxResults');

      mockFetch.mockResolvedValue(
        mockResponse(200, `<tm:root xmlns:tm="http://www.sap.com/cts/transports">${rows}</tm:root>`, {
          'x-csrf-token': 'T',
        }),
      );
      const capped = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'list',
        maxResults: 3,
      });
      const parsedCapped = JSON.parse(capped.content[0]!.text);
      expect(parsedCapped.transports).toHaveLength(3);
      expect(parsedCapped.total).toBe(120);
    });

    it('history returns object transport data as JSON', async () => {
      // Real /transports response shape: com.sap.adt.lock.result2 with flat
      // CORRNR/CORRUSER/CORRTEXT on DATA. CORRNR is already the parent
      // K-request (SAP resolves task→parent automatically).
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <LOCK_HANDLE/>
      <CORRNR>A4HK900123</CORRNR>
      <CORRUSER>DEVELOPER</CORRUSER>
      <CORRTEXT>Refactor ZCL_TEST</CORRTEXT>
    </DATA>
  </asx:values>
</asx:abap>`;
      mockFetch.mockResolvedValue(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'history',
        type: 'CLAS',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.object).toEqual({
        type: 'CLAS',
        name: 'ZCL_TEST',
        uri: '/sap/bc/adt/oo/classes/ZCL_TEST',
      });
      expect(parsed.lockedTransport).toBe('A4HK900123');
      expect(parsed.relatedTransports[0]).toEqual({
        id: 'A4HK900123',
        description: 'Refactor ZCL_TEST',
        owner: 'DEVELOPER',
        status: 'D',
      });
      expect(parsed.candidateTransports).toEqual([]);
      expect(parsed.summary).toBe('Object ZCL_TEST is locked in transport A4HK900123 by DEVELOPER.');
    });

    it('history falls back to transportchecks when /transports is empty', async () => {
      const objectStructure = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:packageRef adtcore:name="Z_MY_PKG"/>
      </adtcore:objectReferences>`;
      const fallbackXml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
        <asx:values><DATA>
          <DEVCLASS>Z_MY_PKG</DEVCLASS>
          <DLVUNIT>SAP</DLVUNIT>
          <RECORDING>X</RECORDING>
          <TRANSPORTS>
            <headers>
              <TRKORR>A4HK900500</TRKORR>
              <AS4TEXT>Fallback candidate</AS4TEXT>
              <AS4USER>DEVELOPER</AS4USER>
            </headers>
          </TRANSPORTS>
        </DATA></asx:values>
      </asx:abap>`;

      mockFetch.mockImplementation((url: string) => {
        const target = String(url);
        if (target.includes('/sap/bc/adt/oo/classes/ZCL_TEST/transports')) {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (target.includes('/sap/bc/adt/oo/classes/ZCL_TEST')) {
          return Promise.resolve(mockResponse(200, objectStructure, { 'x-csrf-token': 'T' }));
        }
        if (target.includes('/sap/bc/adt/cts/transportchecks')) {
          return Promise.resolve(mockResponse(200, fallbackXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'history',
        type: 'CLAS',
        name: 'ZCL_TEST',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.relatedTransports).toEqual([]);
      expect(parsed.candidateTransports).toHaveLength(1);
      expect(parsed.candidateTransports[0]?.id).toBe('A4HK900500');
      expect(parsed.summary).toContain('available for assignment');
    });

    it('history requires type and name', async () => {
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'history',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"type" and "name" are required');
    });
  });

  describe('transport error hints', () => {
    it('corrNr-missing error includes transport hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Correction number is required for this package',
          400,
          '/sap/bc/adt/programs/programs/ZPROG/source/main',
          'correction number required',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('transport/correction number is required');
      expect(result.content[0]?.text).toContain('SE09');
    });

    it('404 error gets generic not-found hint (takes priority over transport hint)', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Transport does not exist',
          404,
          '/sap/bc/adt/cts/transportrequests/NPLK900042',
          'E070 transport does not exist',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      // 404 triggers isNotFound check before getTransportHint — generic not-found hint is returned
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not found');
      expect(result.content[0]?.text).toContain('SAPSearch');
    });

    it('403 transport authorization error gets SAP-domain auth hint (takes priority over transport hint)', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'No authorization for transport operations',
          403,
          '/sap/bc/adt/cts/transportrequests',
          'S_TRANSPRT no authorization',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      // 403 is now classified as a SAP-domain authorization error before transport hint fallback
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SU53');
      expect(result.content[0]?.text).toContain('PFCG');
    });

    it('transport not found on 400 status gets transport-specific hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Transport request error',
          400,
          '/sap/bc/adt/programs/programs/ZPROG',
          'E070 transport does not exist',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      // 400 does NOT trigger isNotFound — getTransportHint fires with E070 match
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not modifiable');
      expect(result.content[0]?.text).toContain('SE09');
    });

    it('package transport layer mismatch includes package hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Package has no transport layer',
          400,
          '/sap/bc/adt/programs/programs/ZPROG',
          'package ZTEST no transport layer assigned',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('transport layer');
      expect(result.content[0]?.text).toContain('$TMP');
    });

    it('no false positive when corrNr appears in URL path but error is unrelated', async () => {
      // When a transport IS provided, the URL contains ?corrNr=A4HK900502.
      // The error message includes the URL path: "ADT API error: status 400 at /sap/bc/adt/ddic/ddl/sources?corrNr=A4HK900502: ..."
      // The transport hint must NOT fire just because "corrnr" appears in the URL.
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          '<exc:exception><exc:localizedMessage>Resource Data Definition ZA_TEST does already exist.</exc:localizedMessage></exc:exception>',
          400,
          '/sap/bc/adt/ddic/ddl/sources?corrNr=A4HK900502',
          '<exc:exception><exc:localizedMessage>Resource Data Definition ZA_TEST does already exist.</exc:localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      // The hint should NOT appear — the error is "already exists", not a transport issue
      expect(result.content[0]?.text).not.toContain('transport/correction number is required');
      expect(result.content[0]?.text).toContain('does already exist');
    });

    it('no false positive on syntax error when corrNr in URL', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          '<exc:exception><exc:localizedMessage>Syntax error in ZD_TEST: DDL source could not be saved</exc:localizedMessage></exc:exception>',
          400,
          '/sap/bc/adt/ddic/ddl/sources/ZD_TEST/source/main?lockHandle=ABC&corrNr=A4HK900502',
          '<exc:exception><exc:localizedMessage>Syntax error in ZD_TEST: DDL source could not be saved</exc:localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      // Syntax error — no transport hint
      expect(result.content[0]?.text).not.toContain('transport/correction number is required');
      expect(result.content[0]?.text).toContain('Syntax error');
    });

    it('no false positive on 409 lock conflict when corrNr in URL', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          '<exc:exception><exc:localizedMessage>Request A4HK900502 is currently being edited by user MARIAN</exc:localizedMessage></exc:exception>',
          409,
          '/sap/bc/adt/ddic/ddl/sources?corrNr=A4HK900502',
          '<exc:exception><exc:localizedMessage>Request A4HK900502 is currently being edited by user MARIAN</exc:localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      // Lock conflict — no transport hint
      expect(result.content[0]?.text).not.toContain('transport/correction number is required');
      expect(result.content[0]?.text).toContain('currently being edited');
    });

    it('non-transport 500 errors get server error hint (not transport hint)', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError('Some generic server error', 500, '/sap/bc/adt/programs/programs/ZPROG', 'internal error'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      // Should get server error hint, NOT transport hint
      expect(result.content[0]?.text).toContain('SAP application server error');
      expect(result.content[0]?.text).not.toContain('transport');
    });
  });

  describe('SAPWrite transport pre-flight check', () => {
    const transportInfoResponse = (recording: boolean, isLocal: boolean, transports: string[] = []) => {
      const transportEntries = transports
        .map((t) => `<headers><TRKORR>${t}</TRKORR><AS4TEXT>Transport ${t}</AS4TEXT><AS4USER>DEV</AS4USER></headers>`)
        .join('');
      return `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING>${recording ? 'X' : ''}</RECORDING>
        <DLVUNIT>${isLocal ? 'LOCAL' : 'SAP'}</DLVUNIT>
        <DEVCLASS>Z_MY_PKG</DEVCLASS>
        ${transports.length > 0 ? `<TRANSPORTS>${transportEntries}</TRANSPORTS>` : ''}
      </DATA></asx:values></asx:abap>`;
    };
    const lockedTransportInfoResponse = (transport: string, packageName: string) =>
      `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING>X</RECORDING>
        <DLVUNIT>SAP</DLVUNIT>
        <DEVCLASS>${packageName}</DEVCLASS>
        <LOCKS><HEADER><TRKORR>${transport}</TRKORR></HEADER></LOCKS>
      </DATA></asx:values></asx:abap>`;

    it('returns guidance error when creating in transportable package without transport', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: String(url), method: opts?.method ?? 'GET' });
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(
            mockResponse(200, transportInfoResponse(true, false, ['A4HK900502']), { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: 'Z_MY_PKG',
        source: 'REPORT ztest.',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requires a transport number');
      expect(result.content[0]?.text).toContain('SAPTransport');
      expect(result.content[0]?.text).toContain('A4HK900502');
    });

    it('proceeds without transport for $TMP packages (no transportInfo call)', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: String(url), method: opts?.method ?? 'GET' });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: '$TMP',
        source: 'REPORT ztest.',
      });

      expect(result.isError).toBeUndefined();
      // No call to transportchecks for $TMP
      expect(calls.some((c) => c.url.includes('/cts/transportchecks'))).toBe(false);
    });

    it('proceeds when transport is explicitly provided (no transportInfo call)', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: String(url), method: opts?.method ?? 'GET' });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: 'Z_MY_PKG',
        transport: 'A4HK900502',
        source: 'REPORT ztest.',
      });

      expect(result.isError).toBeUndefined();
      // No call to transportchecks when transport is explicitly provided
      expect(calls.some((c) => c.url.includes('/cts/transportchecks'))).toBe(false);
    });

    it('auto-uses locked transport from transportInfo response', async () => {
      const lockedResponse = `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING>X</RECORDING>
        <DLVUNIT>SAP</DLVUNIT>
        <DEVCLASS>Z_MY_PKG</DEVCLASS>
        <LOCKS><HEADER><TRKORR>A4HK900999</TRKORR></HEADER></LOCKS>
      </DATA></asx:values></asx:abap>`;
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: String(url), method: opts?.method ?? 'GET' });
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(mockResponse(200, lockedResponse, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: 'Z_MY_PKG',
        source: 'REPORT ztest.',
      });

      expect(result.isError).toBeUndefined();
      // Create call should include the locked transport as corrNr
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/programs/programs'));
      expect(createCall?.url).toContain('corrNr=A4HK900999');
    });

    it('proceeds if transportInfo check fails (graceful fallback)', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(mockResponse(500, 'Internal Error', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: 'Z_MY_PKG',
        source: 'REPORT ztest.',
      });

      // Should proceed without blocking — SAP will return its own error if needed
      // (may still fail later for other reasons, but transport check itself should not block)
      expect(result.content[0]?.text).not.toContain('requires a transport number');
    });

    it('logs and proceeds if batch_create transportInfo check fails', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      try {
        mockFetch.mockImplementation((url: string) => {
          if (String(url).includes('/cts/transportchecks')) {
            return Promise.resolve(mockResponse(500, 'Internal Error', { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
        });

        const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
        const result = await handleToolCall(createClient(), config, 'SAPWrite', {
          action: 'batch_create',
          package: 'Z_MY_PKG',
          objects: [{ type: 'PROG', name: 'ZTEST', source: 'REPORT ztest.' }],
        });

        expect(result.content[0]?.text).not.toContain('requires a transport number');
        expect(warnSpy).toHaveBeenCalledWith(
          'SAPWrite batch_create transport preflight failed; continuing without auto transport',
          expect.objectContaining({
            package: 'Z_MY_PKG',
            type: 'PROG',
            name: 'ZTEST',
            error: expect.stringContaining('ADT API error'),
          }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('returns guidance error for batch_create in transportable package without transport', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(
            mockResponse(200, transportInfoResponse(true, false, ['A4HK900502']), { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: 'Z_MY_PKG',
        objects: [
          { type: 'DDLS', name: 'ZI_TRAVEL', source: '@EndUserText.label: "Travel"\ndefine view entity ZI_TRAVEL ...' },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requires a transport number');
      expect(result.content[0]?.text).toContain('SAPTransport');
    });

    it('still preflights batch_create package when only some objects provide object transport', async () => {
      const calls: string[] = [];
      mockFetch.mockImplementation((url: string) => {
        calls.push(String(url));
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(
            mockResponse(200, transportInfoResponse(true, false, ['A4HK900502']), { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        objects: [
          { type: 'PROG', name: 'ZPROG1', package: 'Z_MY_PKG', transport: 'A4HK900501', source: 'REPORT zprog1.' },
          { type: 'PROG', name: 'ZPROG2', package: 'Z_MY_PKG', source: 'REPORT zprog2.' },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requires a transport number');
      expect(calls.some((url) => url.includes('/cts/transportchecks'))).toBe(true);
      expect(calls.some((url) => url.includes('/sap/bc/adt/programs/programs?corrNr=A4HK900501'))).toBe(false);
    });

    it('auto-uses locked transports separately for each batch_create package', async () => {
      let transportCheckCount = 0;
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        const urlStr = String(url);
        const method = opts?.method ?? 'GET';
        calls.push({ url: urlStr, method });

        if (urlStr.includes('/cts/transportchecks')) {
          transportCheckCount++;
          const transport = transportCheckCount === 1 ? 'A4HK900111' : 'A4HK900222';
          const packageName = transportCheckCount === 1 ? 'ZPKG1' : 'ZPKG2';
          return Promise.resolve(
            mockResponse(200, lockedTransportInfoResponse(transport, packageName), { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        objects: [
          { type: 'PROG', name: 'ZPROG1', package: 'ZPKG1', source: 'REPORT zprog1.' },
          { type: 'PROG', name: 'ZPROG2', package: 'ZPKG2', source: 'REPORT zprog2.' },
        ],
      });

      expect(result.isError).toBeUndefined();
      expect(calls.filter((c) => c.url.includes('/cts/transportchecks'))).toHaveLength(2);
      const createUrls = calls
        .filter(
          (c) =>
            c.method === 'POST' &&
            c.url.includes('/sap/bc/adt/programs/programs') &&
            !c.url.includes('_action=') &&
            !c.url.includes('/activation'),
        )
        .map((c) => c.url);
      expect(createUrls.some((url) => url.includes('corrNr=A4HK900111'))).toBe(true);
      expect(createUrls.some((url) => url.includes('corrNr=A4HK900222'))).toBe(true);
      expect(result.content[0]?.text).toContain('across packages [ZPKG1, ZPKG2]');
    });

    it('proceeds for local package response even if DLVUNIT is not LOCAL', async () => {
      // Some packages might not require recording even if not strictly "LOCAL"
      mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(mockResponse(200, transportInfoResponse(false, false), { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: 'Z_MY_PKG',
        source: 'REPORT ztest.',
      });

      // recording=false → no transport needed, proceed
      expect(result.content[0]?.text).not.toContain('requires a transport number');
    });
  });

  describe('SAPWrite delete corrNr auto-propagation', () => {
    const lockBodyWithCorrNr =
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR>A4HK900100</CORRNR><IS_LOCAL></IS_LOCAL></DATA></asx:values></asx:abap>';
    const lockBodyNoCorrNr =
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';

    it('auto-propagates lock corrNr to delete when no transport supplied', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: url.toString(), method: opts?.method ?? 'GET' });
        // CSRF HEAD
        if (opts?.method === 'HEAD') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        // Lock POST
        if (url.toString().includes('_action=LOCK'))
          return Promise.resolve(mockResponse(200, lockBodyWithCorrNr, { 'x-csrf-token': 'T' }));
        // Delete
        if (opts?.method === 'DELETE') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        // Unlock POST
        if (url.toString().includes('_action=UNLOCK'))
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'ZTEST',
      });

      expect(result.isError).toBeUndefined();
      const deleteCall = calls.find((c) => c.method === 'DELETE');
      expect(deleteCall).toBeDefined();
      expect(deleteCall!.url).toContain('corrNr=A4HK900100');
    });

    it('uses explicit transport over lock corrNr in delete', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: url.toString(), method: opts?.method ?? 'GET' });
        if (opts?.method === 'HEAD') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=LOCK'))
          return Promise.resolve(mockResponse(200, lockBodyWithCorrNr, { 'x-csrf-token': 'T' }));
        if (opts?.method === 'DELETE') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=UNLOCK'))
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'ZTEST',
        transport: 'EXPLICIT_TR',
      });

      expect(result.isError).toBeUndefined();
      const deleteCall = calls.find((c) => c.method === 'DELETE');
      expect(deleteCall).toBeDefined();
      expect(deleteCall!.url).toContain('corrNr=EXPLICIT_TR');
      expect(deleteCall!.url).not.toContain('A4HK900100');
    });

    it('does not add corrNr to delete when lock returns empty corrNr', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: url.toString(), method: opts?.method ?? 'GET' });
        if (opts?.method === 'HEAD') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=LOCK'))
          return Promise.resolve(mockResponse(200, lockBodyNoCorrNr, { 'x-csrf-token': 'T' }));
        if (opts?.method === 'DELETE') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=UNLOCK'))
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'ZTEST',
      });

      expect(result.isError).toBeUndefined();
      const deleteCall = calls.find((c) => c.method === 'DELETE');
      expect(deleteCall).toBeDefined();
      expect(deleteCall!.url).not.toContain('corrNr');
    });

    it('delete succeeds for $TMP objects without transport', async () => {
      mockFetch.mockImplementation((url: string, opts: any) => {
        if (opts?.method === 'HEAD') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=LOCK'))
          return Promise.resolve(mockResponse(200, lockBodyNoCorrNr, { 'x-csrf-token': 'T' }));
        if (opts?.method === 'DELETE') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=UNLOCK'))
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'ZTEST',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Deleted PROG ZTEST');
    });
  });

  describe('SAPWrite delete dependency diagnostics', () => {
    it('enriches DDLS delete [?/039] errors with where-used dependents', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>DLH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      const deleteErrorXml = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">DDL source ZI_ROOT could not be deleted</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-NO">039</entry>
    <entry key="T100KEY-V1">ZI_ROOT</entry>
  </exc:properties>
</exc:exception>`;
      const whereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_one" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_ONE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_two" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_TWO" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/bo/behaviordefinitions/ZI_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ROOT" adtcore:type="BDEF/BO" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        if (method === 'DELETE' && urlStr.includes('/sap/bc/adt/ddic/ddl/sources/ZI_ROOT')) {
          return Promise.resolve(mockResponse(400, deleteErrorXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, whereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'DDLS',
        name: 'ZI_ROOT',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain('could not be deleted');
      expect(text).toContain('Blocking dependents for DDLS ZI_ROOT');
      expect(text).toContain('ZI_CHILD_ONE');
      expect(text).toContain('ZI_CHILD_TWO');
      expect(text).toContain(
        'Suggested delete order: BDEF ZI_ROOT, DDLS ZI_CHILD_ONE, DDLS ZI_CHILD_TWO, then DDLS ZI_ROOT.',
      );
      expect(text).toContain('If the listed dependents were just deleted, wait briefly and retry');
      expect(text).toContain('activate first');

      // Remediation-first ordering: DDIC diagnostics come BEFORE the blocker hint
      // so the LLM sees the raw SAP error → structured diagnostics → remediation.
      const diagnosticsIdx = text.indexOf('DDIC diagnostics:');
      const blockerIdx = text.indexOf('Blocking dependents');
      expect(diagnosticsIdx).toBeGreaterThan(-1);
      expect(blockerIdx).toBeGreaterThan(diagnosticsIdx);

      // The [?/039] T100 key must appear in the diagnostics block (not replaced
      // or shadowed by the blocker hint) — this is the SAP error code that
      // links back to the actual message in SE91.
      expect(text).toContain('[?/039]');

      // The generic "DDIC save failed" hint must NOT fire on delete — it's a
      // save-action remediation ("check annotations, fix field types") that
      // would mislead an LLM into rewriting the DDLS source instead of
      // resolving the dependency chain.
      expect(text).not.toContain('DDIC save failed');
      expect(text).not.toContain('@AbapCatalog annotations');
    });

    it('adds stale-dependency guidance when DDLS delete [?/039] has no current where-used blockers', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>DLH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      const deleteErrorXml = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">DDL source ZI_ROOT could not be deleted</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-NO">039</entry>
    <entry key="T100KEY-V1">ZI_ROOT</entry>
  </exc:properties>
</exc:exception>`;
      const emptyWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects/>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        if (method === 'DELETE' && urlStr.includes('/sap/bc/adt/ddic/ddl/sources/ZI_ROOT')) {
          return Promise.resolve(mockResponse(400, deleteErrorXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, emptyWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'DDLS',
        name: 'ZI_ROOT',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain('[?/039]');
      expect(text).toContain('Delete dependency follow-up for DDLS ZI_ROOT');
      expect(text).toContain('No current ADT where-used dependents were returned');
      expect(text).toContain('wait briefly and retry');
      expect(text).toContain('SAPActivate(type="DDLS", name="ZI_ROOT")');
      expect(text).toContain('SAPNavigate(action="references", type="DDLS", name="ZI_ROOT")');
      expect(text).not.toContain('Blocking dependents for DDLS ZI_ROOT');
      expect(text).not.toContain('DDIC save failed');
      expect(text).not.toContain('@AbapCatalog annotations');
    });

    it('still shows the DDIC save hint for create failures (regression guard)', async () => {
      // The delete fix narrowed the save hint to save actions; make sure we
      // didn't accidentally suppress it for create/update/batch_create too.
      const createErrorXml = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Can't save due to errors in source</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-MSGID">DDL</entry>
    <entry key="T100KEY-MSGNO">001</entry>
    <entry key="LINE">3</entry>
  </exc:properties>
</exc:exception>`;

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/ddic/ddl/sources')) {
          return Promise.resolve(mockResponse(400, createErrorXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_BAD',
        source: 'define view entity ZI_BAD as select from sflight {}',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain('DDIC save failed');
      expect(text).toContain('@AbapCatalog annotations');
    });

    it('does not mislabel write session failures as DDIC save failures', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>DLH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('_action=UNLOCK')) {
          return Promise.resolve(mockResponse(400, 'Service cannot be reached', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_UNLOCK_FAIL',
        source: 'define view entity ZI_UNLOCK_FAIL as select from sflight { key carrid }',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain('SAP ADT write/session infrastructure failed');
      expect(text).not.toContain('DDIC save failed');
      expect(text).not.toContain('@AbapCatalog annotations');
    });
  });

  describe('SAPWrite MSAG transport-vs-task guard', () => {
    function buildTransportListXml(transportId: string | null): string {
      // SAP returns 200 with a workbench listing — empty when ID doesn't match a request.
      if (!transportId) {
        return (
          `<?xml version="1.0" encoding="utf-8"?>` +
          `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:workbench/></tm:root>`
        );
      }
      return (
        `<?xml version="1.0" encoding="utf-8"?>` +
        `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm">` +
        `<tm:workbench><tm:request tm:number="${transportId}" tm:owner="MARIAN" tm:type="K" tm:status="D" tm:description="x"/>` +
        `</tm:workbench></tm:root>`
      );
    }

    it('rejects MSAG create when transport ID is not a valid request (task number)', async () => {
      mockFetch.mockReset();
      // First call: getTransport returns no matching request.
      mockFetch.mockResolvedValueOnce(mockResponse(200, buildTransportListXml(null)));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'MSAG',
        name: 'ZARC1_MSAG_BAD',
        package: '$TMP',
        transport: 'TASK001',
        description: 'test',
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('not a valid transport request');
      expect(text).toContain('TASK001');
    });

    it('proceeds past the guard when getTransport returns a valid request', async () => {
      mockFetch.mockReset();
      // getTransport returns matching request.
      mockFetch.mockResolvedValueOnce(mockResponse(200, buildTransportListXml('REQ001')));
      // Subsequent calls (CSRF + create + activate stubs) — succeed minimally.
      mockFetch.mockResolvedValue(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'MSAG',
        name: 'ZARC1_MSAG_OK',
        package: '$TMP',
        transport: 'REQ001',
        description: 'test',
      });

      // Guard fell through — at least 2 fetches happened (transport check + follow-up).
      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    });

    it('caches getTransport result across MSAG entries inside batch_create', async () => {
      mockFetch.mockReset();
      // First call: getTransport returns a matching request.
      mockFetch.mockResolvedValueOnce(mockResponse(200, buildTransportListXml('REQ001')));
      // Subsequent calls — minimal stubs to keep the batch loop alive.
      mockFetch.mockResolvedValue(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        transport: 'REQ001',
        objects: [
          { type: 'MSAG', name: 'ZARC1_MSAG1', description: 'm1' },
          { type: 'MSAG', name: 'ZARC1_MSAG2', description: 'm2' },
          { type: 'MSAG', name: 'ZARC1_MSAG3', description: 'm3' },
        ],
      });

      // Count transport-listing-endpoint calls. Exactly one should fire for the whole batch
      // (cache hit on entries 2 and 3).
      const transportCalls = mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('/sap/bc/adt/cts/transportrequests/REQ001'),
      );
      expect(transportCalls.length).toBe(1);
    });
  });
});

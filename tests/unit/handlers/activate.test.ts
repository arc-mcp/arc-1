/**
 * SAPActivate handler unit tests — split from the former intent.test.ts monolith.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('SAPActivate handler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

  describe('SAPActivate', () => {
    it('activates a single object', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      // Mock returns generic text with no error markers → activation succeeds
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully activated PROG ZTEST');
    });

    it('activates a function-group structural include through its parent-group URI', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'INCL',
        name: 'LZARC1TOP',
        group: 'ZARC1',
      });
      expect(result.isError).toBeUndefined();
      const activationCall = mockFetch.mock.calls.find((call) => String(call[0]).includes('/activation?'));
      expect(String(activationCall?.[1]?.body)).toContain('/sap/bc/adt/functions/groups/zarc1/includes/lzarc1top');
    });

    it('batch activates multiple objects', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        objects: [
          { type: 'DDLS', name: 'ZI_TRAVEL' },
          { type: 'BDEF', name: 'ZI_TRAVEL' },
          { type: 'SRVD', name: 'ZSD_TRAVEL' },
        ],
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully activated 3 objects');
      expect(result.content[0]?.text).toContain('ZI_TRAVEL');
      expect(result.content[0]?.text).toContain('ZSD_TRAVEL');
    });

    // ─── allowedPackages ceiling on activation (security audit 2026-06) ───
    // Activation is a write-class state change (inactive draft → active runtime
    // version) and must honor allowedPackages against the object's REAL package,
    // exactly like create/update/delete. Without this, a write-scoped user confined
    // to e.g. $TMP could activate a pre-existing draft in a restricted package.
    function restrictedTmpClient(): InstanceType<typeof AdtClient> {
      return new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
    }

    it('blocks single activation of an object in a non-allowed package', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZRESTRICTED"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const result = await handleToolCall(restrictedTmpClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'CLAS',
        name: 'ZCL_VICTIM',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZRESTRICTED');
      expect(result.content[0]?.text).toContain('blocked');
      // The activation endpoint must never be reached — the only call is the
      // package-resolution GET.
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/activation'))).toBe(false);
    });

    it('allows single activation when the object is in an allowed package', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const result = await handleToolCall(restrictedTmpClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'CLAS',
        name: 'ZCL_OK',
      });
      expect(result.content[0]?.text).not.toContain('blocked');
      expect(result.content[0]?.text).toContain('Successfully activated');
    });

    it('blocks batch activation when any object is in a non-allowed package (no partial activation)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZRESTRICTED"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const result = await handleToolCall(restrictedTmpClient(), DEFAULT_CONFIG, 'SAPActivate', {
        objects: [
          { type: 'CLAS', name: 'ZCL_A' },
          { type: 'CLAS', name: 'ZCL_B' },
        ],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked');
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/activation'))).toBe(false);
    });

    it('makes no package-resolution call when allowedPackages is unrestricted', async () => {
      // Default client = unrestricted allowedPackages → the gate is a no-op and
      // must not add an HTTP round-trip resolving the object's package.
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.content[0]?.text).toContain('Successfully activated PROG ZTEST');
      const resolvedObjectMetadata = mockFetch.mock.calls.some(
        (c) => String(c[0]).includes('/programs/programs/ztest') && (c[1]?.method ?? 'GET') === 'GET',
      );
      expect(resolvedObjectMetadata).toBe(false);
    });

    it('blocks publish_srvb when the service binding package is not allowed', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZSB_SECRET"><adtcore:packageRef adtcore:name="ZRESTRICTED"/></srvb:serviceBinding>',
          { 'x-csrf-token': 'T' },
        ),
      );

      const result = await handleToolCall(restrictedTmpClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_SECRET',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZRESTRICTED');
      expect(result.content[0]?.text).toContain('blocked');
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/publishjobs'))).toBe(false);
    });

    it('blocks unpublish_srvb when the service binding package is not allowed', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZSB_SECRET"><adtcore:packageRef adtcore:name="ZRESTRICTED"/></srvb:serviceBinding>',
          { 'x-csrf-token': 'T' },
        ),
      );

      const result = await handleToolCall(restrictedTmpClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'unpublish_srvb',
        name: 'ZSB_SECRET',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZRESTRICTED');
      expect(result.content[0]?.text).toContain('blocked');
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/unpublishjobs'))).toBe(false);
    });

    it('allows publish_srvb when the resolved service binding package is allowed', async () => {
      mockFetch.mockReset();
      const srvbXml =
        '<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZSB_OK" srvb:published="false"><adtcore:packageRef adtcore:name="$TMP"/><srvb:binding srvb:version="V2" srvb:type="ODATA" srvb:category="0"/></srvb:serviceBinding>';
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, srvbXml, { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(mockResponse(200, srvbXml, { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Published</SHORT_TEXT><LONG_TEXT></LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZSB_OK" srvb:published="true"><adtcore:packageRef adtcore:name="$TMP"/></srvb:serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );

      const result = await handleToolCall(restrictedTmpClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_OK',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully published service binding ZSB_OK');
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/publishjobs'))).toBe(true);
    });

    it('batch activation uses type from individual objects', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        objects: [
          { type: 'DDLX', name: 'ZC_TRAVEL' },
          { type: 'SRVB', name: 'ZUI_TRAVEL_O4' },
        ],
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully activated 2 objects');
    });

    it('batch activation returns per-object status details on mixed outcomes', async () => {
      const xml = `<messages>
        <msg type="W" severity="warning" shortText="Root warning" uri="/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL" line="8"/>
        <msg type="E" severity="error" shortText="BDEF activation failed" uri="/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVEL" line="21"/>
      </messages>`;
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(mockResponse(200, xml, { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        objects: [
          { type: 'DDLS', name: 'ZI_TRAVEL' },
          { type: 'BDEF', name: 'ZI_TRAVEL' },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZI_TRAVEL (DDLS)');
      expect(result.content[0]?.text).toContain('ZI_TRAVEL (BDEF)');
      expect(result.content[0]?.text).toContain('[line 21] BDEF activation failed');
    });

    it('publishes a service binding', async () => {
      // Mock: 1) getSrvb for service type detection (GET, also delivers CSRF), 2) publish POST, 3) getSrvb readback
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4"><binding version="V2" type="ODATA" category="0"/></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Published</SHORT_TEXT><LONG_TEXT></LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4" published="true"></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_TRAVEL_O4',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully published service binding ZSB_TRAVEL_O4');

      // Verify wire-level: correct endpoint and body sent (publish is call[1] after getSrvb)
      const publishCall = mockFetch.mock.calls[1];
      const publishUrl = String(publishCall[0]);
      expect(publishUrl).toContain('/sap/bc/adt/businessservices/odatav2/publishjobs');
      expect(publishUrl).toContain('servicename=ZSB_TRAVEL_O4');
      expect(publishUrl).toContain('serviceversion=0001');
      const publishOpts = publishCall[1] as Record<string, unknown>;
      expect(publishOpts.method).toBe('POST');
      expect(String(publishOpts.body)).toContain('adtcore:name="ZSB_TRAVEL_O4"');
    });

    it('package-gate metadata read for publish_srvb sends the parameter-less servicebinding Accept', async () => {
      // Regression (SAP_BASIS 758): the bindings resource rejects an Accept carrying
      // "; charset=utf-8" with 406 SADT_RESOURCE 037, which broke publish_srvb/unpublish_srvb
      // whenever allowedPackages is restricted (the gate's resolveObjectPackage GET ran with
      // the charset-suffixed content type). The gate must send the bare media type.
      const bindingXml =
        '<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZSB_TRAVEL_O4"><adtcore:packageRef adtcore:name="Z_TEST_PKG"/><binding version="V2" type="ODATA" category="0"/></srvb:serviceBinding>';
      mockFetch
        // 1) package-gate resolveObjectPackage GET (also delivers CSRF token)
        .mockResolvedValueOnce(mockResponse(200, bindingXml, { 'x-csrf-token': 'T' }))
        // 2) getSrvb for service type detection
        .mockResolvedValueOnce(mockResponse(200, bindingXml, { 'x-csrf-token': 'T' }))
        // 3) publish POST
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Published</SHORT_TEXT><LONG_TEXT></LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        )
        // 4) getSrvb readback
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4" published="true"></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['Z*'] },
      });
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_TRAVEL_O4',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully published service binding ZSB_TRAVEL_O4');

      const gateCall = mockFetch.mock.calls[0];
      expect(String(gateCall[0])).toContain('/sap/bc/adt/businessservices/bindings/ZSB_TRAVEL_O4');
      const gateHeaders = ((gateCall[1] as Record<string, unknown>)?.headers ?? {}) as Record<string, string>;
      expect(gateHeaders.Accept).toBe('application/vnd.sap.adt.businessservices.servicebinding.v2+xml');
      expect(gateHeaders.Accept).not.toContain('charset');
    });

    it('returns error when publish_srvb fails', async () => {
      mockFetch
        // getSrvb for service type detection (also delivers CSRF token)
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_MISSING"></serviceBinding>',
            {
              'x-csrf-token': 'T',
            },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>ERROR</SEVERITY><SHORT_TEXT>Binding not found</SHORT_TEXT><LONG_TEXT>Details</LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_MISSING',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to publish service binding ZSB_MISSING');
    });

    it('handles UNKNOWN severity from unparseable publish response', async () => {
      mockFetch
        // getSrvb for service type detection (also delivers CSRF token)
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TEST"></serviceBinding>',
            {
              'x-csrf-token': 'T',
            },
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, '<unexpected>xml format</unexpected>', { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TEST" published="true"></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_TEST',
      });
      // UNKNOWN severity should produce a cautious message, not "Successfully published"
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('could not be fully parsed');
    });

    it('returns error when publish_srvb called without name', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Missing required "name"');
    });

    it('returns error when publish response is OK but readback shows unpublished', async () => {
      // Simulate: SAP returns SEVERITY=OK but the SRVB readback still shows published=false
      mockFetch
        // getSrvb for service type detection (also delivers CSRF token)
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4"></serviceBinding>',
            {
              'x-csrf-token': 'T',
            },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Published</SHORT_TEXT><LONG_TEXT></LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4" published="false"></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_TRAVEL_O4',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('still unpublished');
    });

    it('unpublishes a service binding', async () => {
      mockFetch
        // getSrvb for service type detection (also delivers CSRF token)
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4"></serviceBinding>',
            {
              'x-csrf-token': 'T',
            },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Unpublished</SHORT_TEXT><LONG_TEXT></LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        )
        // getSrvb readback: return unpublished SRVB metadata
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4" published="false"></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'unpublish_srvb',
        name: 'ZSB_TRAVEL_O4',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully unpublished service binding ZSB_TRAVEL_O4');

      // Verify wire-level: correct endpoint for unpublish (call[1] after getSrvb)
      const unpublishCall = mockFetch.mock.calls[1];
      const unpublishUrl = String(unpublishCall[0]);
      expect(unpublishUrl).toContain('/sap/bc/adt/businessservices/odatav2/unpublishjobs');
      expect(unpublishUrl).toContain('servicename=ZSB_TRAVEL_O4');
    });

    it('package-gate metadata read for unpublish_srvb sends the parameter-less servicebinding Accept', async () => {
      // Symmetric to the publish_srvb gate regression test: the unpublish gate runs the same
      // resolveObjectPackage GET and must send the bare media type (758/816 reject parameters
      // with 406 SADT_RESOURCE 037).
      const bindingXml =
        '<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZSB_TRAVEL_O4"><adtcore:packageRef adtcore:name="Z_TEST_PKG"/><binding version="V2" type="ODATA" category="0"/></srvb:serviceBinding>';
      mockFetch
        // 1) package-gate resolveObjectPackage GET (also delivers CSRF token)
        .mockResolvedValueOnce(mockResponse(200, bindingXml, { 'x-csrf-token': 'T' }))
        // 2) getSrvb for service type detection
        .mockResolvedValueOnce(mockResponse(200, bindingXml, { 'x-csrf-token': 'T' }))
        // 3) unpublish POST
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Unpublished</SHORT_TEXT><LONG_TEXT></LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        )
        // 4) getSrvb readback
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4" published="false"></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['Z*'] },
      });
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', {
        action: 'unpublish_srvb',
        name: 'ZSB_TRAVEL_O4',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully unpublished service binding ZSB_TRAVEL_O4');

      const gateCall = mockFetch.mock.calls[0];
      expect(String(gateCall[0])).toContain('/sap/bc/adt/businessservices/bindings/ZSB_TRAVEL_O4');
      const gateHeaders = ((gateCall[1] as Record<string, unknown>)?.headers ?? {}) as Record<string, string>;
      expect(gateHeaders.Accept).toBe('application/vnd.sap.adt.businessservices.servicebinding.v2+xml');
      expect(gateHeaders.Accept).not.toContain('charset');
    });

    it('activates a DDIC structure via TABL with structure URL in XML body', async () => {
      // Model B: structures use type='TABL'. The activate handler resolves the
      // URL via client.resolveTablObjectUrlForWrite which asks SAP for the
      // actual subtype (TABL/DS) and returns /structures/. See issue #285.
      //   call 0: GET search?...&query=ZTEST_STRUCT  → returns TABL/DS
      //   call 1: POST .../activation                → 200 (activate)
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/structures/ZTEST_STRUCT" adtcore:type="TABL/DS" adtcore:name="ZTEST_STRUCT"/>
</adtcore:objectReferences>`,
        ),
      );
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          '<?xml version="1.0"?><iac:inactiveCTSObjects xmlns:iac="http://www.sap.com/abapxml/inactiveCtsObjects"/>',
          { 'x-csrf-token': 'T' },
        ),
      );
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: 'ZTEST_STRUCT',
      });
      const lastCallOpts = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1] as RequestInit;
      expect(lastCallOpts.body).toContain('/sap/bc/adt/ddic/structures/ZTEST_STRUCT');
    });

    it('activates a transparent table via TABL with /tables/ URL (no fallback)', async () => {
      // For a transparent table, the write-path resolver asks SAP via search
      // and gets back TABL/DT → routes to /tables/ deterministically.
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/tables/ZTEST_TABLE" adtcore:type="TABL/DT" adtcore:name="ZTEST_TABLE"/>
</adtcore:objectReferences>`,
        ),
      );
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          '<?xml version="1.0"?><iac:inactiveCTSObjects xmlns:iac="http://www.sap.com/abapxml/inactiveCtsObjects"/>',
          { 'x-csrf-token': 'T' },
        ),
      );
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: 'ZTEST_TABLE',
      });
      const lastCallOpts = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1] as RequestInit;
      expect(lastCallOpts.body).toContain('/sap/bc/adt/ddic/tables/ZTEST_TABLE');
      expect(lastCallOpts.body).not.toContain('/sap/bc/adt/ddic/structures/ZTEST_TABLE');
    });

    it('activates DOMA with correct object URL in XML body', async () => {
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'DOMA',
        name: 'ZBUKRS',
      });
      const lastCallOpts = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1] as RequestInit;
      expect(lastCallOpts.body).toContain('/sap/bc/adt/ddic/domains/ZBUKRS');
    });

    it('activates DTEL with correct object URL in XML body', async () => {
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'DTEL',
        name: 'ZBUKRS_DTEL',
      });
      const lastCallOpts = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1] as RequestInit;
      expect(lastCallOpts.body).toContain('/sap/bc/adt/ddic/dataelements/ZBUKRS_DTEL');
    });

    it('activates TRAN with correct object URL in XML body', async () => {
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TRAN',
        name: 'ZTRAN01',
      });
      const lastCallOpts = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1] as RequestInit;
      expect(lastCallOpts.body).toContain('/sap/bc/adt/vit/wb/object_type/trant/object_name/ZTRAN01');
    });

    it('publish_srvb action publishes and returns SRVB info', async () => {
      const publishOkXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>published locally</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(200, '<serviceBinding><binding version="V4" type="ODATA" category="0"/></serviceBinding>', {
            'x-csrf-token': 'T',
          }),
        ) // getSrvb for service type detection (also delivers CSRF)
        .mockResolvedValueOnce(mockResponse(200, publishOkXml, {})) // POST publishjobs
        .mockResolvedValueOnce(mockResponse(200, '<serviceBinding published="true" bindingCreated="true" />', {})); // GET SRVB readback
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_BOOKING_V4',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully published service binding ZSB_BOOKING_V4');
      // Verify readback content (parsed SRVB metadata) is included in the response
      expect(result.content[0]?.text).toContain('bindingCreated');
      // Verify V4 binding uses odatav4 endpoint (call[1] after getSrvb)
      const publishCall = mockFetch.mock.calls[1];
      expect(String(publishCall[0])).toContain('/sap/bc/adt/businessservices/odatav4/publishjobs');
    });

    it('publish_srvb returns error when SAP reports failure', async () => {
      const publishErrorXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>ERROR</SEVERITY><SHORT_TEXT>Activating failed</SHORT_TEXT><LONG_TEXT>TADIR check failed</LONG_TEXT></DATA></asx:values></asx:abap>';
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(200, '<serviceBinding><binding version="V4" type="ODATA" category="0"/></serviceBinding>', {
            'x-csrf-token': 'T',
          }),
        ) // getSrvb for service type detection (also delivers CSRF)
        .mockResolvedValueOnce(mockResponse(200, publishErrorXml, {}));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_BOOKING_V4',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to publish');
      expect(result.content[0]?.text).toContain('TADIR check failed');
    });

    it('unpublish_srvb action unpublishes service binding', async () => {
      const unpublishOkXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>un-published locally</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(200, '<serviceBinding><binding version="V4" type="ODATA" category="0"/></serviceBinding>', {
            'x-csrf-token': 'T',
          }),
        ) // getSrvb for service type detection (also delivers CSRF)
        .mockResolvedValueOnce(mockResponse(200, unpublishOkXml, {})); // POST unpublishjobs
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'unpublish_srvb',
        name: 'ZSB_BOOKING_V4',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully unpublished service binding ZSB_BOOKING_V4');
      // Verify the POST was made to the unpublishjobs endpoint with odatav4
      const postCall = mockFetch.mock.calls.find((call) => (call[1] as RequestInit)?.method === 'POST');
      expect(postCall).toBeDefined();
      expect(String(postCall![0])).toContain('odatav4/unpublishjobs');
    });

    it('publish_srvb returns error when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Missing required "name"');
    });

    it('unpublish_srvb returns error when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'unpublish_srvb',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Missing required "name"');
    });

    it('publish_srvb uses explicit service_type when provided', async () => {
      const publishOkXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>published</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
        // No getSrvb call expected — explicit service_type skips auto-detection
        .mockResolvedValueOnce(mockResponse(200, publishOkXml, {}))
        .mockResolvedValueOnce(mockResponse(200, '<serviceBinding published="true" />', {}));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_EXPLICIT_V4',
        service_type: 'odatav4',
      });
      expect(result.isError).toBeUndefined();
      // Verify odatav4 endpoint was used (call[1] is the publish POST since no getSrvb call)
      const publishCall = mockFetch.mock.calls[1];
      expect(String(publishCall[0])).toContain('/sap/bc/adt/businessservices/odatav4/publishjobs');
    });

    it('publish_srvb falls back to odatav2 when getSrvb fails', async () => {
      const publishOkXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>published</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';
      mockFetch
        .mockResolvedValueOnce(mockResponse(404, 'Not found', { 'x-csrf-token': 'T' })) // getSrvb fails (also delivers CSRF token)
        .mockResolvedValueOnce(mockResponse(200, publishOkXml, {})) // POST publishjobs
        .mockResolvedValueOnce(mockResponse(200, '<serviceBinding published="true" />', {})); // getSrvb readback
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_FALLBACK',
      });
      expect(result.isError).toBeUndefined();
      // Falls back to odatav2 when detection fails
      const publishCall = mockFetch.mock.calls[1];
      expect(String(publishCall[0])).toContain('/sap/bc/adt/businessservices/odatav2/publishjobs');
    });

    it('default action still works as activate', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully activated PROG ZTEST');
    });

    it('formats error messages with line numbers and URIs', async () => {
      const xml = `<messages>
        <msg type="E" severity="error" shortText="Type ZI_TRAVEL is not active" uri="/sap/bc/adt/ddic/ddl/sources/zi_travel" line="42"/>
        <msg type="E" severity="error" shortText="Activation was cancelled"/>
      </messages>`;
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('[line 42]');
      expect(result.content[0]?.text).toContain('Type ZI_TRAVEL is not active');
      expect(result.content[0]?.text).toContain('/sap/bc/adt/ddic/ddl/sources/zi_travel');
    });

    it('adds downstream dependency guidance when DDLS activation fails', async () => {
      const activationXml = `<messages>
        <msg type="E" severity="error" shortText="Element NAME does not exist in dependent projection" line="12"/>
      </messages>`;
      const whereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_one" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_ONE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/bo/behaviordefinitions/ZI_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ROOT" adtcore:type="BDEF/BO" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/srvd/sources/ZSD_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZSD_ROOT" adtcore:type="SRVD/SRV" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/activation?method=activate')) {
          return Promise.resolve(mockResponse(200, activationXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, whereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'DDLS',
        name: 'ZI_ROOT',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain('Activation failed for DDLS ZI_ROOT');
      expect(text).toContain('CDS activation impact for ZI_ROOT');
      expect(text).toContain('ZI_CHILD_ONE');
      expect(text).toContain('ZSD_ROOT');
      expect(text).toContain(
        'Suggested re-activation order: DDLS ZI_ROOT, DDLS ZI_CHILD_ONE, BDEF ZI_ROOT, SRVD ZSD_ROOT',
      );
      expect(text).toContain(
        'Batch call template: SAPActivate(objects=[{type:"DDLS",name:"ZI_ROOT"}, {type:"DDLS",name:"ZI_CHILD_ONE"}, {type:"BDEF",name:"ZI_ROOT"}, {type:"SRVD",name:"ZSD_ROOT"}])',
      );
    });

    it('shows warnings on successful activation', async () => {
      const xml = `<messages>
        <msg type="W" severity="warning" shortText="Consider using CDS view entity"/>
      </messages>`;
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully activated');
      expect(result.content[0]?.text).toContain('Warnings:');
      expect(result.content[0]?.text).toContain('Consider using CDS view entity');
    });
  });
});

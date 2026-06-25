/**
 * SAPWrite class-surgery / RAP unit tests — split from the former intent.test.ts monolith.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { stripFmParamCommentBlock } = await import('../../../src/handlers/write-helpers.js');

describe('SAPWrite handler — class surgery / RAP', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

  describe('SAPWrite edit_method', () => {
    it('rejects edit_method without method param', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'rv = 1.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('method');
    });

    it('rejects edit_method without source param', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZCL_TEST',
        method: 'get_name',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('source');
    });

    it('rejects edit_method for non-CLAS type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'PROG',
        name: 'ZTEST',
        method: 'get_name',
        source: 'rv = 1.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('CLAS');
    });

    // ── PR-D: local handler classes (CCDEF/CCIMP) ─────────────────────

    /**
     * Build a mock that satisfies the edit_method flow against a CCIMP
     * include: GET class metadata (for package check), GET include source,
     * POST lock, PUT new source, POST unlock. Returns the captured call
     * trace so tests can assert URL routing.
     */
    function mockEditMethodIncludeFlow(opts: {
      className: string;
      includeName: string;
      includeSource: string;
      /**
       * When set, simulates an inactive draft: GET `?version=inactive` returns
       * this body; GET `?version=active` (or no version) returns
       * `opts.includeSource` (the active baseline). The inactive-list endpoint
       * also reports a draft for the class so `resolveVersionAndDraftInfo`
       * picks the inactive branch.
       */
      inactiveIncludeSource?: string;
      packageName?: string;
    }): Array<{ method: string; url: string; body?: string }> {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation(
        (url: string | URL, fetchOpts?: { method?: string; body?: string | Buffer | null }) => {
          const method = fetchOpts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({ method, url: urlStr, body: typeof fetchOpts?.body === 'string' ? fetchOpts.body : undefined });
          // Inactive-object list (used by resolveVersionAndDraftInfo to decide
          // whether the class has any unactivated draft). Format matches
          // tests/fixtures/xml/inactive-objects.xml — parseInactiveObjects
          // expects <adtcore:objectReference> nested inside <ioc:object>.
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/activation/inactiveobjects')) {
            const hasDraft = opts.inactiveIncludeSource !== undefined;
            const body = hasDraft
              ? `<?xml version="1.0" encoding="utf-8"?>
<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects" xmlns:adtcore="http://www.sap.com/adt/core">
  <ioc:entry>
    <ioc:object>
      <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/${opts.className.toLowerCase()}" adtcore:type="CLAS/OC" adtcore:name="${opts.className}" adtcore:description="(inactive draft)"/>
    </ioc:object>
  </ioc:entry>
</ioc:inactiveObjects>`
              : '<?xml version="1.0" encoding="utf-8"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>';
            return Promise.resolve(mockResponse(200, body, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.endsWith(`/sap/bc/adt/oo/classes/${opts.className}`)) {
            const pkg = opts.packageName ?? '$TMP';
            return Promise.resolve(
              mockResponse(
                200,
                `<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${pkg}"/></class:abapClass>`,
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          if (
            method === 'GET' &&
            urlStr.includes(`/sap/bc/adt/oo/classes/${opts.className}/includes/${opts.includeName}`)
          ) {
            // Version-aware: when an inactiveIncludeSource is provided, return
            // it for ?version=inactive and the regular source for active.
            const wantsInactive = urlStr.includes('version=inactive');
            const body =
              wantsInactive && opts.inactiveIncludeSource !== undefined
                ? opts.inactiveIncludeSource
                : opts.includeSource;
            // The ADT server returns raw source; client.getClass wraps it with
            // "=== <include> ===\n" header. The mock simulates the server, so
            // we return raw source — the client adds the header.
            return Promise.resolve(mockResponse(200, body, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes(`/sap/bc/adt/oo/classes/${opts.className}/source/main`)) {
            return Promise.resolve(
              mockResponse(
                200,
                `CLASS ${opts.className} DEFINITION PUBLIC. ENDCLASS. CLASS ${opts.className} IMPLEMENTATION. ENDCLASS.`,
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          if (method === 'POST' && urlStr.includes('_action=UNLOCK')) {
            return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
          }
          if (method === 'PUT') {
            // Tests assert which URL receives the PUT — accept any here.
            return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
          }
          // Reject anything else loudly. A routing regression (e.g. an extra
          // GET to /source/main when we wanted /includes/implementations) must
          // surface as a test failure, not silently pass on the catch-all.
          return Promise.resolve(
            mockResponse(
              404,
              `<exc:exception><type id="ResourceNotFound"/><message>Unexpected URL in mock: ${method} ${urlStr}</message></exc:exception>`,
              { 'x-csrf-token': 'T' },
            ),
          );
        },
      );
      return calls;
    }

    const CCIMP_LHC_BODY = `CLASS lhc_project IMPLEMENTATION.
  METHOD approve_project.
    " original body
    DATA(x) = 1.
  ENDMETHOD.
  METHOD get_instance_authorizations.
    result = VALUE #( ).
  ENDMETHOD.
ENDCLASS.`;

    it('auto-routes lhc_project~approve_project to /includes/implementations', async () => {
      const calls = mockEditMethodIncludeFlow({
        className: 'ZBP_DM_PROJECT',
        includeName: 'implementations',
        includeSource: CCIMP_LHC_BODY,
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZBP_DM_PROJECT',
        method: 'lhc_project~approve_project',
        source: '    " new body\n    DATA(y) = 99.',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully updated method "lhc_project~approve_project"');
      expect(result.content[0]?.text).toContain('include: implementations');

      const getCalls = calls.filter(
        (c) => c.method === 'GET' && c.url.includes('/sap/bc/adt/oo/classes/ZBP_DM_PROJECT'),
      );
      // Must read the include, NOT /source/main
      expect(getCalls.some((c) => c.url.includes('/includes/implementations'))).toBe(true);
      expect(getCalls.some((c) => c.url.includes('/source/main'))).toBe(false);

      const putCalls = calls.filter((c) => c.method === 'PUT');
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.url).toContain('/sap/bc/adt/oo/classes/ZBP_DM_PROJECT/includes/implementations');
      expect(putCalls[0]?.url).toContain('lockHandle=LH1');
      expect(putCalls[0]?.body).toContain('DATA(y) = 99.');
      expect(putCalls[0]?.body).not.toContain('DATA(x) = 1.');
      // The "=== implementations ===" header from the GET must not leak into the PUT body
      expect(putCalls[0]?.body).not.toContain('=== implementations ===');
    });

    it('explicit include="implementations" routes regardless of method name', async () => {
      const calls = mockEditMethodIncludeFlow({
        className: 'ZBP_X',
        includeName: 'implementations',
        includeSource: `CLASS lhc_x IMPLEMENTATION.
  METHOD foo.
    WRITE 'old'.
  ENDMETHOD.
ENDCLASS.`,
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZBP_X',
        method: 'foo',
        include: 'implementations',
        source: "    WRITE 'new'.",
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('include: implementations');

      const putCalls = calls.filter((c) => c.method === 'PUT');
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.url).toContain('/includes/implementations');
      expect(putCalls[0]?.url).not.toContain('/source/main');
    });

    it('explicit include="testclasses" overrides auto-detected lhc_* prefix', async () => {
      const calls = mockEditMethodIncludeFlow({
        className: 'ZBP_DM_PROJECT',
        includeName: 'testclasses',
        includeSource: `CLASS lhc_project IMPLEMENTATION.
  METHOD foo.
    " test class body
  ENDMETHOD.
ENDCLASS.`,
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZBP_DM_PROJECT',
        method: 'lhc_project~foo', // would auto-detect implementations
        include: 'testclasses', // …but explicit wins
        source: '    " new test body',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('include: testclasses');

      const putCalls = calls.filter((c) => c.method === 'PUT');
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.url).toContain('/includes/testclasses');
      expect(putCalls[0]?.url).not.toContain('/includes/implementations');
    });

    it('global-interface methods (zif_X~create) keep using /source/main', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      const mainSource = `CLASS zcl_impl DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_order.
ENDCLASS.
CLASS zcl_impl IMPLEMENTATION.
  METHOD zif_order~create.
    rv = 'old'.
  ENDMETHOD.
ENDCLASS.`;
      mockFetch.mockImplementation(
        (url: string | URL, fetchOpts?: { method?: string; body?: string | Buffer | null }) => {
          const method = fetchOpts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({ method, url: urlStr, body: typeof fetchOpts?.body === 'string' ? fetchOpts.body : undefined });
          if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZCL_IMPL')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></class:abapClass>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZCL_IMPL/source/main')) {
            return Promise.resolve(mockResponse(200, mainSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZCL_IMPL',
        method: 'zif_order~create',
        source: "    rv = 'new'.",
        lintBeforeWrite: false,
      });

      expect(result.isError).toBeUndefined();
      // Should NOT mention "include:" — it went through MAIN
      expect(result.content[0]?.text).not.toContain('include:');

      const putCalls = calls.filter((c) => c.method === 'PUT');
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.url).toContain('/sap/bc/adt/oo/classes/ZCL_IMPL/source/main');
      expect(putCalls[0]?.url).not.toContain('/includes/');
    });

    it('rejects garbage include value with the same message as case=update', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZCL_TEST',
        method: 'foo',
        include: 'garbage',
        source: 'rv = 1.',
      });

      expect(result.isError).toBe(true);
      // Schema rejects unknown enum BEFORE the handler-level guard, so the
      // user sees the schema's enum error here.
      expect(result.content[0]?.text.toLowerCase()).toMatch(/invalid|enum|garbage/);
    });

    it('reports which include was searched when method is not found', async () => {
      mockEditMethodIncludeFlow({
        className: 'ZBP_DM_PROJECT',
        includeName: 'implementations',
        includeSource: `CLASS lhc_project IMPLEMENTATION.
  METHOD approve_project. WRITE 'x'. ENDMETHOD.
ENDCLASS.`,
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZBP_DM_PROJECT',
        method: 'lhc_typo~approve_project',
        source: '    " body',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('not found');
      expect(text).toContain('implementations');
      // Auto-routed hint should be present for callers who used the lhc_ prefix
      expect(text).toContain('auto-routed');
    });

    it('reads inactive CCIMP when an inactive draft exists (PR-D review fix)', async () => {
      // Reproduces the RUN-NOTES Run 3 scenario: after `update include=` or
      // `scaffold_rap_handlers`, the real handler body lives in the inactive
      // CCIMP draft, while the active CCIMP is still the empty placeholder
      // shipped with class creation. Without `version=inactive`, edit_method
      // would read the active placeholder and report "method not found".
      const calls = mockEditMethodIncludeFlow({
        className: 'ZBP_DM_PROJECT',
        includeName: 'implementations',
        // Active = empty placeholder comment SAP ships with new classes
        includeSource:
          '*"* use this source file for the definition and implementation of\n' +
          '*"* local helper classes, interface definitions and type\n' +
          '*"* declarations\n',
        // Inactive = the real handler body the user just wrote
        inactiveIncludeSource: `CLASS lhc_project IMPLEMENTATION.
  METHOD approve_project.
    " original body
    DATA(x) = 1.
  ENDMETHOD.
ENDCLASS.`,
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZBP_DM_PROJECT',
        method: 'lhc_project~approve_project',
        source: '    DATA(y) = 99.',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('include: implementations');

      // Must have asked for ?version=inactive
      const inactiveGets = calls.filter(
        (c) => c.method === 'GET' && c.url.includes('/includes/implementations') && c.url.includes('version=inactive'),
      );
      expect(inactiveGets.length).toBe(1);

      const putCalls = calls.filter((c) => c.method === 'PUT');
      expect(putCalls).toHaveLength(1);
      // PUT body must contain the new body spliced onto the INACTIVE draft,
      // not the empty active placeholder.
      expect(putCalls[0]?.body).toContain('DATA(y) = 99.');
      expect(putCalls[0]?.body).toContain('CLASS lhc_project IMPLEMENTATION');
      expect(putCalls[0]?.body).not.toContain('use this source file for the definition');
    });

    it('include reads bypass the source cache (no MAIN/CCIMP collision)', async () => {
      // The cache key is (type, name, active|inactive) and does NOT include the
      // include name. Reusing it would silently mix MAIN bytes with CCIMP bytes
      // on subsequent reads. Prove the include path makes a fresh GET each time.
      const calls = mockEditMethodIncludeFlow({
        className: 'ZBP_DM_PROJECT',
        includeName: 'implementations',
        includeSource: CCIMP_LHC_BODY,
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZBP_DM_PROJECT',
        method: 'lhc_project~approve_project',
        source: '    DATA(z) = 1.',
      });

      expect(result.isError).toBeUndefined();
      const includeGets = calls.filter((c) => c.method === 'GET' && c.url.includes('/includes/implementations'));
      // One GET reads the include for method splicing; the second is the locked
      // existence probe in safeUpdateClassInclude. Neither comes from the cache.
      expect(includeGets.length).toBe(2);
    });
  });

  describe('SAPWrite scaffold_rap_handlers', () => {
    const bdefSource = `managed implementation in class ZBP_I_TRAVELREQ unique;
define behavior for ZI_TRAVELREQ alias Travel
authorization master ( instance )
{
  action SubmitForApproval result [1] $self;
  action RecalculateTotalCost result [1] $self;
}`;

    const classMetadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass
  xmlns:class="http://www.sap.com/adt/classlib"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="ZBP_I_TRAVELREQ"
  adtcore:type="CLAS/OC"
  adtcore:description="Behavior pool"
  class:abapLanguageVersion="standard"/>`;

    const classMetadataForbiddenPackageXml = `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass
  xmlns:class="http://www.sap.com/adt/classlib"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="/DMO/BP_TRAVEL_M"
  adtcore:type="CLAS/OC"
  adtcore:description="Behavior pool"
  class:abapLanguageVersion="standard">
  <adtcore:packageRef adtcore:name="/DMO/FLIGHT_MANAGED"/>
</class:abapClass>`;

    const classMainSource = `CLASS zbp_i_travelreq DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zi_travelreq.
ENDCLASS.

CLASS zbp_i_travelreq IMPLEMENTATION.
ENDCLASS.`;

    const classDefinitionsSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY
      IMPORTING keys FOR ACTION Travel~SubmitForApproval RESULT result.
ENDCLASS.
`;

    it('returns missing handler signatures without applying changes', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
          return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
          return Promise.resolve(mockResponse(200, classDefinitionsSource, { 'x-csrf-token': 'T' }));
        }
        if (
          method === 'GET' &&
          (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
        ) {
          return Promise.reject(new AdtApiError('Not found', 404, urlStr));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.applied).toBe(false);
      expect(parsed.missingCount).toBeGreaterThan(0);
      expect(
        parsed.missing.some(
          (req: { methodName: string }) =>
            req.methodName === 'recalculatetotalcost' || req.methodName === 'get_instance_authorizations',
        ),
      ).toBe(true);
    });

    it('dry-run does not enforce write package allowlist for existing behavior pools', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });

        if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M')) {
          return Promise.resolve(mockResponse(200, classMetadataForbiddenPackageXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M/source/main')) {
          return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M/includes/definitions')) {
          return Promise.resolve(mockResponse(200, classDefinitionsSource, { 'x-csrf-token': 'T' }));
        }
        if (
          method === 'GET' &&
          (urlStr.includes('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M/includes/testclasses') ||
            urlStr.includes('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M/includes/implementations') ||
            urlStr.includes('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M/includes/macros'))
        ) {
          return Promise.reject(new AdtApiError('Not found', 404, urlStr));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/%2FDMO%2FI_TRAVEL_M/source/main')) {
          return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const resolvePackageSpy = vi.spyOn(restrictedClient, 'resolveObjectPackage');

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: '/DMO/BP_TRAVEL_M',
        bdefName: '/DMO/I_TRAVEL_M',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.applied).toBe(false);
      expect(parsed.requiredCount).toBeGreaterThan(0);
      expect(result.content[0]?.text).not.toContain('blocked by safety');
      expect(calls.some((call) => call.method === 'PUT' || call.url.includes('_action=LOCK'))).toBe(false);
      expect(resolvePackageSpy).not.toHaveBeenCalled();
    });

    it('dry-run does not report semantic FOR ACTION implementations as missing stubs', async () => {
      const semanticBdefSource = `managed implementation in class ZBP_I_TRAVELREQ unique;
define behavior for ZI_TRAVELREQ alias Travel
{
  action acceptTravel result [1] $self;
}`;
      const semanticDefinitionsSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS set_status_accepted FOR MODIFY
      IMPORTING keys FOR ACTION Travel~acceptTravel RESULT result.
ENDCLASS.`;
      const semanticImplementationsSource = `CLASS lhc_travel IMPLEMENTATION.
  METHOD set_status_accepted.
  ENDMETHOD.
ENDCLASS.`;

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
          return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
          return Promise.resolve(mockResponse(200, semanticDefinitionsSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations')) {
          return Promise.resolve(mockResponse(200, semanticImplementationsSource, { 'x-csrf-token': 'T' }));
        }
        if (
          method === 'GET' &&
          (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
        ) {
          return Promise.reject(new AdtApiError('Not found', 404, urlStr));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, semanticBdefSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.missingCount).toBe(0);
      expect(parsed.missingImplementationStubCount).toBe(0);
    });

    it('autoApply still enforces write package allowlist for existing behavior pools', async () => {
      mockFetch.mockReset();
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const resolvePackageSpy = vi
        .spyOn(restrictedClient, 'resolveObjectPackage')
        .mockResolvedValue('/DMO/FLIGHT_MANAGED');

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: '/DMO/BP_TRAVEL_M',
        bdefName: '/DMO/I_TRAVEL_M',
        autoApply: true,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('/DMO/FLIGHT_MANAGED');
      expect(result.content[0]?.text).toContain('blocked');
      expect(resolvePackageSpy).toHaveBeenCalledOnce();
    });

    it('returns available aliases when targetAlias does not match BDEF requirements', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
          return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
          return Promise.resolve(mockResponse(200, classDefinitionsSource, { 'x-csrf-token': 'T' }));
        }
        if (
          method === 'GET' &&
          (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
        ) {
          return Promise.reject(new AdtApiError('Not found', 404, urlStr));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
        targetAlias: 'DoesNotExist',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('No RAP handler requirements were found');
      expect(result.content[0]?.text).toContain('Available aliases in ZI_TRAVELREQ: Travel');
    });

    it('autoApply creates missing handler skeletons and scaffolds methods', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string | Buffer | null }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr, body: typeof opts?.body === 'string' ? opts.body : undefined });

        if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
          return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
        }
        if (
          method === 'GET' &&
          (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
        ) {
          return Promise.reject(new AdtApiError('Not found', 404, urlStr));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
        autoApply: true,
        lintBeforeWrite: false,
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Auto-created 2 handler skeleton section(s)');
      const parsed = JSON.parse(text.slice(text.indexOf('{')));
      expect(parsed.applied).toBe(true);
      expect(parsed.hint).toBeUndefined();
      expect(parsed.applyResult.skeletons.createdDefinitions).toEqual(['lhc_travel']);
      expect(parsed.applyResult.skeletons.createdImplementations).toEqual(['lhc_travel']);
      expect(parsed.applyResult.unresolved).toEqual([]);
      // Per ABAP doc ABENABP_HANDLER_CLASS_GLOSRY and SAP demo BP_DEMO_RAP_STRICT, both the
      // DEFINITION and IMPLEMENTATION blocks belong in CCIMP. CCDEF must stay at the SAP
      // placeholder, so the scaffold pipeline must NOT PUT to /includes/definitions.
      const definitionPut = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions'),
      );
      const implementationPut = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations'),
      );
      expect(definitionPut).toBeUndefined();
      expect(implementationPut?.body).toContain(
        'CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.',
      );
      expect(implementationPut?.body).toContain('METHODS submitforapproval FOR MODIFY');
      expect(implementationPut?.body).toContain('CLASS lhc_travel IMPLEMENTATION.');
      expect(implementationPut?.body).toContain('METHOD submitforapproval.');
    });

    it('autoApply injects signatures and writes class source', async () => {
      const classImplementationsSource = `CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;

      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
        ) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({
            method,
            url: urlStr,
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });
          if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
            return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
            return Promise.resolve(mockResponse(200, classDefinitionsSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations')) {
            return Promise.resolve(mockResponse(200, classImplementationsSource, { 'x-csrf-token': 'T' }));
          }
          if (
            method === 'GET' &&
            (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
              urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
          ) {
            return Promise.reject(new AdtApiError('Not found', 404, urlStr));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
        autoApply: true,
        lintBeforeWrite: false,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Scaffolded');
      const putCall = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions'),
      );
      expect(putCall).toBeDefined();
      expect(putCall?.body).toContain('METHODS recalculatetotalcost FOR MODIFY');
      expect(putCall?.body).toContain('METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION');
      const implPutCall = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations'),
      );
      expect(implPutCall).toBeDefined();
      expect(implPutCall?.body).toContain('METHOD recalculatetotalcost.');
      expect(implPutCall?.body).toContain('METHOD get_instance_authorizations.');
    });

    it('autoApply falls back to implementations include when handler class is declared there', async () => {
      const classDefinitionsNoHandlers = `*"* definitions placeholder`;
      const classImplementationsWithHandlers = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY
      IMPORTING keys FOR ACTION Travel~SubmitForApproval RESULT result.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;

      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
        ) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({
            method,
            url: urlStr,
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });

          if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
            return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
            return Promise.resolve(mockResponse(200, classDefinitionsNoHandlers, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations')) {
            return Promise.resolve(mockResponse(200, classImplementationsWithHandlers, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros')) {
            return Promise.reject(new AdtApiError('Not found', 404, urlStr));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses')) {
            return Promise.reject(new AdtApiError('Not found', 404, urlStr));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }

          return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
        autoApply: true,
        lintBeforeWrite: false,
      });

      expect(result.isError).toBeUndefined();
      const putCall = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations'),
      );
      expect(putCall).toBeDefined();
      expect(putCall?.body).toContain('METHODS recalculatetotalcost FOR MODIFY');
      expect(putCall?.body).toContain('METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION');
      expect(putCall?.body).toContain('METHOD recalculatetotalcost.');
      expect(putCall?.body).toContain('METHOD get_instance_authorizations.');
    });

    it('autoApply adds implementation stubs even when declarations already exist', async () => {
      const classDefinitionsAllHandlers = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY
      IMPORTING keys FOR ACTION Travel~SubmitForApproval RESULT result.
    METHODS recalculatetotalcost FOR MODIFY
      IMPORTING keys FOR ACTION Travel~RecalculateTotalCost RESULT result.
    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Travel RESULT result.
ENDCLASS.`;
      const classImplementationsEmpty = `CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;

      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
        ) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({ method, url: urlStr, body: typeof opts?.body === 'string' ? opts.body : undefined });

          if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
            return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
            return Promise.resolve(mockResponse(200, classDefinitionsAllHandlers, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations')) {
            return Promise.resolve(mockResponse(200, classImplementationsEmpty, { 'x-csrf-token': 'T' }));
          }
          if (
            method === 'GET' &&
            (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
              urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
          ) {
            return Promise.reject(new AdtApiError('Not found', 404, urlStr));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
        autoApply: true,
        lintBeforeWrite: false,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('0 RAP handler signature(s) and 3 implementation stub(s)');
      const definitionPutCall = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions'),
      );
      expect(definitionPutCall).toBeUndefined();
      const implPutCall = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations'),
      );
      expect(implPutCall).toBeDefined();
      expect(implPutCall?.body).toContain('METHOD submitforapproval.');
      expect(implPutCall?.body).toContain('METHOD recalculatetotalcost.');
      expect(implPutCall?.body).toContain('METHOD get_instance_authorizations.');
    });

    it('returns validation error when bdefName is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('bdefName');
    });
  });

  describe('SAPWrite generate_behavior_implementation (PR-C)', () => {
    it('rejects type != CLAS with a clear error message', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'generate_behavior_implementation',
        type: 'PROG',
        name: 'ZHELLO',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('only supported for type=CLAS');
    });

    it('rejects when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'generate_behavior_implementation',
        type: 'CLAS',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('name');
    });

    it('Zod schema accepts the new action + boolean fields and forwards them to the orchestrator', async () => {
      // A regular (non-behavior-pool) class metadata XML lets the orchestrator
      // run through Zod validation and the handler dispatch and then surface a
      // domain-level discovery error. Reaching that error proves the schema
      // accepted the new action and its boolean fields.
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/sap/bc/adt/oo/classes/ZCL_REGULAR')) {
          return Promise.resolve(
            mockResponse(
              200,
              `<?xml version="1.0"?>
<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="ZCL_REGULAR" adtcore:description="Plain class" adtcore:language="EN"
  class:fixPointArithmetic="true">
  <adtcore:packageRef adtcore:name="$TMP"/>
</class:abapClass>`,
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'generate_behavior_implementation',
        type: 'CLAS',
        name: 'ZCL_REGULAR',
        activate: false,
        dryRun: true,
      });
      expect(result.isError).toBe(true);
      // The class isn't a behavior pool → the orchestrator throws a precise
      // domain error rather than a generic Zod schema rejection. Either error
      // path proves the action+args reached the handler.
      expect(result.content[0]?.text).toMatch(/not a RAP behavior pool|cannot auto-discover BDEF/);
    });

    it('appears in the SAPWrite unknown-action hint', async () => {
      // Indirect: when an unrelated request is misrouted through SAPWrite with
      // an invalid action, the error message must list every valid action so
      // LLMs can self-correct. generate_behavior_implementation is now valid.
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'invented_action_xyz',
        type: 'CLAS',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBe(true);
      // Zod validation rejects before reaching the unknown-action branch in
      // the handler — assert on the Zod-formatted enum description instead.
      expect(result.content[0]?.text.toLowerCase()).toContain('generate_behavior_implementation');
    });

    // P1 result-code mapping (Codex review on PR #260) is covered by direct
    // unit tests of the exported `isRapGenerateResultSuccess` helper — see
    // tests/unit/adt/rap-generate.test.ts. The handler simply delegates to it;
    // putting the truth table next to the helper keeps the contract local.
  });

  describe('stripFmParamCommentBlock', () => {
    it('returns empty input unchanged', () => {
      const result = stripFmParamCommentBlock('');
      expect(result.source).toBe('');
      expect(result.wasStripped).toBe(false);
    });

    it('returns clean source unchanged', () => {
      const src = "FUNCTION z_foo.\n  WRITE / 'ok'.\nENDFUNCTION.\n";
      const result = stripFmParamCommentBlock(src);
      expect(result.source).toBe(src);
      expect(result.wasStripped).toBe(false);
    });

    it('strips a full SAPGUI parameter comment block and reports wasStripped=true', () => {
      const src = [
        'FUNCTION z_foo.',
        '*"----------------------------------------------------------------------',
        '*"*"Local Interface:',
        '*"  IMPORTING',
        `*"     VALUE(IV_NAME) TYPE STRING DEFAULT 'World'`,
        '*"  EXPORTING',
        '*"     VALUE(EV_GREETING) TYPE STRING',
        '*"----------------------------------------------------------------------',
        '  ev_greeting = |Hello|.',
        'ENDFUNCTION.',
        '',
      ].join('\n');
      const result = stripFmParamCommentBlock(src);
      expect(result.wasStripped).toBe(true);
      expect(result.source).not.toContain('*"');
      expect(result.source).toContain('FUNCTION z_foo.');
      expect(result.source).toContain('ev_greeting = |Hello|.');
      expect(result.source).toContain('ENDFUNCTION.');
    });

    it('preserves single-asterisk ABAP comments', () => {
      const src = 'FUNCTION z_foo.\n* This is a real comment\n  WRITE / 1.\nENDFUNCTION.\n';
      const result = stripFmParamCommentBlock(src);
      expect(result.wasStripped).toBe(false);
      expect(result.source).toContain('* This is a real comment');
    });

    it(`preserves inline " comments`, () => {
      const src = `FUNCTION z_foo.\n  WRITE / 'foo'. " inline comment\nENDFUNCTION.\n`;
      const result = stripFmParamCommentBlock(src);
      expect(result.wasStripped).toBe(false);
      expect(result.source).toContain('" inline comment');
    });

    it('strips lines with leading whitespace before *"', () => {
      const src = 'FUNCTION z_foo.\n  *"  IMPORTING IV_X TYPE STRING\nENDFUNCTION.\n';
      const result = stripFmParamCommentBlock(src);
      expect(result.wasStripped).toBe(true);
      expect(result.source).not.toContain('*"');
    });
  });

  describe('SAPWrite class-section surgery (issue #303)', () => {
    /**
     * Build a mock for class-section surgery flow:
     *   GET /sap/bc/adt/oo/classes/{className} (package check)
     *   GET /sap/bc/adt/oo/classes/{className}/objectstructure
     *   GET /sap/bc/adt/activation/inactiveobjects (draft list)
     *   GET /sap/bc/adt/oo/classes/{className}/source/main (active or inactive)
     *   POST _action=LOCK
     *   PUT /source/main
     *   POST _action=UNLOCK
     */
    function mockClassSurgeryFlow(opts: {
      className: string;
      mainSource: string;
      structureXml: string;
      packageName?: string;
      includeName?: string;
      includeGetStatus?: 200 | 404;
      includeSource?: string;
    }): Array<{ method: string; url: string; body?: string }> {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation(
        (url: string | URL, fetchOpts?: { method?: string; body?: string | Buffer | null }) => {
          const method = fetchOpts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({ method, url: urlStr, body: typeof fetchOpts?.body === 'string' ? fetchOpts.body : undefined });
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/activation/inactiveobjects')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<?xml version="1.0" encoding="utf-8"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          if (method === 'GET' && urlStr.endsWith(`/sap/bc/adt/oo/classes/${opts.className}`)) {
            const pkg = opts.packageName ?? '$TMP';
            return Promise.resolve(
              mockResponse(
                200,
                `<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${pkg}"/></class:abapClass>`,
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          if (method === 'GET' && urlStr.includes(`/sap/bc/adt/oo/classes/${opts.className}/objectstructure`)) {
            return Promise.resolve(mockResponse(200, opts.structureXml, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes(`/sap/bc/adt/oo/classes/${opts.className}/source/main`)) {
            return Promise.resolve(mockResponse(200, opts.mainSource, { 'x-csrf-token': 'T' }));
          }
          if (
            opts.includeName &&
            method === 'GET' &&
            urlStr.includes(`/sap/bc/adt/oo/classes/${opts.className}/includes/${opts.includeName}`)
          ) {
            if (opts.includeGetStatus === 404) {
              return Promise.resolve(
                mockResponse(
                  404,
                  `<exc:exception xmlns:exc="x"><type id="ExceptionResourceNotFound"/><message>not found</message></exc:exception>`,
                  { 'x-csrf-token': 'T' },
                ),
              );
            }
            return Promise.resolve(mockResponse(200, opts.includeSource ?? '', { 'x-csrf-token': 'T' }));
          }
          if ((method === 'GET' || method === 'HEAD') && urlStr.includes('/discovery')) {
            return Promise.resolve(
              mockResponse(200, '<service xmlns="http://www.w3.org/2007/app"/>', { 'x-csrf-token': 'T' }),
            );
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          if (method === 'POST' && urlStr.includes('_action=UNLOCK')) {
            return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
          }
          if (opts.includeName && method === 'POST' && urlStr.includes(`/includes/${opts.includeName}?lockHandle=`)) {
            return Promise.resolve(mockResponse(201, '', { 'x-csrf-token': 'T' }));
          }
          if (method === 'PUT') {
            return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(
            mockResponse(
              404,
              `<exc:exception xmlns:exc="x"><type id="ExceptionResourceNotFound"/><message>not found</message></exc:exception>`,
            ),
          );
        },
      );
      return calls;
    }

    // Probe class source: 2 public methods (HELLO, GOODBYE), 1 private DATA member.
    const PROBE_MAIN = `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.

CLASS zcl_probe IMPLEMENTATION.

  METHOD hello.
    result = |Hello, { name }!|.
  ENDMETHOD.

  METHOD goodbye.
    result = 'Goodbye!'.
  ENDMETHOD.

ENDCLASS.
`;

    // Matches PROBE_MAIN line ranges (1-indexed, end-inclusive). Class def 1-10,
    // impl 12-22. HELLO def 3-5, impl 14-16. GOODBYE def 6-7, impl 18-20.
    const PROBE_STRUCTURE = `<abapsource:objectStructureElement xmlns:adtcore="http://www.sap.com/adt/core" xmlns:abapsource="http://www.sap.com/adt/abapsource" xmlns:atom="http://www.w3.org/2005/Atom" adtcore:name="ZCL_PROBE" visibility="public" final="true" adtcore:type="CLAS/OC">
  <atom:link rel="http://www.sap.com/adt/relations/source/definitionBlock" href="./../zcl_probe/source/main#start=1,0;end=10,8"/>
  <atom:link rel="http://www.sap.com/adt/relations/source/implementationBlock" href="./../zcl_probe/source/main#start=12,0;end=22,8"/>
  <abapsource:objectStructureElement adtcore:type="CLAS/OM" adtcore:name="HELLO" level="instance" visibility="public">
    <atom:link rel="http://www.sap.com/adt/relations/source/definitionBlock" href="./../zcl_probe/source/main#start=3,4;end=5,41"/>
    <atom:link rel="http://www.sap.com/adt/relations/source/implementationBlock" href="./../zcl_probe/source/main#start=14,2;end=16,11"/>
  </abapsource:objectStructureElement>
  <abapsource:objectStructureElement adtcore:type="CLAS/OM" adtcore:name="GOODBYE" level="instance" visibility="public">
    <atom:link rel="http://www.sap.com/adt/relations/source/definitionBlock" href="./../zcl_probe/source/main#start=6,4;end=7,41"/>
    <atom:link rel="http://www.sap.com/adt/relations/source/implementationBlock" href="./../zcl_probe/source/main#start=18,2;end=20,11"/>
  </abapsource:objectStructureElement>
</abapsource:objectStructureElement>`;

    // ── edit_class_definition ────────────────────────────────────────

    it('edit_class_definition happy path: no method-set change (drop FINAL)', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      const newDef = `CLASS zcl_probe DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        source: newDef,
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toMatch(/Successfully updated DEFINITION/);
      // PUT must have happened.
      expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/source/main'))).toBe(true);
    });

    it('edit_class_definition include=testclasses auto-initialises a missing CCAU before PUT', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
        includeName: 'testclasses',
        includeGetStatus: 404,
      });
      const source = `CLASS ltc_probe DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS smoke FOR TESTING.
ENDCLASS.
CLASS ltc_probe IMPLEMENTATION.
  METHOD smoke.
    cl_abap_unit_assert=>assert_equals( act = 1 exp = 1 ).
  ENDMETHOD.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        include: 'testclasses',
        source,
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toMatch(/Initialised the testclasses include first/i);

      const initIndex = calls.findIndex(
        (c) => c.method === 'POST' && c.url.includes('/includes/testclasses?lockHandle='),
      );
      const putIndex = calls.findIndex((c) => c.method === 'PUT' && c.url.includes('/includes/testclasses'));
      expect(initIndex).toBeGreaterThan(-1);
      expect(putIndex).toBeGreaterThan(initIndex);
      expect(calls[putIndex]?.body).toBe(`${source}\n`);
      expect(calls.some((c) => c.url.includes('/objectstructure'))).toBe(false);
    });

    it('edit_class_definition include=definitions skips init when the include already exists', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
        includeName: 'definitions',
        includeGetStatus: 200,
        includeSource: 'CLASS lcl_existing DEFINITION. ENDCLASS.',
      });
      const source = 'CLASS lcl_new DEFINITION. ENDCLASS.';
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        include: 'definitions',
        source,
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).not.toMatch(/Initialised the/i);
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/includes/definitions?lockHandle='))).toBe(false);
      const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/includes/definitions'));
      expect(put?.body).toBe(`${source}\n`);
    });

    it('edit_class_definition refuse-policy: added concrete method without IMPL stub', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      const newDef = `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello.
    METHODS goodbye.
    METHODS greet IMPORTING who TYPE string.
  PRIVATE SECTION.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        source: newDef,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/GREET/);
      expect(result.content[0]?.text).toMatch(/add_method|METHOD…ENDMETHOD/);
      // No PUT should have happened.
      expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('edit_class_definition refuse-policy: ABSTRACT method is exempt from symmetry check', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      const newDef = `CLASS zcl_probe DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
    METHODS to_impl ABSTRACT RETURNING VALUE(r) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        source: newDef,
      });
      expect(result.isError).toBeUndefined();
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });

    it('edit_class_definition refuse-policy: orphan IMPLEMENTATION block on removal', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      // New DEFINITION removes GOODBYE but the existing IMPL still has the body.
      const newDef = `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        source: newDef,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/GOODBYE/);
      expect(result.content[0]?.text).toMatch(/orphan implementation|delete_method/);
      expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('edit_class_definition rejects non-CLAS type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'PROG',
        name: 'ZTEST',
        source: 'REPORT zhello.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('CLAS');
    });

    it('edit_class_definition rejects missing source', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'CLAS',
        name: 'ZCL_PROBE',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/source.*required|required.*source/i);
    });

    // ── edit_method_signature ────────────────────────────────────────

    it('edit_method_signature happy path replaces one method declaration range', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      const newSig = `    METHODS hello
      IMPORTING name TYPE string
                greeting TYPE string DEFAULT 'Hi'
      RETURNING VALUE(result) TYPE string.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method_signature',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'hello',
        source: newSig,
      });
      expect(result.isError).toBeUndefined();
      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall?.body ?? '').toContain("greeting TYPE string DEFAULT 'Hi'");
    });

    it('edit_method_signature returns helpful error for unknown method', async () => {
      mockClassSurgeryFlow({ className: 'ZCL_PROBE', mainSource: PROBE_MAIN, structureXml: PROBE_STRUCTURE });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method_signature',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'nonexistent',
        source: '    METHODS foo.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/Available methods.*HELLO|HELLO.*GOODBYE/);
    });

    it('edit_method_signature rejects missing method', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method_signature',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        source: 'METHODS foo.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/method.*required|NAME.*required/i);
    });

    // ── add_method ───────────────────────────────────────────────────

    it('add_method happy path inserts METHODS + METHOD/ENDMETHOD stub atomically', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'add_method',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: '    METHODS greet IMPORTING who TYPE string RETURNING VALUE(r) TYPE string.',
        visibility: 'public',
      });
      expect(result.isError).toBeUndefined();
      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall?.body ?? '').toContain('METHODS greet');
      expect(putCall?.body ?? '').toContain('METHOD greet.');
      expect(putCall?.body ?? '').toContain('ENDMETHOD.');
    });

    it('add_method with abstract=true inserts no IMPL stub', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'add_method',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: '    METHODS to_impl ABSTRACT.',
        abstract: true,
      });
      expect(result.isError).toBeUndefined();
      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall?.body ?? '').toContain('METHODS to_impl ABSTRACT.');
      // No new METHOD to_impl. ENDMETHOD. stub should have been added.
      const stubCount = (putCall?.body ?? '').match(/METHOD\s+to_impl\s*\./gi)?.length ?? 0;
      expect(stubCount).toBe(0);
    });

    it('add_method refuses when target visibility section header is missing', async () => {
      mockClassSurgeryFlow({ className: 'ZCL_PROBE', mainSource: PROBE_MAIN, structureXml: PROBE_STRUCTURE });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'add_method',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: '    METHODS helper.',
        visibility: 'protected',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/PROTECTED SECTION/);
      expect(result.content[0]?.text).toMatch(/edit_class_definition/);
    });

    it('add_method refuses when method name already exists', async () => {
      mockClassSurgeryFlow({ className: 'ZCL_PROBE', mainSource: PROBE_MAIN, structureXml: PROBE_STRUCTURE });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'add_method',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: '    METHODS hello.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/HELLO/);
      expect(result.content[0]?.text).toMatch(/edit_method_signature|already exists/);
    });

    it('add_method rejects when method clause has no parseable name', async () => {
      mockClassSurgeryFlow({ className: 'ZCL_PROBE', mainSource: PROBE_MAIN, structureXml: PROBE_STRUCTURE });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'add_method',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'this is not abap',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/extract method name|METHODS/);
    });

    // ── delete_method ────────────────────────────────────────────────

    it('delete_method removes both DEFINITION and IMPLEMENTATION ranges', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete_method',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'hello',
      });
      expect(result.isError).toBeUndefined();
      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall?.body ?? '').not.toMatch(/METHODS\s+hello/i);
      expect(putCall?.body ?? '').not.toMatch(/^\s*METHOD\s+hello\s*\.\s*$/im);
      // Other method still present.
      expect(putCall?.body ?? '').toContain('METHODS goodbye');
    });

    it('delete_method returns helpful error for unknown method', async () => {
      mockClassSurgeryFlow({ className: 'ZCL_PROBE', mainSource: PROBE_MAIN, structureXml: PROBE_STRUCTURE });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete_method',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'nonexistent',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/Available methods/);
    });

    it('delete_method rejects non-CLAS type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete_method',
        type: 'PROG',
        name: 'ZTEST',
        method: 'foo',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('CLAS');
    });

    // ── Code-review regression cases ──────────────────────────────────

    it('edit_class_definition refuse-policy does NOT false-flag an AMDP method whose IMPL header has extra qualifiers', async () => {
      // PROBE_MAIN's HELLO/GOODBYE bodies are plain. We add an AMDP-style impl for a
      // method GET_DATA so the regex `^\s*METHOD\s+GET_DATA\b` must match the
      // "METHOD get_data BY DATABASE PROCEDURE..." header (not require a bare period).
      const amdpMain = PROBE_MAIN.replace(
        '  METHOD goodbye.',
        '  METHOD get_data BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT.\n  ENDMETHOD.\n\n  METHOD goodbye.',
      );
      // Structure reports HELLO + GOODBYE (GET_DATA not yet in active structure — it's
      // the method the new DEFINITION declares; its body already exists in IMPL).
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: amdpMain,
        structureXml: PROBE_STRUCTURE,
      });
      const newDef = `CLASS zcl_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
    METHODS get_data RETURNING VALUE(r) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_class_definition',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        source: newDef,
        lintBeforeWrite: false,
      });
      // The AMDP body exists → refuse-policy must NOT flag GET_DATA as missing impl.
      expect(result.isError).toBeUndefined();
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });

    it('add_method rejects an interface-qualified method name (would emit invalid ABAP)', async () => {
      mockClassSurgeryFlow({ className: 'ZCL_PROBE', mainSource: PROBE_MAIN, structureXml: PROBE_STRUCTURE });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'add_method',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'METHODS lhc_handler~run.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/interface-qualified|INTERFACES/);
    });

    it('add_method (concrete) refuses on a purely-abstract class with no IMPLEMENTATION block', async () => {
      // Structure has a class definitionBlock but NO implementationBlock.
      const abstractStruct = `<abapsource:objectStructureElement xmlns:adtcore="http://www.sap.com/adt/core" xmlns:abapsource="http://www.sap.com/adt/abapsource" xmlns:atom="http://www.w3.org/2005/Atom" adtcore:name="ZCL_ABS" visibility="public" abstract="true" adtcore:type="CLAS/OC">
  <atom:link rel="http://www.sap.com/adt/relations/source/definitionBlock" href="./../zcl_abs/source/main#start=1,0;end=4,8"/>
</abapsource:objectStructureElement>`;
      const abstractMain = `CLASS zcl_abs DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS do_it ABSTRACT.
ENDCLASS.`.replace(/\n/g, '\r\n');
      mockClassSurgeryFlow({ className: 'ZCL_ABS', mainSource: abstractMain, structureXml: abstractStruct });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'add_method',
        type: 'CLAS',
        name: 'ZCL_ABS',
        method: '    METHODS concrete RETURNING VALUE(r) TYPE string.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/no IMPLEMENTATION block|abstract=true/);
    });

    it('edit_method_signature does NOT run pre-write lint (allows in-progress param renames)', async () => {
      // Renaming an importing param leaves the body referencing the old name. If lint
      // ran on the spliced source it would block. It must not.
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method_signature',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'hello',
        // rename `name` → `who`; body still uses `name`
        source: '    METHODS hello IMPORTING who TYPE string RETURNING VALUE(result) TYPE string.',
        // deliberately DO NOT pass lintBeforeWrite:false — proving the action skips lint itself
      });
      expect(result.isError).toBeUndefined();
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });

    // ── change_method_visibility (issue #303 follow-up) ───────────────

    it('change_method_visibility moves a method public→private and preserves the body', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'change_method_visibility',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'hello',
        visibility: 'private',
      });
      expect(result.isError).toBeUndefined();
      const putCall = calls.find((c) => c.method === 'PUT');
      const body = putCall?.body ?? '';
      // METHODS hello now sits after PRIVATE SECTION.
      const privIdx = body.indexOf('PRIVATE SECTION');
      const helloDeclIdx = body.indexOf('METHODS hello');
      expect(helloDeclIdx).toBeGreaterThan(privIdx);
      // IMPLEMENTATION body preserved verbatim — this is the whole point.
      expect(body).toContain('result = |Hello, { name }!|.');
      // success message advertises body preservation.
      expect(result.content[0]?.text).toMatch(/IMPLEMENTATION preserved/i);
    });

    it('change_method_visibility leaves the IMPLEMENTATION block untouched (METHOD hello survives)', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'change_method_visibility',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'hello',
        visibility: 'private',
      });
      const body = calls.find((c) => c.method === 'PUT')?.body ?? '';
      expect(body).toMatch(/METHOD hello\./i);
      expect(body).toMatch(/ENDMETHOD\./i);
    });

    it('change_method_visibility is an idempotent no-op when already in the target section', async () => {
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      // hello is already public.
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'change_method_visibility',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'hello',
        visibility: 'public',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toMatch(/already in the PUBLIC SECTION/i);
      // No write should have happened.
      expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('change_method_visibility refuses when the target section header is missing', async () => {
      // Probe class has no PROTECTED SECTION → moving to protected refuses with hint.
      const calls = mockClassSurgeryFlow({
        className: 'ZCL_PROBE',
        mainSource: PROBE_MAIN,
        structureXml: PROBE_STRUCTURE,
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'change_method_visibility',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'hello',
        visibility: 'protected',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/PROTECTED SECTION/);
      expect(result.content[0]?.text).toMatch(/edit_class_definition/);
      expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('change_method_visibility returns helpful error for unknown method', async () => {
      mockClassSurgeryFlow({ className: 'ZCL_PROBE', mainSource: PROBE_MAIN, structureXml: PROBE_STRUCTURE });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'change_method_visibility',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'nonexistent',
        visibility: 'private',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/Available methods/);
    });

    it('change_method_visibility rejects non-CLAS type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'change_method_visibility',
        type: 'PROG',
        name: 'ZTEST',
        method: 'foo',
        visibility: 'private',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('CLAS');
    });

    it('change_method_visibility rejects missing method', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'change_method_visibility',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        visibility: 'private',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/method.*required|NAME.*required/i);
    });

    it('change_method_visibility rejects missing visibility', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'change_method_visibility',
        type: 'CLAS',
        name: 'ZCL_PROBE',
        method: 'hello',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/visibility.*required/i);
    });
  });

  // ── FUGR structural-include update (FEAT-18 sibling) ─────────────────
  // Routing only — the full live lifecycle (create FUGR → update TOP include → activate →
  // read-back) is covered by the integration test, verified on a4h 758 + 816.
  describe('SAPWrite FUGR structural include update', () => {
    function captureLockingFlow(): { method: string; url: string }[] {
      const calls: { method: string; url: string }[] = [];
      mockFetch.mockImplementation((url: string | URL, fetchOpts?: { method?: string }) => {
        const method = fetchOpts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<DATA><LOCK_HANDLE>LH123</LOCK_HANDLE></DATA>', { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      return calls;
    }

    it('routes type=INCL + group to the function-group include source PUT, locking the include (not the group)', async () => {
      const calls = captureLockingFlow();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'INCL',
        name: 'LZARC1_FG_INCTOP',
        group: 'ZARC1_FG_INC',
        source: 'FUNCTION-POOL ZARC1_FG_INC.\n* edited',
        lintBeforeWrite: false,
      });
      expect(result.isError).toBeUndefined();
      const put = calls.find((c) => c.method === 'PUT');
      expect(put?.url).toContain('/sap/bc/adt/functions/groups/zarc1_fg_inc/includes/lzarc1_fg_inctop/source/main');
      // The include object is the lock target; locking the group 423s the PUT (live-verified).
      const lock = calls.find((c) => c.method === 'POST' && c.url.includes('_action=LOCK'));
      expect(lock?.url).toContain('/functions/groups/zarc1_fg_inc/includes/lzarc1_fg_inctop');
      expect(lock?.url).not.toContain('/source/main');
    });

    it('rejects type=INCL + group create instead of creating a standalone program include', async () => {
      const calls = captureLockingFlow();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'INCL',
        name: 'LZMY_FGTOP',
        group: 'ZMY_FG',
        package: '$TMP',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/update only|create\/delete.*unsupported/i);
      expect(calls.some((c) => c.url.includes('/sap/bc/adt/programs/includes'))).toBe(false);
    });

    it('rejects type=INCL + group delete instead of deleting a standalone program include', async () => {
      const calls = captureLockingFlow();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'INCL',
        name: 'LZMY_FGTOP',
        group: 'ZMY_FG',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/update only|create\/delete.*unsupported/i);
      expect(calls.some((c) => c.url.includes('/sap/bc/adt/programs/includes'))).toBe(false);
    });

    it('fails closed cleanly when FUGR include metadata has no packageRef or packageName', async () => {
      const calls: { method: string; url: string }[] = [];
      mockFetch.mockImplementation((url: string | URL, fetchOpts?: { method?: string }) => {
        const method = fetchOpts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/functions/groups/zmy_fg/includes/lzmy_fgtop')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<include:abapInclude xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="LZMY_FGTOP"/>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(
          mockResponse(500, `<unexpected>${method} ${urlStr}</unexpected>`, { 'x-csrf-token': 'T' }),
        );
      });
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZSAFE'] },
      });

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'INCL',
        name: 'LZMY_FGTOP',
        group: 'ZMY_FG',
        source: 'FUNCTION-POOL ZMY_FG.\n* edited',
        lintBeforeWrite: false,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('could not determine');
      expect(result.content[0]?.text).toContain('Fail-closed');
      expect(result.content[0]?.text).not.toContain('500');
      expect(calls.some((c) => c.method === 'PUT' || c.url.includes('_action=LOCK'))).toBe(false);
      // Requires live confirmation on 7.50/758/816: whether include metadata carries
      // adtcore:containerRef adtcore:packageName. This test only pins safe fail-closed behavior.
    });

    it('does not block a realistic TOP include source at the pre-write lint gate', async () => {
      const calls = captureLockingFlow();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'INCL',
        name: 'LZMY_FGTOP',
        group: 'ZMY_FG',
        source: 'FUNCTION-POOL ZMY_FG.\n* global data\nDATA gv_count TYPE i.',
      });
      expect(result.isError).toBeUndefined();
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });

    it.each([
      ['form', 'LZMY_FGF01', 'FORM update_counter.\n  DATA lv_count TYPE i.\nENDFORM.'],
      ['module', 'LZMY_FGO01', 'MODULE status_0100 OUTPUT.\nENDMODULE.'],
    ])('does not misclassify FUGR %s includes as class source during pre-write lint', async (_kind, includeName, source) => {
      const calls = captureLockingFlow();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'INCL',
        name: includeName,
        group: 'ZMY_FG',
        source,
      });
      expect(result.isError).toBeUndefined();
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });

    it('a bare INCL with no group stays a standalone /programs/includes/ include (no FUGR routing)', async () => {
      const calls = captureLockingFlow();
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'INCL',
        name: 'ZSTANDALONE_INC',
        source: '* x',
        lintBeforeWrite: false,
      });
      const put = calls.find((c) => c.method === 'PUT');
      expect(put?.url.toLowerCase()).toContain('/sap/bc/adt/programs/includes/zstandalone_inc/source/main');
      expect(put?.url).not.toContain('/functions/groups/');
    });
  });
});

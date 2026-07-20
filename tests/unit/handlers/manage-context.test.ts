/**
 * SAPManage / SAPContext handler unit tests — split from the former intent.test.ts monolith.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

function ktdEnvelope(markdown: string): string {
  const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
  return `<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd"><sktd:element><sktd:text>${base64}</sktd:text></sktd:element></sktd:docu>`;
}

function liveWhereUsedXml(name = 'ZCL_CALLER'): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/oo/classes/${name.toLowerCase()}" isResult="true">
      <usageReferences:adtObject adtcore:name="${name}" adtcore:type="CLAS/OC" xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:packageRef adtcore:name="$TMP"/>
      </usageReferences:adtObject>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
}

describe('SAPManage / SAPContext handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

  describe('SAPManage', () => {
    const transportInfoResponse = (recording: boolean, isLocal: boolean, transports: string[] = []) => {
      const transportEntries = transports
        .map((t) => `<headers><TRKORR>${t}</TRKORR><AS4TEXT>Transport ${t}</AS4TEXT><AS4USER>DEV</AS4USER></headers>`)
        .join('');
      return `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING>${recording ? 'X' : ''}</RECORDING>
        <DLVUNIT>${isLocal ? 'LOCAL' : 'SAP'}</DLVUNIT>
        <DEVCLASS>Z_PARENT</DEVCLASS>
        ${transports.length > 0 ? `<TRANSPORTS>${transportEntries}</TRANSPORTS>` : ''}
      </DATA></asx:values></asx:abap>`;
    };

    it('returns message when features not yet probed', async () => {
      const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
      resetCachedFeatures();

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'features',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('No features probed yet');
    });

    it('returns error for unknown action', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'invalid',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPManage');
    });

    it('create_package creates DEVC via ADT packages endpoint', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_TEST',
        description: 'Test package',
        superPackage: '$TMP',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Created package ZPKG_TEST');
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/packages'));
      expect(createCall).toBeDefined();
      expect(createCall?.body).toContain('<pak:package');
      expect(createCall?.body).toContain('adtcore:type="DEVC/K"');
      expect(createCall?.body).toContain('<pak:superPackage adtcore:name="$TMP"/>');
    });

    it('create_package appends corrNr when transport is provided', async () => {
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url) });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_TR',
        description: 'Transported package',
        superPackage: 'Z_PARENT',
        transport: 'A4HK900777',
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/packages'));
      expect(createCall?.url).toContain('corrNr=A4HK900777');
    });

    it('create_package returns error when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        description: 'Missing name',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"name" is required');
    });

    it('create_package is blocked by read-only safety mode', async () => {
      const readOnlyClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });

      const result = await handleToolCall(readOnlyClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_RO',
        description: 'Read-only package',
        superPackage: '$TMP',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('delete_package deletes package via lock/delete/unlock', async () => {
      const calls: Array<{ method: string; url: string }> = [];
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'delete_package',
        name: 'ZPKG_DEL',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Deleted package ZPKG_DEL');
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/sap/bc/adt/packages/ZPKG_DEL'))).toBe(true);
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('_action=UNLOCK'))).toBe(true);
    });

    it('delete_package is blocked by read-only safety mode', async () => {
      const readOnlyClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });

      const result = await handleToolCall(readOnlyClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'delete_package',
        name: 'ZPKG_RO',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    // ─── Allowlist gating on SAPManage package mutations ──────────
    // Defense-in-depth: SAP-side S_DEVELOP also gates these, but ARC-1's
    // safety ceiling MUST evaluate `SAP_ALLOWED_PACKAGES` before issuing
    // any DELETE/POST to /sap/bc/adt/packages — otherwise an admin who
    // restricted writes to `ZFOO/**` would be silently overridden by an
    // operator with broader SAP authorization.

    it('delete_package is blocked when target is outside allowedPackages', async () => {
      // Restricted to $TMP only — deleting ZUNRELATED must be denied
      // regardless of allowWrites and SAP-side authorization.
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'delete_package',
        name: 'ZUNRELATED',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Operations on package 'ZUNRELATED' are blocked");
    });

    it('create_package without superPackage gates the new name against allowedPackages', async () => {
      // When `superPackage` is omitted the new package IS the gated root.
      // Restricted to $TMP only — creating ZEVIL at the root must be denied.
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZEVIL',
        description: 'should never be created',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Operations on package 'ZEVIL' are blocked");
    });

    it('change_package calls refactoring preview then execute endpoints', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        if (String(url).includes('step=preview')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring"><generic:transport/></generic:genericRefactoring>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        if (String(url).includes('quickSearch')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zarc1_test" adtcore:type="DDLS/DF" adtcore:name="ZARC1_TEST" adtcore:packageName="$TMP"/></adtcore:objectReferences>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: '$TMP',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Moved ZARC1_TEST');

      const previewCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=preview'));
      expect(previewCall).toBeDefined();
      const executeCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=execute'));
      expect(executeCall).toBeDefined();
    });

    it('change_package treats objectType as a literal ADT type when resolving objectUri', async () => {
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url) });
        if (String(url).includes('quickSearch')) {
          return Promise.resolve(
            mockResponse(
              200,
              `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
                <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/zvictim" adtcore:type="CLAS/OC" adtcore:name="ZVICTIM" adtcore:packageName="$TMP"/>
                <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zvictim" adtcore:type="DDLS/DF" adtcore:name="ZVICTIM" adtcore:packageName="$TMP"/>
              </adtcore:objectReferences>`,
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZVICTIM',
        objectType: '.*',
        oldPackage: '$TMP',
        newPackage: '$TMP',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Could not find object "ZVICTIM" with type ".*"');
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/refactorings'))).toBe(false);
    });

    it('change_package resolves objectUri from parsed ADT search results regardless of attribute order', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        if (String(url).includes('quickSearch')) {
          return Promise.resolve(
            mockResponse(
              200,
              `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
                <adtcore:objectReference adtcore:type="DDLS/DF" adtcore:name="ZARC1_TEST" adtcore:packageName="$TMP" adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zarc1_test"/>
              </adtcore:objectReferences>`,
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        if (String(url).includes('step=preview')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring"><generic:transport/></generic:genericRefactoring>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: '$TMP',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Moved ZARC1_TEST');
      const previewCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=preview'));
      expect(previewCall?.body).toContain('/sap/bc/adt/ddic/ddl/sources/zarc1_test');
    });

    it("change_package is blocked by the object's REAL package, not the caller-supplied oldPackage", async () => {
      // The caller lies: oldPackage="ZALLOWED" (in the allowlist) while the object
      // actually lives in ZSECRET. Authorization must gate the package resolved from
      // objectUri, never the attacker-controlled oldPackage string. (security audit 2026-06)
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZSECRET"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZALLOWED'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZVICTIM',
        objectType: 'CLAS/OC',
        oldPackage: 'ZALLOWED',
        newPackage: 'ZALLOWED',
        objectUri: '/sap/bc/adt/oo/classes/zvictim',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZSECRET');
      expect(result.content[0]?.text).toContain('blocked');
      // The refactoring (move) endpoint must never be reached.
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/refactorings'))).toBe(false);
    });

    it("change_package proceeds when the object's real package is in the allowlist", async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const u = String(url);
        if (u.includes('/oo/classes/zok') && (opts?.method ?? 'GET') === 'GET') {
          return Promise.resolve(
            mockResponse(
              200,
              '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></class:abapClass>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        if (u.includes('step=preview')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring"><generic:transport/></generic:genericRefactoring>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZOK',
        objectType: 'CLAS/OC',
        oldPackage: '$TMP',
        newPackage: '$TMP',
        objectUri: '/sap/bc/adt/oo/classes/zok',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Moved ZOK');
    });

    it('set_api_state is blocked by the resolved real package before release PUT', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="SAP_BASIS"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'set_api_state',
        objectUri: '/sap/bc/adt/oo/classes/cl_salv_table',
        apiState: 'RELEASED',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP_BASIS');
      expect(result.content[0]?.text).toContain('blocked');
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/apireleases/'))).toBe(false);
    });

    it('set_api_state fails closed before revoke PUT when package metadata has no packageRef/containerRef', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(200, '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"/>', {
          'x-csrf-token': 'T',
        }),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'set_api_state',
        objectUri: '/sap/bc/adt/oo/classes/zcl_no_pkg',
        apiState: 'NOT_RELEASED',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('could not determine');
      expect(result.content[0]?.text).toContain('Fail-closed');
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/apireleases/'))).toBe(false);
    });

    it('change_package returns error when objectName is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: 'Z_TARGET',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"objectName" is required');
    });

    it('change_package returns error when objectType is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        oldPackage: '$TMP',
        newPackage: 'Z_TARGET',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"objectType" is required');
    });

    it('change_package returns error when oldPackage is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        newPackage: 'Z_TARGET',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"oldPackage" is required');
    });

    it('change_package returns error when newPackage is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"newPackage" is required');
    });

    it('change_package is blocked by read-only safety mode', async () => {
      const readOnlyClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });

      const result = await handleToolCall(readOnlyClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: 'Z_TARGET',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('change_package is blocked when old package not in allowlist', async () => {
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['Z_ALLOWED'] },
      });

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: 'Z_ALLOWED',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('change_package is blocked when new package not in allowlist', async () => {
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: 'Z_FORBIDDEN',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('change_package passes transport in XML when provided', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        if (String(url).includes('step=preview')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring"><generic:transport/></generic:genericRefactoring>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        objectUri: '/sap/bc/adt/ddic/ddl/sources/zarc1_test',
        oldPackage: '$TMP',
        newPackage: 'Z_TARGET',
        transport: 'A4HK900123',
      });

      expect(result.isError).toBeUndefined();
      const executeCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=execute'));
      expect(executeCall?.body).toContain('<generic:transport>A4HK900123</generic:transport>');
    });

    it('change_package success message includes object name and packages', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        if (String(url).includes('step=preview')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring"><generic:transport/></generic:genericRefactoring>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZCL_MY_CLASS',
        objectType: 'CLAS/OC',
        objectUri: '/sap/bc/adt/oo/classes/zcl_my_class',
        oldPackage: '$TMP',
        newPackage: 'Z_PRODUCTION',
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('ZCL_MY_CLASS');
      expect(text).toContain('$TMP');
      expect(text).toContain('Z_PRODUCTION');
    });

    it('create_package returns transport guidance when parent package requires transport', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(
            mockResponse(200, transportInfoResponse(true, false, ['A4HK900502']), { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_NEEDS_TR',
        description: 'Transport-required package',
        superPackage: 'Z_PARENT',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requires a transport number');
      expect(result.content[0]?.text).toContain('SAPTransport');
      expect(result.content[0]?.text).toContain('A4HK900502');
    });

    it('create_package includes optional fields in XML payload', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_FULL',
        description: 'Full options package',
        superPackage: 'Z_PARENT',
        softwareComponent: 'HOME',
        transportLayer: 'HOME',
        packageType: 'structure',
        transport: 'A4HK900701',
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/packages'));
      expect(createCall?.body).toContain('<pak:attributes pak:packageType="structure" pak:recordChanges="true"/>');
      expect(createCall?.body).toContain('<pak:superPackage adtcore:name="Z_PARENT"/>');
      expect(createCall?.body).toContain('<pak:softwareComponent pak:name="HOME"/>');
      expect(createCall?.body).toContain('<pak:transportLayer pak:name="HOME"/>');
    });

    it('create_package honors explicit recordChanges=false in XML payload', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_NO_RECORD',
        description: 'No recording',
        softwareComponent: 'HOME',
        recordChanges: false,
        transport: 'A4HK900701',
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/packages'));
      expect(createCall?.body).toContain('<pak:attributes pak:packageType="development" pak:recordChanges="false"/>');
      expect(createCall?.body).toContain('<pak:softwareComponent pak:name="HOME"/>');
    });

    it('create_package defaults recordChanges=true for non-LOCAL software components', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_ZLOCAL',
        description: 'ZLOCAL package',
        softwareComponent: 'ZLOCAL',
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/packages'));
      expect(createCall?.body).toContain('<pak:attributes pak:packageType="development" pak:recordChanges="true"/>');
      expect(createCall?.body).toContain('<pak:softwareComponent pak:name="ZLOCAL"/>');
    });

    it('flp_list_catalogs returns catalog list', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          JSON.stringify({
            d: {
              results: [
                {
                  id: '/UI2/CATALOG_ALL',
                  domainId: '/UI2/CATALOG_ALL',
                  title: 'Catalog with all Chips',
                  type: '',
                  scope: '',
                  chipCount: '0042',
                },
              ],
            },
          }),
          { 'x-csrf-token': 'T' },
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_list_catalogs',
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      expect(text).toContain('1 catalogs');
      expect(text).toContain('/UI2/CATALOG_ALL');
      expect(text).toContain('Catalog with all Chips');
    });

    it('flp_list_tiles requires catalogId', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_list_tiles',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"catalogId" is required');
    });

    it('flp_create_catalog is blocked in read-only safety mode', async () => {
      const readOnlyClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });

      const result = await handleToolCall(readOnlyClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_create_catalog',
        domainId: 'ZARC1_TEST',
        title: 'Test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('flp_delete_catalog requires catalogId', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_delete_catalog',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"catalogId" is required');
    });

    it('flp_delete_catalog sends DELETE request', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'csrf' }))
        .mockResolvedValueOnce(mockResponse(204, ''));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_delete_catalog',
        catalogId: 'X-SAP-UI2-CATALOGPAGE:ZARC1_TEST',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Deleted FLP catalog');
    });

    it('flp_create_tile serializes configuration correctly', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'csrf' })).mockResolvedValueOnce(
        mockResponse(
          201,
          JSON.stringify({
            d: {
              pageId: 'X-SAP-UI2-CATALOGPAGE:ZCAT',
              instanceId: 'TILE123',
              chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER',
              title: 'Tile',
              configuration: '{"tileConfiguration":"{}"}',
            },
          }),
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_create_tile',
        catalogId: 'ZCAT',
        tile: {
          id: 'tile-1',
          title: 'Tile',
          semanticObject: 'ZSO',
          semanticAction: 'display',
        },
      });

      expect(result.isError).toBeUndefined();
      const postCall = mockFetch.mock.calls.find((call) => (call[1] as RequestInit)?.method === 'POST');
      expect(postCall).toBeDefined();
      if (!postCall) throw new Error('Expected a POST call');
      const payload = JSON.parse((postCall[1] as RequestInit).body as string);
      const outer = JSON.parse(payload.configuration);
      const inner = JSON.parse(outer.tileConfiguration);
      expect(inner.semantic_object).toBe('ZSO');
      expect(inner.semantic_action).toBe('display');
      expect(inner.display_title_text).toBe('Tile');
    });
  });

  describe('SAPContext', () => {
    it('returns error when type is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('type');
    });

    it('returns error when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'CLAS',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('name');
    });

    it('returns a guardrail error for TABL without structure action', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'TABL',
        name: 'MARA',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('type TABL requires action="structure"');
    });

    it('returns TABL structure context through action="structure"', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        const urlStr = String(url);
        const method = opts?.method ?? 'GET';
        if (urlStr.includes('/sap/bc/adt/core/discovery')) {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences/scope')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<usageReferences:scopeResponse xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences"/>',
            ),
          );
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences"><usageReferences:referencedObjects/></usageReferences:usageReferenceResult>',
            ),
          );
        }
        if (urlStr.includes('/sap/bc/adt/ddic/tables/ZBASE/source/main')) {
          return Promise.resolve(mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/ddic/structures/ZBASE/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define structure zbase {\n  include zinc;\n}', { 'x-csrf-token': 'T' }),
          );
        }
        if (urlStr.includes('/sap/bc/adt/ddic/tables/ZINC/source/main')) {
          return Promise.resolve(mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/ddic/structures/ZINC/source/main')) {
          return Promise.resolve(mockResponse(200, 'define structure zinc { field1 : abap.char(1); }'));
        }
        return Promise.resolve(mockResponse(500, `Unexpected URL ${urlStr}`));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'structure',
        type: 'TABL',
        name: 'ZBASE',
      });
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(result.isError).toBeUndefined();
      expect(payload.tree.children[0]).toMatchObject({ kind: 'include', structure: 'ZINC' });
      expect(payload.includeExtensions).toBe(true);
    });

    it('dispatches successfully with provided source', async () => {
      const source = `CLASS zcl_standalone DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_standalone IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'CLAS',
        name: 'zcl_standalone',
        source,
      });
      // Should not be an error — it processes the source and returns context
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Dependency context for zcl_standalone');
    });

    it('dispatches DDLS type for CDS context', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'DDLS',
        name: 'ZI_ORDER',
      });
      // Mock returns generic text which the CDS parser will process
      // It should not error — it calls getDdls and runs CDS context pipeline
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('CDS dependency context for ZI_ORDER');
    });

    it('prepends decoded KTD before dependency context when available', async () => {
      const calls: string[] = [];
      const source = `CLASS zcl_doc DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_doc IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`;
      const markdown = '# Existing KTD\n\nBusiness meaning.';
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        calls.push(urlStr);
        if (urlStr.includes('/sap/bc/adt/documentation/ktd/documents/')) {
          return Promise.resolve(mockResponse(200, ktdEnvelope(markdown), { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, source, { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'CLAS',
        name: 'ZCL_DOC',
      });

      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBeUndefined();
      expect(text).toContain('Knowledge Transfer Document for ZCL_DOC');
      expect(text).toContain(markdown);
      expect(text.indexOf('Knowledge Transfer Document')).toBeLessThan(text.indexOf('Dependency context'));
      expect(calls.some((url) => url.includes('/sap/bc/adt/documentation/ktd/documents/zcl_doc'))).toBe(true);
    });

    it('continues dependency context when KTD is not found', async () => {
      const source = `CLASS zcl_no_doc DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_no_doc IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/documentation/ktd/documents/')) {
          return Promise.resolve(mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, source, { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'CLAS',
        name: 'ZCL_NO_DOC',
      });

      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBeUndefined();
      expect(text).toContain('Dependency context for ZCL_NO_DOC');
      expect(text).not.toContain('Knowledge Transfer Document');
    });

    it('skips the KTD lookup when includeKtd=false', async () => {
      const calls: string[] = [];
      const source = `CLASS zcl_skip_doc DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_skip_doc IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        calls.push(urlStr);
        return Promise.resolve(mockResponse(200, source, { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'CLAS',
        name: 'ZCL_SKIP_DOC',
        includeKtd: false,
      });

      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBeUndefined();
      expect(text).toContain('Dependency context for ZCL_SKIP_DOC');
      expect(text).not.toContain('Knowledge Transfer Document');
      expect(calls.some((url) => url.includes('/sap/bc/adt/documentation/ktd/documents/'))).toBe(false);
    });

    it('composes KTD with cached dependency context', async () => {
      const layer = new CachingLayer(new MemoryCache());
      const source = 'CLASS zcl_root DEFINITION PUBLIC. ENDCLASS.';
      const markdown = '# Cached Root KTD\n\nUse this before editing.';
      layer.putDepGraph(source, 'ZCL_ROOT', 'CLAS', [
        {
          name: 'ZIF_DEP',
          type: 'INTF',
          methodCount: 1,
          source: 'INTERFACE zif_dep PUBLIC.\n  METHODS run.\nENDINTERFACE.',
          success: true,
        },
      ]);
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/documentation/ktd/documents/')) {
          return Promise.resolve(mockResponse(200, ktdEnvelope(markdown), { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, source, { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPContext',
        { type: 'CLAS', name: 'ZCL_ROOT' },
        undefined,
        undefined,
        layer,
      );

      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBeUndefined();
      expect(text).toContain('Knowledge Transfer Document for ZCL_ROOT');
      expect(text).toContain(markdown);
      expect(text).toContain('[cached]');
      expect(text).toContain('ZIF_DEP');
    });

    it('does not serve cached dependency contracts under principal propagation', async () => {
      const layer = new CachingLayer(new MemoryCache());
      const source = 'CLASS zcl_root DEFINITION PUBLIC. ENDCLASS.';
      layer.putDepGraph(source, 'ZCL_ROOT', 'CLAS', [
        { name: 'ZCL_SECRET', type: 'CLAS', methodCount: 0, source: 'SECRET SOURCE', success: true },
      ]);
      const auth: AuthInfo = {
        token: 'jwt',
        clientId: 'oidc-client',
        scopes: ['read'],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        extra: { sub: 'user-a' },
      };

      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPContext',
        { type: 'CLAS', name: 'ZCL_ROOT', source },
        auth,
        undefined,
        layer,
        true,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).not.toContain('SECRET SOURCE');
      expect(result.content[0]?.text).not.toContain('[cached]');
      expect(result.content[0]?.text).toContain('0 deps resolved');
    });

    it('serves live usages under principal propagation without consulting the cache', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, liveWhereUsedXml()));
      const auth: AuthInfo = {
        token: 'jwt',
        clientId: 'oidc-client',
        scopes: ['read'],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        extra: { sub: 'user-a' },
      };

      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPContext',
        { action: 'usages', type: 'CLAS', name: 'ZCL_TARGET' },
        auth,
        undefined,
        undefined,
        true,
      );

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({ name: 'ZCL_TARGET', usageCount: 1, source: 'live', fallbackUsed: false });
      expect(payload.usages[0].name).toBe('ZCL_CALLER');
    });

    it('reports usageCount as the TOTAL, not the returned page', async () => {
      // The safety property behind bounding: "what breaks if I change this?" must not be answered
      // with the page size. Under-reporting a blast radius is a wrong answer, not a terse one.
      const rows = Array.from(
        { length: 120 },
        (_, i) => `<usageReferences:referencedObject uri="/sap/bc/adt/oo/classes/zcl_c${i}" isResult="true">
      <usageReferences:adtObject adtcore:name="ZCL_C${i}" adtcore:type="CLAS/OC" xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:packageRef adtcore:name="$TMP"/>
      </usageReferences:adtObject>
    </usageReferences:referencedObject>`,
      ).join('\n');
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>${rows}</usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`,
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'usages',
        type: 'CLAS',
        name: 'ZCL_TARGET',
        maxResults: 5,
      });

      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload.usageCount).toBe(120);
      expect(payload.shown).toBe(5);
      expect(payload.truncated).toBe(true);
      expect(payload.usages).toHaveLength(5);
      expect(payload.hint).toContain('120');
    });

    it('resolves a unique name-only usages request through ADT lookup', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          '<objectReferences><objectReference uri="/sap/bc/adt/oo/classes/zcl_target" type="CLAS/OC" name="ZCL_TARGET" packageName="$TMP"/></objectReferences>',
        ),
      );
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, liveWhereUsedXml('ZCL_UNIQUE_CALLER')));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'usages',
        name: 'ZCL_TARGET',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload.resolvedObject).toMatchObject({ type: 'CLAS', name: 'ZCL_TARGET' });
      expect(payload.usages[0].name).toBe('ZCL_UNIQUE_CALLER');
    });

    it('returns bounded candidates for an ambiguous name-only usages request', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          '<objectReferences><objectReference uri="/sap/bc/adt/oo/classes/zsame" type="CLAS/OC" name="ZSAME"/><objectReference uri="/sap/bc/adt/programs/programs/zsame" type="PROG/P" name="ZSAME"/></objectReferences>',
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'usages',
        name: 'ZSAME',
      });

      expect(result.isError).toBe(true);
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload.error).toContain('ambiguous');
      expect(payload.candidates).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('keys inactive-list caching by authenticated user under principal propagation', async () => {
      const layer = new CachingLayer(new MemoryCache());
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: '',
        password: 'secret',
        safety: unrestrictedSafetyConfig(),
      });
      let inactiveCalls = 0;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/activation/inactiveobjects')) {
          inactiveCalls += 1;
          return Promise.resolve(
            mockResponse(
              200,
              '<?xml version="1.0" encoding="utf-8"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, "REPORT zfoo.\nWRITE 'x'.", { 'x-csrf-token': 'T' }));
      });
      const auth = (sub: string): AuthInfo => ({
        token: 'jwt',
        clientId: 'oidc-client',
        scopes: ['read'],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        extra: { sub },
      });

      await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZFOO', version: 'auto' },
        auth('alice'),
        undefined,
        layer,
        true,
      );
      await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZFOO', version: 'auto' },
        auth('bob'),
        undefined,
        layer,
        true,
      );
      await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZFOO', version: 'auto' },
        auth('alice'),
        undefined,
        layer,
        true,
      );

      expect(inactiveCalls).toBe(2);
      expect(layer.inactiveLists.stats()).toEqual({ userCount: 2, totalEntries: 0 });
    });

    it('bypasses inactive-list caching under principal propagation when auth has no user-specific key', async () => {
      const layer = new CachingLayer(new MemoryCache());
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'DISPLAY_USER',
        password: 'secret',
        safety: unrestrictedSafetyConfig(),
      });
      let inactiveCalls = 0;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/activation/inactiveobjects')) {
          inactiveCalls += 1;
          return Promise.resolve(
            mockResponse(
              200,
              '<?xml version="1.0" encoding="utf-8"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, "REPORT zfoo.\nWRITE 'x'.", { 'x-csrf-token': 'T' }));
      });
      const auth: AuthInfo = {
        token: 'jwt',
        clientId: 'shared-oidc-client',
        scopes: ['read'],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        extra: {},
      };

      await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZFOO', version: 'auto' },
        auth,
        undefined,
        layer,
        true,
      );
      await handleToolCall(
        client,
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZFOO', version: 'auto' },
        auth,
        undefined,
        layer,
        true,
      );

      expect(inactiveCalls).toBe(2);
      expect(layer.inactiveLists.stats()).toEqual({ userCount: 0, totalEntries: 0 });
    });

    it('returns CDS impact with upstream and downstream buckets', async () => {
      mockFetch.mockReset();
      const whereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_arc1_proj" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ARC1_PROJ" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/rap/bdef/bo/zi_arc1_root" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ARC1_ROOT" adtcore:type="BDEF/BO" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL, _opts?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_MY_VIEW/source/main')) {
          return Promise.resolve(
            mockResponse(
              200,
              `define view entity Z_MY_VIEW as select from zmytab\n  inner join ZI_BASE on ZI_BASE.id = zmytab.id\n  association [0..1] to ZI_ASSOC as _Assoc on _Assoc.id = zmytab.id\n{\n  key zmytab.id,\n  _Assoc\n}`,
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, whereUsedXml, { 'x-csrf-token': 'T' }));
        }
        // default fallback for token bootstrap/other requests
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_MY_VIEW',
        siblingCheck: false,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('Z_MY_VIEW');
      expect(parsed.type).toBe('DDLS');
      expect(parsed.upstream.tables.map((item: { name: string }) => item.name)).toContain('ZMYTAB');
      expect(parsed.upstream.views.map((item: { name: string }) => item.name)).toContain('ZI_BASE');
      expect(parsed.downstream.projectionViews.map((item: { name: string }) => item.name)).toContain('ZI_ARC1_PROJ');
      expect(parsed.downstream.bdefs.map((item: { name: string }) => item.name)).toContain('ZI_ARC1_ROOT');
      expect(parsed.summary.downstreamTotal).toBeGreaterThanOrEqual(2);
    });

    it('bounds impact buckets while keeping the summary total complete', async () => {
      // Regression: impact accepted maxResults and silently ignored it, classifying and returning
      // the FULL where-used tree — the exact bug bounding exists to kill. The summary must stay
      // complete: an under-reported blast radius is a wrong answer to "what breaks if I change this".
      mockFetch.mockReset();
      const rows = Array.from(
        { length: 80 },
        (
          _,
          i,
        ) => `<usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_p${i}" isResult="true" canHaveChildren="false" usageInformation="gradeDirect">
      <usageReferences:adtObject adtcore:name="ZI_P${i}" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>`,
      ).join('\n');
      const whereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>${rows}</usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_MY_VIEW/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_MY_VIEW as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, whereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_MY_VIEW',
        siblingCheck: false,
        maxResults: 10,
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.downstream.projectionViews).toHaveLength(10);
      expect(parsed.summary.downstreamTotal).toBe(80);
      expect(parsed.truncatedBuckets).toContain('projectionViews (80)');
      expect(parsed.hint).toContain('summary counts remain complete');
    });

    it('returns guidance error when impact is requested for non-DDLS type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'CLAS',
        name: 'ZCL_TEST',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAPNavigate');
    });

    it('defaults type to DDLS when action=impact and type is omitted', async () => {
      // Regression: Sonnet 4.6 transcript showed LLMs call
      //   SAPContext({ action: "impact", name: "I_COUNTRY" })
      // without `type` (since impact is DDLS-only, the type is redundant).
      // Previously this returned 'Both "type" and "name" are required' and
      // forced a retry. Now the handler should default type=DDLS and proceed.
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/I_COUNTRY/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity I_COUNTRY as select from t005 { key t005.land1 as Country }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        name: 'I_COUNTRY',
        siblingCheck: false,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('I_COUNTRY');
      expect(parsed.type).toBe('DDLS');
      // Upstream came from the DDL source we mocked, proving the default
      // routed through the DDLS impact pipeline.
      expect(parsed.upstream.tables.map((item: { name: string }) => item.name)).toContain('T005');
    });

    it('returns Zod validation error when impact is called without name', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPContext');
      expect(result.content[0]?.text).toContain('name');
    });

    it('degrades gracefully when where-used endpoint is unavailable', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_MY_VIEW/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_MY_VIEW as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_MY_VIEW',
        siblingCheck: false,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.warnings).toEqual(['Where-used endpoint not available on this system']);
      expect(parsed.downstream.summary.total).toBe(0);
    });

    it('emits sibling consistency hint when sibling DDLS has DDLX consumers but target does not', async () => {
      mockFetch.mockReset();

      const targetSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA3" adtcore:packageName="ZPKG" adtcore:description="Target"/>
</adtcore:objectReferences>`;
      const siblingSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA3" adtcore:packageName="ZPKG" adtcore:description="Target"/>
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA4" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA4" adtcore:packageName="ZPKG" adtcore:description="Sibling"/>
</adtcore:objectReferences>`;
      const targetWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_projection" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_PROJECTION" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
      const siblingWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddlx/sources/z_orderdata4" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="Z_ORDERDATA4" adtcore:type="DDLX/EX" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_ORDERDATA3 as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA3')) {
          return Promise.resolve(mockResponse(200, targetWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA4')) {
          return Promise.resolve(mockResponse(200, siblingWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/search?operation=quickSearch')) {
          const parsed = new URL(urlStr);
          const query = parsed.searchParams.get('query');
          if (query === 'Z_ORDERDATA3') {
            return Promise.resolve(mockResponse(200, targetSearchXml, { 'x-csrf-token': 'T' }));
          }
          if (query === 'Z_ORDERDATA*') {
            return Promise.resolve(mockResponse(200, siblingSearchXml, { 'x-csrf-token': 'T' }));
          }
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_ORDERDATA3',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.consistencyHints?.[0]).toContain('Z_ORDERDATA3');
      expect(parsed.consistencyHints?.[0]).toContain('Z_ORDERDATA4');
      expect(parsed.siblingExtensionAnalysis.target.packageName).toBe('ZPKG');
      expect(parsed.siblingExtensionAnalysis.checkedCandidates[0].name).toBe('Z_ORDERDATA4');
      expect(parsed.siblingExtensionAnalysis.checkedCandidates[0].metadataExtensions).toBe(1);
    });

    it('does not emit sibling hint when target already has DDLX consumers', async () => {
      mockFetch.mockReset();

      const targetSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA3" adtcore:packageName="ZPKG" adtcore:description="Target"/>
</adtcore:objectReferences>`;
      const siblingSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA4" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA4" adtcore:packageName="ZPKG" adtcore:description="Sibling"/>
</adtcore:objectReferences>`;
      const whereUsedWithDdlx = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddlx/sources/z_orderdata3" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="Z_ORDERDATA3" adtcore:type="DDLX/EX" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_ORDERDATA3 as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA3')) {
          return Promise.resolve(mockResponse(200, whereUsedWithDdlx, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA4')) {
          return Promise.resolve(mockResponse(200, whereUsedWithDdlx, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/search?operation=quickSearch')) {
          const parsed = new URL(urlStr);
          const query = parsed.searchParams.get('query');
          if (query === 'Z_ORDERDATA3') {
            return Promise.resolve(mockResponse(200, targetSearchXml, { 'x-csrf-token': 'T' }));
          }
          if (query === 'Z_ORDERDATA*') {
            return Promise.resolve(mockResponse(200, siblingSearchXml, { 'x-csrf-token': 'T' }));
          }
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_ORDERDATA3',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.consistencyHints).toBeUndefined();
      expect(parsed.siblingExtensionAnalysis.target.metadataExtensions).toBe(1);
    });

    it('enforces sibling candidate cap', async () => {
      mockFetch.mockReset();
      let siblingWhereUsedCalls = 0;

      const targetSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA3" adtcore:packageName="ZPKG" adtcore:description="Target"/>
</adtcore:objectReferences>`;
      const siblingSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA4" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA4" adtcore:packageName="ZPKG" adtcore:description="Sibling 4"/>
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA5" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA5" adtcore:packageName="ZPKG" adtcore:description="Sibling 5"/>
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA6" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA6" adtcore:packageName="ZPKG" adtcore:description="Sibling 6"/>
</adtcore:objectReferences>`;
      const emptyWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects />
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_ORDERDATA3 as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA3')) {
          return Promise.resolve(mockResponse(200, emptyWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA')) {
          siblingWhereUsedCalls += 1;
          return Promise.resolve(mockResponse(200, emptyWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/search?operation=quickSearch')) {
          const parsed = new URL(urlStr);
          const query = parsed.searchParams.get('query');
          if (query === 'Z_ORDERDATA3') {
            return Promise.resolve(mockResponse(200, targetSearchXml, { 'x-csrf-token': 'T' }));
          }
          if (query === 'Z_ORDERDATA*') {
            return Promise.resolve(mockResponse(200, siblingSearchXml, { 'x-csrf-token': 'T' }));
          }
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_ORDERDATA3',
        siblingMaxCandidates: 1,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.siblingExtensionAnalysis.checkedCandidates).toHaveLength(1);
      expect(parsed.siblingExtensionAnalysis.skipped.overLimit).toBe(2);
      expect(siblingWhereUsedCalls).toBe(1);
    });

    it('keeps base impact response when sibling search fails', async () => {
      mockFetch.mockReset();

      const emptyWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects />
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_ORDERDATA3 as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA3')) {
          return Promise.resolve(mockResponse(200, emptyWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/search?operation=quickSearch')) {
          return Promise.resolve(mockResponse(500, 'Search failed', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_ORDERDATA3',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.summary.downstreamTotal).toBe(0);
      expect(parsed.warnings).toContain(
        'Sibling consistency check skipped due to search or where-used processing errors.',
      );
    });

    it('skips sibling analysis and records a warning when the derived stem is too short', async () => {
      mockFetch.mockReset();
      let searchCalled = false;

      const emptyWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects />
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z1/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z1 as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ1')) {
          return Promise.resolve(mockResponse(200, emptyWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/search?operation=quickSearch')) {
          searchCalled = true;
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z1',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.siblingExtensionAnalysis).toBeUndefined();
      expect(parsed.warnings?.some((msg: string) => msg.includes('too short to identify siblings'))).toBe(true);
      expect(searchCalled).toBe(false);
    });
  });
});

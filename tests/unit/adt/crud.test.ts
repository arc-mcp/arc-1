import { describe, expect, it, vi } from 'vitest';
import {
  createObject,
  deleteObject,
  lockObject,
  safeUpdateObject,
  safeUpdateSource,
  unlockObject,
  updateObject,
  updateSource,
} from '../../../src/adt/crud.js';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

function mockHttp(body = ''): AdtHttpClient {
  return {
    get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body }),
    post: vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>HANDLE123</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
    }),
    put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    delete: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    fetchCsrfToken: vi.fn().mockResolvedValue(undefined),
    withStatefulSession: vi.fn().mockImplementation(async (fn: any) => {
      const session = {
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body }),
        post: vi.fn().mockResolvedValue({
          statusCode: 200,
          headers: {},
          body: '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>SESS_HANDLE</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
        }),
        put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
        delete: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
      };
      return fn(session);
    }),
  } as unknown as AdtHttpClient;
}

describe('CRUD Operations', () => {
  // ─── lockObject ────────────────────────────────────────────────────

  describe('lockObject', () => {
    it('parses lock handle from response', async () => {
      const http = mockHttp();
      const result = await lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.lockHandle).toBe('HANDLE123');
      expect(result.isLocal).toBe(true);
      expect(result.corrNr).toBe('');
    });

    it('parses transport number from lock response', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR>A4HK900100</CORRNR><IS_LOCAL></IS_LOCAL></DATA></asx:values></asx:abap>';
      const http = {
        ...mockHttp(),
        post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: lockBody }),
      } as unknown as AdtHttpClient;
      const result = await lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.corrNr).toBe('A4HK900100');
      expect(result.isLocal).toBe(false);
    });

    it('returns lock result when MODIFICATION_SUPPORT is absent (normal object)', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H2</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      const http = {
        ...mockHttp(),
        post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: lockBody }),
      } as unknown as AdtHttpClient;
      const result = await lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result).toEqual({ lockHandle: 'H2', corrNr: '', isLocal: true });
    });

    it('returns lock result when MODIFICATION_SUPPORT is true', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H3</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL></IS_LOCAL><MODIFICATION_SUPPORT>true</MODIFICATION_SUPPORT></DATA></asx:values></asx:abap>';
      const http = {
        ...mockHttp(),
        post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: lockBody }),
      } as unknown as AdtHttpClient;
      const result = await lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result).toEqual({ lockHandle: 'H3', corrNr: '', isLocal: false });
    });

    it('throws AdtApiError 423 when MODIFICATION_SUPPORT is false (ABAP XML format)', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H4</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL></IS_LOCAL><MODIFICATION_SUPPORT>false</MODIFICATION_SUPPORT></DATA></asx:values></asx:abap>';
      const http = {
        ...mockHttp(),
        post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: lockBody }),
      } as unknown as AdtHttpClient;
      await expect(
        lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST'),
      ).rejects.toMatchObject({
        statusCode: 423,
        message: expect.stringContaining('Object cannot be modified'),
      });
      await expect(lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST')).rejects.toThrow(
        AdtApiError,
      );
    });

    it('throws AdtApiError 423 when modificationSupport is false (adtcore namespace format)', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml" xmlns:adtcore="http://www.sap.com/adt/core"><asx:values><DATA><LOCK_HANDLE>H5</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL></IS_LOCAL><adtcore:modificationSupport>false</adtcore:modificationSupport></DATA></asx:values></asx:abap>';
      const http = {
        ...mockHttp(),
        post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: lockBody }),
      } as unknown as AdtHttpClient;
      await expect(
        lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST'),
      ).rejects.toMatchObject({
        statusCode: 423,
        message: expect.stringContaining('Object cannot be modified'),
      });
      await expect(lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST')).rejects.toThrow(
        AdtApiError,
      );
    });

    it('sends LOCK action to correct URL', async () => {
      const http = mockHttp();
      await lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('_action=LOCK'),
        undefined,
        undefined,
        expect.objectContaining({ Accept: expect.stringContaining('com.sap.adt.lock.result') }),
      );
    });

    it('uses accessMode parameter', async () => {
      const http = mockHttp();
      await lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST', 'MODIFY');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('accessMode=MODIFY');
    });

    it('Lock type L is not a mutating operation — allowWrites=false does not block lock', async () => {
      // Lock is gated by its own operation type 'L', not by the write gate.
      // allowWrites=false blocks CDUAWX (Create, Delete, Update, Activate, Workflow, Transport).
      // This is intentional: lock is needed for read operations like syntax check.
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(lockObject(http, safety, '/url')).resolves.toBeDefined();
    });

    it('handles namespaced objects (Issue #18)', async () => {
      const http = mockHttp();
      const url = '/sap/bc/adt/oo/classes/%2fUSE%2fCL_MY_CLASS';
      await lockObject(http, unrestrictedSafetyConfig(), url);
      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('%2fUSE%2fCL_MY_CLASS'),
        undefined,
        undefined,
        expect.any(Object),
      );
    });

    describe('lock-conflict reclassification (layered detection per ADR-0002)', () => {
      function mockHttpThatRejectsLock(status: number, body: string): AdtHttpClient {
        const post = vi.fn().mockRejectedValue(new AdtApiError('reject', status, '/url', body));
        return {
          get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
          post,
          put: vi.fn(),
          delete: vi.fn(),
          fetchCsrfToken: vi.fn(),
          withStatefulSession: vi.fn(),
        } as unknown as AdtHttpClient;
      }

      const html = '<html><body>Logon Error Message — please log on again.</body></html>';

      it('reclassifies 403 + "Logon Error Message" body as 409 lock-conflict', async () => {
        const http = mockHttpThatRejectsLock(403, html);
        await expect(
          lockObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST'),
        ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('locked by another session') });
      });

      it('reclassifies 401 + "Logon Error Message" body as 409 (cookie-clear retry path)', async () => {
        const http = mockHttpThatRejectsLock(401, html);
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url')).rejects.toMatchObject({ statusCode: 409 });
      });

      it('reclassifies 400 + "Logon Error Message" body as 409 (ICM 403→401→400 cascade)', async () => {
        const http = mockHttpThatRejectsLock(400, html);
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url')).rejects.toMatchObject({ statusCode: 409 });
      });

      it('does NOT reclassify S/4 auth-failure body ("Anmeldung fehlgeschlagen")', async () => {
        const http = mockHttpThatRejectsLock(401, '<html><body>Anmeldung fehlgeschlagen</body></html>');
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url')).rejects.toMatchObject({ statusCode: 401 });
      });

      it('reclassifies structured ExceptionResourceNoAccess on any release (Layer 1)', async () => {
        // Per ADR-0002, structured `<exc:exception><type id="ExceptionResourceNoAccess"/>`
        // is the authoritative signal — reclassify regardless of release or HTTP status.
        // Modern S/4 releases emit this shape; we now correctly route to 409 lock-conflict.
        const xml =
          '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><type id="ExceptionResourceNoAccess"/><message lang="EN">User MARIAN is currently editing ZTEST</message></exc:exception>';
        const http = mockHttpThatRejectsLock(403, xml);
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url')).rejects.toMatchObject({
          statusCode: 409,
          message: expect.stringContaining('locked by another session'),
        });
      });

      it('Layer 1 still fires when abapRelease is modern (758) — structured signal wins', async () => {
        const xml =
          '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><type id="ExceptionResourceNoAccess"/></exc:exception>';
        const http = mockHttpThatRejectsLock(403, xml);
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url', 'MODIFY', '758')).rejects.toMatchObject({
          statusCode: 409,
        });
      });

      it('Layer 2 (HTML body) DOES fire when abapRelease<751 (NW 7.50)', async () => {
        const http = mockHttpThatRejectsLock(401, html);
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url', 'MODIFY', '750')).rejects.toMatchObject({
          statusCode: 409,
          message: expect.stringContaining('may be locked'),
        });
      });

      it('Layer 2 (HTML body) does NOT fire when abapRelease>=751 (modern release)', async () => {
        const http = mockHttpThatRejectsLock(401, html);
        // With abapRelease='758' the HTML fallback is dormant — original 401 must surface.
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url', 'MODIFY', '758')).rejects.toMatchObject({
          statusCode: 401,
        });
      });

      it('Layer 2 fires when abapRelease is undefined (CLI / test paths — defensive default)', async () => {
        // Preserves the original heuristic where features were not yet probed.
        const http = mockHttpThatRejectsLock(401, html);
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url')).rejects.toMatchObject({ statusCode: 409 });
      });

      it('Layer 2 fallback uses neutral message ("may be locked or already exist")', async () => {
        const http = mockHttpThatRejectsLock(401, html);
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url', 'MODIFY', '750')).rejects.toMatchObject({
          message: expect.stringContaining('may be locked'),
        });
      });

      it('non-HTML 401 with no marker is not reclassified', async () => {
        const http = mockHttpThatRejectsLock(401, 'Authentication required');
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url')).rejects.toMatchObject({ statusCode: 401 });
      });

      // ─── Codex review of PR #202: HTML detection must be case-insensitive ────
      // Real SAP ICM error pages use a mix of casings — lowercase `<html>` (NPL
      // 7.50 verified live), uppercase `<HTML>`, and `<!DOCTYPE HTML PUBLIC ...>`
      // doctype. The original lowercase-only check would regress on releases that
      // emit any of the other two.
      it('Layer 2 fires on uppercase `<HTML>` body (case-insensitive)', async () => {
        const upperHtml = '<HTML><BODY>Logon Error Message — please log on again.</BODY></HTML>';
        const http = mockHttpThatRejectsLock(401, upperHtml);
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url', 'MODIFY', '750')).rejects.toMatchObject({
          statusCode: 409,
          message: expect.stringContaining('may be locked'),
        });
      });

      it('Layer 2 fires on `<!DOCTYPE HTML>` doctype-prefixed body', async () => {
        const doctypeHtml =
          '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"><html><body>Logon Error Message — session expired</body></html>';
        const http = mockHttpThatRejectsLock(401, doctypeHtml);
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url', 'MODIFY', '750')).rejects.toMatchObject({
          statusCode: 409,
        });
      });

      it('Layer 2 does NOT misfire on a non-HTML body that mentions "html" in plain text', async () => {
        // Defensive: a plain-text 401 mentioning "html" without an actual HTML tag must not
        // be reclassified. The /<!doctype\s+html|<html[\s>]/i regex requires a real opening
        // tag context, so prose-only bodies fall through.
        const proseBody = 'Authentication required (the html-formatted error page is hidden by your proxy).';
        const http = mockHttpThatRejectsLock(401, proseBody);
        await expect(lockObject(http, unrestrictedSafetyConfig(), '/url', 'MODIFY', '750')).rejects.toMatchObject({
          statusCode: 401,
        });
      });
    });

    // The same helper applies to createObject — reclassify lock/exists conflicts that arrive
    // on the create path (e.g., NW 7.50 ICM intercepts CX_ADT_RES_NO_ACCESS during create).
    describe('lock-conflict reclassification on createObject path', () => {
      const html = '<html><body>Logon Error Message — please log on again.</body></html>';

      function mockHttpThatRejectsCreate(status: number, body: string): AdtHttpClient {
        const post = vi.fn().mockRejectedValue(new AdtApiError('reject', status, '/url', body));
        return {
          get: vi.fn(),
          post,
          put: vi.fn(),
          delete: vi.fn(),
          fetchCsrfToken: vi.fn(),
          withStatefulSession: vi.fn(),
        } as unknown as AdtHttpClient;
      }

      it('reclassifies HTML body marker on 401 → 409 (Layer 2 with abapRelease<751)', async () => {
        const http = mockHttpThatRejectsCreate(401, html);
        await expect(
          createObject(
            http,
            unrestrictedSafetyConfig(),
            '/sap/bc/adt/ddic/ddl/sources',
            '<xml/>',
            'application/*',
            undefined,
            undefined,
            '750',
          ),
        ).rejects.toMatchObject({ statusCode: 409 });
      });

      it('reclassifies structured ExceptionResourceNoAccess regardless of release', async () => {
        const xml =
          '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><type id="ExceptionResourceNoAccess"/></exc:exception>';
        const http = mockHttpThatRejectsCreate(403, xml);
        await expect(
          createObject(
            http,
            unrestrictedSafetyConfig(),
            '/sap/bc/adt/ddic/ddl/sources',
            '<xml/>',
            'application/*',
            undefined,
            undefined,
            '758',
          ),
        ).rejects.toMatchObject({ statusCode: 409 });
      });

      it('does NOT reclassify when abapRelease>=751 and only HTML marker is present', async () => {
        const http = mockHttpThatRejectsCreate(401, html);
        await expect(
          createObject(
            http,
            unrestrictedSafetyConfig(),
            '/sap/bc/adt/ddic/ddl/sources',
            '<xml/>',
            'application/*',
            undefined,
            undefined,
            '758',
          ),
        ).rejects.toMatchObject({ statusCode: 401 });
      });
    });
  });

  // ─── unlockObject ──────────────────────────────────────────────────

  describe('unlockObject', () => {
    it('sends unlock request with handle', async () => {
      const http = mockHttp();
      await unlockObject(http, '/sap/bc/adt/programs/programs/ZTEST', 'HANDLE123');
      expect(http.post).toHaveBeenCalledWith(expect.stringContaining('_action=UNLOCK'));
      expect(http.post).toHaveBeenCalledWith(expect.stringContaining('lockHandle=HANDLE123'));
    });

    it('encodes lock handle in URL', async () => {
      const http = mockHttp();
      await unlockObject(http, '/sap/bc/adt/programs/programs/ZTEST', 'HANDLE WITH SPACE');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('lockHandle=HANDLE%20WITH%20SPACE');
    });
  });

  // ─── createObject ──────────────────────────────────────────────────

  describe('createObject', () => {
    it('sends create request without transport', async () => {
      const http = mockHttp();
      await createObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs', '<xml/>');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).not.toContain('corrNr');
    });

    it('sends create request with transport', async () => {
      const http = mockHttp();
      await createObject(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs',
        '<xml/>',
        'application/xml',
        'DEVK900001',
      );
      expect(http.post).toHaveBeenCalledWith(expect.stringContaining('corrNr=DEVK900001'), '<xml/>', 'application/xml');
    });

    it('adds _package query parameter when packageName is provided', async () => {
      const http = mockHttp();
      await createObject(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/bo/behaviordefinitions',
        '<xml/>',
        'application/xml',
        undefined,
        'ZPKG',
      );
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('_package=ZPKG');
    });

    it('adds both corrNr and _package when transport and packageName are provided', async () => {
      const http = mockHttp();
      await createObject(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/bo/behaviordefinitions',
        '<xml/>',
        'application/xml',
        'DEVK900001',
        'ZPKG',
      );
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('corrNr=DEVK900001');
      expect(url).toContain('_package=ZPKG');
    });

    it('encodes packageName when it contains special characters', async () => {
      const http = mockHttp();
      await createObject(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/bo/behaviordefinitions',
        '<xml/>',
        'application/xml',
        undefined,
        '/ABC/PKG SPACE',
      );
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('_package=%2FABC%2FPKG%20SPACE');
    });

    it('treats empty packageName as absent', async () => {
      const http = mockHttp();
      await createObject(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/bo/behaviordefinitions',
        '<xml/>',
        'application/xml',
        undefined,
        '',
      );
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).not.toContain('_package=');
    });

    it('is blocked in read-only mode', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(createObject(http, safety, '/url', '<xml/>')).rejects.toThrow(AdtSafetyError);
    });

    // ─── DTEL v1 content-type fallback (pre-7.52 compat) ────────────────

    it('retries DTEL v2 create with v1 MIME on HTTP 415', async () => {
      const http = mockHttp();
      // First call: 415 on the versioned v2 type (what NW 7.50 returns).
      // Second call: 201 after falling back to v1.
      const error415 = new AdtApiError('Unsupported Media Type', 415, '/sap/bc/adt/ddic/dataelements', '');
      (http.post as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(error415)
        .mockResolvedValueOnce({ statusCode: 201, body: '<created/>', headers: {} });

      await createObject(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/ddic/dataelements',
        '<wbobj/>',
        'application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8',
      );

      const calls = (http.post as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      // First call used v2
      expect(calls[0][2]).toBe('application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8');
      // Second call used v1
      expect(calls[1][2]).toBe('application/vnd.sap.adt.dataelements.v1+xml; charset=utf-8');
    });

    it('does not retry when 415 is returned for a non-fallback content type', async () => {
      const http = mockHttp();
      const error415 = new AdtApiError('Unsupported Media Type', 415, '/sap/bc/adt/oo/classes', '');
      (http.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error415);

      await expect(
        createObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes', '<xml/>', 'application/xml'),
      ).rejects.toThrow(error415);
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('does not retry on non-415 errors even for fallback-capable content types', async () => {
      const http = mockHttp();
      const error400 = new AdtApiError('Bad Request', 400, '/sap/bc/adt/ddic/dataelements', '');
      (http.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error400);

      await expect(
        createObject(
          http,
          unrestrictedSafetyConfig(),
          '/sap/bc/adt/ddic/dataelements',
          '<wbobj/>',
          'application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8',
        ),
      ).rejects.toThrow(error400);
      expect(http.post).toHaveBeenCalledTimes(1);
    });
  });

  // ─── updateSource ──────────────────────────────────────────────────

  describe('updateSource', () => {
    it('sends PUT with lock handle', async () => {
      const http = mockHttp();
      await updateSource(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        'REPORT z.',
        'HANDLE',
      );
      expect(http.put).toHaveBeenCalledWith(expect.stringContaining('lockHandle=HANDLE'), 'REPORT z.', 'text/plain');
    });

    it('includes transport in URL when provided', async () => {
      const http = mockHttp();
      await updateSource(http, unrestrictedSafetyConfig(), '/source/main', 'REPORT z.', 'HANDLE', 'DEVK900001');
      const url = (http.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('lockHandle=HANDLE');
      expect(url).toContain('corrNr=DEVK900001');
    });

    it('handles URL that already has query params', async () => {
      const http = mockHttp();
      await updateSource(http, unrestrictedSafetyConfig(), '/source/main?existing=true', 'source', 'HANDLE');
      const url = (http.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('existing=true');
      expect(url).toContain('&lockHandle=HANDLE'); // uses & not ?
    });

    it('is blocked in read-only mode', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(updateSource(http, safety, '/url', 'source', 'handle')).rejects.toThrow(AdtSafetyError);
    });
  });

  // ─── updateObject ──────────────────────────────────────────────────

  describe('updateObject', () => {
    it('sends PUT with lock handle and custom content type', async () => {
      const http = mockHttp();
      const body = '<doma:domain xmlns:doma="http://www.sap.com/dictionary/domain"/>';
      await updateObject(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/ddic/domains/ZTEST_DOMA',
        body,
        'HANDLE',
        'application/vnd.sap.adt.domains.v2+xml; charset=utf-8',
      );
      expect(http.put).toHaveBeenCalledWith(
        expect.stringContaining('lockHandle=HANDLE'),
        body,
        'application/vnd.sap.adt.domains.v2+xml; charset=utf-8',
      );
    });

    it('includes transport in URL when provided', async () => {
      const http = mockHttp();
      await updateObject(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/ddic/domains/ZTEST_DOMA',
        '<xml/>',
        'HANDLE',
        'application/xml',
        'DEVK900001',
      );
      const url = (http.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('lockHandle=HANDLE');
      expect(url).toContain('corrNr=DEVK900001');
    });

    it('is blocked in read-only mode', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(updateObject(http, safety, '/url', '<xml/>', 'handle', 'application/xml')).rejects.toThrow(
        AdtSafetyError,
      );
    });
  });

  // ─── deleteObject ──────────────────────────────────────────────────

  describe('deleteObject', () => {
    it('sends DELETE with lock handle', async () => {
      const http = mockHttp();
      await deleteObject(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST', 'HANDLE');
      expect(http.delete).toHaveBeenCalledWith(expect.stringContaining('lockHandle=HANDLE'));
    });

    it('includes transport in URL', async () => {
      const http = mockHttp();
      await deleteObject(http, unrestrictedSafetyConfig(), '/url', 'HANDLE', 'DEVK900001');
      const url = (http.delete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain('corrNr=DEVK900001');
    });

    it('is blocked in read-only mode', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(deleteObject(http, safety, '/url', 'handle')).rejects.toThrow(AdtSafetyError);
    });
  });

  // ─── safeUpdateSource ──────────────────────────────────────────────

  describe('safeUpdateSource', () => {
    it('performs lock → update → unlock in stateful session', async () => {
      const http = mockHttp();
      await safeUpdateSource(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs/ZTEST',
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        'REPORT ztest.',
      );
      expect(http.withStatefulSession).toHaveBeenCalled();
    });

    it('auto-propagates lock corrNr when no transport is supplied', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR>A4HK900100</CORRNR><IS_LOCAL></IS_LOCAL></DATA></asx:values></asx:abap>';
      const postMock = vi
        .fn()
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: lockBody })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: '' }); // unlock
      const putMock = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });

      const http = {
        ...mockHttp(),
        withStatefulSession: vi.fn().mockImplementation(async (fn: any) => fn({ post: postMock, put: putMock })),
      } as unknown as AdtHttpClient;

      await safeUpdateSource(http, unrestrictedSafetyConfig(), '/obj', '/obj/source/main', 'source');

      const putUrl = putMock.mock.calls[0]?.[0] as string;
      expect(putUrl).toContain('corrNr=A4HK900100');
    });

    it('uses explicit transport over lock corrNr', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR>A4HK900100</CORRNR><IS_LOCAL></IS_LOCAL></DATA></asx:values></asx:abap>';
      const postMock = vi
        .fn()
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: lockBody })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: '' });
      const putMock = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });

      const http = {
        ...mockHttp(),
        withStatefulSession: vi.fn().mockImplementation(async (fn: any) => fn({ post: postMock, put: putMock })),
      } as unknown as AdtHttpClient;

      await safeUpdateSource(http, unrestrictedSafetyConfig(), '/obj', '/obj/source/main', 'source', 'EXPLICIT_TR');

      const putUrl = putMock.mock.calls[0]?.[0] as string;
      expect(putUrl).toContain('corrNr=EXPLICIT_TR');
      expect(putUrl).not.toContain('A4HK900100');
    });

    it('does not add corrNr when lock returns empty and no transport supplied', async () => {
      // Default mockHttp returns empty CORRNR
      const http = mockHttp();
      const putMock = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });

      const customHttp = {
        ...http,
        withStatefulSession: vi.fn().mockImplementation(async (fn: any) => {
          const session = {
            post: (http as any).withStatefulSession.mock.results?.[0]
              ? undefined
              : vi
                  .fn()
                  .mockResolvedValueOnce({
                    statusCode: 200,
                    headers: {},
                    body: '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                  })
                  .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: '' }),
            put: putMock,
          };
          return fn(session);
        }),
      } as unknown as AdtHttpClient;

      await safeUpdateSource(customHttp, unrestrictedSafetyConfig(), '/obj', '/obj/source/main', 'source');

      const putUrl = putMock.mock.calls[0]?.[0] as string;
      expect(putUrl).not.toContain('corrNr');
    });

    it('no corrNr propagation for $TMP local objects', async () => {
      // $TMP objects return empty corrNr and isLocal=true — no transport needed
      const putMock = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });
      const postMock = vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: {},
          body: '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
        })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: '' });

      const http = {
        ...mockHttp(),
        withStatefulSession: vi.fn().mockImplementation(async (fn: any) => fn({ post: postMock, put: putMock })),
      } as unknown as AdtHttpClient;

      await safeUpdateSource(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs/ZTEST',
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        'REPORT ztest.',
      );

      const putUrl = putMock.mock.calls[0]?.[0] as string;
      expect(putUrl).not.toContain('corrNr');
    });

    it('unlocks even if update fails (try-finally)', async () => {
      const postMock = vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: {},
          body: '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
        })
        // unlock post
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: '' });
      const putMock = vi.fn().mockRejectedValueOnce(new Error('Update failed'));

      const http = {
        ...mockHttp(),
        withStatefulSession: vi.fn().mockImplementation(async (fn: any) => {
          const session = {
            post: postMock,
            put: putMock,
          };
          return fn(session);
        }),
      } as unknown as AdtHttpClient;

      await expect(
        safeUpdateSource(http, unrestrictedSafetyConfig(), '/obj', '/obj/source/main', 'source'),
      ).rejects.toThrow('Update failed');

      // Unlock should still have been called (via finally)
      expect(postMock).toHaveBeenCalledTimes(2); // lock + unlock
      const unlockUrl = postMock.mock.calls[1]?.[0] as string;
      expect(unlockUrl).toContain('_action=UNLOCK');
    });
  });

  // ─── safeUpdateObject ──────────────────────────────────────────────

  describe('safeUpdateObject', () => {
    it('performs lock → update → unlock in stateful session', async () => {
      const http = mockHttp();
      await safeUpdateObject(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/ddic/domains/ZTEST_DOMA',
        '<xml/>',
        'application/vnd.sap.adt.domains.v2+xml; charset=utf-8',
      );
      expect(http.withStatefulSession).toHaveBeenCalled();
    });

    it('auto-propagates lock corrNr when no transport is supplied', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR>A4HK900100</CORRNR><IS_LOCAL></IS_LOCAL></DATA></asx:values></asx:abap>';
      const postMock = vi
        .fn()
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: lockBody })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: '' });
      const putMock = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' });

      const http = {
        ...mockHttp(),
        withStatefulSession: vi.fn().mockImplementation(async (fn: any) => fn({ post: postMock, put: putMock })),
      } as unknown as AdtHttpClient;

      await safeUpdateObject(http, unrestrictedSafetyConfig(), '/obj', '<xml/>', 'application/xml');

      const putUrl = putMock.mock.calls[0]?.[0] as string;
      expect(putUrl).toContain('corrNr=A4HK900100');
    });

    it('unlocks even if update fails (try-finally)', async () => {
      const postMock = vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: {},
          body: '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
        })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: '' });
      const putMock = vi.fn().mockRejectedValueOnce(new Error('Update failed'));

      const http = {
        ...mockHttp(),
        withStatefulSession: vi.fn().mockImplementation(async (fn: any) => fn({ post: postMock, put: putMock })),
      } as unknown as AdtHttpClient;

      await expect(
        safeUpdateObject(http, unrestrictedSafetyConfig(), '/obj', '<xml/>', 'application/xml'),
      ).rejects.toThrow('Update failed');

      expect(postMock).toHaveBeenCalledTimes(2); // lock + unlock
      const unlockUrl = postMock.mock.calls[1]?.[0] as string;
      expect(unlockUrl).toContain('_action=UNLOCK');
    });
  });
});

/**
 * Tool-dispatch & cross-cutting handler unit tests — split from the former intent.test.ts monolith.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { features, featuresOff } from './handler-test-config.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall, hasRequiredScope, TOOL_SCOPES } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { normalizeObjectType, stripLlmEmptyValues, normalizeTypeArgsForValidation } = await import(
  '../../../src/handlers/object-types.js'
);
const { warnCdsReservedKeywords } = await import('../../../src/handlers/cds-hints.js');

describe('tool dispatch & cross-cutting handler behavior', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'UnknownTool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Unknown tool');
    });
  });

  describe('error handling', () => {
    it('returns isError=true for all error responses', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'INVALID_TYPE',
        name: 'X',
      });
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
    });

    it('catches non-Error exceptions', async () => {
      // This tests the catch(err) path with a non-Error value
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        safety: { ...unrestrictedSafetyConfig(), allowFreeSQL: false },
      });
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPQuery', {
        sql: 'SELECT * FROM T000',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('scope enforcement', () => {
    const readAuth: AuthInfo = {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const writeAuth: AuthInfo = {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read', 'write'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const dataAuth: AuthInfo = {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read', 'data'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const sqlAuth: AuthInfo = {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read', 'sql'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    it('allows SAPRead with read scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZHELLO' },
        readAuth,
      );
      expect(result.isError).toBeUndefined();
    });

    // ── Privilege-escalation regression (security audit 2026-06) ──
    // The scope key must be derived from the SAME normalized value the handler
    // dispatches on. Before the fix, the lookup read the RAW `type`, so a value
    // that missed the `SAPRead.TABLE_CONTENTS` policy key here — but was then
    // canonicalized into the data-scoped `TABLE_CONTENTS` for the handler —
    // slipped past the gate with only `read` scope. Two such forms existed:
    it('blocks SAPRead TABLE_CONTENTS passed as an ARRAY with read-only scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        // typeof ["TABLE_CONTENTS"] === "object" → used to yield an undefined
        // policy key → base `read`; String() coercion now maps it to the
        // data-scoped TABLE_CONTENTS policy.
        { type: ['TABLE_CONTENTS'], name: 'T000' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'data'");
    });

    it('blocks SAPRead TABLE_CONTENTS passed as a LOWERCASE string with read-only scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        // "table_contents" matched no policy key (keys are upper-case) → base
        // `read`; normalizing first upper-cases it before the lookup.
        { type: 'table_contents', name: 'T000' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'data'");
    });

    it('allows SAPRead TABLE_CONTENTS in array form with data scope (normalization keeps the legit path)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: ['TABLE_CONTENTS'], name: 'T000' },
        dataAuth,
      );
      // Scope check passes (data ≥ data); it may still fail downstream for
      // non-scope reasons, but must NOT be a scope rejection.
      expect(result.content[0]?.text ?? '').not.toContain('Insufficient scope');
    });

    it('blocks SAPWrite with read-only scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPWrite',
        { type: 'PROG', name: 'ZHELLO', source: 'test' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'write'");
      expect(result.content[0]?.text).toContain('SAPWrite');
    });

    it('allows SAPWrite with write scope', async () => {
      // SAPWrite will fail (unknown tool in switch), but it should NOT be blocked by scope
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPWrite',
        { type: 'PROG', name: 'ZHELLO', source: 'test' },
        writeAuth,
      );
      // Should reach the switch statement, not be blocked by scope
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it('allows SAPTransport with write scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPTransport',
        { action: 'list' },
        writeAuth,
      );
      // Should reach the switch, not blocked by scope
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it('allows SAPTransport read actions with read scope (v0.7: check/history/list/get require read, not write)', async () => {
      // This test inverts the v0.6 behavior — SAPTransport.list is now classified as read.
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPTransport', { action: 'list' }, readAuth);
      // Not blocked by scope — may error for other reasons (e.g., SAP backend), but not "Insufficient scope".
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it('blocks SAPTransport write actions with read scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPTransport',
        { action: 'create', description: 'Test' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'transports'");
    });

    it('allows SAPManage probe/features actions with read scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'features' },
        readAuth,
      );
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it('blocks SAPManage write actions with read scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'create_package' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'write'");
      expect(result.content[0]?.text).toContain('SAPManage(action="create_package")');
    });

    it('blocks SAP(manage) write sub-action escalation with read scope', async () => {
      // Hyperfocused SAP.manage is a coarse "go call SAPManage"; action-level check happens
      // downstream when the inner SAPManage action is dispatched, not here.
      // The hyperfocused outer call requires 'write' scope (SAP.manage is write in ACTION_POLICY).
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAP',
        { action: 'manage', params: { action: 'create_package' } },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Insufficient scope');
    });

    it('allows SAPManage write actions with write scope (scope check passes)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'create_package' },
        writeAuth,
      );
      // Should proceed to handler-level validation, not action-scope rejection.
      expect(result.content[0]?.text).not.toContain("Insufficient scope: 'write'");
      expect(result.content[0]?.text).toContain('"name" is required');
    });

    it('blocks SAPQuery with read-only scope (requires sql)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPQuery',
        { sql: 'SELECT * FROM t000' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'sql'");
    });

    it('blocks SAPQuery with data-only scope (requires sql)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPQuery',
        { sql: 'SELECT * FROM t000' },
        dataAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'sql'");
    });

    it('allows SAPQuery with sql scope (sql implies data)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPQuery',
        { sql: 'SELECT * FROM t000' },
        sqlAuth,
      );
      // Should reach the handler, not blocked by scope
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it("blocks SAPSearch tadir_lookup source='db' with viewer (read-only) scope", async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPSearch',
        { searchType: 'tadir_lookup', names: ['ZA'], source: 'db' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'sql'");
    });

    it("blocks SAPSearch tadir_lookup source='both' with viewer (read-only) scope", async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPSearch',
        { searchType: 'tadir_lookup', names: ['ZA'], source: 'both' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'sql'");
    });

    it("allows SAPSearch tadir_lookup default (source='adt' / unset) with read scope", async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPSearch',
        { searchType: 'tadir_lookup', names: ['ZA'] },
        readAuth,
      );
      // Should reach the handler — not blocked by scope.
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it('allows all tools when no authInfo (backward compat)', async () => {
      // No authInfo = no scope enforcement (stdio mode, API key without XSUAA)
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZHELLO' });
      expect(result.isError).toBeUndefined();
    });

    it('includes user scopes in error message', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {}, readAuth);
      expect(result.content[0]?.text).toContain('Your scopes: [read]');
    });

    it('write scope implies read for SAPRead', async () => {
      // User with only write scope (no explicit read) can access SAPRead
      const writeOnlyAuth: AuthInfo = {
        token: 'test-token',
        clientId: 'test-client',
        scopes: ['write'],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZHELLO' },
        writeOnlyAuth,
      );
      expect(result.isError).toBeUndefined();
    });
  });

  describe('TOOL_SCOPES (back-compat re-export derived from ACTION_POLICY)', () => {
    it('maps read tools to read scope', () => {
      // SAPTransport is now read at tool-level (check/history/list/get).
      // Mutations require the `transports` scope via action-level policy.
      for (const tool of [
        'SAPRead',
        'SAPSearch',
        'SAPNavigate',
        'SAPContext',
        'SAPLint',
        'SAPDiagnose',
        'SAPGit',
        'SAPTransport',
      ]) {
        expect(TOOL_SCOPES[tool]).toBe('read');
      }
    });

    it('maps write tools to write scope', () => {
      // SAPManage default is write (create/delete/change_package mutate); individual
      // read actions (features/probe/cache_stats/flp_list_*) have action-level read scope.
      for (const tool of ['SAPWrite', 'SAPActivate', 'SAPManage']) {
        expect(TOOL_SCOPES[tool]).toBe('write');
      }
    });

    it('maps SAPQuery to sql scope', () => {
      expect(TOOL_SCOPES.SAPQuery).toBe('sql');
    });

    it('covers all 12 tools', () => {
      expect(Object.keys(TOOL_SCOPES)).toHaveLength(12);
    });
  });

  describe('hasRequiredScope', () => {
    function makeAuth(scopes: string[]): AuthInfo {
      return {
        token: 'test-token',
        clientId: 'test-client',
        scopes,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
    }

    it('returns true for direct scope match', () => {
      expect(hasRequiredScope(makeAuth(['read']), 'read')).toBe(true);
      expect(hasRequiredScope(makeAuth(['write']), 'write')).toBe(true);
      expect(hasRequiredScope(makeAuth(['data']), 'data')).toBe(true);
      expect(hasRequiredScope(makeAuth(['sql']), 'sql')).toBe(true);
    });

    it('returns false when scope is missing', () => {
      expect(hasRequiredScope(makeAuth(['read']), 'write')).toBe(false);
      expect(hasRequiredScope(makeAuth(['read']), 'data')).toBe(false);
      expect(hasRequiredScope(makeAuth(['data']), 'read')).toBe(false);
    });

    it('write implies read', () => {
      expect(hasRequiredScope(makeAuth(['write']), 'read')).toBe(true);
    });

    it('sql implies data', () => {
      expect(hasRequiredScope(makeAuth(['sql']), 'data')).toBe(true);
    });

    it('write does NOT imply data', () => {
      expect(hasRequiredScope(makeAuth(['write']), 'data')).toBe(false);
    });

    it('sql does NOT imply read', () => {
      expect(hasRequiredScope(makeAuth(['sql']), 'read')).toBe(false);
    });

    it('returns false for empty scopes', () => {
      expect(hasRequiredScope(makeAuth([]), 'read')).toBe(false);
      expect(hasRequiredScope(makeAuth([]), 'write')).toBe(false);
      expect(hasRequiredScope(makeAuth([]), 'data')).toBe(false);
      expect(hasRequiredScope(makeAuth([]), 'sql')).toBe(false);
    });

    it('admin scope implies ALL other scopes (v0.7 change)', () => {
      expect(hasRequiredScope(makeAuth(['admin']), 'read')).toBe(true);
      expect(hasRequiredScope(makeAuth(['admin']), 'write')).toBe(true);
      expect(hasRequiredScope(makeAuth(['admin']), 'data')).toBe(true);
      expect(hasRequiredScope(makeAuth(['admin']), 'sql')).toBe(true);
      expect(hasRequiredScope(makeAuth(['admin']), 'transports')).toBe(true);
      expect(hasRequiredScope(makeAuth(['admin']), 'git')).toBe(true);
    });
  });

  describe('error guidance', () => {
    it('404 error includes SAPSearch hint', async () => {
      mockFetch.mockReset();
      // Make the mock reject with a 404 AdtApiError
      mockFetch.mockRejectedValueOnce(
        new AdtApiError('Not found', 404, '/sap/bc/adt/programs/programs/ZNONEXIST/source/main'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZNONEXIST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAPSearch');
      expect(result.content[0]?.text).toContain('ZNONEXIST');
    });

    it('401 error includes client hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(new AdtApiError('Auth failed', 401, '/sap/bc/adt/core/discovery'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP_CLIENT');
    });
  });

  describe('SAP domain error classification hints', () => {
    it('409 lock conflict XML returns SM12 hint with extracted user', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Conflict',
          409,
          '/sap/bc/adt/programs/programs/ZPROG/source/main',
          `<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <type id="ExceptionResourceLockedByAnotherUser"/>
  <exc:localizedMessage lang="EN">Object is locked by user DEVELOPER in task E19K900001</exc:localizedMessage>
</exc:exception>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SM12');
      expect(result.content[0]?.text).toContain('DEVELOPER');
      expect(result.content[0]?.text).toContain('E19K900001');
    });

    it('423 lock handle error returns enqueue hint (release unknown → combined guidance)', async () => {
      resetCachedFeatures(); // no detected release → unknown-release branch
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Locked',
          423,
          '/sap/bc/adt/ddic/ddl/sources/ZI_TEST/source/main',
          '<exc:exception><type id="ExceptionResourceInvalidLockHandle"/><localizedMessage>Invalid lock handle</localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Lock handle is invalid or expired');
      // Release unknown → still point at the real fix for < 7.51 (abapfs_extensions);
      // SAP Note 2727890 is kept only as a "separate, narrow bug" mention (issue #293).
      expect(result.content[0]?.text).toContain('abapfs_extensions');
      expect(result.content[0]?.text).toContain('2727890');
    });

    it('423 on detected SAP_BASIS < 7.51 leads with the abapfs_extensions fix', async () => {
      setCachedFeatures({ ...featuresOff(), abapRelease: '750', systemType: 'onprem' });
      try {
        mockFetch.mockReset();
        mockFetch.mockRejectedValueOnce(
          new AdtApiError(
            'Locked',
            423,
            '/sap/bc/adt/programs/programs/ZPROG/source/main',
            '<exc:exception><type id="ExceptionResourceInvalidLockHandle"/></exc:exception>',
          ),
        );
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('abapfs_extensions');
        expect(result.content[0]?.text).toContain('750');
      } finally {
        resetCachedFeatures();
      }
    });

    it('423 on detected SAP_BASIS >= 7.51 does NOT mention abapfs_extensions', async () => {
      setCachedFeatures({ ...featuresOff(), abapRelease: '758', systemType: 'onprem' });
      try {
        mockFetch.mockReset();
        mockFetch.mockRejectedValueOnce(
          new AdtApiError(
            'Locked',
            423,
            '/sap/bc/adt/programs/programs/ZPROG/source/main',
            '<exc:exception><type id="ExceptionResourceInvalidLockHandle"/></exc:exception>',
          ),
        );
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).not.toContain('abapfs_extensions');
        expect(result.content[0]?.text).toContain('Retry first');
      } finally {
        resetCachedFeatures();
      }
    });

    it('403 authorization XML returns SU53/PFCG hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Forbidden',
          403,
          '/sap/bc/adt/programs/programs/ZPROG/source/main',
          '<exc:exception><type id="ExceptionNotAuthorized"/><localizedMessage>No authorization for S_DEVELOP</localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SU53');
      expect(result.content[0]?.text).toContain('PFCG');
      expect(result.content[0]?.text).toContain('S_DEVELOP');
    });

    it('409 already-exists error returns object-exists hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Conflict',
          409,
          '/sap/bc/adt/ddic/ddl/sources',
          '<exc:exception><type id="ExceptionResourceCreationFailure"/><localizedMessage>Object does already exist</localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZA_TEST' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('already exists');
      expect(result.content[0]?.text).toContain('action="update"');
    });

    it('400 activation dependency message returns activation hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Bad request',
          400,
          '/sap/bc/adt/activation',
          'Activation failed: dependency ZI_TRAVEL is inactive and not active',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'DDLS',
        name: 'ZI_TRAVEL',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("SAPRead(type='INACTIVE_OBJECTS')");
      expect(result.content[0]?.text).toContain('SAPActivate');
    });

    it('unclassifiable 409 falls through without domain-specific hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError('Conflict', 409, '/sap/bc/adt/programs/programs/ZPROG/source/main', 'generic conflict'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toContain('SM12');
      expect(result.content[0]?.text).not.toContain('SU53');
      expect(result.content[0]?.text).not.toContain('INACTIVE_OBJECTS');
    });

    it('audit logging includes domain category in errorClass', async () => {
      const auditSpy = vi.spyOn(logger, 'emitAudit');
      try {
        mockFetch.mockReset();
        mockFetch.mockRejectedValueOnce(
          new AdtApiError(
            'Conflict',
            409,
            '/sap/bc/adt/programs/programs/ZPROG/source/main',
            '<exc:exception><type id="ExceptionResourceLockedByAnotherUser"/><localizedMessage>Object is locked by user DEV1 in task E19K900001</localizedMessage></exc:exception>',
          ),
        );

        await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'PROG',
          name: 'ZPROG',
        });

        const endEvent = auditSpy.mock.calls
          .map(([event]) => event)
          .find(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              (event as { event?: string; status?: string }).event === 'tool_call_end' &&
              (event as { event?: string; status?: string }).status === 'error',
          ) as { errorClass?: string } | undefined;
        expect(endEvent?.errorClass).toBe('AdtApiError:lock-conflict');
      } finally {
        auditSpy.mockRestore();
      }
    });

    it('network errors include probe-first connectivity guidance', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8000'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Cannot reach the SAP system');
      expect(result.content[0]?.text).toContain('SAPRead(type="SYSTEM")');
      expect(result.content[0]?.text).toContain('batch/parallel');
    });

    it('network errors on SAPRead SYSTEM mention failed probe specifically', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8000'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'SYSTEM' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Connectivity probe failed');
      expect(result.content[0]?.text).toContain('before running any batch or parallel tool calls');
    });
  });

  describe('BTP ABAP handler adaptation', () => {
    /** Create minimal BTP-detected features for testing */
    function setBtpMode(): void {
      setCachedFeatures({
        ...features({ abapGit: false, gcts: false, amdp: false, ui5: false, ui5repo: false, flp: false }),
        abapRelease: '758',
        systemType: 'btp',
      });
    }

    afterEach(() => {
      resetCachedFeatures();
    });

    it('returns helpful error for PROG read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'RSHOWTIM',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
      expect(result.content[0]?.text).toContain('IF_OO_ADT_CLASSRUN');
    });

    it('returns helpful error for INCL read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'INCL',
        name: 'ZSOME_INCLUDE',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
      expect(result.content[0]?.text).toContain('ABAP Cloud');
    });

    it('returns helpful error for VIEW read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VIEW',
        name: 'V_T002',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
      expect(result.content[0]?.text).toContain('CDS views');
    });

    it('returns helpful error for TEXT_ELEMENTS read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TEXT_ELEMENTS',
        name: 'RSHOWTIM',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
    });

    it('returns helpful error for VARIANTS read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VARIANTS',
        name: 'RSHOWTIM',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
    });

    it('returns helpful error for SOBJ read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'SOBJ',
        name: 'BUS2032',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
      expect(result.content[0]?.text).toContain('BDEF');
    });

    it('allows CLAS read on BTP (works normally)', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
      });
      // Should succeed (not an error about BTP)
      expect(result.isError).toBeUndefined();
    });

    it('returns helpful error for TRAN read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TRAN',
        name: 'SE38',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
    });

    it('allows TABL read of a DDIC structure on BTP (via /tables/→/structures/ fallback)', async () => {
      setBtpMode();
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, '@EndUserText.label : "Return Parameter"\ndefine type bapiret2 { ... }'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'BAPIRET2',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('bapiret2');
    });

    it('rejects type=STRU on BTP at the schema layer', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'STRU',
        name: 'BAPIRET2',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPRead');
    });
  });

  describe('hyperfocused mode (SAP tool)', () => {
    it('routes SAP(read) to SAPRead', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAP', {
        action: 'read',
        type: 'PROG',
        name: 'ZHELLO',
      });
      expect(result.isError).toBeUndefined();
      // Should get the same result as SAPRead(PROG)
      expect(result.content[0]?.text).toBeTruthy();
    });

    it('returns error for unknown SAP action', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAP', {
        action: 'invalid_action',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Unknown action');
    });

    it('routes SAP(search) with params', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAP', {
        action: 'search',
        params: { query: 'ZCL*' },
      });
      // Should succeed (mock returns data)
      expect(result.isError).toBeUndefined();
    });
  });

  describe('normalizeObjectType', () => {
    it('normalizes all supported slash-type mappings', () => {
      // Issue #218 audit follow-up: every entry below is verified against either
      // Eclipse ADT apidoc 3.58.1 or live a4h+npl ADT responses captured
      // 2026-05-08. See research/abap-types/types/<short>.md.
      const mappings: Array<[string, string]> = [
        ['PROG/P', 'PROG'],
        ['PROG/I', 'INCL'],
        ['CLAS/OC', 'CLAS'],
        ['INTF/OI', 'INTF'],
        ['FUGR/F', 'FUGR'], // function group container
        ['FUGR/FF', 'FUNC'], // function module — routes to FUNC, not FUGR
        ['DDLS/DF', 'DDLS'],
        ['DCLS/DL', 'DCLS'],
        ['BDEF/BDO', 'BDEF'],
        ['SRVD/SRV', 'SRVD'],
        ['SRVB/SVB', 'SRVB'],
        ['DDLX/EX', 'DDLX'],
        // TABL/DT (transparent table) and TABL/DS (DDIC structure) both
        // collapse to the canonical 'TABL' short type (Model B). STRU/DS is
        // a legacy slash-form alias that also maps to TABL. Bare 'STRU' is
        // intentionally NOT aliased so schema validation rejects it.
        ['TABL/DT', 'TABL'],
        ['TABL/DS', 'TABL'],
        ['STRU/DS', 'TABL'],
        ['DOMA/DD', 'DOMA'],
        ['DTEL/DE', 'DTEL'],
        ['MSAG/N', 'MSAG'],
        ['DEVC/K', 'DEVC'],
        ['TRAN/T', 'TRAN'], // was 'TRAN/O' pre-audit — ADT actually emits TRAN/T
        ['VIEW/DV', 'VIEW'], // was 'VIEW/V' pre-audit — ADT actually emits VIEW/DV
        ['SKTD/TYP', 'SKTD'],
      ];

      for (const [input, expected] of mappings) {
        expect(normalizeObjectType(input)).toBe(expected);
      }
    });

    it('passes through invented slash codes removed in PR (regression guard)', () => {
      // These were aliased pre-audit. The audit (research/abap-types/) verified
      // they don't exist in ADT or any SAP source. Pass-through means schema
      // validation rejects them loudly so the breaking change surfaces.
      expect(normalizeObjectType('FUNC/FM')).toBe('FUNC/FM');
      expect(normalizeObjectType('CLAS/LI')).toBe('CLAS/LI');
      expect(normalizeObjectType('VIEW/V')).toBe('VIEW/V');
      expect(normalizeObjectType('TRAN/O')).toBe('TRAN/O');
    });

    it('is case-insensitive for friendly and slash types', () => {
      expect(normalizeObjectType('clas')).toBe('CLAS');
      expect(normalizeObjectType('Prog/P')).toBe('PROG');
      expect(normalizeObjectType('ktd')).toBe('SKTD');
    });

    it('passes through already-correct types', () => {
      expect(normalizeObjectType('CLAS')).toBe('CLAS');
      expect(normalizeObjectType('PROG')).toBe('PROG');
    });

    it('passes through unknown types', () => {
      expect(normalizeObjectType('UNKNOWN')).toBe('UNKNOWN');
    });

    it('returns empty string for empty or whitespace input', () => {
      expect(normalizeObjectType('')).toBe('');
      expect(normalizeObjectType('   ')).toBe('');
    });
  });

  describe('type auto-mappings wiring', () => {
    it('normalizes SAPWrite create type "CLAS/OC" to class endpoint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'CLAS/OC',
        name: 'ZCL_NORMALIZED',
      });

      expect(result.isError).toBeUndefined();
      const createCall = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('/sap/bc/adt/oo/classes') &&
          typeof c[1] === 'object' &&
          (c[1] as Record<string, unknown>).method === 'POST',
      );
      expect(createCall).toBeDefined();
    });

    it('normalizes SAPRead type "clas" to class read endpoint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, 'CLASS zcl_test DEFINITION.\nENDCLASS.', { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'clas',
        name: 'ZCL_TEST',
      });

      expect(result.isError).toBeUndefined();
      const readCall = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('/sap/bc/adt/oo/classes/'),
      );
      expect(readCall).toBeDefined();
    });
  });

  describe('5xx error hints in formatErrorForLLM', () => {
    it('500 error includes server error hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(500, 'Internal Server Error', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP application server error');
      expect(result.content[0]?.text).toContain('500');
      expect(result.content[0]?.text).toContain('SAPDiagnose');
    });

    it('503 error includes server error hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(503, 'Service Unavailable', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP application server error');
      expect(result.content[0]?.text).toContain('503');
    });

    it('502 error includes server error hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(502, 'Bad Gateway', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP application server error');
      expect(result.content[0]?.text).toContain('502');
    });
  });

  describe('SAP error enrichment in formatErrorForLLM', () => {
    it('includes additional localized messages from SAP XML response', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">DDL source could not be saved</exc:localizedMessage>
  <exc:localizedMessage lang="EN">Field "POSITION" is a reserved keyword (line 5, col 3)</exc:localizedMessage>
  <exc:localizedMessage lang="EN">Check CDS documentation for valid identifiers</exc:localizedMessage>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, xmlResponse, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Additional detail');
      expect(result.content[0]?.text).toContain('reserved keyword');
    });

    it('includes DDIC diagnostics instead of raw properties for T100KEY errors', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Syntax error in DDL source</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-NO">039</entry>
    <entry key="LINE">15</entry>
    <entry key="COLUMN">8</entry>
  </exc:properties>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, xmlResponse, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      // DDIC diagnostics replace raw Properties when T100KEY entries are present
      expect(result.content[0]?.text).toContain('DDIC diagnostics:');
      expect(result.content[0]?.text).toContain('Line 15');
      expect(result.content[0]?.text).not.toContain('Properties:');
    });

    it('includes raw properties for non-DDIC errors without T100KEY entries', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Some generic error</exc:localizedMessage>
  <exc:properties>
    <entry key="MSG_ID">CL</entry>
    <entry key="SEVERITY">E</entry>
  </exc:properties>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, xmlResponse, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Properties:');
      expect(result.content[0]?.text).toContain('MSG_ID=CL');
      expect(result.content[0]?.text).not.toContain('DDIC diagnostics:');
    });

    it('hides SAP diagnostic details from client-facing errors when minimal errors are enabled', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Object is locked by SECRETUSER</exc:localizedMessage>
  <exc:properties>
    <entry key="LOCK_USER">SECRETUSER</entry>
    <entry key="TRANSPORT">DEVK900001</entry>
  </exc:properties>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(423, xmlResponse, { 'x-csrf-token': 'T' }));

      const detailed = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(detailed.isError).toBe(true);
      expect(detailed.content[0]?.text).toContain('SECRETUSER');
      expect(detailed.content[0]?.text).toContain('DEVK900001');

      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(423, xmlResponse, { 'x-csrf-token': 'T' }));
      const minimal = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors: true }, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });

      expect(minimal.isError).toBe(true);
      const text = minimal.content[0]?.text ?? '';
      expect(text).toContain('ADT API error: status 423');
      expect(text).toContain('ARC1_MINIMAL_ERRORS=true');
      expect(text).not.toContain('SECRETUSER');
      expect(text).not.toContain('DEVK900001');
      expect(text).not.toContain('Properties:');
    });

    it('includes DDIC diagnostics block when T100KEY entries are present', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Can't save due to errors in source</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-MSGID">SBD_MESSAGES</entry>
    <entry key="T100KEY-MSGNO">007</entry>
    <entry key="T100KEY-V1">FIELD_X</entry>
    <entry key="LINE">5</entry>
  </exc:properties>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, xmlResponse, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('DDIC diagnostics:');
      expect(result.content[0]?.text).toContain('[SBD_MESSAGES/007]');
    });

    it('does not add DDIC diagnostics block when no DDIC details are present', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Object not found</exc:localizedMessage>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, xmlResponse, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toContain('DDIC diagnostics:');
    });

    it('adds DDIC save hint for 400 with TABL type', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, 'Bad Request', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Hint: DDIC save failed.');
    });

    it('adds DDIC save hint for 409 with BDEF type', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(409, 'Conflict', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BDEF',
        name: 'ZI_TEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Hint: DDIC save failed.');
    });

    it('adds a BDEF base-extensible hint for behavior extension create failures', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          400,
          '<exc:exception><localizedMessage>Behavior Definition ZR_BASE is not marked as extensible</localizedMessage></exc:exception>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'BDEF',
        name: 'ZR_BASE_X',
        package: '$TMP',
        source: 'extension implementation in class zbp_base_x unique;\nextend behavior for ZR_BASE\n{\n}',
      });
      const text = result.content[0]?.text ?? '';
      expect(result.isError).toBe(true);
      expect(text).toContain('Behavior Definition ZR_BASE is not marked as extensible');
      expect(text).toContain('Hint: The base behavior definition is not extensible');
      expect(text).toContain('mapping ... corresponding extensible');
    });

    it('keeps DDIC hint for generic "already exists" conflicts without creation signatures', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          409,
          '<exc:exception><localizedMessage>Activation failed: element already exists in metadata extension</localizedMessage></exc:exception>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BDEF',
        name: 'ZI_TEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Hint: DDIC save failed.');
      expect(result.content[0]?.text).not.toContain('choose a different name');
    });

    it('adds behavior-pool save failure remediation hint for generic CLAS save errors', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);

        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        if (method === 'PUT' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
          return Promise.reject(
            new AdtApiError(
              'Bad Request',
              400,
              '/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main',
              '<exc:exception><localizedMessage>An error occured during the save operation. The changes were not stored.</localizedMessage></exc:exception>',
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const source = `CLASS zbp_i_travelreq DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zi_travelreq.
ENDCLASS.
CLASS zbp_i_travelreq IMPLEMENTATION.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        source,
        lintBeforeWrite: false,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('scaffold_rap_handlers');
      expect(result.content[0]?.text).toContain('edit_method');
    });

    it('does not add DDIC hint for 404 not-found path', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('was not found');
      expect(result.content[0]?.text).not.toContain('Hint: DDIC save failed.');
    });

    it('does not add DDIC hint for non-DDIC types', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, 'Bad Request', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toContain('Hint: DDIC save failed.');
    });
  });

  describe('warnCdsReservedKeywords', () => {
    it('detects "position" as a reserved keyword', () => {
      const source = `define view entity ZI_Football as select from ztab {
  key id : abap.int4;
  position : abap.int4;
  player_name : abap.char(40);
}`;
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeDefined();
      expect(warning).toContain('position');
      expect(warning).toContain('reserved keyword');
    });

    it('detects multiple reserved keywords', () => {
      const source = `define view entity ZI_Test as select from ztab {
  key id : abap.int4;
  position : abap.int4;
  value : abap.dec(10,2);
  type : abap.char(4);
}`;
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeDefined();
      expect(warning).toContain('position');
      expect(warning).toContain('value');
      expect(warning).toContain('type');
    });

    it('ignores normal field names', () => {
      const source = `define view entity ZI_Test as select from ztab {
  key travel_id : abap.int4;
  customer_name : abap.char(40);
  booking_date : abap.dats;
}`;
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeUndefined();
    });

    it('works with nested structures', () => {
      const source = `define view entity ZI_Test as select from ztab {
  key id : abap.int4;
  position : abap.int4;
} composition [0..*] of ZI_Child as _Child`;
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeDefined();
      expect(warning).toContain('position');
    });

    it('returns undefined for source without braces', () => {
      const source = 'extend view entity ZI_Base with';
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeUndefined();
    });

    it('handles key fields with reserved names', () => {
      const source = `define view entity ZI_Test as select from ztab {
  key name : abap.char(40);
  description : abap.char(80);
}`;
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeDefined();
      expect(warning).toContain('name');
      expect(warning).toContain('description');
    });
  });

  describe('cookie-aware error hint in formatErrorForLLM', () => {
    it('emits cookie refresh hint on 401 when cookieFile is configured', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(401, 'Unauthorized'));
      const result = await handleToolCall(
        createClient(),
        { ...DEFAULT_CONFIG, cookieFile: '/path/to/cookies.txt' },
        'SAPRead',
        { type: 'PROG', name: 'ZTEST' },
      );
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('SAP cookies have expired');
      expect(text).toContain('arc1-cli extract-cookies');
      expect(text).toContain('no restart needed');
      expect(text).not.toContain('Check SAP_CLIENT');
    });

    it('emits cookie refresh hint on 401 when cookieString is configured', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(401, 'Unauthorized'));
      const result = await handleToolCall(
        createClient(),
        { ...DEFAULT_CONFIG, cookieString: 'MYSAPSSO2=xyz' },
        'SAPRead',
        { type: 'PROG', name: 'ZTEST' },
      );
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('SAP cookies have expired');
      expect(text).toContain('arc1-cli extract-cookies');
    });

    it('falls back to standard auth hint on 401 when no cookie auth is configured', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(401, 'Unauthorized'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Check SAP_CLIENT');
      expect(text).not.toContain('SAP cookies have expired');
    });
  });
});

describe('stripLlmEmptyValues (issue #360 GPT/OpenAI pollution)', () => {
  it('strips null-valued keys (strict-mode optional emulation emits null)', () => {
    const out = stripLlmEmptyValues({
      action: 'create',
      type: 'DTEL',
      name: 'Z',
      serviceDefinition: null,
      group: null,
    });
    expect(out).toEqual({ action: 'create', type: 'DTEL', name: 'Z' });
  });

  it('strips empty / whitespace-only strings', () => {
    const out = stripLlmEmptyValues({ action: 'update', type: 'DTEL', name: 'Z', odataVersion: '', source: '   ' });
    expect(out).toEqual({ action: 'update', type: 'DTEL', name: 'Z' });
  });

  it('PRESERVES real boolean false (must not be treated as empty)', () => {
    const out = stripLlmEmptyValues({ signExists: false, lowercase: false });
    expect(out).toEqual({ signExists: false, lowercase: false });
  });

  it('PRESERVES numeric 0 (must not be treated as empty)', () => {
    const out = stripLlmEmptyValues({ length: 0, decimals: 0 });
    expect(out).toEqual({ length: 0, decimals: 0 });
  });

  it('keeps an empty STRING for meaningful-empty fields (target, proposalUserContent) but still strips null', () => {
    const keptEmpty = stripLlmEmptyValues({ action: 'create', target: '   ', proposalUserContent: '' });
    expect(keptEmpty).toEqual({ action: 'create', target: '   ', proposalUserContent: '' });
    const nullStillStripped = stripLlmEmptyValues({ action: 'create', target: null });
    expect(nullStillStripped).toEqual({ action: 'create' });
  });

  it('sanitizes each objects[] item (null/empty dropped per item)', () => {
    const out = stripLlmEmptyValues({
      action: 'batch_create',
      objects: [{ type: 'DTEL', name: 'Z1', serviceDefinition: null, source: '' }],
    });
    expect(out.objects).toEqual([{ type: 'DTEL', name: 'Z1' }]);
  });

  it('does NOT recurse into leaf data arrays (fixedValues keeps its inner empty strings)', () => {
    const out = stripLlmEmptyValues({
      action: 'create',
      type: 'DOMA',
      name: 'Z',
      fixedValues: [{ low: '', high: '', description: '' }],
    });
    expect(out.fixedValues).toEqual([{ low: '', high: '', description: '' }]);
  });

  it('returns a new object and does not mutate the input', () => {
    const input = { a: null, b: 'keep' };
    const out = stripLlmEmptyValues(input);
    expect(out).toEqual({ b: 'keep' });
    expect(input).toEqual({ a: null, b: 'keep' });
  });
});

describe('normalizeTypeArgsForValidation include-drop + strip wiring (issue #360)', () => {
  it('drops an inapplicable include on a non-CLAS SAPWrite update', () => {
    const out = normalizeTypeArgsForValidation('SAPWrite', {
      action: 'update',
      type: 'DDLS',
      name: 'ZC_V',
      source: 'x',
      include: 'definitions',
    });
    expect('include' in out).toBe(false);
    expect(out.type).toBe('DDLS');
  });

  it('keeps include on a valid CLAS include-write action (update)', () => {
    const out = normalizeTypeArgsForValidation('SAPWrite', {
      action: 'update',
      type: 'CLAS',
      name: 'ZCL_X',
      source: 'x',
      include: 'definitions',
    });
    expect(out.include).toBe('definitions');
  });

  it('drops include on delete and on batch_create (never include-aware)', () => {
    const del = normalizeTypeArgsForValidation('SAPWrite', {
      action: 'delete',
      type: 'CLAS',
      name: 'ZCL_X',
      include: 'definitions',
    });
    expect('include' in del).toBe(false);
    const batch = normalizeTypeArgsForValidation('SAPWrite', {
      action: 'batch_create',
      include: 'definitions',
      objects: [{ type: 'DTEL', name: 'Z' }],
    });
    expect('include' in batch).toBe(false);
  });

  it('drops include on a MAIN-only CLAS surgery action (add_method)', () => {
    const out = normalizeTypeArgsForValidation('SAPWrite', {
      action: 'add_method',
      type: 'CLAS',
      name: 'ZCL_X',
      method: 'METHODS foo.',
      include: 'implementations',
    });
    expect('include' in out).toBe(false);
  });

  it('strips null/empty pollution for every tool (not just SAPWrite)', () => {
    const read = normalizeTypeArgsForValidation('SAPRead', { type: 'CLAS', name: 'X', format: '', version: null });
    expect('format' in read).toBe(false);
    expect('version' in read).toBe(false);
  });
});

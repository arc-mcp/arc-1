import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const NAME = 'ZARC_POST_CREATE';
const PRIVATE_DETAIL = 'PRIVATE_POST_CREATE_DIAGNOSTIC';
const LOCK = '<asx:values><LOCK_HANDLE>LOCK1</LOCK_HANDLE><CORRNR></CORRNR></asx:values>';
const DOCUMENT =
  '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" ' +
  `adtcore:name="${NAME}" adtcore:type="SKTD/TYP"><adtcore:packageRef adtcore:name="$TMP"/>` +
  `<sktd:element><sktd:id>${NAME}</sktd:id><sktd:text>Ym9keQ==</sktd:text>` +
  '<adtcore:objectReference/><sktd:shortText sktd:text="" sktd:obligation="forbidden"/></sktd:element></sktd:docu>';

function args(type: 'TTYP' | 'SKTD') {
  return {
    action: 'create',
    type,
    name: NAME,
    package: '$TMP',
    ...(type === 'TTYP' ? { rowType: 'BAPIRET2' } : { refObjectType: 'DDLS/DF', source: 'New documentation.' }),
  };
}

function backend(
  type: 'TTYP' | 'SKTD',
  failure: 'create' | 'GET' | 'PUT' | 'LOCK' | 'UNLOCK' | 'PUT-and-UNLOCK' | 'timeout' | 'none',
  status = 403,
) {
  const base = type === 'TTYP' ? '/sap/bc/adt/ddic/tabletypes' : '/sap/bc/adt/documentation/ktd/documents';
  const calls: Array<{ method: string; url: string }> = [];
  mockFetch.mockImplementation((url: string | URL, options?: { method?: string }) => {
    const method = options?.method ?? 'GET';
    const path = String(url);
    calls.push({ method, url: path });
    const create = method === 'POST' && path.split('?')[0].endsWith(base);
    const followUp = path.toUpperCase().includes(`${base}/${NAME}`.toUpperCase());
    if (failure === 'timeout' && method === 'PUT' && followUp) {
      throw Object.assign(new Error('request timed out'), { name: 'TimeoutError' });
    }
    if (failure === 'PUT-and-UNLOCK' && method === 'POST' && path.includes('_action=UNLOCK')) {
      return Promise.resolve(mockResponse(400, 'UNLOCK_DIAGNOSTIC', { 'x-csrf-token': 'T' }));
    }
    if (
      (failure === 'create' && create) ||
      (failure === method && followUp) ||
      (failure === 'PUT-and-UNLOCK' && method === 'PUT' && followUp) ||
      (failure === 'LOCK' && method === 'POST' && path.includes('_action=LOCK')) ||
      (failure === 'UNLOCK' && method === 'POST' && path.includes('_action=UNLOCK'))
    ) {
      return Promise.resolve(mockResponse(status, PRIVATE_DETAIL, { 'x-csrf-token': 'T' }));
    }
    if (method === 'POST' && path.includes('_action=LOCK')) {
      return Promise.resolve(mockResponse(200, LOCK, { 'x-csrf-token': 'T' }));
    }
    return Promise.resolve(mockResponse(create ? 201 : 200, DOCUMENT, { 'x-csrf-token': 'T' }));
  });
  return calls;
}

describe('post-create errors respect minimal diagnostics', () => {
  beforeEach(() => vi.resetAllMocks());

  for (const [type, failure] of [
    ['TTYP', 'PUT'],
    ['SKTD', 'GET'],
    ['SKTD', 'PUT'],
  ] as const) {
    it.each([false, true])(`${type} ${failure} preserves recovery with minimalErrors=%s`, async (minimalErrors) => {
      const calls = backend(type, failure);
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPWrite', args(type));
      const message = result.content[0]?.text ?? '';
      expect(result.isError).toBe(true);
      expect(message).toContain(type === 'TTYP' ? 'TTYP post-create update failed' : `Created SKTD ${NAME}`);
      expect(message).toContain('SAPRead');
      expect(message).toContain('action="update"');
      if (minimalErrors) {
        expect(message).not.toContain(PRIVATE_DETAIL);
        expect(message).toContain('status 403');
      } else {
        expect(message).toContain(PRIVATE_DETAIL);
      }
      expect(
        calls.filter((call) => call.method === 'POST' && /\/(tabletypes|documents)(?:\?|$)/.test(call.url)),
      ).toHaveLength(1);
      expect(calls.some((call) => call.method === 'DELETE' || call.url.includes('/activation'))).toBe(false);
      if (failure === 'PUT') expect(calls.some((call) => call.url.includes('_action=UNLOCK'))).toBe(true);
    });
  }

  it.each([false, true])('local KTD read/parse errors respect minimalErrors=%s', async (minimalErrors) => {
    backend('SKTD', 'none');
    const client = createClient();
    vi.spyOn(client, 'getKtd').mockRejectedValue(new Error(PRIVATE_DETAIL));
    const result = await handleToolCall(client, { ...DEFAULT_CONFIG, minimalErrors }, 'SAPWrite', args('SKTD'));
    const message = result.content[0]?.text ?? '';
    expect(result.isError).toBe(true);
    expect(message).toContain(`Created SKTD ${NAME}`);
    expect(message).toContain('do not retry create');
    if (minimalErrors) expect(message).not.toContain(PRIVATE_DETAIL);
    else expect(message).toContain(PRIVATE_DETAIL);
  });

  it.each(['TTYP', 'SKTD'] as const)('%s POST rejection never claims creation', async (type) => {
    backend(type, 'create');
    const result = await handleToolCall(
      createClient(),
      { ...DEFAULT_CONFIG, minimalErrors: true },
      'SAPWrite',
      args(type),
    );
    const message = result.content[0]?.text ?? '';
    expect(result.isError).toBe(true);
    expect(message).not.toContain(PRIVATE_DETAIL);
    expect(message).not.toContain('Created SKTD');
    expect(message).not.toContain('after SAP accepted the create POST');
  });

  for (const type of ['TTYP', 'SKTD'] as const) {
    it.each([false, true])(`${type} follow-up 404 retains confirmed creation (minimal=%s)`, async (minimalErrors) => {
      const calls = backend(type, 'PUT', 404);
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPWrite', args(type));
      expect(result.isError).toBe(true);
      const message = result.content[0].text;
      expect(message).toContain('status 404');
      expect(message).not.toContain('was not found');
      expect(message).toContain(type === 'TTYP' ? 'after SAP accepted the create POST' : `Created SKTD ${NAME}`);
      if (minimalErrors) expect(message).not.toContain(PRIVATE_DETAIL);
      else expect(message).toContain(PRIVATE_DETAIL);
      expect(
        calls.filter((call) => call.method === 'POST' && /\/(tabletypes|documents)(?:\?|$)/.test(call.url)),
      ).toHaveLength(1);
      expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    });

    for (const failure of ['LOCK', 'UNLOCK', 'PUT-and-UNLOCK'] as const) {
      it.each([false, true])(
        `${type} ${failure} failure keeps recovery and lock guidance (minimal=%s)`,
        async (minimalErrors) => {
          const calls = backend(type, failure);
          const result = await handleToolCall(
            createClient(),
            { ...DEFAULT_CONFIG, minimalErrors },
            'SAPWrite',
            args(type),
          );
          expect(result.isError).toBe(true);
          const message = result.content[0].text;
          expect(message).not.toContain('was NOT written');
          expect(message).toContain('ADT/SM12');
          expect(message).toContain('SAPRead');
          expect(message).toContain('action="update"');
          if (minimalErrors) {
            expect(message).not.toContain(PRIVATE_DETAIL);
            expect(message).not.toContain('UNLOCK_DIAGNOSTIC');
          } else if (failure === 'PUT-and-UNLOCK') {
            expect(message).toContain('UNLOCK_DIAGNOSTIC');
            expect(message).not.toContain(PRIVATE_DETAIL);
          } else expect(message).toContain(PRIVATE_DETAIL);
          expect(calls.some((call) => call.method === 'PUT')).toBe(failure !== 'LOCK');
          expect(
            calls.filter((call) => call.method === 'POST' && /\/(tabletypes|documents)(?:\?|$)/.test(call.url)),
          ).toHaveLength(1);
          expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
        },
      );
    }

    it.each([false, true])(
      `${type} timeout keeps recovery without repeating create (minimal=%s)`,
      async (minimalErrors) => {
        const calls = backend(type, 'timeout');
        const result = await handleToolCall(
          createClient(),
          { ...DEFAULT_CONFIG, minimalErrors },
          'SAPWrite',
          args(type),
        );
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('SAPRead');
        expect(result.content[0].text).toContain('action="update"');
        expect(result.content[0].text).not.toContain('was NOT written');
        expect(
          calls.filter((call) => call.method === 'POST' && /\/(tabletypes|documents)(?:\?|$)/.test(call.url)),
        ).toHaveLength(1);
        expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
      },
    );

    it.each([false, true])(`${type} retains typed safety errors and recovery (minimal=%s)`, async (minimalErrors) => {
      const calls = backend(type, 'none');
      const client = createClient();
      vi.spyOn(client.http, 'withStatefulSession').mockRejectedValue(new AdtSafetyError('LOCAL_SAFETY_REASON'));
      const result = await handleToolCall(client, { ...DEFAULT_CONFIG, minimalErrors }, 'SAPWrite', args(type));
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('LOCAL_SAFETY_REASON');
      expect(result.content[0].text).toContain('SAPRead');
      expect(result.content[0].text).toContain('action="update"');
      expect(calls.some((call) => call.method === 'PUT' || call.method === 'DELETE')).toBe(false);
      expect(
        calls.filter((call) => call.method === 'POST' && /\/(tabletypes|documents)(?:\?|$)/.test(call.url)),
      ).toHaveLength(1);
    });

    it.each([false, true])(
      `${type} retains existing hints and SAP errors if cache invalidation throws (minimal=%s)`,
      async (minimalErrors) => {
        const calls = backend(type, 'none');
        const client = createClient();
        const error = new AdtApiError(PRIVATE_DETAIL, 403, '/post-create-test');
        error.extraHint = 'EXISTING_SAFE_HINT';
        vi.spyOn(client.http, 'withStatefulSession').mockRejectedValue(error);
        const cache = new CachingLayer(new MemoryCache());
        const invalidate = vi.spyOn(cache, 'invalidate').mockImplementation(() => {
          throw new Error('CACHE_FAILURE');
        });
        const result = await handleToolCall(
          client,
          { ...DEFAULT_CONFIG, minimalErrors },
          'SAPWrite',
          args(type),
          undefined,
          undefined,
          cache,
        );
        expect(result.isError).toBe(true);
        const message = result.content[0].text;
        expect(message).toContain('EXISTING_SAFE_HINT');
        expect(message).toContain(type === 'TTYP' ? 'after SAP accepted the create POST' : `Created SKTD ${NAME}`);
        expect(message).toContain('status 403');
        if (type === 'SKTD') expect(message).toContain('dryRun=true');
        expect(message).not.toContain('CACHE_FAILURE');
        if (minimalErrors) expect(message).not.toContain(PRIVATE_DETAIL);
        else expect(message).toContain(PRIVATE_DETAIL);
        expect(invalidate).toHaveBeenCalled();
        expect(
          calls.filter((call) => call.method === 'POST' && /\/(tabletypes|documents)(?:\?|$)/.test(call.url)),
        ).toHaveLength(1);
        expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
      },
    );
  }

  it('keeps the ordinary not-found diagnostic before creation', async () => {
    backend('TTYP', 'create', 404);
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args('TTYP'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('was not found');
    expect(result.content[0].text).not.toContain('after SAP accepted the create POST');
  });

  it.each([false, true])(
    'TTYP batch keeps its identity and all row-type recovery fields (minimal=%s)',
    async (minimalErrors) => {
      const calls = backend('TTYP', 'PUT');
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'TTYP', name: NAME, rowType: 'CHAR', rowTypeKind: 'builtin', rowTypeLength: 32 }],
      });
      const entry = JSON.parse(result.content[1].text).batch.results[0];
      expect(entry).toMatchObject({
        creation: 'confirmed',
        write: 'unknown',
        activation: 'not_attempted',
        failedPhase: 'write',
      });
      expect(entry.error).toContain(`name="${NAME}"`);
      for (const field of ['rowType', 'rowTypeKind', 'rowTypeLength', 'rowTypeDecimals'])
        expect(entry.error).toContain(field);
      if (minimalErrors) expect(JSON.stringify(result)).not.toContain(PRIVATE_DETAIL);
      else expect(entry.error).toContain(PRIVATE_DETAIL);
      expect(calls.some((call) => call.method === 'DELETE' || call.url.includes('/activation'))).toBe(false);
    },
  );

  it.each([false, true])('FUNC description-language preflight respects minimalErrors=%s', async (minimalErrors) => {
    mockFetch.mockResolvedValue(mockResponse(403, PRIVATE_DETAIL, { 'x-csrf-token': 'T' }));
    const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPWrite', {
      action: 'batch_create',
      objects: [
        {
          type: 'FUNC',
          name: NAME,
          group: 'ZARC_PARENT',
          parameters: [{ kind: 'importing', name: 'IV_TEXT', type: 'STRING', description: 'Input text' }],
        },
      ],
    });
    expect(result.isError).toBe(true);
    const entry = JSON.parse(result.content[1].text).batch.results[0];
    expect(entry).toMatchObject({ creation: 'not_attempted', failedPhase: 'preflight' });
    if (minimalErrors) expect(JSON.stringify(result)).not.toContain(PRIVATE_DETAIL);
    else expect(entry.error).toContain(PRIVATE_DETAIL);
    expect(mockFetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });

  it('keeps the actionable local description-language validation in minimal mode', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, '<abapFunctionGroup/>', { 'x-csrf-token': 'T' }));
    const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors: true }, 'SAPWrite', {
      action: 'batch_create',
      objects: [
        {
          type: 'FUNC',
          name: NAME,
          group: 'ZARC_PARENT',
          parameters: [{ kind: 'importing', name: 'IV_TEXT', type: 'STRING', description: 'Input text' }],
        },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot determine the function group original language');
    expect(mockFetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });
});

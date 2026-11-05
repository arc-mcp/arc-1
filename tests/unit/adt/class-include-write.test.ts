import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeUpdateClassInclude } from '../../../src/adt/crud.js';
import { AdtSafetyError } from '../../../src/adt/errors.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from '../handlers/setup-undici-mock.js';

const owner = '/sap/bc/adt/oo/classes/zcl_include';
const include = `${owner}/includes/testclasses`;
const missing =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><type id="ExceptionResourceNotFound"/></exc:exception>';
let stored: string | undefined;
let missingBody: string;
let putStatus: number;
let initStatus: number;
let readback: string | undefined;
const requests: Array<{ method: string; path: string; headers: Headers }> = [];

function fixture() {
  const client = new AdtClient({
    baseUrl: 'https://sap.example.test',
    safety: {
      ...defaultSafetyConfig(),
      allowWrites: true,
      multiTargetWrite: {
        target: 'A4H/001',
        enabled: true,
        allowedPackages: ['$TMP'],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    },
  });
  const controller = new AbortController();
  const cleanup = { unlockFailed: false };
  const context = pinnedMutationContext(
    client.safety,
    { deadline: Date.now() + 30_000, signal: controller.signal },
    cleanup,
  );
  const phases: string[] = [];
  const pinned = {
    context,
    lockPolicy: { beforeLock: vi.fn(), validateLock: vi.fn(async () => {}) },
    onPhase: (phase: string) => {
      phases.push(phase);
    },
  };
  return { client, pinned, phases, controller, cleanup };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  stored = 'old source';
  missingBody = missing;
  putStatus = 200;
  initStatus = 201;
  readback = undefined;
  requests.length = 0;
  mockFetch.mockImplementation(async (url: unknown, options: any = {}) => {
    const parsed = new URL(String(url));
    const method = options.method ?? 'GET';
    requests.push({ method, path: parsed.pathname + parsed.search, headers: new Headers(options.headers) });
    if (parsed.searchParams.get('_action') === 'LOCK')
      return mockResponse(
        200,
        '<DATA><LOCK_HANDLE>class-lock</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA>',
        {},
        ['sap-contextid=class-session; Path=/'],
      );
    if (parsed.pathname === include) {
      if (method === 'GET') return stored === undefined ? mockResponse(404, missingBody) : mockResponse(200, stored);
      if (method === 'POST') {
        if (initStatus === 201) stored = '';
        return mockResponse(initStatus, '');
      }
      if (method === 'PUT') {
        if (putStatus === 200) stored = readback ?? String(options.body);
        return mockResponse(putStatus, '');
      }
    }
    return mockResponse(200, '', { 'x-csrf-token': 'test-token' });
  });
});

const writes = () => requests.filter((r) => r.path.startsWith(include) && ['PUT', 'POST'].includes(r.method));
const unlocks = () => requests.filter((r) => r.path.includes('_action=UNLOCK'));

describe('shared include adapter with explicit pinned policy', () => {
  it('checks the existing include hash, saves under the class lock and returns actual readback bytes', async () => {
    const { client, pinned, phases } = fixture();
    readback = 'new source\n';
    const result = await safeUpdateClassInclude(
      client.http,
      client.safety,
      owner,
      include,
      'new source',
      undefined,
      undefined,
      sourceHash(stored!),
      pinned,
    );
    expect(result).toEqual({ initialized: false, source: readback, sourceHash: sourceHash(readback) });
    expect(pinned.lockPolicy.validateLock).toHaveBeenCalledOnce();
    expect(phases).toEqual(['include-read', 'source-save', 'source-readback']);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].path).toContain(`${include}?lockHandle=class-lock&`);
    expect(writes()[0].headers.get('cookie')).toContain('sap-contextid=class-session');
    expect(unlocks()[0].headers.get('cookie')).toContain('sap-contextid=class-session');
  });

  it.each([undefined, 'a'.repeat(64)])(
    'does not overwrite existing source with missing/stale hash %s',
    async (hash) => {
      const { client, pinned } = fixture();
      await expect(
        safeUpdateClassInclude(
          client.http,
          client.safety,
          owner,
          include,
          'new source',
          undefined,
          undefined,
          hash,
          pinned,
        ),
      ).rejects.toThrow();
      expect(stored).toBe('old source');
      expect(writes()).toHaveLength(0);
      expect(unlocks()).toHaveLength(1);
    },
  );

  it('initializes only typed absence, under the class lock with the selected recording request', async () => {
    const { client, pinned, phases } = fixture();
    stored = undefined;
    const result = await safeUpdateClassInclude(
      client.http,
      client.safety,
      owner,
      include,
      'new source',
      'A4HK900001',
      undefined,
      undefined,
      pinned,
    );
    expect(result.initialized).toBe(true);
    expect(phases).toEqual(['include-read', 'include-initialization', 'source-save', 'source-readback']);
    expect(
      writes().map((r) => {
        const url = new URL(r.path, 'https://sap.example.test');
        return [r.method, url.pathname, url.searchParams.get('lockHandle'), url.searchParams.get('corrNr')];
      }),
    ).toEqual([
      ['POST', include, 'class-lock', 'A4HK900001'],
      ['PUT', include, 'class-lock', 'A4HK900001'],
    ]);
  });

  it.each([
    'not a typed resource response',
    '<exc:exception><type id="ExceptionResourceNotFound"/><message>No suitable resource found</message></exc:exception>',
  ])('refuses ambiguous or service 404 evidence', async (body) => {
    const { client, pinned } = fixture();
    stored = undefined;
    missingBody = body;
    await expect(
      safeUpdateClassInclude(
        client.http,
        client.safety,
        owner,
        include,
        'new source',
        undefined,
        undefined,
        undefined,
        pinned,
      ),
    ).rejects.toThrow();
    expect(writes()).toHaveLength(0);
    expect(unlocks()).toHaveLength(1);
  });

  it('does not recreate a missing include when the caller supplied an existing-source hash', async () => {
    const { client, pinned } = fixture();
    stored = undefined;
    await expect(
      safeUpdateClassInclude(
        client.http,
        client.safety,
        owner,
        include,
        'new source',
        undefined,
        undefined,
        sourceHash('old source'),
        pinned,
      ),
    ).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });

  it('runs under-lock policy before any include read or save', async () => {
    const { client, pinned } = fixture();
    pinned.lockPolicy.validateLock.mockRejectedValueOnce(new AdtSafetyError('Package changed'));
    await expect(
      safeUpdateClassInclude(
        client.http,
        client.safety,
        owner,
        include,
        'new source',
        undefined,
        undefined,
        sourceHash(stored!),
        pinned,
      ),
    ).rejects.toThrow('Package changed');
    expect(requests.filter((r) => r.path.startsWith(include))).toHaveLength(0);
    expect(unlocks()).toHaveLength(1);
  });

  it('rejects reconstructed context and a different include owner before opening a session', async () => {
    const { client, pinned } = fixture();
    await expect(
      safeUpdateClassInclude(client.http, client.safety, owner, include, 'x', undefined, undefined, undefined, {
        ...pinned,
        context: { ...pinned.context },
      }),
    ).rejects.toThrow('context');
    await expect(
      safeUpdateClassInclude(
        client.http,
        client.safety,
        owner,
        `${owner}2/includes/testclasses`,
        'x',
        undefined,
        undefined,
        undefined,
        pinned,
      ),
    ).rejects.toThrow('locked class owner');
    expect(requests).toHaveLength(0);
  });

  it.each(['init', 'save'] as const)('does not replay an uncertain %s and still unlocks', async (phase) => {
    const { client, pinned, phases } = fixture();
    if (phase === 'init') {
      stored = undefined;
      initStatus = 503;
    } else putStatus = 500;
    await expect(
      safeUpdateClassInclude(
        client.http,
        client.safety,
        owner,
        include,
        'new source',
        undefined,
        undefined,
        stored === undefined ? undefined : sourceHash(stored),
        pinned,
      ),
    ).rejects.toThrow();
    expect(writes()).toHaveLength(1);
    expect(phases).toEqual(['include-read', phase === 'init' ? 'include-initialization' : 'source-save']);
    expect(unlocks()).toHaveLength(1);
  });

  it('refuses a mismatched readback after the one save without claiming rollback', async () => {
    const { client, pinned, phases } = fixture();
    readback = 'different source';
    await expect(
      safeUpdateClassInclude(
        client.http,
        client.safety,
        owner,
        include,
        'new source',
        undefined,
        undefined,
        sourceHash(stored!),
        pinned,
      ),
    ).rejects.toThrow('read-back differed');
    expect(stored).toBe('different source');
    expect(writes()).toHaveLength(1);
    expect(phases.at(-1)).toBe('source-readback');
    expect(unlocks()).toHaveLength(1);
  });

  it('honors cancellation before the include read and retains owning-session cleanup', async () => {
    const { client, pinned, controller } = fixture();
    pinned.lockPolicy.validateLock.mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(
      safeUpdateClassInclude(
        client.http,
        client.safety,
        owner,
        include,
        'new source',
        undefined,
        undefined,
        sourceHash(stored!),
        pinned,
      ),
    ).rejects.toThrow();
    expect(requests.filter((r) => r.path.startsWith(include))).toHaveLength(0);
    expect(unlocks()[0].headers.get('cookie')).toContain('sap-contextid=class-session');
  });

  it('preserves the partial initialization outcome when cancelled before the source PUT', async () => {
    const { client, pinned, controller, phases } = fixture();
    stored = undefined;
    const observe = pinned.onPhase;
    pinned.onPhase = (phase) => {
      observe(phase);
      if (phase === 'source-save') controller.abort();
    };
    await expect(
      safeUpdateClassInclude(
        client.http,
        client.safety,
        owner,
        include,
        'new source',
        undefined,
        undefined,
        undefined,
        pinned,
      ),
    ).rejects.toThrow();
    expect(stored).toBe('');
    expect(writes().map((request) => request.method)).toEqual(['POST']);
    expect(phases).toEqual(['include-read', 'include-initialization', 'source-save']);
    expect(unlocks()).toHaveLength(1);
  });

  it('checks the existing include hash before an explicit empty replacement', async () => {
    const { client, pinned } = fixture();
    const result = await safeUpdateClassInclude(
      client.http,
      client.safety,
      owner,
      include,
      '',
      undefined,
      undefined,
      sourceHash(stored!),
      pinned,
    );
    expect(result).toEqual({ initialized: false, source: '', sourceHash: sourceHash('') });
    expect(writes()).toHaveLength(1);
  });
});

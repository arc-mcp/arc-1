/** Characterization of the single-target lock/save/unlock contract, which pinned targets now share. */
import { describe, expect, it, vi } from 'vitest';
import { lockObject, safeUpdateClassInclude, safeUpdateSource } from '../../../src/adt/crud.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';

const owner = '/sap/bc/adt/oo/classes/zcl_test';
const sourceUrl = `${owner}/source/main`;
const source = 'CLASS zcl_test DEFINITION. ENDCLASS.';
const lockBody = '<DATA><LOCK_HANDLE>test lock</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA>';
const response = (body = '') => ({ statusCode: 200, headers: {}, body });

function fixture() {
  const session = {
    get: vi.fn().mockResolvedValue(response(source)),
    post: vi
      .fn<AdtHttpClient['post']>()
      .mockImplementation(async (url) => response(url.includes('_action=LOCK') ? lockBody : '')),
    put: vi.fn().mockResolvedValue(response()),
  };
  const withStatefulSession = vi.fn(async (fn: (http: AdtHttpClient) => Promise<unknown>) =>
    fn(session as unknown as AdtHttpClient),
  );
  return { http: { withStatefulSession } as unknown as AdtHttpClient, session, withStatefulSession };
}

describe('single-target mutation compatibility', () => {
  it('sends the lock request without request options', async () => {
    const { session } = fixture();
    const http = session as unknown as AdtHttpClient;
    expect(await lockObject(http, unrestrictedSafetyConfig(), owner)).toEqual({
      lockHandle: 'test lock',
      corrNr: '',
      isLocal: true,
    });
    expect(session.post.mock.calls[0]).toHaveLength(4);
  });

  it('keeps the no-hash write request shape and session cleanup options unchanged', async () => {
    const { http, session, withStatefulSession } = fixture();
    await safeUpdateSource(http, unrestrictedSafetyConfig(), owner, sourceUrl, source);
    expect(withStatefulSession.mock.calls[0]).toHaveLength(1);
    expect(session.get).not.toHaveBeenCalled();
    expect(session.put).toHaveBeenCalledExactlyOnceWith(`${sourceUrl}?lockHandle=test%20lock`, source, 'text/plain');
    expect(session.post.mock.calls[1]).toEqual([`${owner}?_action=UNLOCK&lockHandle=test%20lock`]);
  });

  it('gives source transforms the owning session and keeps the hash-read options unchanged', async () => {
    const { http, session } = fixture();
    const transform = vi.fn(async () => `${source}\n`);
    await safeUpdateSource(
      http,
      unrestrictedSafetyConfig(),
      owner,
      sourceUrl,
      transform,
      undefined,
      undefined,
      sourceHash(source),
    );
    expect(session.get).toHaveBeenCalledExactlyOnceWith(sourceUrl, { 'Cache-Control': 'no-cache' });
    expect(transform).toHaveBeenCalledExactlyOnceWith(source, session);
  });

  it.each(['main', 'include'] as const)('preserves %s unlock failure after a successful save', async (kind) => {
    const { http, session } = fixture();
    const failure = new Error('unlock failed');
    session.post.mockResolvedValueOnce(response(lockBody)).mockRejectedValueOnce(failure);
    const operation = kind === 'main' ? safeUpdateSource : safeUpdateClassInclude;
    await expect(operation(http, unrestrictedSafetyConfig(), owner, sourceUrl, source)).rejects.toBe(failure);
    expect(session.put).toHaveBeenCalledTimes(1);
  });

  it.each(['main', 'include'] as const)('preserves %s unlock failure precedence over the save error', async (kind) => {
    const { http, session } = fixture();
    const failure = new Error('unlock failed');
    session.put.mockRejectedValueOnce(new Error('save failed'));
    session.post.mockResolvedValueOnce(response(lockBody)).mockRejectedValueOnce(failure);
    const operation = kind === 'main' ? safeUpdateSource : safeUpdateClassInclude;
    await expect(operation(http, unrestrictedSafetyConfig(), owner, sourceUrl, source)).rejects.toBe(failure);
  });
});

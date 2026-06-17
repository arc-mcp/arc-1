import { describe, expect, it, vi } from 'vitest';

import { AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { createSafeHttpClient } from '../../../src/server/safe-http-client.js';

const resp = { statusCode: 200, headers: {}, body: 'ok' };

function fakeUnderlying() {
  const u = {
    get: vi.fn(async () => resp),
    head: vi.fn(async () => resp),
    post: vi.fn(async () => resp),
    put: vi.fn(async () => resp),
    delete: vi.fn(async () => resp),
    withStatefulSession: vi.fn(async (fn: (c: unknown) => Promise<unknown>) => fn(fakeUnderlying())),
  };
  return u;
}

const as = (u: ReturnType<typeof fakeUnderlying>) => u as unknown as AdtHttpClient;

describe('createSafeHttpClient', () => {
  it('allows GET for a read-scoped tool and delegates to the underlying', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), defaultSafetyConfig(), 'read', 'Custom_R');
    await expect(c.get('/sap/bc/adt/x', { Accept: 'text/plain' })).resolves.toBe(resp);
    expect(u.get).toHaveBeenCalledWith('/sap/bc/adt/x', { Accept: 'text/plain' });
  });

  it('blocks POST for a read-scoped tool (scope coverage) — even with an unrestricted ceiling', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), unrestrictedSafetyConfig(), 'read', 'Custom_R');
    await expect(c.post('/x', 'body')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(u.post).not.toHaveBeenCalled();
  });

  it('allows POST for a write-scoped tool when allowWrites=true and delegates', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), unrestrictedSafetyConfig(), 'write', 'Custom_W');
    await expect(c.post('/x', 'body', 'application/json')).resolves.toBe(resp);
    expect(u.post).toHaveBeenCalledWith('/x', 'body', 'application/json', undefined);
  });

  it('blocks POST for a write-scoped tool when allowWrites=false (server ceiling)', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), defaultSafetyConfig(), 'write', 'Custom_W');
    await expect(c.post('/x', 'body')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(u.post).not.toHaveBeenCalled();
  });

  it('allows GET for a read-scoped tool even when allowWrites=false', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), defaultSafetyConfig(), 'read', 'Custom_R');
    await expect(c.get('/x')).resolves.toBe(resp);
  });

  it('lets a write-scoped tool also GET (write covers read)', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), unrestrictedSafetyConfig(), 'write', 'Custom_W');
    await expect(c.get('/x')).resolves.toBe(resp);
    await expect(c.put('/x', 'b')).resolves.toBe(resp);
    await expect(c.delete('/x')).resolves.toBe(resp);
  });

  it('gates calls made inside withStatefulSession', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), unrestrictedSafetyConfig(), 'read', 'Custom_R');
    await expect(c.withStatefulSession(async (s) => s.post('/x', 'body'))).rejects.toBeInstanceOf(AdtSafetyError);
    // a read inside the session is fine
    await expect(c.withStatefulSession(async (s) => s.get('/x'))).resolves.toBe(resp);
  });
});

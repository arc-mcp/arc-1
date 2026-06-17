import { describe, expect, it, vi } from 'vitest';

import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { createReadOnlyAdtClient, createSafeHttpClient } from '../../../src/server/safe-http-client.js';

const resp = { statusCode: 200, headers: {}, body: 'ok' };

function fakeUnderlying() {
  return {
    get: vi.fn(async () => resp),
    head: vi.fn(async () => resp),
    post: vi.fn(async () => resp),
  };
}

const as = (u: ReturnType<typeof fakeUnderlying>) => u as unknown as AdtHttpClient;

describe('createSafeHttpClient (v1: read-only)', () => {
  it('allows GET and HEAD and delegates to the underlying client', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), defaultSafetyConfig(), 'Custom_R');
    await expect(c.get('/sap/bc/adt/x', { Accept: 'text/plain' })).resolves.toBe(resp);
    expect(u.get).toHaveBeenCalledWith('/sap/bc/adt/x', { Accept: 'text/plain' });
    await expect(c.head('/sap/bc/adt/x')).resolves.toBe(resp);
  });

  it('exposes NO write verbs — post/put/delete/withStatefulSession are absent (package-allowlist gap)', () => {
    const c = createSafeHttpClient(as(fakeUnderlying()), defaultSafetyConfig(), 'Custom_R') as unknown as Record<
      string,
      unknown
    >;
    expect(c.post).toBeUndefined();
    expect(c.put).toBeUndefined();
    expect(c.delete).toBeUndefined();
    expect(c.withStatefulSession).toBeUndefined();
  });
});

describe('createReadOnlyAdtClient (runtime escape-hatch guard, review B1)', () => {
  // A minimal stand-in for AdtClient: a read method that internally needs `this.http`/`this.safety`,
  // plus the escape-hatch members a plugin must never reach.
  function fakeClient() {
    return {
      http: { get: vi.fn(async (_path: string) => resp) },
      safety: defaultSafetyConfig(),
      withSafety: vi.fn(),
      invalidatePackageHierarchy: vi.fn(),
      async getProgram(name: string) {
        // Uses `this` — must resolve to the REAL client even when called via the read-only Proxy.
        const r = await this.http.get(`/programs/${name}`);
        return `${name}:${r.body}:${this.safety ? 'safe' : 'nosafe'}`;
      },
    };
  }

  it('blocks http/safety/withSafety/package mutators at runtime (cast yields undefined)', () => {
    const ro = createReadOnlyAdtClient(fakeClient() as unknown as AdtClient) as unknown as Record<string, unknown>;
    expect(ro.http).toBeUndefined();
    expect(ro.safety).toBeUndefined();
    expect(ro.withSafety).toBeUndefined();
    expect(ro.invalidatePackageHierarchy).toBeUndefined();
    expect('http' in ro).toBe(false);
  });

  it('still runs read methods, bound to the real client so internal this.http works', async () => {
    const ro = createReadOnlyAdtClient(fakeClient() as unknown as AdtClient) as unknown as {
      getProgram(n: string): Promise<string>;
    };
    await expect(ro.getProgram('ZHELLO')).resolves.toBe('ZHELLO:ok:safe');
  });

  it('refuses mutation of the wrapped client', () => {
    const ro = createReadOnlyAdtClient(fakeClient() as unknown as AdtClient) as unknown as Record<string, unknown>;
    expect(() => {
      (ro as { http?: unknown }).http = { get: vi.fn() };
    }).toThrow();
  });
});

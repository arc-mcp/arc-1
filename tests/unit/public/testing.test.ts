import { describe, expect, it } from 'vitest';

import { createMockToolContext } from '../../../src/public/testing.js';

describe('createMockToolContext', () => {
  it('records http calls and returns the configured body', async () => {
    const ctx = createMockToolContext({ responseBody: 'SRC', scopes: ['read'] });
    const res = await ctx.http.get('/sap/bc/adt/x');
    expect(res.body).toBe('SRC');
    expect(ctx.httpCalls).toEqual([{ method: 'GET', path: '/sap/bc/adt/x' }]);
    expect(ctx.authInfo?.scopes).toEqual(['read']);
    expect(ctx.requestId).toBe('test-request');
  });

  it('supports per-path responses and records GET/HEAD calls', async () => {
    const ctx = createMockToolContext({ responses: { '/a': 'AAA', '/b': 'BBB' } });
    expect((await ctx.http.get('/a')).body).toBe('AAA');
    expect((await ctx.http.head('/b')).body).toBe('BBB');
    expect(ctx.httpCalls).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'HEAD', path: '/b' },
    ]);
  });

  it('exposes a read-only http surface (no write verbs in v1)', () => {
    const ctx = createMockToolContext();
    const http = ctx.http as unknown as Record<string, unknown>;
    expect(http.post).toBeUndefined();
    expect(http.put).toBeUndefined();
    expect(http.delete).toBeUndefined();
  });
});

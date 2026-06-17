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

  it('supports per-path responses and records bodies', async () => {
    const ctx = createMockToolContext({ responses: { '/a': 'AAA', '/b': 'BBB' } });
    expect((await ctx.http.get('/a')).body).toBe('AAA');
    expect((await ctx.http.post('/b', 'payload')).body).toBe('BBB');
    expect(ctx.httpCalls).toEqual([
      { method: 'GET', path: '/a' },
      { method: 'POST', path: '/b', body: 'payload' },
    ]);
  });

  it('gates nothing (a pure recorder) and threads through withStatefulSession', async () => {
    const ctx = createMockToolContext({ responseBody: 'S' });
    const out = await ctx.http.withStatefulSession(async (s) => (await s.get('/x')).body);
    expect(out).toBe('S');
  });
});

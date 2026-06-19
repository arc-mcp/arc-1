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

  it('records write calls (post/put/delete) as a pure recorder — gating is tested separately', async () => {
    const ctx = createMockToolContext({ responseBody: 'OK' });
    expect((await ctx.http.post('/sap/bc/http/sap/svc', 'payload')).body).toBe('OK');
    await ctx.http.put('/sap/opu/odata/x', 'b');
    await ctx.http.delete('/sap/opu/odata/x');
    expect(ctx.httpCalls).toEqual([
      { method: 'POST', path: '/sap/bc/http/sap/svc', body: 'payload' },
      { method: 'PUT', path: '/sap/opu/odata/x', body: 'b' },
      { method: 'DELETE', path: '/sap/opu/odata/x' },
    ]);
  });
});

import { describe, expect, it, vi } from 'vitest';

import type { AdtClient } from '../../../src/adt/client.js';
import { AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import {
  createPluginRunOps,
  createReadOnlyAdtClient,
  createSafeHttpClient,
} from '../../../src/server/safe-http-client.js';

const resp = { statusCode: 200, headers: {}, body: 'ok' };

function fakeUnderlying() {
  return {
    get: vi.fn(async () => resp),
    head: vi.fn(async () => resp),
    post: vi.fn(async (_path: string) => ({ ...resp, body: 'console output' })),
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

describe('createPluginRunOps.classRun (gated code execution)', () => {
  // (allowExecute, safety, toolScope) → expectation
  it('refuses when the SAP_ALLOW_PLUGIN_EXECUTE opt-in is off', async () => {
    const u = fakeUnderlying();
    const run = createPluginRunOps(as(u), unrestrictedSafetyConfig(), false, 'write', 'Custom_Run');
    await expect(run.classRun('ZCL_X')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(u.post).not.toHaveBeenCalled();
  });

  it('refuses a tool that does not declare write scope (even with the opt-in on)', async () => {
    const u = fakeUnderlying();
    const run = createPluginRunOps(as(u), unrestrictedSafetyConfig(), true, 'read', 'Custom_Run');
    await expect(run.classRun('ZCL_X')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(u.post).not.toHaveBeenCalled();
  });

  it('refuses when allowWrites=false (execution is a mutation vector)', async () => {
    const u = fakeUnderlying();
    const run = createPluginRunOps(as(u), defaultSafetyConfig(), true, 'write', 'Custom_Run');
    await expect(run.classRun('ZCL_X')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(u.post).not.toHaveBeenCalled();
  });

  it('refuses an invalid class name (path-injection guard)', async () => {
    const u = fakeUnderlying();
    const run = createPluginRunOps(as(u), unrestrictedSafetyConfig(), true, 'write', 'Custom_Run');
    await expect(run.classRun('../../etc/passwd')).rejects.toBeInstanceOf(AdtSafetyError);
    await expect(run.classRun('ZCL X')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(u.post).not.toHaveBeenCalled();
  });

  it('POSTs to the classrun endpoint and returns the console output when all gates pass', async () => {
    const u = fakeUnderlying();
    const run = createPluginRunOps(as(u), unrestrictedSafetyConfig(), true, 'write', 'Custom_Run');
    await expect(run.classRun('ZCL_ARC1_RUN_DEMO')).resolves.toBe('console output');
    expect(u.post).toHaveBeenCalledWith('/sap/bc/adt/oo/classrun/zcl_arc1_run_demo');
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
      // Scope-escalating reads — must NOT be reachable from a read-declared plugin's ctx.client.
      getTableContents: vi.fn(),
      runQuery: vi.fn(),
      runTableQuery: vi.fn(),
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

  it('blocks the scope-escalating data/SQL reads (a read tool cannot reach data/sql via ctx.client)', () => {
    const ro = createReadOnlyAdtClient(fakeClient() as unknown as AdtClient) as unknown as Record<string, unknown>;
    expect(ro.getTableContents).toBeUndefined(); // OperationType.Query → data
    expect(ro.runQuery).toBeUndefined(); // OperationType.FreeSQL → sql
    expect(ro.runTableQuery).toBeUndefined(); // OperationType.Query → data
    expect(Object.getOwnPropertyDescriptor(ro, 'runQuery')).toBeUndefined();
    expect('runQuery' in ro).toBe(false);
  });

  it('still runs read methods, bound to the real client so internal this.http works', async () => {
    const ro = createReadOnlyAdtClient(fakeClient() as unknown as AdtClient) as unknown as {
      getProgram(n: string): Promise<string>;
    };
    await expect(ro.getProgram('ZHELLO')).resolves.toBe('ZHELLO:ok:safe');
  });

  it('does not leak blocked members via getOwnPropertyDescriptor or enumeration (descriptor bypass)', () => {
    const ro = createReadOnlyAdtClient(fakeClient() as unknown as AdtClient);
    // The `get` trap alone left this hole: the descriptor path returned the raw client's `.value`.
    expect(Object.getOwnPropertyDescriptor(ro, 'http')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(ro, 'safety')).toBeUndefined();
    expect(Reflect.getOwnPropertyDescriptor(ro, 'http')).toBeUndefined();
    expect(Object.keys(ro)).not.toContain('http');
    expect(Object.keys(ro)).not.toContain('safety');
    // Nothing http-shaped (a `.post`) escapes through enumeration either.
    expect(Object.values(ro).some((v) => typeof (v as { post?: unknown })?.post === 'function')).toBe(false);
  });

  it('refuses mutation of the wrapped client', () => {
    const ro = createReadOnlyAdtClient(fakeClient() as unknown as AdtClient) as unknown as Record<string, unknown>;
    expect(() => {
      (ro as { http?: unknown }).http = { get: vi.fn() };
    }).toThrow();
  });
});

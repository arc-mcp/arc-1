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
    put: vi.fn(async (_path: string) => resp),
    delete: vi.fn(async (_path: string) => resp),
  };
}

const as = (u: ReturnType<typeof fakeUnderlying>) => u as unknown as AdtHttpClient;
const ODATA = '/sap/opu/odata/sap/ZSVC/EntitySet';
const ICF = '/sap/bc/http/sap/zi18n_service';

describe('createSafeHttpClient — reads', () => {
  it('allows GET and HEAD for any tool/opt-in and delegates', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), defaultSafetyConfig(), 'Custom_R', 'read', false);
    await expect(c.get('/sap/bc/adt/x', { Accept: 'text/plain' })).resolves.toBe(resp);
    expect(u.get).toHaveBeenCalledWith('/sap/bc/adt/x', { Accept: 'text/plain' });
    await expect(c.head('/sap/bc/adt/x')).resolves.toBe(resp);
  });
});

describe('createSafeHttpClient — gated non-ADT writes (SAP_ALLOW_PLUGIN_RAW_WRITES)', () => {
  it('refuses a write when the raw-writes opt-in is off', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), unrestrictedSafetyConfig(), 'Custom_W', 'write', false);
    await expect(c.post(ICF, 'body')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(u.post).not.toHaveBeenCalled();
  });

  it('refuses a write from a non-write-scoped tool (even with the opt-in on)', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), unrestrictedSafetyConfig(), 'Custom_R', 'read', true);
    await expect(c.post(ICF, 'body')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(u.post).not.toHaveBeenCalled();
  });

  it('refuses a write when allowWrites=false (server ceiling)', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), defaultSafetyConfig(), 'Custom_W', 'write', true);
    await expect(c.post(ICF, 'body')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(u.post).not.toHaveBeenCalled();
  });

  it('refuses a write to an ADT path even when every other gate is open (routes like buildUrl)', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), unrestrictedSafetyConfig(), 'Custom_W', 'write', true);
    for (const p of [
      '/sap/bc/adt/oo/classes/zcl_x', // literal
      '/SAP/BC/ADT/oo/classes/zcl_x', // case
      '//sap/bc/adt//oo/classes/zcl_x', // double slashes
      'sap/bc/adt/oo/classes/zcl_x', // NO leading slash — buildUrl prepends it
      '/sap/bc\t/adt/oo/classes/zcl_x', // embedded TAB — new URL strips it
      '/sap/bc/\nadt/oo/classes/zcl_x', // embedded LF — new URL strips it
      '/sap/bc/%61dt/oo/classes/zcl_x', // %-encoded 'a' → decodes to adt
      '/sap/bc/%2561dt/oo/classes/zcl_x', // double-encoded → fully decodes to adt
      '/sap/bc\\adt/oo/classes/zcl_x', // backslash — new URL folds to /
      '/x/../sap/bc/adt/oo/classes/zcl_x', // dot-segment — new URL resolves to adt
      '/sap/bc/%adt/x', // malformed %-encoding → fail-closed refuse
    ]) {
      await expect(c.post(p, 'body')).rejects.toBeInstanceOf(AdtSafetyError);
    }
    expect(u.post).not.toHaveBeenCalled();
  });

  it('does NOT over-refuse a non-ADT path that merely contains the substring later', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), unrestrictedSafetyConfig(), 'Custom_W', 'write', true);
    await expect(c.post('/sap/opu/odata/sap/ZSVC/to_/sap/bc/adt/decoy', 'b')).resolves.toBeTruthy();
    await expect(c.post("/sap/opu/odata/sap/ZSVC/Set(K='a%20b')", 'b')).resolves.toBeTruthy();
    expect(u.post).toHaveBeenCalledTimes(2);
  });

  it('ALLOWS a POST to a non-ADT (OData/ICF) path when all gates pass, and delegates', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), unrestrictedSafetyConfig(), 'Custom_W', 'write', true);
    await expect(c.post(ICF, 'payload', 'application/json')).resolves.toBeTruthy();
    expect(u.post).toHaveBeenCalledWith(ICF, 'payload', 'application/json', undefined);
  });

  it('gates PUT and DELETE the same way (allowed to non-ADT when all gates pass)', async () => {
    const u = fakeUnderlying();
    const c = createSafeHttpClient(as(u), unrestrictedSafetyConfig(), 'Custom_W', 'write', true);
    await expect(c.put(ODATA, 'b')).resolves.toBe(resp);
    await expect(c.delete(ODATA)).resolves.toBe(resp);
    // …and refused to ADT paths
    await expect(c.put('/sap/bc/adt/x', 'b')).rejects.toBeInstanceOf(AdtSafetyError);
    await expect(c.delete('/sap/bc/adt/x')).rejects.toBeInstanceOf(AdtSafetyError);
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

// SafeHttpClient + createReadOnlyAdtClient — the gated surfaces handed to extension tools.
//
// FEAT-61 / review B1: an extension tool must NOT receive the raw, ungated client. There are two
// escape routes a plugin could otherwise take, and both are closed here:
//
//   1. `ctx.http` — the raw AdtHttpClient's post/put/delete bypass `checkOperation`. v1 hands
//      plugins a READ-ONLY surface (get/head). Writes are deliberately deferred to v2: a raw
//      `http.post(path, …)` can't be constrained by `SAP_ALLOWED_PACKAGES` (package resolution
//      needs the ADT object-URL shape, which an arbitrary path doesn't give us), so shipping
//      un-package-gated writes would punch straight through the server safety ceiling. v2 adds a
//      package-aware write vocabulary; until then, code-tier and manifest-tier tools are read-only.
//
//   2. `ctx.client` — typed as `ReadOnlyAdtClient` (Omit of `http`/`safety`/`withSafety`/…), but a
//      cast (`(ctx.client as any).http`) would defeat a type-only narrowing. `createReadOnlyAdtClient`
//      enforces the same omission at RUNTIME via a Proxy, so the cast yields `undefined`.
//
// CSRF, cookies, PP auth, sessions, the semaphore all ride the underlying client unchanged.
// See docs/research/extension-framework-spec.md §5.

import type { AdtClient } from '../adt/client.js';
import type { AdtHttpClient, AdtResponse } from '../adt/http.js';
import { checkOperation, OperationType, type SafetyConfig } from '../adt/safety.js';
import type { ReadOnlyAdtClient } from '../public/types.js';

/** The read-only HTTP surface a plugin tool receives as `ctx.http`. v1: GET/HEAD only. */
export interface SafeHttpClient {
  get(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
  head(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
}

/**
 * Wrap a per-user `AdtHttpClient` in the read-only gated surface for one tool call.
 *
 * @param underlying  the request's per-user (PP/`withSafety`) AdtHttpClient
 * @param safety      the effective per-user SafetyConfig (server ceiling ∧ user)
 * @param opLabel     tool name, used in error messages
 */
export function createSafeHttpClient(underlying: AdtHttpClient, safety: SafetyConfig, opLabel: string): SafeHttpClient {
  // Reads always pass the safety ceiling, but route through checkOperation anyway so the gate is
  // the single seam where v2 write support will re-enter (and any future read opt-in lands here).
  return {
    async get(path, headers) {
      checkOperation(safety, OperationType.Read, `Custom:${opLabel}`);
      return underlying.get(path, headers);
    },
    async head(path, headers) {
      checkOperation(safety, OperationType.Read, `Custom:${opLabel}`);
      return underlying.head(path, headers);
    },
  };
}

/** Keys that must NOT be reachable from a plugin's `ctx.client` (mirror `ReadOnlyAdtClient`'s Omit). */
const BLOCKED_CLIENT_KEYS: ReadonlySet<string> = new Set([
  'http', // the raw, ungated AdtHttpClient
  'safety', // the effective safety ref
  'withSafety', // the safety-escalation clone hatch
  'getPackageHierarchyResolver',
  'invalidatePackageHierarchy',
]);

/**
 * Runtime read-only view of an `AdtClient`, handed to plugins as `ctx.client`. The static type
 * `ReadOnlyAdtClient` hides the escape hatches at compile time; this Proxy enforces the SAME
 * omission at runtime, so `(ctx.client as any).http.post(...)` resolves to `undefined` (review B1).
 *
 * Read methods keep working: each is returned bound to the REAL client, so a method's internal
 * `this.http` / `this.safety` use hits the real instance directly (never the Proxy) — only
 * EXTERNAL access to a blocked key is denied. Mutating traps are closed so a plugin can't repair
 * the object either.
 */
export function createReadOnlyAdtClient(client: AdtClient): ReadOnlyAdtClient {
  return new Proxy(client, {
    get(target, prop) {
      if (typeof prop === 'string' && BLOCKED_CLIENT_KEYS.has(prop)) return undefined;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    has(target, prop) {
      if (typeof prop === 'string' && BLOCKED_CLIENT_KEYS.has(prop)) return false;
      return Reflect.has(target, prop);
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as unknown as ReadOnlyAdtClient;
}

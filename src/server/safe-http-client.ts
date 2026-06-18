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
import { AdtSafetyError } from '../adt/errors.js';
import type { AdtHttpClient, AdtResponse } from '../adt/http.js';
import { checkOperation, OperationType, type SafetyConfig } from '../adt/safety.js';
import { hasRequiredScope, type Scope } from '../authz/policy.js';
import type { PluginRunOps, ReadOnlyAdtClient } from '../public/types.js';

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
  // Scope-escalating reads: these `checkOperation` against `data`/`sql`, not `read`. A plugin
  // declaring only `scope: 'read'` must not reach them via `ctx.client` (the Omit was a type-only
  // narrowing — without these a read tool could call data/SQL whenever the effective safety allowed
  // it). v1 plugins have no data/SQL surface at all (ctx.http is GET-only too); a scoped ctx.data /
  // ctx.sql facade is a v2 item.
  'getTableContents', // OperationType.Query → `data`
  'runQuery', // OperationType.FreeSQL → `sql`
  'runTableQuery', // OperationType.Query → `data`
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
  const isBlocked = (prop: string | symbol): boolean => typeof prop === 'string' && BLOCKED_CLIENT_KEYS.has(prop);
  return new Proxy(client, {
    get(target, prop) {
      if (isBlocked(prop)) return undefined;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    has(target, prop) {
      if (isBlocked(prop)) return false;
      return Reflect.has(target, prop);
    },
    // `http`/`safety` are own data properties, so without these two traps a plugin could read the
    // raw client back via `Object.getOwnPropertyDescriptor(ctx.client, 'http').value` (the `get`
    // trap alone does NOT cover the descriptor path) or enumerate it. They are configurable on the
    // target (TS `readonly` is compile-time only), so hiding them violates no Proxy invariant.
    getOwnPropertyDescriptor(target, prop) {
      if (isBlocked(prop)) return undefined;
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter((k) => !isBlocked(k));
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as unknown as ReadOnlyAdtClient;
}

/** ABAP object name (class): letters/digits/underscore/slash, ≤ 40 chars. Blocks path injection. */
const ABAP_CLASS_NAME = /^[A-Za-z_/][A-Za-z0-9_/]{0,39}$/;

/**
 * Build the `ctx.run` named-operation surface. Unlike `ctx.http` (read-only), these EXECUTE — so the
 * gate is the strictest in the framework. `classRun` (the only op in v1) runs an `IF_OO_ADT_CLASSRUN`
 * console class, which can mutate anything, so it requires ALL of: the dedicated opt-in
 * `SAP_ALLOW_PLUGIN_EXECUTE`; `allowWrites` (via `checkOperation`, since execution is a mutation
 * vector); and the calling tool declaring `write` scope. SAP-side execute auth is the final backstop.
 */
export function createPluginRunOps(
  underlying: AdtHttpClient,
  safety: SafetyConfig,
  allowPluginExecute: boolean,
  toolScope: Scope,
  opLabel: string,
): PluginRunOps {
  return {
    async classRun(className: string): Promise<string> {
      if (!allowPluginExecute) {
        throw new AdtSafetyError(
          `Extension tool '${opLabel}' tried to execute a class, but plugin code execution is disabled. ` +
            'Set SAP_ALLOW_PLUGIN_EXECUTE=true (and SAP_ALLOW_WRITES=true) to allow it.',
        );
      }
      if (!hasRequiredScope([toolScope], 'write')) {
        throw new AdtSafetyError(
          `Extension tool '${opLabel}' declares scope '${toolScope}' and may not execute a class (needs scope 'write').`,
        );
      }
      // Execution is a mutation vector — keep the `allowWrites=false ⇒ no mutation path` invariant.
      checkOperation(safety, OperationType.Workflow, `Custom:${opLabel}:classRun`);
      if (typeof className !== 'string' || !ABAP_CLASS_NAME.test(className)) {
        throw new AdtSafetyError(`Extension tool '${opLabel}': invalid ABAP class name '${className}'.`);
      }
      const res = await underlying.post(`/sap/bc/adt/oo/classrun/${encodeURIComponent(className.toLowerCase())}`);
      return res.body;
    },
  };
}

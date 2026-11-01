// SafeHttpClient + createReadOnlyAdtClient — the gated surfaces handed to extension tools.
//
// FEAT-61 / review B1: an extension tool must NOT receive the raw, ungated client. There are two
// escape routes a plugin could otherwise take, and both are closed here:
//
//   1. `ctx.http` — the raw AdtHttpClient's post/put/delete bypass `checkOperation`. This wrapper
//      always allows GET/HEAD; it allows POST/PUT/DELETE **only to non-ADT paths** (OData/ICF) and
//      **only** when the server opts in via `SAP_ALLOW_PLUGIN_RAW_WRITES` (+ `allowWrites` + a
//      `write`-scoped tool). Writes to `/sap/bc/adt/…` object endpoints are ALWAYS refused: they need
//      `SAP_ALLOWED_PACKAGES` enforcement, which package resolution from an arbitrary path can't give
//      us — those wait for the v2 package-aware `ctx.write` vocabulary. (`SAP_ALLOWED_PACKAGES` does
//      not apply to OData/ICF paths — there is no ABAP package in them.)
//
//   2. `ctx.client` — a frozen facade of explicitly reviewed plain reads. The same key list
//      defines its runtime surface and public type; new AdtClient methods do not appear implicitly.
//
// CSRF, cookies, PP auth, sessions, the semaphore all ride the underlying client unchanged.
// See docs/research/2026-06-17-extension-framework-spec.md §5.

import type { AdtClient } from '../adt/client.js';
import { AdtApiError, AdtNetworkError, AdtSafetyError } from '../adt/errors.js';
import type { AdtHttpClient, AdtResponse } from '../adt/http.js';
import { checkOperation, OperationType, type OperationTypeCode, type SafetyConfig } from '../adt/safety.js';
import { hasRequiredScope, type Scope } from '../authz/policy.js';
import { READ_ONLY_CLIENT_KEYS, type ReadOnlyAdtClient } from '../public/read-only-client.js';
import type { PluginRunOps } from '../public/types.js';

/** The gated HTTP surface a plugin tool receives as `ctx.http`. GET/HEAD always; POST/PUT/DELETE to
 *  NON-ADT paths only when the server opts in — see {@link createSafeHttpClient}. */
export interface SafeHttpClient {
  get(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
  head(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
  post(path: string, body?: string, contentType?: string, headers?: Record<string, string>): Promise<AdtResponse>;
  put(path: string, body: string, contentType?: string, headers?: Record<string, string>): Promise<AdtResponse>;
  delete(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
}

/**
 * True for any path SAP would route to the ADT namespace. Must check the path SAP *actually* routes,
 * not the raw argument — so it is computed exactly the way `AdtHttpClient.buildUrl` builds the request
 * (`new URL('<host>' + (leadingSlash ? path : '/'+path))`, which prepends a slash, deletes tab/CR/LF,
 * folds `\`→`/`, resolves `..`, collapses slashes) and THEN percent-decoded (SAP decodes the routed
 * path; `new URL` keeps `%xx` literal, so `/sap/bc/%61dt/…` would otherwise slip through). A bare
 * `.includes` on the raw arg misses no-leading-slash, embedded `\t`, and `%`-encoded variants.
 * Anchored with `startsWith` so a non-ADT path that merely *contains* the substring isn't over-blocked.
 * Fail-closed: an unparseable path or malformed `%`-encoding is treated as ADT (refused).
 */
function isAdtPath(path: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(`http://h${path.startsWith('/') ? path : `/${path}`}`).pathname;
  } catch {
    return true; // unparseable → refuse (fail-closed)
  }
  let decoded = pathname;
  for (let i = 0; i < 5; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return true; // malformed %-encoding → refuse (fail-closed)
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded
    .toLowerCase()
    .replace(/\/{2,}/g, '/')
    .startsWith('/sap/bc/adt/');
}

/** Services and ABAP execution may commit before an error response; callers must apply their gates first. */
async function postWithoutTransientReplay(
  underlying: AdtHttpClient,
  path: string,
  body?: string,
  contentType?: string,
  headers?: Record<string, string>,
): Promise<AdtResponse> {
  try {
    return await underlying.post(path, body, contentType, headers, { retryTransientErrors: false });
  } catch (error) {
    if (
      error instanceof AdtNetworkError ||
      (error instanceof AdtApiError && (error.statusCode === 429 || error.isServerError))
    ) {
      error.pluginPostOutcome = 'unknown';
    }
    throw error;
  }
}

/**
 * Wrap a per-user `AdtHttpClient` in the gated surface for one tool call.
 *
 * @param underlying      the request's per-user (PP/`withSafety`) AdtHttpClient
 * @param safety          the effective per-user SafetyConfig (server ceiling ∧ user)
 * @param opLabel         tool name, used in error messages
 * @param toolScope       the calling tool's declared `policy.scope` — a write verb needs `write`
 * @param allowRawWrites  the server opt-in (`SAP_ALLOW_PLUGIN_RAW_WRITES`) for non-ADT writes
 */
export function createSafeHttpClient(
  underlying: AdtHttpClient,
  safety: SafetyConfig,
  opLabel: string,
  toolScope: Scope,
  allowRawWrites: boolean,
): SafeHttpClient {
  function gateRead(): void {
    checkOperation(safety, OperationType.Read, `Custom:${opLabel}`);
  }
  function gateWrite(op: OperationTypeCode, path: string): void {
    if (!allowRawWrites) {
      throw new AdtSafetyError(
        `Extension tool '${opLabel}' attempted a write, but plugin raw writes are disabled. ` +
          'Set SAP_ALLOW_PLUGIN_RAW_WRITES=true (and SAP_ALLOW_WRITES=true) to allow non-ADT (OData/ICF) writes.',
      );
    }
    // A write verb (POST→Create / PUT→Update / DELETE→Delete) requires the tool to declare `write`.
    if (!hasRequiredScope([toolScope], 'write')) {
      throw new AdtSafetyError(
        `Extension tool '${opLabel}' declares scope '${toolScope}' and may not issue a ${op}-class write (needs scope 'write').`,
      );
    }
    // ADT object writes need `SAP_ALLOWED_PACKAGES` enforcement this raw surface can't do — refuse.
    if (isAdtPath(path)) {
      throw new AdtSafetyError(
        `Extension tool '${opLabel}' may not write to an ADT path ('${path}') — SAP_ALLOWED_PACKAGES can't be enforced on a raw write. ` +
          'Use a non-ADT (OData/ICF) path; ADT object writes are a v2 ctx.write feature.',
      );
    }
    // The server safety ceiling — POST/PUT/DELETE are mutating, so this requires allowWrites=true.
    checkOperation(safety, op, `Custom:${opLabel}`);
  }
  return {
    async get(path, headers) {
      gateRead();
      return underlying.get(path, headers);
    },
    async head(path, headers) {
      gateRead();
      return underlying.head(path, headers);
    },
    async post(path, body, contentType, headers) {
      gateWrite(OperationType.Create, path);
      return postWithoutTransientReplay(underlying, path, body, contentType, headers);
    },
    async put(path, body, contentType, headers) {
      gateWrite(OperationType.Update, path);
      return underlying.put(path, body, contentType, headers);
    },
    async delete(path, headers) {
      gateWrite(OperationType.Delete, path);
      return underlying.delete(path, headers);
    },
  };
}

/** Plain reads only: new client methods are private to ARC-1 until explicitly reviewed here.
 * Bind readers to the real per-request client so internal identity and safety checks still work.
 * This facade limits supported capabilities; plugins remain trusted in-process code, not a sandbox. */
export function createReadOnlyAdtClient(client: AdtClient): ReadOnlyAdtClient {
  return Object.freeze(
    Object.fromEntries(
      READ_ONLY_CLIENT_KEYS.map((key) => {
        const value = client[key];
        return [key, typeof value === 'function' ? value.bind(client) : value];
      }),
    ),
  ) as ReadOnlyAdtClient;
}

/** ABAP object name (class): letters/digits/underscore/slash, ≤ 40 chars. Blocks path injection. */
const ABAP_CLASS_NAME = /^[A-Za-z_/][A-Za-z0-9_/]{0,39}$/;
/** ABAP report name: optional namespace plus a 1–40 character repository name. */
const ABAP_PROGRAM_NAME = /^(?=.{1,40}$)(?:\/[A-Za-z0-9_]+\/)?[A-Za-z0-9_$]+$/;

/**
 * Build the `ctx.run` named-operation surface. These operations EXECUTE arbitrary ABAP, so the
 * gate is the strictest in the framework. Classes and reports can mutate anything, so they require
 * ALL of: the dedicated opt-in
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
  function gateExecution(kind: 'class' | 'report', operation: 'classRun' | 'programRun'): void {
    if (!allowPluginExecute) {
      throw new AdtSafetyError(
        `Extension tool '${opLabel}' tried to execute a ${kind}, but plugin code execution is disabled. ` +
          'Set SAP_ALLOW_PLUGIN_EXECUTE=true (and SAP_ALLOW_WRITES=true) to allow it.',
      );
    }
    if (!hasRequiredScope([toolScope], 'write')) {
      throw new AdtSafetyError(
        `Extension tool '${opLabel}' declares scope '${toolScope}' and may not execute a ${kind} (needs scope 'write').`,
      );
    }
    // Execution is a mutation vector — keep the `allowWrites=false ⇒ no mutation path` invariant.
    checkOperation(safety, OperationType.Workflow, `Custom:${opLabel}:${operation}`);
  }

  return {
    async classRun(className: string): Promise<string> {
      gateExecution('class', 'classRun');
      if (typeof className !== 'string' || !ABAP_CLASS_NAME.test(className)) {
        throw new AdtSafetyError(`Extension tool '${opLabel}': invalid ABAP class name '${className}'.`);
      }
      const res = await postWithoutTransientReplay(
        underlying,
        `/sap/bc/adt/oo/classrun/${encodeURIComponent(className.toLowerCase())}`,
      );
      return res.body;
    },
    async programRun(programName: string): Promise<string> {
      gateExecution('report', 'programRun');
      if (typeof programName !== 'string' || !ABAP_PROGRAM_NAME.test(programName)) {
        throw new AdtSafetyError(`Extension tool '${opLabel}': invalid ABAP program name '${programName}'.`);
      }
      const res = await postWithoutTransientReplay(
        underlying,
        `/sap/bc/adt/programs/programrun/${encodeURIComponent(programName.toLowerCase())}`,
      );
      return res.body;
    },
  };
}

// SafeHttpClient — the gated low-level HTTP surface handed to extension tools as `ctx.http`.
//
// FEAT-61 / review B1: extension tools must NOT receive the raw AdtHttpClient, whose `post/put/
// delete` bypass `checkOperation` entirely. This wrapper gates every call:
//   1. the tool's declared scope must COVER the call's operation class (a `read` tool can't POST), and
//   2. the server safety ceiling (`checkOperation`: allowWrites / allowDataPreview / …) must allow it.
// Everything else (CSRF, cookies, PP auth, stateful sessions, the semaphore) rides the underlying
// client unchanged and path-agnostically. See docs/research/extension-framework-spec.md §5.

import { AdtSafetyError } from '../adt/errors.js';
import type { AdtHttpClient, AdtResponse } from '../adt/http.js';
import { checkOperation, OperationType, type OperationTypeCode, type SafetyConfig } from '../adt/safety.js';
import { hasRequiredScope, type Scope } from '../authz/policy.js';

/** Operation class → the scope it requires (mirrors ACTION_POLICY's opType↔scope consistency). */
const OPTYPE_SCOPE: Record<OperationTypeCode, Scope> = {
  R: 'read',
  S: 'read',
  I: 'read',
  T: 'read',
  L: 'read',
  Q: 'data',
  F: 'sql',
  C: 'write',
  U: 'write',
  D: 'write',
  A: 'write',
  W: 'write',
  X: 'transports',
};

export interface SafeHttpClient {
  get(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
  head(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
  post(path: string, body?: string, contentType?: string, headers?: Record<string, string>): Promise<AdtResponse>;
  put(path: string, body: string, contentType?: string, headers?: Record<string, string>): Promise<AdtResponse>;
  delete(path: string, headers?: Record<string, string>): Promise<AdtResponse>;
  withStatefulSession<T>(fn: (s: SafeHttpClient) => Promise<T>): Promise<T>;
  // NB: fetchCsrfToken(path?) lands in PR2c alongside the AdtHttpClient change it needs (OData writes).
}

/**
 * Wrap a per-user `AdtHttpClient` in the gated surface for one tool call.
 *
 * @param underlying  the request's per-user (PP/`withSafety`) AdtHttpClient
 * @param safety      the effective per-user SafetyConfig (server ceiling ∧ user)
 * @param toolScope   the calling tool's declared `policy.scope` — the ceiling for its HTTP ops
 * @param opLabel     tool name, used in audit + error messages
 */
export function createSafeHttpClient(
  underlying: AdtHttpClient,
  safety: SafetyConfig,
  toolScope: Scope,
  opLabel: string,
): SafeHttpClient {
  function gate(op: OperationTypeCode): void {
    const required = OPTYPE_SCOPE[op];
    // (1) the tool's declared scope must cover the operation — a `read` tool may never write.
    if (!hasRequiredScope([toolScope], required)) {
      throw new AdtSafetyError(
        `Extension tool '${opLabel}' declares scope '${toolScope}' and may not issue a ${op}-class HTTP call (needs scope '${required}')`,
      );
    }
    // (2) the server safety ceiling (allowWrites / allowDataPreview / allowFreeSQL / …).
    checkOperation(safety, op, `Custom:${opLabel}`);
  }

  const self: SafeHttpClient = {
    async get(path, headers) {
      gate(OperationType.Read);
      return underlying.get(path, headers);
    },
    async head(path, headers) {
      gate(OperationType.Read);
      return underlying.head(path, headers);
    },
    async post(path, body, contentType, headers) {
      gate(OperationType.Create);
      return underlying.post(path, body, contentType, headers);
    },
    async put(path, body, contentType, headers) {
      gate(OperationType.Update);
      return underlying.put(path, body, contentType, headers);
    },
    async delete(path, headers) {
      gate(OperationType.Delete);
      return underlying.delete(path, headers);
    },
    async withStatefulSession(fn) {
      return underlying.withStatefulSession((session) => fn(createSafeHttpClient(session, safety, toolScope, opLabel)));
    },
  };
  return self;
}

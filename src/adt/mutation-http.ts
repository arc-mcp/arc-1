/** A scoped facade: it never changes the underlying transport or unrelated read requests. */

import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { assertMutationContext, type MutationContext, pinnedSessionCleanup } from './mutation-context.js';
import type { SafetyConfig } from './safety.js';

const facades = new WeakMap<AdtHttpClient, { http: AdtHttpClient; context: MutationContext }>();

function owningHttp(http: AdtHttpClient, context: MutationContext): AdtHttpClient {
  const facade = facades.get(http);
  if (!facade) return http;
  if (facade.context !== context) throw new AdtSafetyError('Cannot replace an active mutation context.');
  return facade.http;
}

/** The lifecycle alone receives the owning transport so cleanup can use its separate budget. */
export function withMutationSession<T>(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: MutationContext,
  fn: (owningSession: AdtHttpClient) => Promise<T>,
  cleanup?: Parameters<AdtHttpClient['withStatefulSession']>[1],
): Promise<T> {
  assertMutationContext(safety, context);
  const owning = owningHttp(http, context);
  if (context.mode === 'single-target') return owning.withStatefulSession(fn);
  const boundedCleanup = pinnedSessionCleanup(context);
  return owning.withStatefulSession(fn, {
    ...boundedCleanup,
    timeoutMs: Math.min(boundedCleanup.timeoutMs, cleanup?.timeoutMs ?? boundedCleanup.timeoutMs),
    onClose: (closed) => {
      boundedCleanup.onClose(closed);
      cleanup?.onClose(closed);
    },
  });
}

function composeOptions(policy: AdtRequestOptions, options?: AdtRequestOptions): AdtRequestOptions {
  const signals = [policy.signal, options?.signal].filter((value): value is AbortSignal => value !== undefined);
  return {
    ...options,
    noReplay: true,
    retryTransientErrors: false,
    deadline: options?.deadline === undefined ? policy.deadline : Math.min(policy.deadline!, options.deadline),
    signal: signals.length > 1 && signals[0] !== signals[1] ? AbortSignal.any(signals) : signals[0],
  };
}

export function mutationHttp(http: AdtHttpClient, safety: SafetyConfig, context: MutationContext): AdtHttpClient {
  assertMutationContext(safety, context);
  // Rewrapping cannot replace the scope or hide the owning session from its cleanup path.
  const owning = owningHttp(http, context);
  if (owning !== http) return http;
  // Do not add even an empty options object or change the owning session identity in legacy code.
  if (context.mode === 'single-target') return http;
  const options = (input?: AdtRequestOptions) => {
    assertMutationContext(safety, context);
    return composeOptions(context.requestPolicy, input);
  };
  const scoped: Pick<
    AdtHttpClient,
    'get' | 'head' | 'post' | 'put' | 'delete' | 'fetchCsrfToken' | 'withStatefulSession'
  > = {
    get: (path, headers, input) => http.get(path, headers, options(input)),
    head: (path, headers, input) => http.head(path, headers, options(input)),
    post: (path, body, contentType, headers, input) => http.post(path, body, contentType, headers, options(input)),
    put: (path, body, contentType, headers, input) => http.put(path, body, contentType, headers, options(input)),
    delete: (path, headers, input) => http.delete(path, headers, options(input)),
    fetchCsrfToken: (input) => http.fetchCsrfToken(options(input)),
    withStatefulSession: (fn, cleanup) =>
      withMutationSession(http, safety, context, (session) => fn(mutationHttp(session, safety, context)), cleanup),
  };
  const facade = new Proxy(http, {
    get(target, key) {
      if (Object.hasOwn(scoped, key)) return scoped[key as keyof typeof scoped];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  facades.set(facade, { http, context });
  return facade;
}

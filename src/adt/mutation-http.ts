/** A scoped facade: it never changes the underlying transport or unrelated read requests. */

import { DataResponseBudget } from './data-result-context.js';
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { assertMutationContext, type MutationContext, type PinnedMutationContext } from './mutation-context.js';
import type { SafetyConfig } from './safety.js';

const facades = new WeakMap<AdtHttpClient, { http: AdtHttpClient; context: MutationContext }>();

type RequestMethods = Pick<AdtHttpClient, 'get' | 'head' | 'post' | 'put' | 'delete' | 'fetchCsrfToken'>;

/** Shared request mapping only; session ownership and native submission evidence remain with their callers. */
export function requestHttp(
  http: AdtHttpClient,
  options: (input?: AdtRequestOptions) => AdtRequestOptions,
  methods?: readonly (keyof RequestMethods)[],
  overrides: Partial<AdtHttpClient> = {},
): AdtHttpClient {
  const requests: RequestMethods = {
    get: (path, headers, input) => http.get(path, headers, options(input)),
    head: (path, headers, input) => http.head(path, headers, options(input)),
    post: (path, body, type, headers, input) => http.post(path, body, type, headers, options(input)),
    put: (path, body, type, headers, input) => http.put(path, body, type, headers, options(input)),
    delete: (path, headers, input) => http.delete(path, headers, options(input)),
    fetchCsrfToken: (input) => http.fetchCsrfToken(options(input)),
  };
  const selected = {
    ...Object.fromEntries(
      Object.entries(requests).filter(([key]) => !methods || methods.includes(key as keyof RequestMethods)),
    ),
    ...overrides,
  };
  return new Proxy(http, {
    get(target, key) {
      if (Object.hasOwn(selected, key)) return selected[key as keyof typeof selected];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Recover only a factory-registered context; callers cannot supply a context-shaped transport field. */
export function getMutationContext(http: AdtHttpClient, safety: SafetyConfig): MutationContext | undefined {
  const context = facades.get(http)?.context;
  if (context) assertMutationContext(safety, context);
  return context;
}

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
  if (cleanup && !Number.isFinite(cleanup.timeoutMs)) throw new AdtSafetyError('Invalid mutation cleanup budget.');
  // Reserve cleanup capacity independently of the mutation's consumed response allowance.
  const responseBudget = cleanup?.responseBudget ?? new DataResponseBudget(64 * 1024, 'session-close', true);
  if (responseBudget.limitBytes > 64 * 1024 || !responseBudget.countAllResponses)
    throw new AdtSafetyError('Pinned session cleanup requires an all-response allowance of at most 64 KiB.');
  return owning.withStatefulSession(fn, {
    timeoutMs: Math.min(30_000, cleanup?.timeoutMs ?? 30_000),
    responseBudget,
    noReplay: true,
    onClose: (closed) => cleanup?.onClose(closed),
  });
}

function composeOptions(
  policy: PinnedMutationContext['requestPolicy'],
  options?: AdtRequestOptions,
): AdtRequestOptions {
  if (options?.deadline !== undefined && !Number.isFinite(options.deadline))
    throw new AdtSafetyError('Invalid nested mutation deadline.');
  const signals = [policy.signal, options?.signal].filter((value): value is AbortSignal => value !== undefined);
  return {
    ...options,
    noReplay: true,
    retryTransientErrors: false,
    // An outer native operation owns these cumulative allowances; nested adapters cannot reset them.
    ...(policy.responseBudget ? { responseBudget: policy.responseBudget } : {}),
    ...(policy.attemptBudget ? { attemptBudget: policy.attemptBudget } : {}),
    deadline: options?.deadline === undefined ? policy.deadline : Math.min(policy.deadline, options.deadline),
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
  const facade = requestHttp(http, options, undefined, {
    // A NEW SAP context: it does not own a lock acquired in the parent session. Its close
    // result belongs only to its callback, never the mutation owner's shared cleanup state.
    withStatefulSession: (fn, cleanup) =>
      withMutationSession(http, safety, context, (session) => fn(mutationHttp(session, safety, context)), cleanup),
  });
  facades.set(facade, { http, context });
  return facade;
}

/** Shared observation only: each native experiment supplies its own exact request and cleanup guards. */
import { createHash } from 'node:crypto';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtApiError, extractExceptionType } from '../../../src/adt/errors.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { AdtRequestNotSentError } from "../../../src/adt/errors.js";

export function nativeRequestPolicy(options?: AdtRequestOptions): AdtRequestOptions {
  if (options?.deadline !== undefined && !Number.isFinite(options.deadline))
    throw new Error('A supplied native-contract deadline must be finite.');
  const responseBudget = options?.responseBudget ?? new DataResponseBudget(2 * 1024 * 1024, 'native-contract', true);
  if (responseBudget.limitBytes > 2 * 1024 * 1024 || !responseBudget.countAllResponses)
    throw new Error('Native-contract responses require an all-response allowance of at most 2 MiB.');
  return {
    ...options,
    responseBudget,
    deadline: Math.min(options?.deadline ?? Infinity, Date.now() + 30_000),
    noReplay: true,
    retryTransientErrors: false,
    attemptBudget: options?.attemptBudget ?? new RequestAttemptBudget(32),
  };
}

/** No headers/cookies are captured. Lock-related response bodies and query handles are excluded. */
export function observeNativeHttp(
  http: AdtHttpClient,
  validateRequest: (method: string, path: string, body?: string) => void,
  record: (value: unknown) => void,
  beforeDelete: (session: AdtHttpClient, path: string, policy: AdtRequestOptions) => Promise<void>,
): AdtHttpClient {
  return new Proxy(http, {
    get(target, property) {
      if (property === 'withStatefulSession')
        return (
          run: (session: AdtHttpClient) => Promise<unknown>,
          cleanup: Parameters<AdtHttpClient['withStatefulSession']>[1],
        ) =>
          target.withStatefulSession(
            (session) => run(observeNativeHttp(session, validateRequest, record, beforeDelete)),
            cleanup,
          );
      if (['get', 'head', 'post', 'put', 'delete'].includes(String(property)))
        return async (...input: unknown[]) => {
          const method = String(property).toUpperCase();
          const path = String(input[0]),
            body = method === 'POST' || method === 'PUT' ? (input[1] as string | undefined) : undefined;
          const optionIndex = method === 'POST' || method === 'PUT' ? 4 : 2;
          let label = { method, path: '<invalid native path>' },
            sensitive = false;
          try {
            const uri = new URL(path, 'https://a4h.marianzeis.de');
            sensitive = uri.searchParams.has('_action');
            for (const key of [...uri.searchParams.keys()])
              if (key.toLowerCase() === 'lockhandle') {
                sensitive = true;
                uri.searchParams.delete(key);
              }
            label = { method, path: uri.pathname + uri.search };
            validateRequest(method, path, body);
            const original = input[optionIndex] as AdtRequestOptions | undefined;
            const policy = nativeRequestPolicy(original);
            throwIfRequestCancelled(policy);
            if (method === 'DELETE') {
              await beforeDelete(
                observeNativeHttp(target, validateRequest, record, beforeDelete),
                path.split('?')[0],
                policy,
              );
              // The independent guard can await network reads. Its original request/source
              // authorization must still hold before journaling or sending the deletion.
              validateRequest(method, path, body);
            }
            // Refresh the per-request clamp after guard reads, without extending the outer deadline
            // or replenishing its attempt allowance.
            input[optionIndex] = nativeRequestPolicy({
              ...original,
              attemptBudget: policy.attemptBudget,
              responseBudget: policy.responseBudget,
            });
            const finalPolicy = input[optionIndex] as AdtRequestOptions;
            const allowance = finalPolicy.attemptBudget!;
            // The same allowance reaches direct and Connectivity dispatch after queue/auth/CSRF waits.
            // Charge the original budget first; all synchronous parent proof work precedes our final proof.
            finalPolicy.attemptBudget = new Proxy(allowance, {
              get(budget, key) {
                if (key === 'consume') return () => {
                  budget.consume();
                  try {
                    validateRequest(method, path, body);
                    throwIfRequestCancelled(finalPolicy);
                  } catch (error) {
                    const reason = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown local refusal';
                    record({ stage: 'refused-before-dispatch', ...label, reason });
                    throw error;
                  }
                };
                if (key === 'dispatched') return (actualMethod: string) => {
                  budget.dispatched?.(actualMethod);
                  // A HEAD/GET bootstrap for this mutation is not evidence of mutation handoff.
                  if (actualMethod === method) record({ stage: 'dispatch', ...label });
                };
                const value = Reflect.get(budget, key);
                return typeof value === 'function' ? value.bind(budget) : value;
              },
            });
            throwIfRequestCancelled(finalPolicy);
            if (method === 'DELETE' && (input[optionIndex] as AdtRequestOptions).deadline! - Date.now() < 5000)
              throw new Error('DELETE requires at least five seconds remaining after its receipt guard.');
          } catch (error) {
            const reason = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown local refusal';
            record({ stage: 'refused-before-send', ...label, reason });
            throw new AdtRequestNotSentError(method, `Native contract refused before send: ${reason}`);
          }
          record({ stage: 'request', ...label, ...(body ? { body } : {}) });
          try {
            const request = Reflect.get(target, property) as (...args: unknown[]) => ReturnType<AdtHttpClient['get']>;
            const response = await Reflect.apply(request, target, input);
            record({
              stage: 'response',
              ...label,
              status: response.statusCode,
              bytes: Buffer.byteLength(response.body),
              sha256: createHash('sha256').update(response.body).digest('hex'),
              ...(!sensitive && Buffer.byteLength(response.body) <= 2 * 1024 * 1024 ? { body: response.body } : {}),
            });
            return response;
          } catch (error) {
            record({
              stage: 'error',
              ...label,
              name: error instanceof Error ? error.name : 'unknown',
              ...(error instanceof AdtApiError ? { status: error.statusCode } : {}),
              ...(error instanceof AdtApiError && error.responseBody
                ? { bytes: Buffer.byteLength(error.responseBody), sha256: createHash('sha256').update(error.responseBody).digest('hex') }
                : {}),
              ...(!sensitive &&
              error instanceof AdtApiError &&
              error.responseBody &&
              Buffer.byteLength(error.responseBody) <= 1024 * 1024 &&
              extractExceptionType(error.responseBody)
                ? { body: error.responseBody }
                : {}),
            });
            throw error;
          }
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

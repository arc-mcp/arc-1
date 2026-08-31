import { setTimeout as sleep } from 'node:timers/promises';
import { AdtNetworkError } from './errors.js';

export interface RequestDeadlineOptions {
  signal?: AbortSignal;
  deadline?: number;
}

export interface AdtRequestOptions extends RequestDeadlineOptions {
  /** Override the 120-second per-fetch cap for a known long-running ADT operation. */
  fetchTimeoutMs?: number;
  /** Optional ADT subresource: handled 404s may be logged at debug level. */
  suppressNotFoundLog?: boolean;
  /** Capability probe: all non-2xx responses are expected evidence, not warning noise. */
  probe?: boolean;
}

const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

function callerDeadlineRemaining(options?: RequestDeadlineOptions): number | undefined {
  if (options?.deadline === undefined) return undefined;
  if (!Number.isFinite(options.deadline)) {
    throw new RangeError('ADT request deadline must be a finite epoch-millisecond value.');
  }
  return Math.ceil(options.deadline - Date.now());
}

function requestDeadlineRemaining(options?: RequestDeadlineOptions): number {
  const callerRemaining = callerDeadlineRemaining(options);
  const configuredTimeout = (options as AdtRequestOptions | undefined)?.fetchTimeoutMs;
  if (configuredTimeout !== undefined && (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0)) {
    throw new RangeError('ADT fetch timeout must be a positive finite millisecond value.');
  }
  const fetchTimeout = configuredTimeout === undefined ? DEFAULT_FETCH_TIMEOUT_MS : Math.ceil(configuredTimeout);
  return callerRemaining === undefined ? fetchTimeout : Math.min(fetchTimeout, callerRemaining);
}

function requestTimeoutError(): DOMException {
  return new DOMException('The ADT request deadline was exceeded.', 'TimeoutError');
}

function requestAbortError(signal: AbortSignal): AdtNetworkError {
  const cause = signal.reason instanceof Error ? signal.reason : new Error('The ADT request was aborted.');
  return new AdtNetworkError(cause.message, cause);
}

export function throwIfRequestCancelled(options?: RequestDeadlineOptions): void {
  if (options?.signal?.aborted) {
    throw requestAbortError(options.signal);
  }
  const callerRemaining = callerDeadlineRemaining(options);
  if (callerRemaining !== undefined && callerRemaining <= 0) {
    const cause = requestTimeoutError();
    throw new AdtNetworkError(cause.message, cause);
  }
}

/** Caller-owned cancellation only (no built-in fetch timeout). */
export function requestBudgetSignal(options?: RequestDeadlineOptions): AbortSignal | undefined {
  throwIfRequestCancelled(options);
  const signals: AbortSignal[] = [];
  if (options?.signal) signals.push(options.signal);
  const callerRemaining = callerDeadlineRemaining(options);
  if (callerRemaining !== undefined) signals.push(AbortSignal.timeout(Math.max(1, callerRemaining)));
  if (signals.length === 0) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

/** Await a non-fetch dependency without leaving an unhandled rejection after cancellation. */
export async function awaitWithRequestSignal<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(requestAbortError(signal)));

    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

export function awaitWithinRequestBudget<T>(operation: Promise<T>, options?: RequestDeadlineOptions): Promise<T> {
  try {
    return awaitWithRequestSignal(operation, requestBudgetSignal(options));
  } catch (error) {
    // `operation` was already created by the caller. Observe any later rejection
    // even when the deadline expires while a provider is returning its promise.
    void operation.catch(() => undefined);
    return Promise.reject(error);
  }
}

/** Compose the built-in per-fetch timeout with the caller's signal/deadline. */
export function requestSignal(options?: RequestDeadlineOptions): AbortSignal {
  throwIfRequestCancelled(options);
  const signals = [AbortSignal.timeout(requestDeadlineRemaining(options))];
  if (options?.signal) signals.unshift(options.signal);
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

/** Retry delays consume the same caller budget as their surrounding HTTP request. */
export async function sleepWithinRequestBudget(delayMs: number, options?: RequestDeadlineOptions): Promise<void> {
  if (delayMs <= 0) {
    throwIfRequestCancelled(options);
    return;
  }
  const signal = requestSignal(options);
  try {
    await sleep(delayMs, undefined, { signal });
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? requestTimeoutError();
    throw error;
  }
}

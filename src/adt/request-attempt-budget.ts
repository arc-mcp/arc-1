import { fetch, getGlobalDispatcher, type RequestInit } from 'undici';
import { AdtNetworkError } from './errors.js';

/** Typed, non-retryable exhaustion; never carries SAP response data. */
export class AdtRequestBudgetError extends AdtNetworkError {
  constructor(readonly limit: number) {
    super(`SAP HTTP attempt limit (${limit}) reached. Narrow the requested analysis.`);
    this.name = 'AdtRequestBudgetError';
  }
}

/** Request-local allowance, charged immediately before each direct/proxy SAP send. */
export class RequestAttemptBudget {
  used = 0;
  /** A later body/retry limit must not turn a failed auth response into partial success. */
  authorizationFailureObserved = false;
  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Request limit must be a positive integer.');
  }
  consume(): void {
    if (this.used >= this.limit) throw new AdtRequestBudgetError(this.limit);
    this.used++;
  }
}

/** Count below Fetch's internal 421 replay; preserve the existing dispatcher/TLS configuration. */
export async function fetchWithAttemptBudget(url: string, init: RequestInit, budget?: RequestAttemptBudget) {
  if (!budget) return fetch(url, init);
  const dispatcher = (init.dispatcher ?? getGlobalDispatcher()).compose((dispatch) => (options, handler) => {
    budget.consume();
    return dispatch(options, handler);
  });
  try {
    return await fetch(url, { ...init, dispatcher });
  } catch (error) {
    // Fetch wraps dispatcher errors. Keep exhaustion typed and non-retryable for partial-result policy.
    if (error instanceof TypeError && error.cause instanceof AdtRequestBudgetError) throw error.cause;
    throw error;
  }
}

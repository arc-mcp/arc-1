import { fetch, getGlobalDispatcher, type RequestInit } from 'undici';
import { AdtNetworkError } from './errors.js';
import { type AdtRequestOptions, throwIfRequestCancelled } from './http-deadline.js';

/** Typed, non-retryable exhaustion; never carries SAP response data. */
export class AdtRequestBudgetError extends AdtNetworkError {
  constructor(readonly limit: number) {
    super(`SAP HTTP attempt limit (${limit}) reached. Narrow the requested analysis.`);
    this.name = 'AdtRequestBudgetError';
  }
}

class AdtRequestReplayError extends AdtRequestBudgetError {
  constructor() {
    super(1);
    this.name = 'AdtRequestReplayError';
    this.message =
      'Automatic HTTP replay was refused. The initial request may have reached SAP; inspect its outcome before retrying.';
  }
}

/** Analysis admission/work allowance, not a failure to reach SAP. */
export class AdtAnalysisDeadlineError extends AdtNetworkError {
  constructor() {
    super('The live analysis time limit was reached. Narrow the analysis or wait for other analyses to finish.');
    this.name = 'AdtAnalysisDeadlineError';
  }
}

/** A time boundary may yield partial evidence; cancellation, auth and send exhaustion may not masquerade as it. */
export function isDeadlineFailure(error: unknown, options: AdtRequestOptions): boolean {
  return (
    error instanceof AdtNetworkError &&
    !(error instanceof AdtRequestBudgetError) &&
    options.deadline !== undefined &&
    Date.now() >= options.deadline &&
    !options.signal?.aborted &&
    !options.attemptBudget?.authorizationFailureObserved
  );
}

/** Request-local allowance, charged immediately before each direct/proxy SAP send. */
export class RequestAttemptBudget {
  used = 0;
  /** Unresolved auth evidence; only a validated native expansion may clear it after retry recovery. */
  authorizationFailureObserved = false;
  constructor(
    readonly limit: number,
    readonly revalidation?: { validate: () => void; parent?: RequestAttemptBudget },
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Request limit must be a positive integer.');
  }
  consume(): void {
    this.revalidation?.validate();
    if (this.used >= this.limit) throw new AdtRequestBudgetError(this.limit);
    this.used++;
    this.revalidation?.parent?.consume();
  }
  /** Transport handoff, not native success. CSRF/bootstrap reports its own actual HTTP method. */
  dispatched?: (method: string) => void;
}

/** Notify a submitted Connectivity request; retire its response if receipt persistence fails. */
export function recordSubmittedRequest<T extends { body: { destroy(): unknown } }>(
  pending: Promise<T>,
  budget: RequestAttemptBudget | undefined,
  method: string,
): Promise<T> {
  try {
    budget?.dispatched?.(method);
  } catch (error) {
    void pending.then((response) => response.body.destroy()).catch(() => {});
    throw error;
  }
  return pending;
}

/** Count below Fetch's internal 421 replay; preserve the existing dispatcher/TLS configuration. */
export async function fetchWithAttemptBudget(
  url: string,
  init: RequestInit,
  options?: Pick<AdtRequestOptions, 'attemptBudget' | 'noReplay' | 'deadline' | 'signal'>,
) {
  const { attemptBudget: budget, noReplay = false } = options ?? {};
  if (!budget && !noReplay) return fetch(url, init);
  // A CSRF bootstrap and its mutation are separate fetches. Each may send once even when
  // their shared allowance has room left; Fetch must not silently resend either on 421.
  let sent = false;
  let receiptFailure: { error: unknown } | undefined;
  const dispatcher = (init.dispatcher ?? getGlobalDispatcher()).compose((dispatch) => (request, handler) => {
    if (noReplay && sent) throw new AdtRequestReplayError();
    budget?.consume();
    // A synchronous final proof can outlive the timer before the event loop can abort it.
    throwIfRequestCancelled({ deadline: options?.deadline, signal: init.signal ?? options?.signal });
    sent = true;
    const result = dispatch(request, handler);
    try {
      budget?.dispatched?.(request.method);
    } catch (error) {
      // A synchronous dispatcher can have completed its handler already; Fetch may ignore a late throw.
      receiptFailure = { error };
    }
    return result;
  });
  try {
    const response = await fetch(url, { ...init, dispatcher });
    if (receiptFailure) {
      await response.body?.cancel().catch(() => {});
      throw receiptFailure.error;
    }
    return response;
  } catch (error) {
    // Fetch wraps dispatcher errors. Preserve typed local budget/deadline/cancellation refusals.
    if (error instanceof TypeError && error.cause instanceof AdtNetworkError) throw error.cause;
    throw error;
  }
}

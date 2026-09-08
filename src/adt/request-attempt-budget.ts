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

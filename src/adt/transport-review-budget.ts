import { getCurrentContext } from '../server/context.js';
import { DataResponseBudget } from './data-result-context.js';
import { AdtResponseLimitError } from './errors.js';
import { type AdtRequestOptions, throwIfRequestCancelled } from './http-deadline.js';
import { RequestAttemptBudget } from './request-attempt-budget.js';

export const REVIEW_DEADLINE_MS = 20_000;

/** One review page: bounded sequential reads, including inventory, retries and CSRF. */
export class ReviewBudget {
  readonly started = Date.now();
  readonly deadline = this.started + REVIEW_DEADLINE_MS;
  readonly attempts = new RequestAttemptBudget(180);
  bytes = 0;
  reads = 0;
  exhausted = false;
  stopReason?: string;

  async read<T>(operation: (request: AdtRequestOptions) => Promise<T>): Promise<T> {
    const remaining = 8 * 1024 * 1024 - this.bytes;
    const responseBudget = new DataResponseBudget(Math.max(1, Math.min(1024 * 1024, remaining)), 'transport-review');
    const request: AdtRequestOptions = {
      deadline: this.deadline,
      signal: getCurrentContext()?.signal,
      responseBudget,
      attemptBudget: this.attempts,
    };
    try {
      throwIfRequestCancelled(request);
      if (remaining <= 0 || this.exhausted || this.reads >= 180) throw new Error('Review collection budget exhausted.');
      this.reads++;
      return await operation(request);
    } catch (error) {
      // Failed streaming reservations are released by HTTP. Stop this page rather than
      // repeatedly downloading oversized bodies whose bytes would otherwise go uncharged.
      if (error instanceof AdtResponseLimitError) {
        this.bytes += Math.max(0, error.observedBytes - responseBudget.consumedBytes);
        this.exhausted = true;
        this.stopReason = 'response byte limit';
      }
      if (remaining <= 0 || Date.now() >= this.deadline || this.attempts.used >= 180 || this.reads >= 180)
        this.exhausted = true;
      if (request.signal?.aborted) {
        this.exhausted = true;
        this.stopReason = 'cancelled';
      } else if (Date.now() >= this.deadline) this.stopReason = 'deadline';
      else if (this.exhausted && !this.stopReason) this.stopReason = 'collection limit';
      throw error;
    } finally {
      this.bytes += responseBudget.consumedBytes;
    }
  }
}

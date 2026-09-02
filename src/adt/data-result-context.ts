import { AdtResponseLimitError } from './errors.js';
import type { Semaphore } from './semaphore.js';

export const DEFAULT_DATA_PREVIEW_RESPONSE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_CONCURRENT_DATA_RESULTS = 2;

interface ReservationState {
  bytes: number;
  settled: boolean;
}

/** One cumulative post-content-decoding allowance shared by a complete MCP tool call. */
export class DataResponseBudget {
  private committedBytes = 0;
  private inFlightBytes = 0;

  constructor(
    readonly limitBytes: number,
    readonly endpointFamily = 'data-preview',
  ) {
    if (!Number.isSafeInteger(limitBytes) || limitBytes < 1) {
      throw new RangeError(`Data response limit must be a positive safe integer, got ${limitBytes}.`);
    }
  }

  get consumedBytes(): number {
    return this.committedBytes;
  }

  get reservedBytes(): number {
    return this.inFlightBytes;
  }

  createReservation(): DataResponseReservation {
    return new DataResponseReservation(this, { bytes: 0, settled: false });
  }

  assertSingleResponseBytes(bytes: number, requestId?: string): void {
    if (bytes > this.limitBytes) {
      throw new AdtResponseLimitError(this.limitBytes, bytes, this.endpointFamily, requestId);
    }
  }

  reserve(state: ReservationState, nextChunkBytes: number, requestId?: string): void {
    if (state.settled) throw new Error('Cannot reserve bytes on a settled data-response reservation.');
    const observedBytes = this.committedBytes + this.inFlightBytes + nextChunkBytes;
    if (observedBytes > this.limitBytes) {
      throw new AdtResponseLimitError(this.limitBytes, observedBytes, this.endpointFamily, requestId);
    }
    state.bytes += nextChunkBytes;
    this.inFlightBytes += nextChunkBytes;
  }

  commit(state: ReservationState): void {
    if (state.settled) return;
    state.settled = true;
    this.inFlightBytes -= state.bytes;
    this.committedBytes += state.bytes;
  }

  release(state: ReservationState): void {
    if (state.settled) return;
    state.settled = true;
    this.inFlightBytes -= state.bytes;
  }
}

export class DataResponseReservation {
  constructor(
    private readonly budget: DataResponseBudget,
    private readonly state: ReservationState,
  ) {}

  add(bytes: number, requestId?: string): void {
    this.budget.reserve(this.state, bytes, requestId);
  }

  commit(): void {
    this.budget.commit(this.state);
  }

  release(): void {
    this.budget.release(this.state);
  }
}

/** Lazy process-wide admission lease plus the request's cumulative response budget. */
export class DataResultScope {
  readonly responseBudget: DataResponseBudget;
  private leasePromise?: Promise<void>;
  private leaseHeld = false;
  private released = false;
  private _queueWaitMs = 0;

  constructor(
    limitBytes: number,
    private readonly semaphore?: Semaphore,
  ) {
    this.responseBudget = new DataResponseBudget(limitBytes);
  }

  get queueWaitMs(): number {
    return this._queueWaitMs;
  }

  get hasLease(): boolean {
    return this.leaseHeld;
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.released) throw new Error('Cannot acquire a released data-result scope.');
    if (!this.semaphore || this.leaseHeld) return;
    if (!this.leasePromise) {
      const startedAt = Date.now();
      this.leasePromise = this.semaphore.acquire(signal).then(() => {
        this._queueWaitMs = Date.now() - startedAt;
        this.leaseHeld = true;
      });
    }
    await this.leasePromise;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    if (this.leaseHeld) {
      this.leaseHeld = false;
      this.semaphore?.release();
    }
  }
}

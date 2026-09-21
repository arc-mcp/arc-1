/**
 * Async semaphore for limiting concurrent SAP HTTP requests.
 *
 * Prevents SAP work process exhaustion by capping the number of
 * inflight requests. When the limit is reached, new requests wait
 * in a FIFO queue until a slot is released.
 */

export class Semaphore {
  private _inflight = 0;
  private readonly _max: number;
  private readonly _queue: Array<{ grant: () => void; cancel: () => void }> = [];

  constructor(max: number) {
    if (max < 1) throw new Error(`Semaphore max must be >= 1, got ${max}`);
    this._max = max;
  }

  /** Number of currently active slots */
  get inflight(): number {
    return this._inflight;
  }

  /** Number of callers waiting for a slot */
  get waiting(): number {
    return this._queue.length;
  }

  /** Acquire a slot. Resolves immediately if available, otherwise waits in FIFO order. */
  async acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this._inflight < this._max) {
      this._inflight++;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', entry.cancel);
      const entry = {
        grant: () => {
          cleanup();
          this._inflight++;
          resolve();
        },
        cancel: () => {
          const index = this._queue.indexOf(entry);
          if (index < 0) return;
          this._queue.splice(index, 1);
          cleanup();
          reject(signal?.reason ?? new DOMException('The semaphore wait was aborted.', 'AbortError'));
        },
      };
      this._queue.push(entry);
      signal?.addEventListener('abort', entry.cancel, { once: true });
      if (signal?.aborted) entry.cancel();
    });
  }

  /** Release a slot, waking the next waiter if any. */
  release(): void {
    this._inflight--;
    const next = this._queue.shift();
    if (next) next.grant();
  }

  /** Run a function within a semaphore slot (acquire + try/finally release). */
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

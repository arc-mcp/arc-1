import { describe, expect, it } from 'vitest';
import { DataResponseBudget, DataResultScope } from '../../../src/adt/data-result-context.js';
import { AdtResponseLimitError } from '../../../src/adt/errors.js';
import { Semaphore } from '../../../src/adt/semaphore.js';

describe('DataResponseBudget', () => {
  it('commits completed reservations and releases failed ones', () => {
    const budget = new DataResponseBudget(10);
    const first = budget.createReservation();
    first.add(4);
    expect(budget.reservedBytes).toBe(4);
    first.commit();
    expect(budget.consumedBytes).toBe(4);
    expect(budget.reservedBytes).toBe(0);

    const second = budget.createReservation();
    second.add(3);
    second.release();
    expect(budget.consumedBytes).toBe(4);
    expect(budget.reservedBytes).toBe(0);
  });

  it('includes every in-flight reservation in the cumulative admission decision', () => {
    const budget = new DataResponseBudget(5);
    const first = budget.createReservation();
    const second = budget.createReservation();
    first.add(3);
    expect(() => second.add(3, 'REQ-1')).toThrowError(
      expect.objectContaining<Partial<AdtResponseLimitError>>({
        code: 'DATA_RESPONSE_TOO_LARGE',
        limitBytes: 5,
        observedBytes: 6,
        requestId: 'REQ-1',
      }),
    );
    first.release();
    second.release();
  });

  it('uses the same hard ceiling for a single non-success response without charging it', () => {
    const budget = new DataResponseBudget(5);
    budget.assertSingleResponseBytes(5);
    expect(() => budget.assertSingleResponseBytes(6)).toThrow(AdtResponseLimitError);
    expect(budget.consumedBytes).toBe(0);
  });

  it('rejects non-positive and unsafe limits', () => {
    expect(() => new DataResponseBudget(0)).toThrow(RangeError);
    expect(() => new DataResponseBudget(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('DataResultScope', () => {
  it('acquires lazily, queues FIFO through the shared semaphore, and releases once', async () => {
    const semaphore = new Semaphore(1);
    const first = new DataResultScope(10, semaphore);
    const second = new DataResultScope(10, semaphore);

    expect(semaphore.inflight).toBe(0);
    await first.acquire();
    const waiting = second.acquire();
    expect(semaphore.inflight).toBe(1);
    expect(semaphore.waiting).toBe(1);

    first.release();
    await waiting;
    expect(second.hasLease).toBe(true);
    expect(semaphore.inflight).toBe(1);
    second.release();
    second.release();
    expect(semaphore.inflight).toBe(0);
  });

  it('removes an aborted queued waiter without leaking a slot', async () => {
    const semaphore = new Semaphore(1);
    const active = new DataResultScope(10, semaphore);
    const queued = new DataResultScope(10, semaphore);
    await active.acquire();
    const controller = new AbortController();
    const waiting = queued.acquire(controller.signal);
    controller.abort(new Error('cancelled'));

    await expect(waiting).rejects.toThrow('cancelled');
    expect(semaphore.waiting).toBe(0);
    active.release();
    queued.release();
    expect(semaphore.inflight).toBe(0);
  });

  it('returns a slot granted after the waiting scope was released', async () => {
    const semaphore = new Semaphore(1);
    const active = new DataResultScope(10, semaphore);
    const queued = new DataResultScope(10, semaphore);
    await active.acquire();
    const waiting = queued.acquire();
    expect(semaphore.waiting).toBe(1);

    queued.release();
    active.release();

    await expect(waiting).rejects.toThrow('released while waiting for admission');
    expect(queued.hasLease).toBe(false);
    expect(semaphore.inflight).toBe(0);
    expect(semaphore.waiting).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { Semaphore } from '../../../src/adt/semaphore.js';

describe('Semaphore', () => {
  it('throws when max < 1', () => {
    expect(() => new Semaphore(0)).toThrow('Semaphore max must be >= 1');
    expect(() => new Semaphore(-5)).toThrow('Semaphore max must be >= 1');
  });

  it('starts with inflight=0 and waiting=0', () => {
    const sem = new Semaphore(3);
    expect(sem.inflight).toBe(0);
    expect(sem.waiting).toBe(0);
  });

  it('acquire increments inflight', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    expect(sem.inflight).toBe(1);
    await sem.acquire();
    expect(sem.inflight).toBe(2);
  });

  it('release decrements inflight', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    sem.release();
    expect(sem.inflight).toBe(1);
    sem.release();
    expect(sem.inflight).toBe(0);
  });

  it('queues when at capacity and resolves in FIFO order', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    await sem.acquire(); // slot taken

    // These two will queue
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));

    expect(sem.waiting).toBe(2);

    // Release first — should wake p1
    sem.release();
    await p1;
    expect(sem.inflight).toBe(1);
    expect(sem.waiting).toBe(1);

    // Release again — should wake p2
    sem.release();
    await p2;
    expect(order).toEqual([1, 2]);
  });

  it('removes an aborted waiter without granting it a slot later', async () => {
    const sem = new Semaphore(1);
    const controller = new AbortController();
    let cancelledRan = false;

    await sem.acquire();
    const cancelled = sem.run(async () => {
      cancelledRan = true;
    }, controller.signal);
    const next = sem.acquire();
    expect(sem.waiting).toBe(2);

    controller.abort(new DOMException('deadline', 'TimeoutError'));
    await expect(cancelled).rejects.toThrow('deadline');
    expect(sem.waiting).toBe(1);

    sem.release();
    await next;
    expect(cancelledRan).toBe(false);
    expect(sem.inflight).toBe(1);
    sem.release();
  });

  it('run() executes fn and releases on success', async () => {
    const sem = new Semaphore(1);
    const result = await sem.run(async () => {
      expect(sem.inflight).toBe(1);
      return 42;
    });
    expect(result).toBe(42);
    expect(sem.inflight).toBe(0);
  });

  it('run() releases on error', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(sem.inflight).toBe(0);
  });

  it('enforces concurrency bound', async () => {
    const sem = new Semaphore(2);
    let maxConcurrent = 0;
    let current = 0;

    const task = async () => {
      return sem.run(async () => {
        current++;
        if (current > maxConcurrent) maxConcurrent = current;
        // Yield to allow other tasks to run
        await new Promise((resolve) => setTimeout(resolve, 10));
        current--;
      });
    };

    await Promise.all([task(), task(), task(), task(), task()]);
    expect(maxConcurrent).toBe(2);
  });
});

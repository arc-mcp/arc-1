import { HarnessError } from './safe-io.mjs';

/** Forward work stops cooperatively; cleanup retains its tokens until every tracked task settles. */
export class QualificationShutdown {
  controller = new AbortController();
  tasks = new Set();
  get stopping() {
    return this.controller.signal.aborted;
  }
  /** @returns {{ readonly aborted: boolean }} */
  get signal() {
    return this.controller.signal;
  }
  request() {
    if (this.stopping) return false;
    this.controller.abort();
    return true;
  }
  async track(work) {
    if (this.stopping) throw new HarnessError('HARNESS_STOPPED');
    const task = Promise.resolve().then(() => {
      if (this.stopping) throw new HarnessError('HARNESS_STOPPED');
      return work();
    });
    this.tasks.add(task);
    try {
      return await task;
    } finally {
      this.tasks.delete(task);
    }
  }
  async drain() {
    while (this.tasks.size) await Promise.allSettled([...this.tasks]);
  }
}

export function checkForwardWork(signal, recovering) {
  if (!recovering && signal?.aborted) throw new HarnessError('QUALIFICATION_STOP_REQUESTED');
}

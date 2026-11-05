/** Strict operator input for the currently displayed observation prompt; no queued acknowledgements. */
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { LockObservationPrompt, PassiveLockObservation } from './native-lock-observation.js';

export function createPassiveObservationChannel(
  input: Readable,
  controller: AbortController,
  notify: (prompt: { step: string; resource: string }) => void,
) {
  const lines = createInterface({ input, terminal: false, crlfDelay: Infinity });
  let closed = false,
    bytes = 0;
  let pending: { step: string; settle: (value?: PassiveLockObservation) => void } | undefined;
  const fail = () => {
    controller.abort(new Error('Invalid or interrupted observation input.'));
    pending?.settle();
  };
  const count = (chunk: string | Buffer) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 4096) {
      fail();
      input.destroy();
    }
  };
  input.on('data', count);
  input.on('error', fail);
  lines.on('error', fail);
  lines.on('line', (line) => {
    try {
      if (!pending || line.length > 256) throw new Error('Unexpected input');
      const value = JSON.parse(line);
      if (
        !value ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'observation,step' ||
        value.step !== pending.step ||
        !['present', 'absent', 'changed', 'unknown'].includes(value.observation)
      )
        throw new Error('Unmatched observation');
      pending.settle(value.observation);
    } catch {
      fail();
    }
  });
  lines.on('close', () => {
    if (!closed) {
      closed = true;
      fail();
    }
  });
  return {
    observe: (prompt: LockObservationPrompt): Promise<PassiveLockObservation> =>
      new Promise((resolve, reject) => {
        if (closed || pending || prompt.signal.aborted || controller.signal.aborted) {
          reject(new Error('Observation input is unavailable.'));
          return;
        }
        const abort = () => settle();
        const settle = (value?: PassiveLockObservation) => {
          prompt.signal.removeEventListener('abort', abort);
          pending = undefined;
          if (value) resolve(value);
          else reject(new Error('Observation input stopped.'));
        };
        pending = { step: prompt.step, settle };
        prompt.signal.addEventListener('abort', abort, { once: true });
        try {
          notify({ step: prompt.step, resource: prompt.resource });
        } catch {
          fail();
        }
      }),
    close: () => {
      closed = true;
      pending?.settle();
      input.off('data', count);
      input.off('error', fail);
      lines.close();
    },
  };
}

import { Readable } from 'node:stream';
import type { Client, Dispatcher } from 'undici';
import { describe, expect, it, vi } from 'vitest';
import { capResponseBody, connectivityProxyResponse } from '../../../src/adt/bounded-response.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtResponseLimitError } from '../../../src/adt/errors.js';

describe('bounded BTP Connectivity response', () => {
  it('ignores late proxy body data after an over-limit cancellation', async () => {
    let sent = false;
    let lateEmissionDone!: () => void;
    const lateEmission = new Promise<void>((resolve) => {
      lateEmissionDone = resolve;
    });
    const lateBody = new Readable({
      read() {
        if (sent) return;
        sent = true;
        this.push(Buffer.from('oversized'));
      },
      destroy(error, callback) {
        callback(error);
        queueMicrotask(() => {
          // BTP Connectivity can have BodyReadable data already queued when
          // the response limit cancels it. Readable.toWeb() forwarded this
          // into a closed controller and raised an uncaught ERR_INVALID_STATE.
          this.emit('data', Buffer.from('late'));
          lateEmissionDone();
        });
      },
    });
    Object.assign(lateBody, { text: vi.fn() });
    const close = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const client = { close, destroy } as unknown as Client;
    const response = await connectivityProxyResponse(
      {
        statusCode: 200,
        headers: {},
        body: lateBody as Dispatcher.ResponseData['body'],
      },
      client,
      new AbortController().signal,
      true,
    );

    await expect(
      capResponseBody(response, new DataResponseBudget(4)).then((capped) => capped.text()),
    ).rejects.toBeInstanceOf(AdtResponseLimitError);
    await lateEmission;
    expect(lateBody.destroyed).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });
});

import type { Readable } from 'node:stream';
import type { Client, Dispatcher } from 'undici';
import { getCurrentContext } from '../server/context.js';
import type { DataResponseBudget } from './data-result-context.js';

type ConnectivityProxyResponse = Pick<Dispatcher.ResponseData, 'statusCode' | 'headers' | 'body'>;

function cloneResponseHeaders(headers: Headers): Headers {
  const copy = new Headers();
  let legacySetCookie: string | undefined;
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') legacySetCookie = value;
    else copy.append(key, value);
  }
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = getSetCookie?.call(headers) ?? (legacySetCookie ? [legacySetCookie] : []);
  for (const cookie of setCookies) copy.append('set-cookie', cookie);
  return copy;
}

/** Apply the cumulative post-content-decoding allowance before string conversion. */
export async function capResponseBody(response: Response, budget: DataResponseBudget): Promise<Response> {
  const responseBody = response.body;
  if (responseBody === null) return response;
  const requestId = getCurrentContext()?.requestId;
  const contentEncoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  const contentLength = response.headers.get('content-length')?.trim();
  if ((!contentEncoding || contentEncoding === 'identity') && contentLength && /^\d+$/.test(contentLength)) {
    const declaredBytes = Number(contentLength);
    if (Number.isSafeInteger(declaredBytes)) {
      try {
        budget.assertSingleResponseBytes(declaredBytes, requestId);
      } catch (error) {
        try {
          await responseBody.cancel(error);
        } catch {
          // Preserve the response-limit error.
        }
        throw error;
      }
    }
  }

  const reader = responseBody.getReader();
  const reservation = response.ok ? budget.createReservation() : undefined;
  let seenBytes = 0;
  let settled = false;
  const release = () => {
    if (settled) return;
    settled = true;
    reservation?.release();
  };

  const cappedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          if (!settled) {
            settled = true;
            reservation?.commit();
          }
          controller.close();
          return;
        }
        const nextSeenBytes = seenBytes + chunk.value.byteLength;
        if (reservation) reservation.add(chunk.value.byteLength, requestId);
        else budget.assertSingleResponseBytes(nextSeenBytes, requestId);
        seenBytes = nextSeenBytes;
        controller.enqueue(chunk.value);
      } catch (error) {
        release();
        try {
          await reader.cancel(error);
        } catch {
          // Preserve the original stream/budget error.
        }
        controller.error(error);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason);
    },
  });

  return new Response(cappedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: cloneResponseHeaders(response.headers),
  });
}

function proxyResponseBody(body: Readable, client: Client, signal: AbortSignal): ReadableStream<Uint8Array> {
  // Do not bridge Undici's BodyReadable through Readable.toWeb(). Cancelling that
  // adapter closes its web-stream controller before Client.destroy() has drained
  // already-queued BodyReadable data, so a late data event can enqueue into the
  // closed controller and terminate the process with ERR_INVALID_STATE (#737).
  // Reading the Node stream directly keeps cancellation and client ownership in
  // this one adapter and gives late source events no web controller to reach.
  const iterator = body[Symbol.asyncIterator]();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let settled = false;
  let ended = false;

  const asError = (reason: unknown, fallback: string): Error =>
    reason instanceof Error ? reason : new Error(reason === undefined ? fallback : String(reason));

  const onAbort = () => {
    if (ended) return;
    ended = true;
    const cause = asError(signal.reason, 'The proxy response stream was aborted.');
    try {
      streamController?.error(cause);
    } catch {
      // A simultaneous consumer cancellation may already have closed the stream.
    }
    void settle(cause).catch(() => {
      // The abort reason is already visible to the consumer.
    });
  };

  const settle = async (error?: Error) => {
    if (settled) return;
    settled = true;
    signal.removeEventListener('abort', onAbort);
    if (error) {
      // Stop the body without emitting a second error, then destroy its dedicated
      // client with the original cause. The async iterator retains Node's error
      // listener, so a transport error racing with teardown stays handled.
      if (!body.destroyed) body.destroy();
      await client.destroy(error);
    } else {
      await client.close();
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    },
    async pull(controller) {
      try {
        const chunk = await iterator.next();
        if (ended) return;
        if (chunk.done) {
          ended = true;
          try {
            await settle();
            controller.close();
          } catch (error) {
            controller.error(error);
          }
          return;
        }
        if (!(chunk.value instanceof Uint8Array)) {
          throw new TypeError('The proxy response body emitted a non-byte chunk.');
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        if (ended) return;
        ended = true;
        const cause = asError(error, 'The proxy response stream failed.');
        try {
          await settle(cause);
        } finally {
          controller.error(cause);
        }
      }
    },
    async cancel(reason) {
      if (ended) return;
      ended = true;
      await settle(asError(reason, 'The proxy response stream was cancelled.'));
    },
  });
}

/** Convert one Connectivity response while preserving ownership of its short-lived client. */
export async function connectivityProxyResponse(
  response: ConnectivityProxyResponse,
  client: Client,
  signal: AbortSignal,
  bounded: boolean,
): Promise<Response> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [String(value)]) headers.append(key, item);
  }

  if (response.statusCode === 204 || response.statusCode === 205 || response.statusCode === 304) {
    response.body.destroy();
    return new Response(null, { status: response.statusCode, headers });
  }
  if (!bounded) {
    return new Response(await response.body.text(), { status: response.statusCode, headers });
  }

  const contentEncoding = headers.get('content-encoding')?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== 'identity') {
    const error = new Error(`Unexpected Content-Encoding '${contentEncoding}' on bounded proxy response.`);
    response.body.destroy();
    await client.destroy(error);
    throw error;
  }
  return new Response(proxyResponseBody(response.body, client, signal), {
    status: response.statusCode,
    headers,
  });
}

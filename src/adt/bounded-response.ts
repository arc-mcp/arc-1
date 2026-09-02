import { Readable } from 'node:stream';
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
  const source = Readable.toWeb(body) as ReadableStream<Uint8Array>;
  const reader = source.pipeThrough(new TransformStream<Uint8Array>(), { signal }).getReader();
  let settled = false;
  const settle = async (error?: Error) => {
    if (settled) return;
    settled = true;
    if (error) await client.destroy(error);
    else await client.close();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          await settle();
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        try {
          await settle(cause);
        } finally {
          controller.error(error);
        }
      }
    },
    async cancel(reason) {
      const cause = reason instanceof Error ? reason : new Error('The proxy response stream was cancelled.');
      try {
        await reader.cancel(reason);
      } finally {
        await settle(cause);
      }
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

import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export class HarnessError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function safeFailure(error) {
  return error instanceof HarnessError
    ? { code: error.code, ...(Number.isInteger(error.status) ? { httpStatus: error.status } : {}) }
    : { code: 'UNEXPECTED_FAILURE' };
}

export function assertSafeDiagnosticEnvironment(env = process.env, execArgv = process.execArgv) {
  const diagnosticOptions = /(^|\s)--(?:inspect(?:-brk|-wait)?|trace-tls|tls-keylog)(?:=|\s|$)/;
  if (
    ['NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'SSLKEYLOGFILE'].some((name) => env[name]?.trim()) ||
    diagnosticOptions.test(env.NODE_OPTIONS ?? '') ||
    execArgv.some((value) => diagnosticOptions.test(value))
  ) {
    throw new HarnessError('UNSAFE_RUNTIME_DIAGNOSTICS');
  }
}

export function label(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new HarnessError('INVALID_LABEL');
  return value;
}

export function outsideRepository(actualPath) {
  const location = relative(REPO_ROOT, actualPath);
  return location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location);
}

export async function privateJson(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new HarnessError('ABSOLUTE_PRIVATE_FILE_REQUIRED');
  const actual = await realpath(path);
  if (!outsideRepository(actual)) {
    throw new HarnessError('PRIVATE_INPUT_MUST_BE_OUTSIDE_REPOSITORY');
  }
  const stats = await lstat(actual);
  if (!stats.isFile() || (stats.mode & 0o077) !== 0 || stats.uid !== process.getuid()) {
    throw new HarnessError('PRIVATE_INPUT_REQUIRES_OWNER_ONLY_PERMISSIONS');
  }
  if (stats.size > 512 * 1024) throw new HarnessError('PRIVATE_INPUT_TOO_LARGE');
  try {
    return JSON.parse(await readFile(actual, 'utf8'));
  } catch {
    throw new HarnessError('INVALID_PRIVATE_JSON');
  }
}

export function validateBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new HarnessError('HTTPS_ORIGIN_REQUIRED');
  }
  return url;
}

export function classifySapVerificationFailure(error, sdkErrors) {
  for (const [type, code] of Object.entries({
    WrongAudienceError: 'wrong_audience',
    ExpiredTokenError: 'expired',
    NotYetValidTokenError: 'not_yet_valid',
    InvalidTokenSignatureError: 'invalid_signature',
    InvalidJwtError: 'invalid_jwt',
    UnsupportedAlgorithmError: 'unsupported_algorithm',
    InvalidIssuerError: 'invalid_issuer',
    UntrustedIssuerError: 'untrusted_issuer',
  })) {
    if (typeof sdkErrors[type] === 'function' && error instanceof sdkErrors[type]) return code;
  }
  // JWKS/network/configuration failures are not evidence of a rejected token fixture.
  return undefined;
}

function parseSseEvent(event, responseId) {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return undefined;
  try {
    const candidate = JSON.parse(data);
    return candidate.id != null && (responseId === undefined || candidate.id === responseId) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export async function boundedFetch(url, init = {}, { timeoutMs = 60_000, rpcResponseId } = {}) {
  let response;
  try {
    response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new HarnessError('HTTP_REQUEST_FAILED');
  }
  let text = '';
  let json;
  let bytes = 0;
  const chunks = [];
  const isSse = response.headers.get('content-type')?.includes('text/event-stream');
  const decoder = new TextDecoder();
  let sseRemainder = '';
  if (response.body) {
    const reader = response.body.getReader();
    try {
      readResponse: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new HarnessError('HTTP_RESPONSE_LIMIT_EXCEEDED', response.status);
        }
        chunks.push(value);
        if (isSse && rpcResponseId !== undefined) {
          sseRemainder += decoder.decode(value, { stream: true });
          while (true) {
            const boundary = /\r?\n\r?\n/.exec(sseRemainder);
            if (!boundary) break;
            const event = sseRemainder.slice(0, boundary.index);
            sseRemainder = sseRemainder.slice(boundary.index + boundary[0].length);
            const candidate = parseSseEvent(event, rpcResponseId);
            if (candidate) {
              json = candidate;
              await reader.cancel();
              break readResponse;
            }
          }
        }
      }
      text = Buffer.concat(chunks).toString('utf8');
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError('HTTP_RESPONSE_FAILED', response.status);
    } finally {
      reader.releaseLock();
    }
  }
  if (json === undefined)
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      if (isSse) {
        for (const event of text.split(/\r?\n\r?\n/)) {
          const candidate = parseSseEvent(event, rpcResponseId);
          if (candidate) json = candidate;
        }
      }
    }
  return { status: response.status, headers: response.headers, json, text, bytes };
}

export function readToolBody(response) {
  const result = response.json?.result;
  const entry = Array.isArray(result?.content) ? result.content.find((item) => item?.type === 'text') : undefined;
  let body;
  try {
    body = typeof entry?.text === 'string' ? JSON.parse(entry.text) : undefined;
  } catch {
    /* Some ARC errors are plain text. */
  }
  return { result, body, text: typeof entry?.text === 'string' ? entry.text : '' };
}

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { graphApiKeys } from './config.js';
import { graphInputSchema } from './contract-v2.js';
import { queryV2 } from './query-v2.js';
import type { GraphStore } from './store/store.js';

const MAX_BODY_BYTES = 32_768;
const MAX_RESPONSE_BYTES = 512_000;

function authorized(request: IncomingMessage, keys: Buffer[]): boolean {
  const authorization = request.headers.authorization;
  if (authorization && (authorization.length > 4103 || authorization.slice(0, 7).toLowerCase() !== 'bearer '))
    return false;
  const rawHeader = request.headers['x-api-key'];
  const supplied = authorization ? authorization.slice(7) : Array.isArray(rawHeader) ? undefined : rawHeader;
  if (!supplied || supplied.length > 4096 || !/^[\x21-\x7e]+$/.test(supplied)) return false;
  const bytes = Buffer.from(supplied, 'ascii');
  // These are high-entropy API credentials, not human passwords or stored password hashes.
  // Value comparison is constant-time; only the non-secret credential length is checked first.
  return keys.some((key) => bytes.length === key.length && timingSafeEqual(bytes, key));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.statusCode = Buffer.byteLength(body) > MAX_RESPONSE_BYTES ? 413 : status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(response.statusCode === 413 ? JSON.stringify({ error: 'response_too_large' }) : body);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('invalid_json');
  return parsed as Record<string, unknown>;
}

export function createGraphApi(
  store: GraphStore,
  apiKeys = graphApiKeys(),
  scope = { systemKey: process.env.ARC_GRAPH_API_SYSTEM_KEY ?? '', audience: process.env.ARC_GRAPH_API_AUDIENCE ?? '' },
) {
  if (!/^[A-Z0-9][A-Z0-9._:-]{0,127}$/.test(scope.systemKey) || !/^[A-Za-z0-9._:-]{1,128}$/.test(scope.audience))
    throw new Error('Explicit graph scope required');
  const keyBytes = apiKeys.map((key) => Buffer.from(key, 'ascii'));
  let active = 0;
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      // Node does not await async request listeners: a rejected URL parse would stop the process.
      json(response, 400, { error: 'invalid_request_target' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/healthz') {
      json(response, 200, { status: 'ok' });
      return;
    }
    if (!authorized(request, keyBytes)) {
      response.setHeader('www-authenticate', 'Bearer');
      json(response, 401, { error: 'unauthorized' });
      return;
    }
    if (active >= 8) {
      json(response, 503, { error: 'busy' });
      return;
    }
    active++;
    const deadline = setTimeout(() => request.destroy(), 5000);
    try {
      if (request.method === 'POST' && url.pathname === '/v2/query') {
        const body = await readJson(request);
        if (
          !scope.systemKey ||
          !scope.audience ||
          body.systemKey !== scope.systemKey ||
          body.audience !== scope.audience
        ) {
          json(response, 403, { error: 'forbidden_scope' });
          return;
        }
        const { systemKey: _systemKey, audience: _audience, ...args } = body;
        const parsed = graphInputSchema.safeParse(args);
        if (!parsed.success) {
          json(response, 400, { error: 'invalid_arguments' });
          return;
        }
        json(response, 200, await queryV2(store, parsed.data, scope.systemKey, scope.audience));
        return;
      }
      // A scoped deployment must not retain the unrestricted v1 back door.
      if (scope.systemKey && url.pathname.startsWith('/v1/')) {
        json(response, 410, { error: 'v1_disabled' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/readyz') {
        const ready = await store.ready();
        json(response, ready.migrationVersion === 1 ? 200 : 503, { status: 'ok', ...ready });
        return;
      }
      json(response, 404, { error: 'not_found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === 'request_too_large' ? 413 : 503;
      json(response, status, { error: status === 503 ? 'query_unavailable' : 'request_too_large' });
    } finally {
      clearTimeout(deadline);
      active--;
    }
  };
}

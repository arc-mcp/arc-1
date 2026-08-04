/**
 * IDE workspace roots, read from the MCP client (`roots/list`).
 *
 * Gives ARC-1 a little awareness of what the developer has open — specifically which ADT
 * destination and packages, when the client is an IDE. Used only for presentation (see
 * `ide-links.ts`).
 *
 * STRICTLY ADDITIVE. Roots change what ARC-1 *knows*, never what it *does*. They are impossible
 * on the HTTP transport — `src/server/http.ts` builds a per-request `Server` that never sees
 * `initialize`, so there is no session to ask — and every feature must work without them.
 *
 * Three guards, because a presentation nicety must never delay or fail a tool call:
 *   1. capability gate — skipped entirely unless the client advertised `roots`
 *   2. timeout — a client that accepts the request but never answers cannot hang us
 *   3. cached, including failure — asked once per server, not once per call
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { logger } from './logger.js';

/** How long to wait for the client to answer before giving up for good. */
const ROOTS_TIMEOUT_MS = 2000;

export interface IdeRoots {
  /** Raw roots as reported. Empty when the client has none. */
  roots: Array<{ uri?: string; name?: string }>;
  /** False when roots could not be obtained at all — the caller must not infer "no ABAP folder". */
  known: boolean;
}

const UNKNOWN: IdeRoots = { roots: [], known: false };

/** Per-server cache. A `Server` instance is one client session. */
const cache = new WeakMap<object, Promise<IdeRoots>>();

/**
 * Ask the client for its workspace roots, once. Never throws.
 * @param server the MCP server for this session, if there is one (absent on the CLI)
 */
export function getIdeRoots(server: Server | undefined): Promise<IdeRoots> {
  if (!server) return Promise.resolve(UNKNOWN);
  const cached = cache.get(server);
  if (cached) return cached;

  const pending = fetchRoots(server);
  cache.set(server, pending);
  return pending;
}

/** Drop the cache so the next call re-asks — for `notifications/roots/list_changed`. */
export function invalidateIdeRoots(server: Server | undefined): void {
  if (server) cache.delete(server);
}

async function fetchRoots(server: Server): Promise<IdeRoots> {
  try {
    // Guard 1: never send a request the client did not say it supports. Without this, a client
    // that ignores `roots/list` would cost every session a full timeout.
    if (!server.getClientCapabilities()?.roots) return UNKNOWN;

    // Guard 2: bound the wait. `timeout` is honoured by the SDK's request options.
    const result = await server.listRoots(undefined, { timeout: ROOTS_TIMEOUT_MS });
    const roots = Array.isArray(result?.roots) ? result.roots : [];
    logger.debug('ide roots', { count: roots.length });
    return { roots, known: true };
  } catch (err) {
    logger.debug('ide roots unavailable', { error: err instanceof Error ? err.message : String(err) });
    return UNKNOWN;
  }
}

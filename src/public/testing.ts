// arc-1/public/testing — helpers for unit-testing a plugin tool with no live SAP. @experimental.
//
// `createMockToolContext` returns a ToolContext whose `http` records every call and returns a
// configurable body, so a plugin author can assert "my handler GETs /sap/bc/adt/… and shapes the
// response like X" without a server. See docs/research/extension-framework-spec.md §2/§12.

import type { AdtResponse } from '../adt/http.js';
import type { SafeHttpClient } from '../server/safe-http-client.js';
import type { ToolContext } from './types.js';

export interface MockHttpCall {
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: string;
}

export interface MockToolContext extends ToolContext {
  /** Every `ctx.http` call the handler made, in order. */
  httpCalls: MockHttpCall[];
  /** Every class name passed to `ctx.run.classRun`, in order. */
  classRunCalls: string[];
}

export interface MockToolContextOptions {
  /** Body returned by every `ctx.http` call (unless overridden per-path by `responses`). */
  responseBody?: string;
  /** Per-path response bodies; falls back to `responseBody` then ''. */
  responses?: Record<string, string>;
  /** Scopes on `ctx.authInfo` (default `['read']`). */
  scopes?: string[];
  requestId?: string;
  /** Partial `ctx.client` for handlers that call high-level read methods. */
  client?: Partial<ToolContext['client']>;
  /** Console output returned by `ctx.run.classRun` (default ''). The mock never gates. */
  classRunOutput?: string;
}

export function createMockToolContext(options: MockToolContextOptions = {}): MockToolContext {
  const httpCalls: MockHttpCall[] = [];
  const bodyFor = (path: string): string => options.responses?.[path] ?? options.responseBody ?? '';
  const resp = (path: string): AdtResponse => ({ statusCode: 200, headers: {}, body: bodyFor(path) });

  // A pure recorder — never gates (the gate is unit-tested against the real createSafeHttpClient).
  const http: SafeHttpClient = {
    get: async (path) => {
      httpCalls.push({ method: 'GET', path });
      return resp(path);
    },
    head: async (path) => {
      httpCalls.push({ method: 'HEAD', path });
      return resp(path);
    },
    post: async (path, body) => {
      httpCalls.push({ method: 'POST', path, body });
      return resp(path);
    },
    put: async (path, body) => {
      httpCalls.push({ method: 'PUT', path, body });
      return resp(path);
    },
    delete: async (path) => {
      httpCalls.push({ method: 'DELETE', path });
      return resp(path);
    },
  };

  const classRunCalls: string[] = [];
  const run: ToolContext['run'] = {
    classRun: async (className) => {
      classRunCalls.push(className);
      return options.classRunOutput ?? '';
    },
  };

  const ctx: MockToolContext = {
    client: (options.client ?? {}) as unknown as ToolContext['client'],
    http,
    run,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    authInfo: { userName: 'test-user', scopes: options.scopes ?? ['read'], clientId: 'test' },
    requestId: options.requestId ?? 'test-request',
    httpCalls,
    classRunCalls,
  };
  return ctx;
}

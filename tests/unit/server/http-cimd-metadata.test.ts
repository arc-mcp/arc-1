/**
 * CIMD wiring (T3): the published OAuth metadata, and the config that gates it.
 *
 * The metadata flag is the real feature switch. The MCP SDK's client uses a URL client_id
 * only when `client_id_metadata_document_supported` is true AND it holds a
 * `clientMetadataUrl`; otherwise it silently falls back to DCR. So until ARC-1 advertises
 * the field, nothing else in the CIMD work has any observable effect — and if ARC-1
 * advertised it WITHOUT being able to resolve, every capable client would switch and
 * break. These tests pin both halves of that lockstep.
 *
 * Boot harness is the one from `http-oidc-metadata.test.ts`: start the real server with
 * `listen` stubbed and hand the Express app to supertest.
 */

import { EventEmitter } from 'node:events';
import type { XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHttpServer } from '../../../src/server/http.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const XSUAA: XsuaaCredentials = {
  url: 'https://tenant.authentication.example.test',
  clientid: 'arc1-test-client',
  clientsecret: 'test-client-secret-with-enough-entropy',
  xsappname: 'arc1-test!t1',
  uaadomain: 'authentication.example.test',
};

async function boot(overrides: Partial<typeof DEFAULT_CONFIG>, publicUrl?: string): Promise<express.Express> {
  if (publicUrl) process.env.ARC1_PUBLIC_URL = publicUrl;
  else delete process.env.ARC1_PUBLIC_URL;
  let app!: express.Express;
  const listenSpy = vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
    app = this;
    return new EventEmitter() as never;
  });
  try {
    await startHttpServer(
      (() => ({ connect: vi.fn() })) as never,
      {
        ...DEFAULT_CONFIG,
        transport: 'http-streamable',
        httpAddr: '127.0.0.1:0',
        xsuaaAuth: true,
        authRateLimit: 0,
        mcpHttpRateLimit: 0,
        ...overrides,
      },
      XSUAA,
      undefined,
      undefined,
    );
  } finally {
    listenSpy.mockRestore();
  }
  return app;
}

afterEach(() => {
  delete process.env.ARC1_PUBLIC_URL;
  vi.restoreAllMocks();
});

describe('OAuth metadata — CIMD capability advertisement', () => {
  it('does NOT advertise the flag by default, at the root path', async () => {
    const app = await boot({});
    const res = await request(app).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.client_id_metadata_document_supported).toBeUndefined();
    // DCR stays advertised — it is deprecated, not removed.
    expect(res.body.registration_endpoint).toContain('/register');
  });

  it('advertises the flag at the root path when CIMD is enabled', async () => {
    // Root-path mode is the case the SDK router owns, so this is the one that needed a
    // shadowing handler rather than a field on an existing object.
    const app = await boot({ cimdEnabled: true });
    const res = await request(app).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.client_id_metadata_document_supported).toBe(true);
    // The document must still be the SDK's, not a hand-rolled copy that drops fields.
    expect(res.body.authorization_endpoint).toContain('/authorize');
    expect(res.body.token_endpoint).toContain('/token');
    expect(res.body.registration_endpoint).toContain('/register');
    expect(res.body.response_types_supported).toEqual(['code']);
    expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(res.body.scopes_supported).toContain('read');
  });

  it('advertises the flag behind a path-prefix proxy too', async () => {
    const app = await boot({ cimdEnabled: true }, 'https://api.example.test/arc1');
    const res = await request(app).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.client_id_metadata_document_supported).toBe(true);
    // Prefix mode exists because the SDK strips the base path; that must still hold.
    expect(res.body.authorization_endpoint).toBe('https://api.example.test/arc1/authorize');
  });

  it('omits the flag behind a prefix proxy when CIMD is off', async () => {
    const app = await boot({}, 'https://api.example.test/arc1');
    const res = await request(app).get('/.well-known/oauth-authorization-server');
    expect(res.body.client_id_metadata_document_supported).toBeUndefined();
    expect(res.body.authorization_endpoint).toBe('https://api.example.test/arc1/authorize');
  });
});

describe('CIMD config', () => {
  const parse = async (env: Record<string, string>) => {
    const previous: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      previous[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      const { resolveConfig } = await import('../../../src/server/config.js');
      return resolveConfig([]).config;
    } finally {
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  beforeEach(() => {
    for (const k of [
      'ARC1_CIMD_ENABLED',
      'ARC1_CIMD_ALLOWED_HOSTS',
      'ARC1_CIMD_CACHE_TTL_SECONDS',
      'ARC1_CIMD_PROXY_URL',
    ]) {
      delete process.env[k];
    }
  });

  it('defaults to off, open, and a 900 s fallback TTL', async () => {
    const config = await parse({});
    expect(config.cimdEnabled).toBe(false);
    expect(config.cimdAllowedHosts).toEqual([]);
    expect(config.cimdCacheTtlSeconds).toBe(900);
    expect(config.cimdProxyUrl).toBeUndefined();
  });

  it('parses the allowlist as trimmed, non-empty entries', async () => {
    const config = await parse({ ARC1_CIMD_ENABLED: 'true', ARC1_CIMD_ALLOWED_HOSTS: ' claude.ai , *.vscode.dev ,,' });
    expect(config.cimdEnabled).toBe(true);
    expect(config.cimdAllowedHosts).toEqual(['claude.ai', '*.vscode.dev']);
  });

  it('clamps the fallback TTL into the window the auth package also enforces', async () => {
    // The two must agree, or a configured value would be silently overridden downstream.
    expect((await parse({ ARC1_CIMD_CACHE_TTL_SECONDS: '30' })).cimdCacheTtlSeconds).toBe(300);
    expect((await parse({ ARC1_CIMD_CACHE_TTL_SECONDS: '99999' })).cimdCacheTtlSeconds).toBe(3600);
    expect((await parse({ ARC1_CIMD_CACHE_TTL_SECONDS: '600' })).cimdCacheTtlSeconds).toBe(600);
  });

  it('warns when CIMD is enabled without XSUAA OAuth proxy mode', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { validateConfig } = await import('../../../src/server/config.js');
    validateConfig({ ...DEFAULT_CONFIG, cimdEnabled: true, xsuaaAuth: false });
    expect(warn.mock.calls.flat().join(' ')).toMatch(/ARC1_CIMD_ENABLED=true but SAP_XSUAA_AUTH=false/);
  });

  it('warns when the allowlist or proxy is set while CIMD is off', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { validateConfig } = await import('../../../src/server/config.js');
    validateConfig({ ...DEFAULT_CONFIG, cimdEnabled: false, cimdAllowedHosts: ['claude.ai'] });
    expect(warn.mock.calls.flat().join(' ')).toMatch(/inert/);
  });
});

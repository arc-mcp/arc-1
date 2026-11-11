import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtHttpClient, type AdtHttpConfig } from '../../../src/adt/http.js';
import type { SpnegoMode } from '../../../src/adt/spnego.js';
import { logger } from '../../../src/server/logger.js';

const DISCOVERY = '/sap/bc/adt/core/discovery';
const READ_PATH = '/sap/bc/adt/proof/read';
const SESSION_COOKIE = 'SAP_SESSIONID_PRF_001';

describe('SPNEGO logon in the ADT transport', () => {
  let server: Server;
  let baseUrl: string;
  let requests: { method: string; path: string; headers: IncomingHttpHeaders }[];
  let reply: (req: IncomingMessage, res: ServerResponse) => void;
  let tokens: string[];

  /** Stand-in for the native SSPI/GSSAPI acquirer; each call mints a distinguishable token. */
  function acquirer(): (spn: string) => Promise<string> {
    return async (spn: string) => {
      tokens.push(spn);
      return `TOKEN-${tokens.length}`;
    };
  }

  function createClient(config: Partial<AdtHttpConfig> = {}, mode: SpnegoMode = 'bootstrap'): AdtHttpClient {
    return new AdtHttpClient({
      baseUrl,
      client: '001',
      spnego: { spn: 'HTTP/sap.example.com', mode, acquireToken: acquirer() },
      ...config,
    });
  }

  /** Default backend: hands out a session cookie to a Negotiate logon, then serves cookie-auth. */
  function cookieIssuingBackend(req: IncomingMessage, res: ServerResponse): void {
    const authenticated =
      typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Negotiate ');
    const hasSession = req.headers.cookie?.includes(`${SESSION_COOKIE}=live`);
    res.setHeader('Content-Type', 'application/xml');
    if (authenticated) {
      res.setHeader('Set-Cookie', [`${SESSION_COOKIE}=live; Path=/`, 'MYSAPSSO2=ticket; Path=/']);
      res.setHeader('WWW-Authenticate', 'Negotiate oYG2MIGzoAMK');
      res.end('<discovery/>');
      return;
    }
    if (!hasSession) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Negotiate');
      res.end('<unauthorized/>');
      return;
    }
    res.end('<result>ready</result>');
  }

  beforeEach(async () => {
    requests = [];
    tokens = [];
    reply = cookieIssuingBackend;
    server = createServer((req, res) => {
      requests.push({ method: req.method!, path: req.url!.split('?')[0]!, headers: req.headers });
      reply(req, res);
    });
    // Bind and address the same family — see tests/helpers/supertest-loopback.ts.
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    vi.restoreAllMocks();
    delete process.env.ARC1_LOG_HTTP_DEBUG;
  });

  describe('bootstrap mode', () => {
    it('negotiates once against ADT discovery and then uses the issued session cookies', async () => {
      const client = createClient();

      await expect(client.get(READ_PATH)).resolves.toMatchObject({ body: '<result>ready</result>' });

      expect(tokens).toEqual(['HTTP/sap.example.com']);
      expect(requests.map(({ path }) => path)).toEqual([DISCOVERY, READ_PATH]);
      expect(requests[0]?.headers.authorization).toBe('Negotiate TOKEN-1');
      // The ICM only opens a security session when asked to.
      expect(requests[0]?.headers['x-sap-security-session']).toBe('create');
      // The actual read rides the cookies, not the token.
      expect(requests[1]?.headers.authorization).toBeUndefined();
      expect(requests[1]?.headers.cookie).toContain(`${SESSION_COOKIE}=live`);
      expect(requests[1]?.headers.cookie).toContain('MYSAPSSO2=ticket');
    });

    it('does not negotiate again for later requests on the same client', async () => {
      const client = createClient();

      await client.get(READ_PATH);
      await client.get(READ_PATH);
      await client.get(READ_PATH);

      expect(tokens).toHaveLength(1);
      expect(requests.filter(({ path }) => path === DISCOVERY)).toHaveLength(1);
    });

    it('negotiates once when a cold client fans out concurrently', async () => {
      const client = createClient();

      await Promise.all([client.get(READ_PATH), client.get(READ_PATH), client.get(READ_PATH)]);

      expect(tokens).toHaveLength(1);
      expect(requests.filter(({ path }) => path === DISCOVERY)).toHaveLength(1);
    });

    it('re-negotiates exactly once when the SAP session expires mid-life', async () => {
      const client = createClient();
      await client.get(READ_PATH);
      expect(tokens).toHaveLength(1);

      // SAP drops the session: the stored cookie is no longer honored.
      reply = (req, res) => {
        const authenticated =
          typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Negotiate ');
        const hasFreshSession = req.headers.cookie?.includes(`${SESSION_COOKIE}=second`);
        res.setHeader('Content-Type', 'application/xml');
        if (authenticated) {
          res.setHeader('Set-Cookie', `${SESSION_COOKIE}=second; Path=/`);
          res.end('<discovery/>');
          return;
        }
        if (!hasFreshSession) {
          res.statusCode = 401;
          res.setHeader('WWW-Authenticate', 'Negotiate');
          res.end('<expired/>');
          return;
        }
        res.end('<result>recovered</result>');
      };

      await expect(client.get(READ_PATH)).resolves.toMatchObject({ body: '<result>recovered</result>' });
      expect(tokens).toHaveLength(2);
      // One retry only — the 401 slot is not multiplied by SPNEGO.
      expect(requests.filter(({ path }) => path === DISCOVERY)).toHaveLength(2);
    });

    it('surfaces an actionable error when SAP rejects the SPNEGO logon itself', async () => {
      reply = (_req, res) => {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Negotiate');
        res.end('<rejected/>');
      };
      const client = createClient();

      await expect(client.get(READ_PATH)).rejects.toMatchObject({
        name: 'AdtApiError',
        statusCode: 401,
        path: DISCOVERY,
      });
      await expect(client.get(READ_PATH)).rejects.toThrow(/service principal name matches the SAP host/);
    });

    it('lets a stateful clone inherit the session instead of negotiating inside the lock window', async () => {
      const client = createClient();
      await client.get(READ_PATH);
      const negotiationsBefore = tokens.length;

      await client.withStatefulSession(async (session) => {
        await session.get(READ_PATH);
      });

      // ADR-0006: lock → modify → unlock must not contain a credential negotiation.
      expect(tokens).toHaveLength(negotiationsBefore);
      expect(requests.filter(({ path }) => path === DISCOVERY)).toHaveLength(1);
    });
  });

  describe('per-request mode', () => {
    it('signs every request with a freshly minted token', async () => {
      const client = createClient({}, 'per-request');
      reply = (req, res) => {
        const authenticated =
          typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Negotiate ');
        res.setHeader('Content-Type', 'application/xml');
        if (!authenticated) {
          res.statusCode = 401;
          res.setHeader('WWW-Authenticate', 'Negotiate');
          res.end('<unauthorized/>');
          return;
        }
        res.end('<result>ready</result>');
      };

      await client.get(READ_PATH);
      await client.get(READ_PATH);

      // No discovery bootstrap in this mode; the token rides the request itself.
      expect(requests.map(({ path }) => path)).toEqual([READ_PATH, READ_PATH]);
      expect(requests[0]?.headers.authorization).toBe('Negotiate TOKEN-1');
      expect(requests[1]?.headers.authorization).toBe('Negotiate TOKEN-2');
    });
  });

  describe('secret handling', () => {
    it('redacts the SPNEGO token and the mutual-auth challenge from HTTP debug audit', async () => {
      process.env.ARC1_LOG_HTTP_DEBUG = 'true';
      const audits: Record<string, unknown>[] = [];
      vi.spyOn(logger, 'emitAudit').mockImplementation((event) => {
        audits.push(event as unknown as Record<string, unknown>);
      });

      await createClient().get(READ_PATH);

      const serialized = JSON.stringify(audits);
      expect(serialized).not.toContain('TOKEN-1');
      expect(serialized).not.toContain('oYG2MIGzoAMK');
      expect(serialized).not.toContain('MYSAPSSO2=ticket');

      const withHeaders = audits.filter((event) => event.requestHeaders || event.responseHeaders);
      expect(withHeaders.length).toBeGreaterThan(0);
      for (const event of withHeaders) {
        const requestHeaders = (event.requestHeaders ?? {}) as Record<string, string>;
        const responseHeaders = (event.responseHeaders ?? {}) as Record<string, string>;
        if ('authorization' in requestHeaders) expect(requestHeaders.authorization).toBe('[REDACTED]');
        if ('www-authenticate' in responseHeaders) expect(responseHeaders['www-authenticate']).toBe('[REDACTED]');
        if ('set-cookie' in responseHeaders) expect(responseHeaders['set-cookie']).toBe('[REDACTED]');
      }
    });

    it('never sends a request without a credential when the token cannot be acquired', async () => {
      const client = new AdtHttpClient({
        baseUrl,
        client: '001',
        spnego: {
          spn: 'HTTP/sap.example.com',
          mode: 'bootstrap',
          acquireToken: async () => {
            throw new Error('no Kerberos ticket');
          },
        },
      });

      await expect(client.get(READ_PATH)).rejects.toThrow(/no Kerberos ticket/);
      expect(requests).toHaveLength(0);
    });
  });

  it('stays entirely out of the way when SPNEGO is not configured', async () => {
    reply = (_req, res) => {
      res.setHeader('Content-Type', 'application/xml');
      res.end('<result>ready</result>');
    };
    const client = new AdtHttpClient({ baseUrl, client: '001', username: 'u', password: 'p' });

    await client.get(READ_PATH);

    expect(requests.map(({ path }) => path)).toEqual([READ_PATH]);
    expect(requests[0]?.headers.authorization).toMatch(/^Basic /);
  });
});

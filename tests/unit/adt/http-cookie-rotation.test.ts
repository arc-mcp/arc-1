import { mkdtempSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCookies } from '../../../src/adt/cookies.js';
import { AdtCsrfBootstrapError } from '../../../src/adt/errors.js';
import { AdtHttpClient, type AdtHttpConfig } from '../../../src/adt/http.js';

const sessionCookie = 'SAP_SESSIONID_PROOF_001';
const readPath = '/sap/bc/adt/proof/read';
const opaqueBody = '<session-state>unavailable</session-state>';

describe('cookie-file rotation during CSRF bootstrap (#1186)', () => {
  let directory: string;
  let cookieFile: string;
  let baseUrl: string;
  let server: Server;
  let requests: { method: string; path: string; headers: IncomingHttpHeaders }[];
  let reply: (req: IncomingMessage, res: ServerResponse) => void;

  function cookieText(cookies: Record<string, string>): string {
    return `# Netscape HTTP Cookie File\n${Object.entries(cookies)
      .map(([name, value]) => `127.0.0.1\tFALSE\t/\tFALSE\t0\t${name}\t${value}`)
      .join('\n')}\n`;
  }

  function replaceCookies(cookies: Record<string, string>): void {
    writeFileSync(cookieFile, cookieText(cookies));
  }

  function createClient(config: Partial<AdtHttpConfig> = {}): AdtHttpClient {
    return new AdtHttpClient({
      baseUrl,
      client: '001',
      cookieFile,
      cookies: resolveCookies(cookieFile, undefined),
      ...config,
    });
  }

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'arc1-cookie-rotation-'));
    cookieFile = join(directory, 'cookies.txt');
    replaceCookies({ [sessionCookie]: 'expired-session' });
    requests = [];
    reply = (req, res) => {
      const fresh = req.headers.cookie?.includes(`${sessionCookie}=rotated-session`);
      res.setHeader('Content-Type', 'application/xml');
      if (fresh) res.setHeader('X-CSRF-Token', 'rotated-token');
      else res.setHeader('Set-Cookie', `${sessionCookie}=expired-session; Path=/`);
      if (req.method === 'POST' && (!fresh || req.headers['x-csrf-token'] !== 'rotated-token')) res.statusCode = 403;
      res.end(fresh ? '<result>ready</result>' : opaqueBody);
    };
    server = createServer((req, res) => {
      requests.push({ method: req.method!, path: req.url!.split('?')[0]!, headers: req.headers });
      reply(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    rmSync(directory, { recursive: true, force: true });
  });

  it('recovers in the same client after tokenless HTTP200 and an out-of-band file rotation', async () => {
    const client = createClient();
    await expect(client.post(readPath, '<read/>')).rejects.toMatchObject({
      name: 'AdtCsrfBootstrapError',
      statusCode: 200,
      path: '/sap/bc/adt/discovery',
      isUnauthorized: false,
    });
    expect(requests.map(({ method }) => method)).toEqual(['HEAD', 'GET', 'GET']);
    replaceCookies({ [sessionCookie]: 'rotated-session' });

    await expect(client.post(readPath, '<read/>')).resolves.toMatchObject({ body: '<result>ready</result>' });
    expect(requests.slice(3).map(({ method }) => method)).toEqual(['HEAD', 'POST']);
    expect(requests[4]?.headers).toMatchObject({
      cookie: `${sessionCookie}=rotated-session`,
      'x-csrf-token': 'rotated-token',
    });
  });

  it('reads an atomic file replacement even with the same mtime before its first bootstrap', async () => {
    const client = createClient();
    const original = statSync(cookieFile);
    const replacement = join(directory, 'replacement.txt');
    writeFileSync(replacement, cookieText({ [sessionCookie]: 'rotated-session' }));
    renameSync(replacement, cookieFile);
    utimesSync(cookieFile, original.atime, original.mtime);

    await expect(client.post(readPath, '<read/>')).resolves.toMatchObject({ statusCode: 200 });
    expect(requests.map(({ method }) => method)).toEqual(['HEAD', 'POST']);
    expect(requests.every(({ headers }) => headers.cookie === `${sessionCookie}=rotated-session`)).toBe(true);
  });

  it.each(['same order', 'reordered'])(
    'preserves live cookies and context when file contents are unchanged (%s)',
    async (order) => {
      replaceCookies({ MYSAPSSO2: 'static-ticket', [sessionCookie]: 'file-session' });
      const client = createClient();
      reply = (req, res) => {
        if (req.url?.startsWith('/seed')) {
          res.setHeader('Set-Cookie', [`${sessionCookie}=live-session; Path=/`, 'sap-contextid=live-context; Path=/']);
        } else {
          res.setHeader('X-CSRF-Token', 'live-token');
        }
        res.end('ok');
      };
      await client.get('/seed');
      if (order === 'reordered') replaceCookies({ [sessionCookie]: 'file-session', MYSAPSSO2: 'static-ticket' });

      await client.fetchCsrfToken();
      await client.post(readPath, '<read/>');
      for (const { headers } of requests.slice(1)) {
        expect(headers.cookie).toContain('MYSAPSSO2=static-ticket');
        expect(headers.cookie).toContain(`${sessionCookie}=live-session`);
        expect(headers.cookie).toContain('sap-contextid=live-context');
        expect(headers.cookie).not.toContain('file-session');
      }
      expect(requests[2]?.headers['x-csrf-token']).toBe('live-token');
    },
  );

  it('drops the previous live cookie, context and token together when the file changes', async () => {
    const client = createClient();
    const ordinaryReply = reply;
    reply = (req, res) => {
      if (!req.url?.startsWith('/seed')) return ordinaryReply(req, res);
      res.setHeader('X-CSRF-Token', 'old-token');
      res.setHeader('Set-Cookie', [`${sessionCookie}=old-live-session; Path=/`, 'sap-contextid=old-context; Path=/']);
      res.end('ok');
    };
    await client.get('/seed');
    replaceCookies({ [sessionCookie]: 'rotated-session' });

    await client.fetchCsrfToken();
    await client.post(readPath, '<read/>');
    for (const { headers } of requests.slice(1)) {
      expect(headers.cookie).toBe(`${sessionCookie}=rotated-session`);
      expect(JSON.stringify(headers)).not.toMatch(/old-(?:token|context|live-session)/);
    }
    expect(requests[2]?.headers['x-csrf-token']).toBe('rotated-token');
  });

  it.each(['missing', 'empty'])(
    'preserves the last known cookies for a %s file and recovers after replacement',
    async (state) => {
      const client = createClient();
      if (state === 'missing') unlinkSync(cookieFile);
      else replaceCookies({});
      await expect(client.fetchCsrfToken()).rejects.toBeInstanceOf(AdtCsrfBootstrapError);
      expect(requests.every(({ headers }) => headers.cookie === `${sessionCookie}=expired-session`)).toBe(true);
      replaceCookies({ [sessionCookie]: 'rotated-session' });

      await expect(client.post(readPath, '<read/>')).resolves.toMatchObject({ statusCode: 200 });
      expect(requests.at(-1)?.headers.cookie).toBe(`${sessionCookie}=rotated-session`);
    },
  );

  it('recovers successive stateful children of the same parent without relying on a child reload flag', async () => {
    const parent = createClient();
    await expect(parent.withStatefulSession((child) => child.post(readPath, '<read/>'))).rejects.toBeInstanceOf(
      AdtCsrfBootstrapError,
    );
    replaceCookies({ [sessionCookie]: 'rotated-session' });

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(parent.withStatefulSession((child) => child.post(readPath, '<read/>'))).resolves.toMatchObject({
        statusCode: 200,
      });
    }
    const posts = requests.filter(({ method }) => method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.every(({ headers }) => headers.cookie === `${sessionCookie}=rotated-session`)).toBe(true);
    expect(posts.every(({ headers }) => headers['x-sap-adt-sessiontype'] === 'stateful')).toBe(true);
  });

  it('keeps inline cookie overrides when the file changes', async () => {
    const client = createClient({
      cookieString: `${sessionCookie}=inline-session`,
      cookies: { [sessionCookie]: 'inline-session' },
    });
    replaceCookies({ [sessionCookie]: 'rotated-session' });
    await expect(client.fetchCsrfToken()).rejects.toBeInstanceOf(AdtCsrfBootstrapError);
    // The response can set its own session cookie, but the first probe uses the explicit inline override.
    expect(requests[0]?.headers.cookie).toBe(`${sessionCookie}=inline-session`);
  });

  it('preserves file and live cookies when the file is temporarily empty but inline cookies exist', async () => {
    const cookieString = 'EXTRA=inline-option';
    const client = createClient({ cookieString, cookies: resolveCookies(cookieFile, cookieString) });
    const ordinaryReply = reply;
    reply = (req, res) => {
      if (req.url?.startsWith('/seed')) {
        res.setHeader('Set-Cookie', [`${sessionCookie}=live-session; Path=/`, 'sap-contextid=live-context; Path=/']);
        res.setHeader('X-CSRF-Token', 'live-token');
      } else if (req.headers.cookie?.includes(`${sessionCookie}=live-session`)) {
        res.setHeader('X-CSRF-Token', 'live-token');
      } else return ordinaryReply(req, res);
      res.end('ok');
    };
    await client.get('/seed');
    replaceCookies({});
    await client.fetchCsrfToken();
    await client.post(readPath, '<read/>');
    for (const { headers } of requests.slice(1)) {
      expect(headers.cookie).toContain(`${sessionCookie}=live-session`);
      expect(headers.cookie).toContain('sap-contextid=live-context');
      expect(headers.cookie).toContain(cookieString);
    }

    replaceCookies({ [sessionCookie]: 'rotated-session' });
    await client.fetchCsrfToken();
    await client.post(readPath, '<read/>');
    expect(requests.at(-1)?.headers).toMatchObject({
      cookie: `${sessionCookie}=rotated-session; ${cookieString}`,
      'x-csrf-token': 'rotated-token',
    });
  });

  it('keeps a locked stateful session through refresh and close, then reloads in the next child', async () => {
    const parent = createClient();
    let puts = 0;
    reply = (req, res) => {
      if (req.url?.startsWith('/lock')) {
        res.setHeader('Set-Cookie', [`${sessionCookie}=locked-session; Path=/`, 'sap-contextid=owned-context; Path=/']);
      } else if (req.method === 'PUT') {
        if (++puts === 1) {
          res.statusCode = 403;
          res.setHeader('X-CSRF-Token', 'Required');
        }
      } else if (req.url?.startsWith('/sap/bc/adt/core/http/sessions')) {
        res.statusCode = 204;
      } else {
        const token = req.headers.cookie?.includes('locked-session') ? 'refreshed-token' : 'initial-token';
        res.setHeader('X-CSRF-Token', token);
      }
      res.end();
    };

    await parent.withStatefulSession(async (child) => {
      await child.post('/lock');
      replaceCookies({ [sessionCookie]: 'rotated-session' });
      await child.put(readPath, '<write/>');
    });
    expect(puts).toBe(2);
    const contextRequests = requests.filter(({ headers }) => headers.cookie?.includes('owned-context'));
    expect(contextRequests.map(({ method }) => method)).toEqual(['PUT', 'HEAD', 'PUT', 'GET']);
    expect(contextRequests.every(({ headers }) => headers.cookie?.includes(`${sessionCookie}=locked-session`))).toBe(
      true,
    );
    expect(contextRequests[2]?.headers['x-csrf-token']).toBe('refreshed-token');
    expect(contextRequests[3]?.headers['x-sap-adt-sessiontype']).toBe('stateless');

    await parent.withStatefulSession((child) => child.fetchCsrfToken());
    expect(requests.at(-1)?.headers.cookie).toBe(`${sessionCookie}=rotated-session`);
  });

  it('does not install a file rotated while a bearer-provider await is cancelled', async () => {
    let waitForProvider = false;
    let providerEntered!: () => void;
    let releaseProvider: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    const client = createClient({
      bearerTokenProvider: async () => {
        if (waitForProvider) {
          providerEntered();
          await new Promise<void>((resolve) => {
            releaseProvider = resolve;
          });
        }
        return 'example-bearer';
      },
    });
    reply = (req, res) => {
      if (req.url?.startsWith('/seed')) {
        res.setHeader('Set-Cookie', [`${sessionCookie}=live-session; Path=/`, 'sap-contextid=live-context; Path=/']);
      }
      res.setHeader('X-CSRF-Token', 'live-token');
      res.end('ok');
    };
    await client.get('/seed');
    replaceCookies({ [sessionCookie]: 'rotated-session' });
    const controller = new AbortController();
    waitForProvider = true;
    const pending = client.fetchCsrfToken({ signal: controller.signal });
    await entered;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AdtNetworkError', cause: { name: 'AbortError' } });
    expect(requests).toHaveLength(1);
    releaseProvider?.();
    waitForProvider = false;
    replaceCookies({ [sessionCookie]: 'expired-session' });

    await client.fetchCsrfToken();
    expect(requests.at(-1)?.headers.cookie).toContain(`${sessionCookie}=live-session`);
    expect(requests.at(-1)?.headers.cookie).toContain('sap-contextid=live-context');
  });

  it('recovers a stateful child that inherited an expired parent token', async () => {
    const parent = createClient();
    const ordinaryReply = reply;
    reply = (req, res) => {
      if (!req.url?.startsWith('/seed')) return ordinaryReply(req, res);
      res.setHeader('X-CSRF-Token', 'expired-token');
      res.end('ok');
    };
    await parent.get('/seed');
    replaceCookies({ [sessionCookie]: 'rotated-session' });

    await expect(parent.withStatefulSession((child) => child.post(readPath, '<read/>'))).resolves.toMatchObject({
      statusCode: 200,
    });
    const posts = requests.filter(({ method }) => method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.headers['x-csrf-token']).toBe('expired-token');
    expect(posts[1]?.headers).toMatchObject({
      cookie: `${sessionCookie}=rotated-session`,
      'x-csrf-token': 'rotated-token',
    });
  });

  it('rejects an old in-flight bootstrap without replacing the new session', async () => {
    const client = createClient();
    const ordinaryReply = reply;
    let finishOld: (() => void) | undefined;
    const oldRequestArrived = new Promise<void>((resolve) => {
      reply = (req, res) => {
        if (finishOld || req.method !== 'HEAD') return ordinaryReply(req, res);
        finishOld = () => {
          res.setHeader('X-CSRF-Token', 'obsolete-token');
          res.setHeader('Set-Cookie', `${sessionCookie}=obsolete-session; Path=/`);
          res.end('ok');
        };
        resolve();
      };
    });
    const oldOutcome = client.fetchCsrfToken().catch((error: unknown) => error);
    await oldRequestArrived;
    replaceCookies({ [sessionCookie]: 'rotated-session' });

    try {
      await client.fetchCsrfToken();
    } finally {
      finishOld?.();
    }
    expect(await oldOutcome).toMatchObject({
      name: 'AdtNetworkError',
      message: expect.stringContaining('SAP session changed during CSRF bootstrap'),
    });
    await client.post(readPath, '<read/>');
    expect(requests.at(-1)?.headers).toMatchObject({
      cookie: `${sessionCookie}=rotated-session`,
      'x-csrf-token': 'rotated-token',
    });
  });

  it('never sends the operation on a failed bootstrap and sends it once after rotation with noReplay', async () => {
    const client = createClient();
    await expect(client.post(readPath, '<read/>', undefined, undefined, { noReplay: true })).rejects.toBeInstanceOf(
      AdtCsrfBootstrapError,
    );
    expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(0);
    replaceCookies({ [sessionCookie]: 'rotated-session' });

    await client.post(readPath, '<read/>', undefined, undefined, { noReplay: true });
    expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  it('honors cancellation without sending a probe', async () => {
    const client = createClient();
    replaceCookies({ [sessionCookie]: 'rotated-session' });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.post(readPath, '<read/>', undefined, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AdtNetworkError',
      cause: { name: 'AbortError' },
    });
    expect(requests).toHaveLength(0);
  });
});

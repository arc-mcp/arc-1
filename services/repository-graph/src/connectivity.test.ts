import { once } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectivityTransport, connectivityConfig } from './connectivity.js';
import { resolveDestination } from './destination.js';
import { SapClient } from './sap.js';

vi.mock('undici', async (load) => ({ ...(await load<typeof import('undici')>()), fetch: vi.fn() }));
vi.mock('./destination.js', () => ({ resolveDestination: vi.fn() }));

import { fetch } from 'undici';

const env = (port: number): NodeJS.ProcessEnv => ({
  ARC_GRAPH_CONNECTIVITY_BINDING: 'selected-connectivity',
  VCAP_SERVICES: JSON.stringify({
    connectivity: [
      { name: 'wrong-first', credentials: {} },
      {
        name: 'selected-connectivity',
        credentials: {
          onpremise_proxy_host: '127.0.0.1',
          onpremise_proxy_http_port: port,
          token_service_url: 'https://oauth.example.test',
          clientid: 'test-client',
          clientsecret: 'test-secret',
        },
      },
    ],
  }),
});
const target = new URL('http://virtual.invalid:8000/sap/bc/adt/discovery?sap-client=001');
const auth = { authorization: 'Basic dGVzdDp0ZXN0' };
beforeEach(() => {
  vi.mocked(fetch).mockImplementation(
    async () => new Response(JSON.stringify({ access_token: 'test-proxy-token', expires_in: 60 })) as never,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(fetch).mockReset();
  vi.mocked(resolveDestination).mockReset();
});

async function fixture(handler: RequestListener, run: (port: number) => Promise<void>) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  try {
    await run(address.port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

it('selects the named binding and rejects ambiguous bindings and non-HTTPS token URLs', () => {
  expect(connectivityConfig(env(8000)).proxyOrigin).toBe('http://127.0.0.1:8000');
  expect(() => connectivityConfig({})).toThrow('Explicit');
  expect(() =>
    connectivityConfig({
      ...env(8000),
      VCAP_SERVICES: env(8000).VCAP_SERVICES!.replace('wrong-first', 'selected-connectivity'),
    }),
  ).toThrow('ambiguous');
  expect(() =>
    connectivityConfig({
      ...env(8000),
      VCAP_SERVICES: env(8000).VCAP_SERVICES!.replace('https://oauth', 'http://oauth'),
    }),
  ).toThrow('HTTPS');
});

it('sends absolute URLs, virtual Host and location ID only to the proxy; shares and refreshes its token', async () => {
  let count = 0;
  await fixture(
    (req, res) => {
      count++;
      expect(req.url).toBe(target.toString());
      expect(req.headers.host).toBe(target.host);
      expect(req.headers.authorization).toBe(auth.authorization);
      expect(req.headers['proxy-authorization']).toBe('Bearer test-proxy-token');
      expect(req.headers['sap-connectivity-scc-location_id']).toBe('test-location');
      res.end('metadata');
    },
    async (port) => {
      const proxy = new ConnectivityTransport('test-location', env(port));
      try {
        const now = Date.now();
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
        await Promise.all([1, 2].map(() => proxy.get(target, auth, AbortSignal.timeout(1000))));
        expect(fetch).toHaveBeenCalledTimes(1);
        clock.mockReturnValue(now + 60_000);
        expect((await proxy.get(target, auth, AbortSignal.timeout(1000))).body).toBe('metadata');
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(count).toBe(3);
        expect(proxy.requests).toEqual({ sap: 3, token: 2 });
      } finally {
        await proxy.close();
      }
    },
  );
});

it('refreshes a rejected proxy credential once and then fails closed', async () => {
  await fixture(
    (_req, res) => {
      res.statusCode = 407;
      res.end('PRIVATE_CANARY');
    },
    async (port) => {
      const proxy = new ConnectivityTransport(undefined, env(port));
      try {
        await expect(proxy.get(target, auth, AbortSignal.timeout(1000))).rejects.toThrow(
          'Connectivity authentication failed',
        );
        expect(proxy.requests).toEqual({ sap: 2, token: 2 });
      } finally {
        await proxy.close();
      }
    },
  );
});

it('does not follow redirects or expose their destination credentials', async () => {
  await fixture(
    (_req, res) => {
      res.writeHead(302, { location: 'https://untrusted.invalid' });
      res.end();
    },
    async (port) => {
      const proxy = new ConnectivityTransport(undefined, env(port));
      try {
        expect((await proxy.get(target, auth, AbortSignal.timeout(1000))).status).toBe(302);
        expect(proxy.requests.sap).toBe(1);
      } finally {
        await proxy.close();
      }
    },
  );
});

it('bounds decoded compressed bodies and aborts stalled bodies', async () => {
  let mode = 'small';
  await fixture(
    (_req, res) => {
      if (mode === 'stall') {
        res.writeHead(200);
        res.write('chunk');
        return;
      }
      res.setHeader('content-encoding', 'gzip');
      res.end(gzipSync(mode === 'small' ? 'metadata' : 'x'.repeat(1_048_577)));
    },
    async (port) => {
      const proxy = new ConnectivityTransport(undefined, env(port));
      try {
        expect((await proxy.get(target, auth, AbortSignal.timeout(1000))).body).toBe('metadata');
        mode = 'large';
        await expect(proxy.get(target, auth, AbortSignal.timeout(1000))).rejects.toThrow('response_too_large');
        mode = 'stall';
        await expect(proxy.get(target, auth, AbortSignal.timeout(50))).rejects.toThrow();
        mode = 'small';
        expect((await proxy.get(target, auth, AbortSignal.timeout(1000))).body).toBe('metadata');
      } finally {
        await proxy.close();
      }
    },
  );
});

it('uses the proxy from SapClient and stops further requests after SAP authentication fails', async () => {
  await fixture(
    (_req, res) => {
      res.statusCode = 401;
      res.end('SECRET_ERROR'.repeat(100000));
    },
    async (port) => {
      for (const [key, value] of Object.entries(env(port))) vi.stubEnv(key, value);
      vi.mocked(resolveDestination).mockResolvedValue({
        destinationConfiguration: {
          URL: target.origin,
          ProxyType: 'OnPremise',
          Authentication: 'BasicAuthentication',
          'sap-client': '001',
        },
        authTokens: [{ http_header: { key: 'authorization', value: auth.authorization } }],
      });
      const sap = await SapClient.create('CC_TEST');
      try {
        expect(sap.transport).toBe('cloud-connector');
        await expect(sap.getText('/sap/bc/adt/discovery')).rejects.toThrow('SAP authentication failed');
        await expect(sap.getText('/sap/bc/adt/discovery')).rejects.toThrow('SAP authentication failed');
        expect(sap.metrics().sapRequestAttempts).toBe(1);
      } finally {
        await sap.close();
      }
    },
  );
});

it('does not convert principal propagation into a technical-user fallback', async () => {
  vi.mocked(resolveDestination).mockResolvedValue({
    destinationConfiguration: { URL: target.origin, ProxyType: 'OnPremise', Authentication: 'PrincipalPropagation' },
  });
  await expect(SapClient.create('PP_TEST')).rejects.toThrow('explicit technical identity');
  expect(fetch).not.toHaveBeenCalled();
});

it('refuses ambiguous direct and destination configurations before any network request', async () => {
  vi.stubEnv('ARC_GRAPH_SAP_URL', 'https://sap.example.test');
  vi.stubEnv('ARC_GRAPH_SAP_USER', 'technical');
  vi.stubEnv('ARC_GRAPH_SAP_PASSWORD', 'test-only');
  await expect(SapClient.create('ON_PREMISE')).rejects.toThrow('not both');
  expect(resolveDestination).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('recovers once from a stale proxy token without retrying a SAP authentication failure', async () => {
  let requests = 0;
  await fixture(
    (_req, res) => {
      res.statusCode = ++requests === 1 ? 407 : 200;
      res.end('metadata');
    },
    async (port) => {
      const proxy = new ConnectivityTransport(undefined, env(port));
      try {
        expect((await proxy.get(target, auth, AbortSignal.timeout(1000))).status).toBe(200);
        expect(proxy.requests).toEqual({ sap: 2, token: 2 });
      } finally {
        await proxy.close();
      }
    },
  );
});

it('never reaches the proxy when token acquisition fails or redirects', async () => {
  let requests = 0;
  await fixture(
    (_req, res) => {
      requests++;
      res.end();
    },
    async (port) => {
      for (const status of [302, 401, 500]) {
        vi.mocked(fetch).mockResolvedValue(new Response('SECRET_CANARY', { status }) as never);
        const proxy = new ConnectivityTransport(undefined, env(port));
        try {
          await expect(proxy.get(target, auth, AbortSignal.timeout(1000))).rejects.toThrow(
            'Connectivity authentication failed',
          );
          expect(requests).toBe(0);
        } finally {
          await proxy.close();
        }
      }
    },
  );
});

it('keeps direct network HTTP and insecure TLS disabled', async () => {
  vi.stubEnv('ARC_GRAPH_SAP_URL', 'http://sap.example.test');
  vi.stubEnv('ARC_GRAPH_SAP_USER', 'technical');
  vi.stubEnv('ARC_GRAPH_SAP_PASSWORD', 'test-only');
  await expect(SapClient.create('')).rejects.toThrow('HTTPS');
  vi.stubEnv('ARC_GRAPH_SAP_URL', 'https://sap.example.test');
  vi.stubEnv('ARC_GRAPH_SAP_TRUST_ALL', 'true');
  await expect(SapClient.create('')).rejects.toThrow('verified SAP TLS');
  expect(fetch).not.toHaveBeenCalled();
});

it('also stops direct SAP authentication failures before reading a stalled error body', async () => {
  vi.stubEnv('ARC_GRAPH_SAP_URL', 'https://sap.example.test');
  vi.stubEnv('ARC_GRAPH_SAP_USER', 'technical');
  vi.stubEnv('ARC_GRAPH_SAP_PASSWORD', 'test-only');
  const cancel = vi.fn();
  vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 401 }) as never);
  const sap = await SapClient.create('');
  try {
    await expect(sap.getText('/sap/bc/adt/discovery')).rejects.toThrow('SAP authentication failed');
    await expect(sap.getText('/sap/bc/adt/discovery')).rejects.toThrow('SAP authentication failed');
    expect(fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  } finally {
    await sap.close();
  }
});

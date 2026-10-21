import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockResponse } from '../../helpers/mock-fetch.js';

// Mock undici's fetch (used by AdtHttpClient.doFetch)
const mockFetch = vi.fn();

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

// Import after mock setup
const { AdtHttpClient } = await import('../../../src/adt/http.js');
type AdtHttpConfig = ConstructorParameters<typeof AdtHttpClient>[0];

function getDefaultConfig(): AdtHttpConfig {
  return {
    baseUrl: 'http://sap.example.com:8000',
    username: 'admin',
    password: 'secret',
    client: '001',
    language: 'EN',
  };
}

describe('AdtHttpClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('security session bootstrap', () => {
    it('lets one request establish the SAP security session before a cold fan-out', async () => {
      // SAP issues a new security session to every request without the session cookie.
      // Unused sessions count against the per-user limit (SICF_SESSIONS), so a parallel
      // fan-out on a cold client must not open one session per request.
      let issued = 0;
      const sentCookies: Array<string | undefined> = [];
      mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
        const cookie = ((init.headers ?? {}) as Record<string, string>).Cookie;
        sentCookies.push(cookie);
        if (cookie?.includes('SAP_SESSIONID_A4H_001=')) return mockResponse(200, 'ok');
        issued++;
        return mockResponse(200, 'ok', {}, [`SAP_SESSIONID_A4H_001=S${issued}; Path=/`]);
      });

      const client = new AdtHttpClient(getDefaultConfig());
      await Promise.all(['/a', '/b', '/c', '/d'].map((path) => client.get(path)));

      expect(issued).toBe(1);
      expect(sentCookies[0]).toBeUndefined();
      for (const cookie of sentCookies.slice(1)) expect(cookie).toContain('SAP_SESSIONID_A4H_001=S1');
    });

    it('releases waiting requests on the first response, not when a long first request ends', async () => {
      let finishPost!: () => void;
      mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
        if (url.includes('/core/discovery')) {
          return mockResponse(200, '', { 'x-csrf-token': 'T' }, ['SAP_SESSIONID_A4H_001=S1; Path=/']);
        }
        if (init.method === 'POST') {
          await new Promise<void>((resolve) => {
            finishPost = resolve;
          });
        }
        return mockResponse(200, 'ok');
      });

      const client = new AdtHttpClient(getDefaultConfig());
      const longPost = client.post('/long', '<xml/>');
      const read = await client.get('/read');

      expect(read.body).toBe('ok');
      finishPost();
      await longPost;
    });

    it('sends a token and session cookie from the same fetch when concurrent requests refresh both', async () => {
      // SAP binds the CSRF token to the session cookie; a torn pair is a 403. With a
      // bearerTokenProvider awaiting mid-build, a second request's CSRF fetch can swap
      // both fields between the two reads. Park request A there and let B overwrite them.
      let releaseA!: () => void;
      const aReleased = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let aParked!: () => void;
      const aIsParked = new Promise<void>((resolve) => {
        aParked = resolve;
      });

      let discoveryCalls = 0;
      const posts: Array<{ token?: string; cookie?: string }> = [];
      mockFetch.mockImplementation(async (url: string, init: RequestInit) => {
        const headers = (init.headers ?? {}) as Record<string, string>;
        if (url.includes('/core/discovery')) {
          const nth = ++discoveryCalls;
          // Second (cold) fetch lands while A is parked, replacing token + cookie.
          if (nth === 2) await aIsParked;
          return mockResponse(200, '', { 'x-csrf-token': `TOKEN-S${nth}` }, [`SAP_SESSIONID_A4H_001=S${nth}; Path=/`]);
        }
        posts.push({ token: headers['X-CSRF-Token'], cookie: headers.Cookie });
        if (posts.length === 1) releaseA(); // B is on the wire — let A finish building
        return mockResponse(200, 'ok');
      });

      let parked = false;
      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        // An established session: without it the security-session bootstrap would let
        // only one request through first and the race below could not happen.
        cookies: { SAP_SESSIONID_A4H_001: 'S0' },
        bearerTokenProvider: async () => {
          // fetchCsrfToken() calls this too, before any discovery — park only the
          // in-request call that sits between the token read and the cookie read.
          if (!parked && discoveryCalls > 0) {
            parked = true;
            aParked();
            await aReleased;
          }
          return 'bearer';
        },
      });

      await Promise.all([client.post('/path', '<xml/>'), client.post('/path', '<xml/>')]);

      expect(posts).toHaveLength(2);
      for (const sent of posts) {
        const session = /SAP_SESSIONID_A4H_001=(S\d)/.exec(sent.cookie ?? '')?.[1];
        expect(sent.token).toBe(`TOKEN-${session}`);
      }
    });

    it('does not serialize a client that already has a session cookie', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      mockFetch.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return mockResponse(200, 'ok');
      });

      const client = new AdtHttpClient({ ...getDefaultConfig(), cookies: { SAP_SESSIONID_A4H_001: 'S0' } });
      await Promise.all(['/a', '/b', '/c'].map((path) => client.get(path)));

      expect(maxInFlight).toBe(3);
    });

    it.each([200, 304])('stops gating after HTTP %i even when SAP sends no session cookie', async (status) => {
      let inFlight = 0;
      let maxInFlight = 0;
      mockFetch.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return mockResponse(status, status === 304 ? '' : 'ok');
      });

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/first');
      await Promise.all(['/a', '/b', '/c'].map((path) => client.get(path)));

      expect(maxInFlight).toBe(3);
    });

    it('releases waiting requests when the first request fails', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValue(mockResponse(200, 'ok', {}, ['SAP_SESSIONID_A4H_001=S1; Path=/']));

      const client = new AdtHttpClient(getDefaultConfig());
      const results = await Promise.allSettled([client.get('/a'), client.get('/b')]);

      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('fulfilled');
    });
  });
});

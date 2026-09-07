import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { fetch, Pool } from 'undici';
import { boundedText } from './bounded-body.js';
import { selectedBinding } from './graph/bindings.js';

export class ConnectivityAuthenticationError extends Error {
  constructor() {
    super('Connectivity authentication failed; collection stopped');
  }
}

export function connectivityConfig(env: NodeJS.ProcessEnv = process.env) {
  const name = env.ARC_GRAPH_CONNECTIVITY_BINDING?.trim();
  if (!name) throw new Error('Explicit ARC_GRAPH_CONNECTIVITY_BINDING required for Cloud Connector');
  const c = selectedBinding(env, name);
  const host = c.onpremise_proxy_host;
  const port = Number(c.onpremise_proxy_http_port ?? c.onpremise_proxy_port);
  const tokenUrl = c.token_service_url ?? c.url;
  if (
    typeof host !== 'string' ||
    !/^[a-zA-Z0-9.-]+$/.test(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    typeof tokenUrl !== 'string' ||
    typeof c.clientid !== 'string' ||
    !c.clientid ||
    typeof c.clientsecret !== 'string' ||
    !c.clientsecret
  )
    throw new Error('Invalid Connectivity binding');
  let token: URL;
  try {
    token = new URL(tokenUrl);
  } catch {
    throw new Error('Invalid Connectivity token endpoint');
  }
  if (token.protocol !== 'https:' || token.username || token.password || token.search || token.hash)
    throw new Error('Connectivity token endpoint requires verified HTTPS');
  if (!token.pathname.endsWith('/oauth/token')) token.pathname = `${token.pathname.replace(/\/$/, '')}/oauth/token`;
  return {
    proxyOrigin: `http://${host}:${port}`,
    tokenUrl: token.toString(),
    clientId: c.clientid,
    clientSecret: c.clientsecret,
  };
}

/** Standard absolute-form proxying, not CONNECT. No direct-network fallback. */
export class ConnectivityTransport {
  readonly requests = { sap: 0, token: 0 };
  private readonly config;
  private readonly pool: Pool;
  private token?: { value: string; expiresAt: number };
  private pendingToken?: Promise<string>;

  constructor(
    private readonly locationId?: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    if (locationId && !/^[\x21-\x7e]{1,128}$/.test(locationId)) throw new Error('Invalid Cloud Connector location ID');
    this.config = connectivityConfig(env);
    this.pool = new Pool(this.config.proxyOrigin, { connections: 5, pipelining: 1, headersTimeout: 0, bodyTimeout: 0 });
  }

  private async proxyToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (this.pendingToken) return this.pendingToken;
    this.pendingToken = (async () => {
      this.requests.token++;
      try {
        const r = await fetch(this.config.tokenUrl, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
          }).toString(),
        });
        if (!r.ok) {
          await r.body?.cancel();
          throw new ConnectivityAuthenticationError();
        }
        const value = JSON.parse(await boundedText(r, 262_144)) as { access_token?: unknown; expires_in?: unknown };
        const lifetime = Number(value.expires_in);
        if (
          typeof value.access_token !== 'string' ||
          !/^[\x21-\x7e]{1,65536}$/.test(value.access_token) ||
          !Number.isFinite(lifetime) ||
          lifetime <= 0
        )
          throw new ConnectivityAuthenticationError();
        this.token = { value: value.access_token, expiresAt: Date.now() + Math.min(lifetime * 900, 3_600_000) };
        return this.token.value;
      } catch {
        throw new ConnectivityAuthenticationError();
      } finally {
        this.pendingToken = undefined;
      }
    })();
    return this.pendingToken;
  }

  async get(url: URL, headers: Record<string, string>, signal: AbortSignal) {
    // Virtual HTTP addresses exist only behind this bound proxy. SAP-leg TLS is configured in CC.
    if (url.protocol !== 'http:' || url.username || url.password)
      throw new Error('Cloud Connector requires an HTTP virtual destination');
    for (let retry = 0; retry < 2; retry++) {
      const token = await this.proxyToken();
      signal.throwIfAborted();
      this.requests.sap++;
      const r = await this.pool.request({
        method: 'GET',
        path: url.toString(),
        signal,
        headers: {
          ...headers,
          host: url.host,
          'accept-encoding': 'identity',
          'proxy-authorization': `Bearer ${token}`,
          ...(this.locationId ? { 'SAP-Connectivity-SCC-Location_ID': this.locationId } : {}),
        },
      });
      // Explicit cancellation of undici bodies emits an AbortError. Readers still receive
      // stream errors; this listener also covers paths that intentionally never read a body.
      r.body.on('error', () => undefined);
      if (r.statusCode === 407) {
        r.body.destroy();
        if (this.token?.value === token) this.token = undefined;
        if (retry === 0) continue;
        throw new ConnectivityAuthenticationError();
      }
      // Never let a large/slow SAP error body hide a bad identity or cause repeated logins.
      if (r.statusCode === 401) {
        r.body.destroy();
        return { status: 401, body: '', headers: new Headers() };
      }
      let decoder: ReturnType<typeof createGunzip> | undefined;
      try {
        const h = new Headers();
        for (const [key, value] of Object.entries(r.headers))
          if (value !== undefined) h.set(key, Array.isArray(value) ? value.join(',') : String(value));
        const encoding = h.get('content-encoding')?.toLowerCase();
        if (encoding && encoding !== 'identity') {
          if (encoding === 'gzip') decoder = createGunzip();
          else if (encoding === 'deflate') decoder = createInflate();
          else if (encoding === 'br') decoder = createBrotliDecompress();
          else throw new Error('Unsupported SAP content encoding');
          h.delete('content-length');
          r.body.once('error', (error) => decoder?.destroy(error));
          r.body.pipe(decoder);
        }
        const body = await boundedText({
          headers: h,
          body: Readable.toWeb(decoder ?? r.body) as ReadableStream<Uint8Array>,
        });
        return { status: r.statusCode, body, headers: h };
      } finally {
        decoder?.destroy();
        r.body.destroy();
      }
    }
    throw new ConnectivityAuthenticationError();
  }

  async close(): Promise<void> {
    await this.pool.destroy();
  }
}

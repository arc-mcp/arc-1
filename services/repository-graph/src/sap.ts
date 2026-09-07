import { Agent, fetch } from 'undici';
import { boundedText } from './bounded-body.js';
import { ConnectivityAuthenticationError, ConnectivityTransport } from './connectivity.js';
import { resolveDestination } from './destination.js';
import { integerSetting } from './settings.js';

const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

export class SapRequestError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SapRequestError';
  }
}

export class SapAuthenticationError extends SapRequestError {
  constructor() {
    super('SAP authentication failed; collection stopped', 1, 401);
  }
}

type SapResponse = { status: number; ok: boolean; headers: { get(name: string): string | null } };

function retryDelay(response: SapResponse | undefined, attempt: number): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter && Number.isFinite(Number(retryAfter))) return Math.min(5_000, Number(retryAfter) * 1_000);
  return Math.min(2_000, 250 * 2 ** (attempt - 1));
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function buildSapUrl(baseUrl: string, path: string, client?: string, params?: URLSearchParams): URL {
  const url = new URL(path, baseUrl);
  if (url.origin !== new URL(baseUrl).origin || !url.pathname.startsWith('/sap/bc/adt/')) {
    throw new Error('SAP request must stay on the configured ADT origin');
  }
  if (client) url.searchParams.set('sap-client', client);
  for (const [key, value] of params ?? []) url.searchParams.set(key, value);
  return url;
}

export function buildSapDiscoveryUrl(baseUrl: string, client?: string): URL {
  return buildSapUrl(baseUrl, '/sap/bc/adt/discovery', client);
}

export class SapClient {
  readonly destinationName: string;
  readonly client?: string;
  readonly baseUrl: string;
  private readonly agent?: Agent;
  private readonly authHeader: { key: string; value: string };
  private readonly proxy?: ConnectivityTransport;
  private authenticationFailed = false;
  private requestAttempts = 0;
  readonly transport: 'cloud-connector' | 'direct';

  private constructor(options: {
    destinationName: string;
    client?: string;
    baseUrl: string;
    trustAll: boolean;
    authHeader: { key: string; value: string };
    proxy?: ConnectivityTransport;
  }) {
    const url = new URL(options.baseUrl);
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && (options.proxy || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
    ) {
      throw new Error('SAP requires HTTPS (HTTP is allowed only for loopback fixtures)');
    }
    if (options.trustAll) throw new Error('Collector requires verified SAP TLS');
    this.destinationName = options.destinationName;
    this.client = options.client;
    this.baseUrl = options.baseUrl;
    this.authHeader = options.authHeader;
    this.proxy = options.proxy;
    this.transport = options.proxy ? 'cloud-connector' : 'direct';
    this.agent = options.trustAll ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
  }

  static async create(destinationName = process.env.SAP_DESTINATION ?? ''): Promise<SapClient> {
    const directUrl = process.env.ARC_GRAPH_SAP_URL?.trim();
    const directUser = process.env.ARC_GRAPH_SAP_USER?.trim();
    const directPassword = process.env.ARC_GRAPH_SAP_PASSWORD;
    if (directUrl || directUser || directPassword) {
      if (destinationName) throw new Error('Choose a Destination or direct SAP credentials, not both');
      if (!directUrl || !directUser || !directPassword) {
        throw new Error('ARC_GRAPH_SAP_URL, ARC_GRAPH_SAP_USER, and ARC_GRAPH_SAP_PASSWORD must be set together');
      }
      return new SapClient({
        destinationName: 'direct',
        client: process.env.ARC_GRAPH_SAP_CLIENT?.trim(),
        baseUrl: directUrl,
        trustAll: process.env.ARC_GRAPH_SAP_TRUST_ALL === 'true',
        authHeader: {
          key: 'authorization',
          value: `Basic ${Buffer.from(`${directUser}:${directPassword}`, 'utf8').toString('base64')}`,
        },
      });
    }
    if (!destinationName) throw new Error('SAP_DESTINATION or explicit direct SAP credentials are required');
    const resolved = await resolveDestination(destinationName);
    const config = resolved.destinationConfiguration;
    if (config.Authentication === 'PrincipalPropagation')
      throw new Error('Background collection requires an explicit technical identity');
    const onPremise = config.ProxyType === 'OnPremise';
    if (config.ProxyType && !['OnPremise', 'Internet'].includes(config.ProxyType))
      throw new Error('Unsupported destination proxy type');
    if (onPremise && config.Authentication !== 'BasicAuthentication')
      throw new Error('Cloud Connector collection requires a BasicAuthentication technical destination');
    if (process.env.ARC_GRAPH_SAP_URL_OVERRIDE) throw new Error('Destination URL overrides are not supported');
    const authHeader = resolved.authTokens?.find(
      (token) => token.http_header?.key?.toLowerCase() === 'authorization' && token.http_header.value,
    )?.http_header;
    if (!config.URL || !authHeader?.key || !authHeader.value) {
      throw new Error(`Destination ${destinationName} does not provide a URL and authorization header`);
    }
    if (onPremise && new URL(config.URL).protocol !== 'http:')
      throw new Error('Cloud Connector requires an HTTP virtual destination');
    if (onPremise && !authHeader.value.startsWith('Basic '))
      throw new Error('Cloud Connector requires technical Basic authorization');
    // Reject before allocating the pool; TrustAll must never weaken direct SAP or OAuth TLS.
    if (config.TrustAll?.toLowerCase() === 'true' || process.env.ARC_GRAPH_SAP_TRUST_ALL === 'true')
      throw new Error('Collector requires verified SAP TLS');
    return new SapClient({
      destinationName,
      client: config['sap-client'],
      baseUrl: process.env.ARC_GRAPH_SAP_URL_OVERRIDE?.trim() || config.URL,
      trustAll:
        process.env.ARC_GRAPH_SAP_TRUST_ALL === undefined
          ? config.TrustAll?.toLowerCase() === 'true'
          : process.env.ARC_GRAPH_SAP_TRUST_ALL === 'true',
      authHeader: { key: authHeader.key, value: authHeader.value },
      ...(onPremise ? { proxy: new ConnectivityTransport(config.CloudConnectorLocationId) } : {}),
    });
  }

  async getText(
    path: string,
    params?: URLSearchParams,
    options: { accept?: string; ifNoneMatch?: string; retries?: number; timeoutMs?: number } = {},
  ): Promise<{ attempts: number; body: string; status: number; etag?: string }> {
    const headers: Record<string, string> = {
      accept: options.accept ?? 'application/atomsvc+xml, application/xml',
      [this.authHeader.key]: this.authHeader.value,
    };
    if (options.ifNoneMatch) headers['if-none-match'] = options.ifNoneMatch;
    const timeoutMs = options.timeoutMs ?? integerSetting('ARC_GRAPH_SAP_TIMEOUT_MS', 15_000, 1_000, 60_000);
    const retries = options.retries ?? integerSetting('ARC_GRAPH_SAP_RETRIES', 2, 0, 4);

    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      if (this.authenticationFailed) throw new SapAuthenticationError();
      let response: SapResponse | undefined;
      try {
        const url = buildSapUrl(this.baseUrl, path, this.client, params);
        let body: string;
        if (this.proxy) {
          const proxied = await this.proxy.get(url, headers, AbortSignal.timeout(timeoutMs));
          body = proxied.body;
          response = {
            status: proxied.status,
            ok: proxied.status >= 200 && proxied.status < 300,
            headers: proxied.headers,
          };
        } else {
          this.requestAttempts++;
          const direct = await fetch(url, {
            dispatcher: this.agent,
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (direct.status === 401) {
            this.authenticationFailed = true;
            await direct.body?.cancel();
            throw new SapAuthenticationError();
          }
          response = direct;
          body = await boundedText(direct);
        }
        if (response.status === 401) {
          this.authenticationFailed = true;
          throw new SapAuthenticationError();
        }
        if (response.status === 304) {
          return {
            attempts: attempt,
            body: '',
            status: response.status,
            etag: response.headers.get('etag') ?? undefined,
          };
        }
        if (response.ok) {
          return { attempts: attempt, body, status: response.status, etag: response.headers.get('etag') ?? undefined };
        }
        if (attempt <= retries && RETRYABLE_STATUS.has(response.status)) {
          await delay(retryDelay(response, attempt));
          continue;
        }
        throw new SapRequestError(`SAP request ${path} failed with HTTP ${response.status}`, attempt, response.status);
      } catch (error) {
        if (error instanceof ConnectivityAuthenticationError) {
          this.authenticationFailed = true;
          throw error;
        }
        if (error instanceof SapRequestError) throw error;
        if (error instanceof Error && error.message === 'response_too_large') {
          throw new SapRequestError('SAP response exceeds the 1 MiB limit', attempt);
        }
        if (attempt <= retries) {
          await delay(retryDelay(response, attempt));
          continue;
        }
        throw new SapRequestError(`SAP request failed after ${attempt} attempts`, attempt);
      }
    }
    throw new SapRequestError(`SAP request ${path} failed`, retries + 1);
  }

  async close(): Promise<void> {
    await this.proxy?.close();
    await this.agent?.close();
  }

  metrics() {
    return {
      sapRequestAttempts: this.proxy?.requests.sap ?? this.requestAttempts,
      proxyTokenRequests: this.proxy?.requests.token ?? 0,
    };
  }
}

export async function probeSap(): Promise<{ destination: string; httpStatus: number; responseBytes: number }> {
  const client = await SapClient.create();
  try {
    const response = await client.getText('/sap/bc/adt/discovery');
    return {
      destination: client.destinationName,
      httpStatus: response.status,
      responseBytes: Buffer.byteLength(response.body),
    };
  } finally {
    await client.close();
  }
}

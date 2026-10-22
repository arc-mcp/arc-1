/** Bounded single-target Cloud Connector login reuse (#1085); application sessions stay per write. */
import { createHash } from 'node:crypto';
import { AdtClient } from '../adt/client.js';
import type { AdtClientConfig } from '../adt/config.js';

export type PerUserClient = {
  client: AdtClient;
  transportReuse: 'pooled-new' | 'pooled-reused' | 'request-local';
};

/** Oldest-created entries are evicted first; admitted calls retain their transport. */
export const PER_USER_TRANSPORT_MAX_ENTRIES = 500;

export class PerUserTransportPool {
  private readonly entries = new Map<string, { http: AdtClient['http']; deadline: number }>();

  constructor(
    private readonly maxAgeMs: number,
    private readonly maxEntries = PER_USER_TRANSPORT_MAX_ENTRIES,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** Called only after fresh destination resolution and per-user credential sanitization. */
  client(adtConfig: Partial<AdtClientConfig>, destination: string): PerUserClient {
    const now = performance.now();
    // Credential expiry can put a newer entry before an older entry's deadline.
    for (const [key, entry] of this.entries) {
      if (now >= entry.deadline) this.entries.delete(key);
    }
    const { baseUrl, client, btpProxy, sapConnectivityAuth } = adtConfig;
    const expires = credentialExpiry(sapConnectivityAuth);
    const remaining = expires - Date.now();
    if (!btpProxy || !sapConnectivityAuth || adtConfig.ppProxyAuth || remaining <= 0) {
      return { client: new AdtClient(adtConfig), transportReuse: 'request-local' };
    }
    // Hash the exact credential and route; never log or persist this key. Display names are not identities.
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          sapConnectivityAuth,
          destination,
          baseUrl,
          client,
          btpProxy.protocol,
          btpProxy.host,
          btpProxy.port,
          btpProxy.locationId,
        ]),
      )
      .digest('hex');
    const existing = this.entries.get(key);
    if (existing) {
      return { client: new AdtClient({ ...adtConfig, http: existing.http }), transportReuse: 'pooled-reused' };
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const fresh = new AdtClient(adtConfig);
    this.entries.set(key, { http: fresh.http, deadline: now + Math.min(this.maxAgeMs, remaining) });
    return { client: fresh, transportReuse: 'pooled-new' };
  }
}

/** This is a reuse limit, not JWT validation; the HTTP edge and destination resolver authenticate. */
function credentialExpiry(credential: string | undefined): number {
  try {
    const token = /^Bearer (\S+)$/i.exec(credential ?? '')?.[1];
    const parts = token?.split('.');
    if (parts?.length !== 3) return 0;
    const { exp } = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return typeof exp === 'number' && Number.isFinite(exp * 1000) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

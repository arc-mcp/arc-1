/**
 * Per-user SAP transport reuse for single-target principal propagation over HTTP (OPS-06).
 *
 * HTTP mode builds a server per request, so without reuse every PP tool call starts with an empty
 * cookie jar and opens a new SAP security session. SAP counts unused sessions per user and stops
 * issuing new ones at its limit; stateful lock/write requests then fail with `400 Session not found`
 * while stateless reads keep working (docs/research/2026-10-22-security-session-bootstrap.md).
 *
 * A transport is only handed to a request presenting the same per-user credential for the same route,
 * so the key is the identity SAP authenticated, not a claim derived from it. New requests replace an
 * entry once it reaches the maximum age; requests that already hold it keep it (R21).
 */

import { createHash } from 'node:crypto';
import { AdtClient } from '../adt/client.js';
import type { AdtClientConfig } from '../adt/config.js';

type Transport = AdtClient['http'];

/** Upper bound on retained users; the oldest entry is dropped first and its user simply logs on again. */
export const PER_USER_TRANSPORT_MAX_ENTRIES = 500;

export class PerUserTransportPool {
  // Insertion order is creation order: entries are never re-inserted, only replaced after removal.
  private readonly entries = new Map<string, { http: Transport; since: number }>();

  constructor(
    private readonly maxAgeMs: number,
    private readonly maxEntries = PER_USER_TRANSPORT_MAX_ENTRIES,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /**
   * Build a request's client on its user's pooled transport. Only Cloud Connector credentials are
   * pooled; Bearer and SAMLAssertion configs keep a request-local transport (OPS-06).
   */
  client(adtConfig: Partial<AdtClientConfig>, destination: string): AdtClient {
    const credential = adtConfig.ppProxyAuth ?? adtConfig.sapConnectivityAuth;
    if (!credential) return new AdtClient(adtConfig);
    const { baseUrl, client, btpProxy } = adtConfig;
    const route = [destination, baseUrl, client, btpProxy?.host, btpProxy?.port, btpProxy?.locationId];
    return new AdtClient({ ...adtConfig, http: this.take(credential, route, () => new AdtClient(adtConfig).http) });
  }

  /**
   * Return the live transport for this credential and route, or create one.
   * `credential` must be the exact per-user value sent to SAP; an empty value is never pooled.
   */
  take(credential: string, route: ReadonlyArray<string | number | undefined>, create: () => Transport): Transport {
    if (!credential) return create();
    const now = performance.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.since < this.maxAgeMs) break;
      this.entries.delete(key);
    }
    // Hash so the map holds no second copy of the credential; the transport itself must keep it.
    const key = createHash('sha256')
      .update(JSON.stringify([credential, ...route]))
      .digest('hex');
    const existing = this.entries.get(key);
    if (existing) return existing.http;
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const http = create();
    this.entries.set(key, { http, since: now });
    return http;
  }
}

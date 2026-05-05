/**
 * Tests for the stateless OAuth DCR client store.
 *
 * The interesting properties: a fresh store instance with the same
 * signing secret can resolve every client_id ever issued (no on-disk
 * state needed); tampering with the payload invalidates the signature;
 * client_secret is deterministic from the client_id.
 */

import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../../../src/server/audit.js';
import { logger } from '../../../src/server/logger.js';
import { StatelessDcrClientStore, validateRedirectUri } from '../../../src/server/stateless-client-store.js';

const SIGNING = 'test-signing-secret';
const XSUAA_ID = 'sb-arc1!t599384';
const XSUAA_SECRET = 'xsuaa-default-secret';

function makeStore(opts: { now?: () => number; ttlSeconds?: number } = {}) {
  return new StatelessDcrClientStore(XSUAA_ID, XSUAA_SECRET, SIGNING, opts);
}

/**
 * Install a capture-sink on the global logger and return the events array.
 * The sink writes only into its own buffer, so multiple tests can capture
 * concurrently without polluting each other.
 */
function captureAuditEvents(): AuditEvent[] {
  const events: AuditEvent[] = [];
  logger.addSink({ write: (e: AuditEvent) => events.push(e) });
  return events;
}

describe('StatelessDcrClientStore', () => {
  it('returns the pre-registered XSUAA default client unchanged', async () => {
    const store = makeStore();
    const client = await store.getClient(XSUAA_ID);
    expect(client?.client_id).toBe(XSUAA_ID);
    expect(client?.client_secret).toBe(XSUAA_SECRET);
    expect(client?.redirect_uris).toContain('https://claude.ai/api/mcp/auth_callback');
  });

  it('round-trips a registered client through register → getClient', async () => {
    const store = makeStore();
    const registered = await store.registerClient({
      redirect_uris: ['https://example.com/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      client_name: 'test-client',
    });

    expect(registered.client_id.startsWith('arc1-')).toBe(true);
    expect(registered.client_secret).toBeTruthy();
    expect(registered.client_id_issued_at).toBeTypeOf('number');

    const fetched = await store.getClient(registered.client_id);
    expect(fetched).toBeDefined();
    expect(fetched?.client_id).toBe(registered.client_id);
    expect(fetched?.client_secret).toBe(registered.client_secret);
    expect(fetched?.redirect_uris).toEqual(['https://example.com/callback']);
    expect(fetched?.client_name).toBe('test-client');
  });

  it('survives a process-style restart: a fresh store with the same secret resolves prior IDs', async () => {
    const first = makeStore();
    const registered = await first.registerClient({
      redirect_uris: ['https://example.com/cb'],
      client_name: 'persistent-by-design',
    });

    // Simulate a CF push: brand new instance, same signing secret.
    const second = makeStore();
    const fetched = await second.getClient(registered.client_id);
    expect(fetched?.client_id).toBe(registered.client_id);
    expect(fetched?.client_secret).toBe(registered.client_secret);
  });

  it('rejects a client_id with a tampered payload', async () => {
    const store = makeStore();
    const registered = await store.registerClient({ redirect_uris: ['https://example.com/cb'] });

    // Flip a single character in the payload portion of the ID.
    const [, body] = [registered.client_id.slice(0, 5), registered.client_id.slice(5)];
    const dotIdx = body.lastIndexOf('.');
    const tamperedPayload = `${body[0] === 'A' ? 'B' : 'A'}${body.slice(1, dotIdx)}${body.slice(dotIdx)}`;
    const tampered = `arc1-${tamperedPayload}`;

    expect(await store.getClient(tampered)).toBeUndefined();
  });

  it('rejects a client_id signed with a different secret', async () => {
    const issuer = makeStore();
    const registered = await issuer.registerClient({ redirect_uris: ['https://example.com/cb'] });

    const otherStore = new StatelessDcrClientStore(XSUAA_ID, XSUAA_SECRET, 'a-different-secret');
    expect(await otherStore.getClient(registered.client_id)).toBeUndefined();
  });

  it('returns undefined for malformed or unprefixed client IDs', async () => {
    const store = makeStore();
    expect(await store.getClient('not-prefixed')).toBeUndefined();
    expect(await store.getClient('arc1-')).toBeUndefined();
    expect(await store.getClient('arc1-no-dot-here')).toBeUndefined();
    expect(await store.getClient('arc1-payload.invalid-sig')).toBeUndefined();
  });

  it('expires clients past TTL', async () => {
    let nowMs = 1_700_000_000_000;
    const store = makeStore({ now: () => nowMs, ttlSeconds: 60 });
    const registered = await store.registerClient({ redirect_uris: ['https://example.com/cb'] });

    expect(await store.getClient(registered.client_id)).toBeDefined();

    nowMs += 61_000;
    expect(await store.getClient(registered.client_id)).toBeUndefined();
  });

  it('produces deterministic client_secret for a given client_id', async () => {
    const store = makeStore();
    const registered = await store.registerClient({ redirect_uris: ['https://example.com/cb'] });

    const lookedUpA = await store.getClient(registered.client_id);
    const lookedUpB = await store.getClient(registered.client_id);
    expect(lookedUpA?.client_secret).toBe(registered.client_secret);
    expect(lookedUpB?.client_secret).toBe(registered.client_secret);
  });

  it('encodes and rejects redirect URIs per the existing allowlist policy', async () => {
    const store = makeStore();
    await expect(store.registerClient({ redirect_uris: ['javascript:alert(1)'] })).rejects.toThrow(/javascript:/);
    await expect(store.registerClient({ redirect_uris: ['http://evil.example.com/cb'] })).rejects.toThrow(
      /http:\/\/ is only allowed/,
    );

    // These pass.
    await expect(store.registerClient({ redirect_uris: ['http://localhost:1234/cb'] })).resolves.toBeDefined();
    await expect(store.registerClient({ redirect_uris: ['cursor://cb'] })).resolves.toBeDefined();
  });

  it('keeps client_id length under a reasonable URL budget', async () => {
    const store = makeStore();
    // A typical MCP client registration shape (Claude/Cursor-class).
    const registered = await store.registerClient({
      redirect_uris: [
        'https://claude.ai/api/mcp/auth_callback',
        'cursor://anysphere.cursor-retrieval/oauth/callback',
        'http://localhost:6274/oauth/callback',
      ],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      client_name: 'Claude Desktop',
    });
    // Sanity bound: well under any practical URL length cap, and
    // double-checks that the encoded payload doesn't blow up.
    expect(registered.client_id.length).toBeLessThan(800);
  });

  it('mutates redirect_uris on the XSUAA default client via ensureRedirectUri', () => {
    const store = makeStore();
    store.ensureRedirectUri(XSUAA_ID, 'https://new-mcp-client.example.com/cb');
    // Re-fetch and confirm the new URI is on the list.
    return store.getClient(XSUAA_ID).then((c) => {
      expect(c?.redirect_uris).toContain('https://new-mcp-client.example.com/cb');
    });
  });

  it('is a no-op for ensureRedirectUri on DCR clients (stateless)', async () => {
    const store = makeStore();
    const registered = await store.registerClient({ redirect_uris: ['https://example.com/cb'] });
    store.ensureRedirectUri(registered.client_id, 'https://other.example.com/cb');
    const fetched = await store.getClient(registered.client_id);
    expect(fetched?.redirect_uris).toEqual(['https://example.com/cb']);
  });
});

describe('validateRedirectUri', () => {
  it('rejects dangerous schemes', () => {
    expect(() => validateRedirectUri('javascript:alert(1)')).toThrow();
    expect(() => validateRedirectUri('data:text/html,foo')).toThrow();
    expect(() => validateRedirectUri('file:///etc/passwd')).toThrow();
    expect(() => validateRedirectUri('ftp://x/y')).toThrow();
  });

  it('rejects http:// to non-loopback', () => {
    expect(() => validateRedirectUri('http://evil.com/cb')).toThrow(/localhost\/127\.0\.0\.1/);
  });

  it('accepts https, loopback http, and known custom schemes', () => {
    expect(() => validateRedirectUri('https://example.com/cb')).not.toThrow();
    expect(() => validateRedirectUri('http://localhost/cb')).not.toThrow();
    expect(() => validateRedirectUri('http://127.0.0.1:6274/oauth/callback')).not.toThrow();
    expect(() => validateRedirectUri('cursor://anysphere/cb')).not.toThrow();
    expect(() => validateRedirectUri('vscode://x/cb')).not.toThrow();
  });
});

describe('StatelessDcrClientStore default TTL', () => {
  it('defaults to 30 days when ttlSeconds is not provided', async () => {
    let nowMs = 1_700_000_000_000;
    const store = makeStore({ now: () => nowMs });
    const registered = await store.registerClient({ redirect_uris: ['https://example.com/cb'] });

    // Just under 30 days — still valid
    nowMs += (30 * 24 * 60 * 60 - 1) * 1000;
    expect(await store.getClient(registered.client_id)).toBeDefined();

    // 1 second past 30 days — expired
    nowMs += 2_000;
    expect(await store.getClient(registered.client_id)).toBeUndefined();
  });
});

describe('StatelessDcrClientStore audit events', () => {
  it('emits oauth_client_registered on /register with id length and uri count', async () => {
    const events = captureAuditEvents();
    const store = makeStore();

    const registered = await store.registerClient({
      redirect_uris: ['https://example.com/cb', 'cursor://x/cb'],
      client_name: 'audit-test',
    });

    const evt = events.find(
      (e) => e.event === 'oauth_client_registered' && e.registeredClientId === registered.client_id,
    );
    expect(evt).toBeDefined();
    expect(evt && 'redirectUriCount' in evt && evt.redirectUriCount).toBe(2);
    expect(evt && 'clientName' in evt && evt.clientName).toBe('audit-test');
    expect(evt && 'idBytes' in evt && evt.idBytes).toBe(registered.client_id.length);
    expect(evt?.level).toBe('info');
  });

  it('emits oauth_client_lookup_failed with reason="bad_signature" for tampered IDs', async () => {
    const events = captureAuditEvents();
    const store = makeStore();
    const registered = await store.registerClient({ redirect_uris: ['https://example.com/cb'] });

    const tampered = `arc1-${registered.client_id.slice(5).replace(/^./, 'X')}`;
    expect(await store.getClient(tampered)).toBeUndefined();

    const fail = events.find((e) => e.event === 'oauth_client_lookup_failed' && e.registeredClientId === tampered);
    expect(fail && 'reason' in fail && fail.reason).toBe('bad_signature');
    expect(fail?.level).toBe('warn');
  });

  it('emits oauth_client_lookup_failed with reason="malformed" for missing-signature IDs', async () => {
    const events = captureAuditEvents();
    const store = makeStore();

    expect(await store.getClient('arc1-no-dot-here')).toBeUndefined();

    const fail = events.find(
      (e) => e.event === 'oauth_client_lookup_failed' && e.registeredClientId === 'arc1-no-dot-here',
    );
    expect(fail && 'reason' in fail && fail.reason).toBe('malformed');
  });

  it('emits oauth_client_lookup_failed with reason="unknown_prefix" for non-arc1 IDs', async () => {
    const events = captureAuditEvents();
    const store = makeStore();

    expect(await store.getClient('foreign-id')).toBeUndefined();

    const fail = events.find((e) => e.event === 'oauth_client_lookup_failed' && e.registeredClientId === 'foreign-id');
    expect(fail && 'reason' in fail && fail.reason).toBe('unknown_prefix');
  });

  it('emits oauth_client_lookup_failed with reason="expired" at level "info" past TTL', async () => {
    const events = captureAuditEvents();
    let nowMs = 1_700_000_000_000;
    const store = makeStore({ now: () => nowMs, ttlSeconds: 60 });
    const registered = await store.registerClient({ redirect_uris: ['https://example.com/cb'] });

    nowMs += 61_000;
    expect(await store.getClient(registered.client_id)).toBeUndefined();

    const fail = events.find(
      (e) => e.event === 'oauth_client_lookup_failed' && e.registeredClientId === registered.client_id,
    );
    expect(fail && 'reason' in fail && fail.reason).toBe('expired');
    // Expiry is normal-ish (TTL eviction), not adversarial — info, not warn.
    expect(fail?.level).toBe('info');
  });

  it('emits oauth_redirect_uri_registered when XSUAA default redirect_uris is widened', async () => {
    const events = captureAuditEvents();
    const store = makeStore();

    store.ensureRedirectUri(XSUAA_ID, 'https://new.example.com/cb');

    const evt = events.find((e) => e.event === 'oauth_redirect_uri_registered');
    expect(evt).toBeDefined();
    expect(evt && 'redirectUri' in evt && evt.redirectUri).toBe('https://new.example.com/cb');
    expect(evt?.registeredClientId).toBe(XSUAA_ID);
  });

  it('does not emit oauth_redirect_uri_registered when ensureRedirectUri is a no-op (DCR client)', async () => {
    const store = makeStore();
    const registered = await store.registerClient({ redirect_uris: ['https://example.com/cb'] });

    const events = captureAuditEvents();
    store.ensureRedirectUri(registered.client_id, 'https://other.example.com/cb');

    const evt = events.find((e) => e.event === 'oauth_redirect_uri_registered');
    expect(evt).toBeUndefined();
  });

  it('does not emit oauth_redirect_uri_registered when the URI is already in the list', () => {
    const store = makeStore();
    // Pre-existing redirect — should be a no-op (no audit event).
    const events = captureAuditEvents();
    store.ensureRedirectUri(XSUAA_ID, 'https://claude.ai/api/mcp/auth_callback');

    const evt = events.find((e) => e.event === 'oauth_redirect_uri_registered');
    expect(evt).toBeUndefined();
  });
});

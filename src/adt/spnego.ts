/**
 * SPNEGO / Kerberos token acquisition for SAP logon (shared, process-ambient identity).
 *
 * ARC-1 never holds a Kerberos credential of its own: the token is minted from the OS credential
 * cache of the account the process runs under (SSPI on Windows, GSSAPI on Linux/macOS via the
 * optional `kerberos` native module). That makes SPNEGO a SHARED Layer-B identity — every MCP user
 * of the instance reaches SAP as that one account — so it is rejected alongside principal
 * propagation and multi-target mode in `validateConfig`.
 *
 * The native module is an OPTIONAL dependency, imported lazily through a computed specifier so a
 * build without it (the `.mcpb` Claude Desktop bundle is packed with `npm ci --ignore-scripts`, and
 * no musl/Alpine or win32-arm64 prebuild exists) still starts, compiles and runs with the feature
 * off. A missing module must surface as an actionable error, never as an unauthenticated request.
 */

import { logger } from '../server/logger.js';
import { AdtApiError } from './errors.js';

/** Minimal shape of the `kerberos` client we rely on (the package ships no stable public types). */
interface KerberosClient {
  step(challenge: string): Promise<string | undefined>;
}

interface KerberosModule {
  initializeClient(service: string, options?: Record<string, unknown>): Promise<KerberosClient>;
}

/** The optional native module is absent or cannot be loaded on this platform. */
export class SpnegoUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason?: unknown,
  ) {
    super(message);
    this.name = 'SpnegoUnavailableError';
  }
}

/** The GSSAPI/SSPI exchange itself failed (no TGT, unknown SPN, clock skew, …). */
export class SpnegoAuthError extends Error {
  constructor(
    message: string,
    readonly reason?: unknown,
  ) {
    super(message);
    this.name = 'SpnegoAuthError';
  }
}

/** Acquires one base64 SPNEGO token for the given service principal name. */
export type SpnegoTokenAcquirer = (spn: string) => Promise<string>;

/** SPNEGO negotiation mode. `bootstrap` trades one token for SAP session cookies (default). */
export type SpnegoMode = 'bootstrap' | 'per-request';

/** Resolved SPNEGO settings carried on the ADT client/transport config. */
export interface SpnegoConfig {
  /** Service principal name, e.g. `HTTP/sapdev.corp.example.com`. Already normalized. */
  spn: string;
  mode: SpnegoMode;
  /** Injection point for tests; defaults to the real native acquirer. */
  acquireToken?: SpnegoTokenAcquirer;
}

/**
 * Derive the default SPN from the SAP base URL: `HTTP/<host>`.
 *
 * The host is taken verbatim from the URL (no DNS canonicalization, no reverse lookup) so the SPN
 * is predictable and auditable. Load-balanced or CNAME'd systems commonly need the physical host
 * instead — that is what `SAP_SPNEGO_SPN` is for.
 */
export function deriveSpn(baseUrl: string): string {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new SpnegoAuthError(
      `SAP_SPNEGO requires a valid SAP_URL to derive the service principal name (got '${baseUrl}').`,
    );
  }
  if (!host) {
    throw new SpnegoAuthError(`SAP_SPNEGO could not derive a host from SAP_URL '${baseUrl}'.`);
  }
  // Strip IPv6 brackets: a literal address cannot carry a Kerberos service ticket anyway, but the
  // resulting SPN should at least be readable in the error the KDC produces.
  return `HTTP/${host.replace(/^\[|\]$/g, '')}`;
}

/**
 * Normalize an operator-supplied SPN. A bare host is accepted and prefixed with the HTTP service
 * class, matching what `klist` prints for a browser/PowerShell logon (`HTTP/<fqdn>`).
 */
export function normalizeSpn(raw: string): string {
  const value = raw.trim();
  if (!value) {
    throw new SpnegoAuthError('SAP_SPNEGO_SPN is empty. Use the service principal name, e.g. HTTP/sap.example.com.');
  }
  if (/\s/.test(value) || !/^[\x21-\x7e]+$/.test(value)) {
    throw new SpnegoAuthError('SAP_SPNEGO_SPN must be printable ASCII without whitespace, e.g. HTTP/sap.example.com.');
  }
  return value.includes('/') ? value : `HTTP/${value}`;
}

/** Resolve the effective SPN: explicit override wins, otherwise derive it from the base URL. */
export function resolveSpn(baseUrl: string, override?: string): string {
  return override ? normalizeSpn(override) : deriveSpn(baseUrl);
}

/**
 * Load the optional `kerberos` module.
 *
 * The specifier is computed so TypeScript and bundlers do not resolve it statically — the package
 * is optional and is legitimately absent in several supported packagings.
 */
async function loadKerberos(): Promise<KerberosModule> {
  const specifier = 'kerberos';
  try {
    const mod = (await import(specifier)) as KerberosModule & { default?: KerberosModule };
    const resolved = typeof mod.initializeClient === 'function' ? mod : mod.default;
    if (!resolved || typeof resolved.initializeClient !== 'function') {
      throw new Error('module does not expose initializeClient()');
    }
    return resolved;
  } catch (error) {
    throw new SpnegoUnavailableError(
      "SAP_SPNEGO=true requires the optional 'kerberos' native module, which could not be loaded on this host " +
        `(${process.platform}/${process.arch}). Install it with \`npm install kerberos\`. Prebuilt binaries exist for ` +
        'win32-x64, linux-x64/arm64/s390x (glibc 2.28+) and macOS; Windows on ARM, Alpine/musl images and the ' +
        '.mcpb Desktop bundle have no prebuild and need a source build (Linux also needs the krb5 development ' +
        'headers). Use SAP_COOKIE_FILE there instead.',
      error,
    );
  }
}

/**
 * Endpoint used for the SPNEGO logon exchange. The ADT discovery document is the cheapest
 * authenticated GET on the system and is already the startup auth preflight's probe, so a SPNEGO
 * failure surfaces at startup rather than on the first tool call.
 */
export const SPNEGO_BOOTSTRAP_PATH = '/sap/bc/adt/core/discovery';

/**
 * The credential headers alone, safe to merge into an existing request.
 *
 * Deliberately no `Accept`: in per-request mode these are merged into a request whose Accept was
 * already content-negotiated for its resource, and overwriting it would break that negotiation.
 */
export function spnegoAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Negotiate ${token}`,
    // Ask the ICM to open a security session so the logon returns MYSAPSSO2 + SAP_SESSIONID_*.
    'x-sap-security-session': 'create',
  };
}

/** Full header set for the standalone bootstrap logon request. */
export function spnegoLogonHeaders(token: string): Record<string, string> {
  return { Accept: '*/*', ...spnegoAuthHeaders(token) };
}

/**
 * Audit and classify a SPNEGO logon response.
 *
 * The transport stores the issued cookies; this only decides whether the logon counts as
 * established. A 401/403 here is a credential problem, not a resource problem, so it is reported
 * with the three things an operator can actually check.
 */
export function recordSpnegoLogon(status: number, ok: boolean, durationMs: number): void {
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: ok ? 'info' : 'warn',
    event: 'http_request',
    method: 'GET',
    path: SPNEGO_BOOTSTRAP_PATH,
    statusCode: status,
    durationMs,
    errorBody: 'SPNEGO logon',
  });

  if (status === 401 || status === 403) {
    throw new AdtApiError(
      `SPNEGO logon was rejected by SAP (HTTP ${status}). Verify that the ICM accepts SPNEGO, that the service ` +
        'principal name matches the SAP host, and that this host holds a valid Kerberos ticket (`klist`).',
      status,
      SPNEGO_BOOTSTRAP_PATH,
    );
  }
}

/**
 * Create the real token acquirer.
 *
 * No username or password is passed to `initializeClient`: on Windows that makes SSPI use the
 * caller's existing logon session, and on Linux/macOS GSSAPI uses the ambient credential cache.
 * Passing credentials here would be plain password auth wearing a Kerberos hat — that is what
 * SAP_USER / SAP_PASSWORD already are.
 */
export function createSpnegoTokenAcquirer(): SpnegoTokenAcquirer {
  return async (spn: string): Promise<string> => {
    const kerberos = await loadKerberos();
    let client: KerberosClient;
    try {
      client = await kerberos.initializeClient(spn);
    } catch (error) {
      throw new SpnegoAuthError(
        `SPNEGO: could not initialize a Kerberos client for '${spn}'. Check that the host has a valid ticket ` +
          '(`klist`) and that the SPN matches the SAP host — a load-balancer alias or CNAME usually needs the ' +
          'physical host name in SAP_SPNEGO_SPN.',
        error,
      );
    }
    let token: string | undefined;
    try {
      token = await client.step('');
    } catch (error) {
      throw new SpnegoAuthError(
        `SPNEGO: the Kerberos exchange for '${spn}' failed. Verify the ticket with \`klist\`, the SPN registration, ` +
          'and the clock skew between this host and the KDC.',
        error,
      );
    }
    if (!token) {
      throw new SpnegoAuthError(`SPNEGO: the Kerberos exchange for '${spn}' produced no token.`);
    }
    return token;
  };
}

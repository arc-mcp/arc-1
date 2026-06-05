/**
 * Stateless, signed OAuth `state` codec for the XSUAA callback proxy.
 *
 * ── Why this exists (issue #214) ──────────────────────────────────────
 * XSUAA echoes a literal `+` (not `%2B`) for any `state` value that
 * contains `+` when it redirects back to the OAuth client. Standard base64
 * `state` values (e.g. VS Code generates `randomBytes(16).toString('base64')`)
 * contain `+` ~50% of the time. The receiving client parses the callback
 * query string with `application/x-www-form-urlencoded` semantics, where
 * `+` decodes to a space, so the round-tripped `state` no longer matches the
 * value the client generated → "State does not match" → login fails.
 *
 * ARC-1 cannot influence what XSUAA emits, and XSUAA redirects DIRECTLY to
 * the client today (ARC-1 is not in the return path). The only fix is to
 * insert ARC-1 into the return path: send XSUAA a `state` that ARC-1
 * controls and that is immune to the `+` bug, then re-emit the client's
 * ORIGINAL `state` correctly when redirecting back to the client.
 *
 * ── How this codec is immune to the `+` bug ───────────────────────────
 * The token is `base64url(payload) + "." + base64url(sig)`. base64url uses
 * the alphabet `A-Za-z0-9-_` — no `+`, no `/`. The `.` separator is an
 * RFC 3986 unreserved character. So the entire token is URL-safe: XSUAA has
 * no `+` to mangle, and Express's `+`→space query decoding is a no-op on it.
 * The client's real `state` (which may contain `+`) rides INSIDE the opaque
 * base64url payload, so it survives the XSUAA round-trip untouched.
 *
 * ── Why stateless (vs an in-memory map) ───────────────────────────────
 * Mirrors the StatelessDcrClientStore design (PR #212): the token carries
 * its own payload + HMAC signature, so any instance with the same signing
 * key can validate it. No in-memory map → survives `cf restart`, cell
 * moves, and horizontal scale-out. The signing key is derived (HKDF-style)
 * from the same secret the DCR store uses, with a distinct domain-separation
 * label so the two key spaces never overlap.
 *
 * ── Upstream tracking / when this whole module can be deleted ──────────
 * This is a WORKAROUND for an XSUAA bug. It can be removed ONLY when XSUAA
 * stops emitting a literal `+` (emits `%2B`) for `state` on the authorize
 * redirect. Tracking:
 *   - arc-1 issue:      https://github.com/marianfoo/arc-1/issues/214
 *   - XSUAA root cause: no public SAP Note as of 2026-06; the `+`→literal
 *                       echo is the actual defect and the only thing whose
 *                       fix makes this module removable.
 *   - VS Code (client): https://github.com/microsoft/vscode/issues/314715
 *                       asks VS Code to use base64url `state`. If accepted it
 *                       fixes the VS Code SYMPTOM only — other MCP clients
 *                       (Cursor, claude.ai, Copilot Studio, …) still send
 *                       base64 `state` containing `+`, so the callback proxy
 *                       stays until the XSUAA-side fix lands. Do NOT delete
 *                       this module just because vscode#314715 closes.
 * To verify whether the XSUAA bug is gone, re-run the issue #214 spectrum
 * reproducer (see the issue thread) against the target XSUAA tenant.
 */

import crypto from 'node:crypto';

/** Domain-separation label for the HKDF-style key derivation. Bump the
 *  version suffix to invalidate every outstanding state token at once. */
const KDF_LABEL = 'arc1-oauth-state/v1';

/** Truncated HMAC length in bytes. 16 bytes (128 bits) is ample for a
 *  short-lived, single-use CSRF state token — matches StatelessDcrClientStore. */
const SIG_BYTES = 16;

/** Default lifetime of a state token. The OAuth authorize→callback hop is
 *  interactive (user logs in), so a few minutes covers it; XSUAA auth codes
 *  themselves expire on a similar horizon. */
const DEFAULT_TTL_SECONDS = 600; // 10 minutes

/** Compact JSON shape embedded in the signed token. Keys are terse to keep
 *  the resulting URL short. */
interface StatePayload {
  /** Schema version. */
  v: 1;
  /** The OAuth client's ORIGINAL `state` (may contain `+`; may be absent —
   *  `state` is optional per RFC 6749). */
  s?: string;
  /** The OAuth client's ORIGINAL `redirect_uri` — where ARC-1 sends the
   *  user after XSUAA returns to ARC-1's callback. */
  r: string;
  /** The DCR `client_id` that initiated the flow. Bound into the signed
   *  payload so the callback can verify the recovered `redirect_uri` is
   *  actually registered for THIS client — closing the authorization-code
   *  interception vector where an attacker substitutes their own
   *  `redirect_uri` on a victim's signed state (security audit 2026-06). */
  cid: string;
  /** Expiry, epoch seconds. */
  exp: number;
}

export type DecodeResult =
  | { kind: 'ok'; clientState?: string; clientRedirectUri: string; clientId: string }
  | { kind: 'error'; reason: 'malformed' | 'bad_signature' | 'invalid_payload' | 'expired' };

/**
 * Signs and verifies OAuth `state` tokens for the XSUAA callback proxy.
 */
export class OAuthStateCodec {
  private readonly hmacKey: Buffer;
  private readonly ttlSeconds: number;

  constructor(signingSecret: string, opts: { ttlSeconds?: number } = {}) {
    if (!signingSecret) {
      throw new Error('OAuthStateCodec requires a non-empty signingSecret');
    }
    // HKDF-style: derive a dedicated key from the shared secret + label.
    // The label domain-separates this key from the DCR client-id signing key.
    this.hmacKey = crypto.createHmac('sha256', signingSecret).update(KDF_LABEL).digest();
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  /**
   * Encode a URL-safe, signed state token. The returned value is safe to put
   * in a query string and round-trip through XSUAA (no `+`, no `/`).
   *
   * @param input.now Injectable clock (epoch ms) for deterministic tests.
   */
  encode(input: { clientState?: string; clientRedirectUri: string; clientId: string; now?: number }): string {
    const nowSec = Math.floor((input.now ?? Date.now()) / 1000);
    const payload: StatePayload = {
      v: 1,
      r: input.clientRedirectUri,
      cid: input.clientId,
      exp: nowSec + this.ttlSeconds,
    };
    if (input.clientState !== undefined) {
      payload.s = input.clientState;
    }
    const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${payloadB64}.${this.sign(payloadB64)}`;
  }

  /**
   * Decode and verify a state token. Never throws — returns a typed result.
   *
   * @param now Injectable clock (epoch ms) for deterministic tests.
   */
  decode(token: string, now: number = Date.now()): DecodeResult {
    if (typeof token !== 'string' || token.length === 0) {
      return { kind: 'error', reason: 'malformed' };
    }
    const dot = token.lastIndexOf('.');
    if (dot <= 0 || dot === token.length - 1) {
      return { kind: 'error', reason: 'malformed' };
    }
    const payloadB64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);

    if (!this.verifySignature(payloadB64, sigB64)) {
      return { kind: 'error', reason: 'bad_signature' };
    }

    const payload = parsePayload(payloadB64);
    if (!payload) {
      return { kind: 'error', reason: 'invalid_payload' };
    }

    if (payload.exp * 1000 <= now) {
      return { kind: 'error', reason: 'expired' };
    }

    return { kind: 'ok', clientState: payload.s, clientRedirectUri: payload.r, clientId: payload.cid };
  }

  private sign(payloadB64: string): string {
    const fullDigest = crypto.createHmac('sha256', this.hmacKey).update(payloadB64).digest();
    return fullDigest.subarray(0, SIG_BYTES).toString('base64url');
  }

  private verifySignature(payloadB64: string, sigB64: string): boolean {
    const expected = Buffer.from(this.sign(payloadB64), 'base64url');
    const actual = Buffer.from(sigB64, 'base64url');
    if (actual.length !== expected.length || actual.length !== SIG_BYTES) {
      return false;
    }
    return crypto.timingSafeEqual(actual, expected);
  }
}

/**
 * Parse a base64url payload back into a typed `StatePayload`. Returns
 * `undefined` on any failure (decode error, JSON parse error, schema mismatch).
 */
function parsePayload(payloadB64: string): StatePayload | undefined {
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const obj = JSON.parse(json) as Record<string, unknown>;
    if (obj.v !== 1) return undefined;
    if (typeof obj.r !== 'string' || obj.r.length === 0) return undefined;
    if (typeof obj.cid !== 'string' || obj.cid.length === 0) return undefined;
    if (typeof obj.exp !== 'number' || !Number.isFinite(obj.exp)) return undefined;
    if (obj.s !== undefined && typeof obj.s !== 'string') return undefined;
    return { v: 1, s: obj.s as string | undefined, r: obj.r, cid: obj.cid, exp: obj.exp };
  } catch {
    return undefined;
  }
}

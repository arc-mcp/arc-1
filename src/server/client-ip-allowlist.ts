/**
 * Optional inbound client-IP allowlist (`ARC1_ALLOWED_CLIENT_IPS`, issue #1220).
 *
 * SAP BTP Cloud Foundry sets `x-cf-true-client-ip` on every routed request to the address that
 * connected to the platform. Only that header is trusted — never `X-Forwarded-For`, `req.ip` or the
 * socket — and config validation refuses the setting outside Cloud Foundry, where a client could
 * forge it. Defense in depth in front of authentication, never a replacement for it.
 */

import { BlockList, isIP } from 'node:net';
import type { RequestHandler } from 'express';
import { logger } from './logger.js';

export const CLIENT_IP_HEADER = 'x-cf-true-client-ip';
/** The longest textual IPv6 address is 45 characters; anything longer is not an address. */
const MAX_AUDITED_HEADER_LENGTH = 64;

function addEntry(list: BlockList, entry: string, label: string): void {
  const invalid = (why: string) => new Error(`${label}: invalid entry '${entry}' (${why}).`);
  if (entry.includes('%')) throw invalid('zone ids are not supported');
  const parts = entry.split('/');
  if (parts.length > 2) throw invalid('expected an address or address/prefix');
  const family = isIP(parts[0]!);
  if (family === 0) throw invalid('not an IPv4 or IPv6 address');
  const maxPrefix = family === 4 ? 32 : 128;
  let prefix = maxPrefix;
  if (parts.length === 2) {
    if (!/^(0|[1-9]\d{0,2})$/.test(parts[1]!) || Number(parts[1]) > maxPrefix) {
      throw invalid(`prefix must be an integer from 0 to ${maxPrefix}`);
    }
    prefix = Number(parts[1]);
  }
  list.addSubnet(parts[0]!, prefix, family === 4 ? 'ipv4' : 'ipv6');
}

/** Parse the comma-separated list. Blank = off; an empty or invalid entry throws, naming it. */
export function parseAllowedClientIps(raw: string, label = 'ARC1_ALLOWED_CLIENT_IPS'): string[] {
  if (raw.trim() === '') return [];
  const fields = raw.split(',');
  return fields.map((field, i) => {
    const entry = field.trim();
    if (entry === '') {
      throw new Error(
        `${label} entry #${i + 1} of ${fields.length} is empty: stray commas are not allowed. Set ${label} to an empty value to turn the allowlist off.`,
      );
    }
    addEntry(new BlockList(), entry, label);
    return entry;
  });
}

type RejectReason = 'not_allowed' | 'missing_header' | 'invalid_header';

/** Express middleware: 403 unless the platform-set client address is in `entries`. `/health` is exempt. */
export function createClientIpAllowlist(entries: string[]): RequestHandler {
  const list = new BlockList();
  for (const entry of entries) addEntry(list, entry, 'ARC1_ALLOWED_CLIENT_IPS');
  return (req, res, next) => {
    // CF's http health check calls the container directly, without the header.
    if (req.path === '/health') return next();
    const raw = req.headers[CLIENT_IP_HEADER];
    // Node joins a repeated header with ", ", which isIP rejects; isIP accepts zone ids, so refuse '%'.
    const value = typeof raw === 'string' && !raw.includes('%') ? raw : undefined;
    const family = value === undefined ? 0 : isIP(value);
    let reason: RejectReason;
    if (raw === undefined) reason = 'missing_header';
    else if (value === undefined || family === 0) reason = 'invalid_header';
    else if (!list.check(value, family === 4 ? 'ipv4' : 'ipv6')) reason = 'not_allowed';
    else return next();
    logger.emitAudit({
      timestamp: new Date().toISOString(),
      level: 'warn',
      event: 'client_ip_rejected',
      reason,
      ...(raw === undefined ? {} : { clientIp: String(raw).slice(0, MAX_AUDITED_HEADER_LENGTH) }),
      method: req.method,
      path: req.path,
    });
    res.status(403).json({ error: 'Forbidden' });
  };
}

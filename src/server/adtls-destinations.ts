/**
 * Reader for SAP ADT-for-VS-Code's `~/.adtls/destinations.json` (issue #442).
 *
 * The ADT extension stores connection profiles in a shared destinations file. ARC-1 can reuse the
 * *non-secret* fields of a named destination so users don't retype URL/client/language/user they
 * already configured for VS Code/Cursor/Eclipse.
 *
 * Hard limitation: the file NEVER contains a password. adt-ls does not persist the create-time
 * password (it lives in the editor's secret store) — verified live + in adt-ls behavior, see
 * research/issues/442-dedup-adtls-destinations.md. So `SAP_PASSWORD` is still required separately,
 * and `reentranceTicket`/`oauth`/`sso` destinations only yield a `systemUrl` (ARC-1's MCP server
 * has no browser reentrance flow). This reader is read-only — it never writes the shared file.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Non-secret connection fields ARC-1 can seed from a destination. */
export interface AdtlsDestinationFields {
  url?: string;
  username?: string;
  client?: string;
  language?: string;
}

interface RawDestination {
  id?: string;
  properties?: {
    systemUrl?: string;
    user?: string;
    client?: string;
    language?: string;
  };
}

/** Default path to the ADT-for-VSC destinations store. */
export function defaultDestinationsPath(): string {
  return join(homedir(), '.adtls', 'destinations.json');
}

/**
 * Resolve a named destination's non-secret connection fields. Fail-soft: returns `undefined` (never
 * throws) on a missing/unreadable/malformed file or an unknown id, so config resolution falls through
 * to env/defaults. `warn` is called with a human-readable reason in those cases.
 */
export function loadAdtlsDestination(
  destinationId: string,
  filePath: string,
  warn: (msg: string) => void,
): AdtlsDestinationFields | undefined {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    warn(`SAP_ADTLS_DESTINATION='${destinationId}' set but '${filePath}' could not be read — ignoring`);
    return undefined;
  }

  let parsed: { destinations?: RawDestination[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    warn(`'${filePath}' is not valid JSON — ignoring SAP_ADTLS_DESTINATION`);
    return undefined;
  }

  const match = parsed.destinations?.find((d) => d.id === destinationId);
  if (!match) {
    const known = (parsed.destinations ?? []).map((d) => d.id).filter(Boolean);
    warn(
      `SAP_ADTLS_DESTINATION='${destinationId}' not found in '${filePath}'` +
        (known.length ? ` (known: ${known.join(', ')})` : ' (file has no destinations)'),
    );
    return undefined;
  }

  const p = match.properties ?? {};
  // ponytail: only the four non-secret fields; password is intentionally never read.
  return { url: p.systemUrl, username: p.user, client: p.client, language: p.language };
}

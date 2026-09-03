/**
 * Canonical ARC-1 data-source identity.
 *
 * This is the SINGLE normalizer for every value that can take part in a data-source policy
 * decision: configuration entries, caller-supplied roots, SQL parser results, repository-search
 * results, URI-decoded DDLS identities, dependency-graph node names and aliases, replacement-object
 * annotations, and internal registry entries. Two different normalizers would let the name that is
 * checked drift from the name that is executed, which is the whole class of bug this module exists
 * to make impossible.
 *
 * Deliberately dependency-free (besides `node:crypto`) so `src/server/config.ts` can validate
 * startup configuration without pulling the ABAP parser into process start.
 */

import { createHash } from 'node:crypto';

/** Upper bound on a canonical technical name. */
export const MAX_DATA_SOURCE_NAME_LENGTH = 128;

/**
 * ASCII whitespace only — space, tab, LF, VT, FF, CR.
 *
 * `String.prototype.trim()` also strips Unicode whitespace (U+00A0, U+3000, U+2028, …). That is
 * exactly what we must NOT do: trimming a non-ASCII pad would let `"　USR02"` canonicalize to
 * `USR02`, i.e. two visually different configuration values collapsing to one identity. Unicode
 * whitespace is not trimmed here, so it survives into the ASCII check below and is rejected.
 */
const ASCII_TRIM = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;

/** The complete accepted character set, tested against the RAW value before any case folding. */
const ASCII_ALLOWED = /^[A-Za-z0-9_/$]+$/;

/** At least one letter or digit: `/`, `$`, `_`, and combinations of them are not names. */
const HAS_ALPHANUMERIC = /[A-Za-z0-9]/;

/** Longest offending token echoed back in a startup error. */
const MAX_ECHOED_TOKEN = 64;

/** A value could not be canonicalized into an exact ABAP data-source identity. */
export class DataSourceNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSourceNameError';
  }
}

/** Strip only ASCII surrounding whitespace. Unicode whitespace is intentionally preserved. */
export function asciiTrim(raw: string): string {
  return raw.replace(ASCII_TRIM, '');
}

/** Echo an operator's bad token without dumping unbounded or unrelated content. */
function echoToken(raw: string): string {
  const flat = raw.replace(/[\r\n\t]/g, ' ');
  const clipped = flat.length > MAX_ECHOED_TOKEN ? `${flat.slice(0, MAX_ECHOED_TOKEN)}…` : flat;
  return JSON.stringify(clipped);
}

/**
 * Uppercase ASCII `a-z` and nothing else.
 *
 * `String.prototype.toUpperCase()` is Unicode-aware: `ſ` (U+017F) folds to `S`, `ß` to `SS`, and the
 * `ﬀ` ligature to `FF`. Applying it before validation makes a validator that claims to accept only
 * `A-Z0-9_/$` silently accept non-ASCII input. The ASCII gate above already rejects those inputs, so
 * this mapping is defence in depth: it stays correct even if the checks are ever reordered.
 */
function upperCaseAscii(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    out += code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : value[i];
  }
  return out;
}

/**
 * Canonicalize one exact ABAP data-source identity, or throw.
 *
 * Order matters and is part of the contract: ASCII-trim, then validate the RAW value, then fold
 * case. Nothing is ever silently removed — a name that would need character stripping is rejected.
 *
 * @param raw   the value as supplied by configuration, a caller, or SAP metadata
 * @param what  short label used in the error message (for example `SAP_BLOCKED_DATA_SOURCES entry #2`)
 */
export function canonicalDataSourceName(raw: string, what = 'data-source name'): string {
  const trimmed = asciiTrim(raw);
  if (trimmed.length === 0) {
    throw new DataSourceNameError(`${what} is empty`);
  }
  if (trimmed.length > MAX_DATA_SOURCE_NAME_LENGTH) {
    throw new DataSourceNameError(
      `${what} exceeds the ${MAX_DATA_SOURCE_NAME_LENGTH}-character limit (${trimmed.length} characters)`,
    );
  }
  if (!ASCII_ALLOWED.test(trimmed)) {
    throw new DataSourceNameError(
      `${what} ${echoToken(trimmed)} is not an exact technical name: only ASCII A-Z, a-z, 0-9, _, / and $ are allowed ` +
        '(no wildcards, type prefixes, negation, quoting, regex syntax, or non-ASCII characters)',
    );
  }
  if (!HAS_ALPHANUMERIC.test(trimmed)) {
    throw new DataSourceNameError(`${what} ${echoToken(trimmed)} needs at least one ASCII letter or digit`);
  }
  return upperCaseAscii(trimmed);
}

/** Canonicalize a list, dropping exact duplicates while keeping first-occurrence order. */
export function canonicalDataSourceNames(raws: readonly string[], what = 'data-source name'): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of raws) {
    const name = canonicalDataSourceName(raw, what);
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Parse the `SAP_BLOCKED_DATA_SOURCES` CSV contract.
 *
 * - unset (caller passes `undefined`), empty, or ASCII-whitespace-only → off (empty list);
 * - once the ASCII-trimmed value is non-empty, EVERY comma-separated field is mandatory, so
 *   `,` `,,,` `,USR02` `USR02,` and `USR02,,PA0002` are startup errors rather than silently dropped;
 * - each field is canonicalized with {@link canonicalDataSourceName};
 * - duplicates collapse while preserving first-occurrence order.
 *
 * A value consisting only of NON-ASCII whitespace (for example U+3000) is deliberately an error, not
 * "off": it is indistinguishable from a corrupted deployment value, and only ASCII blanks are the
 * documented off switch.
 */
export function parseBlockedDataSourcesCsv(raw: string, sourceLabel = 'SAP_BLOCKED_DATA_SOURCES'): string[] {
  if (asciiTrim(raw).length === 0) return [];

  const fields = raw.split(',');
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const position = `${sourceLabel} entry #${i + 1} of ${fields.length}`;
    if (asciiTrim(fields[i]!).length === 0) {
      throw new DataSourceNameError(
        `${position} is empty: leading, trailing, repeated, and separator-only commas are not allowed. ` +
          `Set ${sourceLabel} to an empty value to turn the policy off.`,
      );
    }
    const name = canonicalDataSourceName(fields[i]!, position);
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Deterministic policy fingerprint: SHA-256 over `data-source-blocklist:v1\n` followed by the
 * sorted, unique, canonical names joined with `\n`.
 *
 * Order- and duplicate-independent, so two deployments with the same effective policy produce the
 * same value. This is a configuration-drift and correlation identifier ONLY — it is unsalted by
 * design, the candidate name space is small and guessable, and it must never be described as
 * protecting the contents of the list. Exact values live on administrator-only surfaces.
 */
export function dataSourcePolicyFingerprint(names: readonly string[]): string {
  const canonical = [...new Set(names)].sort();
  return createHash('sha256')
    .update(`data-source-blocklist:v1\n${canonical.join('\n')}`)
    .digest('hex');
}

/** Short human-facing form of {@link dataSourcePolicyFingerprint} for startup logs. */
export function shortPolicyFingerprint(names: readonly string[]): string {
  return dataSourcePolicyFingerprint(names).slice(0, 12);
}

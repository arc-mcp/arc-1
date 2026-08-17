/** Security boundary for caller- or response-provided SAP ADT request paths. */

export const ADT_ROOT_PATH = '/sap/bc/adt/';

const VALIDATION_ORIGIN = 'https://arc1.invalid';
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Return a canonical host-relative ADT path, or `null` when URL parsing/proxy decoding could change
 * its authority or path hierarchy. Query strings are retained, but only the raw query delimiter is
 * accepted; fragments, encoded separators, dot segments, controls, and nested encodings are not.
 */
export function canonicalHostRelativeAdtPath(rawPath: string, requiredPrefix = ADT_ROOT_PATH): string | null {
  if (!rawPath || rawPath !== rawPath.trim() || !rawPath.startsWith('/') || rawPath.startsWith('//')) return null;
  if (hasControlCharacter(rawPath) || rawPath.includes('\\') || rawPath.includes('#')) return null;

  const queryIndex = rawPath.indexOf('?');
  const pathname = queryIndex >= 0 ? rawPath.slice(0, queryIndex) : rawPath;
  let decodedPathname = pathname;

  // Repeated decoding detects double-encoded dot segments and separators before any HTTP/proxy
  // layer gets a chance to interpret them. Eight layers is deliberately generous; a still-changing
  // value after that is rejected as non-canonical rather than guessed at.
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      !decodedPathname.startsWith('/') ||
      decodedPathname.startsWith('//') ||
      hasControlCharacter(decodedPathname) ||
      decodedPathname.includes('\\') ||
      decodedPathname.includes('#') ||
      decodedPathname.includes('?') ||
      ENCODED_SEPARATOR.test(decodedPathname) ||
      decodedPathname.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      return null;
    }

    let next: string;
    try {
      next = decodeURIComponent(decodedPathname);
    } catch {
      return null;
    }
    if (next === decodedPathname) break;
    if (depth === 7) return null;
    decodedPathname = next;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawPath, VALIDATION_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== VALIDATION_ORIGIN || parsed.hash || parsed.pathname !== pathname) return null;
  if (!parsed.pathname.startsWith(requiredPrefix)) return null;
  return `${parsed.pathname}${parsed.search}`;
}

export function isCanonicalHostRelativeAdtPath(rawPath: string, requiredPrefix = ADT_ROOT_PATH): boolean {
  return canonicalHostRelativeAdtPath(rawPath, requiredPrefix) !== null;
}

/** Assert without echoing the attacker-controlled path into logs or client errors. */
export function assertCanonicalHostRelativeAdtPath(rawPath: string, requiredPrefix = ADT_ROOT_PATH): string {
  const canonical = canonicalHostRelativeAdtPath(rawPath, requiredPrefix);
  if (!canonical) {
    throw new Error(`Path must be a canonical host-relative ADT path under ${requiredPrefix}`);
  }
  return canonical;
}

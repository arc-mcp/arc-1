/**
 * Enhancement includes: the generated `<name>===…=E` include that holds a source-code plug-in.
 *
 * On releases where ADT serves neither the `enhoxhh` route nor the include's `/source/main`
 * (observed on SAP_BASIS 750 SP23: both answer HTTP 500), the include's revision feed still
 * lists its active version and serves that content. This module only derives the include name
 * and reads one revision; the callers decide when a fallback is appropriate.
 */
import type { AdtClient } from './client.js';
import { canonicalRevisionSourcePath } from './path-safety.js';
import type { RevisionInfo } from './types.js';

/** `ENHNAME` is CHAR 30; the kernel pads it with `=` and appends `E` for the include name. */
const ENHANCEMENT_NAME_LENGTH = 30;
/** Padded names only: a 30-character implementation name would produce an ordinary-looking include. */
const ENHANCEMENT_INCLUDE_RE = /^[A-Z0-9_/]+=+E$/;
/** Name of the enhancement include that stores the plug-in of an enhancement implementation. */
export function enhancementIncludeName(enhancementName: string): string {
  const name = enhancementName.trim().toUpperCase();
  return `${name.padEnd(ENHANCEMENT_NAME_LENGTH, '=')}E`;
}

/** True for `<name padded with '=' to 30 characters>E`; other 31-character include names stay ordinary. */
export function isEnhancementIncludeName(includeName: string): boolean {
  const name = includeName.trim().toUpperCase();
  return name.length === ENHANCEMENT_NAME_LENGTH + 1 && ENHANCEMENT_INCLUDE_RE.test(name);
}

export interface EnhancementIncludeRevision {
  include: string;
  revision: Pick<RevisionInfo, 'id' | 'author' | 'timestamp' | 'transport' | 'versionTitle'>;
  source: string;
}

/**
 * Read one verified active content link for this include. Atom ids may be URNs; feed order does
 * not distinguish history from active source or drafts. SAP errors propagate so the caller can
 * decide whether the original ENHO or include failure is the better message.
 */
export async function readEnhancementIncludeRevision(
  client: Pick<AdtClient, 'getRevisions' | 'getRevisionSource'>,
  includeName: string,
): Promise<EnhancementIncludeRevision | undefined> {
  const feed = await client.getRevisions('INCL', includeName);
  const active = feed.revisions.filter((entry) => /\/versions\/[^/]+\/00000\/content$/i.test(entry.uri));
  if (active.length !== 1) return undefined;
  const revision = active[0];
  const path = canonicalRevisionSourcePath(revision.uri);
  const name = path?.match(/^\/sap\/bc\/adt\/programs\/includes\/([^/]+)\/source\/main\/versions\//i)?.[1];
  if (!path || !name || decodeURIComponent(name).toUpperCase() !== includeName.toUpperCase()) return undefined;
  const source = await client.getRevisionSource(path);
  const { id, author, timestamp, transport, versionTitle } = revision;
  return {
    include: includeName,
    revision: { id, author, timestamp, ...(transport ? { transport } : {}), ...(versionTitle ? { versionTitle } : {}) },
    source,
  };
}

/** One-line provenance note for callers that return plain source text. */
export function describeEnhancementIncludeRevision(read: EnhancementIncludeRevision): string {
  const transport = read.revision.transport ? `, transport ${read.revision.transport}` : '';
  return `Source read from active revision ${read.revision.id} (${read.revision.timestamp}${transport}) of enhancement include ${read.include}; the direct include read failed.`;
}

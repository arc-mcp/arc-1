/**
 * Enhancement includes: the generated `<name>===…=E` include that holds a source-code plug-in.
 *
 * On releases where ADT serves neither the `enhoxhh` route nor the include's `/source/main`
 * (observed on SAP_BASIS 750 SP23: both answer HTTP 500), the include's revision feed still
 * lists its active version and serves that content. This module only derives the include name
 * and reads one revision; the callers decide when a fallback is appropriate.
 */
import type { AdtClient } from './client.js';
import type { AdtRequestOptions } from './http-deadline.js';
import { findIncludeStatements } from './include-expansion.js';
import { canonicalRevisionSourcePath } from './path-safety.js';
import { RELATION_NAME } from './relation-objects.js';
import { RevisionHistoryError } from './revision-feed.js';
import type { RevisionInfo } from './types.js';

/** `ENHNAME` is CHAR 30; the kernel pads it with `=` and appends `E` for the include name. */
const ENHANCEMENT_NAME_LENGTH = 30;
/** Padded names only: a 30-character implementation name would produce an ordinary-looking include. */
const ENHANCEMENT_INCLUDE_RE = /^[A-Z0-9_/]+=+E$/;
/** The active version is listed as revision `00000`; other ids are historical versions. */
const ACTIVE_REVISION_ID = '00000';

/** Name of the enhancement include that stores the plug-in of an enhancement implementation. */
export function enhancementIncludeName(enhancementName: string): string {
  const name = enhancementName.trim().toUpperCase();
  if (name.length > ENHANCEMENT_NAME_LENGTH || !RELATION_NAME.test(name)) {
    throw new RevisionHistoryError();
  }
  return `${name.padEnd(ENHANCEMENT_NAME_LENGTH, '=')}E`;
}

/** True for `<name padded with '=' to 30 characters>E`; other 31-character include names stay ordinary. */
export function isEnhancementIncludeName(includeName: string): boolean {
  const name = includeName.trim().toUpperCase();
  return name.length === ENHANCEMENT_NAME_LENGTH + 1 && ENHANCEMENT_INCLUDE_RE.test(name);
}

export interface EnhancementIncludeRevision {
  include: string;
  revision: Pick<RevisionInfo, 'id' | 'author' | 'timestamp' | 'transport' | 'versionTitle' | 'uri'>;
  source: string;
}

/**
 * Read the active revision of an enhancement include through the revisions feed. Returns
 * `undefined` when the feed lists no active revision. SAP errors propagate unchanged so the caller can
 * decide whether the original ENHO or include failure is the better message.
 */
export async function readEnhancementIncludeRevision(
  client: Pick<AdtClient, 'getRevisions' | 'getRevisionSource'>,
  includeName: string,
  request?: AdtRequestOptions & { version?: 'active' | 'inactive' },
): Promise<EnhancementIncludeRevision | undefined> {
  if (request?.version === 'inactive') return undefined;
  const include = includeName.toUpperCase();
  // Parent E and discovered method EMnnn only. Even a metadata-derived name must be checked at the sink.
  const parent = include.slice(0, 31);
  const owner = parent.slice(0, 30).replace(/=+$/, '');
  if (
    ![31, 35].includes(include.length) ||
    parent !== enhancementIncludeName(owner) ||
    (include.length === 35 && !/^M\d{3}$/.test(include.slice(31)))
  )
    throw new RevisionHistoryError();
  const feed = await client.getRevisions('INCL', includeName, {}, request);
  if (feed.object.type !== 'REPS' || feed.object.name.toUpperCase() !== include) throw new RevisionHistoryError();
  const active = feed.revisions.filter((entry) => entry.id === ACTIVE_REVISION_ID);
  if (active.length > 1) throw new RevisionHistoryError();
  const revision = active[0];
  if (!revision) return undefined;
  const canonical = canonicalRevisionSourcePath(revision.uri);
  const prefix = `/sap/bc/adt/programs/includes/${encodeURIComponent(include)}/source/main/versions/`;
  if (
    !canonical?.toUpperCase().startsWith(prefix.toUpperCase()) ||
    !/^\d{14}\/00000\/content$/.test(canonical.slice(prefix.length))
  )
    throw new RevisionHistoryError();
  const source = await client.getRevisionSource(canonical, request);
  const { id, author, timestamp, transport, versionTitle } = revision;
  return {
    include: includeName,
    revision: {
      id,
      author,
      timestamp,
      uri: canonical,
      ...(transport ? { transport } : {}),
      ...(versionTitle ? { versionTitle } : {}),
    },
    source,
  };
}

/** Follow only actual INCLUDE statements bound to this generated enhancement owner; never guess EM001. */
export function enhancementMethodIncludes(source: string, parentInclude: string): string[] {
  const parent = parentInclude.toUpperCase();
  // Authored INCLUDE grammar excludes '=' in generated names. Substitute collision-free identifiers
  // for parsing only; comments, literals and non-INCLUDE statements still stay excluded.
  const names = new Map<string, string>();
  const upperSource = source.toUpperCase();
  let index = 0;
  const escapedParent = parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const scanned = source.replace(new RegExp(`${escapedParent}M\\d{3}`, 'gi'), (name) => {
    if (name.length !== 35 || !name.toUpperCase().startsWith(parent)) return name;
    let token: string;
    do {
      token = `ZARC1_GENERATED_CHILD_${index++}`;
    } while (upperSource.includes(token));
    names.set(token, name.toUpperCase());
    return token;
  });
  return [...new Set(findIncludeStatements(scanned).flatMap((item) => names.get(item.name.toUpperCase()) ?? []))];
}

/** One-line provenance note for callers that return plain source text. */
export function describeEnhancementIncludeRevision(read: EnhancementIncludeRevision): string {
  const transport = read.revision.transport ? `, transport ${read.revision.transport}` : '';
  return `Source read from revision ${read.revision.id} (${read.revision.timestamp}${transport}) of enhancement include ${read.include}; the direct include read is not served on this SAP release.`;
}

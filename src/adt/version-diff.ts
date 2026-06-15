/**
 * Server-side single-system version diff — backs `SAPRead action="diff"`.
 *
 * Resolves two source refs (active / inactive / revision id / revision URI) to RAW
 * source via the client's public readers, then returns only the unified-diff text:
 * the LLM gets hunks (~0.5K tokens) instead of two full sources. ADT exposes no diff
 * endpoint, so the diff is computed locally (see ./source-diff). Single-system,
 * two-source only — cross-system comparison lives in a skill, not here.
 *
 * Kept out of client.ts (which is being shrunk, file-size ratchet) — these are free
 * functions over the client's public, already-safety-guarded source readers.
 */
import type { AdtClient, SourceReadOptions } from './client.js';
import { AdtApiError } from './errors.js';
import { checkOperation, OperationType } from './safety.js';
import { type UnifiedDiffResult, unifiedDiff } from './source-diff.js';
import type { RevisionInfo } from './types.js';

/** One side of a version diff: `"active"`, `"inactive"`, a revision id, or a `/sap/bc/adt/` URI. */
export type DiffRef = string;

/** Object types whose source diff is supported (plain-text `/source/main` endpoints). Local — only used in the rejection message; the switch in fetchSourceByType is the authoritative gate. */
const DIFF_SUPPORTED_TYPES = [
  'PROG',
  'CLAS',
  'INTF',
  'FUNC',
  'FUGR',
  'INCL',
  'DDLS',
  'DCLS',
  'BDEF',
  'SRVD',
  'DDLX',
  'TABL',
] as const;

interface DiffOptions {
  include?: string;
  group?: string;
}

/**
 * Diff two source versions of one object on a single system.
 * `from`/`to` accept `active`, `inactive`, a revision id (from the VERSIONS feed),
 * or a full revision URI (`/sap/bc/adt/...`).
 */
export async function getVersionDiff(
  client: AdtClient,
  type: string,
  name: string,
  from: DiffRef,
  to: DiffRef,
  opts: DiffOptions = {},
): Promise<UnifiedDiffResult> {
  checkOperation(client.safety, OperationType.Read, 'GetVersionDiff');

  // Resolve the FUNC group ONCE up front so both the revision feed and the active/inactive
  // reads agree — otherwise a bare-id FUNC diff hits getRevisions with no group and throws.
  let group = opts.group;
  if (type === 'FUNC' && !group) {
    group = (await client.resolveFunctionGroup(name)) ?? undefined;
    if (!group) {
      throw new AdtApiError(`Cannot resolve function group for FUNC "${name}". Pass group=<function group>.`, 400, '');
    }
  }
  const resolved: DiffOptions = { include: opts.include, group };

  // Fetch the revisions feed at most once, and only if a bare id needs resolving.
  // Cache the promise (not the result) so concurrent from/to id lookups share one fetch.
  let revListPromise: Promise<RevisionInfo[]> | undefined;
  const revList = (): Promise<RevisionInfo[]> => {
    revListPromise ??= client.getRevisions(type, name, resolved).then((r) => r.revisions);
    return revListPromise;
  };

  const [fromSrc, toSrc] = await Promise.all([
    resolveDiffSource(client, type, name, from, resolved, revList),
    resolveDiffSource(client, type, name, to, resolved, revList),
  ]);

  return unifiedDiff(fromSrc, toSrc, `${name} (${from})`, `${name} (${to})`);
}

/** Resolve one diff ref to raw source text. */
async function resolveDiffSource(
  client: AdtClient,
  type: string,
  name: string,
  ref: DiffRef,
  opts: DiffOptions,
  revList: () => Promise<RevisionInfo[]>,
): Promise<string> {
  if (ref === 'active' || ref === 'inactive') {
    return fetchSourceByType(client, type, name, { version: ref, include: opts.include, group: opts.group });
  }
  if (ref.startsWith('/sap/bc/adt/')) {
    return client.getRevisionSource(ref);
  }
  // Bare revision id → resolve via the feed. Some diff-supported types (FUGR, DDLX) have no
  // revisions endpoint; getRevisions throws a plain Error for those — turn it into clear guidance.
  // Real HTTP failures surface as AdtApiError and propagate unchanged.
  let revs: RevisionInfo[];
  try {
    revs = await revList();
  } catch (err) {
    if (err instanceof AdtApiError) throw err;
    throw new AdtApiError(
      `Revision-id diff is not available for type ${type}. Use "active"/"inactive", or pass a full /sap/bc/adt/ revision URI.`,
      400,
      '',
    );
  }
  const match = revs.find((r) => r.id === ref);
  if (!match) {
    const available = revs.map((r) => r.id).join(', ') || '(none)';
    throw new AdtApiError(
      `Revision "${ref}" not found for ${type} ${name}. Available revision ids: ${available}. ` +
        'Use "active", "inactive", a revision id from SAPRead(type="VERSIONS"), or a full /sap/bc/adt/ URI.',
      404,
      '',
    );
  }
  return client.getRevisionSource(match.uri);
}

/** Fetch raw active/inactive source for a source-bearing type via its existing reader. */
async function fetchSourceByType(
  client: AdtClient,
  type: string,
  name: string,
  opts: { version?: 'active' | 'inactive'; include?: string; group?: string },
): Promise<string> {
  const base: SourceReadOptions = { version: opts.version };
  switch (type) {
    case 'PROG':
      return (await client.getProgram(name, base)).source;
    case 'CLAS':
      // Non-main includes must use the RAW reader: getClass(name, include) prepends a
      // "=== include ===" marker, but revision sources are raw — mixing them is a false diff.
      return opts.include && opts.include.toLowerCase() !== 'main'
        ? (await client.getClassInclude(name, opts.include, base)).source
        : (await client.getClass(name, undefined, base)).source;
    case 'INTF':
      return (await client.getInterface(name, base)).source;
    case 'FUNC': {
      // Group is pre-resolved in getVersionDiff (so the revision feed and this read agree).
      if (!opts.group) {
        throw new AdtApiError(
          `Cannot resolve function group for FUNC "${name}". Pass group=<function group>.`,
          400,
          '',
        );
      }
      return (await client.getFunction(opts.group, name, base)).source;
    }
    case 'FUGR':
      return (await client.getFunctionGroupSource(name, base)).source;
    case 'INCL':
      return (await client.getInclude(name, base)).source;
    case 'DDLS':
      return (await client.getDdls(name, base)).source;
    case 'DCLS':
      return (await client.getDcl(name, base)).source;
    case 'BDEF':
      return (await client.getBdef(name, base)).source;
    case 'SRVD':
      return (await client.getSrvd(name, base)).source;
    case 'DDLX':
      return (await client.getDdlx(name, base)).source;
    case 'TABL':
      // /ddic/tables|structures/<name>/source/main returns DDL text ("define table …") — diffable.
      return (await client.getTabl(name, base)).source;
    default:
      throw new AdtApiError(
        `Version diff is not supported for type "${type}". Supported: ${DIFF_SUPPORTED_TYPES.join(', ')}.`,
        400,
        '',
      );
  }
}

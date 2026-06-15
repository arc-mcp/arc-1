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
import { unifiedDiff } from './source-diff.js';
import type { RevisionInfo } from './types.js';

/** One side of a version diff: `"active"`, `"inactive"`, a revision id, or a `/sap/bc/adt/` URI. */
export type DiffRef = string;

export interface VersionDiffResult {
  type: string;
  name: string;
  from: string;
  to: string;
  /** True when both sides are byte-equal (after newline normalization). */
  identical: boolean;
  /** Unified-diff text; empty when identical. */
  diff: string;
  added: number;
  removed: number;
}

/** Object types whose source diff is supported (plain-text `/source/main` endpoints). */
export const DIFF_SUPPORTED_TYPES = [
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
): Promise<VersionDiffResult> {
  checkOperation(client.safety, OperationType.Read, 'GetVersionDiff');

  // Fetch the revisions feed at most once, and only if a bare id needs resolving.
  // Cache the promise (not the result) so concurrent from/to id lookups share one fetch.
  let revListPromise: Promise<RevisionInfo[]> | undefined;
  const revList = (): Promise<RevisionInfo[]> => {
    revListPromise ??= client.getRevisions(type, name, opts).then((r) => r.revisions);
    return revListPromise;
  };

  const [fromSrc, toSrc] = await Promise.all([
    resolveDiffSource(client, type, name, from, opts, revList),
    resolveDiffSource(client, type, name, to, opts, revList),
  ]);

  const result = unifiedDiff(fromSrc, toSrc, `${name} (${from})`, `${name} (${to})`);
  return { type, name, from: String(from), to: String(to), ...result };
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
  const revs = await revList();
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
      return (await client.getClass(name, opts.include, base)).source;
    case 'INTF':
      return (await client.getInterface(name, base)).source;
    case 'FUNC': {
      const group = opts.group ?? (await client.resolveFunctionGroup(name)) ?? undefined;
      if (!group) {
        throw new AdtApiError(
          `Cannot resolve function group for FUNC "${name}". Pass group=<function group>.`,
          400,
          '',
        );
      }
      return (await client.getFunction(group, name, base)).source;
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
    default:
      throw new AdtApiError(
        `Version diff is not supported for type "${type}". Supported: ${DIFF_SUPPORTED_TYPES.join(', ')}.`,
        400,
        '',
      );
  }
}

/**
 * Source-write previews (`dryRun: true`): run an action up to its final source and its pre-write
 * checks, then return a unified diff, the current `sourceHash` and the `resultHash` of the exact
 * bytes the write would send, instead of locking or writing. Repeating the call without dryRun and
 * with both hashes (`expectedSourceHash`, `expectedResultHash`) writes exactly the previewed change:
 * the write rebuilds it under the lock and refuses when either the source or the result differs.
 */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError, isNotFoundError } from '../../adt/errors.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { unifiedDiff } from '../../adt/source-diff.js';
import { assertResultHash, assertSourceHash, sourceHash } from '../../adt/source-precondition.js';
import { isActionDenied } from '../../server/deny-actions.js';
import { canonicalTablType } from '../object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';
import type { SapWriteContext } from './context.js';

/** Preview bounds (invariant I5): input size, diff work, and displayed diff. */
const MAX_PREVIEW_SOURCE_BYTES = 1024 * 1024;
const DIFF_WORK = { timeout: 100, maxEditLength: 20_000 };
const MAX_DIFF_LINES = 1000;
const MAX_DIFF_BYTES = 64 * 1024;

export const isDryRun = (args: Record<string, unknown>): boolean => args.dryRun === true;

/** A preview reads like SAPRead; only a real write passes the existing-object package gate. */
export async function enforcePackageUnlessDryRun(ctx: SapWriteContext): Promise<string | undefined> {
  return isDryRun(ctx.args) ? undefined : ctx.enforcePackageForExistingObject();
}

/**
 * The same uncached editable read as SAPRead(format="editable") and the locked write. The diff
 * shows the source, so a server that denies the SAPRead of this type also denies the preview.
 */
export async function readEditableForPreview(
  client: AdtClient,
  type: string,
  url: string,
  expectedSourceHash: string | undefined,
): Promise<string> {
  const readType = canonicalTablType(type);
  if (isActionDenied('SAPRead', readType, client.safety.denyActions ?? [])) {
    throw new AdtSafetyError(
      `dryRun shows the source like SAPRead(type="${readType}"), which SAP_DENY_ACTIONS denies on this server. No write was made.`,
    );
  }
  checkOperation(client.safety, OperationType.Read, 'GetSource');
  const source = (await client.http.get(url, { 'Cache-Control': 'no-cache' })).body;
  assertSourceHash(source, expectedSourceHash, url);
  return source;
}

/** Whole-include replacement: a missing include cannot be approved, because its creation is unguarded. */
export async function previewIncludeReplacement(
  ctx: SapWriteContext,
  include: string,
  url: string,
  proposed: string,
): Promise<ToolResult> {
  const { client, args, type, name } = ctx;
  let current: string;
  try {
    current = await readEditableForPreview(client, type, url, args.expectedSourceHash as string | undefined);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    return errorResult(
      `Include "${include}" does not exist in ${type} ${name}. A dry run cannot approve its creation, because the write would create it without a source precondition. No write was made.`,
    );
  }
  return sourcePreviewResult({
    type,
    name,
    include,
    current,
    proposed,
    expectedResultHash: args.expectedResultHash as string | undefined,
  });
}

export interface SourcePreview {
  type: string;
  name: string;
  /** Class include being written; omitted for the main source. */
  include?: string;
  current: string;
  /** Exact bytes the write would send. */
  proposed: string;
  /** Pre-write check output (preflight, lint, server syntax check) or the action's no-op answer. */
  notes?: string;
  expectedResultHash?: string;
}

export function sourcePreviewResult(preview: SourcePreview): ToolResult {
  const { type, name, include, current, proposed, notes } = preview;
  const target = `${type} ${name}${include ? ` include ${include}` : ''}`;
  assertResultHash(proposed, preview.expectedResultHash, target);
  const header = `Dry run for ${target} — nothing was written.`;
  if (Buffer.byteLength(current) > MAX_PREVIEW_SOURCE_BYTES || Buffer.byteLength(proposed) > MAX_PREVIEW_SOURCE_BYTES) {
    return incompletePreview(header, 'the source exceeds the 1-MiB preview limit');
  }
  // SAP drops the final line break on save (verified on SAP_BASIS 754 and 758), so it is not shown
  // as a change. Both hashes still cover the exact bytes.
  const settle = (text: string) => (text && !text.endsWith('\n') ? `${text}\n` : text);
  let diff: ReturnType<typeof unifiedDiff>;
  try {
    diff = unifiedDiff(
      settle(current),
      settle(proposed),
      `${target} (current)`,
      `${target} (proposed)`,
      3,
      false,
      DIFF_WORK,
    );
  } catch {
    return incompletePreview(header, 'the diff exceeded its work budget');
  }
  if (diff.diff.split('\n').length > MAX_DIFF_LINES || Buffer.byteLength(diff.diff) > MAX_DIFF_BYTES) {
    return incompletePreview(header, `the diff exceeds the ${MAX_DIFF_LINES}-line / 64-KiB display limit`);
  }
  const summary = {
    changed: !diff.identical,
    linesAdded: diff.added,
    linesRemoved: diff.removed,
    sourceHash: sourceHash(current),
    resultHash: sourceHash(proposed),
  };
  const next = summary.changed
    ? 'To write exactly this change, repeat the call without dryRun, with expectedSourceHash=sourceHash and expectedResultHash=resultHash.'
    : 'The resulting source equals the current source after line-ending normalization.';
  // Pre-write checks are worded for a write; a preview must not claim one happened.
  const checks = notes?.replace('source was still written', 'a write would still proceed');
  return textResult([`${header} ${next}`, toolJson(summary), checks, diff.diff].filter(Boolean).join('\n\n'));
}

function incompletePreview(header: string, reason: string): ToolResult {
  return errorResult(
    `${header} The preview is incomplete: ${reason}, so it cannot be approved. Split the change into smaller edits.`,
  );
}

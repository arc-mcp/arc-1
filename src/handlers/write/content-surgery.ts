/** SAPWrite action for content-anchored surgical replacement in PROG and INCL sources. */

import { safeUpdateSourceWithTransform } from '../../adt/crud.js';
import { spliceContent } from '../../context/content-splice.js';
import { cachedFeatures } from '../feature-cache.js';
import { resolveVersionAndDraftInfo } from '../read.js';
import { errorResult, type ToolResult, textResult } from '../shared.js';
import { runPreWriteLint, runPreWriteSyntaxCheck } from '../write-helpers.js';
import type { SapWriteContext } from './context.js';

export async function writeActionEditContent(ctx: SapWriteContext): Promise<ToolResult> {
  const {
    client,
    args,
    config,
    cachingLayer,
    cacheSecurity,
    type,
    name,
    transport,
    lintOverride,
    checkOverride,
    objectUrl,
    srcUrl,
    invalidateWrittenObject,
    enforcePackageForExistingObject,
  } = ctx;

  const oldContent = String(args.oldContent ?? '');
  const hasNewContent = typeof args.newContent === 'string';
  if (!oldContent) {
    return errorResult(
      '"oldContent" is required — the exact raw source text to replace (no line-number prefix), copied from a plain SAPRead.',
    );
  }
  if (!hasNewContent) {
    return errorResult('"newContent" is required (pass "" to delete oldContent).');
  }
  if (type !== 'PROG' && type !== 'INCL') {
    return errorResult('edit_content is only supported for type=PROG or type=INCL.');
  }

  const hasLineStart = args.lineStart !== undefined;
  const hasLineEnd = args.lineEnd !== undefined;
  if (hasLineStart !== hasLineEnd) {
    return errorResult(
      'Both lineStart and lineEnd are required together when scoping the anchor search to a line window.',
    );
  }
  const lineStart = hasLineStart ? Number(args.lineStart) : undefined;
  const lineEnd = hasLineEnd ? Number(args.lineEnd) : undefined;
  const newContent = String(args.newContent);

  await enforcePackageForExistingObject();

  const { effectiveVersion } = await resolveVersionAndDraftInfo(
    client,
    cachingLayer,
    type,
    name,
    'auto',
    cacheSecurity,
  );
  const cachedVersion = effectiveVersion === 'inactive' ? 'inactive' : 'active';
  const cachedSource = cachingLayer?.getCachedSourceWithEtag(type, name, cachedVersion) ?? null;

  let lintBlocked: ToolResult | undefined;
  let lintWarnings: string | undefined;
  let checkNotes = '';

  const outcome = await safeUpdateSourceWithTransform(
    client.http,
    client.safety,
    objectUrl,
    srcUrl,
    async (currentSource) => {
      const spliced = spliceContent(currentSource, oldContent, newContent, lineStart, lineEnd);
      if (spliced.outcome === 'error') return { error: spliced.error! };
      if (spliced.outcome === 'already-applied') return { skip: true };

      const lint = runPreWriteLint(spliced.newSource!, type, name, config, lintOverride);
      if (lint.blocked) {
        lintBlocked = lint.result;
        return { error: '__lint_blocked__' };
      }
      lintWarnings = lint.warnings;
      checkNotes = await runPreWriteSyntaxCheck(client, type, spliced.newSource!, objectUrl, config, checkOverride);
      return { source: spliced.newSource! };
    },
    transport,
    cachedFeatures?.abapRelease,
    effectiveVersion === 'inactive' ? 'inactive' : undefined,
    cachedSource,
  );

  if ('error' in outcome) return lintBlocked ?? errorResult(outcome.error);

  if ('skipped' in outcome) {
    return textResult(`No change made — ${type} ${name} already matches the requested state.`);
  }

  invalidateWrittenObject(type, name);
  const message = `Successfully updated ${type} ${name}.`;
  const extras = [lintWarnings, checkNotes].filter(Boolean).join('\n\n');
  return extras ? textResult(`${message}\n\n${extras}`) : textResult(message);
}

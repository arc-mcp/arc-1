import { z } from 'zod';
import { type ReviewMode, reviewCoverage, type TransportObjectDiff } from '../adt/transport-diff.js';
import { artifactHtml, callJson, callText, type ToolInvoker, WorkflowCallError } from './artifact.js';
import { type ReviewPage, type ReviewPageEvidence, reviewPageSchema } from './review-schema.js';
export interface TransportReviewArtifact {
  schemaVersion: 1;
  kind: 'arc1-transport-review';
  request: string;
  mode: ReviewMode;
  collectedAt: string;
  status: 'complete' | 'partial' | 'stale' | 'error';
  pages: ReviewPageEvidence[];
  checks: Array<Record<string, unknown>>;
  observations: string[];
  gaps: string[];
}

/** Bounded collector; never executes transport writes or assumes an empty diff is safe. */
export async function collectTransportReview(
  call: ToolInvoker,
  request: string,
  options: { mode?: ReviewMode; maxPages?: number; syntax?: boolean; context?: boolean } = {},
): Promise<TransportReviewArtifact> {
  const mode = options.mode ?? 'released';
  const artifact: TransportReviewArtifact = {
    schemaVersion: 1,
    kind: 'arc1-transport-review',
    request,
    mode,
    collectedAt: new Date().toISOString(),
    status: 'partial',
    pages: [],
    checks: [],
    observations: [],
    gaps: [],
  };
  const maxPages = Math.min(10, Math.max(1, options.maxPages ?? 5));
  const seenObjects = new Set<string>();
  let offset = 0;
  let continuation: string | undefined;
  let first: ReviewPage | undefined;
  try {
    for (let i = 0; i < maxPages; i++) {
      const page = reviewPageSchema.parse(
        await callJson(call, 'SAPTransport', {
          action: 'diff',
          resultFormat: 'structured',
          id: request,
          reviewMode: mode,
          offset,
          limit: 20,
          ...(continuation ? { continuation } : {}),
        }),
      );
      if (
        page.offset !== offset ||
        page.shown !== page.objects.length ||
        offset + page.shown > page.totalObjects ||
        page.transport.id.toUpperCase() !== request.toUpperCase() ||
        page.reviewMode !== mode
      )
        throw new Error('Invalid review page identity or bounds.');
      if (
        first &&
        (page.inventoryFingerprint !== first.inventoryFingerprint ||
          page.target !== first.target ||
          page.client !== first.client ||
          page.totalObjects !== first.totalObjects)
      ) {
        artifact.status = 'stale';
        artifact.gaps.push('Inventory or target changed during collection. Restart the review.');
        break;
      }
      first ??= page;
      for (const object of page.objects) {
        const key = `${object.type}:${object.name}`.toUpperCase();
        if (seenObjects.has(key)) throw new Error(`Duplicate review object: ${key}.`);
        seenObjects.add(key);
      }
      continuation = page.continuation;
      const { continuation: _token, ...saved } = page;
      artifact.pages.push(saved);
      if (page.nextOffset === undefined) {
        if (offset + page.shown !== page.totalObjects) throw new Error('Incomplete review page has no continuation.');
        // A fresh bounded read validates inventory at the end. It does not freeze source.
        const final = reviewPageSchema.parse(
          await callJson(call, 'SAPTransport', {
            action: 'diff',
            resultFormat: 'structured',
            id: request,
            reviewMode: mode,
            offset: 0,
            limit: 1,
            summary: true,
            continuation,
          }),
        );
        if (
          final.inventoryFingerprint !== first.inventoryFingerprint ||
          final.target !== first.target ||
          final.client !== first.client ||
          final.transport.id !== first.transport.id ||
          final.reviewMode !== mode ||
          final.totalObjects !== first.totalObjects
        ) {
          artifact.status = 'stale';
          artifact.gaps.push('Final inventory revalidation changed; restart the review.');
          break;
        }
        artifact.status = 'complete';
        break;
      }
      if (page.nextOffset !== offset + page.shown || page.nextOffset <= offset)
        throw new Error('Review pagination made no progress.');
      offset = page.nextOffset;
    }
  } catch (error) {
    artifact.status =
      error instanceof Error && /continuation.*stale|restart at offset/i.test(error.message) ? 'stale' : 'error';
    artifact.gaps.push(error instanceof Error ? error.message : 'Collection failed.');
  }
  const objects = artifact.pages.flatMap((p) => p.objects) as TransportObjectDiff[];
  const coverage = reviewCoverage(objects);
  if (
    coverage.uncertain + coverage.unavailable + coverage.unsupported ||
    objects.some((o) => o.parts.some((p) => p.diffTruncated || p.hunksOmitted))
  ) {
    if (artifact.status === 'complete') artifact.status = 'partial';
    artifact.gaps.push('Source coverage or displayed hunks are incomplete; inspect per-part evidence.');
  }
  if (artifact.status === 'partial' && artifact.pages.length >= maxPages) artifact.gaps.push('Page budget reached.');
  artifact.gaps.push(
    'Sources were read at different times. Hashes identify evidence; source stability across collection is not established.',
  );
  if (mode === 'draft') artifact.gaps.push('Saved inactive drafts are not release-readiness evidence.');
  if (options.syntax) {
    for (const object of objects.filter((o) => o.parts.some((p) => p.change === 'changed')).slice(0, 10)) {
      const identity = { type: object.type, name: object.name };
      const check: Record<string, unknown> = {
        ...identity,
        kind: 'syntax',
        sourceState: 'active',
        checkedAt: new Date().toISOString(),
        status: 'not-run',
        historicalCorrelation: 'not established',
      };
      try {
        const before = await callJson(call, 'SAPDiagnose', { action: 'object_state', ...identity });
        const result = z
          .object({ checked: z.boolean(), hasErrors: z.boolean() })
          .passthrough()
          .parse(await callJson(call, 'SAPDiagnose', { action: 'syntax', ...identity, version: 'active' }));
        const after = await callJson(call, 'SAPDiagnose', { action: 'object_state', ...identity });
        const state = z.object({
          sections: z.array(
            z.object({
              section: z.string(),
              active: z.object({ sha256: z.string().optional(), available: z.boolean() }),
            }),
          ),
        });
        const a = state.parse(before).sections;
        const b = state.parse(after).sections;
        check.sourceEvidence = { before: a, after: b };
        check.result = result;
        check.status =
          JSON.stringify(a) !== JSON.stringify(b)
            ? 'stale'
            : !a.length || !a.some((s) => s.active.available) || a.some((s) => s.active.available && !s.active.sha256)
              ? 'incomplete'
              : !result.checked
                ? 'not-run'
                : result.hasErrors
                  ? 'failed'
                  : 'passed';
      } catch (error) {
        check.status = error instanceof WorkflowCallError ? error.status : 'error';
        check.note = error instanceof Error ? error.message : 'Check failed.';
      }
      artifact.checks.push(check);
    }
  }
  if (!artifact.checks.length) artifact.checks.push({ kind: 'syntax/ATC/ABAP Unit', status: 'not-run' });
  if (options.context) {
    for (const object of objects
      .filter((o) => o.parts.some((p) => p.change === 'changed' || p.attribution === 'unverified'))
      .slice(0, 3)) {
      const evidence: Record<string, unknown> = {
        kind: 'dependency-context',
        type: object.type,
        name: object.name,
        sourceState: 'current',
        historicalCorrelation: 'not established',
        checkedAt: new Date().toISOString(),
      };
      try {
        const text = await callText(call, 'SAPContext', {
          type: object.type,
          name: object.name,
          depth: 1,
          maxDeps: 10,
          includeKtd: false,
        });
        evidence.status = 'returned';
        evidence.text = text.slice(0, 16 * 1024);
        evidence.truncated = text.length > 16 * 1024;
      } catch (error) {
        evidence.status = error instanceof WorkflowCallError ? error.status : 'error';
        evidence.note = error instanceof Error ? error.message : 'Context failed.';
      }
      artifact.checks.push(evidence);
    }
  }
  return artifact;
}

export function renderTransportReview(artifact: TransportReviewArtifact): string {
  const objects = artifact.pages.flatMap((p) => p.objects) as TransportObjectDiff[];
  const coverage = reviewCoverage(objects);
  return artifactHtml(`Transport review · ${artifact.request}`, [
    {
      title: `${artifact.status.toUpperCase()} collection · ${artifact.mode}`,
      text: `${artifact.pages[0]?.target ?? 'Target not established'} · ${artifact.collectedAt}\n${objects.length} logical objects · ${objects.reduce((n, o) => n + o.parts.filter((p) => p.change === 'changed').length, 0)} changed source parts\n\nCoverage: ${coverage.reviewed} reviewed · ${coverage.uncertain} uncertain · ${coverage.unavailable} unavailable · ${coverage.unsupported} unsupported\nCounted: ${coverage.denominator}.\n\n${artifact.gaps.join('\n')}\n\nThis report is evidence, not a release verdict.`,
    },
    {
      title: 'Checks actually executed',
      text: artifact.checks
        .map(
          (c) =>
            `${c.kind} · ${[c.type, c.name].filter(Boolean).join(' ')} · ${c.status}${c.sourceState ? ` · ${c.sourceState} source` : ''}${c.historicalCorrelation ? `\n  Historical correlation: ${c.historicalCorrelation}` : ''}`,
        )
        .join('\n'),
      detail: JSON.stringify(artifact.checks, null, 2),
    },
    {
      title: 'Reviewer interpretation',
      text: artifact.observations.join('\n') || 'No model or reviewer interpretation has been added.',
    },
    ...objects.flatMap((o) => [
      {
        title: `${o.type} ${o.name} · scope`,
        text: [
          o.inventoryReason,
          o.scopeNote,
          ...(o.coverageGaps ?? []),
          `${o.components.length} CTS components · ${o.parts.length} source parts`,
        ]
          .filter(Boolean)
          .join('\n'),
        detail: JSON.stringify({ taskIds: o.taskIds, components: o.components }, null, 2),
      },
      ...o.parts.map((p) => ({
        title: `${o.name} · ${p.part} · ${p.change}`,
        text: `${p.baselineStatus} · ${p.sourceState ?? 'unknown state'} · attribution: ${p.attribution ?? 'unverified'}\n${p.from ?? 'no baseline'} → ${p.to ?? 'no revision'}\n+${p.added} / −${p.removed}${p.statisticsComplete ? '' : ' (statistics incomplete)'}\n${p.note ?? ''}${p.diffTruncated || p.hunksOmitted ? '\nHunks incomplete or omitted; narrow the detail request.' : ''}\n\n${p.diff}`,
        detail: JSON.stringify({ ...p, diff: undefined }, null, 2),
      })),
    ]),
  ]);
}

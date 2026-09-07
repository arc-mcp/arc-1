import { COLLECTION_REASONS, type GraphCollectionReport, normalizeNodeRef } from '../types.js';

const COUNTERS = [
  'discoveredObjects',
  'downloadedBytes',
  'requests',
  'saturatedSearches',
  'successfulSources',
  'failedSources',
  'failedReads',
  'failedParses',
  'partialParses',
  'dynamicTargets',
] as const;

/** Persist only approved metadata/counters, never raw source or exception messages. */
export function collectionReportPayload(report: GraphCollectionReport, systemKey: string) {
  if (!['complete', 'partial'].includes(report.status) || report.sources.length > 10_000)
    throw new Error('Invalid collection report');
  const counters: Record<string, number> = {};
  for (const key of COUNTERS) {
    const value = report.counters[key] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid collection counter');
    counters[key] = value;
  }
  const sources = report.sources.map((source) => {
    const ref = normalizeNodeRef({ name: source.name, type: source.type, systemKey });
    if (
      !['parsed', 'partial', 'failed', 'read_failed'].includes(source.status) ||
      source.reasons.some((reason) => !COLLECTION_REASONS.includes(reason)) ||
      !Number.isSafeInteger(source.dynamicTargets) ||
      source.dynamicTargets < 0
    )
      throw new Error('Invalid source outcome');
    return {
      name: ref.name,
      type: ref.type,
      status: source.status,
      reasons: [...new Set(source.reasons)],
      dynamicTargets: source.dynamicTargets,
    };
  });
  const status =
    report.status === 'partial' ||
    counters.failedSources! > 0 ||
    counters.saturatedSearches! > 0 ||
    sources.some((source) => source.status !== 'parsed')
      ? 'partial'
      : 'complete';
  return { status, checkpoint: { sources }, counters };
}

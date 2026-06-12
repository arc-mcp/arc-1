/**
 * CDS impact + pre-write hint helpers (extracted from intent.ts, Stage B; moved verbatim).
 *
 * Downstream-impact bucketing/ordering, where-used scoping, the update/delete/activation
 * dependency hints, and the CDS reserved-keyword guard. Shared by the SAPWrite, SAPActivate and
 * SAPContext handlers.
 */

import { type CdsImpactDownstream, classifyCdsImpact } from '../adt/cds-impact.js';
import type { AdtClient } from '../adt/client.js';
import { findWhereUsed, getWhereUsedScope, type WhereUsedResult } from '../adt/codeintel.js';
import { AdtApiError } from '../adt/errors.js';
import type { ResolvedFeatures } from '../adt/types.js';
import { normalizeObjectType } from './object-types.js';
import { errorResult } from './shared.js';

export const CDS_DEPENDENCY_SENSITIVE_TYPES = new Set(['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD', 'SRVB', 'TABL']);

type CdsImpactBucket = Exclude<keyof CdsImpactDownstream, 'summary'>;

const CDS_IMPACT_BUCKET_ORDER: CdsImpactBucket[] = [
  'projectionViews',
  'bdefs',
  'serviceDefinitions',
  'serviceBindings',
  'accessControls',
  'metadataExtensions',
  'abapConsumers',
  'tables',
  'documentation',
  'other',
];

const CDS_IMPACT_BUCKET_LABEL: Record<CdsImpactBucket, string> = {
  projectionViews: 'Projection views (DDLS)',
  bdefs: 'Behavior definitions (BDEF)',
  serviceDefinitions: 'Service definitions (SRVD)',
  serviceBindings: 'Service bindings (SRVB)',
  accessControls: 'Access controls (DCLS)',
  metadataExtensions: 'Metadata extensions (DDLX)',
  abapConsumers: 'ABAP consumers',
  tables: 'Tables',
  documentation: 'Documentation (SKTD)',
  other: 'Other',
};

const CDS_REACTIVATION_BUCKET_ORDER: CdsImpactBucket[] = [
  'projectionViews',
  'accessControls',
  'metadataExtensions',
  'bdefs',
  'serviceDefinitions',
  'serviceBindings',
  'other',
];

const CDS_DELETE_BUCKET_ORDER: CdsImpactBucket[] = [
  'serviceBindings',
  'serviceDefinitions',
  'bdefs',
  'metadataExtensions',
  'accessControls',
  'projectionViews',
  'other',
];

interface CdsOrderedObject {
  type: string;
  name: string;
}

const CDS_ORDERABLE_TYPES = new Set(['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD', 'SRVB']);
const CDS_IMPACT_WHERE_USED_TYPES = new Set([
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
  'SRVB',
  'CLAS',
  'INTF',
  'PROG',
  'FUGR',
  'TABL',
  'SKTD',
]);

function formatCdsImpactBuckets(downstream: CdsImpactDownstream, maxNames = 4): string[] {
  const lines: string[] = [];

  for (const bucket of CDS_IMPACT_BUCKET_ORDER) {
    const entries = downstream[bucket];
    if (entries.length === 0) continue;
    const unique = Array.from(
      new Set(
        entries.map((entry) => {
          const mainType = entry.type.split('/')[0] || entry.type || '?';
          return `${entry.name} (${mainType})`;
        }),
      ),
    );
    const listed = unique.slice(0, maxNames).join(', ');
    const more = unique.length > maxNames ? ` (+${unique.length - maxNames} more)` : '';
    lines.push(`- ${CDS_IMPACT_BUCKET_LABEL[bucket]}: ${listed}${more}`);
  }

  return lines;
}

function mainObjectType(type: string): string {
  // First consult SLASH_TYPE_MAP so collapsed types (TABL/DS → TABL, legacy
  // STRU/DS → TABL) resolve to ARC-1's canonical short type. Then fall back to
  // splitting on '/' so unknown slash forms (e.g. BDEF/BO from where-used
  // results) still produce the parent type rather than the full slash form.
  const normalized = normalizeObjectType(type);
  if (normalized && !normalized.includes('/')) return normalized;
  return type.split('/')[0]?.toUpperCase() ?? '';
}

function collectOrderedCdsObjects(
  downstream: CdsImpactDownstream,
  bucketOrder: readonly CdsImpactBucket[],
): CdsOrderedObject[] {
  const seen = new Set<string>();
  const ordered: CdsOrderedObject[] = [];

  for (const bucket of bucketOrder) {
    for (const entry of downstream[bucket]) {
      const type = mainObjectType(entry.type);
      const name = String(entry.name ?? '').toUpperCase();
      if (!type || !name || !CDS_ORDERABLE_TYPES.has(type)) continue;
      const key = `${type}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push({ type, name });
    }
  }

  return ordered;
}

function dedupeCdsObjects(objects: readonly CdsOrderedObject[]): CdsOrderedObject[] {
  const seen = new Set<string>();
  const deduped: CdsOrderedObject[] = [];
  for (const obj of objects) {
    const key = `${obj.type}:${obj.name.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(obj);
  }
  return deduped;
}

function formatCdsObjectList(objects: readonly CdsOrderedObject[], max = 8): string {
  if (objects.length === 0) return '';
  const listed = objects
    .slice(0, max)
    .map((obj) => `${obj.type} ${obj.name}`)
    .join(', ');
  return objects.length > max ? `${listed} (+${objects.length - max} more)` : listed;
}

function formatCdsActivationPayload(objects: readonly CdsOrderedObject[], max = 8): string {
  if (objects.length === 0) return '[]';
  const listed = objects
    .slice(0, max)
    .map((obj) => `{type:"${obj.type}",name:"${obj.name}"}`)
    .join(', ');
  return objects.length > max ? `[${listed}, ...] (+${objects.length - max} more)` : `[${listed}]`;
}

function dedupeWhereUsedResults(results: readonly WhereUsedResult[]): WhereUsedResult[] {
  const seen = new Set<string>();
  const deduped: WhereUsedResult[] = [];

  for (const result of results) {
    const uriKey = result.uri.toLowerCase();
    const fallbackKey = `${mainObjectType(result.type)}:${String(result.name ?? '').toUpperCase()}`;
    const key = uriKey || fallbackKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

function isCdsImpactWhereUsedType(objectType: string): boolean {
  return CDS_IMPACT_WHERE_USED_TYPES.has(mainObjectType(objectType));
}

async function loadScopedCdsWhereUsedResults(client: AdtClient, objectUrl: string): Promise<WhereUsedResult[]> {
  try {
    const scope = await getWhereUsedScope(client.http, client.safety, objectUrl);
    const scopedTypes = Array.from(
      new Set(
        scope.entries
          .filter((entry) => entry.count > 0 && isCdsImpactWhereUsedType(entry.objectType))
          .map((entry) => entry.objectType),
      ),
    );
    const scopedResults: WhereUsedResult[] = [];

    for (const objectType of scopedTypes) {
      try {
        scopedResults.push(...(await findWhereUsed(client.http, client.safety, objectUrl, objectType)));
      } catch {
        // Scoped results only enrich guidance; one unsupported filter must not
        // make the write/delete/activate path fail.
      }
    }

    return scopedResults;
  } catch (err) {
    if (err instanceof AdtApiError && [404, 405, 415, 501].includes(err.statusCode)) {
      return [];
    }
    // Where-used enrichment is advisory; the original write/delete/activate
    // result should not fail just because a scoped lookup is unavailable.
    return [];
  }
}

async function loadCdsImpactDownstream(client: AdtClient, objectUrl: string): Promise<CdsImpactDownstream | undefined> {
  try {
    const whereUsed = await findWhereUsed(client.http, client.safety, objectUrl);
    // Some SAP releases return a shallow/default result set for unfiltered
    // usageReferences. Scope + object-type filters usually expose the full
    // bucket fan-out, which is exactly what CRUD guidance needs.
    const scopedWhereUsed = await loadScopedCdsWhereUsedResults(client, objectUrl);
    const combinedWhereUsed = dedupeWhereUsedResults([...whereUsed, ...scopedWhereUsed]);
    return classifyCdsImpact(combinedWhereUsed, { includeIndirect: true });
  } catch (err) {
    if (err instanceof AdtApiError && [404, 405, 415, 501].includes(err.statusCode)) {
      return undefined;
    }
    return undefined;
  }
}

export async function buildCdsUpdateCrudHint(client: AdtClient, name: string, objectUrl: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`CDS update follow-up for ${name}:`);

  const downstream = await loadCdsImpactDownstream(client, objectUrl);
  let orderedReactivation: CdsOrderedObject[] = [];
  if (downstream) {
    const bucketLines = formatCdsImpactBuckets(downstream);
    if (bucketLines.length > 0) {
      lines.push(`- Downstream consumers in ADT where-used index: ${downstream.summary.total}`);
      lines.push(...bucketLines);
      orderedReactivation = collectOrderedCdsObjects(downstream, CDS_REACTIVATION_BUCKET_ORDER);
    } else {
      lines.push('- No downstream consumers found in the current ADT where-used index.');
    }
  } else {
    lines.push('- Where-used index is unavailable on this system (impact list could not be fetched).');
  }

  lines.push(`- SAPWrite(update) stores inactive source only. Run SAPActivate(type="DDLS", name="${name}").`);
  lines.push('- Field/alias/signature changes may require re-activation of dependent DDLS/BDEF/SRVD/DDLX objects.');
  if (orderedReactivation.length > 0) {
    const activationPlan = dedupeCdsObjects([{ type: 'DDLS', name }, ...orderedReactivation]);
    lines.push(`- Suggested re-activation order: ${formatCdsObjectList(activationPlan)}.`);
    lines.push(`- Batch call template: SAPActivate(objects=${formatCdsActivationPayload(activationPlan)}).`);
  }

  return lines.join('\n');
}

export async function buildCdsDeleteDependencyHint(
  client: AdtClient,
  type: string,
  name: string,
  objectUrl: string,
): Promise<string | undefined> {
  const downstream = await loadCdsImpactDownstream(client, objectUrl);
  if (!downstream || downstream.summary.total === 0) {
    const lines: string[] = [];
    lines.push(`Delete dependency follow-up for ${type} ${name}:`);
    if (!downstream) {
      lines.push('- ADT where-used lookup is unavailable on this system or failed during error enrichment.');
    } else {
      lines.push(
        '- No current ADT where-used dependents were returned, but SAP still rejected delete with a DDIC dependency error.',
      );
    }
    lines.push(
      '- If dependents were just deleted, wait briefly and retry; SAP active dependency/index state can lag in the same cleanup session.',
    );
    lines.push(
      `- If source was stripped or restored, run SAPActivate(type="${type}", name="${name}") first; delete checks active DDIC dependencies.`,
    );
    lines.push(
      `- If it keeps failing, run SAPNavigate(action="references", type="${type}", name="${name}") and check for edit locks/inactive objects before retrying.`,
    );
    return lines.join('\n');
  }

  const lines: string[] = [];
  lines.push(`Blocking dependents for ${type} ${name} (ADT where-used):`);
  lines.push(...formatCdsImpactBuckets(downstream));
  const orderedDelete = collectOrderedCdsObjects(downstream, CDS_DELETE_BUCKET_ORDER);
  if (orderedDelete.length > 0) {
    lines.push(`Suggested delete order: ${formatCdsObjectList(orderedDelete)}, then ${type} ${name}.`);
  }
  lines.push(
    `Delete/refactor these dependents first, then retry SAPWrite(action="delete", type="${type}", name="${name}").`,
  );
  lines.push(
    'If the listed dependents were just deleted, wait briefly and retry; SAP active dependency/index state can lag in the same cleanup session.',
  );
  lines.push(
    'For cyclic CDS projection graphs, temporarily strip redirected/composition associations, activate stripped DDLS, then delete.',
  );
  lines.push('If source was already stripped, activate first — delete checks active version dependencies.');

  return lines.join('\n');
}

export async function buildCdsActivationDependencyHint(
  client: AdtClient,
  name: string,
  objectUrl: string,
): Promise<string> {
  const lines: string[] = [];
  const downstream = await loadCdsImpactDownstream(client, objectUrl);
  let orderedReactivation: CdsOrderedObject[] = [];

  lines.push(`CDS activation impact for ${name}:`);
  if (!downstream || downstream.summary.total === 0) {
    lines.push('- No downstream consumers found in ADT where-used index, or index is unavailable.');
  } else {
    lines.push(...formatCdsImpactBuckets(downstream));
    orderedReactivation = collectOrderedCdsObjects(downstream, CDS_REACTIVATION_BUCKET_ORDER);
  }
  lines.push('- When fields/elements change, dependents may fail until re-activated in dependency order.');
  if (orderedReactivation.length > 0) {
    const activationPlan = dedupeCdsObjects([{ type: 'DDLS', name }, ...orderedReactivation]);
    lines.push(`- Suggested re-activation order: ${formatCdsObjectList(activationPlan)}.`);
    lines.push(`- Batch call template: SAPActivate(objects=${formatCdsActivationPayload(activationPlan)}).`);
  } else {
    lines.push(`- Try SAPActivate(objects=[{type:"DDLS",name:"${name}"}, ...dependents...]).`);
  }

  return lines.join('\n');
}

// ─── CDS Pre-Write Validation ──────────────────────────────────────

/** Common CDS reserved/function keywords that cause silent DDL save failures when used as field names */
const CDS_RESERVED_KEYWORDS = new Set([
  'position',
  'value',
  'type',
  'data',
  'timestamp',
  'language',
  'text',
  'source',
  'target',
  'name',
  'description',
  'concat',
  'replace',
  'substring',
  'length',
  'left',
  'right',
  'round',
  'abs',
  'floor',
  'ceiling',
  'division',
  'mod',
  'case',
  'when',
  'then',
  'else',
  'end',
  'cast',
  'coalesce',
  'uuid',
]);

/**
 * Guard CDS syntax against known version-dependent features.
 * Returns an error result if the source uses unsupported syntax, or undefined to proceed.
 * Best-effort: if cachedFeatures is not available (no probe yet), always proceeds.
 */
export function guardCdsSyntax(
  type: string,
  source: string,
  features: ResolvedFeatures | undefined,
): ReturnType<typeof errorResult> | undefined {
  if (type !== 'DDLS' || !source) return undefined;

  // Guard: "define table entity" requires ABAP Cloud (BTP) or SAP_BASIS >= 757
  if (/\bdefine\s+table\s+(entity|function)\b/i.test(source)) {
    const release = features?.abapRelease;
    const isBtp = features?.systemType === 'btp';
    if (!isBtp && release) {
      const releaseNum = Number.parseInt(release.replace(/\D/g, ''), 10);
      if (releaseNum > 0 && releaseNum < 757) {
        return errorResult(
          `"define table entity" syntax requires ABAP Cloud (BTP) or S/4HANA on-premise with SAP_BASIS >= 757. ` +
            `This system reports SAP_BASIS ${release}. ` +
            `Use DDIC transparent tables (SAPWrite type="TABL" or SE11) + CDS view entities ("define [root] view entity") instead.`,
        );
      }
    }
  }

  // Advisory: warn about CDS reserved keywords used as field names
  const keywordWarning = warnCdsReservedKeywords(source);
  if (keywordWarning) {
    // Non-blocking — return undefined to proceed, but the warning will be
    // appended to the success message by the caller if needed.
    // For now we return it as an advisory error only when the keyword is
    // highly likely to cause issues (position is the most common).
    // We don't block the write — just append it as advisory context.
  }

  return undefined;
}

/**
 * Detect CDS reserved keywords used as field names in DDL source.
 * Returns a warning string listing suspicious field names, or undefined if none found.
 */
export function warnCdsReservedKeywords(source: string): string | undefined {
  // Extract field-name-like tokens: lines inside { } that define fields
  // Pattern: whitespace + identifier + colon (field definitions)
  const fieldNames: string[] = [];
  const braceStart = source.indexOf('{');
  const braceEnd = source.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1) return undefined;

  const body = source.slice(braceStart + 1, braceEnd);
  // Match field definitions: leading whitespace, optional "key", then identifier before ":"
  const fieldPattern = /^\s*(?:key\s+)?(\w+)\s*:/gim;
  let match: RegExpExecArray | null;
  while ((match = fieldPattern.exec(body)) !== null) {
    const fieldName = match[1]?.toLowerCase();
    if (fieldName && CDS_RESERVED_KEYWORDS.has(fieldName)) {
      fieldNames.push(match[1]!);
    }
  }

  if (fieldNames.length === 0) return undefined;

  return (
    `Warning: field name(s) ${fieldNames.map((f) => `'${f}'`).join(', ')} may be CDS reserved keywords. ` +
    `If the DDL save fails with a generic syntax error, rename them (e.g., 'position' → 'playing_position', 'type' → 'obj_type').`
  );
}

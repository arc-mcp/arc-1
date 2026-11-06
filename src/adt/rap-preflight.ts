import type { SystemType } from './types.js';

export type RapPreflightSeverity = 'error' | 'warning';

export interface RapPreflightFinding {
  severity: RapPreflightSeverity;
  ruleId: string;
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export interface RapPreflightContext {
  systemType?: SystemType;
  abapRelease?: string;
}

export interface RapPreflightResult {
  findings: RapPreflightFinding[];
  errors: RapPreflightFinding[];
  warnings: RapPreflightFinding[];
  blocked: boolean;
}

/**
 * Deterministic RAP pre-write checks for artifact types where activation-time
 * round-trips are expensive and common failure patterns are known.
 *
 * Why deterministic static rules instead of letting SAP tell us?
 *   Every failed activation is a full lock → PUT → activate → unlock cycle
 *   against the ABAP backend. On a slow / loaded system that's 5-15 seconds
 *   per retry, and the error messages are often cryptic ("activation error:
 *   see error log"). Catching well-known patterns before the write keeps the
 *   LLM-driven agent loop tight and turns error output into actionable
 *   suggestions the model can act on immediately.
 *
 * This validator intentionally focuses on static checks with high signal —
 * every rule maps to a concrete, reproducible failure observed on a real
 * SAP system. We deliberately don't attempt full semantic validation (that's
 * what activation is for); we just catch the traps that waste round-trips.
 *
 * Rules are tagged `error` only when the pattern is guaranteed to fail
 * activation; anything ambiguous (heuristic, release-dependent) is a warning.
 */
export function validateRapSource(type: string, source: string, context: RapPreflightContext = {}): RapPreflightResult {
  const normalizedType = type.toUpperCase();
  const findings: RapPreflightFinding[] = [];

  if (!source.trim()) {
    return { findings, errors: [], warnings: [], blocked: false };
  }

  switch (normalizedType) {
    case 'TABL':
      validateTabl(source, context, findings);
      break;
    case 'BDEF':
      validateBdef(source, context, findings);
      break;
    case 'DDLX':
      validateDdlx(source, context, findings);
      break;
    case 'DDLS':
      validateDdls(source, context, findings);
      break;
    default:
      break;
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  return {
    findings,
    errors,
    warnings,
    blocked: errors.length > 0,
  };
}

export function formatRapPreflightFindings(findings: RapPreflightFinding[]): string {
  if (findings.length === 0) return '';
  return findings
    .map((f) => {
      const loc = f.line ? ` (line ${f.line}${f.column ? `:${f.column}` : ''})` : '';
      const suggestion = f.suggestion ? `\n    Suggestion: ${f.suggestion}` : '';
      return `  - [${f.ruleId}] ${f.message}${loc}${suggestion}`;
    })
    .join('\n');
}

/**
 * TABL (database table) pre-write checks.
 *
 * Targets two categories of failure:
 *  1. Missing currency/quantity metadata (universal — any release):
 *     RAP requires every `abap.curr` field to be paired with a
 *     `@Semantics.amount.currencyCode` annotation referencing a currency key
 *     field (`abap.cuky`). Without it, activation fails with "amount field
 *     requires currency code reference". Same pattern applies to `abap.quan`
 *     + `@Semantics.quantity.unitOfMeasure` + `abap.unit`.
 *
 *  2. Forbidden built-in types on on-prem 7.5x:
 *     SAP_BASIS 750-759 does not accept `abap.uname`, `abap.utclong`, or
 *     `abap.boolean` in TABL source (released builtin types matrix differs
 *     between on-prem NW and S/4HANA 2020+). These are the three most
 *     common migration stumbles when a developer copies a cloud CDS-TABL
 *     from help.sap.com into an older system.
 */
function validateTabl(source: string, context: RapPreflightContext, findings: RapPreflightFinding[]): void {
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    // Amount field: must carry @Semantics.amount.currencyCode on a line
    // within 5 lines above the field (annotations may be stacked).
    if (/\babap\.curr\s*\(/i.test(line) && !hasNearbyAnnotation(lines, i, /@Semantics\.amount\.currencyCode\b/i)) {
      findings.push({
        severity: 'error',
        ruleId: 'TABL_CURR_REQUIRES_CURRENCY_CODE',
        message: 'abap.curr field is missing @Semantics.amount.currencyCode.',
        line: i + 1,
        suggestion: 'Add @Semantics.amount.currencyCode above the amount field and pair it with an abap.cuky field.',
      });
    }

    // Quantity field: symmetrical rule — must carry
    // @Semantics.quantity.unitOfMeasure pointing at an abap.unit key field.
    if (/\babap\.quan\s*\(/i.test(line) && !hasNearbyAnnotation(lines, i, /@Semantics\.quantity\.unitOfMeasure\b/i)) {
      findings.push({
        severity: 'error',
        ruleId: 'TABL_QUAN_REQUIRES_UNIT',
        message: 'abap.quan field is missing @Semantics.quantity.unitOfMeasure.',
        line: i + 1,
        suggestion:
          'Add @Semantics.quantity.unitOfMeasure above the quantity field and pair it with an abap.unit field.',
      });
    }

    // On-prem 7.5x only — these built-in types exist in modern systems but
    // the TABL activator on older releases rejects them.
    if (isOnPrem75x(context)) {
      if (/\babap\.uname\b/i.test(line)) {
        findings.push({
          severity: 'error',
          ruleId: 'TABL_FORBIDDEN_ABAP_UNAME',
          message: 'abap.uname is not accepted in TABL source on on-prem 7.5x.',
          line: i + 1,
          suggestion: 'Use syuname for user fields.',
        });
      }
      if (/\babap\.utclong\b/i.test(line)) {
        findings.push({
          severity: 'error',
          ruleId: 'TABL_FORBIDDEN_ABAP_UTCLONG',
          message: 'abap.utclong is not accepted in TABL source on on-prem 7.5x.',
          line: i + 1,
          suggestion: 'Use timestampl for timestamp fields.',
        });
      }
      if (/\babap\.boolean\b/i.test(line)) {
        findings.push({
          severity: 'error',
          ruleId: 'TABL_FORBIDDEN_ABAP_BOOLEAN',
          message: 'abap.boolean is not accepted in TABL source on on-prem 7.5x.',
          line: i + 1,
          suggestion: 'Use abap.char(1) with X/space semantics for boolean-like fields.',
        });
      }
    }
  }
}

/**
 * BDEF (behavior definition) pre-write checks.
 *
 * Rules in order of severity:
 *
 *  1. `authorization master ( none )` — error, all releases.
 *     This is a frequent copy-paste mistake: developers see `authorization
 *     master ( global )` in one template and `authorization master ( instance )`
 *     in another and guess that `none` is a valid "turn off auth" option.
 *     It isn't. The BDL parser rejects it outright. The right escape hatch
 *     is to omit the clause entirely until the handler class exists.
 *
 *  2. Projection BDEF + `use etag` — error on on-prem 7.5x only.
 *     Modern S/4 supports etag overrides in projection headers; on-prem 7.5x
 *     only accepts `projection;` as the entire projection header and
 *     requires etag semantics to be inherited from the interface BDEF. The
 *     activator error for this is particularly opaque ("syntax error in
 *     behavior definition header").
 *
 *  3. Duplicate `etag master <field>` — warning, all releases.
 *     Reusing the same field name across root + composition is *sometimes*
 *     intentional, but far more often it's a mistake where the developer
 *     copy-pasted a composition block and forgot to retarget the etag
 *     field. Surface it as a warning so the dev can confirm.
 */
function validateBdef(source: string, context: RapPreflightContext, findings: RapPreflightFinding[]): void {
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (/\bauthorization\s+master\s*\(\s*none\s*\)/i.test(line)) {
      findings.push({
        severity: 'error',
        ruleId: 'BDEF_INVALID_AUTH_MASTER_NONE',
        message: 'authorization master ( none ) is invalid. Only global or instance are allowed.',
        line: i + 1,
        suggestion:
          'Use authorization master ( global ) or authorization master ( instance ), or omit until handlers exist.',
      });
    }
  }

  if (isOnPrem75x(context)) {
    // Target ONLY header-level `use etag` — i.e. `use etag;` in the preamble
    // between `projection;` and the first `define behavior` block. The
    // per-entity form `define behavior for X alias Y use etag { ... }`
    // (which SAP's own /DMO/C_TRAVEL_PROCESSOR_M uses, verified on-system)
    // is valid on all modern releases and MUST NOT be flagged.
    if (/\bprojection\s*;/i.test(source)) {
      const firstBehaviorIdx = source.search(/\bdefine\s+behavior\b/i);
      const preamble = firstBehaviorIdx >= 0 ? source.slice(0, firstBehaviorIdx) : source;
      // Header-level form is terminated by a semicolon (or end-of-preamble);
      // the per-entity form never has a terminating `;` directly after etag.
      const headerUseEtagMatch = /\buse\s+etag\s*;/i.exec(preamble);
      if (headerUseEtagMatch) {
        findings.push({
          severity: 'error',
          ruleId: 'BDEF_PROJECTION_USE_ETAG_UNSUPPORTED',
          message: 'Projection BDEF contains "use etag" as a header statement, which is not supported on on-prem 7.5x.',
          line: source.slice(0, headerUseEtagMatch.index).split(/\r?\n/).length,
          suggestion:
            'Move "use etag" into each "define behavior for X alias Y use etag { ... }" block instead of declaring it at the projection header level.',
        });
      }
    }
  }

  // Same field name used as etag master across multiple entities. SAP's own
  // /DMO/I_TRAVEL_M does this (both root and booking use last_changed_at) and
  // activates fine — so this is NOT a guaranteed failure. But when the fields
  // actually belong to different tables and have no semantic connection, etag
  // comparisons can behave unexpectedly on draft/update round-trips. We surface
  // it as a warning so the developer confirms the intent.
  const etagNames = Array.from(source.matchAll(/\betag\s+master\s+([A-Za-z_]\w*)/gi), (m) => m[1]?.toLowerCase() ?? '');
  const duplicate = firstDuplicate(etagNames);
  if (duplicate) {
    findings.push({
      severity: 'warning',
      ruleId: 'BDEF_DUPLICATE_ETAG_MASTER_NAME',
      message: `Multiple etag master declarations reuse "${duplicate}". Verify each entity's etag master refers to its own timestamp field.`,
      suggestion:
        'Reusing the same identifier across root and dependent entities works when both tables contain a column of that name (SAP /DMO/* does this). Double-check the fields are actually present and semantically represent last-changed on each entity.',
    });
  }
}

/**
 * DDLX (metadata extension) pre-write checks.
 *
 * Two distinct rule families here:
 *
 *  1. On-prem 7.5x only — DDLX_ANNOTATION_SCOPE_ONPREM_75X.
 *     ObjectModel annotations belong in the DDLS source on these releases
 *     (semanticKey/text.element rejected live on 758). UI.headerInfo and
 *     Search.searchable are allowed in metadata extensions, documented since
 *     7.52 and verified on 758; do not group them with ObjectModel (#941).
 *
 *  2. All releases — DDLX_DUPLICATE_UI_ANNOTATION.
 *     Developers sometimes stack multiple @UI.lineItem / @UI.fieldGroup /
 *     @UI.selectionField blocks above the same field, expecting them to
 *     merge. They don't — activation rejects it as a duplicate.
 *
 * The duplicate-detection walker is state-machine-like: blank lines and
 * non-UI annotation lines don't reset the `pendingKinds` buffer (stacking
 * annotations on consecutive lines is idiomatic), but once a field
 * declaration ends a block, we record what kinds were seen for that field
 * and clear the buffer for the next field.
 */
function validateDdlx(source: string, context: RapPreflightContext, findings: RapPreflightFinding[]): void {
  const lines = source.split('\n');

  if (isOnPrem75x(context)) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (/@ObjectModel\./i.test(line)) {
        findings.push({
          severity: 'error',
          ruleId: 'DDLX_ANNOTATION_SCOPE_ONPREM_75X',
          message: 'ObjectModel annotation scope is unsupported in DDLX on on-prem 7.5x.',
          line: i + 1,
          suggestion:
            'Move ObjectModel annotations to the DDLS source. UI.headerInfo and Search.searchable may remain in DDLX.',
        });
      }
    }
  }

  // Track which UI annotation "kinds" (lineItem / fieldGroup / selectionField)
  // have been applied per field. A second @UI.lineItem entry on the same
  // field is a duplicate regardless of qualifier.
  const perFieldSeen = new Map<string, Set<string>>();
  let pendingKinds: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const line = raw.trim();
    if (!line) continue;

    const annMatch = line.match(/^@UI\.(lineItem|fieldGroup|selectionField)\b/i);
    if (annMatch) {
      pendingKinds.push(`@UI.${annMatch[1].toLowerCase()}`);
      continue;
    }

    if (line.startsWith('@')) {
      // Non-targeted annotation — keep buffering UI kinds for the next field.
      continue;
    }

    const fieldMatch = line.match(/^([A-Za-z_]\w*)\s*;/);
    if (fieldMatch) {
      const field = fieldMatch[1]!.toLowerCase();
      const seenForField = perFieldSeen.get(field) ?? new Set<string>();
      const seenInCurrentBlock = new Set<string>();

      for (const kind of pendingKinds) {
        if (seenInCurrentBlock.has(kind) || seenForField.has(kind)) {
          findings.push({
            severity: 'error',
            ruleId: 'DDLX_DUPLICATE_UI_ANNOTATION',
            message: `Field "${field}" has duplicate ${kind} annotation entries.`,
            line: i + 1,
            suggestion: 'Consolidate each UI annotation type into one block per field.',
          });
        }
        seenInCurrentBlock.add(kind);
      }

      for (const kind of seenInCurrentBlock) {
        seenForField.add(kind);
      }
      perFieldSeen.set(field, seenForField);
      pendingKinds = [];
      continue;
    }

    // Anything that's neither an annotation nor a field declaration ends the
    // annotation-buffering window (e.g. `extend view entity ... with { ... }`).
    pendingKinds = [];
  }
}

/**
 * DDLS (CDS view entity) pre-write checks.
 *
 * Warning-only: explicit `client` field in the select list.
 *
 * For CDS view entities (the RAP-era successor to DDIC views), SAP handles
 * client filtering implicitly and including `client` in the select list
 * either triggers an activation warning or a hard error depending on
 * release. The safest guidance is to omit it entirely; existing customer
 * sources may be intentional, hence warning-only.
 *
 * Regex limitation (intentional): the pattern matches one flat `{ ... }`
 * select block and will miss `client` inside a nested association block
 * like `{ key c, _Assoc.{ client } }`. Upgrading this to a full CDS parser
 * isn't worth the complexity for a single warning — we accept the false
 * negative.
 */
function validateDdls(source: string, _context: RapPreflightContext, findings: RapPreflightFinding[]): void {
  const match = source.match(/\bselect\s+from\s+\w+\s*{\s*[^}]*\bclient\b[^}]*}/is);
  if (match) {
    findings.push({
      severity: 'warning',
      ruleId: 'DDLS_CLIENT_FIELD_IN_SELECT_LIST',
      message: 'CDS view entity select list appears to include client explicitly.',
      suggestion: 'For view entities, omit client from the select list and let SAP handle implicit client filtering.',
    });
  }
}

/**
 * True if the given line is within 5 lines of an annotation matching the
 * given pattern (stopping at the first non-annotation, non-blank line).
 *
 * Scope is kept small intentionally — TABL semantic annotations like
 * `@Semantics.amount.currencyCode` are conventionally written on the
 * immediately preceding line (or stacked with one or two other annotations
 * above the field). Widening the scan would produce false negatives when an
 * unrelated annotation block further up references the same currency key.
 */
function hasNearbyAnnotation(lines: string[], lineIndex: number, annotationPattern: RegExp): boolean {
  for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 5; i -= 1) {
    const candidate = (lines[i] ?? '').trim();
    if (!candidate) continue;
    if (annotationPattern.test(candidate)) return true;
    if (candidate.startsWith('@')) continue;
    break;
  }
  return false;
}

function firstDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

/**
 * True if the system is on-prem NetWeaver 7.5x (SAP_BASIS 750-759).
 *
 * Conservative by design — when we don't know the system type (e.g. feature
 * detection hasn't run, or the system is an unknown self-hosted variant),
 * we return false so on-prem-75x-only rules don't fire against modern
 * systems as false positives. BTP never qualifies.
 *
 * If systemType is 'onprem' but we couldn't parse the release, assume the
 * most common on-prem scenario (7.5x); customers on S/4 2020+ should always
 * have an abapRelease, so the undefined-release case realistically means
 * we're on older NW.
 */
function isOnPrem75x(context: RapPreflightContext): boolean {
  if (context.systemType === 'btp') return false;
  if (context.systemType !== 'onprem') return false;

  const release = parseAbapRelease(context.abapRelease);
  if (release === undefined) return true;
  return release >= 750 && release <= 759;
}

/**
 * Extract the numeric SAP_BASIS release from release strings like "754",
 * "7.54", "754 SP3". Strips non-digits and parses — imperfect but adequate
 * for the 75x / 75z comparison this module needs.
 */
function parseAbapRelease(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value.replace(/\D/g, ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

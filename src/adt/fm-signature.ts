/**
 * Function-module signature generator/parser/splicer (issue #252).
 *
 * SAP ADT exposes function-module parameters ONLY through the source body —
 * `/source/main` is the single channel. Parameters appear as ABAP source-based
 * signature syntax (`IMPORTING VALUE(name) TYPE type [DEFAULT x] [OPTIONAL]`)
 * between `FUNCTION <name>` and the trailing period that terminates the
 * signature. There is no separate metadata endpoint (verified live on a4h
 * S/4HANA 2023 + NPL 7.50 SP02 — see docs/plans/completed/add-fm-parameters.md).
 *
 * This module provides three pure functions:
 *   - `buildFmSignatureClause` — array → ABAP signature clause
 *   - `parseFmSignature`       — FM source → array (+ body bounds)
 *   - `spliceFmSignature`      — replace the signature region of FM source
 *
 * No I/O, no client coupling. The wiring lives in `src/handlers/intent.ts`.
 */

export type FmParameterKind = 'importing' | 'exporting' | 'changing' | 'tables' | 'exceptions' | 'raising';

export interface FmParameter {
  kind: FmParameterKind;
  /** Parameter / exception name. Always uppercase on output (SAP convention). */
  name: string;
  /**
   * ABAP type expression — verbatim. Examples:
   *   `STRING`, `I`, `BAPIRET2`, `TYPE STANDARD TABLE OF X`, `LIKE DOKHL-OBJECT`,
   *   `TYPE ANY ##ADT_PARAMETER_UNTYPED`.
   * Required for IMPORTING/EXPORTING/CHANGING/TABLES; ignored for EXCEPTIONS/RAISING.
   *
   * For TABLES, the leading keyword (`TYPE` / `LIKE`) is part of the type expression
   * since the older SAPGUI form uses `LIKE struct` while modern style uses `TYPE …`.
   */
  type?: string;
  /** Emit `VALUE(name)` wrapper. Default false (pass-by-reference). EXPORTING usually byValue. */
  byValue?: boolean;
  /** Raw ABAP literal — IMPORTING/CHANGING only. Emitted verbatim, no escaping. */
  default?: string;
  /** Emit `OPTIONAL` keyword. Implicit-true for EXPORTING (don't pass it explicitly). */
  optional?: boolean;
}

const KEYWORD_RE = /^\s*(IMPORTING|EXPORTING|CHANGING|TABLES|EXCEPTIONS|RAISING)\b/i;
const PARAM_LINE_RE = /^\s*(?:VALUE\s*\(\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s+(TYPE|LIKE)\s+(.+?)\s*$/i;
const SIMPLE_NAME_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/;
const KIND_ORDER: FmParameterKind[] = ['importing', 'exporting', 'changing', 'tables', 'exceptions', 'raising'];

/**
 * Build an ABAP signature clause from a structured parameter array.
 * Output is the multi-line clause without leading `FUNCTION` or trailing `.`.
 * Returns empty string for empty arrays.
 */
export function buildFmSignatureClause(params: FmParameter[]): string {
  if (params.length === 0) return '';

  const groups: Record<FmParameterKind, FmParameter[]> = {
    importing: [],
    exporting: [],
    changing: [],
    tables: [],
    exceptions: [],
    raising: [],
  };
  for (const p of params) {
    groups[p.kind].push(p);
  }

  const lines: string[] = [];
  for (const kind of KIND_ORDER) {
    const list = groups[kind];
    if (list.length === 0) continue;
    lines.push(`  ${kind.toUpperCase()}`);
    for (const p of list) {
      lines.push(`    ${formatParam(p)}`);
    }
  }
  return lines.join('\n');
}

function formatParam(p: FmParameter): string {
  const upperName = p.name.toUpperCase();
  if (p.kind === 'exceptions' || p.kind === 'raising') {
    return upperName;
  }
  // TABLES: type may be `LIKE struct` or `TYPE STANDARD TABLE …`. The user's
  // string already contains the keyword; emit verbatim.
  // For other kinds the type string is the bare type name; we prepend `TYPE `.
  const typeStr = (p.type ?? '').trim();
  const namePart = p.byValue ? `VALUE(${upperName})` : upperName;
  let line: string;
  if (p.kind === 'tables' && /^(TYPE|LIKE)\b/i.test(typeStr)) {
    line = `${namePart} ${typeStr}`;
  } else {
    line = `${namePart} TYPE ${typeStr}`;
  }
  if (p.default !== undefined && p.default !== '') {
    line += ` DEFAULT ${p.default}`;
  }
  if (p.optional === true) {
    line += ' OPTIONAL';
  }
  return line;
}

/**
 * Parse an FM source body. Returns the structured parameter array plus byte
 * offsets of the body (the region between the signature-terminator `.` and the
 * `ENDFUNCTION.` keyword).
 *
 * The parser is line-oriented and matches what SAP itself emits via /source/main:
 *   FUNCTION <name>
 *     KEYWORD
 *       <param-line>
 *       <param-line>
 *     KEYWORD
 *       …
 *   .
 *   …body…
 *   ENDFUNCTION.
 *
 * It does not validate ABAP semantics; the caller is responsible for passing
 * source through abaplint or the SAP-side syntax check before reactivating.
 */
export function parseFmSignature(source: string): {
  params: FmParameter[];
  bodyStart: number;
  bodyEnd: number;
} {
  const params: FmParameter[] = [];

  // Locate `FUNCTION <name>` token. Use `[A-Za-z0-9_]+` (not `\S+`) so the
  // trailing period of `FUNCTION x.` is NOT consumed by the name capture.
  const fnMatch = /^\s*FUNCTION\s+[A-Za-z_][A-Za-z0-9_]*/i.exec(source);
  if (!fnMatch) {
    return { params: [], bodyStart: 0, bodyEnd: source.length };
  }

  // Walk lines starting after `FUNCTION <name>` until the signature-terminator `.`
  // (a period that ends the FUNCTION statement). The signature-terminator is the
  // first `.` outside any string literal that appears at the end of a non-keyword,
  // non-param line — SAP emits it on its own line after the last parameter.
  // If no keyword was seen and we hit a bare `.` (e.g. `FUNCTION x.`), that's
  // also a valid signature-terminator (parameter-less FM).
  const cursor = fnMatch.index + fnMatch[0].length;
  let currentKind: FmParameterKind | null = null;
  let bodyStart = source.length;

  // Fast-path: a bare `.` immediately after `FUNCTION <name>` (with optional
  // whitespace) means no signature clause. bodyStart is just after the period.
  const tailAfterName = source.slice(cursor);
  const bareTermMatch = /^\s*\./.exec(tailAfterName);
  if (bareTermMatch) {
    let bs = cursor + bareTermMatch[0].length;
    if (source[bs] === '\r') bs++;
    if (source[bs] === '\n') bs++;
    const endMatch = /\bENDFUNCTION\b/i.exec(source);
    return {
      params: [],
      bodyStart: bs,
      bodyEnd: endMatch ? endMatch.index : source.length,
    };
  }

  const lines = tailAfterName.split('\n');
  let lineStartOffset = cursor;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineEndOffset = lineStartOffset + line.length;

    // Skip comment-only lines (full-line `*` comments) and empty lines.
    const trimmed = line.trim();
    if (trimmed === '' || /^\*/.test(trimmed)) {
      lineStartOffset = lineEndOffset + 1;
      continue;
    }

    // Strip inline `"`-comments before further analysis.
    const codeOnly = stripInlineComment(line);
    const codeTrimmed = codeOnly.trim();

    // Keyword line?
    const kwMatch = KEYWORD_RE.exec(codeOnly);
    if (kwMatch) {
      currentKind = kwMatch[1]?.toLowerCase() as FmParameterKind;
      // Tail after the keyword — could contain a parameter on the same line, e.g.
      //   `IMPORTING VALUE(IV_X) TYPE STRING.`
      const tail = codeOnly.slice(
        codeOnly.toLowerCase().indexOf(kwMatch[1]?.toLowerCase() ?? '') + (kwMatch[1]?.length ?? 0),
      );
      const tailTrimmed = tail.trim();
      const terminatorPos = findSignatureTerminator(tailTrimmed);
      const tailContent = terminatorPos >= 0 ? tailTrimmed.slice(0, terminatorPos) : tailTrimmed;
      if (tailContent !== '') {
        addParamFromLine(params, currentKind, tailContent);
      }
      if (terminatorPos >= 0) {
        // The `.` ends the FUNCTION signature.
        bodyStart = computeBodyStartOffset(source, lineStartOffset, codeOnly, tail, terminatorPos);
        break;
      }
      lineStartOffset = lineEndOffset + 1;
      continue;
    }

    // Parameter line under the current keyword.
    if (currentKind !== null) {
      const terminatorPos = findSignatureTerminator(codeTrimmed);
      const lineContent = terminatorPos >= 0 ? codeTrimmed.slice(0, terminatorPos) : codeTrimmed;
      if (lineContent !== '') {
        addParamFromLine(params, currentKind, lineContent);
      }
      if (terminatorPos >= 0) {
        bodyStart = computeBodyStartOffset(source, lineStartOffset, codeOnly, codeOnly, terminatorPos);
        break;
      }
    }

    lineStartOffset = lineEndOffset + 1;
  }

  // Locate ENDFUNCTION (case-insensitive); body ends at the start of that line.
  const endMatch = /\bENDFUNCTION\b/i.exec(source);
  const bodyEnd = endMatch ? endMatch.index : source.length;

  return { params, bodyStart, bodyEnd };
}

/**
 * Find the position of the signature-terminator `.` in a line, ignoring `.` inside
 * single-quoted string literals (`'…'`) and template-strings (\`…\`). Returns -1
 * if no terminator found on this line.
 *
 * (Multi-line string literals are not legal in an ABAP FUNCTION signature, so a
 * line-scoped check is sufficient.)
 */
function findSignatureTerminator(line: string): number {
  let inSingle = false;
  let inTemplate = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inTemplate) {
      // Two consecutive `''` inside a string is an escaped quote — don't toggle.
      if (inSingle && line[i + 1] === "'") {
        i++;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (ch === '`' && !inSingle) {
      if (inTemplate && line[i + 1] === '`') {
        i++;
        continue;
      }
      inTemplate = !inTemplate;
      continue;
    }
    if (ch === '.' && !inSingle && !inTemplate) {
      return i;
    }
  }
  return -1;
}

function computeBodyStartOffset(
  source: string,
  lineStartOffset: number,
  codeOnly: string,
  _tailOrCode: string,
  terminatorPosInTrimmed: number,
): number {
  // We were given the line's "code only" (inline comments stripped) — but the
  // terminator position is relative to the *trimmed* tail. Translate it back.
  const trimmedStart = codeOnly.length - codeOnly.trimStart().length;
  const terminatorAbs = lineStartOffset + trimmedStart + terminatorPosInTrimmed;
  // bodyStart is the offset just AFTER the `.` (and any trailing newline).
  let bodyStart = terminatorAbs + 1;
  if (source[bodyStart] === '\r') bodyStart++;
  if (source[bodyStart] === '\n') bodyStart++;
  return bodyStart;
}

function stripInlineComment(line: string): string {
  // ABAP inline comment: `"` outside a string literal, to end of line.
  let inSingle = false;
  let inTemplate = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inTemplate) {
      if (inSingle && line[i + 1] === "'") {
        i++;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (ch === '`' && !inSingle) {
      if (inTemplate && line[i + 1] === '`') {
        i++;
        continue;
      }
      inTemplate = !inTemplate;
      continue;
    }
    if (ch === '"' && !inSingle && !inTemplate) {
      return line.slice(0, i);
    }
  }
  return line;
}

function addParamFromLine(params: FmParameter[], kind: FmParameterKind, lineContent: string): void {
  const trimmed = lineContent.trim();
  if (trimmed === '') return;

  if (kind === 'exceptions' || kind === 'raising') {
    const m = SIMPLE_NAME_RE.exec(trimmed);
    if (m?.[1]) {
      params.push({ kind, name: m[1].toUpperCase() });
    }
    return;
  }

  const m = PARAM_LINE_RE.exec(trimmed);
  if (!m) return;
  const [, rawName, typeKeyword, rest] = m;
  if (!rawName || !typeKeyword || !rest) return;

  // `byValue` is true iff the matched chunk between the line start and the name
  // contained a `VALUE(`. Cheapest detection: check whether the original trimmed
  // string starts with `VALUE` (case-insensitive).
  const byValue = /^\s*VALUE\s*\(/i.test(trimmed);

  // For TABLES, prepend the keyword (TYPE/LIKE) so the type round-trips verbatim.
  // For other kinds, drop the keyword (ARC-1's emit prepends `TYPE`).
  let typeStr: string;
  let optional = false;
  let defaultExpr: string | undefined;

  // Split off OPTIONAL and DEFAULT modifiers from the trailing portion.
  let remaining = rest.trim();
  // OPTIONAL is a standalone trailing word.
  const optMatch = /\s+OPTIONAL\s*$/i.exec(remaining);
  if (optMatch) {
    optional = true;
    remaining = remaining.slice(0, optMatch.index).trim();
  }
  // DEFAULT introduces an expression up to the end (after stripping OPTIONAL).
  const defMatch = /\s+DEFAULT\s+(.+)$/i.exec(remaining);
  if (defMatch) {
    defaultExpr = (defMatch[1] ?? '').trim();
    remaining = remaining.slice(0, defMatch.index).trim();
  }

  if (kind === 'tables') {
    typeStr = `${typeKeyword.toUpperCase()} ${remaining}`.trim();
  } else {
    typeStr = remaining;
  }

  const param: FmParameter = {
    kind,
    name: rawName.toUpperCase(),
    type: typeStr,
  };
  if (byValue) param.byValue = true;
  if (optional) param.optional = true;
  if (defaultExpr !== undefined && defaultExpr !== '') param.default = defaultExpr;
  params.push(param);
}

/**
 * Replace the signature region of an FM source with a new clause built from
 * `params`. The body (between the signature-terminator `.` and `ENDFUNCTION.`)
 * is preserved verbatim. Throws when `source` does not start with a `FUNCTION`
 * keyword — caller is expected to fall back to the user's raw source.
 */
export function spliceFmSignature(source: string, fmName: string, params: FmParameter[]): string {
  if (!/^\s*FUNCTION\s+/i.test(source)) {
    throw new Error('FM source does not start with FUNCTION keyword');
  }

  const parsed = parseFmSignature(source);
  const body = source.slice(parsed.bodyStart, parsed.bodyEnd);
  const upperName = fmName.toUpperCase();

  if (params.length === 0) {
    // No signature → just FUNCTION <name>. <body> ENDFUNCTION.
    const bodyTrimmed = body.replace(/^\s*\n/, '');
    return `FUNCTION ${upperName}.\n${bodyTrimmed}ENDFUNCTION.\n`;
  }

  const clause = buildFmSignatureClause(params);
  const bodyTrimmed = body.replace(/^\s*\n/, '');
  return `FUNCTION ${upperName}\n${clause}.\n${bodyTrimmed}ENDFUNCTION.\n`;
}

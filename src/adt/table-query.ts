/** Safe SQL builder and row-limit helpers for ADT data-preview requests. */

import { canonicalDataSourceName } from './data-source-name.js';

/** ADT's freestyle handler cuts each input line here (verified on 7.58 and 8.16). */
const FREESTYLE_SQL_LINE_MAX = 255;
const LINE_WRAP_REFUSAL =
  "Cannot fit freestyle SQL into SAP's 255-character lines. Add line breaks between tokens; long literals, comments, and templates cannot be split safely.";

/** Find a break that advances the line without splitting a literal or creating a comment. */
function findSafeLineBreak(line: string, segmentStart: number): number | undefined {
  let lastSafeBreak: number | undefined;
  // Each segment starts outside a literal: the preceding break was outside one too.
  let quoteDelimiter: "'" | '`' | undefined;
  const lineLimit = segmentStart + FREESTYLE_SQL_LINE_MAX;

  for (let index = segmentStart; index <= lineLimit; index++) {
    const char = line[index];
    if (quoteDelimiter !== undefined) {
      if (char !== quoteDelimiter) continue;
      if (line[index + 1] === quoteDelimiter) {
        index++; // Doubled delimiters belong to the literal.
      } else {
        quoteDelimiter = undefined;
      }
      continue;
    }

    if (char === "'" || char === '`') {
      quoteDelimiter = char;
      continue;
    }
    if (char === '"' || char === '|') {
      break; // Do not wrap inside an inline comment or attempt to parse a template.
    }

    const isWhitespace = char === ' ' || char === '\t';
    if (isWhitespace && index > segmentStart && line[index + 1] !== '*') {
      lastSafeBreak = index; // A column-one '*' would turn the new line into a comment.
    }
  }
  return lastSafeBreak;
}

/** Replace only whitespace outside literals, preserving tokens and existing comment boundaries. */
export function fitFreestyleSqlLines(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      // CRLF's carriage return is not part of the SQL line; preserve it in the final slice.
      const lineLength = line.endsWith('\r') ? line.length - 1 : line.length;
      if (lineLength <= FREESTYLE_SQL_LINE_MAX) return line;
      if (line.startsWith('*')) throw new Error(LINE_WRAP_REFUSAL);

      const parts: string[] = [];
      let segmentStart = 0;
      while (lineLength - segmentStart > FREESTYLE_SQL_LINE_MAX) {
        const breakAt = findSafeLineBreak(line, segmentStart);
        if (breakAt === undefined) throw new Error(LINE_WRAP_REFUSAL);
        parts.push(line.slice(segmentStart, breakAt));
        segmentStart = breakAt + 1;
      }
      parts.push(line.slice(segmentStart));
      return parts.join('\n');
    })
    .join('\n');
}

/** Allowed SQL comparison operators for TABLE_QUERY where conditions. */
const ALLOWED_OPS = new Set([
  '=',
  '!=',
  '<>',
  '<',
  '<=',
  '>',
  '>=',
  'LIKE',
  'NOT LIKE',
  'IN',
  'NOT IN',
  'IS NULL',
  'IS NOT NULL',
]);

// BETWEEN is intentionally excluded: the value would require parsing "low AND high"
// where AND is a reserved word, making safe escaping complex and error-prone.
// Use two separate conditions (>= low, <= high) instead.

/** Build a safe IN/NOT IN list from comma-separated raw values. */
function buildInList(raw: string): string {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  const parts = inner.split(',').map((part) => `'${part.trim().replace(/'/g, "''")}'`);
  return `(${parts.join(', ')})`;
}

/** Upper bound for an in-memory TABLE_QUERY result. */
const MAX_TABLE_QUERY_ROWS = 10_000;

/** Coerce a caller-supplied row limit into [1, MAX_TABLE_QUERY_ROWS]. */
export function clampPreviewRows(requested: number | undefined, fallback = 100): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) return fallback;
  return Math.min(Math.floor(requested), MAX_TABLE_QUERY_ROWS);
}

/**
 * Validate a caller-supplied SQL identifier exactly. It is NEVER rewritten.
 *
 * The previous implementation stripped disallowed characters (`raw.toUpperCase().replace(/[^\w/]/g, '')`).
 * That made the identifier ARC-1 authorized differ from the identifier it executed: `USR02$` was checked
 * as `USR02$` but executed as `USR02`. Silent rewriting is therefore banned outright — including when
 * the blocklist is off, so the identifier contract does not depend on policy state. The only permitted
 * transformation is ASCII case folding, which is what makes "checked name" and "executed name"
 * byte-for-byte equal.
 */
export function exactSqlIdentifier(raw: string, kind: 'table' | 'column' | 'field'): string {
  return canonicalDataSourceName(raw, `TABLE_QUERY ${kind} name`);
}

/**
 * Build a safe static SELECT from structured TABLE_QUERY parameters.
 *
 * Identifiers are validated, not sanitized; values are quoted and escaped, and IN/NOT IN values
 * cannot become subqueries. Pass an already-canonical table name when the caller has authorized it,
 * so the authorized and executed identities are the same string.
 */
export function buildTableQuerySql(
  tableName: string,
  columns?: string[],
  where?: Array<{ field: string; op: string; value?: string }>,
): string {
  const safeTable = exactSqlIdentifier(tableName, 'table');
  const colList = columns?.length ? columns.map((column) => exactSqlIdentifier(column, 'column')).join(', ') : '*';
  let sql = `SELECT ${colList} FROM ${safeTable}`;

  if (where?.length) {
    const clauses = where.map(({ field, op, value }) => {
      const safeField = exactSqlIdentifier(field, 'field');
      const safeOp = op.trim().toUpperCase();
      if (!ALLOWED_OPS.has(safeOp)) throw new Error(`TABLE_QUERY: operator "${op}" is not allowed`);
      if (safeOp === 'IS NULL' || safeOp === 'IS NOT NULL') return `${safeField} ${safeOp}`;
      if (safeOp === 'IN' || safeOp === 'NOT IN') return `${safeField} ${safeOp} ${buildInList(String(value ?? ''))}`;
      return `${safeField} ${safeOp} '${String(value ?? '').replace(/'/g, "''")}'`;
    });
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }

  // ADT freestyle SQL rejects ORDER BY on NW 7.50/7.51; callers sort client-side.
  return sql;
}

/**
 * Execute statements that have ALREADY been authorized by the data-source policy.
 *
 * Kept beside the SQL builder rather than in the ADT facade, but deliberately NOT exported as a
 * public client method: authorization and execution must stay inside one private client operation so
 * no caller can obtain a reusable "already authorized" handle.
 */
export async function executeDataPreviewStatements(
  post: (sql: string, rowLimit: number) => Promise<string>,
  parse: (body: string) => { columns: string[]; rows: Record<string, string>[] },
  statements: string[],
  rowLimit: number,
): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
  const rows: Record<string, string>[] = [];
  let columns: string[] = [];
  for (const statement of statements) {
    const remaining = rowLimit - rows.length;
    if (remaining <= 0) break;
    const chunk = parse(await post(statement, remaining));
    if (columns.length === 0) columns = chunk.columns;
    rows.push(...chunk.rows);
  }
  return { columns, rows: rows.slice(0, rowLimit) };
}

/** Safe SQL builder and row-limit helpers for ADT data-preview requests. */

import { canonicalDataSourceName } from './data-source-name.js';

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

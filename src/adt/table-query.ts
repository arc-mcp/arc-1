/** Safe SQL builder and row-limit helpers for ADT data-preview requests. */

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

/** Sanitize a SQL identifier used by the structured TABLE_QUERY builder. */
function sanitizeIdentifier(raw: string, kind: 'table' | 'column' | 'field'): string {
  const safe = raw.toUpperCase().replace(/[^\w/]/g, '');
  if (!safe) throw new Error(`TABLE_QUERY: ${kind} name "${raw}" is invalid (empty after sanitization)`);
  return safe;
}

/**
 * Build a safe static SELECT from structured TABLE_QUERY parameters.
 * Values are quoted and escaped; IN/NOT IN values cannot become subqueries.
 */
export function buildTableQuerySql(
  tableName: string,
  columns?: string[],
  where?: Array<{ field: string; op: string; value?: string }>,
): string {
  const safeTable = sanitizeIdentifier(tableName, 'table');
  const colList = columns?.length ? columns.map((column) => sanitizeIdentifier(column, 'column')).join(', ') : '*';
  let sql = `SELECT ${colList} FROM ${safeTable}`;

  if (where?.length) {
    const clauses = where.map(({ field, op, value }) => {
      const safeField = sanitizeIdentifier(field, 'field');
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

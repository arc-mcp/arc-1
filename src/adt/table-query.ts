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

function buildInList(raw: string): string {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed;
  const parts = inner.split(',').map((part) => `'${part.trim().replace(/'/g, "''")}'`);
  return `(${parts.join(', ')})`;
}

const MAX_TABLE_QUERY_ROWS = 10_000;

/** Coerce a row limit to a positive integer within ARC-1's data-preview ceiling. */
export function clampPreviewRows(requested: number | undefined, fallback = 100): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) return fallback;
  return Math.min(Math.floor(requested), MAX_TABLE_QUERY_ROWS);
}

function sanitizeIdentifier(raw: string, kind: 'table' | 'column' | 'field'): string {
  const safe = raw.toUpperCase().replace(/[^\w/]/g, '');
  if (!safe) throw new Error(`TABLE_QUERY: ${kind} name "${raw}" is invalid (empty after sanitization)`);
  return safe;
}

/** Build a safe SELECT from structured table-query parameters. */
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
      if (safeOp === 'IN' || safeOp === 'NOT IN') {
        return `${safeField} ${safeOp} ${buildInList(String(value ?? ''))}`;
      }
      return `${safeField} ${safeOp} '${String(value ?? '').replace(/'/g, "''")}'`;
    });
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }

  // ORDER BY is omitted because the ADT freestyle endpoint rejects it on NW 7.50/7.51.
  return sql;
}

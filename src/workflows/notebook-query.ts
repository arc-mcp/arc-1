import { z } from 'zod';
import { analyzeSqlDataSources } from '../adt/sql-source-analyzer.js';
import { maskSqlStringLiterals } from '../handlers/query-errors.js';

const queryResult = z.object({
  rowsReturned: z.number().int().nonnegative().safe(),
  totalRows: z.number().int().nonnegative().safe().optional(),
  columns: z.array(z.string().min(1).max(128)).min(1).max(512),
  rows: z.array(z.record(z.string(), z.string())).max(10_000),
  executedQueryString: z.string().optional(),
  queryExecutionTimeMs: z.number().nonnegative().optional(),
  // Honor explicit incompleteness from compatible adapters; current SAPQuery emits row counts.
  truncated: z.boolean().optional(),
  complete: z.boolean().optional(),
});

export function parseNotebookQuery(input: unknown, maxRows: number, sql: string) {
  const data = queryResult.parse(input);
  const columns = new Set(data.columns);
  let scalarAggregate = false;
  if (data.columns.length === 1) {
    try {
      assertScalarAggregate(sql, data.columns[0]!);
      scalarAggregate = true;
    } catch {
      // Other queries retain the ordinary row-count completeness checks.
    }
  }
  if (
    columns.size !== data.columns.length ||
    data.rowsReturned !== data.rows.length ||
    data.rows.length > maxRows ||
    (!scalarAggregate && data.totalRows !== undefined && data.totalRows < data.rows.length) ||
    data.rows.some(
      (row) => Object.keys(row).length !== columns.size || Object.keys(row).some((key) => !columns.has(key)),
    )
  )
    throw new Error('Inconsistent query row or column metadata.');
  const complete =
    data.truncated !== true &&
    data.complete !== false &&
    // SAP can report matched input records in totalRows for a scalar aggregate, including zero.
    (scalarAggregate
      ? data.rows.length === 1
      : data.totalRows !== undefined
        ? data.totalRows === data.rows.length
        : data.rows.length < maxRows);
  return { ...data, complete, scalarAggregate };
}

/** Deliberately small assertion contract: one simple aggregate projection, with an explicit alias. */
export function assertScalarAggregate(sql: string, column: string): void {
  const masked = maskSqlStringLiterals(sql);
  const projection =
    /^\s*SELECT\s+(?:COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(?:DISTINCT\s+)?(?:\*|[A-Za-z_][\w]*(?:~[A-Za-z_][\w]*)?)\s*\)\s+AS\s+([A-Za-z_][\w]*)\s+FROM\b/i.exec(
      masked,
    );
  if (
    !projection ||
    projection[1]?.toUpperCase() !== column.toUpperCase() ||
    (masked.match(/\bSELECT\b/gi)?.length ?? 0) !== 1 ||
    /\b(?:GROUP\s+BY|HAVING|UNION|INTERSECT|EXCEPT|UP\s+TO|OFFSET|SINGLE|OVER)\b/i.test(masked)
  ) {
    throw new Error(
      'Assertions require one scalar aggregate SELECT with an AS column, without grouping, windows, paging or subqueries.',
    );
  }
  // Reuse the existing parser to reject comments, multiple statements, host expressions and ambiguous SQL.
  analyzeSqlDataSources(sql);
}

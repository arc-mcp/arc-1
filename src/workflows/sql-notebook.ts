import { createHash } from 'node:crypto';
import { awaitWithRequestSignal } from '../adt/http-deadline.js';
import { generateRequestId, getCurrentContext, requestContext } from '../server/context.js';
import { artifactHtml, callText, type ToolInvoker, WorkflowCallError } from './artifact.js';
import { assertNotebookSize, notebookSchema } from './notebook-document.js';
import { assertScalarAggregate, parseNotebookQuery } from './notebook-query.js';

export { importAbapSql, notebookSchema, type SqlNotebook } from './notebook-document.js';
export interface NotebookConnection {
  identity: string;
  client: string;
  call: ToolInvoker;
}
type CellStatus = 'success' | 'incomplete' | 'blocked' | 'error' | 'not-run';
interface AssertionEvidence {
  sql: string;
  sqlHash: string;
  column: string;
  expected: string;
  status: 'passed' | 'failed' | Exclude<CellStatus, 'success'>;
  actual?: string;
  note?: string;
  checkedAt?: string;
  elapsedMs?: number;
  backendMs?: number;
  backendTotalRows?: number;
}
interface CellEvidence {
  id: string;
  kind: 'markdown' | 'sql';
  value?: string;
  status?: CellStatus;
  sql?: string;
  sqlHash?: string;
  target?: string;
  logicalTarget?: string;
  client?: string;
  maxRows?: number;
  startedAt?: string;
  elapsedMs?: number;
  rowsReturned?: number;
  totalRows?: number;
  scalarAggregate?: boolean;
  backendMs?: number;
  executedSql?: string;
  executedSqlHash?: string;
  completeness?: 'complete' | 'limited-or-unknown';
  columns?: string[];
  rows?: Record<string, string>[];
  note?: string;
  resultsOmitted?: string;
  assertion?: AssertionEvidence;
}
export interface NotebookRun {
  schemaVersion: 1;
  kind: 'arc1-notebook-run';
  title: string;
  startedAt: string;
  finishedAt?: string;
  cells: CellEvidence[];
  status: 'success' | 'partial';
  resultsIncluded: boolean;
  responseBytes: number;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
class NotebookLimitError extends Error {}

/** Sequential calls reuse existing SQL gates; cancellation reaches dispatch and its data-result scope. */
export async function runNotebook(
  input: unknown,
  connections: Record<string, NotebookConnection>,
  options: { includeResults?: boolean; signal?: AbortSignal } = {},
): Promise<NotebookRun> {
  assertNotebookSize(input);
  const notebook = notebookSchema.parse(input);
  for (const cell of notebook.cells)
    if (cell.kind === 'sql') {
      if (!Object.hasOwn(connections, cell.target))
        throw new Error(`No authorized connection mapped to ${cell.target}.`);
      if (cell.assertion) assertScalarAggregate(cell.assertion.sql, cell.assertion.column);
    }
  const inherited = getCurrentContext();
  const signals = [AbortSignal.timeout(5 * 60_000), options.signal, inherited?.signal].filter(
    (s): s is AbortSignal => !!s,
  );
  const signal = AbortSignal.any(signals);
  const run: NotebookRun = {
    schemaVersion: 1,
    kind: 'arc1-notebook-run',
    title: notebook.title,
    startedAt: new Date().toISOString(),
    cells: [],
    status: 'success',
    resultsIncluded: options.includeResults === true,
    responseBytes: 0,
  };
  let exportedBytes = 0;
  let stopped = false;
  const limitNote =
    'Notebook cancelled or its five-minute/8-MiB collection limit reached; remaining queries were not executed.';
  async function query(connection: NotebookConnection, sql: string, maxRows: number) {
    if (signal.aborted || stopped) throw new NotebookLimitError(limitNote);
    const text = await requestContext.run(
      { ...inherited, requestId: inherited?.requestId ?? generateRequestId(), signal },
      () => awaitWithRequestSignal(callText(connection.call, 'SAPQuery', { sql, maxRows }), signal),
    );
    run.responseBytes += Buffer.byteLength(text);
    if (run.responseBytes > 8 * 1024 * 1024) {
      stopped = true;
      throw new NotebookLimitError(limitNote);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Expected valid structured SAPQuery evidence.');
    }
    return parseNotebookQuery(data, maxRows, sql);
  }
  function failure(error: unknown): { status: Exclude<CellStatus, 'success' | 'not-run'>; note: string } {
    if (error instanceof NotebookLimitError || signal.aborted) return { status: 'incomplete', note: limitNote };
    return {
      status: error instanceof WorkflowCallError ? error.status : 'error',
      note: error instanceof Error ? error.message : 'Execution failed.',
    };
  }
  for (const cell of notebook.cells) {
    if (cell.kind === 'markdown') {
      run.cells.push({ id: cell.id, kind: cell.kind, value: cell.value });
      continue;
    }
    const connection = connections[cell.target]!;
    const entry: CellEvidence = {
      id: cell.id,
      kind: 'sql',
      sql: cell.value,
      sqlHash: hash(cell.value),
      target: connection.identity,
      logicalTarget: cell.target,
      client: connection.client,
      maxRows: cell.maxRows,
    };
    const start = Date.now();
    if (signal.aborted || stopped) {
      entry.status = 'not-run';
      entry.note = limitNote;
    } else
      try {
        entry.startedAt = new Date().toISOString();
        const data = await query(connection, cell.value, cell.maxRows);
        entry.status = data.complete ? 'success' : 'incomplete';
        entry.completeness = data.complete ? 'complete' : 'limited-or-unknown';
        entry.rowsReturned = data.rowsReturned;
        entry.totalRows = data.totalRows;
        entry.scalarAggregate = data.scalarAggregate;
        entry.backendMs = data.queryExecutionTimeMs;
        entry.executedSql = data.executedQueryString;
        entry.executedSqlHash = data.executedQueryString ? hash(data.executedQueryString) : undefined;
        if (options.includeResults) {
          const bytes = Buffer.byteLength(JSON.stringify({ columns: data.columns, rows: data.rows }));
          if (exportedBytes + bytes <= 4 * 1024 * 1024) {
            entry.columns = data.columns;
            entry.rows = data.rows;
            exportedBytes += bytes;
          } else {
            entry.resultsOmitted = 'Execution report exceeded its 4-MiB result export allowance.';
            entry.status = 'incomplete';
          }
        }
      } catch (error) {
        Object.assign(entry, failure(error));
      }
    if (entry.startedAt) entry.elapsedMs = Date.now() - start;
    if (cell.assertion) {
      const a = cell.assertion;
      const evidence: AssertionEvidence = {
        sql: a.sql,
        sqlHash: hash(a.sql),
        column: a.column,
        expected: a.equals,
        status: 'not-run',
      };
      entry.assertion = evidence;
      // Failed/blocked detail cells never trigger extra SQL. Limited detail may still have a valid scalar check.
      if ((entry.status === 'success' || entry.status === 'incomplete') && !signal.aborted && !stopped) {
        const checked = Date.now();
        evidence.checkedAt = new Date().toISOString();
        try {
          const result = await query(connection, a.sql, 2);
          const names = result.columns.filter((name) => name.toUpperCase() === a.column.toUpperCase());
          const actual = names.length === 1 ? result.rows[0]?.[names[0]!] : undefined;
          evidence.status =
            !result.complete || result.rows.length !== 1 || result.columns.length !== 1 || actual === undefined
              ? 'incomplete'
              : actual === a.equals
                ? 'passed'
                : 'failed';
          evidence.backendMs = result.queryExecutionTimeMs;
          evidence.backendTotalRows = result.totalRows;
          if (options.includeResults && actual !== undefined) {
            const bytes = Buffer.byteLength(JSON.stringify(actual));
            if (exportedBytes + bytes <= 4 * 1024 * 1024) {
              evidence.actual = actual;
              exportedBytes += bytes;
            } else {
              evidence.note = 'Actual value omitted: result export allowance exhausted.';
              entry.status = 'incomplete';
            }
          }
        } catch (error) {
          Object.assign(evidence, failure(error));
        }
        evidence.elapsedMs = Date.now() - checked;
      }
    }
    if (entry.status !== 'success' || (entry.assertion && entry.assertion.status !== 'passed')) run.status = 'partial';
    run.cells.push(entry);
  }
  run.finishedAt = new Date().toISOString();
  return run;
}

export function renderNotebookRun(run: NotebookRun) {
  return artifactHtml(run.title, [
    {
      title: `${run.status.toUpperCase()} · ${run.startedAt}`,
      text: `Results exported: ${run.resultsIncluded}. Detail completeness and the separate aggregate assertion are independent. Calls are sequential, not an atomic data snapshot.`,
    },
    ...run.cells.map((cell) =>
      cell.kind === 'markdown'
        ? { title: cell.id, text: cell.value ?? '' }
        : {
            title: `${cell.id} · ${cell.status}`,
            text: [
              `Target: ${cell.target} · client ${cell.client}`,
              `Rows: ${cell.rowsReturned ?? 'unavailable'} · ${cell.completeness ?? cell.status}`,
              `Elapsed: ${cell.elapsedMs ?? 'not run'}${cell.elapsedMs === undefined ? '' : ' ms'} · SAP: ${cell.backendMs ?? 'unknown'} ms`,
              cell.assertion ? `Aggregate assertion: ${cell.assertion.status}` : '',
              cell.note ?? '',
              '',
              cell.sql ?? '',
            ]
              .filter(Boolean)
              .join('\n'),
            detail: JSON.stringify(cell, null, 2),
          },
    ),
  ]);
}

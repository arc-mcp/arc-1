/**
 * SAPQuery handler — freestyle SQL execution with IN-list chunking + SQL literal parsing.
 */

import type { AdtClient } from '../adt/client.js';
import { AdtApiError, extractUnknownColumn, formatUnknownColumnHint } from '../adt/errors.js';
import type { DataPreviewMeta } from '../adt/xml-parser.js';
import { classifySapQueryParserError, maskSqlStringLiterals } from './query-errors.js';
import { errorResult, type ToolResult, textResult } from './shared.js';

const SAPQUERY_IN_LIST_CHUNK_SIZE = 8;

interface SimpleInListChunkPlan {
  statements: string[];
}

function planSimpleInListChunking(
  sql: string,
  chunkSize = SAPQUERY_IN_LIST_CHUNK_SIZE,
): SimpleInListChunkPlan | undefined {
  const maskedSql = maskSqlStringLiterals(sql);
  if (maskedSql.includes(';')) return undefined;
  if (countSelectKeywords(maskedSql) !== 1) return undefined;
  if (
    /\bSELECT\s+SINGLE\b/i.test(maskedSql) ||
    /\bUP\s+TO\s+\d+\s+ROWS?\b/i.test(maskedSql) ||
    /\bGROUP\s+BY\b/i.test(maskedSql) ||
    /\bHAVING\b/i.test(maskedSql) ||
    /\bORDER\s+BY\b/i.test(maskedSql) ||
    /\bUNION\b/i.test(maskedSql) ||
    /\bDISTINCT\b/i.test(maskedSql) ||
    /\b(?:COUNT|SUM|AVG|MIN|MAX|STRING_AGG)\s*\(/i.test(maskedSql)
  ) {
    return undefined;
  }

  const matches = [...maskedSql.matchAll(/\b[A-Za-z_][A-Za-z0-9_~.]*\s+IN\s*\(/gi)];
  let winner: { openParen: number; closeParen: number; literals: string[] } | undefined;

  for (const match of matches) {
    const matchText = match[0];
    const fieldName = matchText.match(/^([A-Za-z_][A-Za-z0-9_~.]*)\s+IN\s*\(/i)?.[1];
    if (!fieldName || fieldName.toUpperCase() === 'NOT') continue;

    const matchStart = match.index ?? 0;
    const openParen = matchStart + matchText.lastIndexOf('(');
    const closeParen = findMatchingParen(maskedSql, openParen);
    if (closeParen < 0) continue;

    const parsed = parseSingleQuotedLiteralList(sql.slice(openParen + 1, closeParen));
    if (!parsed || parsed.length === 0) continue;
    const literals = [...new Set(parsed)];
    if (!winner || literals.length > winner.literals.length) winner = { openParen, closeParen, literals };
  }

  if (!winner || winner.literals.length <= chunkSize) return undefined;

  const prefix = sql.slice(0, winner.openParen + 1);
  const suffix = sql.slice(winner.closeParen);
  const statements: string[] = [];
  for (let i = 0; i < winner.literals.length; i += chunkSize) {
    statements.push(`${prefix}${winner.literals.slice(i, i + chunkSize).join(', ')}${suffix}`);
  }

  return { statements };
}

function countSelectKeywords(maskedSql: string): number {
  return [...maskedSql.matchAll(/\bSELECT\b/gi)].length;
}

function findMatchingParen(text: string, openParen: number): number {
  let depth = 0;
  for (let i = openParen; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseSingleQuotedLiteralList(listText: string): string[] | undefined {
  const literals: string[] = [];
  let i = 0;
  let expectingValue = true;

  while (i < listText.length) {
    while (i < listText.length && /\s/.test(listText[i]!)) i++;
    if (i >= listText.length) return expectingValue && literals.length > 0 ? undefined : literals;
    if (!expectingValue || listText[i] !== "'") return undefined;

    const start = i;
    i++;
    let closed = false;
    while (i < listText.length) {
      if (listText[i] === "'") {
        if (listText[i + 1] === "'") {
          i += 2;
          continue;
        }
        i++;
        closed = true;
        break;
      }
      i++;
    }
    if (!closed) return undefined;
    literals.push(listText.slice(start, i));
    expectingValue = false;

    while (i < listText.length && /\s/.test(listText[i]!)) i++;
    if (i >= listText.length) return literals;
    if (listText[i] !== ',') return undefined;
    i++;
    expectingValue = true;
  }

  return expectingValue && literals.length > 0 ? undefined : literals;
}

interface QuerySource {
  table: string;
  alias?: string;
}

function resolveUnknownColumnTable(sql: string, badColumn: string): string | undefined {
  const maskedSql = maskSqlStringLiterals(sql);
  const sources: QuerySource[] = [];

  for (const match of maskedSql.matchAll(
    /\b(?:FROM|JOIN)\s+["']?([A-Za-z0-9_/$]+)["']?(?:\s+AS\s+([A-Za-z_][A-Za-z0-9_]*))?/gi,
  )) {
    sources.push({ table: match[1]!, ...(match[2] ? { alias: match[2] } : {}) });
  }

  if (sources.length === 0) return undefined;

  const escapedColumn = badColumn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const qualifiedColumn = new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)~${escapedColumn}\\b`, 'gi');
  const qualifiers = new Set([...maskedSql.matchAll(qualifiedColumn)].map((match) => match[1]!.toUpperCase()));

  if (qualifiers.size === 1) {
    const qualifier = [...qualifiers][0]!;
    return sources.find(
      (source) => source.alias?.toUpperCase() === qualifier || source.table.toUpperCase() === qualifier,
    )?.table;
  }

  // With multiple sources, an unqualified or multiply-qualified bad column is ambiguous. Preserve
  // SAP's original error rather than confidently listing columns from an unrelated table.
  return qualifiers.size === 0 && sources.length === 1 ? sources[0]!.table : undefined;
}

async function runChunkedSapQuery(
  client: AdtClient,
  plan: SimpleInListChunkPlan,
  maxRows: number,
): Promise<{ columns: string[]; rows: Record<string, string>[] } & DataPreviewMeta> {
  // Metrics are intentionally omitted for the chunked path: an early break on the row cap would make
  // totalRows a misleading partial sum, so we report metrics only for the single-statement path below.
  const rowLimit = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 100;
  const rows: Record<string, string>[] = [];
  let columns: string[] = [];

  for (const statement of plan.statements) {
    const remaining = Math.max(0, rowLimit - rows.length);
    if (remaining === 0) break;
    const chunk = await client.runQuery(statement, remaining);
    if (columns.length === 0) columns = chunk.columns;
    rows.push(...chunk.rows);
  }

  return { columns, rows: rows.slice(0, rowLimit) };
}

export async function handleSAPQuery(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const sql = String(args.sql ?? '');
  const maxRows = Number(args.maxRows ?? 100);
  const chunkPlan = planSimpleInListChunking(sql);
  let chunkingAttempted = false;

  try {
    chunkingAttempted = chunkPlan != null;
    const data = chunkPlan
      ? await runChunkedSapQuery(client, chunkPlan, maxRows)
      : await client.runQueryWithMetrics(sql, maxRows);
    // Surface ADT's own metrics first (real match count + server-side time) — most useful for perf triage
    // ("847 ms, 511927 rows matched") and not buried under a long rows array.
    const out: Record<string, unknown> = {};
    if (data.totalRows !== undefined) out.totalRows = data.totalRows;
    if (data.queryExecutionTimeMs !== undefined) out.queryExecutionTimeMs = data.queryExecutionTimeMs;
    if (data.executedQueryString) out.executedQueryString = data.executedQueryString;
    out.rowsReturned = data.rows.length;
    out.columns = data.columns;
    out.rows = data.rows;
    return textResult(JSON.stringify(out, null, 2));
  } catch (err) {
    if (err instanceof AdtApiError && err.isNotFound) {
      // Try to extract table name from SQL and suggest similar names
      const tableMatch = sql.match(/FROM\s+["']?([A-Za-z0-9_/$]+)["']?/i);
      if (tableMatch) {
        const tableName = tableMatch[1]!;

        try {
          const suggestions = await client.searchObject(`${tableName}*`, 10);
          const tableNames = suggestions
            .filter(
              (s) =>
                s.objectType.startsWith('TABL') || s.objectType.startsWith('VIEW') || s.objectType.startsWith('DDLS'),
            )
            .map((s) => s.objectName)
            .slice(0, 5);
          if (tableNames.length > 0) {
            return errorResult(
              `Table "${tableName}" not found.\n\nDid you mean: ${tableNames.join(', ')}?\n\nUse SAPSearch("${tableName}*") for more results, or discover tables with: SAPQuery(sql="SELECT tabname FROM dd02l WHERE tabname LIKE '%${tableName}%'")`,
            );
          }
        } catch {
          // Search failed — fall through to original error
        }
      }
    }
    if (err instanceof AdtApiError) {
      // Dialect mistakes must win over column enrichment. SAP reuses data-preview message 004
      // for many grammar errors, so treating it as an unknown column first produces false advice
      // such as `Unknown column "DESC"` and hides the actionable correction.
      const parserHint = classifySapQueryParserError(err, sql, chunkingAttempted);
      if (parserHint) return errorResult(parserHint);

      // Self-correct an unknown-column error by listing the table's real columns (best-effort).
      const badColumn = extractUnknownColumn(err);
      if (badColumn) {
        const table = resolveUnknownColumnTable(sql, badColumn);
        if (table && /^[A-Za-z0-9_/]+$/.test(table)) {
          try {
            const { columns } = await client.runQuery(`SELECT * FROM ${table}`, 1);
            if (columns.length > 0) return errorResult(formatUnknownColumnHint(badColumn, table, columns));
          } catch {
            // best-effort — fall through to the generic parser hint / original error
          }
        }
      }
    }
    throw err;
  }
}

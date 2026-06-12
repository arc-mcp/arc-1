/**
 * SAPQuery handler — freestyle SQL execution with IN-list chunking + SQL literal parsing.
 * Extracted from intent.ts (Stage B; moved verbatim).
 */

import type { AdtClient } from '../adt/client.js';
import { AdtApiError } from '../adt/errors.js';
import { errorResult, hasSqlParserSignature, type ToolResult, textResult } from './shared.js';

function classifySapQueryParserError(err: AdtApiError, sql: string): string | undefined {
  if (err.statusCode !== 400) return undefined;

  const combined = `${err.message}\n${err.responseBody ?? ''}`;
  if (!hasSqlParserSignature(combined)) return undefined;

  const hints = [
    'ADT freestyle SQL parser rejected this query on this backend/version.',
    'Submit exactly one SELECT statement (no semicolons, no multi-statement scripts).',
    'Remove ABAP target clauses from SQL text (INTO, APPENDING, PACKAGE SIZE).',
  ];

  if (/\bJOIN\b/i.test(sql)) {
    hints.push('JOIN parsing can fail on some systems (SAP Note 3605050); split into staged single-table queries.');
  }

  if (/\bINTO\b|\bAPPENDING\b|\bPACKAGE\s+SIZE\b/i.test(sql)) {
    hints.push('Use the MCP maxRows parameter for row limits instead of ABAP target-table clauses.');
  }

  return `${err.message}\n\nHint: ${hints.join(' ')}`;
}

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

  const matches = [...maskedSql.matchAll(/\b[A-Za-z_][A-Za-z0-9_~.]*\s+IN\s*\(/gi)];
  if (matches.length !== 1) return undefined;

  const match = matches[0]!;
  const matchText = match[0];
  const fieldName = matchText.match(/^([A-Za-z_][A-Za-z0-9_~.]*)\s+IN\s*\(/i)?.[1];
  if (!fieldName || fieldName.toUpperCase() === 'NOT') return undefined;

  const matchStart = match.index ?? 0;
  const openParen = matchStart + matchText.lastIndexOf('(');
  const closeParen = findMatchingParen(maskedSql, openParen);
  if (closeParen < 0) return undefined;

  const literals = parseSingleQuotedLiteralList(sql.slice(openParen + 1, closeParen));
  if (!literals || literals.length <= chunkSize) return undefined;

  const prefix = sql.slice(0, openParen + 1);
  const suffix = sql.slice(closeParen);
  const statements: string[] = [];
  for (let i = 0; i < literals.length; i += chunkSize) {
    statements.push(`${prefix}${literals.slice(i, i + chunkSize).join(', ')}${suffix}`);
  }

  return { statements };
}

function maskSqlStringLiterals(sql: string): string {
  let masked = '';
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'") {
      if (inString && sql[i + 1] === "'") {
        masked += '  ';
        i++;
        continue;
      }
      inString = !inString;
      masked += ' ';
      continue;
    }
    masked += inString ? ' ' : ch;
  }

  return masked;
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

async function runChunkedSapQuery(
  client: AdtClient,
  plan: SimpleInListChunkPlan,
  maxRows: number,
): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
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
    const data = chunkPlan ? await runChunkedSapQuery(client, chunkPlan, maxRows) : await client.runQuery(sql, maxRows);
    return textResult(JSON.stringify(data, null, 2));
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
      let parserHint = classifySapQueryParserError(err, sql);
      if (parserHint && chunkingAttempted) {
        parserHint +=
          '\nARC-1 already split this simple long IN list into smaller ADT freestyle queries; this backend still rejected one chunk. Reduce the query further or use staged named-table previews.';
      }
      if (parserHint) return errorResult(parserHint);
    }
    throw err;
  }
}

/**
 * SAPQuery error classification for ADT's freestyle ABAP SQL subset.
 *
 * Prefer the submitted SQL shape over localized SAP prose. SAP reuses
 * ADT_DATAPREVIEW_MSG/004 for unrelated grammar, ambiguity, and unknown-column
 * failures, so the T100 number alone is not a safe classifier.
 */

import type { AdtApiError } from '../adt/errors.js';
import { hasSqlParserSignature } from './shared.js';

const SOURCE_ALIAS_STOP_WORDS = new Set([
  'APPENDING',
  'AS',
  'BYPASSING',
  'CLIENT',
  'CONNECTION',
  'CROSS',
  'EXCEPT',
  'FETCH',
  'FIELDS',
  'FULL',
  'GROUP',
  'HAVING',
  'INNER',
  'INTERSECT',
  'INTO',
  'JOIN',
  'LEFT',
  'OFFSET',
  'ON',
  'ORDER',
  'PRIVILEGED',
  'RIGHT',
  'UNION',
  'UP',
  'USING',
  'WHERE',
  'WITH',
]);

function withHint(err: AdtApiError, hint: string): string {
  return `${err.message}\n\nHint: ${hint}`;
}

export function maskSqlStringLiterals(sql: string): string {
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

function declaredSourceAliases(maskedSql: string): Set<string> {
  const aliases = new Set<string>();
  for (const match of maskedSql.matchAll(
    /\b(?:FROM|JOIN)\s+[A-Za-z_/$][A-Za-z0-9_/$]*\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi,
  )) {
    aliases.add(match[1]!.toUpperCase());
  }
  return aliases;
}

function findMissingSourceAliasAs(maskedSql: string): { table: string; alias: string } | undefined {
  for (const match of maskedSql.matchAll(
    /\b(?:FROM|JOIN)\s+([A-Za-z_/$][A-Za-z0-9_/$]*)\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi,
  )) {
    const table = match[1]!;
    const alias = match[2]!;
    if (!SOURCE_ALIAS_STOP_WORDS.has(alias.toUpperCase())) return { table, alias };
  }
  return undefined;
}

function findSimpleSelectListPair(maskedSql: string): { first: string; second: string } | undefined {
  const match = maskedSql.match(
    /^\s*SELECT\s+(?:SINGLE\s+)?([A-Za-z_][A-Za-z0-9_]*(?:~[A-Za-z_][A-Za-z0-9_]*)?)\s+([A-Za-z_][A-Za-z0-9_]*)\s+FROM\b/i,
  );
  if (!match || match[1]!.toUpperCase() === 'DISTINCT') return undefined;
  return { first: match[1]!, second: match[2]! };
}

function findAliasDotAccess(maskedSql: string): { original: string; replacement: string } | undefined {
  const aliases = declaredSourceAliases(maskedSql);
  for (const match of maskedSql.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*(\*|[A-Za-z_][A-Za-z0-9_]*)/g)) {
    const alias = match[1]!;
    const field = match[2]!;
    if (aliases.has(alias.toUpperCase())) {
      return { original: match[0], replacement: `${alias}~${field}` };
    }
  }
  return undefined;
}

function findRowLimit(maskedSql: string): { syntax: string; rows?: string } | undefined {
  const top = maskedSql.match(/\bSELECT\s+(?:SINGLE\s+)?TOP\s+(\d+)\b/i);
  if (top) return { syntax: 'TOP', rows: top[1] };
  const limit = maskedSql.match(/\bLIMIT\s+(\d+)\b/i);
  if (limit) return { syntax: 'LIMIT', rows: limit[1] };
  const fetch = maskedSql.match(/\bFETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY\b/i);
  if (fetch) return { syntax: 'FETCH FIRST/NEXT', rows: fetch[1] };
  if (/\bOFFSET\s+\d+\b/i.test(maskedSql)) return { syntax: 'OFFSET' };
  return undefined;
}

export function classifySapQueryParserError(
  err: AdtApiError,
  sql: string,
  chunkingAttempted = false,
): string | undefined {
  const maskedSql = maskSqlStringLiterals(sql);
  const fullJoin = /\bFULL(?:\s+OUTER)?\s+JOIN\b/i.test(maskedSql);

  // 8.16 can turn FULL JOIN into an internal 500 instead of the expected parser 400.
  // Only classify a server error when the submitted syntax identifies this live-verified crash path.
  if (err.statusCode !== 400 && !(err.statusCode >= 500 && fullJoin)) return undefined;

  const combined = `${err.message}\n${err.responseBody ?? ''}`;

  if (fullJoin) {
    return withHint(
      err,
      'FULL JOIN is not supported by ABAP SQL. Rewrite it using supported INNER, LEFT OUTER, RIGHT OUTER, or CROSS JOINs; if full-outer semantics are required, combine two supported queries client-side.',
    );
  }

  // Some backends mis-parse a long IN-list as one unterminated literal running into the
  // endpoint's internal INTO TABLE wrapper.
  if (/longer than 255 characters/i.test(combined)) {
    const automaticChunking = chunkingAttempted
      ? 'ARC-1 already chunked the longest literal IN-list in this plain SELECT, but this backend rejected a chunk; reduce the batches further.'
      : 'ARC-1 auto-chunks the longest literal IN-list of plain SELECTs, including queries with multiple IN-clauses. It sends ORDER BY, GROUP BY, DISTINCT, and aggregate queries whole to preserve semantics, so split those manually.';
    return withHint(
      err,
      `A text literal was parsed as >255 characters, typically because this backend mis-read a long IN-list as one literal. Split the largest IN-list into smaller batches (~5–8 values each) and union the results; re-sort client-side if the query is ordered. ${automaticChunking}`,
    );
  }

  const rowLimit = findRowLimit(maskedSql);
  if (rowLimit?.syntax === 'OFFSET') {
    return withHint(
      err,
      'OFFSET pagination is not supported by the ADT freestyle endpoint. Remove OFFSET, constrain the WHERE/ORDER BY keys, and use the SAPQuery maxRows parameter for the returned row cap.',
    );
  }
  if (rowLimit) {
    const rows = rowLimit.rows ? ` (for example, maxRows: ${rowLimit.rows})` : '';
    return withHint(
      err,
      `${rowLimit.syntax} belongs to another SQL dialect. Remove it from the SQL and pass the SAPQuery maxRows parameter${rows}; ARC-1 applies the ABAP row limit.`,
    );
  }

  if (/^\s*WITH\b/i.test(maskedSql)) {
    return withHint(
      err,
      'The ADT freestyle endpoint accepts a SELECT as its first token and rejects CTEs, including ABAP +cte syntax. Rewrite the CTE as a supported IN/EXISTS subquery or split it into separate SAPQuery calls.',
    );
  }
  if (/\b(?:FROM|JOIN)\s*\(\s*SELECT\b/i.test(maskedSql)) {
    return withHint(
      err,
      'Derived tables in FROM/JOIN are not supported by this ADT freestyle endpoint. Move the subquery into WHERE with IN/EXISTS, query a CDS entity, or split the operation into separate calls.',
    );
  }
  if (/\bOVER\s*\(/i.test(maskedSql)) {
    return withHint(
      err,
      'Window expressions (OVER/PARTITION BY) are not supported by this ADT freestyle endpoint. Use GROUP BY/aggregates where equivalent, or calculate row numbers and running values client-side.',
    );
  }

  const setOperator = maskedSql.match(/\b(INTERSECT|EXCEPT)\b/i)?.[1]?.toUpperCase();
  if (setOperator) {
    const alternative = setOperator === 'INTERSECT' ? 'IN or EXISTS' : 'NOT EXISTS';
    return withHint(
      err,
      `${setOperator} conflicts with the ADT freestyle endpoint's injected ABAP row limit. Rewrite it using ${alternative}; UNION and UNION ALL are supported when their result shape fits the query.`,
    );
  }

  if (/\b(?:INTO|APPENDING|PACKAGE\s+SIZE)\b/i.test(maskedSql)) {
    return withHint(
      err,
      'Remove ABAP target clauses such as INTO, APPENDING, and PACKAGE SIZE. ARC-1 owns the result target; use the SAPQuery maxRows parameter for the row cap.',
    );
  }

  if (/--|\/\*|\*\/|"/.test(maskedSql)) {
    return withHint(
      err,
      'Remove comments and double quotes from the SQL text. In ABAP SQL token input, double quote starts a comment rather than quoting an identifier or string; use bare DDIC/CDS names and single-quoted literals.',
    );
  }
  if (/;/.test(maskedSql)) {
    return withHint(
      err,
      'Submit exactly one SELECT without a trailing semicolon or additional statements. The ADT endpoint supplies the ABAP statement boundary itself.',
    );
  }

  if (/@[A-Za-z_][A-Za-z0-9_]*|:[A-Za-z_][A-Za-z0-9_]*|\?/.test(maskedSql)) {
    return withHint(
      err,
      'The freestyle endpoint has no ABAP host-program or prepared-statement context, so @variables, :parameters, and ? placeholders cannot be resolved. Inline the value as a correctly escaped single-quoted literal.',
    );
  }

  if (/\bORDER\s+BY\b[\s\S]*\b(?:ASC|DESC)\b/i.test(maskedSql)) {
    return withHint(
      err,
      'Use the ABAP SQL sort keywords ASCENDING or DESCENDING, not ASC or DESC. Separate multiple ORDER BY fields with commas.',
    );
  }

  const nullComparison = maskedSql.match(/(?:(!=|<>|\bNE\b|=|\bEQ\b)\s*NULL\b|\bNULL\s*(!=|<>|\bNE\b|=|\bEQ\b))/i);
  if (nullComparison) {
    const operator = (nullComparison[1] ?? nullComparison[2] ?? '=').toUpperCase();
    const replacement = operator === '=' || operator === 'EQ' ? 'IS NULL' : 'IS NOT NULL';
    return withHint(err, `NULL cannot be compared with ${operator}. Use ${replacement} instead.`);
  }
  if (/!=/.test(maskedSql)) {
    return withHint(err, 'The != operator is not accepted here. Use the ABAP SQL not-equal operator <> or NE.');
  }
  if (/\bILIKE\b/i.test(maskedSql)) {
    return withHint(
      err,
      "ILIKE is not part of ABAP SQL. For a case-insensitive match, normalize the column with UPPER(...) and use LIKE with an uppercase single-quoted pattern, for example UPPER(name) LIKE '%ORDER%'.",
    );
  }
  if (/\|\|/.test(maskedSql)) {
    return withHint(
      err,
      'The || concatenation operator is not accepted here. Use the ABAP SQL CONCAT(left, right) function.',
    );
  }

  const schemaSource = maskedSql.match(/\b(FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_$]*)\.([A-Za-z_][A-Za-z0-9_$]*)\b/i);
  if (schemaSource) {
    return withHint(
      err,
      `Database schema prefixes are not accepted. Write ${schemaSource[1]!.toUpperCase()} ${schemaSource[3]} instead of ${schemaSource[2]}.${schemaSource[3]}; query the DDIC table or CDS entity name directly.`,
    );
  }

  const missingSourceAliasAs = findMissingSourceAliasAs(maskedSql);
  if (missingSourceAliasAs) {
    return withHint(
      err,
      `ABAP SQL requires AS for table aliases. Write ${missingSourceAliasAs.table} AS ${missingSourceAliasAs.alias}; qualify its fields as ${missingSourceAliasAs.alias}~field.`,
    );
  }

  if (/\bambiguous\b|\bzweideutig\b/i.test(combined)) {
    return withHint(
      err,
      'The column exists in more than one joined source. Qualify it with the declared table alias and a tilde in SELECT, ON, WHERE, GROUP BY, and ORDER BY, for example alias~field.',
    );
  }

  const aliasDot = findAliasDotAccess(maskedSql);
  if (aliasDot) {
    return withHint(
      err,
      `Use a tilde for ABAP SQL field access: write "${aliasDot.replacement}", not "${aliasDot.original}". Only declared table aliases use this conversion; replace every alias.field/alias.* access while leaving DDIC/CDS names unchanged. JOINs, WHERE, and ORDER BY all work with this qualification.`,
    );
  }

  const cdsCastType = maskedSql.match(/\bABAP\.([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(\s*\d+\s*\))?/i)?.[0];
  if (cdsCastType) {
    return withHint(
      err,
      `CDS cast type syntax ${cdsCastType} is not accepted by freestyle ABAP SQL. Use a supported ABAP SQL cast target such as CAST(value AS CHAR), without a CDS/SQL length suffix.`,
    );
  }

  const selectListPair = findSimpleSelectListPair(maskedSql);
  if (selectListPair || /select list must be comma-separated/i.test(combined)) {
    const example = selectListPair
      ? ` Separate columns with a comma, or write ${selectListPair.first} AS ${selectListPair.second} if the second identifier is an alias.`
      : '';
    return withHint(err, `ABAP SQL requires commas between select-list fields and AS before a column alias.${example}`);
  }

  if (!hasSqlParserSignature(combined)) return undefined;

  const hints = [
    'ADT freestyle SQL parser rejected this query on this backend/version.',
    'Submit one SELECT without comments or a semicolon.',
    'Use AS aliases, alias~field qualification, single-quoted inline literals, and the SAPQuery maxRows parameter.',
  ];
  const chunkRetry = chunkingAttempted
    ? ' ARC-1 already split the longest literal IN-list; reduce the query or batches further.'
    : '';
  return withHint(err, `${hints.join(' ')}${chunkRetry}`);
}

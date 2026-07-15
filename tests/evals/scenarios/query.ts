/**
 * SAPQuery — SQL-against-SAP scenarios. Only registered when allowFreeSQL=true.
 *
 * These scenarios score the SQL shape, not merely the presence of an `sql` argument. Patterns
 * intentionally allow harmless formatting and alias-name variation while rejecting dialect forms
 * that the ADT freestyle endpoint cannot execute.
 */

import type { EvalScenario } from '../types.js';

const FREESTYLE_FORBIDDEN = [
  /\b(?:LIMIT|OFFSET)\b|\bFETCH\s+(?:FIRST|NEXT)\b|\bSELECT\s+TOP\b/i,
  /@[A-Za-z_][A-Za-z0-9_]*|:[A-Za-z_][A-Za-z0-9_]*|\?/,
  /--|\/\*|\*\/|"|;/,
  /^\s*WITH\b|\bFULL(?:\s+OUTER)?\s+JOIN\b|\bOVER\s*\(/i,
  /\b(?:INTERSECT|EXCEPT)\b/i,
];

const QUERY_RESULT = JSON.stringify({
  rowsReturned: 1,
  columns: ['RESULT'],
  rows: [{ RESULT: 'example' }],
});

export const SCENARIOS: EvalScenario[] = [
  {
    id: 'query-sql',
    description: 'Query TADIR with an executable package filter',
    prompt: 'Use SAPQuery to find all development objects in package ZORDER. Return PGMID, OBJECT, and OBJ_NAME.',
    category: 'query',
    tags: ['single-step', 'basic', 'sql-validity'],
    requireFullParameters: true,
    optimal: [
      {
        tool: 'SAPQuery',
        argumentPatterns: {
          sql: {
            required: [
              /\bSELECT\b/i,
              /\bPGMID\b/i,
              /\bOBJECT\b/i,
              /\bOBJ_NAME\b/i,
              /\bFROM\s+TADIR\b/i,
              /\bDEVCLASS\s*=\s*'ZORDER'/i,
            ],
            forbidden: FREESTYLE_FORBIDDEN,
          },
        },
      },
    ],
    acceptable: [{ tool: 'SAPRead', requiredArgs: { type: 'DEVC', name: 'ZORDER' } }],
    mockResponses: { SAPQuery: QUERY_RESULT, SAPRead: QUERY_RESULT },
  },
  {
    id: 'query-join-alias-and-sort',
    description: 'Use AS aliases, tilde qualification, and ABAP sort direction',
    prompt:
      'Use one SAPQuery call to list up to 20 transparent DDIC tables whose names start with Z, together with their English DD02T short text, sorted by table name descending.',
    category: 'query',
    tags: ['single-step', 'sql-validity', 'join', 'aliases'],
    requireFullParameters: true,
    optimal: [
      {
        tool: 'SAPQuery',
        requiredArgs: { maxRows: 20 },
        argumentPatterns: {
          sql: {
            required: [
              /\bFROM\s+DD02L\s+AS\s+[A-Za-z_][A-Za-z0-9_]*/i,
              /\bJOIN\s+DD02T\s+AS\s+[A-Za-z_][A-Za-z0-9_]*/i,
              /\b[A-Za-z_][A-Za-z0-9_]*~TABNAME\b/i,
              /\b[A-Za-z_][A-Za-z0-9_]*~DDTEXT\b/i,
              /\bTABCLASS\s*=\s*'TRANSP'/i,
              /\bDDLANGUAGE\s*=\s*'E'/i,
              /\bORDER\s+BY\b[\s\S]*\bDESCENDING\b/i,
            ],
            forbidden: [
              ...FREESTYLE_FORBIDDEN,
              /\b[A-Za-z_][A-Za-z0-9_]*\.(?:TABNAME|DDTEXT|DDLANGUAGE|TABCLASS)\b/i,
              /\bDESC\b(?!ENDING)/i,
            ],
          },
        },
      },
    ],
    mockResponses: { SAPQuery: QUERY_RESULT },
  },
  {
    id: 'query-row-limit-parameter',
    description: 'Use maxRows rather than SQL-dialect limiting syntax',
    prompt: 'Use SAPQuery to return at most five SAP clients from T000, with columns MANDT and MTEXT.',
    category: 'query',
    tags: ['single-step', 'sql-validity', 'row-limit'],
    requireFullParameters: true,
    optimal: [
      {
        tool: 'SAPQuery',
        requiredArgs: { maxRows: 5 },
        argumentPatterns: {
          sql: {
            required: [/\bSELECT\b[\s\S]*\bMANDT\b/i, /\bMTEXT\b/i, /\bFROM\s+T000\b/i],
            forbidden: FREESTYLE_FORBIDDEN,
          },
        },
      },
    ],
    mockResponses: { SAPQuery: QUERY_RESULT },
  },
  {
    id: 'query-inline-single-quoted-literal',
    description: 'Inline a single-quoted value instead of using host parameters',
    prompt: 'Use SAPQuery to fetch PGMID, OBJECT, and OBJ_NAME from TADIR for the exact object name ZCL_ORDER_SERVICE.',
    category: 'query',
    tags: ['single-step', 'sql-validity', 'literals'],
    requireFullParameters: true,
    optimal: [
      {
        tool: 'SAPQuery',
        argumentPatterns: {
          sql: {
            required: [/\bFROM\s+TADIR\b/i, /\bOBJ_NAME\s*=\s*'ZCL_ORDER_SERVICE'/i],
            forbidden: FREESTYLE_FORBIDDEN,
          },
        },
      },
    ],
    mockResponses: { SAPQuery: QUERY_RESULT },
  },
  {
    id: 'query-null-and-case-insensitive-match',
    description: 'Use IS NOT NULL and UPPER plus LIKE instead of ANSI alternatives',
    prompt:
      'Use SAPQuery to find English DD02T descriptions that are not null and contain the word order regardless of case.',
    category: 'query',
    tags: ['single-step', 'sql-validity', 'comparison', 'null'],
    requireFullParameters: true,
    optimal: [
      {
        tool: 'SAPQuery',
        argumentPatterns: {
          sql: {
            required: [
              /\bFROM\s+DD02T\b/i,
              /\bDDLANGUAGE\s*=\s*'E'/i,
              /\bDDTEXT\s+IS\s+NOT\s+NULL\b/i,
              /\bUPPER\s*\(\s*DDTEXT\s*\)\s+LIKE\s+'%ORDER%'/i,
            ],
            forbidden: [...FREESTYLE_FORBIDDEN, /\bILIKE\b/i, /(?:=|!=|<>)\s*NULL\b/i],
          },
        },
      },
    ],
    mockResponses: { SAPQuery: QUERY_RESULT },
  },
  {
    id: 'query-comparison-and-sort-keywords',
    description: 'Use ABAP comparison and sort keywords',
    prompt: 'Use SAPQuery to list T000 clients except client 000, sorted by MANDT ascending.',
    category: 'query',
    tags: ['single-step', 'sql-validity', 'comparison', 'sort'],
    requireFullParameters: true,
    optimal: [
      {
        tool: 'SAPQuery',
        argumentPatterns: {
          sql: {
            required: [/\bFROM\s+T000\b/i, /\bMANDT\s*(?:<>|\bNE\b)\s*'000'/i, /\bORDER\s+BY\s+MANDT\s+ASCENDING\b/i],
            forbidden: [...FREESTYLE_FORBIDDEN, /!=/, /\bASC\b(?!ENDING)/i],
          },
        },
      },
    ],
    mockResponses: { SAPQuery: QUERY_RESULT },
  },
  {
    id: 'query-subquery-instead-of-intersect',
    description: 'Use a supported subquery instead of INTERSECT',
    prompt:
      'Use one SAPQuery call with a subquery to return TADIR OBJ_NAME values that also occur as DD02L TABNAME values.',
    category: 'query',
    tags: ['single-step', 'sql-validity', 'subquery', 'set-operator'],
    requireFullParameters: true,
    optimal: [
      {
        tool: 'SAPQuery',
        argumentPatterns: {
          sql: {
            required: [
              /\bFROM\s+TADIR\b/i,
              /\bOBJ_NAME\b/i,
              /(?:\bIN\s*\(\s*SELECT\b|\bEXISTS\s*\(\s*SELECT\b)/i,
              /\bFROM\s+DD02L\b/i,
            ],
            forbidden: FREESTYLE_FORBIDDEN,
          },
        },
      },
    ],
    mockResponses: { SAPQuery: QUERY_RESULT },
  },
];

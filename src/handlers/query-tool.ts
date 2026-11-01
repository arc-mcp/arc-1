/** Action-aware SAPQuery definition; server flags establish its maximum visible surface. */
import type { ResolvedFeatures } from '../adt/types.js';
import type { ServerConfig } from '../server/types.js';
import { APPLICATION_LOG_DESCRIPTION, APPLICATION_LOG_PROPERTY } from './application-log-input.js';
import { LONG_TEXT_DESCRIPTION, LONG_TEXT_PROPERTY } from './long-text-input.js';
import type { ToolDefinition } from './tools.js';

const QUERY_SQL_DIALECT_GUIDE =
  'Read-only ABAP SQL SELECT: AS aliases, alias~field/alias~*, ASCENDING/DESCENDING; single-quoted literals (no @/:/?). maxRows, not TOP/LIMIT/OFFSET/FETCH. JOIN/GROUP BY/aggregates/UNION/subqueries; no CTE/FULL JOIN/derived/window tables/INTERSECT/EXCEPT/comments/semicolons/schema prefixes. Long literal IN-lists auto-chunk in plain projection SELECTs. ';

export const QUERY_SQL_DESCRIPTION_ONPREM =
  QUERY_SQL_DIALECT_GUIDE +
  'Metadata: DD02L/DD03L/TADIR/TFDIR/SWOTLV. Consumers: SAPContext(action="impact",type="DDLS"); avoid DDDDLSRC/ACMDCLSRC/DDLXSRC_SRC.';

export const QUERY_SQL_DESCRIPTION_BTP =
  'Query BTP ABAP Environment with ABAP SQL; returns columns + rows. ' +
  QUERY_SQL_DIALECT_GUIDE +
  'BTP permits custom Z/Y tables and released CDS entities; standard tables are blocked. ' +
  'Use released views such as I_LANGUAGE. Unknown tables get suggestions.';

export function queryDescription(actions: readonly string[], btp: boolean): string {
  return [
    ...(actions.includes('sql')
      ? [`sql (default): ${btp ? QUERY_SQL_DESCRIPTION_BTP : QUERY_SQL_DESCRIPTION_ONPREM}`]
      : []),
    ...(actions.includes('application_log') ? [APPLICATION_LOG_DESCRIPTION] : []),
    ...(actions.includes('long_text') ? [LONG_TEXT_DESCRIPTION] : []),
  ].join('\n');
}

export function createQueryDefinition(
  config: ServerConfig,
  resolvedFeatures?: Partial<ResolvedFeatures>,
): ToolDefinition | undefined {
  const btp = config.systemType === 'btp' || resolvedFeatures?.systemType === 'btp';
  const sql = config.allowFreeSQL;
  const longText = config.allowDataPreview && !btp;
  const applicationLog = longText && config.blockedDataSources.length === 0;
  const actions = [
    ...(sql ? ['sql'] : []),
    ...(longText ? ['long_text'] : []),
    ...(applicationLog ? ['application_log'] : []),
  ];
  if (actions.length === 0) return undefined;
  return {
    name: 'SAPQuery',
    description: queryDescription(actions, btp),
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: actions },
        ...(sql
          ? {
              sql: { type: 'string' },
              maxRows: {
                type: 'number',
                description: 'Default 100; max 10,000; byte-capped.',
              },
            }
          : {}),
        ...(longText ? { longText: LONG_TEXT_PROPERTY } : {}),
        ...(applicationLog ? { applicationLog: APPLICATION_LOG_PROPERTY } : {}),
      },
      required: sql ? (longText ? [] : ['sql']) : applicationLog ? ['action'] : ['action', 'longText'],
      additionalProperties: false,
    },
  };
}

/** Keep fields and requirements aligned with the actions left after authorization. */
export function pruneQueryDefinition(tool: ToolDefinition, allowedActions: readonly string[]): ToolDefinition {
  if (tool.name !== 'SAPQuery') return tool;
  const properties = (tool.inputSchema.properties as Record<string, unknown> | undefined) ?? {};
  const action = (properties.action as Record<string, unknown> | undefined) ?? {};
  const existingActions = Array.isArray(action.enum) ? action.enum : [];
  const actions = existingActions.filter(
    (value): value is string =>
      typeof value === 'string' &&
      ['sql', 'long_text', 'application_log'].includes(value) &&
      allowedActions.includes(value),
  );
  const sql = actions.includes('sql');
  const longText = actions.includes('long_text');
  const applicationLog = actions.includes('application_log');
  const remaining = Object.fromEntries(
    Object.entries(properties).filter(([name]) =>
      name === 'sql' || name === 'maxRows'
        ? sql
        : name === 'longText'
          ? longText
          : name === 'applicationLog'
            ? applicationLog
            : true,
    ),
  );
  // Preserve unrelated requirements such as an injected multi-target selector.
  const required = (Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required.map(String) : []).filter(
    (name) => !['sql', 'action', 'longText', 'applicationLog'].includes(name),
  );
  if (sql && !longText && !applicationLog) required.push('sql');
  if (!sql) {
    required.push('action');
    if (longText && !applicationLog) required.push('longText');
    if (applicationLog && !longText) required.push('applicationLog');
  }
  return {
    ...tool,
    description: queryDescription(actions, tool.description.includes(QUERY_SQL_DESCRIPTION_BTP)),
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...remaining,
        action: { ...action, enum: actions },
      },
      required,
    },
  };
}

/**
 * Conservative ABAP SQL source analysis for the experimental data-source blocklist.
 *
 * This is an authorization parser, not a formatter or best-effort dependency extractor:
 * anything that cannot be proven to be one complete static SELECT/WITH statement is refused.
 */

import { Expressions, MemoryFile, Registry, Version } from '@abaplint/core';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';
import { canonicalDataSourceName } from './data-source-name.js';

const MAX_SQL_LENGTH = 100_000;
const SYNTHETIC_TARGET = '__arc1_policy_result';

const FORBIDDEN_EXPRESSIONS = [
  ['privileged access', Expressions.SQLPrivilegedAccess],
  ['client override', Expressions.SQLClient],
  ['secondary database connection', Expressions.DatabaseConnection],
  ['dynamic expression', Expressions.Dynamic],
  ['CDS association path', Expressions.SQLPathForEntity],
  ['CDS column path', Expressions.SQLPathForColumn],
  ['external PROVIDED BY source', Expressions.SQLProvidedBy],
] as const;

type StatementNode = {
  concatTokens(): string;
  get(): { constructor: { name: string } };
  getTokens(): Array<{ constructor: { name: string }; getRow(): number; getStr(): string }>;
};

type StructureNode = {
  findAllStatementNodes(): StatementNode[];
  findAllExpressionsRecursive(type: unknown): Array<{ concatTokens(): string }>;
};

export class SqlSourceAnalysisError extends Error {
  constructor(message: string) {
    super(`SQL source analysis failed: ${message}`);
    this.name = 'SqlSourceAnalysisError';
  }
}

/**
 * Canonicalize a source the parser found, reporting failure as a SQL-grammar problem.
 *
 * Identity rules live in one place (`data-source-name.ts`); a name the shared canonicalizer refuses
 * means the statement is outside the accepted subset, not that lineage is unresolved.
 */
function parsedSourceName(raw: string): string {
  try {
    return canonicalDataSourceName(raw, 'SQL data source');
  } catch (error) {
    throw new SqlSourceAnalysisError(error instanceof Error ? error.message : String(error));
  }
}

/** Extract every static database source from one complete ABAP SQL SELECT/WITH statement. */
export function analyzeSqlDataSources(sql: string): string[] {
  if (sql.length > MAX_SQL_LENGTH) {
    throw new SqlSourceAnalysisError(`SQL is too long for policy analysis (maximum ${MAX_SQL_LENGTH} characters)`);
  }
  const trimmed = sql.trim();
  if (!trimmed) throw new SqlSourceAnalysisError('SQL is empty');

  const inputLineCount = trimmed.split(/\r?\n/).length;
  const syntheticTargetRow = inputLineCount + 3;
  const source = `REPORT zarc1_policy.\nSTART-OF-SELECTION.\n${trimmed}\n` + `INTO TABLE @DATA(${SYNTHETIC_TARGET}).`;

  const registry = new Registry(getDefaultAbaplintConfig(Version.v758));
  registry.addFile(new MemoryFile('zarc1_policy.prog.abap', source));
  registry.parse();

  const parserIssues = registry.findIssues().filter((issue) => issue.getKey() === 'parser_error');
  if (parserIssues.length > 0) {
    throw new SqlSourceAnalysisError('statement is malformed or unsupported by the security parser');
  }

  const objects = Array.from(registry.getObjects());
  const object = objects[0] as
    | { getMainABAPFile?(): { getStructure?(): StructureNode | undefined } | undefined }
    | undefined;
  const structure = object?.getMainABAPFile?.()?.getStructure?.();
  if (objects.length !== 1 || !structure) {
    throw new SqlSourceAnalysisError('statement did not produce one complete ABAP program syntax tree');
  }

  const statements = structure.findAllStatementNodes();
  if (
    statements.length !== 3 ||
    statements[0]?.get().constructor.name !== 'Report' ||
    statements[1]?.get().constructor.name !== 'StartOfSelection' ||
    !['Select', 'With'].includes(statements[2]?.get().constructor.name ?? '')
  ) {
    throw new SqlSourceAnalysisError('exactly one SELECT or WITH statement is required');
  }

  const queryStatement = statements[2]!;
  const tokens = queryStatement.getTokens();
  const syntheticTokens = tokens
    .filter((token) => token.getRow() === syntheticTargetRow)
    .map((token) => token.getStr());
  const expectedTarget = ['INTO', 'TABLE', '@', 'DATA', '(', SYNTHETIC_TARGET, ')', '.'];
  if (
    syntheticTokens.length !== expectedTarget.length ||
    syntheticTokens.some((token, i) => token !== expectedTarget[i])
  ) {
    throw new SqlSourceAnalysisError('statement is incomplete or already contains an output target');
  }

  const callerHostMarkers = tokens.filter(
    (token) => token.constructor.name === 'WAt' && token.getRow() !== syntheticTargetRow,
  );
  if (callerHostMarkers.length > 0) {
    throw new SqlSourceAnalysisError('host expressions are not allowed while the data-source blocklist is active');
  }

  for (const [label, expression] of FORBIDDEN_EXPRESSIONS) {
    if (structure.findAllExpressionsRecursive(expression).length > 0) {
      throw new SqlSourceAnalysisError(`${label} is not allowed while the data-source blocklist is active`);
    }
  }

  const sources = structure
    .findAllExpressionsRecursive(Expressions.DatabaseTable)
    .map((node) => parsedSourceName(node.concatTokens()));
  const uniqueSources = [...new Set(sources)];
  if (uniqueSources.length === 0) {
    throw new SqlSourceAnalysisError('no static database source could be proven');
  }
  return uniqueSources;
}

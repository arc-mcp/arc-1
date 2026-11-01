/** Prove that a whole-line class splice contains only the selected source construct. */
import { type Nodes, Statements, Unknown } from '@abaplint/core';
import { parseClassSourceStatements } from './class-source-parser.js';
import { AdtSafetyError } from './errors.js';
import type { LineRange } from './types.js';

function refuse(): never {
  throw new AdtSafetyError(
    'Class surgery cannot safely isolate the selected source boundary. Read and update the complete editable source instead.',
  );
}

function blockStatements(source: string, range: Pick<LineRange, 'sr' | 'er'>) {
  const lines = source.split(/\r?\n/);
  if (
    !Number.isSafeInteger(range.sr) ||
    !Number.isSafeInteger(range.er) ||
    range.sr < 1 ||
    range.er < range.sr ||
    range.er > lines.length
  )
    refuse();
  return parseClassSourceStatements(lines.slice(range.sr - 1, range.er).join('\n'));
}

export function assertClassEditBoundary(
  source: string,
  range: LineRange,
  name: string,
  kind: 'definition' | 'implementation',
): void {
  const statements = blockStatements(source, range);
  const first = statements[0],
    last = statements.at(-1);
  const expected = kind === 'definition' ? Statements.ClassDefinition : Statements.ClassImplementation;
  const boundaries = statements.filter(
    (s) =>
      s.get() instanceof Statements.ClassDefinition ||
      s.get() instanceof Statements.ClassImplementation ||
      s.get() instanceof Statements.EndClass,
  );
  if (
    !(first?.get() instanceof expected) ||
    !(last?.get() instanceof Statements.EndClass) ||
    boundaries.length !== 2 ||
    first.concatTokens().split(/\s+/)[1]?.toUpperCase() !== name.toUpperCase()
  )
    refuse();
}

/** The grammar cannot name a namespaced RHS of an interface redefinition; validate its tail separately. */
function isMethodDeclaration(statement: Nodes.StatementNode): boolean {
  if (statement.get() instanceof Statements.MethodDef) return true;
  if (!(statement.get() instanceof Unknown)) return false;
  const tokens = statement.getTokens();
  if (
    !/^(?:CLASS-)?METHODS$/i.test(tokens[0]?.getStr() ?? '') ||
    !/^(?:\/[A-Z0-9_]+\/)?[A-Z_][A-Z0-9_]*~\/[A-Z0-9_]+\/[A-Z_][A-Z0-9_]*$/i.test(tokens[1]?.getStr() ?? '')
  )
    return false;
  const normalized = parseClassSourceStatements(
    tokens.map((token, index) => (index === 1 ? 'zboundary_method' : token.getStr())).join(' '),
  );
  return normalized.length === 1 && normalized[0]?.get() instanceof Statements.MethodDef;
}

export function assertMethodDeclarationBoundary(
  source: string,
  range: LineRange,
  name: string,
  insertionAfterChain = false,
): void {
  const statements = blockStatements(source, range);
  const only = insertionAfterChain ? statements.at(-1) : statements[0];
  const actualName = only?.concatTokens().match(/^(?:CLASS-)?METHODS\s+([^\s.]+)/i)?.[1];
  if (
    (!insertionAfterChain && (statements.length !== 1 || only?.getColon() !== undefined)) ||
    !statements.every(isMethodDeclaration) ||
    only?.getLastToken().getStr() !== '.' ||
    actualName?.toUpperCase() !== name.toUpperCase()
  )
    refuse();
}

export function assertMethodImplementationBoundary(source: string, range: LineRange, name: string): void {
  const statements = blockStatements(source, range);
  const first = statements[0],
    last = statements.at(-1);
  const boundaries = statements.filter(
    (s) => s.get() instanceof Statements.MethodImplementation || s.get() instanceof Statements.EndMethod,
  );
  const actualName = first?.concatTokens().match(/^METHOD\s+([^\s.]+)/i)?.[1];
  if (
    !(first?.get() instanceof Statements.MethodImplementation) ||
    !(last?.get() instanceof Statements.EndMethod) ||
    boundaries.length !== 2 ||
    actualName?.toUpperCase() !== name.toUpperCase()
  )
    refuse();
}

/** Inserting a stub before ENDCLASS must not split another statement on that row. */
export function assertClassEndInsertionBoundary(source: string, row: number): void {
  const statements = blockStatements(source, { sr: row, er: row });
  if (statements.length !== 1 || !(statements[0]?.get() instanceof Statements.EndClass)) refuse();
}

/** Insertion after a declaration/section must not land inside a statement spanning that line. */
export function assertSectionHeaderBoundary(source: string, row: number, visibility: string): void {
  const statements = blockStatements(source, { sr: row, er: row });
  if (
    statements.length !== 1 ||
    statements[0]
      ?.getTokens()
      .map((token) => token.getStr().toUpperCase())
      .join(' ') !== `${visibility.toUpperCase()} SECTION .`
  )
    refuse();
}

/** Parse declarations using the same ABAP lexer, including chained statements. */
export function classEditStatements(source: string): Nodes.StatementNode[] {
  if (!source.trim()) return [];
  return blockStatements(source, { sr: 1, er: source.split(/\r?\n/).length });
}

export function assertClassDefinitionReplacement(source: string, name: string): void {
  try {
    assertClassEditBoundary(source, { sr: 1, sc: 0, er: source.split(/\r?\n/).length, ec: 0 }, name, 'definition');
  } catch {
    throw new AdtSafetyError(`Replacement must contain only the selected CLASS ${name} DEFINITION...ENDCLASS block.`);
  }
}

export function assertMethodDeclarationReplacement(source: string, name: string): void {
  try {
    assertMethodDeclarationBoundary(source, { sr: 1, sc: 0, er: source.split(/\r?\n/).length, ec: 0 }, name);
  } catch {
    throw new AdtSafetyError(
      `Replacement must contain exactly one unchained METHODS or CLASS-METHODS declaration for ${name}.`,
    );
  }
}

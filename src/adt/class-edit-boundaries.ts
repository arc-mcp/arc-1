/** Prove that a whole-line class splice contains only the selected source construct. */
import { Comment, MemoryFile, Objects, Registry, Statements, Version } from '@abaplint/core';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';
import type { LineRange } from './types.js';

function refuse(): never {
  throw new Error(
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
  const registry = new Registry(getDefaultAbaplintConfig(Version.Cloud));
  registry.addFile(new MemoryFile('zboundary.prog.abap', lines.slice(range.sr - 1, range.er).join('\n')));
  registry.parse();
  const object = registry.getFirstObject();
  if (!(object instanceof Objects.Program)) refuse();
  return (
    object
      .getMainABAPFile()
      ?.getStatements()
      .filter((s) => !(s.get() instanceof Comment)) ?? []
  );
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
    (!insertionAfterChain && statements.length !== 1) ||
    !statements.every((s) => s.get() instanceof Statements.MethodDef) ||
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

import { Expressions, type Nodes, Statements, Unknown } from '@abaplint/core';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  classSourceEvidence,
  parseClassSourceStatements,
  refuseClassEvidence,
  type SourceBlock,
} from './class-source-evidence.js';
import { AdtSafetyError } from './errors.js';
import type { LineRange } from './types.js';
import { parseClassStructure } from './xml-parser.js';

const origin = 'https://class-evidence.invalid';

const relation = 'http://www.sap.com/adt/relations/source/';

const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false });

type Element = Record<string, unknown>;

function relativeReference(value: unknown): string {
  if (typeof value !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || value.includes('\\'))
    refuseClassEvidence();
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) <= 32) refuseClassEvidence();
  return value;
}

function elements(value: unknown): Element[] {
  if (value === undefined) return [];
  const result = Array.isArray(value) ? value : [value];
  if (result.some((v) => !v || typeof v !== 'object' || Array.isArray(v))) refuseClassEvidence();
  return result as Element[];
}

function sameRange(actual: LineRange, first: Nodes.StatementNode, last = first): void {
  const start = first.getFirstToken().getStart();
  // Native blocks end at the terminating period/comma token, including whitespace before it.
  const terminal = last.getLastToken();
  if (!['.', ','].includes(terminal.getStr())) refuseClassEvidence();
  const end = terminal.getStart();
  if (
    !end ||
    actual.sr !== start.getRow() ||
    actual.sc !== start.getCol() - 1 ||
    actual.er !== end.getRow() ||
    actual.ec !== end.getCol() - 1
  )
    refuseClassEvidence();
}

export function verifiedClassStructure(xml: string, source: string, name: string, owner: string, sapClient: string) {
  if (xml.length > 1024 * 1024 || /<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) refuseClassEvidence();
  const parsed = parser.parse(xml) as Element;
  const roots = elements(parsed['abapsource:objectStructureElement']);
  if (roots.length !== 1) refuseClassEvidence();
  const root = roots[0]!;
  if (
    root['@_adtcore:type'] !== 'CLAS/OC' ||
    root['@_adtcore:name'] !== name ||
    root['@_xmlns:adtcore'] !== 'http://www.sap.com/adt/core' ||
    root['@_xmlns:abapsource'] !== 'http://www.sap.com/adt/abapsource' ||
    root['@_xmlns:atom'] !== 'http://www.w3.org/2005/Atom'
  )
    refuseClassEvidence();
  const base = new URL(`${owner}/objectstructure`, origin);
  if (root['@_xml:base'] !== undefined) {
    if (typeof root['@_xml:base'] !== 'string') refuseClassEvidence();
    const supplied = new URL(relativeReference(root['@_xml:base']), base);
    if (
      supplied.origin !== origin ||
      supplied.pathname.toLowerCase() !== base.pathname.toLowerCase() ||
      supplied.hash ||
      [...supplied.searchParams.keys()].some((k) => !['sap-client', 'sap-language'].includes(k)) ||
      supplied.searchParams.getAll('sap-client').length > 1 ||
      supplied.searchParams.getAll('sap-language').length > 1 ||
      (supplied.searchParams.has('sap-client') && supplied.searchParams.get('sap-client') !== sapClient)
    )
      refuseClassEvidence();
  }
  function ranges(element: Element): Map<string, LineRange> {
    const found = new Map<string, LineRange>();
    if (
      element !== root &&
      (element['@_xml:base'] !== undefined || Object.keys(element).some((k) => k.startsWith('@_xmlns:')))
    )
      refuseClassEvidence();
    for (const link of elements(element['atom:link'])) {
      const rel = link['@_rel'];
      if (typeof rel !== 'string' || !rel.startsWith(relation)) continue;
      const key = rel.slice(relation.length);
      if (!['definitionBlock', 'implementationBlock', 'definitionIdentifier', 'implementationIdentifier'].includes(key))
        continue;
      const href = link['@_href'];
      if (found.has(key) || link['@_xml:base'] !== undefined || Object.keys(link).some((k) => k.startsWith('@_xmlns:')))
        refuseClassEvidence();
      const url = new URL(relativeReference(href), base);
      if (
        url.origin !== origin ||
        url.pathname.toLowerCase() !== `${owner}/source/main`.toLowerCase() ||
        url.search ||
        url.username ||
        url.password
      )
        refuseClassEvidence();
      const match = /^#start=(\d+),(\d+);end=(\d+),(\d+)$/.exec(url.hash);
      if (!match) refuseClassEvidence();
      const [sr, sc, er, ec] = match.slice(1).map(Number);
      if (![sr, sc, er, ec].every(Number.isSafeInteger) || sr! < 1 || er! < sr! || (sr === er && ec! < sc!))
        refuseClassEvidence();
      found.set(key, { sr: sr!, sc: sc!, er: er!, ec: ec! });
    }
    return found;
  }
  function verifyBlock(found: Map<string, LineRange>, key: string, expected: SourceBlock | undefined) {
    const value = found.get(key);
    if (!!value !== !!expected) refuseClassEvidence();
    if (value && expected) sameRange(value, expected.first, expected.last);
  }
  function verifyIdentifier(
    found: Map<string, LineRange>,
    key: string,
    expectedName: string,
    header: Nodes.StatementNode | undefined,
    interfaceReference = false,
  ) {
    const value = found.get(key);
    if (!value) return;
    const identifier = interfaceReference
      ? header?.findFirstExpression(Expressions.InterfaceName)
      : (header?.findFirstExpression(Expressions.MethodName) ?? header?.findFirstExpression(Expressions.ClassName));
    if (!identifier) refuseClassEvidence();
    const start = identifier.getFirstToken().getStart(),
      end = identifier.getLastToken().getEnd();
    if (
      value.sr !== start.getRow() ||
      value.sc !== start.getCol() - 1 ||
      value.er !== end.getRow() ||
      value.ec !== end.getCol() - 1 ||
      identifier.concatTokens().toUpperCase() !== expectedName
    )
      refuseClassEvidence();
  }
  const evidence = classSourceEvidence(source, name);
  const rootRanges = ranges(root);
  verifyBlock(rootRanges, 'definitionBlock', evidence.definition);
  verifyBlock(rootRanges, 'implementationBlock', evidence.implementation);
  verifyIdentifier(rootRanges, 'definitionIdentifier', name, evidence.definition.first);
  verifyIdentifier(rootRanges, 'implementationIdentifier', name, evidence.implementation?.first);
  const declarations = new Set<string>(),
    implementations = new Set<string>();
  for (const child of elements(root['abapsource:objectStructureElement'])) {
    if (!['CLAS/OM', 'CLAS/OO'].includes(String(child['@_adtcore:type']))) continue;
    if (child['abapsource:objectStructureElement'] !== undefined) refuseClassEvidence();
    const method = child['@_adtcore:name'];
    if (typeof method !== 'string' || method !== method.toUpperCase()) refuseClassEvidence();
    for (const key of ['@_abstract', '@_redefinition'])
      if (child[key] !== undefined && child[key] !== 'true' && child[key] !== 'false') refuseClassEvidence();
    const found = ranges(child);
    const declaration = found.get('definitionBlock'),
      implementation = found.get('implementationBlock');
    if (!declaration && !implementation) refuseClassEvidence();
    const expected = evidence.methods.get(method),
      body = evidence.bodies.get(method);
    if (declaration) {
      if (
        !expected ||
        declarations.has(method) ||
        child['@_visibility'] !== expected.visibility ||
        child['@_level'] !== expected.level ||
        (child['@_abstract'] === 'true') !== expected.abstract ||
        (child['@_redefinition'] === 'true') !== expected.redefinition
      )
        refuseClassEvidence();
      sameRange(declaration, expected.declaration);
      declarations.add(method);
    }
    if (implementation) {
      if (!body || implementations.has(method)) refuseClassEvidence();
      sameRange(implementation, body.first, body.last);
      implementations.add(method);
    }
    if (expected) verifyIdentifier(found, 'definitionIdentifier', method, expected.declaration);
    else {
      const interfaceName = method.split('~')[0]!;
      const reference = method.includes('~') ? evidence.interfaces.get(interfaceName) : undefined;
      if (
        !reference ||
        child['@_visibility'] !== reference.visibility ||
        !['instance', 'static'].includes(String(child['@_level'])) ||
        child['@_abstract'] === 'true' ||
        child['@_redefinition'] === 'true'
      )
        refuseClassEvidence();
      verifyIdentifier(found, 'definitionIdentifier', interfaceName, reference.declaration, true);
    }
    verifyIdentifier(found, 'implementationIdentifier', method, body?.first);
  }
  if (declarations.size !== evidence.methods.size || implementations.size !== evidence.bodies.size)
    refuseClassEvidence();
  const structure = parseClassStructure(xml, name);
  if (structure.className !== name || structure.methods.length !== evidence.methods.size) refuseClassEvidence();
  // The shared read parser also accepts split legacy metadata and ignores local-class sections.
  // Recheck its final projection so an ignored/nested node cannot overwrite verified fields.
  sameRange(structure.classDefinitionBlock, evidence.definition.first, evidence.definition.last);
  if (!!structure.classImplementationBlock !== !!evidence.implementation) refuseClassEvidence();
  if (structure.classImplementationBlock && evidence.implementation)
    sameRange(structure.classImplementationBlock, evidence.implementation.first, evidence.implementation.last);
  for (const method of structure.methods) {
    const expected = evidence.methods.get(method.name),
      body = evidence.bodies.get(method.name);
    if (
      !expected ||
      method.visibility !== expected.visibility ||
      method.level !== expected.level ||
      method.abstract !== expected.abstract ||
      !!method.redefinition !== expected.redefinition ||
      !!method.implementation !== !!body
    )
      refuseClassEvidence();
    sameRange(method.definition, expected.declaration);
    if (method.implementation && body) sameRange(method.implementation, body.first, body.last);
  }
  return structure;
}

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
    !/^METHODS$/i.test(tokens[0]?.getStr() ?? '') ||
    !/^(?:\/[A-Z0-9_]+\/)?[A-Z_][A-Z0-9_]*~\/[A-Z0-9_]+\/[A-Z_][A-Z0-9_]*$/i.test(tokens[1]?.getStr() ?? '')
  )
    return false;
  if (
    !/^(?:FINAL\s+)?REDEFINITION\s*\.$/i.test(
      tokens
        .slice(2)
        .map((token) => token.getStr())
        .join(' '),
    )
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
export function classEndInsertionRow(source: string, range: LineRange): number {
  const statements = blockStatements(source, range);
  const last = statements.at(-1);
  if (!(last?.get() instanceof Statements.EndClass)) refuse();
  const row = last.getStart().getRow();
  if (statements.at(-2)?.getEnd().getRow() === row) refuse();
  const line = source.split(/\r?\n/)[range.sr + row - 2]!;
  if (line.slice(0, last.getStart().getCol() - 1).trim()) refuse();
  return range.sr + row - 1;
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
      `Replacement must contain exactly one unchained METHODS or CLASS-METHODS declaration for ${name}, recognized by the installed boundary parser. If SAP supports syntax newer than this parser, use a complete source update.`,
    );
  }
}

import {
  ABAPObject,
  Comment,
  Config,
  Expressions,
  MemoryFile,
  type Nodes,
  Registry,
  Statements,
  Unknown,
  Version,
} from '@abaplint/core';
import type { RelationKind } from '../graph/types.js';

export interface ExtractedReference {
  line: number;
  name: string;
  relation: RelationKind;
}

export type ParseReason =
  | 'empty_source'
  | 'structure_error'
  | 'unknown_statement'
  | 'macro_statement'
  | 'unsupported_cds';
export interface SourceAnalysis {
  dynamicTargets: number;
  method: 'abap-ast-v2' | 'cds-static-v2';
  reasons: ParseReason[];
  references: ExtractedReference[];
  status: 'parsed' | 'partial' | 'failed';
}

// Parsing success concerns grammar, not completeness of runtime dependency analysis.
export class SourceParseError extends Error {
  constructor(readonly analysis: SourceAnalysis) {
    super(`Source extraction ${analysis.status}: ${analysis.reasons.join(', ')}`);
    this.name = 'SourceParseError';
  }
}

const BUILTIN_TYPES = new Set([
  'STRING',
  'XSTRING',
  'I',
  'INT8',
  'P',
  'C',
  'N',
  'D',
  'T',
  'F',
  'X',
  'DECFLOAT16',
  'DECFLOAT34',
  'ABAP_BOOL',
  'ABAP_TRUE',
  'ABAP_FALSE',
  'SY',
  'SYST',
  'ANY',
  'DATA',
  'OBJECT',
]);

function head(name: string): string {
  return (
    name
      .split(/=>|->|-|~/u, 1)[0]
      ?.trim()
      .toUpperCase() ?? ''
  );
}

interface Scope {
  parent?: Scope;
  types: Set<string>;
}

// Two passes support class definition/implementation pairs and forward local declarations.
// Procedure-local names must not hide repository types used by a different procedure.
function localScopes(statements: readonly Nodes.StatementNode[]): Map<Nodes.StatementNode, Scope> {
  const root: Scope = { types: new Set() };
  const containers = new Map<string, Scope>();
  const scopes = new Map<Nodes.StatementNode, Scope>();
  let container = root;
  let current = root;
  let typeDepth = 0;
  for (const statement of statements) {
    const kind = statement.get();
    const isClass = kind instanceof Statements.ClassDefinition || kind instanceof Statements.ClassImplementation;
    if (isClass || kind instanceof Statements.Interface) {
      const name = statement
        .findFirstExpression(isClass ? Expressions.ClassName : Expressions.InterfaceName)
        ?.concatTokens()
        .toUpperCase();
      if (name) {
        root.types.add(name);
        container = containers.get(name) ?? { parent: root, types: new Set() };
        containers.set(name, container);
        current = container;
      }
    } else if (kind instanceof Statements.ClassDeferred || kind instanceof Statements.InterfaceDeferred) {
      const name = statement
        .findFirstExpression(
          kind instanceof Statements.ClassDeferred ? Expressions.ClassName : Expressions.InterfaceName,
        )
        ?.concatTokens()
        .toUpperCase();
      if (name) root.types.add(name);
    } else if (
      kind instanceof Statements.MethodImplementation ||
      kind instanceof Statements.Form ||
      kind instanceof Statements.FunctionModule
    ) {
      current = { parent: container, types: new Set() };
    }
    scopes.set(statement, current);
    if (
      kind instanceof Statements.TypeEnd ||
      kind instanceof Statements.TypeEnumEnd ||
      kind instanceof Statements.TypeMeshEnd
    ) {
      typeDepth = Math.max(0, typeDepth - 1);
    } else {
      const opensType =
        kind instanceof Statements.TypeBegin ||
        kind instanceof Statements.TypeEnumBegin ||
        kind instanceof Statements.TypeMeshBegin;
      if (typeDepth === 0 && (kind instanceof Statements.Type || opensType)) {
        const name = statement.findDirectExpression(Expressions.NamespaceSimpleName)?.concatTokens().toUpperCase();
        if (name) current.types.add(name);
      }
      if (opensType) typeDepth += 1;
    }
    if (
      kind instanceof Statements.EndMethod ||
      kind instanceof Statements.EndForm ||
      kind instanceof Statements.EndFunction
    )
      current = container;
    if (kind instanceof Statements.EndClass || kind instanceof Statements.EndInterface) container = current = root;
  }
  return scopes;
}

function locallyDefined(scope: Scope | undefined, name: string): boolean {
  for (let current = scope; current; current = current.parent) {
    if (current.types.has(name)) return true;
  }
  return false;
}

export function analyzeAbapSource(source: string, type: string, objectName: string): SourceAnalysis {
  const result: SourceAnalysis = {
    dynamicTargets: 0,
    method: 'abap-ast-v2',
    reasons: [],
    references: [],
    status: 'parsed',
  };
  const suffix = type.startsWith('INTF') ? 'intf' : type.startsWith('PROG') ? 'prog' : 'clas';
  // The first live target is on-premise ABAP 7.58. Do not parse classic ABAP in Cloud language mode.
  const registry = new Registry(Config.getDefault(Version.v758));
  registry.addFile(new MemoryFile(`${objectName.replaceAll('/', '#')}.${suffix}.abap`, source.replace(/\r\n/g, '\n')));
  registry.parse();
  const statements: Nodes.StatementNode[] = [];
  for (const object of registry.getObjects()) {
    if (!ABAPObject.is(object)) continue;
    const file = object.getMainABAPFile();
    if (!file?.getStructure() || object.getParsingIssues().length) result.reasons.push('structure_error');
    if (file) statements.push(...file.getStatements());
  }
  const meaningful = statements.filter((statement) => !(statement.get() instanceof Comment));
  if (meaningful.length === 0) result.reasons.push('empty_source');
  if (meaningful.some((statement) => statement.get() instanceof Unknown)) result.reasons.push('unknown_statement');
  if (
    meaningful.some((statement) => /^(MacroCall|MacroContent|MacroRecursion)$/.test(statement.get().constructor.name))
  ) {
    result.reasons.push('macro_statement');
  }
  result.reasons = [...new Set(result.reasons)];
  if (result.reasons.length) {
    result.status =
      meaningful.some((statement) => !(statement.get() instanceof Unknown)) &&
      !result.reasons.includes('structure_error')
        ? 'partial'
        : 'failed';
    // Do not expose a convincing subset as authoritative replacement evidence.
    return result;
  }
  const scopes = localScopes(statements);
  const seen = new Set<string>();
  const add = (statement: Nodes.StatementNode, rawName: string, relation: RelationKind, line: number) => {
    const name = head(rawName);
    if (!/^[A-Z0-9_/]+$/.test(name)) return;
    // SQL tables and function names live in different namespaces from local ABAP types.
    if (
      relation !== 'reads_from' &&
      relation !== 'function_call' &&
      (name === objectName.toUpperCase() || BUILTIN_TYPES.has(name) || locallyDefined(scopes.get(statement), name))
    )
      return;
    const key = `${relation}:${name}`;
    if (!seen.has(key)) {
      result.references.push({ line, name, relation });
      seen.add(key);
    }
  };
  for (const statement of statements) {
    for (const [expression, relation] of [
      [Expressions.SuperClassName, 'inherits_from'],
      [Expressions.ClassName, 'references'],
      [Expressions.TypeName, 'references'],
    ] as const) {
      for (const node of statement.findAllExpressionsRecursive(expression))
        add(statement, node.concatTokens(), relation, node.getFirstToken().getRow());
    }
    if (statement.get() instanceof Statements.InterfaceDef) {
      for (const node of statement.findAllExpressions(Expressions.InterfaceName))
        add(statement, node.concatTokens(), 'implements', node.getFirstToken().getRow());
    }
    for (const node of statement.findAllExpressionsRecursive(Expressions.MethodCallChain)) {
      const match = node.concatTokens().match(/^([\w/]+)=>/);
      if (match?.[1]) add(statement, match[1], 'static_call', node.getFirstToken().getRow());
    }
    if (statement.get() instanceof Statements.CallFunction) {
      for (const node of statement.findAllExpressions(Expressions.FunctionName)) {
        const literal = node.concatTokens().match(/^(['`])([\w/]+)\1$/);
        if (literal?.[2]) add(statement, literal[2], 'function_call', node.getFirstToken().getRow());
        else result.dynamicTargets += 1;
      }
    }
    for (const from of statement.findAllExpressionsRecursive(Expressions.SQLFromSource)) {
      // Host internal tables and CTE aliases have no direct DatabaseTable expression.
      const table = from.findDirectExpression(Expressions.DatabaseTable);
      if (!table) continue;
      if (table.findFirstExpression(Expressions.Dynamic)) result.dynamicTargets += 1;
      else add(statement, table.concatTokens(), 'reads_from', table.getFirstToken().getRow());
    }
  }
  return result;
}

export function extractAbapReferences(source: string, type: string, objectName: string): ExtractedReference[] {
  const result = analyzeAbapSource(source, type, objectName);
  if (result.status !== 'parsed') throw new SourceParseError(result);
  return result.references;
}

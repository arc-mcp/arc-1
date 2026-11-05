/** Enumerate statement boundaries even when a multi-class include has no ClassGlobal structure. */
import {
  Comment,
  Expressions,
  MemoryFile,
  type Nodes,
  Objects,
  Registry,
  Statements,
  Unknown,
  type Version,
} from '@abaplint/core';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';
import type { MethodInfo, MethodListResult } from './method-surgery.js';

/** Narrow lexer fallback for a namespaced interface RHS not supported by the AST grammar. */
export function methodHeaderName(statement: Nodes.StatementNode): string | undefined {
  if (statement.get() instanceof Statements.MethodImplementation)
    return statement.findFirstExpression(Expressions.MethodName)?.concatTokens();
  if (!(statement.get() instanceof Unknown)) return undefined;
  const tokens = statement.getTokens().map((token) => token.getStr());
  if (tokens.length !== 3 || tokens[0]?.toUpperCase() !== 'METHOD' || tokens[2] !== '.') return undefined;
  return /^(?:\/[A-Z0-9_]+\/)?[A-Z_][A-Z0-9_]*~\/[A-Z0-9_]+\/[A-Z_][A-Z0-9_]*$/i.test(tokens[1]!)
    ? tokens[1]
    : undefined;
}

export function methodInventory(source: string, className: string, version: Version): MethodListResult {
  const registry = new Registry(getDefaultAbaplintConfig(version));
  registry.addFile(new MemoryFile(`${className.toLowerCase().replace(/\//g, '#')}.prog.abap`, source));
  registry.parse();
  const object = registry.getFirstObject();
  if (!(object instanceof Objects.Program)) throw Error('Cannot parse class statements.');
  const declarations = new Map<string, MethodInfo>();
  const interfaces = new Map<string, MethodInfo['visibility']>();
  const methods: MethodInfo[] = [];
  let owner = '',
    mode = '',
    hasClass = false;
  let visibility: MethodInfo['visibility'] = 'public';
  let pending: { name: string; startLine: number; containingClass: string } | undefined;
  for (const statement of object.getMainABAPFile()?.getStatements() ?? []) {
    const kind = statement.get(),
      text = statement.concatTokens();
    if (kind instanceof Comment) continue;
    if (
      kind instanceof Unknown &&
      !methodHeaderName(statement) &&
      /^(?:CLASS\s+\S+\s+(?:DEFINITION|IMPLEMENTATION)\b|(?:METHOD|ENDMETHOD|ENDCLASS)\b)/i.test(text)
    )
      throw Error(
        'Cannot prove a class or method boundary with the installed parser. Read the complete source with SAPRead.',
      );
    if (kind instanceof Statements.ClassDefinition || kind instanceof Statements.ClassImplementation) {
      if (pending || owner) throw Error('Incomplete or nested class/method boundary.');
      owner = text.split(/\s+/)[1]!;
      mode = kind instanceof Statements.ClassDefinition ? 'definition' : 'implementation';
      visibility = 'public';
      hasClass = true;
      continue;
    }
    if (kind instanceof Statements.EndClass) {
      if (!owner) throw Error('ENDCLASS has no matching CLASS boundary.');
      if (pending) throw Error('Method has no ENDMETHOD before ENDCLASS.');
      owner = '';
      mode = '';
      continue;
    }
    if (mode === 'definition') {
      if (kind instanceof Statements.Public) visibility = 'public';
      if (kind instanceof Statements.Protected) visibility = 'protected';
      if (kind instanceof Statements.Private) visibility = 'private';
      if (kind instanceof Statements.InterfaceDef) {
        const name = statement.findFirstExpression(Expressions.InterfaceName)?.concatTokens();
        if (name) interfaces.set(`${owner}~${name}`.toUpperCase(), visibility);
      }
      if (kind instanceof Statements.MethodDef || (kind instanceof Unknown && /^(?:CLASS-)?METHODS\s/i.test(text))) {
        const name =
          statement.findFirstExpression(Expressions.MethodName)?.concatTokens() ??
          text.match(/^(?:CLASS-)?METHODS\s+([^\s.,]+)/i)?.[1];
        if (!name) continue;
        declarations.set(`${owner}~${name}`.toUpperCase(), {
          name,
          visibility,
          signature: text.replace(/,\s*$/, '.'),
          isRedefinition:
            !!statement.findFirstExpression(Expressions.Redefinition) ||
            (kind instanceof Unknown && /^METHODS\s+\S+\s+(?:FINAL\s+)?REDEFINITION\s*\.$/i.test(text)),
          startLine: 0,
          endLine: 0,
          isInterfaceMethod: name.includes('~'),
          containingClass: owner,
        });
      }
    }
    if (kind instanceof Statements.MethodImplementation || methodHeaderName(statement)) {
      if (pending || mode !== 'implementation') throw Error('Unowned or nested METHOD boundary.');
      const name = methodHeaderName(statement);
      if (!name) throw Error('Cannot identify the METHOD name.');
      pending = { name, startLine: statement.getStart().getRow(), containingClass: owner };
    } else if (kind instanceof Statements.EndMethod) {
      if (!pending) throw Error('ENDMETHOD has no matching METHOD boundary.');
      const key = `${pending.containingClass}~${pending.name}`.toUpperCase();
      const declaration = declarations.get(key);
      const interfaceName = pending.name.includes('~') ? pending.name.split('~')[0] : undefined;
      methods.push({
        ...pending,
        endLine: statement.getEnd().getRow(),
        signature: declaration?.signature ?? `METHODS ${pending.name}.`,
        visibility:
          declaration?.visibility ??
          (interfaceName ? interfaces.get(`${owner}~${interfaceName}`.toUpperCase()) : undefined) ??
          'public',
        isRedefinition: declaration?.isRedefinition ?? false,
        isInterfaceMethod: pending.name.includes('~'),
      });
      pending = undefined;
    }
  }
  if (pending || owner) throw Error('Incomplete class/method boundary.');
  const implemented = new Set(methods.map((method) => `${method.containingClass}~${method.name}`.toUpperCase()));
  for (const [key, declaration] of declarations) if (!implemented.has(key)) methods.push(declaration);
  const order = { public: 0, protected: 1, private: 2 };
  methods.sort(
    (a, b) => order[a.visibility] - order[b.visibility] || a.name.toUpperCase().localeCompare(b.name.toUpperCase()),
  );
  return { className, methods, success: hasClass || source.trim().length === 0 };
}

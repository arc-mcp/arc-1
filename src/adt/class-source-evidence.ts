/** Source-side inventory used to verify native class structure before pinned surgery. */
import { Expressions, type Nodes, Statements, Unknown } from '@abaplint/core';
import { parseClassSourceStatements } from './class-source-parser.js';
import { AdtSafetyError } from './errors.js';

export type SourceBlock = { first: Nodes.StatementNode; last: Nodes.StatementNode };
export interface SourceMethod {
  declaration: Nodes.StatementNode;
  visibility: 'public' | 'protected' | 'private';
  level: 'instance' | 'static';
  abstract: boolean;
  redefinition: boolean;
}
export function refuseClassEvidence(): never {
  throw new AdtSafetyError(
    'Native class structure does not agree with the exact editable owner/source. Read and update the complete source instead.',
  );
}
const className = (s: Nodes.StatementNode) =>
  s.findFirstExpression(Expressions.ClassName)?.concatTokens().toUpperCase();
export const sourceMethodName = (s: Nodes.StatementNode) =>
  s.findFirstExpression(Expressions.MethodName)?.concatTokens().toUpperCase();

export function classSourceEvidence(source: string, name: string) {
  const statements = parseClassSourceStatements(source);
  const methods = new Map<string, SourceMethod>();
  const bodies = new Map<string, SourceBlock>();
  const interfaces = new Map<string, { declaration: Nodes.StatementNode; visibility: SourceMethod['visibility'] }>();
  let definition: SourceBlock | undefined, implementation: SourceBlock | undefined;
  let current: { first: Nodes.StatementNode; selected: boolean; definition: boolean } | undefined;
  let body: Nodes.StatementNode | undefined;
  let visibility: SourceMethod['visibility'] | undefined;
  for (const s of statements) {
    const kind = s.get();
    if (kind instanceof Statements.ClassDefinition || kind instanceof Statements.ClassImplementation) {
      if (current || body) refuseClassEvidence();
      current = {
        first: s,
        selected: className(s) === name.toUpperCase(),
        definition: kind instanceof Statements.ClassDefinition,
      };
      visibility = undefined;
    } else if (kind instanceof Statements.EndClass) {
      if (!current || body) refuseClassEvidence();
      if (current.selected) {
        const block = { first: current.first, last: s };
        if (current.definition) {
          if (definition) refuseClassEvidence();
          definition = block;
        } else {
          if (implementation) refuseClassEvidence();
          implementation = block;
        }
      }
      current = undefined;
    } else if (current?.selected && current.definition) {
      if (kind instanceof Statements.Public) visibility = 'public';
      else if (kind instanceof Statements.Protected) visibility = 'protected';
      else if (kind instanceof Statements.Private) visibility = 'private';
      else if (kind instanceof Statements.InterfaceDef) {
        const interfaceName = s.findFirstExpression(Expressions.InterfaceName)?.concatTokens().toUpperCase();
        if (!interfaceName || !visibility || interfaces.has(interfaceName)) refuseClassEvidence();
        interfaces.set(interfaceName, { declaration: s, visibility });
      } else if (kind instanceof Statements.MethodDef) {
        const method = sourceMethodName(s);
        if (!method || !visibility || methods.has(method)) refuseClassEvidence();
        methods.set(method, {
          declaration: s,
          visibility,
          level: s.concatTokens().toUpperCase().startsWith('CLASS-METHODS') ? 'static' : 'instance',
          abstract: !!s.findFirstExpression(Expressions.Abstract),
          redefinition: !!s.findFirstExpression(Expressions.Redefinition),
        });
      } else if (
        kind instanceof Statements.MethodImplementation ||
        kind instanceof Statements.EndMethod ||
        kind instanceof Unknown
      )
        refuseClassEvidence();
    } else if (current?.selected) {
      if (kind instanceof Statements.MethodImplementation) {
        if (body) refuseClassEvidence();
        body = s;
      } else if (kind instanceof Statements.EndMethod) {
        const method = body && sourceMethodName(body);
        if (!body || !method || bodies.has(method)) refuseClassEvidence();
        bodies.set(method, { first: body, last: s });
        body = undefined;
      }
    }
  }
  if (!definition || current || body) refuseClassEvidence();
  return { definition, implementation, methods, bodies, interfaces };
}

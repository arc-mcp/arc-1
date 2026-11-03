import { Expressions, MemoryFile, Objects, Registry, Statements, Unknown, Version } from '@abaplint/core';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';

type SignatureResult =
  | { success: false; error: string }
  | {
      success: true;
      methodName: string;
      visibility: 'public' | 'protected' | 'private';
      signature: string;
      startLine: number;
      endLine: number;
    };

/** Read declarations only from the named global DEFINITION. No inferred or regex signatures. */
export function extractOwnMethodSignature(
  source: string,
  className: string,
  methodName: string,
  version: Version = Version.Cloud,
): SignatureResult {
  const unavailable = (detail: string): SignatureResult => ({
    success: false,
    error: `${detail} Use grep or a plain source read to inspect the declaration.`,
  });
  try {
    const normalized = source.replace(/\r\n/g, '\n');
    const registry = new Registry(getDefaultAbaplintConfig(version));
    registry.addFile(new MemoryFile(`${className.toLowerCase().replace(/\//g, '#')}.clas.abap`, normalized));
    registry.parse();
    const object = registry.getFirstObject();
    if (!(object instanceof Objects.Class)) return unavailable('Cannot parse the global class declaration.');
    const statements = object.getMainABAPFile()?.getStatements() ?? [];
    const definitions = statements.filter((statement) => {
      const tokens = statement.getTokens().map((token) => token.getStr().toUpperCase());
      return (
        tokens[0] === 'CLASS' &&
        tokens[1] === className.toUpperCase() &&
        tokens[2] === 'DEFINITION' &&
        tokens[3] !== 'DEFERRED' &&
        tokens[3] !== 'LOAD'
      );
    });
    const definition = definitions[0];
    if (definitions.length !== 1 || !(definition?.get() instanceof Statements.ClassDefinition)) {
      return unavailable('No unambiguous parsed global class DEFINITION found.');
    }
    const start = statements.indexOf(definition);
    const end = statements.findIndex(
      (statement, index) => index > start && statement.get() instanceof Statements.EndClass,
    );
    if (end < 0) return unavailable('The global class DEFINITION is incomplete.');
    const body = statements.slice(start + 1, end);
    if (
      body.some(
        (statement) =>
          statement.get() instanceof Unknown ||
          statement.get() instanceof Statements.ClassDefinition ||
          statement.get() instanceof Statements.ClassImplementation,
      )
    ) {
      return unavailable('Unsupported or incomplete syntax in the global class DEFINITION.');
    }
    const headerTokens = definition.getTokens().map((token) => token.getStr());
    const from = headerTokens.findIndex((token) => token.toUpperCase() === 'FROM');
    const superclass = from >= 0 ? headerTokens[from + 1] : undefined;
    const interfaces = body
      .filter((statement) => statement.get() instanceof Statements.InterfaceDef)
      .map((statement) => statement.getTokens()[1]?.getStr())
      .filter((name) => name !== undefined)
      .slice(0, 5);
    const ownershipHint = [
      ...(superclass ? [`Read superclass ${superclass} for inherited parameters.`] : []),
      ...(interfaces.length ? [`Read type=INTF for interface declarations: ${interfaces.join(', ')}.`] : []),
    ].join(' ');
    let visibility: 'public' | 'protected' | 'private' = 'public';
    const matches: {
      statement: (typeof statements)[number];
      visibility: 'public' | 'protected' | 'private';
      nameIndex: number;
    }[] = [];
    for (const statement of body) {
      if (statement.get() instanceof Statements.Public) visibility = 'public';
      if (statement.get() instanceof Statements.Protected) visibility = 'protected';
      if (statement.get() instanceof Statements.Private) visibility = 'private';
      if (!(statement.get() instanceof Statements.MethodDef)) continue;
      const tokens = statement.getTokens();
      const nameIndex = tokens.findIndex((token) => token.getStr().toUpperCase() === 'METHODS') + 1;
      if (nameIndex > 0 && tokens[nameIndex]?.getStr().toUpperCase() === methodName.toUpperCase()) {
        matches.push({ statement, visibility, nameIndex });
      }
    }
    if (matches.length !== 1) {
      return unavailable(`No unambiguous own method declaration found. ${ownershipHint}`.trim());
    }
    const match = matches[0]!;
    const tokens = match.statement.getTokens();
    if (match.statement.findDirectExpression(Expressions.Redefinition)) {
      return unavailable(`REDEFINITION does not declare the inherited parameters. ${ownershipHint}`.trim());
    }
    const first = tokens[match.nameIndex]!;
    const last = tokens.at(-1)!;
    if (!['.', ','].includes(last.getStr())) return unavailable('The method declaration is incomplete.');
    const lines = normalized.split('\n');
    const offsets: number[] = [0];
    for (const line of lines) offsets.push(offsets.at(-1)! + line.length + 1);
    const clause = normalized.slice(
      offsets[first.getRow() - 1]! + first.getCol() - 1,
      offsets[last.getRow() - 1]! + last.getCol() - 1,
    );
    // Dechain only the selected clause; retain its multiline types, literals and comments.
    const keyword = match.nameIndex === 1 ? 'METHODS' : 'CLASS-METHODS';
    return {
      success: true,
      methodName: first.getStr(),
      visibility: match.visibility,
      signature: `${keyword} ${clause}.`,
      startLine: first.getRow(),
      endLine: last.getRow(),
    };
  } catch {
    return unavailable('Cannot parse the global class declaration.');
  }
}

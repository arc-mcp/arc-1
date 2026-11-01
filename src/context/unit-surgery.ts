/**
 * Token-efficient surgery for procedural ABAP units.
 *
 * Locates named FORM...ENDFORM and MODULE...ENDMODULE blocks with abaplint's
 * structure tree, then replaces or inserts one whole block. Event blocks are
 * deliberately excluded because abaplint does not expose them as structures.
 */

import { MemoryFile, Registry, Statements, Structures, type Version } from '@abaplint/core';
import { ABAPLINT_MAX_RELEASE, mapSapReleaseToAbaplintVersion } from '../adt/features.js';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';

// Procedural unit surgery is on-prem only. Cloud grammar intentionally rejects classic MODULE
// blocks, so the no-probe fallback must use the on-prem parser ceiling.
const DEFAULT_VERSION = mapSapReleaseToAbaplintVersion(String(ABAPLINT_MAX_RELEASE));

export type EditableUnitKind = 'FORM' | 'MODULE';

export interface EditableUnitInfo {
  name: string;
  kind: EditableUnitKind;
  startLine: number;
  endLine: number;
}

export interface UnitSpliceResult {
  newSource: string;
  oldUnitSource: string;
  newUnitSource: string;
  unit?: EditableUnitInfo;
  success: boolean;
  error?: string;
}

interface LocatedUnit extends EditableUnitInfo {
  startColumn: number;
  endColumn: number;
}

type AstNode = {
  findAllStructuresRecursive(type: unknown): AstNode[];
  getFirstStatement(): { concatTokens(): string; getFirstToken(): { getRow(): number; getCol(): number } } | undefined;
  getLastToken(): { getRow(): number; getCol(): number; getStr(): string };
};

function parseUnitName(tokens: string, kind: EditableUnitKind): string | undefined {
  const match = tokens.match(kind === 'FORM' ? /^FORM\s+([^\s.]+)/i : /^MODULE\s+([^\s.]+)/i);
  return match?.[1];
}

function collectUnits(root: AstNode, kind: EditableUnitKind): LocatedUnit[] {
  const structureType = kind === 'FORM' ? Structures.Form : Structures.Module;
  const units: LocatedUnit[] = [];
  for (const node of root.findAllStructuresRecursive(structureType)) {
    const first = node.getFirstStatement();
    if (!first) continue;
    const name = parseUnitName(first.concatTokens(), kind);
    if (!name) continue;
    units.push({
      name,
      kind,
      startLine: first.getFirstToken().getRow(),
      endLine: node.getLastToken().getRow(),
      startColumn: first.getFirstToken().getCol(),
      endColumn: node.getLastToken().getCol() + node.getLastToken().getStr().length,
    });
  }
  return units;
}

/** List the editable FORM and MODULE blocks in a program-style source file. */
function locateUnits(source: string, objectName: string, abaplintVersion?: Version): LocatedUnit[] {
  if (/\r(?!\n)/.test(source)) throw Error('Bare carriage returns are not supported; use LF or CRLF.');
  const normalized = source.replace(/\r\n/g, '\n');
  const config = getDefaultAbaplintConfig(abaplintVersion ?? DEFAULT_VERSION);
  const registry = new Registry(config);
  registry.addFile(new MemoryFile(`${objectName.toLowerCase().replace(/\//g, '#')}.prog.abap`, normalized));
  registry.parse();

  const units: LocatedUnit[] = [];
  for (const object of registry.getObjects()) {
    const file = (object as { getMainABAPFile?: () => unknown }).getMainABAPFile?.() as
      | { getStructure(): AstNode | undefined; getStatements(): { get(): unknown }[] }
      | undefined;
    const structure = file?.getStructure();
    if (!structure) throw new Error('Source has an incomplete ABAP structure.');
    const modules = collectUnits(structure, 'MODULE');
    // abaplint can retain an unterminated MODULE as flat statements in a valid root.
    // Every MODULE/ENDMODULE statement must belong to a complete structure.
    const boundaries = file!
      .getStatements()
      .filter(
        (statement) => statement.get() instanceof Statements.Module || statement.get() instanceof Statements.EndModule,
      );
    if (boundaries.length !== modules.length * 2) throw new Error('Source has an incomplete MODULE structure.');
    units.push(...collectUnits(structure, 'FORM'), ...modules);
  }
  return units.sort((a, b) => a.startLine - b.startLine);
}

/** Public unit inventory keeps its existing line-range shape. */
export function listEditableUnits(source: string, objectName: string, abaplintVersion?: Version): EditableUnitInfo[] {
  return locateUnits(source, objectName, abaplintVersion).map(({ name, kind, startLine, endLine }) => ({
    name,
    kind,
    startLine,
    endLine,
  }));
}

function replacementError(
  unit: EditableUnitInfo,
  replacement: string,
  objectName: string,
  abaplintVersion?: Version,
): string | undefined {
  const trimmed = replacement.trim();
  const opening = trimmed.match(/^(FORM|MODULE)\s+([^\s.]+)/i);
  if (!opening) {
    return `Replacement source must be a complete ${unit.kind} ${unit.name}...END${unit.kind} block.`;
  }

  const replacementKind = opening[1]!.toUpperCase() as EditableUnitKind;
  const replacementName = opening[2]!;
  if (replacementKind !== unit.kind) {
    return `Unit "${unit.name}" is a ${unit.kind}, but the replacement starts with ${replacementKind}.`;
  }
  if (replacementName.toUpperCase() !== unit.name.toUpperCase()) {
    return `Replacement declares ${replacementKind} "${replacementName}", but the selected unit is "${unit.name}".`;
  }

  // The opening/terminator checks alone would accept two concatenated units as
  // one replacement. Parse the fragment too and require the selected unit to
  // be the only structure and to span every supplied line.
  let replacementUnits: LocatedUnit[];
  try {
    replacementUnits = locateUnits(trimmed, `${objectName}_replacement`, abaplintVersion);
  } catch (error) {
    return `Could not parse replacement source with abaplint: ${error instanceof Error ? error.message : String(error)}`;
  }
  const replacementLines = trimmed.replace(/\r\n/g, '\n').split('\n');
  const replacementLineCount = replacementLines.length;
  const tail = replacementUnits[0]
    ? replacementLines[replacementUnits[0].endLine - 1]?.slice(replacementUnits[0].endColumn - 1)
    : undefined;
  if (
    replacementUnits.length !== 1 ||
    replacementUnits[0]?.startLine !== 1 ||
    replacementUnits[0]?.endLine !== replacementLineCount ||
    tail === undefined ||
    !/^[ \t]*(?:"[^\r\n]*)?$/.test(tail)
  ) {
    return `Replacement source must contain exactly one complete ${unit.kind} ${unit.name}...END${unit.kind} block.`;
  }
  return undefined;
}

/** Replace one named FORM or MODULE block while preserving the file's line endings. */
export function spliceUnit(
  source: string,
  objectName: string,
  unitName: string,
  replacement: string,
  abaplintVersion?: Version,
): UnitSpliceResult {
  const hasCRLF = source.includes('\r\n');
  const normalized = source.replace(/\r\n/g, '\n');

  let units: LocatedUnit[];
  try {
    units = locateUnits(normalized, objectName, abaplintVersion);
  } catch (error) {
    return {
      newSource: '',
      oldUnitSource: '',
      newUnitSource: '',
      success: false,
      error: `Could not parse ${objectName} with abaplint: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const matches = units.filter((unit) => unit.name.toUpperCase() === unitName.toUpperCase());
  if (matches.length === 0) {
    const available = units.map((unit) => `${unit.kind} ${unit.name}`).join(', ');
    return {
      newSource: '',
      oldUnitSource: '',
      newUnitSource: '',
      success: false,
      error: `Unit "${unitName}" not found in ${objectName}. Available units: ${available || '(none)'}`,
    };
  }
  if (matches.length > 1) {
    const candidates = matches
      .map((unit) => `${unit.kind} ${unit.name} (lines ${unit.startLine}-${unit.endLine})`)
      .join(', ');
    return {
      newSource: '',
      oldUnitSource: '',
      newUnitSource: '',
      success: false,
      error: `Unit name "${unitName}" is ambiguous in ${objectName}: ${candidates}.`,
    };
  }

  const located = matches[0]!;
  const { name, kind, startLine, endLine } = located;
  const unit: EditableUnitInfo = { name, kind, startLine, endLine };
  const lines = normalized.split('\n');
  const before = lines[unit.startLine - 1]!.slice(0, located.startColumn - 1);
  const after = lines[unit.endLine - 1]!.slice(located.endColumn - 1);
  if (before.trim() || (after.trim() && !after.trimStart().startsWith('"'))) {
    return {
      success: false,
      error:
        'The selected unit shares a boundary line with another statement. Put its boundaries on separate lines before editing.',
      newSource: '',
      oldUnitSource: '',
      newUnitSource: '',
      unit,
    };
  }
  const invalidReplacement = replacementError(unit, replacement, objectName, abaplintVersion);
  if (invalidReplacement) {
    return {
      newSource: '',
      oldUnitSource: '',
      newUnitSource: '',
      unit,
      success: false,
      error: invalidReplacement,
    };
  }

  const oldUnitSource = lines.slice(unit.startLine - 1, unit.endLine).join('\n');
  const newUnitSource = replacement.replace(/\r\n/g, '\n').trim();
  const newLines = [...lines.slice(0, unit.startLine - 1), newUnitSource, ...lines.slice(unit.endLine)];
  let newSource = newLines.join('\n');
  if (hasCRLF) newSource = newSource.replace(/\n/g, '\r\n');

  return { newSource, oldUnitSource, newUnitSource, unit, success: true };
}

/** Append a complete new unit at physical EOF; never reposition INCLUDEs. */
export function insertUnit(
  source: string,
  objectName: string,
  unitName: string,
  addition: string,
  abaplintVersion?: Version,
): UnitSpliceResult {
  const fail = (error: string): UnitSpliceResult => ({
    success: false,
    error,
    newSource: '',
    oldUnitSource: '',
    newUnitSource: '',
  });
  const normalized = source.replace(/\r\n/g, '\n');
  let units: EditableUnitInfo[];
  try {
    units = listEditableUnits(normalized, objectName, abaplintVersion);
  } catch (error) {
    return fail(`Could not parse ${objectName}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (units.some((unit) => unit.name.toUpperCase() === unitName.toUpperCase())) {
    return fail(`Unit "${unitName}" already exists in ${objectName}; use edit_unit to replace it.`);
  }
  const kind = addition
    .trim()
    .match(/^(FORM|MODULE)\s/i)?.[1]
    ?.toUpperCase() as EditableUnitKind | undefined;
  if (!kind) return fail('source must contain one complete FORM...ENDFORM or MODULE...ENDMODULE block.');
  const unit: EditableUnitInfo = { name: unitName, kind, startLine: 1, endLine: 1 };
  const invalid = replacementError(unit, addition, objectName, abaplintVersion);
  if (invalid) return fail(invalid);

  const prefix = normalized && !normalized.endsWith('\n') ? `${normalized}\n` : normalized;
  const newUnitSource = addition.replace(/\r\n/g, '\n').trim();
  let newSource = `${prefix}${newUnitSource}\n`;
  if (source.includes('\r\n')) newSource = newSource.replace(/\n/g, '\r\n');
  unit.startLine = prefix.split('\n').length;
  unit.endLine = unit.startLine + newUnitSource.split('\n').length - 1;
  return { success: true, newSource, newUnitSource, oldUnitSource: '', unit };
}

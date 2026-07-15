/**
 * Token-efficient surgery for procedural ABAP units.
 *
 * Locates named FORM...ENDFORM and MODULE...ENDMODULE blocks with abaplint's
 * structure tree, then replaces exactly one whole block. Event blocks are
 * deliberately excluded because abaplint does not expose them as structures.
 */

import { MemoryFile, Registry, Structures, Version } from '@abaplint/core';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';

// edit_unit is on-prem only. Cloud grammar intentionally rejects classic MODULE
// blocks, so the no-probe fallback must use the on-prem parser ceiling.
const DEFAULT_VERSION = Version.v758;

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

type AstNode = {
  findAllStructuresRecursive(type: unknown): AstNode[];
  getFirstStatement(): { concatTokens(): string; getFirstToken(): { getRow(): number } } | undefined;
  getLastToken(): { getRow(): number };
};

function parseUnitName(tokens: string, kind: EditableUnitKind): string | undefined {
  const match = tokens.match(kind === 'FORM' ? /^FORM\s+([^\s.]+)/i : /^MODULE\s+([^\s.]+)/i);
  return match?.[1];
}

function collectUnits(root: AstNode, kind: EditableUnitKind): EditableUnitInfo[] {
  const structureType = kind === 'FORM' ? Structures.Form : Structures.Module;
  const units: EditableUnitInfo[] = [];
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
    });
  }
  return units;
}

/** List the editable FORM and MODULE blocks in a program-style source file. */
export function listEditableUnits(source: string, objectName: string, abaplintVersion?: Version): EditableUnitInfo[] {
  const normalized = source.replace(/\r\n/g, '\n');
  const config = getDefaultAbaplintConfig(abaplintVersion ?? DEFAULT_VERSION);
  const registry = new Registry(config);
  registry.addFile(new MemoryFile(`${objectName.toLowerCase().replace(/\//g, '#')}.prog.abap`, normalized));
  registry.parse();

  const units: EditableUnitInfo[] = [];
  for (const object of registry.getObjects()) {
    const file = (object as { getMainABAPFile?: () => unknown }).getMainABAPFile?.() as
      | { getStructure(): AstNode | undefined }
      | undefined;
    const structure = file?.getStructure();
    if (!structure) continue;
    units.push(...collectUnits(structure, 'FORM'), ...collectUnits(structure, 'MODULE'));
  }
  return units.sort((a, b) => a.startLine - b.startLine);
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

  const terminator = unit.kind === 'FORM' ? /ENDFORM\s*\.\s*$/i : /ENDMODULE\s*\.\s*$/i;
  if (!terminator.test(trimmed)) {
    return `Replacement source must end with END${unit.kind}.`;
  }

  // The opening/terminator checks alone would accept two concatenated units as
  // one replacement. Parse the fragment too and require the selected unit to
  // be the only structure and to span every supplied line.
  let replacementUnits: EditableUnitInfo[];
  try {
    replacementUnits = listEditableUnits(trimmed, `${objectName}_replacement`, abaplintVersion);
  } catch (error) {
    return `Could not parse replacement source with abaplint: ${error instanceof Error ? error.message : String(error)}`;
  }
  const replacementLineCount = trimmed.replace(/\r\n/g, '\n').split('\n').length;
  if (
    replacementUnits.length !== 1 ||
    replacementUnits[0]?.startLine !== 1 ||
    replacementUnits[0]?.endLine !== replacementLineCount
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

  let units: EditableUnitInfo[];
  try {
    units = listEditableUnits(normalized, objectName, abaplintVersion);
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

  const unit = matches[0]!;
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

  const lines = normalized.split('\n');
  const oldUnitSource = lines.slice(unit.startLine - 1, unit.endLine).join('\n');
  const newUnitSource = replacement.replace(/\r\n/g, '\n').trim();
  const newLines = [...lines.slice(0, unit.startLine - 1), newUnitSource, ...lines.slice(unit.endLine)];
  let newSource = newLines.join('\n');
  if (hasCRLF) newSource = newSource.replace(/\n/g, '\r\n');

  return { newSource, oldUnitSource, newUnitSource, unit, success: true };
}

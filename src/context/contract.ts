/**
 * Public API contract extraction from ABAP source code.
 *
 * Uses @abaplint/core AST to extract only the public-facing API:
 * - Classes: CLASS DEFINITION + PUBLIC SECTION only
 * - Interfaces: Full source (interfaces are already public contracts)
 * - Function modules: Signature block only (IMPORTING/EXPORTING params)
 *
 * This achieves 7-30x token compression vs full source code.
 */

import { MemoryFile, Registry, Statements, Structures, Version } from '@abaplint/core';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';
import type { Contract } from './types.js';

// Cast helpers for abaplint AST nodes
type AstNode = {
  findAllStatements(type: unknown): Array<{ concatTokens(): string; getFirstToken(): { getRow(): number } }>;
  findAllStatementNodes(): Array<{ concatTokens(): string; get(): { constructor: { name: string } } }>;
  findDirectStructures(type: unknown): AstNode[];
  findAllStructuresRecursive(type: unknown): AstNode[];
  concatTokens(): string;
  getFirstStatement(): { concatTokens(): string } | undefined;
};

/**
 * Extract the public API contract from ABAP source.
 */
/** Default abaplint version for contract extraction (Cloud = superset of all) */
const DEFAULT_VERSION = Version.Cloud;

export function extractContract(
  source: string,
  name: string,
  objectType: 'CLAS' | 'INTF' | 'FUNC' | 'UNKNOWN',
  abaplintVersion?: Version,
): Contract {
  // Normalize CRLF → LF (SAP ADT returns CRLF which can break abaplint parsing)
  const normalized = source.replace(/\r\n/g, '\n');
  const ver = abaplintVersion ?? DEFAULT_VERSION;
  try {
    switch (objectType) {
      case 'CLAS':
        return extractClassContract(normalized, name, ver);
      case 'INTF':
        return extractInterfaceContract(normalized, name, ver);
      case 'FUNC':
        return extractFunctionContract(normalized, name);
      default:
        return { name, type: objectType, methodCount: 0, source: normalized, success: true };
    }
  } catch (err) {
    return {
      name,
      type: objectType,
      methodCount: 0,
      source: '',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Extract class contract: CLASS DEFINITION + PUBLIC SECTION only.
 * Strips PROTECTED, PRIVATE sections and entire CLASS IMPLEMENTATION.
 */
function extractClassContract(source: string, name: string, ver: Version): Contract {
  const config = getDefaultAbaplintConfig(ver);
  const reg = new Registry(config);
  reg.addFile(new MemoryFile(`${name.toLowerCase()}.clas.abap`, source));
  reg.parse();

  for (const obj of reg.getObjects()) {
    const file = (obj as { getMainABAPFile?: () => unknown }).getMainABAPFile?.() as
      | { getStructure(): AstNode | undefined }
      | undefined;
    if (!file) continue;

    const structure = file.getStructure();
    if (!structure) continue;

    // Find the ClassDefinition structure (not the statement)
    const classDefs = structure.findAllStructuresRecursive(Structures.ClassDefinition);
    if (classDefs.length === 0) {
      // Fall back to regex-based extraction
      return extractClassContractRegex(source, name);
    }

    for (const classDef of classDefs) {
      // Get the opening CLASS...DEFINITION statement
      const firstStmt = classDef.getFirstStatement();
      const classLine = firstStmt?.concatTokens() ?? '';

      // Find PublicSection
      const pubSections = classDef.findDirectStructures(Structures.PublicSection);
      if (pubSections.length === 0) {
        // Class has no public section
        const lines = [classLine, '  PUBLIC SECTION.', 'ENDCLASS.'];
        return { name, type: 'CLAS', methodCount: 0, source: lines.join('\n'), success: true };
      }

      // Reconstruct public section from statements
      const pubStmts = pubSections[0].findAllStatementNodes();
      const pubLines = pubStmts.map((s) => `  ${s.concatTokens()}`);

      // Count methods
      const methodDefs = pubSections[0].findAllStatements(Statements.MethodDef);
      const methodCount = methodDefs.length;

      const lines = [classLine, ...pubLines, 'ENDCLASS.'];
      return { name, type: 'CLAS', methodCount, source: lines.join('\n'), success: true };
    }
  }

  // Fallback to regex if AST parsing fails
  return extractClassContractRegex(source, name);
}

/**
 * Regex-based fallback for class contract extraction.
 * Used when AST parsing doesn't produce a ClassDefinition structure.
 */
function extractClassContractRegex(source: string, name: string): Contract {
  const lines = source.split('\n');
  const result: string[] = [];
  let inDefinition = false;
  let inPublic = false;
  let methodCount = 0;

  for (const line of lines) {
    const upper = line.toUpperCase().trim();

    if (upper.match(/^CLASS\s+\S+\s+DEFINITION/)) {
      inDefinition = true;
      result.push(line);
      continue;
    }

    if (!inDefinition) continue;

    if (upper === 'PUBLIC SECTION.') {
      inPublic = true;
      result.push(line);
      continue;
    }

    if (upper === 'PROTECTED SECTION.' || upper === 'PRIVATE SECTION.') {
      inPublic = false;
      continue;
    }

    if (upper === 'ENDCLASS.') {
      result.push('ENDCLASS.');
      break;
    }

    if (inPublic) {
      result.push(line);
      if (upper.match(/^\s*METHODS\s/)) methodCount++;
    }
  }

  if (result.length === 0) {
    return { name, type: 'CLAS', methodCount: 0, source, success: true };
  }

  return { name, type: 'CLAS', methodCount, source: result.join('\n'), success: true };
}

/**
 * Extract interface contract: return full source (interfaces are already contracts).
 * Count methods for stats.
 */
function extractInterfaceContract(source: string, name: string, ver: Version): Contract {
  const config = getDefaultAbaplintConfig(ver);
  const reg = new Registry(config);
  reg.addFile(new MemoryFile(`${name.toLowerCase()}.intf.abap`, source));
  reg.parse();

  let methodCount = 0;
  for (const obj of reg.getObjects()) {
    const file = (obj as { getMainABAPFile?: () => unknown }).getMainABAPFile?.() as
      | { getStructure(): AstNode | undefined }
      | undefined;
    if (!file) continue;

    const structure = file.getStructure();
    if (!structure) continue;

    const intfs = structure.findAllStructuresRecursive(Structures.Interface);
    for (const intf of intfs) {
      const methodDefs = intf.findAllStatements(Statements.MethodDef);
      methodCount = methodDefs.length;
    }
  }

  // Interfaces are already public contracts — return as-is
  return { name, type: 'INTF', methodCount, source: source.trim(), success: true };
}

/**
 * Extract function module contract: signature block only.
 * Keeps FUNCTION line + *" parameter comments + ENDFUNCTION.
 */
function extractFunctionContract(source: string, name: string): Contract {
  const lines = source.split('\n');
  const result: string[] = [];
  let inFunction = false;
  let pastSignature = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();

    if (upper.startsWith('FUNCTION ')) {
      inFunction = true;
      result.push(line);
      continue;
    }

    if (!inFunction) continue;

    if (upper === 'ENDFUNCTION.') {
      result.push('ENDFUNCTION.');
      break;
    }

    // Signature comment lines start with *"
    if (trimmed.startsWith('*"')) {
      result.push(line);
      continue;
    }

    // Once we hit a non-signature line, we're past the signature
    if (!pastSignature && !trimmed.startsWith('*"') && trimmed !== '') {
      pastSignature = true;
    }
  }

  // Count parameters in signature
  const paramCount = result.filter((l) => l.trim().startsWith('*"')).length;

  return {
    name,
    type: 'FUNC',
    methodCount: paramCount, // for FMs, "methodCount" means parameter count
    source: result.join('\n'),
    success: true,
  };
}

/**
 * AST-based dependency extraction from ABAP source code.
 *
 * Uses @abaplint/core to parse ABAP into an AST, then walks the tree
 * to find all external references (classes, interfaces, function modules,
 * exception classes). This is more accurate than the Go version's regex
 * approach — no false positives from string literals or comments.
 *
 * Extracted dependency kinds:
 * - inheritance:    CLASS ... INHERITING FROM <name>
 * - interface:      INTERFACES <name>
 * - type_ref:       TYPE REF TO <name>, NEW <name>(), CAST <name>()
 * - static_call:    <name>=>method()
 * - function_call:  CALL FUNCTION '<name>'
 * - exception:      RAISING <name>, CATCH <name>
 */

import { Expressions, MemoryFile, Registry, Statements, Version } from '@abaplint/core';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';
import { detectFilename } from '../lint/lint.js';
import type { Dependency, DependencyKind } from './types.js';

/**
 * abaplint version for parsing.
 * We use Cloud (the superset of all on-prem versions) so that source code
 * from ANY SAP release (7.00 through 7.58, S/4HANA, BTP ABAP Environment)
 * parses successfully.  Lower versions silently produce no AST structure
 * when they encounter unknown syntax (e.g. v740sp02 fails on ENUM types,
 * GLOBAL FRIENDS, and other 7.50+ features found in /DMO/ demo objects).
 * Since we only extract dependencies here (no linting), the permissive
 * parser is the correct choice.
 */
const ABAPLINT_VERSION = Version.Cloud;

/** ABAP built-in types that are never external dependencies */
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
  'CLIKE',
  'CSEQUENCE',
  'NUMERIC',
  'SIMPLE',
  'XSEQUENCE',
  'TABLE',
  'STANDARD TABLE',
  'SORTED TABLE',
  'HASHED TABLE',
  'REF TO',
]);

/** SAP standard prefixes that we filter out by default */
const SAP_STANDARD_PREFIXES = ['CL_ABAP_', 'IF_ABAP_', 'CX_SY_', 'CL_GUI_', 'CL_SALV_', 'CL_BCS_', 'CL_OS_'];

/**
 * Check if a name is a built-in ABAP type (not an external dependency).
 */
function isBuiltinType(name: string): boolean {
  return BUILTIN_TYPES.has(name.toUpperCase());
}

/**
 * Check if a name is a SAP standard object that should be filtered.
 */
function isSapStandard(name: string): boolean {
  const upper = name.toUpperCase();
  return SAP_STANDARD_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * Check if a name is a custom object (Z* or Y* namespace).
 */
function isCustomObject(name: string): boolean {
  const upper = name.toUpperCase();
  return upper.startsWith('Z') || upper.startsWith('Y');
}

/**
 * Extract dependencies from ABAP source using @abaplint/core AST.
 *
 * Parses the source, walks the AST to find all external references,
 * filters out built-in types and self-references, deduplicates,
 * and sorts (custom objects first).
 *
 * @param source - ABAP source code
 * @param objectName - Name of the object being analyzed (filtered from results)
 * @param filterSapStandard - Whether to filter SAP standard objects (default true)
 * @returns Deduplicated, sorted list of dependencies
 */
export function extractDependencies(
  source: string,
  objectName: string,
  filterSapStandard = true,
  abaplintVersion?: Version,
): Dependency[] {
  // Normalize CRLF → LF (SAP ADT returns CRLF which can break abaplint parsing)
  const normalizedSource = source.replace(/\r\n/g, '\n');
  const config = getDefaultAbaplintConfig(abaplintVersion ?? ABAPLINT_VERSION);
  const filename = detectFilename(normalizedSource, objectName);
  const reg = new Registry(config);
  reg.addFile(new MemoryFile(filename, normalizedSource));
  reg.parse();

  const rawDeps: Dependency[] = [];

  for (const obj of reg.getObjects()) {
    const file = (obj as { getMainABAPFile?: () => unknown }).getMainABAPFile?.() as
      | { getStructure(): unknown }
      | undefined;
    if (!file) continue;

    const structure = file.getStructure() as
      | {
          findAllExpressionsRecursive(
            type: unknown,
          ): Array<{ concatTokens(): string; getFirstToken(): { getRow(): number } }>;
          findAllStatements(type: unknown): Array<{
            concatTokens(): string;
            getFirstToken(): { getRow(): number };
            findAllExpressions(type: unknown): Array<{ concatTokens(): string }>;
            findAllExpressionsRecursive(type: unknown): Array<{ concatTokens(): string }>;
          }>;
        }
      | undefined;
    if (!structure) continue;

    // 1. INHERITING FROM — via SuperClassName expression
    const superClasses = structure.findAllExpressionsRecursive(Expressions.SuperClassName);
    for (const node of superClasses) {
      addDep(rawDeps, node.concatTokens(), 'inheritance', node.getFirstToken().getRow());
    }

    // 2. INTERFACES — via InterfaceDef statement
    const intfDefs = structure.findAllStatements(Statements.InterfaceDef);
    for (const stmt of intfDefs) {
      const intfNames = stmt.findAllExpressions(Expressions.InterfaceName);
      for (const node of intfNames) {
        addDep(rawDeps, node.concatTokens(), 'interface', stmt.getFirstToken().getRow());
      }
    }

    // 3. ClassName expressions — covers TYPE REF TO, NEW, CAST, CATCH, RAISING, static calls
    const classNames = structure.findAllExpressionsRecursive(Expressions.ClassName);
    for (const node of classNames) {
      const name = node.concatTokens();
      addDep(rawDeps, name, 'type_ref', node.getFirstToken().getRow());
    }

    // 4. TypeName expressions — covers DATA ... TYPE <name>, TYPES ... TYPE <name>
    const typeNames = structure.findAllExpressionsRecursive(Expressions.TypeName);
    for (const node of typeNames) {
      const name = node.concatTokens();
      // TypeName can be multi-part (e.g., "zcl_class=>ty_type") — take the first segment
      const firstSegment = name.split('=>')[0].split('->')[0].split('-')[0].split('~')[0].trim();
      if (firstSegment) {
        addDep(rawDeps, firstSegment, 'type_ref', node.getFirstToken().getRow());
      }
    }

    // 5. MethodCallChain — for static calls (ClassName=>method)
    const chains = structure.findAllExpressionsRecursive(Expressions.MethodCallChain);
    for (const node of chains) {
      const text = node.concatTokens();
      const match = text.match(/^(\w[\w/]*)=>/);
      if (match) {
        addDep(rawDeps, match[1], 'static_call', node.getFirstToken().getRow());
      }
    }

    // 6. CALL FUNCTION — via CallFunction statement + FunctionName expression
    const callFuncs = structure.findAllStatements(Statements.CallFunction);
    for (const stmt of callFuncs) {
      const funcNames = stmt.findAllExpressions(Expressions.FunctionName);
      for (const node of funcNames) {
        // Function name is typically in quotes: 'Z_DELIVERY_FM'
        const name = node.concatTokens().replace(/'/g, '').trim();
        if (name) {
          addDep(rawDeps, name, 'function_call', stmt.getFirstToken().getRow());
        }
      }
    }

    // 7. CATCH — exception classes via ClassName in Catch statements
    const catches = structure.findAllStatements(Statements.Catch);
    for (const stmt of catches) {
      const exNames = stmt.findAllExpressionsRecursive(Expressions.ClassName);
      for (const node of exNames) {
        addDep(rawDeps, node.concatTokens(), 'exception', stmt.getFirstToken().getRow());
      }
    }

    // 8. NEW and CAST — via dedicated expression types (v7.40+)
    const newObjs = structure.findAllExpressionsRecursive(Expressions.NewObject);
    for (const node of newObjs) {
      const typeNode = (
        node as { findFirstExpression?(type: unknown): { concatTokens(): string } | undefined }
      ).findFirstExpression?.(Expressions.TypeNameOrInfer);
      if (typeNode) {
        const name = typeNode.concatTokens();
        if (name !== '#') {
          addDep(rawDeps, name, 'type_ref', node.getFirstToken().getRow());
        }
      }
    }

    const casts = structure.findAllExpressionsRecursive(Expressions.Cast);
    for (const node of casts) {
      const typeNode = (
        node as { findFirstExpression?(type: unknown): { concatTokens(): string } | undefined }
      ).findFirstExpression?.(Expressions.TypeNameOrInfer);
      if (typeNode) {
        const name = typeNode.concatTokens();
        if (name !== '#') {
          addDep(rawDeps, name, 'type_ref', node.getFirstToken().getRow());
        }
      }
    }
  }

  // Deduplicate and filter
  return deduplicateAndFilter(rawDeps, objectName, filterSapStandard);
}

/** Add a dependency to the raw list */
function addDep(deps: Dependency[], name: string, kind: DependencyKind, line: number): void {
  const trimmed = name.trim();
  if (trimmed && !isBuiltinType(trimmed)) {
    deps.push({ name: trimmed, kind, line });
  }
}

/**
 * Deduplicate dependencies, filter self-references and optionally SAP standard,
 * then sort (custom objects first, alphabetically within each group).
 */
function deduplicateAndFilter(rawDeps: Dependency[], objectName: string, filterSapStandard: boolean): Dependency[] {
  const seen = new Set<string>();
  const result: Dependency[] = [];
  const selfName = objectName.toUpperCase();

  for (const dep of rawDeps) {
    const upper = dep.name.toUpperCase();

    // Skip self-references
    if (upper === selfName) continue;

    // Skip built-ins (double-check)
    if (isBuiltinType(dep.name)) continue;

    // Skip SAP standard if filtering enabled
    if (filterSapStandard && isSapStandard(dep.name)) continue;

    // Deduplicate — keep the first occurrence (preserves most meaningful kind)
    if (seen.has(upper)) continue;
    seen.add(upper);

    result.push(dep);
  }

  // Sort: custom objects (Z*, Y*) first, then others, alphabetically within each group
  result.sort((a, b) => {
    const aCustom = isCustomObject(a.name);
    const bCustom = isCustomObject(b.name);
    if (aCustom && !bCustom) return -1;
    if (!aCustom && bCustom) return 1;
    return a.name.toUpperCase().localeCompare(b.name.toUpperCase());
  });

  return result;
}

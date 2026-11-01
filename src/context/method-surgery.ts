/**
 * Method-level surgery for ABAP classes.
 *
 * Provides three operations for token-efficient class editing:
 * 1. listMethods    — Extract method table-of-contents (names, signatures, visibility, line ranges)
 * 2. extractMethod  — Read a single method implementation (~95% token reduction vs full class)
 * 3. spliceMethod   — Surgically replace a single method body, return new full source
 *
 * All functions are pure (no I/O) — they operate on source strings and return results.
 * Uses parsed statement boundaries, including multi-class includes without a complete structure tree.
 */

import { Comment, MemoryFile, Objects, Registry, Statements, Unknown, Version } from '@abaplint/core';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';
import { methodHeaderName, methodInventory } from './method-inventory.js';
import { methodNotFoundMessage } from './method-suggestions.js';

const DEFAULT_VERSION = Version.Cloud;

// ─── Types ──────────────────────────────────────────────────────────

/** Metadata about a single method in a class */
export interface MethodInfo {
  /** Method name, e.g. "get_name" or "zif_order~process" */
  name: string;
  /** Visibility section where the method is defined */
  visibility: 'public' | 'protected' | 'private';
  /** Full METHODS statement text from the definition (e.g. "METHODS get_name RETURNING VALUE(rv) TYPE string.") */
  signature: string;
  /** 1-based line number of METHOD statement in implementation */
  startLine: number;
  /** 1-based line number of ENDMETHOD statement */
  endLine: number;
  /** Whether the method has REDEFINITION keyword */
  isRedefinition: boolean;
  /** Whether the name contains ~ (interface method implementation) */
  isInterfaceMethod: boolean;
  /**
   * Local class name from `CLASS xxx IMPLEMENTATION.` containing this method
   * (e.g. "lhc_project", "lcl_helper"). Distinct from `MethodListResult.className`,
   * which is the global class. For sources containing only one class block this
   * matches the global name; for CCDEF/CCIMP includes with multiple local classes
   * this is what enables qualified-name disambiguation in `extractMethod`.
   *
   * Empty string when no IMPLEMENTATION block could be associated (e.g. a
   * definition-only signature with no impl).
   */
  containingClass?: string;
}

/** Result of listing all methods in a class */
export interface MethodListResult {
  className: string;
  methods: MethodInfo[];
  success: boolean;
  error?: string;
}

/** Result of extracting a single method */
export interface MethodExtractResult {
  className: string;
  methodName: string;
  /** Full method block: METHOD ... ENDMETHOD. (including keywords) */
  methodSource: string;
  /** Just the body between METHOD and ENDMETHOD */
  bodySource: string;
  /** 1-based start line in original source */
  startLine: number;
  /** 1-based end line in original source */
  endLine: number;
  success: boolean;
  error?: string;
}

/** Result of splicing a new method body into the class source */
export interface MethodSpliceResult {
  /** Complete new class source with method replaced */
  newSource: string;
  /** The old method source that was replaced */
  oldMethodSource: string;
  /** The new method source that replaced it */
  newMethodSource: string;
  success: boolean;
  error?: string;
}

/** List methods without dropping duplicate bodies or formatting variants from the ambiguity check. */
export function listMethods(source: string, className: string, abaplintVersion?: Version): MethodListResult {
  try {
    if (/\r(?!\n)/.test(source)) throw Error('Bare carriage returns are not supported; use LF or CRLF.');
    return methodInventory(source.replace(/\r\n/g, '\n'), className, abaplintVersion ?? DEFAULT_VERSION);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      className,
      methods: [],
      success: false,
      error: message.includes('SAPRead') ? message : `${message} Read the complete source with SAPRead.`,
    };
  }
}

// ─── Extract Method ─────────────────────────────────────────────────

/**
 * Extract a single method's implementation from a class.
 *
 * Lookup order:
 * 1. **Cross-class ambiguity guard** — if multiple exact matches (including
 *    interface-qualified names) exist in different containing local
 *    classes, error with a list of qualified candidates. Prevents silent
 *    first-match wins on CCIMP sources.
 * 2. **Exact match** — `m.name === methodName`. Catches both unique bare names
 *    and global-interface implementations stored as `zif_order~create`.
 * 3. **Qualified-class match** — only when methodName has `~` AND step 2 found
 *    nothing. Splits LHS/RHS and matches against the method's `containingClass`
 *    plus its bare name. Routes `lhc_project~approve_project` → the right
 *    method inside `CLASS lhc_project IMPLEMENTATION`.
 * 4. **Fuzzy interface match** — last-resort suffix match for callers who pass
 *    a bare name that happens to match the right-hand side of an interface
 *    method specifier (e.g. `process` → `zif_order~process`).
 *
 * Supports:
 * - Exact name match: "get_name"
 * - Interface method: "zif_order~process"
 * - Local-class qualified: "lhc_project~approve_project"
 * - Fuzzy interface match: "process" finds "zif_order~process"
 */
export function extractMethod(
  source: string,
  className: string,
  methodName: string,
  abaplintVersion?: Version,
): MethodExtractResult {
  const normalized = source.replace(/\r\n/g, '\n');
  const listing = listMethods(normalized, className, abaplintVersion);

  if (!listing.success) {
    return {
      className,
      methodName,
      methodSource: '',
      bodySource: '',
      startLine: 0,
      endLine: 0,
      success: false,
      error: listing.error ?? 'Failed to list methods',
    };
  }

  const implementations = listing.methods.filter((m) => m.startLine > 0 && m.endLine >= m.startLine);
  const upperName = methodName.toUpperCase();
  const hasTilde = methodName.includes('~');

  // ── Step 1: cross-class ambiguity guard ──
  // Exact interface-qualified names can also occur in multiple local classes.
  // If caller passed "approve_project" and the source has BOTH
  //   CLASS lhc_project IMPLEMENTATION. METHOD approve_project. ENDMETHOD.
  //   CLASS lhc_task IMPLEMENTATION.    METHOD approve_project. ENDMETHOD.
  // …then `find()` would silently pick whichever appears first in source order.
  // Detect the multi-class match early and ask the caller to qualify.
  const exactCandidates = implementations.filter((m) => m.name.toUpperCase() === upperName);
  if (exactCandidates.length > 1) {
    const distinctClasses = Array.from(
      new Set(exactCandidates.map((c) => (c.containingClass ?? '').trim()).filter((c) => c.length > 0)),
    );
    if (distinctClasses.length > 1) {
      const qualified = distinctClasses.map((cls) => `${cls}~${methodName}`).join(', ');
      return {
        className,
        methodName,
        methodSource: '',
        bodySource: '',
        startLine: 0,
        endLine: 0,
        success: false,
        error:
          `Ambiguous method name "${methodName}" in ${className}. ` +
          `Multiple local classes define it: ${distinctClasses.join(', ')}. ` +
          `Use a qualified name like "${qualified.split(', ')[0]}".`,
      };
    }
    return {
      className,
      methodName,
      methodSource: '',
      bodySource: '',
      startLine: 0,
      endLine: 0,
      success: false,
      error: `Ambiguous method name "${methodName}" in ${className}. Multiple implementations match; read and update the complete editable source to resolve the duplicate.`,
    };
  }

  // ── Step 2: exact match ──
  let method = implementations.find((m) => m.name.toUpperCase() === upperName);

  // ── Step 3: qualified-class match (lhc_project~approve_project) ──
  // Only fires when caller passed a tilde AND the exact lookup above didn't
  // catch it. This branch must NOT intercept global-interface methods like
  // `zif_order~create` — those are stored with `~` in `m.name` and are
  // matched by step 2.
  if (!method && hasTilde) {
    const tildeIdx = methodName.indexOf('~');
    const lhsUpper = methodName.slice(0, tildeIdx).toUpperCase();
    const rhsUpper = methodName.slice(tildeIdx + 1).toUpperCase();
    const qualifiedMatches = implementations.filter(
      (m) => (m.containingClass ?? '').toUpperCase() === lhsUpper && m.name.toUpperCase() === rhsUpper,
    );
    if (qualifiedMatches.length === 1) {
      method = qualifiedMatches[0];
    } else if (qualifiedMatches.length > 1) {
      // ABAP forbids two methods with the same name in the same class, but
      // belt-and-braces — surface it instead of silently picking one.
      const names = qualifiedMatches.map((c) => `${c.containingClass}~${c.name}`).join(', ');
      return {
        className,
        methodName,
        methodSource: '',
        bodySource: '',
        startLine: 0,
        endLine: 0,
        success: false,
        error: `Ambiguous qualified method "${methodName}". Matched multiple: ${names}.`,
      };
    }
  }

  // ── Step 4: existing fuzzy interface match — unchanged ──
  if (!method) {
    // Fuzzy: user said "process", we try to match "*~process"
    const candidates = implementations.filter((m) => {
      const parts = m.name.toUpperCase().split('~');
      return parts.length === 2 && parts[1] === upperName;
    });
    if (candidates.length === 1) {
      method = candidates[0];
    } else if (candidates.length > 1) {
      const names = candidates.map((c) => c.name).join(', ');
      return {
        className,
        methodName,
        methodSource: '',
        bodySource: '',
        startLine: 0,
        endLine: 0,
        success: false,
        error: `Ambiguous method name "${methodName}". Multiple interface methods match: ${names}. Use the full name (e.g., "zif_order~process").`,
      };
    }
  }

  if (!method || method.startLine === 0 || method.endLine === 0) {
    const declarations = listing.methods.filter((candidate) => !candidate.startLine || !candidate.endLine);
    const exactDeclaration = declarations.find((candidate) => candidate.name.toUpperCase() === upperName);
    const qualifiedDeclarations = declarations.filter((candidate) =>
      hasTilde
        ? `${candidate.containingClass ?? ''}~${candidate.name}`.toUpperCase() === upperName
        : candidate.name.toUpperCase().split('~').at(-1) === upperName,
    );
    return {
      className,
      methodName,
      methodSource: '',
      bodySource: '',
      startLine: 0,
      endLine: 0,
      success: false,
      error: methodNotFoundMessage(
        className,
        methodName,
        listing.methods,
        method ?? exactDeclaration ?? (qualifiedDeclarations.length === 1 ? qualifiedDeclarations[0] : undefined),
      ),
    };
  }

  const lines = normalized.split('\n');
  const methodLines = lines.slice(method.startLine - 1, method.endLine);
  const methodSource = methodLines.join('\n');

  // Body = everything between METHOD line and ENDMETHOD line
  const bodyLines = methodLines.slice(1, -1);
  const bodySource = bodyLines.join('\n');

  return {
    className,
    methodName: method.name,
    methodSource,
    bodySource,
    startLine: method.startLine,
    endLine: method.endLine,
    success: true,
  };
}

// ─── Splice Method ──────────────────────────────────────────────────

/** Preserve boundary statements, including multiline AMDP headers and trailing comments. */
function methodBoundaries(
  source: string,
  version: Version,
): { opening: string; closing: string; name: string } | undefined {
  if (/\r(?!\n)/.test(source)) return undefined;
  const registry = new Registry(getDefaultAbaplintConfig(version));
  registry.addFile(new MemoryFile('zmethod.prog.abap', source));
  registry.parse();
  const object = registry.getFirstObject();
  if (!(object instanceof Objects.Program)) return undefined;
  const statements =
    object
      .getMainABAPFile()
      ?.getStatements()
      .filter((s) => !(s.get() instanceof Comment)) ?? [];
  const first = statements[0];
  const last = statements.at(-1);
  // extractMethod selects whole lines. Refuse when a neighboring statement shares those lines.
  const boundaries = statements.filter(
    (s) => methodHeaderName(s) !== undefined || s.get() instanceof Statements.EndMethod,
  );
  if (
    !first ||
    methodHeaderName(first) === undefined ||
    !(last?.get() instanceof Statements.EndMethod) ||
    boundaries.length !== 2 ||
    statements.slice(1, -1).some((statement) => {
      const kind = statement.get();
      return (
        [
          Statements.ClassDefinition,
          Statements.ClassImplementation,
          Statements.ClassDeferred,
          Statements.EndClass,
          Statements.Interface,
          Statements.InterfaceDeferred,
          Statements.EndInterface,
          Statements.Form,
          Statements.FormDefinition,
          Statements.EndForm,
          Statements.Module,
          Statements.EndModule,
          Statements.Report,
          Statements.Program,
          Statements.FunctionModule,
          Statements.FunctionPool,
          Statements.EndFunction,
        ].some((boundary) => kind instanceof boundary) ||
        (kind instanceof Unknown &&
          /^(?:METHOD\b|ENDMETHOD\b|CLASS(?:\s|$)|ENDCLASS\b|INTERFACE\s|ENDINTERFACE\b|FORM\s|ENDFORM\b|MODULE\s|ENDMODULE\b|REPORT\s|PROGRAM\s|FUNCTION(?:-|\s)|ENDFUNCTION\b)/i.test(
            statement.concatTokens(),
          ))
      );
    })
  )
    return undefined;
  const lines = source.split('\n');
  const headerRow = first.getEnd().getRow() - 1;
  const headerColumn = first.getEnd().getCol() - 1;
  const headerLine = lines[headerRow]!;
  // Keep an inline header comment, but discard an old body on the same line.
  const headerEnd = /^[ \t]*(?:".*)?$/.test(headerLine.slice(headerColumn)) ? headerLine.length : headerColumn;
  const opening = [...lines.slice(0, headerRow), headerLine.slice(0, headerEnd)].join('\n');
  const footerRow = last.getStart().getRow() - 1;
  const footerColumn = last.getStart().getCol() - 1;
  const footerLine = lines[footerRow]!;
  const prefix = footerLine.slice(0, footerColumn);
  const indent = /^[ \t]*$/.test(prefix) ? prefix : source.match(/^[ \t]*/)![0];
  const name = /^METHOD\s+([^\s.]+)/i.exec(first.concatTokens())?.[1];
  if (!name) return undefined;
  return {
    opening,
    closing: [indent + footerLine.slice(footerColumn), ...lines.slice(footerRow + 1)].join('\n'),
    name,
  };
}

/**
 * Surgically replace a single method's implementation in a class source.
 *
 * @param source - Full class source code
 * @param className - Class name
 * @param methodName - Method to replace
 * @param newBody - New method body. Either:
 *   - Just the body content (auto-wrapped with METHOD/ENDMETHOD)
 *   - Full METHOD...ENDMETHOD block (detected and used as-is)
 */
export function spliceMethod(
  source: string,
  className: string,
  methodName: string,
  newBody: string,
  abaplintVersion?: Version,
): MethodSpliceResult {
  // Detect line ending style (preserve original)
  const hasCRLF = source.includes('\r\n');
  const normalized = source.replace(/\r\n/g, '\n');
  const extracted = extractMethod(normalized, className, methodName, abaplintVersion);

  if (!extracted.success) {
    return {
      newSource: '',
      oldMethodSource: '',
      newMethodSource: '',
      success: false,
      error: extracted.error,
    };
  }

  // Determine if newBody is a full METHOD...ENDMETHOD block or just the body
  const trimmedBody = newBody.trim();
  const isFullBlock = /^METHOD\s+/i.test(trimmedBody) && /ENDMETHOD\s*\.?\s*$/i.test(trimmedBody);

  const boundaries = methodBoundaries(extracted.methodSource, abaplintVersion ?? DEFAULT_VERSION);
  if (!boundaries) {
    return {
      newSource: '',
      oldMethodSource: extracted.methodSource,
      newMethodSource: '',
      success: false,
      error: 'Cannot isolate the selected method. Put neighboring statements on separate lines before editing.',
    };
  }
  let newMethodBlock: string;
  if (isFullBlock) {
    // Use the body as-is (preserve original indentation)
    // Normalize to \n for consistent splicing, then re-apply line endings at the end
    newMethodBlock = newBody.replace(/\r\n/g, '\n');
  } else {
    newMethodBlock = `${boundaries.opening}\n${newBody.replace(/\r\n/g, '\n')}\n${boundaries.closing}`;
  }

  const replacement = methodBoundaries(newMethodBlock, abaplintVersion ?? DEFAULT_VERSION);
  if (!replacement || replacement.name.toUpperCase() !== extracted.methodName.toUpperCase()) {
    return {
      newSource: '',
      oldMethodSource: extracted.methodSource,
      newMethodSource: '',
      success: false,
      error: `Replacement must contain only the selected METHOD ${extracted.methodName}...ENDMETHOD block.`,
    };
  }

  // Replace in source
  const lines = normalized.split('\n');
  const before = lines.slice(0, extracted.startLine - 1);
  const after = lines.slice(extracted.endLine);

  let newSource = [...before, newMethodBlock, ...after].join('\n');

  // Restore original line ending style
  if (hasCRLF) {
    newSource = newSource.replace(/\n/g, '\r\n');
  }

  return {
    newSource,
    oldMethodSource: extracted.methodSource,
    newMethodSource: newMethodBlock,
    success: true,
  };
}

// ─── Format Method Listing ──────────────────────────────────────────

/**
 * Format a MethodListResult into a human-readable, LLM-friendly text.
 */
export function formatMethodListing(listing: MethodListResult): string {
  if (!listing.success) {
    return `Failed to list methods for ${listing.className}: ${listing.error}`;
  }

  if (listing.methods.length === 0) {
    return `=== ${listing.className} (0 methods) ===\nNo methods found.`;
  }

  const lines: string[] = [];
  lines.push(`=== ${listing.className} (${listing.methods.length} methods) ===`);

  let currentVisibility = '';
  for (const method of listing.methods) {
    if (method.visibility !== currentVisibility) {
      currentVisibility = method.visibility;
      lines.push(`${currentVisibility.toUpperCase()}:`);
    }

    const flags: string[] = [];
    if (method.isInterfaceMethod) flags.push('interface');
    if (method.isRedefinition) flags.push('redefinition');
    const flagStr = flags.length > 0 ? `  [${flags.join(', ')}]` : '';
    const lineRange = method.startLine > 0 ? `  [lines ${method.startLine}-${method.endLine}]` : '';

    // Show the signature (strip trailing period for cleaner display)
    const sig = method.signature.replace(/\.\s*$/, '');
    lines.push(`  ${sig}${flagStr}${lineRange}`);
  }

  return lines.join('\n');
}

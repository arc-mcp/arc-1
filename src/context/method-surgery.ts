/**
 * Method-level surgery for ABAP classes.
 *
 * Provides three operations for token-efficient class editing:
 * 1. listMethods    — Extract method table-of-contents (names, signatures, visibility, line ranges)
 * 2. extractMethod  — Read a single method implementation (~95% token reduction vs full class)
 * 3. spliceMethod   — Surgically replace a single method body, return new full source
 *
 * All functions are pure (no I/O) — they operate on source strings and return results.
 * Uses @abaplint/core AST for accurate parsing with regex fallback for unparseable source.
 */

import { MemoryFile, Registry, Statements, Structures, Version } from '@abaplint/core';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';

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

// ─── AST Node Type ──────────────────────────────────────────────────

type AstNode = {
  findAllStatements(type: unknown): Array<{ concatTokens(): string; getFirstToken(): { getRow(): number } }>;
  findAllStatementNodes(): Array<{ concatTokens(): string; get(): { constructor: { name: string } } }>;
  findDirectStructures(type: unknown): AstNode[];
  findAllStructuresRecursive(type: unknown): AstNode[];
  findAllStructures(type: unknown): AstNode[];
  concatTokens(): string;
  getFirstStatement(): { concatTokens(): string; getFirstToken(): { getRow(): number } } | undefined;
  getLastToken(): { getRow(): number };
};

// ─── List Methods ───────────────────────────────────────────────────

/**
 * List all methods in a class with their signatures, visibility, and line ranges.
 */
export function listMethods(source: string, className: string, abaplintVersion?: Version): MethodListResult {
  const normalized = source.replace(/\r\n/g, '\n');
  try {
    const result = listMethodsAST(normalized, className, abaplintVersion ?? DEFAULT_VERSION);
    if (result.success && result.methods.length > 0) return result;
    // Fallback to regex if AST found nothing
    const regexResult = listMethodsRegex(normalized, className);
    return regexResult;
  } catch (_err: unknown) {
    // AST parsing failed — use regex fallback
    const regexResult = listMethodsRegex(normalized, className);
    return regexResult;
  }
}

function listMethodsAST(source: string, className: string, ver: Version): MethodListResult {
  const config = getDefaultAbaplintConfig(ver);
  const reg = new Registry(config);
  reg.addFile(new MemoryFile(`${className.toLowerCase().replace(/\//g, '#')}.clas.abap`, source));
  reg.parse();

  // Collect method signatures from DEFINITION with visibility
  const signatures = new Map<
    string,
    { signature: string; visibility: 'public' | 'protected' | 'private'; isRedefinition: boolean }
  >();

  // Collect method line ranges from IMPLEMENTATION, tagged with the containing
  // local-class name. Multiple local classes inside one source can declare the
  // same bare method name; the upper-case name alone is not unique, so the map
  // key combines containing-class + method name.
  const implementations = new Map<
    string,
    { startLine: number; endLine: number; containingClass: string; bareName: string }
  >();

  for (const obj of reg.getObjects()) {
    const file = (obj as { getMainABAPFile?: () => unknown }).getMainABAPFile?.() as
      | { getStructure(): AstNode | undefined }
      | undefined;
    if (!file) continue;

    const structure = file.getStructure();
    if (!structure) continue;

    // ── Definition: extract method signatures with visibility ──
    const classDefs = structure.findAllStructuresRecursive(Structures.ClassDefinition);
    for (const classDef of classDefs) {
      extractMethodSignatures(classDef, 'public', Structures.PublicSection, signatures);
      extractMethodSignatures(classDef, 'protected', Structures.ProtectedSection, signatures);
      extractMethodSignatures(classDef, 'private', Structures.PrivateSection, signatures);
    }

    // ── Implementation: extract METHOD ... ENDMETHOD line ranges ──
    const classImpls = structure.findAllStructuresRecursive(Structures.ClassImplementation);
    for (const classImpl of classImpls) {
      // Capture the containing local-class name from "CLASS <name> IMPLEMENTATION."
      const classFirstStmt = classImpl.getFirstStatement?.();
      const classTokens = classFirstStmt?.concatTokens() ?? '';
      const classMatch = classTokens.match(/^CLASS\s+(\S+)\s+IMPLEMENTATION/i);
      const containingClass = classMatch?.[1] ?? '';

      const methods = classImpl.findAllStructuresRecursive(Structures.Method) as AstNode[];
      for (const method of methods) {
        const firstStmt = method.getFirstStatement();
        if (!firstStmt) continue;
        const tokens = firstStmt.concatTokens();
        // Extract method name from "METHOD method_name."
        const match = tokens.match(/^METHOD\s+(\S+)/i);
        if (match) {
          const name = match[1]!.replace(/\.$/, '');
          const startLine = firstStmt.getFirstToken().getRow();
          const endLine = method.getLastToken().getRow();
          // Composite key: containing class + bare method name. Two local
          // classes can legally declare a method with the same bare name.
          const mapKey = `${containingClass.toUpperCase()}~${name.toUpperCase()}`;
          implementations.set(mapKey, { startLine, endLine, containingClass, bareName: name });
        }
      }
    }
  }

  // Build a set of all definition method names (upper) so we can detect impl-only methods
  const definedUpper = new Set(signatures.keys());

  // Merge: start from implementations (since those have line ranges) and enrich with definition info
  const methods: MethodInfo[] = [];
  const processed = new Set<string>();

  for (const [, impl] of implementations) {
    // Find original case from source
    const lines = source.split('\n');
    const methodLine = lines[impl.startLine - 1] ?? '';
    const nameMatch = methodLine.match(/METHOD\s+(\S+)\s*\./i);
    const originalName = nameMatch?.[1] ?? impl.bareName;
    const upperImplName = impl.bareName.toUpperCase();

    // Try to match to a definition signature
    // For interface methods like "zif_order~create", the definition has "create" (INTERFACES zif_order)
    // For regular methods, definition name matches implementation name
    let sig = signatures.get(upperImplName);
    if (!sig) {
      // For interface methods: try matching by the part after ~
      const parts = upperImplName.split('~');
      if (parts.length === 2) {
        sig = signatures.get(parts[1]!);
      }
    }

    const visibility = sig?.visibility ?? 'public';
    const signature = sig?.signature ?? `METHODS ${originalName}.`;
    const isRedefinition = sig?.isRedefinition ?? false;

    methods.push({
      name: originalName,
      visibility,
      signature,
      startLine: impl.startLine,
      endLine: impl.endLine,
      isRedefinition,
      isInterfaceMethod: originalName.includes('~'),
      containingClass: impl.containingClass,
    });

    processed.add(upperImplName);
    // Also mark the definition key as processed (may differ for interface methods)
    if (sig) {
      // Try exact match first
      if (definedUpper.has(upperImplName)) {
        processed.add(upperImplName);
      } else {
        // For interface methods: mark the short name as processed
        const parts = upperImplName.split('~');
        if (parts.length === 2 && definedUpper.has(parts[1]!)) {
          processed.add(parts[1]!);
        }
      }
    } else {
      // No definition found — still mark it processed under its own key
      // to prevent duplication
    }
  }

  // Add methods that are in definition but have no implementation (unusual but possible)
  for (const [upperName, sig] of signatures) {
    if (processed.has(upperName)) continue;
    const originalName = sig.signature.match(/(?:CLASS-)?METHODS\s+(\S+)/i)?.[1] ?? upperName;
    methods.push({
      name: originalName,
      visibility: sig.visibility,
      signature: sig.signature,
      startLine: 0,
      endLine: 0,
      isRedefinition: sig.isRedefinition,
      isInterfaceMethod: originalName.includes('~'),
    });
  }

  // Sort: public first, then protected, then private, alphabetical within each
  const order = { public: 0, protected: 1, private: 2 };
  methods.sort((a, b) => {
    const vis = order[a.visibility] - order[b.visibility];
    if (vis !== 0) return vis;
    return a.name.toUpperCase().localeCompare(b.name.toUpperCase());
  });

  return { className, methods, success: true };
}

function extractMethodSignatures(
  classDef: AstNode,
  visibility: 'public' | 'protected' | 'private',
  sectionType: unknown,
  signatures: Map<
    string,
    { signature: string; visibility: 'public' | 'protected' | 'private'; isRedefinition: boolean }
  >,
): void {
  const sections = classDef.findDirectStructures(sectionType);
  for (const section of sections) {
    const methodDefs = section.findAllStatements(Statements.MethodDef);
    for (const methodDef of methodDefs) {
      const sigText = methodDef.concatTokens();
      // Extract method name from "METHODS method_name ..." or "CLASS-METHODS ..."
      const match = sigText.match(/(?:CLASS-)?METHODS\s+(\S+)/i);
      if (match) {
        // Strip trailing period (abaplint concatTokens includes it for single-word statements like "METHODS helper.")
        const name = match[1]!.replace(/\.$/, '');
        const isRedefinition = /REDEFINITION/i.test(sigText);
        signatures.set(name.toUpperCase(), { signature: sigText, visibility, isRedefinition });
      }
    }
  }
}

// ─── Regex Fallback ─────────────────────────────────────────────────

function listMethodsRegex(source: string, className: string): MethodListResult {
  const lines = source.split('\n');
  const methods: MethodInfo[] = [];
  const signatureMap = new Map<
    string,
    { signature: string; visibility: 'public' | 'protected' | 'private'; isRedefinition: boolean }
  >();

  // Phase 1: Scan DEFINITION for method signatures and visibility
  let inDefinition = false;
  let currentVisibility: 'public' | 'protected' | 'private' = 'public';

  for (const line of lines) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();

    if (upper.match(/^CLASS\s+\S+\s+DEFINITION/)) {
      inDefinition = true;
      continue;
    }
    if (upper === 'ENDCLASS.' && inDefinition) {
      inDefinition = false;
      continue;
    }

    if (inDefinition) {
      if (upper === 'PUBLIC SECTION.') {
        currentVisibility = 'public';
        continue;
      }
      if (upper === 'PROTECTED SECTION.') {
        currentVisibility = 'protected';
        continue;
      }
      if (upper === 'PRIVATE SECTION.') {
        currentVisibility = 'private';
        continue;
      }

      const methodMatch = trimmed.match(/^(?:CLASS-)?METHODS\s+(\S+)/i);
      if (methodMatch) {
        const name = methodMatch[1]!;
        // Collect full method statement (may span multiple lines)
        let fullSig = trimmed;
        if (!trimmed.endsWith('.')) {
          // Multi-line signature — collect until we find a period
          const startIdx = lines.indexOf(line);
          for (let i = startIdx + 1; i < lines.length; i++) {
            fullSig += ` ${lines[i]!.trim()}`;
            if (lines[i]!.trim().endsWith('.')) break;
          }
        }
        signatureMap.set(name.toUpperCase(), {
          signature: fullSig,
          visibility: currentVisibility,
          isRedefinition: /REDEFINITION/i.test(fullSig),
        });
      }
    }
  }

  // Phase 2: Scan IMPLEMENTATION for METHOD ... ENDMETHOD line ranges
  let inImplementation = false;
  let currentContainingClass = '';
  let currentMethodName = '';
  let methodStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    const upper = trimmed.toUpperCase();

    const implOpen = trimmed.match(/^CLASS\s+(\S+)\s+IMPLEMENTATION\s*\.?$/i);
    if (implOpen) {
      inImplementation = true;
      currentContainingClass = implOpen[1]!;
      continue;
    }
    if (upper === 'ENDCLASS.' && inImplementation) {
      inImplementation = false;
      currentContainingClass = '';
      continue;
    }

    if (inImplementation) {
      const methodStart = trimmed.match(/^METHOD\s+(\S+)\s*\./i);
      if (methodStart) {
        currentMethodName = methodStart[1]!;
        methodStartLine = i + 1; // 1-based
      }
      if (upper === 'ENDMETHOD.' && currentMethodName) {
        const endLine = i + 1; // 1-based
        const sig = signatureMap.get(currentMethodName.toUpperCase());

        methods.push({
          name: currentMethodName,
          visibility: sig?.visibility ?? 'public',
          signature: sig?.signature ?? `METHODS ${currentMethodName}.`,
          startLine: methodStartLine,
          endLine,
          isRedefinition: sig?.isRedefinition ?? false,
          isInterfaceMethod: currentMethodName.includes('~'),
          containingClass: currentContainingClass,
        });

        currentMethodName = '';
      }
    }
  }

  // Sort: public first, then protected, then private
  const order = { public: 0, protected: 1, private: 2 };
  methods.sort((a, b) => {
    const vis = order[a.visibility] - order[b.visibility];
    if (vis !== 0) return vis;
    return a.name.toUpperCase().localeCompare(b.name.toUpperCase());
  });

  // Success if we found methods OR if the source contains a class (even with no methods)
  const hasClass = /CLASS\s+\S+\s+IMPLEMENTATION/i.test(source);
  return { className, methods, success: methods.length > 0 || hasClass || source.trim().length === 0 };
}

// ─── Extract Method ─────────────────────────────────────────────────

/**
 * Extract a single method's implementation from a class.
 *
 * Lookup order:
 * 1. **Cross-class ambiguity guard** — if the caller passed a bare name (no `~`)
 *    and multiple methods with that name exist in different containing local
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

  const upperName = methodName.toUpperCase();
  const hasTilde = methodName.includes('~');

  // ── Step 1: cross-class ambiguity guard ──
  // If caller passed bare "approve_project" and the source has BOTH
  //   CLASS lhc_project IMPLEMENTATION. METHOD approve_project. ENDMETHOD.
  //   CLASS lhc_task IMPLEMENTATION.    METHOD approve_project. ENDMETHOD.
  // …then `find()` would silently pick whichever appears first in source order.
  // Detect the multi-class match early and ask the caller to qualify.
  if (!hasTilde) {
    const exactCandidates = listing.methods.filter((m) => m.name.toUpperCase() === upperName);
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
    }
  }

  // ── Step 2: exact match ──
  let method = listing.methods.find((m) => m.name.toUpperCase() === upperName);

  // ── Step 3: qualified-class match (lhc_project~approve_project) ──
  // Only fires when caller passed a tilde AND the exact lookup above didn't
  // catch it. This branch must NOT intercept global-interface methods like
  // `zif_order~create` — those are stored with `~` in `m.name` and are
  // matched by step 2.
  if (!method && hasTilde) {
    const tildeIdx = methodName.indexOf('~');
    const lhsUpper = methodName.slice(0, tildeIdx).toUpperCase();
    const rhsUpper = methodName.slice(tildeIdx + 1).toUpperCase();
    const qualifiedMatches = listing.methods.filter(
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
    const candidates = listing.methods.filter((m) => {
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
    // Build a helpful "available methods" list. For sources with multiple
    // local classes, prefer the qualified form so the LLM can copy-paste it.
    const distinctClasses = new Set(
      listing.methods.map((m) => (m.containingClass ?? '').trim()).filter((c) => c.length > 0),
    );
    const available =
      distinctClasses.size > 1
        ? listing.methods.map((m) => (m.containingClass ? `${m.containingClass}~${m.name}` : m.name)).join(', ')
        : listing.methods.map((m) => m.name).join(', ');
    return {
      className,
      methodName,
      methodSource: '',
      bodySource: '',
      startLine: 0,
      endLine: 0,
      success: false,
      error: `Method "${methodName}" not found in ${className}. Available methods: ${available || '(none)'}`,
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

  let newMethodBlock: string;
  if (isFullBlock) {
    // Use the body as-is (preserve original indentation)
    // Normalize to \n for consistent splicing, then re-apply line endings at the end
    newMethodBlock = newBody.replace(/\r\n/g, '\n');
  } else {
    // Wrap with METHOD/ENDMETHOD using the original method name from the source
    newMethodBlock = `  METHOD ${extracted.methodName}.\n${newBody.replace(/\r\n/g, '\n')}\n  ENDMETHOD.`;
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

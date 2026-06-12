/**
 * Pure splice + diff helpers for class-section surgery (issue #303).
 *
 * All functions operate on `(source, structure)` and return new source. No HTTP,
 * no lock, no I/O. The handler in `src/handlers/write/class-surgery.ts` wires lock → splice →
 * PUT /source/main → unlock around these.
 *
 * Line-range semantics (matches `LineRange` in `src/adt/types.ts`):
 *   - `sr`/`er` are 1-indexed rows. `sc`/`ec` are 0-indexed columns.
 *   - The `er` row is INCLUSIVE (the end token lives on that line).
 *   - The `ec` column is the column AFTER the end token (half-open [sc, ec)).
 *
 * Splice strategy:
 *   - Whole-line splices for class-level and method-level blocks (we never need
 *     sub-line precision; ABAP statements occupy whole lines).
 *   - When inserting/removing one METHOD pair, we must process IMPL ranges BEFORE
 *     DEFINITION ranges (they're at larger line numbers) so DEFINITION ranges
 *     stay valid even after the IMPL splice shifts later content.
 *
 * Line-ending handling: source from SAP is CRLF. Helpers detect the prevailing
 * convention and re-emit it, so the PUT-back round-trips byte-for-byte (modulo
 * the intended change).
 */

import type { ClassStructure, MethodStructure } from './types.js';

// ─── Line-ending helpers ───────────────────────────────────────────────

/**
 * Detect the prevailing line terminator in `source`. Defaults to CRLF when the
 * source has no terminator (an unusual single-line PROG would be the only case
 * — and a fresh write should match SAP's CRLF anyway).
 */
function detectEol(source: string): '\r\n' | '\n' {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function splitLines(source: string): string[] {
  return source.split(/\r?\n/);
}

function joinLines(lines: string[], eol: '\r\n' | '\n'): string {
  return lines.join(eol);
}

// ─── Whole-line splice primitives ──────────────────────────────────────

/**
 * Replace whole lines `[sr..er]` (1-indexed, INCLUSIVE) with `replacement`.
 * The replacement is line-split and reflowed with `source`'s prevailing EOL.
 */
export function spliceLines(source: string, sr: number, er: number, replacement: string): string {
  const eol = detectEol(source);
  const lines = splitLines(source);
  if (sr < 1 || er < sr || er > lines.length) {
    throw new RangeError(`spliceLines: invalid range sr=${sr} er=${er} (have ${lines.length} lines)`);
  }
  const before = lines.slice(0, sr - 1);
  const after = lines.slice(er);
  // Empty replacement means DELETE the range — splice in zero lines, not [''].
  // (splitLines('') returns [''] which would leave a stray blank line behind.)
  const replLines = replacement === '' ? [] : splitLines(replacement.replace(/\r?\n$/, ''));
  return joinLines([...before, ...replLines, ...after], eol);
}

/**
 * Insert `text` BEFORE line `lineNo` (1-indexed). When `lineNo === lines.length + 1`,
 * appends at end. The inserted text gets `source`'s prevailing EOL.
 */
export function insertBeforeLine(source: string, lineNo: number, text: string): string {
  const eol = detectEol(source);
  const lines = splitLines(source);
  if (lineNo < 1 || lineNo > lines.length + 1) {
    throw new RangeError(`insertBeforeLine: invalid lineNo=${lineNo} (have ${lines.length} lines)`);
  }
  const before = lines.slice(0, lineNo - 1);
  const after = lines.slice(lineNo - 1);
  const insertLines = splitLines(text.replace(/\r?\n$/, ''));
  return joinLines([...before, ...insertLines, ...after], eol);
}

// ─── Splice helpers backed by ClassStructure ───────────────────────────

/**
 * Replace the class-level DEFINITION block lines with `newDefBlock`. Does NOT
 * touch the IMPLEMENTATION block — callers run diff-then-refuse before this
 * helper to ensure the result is activatable.
 */
export function spliceClassDefinition(source: string, structure: ClassStructure, newDefBlock: string): string {
  const r = structure.classDefinitionBlock;
  return spliceLines(source, r.sr, r.er, newDefBlock);
}

/**
 * Replace a single method's signature lines (the METHODS clause in DEFINITION)
 * with `newSig`. Touches DEFINITION only — IMPLEMENTATION block is untouched,
 * so any body incompatibility surfaces at SAP activation, not before. Mirrors
 * `edit_method`'s contract.
 */
export function spliceMethodSignature(source: string, method: MethodStructure, newSig: string): string {
  if (!method.definition) {
    throw new Error(`spliceMethodSignature: method ${method.name} has no definition range`);
  }
  const r = method.definition;
  return spliceLines(source, r.sr, r.er, newSig);
}

// ─── insertMethodPair: atomic DEFINITION + IMPLEMENTATION add ──────────

export interface InsertMethodPairOpts {
  /** The METHODS clause as ABAP source (multi-line OK). */
  decl: string;
  /** Visibility section to insert into. */
  visibility: 'public' | 'protected' | 'private';
  /** When true, only inserts DEFINITION — no METHOD/ENDMETHOD stub. */
  isAbstract?: boolean;
  /** Method name (UPPERCASE). Used to build the empty IMPL stub. */
  methodName: string;
  /** Optional indent override for the IMPL stub. Defaults to two spaces. */
  implIndent?: string;
}

/**
 * Insert a METHODS declaration in the target visibility section AND (unless
 * `isAbstract`) an empty `METHOD <name>. ENDMETHOD.` stub at the end of the
 * IMPLEMENTATION block. Returns the new source (both halves spliced atomically).
 *
 * Anchor strategy:
 *   1. PRIMARY — locate the LAST existing method in `visibility` per
 *      `structure.methods` and insert AFTER its `definition.er` row.
 *   2. FALLBACK — when the section has zero existing methods, regex-scan the
 *      DEFINITION block source for `^\s*(PUBLIC|PROTECTED|PRIVATE)\s+SECTION\s*\.\s*$`
 *      and insert AFTER that line.
 *   3. THROW — if neither anchor exists (section header missing), the caller
 *      MUST refuse the write and route the user to `edit_class_definition`.
 *
 * IMPL stub goes at end of `classImplementationBlock` (just before the trailing
 * ENDCLASS of the IMPLEMENTATION block). When the class has no IMPLEMENTATION
 * block at all (rare, all-abstract), only the DEFINITION is touched.
 */
export function insertMethodPair(source: string, structure: ClassStructure, opts: InsertMethodPairOpts): string {
  const anchor = findSectionAnchor(source, structure, opts.visibility);
  if (anchor === null) {
    throw new Error(
      `insertMethodPair: no ${opts.visibility.toUpperCase()} SECTION found in class ${structure.className}`,
    );
  }

  // Stage 1: insert METHODS clause in DEFINITION.
  let next = insertBeforeLine(source, anchor.afterLine + 1, opts.decl);

  // Stage 2: insert IMPL stub (unless abstract). All IMPL line numbers shift by
  // the count of inserted decl lines, so we adjust the end-of-impl-block anchor.
  // insertedCount must match what insertBeforeLine ACTUALLY inserted — it strips
  // a single trailing newline before splitting (line 76), so we strip here too.
  // Without this, a caller-supplied `decl` with a trailing "\n" over-counts by one
  // and the stub lands AFTER the IMPLEMENTATION's ENDCLASS (invalid ABAP).
  if (!opts.isAbstract && structure.classImplementationBlock) {
    const insertedCount = splitLines(opts.decl.replace(/\r?\n$/, '')).length;
    const newImplEndLine = structure.classImplementationBlock.er + insertedCount;
    const indent = opts.implIndent ?? '  ';
    const stub = `${indent}METHOD ${opts.methodName.toLowerCase()}.\n${indent}ENDMETHOD.`;
    next = insertBeforeLine(next, newImplEndLine, stub);
  }

  return next;
}

// ─── removeMethodPair: atomic DEFINITION + IMPLEMENTATION delete ──────

/**
 * Remove a method from both DEFINITION and IMPLEMENTATION blocks. Removes in
 * descending line-order (IMPL first, then DEF) so the earlier range stays valid
 * after the later range is removed. ABSTRACT methods (no `implementation`
 * range) only have their DEFINITION line range removed.
 */
export function removeMethodPair(source: string, method: MethodStructure): string {
  let next = source;
  if (method.implementation) {
    next = spliceLines(next, method.implementation.sr, method.implementation.er, '');
  }
  next = spliceLines(next, method.definition.sr, method.definition.er, '');
  return next;
}

// ─── moveMethodDefinition: DEFINITION-only section move ────────────────

/**
 * Move a method's METHODS clause from its current visibility section to a new
 * location in the DEFINITION block, leaving the IMPLEMENTATION block UNTOUCHED.
 *
 * This is the body-preserving primitive behind `change_method_visibility`
 * (issue #303 follow-up). Contrast with `delete_method` + `add_method`, which
 * discards the method body and recreates an empty stub.
 *
 * Single-pass line walk over the ORIGINAL source: the method's `definition`
 * lines are captured, every other line is re-emitted in order, and the captured
 * clause is re-inserted immediately AFTER `targetAfterLine`. Because both the
 * skip-range and the anchor are expressed in original 1-indexed line numbers,
 * the walk is correct whether the target section sits above or below the
 * method's current position — no index-shift arithmetic between a remove and an
 * insert.
 *
 * `targetAfterLine` (1-indexed) is the line to insert AFTER — typically from
 * `findSectionAnchor(source, structure, targetVisibility)`. It MUST lie outside
 * the moved method's `definition` range; the caller guarantees this by only
 * moving between DIFFERENT sections (a method's clause and the target-section
 * anchor never overlap). A `targetAfterLine` inside the range is a caller bug
 * and throws.
 *
 * IMPLEMENTATION is never read or written here — the METHOD…ENDMETHOD body is
 * preserved verbatim. The clause keeps its original indentation.
 */
export function moveMethodDefinition(source: string, method: MethodStructure, targetAfterLine: number): string {
  if (!method.definition) {
    throw new Error(`moveMethodDefinition: method ${method.name} has no definition range`);
  }
  const { sr, er } = method.definition;
  if (targetAfterLine >= sr && targetAfterLine <= er) {
    throw new RangeError(
      `moveMethodDefinition: targetAfterLine ${targetAfterLine} is inside the moved method's definition range [${sr}, ${er}]`,
    );
  }
  const eol = detectEol(source);
  const lines = splitLines(source);
  const clause = lines.slice(sr - 1, er);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    if (lineNo >= sr && lineNo <= er) continue; // drop the moved clause from its old spot
    out.push(lines[i]!);
    if (lineNo === targetAfterLine) out.push(...clause); // re-insert after the anchor
  }
  return joinLines(out, eol);
}

// ─── findSectionAnchor ────────────────────────────────────────────────

/**
 * Locate the insertion point for a new METHODS clause in the target visibility
 * section. See `insertMethodPair` jsdoc for the two-step strategy.
 *
 * Returns `{ afterLine }` (1-indexed; the new clause goes on the line AFTER
 * this row). Returns `null` if the section header doesn't exist in DEFINITION.
 */
export function findSectionAnchor(
  source: string,
  structure: ClassStructure,
  visibility: 'public' | 'protected' | 'private',
): { afterLine: number } | null {
  // Step 1: anchor after the LAST existing method in the target section.
  const methods = structure.methods.filter((m) => m.visibility === visibility && m.definition);
  if (methods.length > 0) {
    const lastEr = Math.max(...methods.map((m) => m.definition.er));
    return { afterLine: lastEr };
  }

  // Step 2: anchor immediately after the SECTION header line within the
  // class-level DEFINITION block. Strip a trailing ABAP line comment (`"…`)
  // before matching, so a header like `  PUBLIC SECTION. " public API` (very
  // common in class templates) is still recognized. The `\.` requires the
  // period after SECTION but no `$` anchor, tolerating trailing tokens.
  const defBlock = structure.classDefinitionBlock;
  const lines = splitLines(source);
  const sectionRe = new RegExp(`^\\s*${visibility.toUpperCase()}\\s+SECTION\\s*\\.`, 'i');
  for (let i = defBlock.sr - 1; i < Math.min(defBlock.er, lines.length); i++) {
    const stripped = lines[i]!.replace(/"[^\n]*$/, '');
    if (sectionRe.test(stripped)) return { afterLine: i + 1 };
  }
  return null;
}

// ─── diffMethodSets: refuse-policy input for edit_class_definition ─────

/** A method declaration discovered in a NEW DEFINITION block (for diff'ing). */
export interface DeclaredMethod {
  /** UPPERCASE method name. */
  name: string;
  /** ABSTRACT methods don't need an IMPL stub. */
  isAbstract: boolean;
  /** Source: was it declared as EVENTS / INTERFACES / ALIASES? Exempt from symmetry. */
  isEvent: boolean;
  isInterface: boolean;
  isAlias: boolean;
}

export interface MethodDiff {
  /** Methods declared in NEW that don't exist in OLD. */
  added: DeclaredMethod[];
  /** Methods that exist in OLD but not in NEW. */
  removed: MethodStructure[];
}

/**
 * Diff the method set declared in a NEW DEFINITION block against the current
 * `structure.methods`. Uses abaplint's `Structures.ClassDefinition` AST to
 * enumerate METHODS/CLASS-METHODS/EVENTS/INTERFACES/ALIASES declarations.
 *
 * Returns added/removed by name (UPPERCASE). The handler's refuse-policy then
 * exempts ABSTRACT METHODS, EVENTS, INTERFACES, ALIASES from the symmetry
 * check — only concrete methods that need a METHOD…ENDMETHOD block in IMPL.
 */
export function diffMethodSets(structure: ClassStructure, newDefBlock: string): MethodDiff {
  const oldNames = new Set(structure.methods.map((m) => m.name));
  const declared = parseDefinitionBlockDeclarations(newDefBlock);
  const declaredNames = new Set(declared.map((d) => d.name));

  const added = declared.filter((d) => !oldNames.has(d.name));
  const removed = structure.methods.filter((m) => !declaredNames.has(m.name));
  return { added, removed };
}

// ─── DEFINITION-block declaration parser (abaplint primary, regex fallback) ─

/**
 * Enumerate METHODS / CLASS-METHODS / EVENTS / INTERFACES / ALIASES
 * declarations in a NEW DEFINITION block string. Returns UPPERCASE names with
 * the abstract/event/interface/alias flags.
 *
 * Implementation: regex-scan with leading-comment stripping. We deliberately
 * avoid abaplint here — the fragment is a partial CLASS DEFINITION block and
 * abaplint requires a synthetic IMPLEMENTATION shell wrapper to parse it,
 * which obscures errors and adds complexity for no benefit. The regex handles
 * single-line and multi-line METHODS clauses (REDEFINITION, ABSTRACT keyword
 * detection, multi-line IMPORTING/EXPORTING tails) reliably for issue #303's
 * symmetry-check use case. Edge cases (e.g. METHODS keyword inside a string
 * literal) cannot occur in a valid DEFINITION block — there are no executable
 * statements there.
 */
export function parseDefinitionBlockDeclarations(defBlock: string): DeclaredMethod[] {
  return parseWithRegex(defBlock);
}

function parseWithRegex(defBlock: string): DeclaredMethod[] {
  const out: DeclaredMethod[] = [];
  // Strip block + line comments before scanning so commented-out METHODS don't count.
  const stripped = defBlock.replace(/^\s*\*.*$/gm, '').replace(/"[^\n]*$/gm, '');
  // METHODS / CLASS-METHODS <name> — multi-line clauses span until the period.
  // We only need the NAME, so the regex looks at the start of each clause.
  const methodRe = /^\s*(CLASS-METHODS|METHODS)\s+([A-Z_][A-Z0-9_]*)([^.]*)\./gim;
  for (const m of stripped.matchAll(methodRe)) {
    const name = m[2]!.toUpperCase();
    const tail = m[3] ?? '';
    const isAbstract = /\bABSTRACT\b/i.test(tail);
    out.push({ name, isAbstract, isEvent: false, isInterface: false, isAlias: false });
  }
  const eventRe = /^\s*(CLASS-EVENTS|EVENTS)\s+([A-Z_][A-Z0-9_]*)/gim;
  for (const m of stripped.matchAll(eventRe)) {
    out.push({ name: m[2]!.toUpperCase(), isAbstract: false, isEvent: true, isInterface: false, isAlias: false });
  }
  const ifaceRe = /^\s*INTERFACES\s+([A-Z_][A-Z0-9_]*)/gim;
  for (const m of stripped.matchAll(ifaceRe)) {
    out.push({ name: m[1]!.toUpperCase(), isAbstract: false, isEvent: false, isInterface: true, isAlias: false });
  }
  const aliasRe = /^\s*ALIASES\s+([A-Z_][A-Z0-9_]*)/gim;
  for (const m of stripped.matchAll(aliasRe)) {
    out.push({ name: m[1]!.toUpperCase(), isAbstract: false, isEvent: false, isInterface: false, isAlias: true });
  }
  return out;
}

// ─── extractMethodNameFromClause ───────────────────────────────────────

/**
 * Pull the method name out of a `METHODS x ...` or `CLASS-METHODS x ...` clause.
 * Returns UPPERCASE name, or `null` if the clause doesn't start with a recognised
 * keyword. Used by `add_method` to derive the IMPL stub name when the caller
 * doesn't pass `methodName` explicitly.
 *
 * Comments and leading whitespace are skipped. Multi-line clauses are handled
 * (the name is on the first non-comment line).
 */
export function extractMethodNameFromClause(clause: string): string | null {
  // Strip leading line comments (`*…` whole-line + `"…` trailing).
  const lines = clause.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/"[^\n]*$/, '').trim();
    if (!line || line.startsWith('*')) continue;
    const m = line.match(/^(?:CLASS-METHODS|METHODS)\s+([A-Z_][A-Z0-9_~]*)/i);
    if (m) return m[1]!.toUpperCase();
    // First non-comment line that isn't a METHODS keyword — bail.
    return null;
  }
  return null;
}

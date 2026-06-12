/**
 * Pure regex search over source text for token-efficient SAPRead reads.
 *
 * `grepSource` returns only the lines matching a pattern plus a few lines of
 * surrounding context (with 1-based line numbers), instead of the full object
 * source — the search half of an agent's "search → locate → read" loop, run
 * server-side over ADT. For classes it can annotate each match with the owning
 * local class / method via a `MethodRange[]` (mapped from `MethodInfo` by the
 * caller), so a hit can be followed up with a targeted `method=` read.
 *
 * All functions are pure (no I/O) — they operate on source strings and return a
 * formatted string. Mirrors `src/context/method-surgery.ts`.
 */

/** 1-based, inclusive line range owning a method — a minimal slice of `MethodInfo`. */
export interface MethodRange {
  name: string;
  /** Local `CLASS x IMPLEMENTATION` name containing the method (e.g. "ltcl_test"). */
  containingClass?: string;
  /** 1-based line of the METHOD statement (0 when no implementation range is known). */
  startLine: number;
  /** 1-based line of the ENDMETHOD statement (inclusive). */
  endLine: number;
}

export interface GrepOptions {
  /** Method ranges for class/method annotation of matches. */
  methods?: MethodRange[];
  /** Lines of context shown on each side of a match (default 3). */
  contextLines?: number;
  /** Cap on the number of matches rendered (default 100). */
  maxMatches?: number;
}

export interface GrepResult {
  /** Total matching lines found (before any `maxMatches` truncation). */
  matchCount: number;
  /** Formatted, LLM-friendly match report (or a no-match / invalid-pattern message). */
  output: string;
  /** True when the pattern cannot be used safely or has no valid regex/literal interpretation. */
  invalidPattern: boolean;
}

const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_MAX_MATCHES = 100;
export const MAX_GREP_PATTERN_LENGTH = 512;
export const MAX_GREP_LINE_LENGTH = 1000;
const REGEX_META = /[.*+?^${}()|[\]\\]/;
const NESTED_QUANTIFIER_GROUP =
  /\((?:\?:)?(?:[^()[\]\\]|\\.|\[[^\]]*])*[*+{](?:[^()[\]\\]|\\.|\[[^\]]*])*\)\s*(?:[+*?]|\{\d)/;
const BACKREFERENCE = /\\[1-9]/;
const LOOKAROUND = /\(\?(?:[=!]|<[=!])/;

interface RegexGroupFrame {
  hasAlternation: boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compile a `gim` regex, or return null when the pattern is not valid regex. */
function tryCompile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'gim');
  } catch {
    return null;
  }
}

function isRegexQuantifierAt(pattern: string, index: number): boolean {
  const char = pattern[index];
  if (char === '{') return /^\{\d+(?:,\d*)?\}/.test(pattern.slice(index));
  return char === '+' || char === '*' || char === '?';
}

function hasQuantifiedAlternationGroup(pattern: string): boolean {
  const stack: RegexGroupFrame[] = [];
  let inCharClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;

    if (char === '\\') {
      i++;
      continue;
    }

    if (inCharClass) {
      if (char === ']') inCharClass = false;
      continue;
    }

    if (char === '[') {
      inCharClass = true;
      continue;
    }

    if (char === '(') {
      stack.push({ hasAlternation: false });
      continue;
    }

    if (char === '|') {
      const top = stack[stack.length - 1];
      if (top) top.hasAlternation = true;
      continue;
    }

    if (char === ')') {
      const frame = stack.pop();
      if (!frame) continue;

      if (frame.hasAlternation && isRegexQuantifierAt(pattern, i + 1)) {
        return true;
      }

      const parent = stack[stack.length - 1];
      if (parent && frame.hasAlternation) parent.hasAlternation = true;
    }
  }

  return false;
}

function unsafePatternReason(pattern: string): string | null {
  if (pattern.length > MAX_GREP_PATTERN_LENGTH) {
    return `pattern is too long (${pattern.length} characters; maximum ${MAX_GREP_PATTERN_LENGTH})`;
  }
  if (LOOKAROUND.test(pattern)) {
    return 'lookaround assertions are disabled for server-side grep';
  }
  if (BACKREFERENCE.test(pattern)) {
    return 'backreferences are disabled for server-side grep';
  }
  if (NESTED_QUANTIFIER_GROUP.test(pattern)) {
    return 'nested quantified groups are disabled for server-side grep';
  }
  if (hasQuantifiedAlternationGroup(pattern)) {
    return 'quantified alternation groups are disabled for server-side grep';
  }
  return null;
}

function trimSearchLine(line: string): string {
  return line.length <= MAX_GREP_LINE_LENGTH ? line : line.slice(0, MAX_GREP_LINE_LENGTH);
}

/** 0-based indexes of lines matching `regex` (resets lastIndex so the global flag never skips a line). */
function matchingIndexes(lines: string[], regex: RegExp): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    regex.lastIndex = 0;
    if (regex.test(trimSearchLine(lines[i]!))) out.push(i);
  }
  return out;
}

/**
 * Resolve `pattern` against `lines`, falling back to a literal search so LLM
 * callers that forget to escape metacharacters (`a.b`, `read_entities(`) still
 * get results. Returns the matched 0-based line indexes, the pattern actually
 * used (for display), and whether the pattern was unusable.
 */
function resolveMatches(
  lines: string[],
  pattern: string,
): { indexes: number[]; effectivePattern: string; invalidPattern: boolean } {
  const regex = tryCompile(pattern);

  if (regex) {
    const indexes = matchingIndexes(lines, regex);
    if (indexes.length > 0) return { indexes, effectivePattern: pattern, invalidPattern: false };
    // Valid regex, zero matches: an unescaped metacharacter may have been meant literally.
    if (REGEX_META.test(pattern)) {
      const literal = escapeRegex(pattern);
      const literalIndexes = matchingIndexes(lines, new RegExp(literal, 'gim'));
      if (literalIndexes.length > 0)
        return { indexes: literalIndexes, effectivePattern: literal, invalidPattern: false };
    }
    return { indexes: [], effectivePattern: pattern, invalidPattern: false };
  }

  // Not valid regex (e.g. an unbalanced paren from a method-call search): try it literally.
  const literal = escapeRegex(pattern);
  const literalRegex = tryCompile(literal);
  const literalIndexes = literalRegex ? matchingIndexes(lines, literalRegex) : [];
  if (literalIndexes.length > 0) return { indexes: literalIndexes, effectivePattern: literal, invalidPattern: false };
  return { indexes: [], effectivePattern: pattern, invalidPattern: true };
}

/** Find the method owning a 1-based line, if any (first range that contains it). */
function methodForLine(line1: number, methods: MethodRange[] | undefined): MethodRange | undefined {
  if (!methods) return undefined;
  for (const m of methods) {
    if (m.startLine > 0 && line1 >= m.startLine && line1 <= m.endLine) return m;
  }
  return undefined;
}

function methodLabel(m: MethodRange): string {
  return m.containingClass ? `${m.containingClass}=>${m.name}` : m.name;
}

/**
 * Search `source` for `pattern` and return matching lines + context.
 *
 * @param source  Object source text (CRLF tolerated).
 * @param pattern Regex (case-insensitive); falls back to literal search on failure.
 * @param opts    Optional method ranges (annotation), context window, match cap.
 */
export function grepSource(source: string, pattern: string, opts: GrepOptions = {}): GrepResult {
  const contextLines = opts.contextLines ?? DEFAULT_CONTEXT_LINES;
  const maxMatches = opts.maxMatches ?? DEFAULT_MAX_MATCHES;
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const unsafeReason = unsafePatternReason(pattern);

  if (unsafeReason) {
    return {
      matchCount: 0,
      invalidPattern: true,
      output: `Unsupported grep pattern: ${unsafeReason}. Use a shorter literal token or a simpler regex.`,
    };
  }

  const { indexes, effectivePattern, invalidPattern } = resolveMatches(lines, pattern);

  if (invalidPattern) {
    return {
      matchCount: 0,
      invalidPattern: true,
      output: `Invalid regex pattern: "${pattern}" (and no literal match). Escape regex metacharacters or send a simpler pattern.`,
    };
  }

  if (indexes.length === 0) {
    return { matchCount: 0, invalidPattern: false, output: `No matches found for /${effectivePattern}/i.` };
  }

  const matchCount = indexes.length;
  const truncated = matchCount > maxMatches;
  const shown = truncated ? indexes.slice(0, maxMatches) : indexes;
  const matchSet = new Set(shown);

  // Union of match lines + their context windows.
  const visible = new Set<number>();
  for (const idx of shown) {
    for (let c = Math.max(0, idx - contextLines); c <= Math.min(lines.length - 1, idx + contextLines); c++) {
      visible.add(c);
    }
  }
  const sorted = [...visible].sort((a, b) => a - b);

  const out: string[] = [`${matchCount} match(es) for /${effectivePattern}/i:`];
  let prevLine = -2;
  let prevLabel = '';
  for (const idx of sorted) {
    const owner = methodForLine(idx + 1, opts.methods);
    const label = owner ? methodLabel(owner) : '';
    if (label !== prevLabel) {
      // Owning method changed. Entering a method → emit its header; leaving one into
      // between-method lines → emit a bare separator so trailing context is not visually
      // attributed to the method we just left. Either way, update prevLabel.
      if (label) {
        out.push(prevLine === -2 ? `[${label}]` : `--\n[${label}]`);
      } else if (prevLine !== -2) {
        out.push('--');
      }
      prevLabel = label;
    } else if (idx > prevLine + 1 && out.length > 1) {
      // Non-contiguous block within the same (or no) method — visual separator.
      out.push('--');
    }
    const marker = matchSet.has(idx) ? '>' : ' ';
    out.push(`${marker}${String(idx + 1).padStart(5)}: ${lines[idx]}`);
    prevLine = idx;
  }

  if (truncated) {
    out.push(`\n... showing first ${maxMatches} of ${matchCount} matches. Narrow your pattern.`);
  }

  return { matchCount, invalidPattern: false, output: out.join('\n') };
}

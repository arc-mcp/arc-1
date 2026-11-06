/**
 * Bounded include expansion for `SAPRead expand_includes` on programs and includes (PROG, INCL).
 * Function groups keep their own walk in `AdtClient.getFunctionGroupExpanded`.
 *
 * INCLUDE statements are recognized by abaplint (`Statements.Include`): chains, `IF FOUND`,
 * comments and literals are handled by the parser, and `INCLUDE TYPE`/`INCLUDE STRUCTURE` are
 * type includes. abaplint's structure pass grows faster than linearly with one file (measured on
 * 2.120.71: 10k lines of code ≈ 0.8 s, 100k ≈ 108 s; 40k INCLUDE statements ≈ 3.4 s), so only the
 * statements that mention INCLUDE are handed to it, at their original line numbers and in blocks of
 * at most `PARSE_BLOCK_STATEMENTS`; every other line is blanked. That pre-filter never decides what
 * an include is — it only removes statements that do not contain the keyword.
 *
 * Customer includes are always expanded; SAP includes only under an SAP program, includes of a
 * namespace only under a program of that namespace, and `<...>` system includes never. Customer
 * includes are read first, also those found inside an SAP include; within each group the walk is
 * breadth-first, so a limit cuts deep includes before shallow ones. Every block names the source and
 * line that include it. All reads share one deadline and the request's cancel signal. Every include
 * that is not shown in full is reported, customer code first.
 */

import { Expressions, MemoryFile, Registry, Statements } from '@abaplint/core';
import { getDefaultAbaplintConfig } from '../lint/abaplint-config-cache.js';
import { getCurrentContext } from '../server/context.js';
import type { AdtClient, SourceReadOptions } from './client.js';
import { AdtApiError, AdtNetworkError, AdtSafetyError, isNotFoundError } from './errors.js';
import { ABAPLINT_MAX_RELEASE, mapSapReleaseToAbaplintVersion } from './features.js';
import type { AdtRequestOptions } from './http-deadline.js';

/** One INCLUDE statement of a source. */
export interface IncludeStatement {
  /** Include name as written. */
  name: string;
  /** 1-based line of the include name. */
  line: number;
  /** `INCLUDE … IF FOUND`: the include may legitimately not exist. */
  ifFound: boolean;
}

export interface IncludeExpansionLimits {
  /** Sources read, the root included; an `IF FOUND` include that does not exist counts as one. */
  maxBlocks: number;
  /** Include levels below the root. */
  maxDepth: number;
  /** Characters of source over all blocks. */
  maxChars: number;
  /** Milliseconds for reading the program and its includes. */
  maxMs: number;
}

/**
 * Time for reading the program and its includes. 80 sources took about 4 s on SAP_BASIS 7.50 and 7.58,
 * so 20 s leaves room for slower systems and still ends far below the 120 s timeout of one request. It is
 * set on its own; `REVIEW_DEADLINE_MS` bounds one transport-review page with the same value.
 */
export const EXPANSION_DEADLINE_MS = 20_000;

/**
 * Text output must fit what MCP clients show inline: a client with a 25,000-token result limit refused
 * an 81,000-character SAPMV45A expansion and saved a 62 KB one to a file, because comment-heavy SAP code
 * tokenizes far below 4 characters per token. 40,000 characters stayed inline in the live tests.
 */
export const EXPANSION_TEXT_LIMITS: IncludeExpansionLimits = {
  maxBlocks: 80,
  maxDepth: 5,
  maxChars: 40_000,
  maxMs: EXPANSION_DEADLINE_MS,
};
/** grep reads more than it returns; the character limit only bounds memory and SAP work. */
export const EXPANSION_SEARCH_LIMITS: IncludeExpansionLimits = { ...EXPANSION_TEXT_LIMITS, maxChars: 4_000_000 };

export interface IncludeExpansionOptions {
  limits?: Partial<IncludeExpansionLimits>;
  /** Cut the block that crosses `maxChars` at a line boundary instead of keeping it whole. */
  shorten?: boolean;
  /** Epoch milliseconds after which no further include is read; defaults to now + `maxMs`. */
  deadline?: number;
  /** Cancels the walk together with the MCP request. */
  signal?: AbortSignal;
}

export interface ExpansionBlock {
  name: string;
  source: string;
  /** Source and line of the INCLUDE statement that names it; absent for the root. */
  includedAt?: { parent: string; line: number };
  /** The read failed; `source` is a placeholder. */
  unreadable?: true;
  /** Read from the user's unactivated draft. */
  draft?: true;
}

export type IncludeSkipReason = 'system' | 'sap' | 'namespace' | 'name' | 'depth' | 'blocks' | 'size' | 'time';

const LIMIT_REASONS: ReadonlySet<IncludeSkipReason | undefined> = new Set(['depth', 'blocks', 'size', 'time']);

/** An include that is referenced but not shown in full. */
export interface IncludeIssue {
  kind: 'skipped' | 'absent' | 'unreadable' | 'cycle' | 'shortened';
  include: string;
  /** Block whose INCLUDE statement names the include. */
  parent: string;
  line: number;
  reason?: IncludeSkipReason;
  /** For `unreadable`: HTTP status or error class, never SAP's message text. */
  detail?: string;
  /** For `shortened`: lines kept and total lines. */
  shownLines?: number;
  totalLines?: number;
}

export interface IncludeExpansionResult {
  blocks: ExpansionBlock[];
  issues: IncludeIssue[];
  /** A limit left includes unread or shortened a block. */
  truncated: boolean;
  limits: IncludeExpansionLimits;
}

export interface IncludeExpansionRoot {
  /** Block heading, e.g. `PROG ZREPORT`. */
  label: string;
  /** Program holding the root source; names it in issue locations and cycles. */
  ref: string;
  /** Object name deciding which includes share its owner. */
  owner: string;
  source: string;
}

export type IncludeReader = (name: string, optional: boolean, request: AdtRequestOptions) => Promise<string>;

type StatementNode = {
  get(): unknown;
  getTokens(): Array<{ getStr(): string }>;
  findFirstExpression(type: unknown): { concatTokens(): string; getFirstToken(): { getRow(): number } } | undefined;
};

const KEYWORD = 'INCLUDE';
const MAX_NAME_LENGTH = 40;
const MAX_LISTED = 20;
// SAP names module includes after their field, e.g. MV45AO0R_RV45A-KEDATU_AUSGABE.
const FETCHABLE_NAME = /^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_%#]+(?:-[A-Z0-9_]+)*$/i;
const DEFAULT_VERSION = mapSapReleaseToAbaplintVersion(String(ABAPLINT_MAX_RELEASE));

function isWordChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

/** INCLUDE statements per abaplint parse; its structure pass grows faster than linearly with them. */
const PARSE_BLOCK_STATEMENTS = 2_000;

/**
 * Row ranges, in order and without overlap, of the statements that contain the INCLUDE keyword
 * outside comments and literals. Statement boundaries are the ABAP periods outside literals; a range
 * ends at a line whose last statement is complete, so no fragment can merge into a following INCLUDE
 * statement and the ranges can be parsed in separate blocks.
 */
function includeStatementRanges(lines: string[]): Array<[number, number]> {
  const pendingAtEnd = new Array<boolean>(lines.length).fill(false);
  const ranges: Array<[number, number]> = [];
  let pending = false;
  let mentions = false;
  let start = 0;
  let templateText = false;
  let templateDepth = 0;
  const open = (row: number) => {
    if (!pending) start = row;
    pending = true;
  };
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]!;
    // A later INCLUDE on this line must keep the prefix of a multiline statement too.
    const rowStart = pending ? start : row;
    if (!templateText && line.startsWith('*')) {
      pendingAtEnd[row] = pending;
      continue;
    }
    let i = 0;
    while (i < line.length) {
      const char = line[i]!;
      // Keep template state across rows; { resumes code and } resumes text, including nested templates.
      if (templateText) {
        if (char === '\\') i += 2;
        else {
          if (char === '|') templateDepth--;
          if (char === '|' || char === '{') templateText = false;
          i++;
        }
        continue;
      }
      if (char === '"') break;
      if (char === '|' || (char === '}' && templateDepth > 0)) {
        open(rowStart);
        if (char === '|') templateDepth++;
        templateText = true;
        i++;
      } else if (char === "'" || char === '`') {
        open(rowStart);
        let j = i + 1;
        while (j < line.length && line[j] !== char) j++;
        i = j + 1;
      } else if (char === '.') {
        if (pending && mentions) ranges.push([start, row]);
        pending = false;
        mentions = false;
        i++;
      } else if (isWordChar(line.charCodeAt(i))) {
        open(rowStart);
        let j = i + 1;
        while (j < line.length && isWordChar(line.charCodeAt(j))) j++;
        if (j - i === KEYWORD.length && line.slice(i, j).toUpperCase() === KEYWORD) mentions = true;
        i = j;
      } else {
        if (char !== ' ' && char !== '\t' && char !== '\r') open(rowStart);
        i++;
      }
    }
    pendingAtEnd[row] = pending;
  }
  if (pending && mentions) ranges.push([start, lines.length - 1]);
  const merged: Array<[number, number]> = [];
  for (const [from, to] of ranges) {
    let end = to;
    while (pendingAtEnd[end] && end + 1 < lines.length) end++;
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([from, end]);
  }
  return merged;
}

/** INCLUDE statements of an ABAP source in source order (type includes excluded). */
export function findIncludeStatements(source: string): IncludeStatement[] {
  if (!/include/i.test(source)) return [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const ranges = includeStatementRanges(lines);
  const statements: IncludeStatement[] = [];
  for (let first = 0; first < ranges.length; first += PARSE_BLOCK_STATEMENTS) {
    const block = ranges.slice(first, first + PARSE_BLOCK_STATEMENTS);
    const offset = block[0]![0];
    const rows = new Array<string>(block.at(-1)![1] - offset + 1).fill('');
    for (const [from, to] of block) for (let row = from; row <= to; row++) rows[row - offset] = lines[row]!;
    statements.push(...parseIncludeStatements(rows.join('\n'), offset));
  }
  return statements;
}

/** abaplint's INCLUDE statements in `text`, with their lines moved down by `offset` rows. */
function parseIncludeStatements(text: string, offset: number): IncludeStatement[] {
  const registry = new Registry(getDefaultAbaplintConfig(DEFAULT_VERSION));
  registry.addFile(new MemoryFile('zarc1_include_scan.prog.abap', text));
  registry.parse();
  const statements: IncludeStatement[] = [];
  for (const object of registry.getObjects()) {
    const file = (object as { getMainABAPFile?: () => unknown }).getMainABAPFile?.() as
      | { getStatements(): StatementNode[] }
      | undefined;
    for (const statement of file?.getStatements() ?? []) {
      if (!(statement.get() instanceof Statements.Include)) continue;
      const name = statement.findFirstExpression(Expressions.IncludeName);
      if (!name) continue;
      const words = statement.getTokens().map((token) => token.getStr().toUpperCase());
      statements.push({
        name: name.concatTokens(),
        line: name.getFirstToken().getRow() + offset,
        ifFound: words.some((word, index) => word === 'IF' && words[index + 1] === 'FOUND'),
      });
    }
  }
  return statements;
}

/** `system` (`<...>`), `customer`, a `/NAMESPACE/`, or `sap`. */
export function includeOwner(name: string): string {
  const upper = name.toUpperCase();
  if (upper.startsWith('<')) return 'system';
  const namespace = /^\/[^/]+\//.exec(upper);
  if (namespace) return namespace[0];
  // Customer name ranges: Z*/Y*, module pools SAPMZ*/MZ*, function groups SAPLZ*/LZ*.
  return /^(?:SAP[LM]|[LM])?[YZ]/.test(upper) ? 'customer' : 'sap';
}

function skipReason(include: string, rootOwner: string): IncludeSkipReason | undefined {
  const owner = includeOwner(include);
  if (owner === 'system') return 'system';
  if (owner !== 'customer' && owner !== rootOwner) return owner === 'sap' ? 'sap' : 'namespace';
  if (include.length > MAX_NAME_LENGTH || !FETCHABLE_NAME.test(include)) return 'name';
  return undefined;
}

/** The expansion of `root` reads `include`, limits aside (owner and name rules). */
export function expandsInclude(include: string, root: string): boolean {
  return skipReason(include, includeOwner(root)) === undefined;
}

/** Lines of `source` that fit `maxChars`, or undefined when only blank lines would be left out. */
function shortenSource(
  source: string,
  maxChars: number,
): { text: string; shownLines: number; totalLines: number } | undefined {
  const lines = source.split('\n');
  let used = 0;
  let shownLines = 0;
  while (shownLines < lines.length && used + lines[shownLines]!.length + 1 <= maxChars) {
    used += lines[shownLines]!.length + 1;
    shownLines++;
  }
  if (lines.slice(shownLines).every((line) => line.trim() === '')) return undefined;
  return { text: lines.slice(0, shownLines).join('\n'), shownLines, totalLines: lines.length };
}

/** The read was cut off by its deadline (an `AbortSignal.timeout`), detected as in the transport review. */
function isDeadlineError(err: unknown): boolean {
  return err instanceof AdtNetworkError && err.cause?.name === 'TimeoutError';
}

/** An include found but not yet read. */
interface PendingInclude {
  statement: IncludeStatement;
  /** Where its INCLUDE statement is. */
  at: { parent: string; line: number };
  depth: number;
  ancestors: Set<string>;
  customer: boolean;
  /** Order in which it was found; keeps the walk deterministic. */
  order: number;
}

/** Customer includes first, then the others; each group breadth-first in the order found. */
function byPriority(a: PendingInclude, b: PendingInclude): number {
  return Number(b.customer) - Number(a.customer) || a.depth - b.depth || a.order - b.order;
}

/**
 * Walk the include graph of `root`, customer includes first: one found inside an SAP include goes
 * ahead of the SAP includes still waiting. A read that fails because the deadline passed ends the
 * walk with the rest listed under the time limit; other failures except safety refusals and
 * cancellation become placeholder blocks, and a 404 for `INCLUDE … IF FOUND` is reported as absent.
 */
export async function expandIncludes(
  root: IncludeExpansionRoot,
  read: IncludeReader,
  options: IncludeExpansionOptions = {},
): Promise<IncludeExpansionResult> {
  const limits = { ...EXPANSION_SEARCH_LIMITS, ...options.limits };
  const deadline = options.deadline ?? Date.now() + limits.maxMs;
  const request: AdtRequestOptions = { deadline, ...(options.signal ? { signal: options.signal } : {}) };
  const timeUp = () => Date.now() >= deadline;
  const rootOwner = includeOwner(root.owner);
  const blocks: ExpansionBlock[] = [];
  const issues: IncludeIssue[] = [];
  const rootKey = root.ref.toUpperCase();
  const seen = new Set<string>([rootKey]);
  const cycles = new Set<string>();
  const pending: PendingInclude[] = [];
  let found = 0;
  /** `IF FOUND` includes that do not exist: no block, but a read like any other. */
  let absent = 0;
  let chars = 0;
  let stop: IncludeSkipReason | undefined;

  /** Add a block; false when not even the first line of an include fits, which is then listed instead. */
  const add = (name: string, source: string, at?: { parent: string; line: number }): boolean => {
    const cut =
      options.shorten && chars + source.length > limits.maxChars
        ? shortenSource(source, limits.maxChars - chars)
        : undefined;
    if (cut?.shownLines === 0 && at) {
      issues.push({ kind: 'skipped', reason: 'size', include: name, ...at });
      stop = 'size';
      return false;
    }
    const includedAt = at ? { includedAt: at } : {};
    if (!cut) {
      blocks.push({ name, source, ...includedAt });
    } else {
      const rest = `lines ${cut.shownLines + 1}-${cut.totalLines} not shown (character limit)`;
      blocks.push({ name, source: `${cut.text}${cut.text ? '\n' : ''}[... ${rest}]`, ...includedAt });
      issues.push({
        kind: 'shortened',
        include: name,
        parent: at?.parent ?? '',
        line: at?.line ?? 0,
        shownLines: cut.shownLines,
        totalLines: cut.totalLines,
      });
    }
    chars += source.length;
    if (chars >= limits.maxChars) stop = 'size';
    return true;
  };

  /** Queue the includes that `source` names, or report why one is not read. */
  const discover = (ref: string, source: string, depth: number, ancestors: Set<string>): void => {
    for (const statement of findIncludeStatements(source)) {
      const key = statement.name.toUpperCase();
      const at = { parent: ref, line: statement.line };
      if (ancestors.has(key)) {
        if (!cycles.has(`${ref.toUpperCase()} ${key}`)) issues.push({ kind: 'cycle', include: statement.name, ...at });
        cycles.add(`${ref.toUpperCase()} ${key}`);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      const reason = skipReason(statement.name, rootOwner) ?? stop ?? (depth >= limits.maxDepth ? 'depth' : undefined);
      if (reason) {
        issues.push({ kind: 'skipped', reason, include: statement.name, ...at });
        continue;
      }
      const customer = includeOwner(statement.name) === 'customer';
      pending.push({
        statement,
        at,
        depth: depth + 1,
        ancestors: new Set([...ancestors, key]),
        customer,
        order: found++,
      });
    }
  };

  add(root.label, root.source);
  discover(root.ref, root.source, 0, new Set([rootKey]));
  while (pending.length > 0) {
    let first = 0;
    for (let i = 1; i < pending.length; i++) if (byPriority(pending[i]!, pending[first]!) < 0) first = i;
    const next = pending.splice(first, 1)[0]!;
    const { statement, at } = next;
    if (!stop && timeUp()) stop = 'time';
    const reason = stop ?? (blocks.length + absent >= limits.maxBlocks ? 'blocks' : undefined);
    if (reason) {
      // Nothing more is read: list the rest once, in the order it would have been read.
      for (const left of [next, ...pending.sort(byPriority)]) {
        issues.push({ kind: 'skipped', reason, include: left.statement.name, ...left.at });
      }
      break;
    }
    let source: string;
    try {
      source = await read(statement.name, statement.ifFound, request);
    } catch (err) {
      if (err instanceof AdtSafetyError || options.signal?.aborted) throw err;
      if (isDeadlineError(err)) {
        stop = 'time';
        issues.push({ kind: 'skipped', reason: 'time', include: statement.name, ...at });
      } else if (statement.ifFound && isNotFoundError(err)) {
        absent++;
        issues.push({ kind: 'absent', include: statement.name, ...at });
      } else {
        blocks.push({
          name: statement.name,
          source: `[Could not read include "${statement.name}"]`,
          includedAt: at,
          unreadable: true,
        });
        const detail = err instanceof AdtApiError ? `HTTP ${err.statusCode}` : (err as Error)?.name || 'error';
        issues.push({ kind: 'unreadable', detail, include: statement.name, ...at });
      }
      continue;
    }
    if (add(statement.name, source, at)) discover(statement.name, source, next.depth, next.ancestors);
  }
  const truncated = issues.some(
    (issue) => issue.kind === 'shortened' || (issue.kind === 'skipped' && LIMIT_REASONS.has(issue.reason)),
  );
  return { blocks, issues, truncated, limits };
}

export interface ProgramExpansionVersions {
  /** Version of the program or include itself. */
  root?: 'active' | 'inactive';
  /** It is read from the user's draft. */
  rootDraft?: boolean;
  /** Version of one include (default: the root's), and whether that is the user's draft. */
  include?: (name: string) => { version: 'active' | 'inactive'; draft: boolean };
}

/**
 * Read a program or include and every include it names, customer includes first, within one deadline.
 * Blocks read from the user's drafts are marked `draft`.
 */
export async function readProgramExpanded(
  client: AdtClient,
  type: 'PROG' | 'INCL',
  name: string,
  versions: ProgramExpansionVersions,
  options: Omit<IncludeExpansionOptions, 'deadline' | 'signal'> = {},
): Promise<IncludeExpansionResult> {
  const limits = { ...EXPANSION_SEARCH_LIMITS, ...options.limits };
  const signal = getCurrentContext()?.signal;
  const deadline = Date.now() + limits.maxMs;
  const rootRead: SourceReadOptions = { deadline, ...(signal ? { signal } : {}), version: versions.root };
  const { source } =
    type === 'PROG' ? await client.getProgram(name, rootRead) : await client.getInclude(name, rootRead);
  const versionOf = (include: string) => versions.include?.(include) ?? { version: versions.root, draft: false };
  const read: IncludeReader = async (include, optional, request) =>
    (
      await client.getInclude(include, {
        ...request,
        version: versionOf(include).version,
        suppressNotFoundLog: optional,
      })
    ).source;
  const root = { label: `${type} ${name}`, ref: name, owner: name, source };
  const result = await expandIncludes(root, read, { ...options, limits, deadline, signal });
  const blocks = result.blocks.map((block, index): ExpansionBlock => {
    const draft = index === 0 ? versions.rootDraft === true : !block.unreadable && versionOf(block.name).draft;
    return draft ? { ...block, draft: true } : block;
  });
  return { ...result, blocks };
}

/** Customer includes first, then other namespaces, SAP and system includes. */
function ownerRank(include: string): number {
  const owner = includeOwner(include);
  return owner === 'customer' ? 0 : owner.startsWith('/') ? 1 : owner === 'sap' ? 2 : 3;
}

function listed(issues: IncludeIssue[]): string {
  const ordered = [...issues].sort((a, b) => ownerRank(a.include) - ownerRank(b.include));
  const names = ordered
    .slice(0, MAX_LISTED)
    .map((issue) => `${issue.include} (${issue.parent} line ${issue.line}${issue.detail ? `, ${issue.detail}` : ''})`);
  if (issues.length > MAX_LISTED) names.push(`${issues.length - MAX_LISTED} more`);
  return names.join(', ');
}

/**
 * Explain every include that is not shown (or searched) in full, customer code first, or undefined
 * when there is none. `searched` words the notes for grep output.
 */
export function expansionNotes(result: IncludeExpansionResult, searched: boolean): string | undefined {
  const verb = searched ? 'searched' : 'expanded';
  const of = (predicate: (issue: IncludeIssue) => boolean) => result.issues.filter(predicate);
  const lines: string[] = [];
  const shortened = of((issue) => issue.kind === 'shortened');
  if (result.truncated) {
    const { maxBlocks, maxDepth, maxChars, maxMs } = result.limits;
    const unread = of((issue) => issue.kind === 'skipped' && LIMIT_REASONS.has(issue.reason));
    const hit = new Set<IncludeSkipReason>(unread.map((issue) => issue.reason!));
    if (shortened.length) hit.add('size');
    const phrases: Partial<Record<IncludeSkipReason, string>> = {
      blocks: `${maxBlocks} sources`,
      depth: `${maxDepth} levels`,
      size: `${maxChars.toLocaleString('en-US')} characters`,
      time: `${maxMs / 1000} s`,
    };
    const reached = (['blocks', 'depth', 'size', 'time'] as const).filter((reason) => hit.has(reason));
    lines.push(
      `Limit reached (${reached.map((reason) => phrases[reason]).join(', ')}).` +
        (shortened.length
          ? ` ${shortened.map((issue) => `${issue.include} shows lines 1-${issue.shownLines} of ${issue.totalLines}`).join('; ')}.`
          : '') +
        (unread.length ? ` Not ${verb}: ${listed(unread)}; includes inside them are not listed.` : ''),
    );
  }
  const unreadable = of((issue) => issue.kind === 'unreadable');
  if (unreadable.length) lines.push(`Could not be read: ${listed(unreadable)}.`);
  const absent = of((issue) => issue.kind === 'absent');
  if (absent.length) lines.push(`Not present (INCLUDE ... IF FOUND): ${listed(absent)}.`);
  const cycle = of((issue) => issue.kind === 'cycle');
  if (cycle.length) lines.push(`Cycle (includes an enclosing include again; read once): ${listed(cycle)}.`);
  const namespace = of((issue) => issue.reason === 'namespace');
  if (namespace.length) lines.push(`Not ${verb} (other namespace; may be customer code): ${listed(namespace)}.`);
  const sap = of((issue) => issue.reason === 'sap');
  if (sap.length) lines.push(`Not ${verb} (SAP include): ${listed(sap)}.`);
  const system = of((issue) => issue.reason === 'system');
  if (system.length) lines.push(`Not ${verb} (system include): ${listed(system)}.`);
  const name = of((issue) => issue.reason === 'name');
  if (name.length) lines.push(`Not ${verb} (unsupported include name): ${listed(name)}.`);
  if (lines.length === 0) return undefined;
  if (searched) lines.push('Search one include with SAPRead(type="INCL", name="...", grep="...").');
  else if (shortened.length === 0) lines.push('Read one include with SAPRead(type="INCL", name="...").');
  else
    lines.push(
      'Read one include with SAPRead(type="INCL", name="..."); lineStart/lineEnd read the rest of a shortened one.',
    );
  return `=== [include expansion] ===\n${lines.join('\n')}`;
}

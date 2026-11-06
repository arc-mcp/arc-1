/**
 * Transport-scoped review diffs — backs `SAPTransport action="diff"`.
 *
 * Answers "what did this transport change?" by picking, per object, the revision written
 * under the transport and the one immediately before it, then diffing those two sources.
 *
 * The selection mirrors SAP's own ADT MCP tool
 * (`com.sap.adt.tm.backend.diff.TransportDiffService`, ADT 3.60.1) with four corrections
 * proven necessary against live feeds — see docs/plans/2026-08-03-transport-diff.md:
 *
 *  1. match the request AND its tasks (SAP matches one exact correction number);
 *  2. break timestamp ties on the version number — the feed is returned in neither
 *     version nor date order (a4h returns `00002, 00000, 00001`);
 *  3. skip every same-transport sibling when walking back, not just one active entry,
 *     so two saves under one transport still diff against the pre-transport state;
 *  4. never require the predecessor to carry a CTS id — released revisions with a blank
 *     transport exist and are valid baselines.
 *
 * `selectionMethod` and `baselineStatus` ride the result so a reviewer can tell exact
 * evidence from a fallback guess; SAP's tool reports neither.
 */
import { getCurrentContext } from '../server/context.js';
import { type AdtClient, CLASS_REVISION_INCLUDES, REVISION_TYPES } from './client.js';
import { AdtApiError, AdtNetworkError, AdtResponseLimitError, isNotFoundError } from './errors.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { AdtRequestBudgetError } from './request-attempt-budget.js';
import { RevisionHistoryError } from './revision-feed.js';
import { unifiedDiff } from './source-diff.js';
import { ReviewBudget } from './transport-review-budget.js';
import type { RevisionInfo, TransportObject } from './types.js';

/**
 * Error text for a result NOTE (not a thrown error).
 *
 * These notes ride a SUCCESS payload, so they never reach dispatch's `formatMinimalAdtError`.
 * Under `ARC1_MINIMAL_ERRORS` the SAP diagnostic and the ADT path must still be withheld —
 * the status code alone is enough for a reviewer to see that something failed.
 */
function describeError(err: unknown, minimalErrors?: boolean): string {
  // Explain the cause, not the budget state: SAP may fail on the last allowed read.
  if (err instanceof AdtApiError) return minimalErrors ? `SAP request failed (status ${err.statusCode})` : err.message;
  if (err instanceof AdtResponseLimitError)
    return `ARC-1 response exceeded its ${err.limitBytes}-byte review allowance; inspect this part in SAP.`;
  if (err instanceof AdtRequestBudgetError) return err.message;
  if (err instanceof RevisionHistoryError) return err.message;
  if (err instanceof AdtNetworkError && err.cause?.name === 'TimeoutError')
    return 'ARC-1 review request time limit reached; source evidence was not collected.';
  if (err instanceof Error && err.message === 'Review collection budget exhausted.')
    return 'ARC-1 review page budget exhausted; remaining source evidence was not collected.';
  if (!minimalErrors) return err instanceof Error ? err.message : String(err);
  return 'request failed';
}

/** Authentication and caller cancellation end the review, even inside per-part recovery. */
function throwIfReviewInterrupted(error: unknown): void {
  throwIfRequestCancelled({ signal: getCurrentContext()?.signal });
  if (error instanceof AdtApiError && error.statusCode === 401) throw error;
}

/** How `current` was chosen — evidence quality, surfaced to the caller. */
export type RevisionSelectionMethod = 'exact-transport' | 'active-only-fallback' | 'no-revisions';

export type ReviewMode = 'released' | 'active';
export function revisionSourceState(r: RevisionInfo | null): 'released' | 'active' | 'draft' | 'unknown' {
  if (!r) return 'unknown';
  const num = revisionNumber(r);
  return num === ACTIVE_VERSION ? 'active' : num === INACTIVE_VERSION ? 'draft' : num ? 'released' : 'unknown';
}

/** What the "before" side of a diff actually is. */
export type BaselineStatus =
  | 'prior-revision'
  /** A predecessor exists, but the "after" side was NOT matched to this transport — the diff
   *  may belong to another change. Never present this as authoritative. */
  | 'prior-revision-unverified'
  | 'no-prior-snapshot'
  | 'baseline-ambiguous'
  | 'baseline-unavailable';

export interface SkippedRevision {
  revision: RevisionInfo;
  reason: string;
}

export interface TransportRevisionPair {
  current: RevisionInfo | null;
  previous: RevisionInfo | null;
  selectionMethod: RevisionSelectionMethod;
  skipped: SkippedRevision[];
  /** A candidate predecessor exists, but its chronology cannot be established. */
  baselineAmbiguous?: boolean;
}

/**
 * The two pseudo-versions SAP's `IRevision` maps to UI text rather than a number: `00000` is the
 * ACTIVE work state and `99999` the INACTIVE draft. Only active source can be the current side of an open-request
 * review; neither work state is a transported baseline.
 */
const ACTIVE_VERSION = '00000';
const INACTIVE_VERSION = '99999';
const WORK_STATE_VERSIONS = new Set([ACTIVE_VERSION, INACTIVE_VERSION]);

/**
 * The 5-digit ADT version number of a revision.
 *
 * On 7.58 the atom `<id>` is the bare number (`00001`). Some releases use a URN there, so
 * fall back to the number segment of the content URI (`…/versions/<ts>/00001/content`).
 */
export function revisionNumber(revision: RevisionInfo): string {
  for (const value of [revision.id, revision.uri]) {
    const match = String(value ?? '').match(/(?:^|\/)(\d{5})(?:$|[/?#])/);
    if (match) return match[1];
  }
  return '';
}

/**
 * Newest first: timestamp desc, then version number desc, then original order (stable).
 *
 * A revision may carry NO `<atom:updated>` at all (live: CERTRULE_DYNP version 00001 on
 * a4h). Such entries rank AFTER every dated one — a high-numbered undated revision must not
 * outrank a genuinely newer dated one and become the baseline — and are then ordered among
 * themselves by version number.
 */
function sortNewestFirst(revisions: RevisionInfo[]): RevisionInfo[] {
  return revisions
    .map((revision, index) => {
      const parsed = Date.parse(String(revision.timestamp ?? ''));
      // revisionNumber() returns '' when no digit run is present, and Number('') is 0 — which
      // would rank an unparseable revision alongside ACTIVE (00000). Test the digits instead.
      const raw = revisionNumber(revision);
      return {
        revision,
        index,
        time: Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY,
        num: /^\d+$/.test(raw) ? Number(raw) : Number.NEGATIVE_INFINITY,
      };
    })
    .sort(
      // Subtracting two -Infinity values yields NaN, so compare the keys instead of
      // differencing them — the ordering must not depend on NaN happening to be falsy.
      (a, b) => compareDesc(a.time, b.time) || compareDesc(a.num, b.num) || a.index - b.index,
    )
    .map((e) => e.revision);
}

/** Descending compare that is total for ±Infinity (a - b would be NaN for equal infinities). */
function compareDesc(a: number, b: number): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

/**
 * Pick the revision written under `transportIds` and the one immediately preceding it.
 *
 * `transportIds` should hold the request id AND every task id: version records reference
 * the request on the systems verified so far, but matching both is a superset that can
 * only add correct matches.
 */
export function selectTransportRevisionPair(
  revisions: RevisionInfo[],
  transportIds: Iterable<string>,
  mode: ReviewMode = 'released',
): TransportRevisionPair {
  const sorted = sortNewestFirst(revisions);
  const wanted = new Set([...transportIds].map((id) => String(id).trim().toUpperCase()).filter(Boolean));
  const belongsToTransport = (r: RevisionInfo) => {
    const id = String(r.transport ?? '')
      .trim()
      .toUpperCase();
    return id !== '' && wanted.has(id);
  };

  if (!sorted.length) {
    return { current: null, previous: null, selectionMethod: 'no-revisions', skipped: [] };
  }

  // A released review needs an attributed historical snapshot. An open request uses
  // active source, never an inactive draft or an unrelated released version.
  let currentIndex = sorted.findIndex((r) => belongsToTransport(r) && revisionSourceState(r) === mode);
  let selectionMethod: RevisionSelectionMethod = 'exact-transport';
  if (currentIndex === -1 && mode === 'active') {
    currentIndex = sorted.findIndex((r) => revisionSourceState(r) === 'active');
    selectionMethod = 'active-only-fallback';
  }
  if (currentIndex === -1) {
    return { current: null, previous: null, selectionMethod: 'no-revisions', skipped: [] };
  }

  const skipped: SkippedRevision[] = [];
  const current = sorted[currentIndex];
  // Active timestamps can predate the latest snapshot (verified on A4H). They are not
  // historical boundaries: compare active source to the latest foreign snapshot.
  const candidates =
    mode === 'active' ? sorted.filter((r) => revisionSourceState(r) === 'released') : sorted.slice(currentIndex + 1);
  let previousIndex = 0;
  while (previousIndex < candidates.length) {
    const candidate = candidates[previousIndex];
    const num = revisionNumber(candidate);
    if (WORK_STATE_VERSIONS.has(num)) {
      const kind = num === ACTIVE_VERSION ? 'active work state' : 'inactive draft';
      skipped.push({ revision: candidate, reason: `${kind} (version ${num}), not a transported predecessor` });
    } else if (belongsToTransport(candidate)) {
      skipped.push({ revision: candidate, reason: 'belongs to the same transport — baseline must predate it' });
    } else {
      break;
    }
    previousIndex += 1;
  }

  const previous = candidates[previousIndex] ?? null;
  // Missing dates sort last, so date order cannot prove the pair: a predecessor numbered at or
  // after `current`, or a foreign snapshot numbered between the two, leaves chronology open.
  const [before, after] = [previous ? revisionNumber(previous) : '', revisionNumber(current)];
  const currentIsWorkState = WORK_STATE_VERSIONS.has(after);
  const undatedWorkState =
    currentIsWorkState && !Number.isFinite(Date.parse(current.timestamp)) && candidates.length > 0;
  const conflictingCurrent = sorted.some(
    (r) => belongsToTransport(r) && revisionSourceState(r) === mode && revisionNumber(r) > after,
  );
  const conflictingOrder =
    previous &&
    ((revisionSourceState(current) === 'released' && before >= after) ||
      sorted.some(
        (r) =>
          revisionSourceState(r) === 'released' &&
          !belongsToTransport(r) &&
          revisionNumber(r) > before &&
          (currentIsWorkState || revisionNumber(r) < after),
      ));
  return {
    current,
    previous,
    selectionMethod,
    skipped,
    ...(undatedWorkState || conflictingCurrent || conflictingOrder ? { baselineAmbiguous: true } : {}),
  };
}

/**
 * Classify the "before" side.
 *
 * No prior snapshot means only that no predecessor was found; it is not proof of creation.
 * An exact transport match identifies attribution, not the completeness of retained history. A missing predecessor under a fallback selection is ambiguous — it may
 * simply mean the object's history was never snapshotted.
 */
export function baselineStatusFor(pair: TransportRevisionPair, allRevisions: RevisionInfo[] = []): BaselineStatus {
  if (!pair.current) return 'baseline-unavailable';
  if (pair.baselineAmbiguous) return 'baseline-ambiguous';
  const matched = pair.selectionMethod === 'exact-transport';
  if (pair.previous) return matched ? 'prior-revision' : 'prior-revision-unverified';
  if (!matched) return 'baseline-ambiguous';
  // A lower numbered snapshot is evidence that the walk-back missed existing history
  // (for example an undated current row sorted last). Neither result proves creation.
  const currentVersion = revisionNumber(pair.current);
  const currentNum = Number(currentVersion);
  const hasOlder = allRevisions.some((r) => {
    const raw = revisionNumber(r);
    return (
      /^\d+$/.test(raw) &&
      !WORK_STATE_VERSIONS.has(raw) &&
      (WORK_STATE_VERSIONS.has(currentVersion) || Number(raw) < currentNum)
    );
  });
  return hasOlder ? 'baseline-ambiguous' : 'no-prior-snapshot';
}

// ─── Logical object rollup ──────────────────────────────────────────

/**
 * LIMU component types that belong to a class.
 *
 * `REPT` (text pool) deliberately is NOT here: it exists for BOTH classes (the `====CP` class
 * pool) and programs, and claiming it for classes turned every report with text symbols into a
 * phantom class. It is resolved by `wbtype`/name shape below instead.
 */
const CLASS_COMPONENT_TYPES = new Set(['CINC', 'CPRI', 'CPRO', 'CPUB', 'CLSD', 'METH']);

/** LIMU source types that roll up to a program (or, by `wbtype`, an include). */
const PROGRAM_COMPONENT_TYPES = new Set(['REPS', 'REPT']);

export interface LogicalTransportObject {
  pgmid: string;
  type: string;
  name: string;
  description: string;
  taskIds: string[];
  /** The raw transport entries this logical object was built from. */
  components: Array<{ pgmid: string; type: string; name: string; wbtype: string; taskId: string }>;
}

/**
 * The owning class of a LIMU class component, or '' when the entry is not one.
 *
 * CTS pads the class name to 30 characters and appends the component:
 *   `ZCL_ARC1_DEMO_CALC            SUBTRACT` (METH — space padded)
 *   `ZCL_ARC1_DEMO_CALC============CCIMP`    (CINC — '=' padded)
 * Both live shapes verified on a4h. Taking the first 30 chars and cutting at the first
 * '=' handles both, where SAP's own `^([^\s]+)` leaves `====CCIMP` attached.
 *
 * `REPT` is ambiguous (class pool vs program text pool), so it counts as a class component
 * only when `wbtype` says CLAS or the name carries the `=`-padded class-pool shape.
 */
function classOwnerName(pgmid: string, type: string, wbtype: string, name: string): string {
  if (pgmid !== 'LIMU') return '';
  const wb = wbtype.toUpperCase();
  const isClassComponent =
    CLASS_COMPONENT_TYPES.has(type) || wb.startsWith('CLAS/') || (type === 'REPT' && name.includes('='));
  if (!isClassComponent) return '';
  return name.slice(0, 30).replace(/=+.*$/, '').trimEnd();
}

/**
 * ADT splits programs and includes across two endpoints (`/programs/programs/` vs
 * `/programs/includes/`) although CTS types both as `R3TR PROG` / `LIMU REPS`. Only `wbtype`
 * carries the distinction, so an include typed as PROG would 404 on every revision lookup.
 */
function isIncludeWbtype(wbtype: string): boolean {
  return wbtype.toUpperCase().startsWith('PROG/I');
}

/**
 * A FUNCTION-GROUP *source* entry: the group container (`FUGR/F`), its main program
 * (`FUGR/PX`) or a structural include (`FUGR/I`, live-verified on 7.50 and 7.58 — see
 * `src/handlers/read.ts`). These live under `/functions/groups/{group}/...`, which has no
 * revisions feed here, so they are reported as inventory rather than 404'd elsewhere.
 *
 * `FUGR/FF` is deliberately EXCLUDED: it is a function MODULE (`LIMU FUNC`), which
 * `SLASH_TYPE_MAP` maps to the fully supported `FUNC` type. Matching the bare `FUGR/`
 * prefix would send every changed function module to inventory instead of diffing it.
 */
function isFunctionGroupSource(wbtype: string): boolean {
  const wb = wbtype.toUpperCase();
  return wb.startsWith('FUGR/') && !wb.startsWith('FUGR/FF');
}

/** Marker type for a function-group part, so `diffTransportObject` can explain it. */
const FUGR_INCLUDE_TYPE = 'FUGR_INCLUDE';

/**
 * Collapse a transport's raw entries into reviewable objects.
 *
 * `parseTransportList` already yields task-level entries only, so request-level and
 * `<tm:all_objects>` duplicates never arrive here — but the same object under two tasks
 * does, and LIMU names are unusable as ADT object names either way.
 */
export function rollupTransportObjects(
  tasks: Array<{ id: string; objects: TransportObject[] }>,
): LogicalTransportObject[] {
  const byKey = new Map<string, LogicalTransportObject>();

  for (const task of tasks) {
    for (const object of task.objects) {
      const pgmid = String(object.pgmid ?? '').toUpperCase();
      // Release comments ("Comment Entry: Released") are bookkeeping, not repository objects.
      if (pgmid === 'CORR') continue;

      const rawType = String(object.type ?? '').toUpperCase();
      const wbtype = String(object.wbtype ?? '');
      const rawName = String(object.name ?? '').toUpperCase();

      const owner = classOwnerName(pgmid, rawType, wbtype, rawName);
      let type = rawType;
      let name = rawName;
      let logicalPgmid = pgmid;
      if (owner) {
        logicalPgmid = 'R3TR';
        type = 'CLAS';
        name = owner;
      } else if (isFunctionGroupSource(wbtype)) {
        // FUGR sources are not addressable via the program/include endpoints — keep the entry
        // visible as inventory instead of routing it somewhere that 404s.
        logicalPgmid = 'R3TR';
        type = FUGR_INCLUDE_TYPE;
      } else if (pgmid === 'LIMU' && PROGRAM_COMPONENT_TYPES.has(rawType)) {
        logicalPgmid = 'R3TR';
        type = isIncludeWbtype(wbtype) ? 'INCL' : 'PROG';
      } else if (type === 'PROG' && isIncludeWbtype(wbtype)) {
        // R3TR PROG with wbtype PROG/I is a standalone include, not a program.
        type = 'INCL';
      }
      if (!type || !name) continue;

      const key = `${logicalPgmid}:${type}:${name}`;
      const component = { pgmid, type: rawType, name: object.name, wbtype, taskId: task.id };
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          pgmid: logicalPgmid,
          type,
          name,
          description: String(object.description ?? ''),
          taskIds: [task.id],
          components: [component],
        });
        continue;
      }
      existing.description ||= String(object.description ?? '');
      if (!existing.taskIds.includes(task.id)) existing.taskIds.push(task.id);
      existing.components.push(component);
    }
  }

  return [...byKey.values()];
}

// ─── Per-object diffing ─────────────────────────────────────────────

/** Class-pool suffix → the ADT include that holds it. */
const CLASS_POOL_INCLUDES: Record<string, string> = {
  CCDEF: 'definitions',
  CCIMP: 'implementations',
  CCMAC: 'macros',
  CCAU: 'testclasses',
};

/**
 * Which class includes this transport actually touched.
 *
 * CTS already states it: a `CINC ZCL_X============CCIMP` entry names the include, and
 * `METH`/`CPUB`/`CPRI`/`CPRO`/`CLSD` mean the main source. Reading that is strictly better
 * than diffing all five and guessing afterwards which were untouched — it cannot mislabel a
 * changed include as unchanged, and it drops ~4/5 of the SAP round trips for a typical class.
 * A bare `R3TR CLAS` entry carries no component detail, so fall back to all five.
 */
export function classIncludesFor(object: LogicalTransportObject): { includes: string[]; fromComponents: boolean } {
  const includes = new Set<string>();
  for (const c of object.components) {
    // A whole-class R3TR entry is exactly the case where CTS records NO component detail
    // (`R3TR CLAS X` and `LIMU <sub> X` are mutually exclusive per request — measured across
    // ~640k LIMU rows on 758, zero counterexamples), so fall back to every include.
    if (c.pgmid !== 'LIMU') return { includes: [...CLASS_REVISION_INCLUDES], fromComponents: false };
    if (c.type === 'REPT') continue;
    // The suffix starts at a FIXED offset: CTS pads the class name into a 30-char field. It
    // pads with '=' only when the name is shorter — 6.6% of live CINC rows are 30-char names
    // with no padding at all, where splitting on '=' returns the whole string and silently
    // resolves to `main`. Positions 31+ hold only CCAU/CCIMP/CCDEF/CCMAC (census-verified);
    // for METH/CLSD/CPUB/CPRI/CPRO they hold a method name or '', which correctly means main.
    const suffix = c.name.slice(30).trim().toUpperCase();
    includes.add(CLASS_POOL_INCLUDES[suffix] ?? 'main');
  }
  return includes.size
    ? { includes: [...includes], fromComponents: true }
    : { includes: [...CLASS_REVISION_INCLUDES], fromComponents: false };
}

/**
 * Per-part diff cap. A missing predecessor displays available source as additions, so a page of
 * 20 such objects is otherwise unbounded — `MAX_DIFF_OBJECTS` limits the object count, never
 * the bytes. `added`/`removed` are counted before truncation, so the totals stay honest.
 */
const MAX_DIFF_LINES = 400;

/** Trim a unified diff to `MAX_DIFF_LINES` body lines, keeping the header. */
function capDiff(diff: string): { diff: string; truncated: boolean } {
  const lines = diff.split('\n');
  const maxBytes = 16 * 1024;
  if (lines.length <= MAX_DIFF_LINES && Buffer.byteLength(diff) <= maxBytes) return { diff, truncated: false };
  // Decode only complete UTF-8 code points; reserve space for the omission marker.
  const capped = Buffer.from(lines.slice(0, MAX_DIFF_LINES).join('\n'))
    .subarray(0, maxBytes - 100)
    .toString('utf8')
    .replace(/\uFFFD$/, '');
  return {
    diff: `${capped}\n… diff truncated (400-line / 16-KiB display limit)`,
    truncated: true,
  };
}

export interface TransportPartDiff {
  part: string;
  baselineStatus: BaselineStatus;
  selectionMethod: RevisionSelectionMethod;
  from: string | null;
  to: string | null;
  added: number;
  removed: number;
  diff: string;
  /** The hunks were trimmed; `added`/`removed` still reflect the full change. */
  diffTruncated?: boolean;
  note?: string;
  hunksOmitted?: boolean;
}

export interface TransportObjectDiff {
  type: string;
  name: string;
  taskIds: string[];
  parts: TransportPartDiff[];
  /** CTS scope that the source comparison does not cover. */
  notCompared?: string[];
  scopeNote?: string;
  /** Set instead of `parts` when the object carries no diffable source at all. */
  inventoryReason?: string;
}

/** Short evidence label for a revision, e.g. `00001 (A4HK906289)`. */
function revisionLabel(revision: RevisionInfo): string {
  const num = revisionNumber(revision) || revision.id || '?';
  return revision.transport ? `${num} (${revision.transport})` : num;
}

/**
 * Build the "we could not read this" part row. Message text is sanitized by the caller.
 *
 * `resolved` carries whatever evidence was already established. A failure AFTER pair selection
 * (a flaky source GET) must keep its `selectionMethod`/`from`/`to` — claiming "no revisions"
 * for an object whose pair WAS identified is a false signal in the field a reviewer uses to
 * judge evidence quality.
 */
function unavailablePart(part: string, note: string, resolved?: Partial<TransportPartDiff>): TransportPartDiff {
  return {
    ...resolved,
    part,
    baselineStatus: 'baseline-unavailable',
    selectionMethod: resolved?.selectionMethod ?? 'no-revisions',
    from: resolved?.from ?? null,
    to: resolved?.to ?? null,
    added: 0,
    removed: 0,
    diff: '',
    note: [resolved?.note, note].filter(Boolean).join(' '),
  };
}

/**
 * Diff one source part of one object across the transport boundary.
 *
 * Every selected or speculative part receives a result. A 404 cannot establish absence,
 * deletion or unchanged source; report it as an evidence gap.
 */
async function diffPart(
  client: AdtClient,
  type: string,
  name: string,
  part: string,
  transportIds: Set<string>,
  opts: {
    group?: string;
    minimalErrors?: boolean;
    mode?: ReviewMode;
    budget?: ReviewBudget;
    summary?: boolean;
    speculative?: boolean;
  },
): Promise<TransportPartDiff> {
  const include = type === 'CLAS' ? part : undefined;
  let revisions: RevisionInfo[];
  let historyIncomplete = false;
  try {
    const history = await (opts.budget
      ? opts.budget.read((request) => client.getRevisions(type, name, { include, group: opts.group }, request))
      : client.getRevisions(type, name, { include, group: opts.group }));
    revisions = history.revisions;
    historyIncomplete = history.historyComplete === false;
  } catch (err) {
    throwIfReviewInterrupted(err);
    if (type === 'CLAS' && part !== 'main' && isNotFoundError(err)) {
      return unavailablePart(
        part,
        `${opts.speculative ? 'Speculative part' : 'CTS-selected part'}: revision history returned 404; absence or deletion is not established`,
      );
    }
    return unavailablePart(part, `revision history unavailable: ${describeError(err, opts.minimalErrors)}`);
  }

  const pair = selectTransportRevisionPair(revisions, transportIds, opts.mode);
  const baselineStatus: BaselineStatus =
    historyIncomplete && pair.current ? 'baseline-ambiguous' : baselineStatusFor(pair, revisions);
  const base = {
    part,
    baselineStatus,
    selectionMethod: pair.selectionMethod,
    from: pair.previous ? revisionLabel(pair.previous) : null,
    to: pair.current ? revisionLabel(pair.current) : null,
    ...(opts.mode === 'active' &&
    revisions.some(
      (r) => revisionSourceState(r) === 'draft' && transportIds.has((r.transport ?? '').trim().toUpperCase()),
    )
      ? { note: 'Inactive draft pending for this request; not compared.' }
      : {}),
  };

  if (!pair.current) {
    return unavailablePart(
      part,
      opts.speculative && opts.mode !== 'active'
        ? 'Speculative part: no snapshot attributed to this request; unchanged source is not established.'
        : 'No revision satisfies the requested source state and attribution.',
      base,
    );
  }

  let after: string;
  let before: string;
  try {
    // Without a predecessor, additions only display the available source; they do not prove creation.
    const read = (uri: string) =>
      opts.budget
        ? opts.budget.read((request) => client.getRevisionSource(uri, request))
        : client.getRevisionSource(uri);
    after = await read(pair.current.uri);
    before = pair.previous ? await read(pair.previous.uri) : '';
  } catch (err) {
    throwIfReviewInterrupted(err);
    return unavailablePart(part, `source read failed: ${describeError(err, opts.minimalErrors)}`, base);
  }

  let result: ReturnType<typeof unifiedDiff>;
  try {
    result = unifiedDiff(before, after, `${name} (${base.from ?? 'none'})`, `${name} (${base.to})`, 3, true, {
      timeout: 100,
      maxEditLength: 20_000,
    });
  } catch {
    return unavailablePart(part, 'Diff calculation failed or exceeded its work budget; statistics are unavailable.', {
      ...base,
    });
  }
  const capped = capDiff(result.diff);
  const note = [
    base.note,
    historyIncomplete ? 'History advertises more revisions; the selected baseline is uncertain.' : '',
    pair.selectionMethod !== 'exact-transport'
      ? 'Active source is not attributed to this request; this is a candidate comparison.'
      : '',
    result.cosmeticOnly
      ? 'whitespace-only change (trailing blanks / final newline)'
      : result.identical
        ? 'no source change between the selected revisions'
        : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    ...base,
    added: result.added,
    removed: result.removed,
    diff: opts.summary ? '' : capped.diff,
    ...(opts.summary && result.diff ? { hunksOmitted: true } : {}),
    ...(capped.truncated ? { diffTruncated: true } : {}),
    ...(note ? { note } : {}),
  };
}

/** Diff every source part of one logical object. Never throws — failures become visible rows. */
export async function diffTransportObject(
  client: AdtClient,
  object: LogicalTransportObject,
  transportIds: Set<string>,
  opts: { minimalErrors?: boolean; mode?: ReviewMode; budget?: ReviewBudget; summary?: boolean } = {},
): Promise<TransportObjectDiff> {
  opts = { ...opts, budget: opts.budget ?? new ReviewBudget() };
  const { type, name, taskIds } = object;
  const textGap =
    'Text-pool components are in scope; historical symbols, selection texts and headings were not compared.';
  // A text-only CTS key names no source part; diffing main would review something CTS never selected.
  if (object.components.length && object.components.every((c) => c.type === 'REPT')) {
    return { type, name, taskIds, parts: [], inventoryReason: textGap };
  }
  if (object.pgmid !== 'R3TR' && object.pgmid !== 'LIMU') {
    return {
      type,
      name,
      taskIds,
      parts: [],
      inventoryReason: `${object.pgmid} entry: non-source scope has no verified historical adapter.`,
    };
  }
  const wholeObject = object.components.some((c) => c.pgmid === 'R3TR');
  const notCompared = new Set<string>();
  if (wholeObject && REVISION_TYPES.has(type)) notCompared.add('metadata');
  if ((wholeObject && (type === 'PROG' || type === 'CLAS')) || object.components.some((c) => c.type === 'REPT')) {
    notCompared.add('text pool');
  }
  if (wholeObject && type === 'PROG') {
    notCompared.add('screens');
    notCompared.add('GUI status');
  }
  const head = {
    type,
    name,
    taskIds,
    ...(notCompared.size ? { notCompared: [...notCompared] } : {}),
    ...(object.components.some((c) => c.type === 'METH')
      ? {
          scopeNote: 'CTS method keys select whole class source; hunks are not attributed per method.',
        }
      : {}),
  };

  if (type === FUGR_INCLUDE_TYPE) {
    return {
      ...head,
      parts: [],
      inventoryReason:
        'function-group source (wbtype FUGR/*) — in scope; historical include ownership and before/after coverage are not verified by this adapter',
    };
  }

  if (!REVISION_TYPES.has(type)) {
    return {
      ...head,
      parts: [],
      inventoryReason: `type ${type} has no verified historical adapter — in scope, but no source diff available`,
    };
  }

  // FUNC revisions are addressed under their group. A lookup failure must not abort the whole
  // review, so it degrades to an inventory row like any other per-object problem.
  let group: string | undefined;
  if (type === 'FUNC') {
    try {
      group =
        (await (opts.budget
          ? opts.budget.read((request) => client.resolveFunctionGroup(name, request))
          : client.resolveFunctionGroup(name))) ?? undefined;
    } catch (err) {
      throwIfReviewInterrupted(err);
      return {
        ...head,
        parts: [],
        inventoryReason: `function group lookup failed: ${describeError(err, opts.minimalErrors)}`,
      };
    }
    if (!group) {
      return { ...head, parts: [], inventoryReason: `cannot resolve the function group for FUNC ${name}` };
    }
  }

  // Sequence parts within the shared page budget; never enqueue an unbounded batch.
  const selection = type === 'CLAS' ? classIncludesFor(object) : { includes: ['main'], fromComponents: true };
  const wanted = selection.includes;
  const parts: TransportPartDiff[] = [];
  for (const part of wanted) {
    try {
      const result = await diffPart(client, type, name, part, transportIds, {
        ...opts,
        group,
        speculative: !selection.fromComponents,
      });
      parts.push(result);
    } catch (err) {
      throwIfReviewInterrupted(err);
      parts.push(unavailablePart(part, `source read failed: ${describeError(err, opts.minimalErrors)}`));
    }
  }
  return { ...head, parts };
}

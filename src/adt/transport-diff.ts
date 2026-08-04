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
import { type AdtClient, CLASS_REVISION_INCLUDES, REVISION_TYPES } from './client.js';
import { AdtApiError, isNotFoundError } from './errors.js';
import { unifiedDiff } from './source-diff.js';
import type { RevisionInfo, TransportObject } from './types.js';

/**
 * Error text for a result NOTE (not a thrown error).
 *
 * These notes ride a SUCCESS payload, so they never reach dispatch's `formatMinimalAdtError`.
 * Under `ARC1_MINIMAL_ERRORS` the SAP diagnostic and the ADT path must still be withheld —
 * the status code alone is enough for a reviewer to see that something failed.
 */
function describeError(err: unknown, minimalErrors?: boolean): string {
  if (!minimalErrors) return err instanceof Error ? err.message : String(err);
  if (err instanceof AdtApiError) return `SAP request failed (status ${err.statusCode})`;
  return 'request failed';
}

/** How `current` was chosen — evidence quality, surfaced to the caller. */
export type RevisionSelectionMethod =
  | 'exact-transport'
  | 'latest-revision-fallback'
  | 'active-only-fallback'
  | 'no-revisions';

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
}

/**
 * The two pseudo-versions SAP's `IRevision` maps to UI text rather than a number: `00000` is the
 * ACTIVE work state and `99999` the INACTIVE draft. Either can legitimately be the *current* side
 * of a review — that is the change being shipped — but neither is ever a transported baseline.
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

  // An UNRELEASED transport has no snapshot of its own — but while its objects are locked,
  // the active entry (00000) carries the transport link, so it matches here and the walk
  // back lands on the last released state. That makes "what am I about to ship" the same
  // code path as "what did this transport ship", with the same evidence labels.
  let currentIndex = sorted.findIndex(belongsToTransport);
  let selectionMethod: RevisionSelectionMethod = 'exact-transport';

  if (currentIndex === -1) {
    // No revision names this transport. Prefer the newest real snapshot over a work state,
    // so the diff is still between two transported versions.
    currentIndex = sorted.findIndex((r) => !WORK_STATE_VERSIONS.has(revisionNumber(r)));
    selectionMethod = 'latest-revision-fallback';
  }
  if (currentIndex === -1) {
    currentIndex = 0;
    selectionMethod = 'active-only-fallback';
  }

  const skipped: SkippedRevision[] = [];
  let previousIndex = currentIndex + 1;
  while (previousIndex < sorted.length) {
    const candidate = sorted[previousIndex];
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

  return {
    current: sorted[currentIndex],
    previous: previousIndex < sorted.length ? sorted[previousIndex] : null,
    selectionMethod,
    skipped,
  };
}

/**
 * Classify the "before" side.
 *
 * Creation is asserted ONLY when the current revision was matched to the transport and has
 * no predecessor. A missing predecessor under a fallback selection is ambiguous — it may
 * simply mean the object's history was never snapshotted.
 */
export function baselineStatusFor(pair: TransportRevisionPair, allRevisions: RevisionInfo[] = []): BaselineStatus {
  if (!pair.current) return 'baseline-unavailable';
  const matched = pair.selectionMethod === 'exact-transport';
  if (pair.previous) return matched ? 'prior-revision' : 'prior-revision-unverified';
  if (!matched) return 'baseline-ambiguous';
  // "Matched with no predecessor" normally means created here — but for an OPEN transport the
  // active row carries the transport link, so `matched` is trivially true, and SAP only writes
  // versions on release. If any revision has a strictly lower version number, the object plainly
  // pre-existed and the walk-back simply failed to reach it (e.g. the transport's own revision
  // is undated and sorts last). Creation is asserted only when nothing older exists.
  const currentNum = Number(revisionNumber(pair.current));
  const hasOlder = allRevisions.some((r) => {
    const raw = revisionNumber(r);
    return /^\d+$/.test(raw) && !WORK_STATE_VERSIONS.has(raw) && Number(raw) < currentNum;
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
 * Per-part diff cap. A created object renders its ENTIRE source as an addition, so a page of
 * 20 such objects is otherwise unbounded — `MAX_DIFF_OBJECTS` limits the object count, never
 * the bytes. `added`/`removed` are counted before truncation, so the totals stay honest.
 */
const MAX_DIFF_LINES = 400;

/** Trim a unified diff to `MAX_DIFF_LINES` body lines, keeping the header. */
function capDiff(diff: string): { diff: string; truncated: boolean } {
  const lines = diff.split('\n');
  if (lines.length <= MAX_DIFF_LINES) return { diff, truncated: false };
  return {
    diff: `${lines.slice(0, MAX_DIFF_LINES).join('\n')}\n… diff truncated at ${MAX_DIFF_LINES} lines`,
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
}

export interface TransportObjectDiff {
  type: string;
  name: string;
  taskIds: string[];
  parts: TransportPartDiff[];
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
function unavailablePart(
  part: string,
  note: string,
  resolved?: Pick<TransportPartDiff, 'selectionMethod' | 'from' | 'to'>,
): TransportPartDiff {
  return {
    part,
    baselineStatus: 'baseline-unavailable',
    selectionMethod: resolved?.selectionMethod ?? 'no-revisions',
    from: resolved?.from ?? null,
    to: resolved?.to ?? null,
    added: 0,
    removed: 0,
    diff: '',
    note,
  };
}

/**
 * Diff one source part of one object across the transport boundary.
 *
 * Returns null ONLY for a class include that genuinely does not exist (most classes have no
 * CCAU test include) — every other failure becomes a visible `baseline-unavailable` row, so a
 * read error can never masquerade as "unchanged".
 */
async function diffPart(
  client: AdtClient,
  type: string,
  name: string,
  part: string,
  transportIds: Set<string>,
  opts: { group?: string; minimalErrors?: boolean },
): Promise<TransportPartDiff | null> {
  const include = type === 'CLAS' ? part : undefined;
  let revisions: RevisionInfo[];
  try {
    revisions = (await client.getRevisions(type, name, { include, group: opts.group })).revisions;
  } catch (err) {
    if (type === 'CLAS' && part !== 'main' && isNotFoundError(err)) return null;
    return unavailablePart(part, `revision history unavailable: ${describeError(err, opts.minimalErrors)}`);
  }

  const pair = selectTransportRevisionPair(revisions, transportIds);
  const base = {
    part,
    baselineStatus: baselineStatusFor(pair, revisions),
    selectionMethod: pair.selectionMethod,
    from: pair.previous ? revisionLabel(pair.previous) : null,
    to: pair.current ? revisionLabel(pair.current) : null,
  };

  if (!pair.current) {
    return { ...base, added: 0, removed: 0, diff: '', note: 'no revision history for this part' };
  }

  let after: string;
  let before: string;
  try {
    // No predecessor: render the whole thing as an addition so a created object is still
    // reviewable. `baselineStatus` says whether that is proven creation or a missing base.
    [after, before] = await Promise.all([
      client.getRevisionSource(pair.current.uri),
      pair.previous ? client.getRevisionSource(pair.previous.uri) : Promise.resolve(''),
    ]);
  } catch (err) {
    return unavailablePart(part, `source read failed: ${describeError(err, opts.minimalErrors)}`, base);
  }

  const result = unifiedDiff(before, after, `${name} (${base.from ?? 'none'})`, `${name} (${base.to})`, 3, true);
  const capped = capDiff(result.diff);
  const note = result.cosmeticOnly
    ? 'whitespace-only change (trailing blanks / final newline)'
    : result.identical
      ? 'no source change between the selected revisions'
      : undefined;

  return {
    ...base,
    added: result.added,
    removed: result.removed,
    diff: capped.diff,
    ...(capped.truncated ? { diffTruncated: true } : {}),
    ...(note ? { note } : {}),
  };
}

/** Diff every source part of one logical object. Never throws — failures become visible rows. */
export async function diffTransportObject(
  client: AdtClient,
  object: LogicalTransportObject,
  transportIds: Set<string>,
  opts: { minimalErrors?: boolean } = {},
): Promise<TransportObjectDiff> {
  const { type, name, taskIds } = object;
  const head = { type, name, taskIds };

  if (type === FUGR_INCLUDE_TYPE) {
    return {
      ...head,
      parts: [],
      inventoryReason:
        'function-group source (wbtype FUGR/*) — in scope, but its includes live under /functions/groups and have no revisions feed here',
    };
  }

  if (!REVISION_TYPES.has(type)) {
    return {
      ...head,
      parts: [],
      inventoryReason: `type ${type} has no ADT source revision feed — in scope, but no source diff available`,
    };
  }

  // FUNC revisions are addressed under their group. A lookup failure must not abort the whole
  // review, so it degrades to an inventory row like any other per-object problem.
  let group: string | undefined;
  if (type === 'FUNC') {
    try {
      group = (await client.resolveFunctionGroup(name)) ?? undefined;
    } catch (err) {
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

  // Parts are independent reads; http.ts funnels every request through the shared Semaphore
  // (ARC1_MAX_CONCURRENT), so fanning out here is bounded without extra bookkeeping.
  const selection = type === 'CLAS' ? classIncludesFor(object) : { includes: ['main'], fromComponents: true };
  const wanted = selection.includes;
  const settled = await Promise.all(
    wanted.map(async (part) => {
      try {
        return await diffPart(client, type, name, part, transportIds, { group, minimalErrors: opts.minimalErrors });
      } catch (err) {
        if (type === 'CLAS' && part !== 'main' && isNotFoundError(err)) return null;
        return unavailablePart(part, `source read failed: ${describeError(err, opts.minimalErrors)}`);
      }
    }),
  );
  const parts = settled.filter((p): p is TransportPartDiff => p !== null);
  // Every selected part turned out not to exist. Dropping them all would emit an object with
  // no rows and no reason — indistinguishable from "nothing changed", which is the one thing
  // this tool must never say by accident.
  if (!parts.length) {
    return {
      ...head,
      parts: [],
      inventoryReason: `no readable source for ${wanted.join(', ')} — the object or its includes could not be found`,
    };
  }
  return { ...head, parts: selection.fromComponents ? parts : suppressUntouchedParts(parts) };
}

/**
 * Blank the DIFF of parts this transport did not touch, keeping the row for coverage.
 *
 * ONLY valid for a SPECULATIVE part list. When the includes came from the transport's own
 * components, every selected part was named by CTS and therefore WAS changed — suppressing
 * one because its revision happens to carry no CTS id (a live-verified shape) would erase a
 * real diff and report it clean. The caller enforces that; this function assumes the parts
 * were probed blindly.
 *
 * Without it, the whole-class (`R3TR CLAS`) shape renders SAP's boilerplate headers in the
 * four untouched includes as fresh additions — noise around one real change.
 *
 * Two further guards: suppress only when a sibling part DID match the transport (so
 * attribution demonstrably works for this object), and NEVER touch a row whose read failed.
 */
function suppressUntouchedParts(parts: TransportPartDiff[]): TransportPartDiff[] {
  if (!parts.some((p) => p.selectionMethod === 'exact-transport')) return parts;
  return parts.map((p) =>
    p.selectionMethod === 'exact-transport' || p.baselineStatus === 'baseline-unavailable'
      ? p
      : { ...p, added: 0, removed: 0, diff: '', note: 'not changed by this transport' },
  );
}

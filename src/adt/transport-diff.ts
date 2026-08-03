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
import type { AdtClient } from './client.js';
import { unifiedDiff } from './source-diff.js';
import type { RevisionInfo, TransportObject } from './types.js';

/** How `current` was chosen — evidence quality, surfaced to the caller. */
export type RevisionSelectionMethod =
  | 'exact-transport'
  | 'latest-revision-fallback'
  | 'active-only-fallback'
  | 'no-revisions';

/** What the "before" side of a diff actually is. */
export type BaselineStatus =
  | 'prior-revision'
  | 'no-prior-snapshot'
  | 'baseline-ambiguous'
  | 'baseline-unavailable'
  | 'not-supported';

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

/** SAP's `IRevision` maps backend version `00000` to "Active" — it is the work state, not a snapshot. */
const ACTIVE_VERSION = '00000';

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
 * a4h). Such entries sort as oldest rather than being compared on the version number —
 * otherwise a high-numbered undated revision outranks a genuinely newer dated one and
 * becomes the baseline. Mixing the two keys per-pair also breaks comparator transitivity,
 * so the result depends on input order.
 */
function sortNewestFirst(revisions: RevisionInfo[]): RevisionInfo[] {
  return revisions
    .map((revision, index) => {
      const parsed = Date.parse(String(revision.timestamp ?? ''));
      const num = Number(revisionNumber(revision));
      return {
        revision,
        index,
        time: Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY,
        num: Number.isFinite(num) ? num : Number.NEGATIVE_INFINITY,
      };
    })
    .sort((a, b) => b.time - a.time || b.num - a.num || a.index - b.index)
    .map((e) => e.revision);
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
    // No revision names this transport. Prefer the newest real snapshot over the active
    // work state, so the diff is still between two transported versions.
    currentIndex = sorted.findIndex((r) => revisionNumber(r) !== ACTIVE_VERSION);
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
    if (revisionNumber(candidate) === ACTIVE_VERSION) {
      skipped.push({ revision: candidate, reason: 'active work state (version 00000), not a transported predecessor' });
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
export function baselineStatusFor(pair: TransportRevisionPair): BaselineStatus {
  if (!pair.current) return 'baseline-unavailable';
  if (pair.previous) return 'prior-revision';
  return pair.selectionMethod === 'exact-transport' ? 'no-prior-snapshot' : 'baseline-ambiguous';
}

// ─── Logical object rollup ──────────────────────────────────────────

/** LIMU component types that belong to a class rather than being objects in their own right. */
const CLASS_COMPONENT_TYPES = new Set(['CINC', 'CPRI', 'CPRO', 'CPUB', 'CLSD', 'METH', 'REPT']);

/** LIMU source types that roll up to a program. */
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
 */
function classOwnerName(pgmid: string, type: string, wbtype: string): (name: string) => string {
  const isClassComponent = CLASS_COMPONENT_TYPES.has(type) || wbtype.toUpperCase().startsWith('CLAS/');
  if (pgmid !== 'LIMU' || !isClassComponent) return () => '';
  return (name) => name.slice(0, 30).replace(/=+.*$/, '').trimEnd();
}

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

      const owner = classOwnerName(pgmid, rawType, wbtype)(rawName);
      let type = rawType;
      let name = rawName;
      let logicalPgmid = pgmid;
      if (owner) {
        logicalPgmid = 'R3TR';
        type = 'CLAS';
        name = owner;
      } else if (pgmid === 'LIMU' && PROGRAM_COMPONENT_TYPES.has(rawType)) {
        logicalPgmid = 'R3TR';
        type = 'PROG';
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

/**
 * Source parts to diff per type. A class keeps its local classes and test classes in
 * separate includes, each with its own versions feed — diffing only `main` silently misses
 * changes that live in CCIMP or the test include. Empty label = the object's only source.
 */
const CLASS_INCLUDES = ['main', 'definitions', 'implementations', 'macros', 'testclasses'] as const;

/** Types whose revisions feed `revisionsUrlFor` can address. Others have no snapshot history. */
const REVISION_TYPES = new Set(['PROG', 'CLAS', 'INTF', 'FUNC', 'INCL', 'DDLS', 'DCLS', 'BDEF', 'SRVD']);

export interface TransportPartDiff {
  part: string;
  baselineStatus: BaselineStatus;
  selectionMethod: RevisionSelectionMethod;
  from: string | null;
  to: string | null;
  added: number;
  removed: number;
  diff: string;
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
 * A class include that does not exist 404s on its versions feed. That is absence of source,
 * not a failure — most classes have no CCAU test include.
 */
function isAbsentInclude(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /status 404|does not exist|No suitable resource found/i.test(msg);
}

/** Diff one source part of one object across the transport boundary. Null = the part does not exist. */
async function diffPart(
  client: AdtClient,
  type: string,
  name: string,
  part: string,
  transportIds: Set<string>,
  opts: { group?: string },
): Promise<TransportPartDiff | null> {
  const include = type === 'CLAS' ? part : undefined;
  let revisions: RevisionInfo[];
  try {
    revisions = (await client.getRevisions(type, name, { include, group: opts.group })).revisions;
  } catch (err) {
    if (type === 'CLAS' && part !== 'main' && isAbsentInclude(err)) return null;
    return {
      part,
      baselineStatus: 'baseline-unavailable',
      selectionMethod: 'no-revisions',
      from: null,
      to: null,
      added: 0,
      removed: 0,
      diff: '',
      note: `revision history unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const pair = selectTransportRevisionPair(revisions, transportIds);
  const status = baselineStatusFor(pair);
  const base = {
    part,
    baselineStatus: status,
    selectionMethod: pair.selectionMethod,
    from: pair.previous ? revisionLabel(pair.previous) : null,
    to: pair.current ? revisionLabel(pair.current) : null,
  };

  if (!pair.current) {
    return { ...base, added: 0, removed: 0, diff: '', note: 'no revision history for this part' };
  }

  const after = await client.getRevisionSource(pair.current.uri);
  // No predecessor: render the whole thing as an addition so a created object is still
  // reviewable. `baselineStatus` says whether that is proven creation or just a missing base.
  const before = pair.previous ? await client.getRevisionSource(pair.previous.uri) : '';
  const result = unifiedDiff(before, after, `${name} (${base.from ?? 'none'})`, `${name} (${base.to})`, 3, true);

  return {
    ...base,
    added: result.added,
    removed: result.removed,
    diff: result.diff,
    ...(result.identical ? { note: 'no source change between the selected revisions' } : {}),
  };
}

/** Diff every source part of one logical object. */
export async function diffTransportObject(
  client: AdtClient,
  object: LogicalTransportObject,
  transportIds: Set<string>,
): Promise<TransportObjectDiff> {
  const { type, name, taskIds } = object;
  const head = { type, name, taskIds };

  if (!REVISION_TYPES.has(type)) {
    return {
      ...head,
      parts: [],
      inventoryReason: `type ${type} has no ADT source revision feed — in scope, but no source diff available`,
    };
  }

  // FUNC revisions are addressed under their group; resolve it once.
  let group: string | undefined;
  if (type === 'FUNC') {
    group = (await client.resolveFunctionGroup(name)) ?? undefined;
    if (!group) {
      return { ...head, parts: [], inventoryReason: `cannot resolve the function group for FUNC ${name}` };
    }
  }

  const parts: TransportPartDiff[] = [];
  for (const part of type === 'CLAS' ? CLASS_INCLUDES : ['main']) {
    try {
      const diff = await diffPart(client, type, name, part, transportIds, { group });
      if (diff) parts.push(diff);
    } catch (err) {
      if (type === 'CLAS' && part !== 'main' && isAbsentInclude(err)) continue;
      parts.push({
        part,
        baselineStatus: 'baseline-unavailable',
        selectionMethod: 'no-revisions',
        from: null,
        to: null,
        added: 0,
        removed: 0,
        diff: '',
        note: `source read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { ...head, parts: suppressUntouchedParts(parts) };
}

/**
 * Drop the diff from parts this transport never touched.
 *
 * A class has five includes but a transport usually changes one. The untouched ones have no
 * revision naming the transport, so pair selection falls back to their newest snapshot and
 * would render SAP's boilerplate header comments as a fresh addition — four noise blocks
 * around one real change (observed live on ZCL_ARC1_DEMO_CALC / A4HK906291).
 *
 * Only suppress when a sibling part DID match the transport: that proves attribution works
 * for this object, so a non-matching part really is untouched. If nothing matched, the
 * fallback diffs are the only evidence there is — keep them, flagged as ambiguous.
 */
function suppressUntouchedParts(parts: TransportPartDiff[]): TransportPartDiff[] {
  if (!parts.some((p) => p.selectionMethod === 'exact-transport')) return parts;
  return parts.map((p) =>
    p.selectionMethod === 'exact-transport'
      ? p
      : { ...p, added: 0, removed: 0, diff: '', note: 'not changed by this transport' },
  );
}

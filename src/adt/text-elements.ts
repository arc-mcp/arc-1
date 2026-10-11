/**
 * ADT textelements service — an object's text pool.
 *
 * Three collections (`classes`, `programs`, `functiongroups`), each exposing three subobjects that
 * carry their own media type: `symbols` (the numbered `'Text'(001)` literals), `selections` (a
 * report's selection texts — the labels beside PARAMETERS/SELECT-OPTIONS) and `headings` (list
 * header and column headers). Class writes support only `symbols`. Explicit class reads return
 * SAP's raw response, including empty selections and heading placeholders on verified systems.
 *
 * Split out of client.ts, which keeps only the thin delegating methods.
 */

import { lockObject, unlockObject } from './crud.js';
import { activate } from './devtools.js';
import { AdtApiError, AdtError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { parseXml } from './xml-parser.js';

/** Media type per subobject. Each is used as BOTH Content-Type and Accept on the write PUT (SAP
 *  returns 400 "Accept header missing" otherwise). */
const TEXT_ELEMENT_CT = {
  symbols: 'application/vnd.sap.adt.textelements.symbols.v1',
  selections: 'application/vnd.sap.adt.textelements.selections.v1',
  headings: 'application/vnd.sap.adt.textelements.headings.v1',
} as const;

/** ADT textelements collections, keyed by the SAPRead/SAPWrite object type they serve. */
const TEXT_ELEMENT_COLLECTIONS = {
  CLAS: 'classes',
  PROG: 'programs',
  FUGR: 'functiongroups',
} as const;

/** Which subobject of a text pool to read or write. */
export type TextElementPart = keyof typeof TEXT_ELEMENT_CT;

/** Object types that have a text pool on the textelements service. */
export type TextElementObjectType = keyof typeof TEXT_ELEMENT_COLLECTIONS;

export const TEXT_ELEMENT_PARTS = Object.keys(TEXT_ELEMENT_CT) as TextElementPart[];

export const TEXT_ELEMENT_OBJECT_TYPES = Object.keys(TEXT_ELEMENT_COLLECTIONS) as TextElementObjectType[];

export function isTextElementObjectType(type: string): type is TextElementObjectType {
  return Object.hasOwn(TEXT_ELEMENT_COLLECTIONS, type);
}

/** Validate at the HTTP boundary too: JavaScript consumers do not have TypeScript's enums. */
function assertPart(objectType: TextElementObjectType, part: TextElementPart): void {
  if (!isTextElementObjectType(objectType) || !Object.hasOwn(TEXT_ELEMENT_CT, part)) {
    throw new AdtApiError('Invalid text element object type or part.', 400, '/sap/bc/adt/textelements');
  }
}

/** ADT path of the textelements object — the lock target, not the class/program object itself. */
function textElementsObject(objectType: TextElementObjectType, name: string): string {
  return `/sap/bc/adt/textelements/${TEXT_ELEMENT_COLLECTIONS[objectType]}/${encodeURIComponent(name)}`;
}

/** False only when discovery is loaded AND says the collection is missing (e.g. NW 7.50).
 *  A not-yet-populated map answers true, so 757/758/816 is never false-blocked and a real
 *  404 surfaces from SAP instead. */
function serviceAvailable(http: AdtHttpClient, objectType: TextElementObjectType): boolean {
  if (!http.hasDiscoveryData()) return true;
  return http.discoveryAcceptFor(`/sap/bc/adt/textelements/${TEXT_ELEMENT_COLLECTIONS[objectType]}`) !== undefined;
}

/** Fail clean when the ADT textelements service is absent. */
export function assertTextElementsService(http: AdtHttpClient, objectType: TextElementObjectType): void {
  if (!serviceAvailable(http, objectType)) {
    throw new AdtApiError(
      `Text elements for ${objectType} require the ADT textelements service (not available on this system).`,
      404,
      `/sap/bc/adt/textelements/${TEXT_ELEMENT_COLLECTIONS[objectType]}`,
    );
  }
}

/** Read one subobject. Returns the raw properties-style body: `@MaxLength:NN` then `NNN=text` for
 *  symbols, `PARAM=text` lines for selections, `listHeader=`/`columnHeader_N=` for headings. */
export async function readTextElementPart(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectType: TextElementObjectType,
  name: string,
  part: TextElementPart,
): Promise<string> {
  checkOperation(safety, OperationType.Read, 'GetTextElements');
  assertPart(objectType, part);
  assertTextElementsService(http, objectType);
  const resp = await http.get(`${textElementsObject(objectType, name)}/source/${part}`, {
    Accept: TEXT_ELEMENT_CT[part],
  });
  return resp.body;
}

/** Read supported parts under `=== part ===` markers. Preserve raw bodies and propagate failures:
 *  HTTP 406 can indicate a source parse/consistency error, not just an unsupported part. */
export async function readTextElements(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
  options?: { objectType?: string; part?: TextElementPart },
): Promise<string> {
  checkOperation(safety, OperationType.Read, 'GetTextElements');
  const objectType = (options?.objectType ?? 'PROG').toUpperCase();
  if (!isTextElementObjectType(objectType)) {
    throw new AdtApiError(
      `Text elements exist only for ${TEXT_ELEMENT_OBJECT_TYPES.join(', ')} — got "${objectType}".`,
      400,
      '/sap/bc/adt/textelements',
    );
  }
  assertTextElementsService(http, objectType);
  if (options?.part) return readTextElementPart(http, safety, objectType, name, options.part);

  const chunks: string[] = [];
  const parts: readonly TextElementPart[] = objectType === 'CLAS' ? ['symbols'] : TEXT_ELEMENT_PARTS;
  for (const part of parts) {
    const body = await readTextElementPart(http, safety, objectType, name, part);
    if (body.trim()) chunks.push(`=== ${part} ===\n${body}`);
  }
  if (chunks.length > 1) {
    chunks.push(
      'Edit parts individually: SAPRead include=<part>, then SAPWrite textPart=<part>. Send only the raw part body in source, without the === part === markers.',
    );
  }
  return chunks.length > 0 ? chunks.join('\n\n') : `No text elements maintained for ${objectType} ${name}.`;
}

/** One entry of a part body: its `@…` annotation lines, then `KEY=value`. Keys come back
 *  padded (`P_MATNR =Material`), so they are compared trimmed. */
export interface TextPartEntry {
  key: string;
  value: string;
  annotations: string[];
}

/** A selection text marked `@DDICReference` takes its label from the dictionary field. */
const DDIC_REFERENCE = '@DDICReference';
/** What SAP returns for a selection without a text; SAP does not store it on write. */
const UNMAINTAINED_SELECTION = '?...';
/** SAP refuses longer selection texts with SEDX_ADT/110 "Length of text symbol … exceeds 30 characters". */
const SELECTION_TEXT_MAX = 30;

/** Parse a properties-style part body (CRLF or LF; entries may be blank-line separated). */
export function parseTextElementPart(body: string): TextPartEntry[] {
  const entries: TextPartEntry[] = [];
  let annotations: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith('@')) {
      annotations.push(line.trim());
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue; // not an entry: SAP judges it
    entries.push({ key: line.slice(0, eq).trim(), value: line.slice(eq + 1), annotations });
    annotations = [];
  }
  return entries;
}

/** Whether an entry carries a text: selections answer `?...` and headings an empty value for none. */
function isMaintained(part: TextElementPart, entry: TextPartEntry): boolean {
  const text = entry.value.trim();
  return part === 'selections' ? text !== '' && text !== UNMAINTAINED_SELECTION : part === 'symbols' || text !== '';
}

/** Every entry SAP would refuse for its length. SAP itself names only the first one (selections:
 *  SEDX_ADT/110; symbols: an unspecific 406), so the caller would fix them one write at a time. */
export function textElementLengthProblems(part: TextElementPart, source: string): string[] {
  const problems: string[] = [];
  for (const entry of parseTextElementPart(source)) {
    const text = entry.value.trimEnd();
    if (part === 'selections') {
      if (entry.annotations.includes(DDIC_REFERENCE) || !isMaintained(part, entry)) continue;
      if (text.length > SELECTION_TEXT_MAX) {
        problems.push(`${entry.key}: ${text.length} characters, selection texts allow ${SELECTION_TEXT_MAX}`);
      }
    } else if (part === 'symbols') {
      const max = entry.annotations.map((a) => /^@MaxLength:\s*(\d+)$/i.exec(a)?.[1]).find(Boolean);
      if (max === undefined) problems.push(`${entry.key}: no @MaxLength line before it`);
      else if (text.length > Number(max)) {
        problems.push(`${entry.key}: ${text.length} characters, its @MaxLength is ${max}`);
      }
    }
  }
  return problems;
}

/** What a complete-part write removed from the version it replaced. */
export interface TextPartWriteReport {
  /** Keys that had a text and have none after the write. */
  removed: string[];
  /** Selection keys whose dictionary reference the write dropped (the label is now fixed text). */
  ddicReferenceDropped: string[];
}

export function diffTextElementPart(part: TextElementPart, before: string, after: string): TextPartWriteReport {
  const next = new Map(parseTextElementPart(after).map((e) => [e.key, e]));
  const removed: string[] = [];
  const ddicReferenceDropped: string[] = [];
  for (const old of parseTextElementPart(before)) {
    const now = next.get(old.key);
    if (isMaintained(part, old) && (!now || !isMaintained(part, now))) removed.push(old.key);
    if (old.annotations.includes(DDIC_REFERENCE) && !now?.annotations.includes(DDIC_REFERENCE)) {
      ddicReferenceDropped.push(old.key);
    }
  }
  return { removed, ddicReferenceDropped };
}

/** Write one part, unlock, then activate only the text pool in the same stateful session.
 *  The part is replaced completely: entries missing from `source` are removed. The version it
 *  replaces is read under the same lock, and the returned report names what the write removed.
 *  PUT uses the part's media type as BOTH Content-Type and Accept. SAP refuses activation
 *  while the pool is locked; a source read alone cannot distinguish its inactive version.
 *  A never-activated PROG still needs its first owner activation to activate the texts. */
export async function writeTextElementPart(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectType: TextElementObjectType,
  name: string,
  part: TextElementPart,
  source: string,
  transport?: string,
): Promise<TextPartWriteReport> {
  checkOperation(safety, OperationType.Update, 'WriteTextElements');
  assertPart(objectType, part);
  if (objectType === 'CLAS' && part !== 'symbols') {
    throw new AdtApiError(
      `Only symbols can be written for CLAS; ${part} is read-only in ARC-1.`,
      400,
      '/sap/bc/adt/textelements/classes',
    );
  }
  assertTextElementsService(http, objectType);
  const obj = textElementsObject(objectType, name);
  const lengthProblems = textElementLengthProblems(part, source);
  if (lengthProblems.length > 0) {
    throw new AdtApiError(
      `${part} of ${objectType} ${name} not written; SAP would refuse ${lengthProblems.length === 1 ? 'this entry' : 'these entries'}:\n` +
        lengthProblems.map((p) => `- ${p}`).join('\n'),
      400,
      `${obj}/source/${part}`,
    );
  }
  let report: TextPartWriteReport = { removed: [], ddicReferenceDropped: [] };
  await http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, safety, obj, 'MODIFY');
    const corr = transport ?? (lock.corrNr || undefined);
    try {
      const before = await session.get(`${obj}/source/${part}`, { Accept: TEXT_ELEMENT_CT[part] });
      let url = `${obj}/source/${part}?lockHandle=${encodeURIComponent(lock.lockHandle)}`;
      if (corr) url += `&corrNr=${encodeURIComponent(corr)}`;
      await session.put(url, source, TEXT_ELEMENT_CT[part], { Accept: TEXT_ELEMENT_CT[part] });
      report = diffTextElementPart(part, before.body, source);
    } finally {
      await unlockObject(session, obj, lock.lockHandle);
    }
    await activateTextPool(
      session,
      safety,
      obj,
      name,
      'Text elements were saved, but activation was not confirmed. Retry the same text write.',
    );
  });
  return report;
}

/** Activate one text-pool URI only; on failure, prefix `note` to the error and keep it as the hint. */
export async function activateTextPool(
  http: AdtHttpClient,
  safety: SafetyConfig,
  uri: string,
  name: string,
  note: string,
): Promise<void> {
  try {
    // Do not add other inactive objects suggested by a preaudit response.
    const result = await activate(http, safety, uri, { preaudit: false, name });
    if (!result.success) {
      throw new AdtApiError(result.messages.join('\n') || 'Text-pool activation failed.', 400, uri);
    }
  } catch (err) {
    // The dispatcher retains this static hint when minimal errors hide SAP diagnostics.
    if (err instanceof AdtError && !err.extraHint) err.extraHint = note;
    if (err instanceof Error) {
      err.message = `${note}\n${err.message}`;
    }
    throw err;
  }
}

/** Caller already holds the owner lock in this session. The pool has an independent lock:
 * hold both from the explicit inactive-version read through owner DELETE. The caller's
 * inactive feed omits other users' drafts and cannot authorize automatic activation. */
export async function withActiveTextPoolForDelete<T>(
  session: AdtHttpClient,
  safety: SafetyConfig,
  objectType: 'PROG' | 'FUGR',
  name: string,
  deleteOwner: () => Promise<T>,
): Promise<T> {
  if (!serviceAvailable(session, objectType)) return deleteOwner();
  const uri = textElementsObject(objectType, name);
  const lock = await lockObject(session, safety, uri, 'MODIFY');
  try {
    const response = await session.get(`${uri}?version=inactive`);
    const pool = parseXml(response.body).textElement as Record<string, unknown> | undefined;
    const version = pool?.['@_version'];
    if (
      !pool ||
      Array.isArray(pool) ||
      pool['@_name'] !== name ||
      pool['@_type'] !== `${objectType}/PX` ||
      (version !== 'active' && version !== 'inactive')
    ) {
      throw new AdtApiError('Cannot verify the text-pool state; the owner was not deleted.', 409, uri);
    }
    if (version === 'inactive') {
      const hint =
        `${objectType} ${name} was not deleted because its text pool is inactive. ` +
        'Review the draft with its author, then explicitly activate the pool and retry deletion. ' +
        (objectType === 'PROG'
          ? `A newly created program needs its first owner activation. If its source cannot compile and you intend to discard it, replace the source with REPORT ${name}., activate the program, then retry deletion.`
          : 'If SAP leaves an empty pool inactive after activation, resolve the draft in ADT before retrying.');
      const error = new AdtApiError('Deletion refused because the text pool is inactive.', 409, uri);
      error.extraHint = hint;
      throw error;
    }
    return await deleteOwner();
  } finally {
    try {
      await unlockObject(session, uri, lock.lockHandle);
    } catch {
      // Owner DELETE also removes the pool; the stateful session closes on every path.
    }
  }
}

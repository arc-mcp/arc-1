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
function assertService(http: AdtHttpClient, objectType: TextElementObjectType): void {
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
  assertService(http, objectType);
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
  assertService(http, objectType);
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

/** Write one part, unlock, then activate only the text pool in the same stateful session.
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
): Promise<void> {
  checkOperation(safety, OperationType.Update, 'WriteTextElements');
  assertPart(objectType, part);
  if (objectType === 'CLAS' && part !== 'symbols') {
    throw new AdtApiError(
      `Only symbols can be written for CLAS; ${part} is read-only in ARC-1.`,
      400,
      '/sap/bc/adt/textelements/classes',
    );
  }
  assertService(http, objectType);
  const obj = textElementsObject(objectType, name);
  await http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, safety, obj, 'MODIFY');
    const corr = transport ?? (lock.corrNr || undefined);
    try {
      let url = `${obj}/source/${part}?lockHandle=${encodeURIComponent(lock.lockHandle)}`;
      if (corr) url += `&corrNr=${encodeURIComponent(corr)}`;
      await session.put(url, source, TEXT_ELEMENT_CT[part], { Accept: TEXT_ELEMENT_CT[part] });
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

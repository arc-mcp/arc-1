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

import {
  lockObject,
  type MutationLockPolicy,
  unlockObject,
  withAdditionalMutationLock,
  withLockedMutation,
} from './crud.js';
import { type ActivationResult, activate } from './devtools.js';
import { AdtApiError, AdtError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import {
  assertMutationContext,
  type MutationContext,
  type PinnedMutationContext,
  singleTargetMutationContext,
} from './mutation-context.js';
import { getMutationContext } from './mutation-http.js';
import { nativeXmlRoot } from './native-xml-evidence.js';
import { pinnedFunctionSelection } from './pinned-function-owner.js';
import { completePinnedTextPoolWrite } from './pinned-text-pool-completion.js';
import { assertPinnedSourceOwner } from './pinned-write-policy.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { textPartChanges, textPartIsVerifiable, textPartMatchesRequest } from './text-part-changes.js';
import { TEXT_ELEMENT_COLLECTIONS, type TextElementObjectType, textElementsObject } from './text-pool-identity.js';
import { parseXml } from './xml-parser.js';

export type { TextElementObjectType } from './text-pool-identity.js';

/** Media type per subobject. Each is used as BOTH Content-Type and Accept on the write PUT (SAP
 *  returns 400 "Accept header missing" otherwise). */
const TEXT_ELEMENT_CT = {
  symbols: 'application/vnd.sap.adt.textelements.symbols.v1',
  selections: 'application/vnd.sap.adt.textelements.selections.v1',
  headings: 'application/vnd.sap.adt.textelements.headings.v1',
} as const;
const TEXT_POOL_METADATA_CT = 'application/vnd.sap.adt.textelements.v1+xml';

/** Which subobject of a text pool to read or write. */
export type TextElementPart = keyof typeof TEXT_ELEMENT_CT;

export interface TextElementWriteResult {
  changes: string;
  state: 'active' | 'inactive' | 'unknown';
  unchanged: boolean;
  activePartVerified?: boolean;
  nativeActivation?: ActivationResult;
  verificationFailures?: Array<'pool-state' | 'active-part'>;
}

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

/** False only when discovery is loaded AND says the collection is missing (e.g. NW 7.50).
 *  A not-yet-populated map answers true, so 757/758/816 is never false-blocked and a real
 *  404 surfaces from SAP instead. */
export function textElementsServiceAvailable(http: AdtHttpClient, objectType: TextElementObjectType): boolean {
  if (!http.hasDiscoveryData()) return true;
  return http.discoveryAcceptFor(`/sap/bc/adt/textelements/${TEXT_ELEMENT_COLLECTIONS[objectType]}`) !== undefined;
}

/** Fail clean when the ADT textelements service is absent. */
export function assertTextElementsService(http: AdtHttpClient, objectType: TextElementObjectType): void {
  if (!textElementsServiceAvailable(http, objectType)) {
    throw new AdtApiError(
      `Text elements for ${objectType} require the ADT textelements service (not available on this system).`,
      404,
      `/sap/bc/adt/textelements/${TEXT_ELEMENT_COLLECTIONS[objectType]}`,
    );
  }
}

/** A known missing native service is a policy refusal, not an opaque post-submission failure. */
function assertPinnedTextElementsService(http: AdtHttpClient, objectType: TextElementObjectType): void {
  if (!textElementsServiceAvailable(http, objectType))
    throw new AdtSafetyError(
      `Pinned ${objectType} text-pool operations require the native ADT textelements service, which this target does not expose. Use ADT or a target with that service.`,
    );
}

/** Read one subobject. Returns the raw properties-style body: `@MaxLength:NN` then `NNN=text` for
 *  symbols, `PARAM=text` lines for selections, `listHeader=`/`columnHeader_N=` for headings. */
export async function readTextElementPart(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectType: TextElementObjectType,
  name: string,
  part: TextElementPart,
  options?: { version?: 'active' | 'inactive'; fresh?: boolean },
): Promise<string> {
  checkOperation(safety, OperationType.Read, 'GetTextElements');
  assertPart(objectType, part);
  assertTextElementsService(http, objectType);
  if (options?.version !== undefined && !['active', 'inactive'].includes(options.version))
    throw new AdtApiError('Invalid text-element version.', 400, '/sap/bc/adt/textelements');
  const fresh = options?.fresh === true || options?.version !== undefined;
  const uri = `${textElementsObject(objectType, name)}/source/${part}${options?.version ? `?version=${options.version}` : ''}`;
  const resp = await http.get(uri, {
    Accept: TEXT_ELEMENT_CT[part],
    ...(fresh ? { 'Cache-Control': 'no-cache' } : {}),
  });
  if (fresh && Buffer.byteLength(resp.body, 'utf8') > 1024 * 1024)
    throw new AdtApiError('Text-element source exceeded the verification bound.', 409, uri);
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

/** Write one part, unlock, then activate only the text pool in the same stateful session.
 *  Compare native bodies under the lock to report what the replacement removed.
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
): Promise<TextElementWriteResult> {
  return writeTextElementPartWithPolicy(http, safety, objectType, name, part, source, transport, {
    mode: 'single-target',
    context: singleTargetMutationContext(safety),
  });
}

export interface PinnedTextPoolWriteProfile {
  readonly mode: 'pinned-pp';
  readonly ownerType: 'CLAS' | 'PROG' | 'FUGR';
  readonly ownerName: string;
  readonly ownerPackage: string;
  readonly context: PinnedMutationContext;
  readonly lockPolicy: MutationLockPolicy;
  readonly validateActivationOwner: (session: AdtHttpClient) => Promise<void>;
  readonly onPhase: (phase: string, state?: string) => void;
  readonly onResult?: (result: TextElementWriteResult) => void;
}

/** Shared native part-save protocol; policy supplies ownership/recording and verified activation. */
export async function writeTextElementPartWithPolicy(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectType: TextElementObjectType,
  name: string,
  part: TextElementPart,
  source: string,
  transport: string | undefined,
  profile: { mode: 'single-target'; context: MutationContext } | PinnedTextPoolWriteProfile,
): Promise<TextElementWriteResult> {
  assertMutationContext(safety, profile.context);
  if (profile.mode !== profile.context.mode) throw new AdtSafetyError('Mismatched text-pool mutation profile.');
  const pinned = profile.mode === 'pinned-pp' ? profile : undefined;
  if (
    pinned &&
    (objectType !== pinned.ownerType ||
      name !== pinned.ownerName ||
      pinned.lockPolicy.afterUnlock ||
      pinned.lockPolicy.afterUnlockNeeded ||
      pinned.lockPolicy.confirmedResourceDeletion)
  )
    throw new AdtSafetyError('Select the dedicated admitted text-pool ownership profile.');
  if (pinned) {
    if (objectType === 'FUGR') pinnedFunctionSelection(objectType, name);
    else assertPinnedSourceOwner(objectType, name);
  }
  if (pinned && Buffer.byteLength(source, 'utf8') > 1024 * 1024)
    throw new AdtSafetyError('Text-element source exceeds the 1 MiB verification bound.');
  checkOperation(safety, OperationType.Update, 'WriteTextElements');
  assertPart(objectType, part);
  if (pinned && !textPartIsVerifiable(part, source))
    throw new AdtSafetyError(
      'ARC-1 cannot verify this text-part format. Use unique keys and supported complete annotations. No text was saved.',
    );
  if (objectType === 'CLAS' && part !== 'symbols') {
    throw new AdtApiError(
      `Only symbols can be written for CLAS; ${part} is read-only in ARC-1.`,
      400,
      '/sap/bc/adt/textelements/classes',
    );
  }
  pinned?.onPhase('text-pool-service');
  if (pinned) assertPinnedTextElementsService(http, objectType);
  else assertTextElementsService(http, objectType);
  const obj = textElementsObject(objectType, name);
  const result: TextElementWriteResult = { changes: '', state: 'unknown', unchanged: false };
  pinned?.onResult?.(result);
  let saved = false,
    activationStarted = false,
    readback: string | undefined;
  const lockPolicy = pinned?.lockPolicy ?? { beforeLock: () => {}, validateLock: async () => {} };
  try {
    await withLockedMutation(
      http,
      safety,
      profile.context,
      obj,
      {
        ...lockPolicy,
        afterUnlockNeeded: () => !result.unchanged,
        afterUnlock: async (session) => {
          if (result.unchanged) return;
          activationStarted = true;
          if (pinned) {
            await completePinnedTextPoolWrite(session, safety, pinned, part, readback, result);
          } else {
            await activateTextPool(
              session,
              safety,
              obj,
              name,
              `Text elements were saved, but activation was not confirmed. Inspect the text pool before retrying the same text write.${result.changes}`,
            );
            try {
              result.state = await readTextPoolState(session, obj, objectType, name);
            } catch {
              result.state = 'unknown';
            }
          }
        },
      },
      async (session, lock) => {
        const corr = transport ?? (lock.corrNr || undefined);
        pinned?.onPhase('text-pool-read');
        const poolState = pinned
          ? await readOwnedTextPoolState(session, objectType, name, pinned.ownerPackage)
          : undefined;
        const before = await readTextElementPart(
          session,
          safety,
          objectType,
          name,
          part,
          pinned ? { version: 'inactive' } : undefined,
        );
        // Initial empty CLAS/FUGR saves can strand an inactive pool in SAP (COMPAT-15).
        // Content equality alone is not enough: an existing draft must never be skipped.
        if (objectType !== 'PROG' && part === 'symbols' && source === '' && before === '') {
          const state = poolState ?? (await readTextPoolState(session, obj, objectType, name));
          if (state === 'active') {
            if (
              pinned &&
              (await readTextElementPart(session, safety, objectType, name, part, { version: 'active' })) !== ''
            )
              throw new AdtSafetyError('The active empty-pool content could not be verified.');
            result.state = state;
            result.unchanged = true;
            if (pinned) result.activePartVerified = true;
            pinned?.onPhase('complete', 'unchanged');
            return;
          }
        }
        let url = `${obj}/source/${part}?lockHandle=${encodeURIComponent(lock.lockHandle)}`;
        if (corr) url += `&corrNr=${encodeURIComponent(corr)}`;
        if (pinned) throwIfRequestCancelled(pinned.context.requestPolicy);
        pinned?.onPhase('text-save', 'text-save-unknown');
        await session.put(url, source, TEXT_ELEMENT_CT[part], { Accept: TEXT_ELEMENT_CT[part] });
        saved = true;
        pinned?.onPhase('text-readback', 'text-saved-unverified');
        const after = await readTextElementPart(
          session,
          safety,
          objectType,
          name,
          part,
          pinned ? { version: 'inactive' } : undefined,
        );
        readback = after;
        result.changes = textPartChanges(part, before, after);
        if (pinned && !textPartMatchesRequest(part, source, after))
          throw new AdtSafetyError(
            'SAP readback does not match the requested text-part entries or annotations. The part may have been saved, but activation was not requested. Inspect the native part in ADT before continuing.',
          );
        pinned?.onPhase('unlock', 'text-saved-inactive');
      },
    );
  } catch (err) {
    if (saved && !activationStarted) {
      throwTextPoolFailure(
        err,
        'Text elements were saved, but read-back or activation was not confirmed. Read the part before retrying.' +
          result.changes,
      );
    }
    throw err;
  }
  return result;
}

/** Read exact native identity/state for the owner's pool; never activate it or follow arbitrary URIs. */
export async function readOwnedTextPoolState(
  http: AdtHttpClient,
  objectType: TextElementObjectType,
  name: string,
  expectedPackage?: string,
): Promise<'active' | 'inactive'> {
  assertPinnedTextElementsService(http, objectType);
  return readTextPoolState(http, textElementsObject(objectType, name), objectType, name, true, expectedPackage);
}

async function readTextPoolState(
  http: AdtHttpClient,
  uri: string,
  objectType: TextElementObjectType,
  name: string,
  fresh = false,
  expectedPackage?: string,
): Promise<'active' | 'inactive'> {
  const response = await http.get(
    `${uri}?version=inactive`,
    fresh ? { 'Cache-Control': 'no-cache', Accept: TEXT_POOL_METADATA_CT } : undefined,
  );
  if (fresh) {
    const core = 'http://www.sap.com/adt/core';
    const pool = nativeXmlRoot(response.body, 'textElement', 'http://www.sap.com/adt/textelements');
    const state = pool.attribute('version', core);
    if (
      pool.attribute('name', core) !== name ||
      pool.attribute('type', core) !== (objectType === 'CLAS' ? 'CLAS/OCX' : `${objectType}/PX`) ||
      (state !== 'active' && state !== 'inactive')
    )
      throw new AdtSafetyError('Cannot verify the text-pool state.');
    const pkg = pool.child('packageRef', core);
    if (
      expectedPackage !== undefined &&
      pkg &&
      (pkg.attribute('name', core) !== expectedPackage ||
        (pkg.attribute('type', core) !== undefined && pkg.attribute('type', core) !== 'DEVC/K'))
    )
      throw new AdtSafetyError('The text-pool package does not match its verified owner package.');
    return state;
  }
  const pool = parseXml(response.body).textElement as Record<string, unknown> | undefined;
  const state = pool?.['@_version'];
  if (
    !pool ||
    Array.isArray(pool) ||
    pool['@_name'] !== name ||
    pool['@_type'] !== (objectType === 'CLAS' ? 'CLAS/OCX' : `${objectType}/PX`) ||
    (state !== 'active' && state !== 'inactive')
  ) {
    throw new AdtApiError('Cannot verify the text-pool state.', 409, uri);
  }
  return state;
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
    throwTextPoolFailure(err, note);
  }
}

/** Keep confirmed save state visible even when minimal errors hide SAP diagnostics. */
function throwTextPoolFailure(err: unknown, note: string): never {
  if (err instanceof AdtError) err.extraHint = err.extraHint ? `${note}\n${err.extraHint}` : note;
  if (err instanceof Error) err.message = `${note}\n${err.message}`;
  throw err;
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
  if (safety.multiTargetWrite)
    throw new AdtSafetyError('Pinned text-pool deletion requires its explicit owning-lock policy.');
  if (!textElementsServiceAvailable(session, objectType)) return deleteOwner();
  const uri = textElementsObject(objectType, name);
  const lock = await lockObject(session, safety, uri, 'MODIFY');
  try {
    await assertActiveTextPoolForDelete(session, uri, objectType, name);
    return await deleteOwner();
  } finally {
    try {
      await unlockObject(session, uri, lock.lockHandle);
    } catch {
      // Owner DELETE also removes the pool; the stateful session closes on every path.
    }
  }
}

/** Pinned profile uses the outer coordinator's owning session and independent cleanup budget. */
export async function withPinnedActiveTextPoolForDelete<T>(
  session: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
  policy: MutationLockPolicy,
  deleteOwner: () => Promise<T>,
  expectedPackage?: string,
  objectType: 'PROG' | 'FUGR' = 'PROG',
): Promise<T> {
  if (getMutationContext(session, safety)?.mode !== 'pinned-pp')
    throw new AdtSafetyError('Pinned text-pool deletion requires a registered mutation session.');
  assertPinnedTextElementsService(session, objectType);
  const uri = textElementsObject(objectType, name);
  return withAdditionalMutationLock(session, uri, policy, async () => {
    await assertActiveTextPoolForDelete(session, uri, objectType, name, true, expectedPackage);
    return deleteOwner();
  });
}

async function assertActiveTextPoolForDelete(
  session: AdtHttpClient,
  uri: string,
  objectType: 'PROG' | 'FUGR',
  name: string,
  fresh = false,
  expectedPackage?: string,
): Promise<void> {
  const version = await readTextPoolState(session, uri, objectType, name, fresh, expectedPackage);
  if (version === 'inactive') {
    if (fresh)
      throw new AdtSafetyError(
        `${objectType} ${name} was not deleted because its text pool is inactive. Review the draft with its author in ADT and activate the intended pool there before retrying deletion.${objectType === 'PROG' ? ' A new program may first need owner activation.' : ''} Pinned SAPActivate does not offer direct REPT activation; deletion never activates drafts automatically.`,
      );
    const hint =
      `${objectType} ${name} was not deleted because its text pool is inactive. ` +
      'Review the draft with its author, then explicitly activate the pool and retry deletion. ' +
      (objectType === 'PROG'
        ? `A newly created program needs its first owner activation. If its source cannot compile and you intend to discard it, replace the source with REPORT ${name}., activate the program, then retry deletion.`
        : 'SAP can leave an empty pool inactive despite a successful activation response. Stop and involve the user; ARC-1 has no verified automatic repair.');
    const error = new AdtApiError('Deletion refused because the text pool is inactive.', 409, uri);
    error.extraHint = hint;
    throw error;
  }
}

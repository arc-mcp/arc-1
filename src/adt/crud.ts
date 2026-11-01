/**
 * CRUD operations for SAP ADT objects.
 *
 * All write operations follow the pattern: lock → modify → unlock
 * The lock/unlock must happen on the same stateful HTTP session.
 * We use AdtHttpClient.withStatefulSession() to guarantee this.
 *
 * Critical: unlock MUST happen even if modify fails (try-finally pattern).
 * This was a hard-won lesson in the fr0ster codebase — earlier versions
 * leaked locks on error, blocking the object for other developers.
 */

import { postCreate } from './create-request.js';
import { AdtApiError, AdtSafetyError, extractExceptionType } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import {
  assertMutationContext,
  type MutationContext,
  pinnedSessionCleanup,
  singleTargetMutationContext,
} from './mutation-context.js';
import { mutationHttp, withMutationSession } from './mutation-http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { assertSourceHash } from './source-precondition.js';
/** Lock result from SAP */
export interface LockResult {
  lockHandle: string;
  corrNr: string;
  isLocal: boolean;
  localityKnown?: boolean;
}

/** Lock an ABAP object for editing */
export async function lockObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  accessMode = 'MODIFY',
  abapRelease?: string,
  systemType?: string,
  options?: AdtRequestOptions,
): Promise<LockResult> {
  if (accessMode === 'MODIFY') {
    checkOperation(safety, OperationType.Lock, 'LockObject');
  }

  let resp: Awaited<ReturnType<AdtHttpClient['post']>>;
  try {
    resp = await http.post(
      `${objectUrl}?_action=LOCK&accessMode=${accessMode}`,
      undefined,
      undefined,
      {
        // Dual Accept: vendor-specific type for structured lock result parsing,
        // plus wildcard fallback for SAP versions that don't support the vendor type.
        Accept: 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result, application/*;q=0.8',
      },
      options,
    );
  } catch (err) {
    const conv = convertHtmlConflictToProperError(err, objectUrl, { abapRelease, systemType, operation: 'lock' });
    if (conv) throw conv;
    throw err;
  }

  // Parse lock response (asx:abap format) — simple regex extraction
  const lockHandle = extractXmlValue(resp.body, 'LOCK_HANDLE');
  const corrNr = extractXmlValue(resp.body, 'CORRNR');
  const isLocal = extractXmlValue(resp.body, 'IS_LOCAL') === 'X';
  const modificationSupport = extractXmlValue(resp.body, 'MODIFICATION_SUPPORT');
  const namespacedModificationSupportMatch = resp.body.match(/modificationSupport[^>]*>([^<]+)<\//);
  const namespacedModificationSupport = namespacedModificationSupportMatch?.[1] ?? '';

  if (modificationSupport === 'false' || namespacedModificationSupport === 'false') {
    throw new AdtApiError(
      'Object cannot be modified: it is in a released or non-modifiable transport. To edit this object, assign it to a new open correction request (use SE09 to create one), or work with your basis team to create a new transport.',
      423,
      objectUrl,
    );
  }

  return {
    lockHandle,
    corrNr,
    isLocal,
    ...(options
      ? {
          localityKnown:
            ['', 'X'].includes(extractXmlValue(resp.body, 'IS_LOCAL')) &&
            /<IS_LOCAL(?:\s[^>]*)?(?:\s*\/>|>[\s\S]*?<\/IS_LOCAL>)/.test(resp.body),
        }
      : {}),
  };
}

/** Unlock an ABAP object */
export async function unlockObject(http: AdtHttpClient, objectUrl: string, lockHandle: string): Promise<void> {
  await http.post(`${objectUrl}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`);
}

/** Required hooks keep policy revalidation before the operation, inside the owning lock. */
export interface MutationLockPolicy {
  beforeLock: () => void;
  validateLock: (session: AdtHttpClient, lock: LockResult) => Promise<void>;
}

const legacyLockPolicy: MutationLockPolicy = {
  beforeLock: () => {},
  validateLock: async () => {},
};

type AdditionalLock = <T>(
  url: string,
  policy: MutationLockPolicy,
  operation: (lock: LockResult) => Promise<T>,
) => Promise<T>;
const additionalLocks = new WeakMap<AdtHttpClient, AdditionalLock>();

/** Additional native locks belong to the existing coordinator/session, never a new SAP context. */
export function withAdditionalMutationLock<T>(
  session: AdtHttpClient,
  objectUrl: string,
  policy: MutationLockPolicy,
  operation: (lock: LockResult) => Promise<T>,
): Promise<T> {
  const acquire = additionalLocks.get(session);
  if (!acquire) throw new AdtSafetyError('An active pinned owning-lock lifecycle is required.');
  return acquire(objectUrl, policy, operation);
}

/** Shared session/lock mechanics; adapters retain their native recording, source and result logic. */
export async function withLockedMutation<T>(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: MutationContext,
  objectUrl: string,
  policy: MutationLockPolicy,
  operation: (session: AdtHttpClient, lock: LockResult) => Promise<T>,
  abapRelease?: string,
): Promise<T> {
  assertMutationContext(safety, context);
  checkOperation(safety, OperationType.Update, 'MutationSession');
  const run = async (owningSession: AdtHttpClient) => {
    const session = mutationHttp(owningSession, safety, context);
    const held = new Set([objectUrl]);
    const release = async (url: string, handle: string) => {
      if (context.mode !== 'pinned-pp' || !handle) return;
      try {
        await owningSession.post(
          `${url}?_action=UNLOCK&lockHandle=${encodeURIComponent(handle)}`,
          undefined,
          undefined,
          undefined,
          { deadline: Date.now() + 30_000, retryTransientErrors: false, noReplay: true },
        );
      } catch {
        context.cleanup.unlockFailed = true;
      }
    };
    policy.beforeLock();
    const lock = await lockObject(session, safety, objectUrl, 'MODIFY', abapRelease, undefined, context.requestPolicy);
    if (context.mode === 'pinned-pp')
      additionalLocks.set(session, async (url, extraPolicy, fn) => {
        if (held.has(url)) throw new AdtSafetyError('The resource is already locked by this mutation.');
        held.add(url);
        try {
          extraPolicy.beforeLock();
          const extra = await lockObject(session, safety, url, 'MODIFY', abapRelease, undefined, context.requestPolicy);
          try {
            await extraPolicy.validateLock(session, extra);
            return await fn(extra);
          } finally {
            await release(url, extra.lockHandle);
          }
        } finally {
          held.delete(url);
        }
      });
    try {
      await policy.validateLock(session, lock);
      return await operation(session, lock);
    } finally {
      additionalLocks.delete(session);
      if (context.mode === 'single-target') {
        // Preserve legacy finally precedence, including an unlock error replacing the primary error.
        await unlockObject(owningSession, objectUrl, lock.lockHandle);
      } else await release(objectUrl, lock.lockHandle);
    }
  };
  return withMutationSession(
    http,
    safety,
    context,
    run,
    context.mode === 'pinned-pp' ? pinnedSessionCleanup(context) : undefined,
  );
}

/**
 * Some vendor content types are versioned, and the server-side release
 * determines which versions are accepted. DTEL is a concrete case: modern
 * systems (SAP_BASIS ≥ 7.52) accept `…dataelements.v2+xml`, NW 7.50/7.51
 * only accept `…dataelements.v1+xml` — same XML body, different MIME version
 * suffix. On HTTP 415, retry once with the fallback.
 *
 * Kept as a narrow static map so a backport never falls back into an
 * unintended retry loop for unrelated content types.
 */
const CONTENT_TYPE_FALLBACKS: Record<string, string> = {
  'application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8':
    'application/vnd.sap.adt.dataelements.v1+xml; charset=utf-8',
  'application/vnd.sap.adt.dataelements.v2+xml': 'application/vnd.sap.adt.dataelements.v1+xml',
};

/** Create a new ABAP object */
export async function createObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  body: string,
  contentType = 'application/*',
  transport?: string,
  packageName?: string,
  abapRelease?: string,
  systemType?: string,
  objectName?: string,
): Promise<string> {
  checkOperation(safety, OperationType.Create, 'CreateObject');

  const params: string[] = [];
  if (transport) {
    params.push(`corrNr=${encodeURIComponent(transport)}`);
  }
  if (packageName) {
    params.push(`_package=${encodeURIComponent(packageName)}`);
  }
  const url = params.length > 0 ? `${objectUrl}?${params.join('&')}` : objectUrl;

  try {
    const resp = await postCreate(http, url, body, contentType);
    return resp.body;
  } catch (err) {
    // Preserve uncertain 429/5xx outcomes instead of reclassifying them as definitive 4xx rejections.
    if (err instanceof AdtApiError && err.creationOutcome === 'unknown') throw err;
    // Reclassify lock/exists conflicts that arrive as HTML or via structured
    // exception type — same precedence as the lockObject path.
    const conv = convertHtmlConflictToProperError(err, objectUrl, {
      abapRelease,
      systemType,
      operation: 'create',
      objectName,
    });
    if (conv) throw conv;
    const fallback = CONTENT_TYPE_FALLBACKS[contentType];
    if (fallback && isUnsupportedMediaTypeError(err)) {
      const resp = await postCreate(http, url, body, fallback);
      return resp.body;
    }
    throw err;
  }
}

function isUnsupportedMediaTypeError(err: unknown): boolean {
  if (!(err instanceof AdtApiError)) return false;
  return err.statusCode === 415;
}

/** Update source code of an ABAP object (requires lock) */
export async function updateSource(
  http: AdtHttpClient,
  safety: SafetyConfig,
  sourceUrl: string,
  source: string,
  lockHandle: string,
  transport?: string,
): Promise<void> {
  checkOperation(safety, OperationType.Update, 'UpdateSource');

  let url = sourceUrl;
  const params: string[] = [`lockHandle=${encodeURIComponent(lockHandle)}`];
  if (transport) {
    params.push(`corrNr=${encodeURIComponent(transport)}`);
  }
  if (params.length > 0) {
    url += (url.includes('?') ? '&' : '?') + params.join('&');
  }

  await http.put(url, source, 'text/plain');
}

/** Update object metadata XML (requires lock) */
export async function updateObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  body: string,
  lockHandle: string,
  contentType: string,
  transport?: string,
): Promise<void> {
  checkOperation(safety, OperationType.Update, 'UpdateObject');

  let url = objectUrl;
  const params: string[] = [`lockHandle=${encodeURIComponent(lockHandle)}`];
  if (transport) {
    params.push(`corrNr=${encodeURIComponent(transport)}`);
  }
  if (params.length > 0) {
    url += (url.includes('?') ? '&' : '?') + params.join('&');
  }

  try {
    await http.put(url, body, contentType);
  } catch (err) {
    const fallback = CONTENT_TYPE_FALLBACKS[contentType];
    if (fallback && isUnsupportedMediaTypeError(err)) {
      await http.put(url, body, fallback);
      return;
    }
    throw err;
  }
}

/** Delete an ABAP object (requires lock) */
export async function deleteObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  lockHandle: string,
  transport?: string,
): Promise<void> {
  checkOperation(safety, OperationType.Delete, 'DeleteObject');

  let url = `${objectUrl}?lockHandle=${encodeURIComponent(lockHandle)}`;
  if (transport) {
    url += `&corrNr=${encodeURIComponent(transport)}`;
  }

  await http.delete(url);
}

/**
 * High-level: update source with guaranteed unlock.
 * lock → optional fresh read/transform and hash check → updateSource → unlock (in try-finally)
 */
export async function safeUpdateSource(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  sourceUrl: string,
  source: string | ((current: string, session: AdtHttpClient) => Promise<string>),
  transport?: string,
  abapRelease?: string,
  expectedSourceHash?: string,
): Promise<void> {
  checkOperation(safety, OperationType.Update, 'UpdateSource');
  await withLockedMutation(
    http,
    safety,
    singleTargetMutationContext(safety),
    objectUrl,
    legacyLockPolicy,
    async (session, lock) => {
      const effectiveTransport = transport ?? (lock.corrNr || undefined);
      let replacement: string;
      if (expectedSourceHash !== undefined || typeof source === 'function') {
        checkOperation(safety, OperationType.Read, 'GetSource');
        const current = await session.get(sourceUrl, { 'Cache-Control': 'no-cache' });
        assertSourceHash(current.body, expectedSourceHash, sourceUrl);
        replacement = typeof source === 'function' ? await source(current.body, session) : source;
      } else {
        replacement = source;
      }
      await updateSource(session, safety, sourceUrl, replacement, lock.lockHandle, effectiveTransport);
    },
    abapRelease,
  );
}

/**
 * Initialise (create) an empty class-local include (CCDEF/CCIMP/CCMAC/CCAU).
 *
 * On a freshly-created class the optional includes — notably `testclasses`
 * (CCAU) — do not exist yet: `GET …/includes/testclasses` → 404, and a content
 * PUT fails with `HTTP 500 "…CCAU does not have any inactive version"`. SAP's
 * ADT contract is that the include must be created first.
 *
 * Live-verified mechanism (7.50 / 758 / 816): inside a locked stateful session,
 * an empty `POST …/includes/{include}?lockHandle=<LH>` (no body, no content-type)
 * returns 201 and creates the include (SAP generates an empty skeleton). A bare
 * POST without the lock handle returns 423 ("Resource CLASS_INCLUDE … is not
 * locked"), so this MUST run with a valid lock on the parent class.
 *
 * `transport` is REQUIRED for a class in a transportable package: creating the include
 * creates a new `LIMU CINC …CCAU` sub-object that CTS must record, and without a corrNr
 * SAP 500s with "Object LIMU CINC … is already locked in request … of user …" instead of
 * reusing the covering `R3TR CLAS` lock (#645). `$TMP` needs none.
 *
 * Caller contract: invoke inside `withStatefulSession`, holding the parent
 * class lock; pass that `lockHandle`.
 */
export async function initClassInclude(
  http: AdtHttpClient,
  safety: SafetyConfig,
  includeUrl: string,
  lockHandle: string,
  transport?: string,
): Promise<void> {
  // Creating the include is a mutation — gated by allowWrites like every other
  // write (package gating already happened in the handler before this point).
  checkOperation(safety, OperationType.Create, 'InitClassInclude');
  let url = `${includeUrl}?lockHandle=${encodeURIComponent(lockHandle)}`;
  if (transport) {
    url += `&corrNr=${encodeURIComponent(transport)}`;
  }
  await postCreate(http, url, '');
}

// Compatibility export; the shared adapter keeps the legacy signature and explicit pinned policy.
export { safeUpdateClassInclude } from './class-include-write.js';

/**
 * High-level: update object metadata with guaranteed unlock.
 * lock → updateObject → unlock (in try-finally)
 */
export async function safeUpdateObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  body: string,
  contentType: string,
  transport?: string,
  abapRelease?: string,
): Promise<void> {
  await http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, safety, objectUrl, 'MODIFY', abapRelease);
    const effectiveTransport = transport ?? (lock.corrNr || undefined);
    try {
      await updateObject(session, safety, objectUrl, body, lock.lockHandle, contentType, effectiveTransport);
    } finally {
      await unlockObject(session, objectUrl, lock.lockHandle);
    }
  });
}

/** Simple XML value extractor (for lock responses) */
function extractXmlValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const match = xml.match(regex);
  return match?.[1] ?? '';
}

/**
 * Convert an ICM-intercepted lock/exists conflict into a clean AdtApiError(409).
 *
 * Two-layer detection (per ADR-0002):
 *
 *   Layer 1 — structured exception type (release-agnostic, robust):
 *     <exc:exception><type id="ExceptionResourceNoAccess"/>  → reclassify regardless of status.
 *     Same for ExceptionResourceLockedByAnotherUser.
 *
 *   Layer 2 — HTML body marker, scoped by SAP_BASIS release:
 *     Some SAP releases (NW 7.50) emit an ICM HTML "Logon Error Message" page when the ADT
 *     handler tries to throw CX_ADT_RES_NO_ACCESS through cookie auth. The "Logon Error
 *     Message" string appears in the <title> only on systems whose ICM uses the English
 *     error-page template — re-localizing the system would shift the marker. So the heuristic
 *     is gated on `cachedFeatures.abapRelease < 751` (or undefined for CLI/test paths,
 *     where the startup probe didn't populate features).
 *     The fallback message is intentionally neutral ("may be locked or already exist") because
 *     the ICM intercept loses the original SAP exception type — we cannot disambiguate.
 *
 * Returns the reclassified AdtApiError(409) (caller throws), or undefined when the original
 * error should be rethrown unchanged.
 */
export function convertHtmlConflictToProperError(
  err: unknown,
  objectUrl: string,
  opts: { abapRelease?: string; systemType?: string; operation?: 'lock' | 'create'; objectName?: string } = {},
): AdtApiError | undefined {
  if (!(err instanceof AdtApiError)) return undefined;
  const body = err.responseBody ?? '';
  const cloud = opts.systemType === 'btp';
  // On create, objectUrl is the collection (e.g. /oo/classes) — its last segment is "classes",
  // not the object — so the caller passes the real name explicitly (G-4).
  const name = opts.objectName ?? objectUrl.split('/').pop() ?? objectUrl;

  // Layer 1: structured exception type
  const typeId = extractExceptionType(body);

  // ExceptionResourceNoAccess on a CREATE is an authorization/package denial, NOT a lock
  // (SM12/SE80 don't exist on BTP). On BTP this most often means the target package isn't
  // writable ($TMP and on-prem packages are rejected — objects must live in a cloud package). (G-4)
  if (typeId === 'ExceptionResourceNoAccess' && opts.operation === 'create') {
    // Structure packages (e.g. the default ZLOCAL on a fresh ABAP Environment) cannot hold
    // development objects — a distinct, common BTP case worth its own hint (PAK 149, live-verified).
    const isStructurePackage = /Structure packages cannot contain development objects/i.test(body);
    return new AdtApiError(
      isStructurePackage
        ? `Cannot create ${name}: the target package is a structure package and cannot contain development objects. ` +
            `On the ABAP Environment, create a regular sub-package under it (e.g. under ZLOCAL) and target that, ` +
            `then set SAP_ALLOWED_PACKAGES accordingly.`
        : cloud
          ? `Cannot create ${name}: no authorization, or the target package is not writable on the ABAP Environment. ` +
            `On BTP, objects must live in a regular (non-structure) cloud package — $TMP, on-prem packages, and ` +
            `structure packages are rejected. Set SAP_ALLOWED_PACKAGES to a writable cloud package and ensure your ` +
            `developer role (e.g. SAP_BR_DEVELOPER) is assigned.`
          : `Cannot create ${name}: insufficient authorization for the target package. ` +
            `Verify your S_DEVELOP authorization and that the package allows this object type.`,
      403,
      objectUrl,
      body,
    );
  }

  if (typeId === 'ExceptionResourceNoAccess' || typeId === 'ExceptionResourceLockedByAnotherUser') {
    const releaseHint = cloud
      ? 'Close the object in any open editor (e.g. Eclipse ADT) and retry.'
      : 'Close the editor (Eclipse, SE80) or release the lock in SM12, then retry.';
    return new AdtApiError(`Object ${name} is locked by another session. ${releaseHint}`, 409, objectUrl, body);
  }

  // Layer 2: HTML body marker, scoped by release
  //
  // Case-insensitive HTML detection: real SAP ICM error pages use a mix of casings
  // — lowercase `<html>` (NPL 7.50, verified live), uppercase `<HTML>` (some
  // releases / language packs), and `<!DOCTYPE HTML PUBLIC ...>` (W3C-style
  // doctype). Picking ONE casing (codex review of PR #202 pre-fix used
  // lowercase-only) regresses #196's behavior on releases that emit any of the
  // other two. The "Logon Error Message" marker is itself emitted as written
  // (no localization on that string), so it can stay case-sensitive.
  const release = parseReleaseNum(opts.abapRelease);
  const fallbackEligible = release === 0 || release < 751;
  const looksLikeHtml = /<!doctype\s+html|<html[\s>]/i.test(body);
  const isHtml4xx =
    (err.statusCode === 400 || err.statusCode === 401 || err.statusCode === 403) &&
    looksLikeHtml &&
    body.includes('Logon Error Message');
  if (fallbackEligible && isHtml4xx) {
    return new AdtApiError(
      `Operation conflicted on ${name} — object may be locked by another session or already exist. ` +
        `Run SAPSearch to verify the object exists, then either update the existing object or wait for the lock to release (SM12).`,
      409,
      objectUrl,
      body,
    );
  }

  return undefined;
}

function parseReleaseNum(abapRelease?: string): number {
  if (!abapRelease) return 0;
  const num = Number.parseInt(abapRelease.replace(/\D/g, ''), 10);
  return Number.isFinite(num) ? num : 0;
}

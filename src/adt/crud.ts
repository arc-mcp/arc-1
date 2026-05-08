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

import { AdtApiError, extractExceptionType } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
/** Lock result from SAP */
export interface LockResult {
  lockHandle: string;
  corrNr: string;
  isLocal: boolean;
}

/** Lock an ABAP object for editing */
export async function lockObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  accessMode = 'MODIFY',
  abapRelease?: string,
): Promise<LockResult> {
  if (accessMode === 'MODIFY') {
    checkOperation(safety, OperationType.Lock, 'LockObject');
  }

  let resp: Awaited<ReturnType<AdtHttpClient['post']>>;
  try {
    resp = await http.post(`${objectUrl}?_action=LOCK&accessMode=${accessMode}`, undefined, undefined, {
      // Dual Accept: vendor-specific type for structured lock result parsing,
      // plus wildcard fallback for SAP versions that don't support the vendor type.
      Accept: 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result, application/*;q=0.8',
    });
  } catch (err) {
    const conv = convertHtmlConflictToProperError(err, objectUrl, abapRelease);
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

  return { lockHandle, corrNr, isLocal };
}

/** Unlock an ABAP object */
export async function unlockObject(http: AdtHttpClient, objectUrl: string, lockHandle: string): Promise<void> {
  await http.post(`${objectUrl}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`);
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
    const resp = await http.post(url, body, contentType);
    return resp.body;
  } catch (err) {
    // Reclassify lock/exists conflicts that arrive as HTML or via structured
    // exception type — same precedence as the lockObject path.
    const conv = convertHtmlConflictToProperError(err, objectUrl, abapRelease);
    if (conv) throw conv;
    const fallback = CONTENT_TYPE_FALLBACKS[contentType];
    if (fallback && isUnsupportedMediaTypeError(err)) {
      const resp = await http.post(url, body, fallback);
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
 * lock → updateSource → unlock (in try-finally)
 */
export async function safeUpdateSource(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  sourceUrl: string,
  source: string,
  transport?: string,
  abapRelease?: string,
): Promise<void> {
  await http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, safety, objectUrl, 'MODIFY', abapRelease);
    const effectiveTransport = transport ?? (lock.corrNr || undefined);
    try {
      await updateSource(session, safety, sourceUrl, source, lock.lockHandle, effectiveTransport);
    } finally {
      await unlockObject(session, objectUrl, lock.lockHandle);
    }
  });
}

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
  abapRelease?: string,
): AdtApiError | undefined {
  if (!(err instanceof AdtApiError)) return undefined;
  const body = err.responseBody ?? '';
  const name = objectUrl.split('/').pop() ?? objectUrl;

  // Layer 1: structured exception type
  const typeId = extractExceptionType(body);
  if (typeId === 'ExceptionResourceNoAccess' || typeId === 'ExceptionResourceLockedByAnotherUser') {
    return new AdtApiError(
      `Object ${name} is locked by another session. Close the editor (Eclipse, SE80) or release the lock in SM12, then retry.`,
      409,
      objectUrl,
      body,
    );
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
  const release = parseReleaseNum(abapRelease);
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

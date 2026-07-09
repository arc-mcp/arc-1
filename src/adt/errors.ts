/**
 * Error types for ADT API interactions.
 *
 * SAP ADT returns errors in multiple formats:
 * - HTTP status codes (401, 403, 404, 500)
 * - XML exception bodies (with structured error messages)
 * - HTML error pages (generic SAP web dispatcher errors)
 * - Plain text (rare, usually session-related)
 *
 * We normalize all of these into typed error classes so handlers
 * can make decisions without parsing strings.
 *
 * Learned from fr0ster: their extractAdtErrorMessage() parses the XML
 * exception body to get the actual SAP error message. We do the same
 * in AdtApiError.fromResponse().
 */

import { parseReleaseNumber, STATEFUL_SESSION_MIN_RELEASE } from './release.js';

/** Base error for all ADT-related errors */
export class AdtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdtError';
  }
}

export interface DdicDiagnostic {
  messageId?: string;
  messageNumber?: string;
  variables: string[];
  lineNumber?: number;
  text: string;
}

export interface SapErrorClassification {
  category:
    | 'lock-conflict'
    | 'enqueue-error'
    | 'authorization'
    | 'activation-dependency'
    | 'transport-issue'
    | 'object-exists'
    | 'method-not-supported'
    | 'icf-handler-not-bound'
    | 'icf-service-inactive'
    | 'bdef-base-not-extensible'
    | 'include-not-initialized'
    | 'data-view-not-authorized'
    | 'package-create-invalid';
  hint: string;
  transaction?: string;
  details?: Record<string, string>;
}

export interface GctsErrorClassification {
  exception?: string;
  logMessage?: string;
}

export interface AbapGitErrorClassification {
  namespace?: string;
  message?: string;
  t100Key?: string;
}

/** HTTP-level API error from SAP ADT */
export class AdtApiError extends AdtError {
  /**
   * Optional remediation hint attached by a handler when it has context the
   * generic error formatter lacks (e.g., the list of blocking dependents
   * fetched via `/usageReferences` after a `[?/039]` delete failure).
   * Appended at the very end of the LLM-facing error message so it reads as
   * "what happened → diagnostics → how to fix".
   */
  extraHint?: string;

  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly path: string,
    public readonly responseBody?: string,
  ) {
    // Extract a human-readable message, stripping raw XML/HTML.
    // Try the truncated message first; if that only yields a generic title (e.g., "Application Server Error"),
    // retry with the full responseBody which may contain deeper error details (e.g., <span id="msgText">).
    let clean = AdtApiError.extractCleanMessage(message);
    if (responseBody && responseBody.length > message.length && /^Application Server Error/.test(clean)) {
      const deepClean = AdtApiError.extractCleanMessage(responseBody);
      if (deepClean !== clean) clean = deepClean;
    }
    super(`ADT API error: status ${statusCode} at ${path}: ${clean}`);
    this.name = 'AdtApiError';
  }

  /**
   * Extract a human-readable error message from SAP's XML/HTML error responses.
   *
   * SAP ADT returns errors as XML like:
   *   <exc:exception ...><exc:localizedMessage lang="EN">...</exc:localizedMessage></exc:exception>
   * or HTML error pages. We extract the meaningful text and discard the markup.
   */
  static extractCleanMessage(raw: string): string {
    if (!raw || raw.length === 0) return 'Unknown error';

    // 1. Try XML: extract <localizedMessage> or <message> content
    const xmlMessage = findFirstElementText(raw, ['localizedMessage', 'message']);
    if (xmlMessage) {
      return xmlMessage;
    }

    // 2. Try HTML: extract SAP's error detail from <span id="msgText"> or <p class="detailText">
    //    SAP 500 pages embed the actual error (e.g., "Syntax error in program ...") in these elements.
    const detail =
      findFirstElementText(raw, ['span'], { id: 'msgText' }) ??
      findFirstElementText(raw, ['p'], { class: 'detailText' });
    if (detail) {
      // Also grab the title for context (e.g., "Application Server Error")
      const title = findFirstElementText(raw, ['title']);
      return title && title !== detail ? `${title}: ${detail}` : detail;
    }

    // 3. Try HTML: extract <title> or <h1> content
    const htmlMessage = findFirstElementText(raw, ['title', 'h1']);
    if (htmlMessage) {
      return htmlMessage;
    }

    // 4. If no XML/HTML tags at all, it's plain text — use as-is (truncated)
    if (!raw.includes('<')) {
      return raw.slice(0, 300);
    }

    // 5. Fallback: strip all tags and use whatever text remains
    const stripped = stripTagsAndCollapseWhitespace(raw);
    return stripped.length > 0 ? stripped.slice(0, 300) : 'SAP returned an error (no readable message)';
  }

  get isNotFound(): boolean {
    return this.statusCode === 404;
  }

  get isUnauthorized(): boolean {
    return this.statusCode === 401;
  }

  get isForbidden(): boolean {
    return this.statusCode === 403;
  }

  /**
   * SAP returns 400 with specific messages when the HTTP session expires.
   * This is different from 401 (auth failure) — it means the stateful
   * session cookie is no longer valid.
   */
  get isSessionExpired(): boolean {
    if (this.statusCode !== 400) return false;
    const msg = (this.responseBody ?? '').toLowerCase();
    return (
      msg.includes('icmenosession') || msg.includes('session timed out') || msg.includes('session no longer exists')
    );
  }

  get isServerError(): boolean {
    return this.statusCode >= 500;
  }

  /**
   * Extract ALL localized messages from SAP's XML error response.
   * SAP DDL save errors often return multiple messages with line/column detail.
   * Returns only messages beyond the first (which is already in err.message).
   */
  static extractAllMessages(xml: string): string[] {
    if (!xml) return [];
    const matches = findElementTexts(xml, ['localizedMessage']);
    const messages: string[] = [];
    let first = true;
    for (const text of matches) {
      if (first) {
        first = false;
        continue; // Skip the first — it's already in extractCleanMessage
      }
      if (text) messages.push(text);
    }
    return messages;
  }

  /**
   * Extract key-value properties from SAP's XML error response.
   * Properties often contain line numbers, message IDs, and other diagnostic detail.
   */
  static extractProperties(xml: string): Record<string, string> {
    if (!xml) return {};
    const props: Record<string, string> = {};
    for (const entry of findElements(xml, ['entry'])) {
      const key = entry.attributes.key?.trim();
      const value = entry.text.trim();
      if (key && value) props[key] = value;
    }
    return props;
  }

  /**
   * Extract structured DDIC diagnostics from SAP XML error responses.
   *
   * DDIC save failures often include T100KEY entries (MSGID, MSGNO, V1-V4)
   * and line/column information in <entry> property nodes.
   */
  static extractDdicDiagnostics(xml: string): DdicDiagnostic[] {
    if (!xml) return [];

    const props = AdtApiError.extractProperties(xml);
    const localizedMessages = findElementTexts(xml, ['localizedMessage']);

    const messageId = props['T100KEY-MSGID'];
    const messageNumber = props['T100KEY-MSGNO'] ?? props['T100KEY-NO'];
    const variables = [props['T100KEY-V1'], props['T100KEY-V2'], props['T100KEY-V3'], props['T100KEY-V4']].filter(
      (value): value is string => Boolean(value),
    );
    const lineNumber = parseOptionalInt(props.LINE ?? props['T100KEY-LINE']);
    const hasDdicProperties = Object.keys(props).some(
      (key) => key.startsWith('T100KEY-') || key === 'LINE' || key === 'COLUMN',
    );

    // Avoid false positives for generic API errors.
    if (!hasDdicProperties && localizedMessages.length <= 1) {
      return [];
    }

    const diagnostics: DdicDiagnostic[] = [];
    const seen = new Set<string>();

    const addDiagnostic = (diag: DdicDiagnostic): void => {
      const key = `${diag.messageId ?? ''}|${diag.messageNumber ?? ''}|${diag.lineNumber ?? ''}|${diag.text}`;
      if (seen.has(key)) return;
      seen.add(key);
      diagnostics.push(diag);
    };

    if (hasDdicProperties) {
      addDiagnostic({
        messageId,
        messageNumber,
        variables,
        lineNumber,
        text: localizedMessages[0] ?? 'DDIC save failed due to source errors.',
      });
    }

    for (const text of localizedMessages) {
      const inlineLine = extractInlineLineNumber(text);
      addDiagnostic({
        messageId,
        messageNumber,
        variables,
        lineNumber: inlineLine ?? lineNumber,
        text,
      });
    }

    return diagnostics;
  }

  /**
   * Format DDIC diagnostics in a compact, LLM-friendly multi-line block.
   * Returns empty string when no DDIC diagnostics are present.
   */
  static formatDdicDiagnostics(xml: string): string {
    const diagnostics = AdtApiError.extractDdicDiagnostics(xml);
    if (diagnostics.length === 0) return '';

    const lines = diagnostics.map((diag) => {
      const idPart =
        diag.messageId || diag.messageNumber ? `[${diag.messageId ?? '?'}/${diag.messageNumber ?? '?'}] ` : '';
      const varsPart =
        diag.variables.length > 0
          ? `${diag.variables.map((value, index) => `V${index + 1}=${value}`).join(', ')}: `
          : '';
      const linePart = diag.lineNumber ? `Line ${diag.lineNumber}: ` : '';
      return `  - ${idPart}${linePart}${varsPart}${diag.text}`;
    });

    return `DDIC diagnostics:\n${lines.join('\n')}`;
  }
}

interface DirectTextElement {
  name: string;
  attributes: Record<string, string>;
  text: string;
}

function findFirstElementText(
  input: string,
  names: string[],
  requiredAttributes: Record<string, string> = {},
): string | undefined {
  for (const name of names) {
    const text = findElements(input, [name], requiredAttributes)[0]?.text;
    if (text) return text;
  }
  return undefined;
}

function findElementTexts(input: string, names: string[]): string[] {
  return findElements(input, names).map((element) => element.text);
}

function findElements(
  input: string,
  names: string[],
  requiredAttributes: Record<string, string> = {},
): DirectTextElement[] {
  const out: DirectTextElement[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const lt = input.indexOf('<', cursor);
    if (lt < 0) break;

    const gt = findTagEnd(input, lt + 1);
    if (gt < 0) break;

    const startTag = parseStartTag(input, lt, gt);
    cursor = gt + 1;
    if (!startTag || startTag.selfClosing || !names.includes(startTag.name)) continue;
    if (!attributesMatch(startTag.attributes, requiredAttributes)) continue;

    const nextTag = input.indexOf('<', cursor);
    if (nextTag < 0 || input[nextTag + 1] !== '/') continue;

    const text = input.slice(cursor, nextTag).trim();
    if (text) out.push({ name: startTag.name, attributes: startTag.attributes, text });
  }

  return out;
}

function findTagEnd(input: string, start: number): number {
  let quote: string | undefined;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

function parseStartTag(
  input: string,
  lt: number,
  gt: number,
): { name: string; attributes: Record<string, string>; selfClosing: boolean } | undefined {
  let pos = lt + 1;
  while (pos < gt && isWhitespace(input.charCodeAt(pos))) pos++;

  const first = input[pos];
  if (!first || first === '/' || first === '!' || first === '?') return undefined;

  const nameStart = pos;
  while (pos < gt && !isWhitespace(input.charCodeAt(pos)) && input[pos] !== '/') pos++;

  const rawName = input.slice(nameStart, pos);
  if (!rawName) return undefined;

  return {
    name: localName(rawName),
    attributes: parseAttributes(input, pos, gt),
    selfClosing: isSelfClosingTag(input, lt, gt),
  };
}

function parseAttributes(input: string, start: number, end: number): Record<string, string> {
  const attributes: Record<string, string> = {};
  let pos = start;

  while (pos < end) {
    while (pos < end && isWhitespace(input.charCodeAt(pos))) pos++;
    if (pos >= end || input[pos] === '/') break;

    const nameStart = pos;
    while (
      pos < end &&
      !isWhitespace(input.charCodeAt(pos)) &&
      input[pos] !== '=' &&
      input[pos] !== '/' &&
      input[pos] !== '>'
    ) {
      pos++;
    }

    const attrName = localName(input.slice(nameStart, pos)).toLowerCase();
    while (pos < end && isWhitespace(input.charCodeAt(pos))) pos++;

    let attrValue = '';
    if (input[pos] === '=') {
      pos++;
      while (pos < end && isWhitespace(input.charCodeAt(pos))) pos++;
      const quote = input[pos];
      if (quote === '"' || quote === "'") {
        const valueStart = ++pos;
        while (pos < end && input[pos] !== quote) pos++;
        attrValue = input.slice(valueStart, pos);
        if (input[pos] === quote) pos++;
      } else {
        const valueStart = pos;
        while (pos < end && !isWhitespace(input.charCodeAt(pos)) && input[pos] !== '/') pos++;
        attrValue = input.slice(valueStart, pos);
      }
    }

    if (attrName) attributes[attrName] = attrValue;
  }

  return attributes;
}

function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function isSelfClosingTag(input: string, lt: number, gt: number): boolean {
  let pos = gt - 1;
  while (pos > lt && isWhitespace(input.charCodeAt(pos))) pos--;
  return input[pos] === '/';
}

function attributesMatch(attributes: Record<string, string>, required: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(required)) {
    if (attributes[key.toLowerCase()] !== value) return false;
  }
  return true;
}

function stripTagsAndCollapseWhitespace(input: string): string {
  let out = '';
  let inTag = false;
  let previousWasSpace = true;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inTag) {
      if (ch === '>') inTag = false;
      continue;
    }

    if (ch === '<') {
      inTag = true;
      if (!previousWasSpace) {
        out += ' ';
        previousWasSpace = true;
      }
      continue;
    }

    if (isWhitespace(input.charCodeAt(i))) {
      if (!previousWasSpace) {
        out += ' ';
        previousWasSpace = true;
      }
      continue;
    }

    out += ch;
    previousWasSpace = false;
  }

  return previousWasSpace ? out.trimEnd() : out;
}

function isWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
}

/** Extract SAP ADT exception type id from XML response bodies. */
export function extractExceptionType(xml: string): string | undefined {
  if (!xml?.includes('<')) return undefined;
  const match = xml.match(/<(?:\w+:)?type\s+id="([^"]+)"\s*\/>|<(?:\w+:)?type\s+id="([^"]+)">/i);
  return match?.[1] ?? match?.[2];
}

/** Reject regex captures that hit a generic placeholder ("another", "the", etc.) instead of a real userid. */
const PLACEHOLDER_USERS = /^(another|the|user|session|someone|somebody)$/i;

/** Extract lock owner details (user + transport/task) from SAP lock messages.
 *
 *  Prefers the structured `<entry key="T100KEY-V1">…</entry>` property bag (SAP `MSGV1` slot,
 *  populated by message `EU 510` on lock-conflict 403s). Falls back to free-text regex when
 *  the property bag isn't present (e.g. NW 7.50 plain-text bodies). The placeholder filter
 *  guards against false positives like "currently being edited by another user". */
export function extractLockOwner(text: string): { user?: string; transport?: string } | undefined {
  if (!text) return undefined;

  // 1. Structured T100 property bag (S/4 / modern releases via <exc:exception>):
  //    <entry key="T100KEY-V1">MARIAN</entry>      → MSGV1 = lock owner
  //    <entry key="T100KEY-V3">A4HK900502</entry>  → MSGV3 = transport (when present)
  const v1Match = text.match(/<entry\s+key="T100KEY-V1">([^<]+)<\/entry>/i);
  const v3Match = text.match(/<entry\s+key="T100KEY-V3">([^<]+)<\/entry>/i);
  let user = v1Match?.[1]?.trim();
  let transport = v3Match?.[1]?.trim();

  // 2. Regex fallback (NW 7.50, plain-text messages, T100 properties absent).
  //    Order: most specific phrasing first so generic LONGTEXT phrasing never
  //    wins over the structured `<message>` line.
  if (!user) {
    const userMatch =
      text.match(/\buser\s+["']?([A-Z0-9_.$/-]+)["']?\s+is\s+currently\s+editing\b/i) ??
      text.match(/\blocked by(?:\s+user)?\s+["']?([A-Z0-9_.$/-]+)["']?/i) ??
      text.match(/\bbeing edited by(?:\s+user)?\s+["']?([A-Z0-9_.$/-]+)["']?/i);
    const candidate = userMatch?.[1]?.replace(/[.,;:)]$/, '');
    if (candidate && !PLACEHOLDER_USERS.test(candidate)) user = candidate;
  }

  if (!transport) {
    const transportMatch =
      text.match(/\b(?:in\s+)?(?:task|transport|request)\s+([A-Z0-9]{3,}\d{4,})\b/i) ??
      text.match(/\b([A-Z]\d{2}[A-Z]\d{6})\b/i);
    transport = transportMatch?.[1]?.replace(/[.,;:)]$/, '');
  }

  if (!user && !transport) return undefined;

  return {
    ...(user ? { user } : {}),
    ...(transport ? { transport } : {}),
  };
}

/** Name the SICF node from a request path for an activation hint (drops the query string). */
function sicfNodeFromPath(path?: string): string {
  if (!path) return 'the requested ICF service';
  return `\`${path.split('?')[0]}\``;
}

/** Classify SAP ADT errors into actionable domain categories with remediation hints. */
export function classifySapDomainError(
  statusCode: number,
  responseBody?: string,
  path?: string,
  abapRelease?: string,
): SapErrorClassification | undefined {
  const bodyRaw = responseBody ?? '';
  const bodyLower = bodyRaw.toLowerCase();
  const typeId = extractExceptionType(bodyRaw);

  // Un-initialised class-local include (issue #303 follow-up). A content PUT to a
  // class include that doesn't exist yet (notably testclasses/CCAU on a fresh class)
  // fails with HTTP 500 ExceptionResourceSaveFailure + "…CCAU does not have any
  // inactive version". Checked BEFORE the activation-dependency branch below, which
  // also matches /inactive/. ARC-1's update include= path now auto-creates the
  // include before writing, so this hint covers only paths that bypass auto-init
  // (e.g. a direct source PUT to an un-initialised include).
  if (/does not have any inactive version/i.test(bodyRaw)) {
    return {
      category: 'include-not-initialized',
      hint: 'This class-local include is not initialised yet (a fresh class has no testclasses/CCAU include until first write). Write to it via SAPWrite(action="update", type="CLAS", include="testclasses", source=…) — ARC-1 auto-creates the include before writing.',
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  // BTP / ABAP-Cloud data preview + freestyle SQL of SAP standard tables: HTTP 400
  // ExceptionDataPreviewGeneral "No authorization to view data" (ADT_DATAPREVIEW_MSG/023; the
  // LONGTEXT cites auth object S_ABPLNGVS — the ABAP language-version gate, not a missing data-read
  // role). Distinct code path from a package/object 403 (ExceptionResourceNoAccess). Live-verified 919.
  if (typeId === 'ExceptionDataPreviewGeneral' && /no authorization to view data/i.test(bodyRaw)) {
    return {
      category: 'data-view-not-authorized',
      hint:
        'On the ABAP Environment (ABAP Cloud), previewing SAP standard-table contents and running ' +
        'freestyle SQL against standard tables is blocked by the cloud data-access model (authorization ' +
        'object S_ABPLNGVS) — not a role you can grant. Query a released CDS view instead (SAPQuery ' +
        'against a C1-released view), or read/preview a custom Z* table you own.',
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  // BTP package create: the IAS email as responsible fails the package deserialize ST (SPAK_ST_PACKAGES);
  // it must be a valid internal ABAP user (XUBNAME). Live-verified 919.
  if (typeId === 'ExceptionInvalidData' && /SPAK_ST_PACKAGES/.test(bodyRaw)) {
    return {
      category: 'package-create-invalid',
      hint:
        'Package create rejected: on the ABAP Environment the person-responsible must be a valid ' +
        'internal ABAP user (XUBNAME, e.g. CB9980000000), not an IAS email. Omit `responsible` to ' +
        'auto-resolve it, or pass the internal user.',
      details: { exceptionType: typeId },
    };
  }

  // BTP package create: a root package (no structure superPackage) → HTTP 400
  // ExceptionResourceCreationFailure "... is not a valid software component" (TR/458). Live-verified 919.
  if (typeId === 'ExceptionResourceCreationFailure' && /is not a valid software component/i.test(bodyRaw)) {
    return {
      category: 'package-create-invalid',
      hint:
        'On the ABAP Environment a new package must nest under a structure package. Pass `superPackage` ' +
        '(e.g. "ZLOCAL") so the package is created inside it, rather than as a root package.',
      details: { exceptionType: typeId },
    };
  }

  const lockPattern =
    /\blocked by\b|\bbeing edited by\b|\bcurrently editing\b|\bresource is locked\b|\balready locked\b/i.test(bodyRaw);

  // A create-time package/authorization denial surfaces as ExceptionResourceNoAccess too (a structure
  // package, a non-writable package, missing authorization), but it is NOT a lock — never send the user
  // to SM12 (which doesn't even exist on BTP). crud.ts already produced the actionable 403 message; this
  // keeps the classifier consistent so no contradictory lock hint is appended. A bare/409
  // ExceptionResourceNoAccess (no package markers) still classifies as a lock below — ADR-0002.
  if (
    typeId === 'ExceptionResourceNoAccess' &&
    !lockPattern &&
    /structure package|cannot contain development objects|\bnot authorized\b|person responsible|S_DEVELOP|S_ABPLNGVS/i.test(
      bodyRaw,
    )
  ) {
    return {
      category: 'authorization',
      hint:
        'This is a package or authorization denial on create — not a lock, so SM12 does not apply. ' +
        'Target a writable, regular (non-structure) package you are authorized to develop in.',
      details: { exceptionType: typeId },
    };
  }

  if (
    typeId === 'ExceptionResourceLockedByAnotherUser' ||
    typeId === 'ExceptionResourceNoAccess' ||
    ((statusCode === 409 || statusCode === 403) && lockPattern)
  ) {
    const owner = extractLockOwner(bodyRaw);
    const lockHintParts: string[] = ['Object is locked'];
    if (owner?.user && owner?.transport) {
      lockHintParts.push(`by user ${owner.user} in transport ${owner.transport}`);
    } else if (owner?.user) {
      lockHintParts.push(`by user ${owner.user}`);
    } else if (owner?.transport) {
      lockHintParts.push(`in transport ${owner.transport}`);
    } else {
      lockHintParts.push('by another user/session');
    }

    return {
      category: 'lock-conflict',
      hint: `${lockHintParts.join(' ')}. Check SM12 in SAP GUI for lock entries, or wait for the lock to be released.`,
      transaction: 'SM12',
      details: {
        ...(typeId ? { exceptionType: typeId } : {}),
        ...(owner?.user ? { user: owner.user } : {}),
        ...(owner?.transport ? { transport: owner.transport } : {}),
      },
    };
  }

  if (typeId === 'ExceptionResourceInvalidLockHandle' || statusCode === 423) {
    // The 423 "invalid lock handle" on ADT writes has a release-specific root cause:
    // on SAP_BASIS < 7.51 the ADT REST handler (CL_REST_HTTP_HANDLER) does not honor
    // the `X-sap-adt-sessiontype: stateful` header, so the LOCK is released before the
    // PUT and the handle is rejected. The fix is the abapfs_extensions enhancement
    // (back-ports the 7.51 CONFIGURE_SESSION_STATE behavior). SAP Note 2727890 is a
    // SEPARATE, narrow bug (lock handles containing '+') — not this issue. See #293.
    const releaseNum = parseReleaseNumber(abapRelease);
    const abapfsFix =
      'install the abapfs_extensions enhancement on the SAP system ' +
      '(https://github.com/marcellourbani/abapfs_extensions) via abapGit — it back-ports the ' +
      '7.51 stateful-session handling to CL_REST_HTTP_HANDLER. SAP Note 2727890 is a separate, ' +
      "narrow bug (lock handles containing '+') and is NOT this issue.";

    let hint: string;
    if (releaseNum !== undefined && releaseNum < STATEFUL_SESSION_MIN_RELEASE) {
      hint =
        `Your SAP_BASIS (${abapRelease}) does not honor stateful ADT HTTP sessions, so the lock ` +
        `is released before the write completes. To fix: ${abapfsFix}`;
    } else if (releaseNum !== undefined) {
      // 7.51+ honors stateful sessions natively — a 423 here is more likely a transient
      // expiry or a genuine concurrent lock, not the pre-7.51 backend gap.
      hint =
        'Lock handle is invalid or expired. Retry first — transient expiry is the common case. ' +
        'If it persists, check SM12 for stale lock entries and ensure no other editor (Eclipse, ' +
        'SE80) holds the object.';
    } else {
      // Release unknown (detection unavailable): give the actionable < 7.51 guidance too,
      // so the hint is useful even when we could not detect the backend release.
      hint =
        'Lock handle is invalid or expired. Retry first — transient expiry is the common case. ' +
        `If 423 persists on the first PUT after a successful LOCK and your SAP_BASIS is below 7.51, ${abapfsFix}`;
    }

    return {
      category: 'enqueue-error',
      hint,
      transaction: releaseNum !== undefined && releaseNum >= STATEFUL_SESSION_MIN_RELEASE ? 'SM12' : undefined,
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  // Some ADT endpoints return `HTTP 404 "No suitable resource found"` for every
  // verb while still appearing in `/discovery` — this is the ADT framework's
  // way of saying the resource URI didn't match any registered handler inside
  // the ADT framework (or the ICF service is active but its handler class is
  // not bound). Distinct from a regular "does not exist" 404 on a missing
  // object. See `icf-handler-not-bound`.
  if (statusCode === 404 && /No suitable resource found/i.test(bodyRaw)) {
    return {
      category: 'icf-handler-not-bound',
      hint:
        'The ADT framework returned "No suitable resource found" — this endpoint is listed in ' +
        '`/sap/bc/adt/discovery` but no handler matches the URI. In tcode `SICF`, navigate to the ' +
        'service node under `/default_host/sap/bc/adt/...` and verify (a) the service is activated ' +
        'and (b) its "Handler List" tab references the correct ADT handler class. If the service ' +
        'looks active, the ADT framework itself may be missing the internal resource registration ' +
        '(often caused by incomplete activation after an upgrade or on minimally-configured ' +
        'systems). Consult your Basis admin or SAP KBA 3128830 (Troubleshooting ICF 404 Errors).',
      transaction: 'SICF',
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  // An un-activated SICF node (non-ADT — e.g. an OData service or /sap/bc/stmc) returns SAP's
  // generic ICF page: HTTP 403/404, text/html, "<title>Service cannot be reached</title>". This is
  // NOT an ADT object-not-found (XML ExceptionResourceNotFound) — turn it into an activation hint.
  // Reused by the ST05/TMC SQL-trace perf features (their endpoints live under inactive-by-default nodes).
  if ((statusCode === 403 || statusCode === 404) && !typeId && looksLikeIcfServiceInactivePage(bodyRaw)) {
    return {
      category: 'icf-service-inactive',
      hint:
        `The ICF service node ${sicfNodeFromPath(path)} is not activated (SAP returned its "Service cannot be ` +
        'reached" page). Activate it in tcode SICF (locate the node under /default_host/…, right-click → ' +
        "Activate Service). For ARC-1's ST05/TMC SQL-trace features, activate /sap/bc/stmc and its sub-nodes (data, ui5).",
      transaction: 'SICF',
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  const authPattern = /\bauthorization\b|not authorized|s_develop|s_adt_res|s_transprt/i.test(bodyRaw);
  if (typeId === 'ExceptionNotAuthorized' || (statusCode === 403 && authPattern)) {
    const endpointHint = describeAuthEndpoint(path);
    return {
      category: 'authorization',
      hint: endpointHint
        ? `${endpointHint} Run transaction SU53 in SAP GUI immediately after the failed call to see the exact missing authorization object.`
        : 'The SAP user lacks required authorization. Run transaction SU53 in SAP GUI to inspect the last failed authorization check. Common objects: S_DEVELOP (development), S_ADT_RES (ADT resources), S_TRANSPRT (transports). Contact your basis admin or review PFCG role assignments.',
      transaction: 'SU53',
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  if (
    statusCode === 400 &&
    /\bbehavior\s+definition\b/i.test(bodyRaw) &&
    /\bnot\s+marked\s+as\s+extensible\b/i.test(bodyRaw)
  ) {
    return {
      category: 'bdef-base-not-extensible',
      hint:
        'The base behavior definition is not extensible, so SAP refused the behavior extension create. ' +
        'Update and activate the base BDEF with strict(2), an `extensible` header, an `extensible` entity declaration, ' +
        'and `mapping ... corresponding extensible`; then retry the extension create.',
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  const objectExistsPattern = bodyLower.includes('already exists') || bodyLower.includes('does already exist');
  const resourceExistsPattern =
    /\bresource\b[^.\n]*\bdoes?\s+already\s+exist\b/i.test(bodyRaw) ||
    /\bresource\b[^.\n]*\balready exists\b/i.test(bodyRaw);
  if ((typeId === 'ExceptionResourceCreationFailure' || resourceExistsPattern) && objectExistsPattern) {
    return {
      category: 'object-exists',
      hint: 'An object with this name already exists. Recovery path: rerun the same payload with SAPWrite(action="update") to overwrite source/content, instead of retrying create.',
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  if (
    /activat(e|ion)/i.test(bodyRaw) &&
    (/\bdependency\b/i.test(bodyRaw) || /\binactive\b/i.test(bodyRaw) || /\bnot active\b/i.test(bodyRaw))
  ) {
    return {
      category: 'activation-dependency',
      hint: "Activation failed due to inactive dependencies. Use SAPRead(type='INACTIVE_OBJECTS') to list inactive objects, then activate dependencies first with SAPActivate.",
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  if (/\badjustment\b|\bupgrade mode\b|\bspau(?:_enh)?\b/i.test(bodyRaw)) {
    return {
      category: 'transport-issue',
      hint: 'SAP is in adjustment/upgrade mode. Development changes may be blocked until upgrade activities are complete. Check SPAU/SPAU_ENH in SAP GUI.',
      transaction: 'SPAU',
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  if (typeId === 'ExceptionMethodNotSupported' || statusCode === 405) {
    return {
      category: 'method-not-supported',
      hint: 'The ADT endpoint rejected this HTTP method. Verify the operation is supported on this SAP release and retry with the correct tool action.',
      details: typeId ? { exceptionType: typeId } : undefined,
    };
  }

  return undefined;
}

function looksLikeIcfServiceInactivePage(body: string): boolean {
  return /<(?:title|h1)[^>]*>\s*Service cannot be reached\s*<\/(?:title|h1)>/i.test(body);
}

/**
 * Build an endpoint-specific 403 hint for diagnostics endpoints. The dump
 * list and dump detail sit on different SAP authorization objects, so a
 * user can have access to one but not the other; the generic
 * "Authorization error" message hides which auth object is missing.
 * Naming the typical S_ADMI_FCD / S_ADT_RES values for each path lets the
 * LLM tell the user which role to request — and which transaction (ST22,
 * /IWFND/ERROR_LOG) it maps to — without speculating beyond what the tool
 * just tried to read.
 *
 * Returns `undefined` for paths that aren't recognized so the generic
 * authorization hint kicks in for everything else.
 */
function describeAuthEndpoint(path?: string): string | undefined {
  if (!path) return undefined;

  // Dump detail: /sap/bc/adt/runtime/dump/{id}[/formatted]
  if (/\/sap\/bc\/adt\/runtime\/dump\/[^/?#]+/.test(path)) {
    return (
      'Reading the short-dump detail was forbidden, even if listing dumps works. ' +
      'The forbidden resource is `/sap/bc/adt/runtime/dump/{id}` (transaction ST22). ' +
      'Typical authorization objects to check: `S_ADMI_FCD` with value `ST22` ' +
      '(ABAP runtime error analysis) and `S_ADT_RES` (ACTVT 03) on the ' +
      '`/sap/bc/adt/runtime/dump/*` resource path.'
    );
  }

  // Dump list: /sap/bc/adt/runtime/dumps
  if (/\/sap\/bc\/adt\/runtime\/dumps(\?|$|\/)/.test(path)) {
    return (
      'Listing short dumps was forbidden. The forbidden resource is ' +
      '`/sap/bc/adt/runtime/dumps` (transaction ST22). Typical authorization ' +
      'objects to check: `S_ADMI_FCD` with value `ST22` and `S_ADT_RES` ' +
      '(ACTVT 03) on the `/sap/bc/adt/runtime/dumps` resource path.'
    );
  }

  // Gateway error log (list or detail)
  if (/\/sap\/bc\/adt\/gw\/errorlog/.test(path)) {
    return (
      'Reading the SAP Gateway error log was forbidden. The forbidden resource is ' +
      '`/sap/bc/adt/gw/errorlog/*` (transaction `/IWFND/ERROR_LOG`). Typical ' +
      'authorization objects to check: `S_ADT_RES` (ACTVT 03) on ' +
      '`/sap/bc/adt/gw/errorlog/*`, plus the OData Gateway role that grants ' +
      'access to `/IWFND/ERROR_LOG`.'
    );
  }

  return undefined;
}

/**
 * Parse gCTS JSON error payloads.
 *
 * Known shapes:
 * - {"exception":"..."}
 * - {"log":[{"severity":"ERROR","message":"..."}]}
 */
export function classifyGctsError(body: string): GctsErrorClassification {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const exception = typeof parsed.exception === 'string' ? parsed.exception : undefined;

    const logs = Array.isArray(parsed.log) ? parsed.log : [];
    const errorLog = logs.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        String((entry as Record<string, unknown>).severity ?? '').toUpperCase() === 'ERROR',
    ) as Record<string, unknown> | undefined;
    const logMessage = typeof errorLog?.message === 'string' ? errorLog.message : undefined;

    return {
      ...(exception ? { exception } : {}),
      ...(logMessage ? { logMessage } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Parse abapGit bridge/framework XML errors from /sap/bc/adt/abapgit/*.
 */
export function classifyAbapgitError(xmlBody: string): AbapGitErrorClassification {
  if (!xmlBody) return {};

  const namespace =
    xmlBody.match(/<(?:\w+:)?namespace[^>]*\sid="([^"]+)"/i)?.[1] ??
    xmlBody.match(/<(?:\w+:)?namespace[^>]*>([^<]+)</i)?.[1];
  const message = AdtApiError.extractCleanMessage(xmlBody);
  const props = AdtApiError.extractProperties(xmlBody);
  const msgId = props['T100KEY-MSGID'];
  const msgNo = props['T100KEY-MSGNO'] ?? props['T100KEY-NO'];
  const t100Key = msgId || msgNo ? `${msgId ?? '?'}/${msgNo ?? '?'}` : undefined;

  return {
    ...(namespace ? { namespace } : {}),
    ...(message && message !== 'Unknown error' ? { message } : {}),
    ...(t100Key ? { t100Key } : {}),
  };
}

/**
 * Markers for a cross-subaccount principal-propagation trust failure, as surfaced by the BTP
 * Destination Service (`authTokens[].error`) for an `OAuth2UserTokenExchange` destination whose
 * target XSUAA lives in a DIFFERENT subaccount than the one that issued the user token.
 */
const CROSS_SUBACCOUNT_PP_MARKERS = [
  /unknown signing key/i,
  /unable to map issuer/i,
  /no identity provider found for issuer/i,
];

/**
 * Actionable hint for a principal-propagation / destination token-exchange failure.
 *
 * The raw Destination Service messages ("Token header claim [kid] references unknown signing key",
 * "Unable to map issuer: No identity provider found for issuer …") are opaque. SAP's documented rule
 * (Routing via Destination, BTP ABAP Environment): same subaccount → `OAuth2UserTokenExchange`;
 * different subaccounts → `OAuth2SAMLBearerAssertion` + trust. ARC-1 already handles the SAMLBearer
 * bearer token, so this is a destination-configuration fix, not a code change.
 *
 * Returns a one-line hint when the message matches a known cross-subaccount marker, else undefined.
 * Validated live (issue #434).
 */
export function destinationPpHint(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (!CROSS_SUBACCOUNT_PP_MARKERS.some((re) => re.test(message))) return undefined;
  return (
    'ARC-1 and the SAP system appear to be in different BTP subaccounts: the target XSUAA does not ' +
    'trust the token issuer. OAuth2UserTokenExchange only works when ARC-1 and the ABAP system are in ' +
    'the SAME subaccount; for different subaccounts use an OAuth2SAMLBearerAssertion destination with ' +
    'trust established (ARC-1 supports this with no code change). See docs_page/btp-abap-environment.md.'
  );
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractInlineLineNumber(text: string): number | undefined {
  const match = text.match(/\bline\s+(\d+)\b/i);
  return match?.[1] ? parseOptionalInt(match[1]) : undefined;
}

/** Network-level error (DNS, connection refused, timeout) */
export class AdtNetworkError extends AdtError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(`ADT network error: ${message}`);
    this.name = 'AdtNetworkError';
  }
}

/** Safety system blocked the operation */
export class AdtSafetyError extends AdtError {
  constructor(message: string) {
    super(message);
    this.name = 'AdtSafetyError';
  }
}

/** Check if an error is a specific ADT error type */
export function isNotFoundError(err: unknown): boolean {
  return err instanceof AdtApiError && err.isNotFound;
}

export function isSessionExpiredError(err: unknown): boolean {
  return err instanceof AdtApiError && err.isSessionExpired;
}

/**
 * Extract the offending column from a verified unknown-column data-preview error, else null.
 *
 * Live testing on 7.58/8.16 showed that `ADT_DATAPREVIEW_MSG` number `004` is a generic parser bucket:
 * DESC/LIMIT grammar failures and ambiguous join columns use it too. The id+number remain a required
 * structural gate, but are not sufficient to justify replacing SAP's message with an unknown-column
 * hint. We additionally accept only the live-verified EN/DE unknown-column forms. Unknown languages
 * deliberately fall back to SAP's original error rather than risk confidently wrong remediation.
 */
export function extractUnknownColumn(err: unknown): string | null {
  if (!(err instanceof AdtApiError)) return null;
  const body = err.responseBody ?? '';
  const properties = AdtApiError.extractProperties(body);
  if (properties['T100KEY-ID'] !== 'ADT_DATAPREVIEW_MSG' || !/^0*4$/.test(properties['T100KEY-NO'] ?? '')) {
    return null;
  }

  const message = properties['T100KEY-V1'] ?? '';
  const unknownColumn = message.match(/^(?:Unknown column name|Unbekannter Spaltenname)\s+"([A-Za-z0-9_/$]+)"/i);
  return unknownColumn?.[1] ?? null;
}

/** Render the self-correcting hint listing a table's actual columns. */
export function formatUnknownColumnHint(badColumn: string, tableName: string, columns: string[]): string {
  return `Unknown column "${badColumn}" on ${tableName.toUpperCase()}. Available columns: ${columns.join(', ')}.`;
}

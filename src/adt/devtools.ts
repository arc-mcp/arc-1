/**
 * Development tools for SAP ADT.
 *
 * - SyntaxCheck: compile-time validation
 * - PrettyPrint: server-side ABAP formatting
 * - Activate: publish objects to the main repository
 * - RunUnitTests: execute ABAP unit tests
 * - RunATCCheck: ABAP Test Cockpit (code quality)
 */

import { logger } from '../server/logger.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type {
  CdsTestCase,
  CdsTestCasesResult,
  CoverageSummary,
  FixAffectedObject,
  FixDelta,
  FixProposal,
  MethodCoverage,
  SyntaxCheckResult,
  SyntaxMessage,
  UnitTestResult,
  UnitTestRunResult,
} from './types.js';
import { decodeXmlEntities, escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

/** Run syntax check on an ABAP object.
 *
 *  Two modes:
 *   - URI-only (default): compile whatever is stored at the URI (active or inactive version).
 *   - Inline content: compile arbitrary source as if it lived at the URI. Lets callers
 *     validate a proposed edit BEFORE it is written. Body shape matches Eclipse ADT /
 *     vibing-steampunk (base64-encoded artifact under <chkrun:artifacts>). Verified on
 *     NetWeaver 7.50 via scripts/probe-checkrun-content.ts.
 */
export async function syntaxCheck(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  options?: { version?: 'active' | 'inactive'; content?: string },
): Promise<SyntaxCheckResult> {
  checkOperation(safety, OperationType.Read, 'SyntaxCheck');

  const version = options?.version ?? 'active';

  if (options?.content !== undefined) {
    const artifactUri = `${objectUrl}/source/main`;
    const encoded = Buffer.from(options.content, 'utf-8').toString('base64');
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">
  <chkrun:checkObject adtcore:uri="${escapeXmlAttr(objectUrl)}" chkrun:version="${version}">
    <chkrun:artifacts>
      <chkrun:artifact chkrun:contentType="text/plain; charset=utf-8" chkrun:uri="${escapeXmlAttr(artifactUri)}">
        <chkrun:content>${encoded}</chkrun:content>
      </chkrun:artifact>
    </chkrun:artifacts>
  </chkrun:checkObject>
</chkrun:checkObjectList>`;
    const resp = await http.post('/sap/bc/adt/checkruns?reporters=abapCheckRun', body, 'application/*', {
      Accept: 'application/vnd.sap.adt.checkmessages+xml',
    });
    return parseSyntaxCheckResult(resp.body);
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">
  <chkrun:checkObject adtcore:uri="${escapeXmlAttr(objectUrl)}" chkrun:version="${version}"/>
</chkrun:checkObjectList>`;

  const resp = await http.post('/sap/bc/adt/checkruns', body, 'application/vnd.sap.adt.checkobjects+xml', {
    Accept: 'application/vnd.sap.adt.checkmessages+xml',
  });

  return parseSyntaxCheckResult(resp.body);
}

export interface PrettyPrinterSettings {
  indentation: boolean;
  style: 'keywordUpper' | 'keywordLower' | 'keywordAuto' | 'none';
}

/** Format ABAP source code via ADT PrettyPrinter */
export async function prettyPrint(http: AdtHttpClient, safety: SafetyConfig, source: string): Promise<string> {
  checkOperation(safety, OperationType.Intelligence, 'PrettyPrint');

  const resp = await http.post('/sap/bc/adt/abapsource/prettyprinter', source, 'text/plain; charset=utf-8', {
    Accept: 'text/plain',
  });
  return resp.body;
}

/** Read system-wide ADT PrettyPrinter settings */
export async function getPrettyPrinterSettings(
  http: AdtHttpClient,
  safety: SafetyConfig,
): Promise<PrettyPrinterSettings> {
  checkOperation(safety, OperationType.Read, 'GetPrettyPrinterSettings');

  const resp = await http.get('/sap/bc/adt/abapsource/prettyprinter/settings', {
    Accept: 'application/vnd.sap.adt.ppsettings.v2+xml',
  });

  const parsed = parseXml(resp.body);
  const root = (parsed.PrettyPrinterSettings as Record<string, unknown> | undefined) ?? {};

  const rawIndentation = root['@_indentation'];
  const rawStyle = String(root['@_style'] ?? '');
  const validStyle: PrettyPrinterSettings['style'] =
    rawStyle === 'keywordUpper' || rawStyle === 'keywordLower' || rawStyle === 'keywordAuto' || rawStyle === 'none'
      ? rawStyle
      : 'keywordUpper';

  return {
    indentation: rawIndentation == null ? true : String(rawIndentation).toLowerCase() === 'true',
    style: validStyle,
  };
}

/** Update system-wide ADT PrettyPrinter settings */
export async function setPrettyPrinterSettings(
  http: AdtHttpClient,
  safety: SafetyConfig,
  settings: PrettyPrinterSettings,
): Promise<void> {
  checkOperation(safety, OperationType.Update, 'SetPrettyPrinterSettings');

  const body = `<?xml version="1.0" encoding="utf-8"?><abapformatter:PrettyPrinterSettings abapformatter:indentation="${settings.indentation}" abapformatter:style="${settings.style}" xmlns:abapformatter="http://www.sap.com/adt/prettyprintersettings"/>`;
  await http.put('/sap/bc/adt/abapsource/prettyprinter/settings', body, 'application/vnd.sap.adt.ppsettings.v2+xml');
}

/** Structured message from an activation response */
export interface ActivationMessage {
  severity: 'error' | 'warning' | 'info';
  text: string;
  uri?: string;
  line?: number;
}

/** Result of an activation operation */
export interface ActivationResult {
  success: boolean;
  messages: string[];
  details: ActivationMessage[];
}

/** Activate (publish) ABAP objects.
 *
 *  Implements the ADT preaudit handshake: the first POST with preauditRequested=true
 *  may return an <ioc:inactiveObjects> prompt listing related objects that must be
 *  included. When that happens, a second POST with the full list and preauditRequested=false
 *  commits the activation. */
export async function activate(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  options?: { preaudit?: boolean; name?: string },
): Promise<ActivationResult> {
  checkOperation(safety, OperationType.Activate, 'Activate');

  try {
    const preaudit = options?.preaudit !== false;
    const nameAttr = options?.name ? ` adtcore:name="${escapeXmlAttr(options.name)}"` : '';
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${escapeXmlAttr(objectUrl)}"${nameAttr}/>
</adtcore:objectReferences>`;

    const phase1Start = Date.now();
    const resp = await http.post(
      `/sap/bc/adt/activation?method=activate&preauditRequested=${preaudit}`,
      body,
      'application/*',
      { Accept: 'application/xml' },
    );
    const phase1DurationMs = Date.now() - phase1Start;

    const outcome = parseActivationOutcome(resp.body);
    if (outcome.kind !== 'preaudit' || !preaudit) {
      return outcomeToResult(outcome);
    }

    return confirmPreaudit(http, outcome.refs, options?.name ?? objectUrl, phase1DurationMs);
  } catch (err) {
    return rethrowOrLockHint(err, options?.name ?? objectUrl);
  }
}

/**
 * Activate (publish) multiple ABAP objects in a single batch call.
 *
 * The ADT activation endpoint natively supports multiple objectReference elements.
 * This is essential for RAP stacks where objects depend on each other
 * (DDLS → BDEF → SRVD → SRVB) and must be activated together.
 */
export async function activateBatch(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objects: Array<{ url: string; name: string }>,
  options?: { preaudit?: boolean },
): Promise<ActivationResult> {
  checkOperation(safety, OperationType.Activate, 'ActivateBatch');

  const preaudit = options?.preaudit !== false;
  const refs = objects
    .map(
      (o) =>
        `  <adtcore:objectReference adtcore:uri="${escapeXmlAttr(o.url)}" adtcore:name="${escapeXmlAttr(o.name)}"/>`,
    )
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
${refs}
</adtcore:objectReferences>`;

  try {
    const phase1Start = Date.now();
    const resp = await http.post(
      `/sap/bc/adt/activation?method=activate&preauditRequested=${preaudit}`,
      body,
      'application/*',
      { Accept: 'application/xml' },
    );
    const phase1DurationMs = Date.now() - phase1Start;

    const outcome = parseActivationOutcome(resp.body);
    if (outcome.kind !== 'preaudit' || !preaudit) {
      const result = outcomeToResult(outcome);
      return retryBatchActivationIndividuallyAfterEd064(http, safety, objects, result, options);
    }

    return confirmPreaudit(http, outcome.refs, objects.map((o) => o.name).join(', '), phase1DurationMs, {
      ed064RetryObjects: objects,
      preaudit: options?.preaudit,
      safety,
    });
  } catch (err) {
    return rethrowOrLockHint(err, objects.map((o) => o.name).join(', '));
  }
}

/** Second POST of the preaudit handshake: send the full object list with preauditRequested=false.
 *
 *  Emits an `activation_preaudit_completed` audit event so SIEM/audit consumers can correlate
 *  the two http_request events as one logical handshake instead of greppping for the
 *  preauditRequested=true→false pattern. */
async function confirmPreaudit(
  http: AdtHttpClient,
  refs: Array<{ uri: string; name: string }>,
  objectLabel: string,
  phase1DurationMs: number,
  options?: {
    ed064RetryObjects?: Array<{ url: string; name: string }>;
    preaudit?: boolean;
    safety: SafetyConfig;
  },
): Promise<ActivationResult> {
  logger.debug('Activation preaudit: SAP returned inactive objects, confirming with preauditRequested=false', {
    count: refs.length,
    objects: refs.map((r) => ({ name: r.name, uri: r.uri })),
  });
  const refLines = refs
    .map(
      (r) =>
        `  <adtcore:objectReference adtcore:uri="${escapeXmlAttr(r.uri)}" adtcore:name="${escapeXmlAttr(r.name)}"/>`,
    )
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
${refLines}
</adtcore:objectReferences>`;

  const phase2Start = Date.now();
  let result: ActivationResult | undefined;
  try {
    const resp = await http.post(
      '/sap/bc/adt/activation?method=activate&preauditRequested=false',
      body,
      'application/*',
      { Accept: 'application/xml' },
    );
    result = outcomeToResult(parseActivationOutcome(resp.body));
    if (options?.ed064RetryObjects) {
      result = await retryBatchActivationIndividuallyAfterEd064(
        http,
        options.safety,
        options.ed064RetryObjects,
        result,
        { preaudit: options.preaudit },
      );
    }
    return result;
  } finally {
    logger.emitAudit({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'activation_preaudit_completed',
      objectLabel,
      refCount: refs.length,
      phase1DurationMs,
      phase2DurationMs: Date.now() - phase2Start,
      outcome: result?.success ? 'success' : 'error',
    });
  }
}

function isEd064Text(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\bed0?64\b/.test(normalized) || (normalized.includes('no next') && normalized.includes('previous object'));
}

function isRecoverableEd064BatchQuirk(result: ActivationResult): boolean {
  if (result.success) return false;
  const errorTexts = result.details
    .filter((d) => d.severity === 'error')
    .map((d) => d.text)
    .filter(Boolean);

  if (errorTexts.length === 0) {
    const messages = result.messages.filter(Boolean);
    return messages.length > 0 && messages.every(isEd064Text);
  }

  return errorTexts.every(isEd064Text);
}

async function retryBatchActivationIndividuallyAfterEd064(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objects: Array<{ url: string; name: string }>,
  original: ActivationResult,
  options?: { preaudit?: boolean },
): Promise<ActivationResult> {
  if (!isRecoverableEd064BatchQuirk(original) || objects.length === 0) return original;

  logger.debug('Batch activation returned ED064 only; retrying original objects individually', {
    count: objects.length,
    objects: objects.map((o) => ({ name: o.name, uri: o.url })),
  });

  const retryResults: Array<{ object: { url: string; name: string }; result: ActivationResult }> = [];
  for (const object of objects) {
    const result = await activate(http, safety, object.url, { name: object.name, preaudit: options?.preaudit });
    retryResults.push({ object, result });
  }

  const note =
    `Batch activation returned ED064 "no next/previous object found"; ` +
    `retried ${objects.length} object${objects.length === 1 ? '' : 's'} individually.`;
  const retryMessages = retryResults.flatMap(({ object, result }) =>
    result.messages.map((message) => `${object.name}: ${message}`),
  );
  const retryDetails = retryResults.flatMap(({ object, result }) =>
    result.details.map((detail) => ({
      ...detail,
      text: `${object.name}: ${detail.text}`,
    })),
  );

  if (retryResults.every(({ result }) => result.success)) {
    return {
      success: true,
      messages: [note, ...retryMessages],
      details: [
        { severity: 'warning', text: note },
        ...original.details.map((detail) =>
          detail.severity === 'error' ? { ...detail, severity: 'warning' as const } : detail,
        ),
        ...retryDetails,
      ],
    };
  }

  return {
    success: false,
    messages: [...original.messages, note, ...retryMessages],
    details: [...original.details, { severity: 'info', text: note }, ...retryDetails],
  };
}

// NW 7.50 lock-conflict-as-auth-error quirk:
// The activation handler raises CX_ADT_RES_NO_ACCESS (→ 403) for lock conflicts.
// With cookie auth (no Basic Auth header), ICM transforms 403 → 401 "no logon data".
// ARC-1's 401 retry handler then clears cookies and retries → 400.
// So we see 400, 401, or 403 depending on timing — all with the same HTML login page.
// Other ADT endpoints work fine with the same session. Detected by matching
// "Logon Error Message" in the HTML body on the activation path.
//
// The "Logon Error Message" HTML body is the de-facto NW 7.50 gate — S/4 returns
// structured XML with <exc:exception> here (no "Logon Error Message" string), and
// S/4's auth-failure HTML is "Anmeldung fehlgeschlagen" (also no match). So this
// branch self-scopes without an explicit detectSystemCapabilities() check.
function rethrowOrLockHint(err: unknown, objectLabel: string): never | ActivationResult {
  if (
    err instanceof AdtApiError &&
    (err.statusCode === 400 || err.statusCode === 401 || err.statusCode === 403) &&
    err.responseBody?.includes('Logon Error Message')
  ) {
    logger.debug(`Activation ${err.statusCode} interpreted as lock conflict (NW 7.50 CX_ADT_RES_NO_ACCESS quirk)`, {
      object: objectLabel,
      path: err.path,
    });
    return {
      success: false,
      messages: [
        `Object ${objectLabel} is locked by another session. Close the editor (Eclipse, SE80) or release the lock in SM12, then retry activation.`,
      ],
      details: [{ severity: 'error', text: `Object ${objectLabel} is locked by another session.` }],
    };
  }
  throw err;
}

function outcomeToResult(outcome: ActivationOutcome): ActivationResult {
  if (outcome.kind === 'preaudit') {
    const messages = [...outcome.messages];
    const details = [...outcome.details];
    for (const ref of outcome.refs) {
      const label = ref.name || 'object';
      const text = `Activation did not complete — ${label} is still inactive.`;
      messages.push(text);
      details.push({ severity: 'error', text, uri: ref.uri });
    }
    return { success: false, messages, details };
  }
  return { success: outcome.kind === 'success', messages: outcome.messages, details: outcome.details };
}

/** Result of a publish/unpublish operation */
export interface PublishResult {
  severity: string;
  shortText: string;
  longText: string;
}

function findDeepValue(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDeepValue(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = obj as Record<string, unknown>;
  if (key in record) return record[key];
  for (const val of Object.values(record)) {
    const found = findDeepValue(val, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function parsePublishResponse(xml: string): PublishResult {
  if (!xml.trim()) return { severity: 'OK', shortText: '', longText: '' };
  const parsed = parseXml(xml);
  const severity = findDeepValue(parsed, 'SEVERITY');
  const shortText = findDeepValue(parsed, 'SHORT_TEXT');
  const longText = findDeepValue(parsed, 'LONG_TEXT');
  return {
    severity: severity != null ? String(severity) : 'UNKNOWN',
    shortText: shortText != null ? String(shortText) : '',
    longText: longText != null ? String(longText) : '',
  };
}

function publishBody(name: string): string {
  return `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:name="${escapeXmlAttr(name)}"/></adtcore:objectReferences>`;
}

// On-prem releases (live-verified on S/4HANA 2023, SAP_BASIS 758) render the publish/unpublish
// job status ONLY as application/vnd.sap.as+xml: any Accept that does not cover it is rejected
// with 406 SADT_RESOURCE 044 ("The message content is not acceptable. Accepted content types:
// application/vnd.sap.as+xml") — e.g. the newer-release media type
// application/vnd.sap.adt.businessservices.odatav4.v1+xml. Naming as+xml first keeps 758
// deterministic; the wildcard keeps backends with other renderers working.
const PUBLISH_JOB_ACCEPT = 'application/vnd.sap.as+xml, application/*;q=0.8';

/**
 * Fully-qualified AS-XML media type for a publish/unpublish job, as Eclipse ADT sends it.
 * All four serviceType × job combinations live-verified against S/4HANA 2023 (SAP_BASIS 758).
 */
function publishJobAsXmlType(serviceType: 'odatav2' | 'odatav4', job: 'publishjob' | 'unpublishjob'): string {
  return `application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.businessservices.${serviceType}.${job}`;
}

/**
 * True when the backend rejected content negotiation and named application/vnd.sap.as+xml as
 * the only type it supports. Self-scoping: only ever fires on backends that emit exactly this
 * complaint, so the as+xml retry cannot affect systems that accept the primary headers.
 */
function isAsXmlOnlyNegotiationError(err: unknown): boolean {
  if (!(err instanceof AdtApiError)) return false;
  if (err.statusCode !== 406 && err.statusCode !== 415) return false;
  return `${err.message} ${err.responseBody ?? ''}`.includes('application/vnd.sap.as+xml');
}

async function postPublishJob(
  http: AdtHttpClient,
  serviceType: 'odatav2' | 'odatav4',
  job: 'publishjob' | 'unpublishjob',
  name: string,
  version: string,
): Promise<PublishResult> {
  const path = `/sap/bc/adt/businessservices/${serviceType}/${job}s?servicename=${encodeURIComponent(name)}&serviceversion=${encodeURIComponent(version)}`;
  try {
    const resp = await http.post(path, publishBody(name), 'application/xml', { Accept: PUBLISH_JOB_ACCEPT });
    return parsePublishResponse(resp.body);
  } catch (err) {
    if (!isAsXmlOnlyNegotiationError(err)) throw err;
    const asXmlType = publishJobAsXmlType(serviceType, job);
    logger.debug(`Publish job content negotiation rejected — retrying with ${asXmlType}`, { path });
    const resp = await http.post(path, publishBody(name), asXmlType, { Accept: asXmlType });
    return parsePublishResponse(resp.body);
  }
}

/** Publish an OData service binding (makes the service available for consumption) */
export async function publishServiceBinding(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
  version = '0001',
  serviceType: 'odatav2' | 'odatav4' = 'odatav2',
): Promise<PublishResult> {
  checkOperation(safety, OperationType.Activate, 'PublishServiceBinding');
  return postPublishJob(http, serviceType, 'publishjob', name, version);
}

/** Unpublish an OData service binding (removes the service from consumption) */
export async function unpublishServiceBinding(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
  version = '0001',
  serviceType: 'odatav2' | 'odatav4' = 'odatav2',
): Promise<PublishResult> {
  checkOperation(safety, OperationType.Activate, 'UnpublishServiceBinding');
  return postPublishJob(http, serviceType, 'unpublishjob', name, version);
}

/** Run ABAP unit tests for an object */
export async function runUnitTests(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  opts: { coverage?: boolean } = {},
): Promise<UnitTestRunResult> {
  checkOperation(safety, OperationType.Test, 'RunUnitTests');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<aunit:runConfiguration xmlns:aunit="http://www.sap.com/adt/aunit">
  <external>
    <coverage active="${opts.coverage ? 'true' : 'false'}"/>
  </external>
  <options>
    <uriType value="semantic"/>
    <testDeterminationStrategy sameProgram="true" assignedTests="false" publicApi="false"/>
    <testRiskLevels harmless="true" dangerous="true" critical="true"/>
    <testDurations short="true" medium="true" long="true"/>
  </options>
  <adtcore:objectSets xmlns:adtcore="http://www.sap.com/adt/core">
    <objectSet kind="inclusive">
      <adtcore:objectReferences>
        <adtcore:objectReference adtcore:uri="${escapeXmlAttr(objectUrl)}"/>
      </adtcore:objectReferences>
    </objectSet>
  </adtcore:objectSets>
</aunit:runConfiguration>`;

  const resp = await http.post(
    '/sap/bc/adt/abapunit/testruns',
    body,
    'application/vnd.sap.adt.abapunit.testruns.config.v4+xml',
    {
      Accept: 'application/vnd.sap.adt.abapunit.testruns.result.v2+xml',
    },
  );

  const tests = parseUnitTestResults(resp.body);
  if (!opts.coverage) return { tests };

  // Coverage is a second step: the run result references a coverage measurement, which we POST
  // (with the same object set) to retrieve the statement/branch/procedure aggregate. The endpoint is
  // live-verified on 7.50 + 758 + 816 (2026-06-25); the best-effort fallback (missing URI / fetch
  // failure / no valid metrics → return tests with no coverage) is defensive for unknown systems.
  const measurementUri = extractCoverageMeasurementUri(resp.body);
  if (!measurementUri) return { tests };
  try {
    const coverageQuery = `<?xml version="1.0" encoding="UTF-8"?>
<cov:query xmlns:cov="http://www.sap.com/adt/cov"><adtcore:objectSets xmlns:adtcore="http://www.sap.com/adt/core"><objectSet kind="inclusive"><adtcore:objectReferences><adtcore:objectReference adtcore:uri="${escapeXmlAttr(objectUrl)}"/></adtcore:objectReferences></objectSet></adtcore:objectSets></cov:query>`;
    const measResp = await http.post(measurementUri, coverageQuery, 'application/xml', { Accept: 'application/xml' });
    const coverage = parseCoverageMeasurement(measResp.body);
    return hasCoverageMetrics(coverage) ? { tests, coverage } : { tests };
  } catch {
    return { tests };
  }
}

/** Extract the coverage-measurement URI from an abapunit testruns result run with coverage="true". */
export function extractCoverageMeasurementUri(testrunsXml: string): string | null {
  const parsed = parseXml(testrunsXml);
  for (const node of findDeepNodes(parsed, 'coverage')) {
    const uri = (node as Record<string, unknown>)['@_uri'];
    if (typeof uri === 'string' && uri.includes('/coverage/measurements/')) return uri;
  }
  return null;
}

/** Max per-method entries returned (worst-first); pathological classes don't bloat the output. */
const MAX_METHODS_BELOW_FULL = 50;

/** Validate + extract the statement/branch/procedure metrics from one `<coverages>` node.
 *  Non-finite / negative attrs are skipped so malformed XML degrades instead of emitting NaN. */
function parseCoverageEntries(coveragesNode: Record<string, unknown>): Omit<MethodCoverage, 'method'> {
  const raw = coveragesNode.coverage;
  const entries = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
  const out: Omit<MethodCoverage, 'method'> = {};
  for (const e of entries) {
    const type = String(e['@_type'] ?? '');
    const total = Number(e['@_total'] ?? 0);
    const executed = Number(e['@_executed'] ?? 0);
    if (
      (type === 'statement' || type === 'branch' || type === 'procedure') &&
      Number.isFinite(total) &&
      Number.isFinite(executed) &&
      total >= 0 &&
      executed >= 0
    ) {
      out[type] = { executed, total, percent: total ? Math.round((executed / total) * 10000) / 100 : 0 };
    }
  }
  return out;
}

/** Walk the measurement tree and collect every per-method (CLAS/OM) coverage node. */
function collectMethodCoverages(parsed: unknown): MethodCoverage[] {
  const methods: MethodCoverage[] = [];
  const visit = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj) visit(item);
      return;
    }
    const rec = obj as Record<string, unknown>;
    // removeNSPrefix strips adtcore: (element key `objectReference`, attrs `@_type`/`@_name`); the
    // parser also arrays `objectReference` (ARRAY_TAGS), so unwrap the single entry.
    const refRaw = rec.objectReference;
    const ref = (Array.isArray(refRaw) ? refRaw[0] : refRaw) as Record<string, unknown> | undefined;
    // Method node type is `CLAS/OM` on 758/816 but `CLAS/OM/<visibility>` (e.g. CLAS/OM/public) on
    // NW 7.50 — live-verified 2026-06-25; match the prefix so per-method works on all three.
    const refType = ref ? String(ref['@_type'] ?? '') : '';
    if (ref && (refType === 'CLAS/OM' || refType.startsWith('CLAS/OM/')) && rec.coverages) {
      const name = String(ref['@_name'] ?? '');
      const coveragesNode = (Array.isArray(rec.coverages) ? rec.coverages[0] : rec.coverages) as Record<
        string,
        unknown
      >;
      const metrics = parseCoverageEntries(coveragesNode);
      if (name && (metrics.statement || metrics.branch || metrics.procedure)) {
        methods.push({ method: name, ...metrics });
      }
    }
    for (const value of Object.values(rec)) visit(value);
  };
  visit(parsed);
  return methods;
}

/** Parse the object-level statement/branch/procedure aggregate from a coverage-measurement response,
 *  plus the per-method drill-down (methods below full statement coverage, worst-first). */
export function parseCoverageMeasurement(xml: string): CoverageSummary {
  const parsed = parseXml(xml);
  const firstCoverages = findDeepNodes(parsed, 'coverages')[0] as Record<string, unknown> | undefined;
  if (!firstCoverages) return {};
  const summary: CoverageSummary = parseCoverageEntries(firstCoverages);
  // Per-method nodes are already in THIS response (no extra round-trip). Surface only methods below
  // 100% statement coverage — the actionable subset the object aggregate hides — worst-first, capped.
  const below = collectMethodCoverages(parsed)
    .filter((m) => m.statement !== undefined && m.statement.executed < m.statement.total)
    .sort((a, b) => a.statement!.percent - b.statement!.percent || b.statement!.total - a.statement!.total)
    .slice(0, MAX_METHODS_BELOW_FULL);
  if (below.length > 0) summary.methodsBelowFull = below;
  return summary;
}

function hasCoverageMetrics(summary: CoverageSummary): boolean {
  return Boolean(summary.statement || summary.branch || summary.procedure);
}

/** Run ATC check on an object */
export async function runAtcCheck(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  variant?: string,
): Promise<{ findings: AtcFinding[] }> {
  checkOperation(safety, OperationType.Read, 'RunATCCheck');

  // ATC is a three-step flow. The checks that actually run are selected by the *check
  // variant bound to a worklist* — not by the run request. The previous implementation
  // skipped worklist creation and POSTed straight to `/runs?worklistId=1`, so ATC executed
  // no checks and always returned zero findings (and the `variant` argument was silently
  // ignored — it only toggled `maximumVerdicts`). Verified live on A4H (S/4HANA 2023):
  // a variant-bound worklist yields findings; the bare `worklistId=1` path does not.

  // Step 1 — create a worklist bound to the check variant. Omitting `checkVariant` uses the
  // system's configured default check variant (live-verified to produce findings). The
  // response body is the plain-text worklist id.
  const worklistPath = variant
    ? `/sap/bc/adt/atc/worklists?checkVariant=${encodeURIComponent(variant)}`
    : '/sap/bc/adt/atc/worklists';
  const worklistResp = await http.post(worklistPath, '', 'application/xml', { Accept: 'text/plain' });
  const worklistId = worklistResp.body.trim();
  if (!worklistId) {
    throw new AdtApiError('ATC worklist creation returned no worklist id; cannot run ATC checks.', 500, worklistPath);
  }

  // Step 2 — run the selected checks for the object set into that worklist.
  const runBody = `<?xml version="1.0" encoding="UTF-8"?>
<atc:run xmlns:atc="http://www.sap.com/adt/atc" maximumVerdicts="100">
  <objectSets xmlns:adtcore="http://www.sap.com/adt/core">
    <objectSet kind="inclusive">
      <adtcore:objectReferences>
        <adtcore:objectReference adtcore:uri="${escapeXmlAttr(objectUrl)}"/>
      </adtcore:objectReferences>
    </objectSet>
  </objectSets>
</atc:run>`;
  await http.post(`/sap/bc/adt/atc/runs?worklistId=${encodeURIComponent(worklistId)}`, runBody, 'application/xml', {
    Accept: 'application/xml',
  });

  // Step 3 — read the populated worklist with its findings.
  const resultResp = await http.get(`/sap/bc/adt/atc/worklists/${encodeURIComponent(worklistId)}`, {
    Accept: 'application/atc.worklist.v1+xml',
  });

  return { findings: parseAtcFindings(resultResp.body) };
}

/**
 * Get SAP-suggested ABAP Unit test cases for a CDS entity (CDS Test Double Framework).
 *
 * Wraps `GET /sap/bc/adt/aunit/dbtestdoubles/cds/testcases?ddlsourceName=<CDS>`, new on
 * SAP_BASIS 8.16 (ABAP Platform 2025 / S/4HANA 2025). SAP analyzes the active CDS view and
 * returns one suggested test case per testable semantic (the whole view, each calculated
 * field, each CAST/CASE), each with a method name + description + semanticType. Read-only —
 * the AI-backed testdata/testmethod generation siblings (POST, Joule-licensed) are not exposed.
 *
 * Returns HTTP 400 "CDS view <name> does not exist" for an unknown/inactive entity (surfaced
 * as AdtApiError). Gate availability with supportsCdsTestCases() before calling on unknown
 * systems — the endpoint 404s on releases below 8.16 (verified: 758 → 404, 816 → 200).
 */
export async function getCdsTestCases(
  http: AdtHttpClient,
  safety: SafetyConfig,
  ddlsourceName: string,
): Promise<CdsTestCasesResult> {
  checkOperation(safety, OperationType.Read, 'GetCdsTestCases');

  const path = `/sap/bc/adt/aunit/dbtestdoubles/cds/testcases?ddlsourceName=${encodeURIComponent(ddlsourceName)}`;
  const resp = await http.get(path, {
    Accept: 'application/vnd.sap.adt.aunit.dbtestdoubles.cds.testcases.v1+xml',
  });
  return parseCdsTestCases(resp.body);
}

/**
 * Capability gate for getCdsTestCases — true iff ADT discovery advertises the
 * `aunit/dbtestdoubles/cds/testcases` collection (present on 8.16+, absent on 7.5x / 758).
 * Returns undefined when discovery has not been loaded (caller should attempt and let a 404
 * surface). Mirrors supportsExplicitTransportTarget() in transport.ts.
 */
export function supportsCdsTestCases(http: AdtHttpClient): boolean | undefined {
  if (!http.hasDiscoveryData()) return undefined;
  return http.discoveryAcceptFor('/sap/bc/adt/aunit/dbtestdoubles/cds/testcases') !== undefined;
}

function assertQuickfixProposalUri(uri: string): void {
  const quickfixProposalPrefix = '/sap/bc/adt/quickfixes/';
  let parsed: URL;
  try {
    parsed = new URL(uri, 'https://arc1.invalid');
  } catch {
    throw new AdtSafetyError(`ApplyFixProposal refused invalid quickfix proposal URI: '${uri}'`);
  }
  if (
    !uri.startsWith(quickfixProposalPrefix) ||
    parsed.origin !== 'https://arc1.invalid' ||
    !parsed.pathname.startsWith(quickfixProposalPrefix)
  ) {
    throw new AdtSafetyError(
      `ApplyFixProposal refused non-quickfix proposal URI: '${uri}'. Use a proposal URI returned by SAPDiagnose(action="quickfix").`,
    );
  }
}

/** Get SAP quick fix proposals for a given source position */
export async function getFixProposals(
  http: AdtHttpClient,
  safety: SafetyConfig,
  sourceUri: string,
  source: string,
  line: number,
  column: number,
): Promise<FixProposal[]> {
  checkOperation(safety, OperationType.Read, 'GetFixProposals');

  const uriWithStart = `${sourceUri}#start=${line},${column}`;
  const path = `/sap/bc/adt/quickfixes/evaluation?uri=${encodeURIComponent(uriWithStart)}`;

  try {
    const resp = await http.post(path, source, 'application/*', {
      Accept: 'application/*',
    });
    return parseFixProposals(resp.body);
  } catch (err) {
    if (err instanceof AdtApiError && (err.statusCode === 404 || err.statusCode === 406)) {
      // Graceful fallback: endpoint not available on this SAP release/system.
      return [];
    }
    throw err;
  }
}

/** Apply one SAP quick fix proposal and return replacement deltas */
export async function applyFixProposal(
  http: AdtHttpClient,
  safety: SafetyConfig,
  proposal: FixProposal,
  sourceUri: string,
  source: string,
  line: number,
  column: number,
): Promise<FixDelta[]> {
  checkOperation(safety, OperationType.Update, 'ApplyFixProposal');
  assertQuickfixProposalUri(proposal.uri);

  const uriWithStart = `${sourceUri}#start=${line},${column}`;
  const userContent =
    proposal.userContent === undefined
      ? ''
      : `
  <userContent>${escapeXmlAttr(proposal.userContent)}</userContent>`;
  const affectedObjects = serializeAffectedObjects(proposal.affectedObjects);
  // quickfixes.xsd uses elementFormDefault="unqualified"; only the root and imported adtcore
  // elements are prefixed.
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<quickfixes:proposalRequest xmlns:quickfixes="http://www.sap.com/adt/quickfixes" xmlns:adtcore="http://www.sap.com/adt/core">
  <input>
    <content>${escapeXmlAttr(source)}</content>
    <adtcore:objectReference adtcore:uri="${escapeXmlAttr(uriWithStart)}"/>
  </input>${affectedObjects}${userContent}
</quickfixes:proposalRequest>`;

  const resp = await http.post(proposal.uri, body, 'application/xml', {
    Accept: 'application/xml',
  });

  return parseFixDeltas(resp.body);
}

// ─── Parsers ────────────────────────────────────────────────────────

export interface AtcFinding {
  priority: number;
  checkTitle: string;
  messageTitle: string;
  uri: string;
  line: number;
  quickfixInfo?: string;
  hasQuickfix?: boolean;
}

/** Discriminated outcome from parsing an activation response. */
export type ActivationOutcome =
  | { kind: 'success'; messages: string[]; details: ActivationMessage[] }
  | { kind: 'error'; messages: string[]; details: ActivationMessage[] }
  | {
      kind: 'preaudit';
      refs: Array<{ uri: string; name: string }>;
      messages: string[];
      details: ActivationMessage[];
    };

/** Parse activation response into a discriminated outcome. */
export function parseActivationOutcome(xml: string): ActivationOutcome {
  if (!xml.trim()) return { kind: 'success', messages: [], details: [] };

  const parsed = parseXml(xml);
  const msgs = findDeepNodes(parsed, 'msg');
  const messages: string[] = [];
  const details: ActivationMessage[] = [];
  let hasErrors = false;

  for (const m of msgs) {
    const rawSeverity = String(m['@_severity'] ?? '');
    const type = String(m['@_type'] ?? '');
    const isError = rawSeverity === 'error' || rawSeverity === 'fatal' || type === 'E' || type === 'A';
    if (isError) hasErrors = true;

    const shortText = extractShortText(m);
    if (shortText) messages.push(shortText);

    const severity: ActivationMessage['severity'] = isError
      ? 'error'
      : type === 'W' || rawSeverity === 'warning'
        ? 'warning'
        : 'info';

    const rawUri = m['@_uri'] ?? m['@_href'];
    const rawLine = m['@_line'];
    const detail: ActivationMessage = { severity, text: shortText };
    if (rawUri) detail.uri = String(rawUri);
    // Prefer #start=LINE,COL from the URI — @_line is often an ordinal message index, not source line.
    let line = 0;
    const uriStr = rawUri ? String(rawUri) : '';
    const startMatch = uriStr.match(/#start=(\d+),(\d+)/);
    if (startMatch) {
      line = Number.parseInt(startMatch[1], 10);
    }
    if (!line && rawLine != null) {
      line = Number.parseInt(String(rawLine), 10);
    }
    if (Number.isFinite(line) && line > 0) detail.line = line;
    details.push(detail);
  }

  if (hasErrors) return { kind: 'error', messages, details };

  // <ioc:inactiveObjects> with no <msg> errors = preaudit prompt.
  // SAP lists the related inactive objects and asks the client to confirm.
  const inactive = extractInactiveObjectEntries(parsed);
  if (inactive.length > 0) {
    return {
      kind: 'preaudit',
      refs: inactive.map((r) => ({ uri: r.uri, name: r.name })),
      messages,
      details,
    };
  }

  return { kind: 'success', messages, details };
}

/** Parse activation response XML to detect errors via proper XML parsing.
 *  Treats preaudit prompts as errors — use parseActivationOutcome for handshake support. */
export function parseActivationResult(xml: string): ActivationResult {
  const outcome = parseActivationOutcome(xml);
  if (outcome.kind === 'preaudit') {
    const messages = [...outcome.messages];
    const details = [...outcome.details];
    for (const ref of outcome.refs) {
      const label = ref.name || 'object';
      const text = `Activation did not complete — ${label} is still inactive.`;
      messages.push(text);
      details.push({ severity: 'error', text, uri: ref.uri });
    }
    return { success: false, messages, details };
  }
  return { success: outcome.kind === 'success', messages: outcome.messages, details: outcome.details };
}

/** Extract still-inactive object refs from an <ioc:inactiveObjects> response.
 *  Entries with no <object> child (transport-only rows) are ignored. */
function extractInactiveObjectEntries(
  parsed: Record<string, unknown>,
): Array<{ name: string; uri: string; user: string }> {
  const entries = findDeepNodes(parsed, 'entry');
  const out: Array<{ name: string; uri: string; user: string }> = [];
  for (const entry of entries) {
    const objectNode = entry.object;
    if (!objectNode || typeof objectNode !== 'object') continue;
    const refs = findDeepNodes(objectNode as Record<string, unknown>, 'ref');
    if (refs.length === 0) continue;
    const transportNode = entry.transport;
    const transportUser =
      transportNode && typeof transportNode === 'object'
        ? String((transportNode as Record<string, unknown>)['@_user'] ?? '')
        : '';
    for (const ref of refs) {
      out.push({
        name: String(ref['@_name'] ?? '').trim(),
        uri: String(ref['@_uri'] ?? ''),
        user: transportUser,
      });
    }
  }
  return out;
}

/** Extract shortText from an activation message node.
 *  Format 1 (attribute): <msg shortText="..."/>
 *  Format 2 (element):   <msg><shortText><txt>line1</txt><txt>line2</txt></shortText></msg>
 */
function extractShortText(m: Record<string, unknown>): string {
  // Try attribute first (older SAP systems / some message types)
  const attr = m['@_shortText'];
  if (attr) return String(attr);

  // Try child element with <txt> sub-elements
  const shortTextNode = m.shortText;
  if (!shortTextNode || typeof shortTextNode !== 'object') return '';

  const record = shortTextNode as Record<string, unknown>;
  const txt = record.txt ?? record['#text'];
  if (typeof txt === 'string') return txt;
  if (Array.isArray(txt)) return txt.map((t) => String(t)).join(' — ');
  if (txt != null) return String(txt);
  return '';
}

function parseSyntaxCheckResult(xml: string): SyntaxCheckResult {
  const parsed = parseXml(xml);
  // Two response shapes observed:
  //   - <msg type="E" shortText="..." line="..." col="..."/> (older / some variants)
  //   - <chkrun:checkMessage chkrun:type="E" chkrun:shortText="..." chkrun:uri="...#start=LINE,COL"/>
  //     (NW 7.50 /checkruns response — uri carries the position via #start=line,col)
  const msgs = [...findDeepNodes(parsed, 'msg'), ...findDeepNodes(parsed, 'checkMessage')];
  const messages: SyntaxMessage[] = msgs.map((m) => {
    const type = String(m['@_type'] ?? '');
    let line = Number.parseInt(String(m['@_line'] ?? '0'), 10);
    let column = Number.parseInt(String(m['@_col'] ?? '0'), 10);
    const uri = String(m['@_uri'] ?? '');
    const startMatch = uri.match(/#start=(\d+),(\d+)/);
    if (startMatch) {
      if (!line) line = Number.parseInt(startMatch[1], 10);
      if (!column) column = Number.parseInt(startMatch[2], 10);
    }
    return {
      severity: type === 'E' ? 'error' : type === 'W' ? 'warning' : 'info',
      text: decodeXmlEntities(String(m['@_shortText'] ?? '')),
      line: Number.isFinite(line) ? line : 0,
      column: Number.isFinite(column) ? column : 0,
      ...(uri ? { uri } : {}),
    };
  });

  return {
    hasErrors: messages.some((m) => m.severity === 'error'),
    messages,
  };
}

function parseUnitTestResults(xml: string): UnitTestResult[] {
  const results: UnitTestResult[] = [];
  const parsed = parseXml(xml);
  const testClasses = findDeepNodes(parsed, 'testClass');

  for (const tc of testClasses) {
    const className = String(tc['@_name'] ?? '');
    const uri = String(tc['@_uri'] ?? '');
    // Extract program name from URI:
    //   classes: /sap/bc/adt/oo/classes/ZCL_TEST/...
    //   programs: /sap/bc/adt/programs/programs/ZTEST/...  (note: "programs" appears twice)
    const uriParts = uri.split('/');
    let program = '';
    for (let i = 0; i < uriParts.length - 1; i++) {
      if (uriParts[i] === 'classes') {
        program = uriParts[i + 1] ?? '';
        break;
      }
      if (uriParts[i] === 'programs' && uriParts[i + 1] === 'programs' && i + 2 < uriParts.length) {
        program = uriParts[i + 2] ?? '';
        break;
      }
    }

    const methods = findDeepNodes(tc, 'testMethod');
    for (const method of methods) {
      const methodName = String(method['@_name'] ?? '');
      const alerts = findDeepNodes(method, 'alert');
      const hasAlert = alerts.length > 0;
      // Extract message from first alert's title element
      let message: string | undefined;
      if (hasAlert) {
        const titleVal = (alerts[0] as Record<string, unknown>).title;
        if (titleVal != null) {
          if (typeof titleVal === 'string') {
            message = titleVal;
          } else if (typeof titleVal === 'object' && !Array.isArray(titleVal)) {
            message = String((titleVal as Record<string, unknown>)['#text'] ?? '');
          } else {
            message = String(titleVal);
          }
        }
      }
      // Extract duration from executionTime attribute (in seconds)
      const execTime = method['@_executionTime'];
      const duration = execTime ? Number(execTime) : undefined;

      results.push({
        program,
        testClass: className,
        testMethod: methodName,
        status: hasAlert ? 'failed' : 'passed',
        ...(message ? { message } : {}),
        ...(duration !== undefined && !Number.isNaN(duration) ? { duration } : {}),
      });
    }
  }

  return results;
}

function toNodeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function readNodeText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map((n) => readNodeText(n)).join('');
  if (typeof node !== 'object') return '';
  const rec = node as Record<string, unknown>;
  if ('#text' in rec) return readNodeText(rec['#text']);
  return Object.entries(rec)
    .filter(([k]) => !k.startsWith('@_'))
    .map(([, v]) => readNodeText(v))
    .join('');
}

function nodeRecords(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => item != null && typeof item === 'object');
  }
  return typeof value === 'object' ? [value as Record<string, unknown>] : [];
}

function readObjectReference(value: unknown): FixAffectedObject | undefined {
  const objectRef = toNodeRecord(value);
  const uri = String(objectRef?.['@_uri'] ?? '');
  if (!uri) return undefined;

  const affected: FixAffectedObject = { uri };
  const type = objectRef?.['@_type'];
  const name = objectRef?.['@_name'];
  const description = objectRef?.['@_description'];
  if (type != null) affected.type = String(type);
  if (name != null) affected.name = String(name);
  if (description != null) affected.description = String(description);
  return affected;
}

function parseAffectedObjects(value: unknown): FixAffectedObject[] | undefined {
  const affectedNode = toNodeRecord(value);
  if (!affectedNode) return undefined;

  const affected: FixAffectedObject[] = [];
  for (const unit of nodeRecords(affectedNode.unit)) {
    const ref = readObjectReference(unit.objectReference);
    if (!ref) continue;
    if (unit.content !== undefined) ref.content = readNodeText(unit.content);
    affected.push(ref);
  }

  for (const objectRef of nodeRecords(affectedNode.objectReference)) {
    const ref = readObjectReference(objectRef);
    if (ref) affected.push(ref);
  }

  return affected.length > 0 ? affected : undefined;
}

function serializeObjectReferenceAttrs(ref: FixAffectedObject): string {
  const attrs = [`adtcore:uri="${escapeXmlAttr(ref.uri)}"`];
  if (ref.type !== undefined) attrs.push(`adtcore:type="${escapeXmlAttr(ref.type)}"`);
  if (ref.name !== undefined) attrs.push(`adtcore:name="${escapeXmlAttr(ref.name)}"`);
  if (ref.description !== undefined) attrs.push(`adtcore:description="${escapeXmlAttr(ref.description)}"`);
  return attrs.join(' ');
}

function serializeAffectedObjects(affectedObjects: FixAffectedObject[] | undefined): string {
  const units = (affectedObjects ?? [])
    .filter((affected) => affected.uri && affected.content !== undefined)
    .map(
      (affected) => `    <unit>
      <content>${escapeXmlAttr(affected.content ?? '')}</content>
      <adtcore:objectReference ${serializeObjectReferenceAttrs(affected)}/>
    </unit>`,
    );

  if (units.length === 0) return '';
  return `
  <affectedObjects>
${units.join('\n')}
  </affectedObjects>`;
}

function parseFixProposals(xml: string): FixProposal[] {
  const parsed = parseXml(xml);
  const results = findDeepNodes(parsed, 'evaluationResult');
  if (results.length === 0) return [];

  return results
    .map((result) => {
      const objectRef = toNodeRecord(result.objectReference);
      const affectedObjects = parseAffectedObjects(result.affectedObjects);
      return {
        uri: String(objectRef?.['@_uri'] ?? ''),
        type: String(objectRef?.['@_type'] ?? ''),
        name: String(objectRef?.['@_name'] ?? ''),
        description: String(objectRef?.['@_description'] ?? ''),
        userContent: readNodeText(result.userContent),
        ...(affectedObjects ? { affectedObjects } : {}),
      } satisfies FixProposal;
    })
    .filter((proposal) => proposal.uri.length > 0);
}

function parseIntOrUndefined(value: unknown): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parsePositionFragment(uri: string, key: 'start' | 'end'): { line: number; column: number } | undefined {
  const re = key === 'start' ? /(?:#|[;&])start=(\d+),(\d+)/ : /(?:#|[;&])end=(\d+),(\d+)/;
  const match = uri.match(re);
  if (!match?.[1] || !match[2]) return undefined;
  return {
    line: Number.parseInt(match[1], 10),
    column: Number.parseInt(match[2], 10),
  };
}

function parseFixDeltaNode(node: Record<string, unknown>): FixDelta {
  const objectRef = toNodeRecord(node.objectReference);
  const startNode = toNodeRecord(node.start ?? node.from ?? node.sourceStart);
  const endNode = toNodeRecord(node.end ?? node.to ?? node.sourceEnd);

  const uri = String(node['@_uri'] ?? objectRef?.['@_uri'] ?? '');

  const startFromUri = parsePositionFragment(uri, 'start');
  const endFromUri = parsePositionFragment(uri, 'end');

  const startLine =
    parseIntOrUndefined(node['@_startLine']) ??
    parseIntOrUndefined(node['@_startline']) ??
    parseIntOrUndefined(startNode?.['@_line']) ??
    startFromUri?.line ??
    0;
  const startColumn =
    parseIntOrUndefined(node['@_startColumn']) ??
    parseIntOrUndefined(node['@_startCol']) ??
    parseIntOrUndefined(node['@_startcolumn']) ??
    parseIntOrUndefined(startNode?.['@_column']) ??
    parseIntOrUndefined(startNode?.['@_col']) ??
    startFromUri?.column ??
    0;
  const endLine =
    parseIntOrUndefined(node['@_endLine']) ??
    parseIntOrUndefined(node['@_endline']) ??
    parseIntOrUndefined(endNode?.['@_line']) ??
    endFromUri?.line ??
    startLine;
  const endColumn =
    parseIntOrUndefined(node['@_endColumn']) ??
    parseIntOrUndefined(node['@_endCol']) ??
    parseIntOrUndefined(node['@_endcolumn']) ??
    parseIntOrUndefined(endNode?.['@_column']) ??
    parseIntOrUndefined(endNode?.['@_col']) ??
    endFromUri?.column ??
    startColumn;

  const content = readNodeText(node.content ?? node.replacement ?? node.newText ?? node.text ?? node['#text']);

  return {
    uri,
    range: {
      start: { line: startLine, column: startColumn },
      end: { line: endLine, column: endColumn },
    },
    content,
  };
}

function parseFixDeltas(xml: string): FixDelta[] {
  const parsed = parseXml(xml);
  const unitNodes = findDeepNodes(parsed, 'deltas').flatMap((deltas) => nodeRecords(deltas.unit));
  if (unitNodes.length > 0) return unitNodes.map(parseFixDeltaNode);

  const candidateKeys = ['delta', 'edit', 'textEdit', 'replacement', 'replace'] as const;
  let nodes: Array<Record<string, unknown>> = [];

  for (const key of candidateKeys) {
    nodes = findDeepNodes(parsed, key);
    if (nodes.length > 0) break;
  }

  return nodes.map(parseFixDeltaNode);
}

function parseAtcFindings(xml: string): AtcFinding[] {
  const parsed = parseXml(xml);
  const nodes = findDeepNodes(parsed, 'finding');

  return nodes.map((f) => {
    // Real ATC findings carry TWO uri-ish attributes: `adtcore:uri` (a findings-catalog
    // URI with no source position) and `atcfinding:location` (the source URI with the
    // `#start=line,col` fragment). Prefer `location` so the source line is extracted and
    // the returned uri points at the actual code position. Hand-written fixtures that only
    // set `uri="...#start=..."` still work via the fallback.
    const rawUri = String(f['@_location'] ?? f['@_uri'] ?? '');
    let line = 0;
    const startIdx = rawUri.indexOf('#start=');
    if (startIdx !== -1) {
      const fragment = rawUri.slice(startIdx + '#start='.length);
      const firstNum = Number.parseInt(fragment.split(',')[0]!, 10);
      if (!Number.isNaN(firstNum)) line = firstNum;
    }

    const quickfixInfoRaw = f['@_quickfixInfo'];
    const quickfixInfo = quickfixInfoRaw == null ? undefined : String(quickfixInfoRaw);
    const quickfixNode = toNodeRecord(f.quickfixes);
    const manual = String(quickfixNode?.['@_manual'] ?? 'false').toLowerCase() === 'true';
    const automatic = String(quickfixNode?.['@_automatic'] ?? 'false').toLowerCase() === 'true';
    const pseudo = String(quickfixNode?.['@_pseudo'] ?? 'false').toLowerCase() === 'true';

    return {
      priority: Number.parseInt(String(f['@_priority'] ?? '0'), 10),
      checkTitle: String(f['@_checkTitle'] ?? ''),
      messageTitle: String(f['@_messageTitle'] ?? ''),
      uri: rawUri,
      line,
      quickfixInfo,
      hasQuickfix: manual || automatic || pseudo,
    };
  });
}

/** Read the text content of a CDS test-case child element (string leaf or {#text} node). */
function cdsNodeText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && !Array.isArray(v)) {
    return String((v as Record<string, unknown>)['#text'] ?? '');
  }
  return String(v);
}

/**
 * Parse the `cds/testcases` response into structured suggestions.
 *
 * Live shape (namespace prefixes stripped by parseXml's removeNSPrefix):
 *   <root><cds>I_CURRENCY</cds><testCases>
 *     <testCase><title/><testMethod/><description/><semanticType/><calculatedField/></testCase>…
 *   </testCases></root>
 * The <cds> element is a string leaf, so it is read off the root node directly
 * (findDeepNodes skips string leaves); the testCase list is collected recursively.
 */
function parseCdsTestCases(xml: string): CdsTestCasesResult {
  const parsed = parseXml(xml);
  const root = (parsed.root ?? parsed) as Record<string, unknown>;
  const cds = cdsNodeText(root.cds).trim();

  const testCases: CdsTestCase[] = findDeepNodes(parsed, 'testCase').map((node) => {
    const tc: CdsTestCase = {
      title: cdsNodeText(node.title).trim(),
      testMethod: cdsNodeText(node.testMethod).trim(),
      description: cdsNodeText(node.description).trim(),
      semanticType: cdsNodeText(node.semanticType).trim(),
    };
    const calculatedField = cdsNodeText(node.calculatedField).trim();
    if (calculatedField) tc.calculatedField = calculatedField;
    const conditionScenario = cdsNodeText(node.conditionScenario).trim();
    if (conditionScenario) tc.conditionScenario = conditionScenario;
    return tc;
  });

  return { cds, testCaseCount: testCases.length, testCases };
}

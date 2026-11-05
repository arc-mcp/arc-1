import { getMutationContext } from './mutation-http.js';
import { PINNED_BATCH_OWNER_LIMIT, PINNED_BATCH_REFERENCE_LIMIT } from './pinned-batch-bounds.js';
/**
 * Development tools for SAP ADT.
 *
 * - SyntaxCheck: compile-time validation
 * - PrettyPrint: server-side ABAP formatting
 * - Activate: publish objects to the main repository
 * - RunUnitTests: execute ABAP unit tests
 * - RunATCCheck: ABAP Test Cockpit (code quality)
 */

import { XMLValidator } from 'fast-xml-parser';
import { getCurrentContext } from '../server/context.js';
import { logger } from '../server/logger.js';
import { ActivationEvidenceError } from './activation-evidence-error.js';
import { type AunitRunResult, parseAunitRunResult, withAunitCoverage } from './aunit.js';
import { AdtApiError, AdtNetworkError, AdtSafetyError } from './errors.js';
import { assertPinnedGroupGenerationReferences, nativeFunctionGroupExecution } from './function-activation-metadata.js';
import type { AdtHttpClient } from './http.js';
import type { AdtRequestOptions } from './http-deadline.js';
import { nativeActivationExecuted, nativeInactiveReferences } from './native-activation-evidence.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import { assertPinnedActivationOptions } from './pinned-text-pool-activation.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type {
  CdsTestCase,
  CdsTestCasesResult,
  CoverageSummary,
  MethodCoverage,
  SyntaxCheckResult,
  SyntaxMessage,
} from './types.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

export {
  type AtcCompletionEvidence,
  type AtcFinding,
  type AtcFindingStatistics,
  type AtcRunInfo,
  type AtcRunResult,
  getAtcSystemDefaultVariant,
  listAtcVariants,
  runAtcCheck,
} from './atc.js';

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
  options?: { version?: 'active' | 'inactive'; content?: string; artifactContentType?: 'application/json' },
  requestOptions?: AdtRequestOptions,
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
      <chkrun:artifact chkrun:contentType="${options.artifactContentType ?? 'text/plain; charset=utf-8'}" chkrun:uri="${escapeXmlAttr(artifactUri)}">
        <chkrun:content>${encoded}</chkrun:content>
      </chkrun:artifact>
    </chkrun:artifacts>
  </chkrun:checkObject>
</chkrun:checkObjectList>`;
    const resp = await http.post(
      '/sap/bc/adt/checkruns?reporters=abapCheckRun',
      body,
      'application/*',
      {
        Accept: 'application/vnd.sap.adt.checkmessages+xml',
      },
      requestOptions,
    );
    return parseSyntaxCheckResult(
      resp.body,
      options.artifactContentType === 'application/json' ? objectUrl : undefined,
    );
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">
  <chkrun:checkObject adtcore:uri="${escapeXmlAttr(objectUrl)}" chkrun:version="${version}"/>
</chkrun:checkObjectList>`;

  const resp = await http.post(
    '/sap/bc/adt/checkruns',
    body,
    'application/vnd.sap.adt.checkobjects+xml',
    {
      Accept: 'application/vnd.sap.adt.checkmessages+xml',
    },
    requestOptions,
  );

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

/** Read the connected SAP user's ADT PrettyPrinter settings for this system. */
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

/** Update the connected SAP user's ADT PrettyPrinter settings for this system. */
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
  /** Only the explicit pinned function-group profile reports generation separately. */
  execution?: 'activation' | 'generation';
}

const ACTIVATION_TIMEOUT_MS = 300_000;

/** One budget for the complete activation, including preaudit and ED064 recovery. */
function activationRequestOptions(): AdtRequestOptions {
  return {
    deadline: Date.now() + ACTIVATION_TIMEOUT_MS,
    fetchTimeoutMs: ACTIVATION_TIMEOUT_MS,
    signal: getCurrentContext()?.signal,
    retryTransientErrors: false,
  };
}

export interface ActivationReference {
  uri: string;
  name?: string;
  type?: string;
  deleted?: string;
}

export interface ActivationOptions {
  preaudit?: boolean;
  name?: string;
  /** Required on the multi-target boundary; validates initial and SAP-expanded references. */
  validateReferences?: (refs: readonly ActivationReference[]) => Promise<void>;
  beforeSubmit?: () => void;
  /** Private pinned profile: exact group scope, never evidence that module drafts activated. */
  functionGroupGeneration?: true;
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
  options?: ActivationOptions,
): Promise<ActivationResult> {
  return activateWithinBudget(
    http,
    safety,
    objectUrl,
    { ...activationRequestOptions(), noReplay: safety.multiTargetWrite?.enabled === true },
    options,
  );
}

async function activateWithinBudget(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  requestOptions: AdtRequestOptions,
  options?: ActivationOptions,
): Promise<ActivationResult> {
  checkOperation(safety, OperationType.Activate, 'Activate');
  assertPinnedActivationOptions(http, safety, objectUrl, options);
  if (options?.functionGroupGeneration !== undefined) {
    if (options.functionGroupGeneration !== true || !safety.multiTargetWrite?.enabled)
      throw new AdtSafetyError('Function-group generation requires its explicit pinned profile.');
    assertPinnedGroupGenerationReferences(objectUrl, options.name, [{ uri: objectUrl, name: options.name }]);
  }
  await options?.validateReferences?.([{ uri: objectUrl, name: options.name }]);

  try {
    const preaudit = options?.preaudit !== false;
    const nameAttr = options?.name ? ` adtcore:name="${escapeXmlAttr(options.name)}"` : '';
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${escapeXmlAttr(objectUrl)}"${nameAttr}/>
</adtcore:objectReferences>`;

    const phase1Start = Date.now();
    options?.beforeSubmit?.();
    const resp = await postActivation(
      http,
      `/sap/bc/adt/activation?method=activate&preauditRequested=${preaudit}`,
      body,
      'application/*',
      { Accept: 'application/xml' },
      requestOptions,
    );
    const phase1DurationMs = Date.now() - phase1Start;

    const outcome = parseActivationOutcome(
      resp.body,
      options?.functionGroupGeneration ? 'function-group-generation' : safety.multiTargetWrite?.enabled === true,
    );
    if (outcome.kind !== 'preaudit' || !preaudit) {
      return outcomeToResult(outcome);
    }

    if (options?.functionGroupGeneration) assertPinnedGroupGenerationReferences(objectUrl, options.name, outcome.refs);
    await options?.validateReferences?.(outcome.refs);
    options?.beforeSubmit?.();
    return await confirmPreaudit(http, outcome.refs, options?.name ?? objectUrl, phase1DurationMs, requestOptions, {
      safety,
      functionGroupGeneration: options?.functionGroupGeneration,
    });
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
  options?: Pick<ActivationOptions, 'preaudit' | 'validateReferences' | 'beforeSubmit'>,
): Promise<ActivationResult> {
  checkOperation(safety, OperationType.Activate, 'ActivateBatch');
  const context = getMutationContext(http, safety);
  if (
    safety.multiTargetWrite &&
    (!safety.multiTargetWrite.enabled ||
      context?.mode !== 'pinned-pp' ||
      !options?.validateReferences ||
      options.preaudit === false ||
      objects.length === 0 ||
      objects.length > PINNED_BATCH_OWNER_LIMIT ||
      new Set(objects.map((object) => object.url)).size !== objects.length)
  )
    throw new AdtSafetyError(
      'Pinned batch activation is forbidden without bounded owners, preaudit and a scoped validator.',
    );
  const requestOptions = context?.mode === 'pinned-pp' ? context.requestPolicy : activationRequestOptions();
  await options?.validateReferences?.(objects.map((object) => ({ uri: object.url, name: object.name })));

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
    options?.beforeSubmit?.();
    const resp = await postActivation(
      http,
      `/sap/bc/adt/activation?method=activate&preauditRequested=${preaudit}`,
      body,
      'application/*',
      { Accept: 'application/xml' },
      requestOptions,
    );
    const phase1DurationMs = Date.now() - phase1Start;

    const outcome = parseActivationOutcome(resp.body, safety.multiTargetWrite?.enabled === true);
    if (outcome.kind !== 'preaudit' || !preaudit) {
      const result = outcomeToResult(outcome);
      if (safety.multiTargetWrite) return result; // Ambiguous native batches are never replayed.
      return await retryBatchActivationIndividuallyAfterEd064(http, safety, objects, result, requestOptions, options);
    }

    if (safety.multiTargetWrite && outcome.refs.length > PINNED_BATCH_REFERENCE_LIMIT)
      throw new AdtSafetyError('Pinned activation exceeds the raw reference bound.');
    await options?.validateReferences?.(outcome.refs);
    options?.beforeSubmit?.();
    return await confirmPreaudit(
      http,
      outcome.refs,
      objects.map((o) => o.name).join(', '),
      phase1DurationMs,
      requestOptions,
      {
        ...(safety.multiTargetWrite ? {} : { ed064RetryObjects: objects }),
        preaudit: options?.preaudit,
        safety,
      },
    );
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
  requestOptions: AdtRequestOptions,
  options?: {
    ed064RetryObjects?: Array<{ url: string; name: string }>;
    preaudit?: boolean;
    safety: SafetyConfig;
    functionGroupGeneration?: true;
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
    const resp = await postActivation(
      http,
      '/sap/bc/adt/activation?method=activate&preauditRequested=false',
      body,
      'application/*',
      { Accept: 'application/xml' },
      requestOptions,
    );
    result = outcomeToResult(
      parseActivationOutcome(
        resp.body,
        options?.functionGroupGeneration
          ? 'function-group-generation'
          : options?.safety.multiTargetWrite?.enabled === true,
      ),
    );
    if (options?.ed064RetryObjects) {
      result = await retryBatchActivationIndividuallyAfterEd064(
        http,
        options.safety,
        options.ed064RetryObjects,
        result,
        requestOptions,
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
  requestOptions: AdtRequestOptions,
  options?: { preaudit?: boolean },
): Promise<ActivationResult> {
  if (!isRecoverableEd064BatchQuirk(original) || objects.length === 0) return original;

  logger.debug('Batch activation returned ED064 only; retrying original objects individually', {
    count: objects.length,
    objects: objects.map((o) => ({ name: o.name, uri: o.url })),
  });

  const retryResults: Array<{ object: { url: string; name: string }; result: ActivationResult }> = [];
  for (const object of objects) {
    const result = await activateWithinBudget(http, safety, object.url, requestOptions, {
      name: object.name,
      preaudit: options?.preaudit,
    });
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
async function postActivation(http: AdtHttpClient, ...args: Parameters<AdtHttpClient['post']>) {
  try {
    return await http.post(...args);
  } catch (err) {
    if (
      err instanceof AdtNetworkError ||
      (err instanceof AdtApiError && (err.statusCode === 429 || err.isServerError))
    ) {
      err.activationOutcome = 'unknown';
      err.extraHint =
        'If activation was submitted, its completion is unconfirmed; SAP may still finish it. ' +
        'Check SAPRead(type="INACTIVE_OBJECTS") and inspect the object with force_refresh=true before another activation. ' +
        'An active definition alone does not prove that dependent generation has finished.';
    }
    throw err;
  }
}

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
  return {
    success: outcome.kind === 'success',
    messages: outcome.messages,
    details: outcome.details,
    ...(outcome.kind === 'success' && outcome.execution ? { execution: outcome.execution } : {}),
  };
}

export { type PublishResult, publishServiceBinding, unpublishServiceBinding } from './service-publication.js';

/** Run ABAP unit tests for an object and return the canonical structured result. */
export async function runUnitTests(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string | string[],
  opts: { coverage?: boolean; requestOptions?: AdtRequestOptions } = {},
): Promise<AunitRunResult> {
  checkOperation(safety, OperationType.Test, 'RunUnitTests');
  const objectUrls = Array.isArray(objectUrl) ? objectUrl : [objectUrl];
  if (objectUrls.length === 0) throw new Error('ABAP Unit requires at least one object reference.');
  const objectReferences = objectUrls
    .map((url) => `<adtcore:objectReference adtcore:uri="${escapeXmlAttr(url)}"/>`)
    .join('');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<aunit:runConfiguration xmlns:aunit="http://www.sap.com/adt/aunit">
  <external>
    <coverage active="${opts.coverage ? 'true' : 'false'}"/>
  </external>
  <options>
    <uriType value="semantic"/>
    <testDeterminationStrategy sameProgram="true" assignedTests="false" publicApi="false"/>
    <testRiskLevels harmless="true" dangerous="false" critical="false"/>
    <testDurations short="true" medium="true" long="true"/>
  </options>
  <adtcore:objectSets xmlns:adtcore="http://www.sap.com/adt/core">
    <objectSet kind="inclusive">
      <adtcore:objectReferences>
        ${objectReferences}
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
    opts.requestOptions,
  );

  const result = parseAunitRunResult(resp.body);
  if (!opts.coverage) return result;

  // Coverage is a second step: the run result references a coverage measurement, which we POST
  // (with the same object set) to retrieve the statement/branch/procedure aggregate. The endpoint is
  // live-verified on 7.50 + 758 + 816 (2026-06-25); the best-effort fallback (missing URI / fetch
  // failure / no valid metrics → return tests with no coverage) is defensive for unknown systems.
  const measurementUri = extractCoverageMeasurementUri(resp.body);
  if (!measurementUri) {
    return withAunitCoverage(result, undefined, 'measurement_not_reported');
  }
  try {
    const coverageQuery = `<?xml version="1.0" encoding="UTF-8"?>
<cov:query xmlns:cov="http://www.sap.com/adt/cov"><adtcore:objectSets xmlns:adtcore="http://www.sap.com/adt/core"><objectSet kind="inclusive"><adtcore:objectReferences>${objectReferences}</adtcore:objectReferences></objectSet></adtcore:objectSets></cov:query>`;
    const measResp = await http.post(
      measurementUri,
      coverageQuery,
      'application/xml',
      { Accept: 'application/xml' },
      opts.requestOptions,
    );
    const coverage = parseCoverageMeasurement(measResp.body);
    return hasCoverageMetrics(coverage)
      ? withAunitCoverage(result, coverage)
      : withAunitCoverage(result, undefined, 'no_valid_metrics');
  } catch {
    return withAunitCoverage(result, undefined, 'request_failed');
  }
}

/** Extract the coverage-measurement URI from an abapunit testruns result run with coverage="true". */
export function extractCoverageMeasurementUri(testrunsXml: string): string | null {
  const parsed = parseXml(testrunsXml);
  const measurementPrefix = '/sap/bc/adt/runtime/traces/coverage/measurements/';
  for (const node of findDeepNodes(parsed, 'coverage')) {
    const uri = (node as Record<string, unknown>)['@_uri'];
    if (typeof uri !== 'string') continue;
    const canonical = canonicalHostRelativeAdtPath(uri, measurementPrefix);
    if (!canonical || canonical.includes('?')) continue;
    const measurementId = canonical.slice(measurementPrefix.length);
    if (/^[A-Za-z0-9_-]+$/.test(measurementId)) return canonical;
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

export { applyFixProposal, getFixProposals } from './quickfix.js';

// ─── Parsers ────────────────────────────────────────────────────────

/** Discriminated outcome from parsing an activation response. */
export type ActivationOutcome =
  | { kind: 'success'; messages: string[]; details: ActivationMessage[]; execution?: 'activation' | 'generation' }
  | { kind: 'error'; messages: string[]; details: ActivationMessage[] }
  | {
      kind: 'preaudit';
      refs: Array<ActivationReference & { name: string }>;
      messages: string[];
      details: ActivationMessage[];
    };

/** Parse activation response into a discriminated outcome. */
export function parseActivationOutcome(
  xml: string,
  requireExecutionEvidence: boolean | 'function-group-generation' = false,
): ActivationOutcome {
  if (!xml.trim() && !requireExecutionEvidence) return { kind: 'success', messages: [], details: [] };

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
      refs: requireExecutionEvidence
        ? nativeInactiveReferences(xml)
        : inactive.map((r) => ({ uri: r.uri, name: r.name })),
      messages,
      details,
    };
  }

  let execution: 'activation' | 'generation' | undefined;
  if (requireExecutionEvidence) {
    let confirmed = false;
    try {
      if (requireExecutionEvidence === 'function-group-generation') {
        execution = nativeFunctionGroupExecution(xml);
        confirmed = execution !== undefined;
      } else confirmed = nativeActivationExecuted(xml);
    } catch (error) {
      if (!(error instanceof AdtSafetyError)) throw error;
    }
    if (!confirmed) throw new ActivationEvidenceError(messages, details);
  }
  return { kind: 'success', messages, details, ...(execution ? { execution } : {}) };
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
): Array<{ uri: string; name: string; user: string }> {
  const entries = findDeepNodes(parsed, 'entry');
  const out: Array<{ uri: string; name: string; user: string }> = [];
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
export function extractShortText(m: Record<string, unknown>): string {
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

/** Map one native syntax message; shared by single and batch checks. */
export function parseSyntaxMessage(m: Record<string, unknown>): SyntaxMessage {
  const type = String(m['@_type'] ?? '');
  let line = Number.parseInt(String(m['@_line'] ?? '0'), 10);
  let column = Number.parseInt(String(m['@_col'] ?? '0'), 10);
  const uri = String(m['@_uri'] ?? '');
  const startMatch = uri.match(/#start=(\d+),(\d+)/);
  if (startMatch) {
    if (!line) line = Number.parseInt(startMatch[1], 10);
    if (!column) column = Number.parseInt(startMatch[2], 10);
  }
  const code = String(m['@_code'] ?? '');
  const t100 = findDeepNodes(m, 't100Key')[0];
  return {
    severity: type === 'E' ? 'error' : type === 'W' ? 'warning' : 'info',
    text: String(m['@_shortText'] ?? ''),
    line: Number.isFinite(line) ? line : 0,
    column: Number.isFinite(column) ? column : 0,
    ...(uri ? { uri } : {}),
    ...(code ? { code } : {}),
    ...(t100 ? { t100: { id: String(t100['@_msgid'] ?? ''), number: String(t100['@_msgno'] ?? '') } } : {}),
  };
}

function parseSyntaxCheckResult(xml: string, expectedJsonUri?: string): SyntaxCheckResult {
  // JSON candidate checks must prove that SAP processed this object. Keep legacy ABAP responses
  // compatible, but never interpret a login page, truncated XML, or missing report as a clean UIAD.
  if (expectedJsonUri && (Buffer.byteLength(xml) > 256 * 1024 || XMLValidator.validate(xml) !== true)) {
    return { hasErrors: false, messages: [], checked: false, statusText: 'Invalid or oversized JSON check response.' };
  }
  const parsed = parseXml(xml);
  // Two response shapes observed:
  //   - <msg type="E" shortText="..." line="..." col="..."/> (older / some variants)
  //   - <chkrun:checkMessage chkrun:type="E" chkrun:shortText="..." chkrun:uri="...#start=LINE,COL"/>
  //     (NW 7.50 /checkruns response — uri carries the position via #start=line,col)
  const msgs = [...findDeepNodes(parsed, 'msg'), ...findDeepNodes(parsed, 'checkMessage')];
  const messages = msgs.map(parseSyntaxMessage);

  // SAP reports refusal to check via <chkrun:checkReport chkrun:status="notProcessed"
  // chkrun:statusText="Resource CLASS ZCL_X does not exist."/> — with zero messages, which would
  // otherwise read as "clean". Legacy <msg> shapes carry no report → treat as checked.
  const reports = findDeepNodes(parsed, 'checkReport');
  // An empty native envelope is missing evidence, not the legacy message-only success shape.
  const emptyNativeReport = Object.hasOwn(parsed, 'checkRunReports') && reports.length === 0 && msgs.length === 0;
  const unprocessed = reports.find((r) => r['@_status'] && String(r['@_status']) !== 'processed');
  const jsonReportValid =
    !expectedJsonUri ||
    (parsed.checkRunReports !== undefined &&
      reports.length === 1 &&
      reports[0]['@_status'] === 'processed' &&
      reports[0]['@_reporter'] === 'abapCheckRun' &&
      String(reports[0]['@_triggeringUri'] ?? '').toLowerCase() === expectedJsonUri.toLowerCase() &&
      msgs.every((m) => ['E', 'W', 'I'].includes(String(m['@_type'] ?? ''))));

  return {
    hasErrors: messages.some((m) => m.severity === 'error'),
    messages,
    checked: !unprocessed && jsonReportValid && !emptyNativeReport,
    ...(emptyNativeReport ? { statusText: 'SAP returned no syntax-check report or messages.' } : {}),
    ...(unprocessed ? { statusText: String(unprocessed['@_statusText'] ?? '') } : {}),
    ...(!jsonReportValid && !unprocessed
      ? { statusText: 'SAP did not return a processed JSON candidate check for this object.' }
      : {}),
  };
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

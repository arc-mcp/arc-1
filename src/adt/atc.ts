/** ABAP Test Cockpit worklist execution and completeness-aware parsing. */

import { AdtApiError, AdtNetworkError } from './errors.js';
import type { AdtHttpClient, AdtResponse } from './http.js';
import type { AdtRequestOptions } from './http-deadline.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { escapeXmlAttr, type NamedItem, parseAtcSystemCheckVariant, parseNamedItems, parseXml } from './xml-parser.js';

export interface AtcFinding {
  priority: number;
  checkTitle: string;
  messageTitle: string;
  uri: string;
  line: number;
  quickfixInfo?: string;
  hasQuickfix?: boolean;
}

/**
 * How the check variant bound at worklist creation was chosen.
 *
 * `requestedUnverified` = the caller named it, but `/atc/variants` was unreachable, so ARC-1 could
 * not confirm SAP will honour the name rather than silently substituting `DEFAULT`.
 */
export type AtcVariantSource = 'requested' | 'requestedUnverified' | 'systemDefault' | 'sapFallback';

export interface AtcRunInfo {
  type: string;
  description: string;
}

export interface AtcFindingStatistics {
  errors: number;
  warnings: number;
  infos: number;
  total: number;
}

export type AtcCompletionEvidence = 'asyncRunCompleted' | 'legacyWorklistSettled';

export interface AtcRunResult {
  findings: AtcFinding[];
  worklistId: string;
  /** The variant actually bound at worklist creation; null only when none could be sent. */
  variant: string | null;
  variantSource: AtcVariantSource;
  maximumVerdicts: number;
  /**
   * @deprecated Informational compatibility alias for `findingStatistics.total`. SAP does not
   * define this value as the exact number of findings that must appear in the worklist.
   */
  expectedFindingCount: number | null;
  findingStatistics: AtcFindingStatistics | null;
  findingCount: number;
  processedObjectCount: number;
  objectSetIsComplete: boolean | null;
  truncated: boolean;
  complete: boolean;
  completionEvidence: AtcCompletionEvidence | null;
  incompleteReasons: string[];
  runStatusCode: number;
  runStatus: string | null;
  runInfos: AtcRunInfo[];
  worklist: {
    id: string;
    timestamp?: string;
    usedObjectSet?: string;
    status?: string;
  };
  infos: string[];
}

export interface AtcPollOptions {
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

const DEFAULT_ATC_TIMEOUT_MS = 300_000;
const DEFAULT_ATC_POLL_DELAY_MS = 250;
const DEFAULT_ATC_MAX_POLL_DELAY_MS = 2_000;
const ATC_RUN_STATUS_PREFIX = '/sap/bc/adt/atc/runs/';
const ATC_RUN_STATUS_MEDIA_TYPE = 'application/vnd.sap.atc.run.v1+xml';
/**
 * Fallback quiet interval when SAP returns a synchronous run without a status location.
 *
 * A live 758 worklist grew from 23 findings/two objects to 73/ten after already reporting
 * `objectSetIsComplete=true`, so neither that flag nor a few fast count snapshots are terminal
 * evidence. Modern systems instead expose the terminal run status requested with
 * `clientWait=false`. Ten seconds spans at least five intervals at the default 2 s backoff cap.
 * SAP also advances the root worklist timestamp on unchanged GETs, so that proven volatile
 * attribute is excluded from the comparison.
 * See docs/research/2026-08-20-atc-completeness-polling.md.
 */
const ATC_SETTLE_QUIET_MS = 10_000;

/** Compare the complete wire response except SAP's per-GET root worklist timestamp. */
function atcWorklistSettleObservation(xml: string): string {
  return xml.replace(/<(?:[A-Za-z_][\w.-]*:)?worklist\b[^>]*>/, (rootStart) =>
    rootStart.replace(/\s+(?:[A-Za-z_][\w.-]*:)?timestamp\s*=\s*(?:"[^"]*"|'[^']*')/, ''),
  );
}

/** List the valid ATC check variants. */
export async function listAtcVariants(
  http: AdtHttpClient,
  safety: SafetyConfig,
  filter = '*',
  options?: AdtRequestOptions,
): Promise<NamedItem[]> {
  checkOperation(safety, OperationType.Read, 'ListAtcVariants');
  const pattern = filter.trim() || '*';
  const resp = await http.get(
    `/sap/bc/adt/atc/variants?name=${encodeURIComponent(pattern)}`,
    { Accept: 'application/vnd.sap.adt.nameditems.v1+xml' },
    options,
  );
  return parseNamedItems(resp.body).filter((item) => item.name);
}

/** Read the system default ATC check variant. */
export async function getAtcSystemDefaultVariant(
  http: AdtHttpClient,
  safety: SafetyConfig,
  options?: AdtRequestOptions,
): Promise<string | undefined> {
  checkOperation(safety, OperationType.Read, 'GetAtcCustomizing');
  const resp = await http.get('/sap/bc/adt/atc/customizing', { Accept: 'application/xml' }, options);
  return parseAtcSystemCheckVariant(resp.body);
}

/**
 * Decide which check variant to bind at worklist creation.
 *
 * SAP does NOT apply `systemCheckVariant` when `checkVariant` is empty — it runs the Code Inspector
 * variant literally named `DEFAULT` (measured on two independent 758 systems; see
 * docs/research/2026-08-19-atc-default-check-variant.md). SAP's own adt-ls resolves the default
 * client-side too, so ARC-1 sends it explicitly.
 *
 * Runs under the caller's ATC request budget (`requestOptions`) — these pre-flight GETs must honour
 * the same deadline and abort signal as the worklist calls.
 */
async function resolveCheckVariant(
  http: AdtHttpClient,
  safety: SafetyConfig,
  requestedRaw: string | undefined,
  requestOptions: AdtRequestOptions,
): Promise<{ variant: string | undefined; variantSource: AtcVariantSource }> {
  const requested = requestedRaw?.trim() ? requestedRaw.trim() : undefined;
  if (requested) {
    // An unknown name is not rejected by SAP — the worklist silently binds DEFAULT and the run looks
    // successful. Fail open: a validation lookup must never break a working ATC run.
    let known: NamedItem[] | undefined;
    try {
      known = await listAtcVariants(http, safety, requested, requestOptions);
    } catch {
      // best-effort-validation: endpoint absent, auth, or network — run with the caller's string,
      // but say so: SAP may still substitute DEFAULT and we did not get to check.
      return { variant: requested, variantSource: 'requestedUnverified' };
    }
    const match = known.find((item) => item.name.toLowerCase() === requested.toLowerCase());
    if (!match) {
      throw new AdtApiError(
        `Check variant "${requested}" does not exist on this system — SAP would silently run "DEFAULT" instead. ` +
          'List variants with SAPDiagnose(action="atc_variants").',
        400,
        '/sap/bc/adt/atc/variants',
      );
    }
    // Send the canonical name: SAP's lookup is case-sensitive, so a lowercase input would fall back too.
    return { variant: match.name, variantSource: 'requested' };
  }

  const systemDefault = await getAtcSystemDefaultVariant(http, safety, requestOptions).catch((error) => {
    // Only "endpoint absent / not negotiable" degrades; 401/403/5xx must surface.
    if (error instanceof AdtApiError && (error.statusCode === 404 || error.statusCode === 406)) return undefined;
    throw error;
  });
  return systemDefault
    ? { variant: systemDefault, variantSource: 'systemDefault' }
    : { variant: undefined, variantSource: 'sapFallback' };
}

/** Run an ATC worklist and preserve terminal, structural, and informational evidence for CI. */
export async function runAtcCheck(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  variant?: string,
  pollOptions: AtcPollOptions = {},
): Promise<AtcRunResult> {
  checkOperation(safety, OperationType.Read, 'RunATCCheck');
  const now = pollOptions.now ?? Date.now;
  const timeoutMs = pollOptions.timeoutMs ?? DEFAULT_ATC_TIMEOUT_MS;
  const deadline = now() + timeoutMs;
  const requestOptions: AdtRequestOptions = {
    deadline,
    fetchTimeoutMs: timeoutMs,
    signal: pollOptions.signal,
  };
  const { variant: effectiveVariant, variantSource } = await resolveCheckVariant(http, safety, variant, requestOptions);
  const worklistPath = effectiveVariant
    ? `/sap/bc/adt/atc/worklists?checkVariant=${encodeURIComponent(effectiveVariant)}`
    : '/sap/bc/adt/atc/worklists';
  const worklistResp = await http.post(worklistPath, '', 'application/xml', { Accept: 'text/plain' }, requestOptions);
  const worklistId = worklistResp.body.trim();
  if (!worklistId) {
    throw new AdtApiError('ATC worklist creation returned no worklist id; cannot run ATC checks.', 500, worklistPath);
  }

  const maximumVerdicts = 100;
  const runBody = `<?xml version="1.0" encoding="UTF-8"?>
<atc:run xmlns:atc="http://www.sap.com/adt/atc" maximumVerdicts="${maximumVerdicts}">
  <objectSets xmlns:adtcore="http://www.sap.com/adt/core">
    <objectSet kind="inclusive">
      <adtcore:objectReferences>
        <adtcore:objectReference adtcore:uri="${escapeXmlAttr(objectUrl)}"/>
      </adtcore:objectReferences>
    </objectSet>
  </objectSets>
</atc:run>`;
  let runResp: AdtResponse;
  try {
    runResp = await http.post(
      `/sap/bc/adt/atc/runs?worklistId=${encodeURIComponent(worklistId)}&clientWait=false`,
      runBody,
      'application/xml',
      { Accept: 'application/xml' },
      requestOptions,
    );
  } catch (error) {
    if (isAtcDeadlineFailure(error)) {
      return incompleteAtcResult(
        {
          worklistId,
          variant: effectiveVariant,
          variantSource,
          maximumVerdicts,
          findingStatistics: null,
          runInfos: [],
          runStatusCode: 0,
          runStatus: null,
          completionEvidence: null,
        },
        'ATC execution timed out.',
      );
    }
    throw error;
  }
  const runInfos = parseAtcRunInfos(runResp.body);
  const findingStatistics = parseAtcFindingStatistics(runInfos);
  const baseContext: AtcResultContext = {
    worklistId,
    variant: effectiveVariant,
    variantSource,
    maximumVerdicts,
    findingStatistics,
    runInfos,
    runStatusCode: runResp.statusCode,
    runStatus: null,
    completionEvidence: null,
  };
  const sleep = pollOptions.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let delayMs = pollOptions.initialDelayMs ?? DEFAULT_ATC_POLL_DELAY_MS;
  const maxDelayMs = pollOptions.maxDelayMs ?? DEFAULT_ATC_MAX_POLL_DELAY_MS;
  const rawRunLocation = responseHeader(runResp, 'location');

  if (rawRunLocation !== undefined) {
    const runStatusPath = canonicalAtcRunStatusPath(rawRunLocation);
    if (!runStatusPath) {
      return incompleteAtcResult(baseContext, 'SAP returned an unsafe or malformed ATC run-status location.');
    }

    let runStatus: string | null = null;
    while (true) {
      let statusResp: AdtResponse;
      try {
        statusResp = await http.get(runStatusPath, { Accept: ATC_RUN_STATUS_MEDIA_TYPE }, requestOptions);
      } catch (error) {
        if (isAtcDeadlineFailure(error)) {
          return incompleteAtcResult(
            { ...baseContext, runStatus },
            'ATC run-status polling timed out before SAP completed the run.',
          );
        }
        throw error;
      }
      runStatus = parseAtcRunStatus(statusResp.body);
      if (!runStatus) {
        return incompleteAtcResult(
          { ...baseContext, runStatus },
          'SAP returned an ATC run-status response without one valid status.',
        );
      }
      if (isAtcRunCompleted(runStatus)) break;
      if (!isAtcRunPending(runStatus)) {
        return incompleteAtcResult(
          { ...baseContext, runStatus },
          `SAP ended the ATC run with status "${runStatus}" instead of "Completed".`,
        );
      }
      if (now() >= deadline) {
        return incompleteAtcResult(
          { ...baseContext, runStatus },
          'ATC run-status polling reached the request deadline before SAP completed the run.',
        );
      }
      await sleep(Math.min(delayMs, Math.max(0, deadline - now())));
      if (now() >= deadline) {
        return incompleteAtcResult(
          { ...baseContext, runStatus },
          'ATC run-status polling reached the request deadline before SAP completed the run.',
        );
      }
      delayMs = Math.min(maxDelayMs, delayMs * 2);
    }

    const completedContext: AtcResultContext = {
      ...baseContext,
      runStatus,
      completionEvidence: 'asyncRunCompleted',
    };
    try {
      const resultResp = await http.get(
        `/sap/bc/adt/atc/worklists/${encodeURIComponent(worklistId)}`,
        { Accept: 'application/atc.worklist.v1+xml' },
        requestOptions,
      );
      return parseAtcRunResult(resultResp.body, completedContext);
    } catch (error) {
      if (isAtcDeadlineFailure(error)) {
        return incompleteAtcResult(
          completedContext,
          'ATC completed, but worklist retrieval timed out before SAP returned the result.',
        );
      }
      throw error;
    }
  }

  if (runResp.statusCode !== 200) {
    return incompleteAtcResult(
      baseContext,
      `SAP returned asynchronous ATC status ${runResp.statusCode} without a run-status location.`,
    );
  }

  // Older systems return the completed run synchronously without a status location. The worklist
  // may still populate after the POST returns, so retain the proven full-response quiet interval.
  let result: AtcRunResult | undefined;
  let resultXml: string | undefined;
  let lastWorklistObservation: string | undefined;
  let unchangedSince: number | undefined;

  while (true) {
    let resultResp: AdtResponse;
    try {
      resultResp = await http.get(
        `/sap/bc/adt/atc/worklists/${encodeURIComponent(worklistId)}`,
        { Accept: 'application/atc.worklist.v1+xml' },
        requestOptions,
      );
    } catch (error) {
      if (isAtcDeadlineFailure(error)) {
        return (
          result ??
          incompleteAtcResult(baseContext, 'ATC worklist polling timed out before SAP returned the first snapshot.')
        );
      }
      throw error;
    }
    resultXml = resultResp.body;
    result = parseAtcRunResult(resultXml, baseContext);
    // Counts alone miss same-count replacements and other response-evidence changes. Compare the
    // full XML except the root timestamp, which live 758 advances on otherwise identical GETs.
    const observedAt = now();
    const observation = atcWorklistSettleObservation(resultResp.body);
    if (observation !== lastWorklistObservation) {
      lastWorklistObservation = observation;
      unchangedSince = observedAt;
    }
    const unchangedForMs = unchangedSince === undefined ? 0 : observedAt - unchangedSince;
    const settled = unchangedForMs >= ATC_SETTLE_QUIET_MS;
    if (settled || observedAt >= deadline) {
      if (settled) {
        result = parseAtcRunResult(resultXml, {
          ...baseContext,
          completionEvidence: 'legacyWorklistSettled',
        });
      }
      if (settled && !result.complete) {
        result.incompleteReasons.push(
          `ATC worklist response, excluding SAP's poll timestamp, was unchanged for at least ` +
            `${ATC_SETTLE_QUIET_MS / 1_000} seconds at ` +
            `${result.findingCount} finding(s) over ${result.processedObjectCount} object(s) without satisfying ` +
            "SAP's completeness evidence; returning the settled result.",
        );
      }
      return result;
    }
    await sleep(Math.min(delayMs, Math.max(0, deadline - now())));
    if (now() >= deadline) return result;
    delayMs = Math.min(maxDelayMs, delayMs * 2);
  }
}

function isAtcDeadlineFailure(error: unknown): boolean {
  return (
    error instanceof AdtNetworkError &&
    (error.cause?.name === 'TimeoutError' || /deadline was exceeded|timed out|\btimeout\b/i.test(error.message))
  );
}

interface AtcResultContext {
  worklistId: string;
  variant?: string;
  variantSource: AtcVariantSource;
  maximumVerdicts: number;
  findingStatistics: AtcFindingStatistics | null;
  runInfos: AtcRunInfo[];
  runStatusCode: number;
  runStatus: string | null;
  completionEvidence: AtcCompletionEvidence | null;
}

function incompleteAtcResult(context: AtcResultContext, reason: string): AtcRunResult {
  return {
    findings: [],
    worklistId: context.worklistId,
    variant: context.variant ?? null,
    variantSource: context.variantSource,
    maximumVerdicts: context.maximumVerdicts,
    expectedFindingCount: context.findingStatistics?.total ?? null,
    findingStatistics: context.findingStatistics,
    findingCount: 0,
    processedObjectCount: 0,
    objectSetIsComplete: null,
    truncated: false,
    complete: false,
    completionEvidence: context.completionEvidence,
    incompleteReasons: [reason],
    runStatusCode: context.runStatusCode,
    runStatus: context.runStatus,
    runInfos: context.runInfos,
    worklist: { id: context.worklistId },
    infos: [],
  };
}

function nodeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function nodeValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function nodeRecords(value: unknown): Record<string, unknown>[] {
  return nodeValues(value).filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

function nodeText(value: unknown): string {
  const first = nodeValues(value)[0];
  if (first == null) return '';
  if (typeof first !== 'object') return String(first).trim();
  return String((first as Record<string, unknown>)['#text'] ?? '').trim();
}

function responseHeader(response: AdtResponse, name: string): string | undefined {
  const match = Object.entries(response.headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1];
}

function canonicalAtcRunStatusPath(rawPath: string): string | null {
  const canonical = canonicalHostRelativeAdtPath(rawPath, ATC_RUN_STATUS_PREFIX);
  if (!canonical || canonical.includes('?')) return null;
  const runId = canonical.slice(ATC_RUN_STATUS_PREFIX.length);
  return runId && !runId.includes('/') ? canonical : null;
}

function parseAtcRunStatus(xml: string): string | null {
  const roots = nodeRecords(parseXml(xml).run);
  if (roots.length !== 1) return null;
  const status = typeof roots[0]?.['@_status'] === 'string' ? roots[0]['@_status'].trim() : '';
  return status || null;
}

function normalizedAtcRunStatus(status: string): string {
  return status.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isAtcRunCompleted(status: string): boolean {
  return ['completed', 'finished'].includes(normalizedAtcRunStatus(status));
}

function isAtcRunPending(status: string): boolean {
  return ['not yet started', 'running'].includes(normalizedAtcRunStatus(status));
}

function parseAtcRunInfos(xml: string): AtcRunInfo[] {
  if (!xml.trim()) return [];
  const root = nodeRecord(parseXml(xml).worklistRun);
  const infos = nodeRecords(root?.infos).flatMap((container) => nodeRecords(container.info));
  return infos
    .map((info) => ({ type: nodeText(info.type), description: nodeText(info.description) }))
    .filter((info) => info.type || info.description);
}

function parseAtcFindingStatistics(runInfos: AtcRunInfo[]): AtcFindingStatistics | null {
  const stats = runInfos.find((info) => info.type.toUpperCase() === 'FINDING_STATS');
  const parts = (stats?.description ?? '').split(',').map((part) => Number(part.trim()));
  if (parts.length !== 3 || !parts.every((part) => Number.isSafeInteger(part) && part >= 0)) return null;
  const [errors, warnings, infos] = parts as [number, number, number];
  return { errors, warnings, infos, total: errors + warnings + infos };
}

function isValidProcessedObject(object: Record<string, unknown>): boolean {
  const uri = typeof object['@_uri'] === 'string' ? object['@_uri'].trim() : '';
  const type = typeof object['@_type'] === 'string' ? object['@_type'].trim() : '';
  const name = typeof object['@_name'] === 'string' ? object['@_name'].trim() : '';
  return (
    uri.length > 0 &&
    canonicalHostRelativeAdtPath(uri, '/sap/bc/adt/', { allowRawEncodedSlash: true }) !== null &&
    type.length > 0 &&
    name.length > 0
  );
}

function parseAtcFinding(finding: Record<string, unknown>): AtcFinding {
  const rawUri = String(finding['@_location'] ?? finding['@_uri'] ?? '');
  let line = 0;
  const startIdx = rawUri.indexOf('#start=');
  if (startIdx !== -1) {
    const firstNum = Number.parseInt(rawUri.slice(startIdx + '#start='.length).split(',')[0]!, 10);
    if (!Number.isNaN(firstNum)) line = firstNum;
  }

  const quickfixInfoRaw = finding['@_quickfixInfo'];
  const quickfixNode = nodeRecord(finding.quickfixes);
  const quickfixKinds = ['manual', 'automatic', 'pseudo'];
  return {
    priority: Number(String(finding['@_priority'] ?? '')),
    checkTitle: String(finding['@_checkTitle'] ?? ''),
    messageTitle: String(finding['@_messageTitle'] ?? ''),
    uri: rawUri,
    line,
    ...(quickfixInfoRaw == null ? {} : { quickfixInfo: String(quickfixInfoRaw) }),
    hasQuickfix: quickfixKinds.some((kind) => String(quickfixNode?.[`@_${kind}`] ?? 'false').toLowerCase() === 'true'),
  };
}

function parseAtcFindings(root: Record<string, unknown>, objectRows: Record<string, unknown>[]): AtcFinding[] {
  const objectFindings = objectRows.flatMap((object) =>
    nodeRecords(object.findings).flatMap((container) => nodeRecords(container.finding)),
  );
  // Root-level findings are retained for older/minimal response shapes, but arbitrary nested
  // metadata is never searched as worklist evidence.
  return [...objectFindings, ...nodeRecords(root.finding)].map(parseAtcFinding);
}

function parseAtcInfos(root: Record<string, unknown>): string[] {
  return nodeRecords(root.infos)
    .flatMap((container) => nodeValues(container.info))
    .map((value) => {
      const node = nodeRecord(value);
      if (!node) return String(value ?? '').trim();
      const attribute = ['message', 'text', 'description', 'title']
        .map((key) => node[`@_${key}`])
        .find((entry) => entry != null);
      return String(attribute ?? node['#text'] ?? '').trim();
    })
    .filter(Boolean);
}

function parseAtcRunResult(xml: string, context: AtcResultContext): AtcRunResult {
  const parsed = parseXml(xml);
  const rawRootNodes = nodeValues(parsed.worklist);
  const rootNodes = nodeRecords(parsed.worklist);
  const rootShapeIsValid = rawRootNodes.length === 1 && rootNodes.length === 1;
  const root = rootShapeIsValid ? rootNodes[0]! : {};
  const completenessRaw = root['@_objectSetIsComplete'];
  const objectSetIsComplete = completenessRaw == null ? null : String(completenessRaw).trim().toLowerCase() === 'true';
  const rawObjectContainers = nodeValues(root.objects);
  const objectContainers = nodeRecords(root.objects);
  const objectContainerShapeIsValid = rawObjectContainers.length === 1 && objectContainers.length === 1;
  const rawObjectValue = objectContainerShapeIsValid ? objectContainers[0]!.object : undefined;
  const rawObjectRows = nodeValues(rawObjectValue);
  const objectRows = nodeRecords(rawObjectValue);
  const findings = parseAtcFindings(root, objectRows);
  const validObjectRows = objectRows.filter(isValidProcessedObject);
  const processedObjectCount = validObjectRows.length;
  const malformedObjectCount = rawObjectRows.length - validObjectRows.length;
  const bodyWorklistId = typeof root['@_id'] === 'string' ? root['@_id'].trim() : '';
  const worklistIdMatches = bodyWorklistId.length > 0 && bodyWorklistId === context.worklistId;
  const invalidPriorityCount = findings.filter(
    (finding) => !Number.isInteger(finding.priority) || finding.priority <= 0,
  ).length;
  const incompleteReasons: string[] = [];
  if (!rootShapeIsValid) incompleteReasons.push('SAP did not provide one valid ATC worklist root.');
  if (!bodyWorklistId) {
    incompleteReasons.push('SAP worklist response did not provide the created worklist id.');
  } else if (!worklistIdMatches) {
    incompleteReasons.push('SAP worklist response id does not match the created worklist id.');
  }
  if (objectSetIsComplete !== true) {
    incompleteReasons.push(
      objectSetIsComplete === false
        ? 'SAP marked the ATC object set incomplete.'
        : 'SAP did not provide object-set completeness evidence.',
    );
  }
  if (context.completionEvidence === null) incompleteReasons.push('SAP did not provide terminal ATC run evidence.');
  if (!objectContainerShapeIsValid) {
    incompleteReasons.push('SAP did not provide one schema-scoped ATC objects container.');
  }
  if (processedObjectCount === 0) incompleteReasons.push('SAP did not report any processed ATC object.');
  if (malformedObjectCount > 0) {
    incompleteReasons.push(`${malformedObjectCount} malformed processed ATC object row(s) were ignored.`);
  }
  if (invalidPriorityCount > 0) {
    incompleteReasons.push(`${invalidPriorityCount} ATC finding(s) had a missing or malformed priority.`);
  }
  const infos = parseAtcInfos(root);

  return {
    findings,
    worklistId: context.worklistId,
    variant: context.variant ?? null,
    variantSource: context.variantSource,
    maximumVerdicts: context.maximumVerdicts,
    expectedFindingCount: context.findingStatistics?.total ?? null,
    findingStatistics: context.findingStatistics,
    findingCount: findings.length,
    processedObjectCount,
    objectSetIsComplete,
    truncated: false,
    complete:
      rootShapeIsValid &&
      worklistIdMatches &&
      objectSetIsComplete === true &&
      context.completionEvidence !== null &&
      objectContainerShapeIsValid &&
      processedObjectCount > 0 &&
      malformedObjectCount === 0 &&
      invalidPriorityCount === 0,
    completionEvidence: context.completionEvidence,
    incompleteReasons,
    runStatusCode: context.runStatusCode,
    runStatus: context.runStatus,
    runInfos: context.runInfos,
    worklist: {
      id: bodyWorklistId,
      ...(root['@_timestamp'] ? { timestamp: String(root['@_timestamp']) } : {}),
      ...(root['@_usedObjectSet'] ? { usedObjectSet: String(root['@_usedObjectSet']) } : {}),
      ...(root['@_status'] || root['@_state'] ? { status: String(root['@_status'] ?? root['@_state']) } : {}),
    },
    infos,
  };
}

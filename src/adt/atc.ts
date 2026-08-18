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

export interface AtcRunResult {
  findings: AtcFinding[];
  worklistId: string;
  variant: string | null;
  maximumVerdicts: number;
  expectedFindingCount: number | null;
  findingCount: number;
  processedObjectCount: number;
  objectSetIsComplete: boolean | null;
  truncated: boolean;
  complete: boolean;
  incompleteReasons: string[];
  runStatusCode: number;
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

/** List the valid ATC check variants. */
export async function listAtcVariants(http: AdtHttpClient, safety: SafetyConfig, filter = '*'): Promise<NamedItem[]> {
  checkOperation(safety, OperationType.Read, 'ListAtcVariants');
  const pattern = filter.trim() || '*';
  const resp = await http.get(`/sap/bc/adt/atc/variants?name=${encodeURIComponent(pattern)}`, {
    Accept: 'application/vnd.sap.adt.nameditems.v1+xml',
  });
  return parseNamedItems(resp.body).filter((item) => item.name);
}

/** Read the system default ATC check variant. */
export async function getAtcSystemDefaultVariant(
  http: AdtHttpClient,
  safety: SafetyConfig,
): Promise<string | undefined> {
  checkOperation(safety, OperationType.Read, 'GetAtcCustomizing');
  const resp = await http.get('/sap/bc/adt/atc/customizing', { Accept: 'application/xml' });
  return parseAtcSystemCheckVariant(resp.body);
}

/** Run an ATC worklist and preserve the evidence required for a CI verdict. */
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
  const worklistPath = variant
    ? `/sap/bc/adt/atc/worklists?checkVariant=${encodeURIComponent(variant)}`
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
      `/sap/bc/adt/atc/runs?worklistId=${encodeURIComponent(worklistId)}`,
      runBody,
      'application/xml',
      { Accept: 'application/xml' },
      requestOptions,
    );
  } catch (error) {
    if (isAtcDeadlineFailure(error)) {
      return incompleteAtcResult(worklistId, variant, maximumVerdicts, null, 0, 'ATC execution timed out.');
    }
    throw error;
  }
  const expectedFindingCount = parseAtcFindingStats(runResp.body);
  const sleep = pollOptions.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let delayMs = pollOptions.initialDelayMs ?? DEFAULT_ATC_POLL_DELAY_MS;
  const maxDelayMs = pollOptions.maxDelayMs ?? DEFAULT_ATC_MAX_POLL_DELAY_MS;
  let result: AtcRunResult | undefined;

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
          incompleteAtcResult(
            worklistId,
            variant,
            maximumVerdicts,
            expectedFindingCount,
            runResp.statusCode,
            'ATC worklist polling timed out before SAP returned the first snapshot.',
          )
        );
      }
      throw error;
    }
    result = parseAtcRunResult(resultResp.body, {
      worklistId,
      variant,
      maximumVerdicts,
      expectedFindingCount,
      runStatusCode: runResp.statusCode,
    });
    if (
      expectedFindingCount === null ||
      result.complete ||
      result.findingCount > expectedFindingCount ||
      now() >= deadline
    ) {
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

function incompleteAtcResult(
  worklistId: string,
  variant: string | undefined,
  maximumVerdicts: number,
  expectedFindingCount: number | null,
  runStatusCode: number,
  reason: string,
): AtcRunResult {
  return {
    findings: [],
    worklistId,
    variant: variant ?? null,
    maximumVerdicts,
    expectedFindingCount,
    findingCount: 0,
    processedObjectCount: 0,
    objectSetIsComplete: null,
    truncated: expectedFindingCount !== null && expectedFindingCount > 0,
    complete: false,
    incompleteReasons: [reason],
    runStatusCode,
    worklist: { id: worklistId },
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

function parseAtcFindingStats(xml: string): number | null {
  const root = nodeRecord(parseXml(xml).worklistRun);
  const infos = nodeRecords(root?.infos).flatMap((container) => nodeRecords(container.info));
  const stats = infos.find((info) => nodeText(info.type).toUpperCase() === 'FINDING_STATS');
  const parts = nodeText(stats?.description)
    .split(',')
    .map((part) => Number(part.trim()));
  return parts.length === 3 && parts.every((part) => Number.isSafeInteger(part) && part >= 0)
    ? parts.reduce((sum, part) => sum + part, 0)
    : null;
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

function parseAtcRunResult(
  xml: string,
  context: {
    worklistId: string;
    variant?: string;
    maximumVerdicts: number;
    expectedFindingCount: number | null;
    runStatusCode: number;
  },
): AtcRunResult {
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
  const truncated = context.expectedFindingCount !== null && findings.length < context.expectedFindingCount;
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
  if (context.expectedFindingCount === null) {
    incompleteReasons.push('SAP did not provide valid ATC finding-count evidence for this run.');
  } else if (findings.length !== context.expectedFindingCount) {
    incompleteReasons.push(
      findings.length < context.expectedFindingCount
        ? `ATC worklist has ${findings.length} of ${context.expectedFindingCount} findings reported by the run.`
        : `ATC worklist has ${findings.length} findings, exceeding the ${context.expectedFindingCount} reported by the run.`,
    );
  }
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
    maximumVerdicts: context.maximumVerdicts,
    expectedFindingCount: context.expectedFindingCount,
    findingCount: findings.length,
    processedObjectCount,
    objectSetIsComplete,
    truncated,
    complete:
      rootShapeIsValid &&
      worklistIdMatches &&
      objectSetIsComplete === true &&
      !truncated &&
      context.expectedFindingCount !== null &&
      findings.length === context.expectedFindingCount &&
      objectContainerShapeIsValid &&
      processedObjectCount > 0 &&
      malformedObjectCount === 0 &&
      invalidPriorityCount === 0,
    incompleteReasons,
    runStatusCode: context.runStatusCode,
    worklist: {
      id: bodyWorklistId,
      ...(root['@_timestamp'] ? { timestamp: String(root['@_timestamp']) } : {}),
      ...(root['@_usedObjectSet'] ? { usedObjectSet: String(root['@_usedObjectSet']) } : {}),
      ...(root['@_status'] || root['@_state'] ? { status: String(root['@_status'] ?? root['@_state']) } : {}),
    },
    infos,
  };
}

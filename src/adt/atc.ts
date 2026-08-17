/** ABAP Test Cockpit worklist execution and completeness-aware parsing. */

import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { isCanonicalHostRelativeAdtPath } from './path-safety.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import {
  escapeXmlAttr,
  findDeepNodes,
  type NamedItem,
  parseAtcSystemCheckVariant,
  parseNamedItems,
  parseXml,
} from './xml-parser.js';

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
): Promise<AtcRunResult> {
  checkOperation(safety, OperationType.Read, 'RunATCCheck');
  const worklistPath = variant
    ? `/sap/bc/adt/atc/worklists?checkVariant=${encodeURIComponent(variant)}`
    : '/sap/bc/adt/atc/worklists';
  const worklistResp = await http.post(worklistPath, '', 'application/xml', { Accept: 'text/plain' });
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
  const runResp = await http.post(
    `/sap/bc/adt/atc/runs?worklistId=${encodeURIComponent(worklistId)}`,
    runBody,
    'application/xml',
    { Accept: 'application/xml' },
  );
  const resultResp = await http.get(`/sap/bc/adt/atc/worklists/${encodeURIComponent(worklistId)}`, {
    Accept: 'application/atc.worklist.v1+xml',
  });
  return parseAtcRunResult(resultResp.body, {
    worklistId,
    variant,
    maximumVerdicts,
    runStatusCode: runResp.statusCode,
  });
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

function isValidProcessedObject(object: Record<string, unknown>): boolean {
  const uri = typeof object['@_uri'] === 'string' ? object['@_uri'].trim() : '';
  const type = typeof object['@_type'] === 'string' ? object['@_type'].trim() : '';
  const name = typeof object['@_name'] === 'string' ? object['@_name'].trim() : '';
  return uri.length > 0 && isCanonicalHostRelativeAdtPath(uri) && type.length > 0 && name.length > 0;
}

function parseAtcFindings(xml: string): AtcFinding[] {
  const parsed = parseXml(xml);
  return findDeepNodes(parsed, 'finding').map((finding) => {
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
      hasQuickfix: quickfixKinds.some(
        (kind) => String(quickfixNode?.[`@_${kind}`] ?? 'false').toLowerCase() === 'true',
      ),
    };
  });
}

function parseAtcRunResult(
  xml: string,
  context: { worklistId: string; variant?: string; maximumVerdicts: number; runStatusCode: number },
): AtcRunResult {
  const parsed = parseXml(xml);
  const rawRootNodes = nodeValues(parsed.worklist);
  const rootNodes = nodeRecords(parsed.worklist);
  const rootShapeIsValid = rawRootNodes.length === 1 && rootNodes.length === 1;
  const root = rootShapeIsValid ? rootNodes[0]! : {};
  const findings = parseAtcFindings(xml);
  const completenessRaw = root['@_objectSetIsComplete'];
  const objectSetIsComplete = completenessRaw == null ? null : String(completenessRaw).trim().toLowerCase() === 'true';
  const truncated = findings.length >= context.maximumVerdicts;
  const rawObjectContainers = nodeValues(root.objects);
  const objectContainers = nodeRecords(root.objects);
  const objectContainerShapeIsValid = rawObjectContainers.length === 1 && objectContainers.length === 1;
  const rawObjectValue = objectContainerShapeIsValid ? objectContainers[0]!.object : undefined;
  const rawObjectRows = nodeValues(rawObjectValue);
  const objectRows = nodeRecords(rawObjectValue);
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
  if (truncated) incompleteReasons.push(`ATC reached the ${context.maximumVerdicts}-verdict response cap.`);
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
  const infos = findDeepNodes(parsed, 'info')
    .map((node) => {
      const attribute = ['message', 'text', 'description', 'title']
        .map((key) => node[`@_${key}`])
        .find((value) => value != null);
      return String(attribute ?? node['#text'] ?? '').trim();
    })
    .filter(Boolean);

  return {
    findings,
    worklistId: context.worklistId,
    variant: context.variant ?? null,
    maximumVerdicts: context.maximumVerdicts,
    findingCount: findings.length,
    processedObjectCount,
    objectSetIsComplete,
    truncated,
    complete:
      rootShapeIsValid &&
      worklistIdMatches &&
      objectSetIsComplete === true &&
      !truncated &&
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

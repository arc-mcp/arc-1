/** Shared native quickfix evaluation/application. Application returns deltas; it never saves source. */
import { AdtApiError, AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import type { preparePinnedQuickfix, QuickfixApplicationProfile } from './pinned-quickfix.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { FixAffectedObject, FixDelta, FixProposal } from './types.js';
import { escapeXmlAttr, findDeepNodes, parseXml } from './xml-parser.js';

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

async function assertQuickfixOwnerExists(
  http: AdtHttpClient,
  sourceUri: string,
  assertOwner?: (xml: string) => void,
): Promise<void> {
  // SAP's OO scanner can dump for missing owners (#993). Check metadata, not the
  // source: inactive objects and unsaved optional class includes are valid inputs.
  const owner = /^(\/sap\/bc\/adt\/oo\/(?:classes|interfaces)\/[^/?#]+)\//.exec(sourceUri)?.[1];
  if (owner) {
    if (!canonicalHostRelativeAdtPath(sourceUri, '/sap/bc/adt/oo/', { allowRawEncodedSlash: true })) {
      throw new AdtSafetyError('Quick-fix sourceUri must be a canonical host-relative ADT source path.');
    }
    try {
      const response = await http.get(owner);
      assertOwner?.(response.body);
    } catch (err) {
      if (err instanceof AdtApiError && err.isNotFound) {
        err.extraHint =
          'Quick-fix request was not sent: SAP could not find the class/interface metadata. ' +
          'Check name and sourceUri, or create the object first. It does not need to be activated.';
      }
      throw err;
    }
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
  return evaluateFixProposals(http, safety, sourceUri, source, line, column);
}

async function evaluateFixProposals(
  http: AdtHttpClient,
  safety: SafetyConfig,
  sourceUri: string,
  source: string,
  line: number,
  column: number,
  pinned?: ReturnType<typeof preparePinnedQuickfix>,
): Promise<FixProposal[]> {
  checkOperation(safety, OperationType.Read, 'GetFixProposals');
  await assertQuickfixOwnerExists(http, sourceUri, pinned?.assertOwner);

  const uriWithStart = `${sourceUri}#start=${line},${column}`;
  const path = `/sap/bc/adt/quickfixes/evaluation?uri=${encodeURIComponent(uriWithStart)}`;

  try {
    const resp = await http.post(path, source, 'application/*', {
      Accept: 'application/*',
    });
    return pinned ? pinned.parseProposals(resp.body) : parseFixProposals(resp.body);
  } catch (err) {
    if (!pinned && err instanceof AdtApiError && (err.statusCode === 404 || err.statusCode === 406)) {
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
  profile: QuickfixApplicationProfile = { mode: 'single-target' },
): Promise<FixDelta[]> {
  checkOperation(safety, OperationType.Update, 'ApplyFixProposal');
  assertQuickfixProposalUri(proposal.uri);
  if (profile.mode === 'single-target' && safety.multiTargetWrite)
    throw new AdtSafetyError('Missing pinned quickfix profile.');
  // Keep legacy imports independent of the private transport/budget runtime.
  const pinned =
    profile.mode === 'pinned-pp'
      ? (await import('./pinned-quickfix.js')).preparePinnedQuickfix(
          http,
          safety,
          profile,
          proposal,
          sourceUri,
          source,
          line,
          column,
        )
      : undefined;
  if (pinned) {
    http = pinned.http;
    proposal = pinned.proposal; // Own the validated context across the asynchronous evaluation.
    pinned.assertProposal(await evaluateFixProposals(http, safety, sourceUri, source, line, column, pinned));
  }
  await assertQuickfixOwnerExists(http, sourceUri, pinned?.assertOwner);

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

  return pinned ? pinned.parseDeltas(resp.body) : parseFixDeltas(resp.body);
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
  const parsed = parseXml(xml, true);
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
  const parsed = parseXml(xml, true);
  const unitNodes = findDeepNodes(parsed, 'deltas').flatMap((deltas) => nodeRecords(deltas.unit));
  // ADT units carry replacement text only in <content>, never between child elements.
  if (unitNodes.length > 0) return unitNodes.map((node) => parseFixDeltaNode({ ...node, content: node.content ?? '' }));

  const candidateKeys = ['delta', 'edit', 'textEdit', 'replacement', 'replace'] as const;
  let nodes: Array<Record<string, unknown>> = [];

  for (const key of candidateKeys) {
    nodes = findDeepNodes(parsed, key);
    if (nodes.length > 0) break;
  }

  return nodes.map(parseFixDeltaNode);
}

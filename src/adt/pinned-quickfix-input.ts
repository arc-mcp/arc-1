import { AdtSafetyError } from './errors.js';
import { nativeXmlRoot } from './native-xml-evidence.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import { NATIVE_REPOSITORY_OWNERS } from './pinned-repository-owner.js';
import type { FixAffectedObject, FixDelta, FixProposal } from './types.js';

export const QUICKFIX_FIELDS = [
  'action',
  'type',
  'name',
  'source',
  'sourceUri',
  'line',
  'column',
  'proposalUri',
  'proposalUserContent',
  'proposalAffectedObjects',
] as const;

const owners = {
  CLAS: NATIVE_REPOSITORY_OWNERS.CLAS,
  INTF: NATIVE_REPOSITORY_OWNERS.INTF,
  PROG: NATIVE_REPOSITORY_OWNERS.PROG,
  INCL: NATIVE_REPOSITORY_OWNERS.INCL,
} as const;

export interface QuickfixOwner {
  type: keyof typeof owners;
  name: string;
}

export interface QuickfixInput {
  owner: QuickfixOwner;
  proposal: FixProposal;
  sourceUri: string;
  source: string;
  line: number;
  column: number;
  units: ReadonlyMap<string, string>;
}

export function quickfixOwner(owner: QuickfixOwner) {
  if (
    typeof owner.type !== 'string' ||
    typeof owner.name !== 'string' ||
    !Object.hasOwn(owners, owner.type) ||
    !/^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+$/.test(owner.name) ||
    owner.name.length > 30
  )
    throw new AdtSafetyError('Unsupported quickfix owner identity.');
  return { ...owners[owner.type], url: `/sap/bc/adt/${owners[owner.type].path}/${encodeURIComponent(owner.name)}` };
}

export function quickfixProposalPath(uri: unknown): string {
  // The established native provider endpoint has exactly these segments. Query-bearing/interactive
  // and other provider contracts need their own native proof; never normalize SAP's proposal URI.
  if (
    typeof uri !== 'string' ||
    uri.length > 512 ||
    !/^\/sap\/bc\/adt\/quickfixes\/proposals\/providers\/[a-z][a-z0-9_-]*\/quickfixes\/[a-z][a-z0-9_-]*$/.test(uri)
  )
    throw new AdtSafetyError('Unqualified quickfix proposal URI.');
  return uri;
}

/** Preserve the supplied URI, but compare ABAP owner identity without casing aliases. */
export function quickfixSourceKey(uri: string, owner: QuickfixOwner): string {
  const selected = quickfixOwner(owner);
  if (
    !canonicalHostRelativeAdtPath(uri, `/sap/bc/adt/${selected.path}/`, { allowRawEncodedSlash: true }) ||
    uri.includes('?')
  )
    throw new AdtSafetyError('Quickfix source must be an exact same-target source URI.');
  const suffix = uri.slice(`/sap/bc/adt/${selected.path}/`.length);
  const match = /^([^/]+)\/(source\/main|includes\/(definitions|implementations|macros|testclasses))$/.exec(suffix);
  if (!match || (owner.type !== 'CLAS' && match[2] !== 'source/main'))
    throw new AdtSafetyError('Unqualified quickfix source unit.');
  const name = decodeURIComponent(match[1]);
  if (encodeURIComponent(name) !== match[1] || name.toUpperCase() !== owner.name)
    throw new AdtSafetyError('Quickfix source and selected owner differ.');
  return `${owner.type}:${owner.name}:${match[2]}`;
}

export function quickfixRangeUri(uri: string, owner: QuickfixOwner, required = false) {
  const match = /^([^#]+)(?:#start=([1-9][0-9]*),(0|[1-9][0-9]*);end=([1-9][0-9]*),(0|[1-9][0-9]*))?$/.exec(uri);
  if (!match || (required && match[2] === undefined)) throw new AdtSafetyError('Unqualified quickfix source range.');
  const key = quickfixSourceKey(match[1], owner);
  const range =
    match[2] === undefined
      ? undefined
      : {
          start: { line: Number(match[2]), column: Number(match[3]) },
          end: { line: Number(match[4]), column: Number(match[5]) },
        };
  return { key, range };
}

export function quickfixPosition(source: string, position: { line: number; column: number }): number {
  const lines = source.split(/\r\n|\r|\n/);
  if (
    !Number.isSafeInteger(position.line) ||
    !Number.isSafeInteger(position.column) ||
    position.line < 1 ||
    position.line > lines.length ||
    position.column < 0 ||
    position.column > lines[position.line - 1].length
  )
    throw new AdtSafetyError('Quickfix range is outside its exact supplied source unit.');
  // Used only for ordering/overlap comparisons, never to splice or normalize source bytes.
  return lines.slice(0, position.line - 1).reduce((total, line) => total + line.length + 1, 0) + position.column;
}

function text(value: unknown, limit: number, label: string): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > limit ||
    [...value].some((char) => {
      const code = char.codePointAt(0)!;
      return (
        (code < 32 && ![9, 10, 13].includes(code)) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        code === 0xfffe ||
        code === 0xffff
      );
    })
  )
    throw new AdtSafetyError(`Invalid or oversized quickfix ${label}.`);
  return value;
}

export function parsePinnedQuickfixInput(args: Record<string, unknown>): QuickfixInput {
  if (
    args.action !== 'apply_quickfix' ||
    Object.keys(args).some((key) => !(QUICKFIX_FIELDS as readonly string[]).includes(key))
  )
    throw new AdtSafetyError('Unsupported private quickfix action or field.');
  const owner = { type: args.type, name: args.name } as QuickfixOwner;
  const selected = quickfixOwner(owner);
  const source = text(args.source, 256 * 1024, 'source');
  if (!source) throw new AdtSafetyError('Quickfix source is required.');
  const sourceUri =
    args.sourceUri === undefined ? `${selected.url}/source/main` : text(args.sourceUri, 512, 'source URI');
  const key = quickfixSourceKey(sourceUri, owner);
  const line = args.line as number,
    column = (args.column ?? 0) as number;
  quickfixPosition(source, { line, column });
  const userContent = text(args.proposalUserContent, 64 * 1024, 'state');
  const affected = args.proposalAffectedObjects ?? [];
  if (!Array.isArray(affected) || affected.length > 8)
    throw new AdtSafetyError('Quickfix affected units exceed their bound.');
  const units = new Map([[key, source]]),
    seen = new Set<string>();
  let bytes = Buffer.byteLength(source + userContent, 'utf8');
  const affectedObjects = affected.map((raw): FixAffectedObject => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).some((field) => !['uri', 'type', 'name', 'description', 'content'].includes(field))
    )
      throw new AdtSafetyError('Unknown quickfix affected-unit context.');
    const uri = text(raw.uri, 600, 'affected URI'),
      content = text(raw.content, 256 * 1024, 'affected source');
    const { key: unit, range } = quickfixRangeUri(uri, owner);
    if (seen.has(unit) || (units.has(unit) && units.get(unit) !== content))
      throw new AdtSafetyError('Conflicting quickfix source units.');
    seen.add(unit);
    if (range && quickfixPosition(content, range.end) < quickfixPosition(content, range.start))
      throw new AdtSafetyError('Reversed quickfix source range.');
    const result: FixAffectedObject = { uri, content };
    for (const field of ['type', 'name', 'description'] as const)
      if (raw[field] !== undefined) result[field] = text(raw[field], 512, `affected ${field}`);
    if (
      (result.type !== undefined && result.type !== selected.native) ||
      (result.name !== undefined && result.name.toUpperCase() !== owner.name)
    )
      throw new AdtSafetyError('Affected-unit metadata contradicts the selected quickfix owner.');
    units.set(unit, content);
    bytes += Buffer.byteLength(content, 'utf8');
    return result;
  });
  if (bytes > 512 * 1024) throw new AdtSafetyError('Quickfix input exceeds its combined byte allowance.');
  return {
    owner,
    sourceUri,
    source,
    line,
    column,
    units,
    proposal: {
      uri: quickfixProposalPath(args.proposalUri),
      type: 'quickfix/proposal',
      name: '',
      description: '',
      userContent,
      ...(affectedObjects.length ? { affectedObjects } : {}),
    },
  };
}

const qf = 'http://www.sap.com/adt/quickfixes',
  core = 'http://www.sap.com/adt/core';

// A4H/001 returns these concrete IDs for the refactoring provider. Keep the historical
// generic spelling too; neither form changes the qualified endpoint or source-context contract.
const nativeRefactoringTypes = new Set([
  'use_similar_local_variable',
  'declare_local_variable',
  'declare_importing_parameter',
  'declare_changing_parameter',
  'declare_exporting_parameter',
  'declare_returning_parameter',
  'declare_attribute',
]);

type Node = Array<[string, unknown]>;

const field = (kind: string, name: string, ns = '') => JSON.stringify([kind, ns, name]);

const childField = (name: string, ns = '') => field('element', name, ns);

const attrField = (name: string) => field('attribute', name, core);

function shape(node: Node, fields: readonly string[]): void {
  if (node.some(([key]) => !fields.includes(key))) throw new AdtSafetyError('Unqualified native quickfix shape.');
}

function children(node: Node, name: string, ns = '', limit = 1): Node[] {
  const values = (node.find(([key]) => key === childField(name, ns))?.[1] ?? []) as Node[];
  if (!Array.isArray(values) || values.length > limit)
    throw new AdtSafetyError('Ambiguous or oversized quickfix children.');
  return values;
}

function one(node: Node, name: string, ns = ''): Node {
  const found = children(node, name, ns);
  if (found.length !== 1) throw new AdtSafetyError('Required native quickfix evidence is missing.');
  return found[0];
}

function pinnedQuickfixEvidenceText(node: Node, name: string): string {
  const value = children(node, name)[0];
  if (!value) return '';
  shape(value, ['text']);
  return (value.find(([key]) => key === 'text')?.[1] ?? '') as string;
}

function reference(node: Node): FixAffectedObject {
  shape(node, ['uri', 'type', 'name', 'description'].map(attrField));
  const attributes = Object.fromEntries(
    node.map(([key, value]) => [(JSON.parse(key) as string[])[2], value]),
  ) as Record<string, string>;
  if (!attributes.uri) throw new AdtSafetyError('Native quickfix reference has no URI.');
  return { ...attributes, uri: attributes.uri };
}

function unit(node: Node): FixAffectedObject {
  shape(node, [childField('objectReference', core), childField('content')]);
  const result = reference(one(node, 'objectReference', core));
  if (children(node, 'content').length) result.content = pinnedQuickfixEvidenceText(node, 'content');
  return result;
}

function document(xml: string, root: string): Node {
  return nativeXmlRoot(xml, root, qf, true).canonicalValue({}) as Node;
}

export function readPinnedQuickfixProposals(xml: string): FixProposal[] {
  const root = document(xml, 'evaluationResults');
  shape(root, [childField('evaluationResult')]);
  return children(root, 'evaluationResult', '', 64).map((entry) => {
    shape(entry, [childField('objectReference', core), childField('userContent'), childField('affectedObjects')]);
    const ref = reference(one(entry, 'objectReference', core));
    quickfixProposalPath(ref.uri);
    if (
      ref.type !== 'quickfix/proposal' &&
      (!ref.type ||
        !nativeRefactoringTypes.has(ref.type) ||
        ref.uri !== `/sap/bc/adt/quickfixes/proposals/providers/refactoring/quickfixes/${ref.type}`)
    )
      throw new AdtSafetyError('Unknown native quickfix proposal type.');
    const affected = children(entry, 'affectedObjects')[0];
    let affectedObjects: FixAffectedObject[] | undefined;
    if (affected) {
      shape(affected, [childField('unit'), childField('objectReference', core)]);
      const units = children(affected, 'unit', '', 8),
        refs = children(affected, 'objectReference', core, 8);
      if (units.length && refs.length) throw new AdtSafetyError('Ambiguous native affected-unit representation.');
      affectedObjects = units.length ? units.map(unit) : refs.map(reference);
    }
    return {
      uri: ref.uri,
      type: ref.type,
      name: ref.name ?? '',
      description: ref.description ?? '',
      userContent: pinnedQuickfixEvidenceText(entry, 'userContent'),
      ...(affectedObjects?.length ? { affectedObjects } : {}),
    };
  });
}

export function assertPinnedQuickfixProposal(input: QuickfixInput, proposals: FixProposal[]): void {
  const matches = proposals.filter((candidate) => candidate.uri === input.proposal.uri);
  if (matches.length !== 1 || matches[0].userContent !== input.proposal.userContent)
    throw new AdtSafetyError('Quickfix proposal/state no longer matches this exact source and cursor.');
  const native = matches[0].affectedObjects ?? [],
    supplied = input.proposal.affectedObjects ?? [];
  if (native.length !== supplied.length) throw new AdtSafetyError('Quickfix affected-unit context changed.');
  const seen = new Set<string>();
  for (const affected of native) {
    const { key } = quickfixRangeUri(affected.uri, input.owner);
    if (seen.has(key)) throw new AdtSafetyError('Ambiguous native quickfix affected units.');
    seen.add(key);
    const original = supplied.find((candidate) => candidate.uri === affected.uri);
    if (
      !original ||
      ['uri', 'type', 'name', 'description'].some(
        (field) => original[field as keyof FixAffectedObject] !== affected[field as keyof FixAffectedObject],
      ) ||
      (affected.content !== undefined && original.content !== affected.content)
    )
      throw new AdtSafetyError('Quickfix affected-unit context differs from fresh native evidence.');
  }
}

export function assertPinnedQuickfixOwner(xml: string, input: QuickfixInput): void {
  const owner = quickfixOwner(input.owner),
    root = nativeXmlRoot(xml, owner.root, owner.namespace, true);
  const uri = root.attribute('uri', core);
  if (
    root.attribute('name', core)?.toUpperCase() !== input.owner.name ||
    root.attribute('type', core) !== owner.native ||
    (uri !== undefined && uri.toLowerCase() !== owner.url.toLowerCase())
  )
    throw new AdtSafetyError('Quickfix metadata does not identify the selected owner.');
}

export function readPinnedQuickfixDeltas(xml: string, input: QuickfixInput): FixDelta[] {
  const root = document(xml, 'proposalResult');
  shape(root, [childField('deltas'), childField('variableSourceStates')]);
  const states = children(root, 'variableSourceStates')[0];
  if (states) {
    // A4H returns this empty envelope for a declaration delta. Populated or unknown
    // source-state contracts remain unsupported; never silently discard their references.
    shape(states, [childField('objectReferences', core)]);
    shape(one(states, 'objectReferences', core), []);
  }
  const deltas = one(root, 'deltas');
  shape(deltas, [childField('unit')]);
  const intervals = new Map<string, Array<[number, number]>>();
  return children(deltas, 'unit', '', 64).map((node) => {
    const value = unit(node),
      { key, range } = quickfixRangeUri(value.uri, input.owner, true);
    const source = input.units.get(key),
      selected = quickfixOwner(input.owner);
    if (source === undefined || !range || (value.type !== undefined && value.type !== selected.native))
      throw new AdtSafetyError('Quickfix delta escapes the exact supplied source context.');
    // Delta names are native edit labels (e.g. "Insert variable definition"), not
    // owner identities. The canonical URI, native type and supplied unit bind scope.
    const start = quickfixPosition(source, range.start),
      end = quickfixPosition(source, range.end);
    const prior = intervals.get(key) ?? [];
    if (end < start || prior.some(([a, b]) => (start < b && end > a) || start === a))
      throw new AdtSafetyError('Quickfix delta ranges are reversed, duplicated or overlapping.');
    prior.push([start, end]);
    intervals.set(key, prior);
    return { uri: value.uri, range, content: value.content ?? '' };
  });
}

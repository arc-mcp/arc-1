/** Native CTS membership evidence for one pinned mutation. Never constructed from tool arguments. */

import { checkPinnedRequest, isTransportInWhitelist } from './allowlist-policy.js';
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { mutationHttp } from './mutation-http.js';
import type { SafetyConfig } from './safety.js';
import { CTS_CONTENT_TYPE_ORGANIZER } from './transport-contract.js';
import { parseXml } from './xml-parser.js';

const OPERATIONS = {
  create: ['CreateTransport'],
  release: ['ReleaseTransport'],
  release_recursive: ['ReleaseTransportRecursive', 'ReleaseTransport'],
  delete: ['DeleteTransport', 'DeleteTransportObject'],
  reassign: ['ReassignTransport'],
  remove_object: ['RemoveTransportObject'],
} as const;
export type PinnedTransportAction = keyof typeof OPERATIONS;
type XmlNode = Record<string, unknown>;

interface Scope {
  readonly context: PinnedMutationContext;
  readonly http: AdtHttpClient;
  readonly action: PinnedTransportAction;
  readonly requested?: string;
  readonly parent?: string;
  readonly ids: ReadonlySet<string>;
}

// Copying or deserializing a SafetyConfig cannot mint or transfer a verified scope.
const scopes = new WeakMap<SafetyConfig, Scope>();

export interface PreparedPinnedTransport {
  readonly http: AdtHttpClient;
  readonly safety: SafetyConfig;
  readonly requestedId?: string;
  readonly parentId?: string;
  readonly verifiedIds: readonly string[];
}

function requireCapability(safety: SafetyConfig, context: PinnedMutationContext): void {
  assertMutationContext(safety, context);
  if (!safety.allowWrites || !safety.allowTransportWrites || !safety.multiTargetWrite?.allowedTransports.length)
    throw new AdtSafetyError(
      'Pinned CTS management requires writes, transport writes and a destination request policy.',
    );
  throwIfRequestCancelled(context.requestPolicy);
}

function assertCreatePolicy(safety: SafetyConfig): void {
  const policy = safety.multiTargetWrite!;
  const unrestricted = (list: readonly string[], legacyEmpty: boolean) =>
    ((legacyEmpty && list.length === 0) || list.includes('*')) &&
    isTransportInWhitelist({ allowedTransports: [...list] }, 'ARC1_CREATE_REQUEST');
  if (!unrestricted(policy.serverAllowedTransports, true) || !unrestricted(policy.allowedTransports, false))
    throw new AdtSafetyError('Pinned CTS creation requires unrestricted global requests and explicit destination "*".');
}

function requireId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[A-Z0-9]{1,20}$/.test(id))
    throw new AdtSafetyError('Invalid canonical CTS request/task ID.');
}

function nodes(value: unknown): XmlNode[] {
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  if (items.some((item) => !item || typeof item !== 'object' || Array.isArray(item)))
    throw new AdtSafetyError('Unrecognized CTS membership document.');
  return items as XmlNode[];
}

function parentId(value: unknown): string {
  const id =
    typeof value === 'string' && value.startsWith('/sap/bc/adt/cts/transportrequests/')
      ? value.slice('/sap/bc/adt/cts/transportrequests/'.length)
      : value;
  requireId(id);
  return id;
}

async function readTree(http: AdtHttpClient, id: string): Promise<XmlNode> {
  const response = await http.get(`/sap/bc/adt/cts/transportrequests/${id}`, { Accept: CTS_CONTENT_TYPE_ORGANIZER });
  if (response.body.length > 1024 * 1024) throw new AdtSafetyError('CTS membership evidence exceeds 1 MiB.');
  const parsed = parseXml(response.body);
  const roots = nodes(parsed.root ?? (parsed.task ? { task: parsed.task } : undefined));
  if (roots.length !== 1) throw new AdtSafetyError('CTS membership document must contain one organizer root.');
  return roots[0];
}

/** Only canonical parent membership is established here; adapters must validate action-specific type/state. */
async function resolveTree(http: AdtHttpClient, requested: string): Promise<{ parent: string; ids: Set<string> }> {
  let root = await readTree(http, requested);
  let matches = nodes(root.request).filter(
    (request) =>
      request['@_number'] === requested || nodes(request.task).some((task) => task['@_number'] === requested),
  );
  if (matches.length === 0) {
    const tasks = nodes(root.task).filter((task) => task['@_number'] === requested);
    if (tasks.length !== 1) throw new AdtSafetyError('CTS task parent is missing or ambiguous.');
    const parent = parentId(tasks[0]['@_parent']);
    if (parent === requested) throw new AdtSafetyError('CTS task cannot be its own parent.');
    root = await readTree(http, parent);
    matches = nodes(root.request).filter((request) => request['@_number'] === parent);
  }
  if (matches.length !== 1) throw new AdtSafetyError('CTS parent membership is missing or ambiguous.');
  const request = matches[0];
  const parent = request['@_number'];
  requireId(parent);
  const siblings = nodes(root.task);
  const tasks = [...nodes(request.task), ...siblings.filter((task) => parentId(task['@_parent']) === parent)];
  if (tasks.length > 256) throw new AdtSafetyError('CTS membership exceeds 256 tasks.');
  const ids = new Set([parent]);
  for (const task of tasks) {
    const id = task['@_number'];
    requireId(id);
    if (
      ids.has(id) ||
      (task['@_parent'] !== undefined && task['@_parent'] !== '' && parentId(task['@_parent']) !== parent)
    )
      throw new AdtSafetyError('CTS membership contains duplicate IDs or conflicting parents.');
    ids.add(id);
  }
  if (siblings.some((task) => ids.has(String(task['@_number'])) && parentId(task['@_parent']) !== parent))
    throw new AdtSafetyError('CTS membership contains conflicting parents.');
  if (!ids.has(requested)) throw new AdtSafetyError('The selected task is absent from its native parent tree.');
  return { parent, ids };
}

/** Returns a request-local safety/HTTP pair; does not enable capabilities or grant any caller scope. */
export async function preparePinnedTransport(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  action: PinnedTransportAction,
  requestedId?: string,
): Promise<PreparedPinnedTransport> {
  requireCapability(safety, context);
  if (!Object.hasOwn(OPERATIONS, action)) throw new AdtSafetyError('Unreviewed pinned CTS action.');
  const scopedHttp = mutationHttp(http, safety, context);
  let parent: string | undefined;
  let ids = new Set<string>();
  if (action === 'create') {
    if (requestedId !== undefined) throw new AdtSafetyError('CTS creation cannot supply an existing request ID.');
    assertCreatePolicy(safety);
  } else {
    requireId(requestedId);
    ({ parent, ids } = await resolveTree(scopedHttp, requestedId));
    checkPinnedRequest(safety, parent);
    if (action === 'release_recursive' && requestedId !== parent)
      throw new AdtSafetyError('Recursive release requires the canonical parent request.');
  }
  requireCapability(safety, context);
  const scopedSafety = Object.freeze({ ...safety });
  scopes.set(scopedSafety, { context, http: scopedHttp, action, requested: requestedId, parent, ids });
  return Object.freeze({
    http: scopedHttp,
    safety: scopedSafety,
    requestedId,
    parentId: parent,
    verifiedIds: Object.freeze([...ids]),
  });
}

/** Synchronous low-level boundary: only the prepared HTTP pair and verified members may be submitted. */
export function assertPinnedTransportWrite(
  safety: SafetyConfig,
  id: string,
  operation: string,
  http?: AdtHttpClient,
): void {
  const scope = scopes.get(safety);
  if (!scope || http !== scope.http) throw new AdtSafetyError('Missing verified pinned CTS scope/HTTP pair.');
  requireCapability(safety, scope.context);
  if (!(OPERATIONS[scope.action] as readonly string[]).includes(operation))
    throw new AdtSafetyError('CTS operation is outside the prepared action scope.');
  if (scope.action === 'create') {
    if (id !== '') throw new AdtSafetyError('CTS creation requires pre-ID admission.');
    assertCreatePolicy(safety);
    return;
  }
  if (!scope.parent || !scope.ids.has(id)) throw new AdtSafetyError('CTS ID is outside verified native membership.');
  if (
    scope.action !== 'remove_object' &&
    (scope.action === 'release' || scope.requested !== scope.parent) &&
    id !== scope.requested
  )
    throw new AdtSafetyError('CTS ID is outside the selected resource scope.');
  checkPinnedRequest(safety, scope.parent);
  if (operation === 'ReleaseTransportRecursive' && id !== scope.parent)
    throw new AdtSafetyError('Recursive release requires the canonical parent request.');
}

/** Preflight the complete second-read set before a recursive operation can submit its first child. */
export function assertPinnedTransportTasks(
  safety: SafetyConfig,
  http: AdtHttpClient,
  selected: string,
  tasks: readonly { id: string; status: string }[],
  operation: string,
): void {
  if (!safety.multiTargetWrite) return;
  assertPinnedTransportWrite(safety, selected, operation, http);
  const scope = scopes.get(safety)!;
  const observed = new Set(tasks.map((task) => task.id));
  if (observed.size !== tasks.length) throw new AdtSafetyError('CTS second read contains duplicate tasks.');
  // A partial or differently structured tree must not silently omit a frozen child.
  if (selected === scope.parent && [...scope.ids].some((id) => id !== selected && !observed.has(id)))
    throw new AdtSafetyError('CTS second read omitted verified task membership.');
  for (const task of tasks) {
    if (!scope.ids.has(task.id)) throw new AdtSafetyError('CTS ID is outside verified native membership.');
    if (task.status !== 'R') assertPinnedTransportWrite(safety, task.id, operation, http);
  }
}

export function pinnedTransportRequestPolicy(safety: SafetyConfig, http: AdtHttpClient) {
  const scope = scopes.get(safety);
  if (!scope || http !== scope.http) throw new AdtSafetyError('Missing verified pinned CTS scope/HTTP pair.');
  requireCapability(safety, scope.context);
  return scope.context.requestPolicy;
}

/** Fail closed when the transport allowlist cannot authorize a concurrently changing CTS subtree. */
export function checkRecursiveTransportReleaseScope(safety: SafetyConfig): void {
  if (safety.multiTargetWrite) {
    assertPinnedRecursiveTransportScope(safety);
    return;
  }
  const explicitlyUnrestricted =
    safety.allowedTransports.length === 0 || safety.allowedTransports.some((entry) => entry.trim() === '*');
  if (explicitlyUnrestricted) return;

  throw new AdtSafetyError(
    'Recursive transport release is blocked by a restrictive allowedTransports policy. ' +
      'SAP can fold a child task attached concurrently into the parent release, so exact/prefix allowlists ' +
      'cannot authorize the complete live subtree atomically. Use an empty legacy allowlist or explicit "*" ' +
      'only when every current and concurrently attached child of the request is authorized.',
  );
}

function assertPinnedRecursiveTransportScope(safety: SafetyConfig): void {
  const scope = scopes.get(safety);
  if (!scope?.parent || scope.action !== 'release_recursive')
    throw new AdtSafetyError('Missing verified pinned recursive-release scope.');
  assertPinnedTransportWrite(safety, scope.parent, 'ReleaseTransportRecursive', scope.http);
}

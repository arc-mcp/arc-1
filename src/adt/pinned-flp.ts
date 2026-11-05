import { hasExplicitUnrestrictedRequestPolicy } from './allowlist-policy.js';
import { AdtApiError, AdtSafetyError, hasControlCharacter, isDefiniteNativeRejection } from './errors.js';
import {
  addTileToGroup,
  createTile,
  deleteCatalog,
  type FlpCatalogEntity,
  type FlpGroupEntity,
  type FlpTileInput,
  flpCatalogKey,
  mapCatalog,
  mapGroup,
  normalizeCatalogId,
} from './flp.js';
import type { AdtHttpClient } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { mutationHttp } from './mutation-http.js';
import {
  assertCatalogPage,
  assertManagedCatalog,
  assertManagedGroup,
  createPinnedFlpEntity,
  readEntity,
  readPinnedFlpTilePage,
} from './pinned-flp-entity.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { FlpCatalog, FlpGroup, FlpTileInstance } from './types.js';

const GROUP_CONTAINER = '/UI2/FLPD_CATALOG';

const RESERVED_PREFIX = 'X-SAP-UI2-';

const STATIC_TILE_CHIP = 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER';

// No OData key delimiters, separators or encoded characters reach a native key.
const CONTENT_ID = /^(?:\/[A-Za-z0-9_]{1,30}\/)?[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const TILE_INSTANCE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const PINNED_FLP_RECORDING_NOT_ESTABLISHED =
  'Native FLP customizing recording and selection of an allowed request cannot be established before this mutation, so it stays unavailable on this connection.';

function contentId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !CONTENT_ID.test(value) || value.startsWith(RESERVED_PREFIX))
    throw new AdtSafetyError(`${field} must be one exact classic FLP identifier without reserved prefixes.`);
  if (value === GROUP_CONTAINER) throw new AdtSafetyError(`${field} must not select the group container.`);
  return value;
}

function createId(value: unknown, field: string, max: number): string {
  const id = contentId(value, field);
  if (id.length > max) throw new AdtSafetyError(`${field} exceeds the native create limit of ${max} characters.`);
  return id;
}

function catalogDomain(value: unknown): string {
  return contentId(typeof value === 'string' ? normalizeCatalogId(value) : value, 'catalogId');
}

function text(value: unknown, field: string, max = 255): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || hasControlCharacter(value))
    throw new AdtSafetyError(`${field} must be one non-empty line of at most ${max} characters.`);
  return value;
}

function pattern(value: unknown, field: string, shape: RegExp): string {
  if (typeof value !== 'string' || !shape.test(value)) throw new AdtSafetyError(`${field} has an unsupported format.`);
  return value;
}

/** Shared launchpad content must not carry a script or data target to other users. */
function tileUrl(value: unknown): string {
  const url = text(value, 'tile.url', 1024);
  const relative = /^(?:#|\/(?!\/))/.test(url);
  let https = false;
  try {
    https = new URL(url).protocol === 'https:';
  } catch {
    // Relative targets are not absolute URLs.
  }
  if (/[\s\\]/.test(url) || (!relative && !https))
    throw new AdtSafetyError('tile.url must be a same-origin path, launchpad hash or https URL.');
  return url;
}

function tileInput(value: unknown): FlpTileInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdtSafetyError('tile must be an object.');
  const tile = value as Record<string, unknown>;
  const fields = ['id', 'title', 'icon', 'semanticObject', 'semanticAction', 'url', 'subtitle', 'info'];
  if (Object.keys(tile).some((key) => tile[key] !== undefined && !fields.includes(key)))
    throw new AdtSafetyError('tile contains an unsupported field.');
  return {
    id: pattern(tile.id, 'tile.id', /^[A-Za-z0-9_.-]{1,64}$/),
    title: text(tile.title, 'tile.title'),
    semanticObject: pattern(tile.semanticObject, 'tile.semanticObject', /^[A-Za-z][A-Za-z0-9_]{0,29}$/),
    semanticAction: pattern(tile.semanticAction, 'tile.semanticAction', /^[A-Za-z][A-Za-z0-9_]{0,59}$/),
    ...(tile.icon === undefined
      ? {}
      : { icon: pattern(tile.icon, 'tile.icon', /^sap-icon:\/\/[A-Za-z0-9/_-]{1,64}$/) }),
    ...(tile.url === undefined ? {} : { url: tileUrl(tile.url) }),
    ...(tile.subtitle === undefined ? {} : { subtitle: text(tile.subtitle, 'tile.subtitle') }),
    ...(tile.info === undefined ? {} : { info: text(tile.info, 'tile.info') }),
  };
}

export type PinnedFlpPlan =
  | { action: 'flp_create_catalog'; domainId: string; title: string }
  | { action: 'flp_create_group'; groupId: string; title: string }
  | { action: 'flp_create_tile'; domainId: string; tile: FlpTileInput }
  | { action: 'flp_add_tile_to_group'; groupId: string; domainId: string; tileInstanceId: string }
  | { action: 'flp_delete_catalog'; domainId: string };

/** Pure input contract shared by capability admission and the adapter. */
export function parsePinnedFlpMutation(args: Record<string, unknown>): PinnedFlpPlan {
  switch (args.action) {
    case 'flp_create_catalog':
      return {
        action: args.action,
        domainId: createId(args.domainId, 'domainId', 35),
        title: text(args.title, 'title'),
      };
    case 'flp_create_group':
      return { action: args.action, groupId: createId(args.groupId, 'groupId', 70), title: text(args.title, 'title') };
    case 'flp_create_tile':
      return { action: args.action, domainId: catalogDomain(args.catalogId), tile: tileInput(args.tile) };
    case 'flp_add_tile_to_group':
      return {
        action: args.action,
        groupId: contentId(args.groupId, 'groupId'),
        domainId: catalogDomain(args.catalogId),
        tileInstanceId: pattern(args.tileInstanceId, 'tileInstanceId', TILE_INSTANCE_ID),
      };
    case 'flp_delete_catalog':
      return { action: args.action, domainId: catalogDomain(args.catalogId) };
    default:
      throw new AdtSafetyError('Unsupported classic FLP action.');
  }
}

export function parsePinnedFlpList(args: Record<string, unknown>): void {
  if (args.action === 'flp_list_tiles') catalogDomain(args.catalogId);
  else if (args.action !== 'flp_list_catalogs' && args.action !== 'flp_list_groups')
    throw new AdtSafetyError('Unsupported classic FLP list action.');
}

export interface PinnedFlpOutcome {
  ok: boolean;
  state:
    | 'unchanged'
    | 'created'
    | 'creation-rejected'
    | 'create-unconfirmed'
    | 'membership-verified'
    | 'membership-accepted-unconfirmed'
    | 'assignment-rejected'
    | 'assignment-unconfirmed'
    | 'delete-rejected'
    | 'delete-unconfirmed';
  phase: 'validation' | 'preflight' | 'write' | 'readback';
  retryable: false;
  /** Target and client level; SAP authorization decides. Consumers of the launchpad content see its effects. */
  resource: 'classic-flp-client-content';
  /** Whether SAP recorded this change in a customizing request is not observable through this API. */
  recording: 'not-established' | 'native-governed-unverified';
  recordingNote?: string;
  /** A 604 lookup can hide errors: native CREATE, not read absence, protects the selected existing key. */
  priorExistence?: 'unknown';
  catalog?: FlpCatalog;
  group?: FlpGroup;
  tile?: FlpTileInstance;
  alreadyMember?: true;
  tilesAtDelete?: string;
  manualVerification?: string;
  statusCode?: number;
  message?: string;
}

async function readTiles(http: AdtHttpClient, safety: SafetyConfig, pageId: string) {
  const result = await readPinnedFlpTilePage(http, safety, pageId);
  // The native $top is enforced, so a full page cannot prove membership or absence.
  if (result.truncated)
    throw new AdtSafetyError(
      'This FLP page reached its read limit or reports further entries; the listing is incomplete.',
    );
  return result.items;
}

function expectedTileFields(tile: FlpTileInput): Record<string, string | undefined> {
  return {
    id: tile.id,
    display_title_text: tile.title,
    semantic_object: tile.semanticObject,
    semantic_action: tile.semanticAction,
    display_icon_url: tile.icon,
    url: tile.url,
    display_subtitle_text: tile.subtitle,
    display_info_text: tile.info,
  };
}

function tileMatches(actual: FlpTileInstance, plan: { domainId: string; tile: FlpTileInput }): boolean {
  const config = actual.configuration ?? {};
  return (
    actual.pageId === flpCatalogKey(plan.domainId) &&
    actual.chipId === STATIC_TILE_CHIP &&
    actual.title === plan.tile.title &&
    Object.entries(expectedTileFields(plan.tile)).every(([key, value]) => value === undefined || config[key] === value)
  );
}

async function createTileStep(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  outcome: PinnedFlpOutcome,
  plan: Extract<PinnedFlpPlan, { action: 'flp_create_tile' }>,
): Promise<void> {
  const key = flpCatalogKey(plan.domainId);
  const catalog = await readEntity<FlpCatalogEntity>(http, 'Catalogs', key);
  assertManagedCatalog(catalog, plan.domainId);
  outcome.catalog = mapCatalog(catalog);
  const before = await readTiles(http, safety, key);
  if (before.some((tile) => tile.configuration?.id === plan.tile.id))
    throw new AdtSafetyError('A tile with this logical id already exists in the catalog.');
  submit(context, outcome, 'create-unconfirmed');
  const created = await createTile(http, safety, plan.domainId, plan.tile);
  outcome.tile = created;
  if (!TILE_INSTANCE_ID.test(created.instanceId))
    throw new AdtSafetyError('The native tile response has no usable instance id.');
  outcome.phase = 'readback';
  throwIfRequestCancelled(context.requestPolicy);
  const stored = (await readTiles(http, safety, key)).find((tile) => tile.instanceId === created.instanceId);
  if (!stored || !tileMatches(stored, plan))
    throw new AdtSafetyError('The native catalog does not show the requested tile.');
  outcome.tile = stored;
  outcome.ok = true;
  outcome.state = 'created';
}

const MEMBERSHIP_MANUAL_STEP =
  'Open this group in SAP Fiori Launchpad Designer and confirm the tile is listed. Do not repeat the assignment before checking.';

async function addTileStep(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  outcome: PinnedFlpOutcome,
  plan: Extract<PinnedFlpPlan, { action: 'flp_add_tile_to_group' }>,
): Promise<void> {
  const key = flpCatalogKey(plan.domainId);
  const catalog = await readEntity<FlpCatalogEntity>(http, 'Catalogs', key);
  assertCatalogPage(catalog, plan.domainId);
  const group = await readEntity<FlpGroupEntity>(http, 'Pages', plan.groupId);
  assertManagedGroup(group, plan.groupId);
  outcome.catalog = mapCatalog(catalog);
  outcome.group = mapGroup(group);
  if (!(await readTiles(http, safety, key)).some((tile) => tile.instanceId === plan.tileInstanceId))
    throw new AdtSafetyError('This tile instance does not belong to the selected catalog.');
  const reference = `X-SAP-UI2-PAGE:${key}:${plan.tileInstanceId}`;
  const existing = (await readTiles(http, safety, plan.groupId)).find((tile) => tile.chipId === reference);
  if (existing) {
    outcome.ok = true;
    outcome.alreadyMember = true;
    outcome.tile = existing;
    return;
  }
  submit(context, outcome, 'assignment-unconfirmed');
  const assigned = await addTileToGroup(http, safety, plan.groupId, plan.domainId, plan.tileInstanceId);
  outcome.tile = assigned;
  // HTTP success alone is acceptance. Only the native group listing can make it verified membership.
  outcome.phase = 'readback';
  outcome.state = 'membership-accepted-unconfirmed';
  outcome.manualVerification = MEMBERSHIP_MANUAL_STEP;
  throwIfRequestCancelled(context.requestPolicy);
  const member = (await readTiles(http, safety, plan.groupId)).find(
    (tile) => tile.pageId === plan.groupId && tile.instanceId === assigned.instanceId && tile.chipId === reference,
  );
  if (!member) throw new AdtSafetyError('The native group listing does not show this assignment.');
  outcome.tile = member;
  delete outcome.manualVerification;
  outcome.ok = true;
  outcome.state = 'membership-verified';
}

async function deleteCatalogStep(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  outcome: PinnedFlpOutcome,
  plan: Extract<PinnedFlpPlan, { action: 'flp_delete_catalog' }>,
): Promise<void> {
  const key = flpCatalogKey(plan.domainId);
  const catalog = await readEntity<FlpCatalogEntity>(http, 'Catalogs', key);
  assertManagedCatalog(catalog, plan.domainId);
  outcome.catalog = mapCatalog(catalog);
  outcome.tilesAtDelete = catalog.chipCount;
  submit(context, outcome, 'delete-unconfirmed');
  await deleteCatalog(http, safety, key);
  outcome.phase = 'readback';
  throwIfRequestCancelled(context.requestPolicy);
  await readEntity(http, 'Catalogs', key);
  throw new AdtSafetyError('The FLP catalog is still readable; deletion is not confirmed.');
}

/** The last check before one no-replay submission; a later failure cannot report "unchanged". */
function submit(context: PinnedMutationContext, outcome: PinnedFlpOutcome, pending: PinnedFlpOutcome['state']): void {
  throwIfRequestCancelled(context.requestPolicy);
  outcome.phase = 'write';
  outcome.state = pending;
}

export async function executePinnedFlpMutation(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  input: Record<string, unknown>,
  recordingProfile?: PinnedFlpRecordingProfile,
): Promise<PinnedFlpOutcome> {
  const outcome: PinnedFlpOutcome = {
    ok: false,
    state: 'unchanged',
    phase: 'validation',
    retryable: false,
    resource: 'classic-flp-client-content',
    recording: 'not-established',
  };
  try {
    assertMutationContext(safety, context);
    if (context.mode !== 'pinned-pp') throw new AdtSafetyError('A pinned mutation context is required.');
    if (recordingProfile) {
      assertFlpRecordingProfile(safety, context, recordingProfile);
      outcome.recording = recordingProfile.kind;
      outcome.recordingNote =
        'SAP governs optional customizing recording; no request/task receipt is verified. Submitted failures may include CTS effects. No automatic CTS compensation is attempted.';
    }
    const plan = parsePinnedFlpMutation(input);
    checkOperation(safety, OperationType.Workflow, 'PinnedFlpMutation');
    const scoped = mutationHttp(http, safety, context);
    outcome.phase = 'preflight';
    throwIfRequestCancelled(context.requestPolicy);
    if (plan.action === 'flp_create_catalog' || plan.action === 'flp_create_group')
      await createPinnedFlpEntity(scoped, safety, context, outcome, plan);
    else if (plan.action === 'flp_create_tile') await createTileStep(scoped, safety, context, outcome, plan);
    else if (plan.action === 'flp_add_tile_to_group') await addTileStep(scoped, safety, context, outcome, plan);
    else await deleteCatalogStep(scoped, safety, context, outcome, plan);
    return outcome;
  } catch (error) {
    if (error instanceof AdtApiError) outcome.statusCode = error.statusCode;
    if (outcome.phase === 'write' && outcome.priorExistence !== 'unknown' && isDefiniteNativeRejection(error))
      outcome.state =
        outcome.state === 'assignment-unconfirmed'
          ? 'assignment-rejected'
          : outcome.state === 'delete-unconfirmed'
            ? 'delete-rejected'
            : 'creation-rejected';
    outcome.message =
      error instanceof AdtSafetyError
        ? error.message
        : outcome.state === 'unchanged'
          ? 'No classic FLP change was submitted.'
          : 'The classic FLP outcome is not confirmed. Read the native content before deciding the next action; nothing was retried.';
    return outcome;
  }
}

export interface PinnedFlpRecordingProfile {
  readonly kind: 'native-governed-unverified';
  readonly context: PinnedMutationContext;
  readonly assert: () => void;
}

const profiles = new WeakSet<PinnedFlpRecordingProfile>();

export function createNativeGovernedFlpRecording(
  safety: SafetyConfig,
  context: PinnedMutationContext,
  coverage: { systemType: string; abapRelease?: string },
  validateInvocation: () => void,
): PinnedFlpRecordingProfile {
  const assert = () => {
    assertMutationContext(safety, context);
    throwIfRequestCancelled(context.requestPolicy);
    if (
      context.mode !== 'pinned-pp' ||
      !safety.allowWrites ||
      !hasExplicitUnrestrictedRequestPolicy(context.recordingPolicy.allowedTransports) ||
      !hasExplicitUnrestrictedRequestPolicy(context.recordingPolicy.serverAllowedTransports)
    )
      throw new AdtSafetyError(
        'Native-governed FLP recording requires explicit unrestricted "*" on both request policies.',
      );
    // This is internal source coverage, not a claim that the release alone proves runtime qualification.
    if (coverage.systemType !== 'onprem' || coverage.abapRelease !== '758')
      throw new AdtSafetyError('The private FLP recording profile covers only the reviewed on-premise 758 CUST flow.');
    validateInvocation();
  };
  assert();
  const profile: PinnedFlpRecordingProfile = Object.freeze({ kind: 'native-governed-unverified', context, assert });
  profiles.add(profile);
  return profile;
}

export function assertFlpRecordingProfile(
  safety: SafetyConfig,
  context: PinnedMutationContext,
  profile: PinnedFlpRecordingProfile,
): void {
  if (!profiles.has(profile) || profile.context !== context)
    throw new AdtSafetyError('Missing or mismatched private FLP recording profile.');
  assertMutationContext(safety, context);
  profile.assert();
}

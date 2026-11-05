import { DataResponseBudget } from './data-result-context.js';
import { AdtApiError, AdtSafetyError } from './errors.js';
import {
  createCatalog,
  createGroup,
  FLP_SERVICE_PATH,
  FLP_TILE_PAGE_SIZE,
  type FlpCatalogEntity,
  type FlpCreateProfile,
  type FlpGroupEntity,
  type FlpTileEntity,
  flpCatalogKey,
  flpPageTilesPath,
  mapCatalog,
  mapGroup,
  mapTile,
  parseODataSingle,
} from './flp.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import type { PinnedMutationContext } from './mutation-context.js';
import type { PinnedFlpOutcome, PinnedFlpPlan } from './pinned-flp.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';

const GROUP_CONTAINER = '/UI2/FLPD_CATALOG';

export const PINNED_FLP_ENTITY_LIMIT = 256 * 1024;

export const flpEntityPath = (set: 'Catalogs' | 'Pages', key: string) =>
  `${FLP_SERVICE_PATH}/${set}('${encodeURIComponent(key)}')?$format=json`;

function options(limit = PINNED_FLP_ENTITY_LIMIT): AdtRequestOptions {
  return { responseBudget: new DataResponseBudget(limit, 'flp-content', true) };
}

/** Every keyed error propagates; only the conditional-create preflight may handle its unknown result. */
export async function readEntity<T>(http: AdtHttpClient, set: 'Catalogs' | 'Pages', key: string): Promise<T> {
  const response = await http.get(flpEntityPath(set, key), { Accept: 'application/json' }, options());
  new DataResponseBudget(PINNED_FLP_ENTITY_LIMIT, 'flp-content', true).assertSingleResponseBytes(
    Buffer.byteLength(response.body, 'utf8'),
  );
  const entity = parseODataSingle<T & { id?: unknown }>(response.body);
  if (!entity || typeof entity !== 'object' || Array.isArray(entity) || entity.id !== key)
    throw new AdtSafetyError('The FLP response does not identify the requested native entity.');
  return entity;
}

function notReadOnly(value: unknown): boolean {
  return value === false || value === '' || value === 'false';
}

/** An assignment only references its source catalog, so a standard catalog page is a valid source. */
export function assertCatalogPage(entity: FlpCatalogEntity, domainId: string): void {
  if (entity.id !== flpCatalogKey(domainId) || entity.domainId !== domainId || entity.type !== 'CATALOG_PAGE')
    throw new AdtSafetyError('The selected FLP catalog is not the requested catalog page.');
}

/** Only client-specific catalog pages are changed; standard or remote catalogs have another native type/scope. */
export function assertManagedCatalog(entity: FlpCatalogEntity & { isReadOnly?: unknown }, domainId: string): void {
  assertCatalogPage(entity, domainId);
  if (entity.scope !== 'CUSTOMIZING' || !notReadOnly(entity.isReadOnly))
    throw new AdtSafetyError('The selected FLP catalog is not a writable client-specific catalog page.');
}

export function assertManagedGroup(
  entity: FlpGroupEntity & { isCatalogPage?: unknown; isReadOnly?: unknown; scope?: unknown },
  groupId: string,
): void {
  if (
    entity.id !== groupId ||
    entity.catalogId !== GROUP_CONTAINER ||
    entity.scope !== 'CUSTOMIZING' ||
    !notReadOnly(entity.isCatalogPage) ||
    !notReadOnly(entity.isReadOnly)
  )
    throw new AdtSafetyError('The selected FLP group is not a writable classic launchpad group.');
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The observed CUST resource-lookup failure can also hide provider/cache errors. This predicate
 * permits only a backend-protected CREATE attempt; it MUST NOT establish absence or deletion.
 */
export function isUnresolvedFlpLookup(error: unknown, path: string): boolean {
  if (
    !(error instanceof AdtApiError) ||
    error.statusCode !== 404 ||
    error.path !== path ||
    !error.responseBody ||
    Buffer.byteLength(error.responseBody, 'utf8') > PINNED_FLP_ENTITY_LIMIT
  )
    return false;
  try {
    const body: unknown = JSON.parse(error.responseBody);
    if (!record(body) || !record(body.error) || body.error.code !== '/UI2/FND/604') return false;
    const inner = body.error.innererror;
    if (!record(inner) || !record(inner.application)) return false;
    const app = inner.application;
    return (
      app.component_id === 'CA-FLP-ABA' &&
      app.service_namespace === '/UI2/' &&
      app.service_id === 'PAGE_BUILDER_CUST' &&
      app.service_version === '0001' &&
      Array.isArray(inner.errordetails) &&
      inner.errordetails.length === 1 &&
      record(inner.errordetails[0]) &&
      inner.errordetails[0].code === '/IWBEP/CX_MGW_BUSI_EXCEPTION' &&
      inner.errordetails[0].severity === 'error'
    );
  } catch {
    return false;
  }
}

type CreatePlan = Extract<PinnedFlpPlan, { action: 'flp_create_catalog' | 'flp_create_group' }>;

export async function createPinnedFlpEntity(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  outcome: PinnedFlpOutcome,
  plan: CreatePlan,
): Promise<void> {
  const set = plan.action === 'flp_create_catalog' ? 'Catalogs' : 'Pages';
  const key = plan.action === 'flp_create_catalog' ? flpCatalogKey(plan.domainId) : plan.groupId;
  let observed = false;
  try {
    await readEntity(http, set, key);
    observed = true;
  } catch (error) {
    if (!isUnresolvedFlpLookup(error, flpEntityPath(set, key))) throw error;
  }
  if (observed) throw new AdtSafetyError('The selected FLP entity already exists; no create was submitted.');
  // Native CREATE checks existence under its enqueue before preparing content. A 604 response can
  // hide lookup failures; it is not absence evidence. Transport work and multi-part creation can
  // precede an error, so every failed submission remains potentially partial, including 4xx.
  outcome.priorExistence = 'unknown';
  throwIfRequestCancelled(context.requestPolicy);
  outcome.phase = 'write';
  outcome.state = 'create-unconfirmed';
  const profile: FlpCreateProfile = {
    kind: 'pinned-create-only',
    responseBudget: new DataResponseBudget(PINNED_FLP_ENTITY_LIMIT, 'flp-create', true),
  };
  const created =
    plan.action === 'flp_create_catalog'
      ? await createCatalog(http, safety, plan.domainId, plan.title, profile)
      : await createGroup(http, safety, plan.groupId, plan.title, profile);
  outcome.phase = 'readback';
  if (created.id !== key || created.title !== plan.title)
    throw new AdtSafetyError('The FLP create response did not identify the requested entity and title.');
  if (
    plan.action === 'flp_create_catalog'
      ? !('domainId' in created) ||
        created.domainId !== plan.domainId ||
        created.type !== 'CATALOG_PAGE' ||
        created.scope !== 'CUSTOMIZING'
      : !('catalogId' in created) || created.catalogId !== '/UI2/FLPD_CATALOG' || created.layout !== ''
  )
    throw new AdtSafetyError('The FLP create response has inconsistent native ownership fields.');
  throwIfRequestCancelled(context.requestPolicy);
  if (plan.action === 'flp_create_catalog') {
    const stored = await readEntity<FlpCatalogEntity>(http, 'Catalogs', key);
    assertManagedCatalog(stored, plan.domainId);
    if (stored.title !== plan.title) throw new AdtSafetyError('The native catalog does not show the requested title.');
    outcome.catalog = mapCatalog(stored);
  } else {
    const stored = await readEntity<FlpGroupEntity>(http, 'Pages', key);
    assertManagedGroup(stored, plan.groupId);
    if (stored.title !== plan.title || stored.layout !== '')
      throw new AdtSafetyError('The native group does not show the requested title and layout.');
    outcome.group = mapGroup(stored);
  }
  outcome.ok = true;
  outcome.state = 'created';
}

export const PINNED_FLP_LIST_BYTES = 8 * 1024 * 1024;

export interface PinnedFlpCollection<T> {
  items: T[];
  /** A full page or a native continuation/count makes completeness unknown. No continuation is followed. */
  truncated: boolean;
}

async function collection<T>(http: AdtHttpClient, path: string): Promise<PinnedFlpCollection<T>> {
  const budget = new DataResponseBudget(PINNED_FLP_LIST_BYTES, 'flp-content', true);
  // Only a successful collection can establish emptiness. A collection 404 (including an OData
  // error) means the listing is unavailable, not that there are zero catalogs/groups/tiles.
  const response = await http.get(path, { Accept: 'application/json' }, { responseBudget: budget });
  budget.assertSingleResponseBytes(Buffer.byteLength(response.body, 'utf8'));
  const page = (JSON.parse(response.body) as { d?: { results?: T[]; __next?: unknown; __count?: unknown } } | null)?.d;
  if (!page || !Array.isArray(page.results))
    throw new AdtSafetyError('The FLP response does not contain an OData collection.');
  const items = page.results;
  if (page.__next !== undefined && (typeof page.__next !== 'string' || !page.__next))
    throw new AdtSafetyError('The FLP collection has an unsupported continuation marker.');
  let count: number | undefined;
  if (page.__count !== undefined) {
    if (typeof page.__count !== 'string' || !/^\d+$/.test(page.__count))
      throw new AdtSafetyError('The FLP collection has an unsupported count.');
    count = Number(page.__count);
    if (!Number.isSafeInteger(count) || count < items.length)
      throw new AdtSafetyError('The FLP collection count does not match its returned entries.');
  }
  return {
    items: items.slice(0, FLP_TILE_PAGE_SIZE),
    truncated:
      items.length >= FLP_TILE_PAGE_SIZE || page.__next !== undefined || (count !== undefined && count > items.length),
  };
}

export async function listPinnedFlpCatalogs(http: AdtHttpClient, safety: SafetyConfig) {
  checkOperation(safety, OperationType.Read, 'ListFlpCatalogs');
  const page = await collection<FlpCatalogEntity>(
    http,
    `${FLP_SERVICE_PATH}/Catalogs?$format=json&$top=500&$select=id,domainId,title,type,scope,chipCount`,
  );
  return { ...page, items: page.items.map(mapCatalog) };
}

export async function listPinnedFlpGroups(http: AdtHttpClient, safety: SafetyConfig) {
  checkOperation(safety, OperationType.Read, 'ListFlpGroups');
  const page = await collection<FlpGroupEntity>(
    http,
    `${FLP_SERVICE_PATH}/Pages?$format=json&$top=500&$select=id,title,catalogId,layout&$filter=catalogId%20eq%20'/UI2/FLPD_CATALOG'`,
  );
  return { ...page, items: page.items.map(mapGroup) };
}

export async function readPinnedFlpTilePage(http: AdtHttpClient, safety: SafetyConfig, pageId: string) {
  checkOperation(safety, OperationType.Read, 'ListFlpTiles');
  const page = await collection<FlpTileEntity>(http, flpPageTilesPath(pageId));
  const identities = new Set<string>();
  const items = page.items.map((row) => {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      row.pageId !== pageId ||
      typeof row.instanceId !== 'string' ||
      !row.instanceId.trim() ||
      typeof row.chipId !== 'string' ||
      !row.chipId.trim() ||
      identities.has(row.instanceId)
    )
      throw new AdtSafetyError('The FLP tile listing does not identify unambiguous tiles owned by the requested page.');
    identities.add(row.instanceId);
    return mapTile(row);
  });
  return { ...page, items };
}

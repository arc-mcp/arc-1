/**
 * OData client for SAP Fiori Launchpad customization service.
 *
 * Uses `/sap/opu/odata/UI2/PAGE_BUILDER_CUST` for catalog/group/tile management.
 */

import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { FlpCatalog, FlpGroup, FlpTileInstance } from './types.js';

export const FLP_SERVICE_PATH = '/sap/opu/odata/UI2/PAGE_BUILDER_CUST';

interface ODataCollection<T> {
  d?: {
    results?: T[];
  };
}

interface ODataSingle<T> {
  d?: T;
}

interface FlpCatalogEntity {
  id?: string;
  domainId?: string;
  title?: string;
  type?: string;
  scope?: string;
  chipCount?: string;
}

interface FlpGroupEntity {
  id?: string;
  title?: string;
  catalogId?: string;
  layout?: string;
}

interface FlpTileEntity {
  pageId?: string;
  instanceId?: string;
  chipId?: string;
  title?: string;
  configuration?: string;
}

export interface FlpTileInput {
  id: string;
  title: string;
  icon?: string;
  semanticObject: string;
  semanticAction: string;
  url?: string;
  subtitle?: string;
  info?: string;
}

function parseODataCollection<T>(body: string): T[] {
  const data = JSON.parse(body) as ODataCollection<T>;
  const results = data.d?.results;
  if (!Array.isArray(results)) {
    throw new Error('Unexpected OData response: missing "d.results" collection');
  }
  return results;
}

function parseODataSingle<T>(body: string): T {
  const data = JSON.parse(body) as ODataSingle<T>;
  if (!data.d) {
    throw new Error('Unexpected OData response: missing "d" object');
  }
  return data.d;
}

function mapCatalog(entity: FlpCatalogEntity): FlpCatalog {
  return {
    id: entity.id ?? '',
    domainId: entity.domainId ?? '',
    title: entity.title ?? '',
    type: entity.type ?? '',
    scope: entity.scope ?? '',
    chipCount: entity.chipCount ?? '',
  };
}

function mapGroup(entity: FlpGroupEntity): FlpGroup {
  return {
    id: entity.id ?? '',
    title: entity.title ?? '',
    catalogId: entity.catalogId ?? '',
    layout: entity.layout ?? '',
  };
}

function mapTile(entity: FlpTileEntity): FlpTileInstance {
  return {
    pageId: entity.pageId ?? '',
    instanceId: entity.instanceId ?? '',
    chipId: entity.chipId ?? '',
    title: entity.title ?? '',
    configuration: parseTileConfiguration(entity.configuration ?? ''),
  };
}

const CATALOG_PAGE_PREFIX = 'X-SAP-UI2-CATALOGPAGE:';

/**
 * Normalize a catalog ID to domain-only form.
 *
 * listCatalogs returns both `id` (e.g. "X-SAP-UI2-CATALOGPAGE:FOO") and
 * `domainId` (e.g. "FOO"). Functions that build a pageId expect the domain
 * ID, so we strip the prefix when callers pass the full form.
 */
export function normalizeCatalogId(catalogId: string): string {
  if (catalogId.startsWith(CATALOG_PAGE_PREFIX)) {
    return catalogId.slice(CATALOG_PAGE_PREFIX.length);
  }
  return catalogId;
}

function buildTileConfiguration(tile: FlpTileInput): string {
  const tileConfiguration: Record<string, unknown> = {
    id: tile.id,
    display_title_text: tile.title,
    semantic_object: tile.semanticObject,
    semantic_action: tile.semanticAction,
  };

  if (tile.icon) tileConfiguration.display_icon_url = tile.icon;
  if (tile.url) tileConfiguration.url = tile.url;
  if (tile.subtitle) tileConfiguration.display_subtitle_text = tile.subtitle;
  if (tile.info) tileConfiguration.display_info_text = tile.info;

  return JSON.stringify({ tileConfiguration: JSON.stringify(tileConfiguration) });
}

/**
 * Parse FLP PageChipInstance configuration (double-serialized JSON).
 *
 * configuration is typically:
 *   {"tileConfiguration":"{\"semantic_object\":\"...\"}"}
 */
export function parseTileConfiguration(configStr: string): Record<string, unknown> | null {
  if (!configStr) return null;

  try {
    const parsed = JSON.parse(configStr) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const outer = parsed as Record<string, unknown>;
    const nested = outer.tileConfiguration;

    if (typeof nested === 'string') {
      const parsedNested = JSON.parse(nested) as unknown;
      if (parsedNested && typeof parsedNested === 'object' && !Array.isArray(parsedNested)) {
        return parsedNested as Record<string, unknown>;
      }
      return null;
    }

    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }

    return outer;
  } catch {
    return null;
  }
}

export async function listCatalogs(http: AdtHttpClient, safety: SafetyConfig): Promise<FlpCatalog[]> {
  checkOperation(safety, OperationType.Read, 'ListFlpCatalogs');

  const path = `${FLP_SERVICE_PATH}/Catalogs?$format=json&$top=500&$select=id,domainId,title,type,scope,chipCount`;

  try {
    const resp = await http.get(path, { Accept: 'application/json' });
    return parseODataCollection<FlpCatalogEntity>(resp.body).map(mapCatalog);
  } catch (err) {
    if (err instanceof AdtApiError && err.statusCode === 404) {
      return [];
    }
    throw err;
  }
}

export async function listGroups(http: AdtHttpClient, safety: SafetyConfig): Promise<FlpGroup[]> {
  checkOperation(safety, OperationType.Read, 'ListFlpGroups');

  const path =
    `${FLP_SERVICE_PATH}/Pages?` +
    "$format=json&$top=500&$select=id,title,catalogId,layout&$filter=catalogId%20eq%20'/UI2/FLPD_CATALOG'";

  const resp = await http.get(path, { Accept: 'application/json' });
  return parseODataCollection<FlpGroupEntity>(resp.body).map(mapGroup);
}

/** Row cap for a single tile listing — `$top` is enforced by the service, so this can truncate. */
export const FLP_TILE_PAGE_SIZE = 500;

/**
 * List the tiles of a catalog via the Page → PageChipInstances association.
 *
 * Never send a `$filter` to PageChipInstances — not on `pageId`, not on `chipId`.
 * The data accessor (/UI2/CL_EDM_DA_V06_USAGE) takes the page from the navigation
 * parent and `assert 1 = 2`s on any select-option but its internal GADGET_ID, so a
 * filter short-dumps the backend (ST22) on 7.50, 758 and 816 alike.
 */
export async function listTiles(
  http: AdtHttpClient,
  safety: SafetyConfig,
  catalogId: string,
): Promise<FlpTileInstance[]> {
  checkOperation(safety, OperationType.Read, 'ListFlpTiles');

  const pageId = `X-SAP-UI2-CATALOGPAGE:${normalizeCatalogId(catalogId)}`;
  const path =
    `${FLP_SERVICE_PATH}/Pages('${encodeURIComponent(pageId)}')/PageChipInstances?` +
    `$format=json&$top=${FLP_TILE_PAGE_SIZE}&$select=pageId,instanceId,chipId,title,configuration`;

  const resp = await http.get(path, { Accept: 'application/json' });
  return parseODataCollection<FlpTileEntity>(resp.body).map(mapTile);
}

export async function createCatalog(
  http: AdtHttpClient,
  safety: SafetyConfig,
  domainId: string,
  title: string,
): Promise<FlpCatalog> {
  checkOperation(safety, OperationType.Workflow, 'CreateFlpCatalog');

  const payload = JSON.stringify({ domainId, title, type: 'CATALOG_PAGE' });
  const resp = await http.post(`${FLP_SERVICE_PATH}/Catalogs`, payload, 'application/json', {
    Accept: 'application/json',
  });

  return mapCatalog(parseODataSingle<FlpCatalogEntity>(resp.body));
}

export async function createGroup(
  http: AdtHttpClient,
  safety: SafetyConfig,
  id: string,
  title: string,
): Promise<FlpGroup> {
  checkOperation(safety, OperationType.Workflow, 'CreateFlpGroup');

  const payload = JSON.stringify({ id, title, catalogId: '/UI2/FLPD_CATALOG', layout: '' });
  const resp = await http.post(`${FLP_SERVICE_PATH}/Pages`, payload, 'application/json', {
    Accept: 'application/json',
  });

  return mapGroup(parseODataSingle<FlpGroupEntity>(resp.body));
}

export async function createTile(
  http: AdtHttpClient,
  safety: SafetyConfig,
  catalogId: string,
  tile: FlpTileInput,
): Promise<FlpTileInstance> {
  checkOperation(safety, OperationType.Workflow, 'CreateFlpTile');

  const payload = JSON.stringify({
    chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER',
    pageId: `X-SAP-UI2-CATALOGPAGE:${normalizeCatalogId(catalogId)}`,
    scope: 'CUSTOMIZING',
    title: tile.title,
    configuration: buildTileConfiguration(tile),
  });

  const resp = await http.post(`${FLP_SERVICE_PATH}/PageChipInstances`, payload, 'application/json', {
    Accept: 'application/json',
  });

  return mapTile(parseODataSingle<FlpTileEntity>(resp.body));
}

export async function addTileToGroup(
  http: AdtHttpClient,
  safety: SafetyConfig,
  groupId: string,
  catalogId: string,
  tileInstanceId: string,
): Promise<FlpTileInstance> {
  checkOperation(safety, OperationType.Workflow, 'AddFlpTileToGroup');

  const payload = JSON.stringify({
    chipId: `X-SAP-UI2-PAGE:X-SAP-UI2-CATALOGPAGE:${normalizeCatalogId(catalogId)}:${tileInstanceId}`,
    pageId: groupId,
  });

  const resp = await http.post(`${FLP_SERVICE_PATH}/PageChipInstances`, payload, 'application/json', {
    Accept: 'application/json',
  });

  return mapTile(parseODataSingle<FlpTileEntity>(resp.body));
}

export async function deleteCatalog(http: AdtHttpClient, safety: SafetyConfig, catalogId: string): Promise<void> {
  checkOperation(safety, OperationType.Workflow, 'DeleteFlpCatalog');

  const path = `${FLP_SERVICE_PATH}/Catalogs('${encodeURIComponent(catalogId)}')`;
  await http.delete(path, { Accept: 'application/json' });
}

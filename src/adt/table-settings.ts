/** Technical table settings (TABL/DTT): a separately locked XML document, not table source. */
import { XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { lockObject, unlockObject } from './crud.js';
import { fetchDiscoveryDocument, resolveAcceptType } from './discovery.js';
import { AdtApiError, AdtError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { escapeXmlAttr, parseXml } from './xml-parser.js';

export const TABLE_SETTINGS_COLLECTION = '/sap/bc/adt/ddic/db/settings';
export const TABLE_SETTINGS_CONTENT_TYPE = 'application/vnd.sap.adt.table.settings.v2+xml';

const bufferingPatch = z
  .object({
    allowed: z.enum(['N', 'A', 'X']).optional(),
    type: z.enum(['', 'P', 'G', 'X']).optional(),
    areaKeyFields: z.number().int().min(0).max(999).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), 'buffering must not be empty');
const settingsPatch = z
  .object({
    dataClass: z
      .string()
      .regex(/^[A-Z0-9_]{1,5}$/)
      .optional(),
    sizeCategory: z.number().int().min(0).max(9).optional(),
    loggingEnabled: z.boolean().optional(),
    buffering: bufferingPatch.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), 'provide at least one setting');
export type TableSettingsPatch = z.infer<typeof settingsPatch>;

export function parseTableSettingsPatch(source: string): TableSettingsPatch {
  try {
    return settingsPatch.parse(JSON.parse(source));
  } catch (error) {
    throw new AdtError(`Invalid TABL/DTT source: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const tableSettingsUrl = (name: string): string =>
  `${TABLE_SETTINGS_COLLECTION}/${encodeURIComponent(name.toLowerCase())}`;
export const tableSettingsParentUrl = (name: string): string =>
  `/sap/bc/adt/ddic/tables/${encodeURIComponent(name.toLowerCase())}`;

export async function assertTableSettingsService(http: AdtHttpClient, safety: SafetyConfig): Promise<void> {
  checkOperation(safety, OperationType.Read, 'ReadTableSettings');
  let accept: string | undefined;
  if (http.hasDiscoveryData()) accept = http.discoveryAcceptFor(TABLE_SETTINGS_COLLECTION);
  else {
    // Keep the discovery result request-local, as the shared client can serve different identities.
    const { map } = await fetchDiscoveryDocument(http);
    if (map.size === 0) return; // Unknown availability: let the native request establish support.
    accept = resolveAcceptType(map, TABLE_SETTINGS_COLLECTION);
  }
  if (!accept?.includes('table.settings')) {
    throw new AdtApiError(
      'TABL/DTT requires the ADT technical table settings service, unavailable on this system.',
      404,
      TABLE_SETTINGS_COLLECTION,
    );
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AdtError('Invalid technical settings metadata.');
  return value as Record<string, unknown>;
}
function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).every((key) => key === '#text' || key.startsWith('@_')))
      return scalar(fields['#text'] ?? '');
  }
  throw new AdtError('Missing or duplicate technical settings field.');
}

function integer(value: unknown): number {
  const text = scalar(value);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
    throw new AdtError('Invalid numeric technical settings metadata.');
  return Number(text);
}

export function parseTableSettings(xml: string, name: string) {
  if (XMLValidator.validate(xml) !== true) throw new AdtError('Invalid technical settings XML.');
  const root = record(parseXml(xml).tableSettings);
  const parent = record(root.containerRef);
  const version = root['@_version'];
  if (
    root['@_name'] !== name.toUpperCase() ||
    root['@_type'] !== 'TABL/DTT' ||
    parent['@_name'] !== name.toUpperCase() ||
    parent['@_type'] !== 'TABL/DT' ||
    !['active', 'inactive', 'new'].includes(String(version))
  ) {
    throw new AdtError('Technical settings metadata does not match the requested table or has no known version.');
  }
  const buffering = record(root.buffering);
  const source = {
    dataClass: scalar(root.dataClassCategory),
    sizeCategory: integer(root.sizeCategory),
    ...(root.loggingEnabled === 'true' || root.loggingEnabled === 'false'
      ? { loggingEnabled: root.loggingEnabled === 'true' }
      : {}),
    buffering: {
      allowed: scalar(buffering.allowed),
      type: scalar(buffering.type),
      areaKeyFields: integer(buffering.areaKeyFields),
    },
  };
  return {
    name: name.toUpperCase(),
    type: 'TABL/DTT',
    version: String(version),
    source,
    storageType: root.storageType,
    loadUnit: root.loadUnit,
    loggingEnabled: root.loggingEnabled,
  };
}

export async function getTableSettings(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
  version?: 'active' | 'inactive',
) {
  await assertTableSettingsService(http, safety);
  // An unversioned GET can hide another user's draft. SAP falls back to active/new if none exists.
  const response = await http.get(`${tableSettingsUrl(name)}?version=${version ?? 'inactive'}`, {
    Accept: TABLE_SETTINGS_CONTENT_TYPE,
  });
  const result = parseTableSettings(response.body, name);
  if (version && result.version !== version) {
    throw new AdtError(
      `Cannot confirm ${version} technical settings for ${name}: SAP reports ${result.version}. Omit version for the working view.`,
    );
  }
  return result;
}

/** Replace one scalar in its native scope; keep attributes, unknown elements and ordering intact. */
function replaceField(xml: string, prefix: string, field: string, value: string | number): string {
  const tag = `${prefix}${field}`;
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<${escapedTag}(?:\\s[^>]*?)?>([^<]*)</${escapedTag}\\s*>|<${escapedTag}(?:\\s[^>]*?)?/>`,
    'g',
  );
  const matches = [...xml.matchAll(pattern)];
  if (matches.length !== 1) throw new AdtError(`Cannot safely edit technical settings: expected one ${field} element.`);
  return xml.replace(pattern, (match) => {
    const opening = match.slice(0, match.indexOf('>') + 1).replace(/\s*\/>$/, '>');
    return `${opening}${escapeXmlAttr(String(value))}</${tag}>`;
  });
}

export function patchTableSettingsXml(xml: string, name: string, patch: TableSettingsPatch): string {
  patch = settingsPatch.parse(patch);
  const settings = parseTableSettings(xml, name);
  // Native settings contain scalar XML. Refuse lexical constructs that could hide matching tags.
  if (/<!--|<!\[CDATA\[|<!DOCTYPE/i.test(xml))
    throw new AdtError('Cannot safely edit technical settings containing comments, CDATA or a document type.');
  const prefix = xml.match(/<([A-Za-z_][\w.-]*:)?tableSettings\b/)?.[1] ?? '';
  if (patch.dataClass !== undefined) xml = replaceField(xml, prefix, 'dataClassCategory', patch.dataClass);
  if (patch.sizeCategory !== undefined) xml = replaceField(xml, prefix, 'sizeCategory', patch.sizeCategory);
  if (patch.loggingEnabled !== undefined) {
    // Require the root field: a nested lookalike must not stand in for an absent setting.
    if (settings.source.loggingEnabled === undefined)
      throw new AdtError('SAP does not expose a supported loggingEnabled field for this table.');
    xml = replaceField(xml, prefix, 'loggingEnabled', String(patch.loggingEnabled));
  }
  if (patch.buffering) {
    const buffering = patch.buffering;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `<${escapedPrefix}buffering(?:\\s[^>]*?)?>[\\s\\S]*?</${escapedPrefix}buffering\\s*>`,
      'g',
    );
    if ([...xml.matchAll(pattern)].length !== 1)
      throw new AdtError('Cannot safely edit technical settings: expected one buffering element.');
    xml = xml.replace(pattern, (block) => {
      for (const [field, value] of Object.entries(buffering)) {
        if (value !== undefined) block = replaceField(block, prefix, field, value);
      }
      return block;
    });
  }
  // A legal '>' inside an attribute can defeat lexical replacement; never PUT malformed XML.
  if (XMLValidator.validate(xml) !== true) throw new AdtError('Cannot safely edit this technical settings XML.');
  return xml;
}

/** Caller enforces the actual parent table's package. This function never activates. */
export async function updateTableSettings(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
  patch: TableSettingsPatch,
  transport?: string,
): Promise<string> {
  checkOperation(safety, OperationType.Update, 'UpdateTableSettings');
  await assertTableSettingsService(http, safety);
  const url = tableSettingsUrl(name);
  let saved = false;
  let saveRequested = false;
  try {
    return await http.withStatefulSession(async (session) => {
      const lock = await lockObject(session, safety, url, 'MODIFY');
      try {
        const before = (await session.get(`${url}?version=inactive`, { Accept: TABLE_SETTINGS_CONTENT_TYPE })).body;
        const version = parseTableSettings(before, name).version;
        const body = patchTableSettingsXml(before, name, patch);
        const corr = transport ?? lock.corrNr;
        const query = `?lockHandle=${encodeURIComponent(lock.lockHandle)}${corr ? `&corrNr=${encodeURIComponent(corr)}` : ''}`;
        checkOperation(safety, OperationType.Update, 'UpdateTableSettings');
        saveRequested = true;
        await session.put(
          `${url}${query}`,
          body,
          TABLE_SETTINGS_CONTENT_TYPE,
          { Accept: TABLE_SETTINGS_CONTENT_TYPE },
          // Do not replay an uncertain save; the failure hint asks the caller to inspect the draft.
          { retryTransientErrors: false },
        );
        saved = true;
        return version;
      } finally {
        await unlockObject(session, url, lock.lockHandle);
      }
    });
  } catch (error) {
    if (saveRequested) {
      const note = saved
        ? 'Technical settings were saved, but unlocking failed. Read the settings before retrying.'
        : 'Technical settings save was requested but not confirmed. Read the settings before retrying.';
      if (error instanceof AdtError) error.extraHint = `${note}\n${error.extraHint ?? ''}`;
      if (error instanceof Error) error.message = `${note}\n${error.message}`;
    }
    throw error;
  }
}

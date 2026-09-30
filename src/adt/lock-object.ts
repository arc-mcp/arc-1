/**
 * DDIC lock objects (ENQU) — read, create/update XML, and the JSON definition SAPWrite accepts.
 *
 * ADT models a lock object as ONE metadata document (no /source/main):
 *   GET/PUT /sap/bc/adt/ddic/lockobjects/sources/{name}   application/vnd.sap.adt.lockobjects.v1+xml
 *   <enqu:lockobject …><adtcore:packageRef/><enqu:content>
 *     allowRFC, primaryTable{tableName,lockMode}, secondaryTables[], lockParameters[], lockModules[]
 *   </enqu:content></enqu:lockobject>
 *
 * Live-verified on S/4HANA (SAP_BASIS 8.16), see docs/research/2026-09-28-enqu-lock-object-adt-contract.md:
 *   - create POST needs <enqu:content> with a primary table ("Primary table name must not be empty"
 *     otherwise) and stores the object inactive;
 *   - activation derives the lock parameters from the primary/secondary tables' key fields when the
 *     list is empty, and generates ENQUEUE_/DEQUEUE_ function modules (read-only <enqu:lockModules>);
 *   - update is lock → full-document PUT → unlock; description, allowRFC, lock modes and the
 *     per-parameter parameterWanted flag all round-trip.
 *
 * SAPRead returns the definition as JSON and SAPWrite takes the same JSON in "source", so a read →
 * edit → write cycle needs no reshaping. Read-only keys (name, package, lockModules, …) are ignored.
 */
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { escapeXmlAttr, getNestedArray, parseXml } from './xml-parser.js';

export const LOCKOBJECT_CONTENT_TYPE = 'application/vnd.sap.adt.lockobjects.v1+xml';
export const LOCKOBJECT_COLLECTION = '/sap/bc/adt/ddic/lockobjects/sources';

/** Definition defaults: E/S/X, or no lock for a table used only as a foreign-key link. O is runtime-only. */
export const LOCK_MODES = ['E', 'S', 'X', ''] as const;
export type LockMode = (typeof LOCK_MODES)[number];

export interface LockTable {
  tableName: string;
  lockMode: string;
}

export interface LockParameter {
  parameterName: string;
  tableName: string;
  fieldName: string;
  /** false = the parameter exists but is not passed to ENQUEUE_ (SE11 "Weight" column unchecked). */
  parameterWanted: boolean;
}

export interface LockObjectInfo {
  name: string;
  description: string;
  package: string;
  version: string;
  allowRFC: boolean;
  primaryTable: LockTable;
  secondaryTables: LockTable[];
  lockParameters: LockParameter[];
  /** Generated ENQUEUE_/DEQUEUE_ function modules (read-only; empty until activation). */
  lockModules: string[];
}

/** The writable part of a lock object — what SAPWrite accepts as JSON in "source". */
export interface LockObjectDefinition {
  allowRFC?: boolean;
  primaryTable?: LockTable;
  secondaryTables?: LockTable[];
  lockParameters?: LockParameter[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function parseLockTable(node: unknown): LockTable {
  const rec = (node ?? {}) as Record<string, unknown>;
  return { tableName: text(rec.tableName), lockMode: text(rec.lockMode) };
}

/** Parse the `<enqu:lockobject>` metadata document. */
export function parseLockObject(xml: string): LockObjectInfo {
  const parsed = parseXml(xml);
  // After NS strip: enqu:lockobject → lockobject
  const root = asRecord(parsed.lockobject);
  if (!root) throw new Error('Invalid ENQU response: expected <enqu:lockobject>.');
  const adtType = text(root['@_type']);
  if (adtType && adtType !== 'ENQU/DL') {
    throw new Error(`Invalid ENQU response: expected adtcore:type="ENQU/DL", got "${adtType}".`);
  }
  const content = (root.content ?? {}) as Record<string, unknown>;
  const pkgRef = (root.packageRef ?? {}) as Record<string, unknown>;
  return {
    name: text(root['@_name']),
    description: text(root['@_description']),
    package: text(pkgRef['@_name']),
    version: text(root['@_version']),
    allowRFC: text(content.allowRFC) === 'true',
    primaryTable: parseLockTable(content.primaryTable),
    secondaryTables: getNestedArray(content, 'secondaryTables', 'secondaryTable').map(parseLockTable),
    lockParameters: getNestedArray(content, 'lockParameters', 'lockParameter').map((rec) => ({
      parameterName: text(rec.parameterName),
      tableName: text(rec.tableName),
      fieldName: text(rec.fieldName),
      parameterWanted: text(rec.parameterWanted) !== 'false',
    })),
    lockModules: getNestedArray(content, 'lockModules', 'lockModule')
      .map((rec) => text(rec['@_name']))
      .filter(Boolean),
  };
}

/** Read a lock object. Omitting `version` returns SAP's developer view (a pending inactive edit). */
export async function getLockObject(
  http: AdtHttpClient,
  safety: SafetyConfig,
  name: string,
  version?: 'active' | 'inactive',
): Promise<LockObjectInfo> {
  checkOperation(safety, OperationType.Read, 'GetLockObject');
  const query = version ? `?version=${version}` : '';
  const resp = await http.get(`${LOCKOBJECT_COLLECTION}/${encodeURIComponent(name)}${query}`, {
    Accept: LOCKOBJECT_CONTENT_TYPE,
  });
  return parseLockObject(resp.body);
}

const DDIC_NAME_RE = /^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+$/;
/** Keys SAPRead emits that are not writable — accepted (and ignored) so read output round-trips. */
const READ_ONLY_KEYS = ['name', 'description', 'package', 'version', 'lockModules'];
const WRITABLE_KEYS = ['allowRFC', 'primaryTable', 'secondaryTables', 'lockParameters'];

function invalid(message: string): Error {
  return new Error(`Invalid ENQU source: ${message}`);
}

function rejectUnknownKeys(rec: Record<string, unknown>, allowed: string[], where: string): void {
  const unknown = Object.keys(rec).filter((key) => !allowed.includes(key));
  if (unknown.length) throw invalid(`${where}: unknown key(s) ${unknown.map((key) => `"${key}"`).join(', ')}.`);
}

function validateName(value: unknown, where: string): string {
  const name = text(value).toUpperCase();
  if (!name) throw invalid(`${where} is required.`);
  if (!DDIC_NAME_RE.test(name)) throw invalid(`${where} "${text(value)}" is not a valid DDIC name.`);
  return name;
}

function validateLockTable(value: unknown, where: string): LockTable {
  const rec = asRecord(value);
  if (!rec) throw invalid(`${where} must be an object {"tableName":"…","lockMode":"E"}.`);
  rejectUnknownKeys(rec, ['tableName', 'lockMode'], where);
  const lockMode = text(rec.lockMode ?? 'E').toUpperCase();
  if (!(LOCK_MODES as readonly string[]).includes(lockMode)) {
    throw invalid(
      `${where}.lockMode "${text(rec.lockMode)}" must be one of ${LOCK_MODES.map((mode) => JSON.stringify(mode)).join(', ')}. Optimistic mode O is a runtime option, not a definition default.`,
    );
  }
  return { tableName: validateName(rec.tableName, `${where}.tableName`), lockMode };
}

function validateBoolean(value: unknown, where: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  throw invalid(`${where} must be true or false.`);
}

/**
 * Parse and validate the JSON definition from SAPWrite "source". Unknown keys are rejected (a typo
 * such as "primarytable" would otherwise silently keep the stored value); SAPRead's read-only keys
 * are ignored so its output can be edited and written back unchanged.
 */
export function parseLockObjectDefinition(source: string): LockObjectDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (err) {
    throw invalid(`expected a JSON object (${err instanceof Error ? err.message : String(err)}).`);
  }
  const rec = asRecord(raw);
  if (!rec) throw invalid('expected a JSON object.');
  rejectUnknownKeys(rec, [...WRITABLE_KEYS, ...READ_ONLY_KEYS], 'definition');
  const def: LockObjectDefinition = {};
  if (rec.allowRFC !== undefined) def.allowRFC = validateBoolean(rec.allowRFC, 'allowRFC');
  if (rec.primaryTable !== undefined) def.primaryTable = validateLockTable(rec.primaryTable, 'primaryTable');
  if (rec.secondaryTables !== undefined) {
    if (!Array.isArray(rec.secondaryTables)) throw invalid('secondaryTables must be an array.');
    def.secondaryTables = rec.secondaryTables.map((t, i) => validateLockTable(t, `secondaryTables[${i}]`));
  }
  if (rec.lockParameters !== undefined) {
    if (!Array.isArray(rec.lockParameters)) throw invalid('lockParameters must be an array.');
    def.lockParameters = rec.lockParameters.map((p, i) => {
      const where = `lockParameters[${i}]`;
      const prec = asRecord(p);
      if (!prec) throw invalid(`${where} must be an object.`);
      rejectUnknownKeys(prec, ['parameterName', 'tableName', 'fieldName', 'parameterWanted'], where);
      return {
        parameterName: validateName(prec.parameterName ?? prec.fieldName, `${where}.parameterName`),
        tableName: validateName(prec.tableName, `${where}.tableName`),
        fieldName: validateName(prec.fieldName, `${where}.fieldName`),
        parameterWanted:
          prec.parameterWanted === undefined ? true : validateBoolean(prec.parameterWanted, `${where}.parameterWanted`),
      };
    });
  }
  return def;
}

/**
 * Overlay a (partial) definition on the stored lock object for a full-document PUT. Omitted keys
 * keep their stored value.
 *
 * Changing the table set requires explicit lockParameters: the stored ones name the old tables, and
 * when an UPDATE sends an empty list SAP re-derives them from the key fields with
 * parameterWanted=false (live 8.16; a create derives them with true). That would silently produce
 * ENQUEUE_/DEQUEUE_ modules without key parameters, so we refuse instead of guessing.
 */
export function mergeLockObjectDefinition(existing: LockObjectInfo, def: LockObjectDefinition): LockObjectDefinition {
  const primaryTable = def.primaryTable ?? existing.primaryTable;
  const secondaryTables = def.secondaryTables ?? existing.secondaryTables;
  const tableKey = (p: LockTable, s: LockTable[]) => [p.tableName, ...s.map((t) => t.tableName)].join(',');
  const tablesChanged =
    tableKey(primaryTable, secondaryTables) !== tableKey(existing.primaryTable, existing.secondaryTables);
  if (tablesChanged && def.lockParameters === undefined) {
    throw invalid(
      'changing primaryTable/secondaryTables requires "lockParameters" for the new tables ' +
        '(one {"parameterName","tableName","fieldName","parameterWanted"} per key field). ' +
        'Without them SAP re-derives the parameters with parameterWanted=false.',
    );
  }
  return {
    allowRFC: def.allowRFC ?? existing.allowRFC,
    primaryTable,
    secondaryTables,
    lockParameters: def.lockParameters ?? existing.lockParameters,
  };
}

export interface LockObjectXmlParams {
  name: string;
  description: string;
  package: string;
  definition: LockObjectDefinition;
  /** Master language, e.g. "EN" (normalized by the caller). */
  masterLanguage: string;
  /** Pre-built ` adtcore:responsible="…"` attribute, or ''. */
  responsibleAttr: string;
}

/**
 * Build the create/update body. Element order matches SAP's own GET serialization; the read-only
 * <enqu:lockModules> is omitted (a PUT without it is accepted, live-verified on 8.16).
 */
export function buildLockObjectXml(params: LockObjectXmlParams): string {
  const { definition } = params;
  if (!definition.primaryTable) {
    throw invalid('primaryTable is required, e.g. {"primaryTable":{"tableName":"ZMY_TABLE","lockMode":"E"}}.');
  }
  const table = (tag: string, t: LockTable) =>
    `<enqu:${tag}><enqu:tableName>${escapeXmlAttr(t.tableName)}</enqu:tableName><enqu:lockMode>${escapeXmlAttr(t.lockMode)}</enqu:lockMode></enqu:${tag}>`;
  const secondary = (definition.secondaryTables ?? []).map((t) => table('secondaryTable', t)).join('');
  const parameters = (definition.lockParameters ?? [])
    .map(
      (p) =>
        `<enqu:lockParameter><enqu:parameterWanted>${p.parameterWanted}</enqu:parameterWanted><enqu:parameterName>${escapeXmlAttr(p.parameterName)}</enqu:parameterName><enqu:tableName>${escapeXmlAttr(p.tableName)}</enqu:tableName><enqu:fieldName>${escapeXmlAttr(p.fieldName)}</enqu:fieldName></enqu:lockParameter>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<enqu:lockobject xmlns:enqu="http://www.sap.com/adt/ddic/enqu" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:type="ENQU/DL" adtcore:name="${escapeXmlAttr(params.name)}" adtcore:description="${escapeXmlAttr(params.description)}" adtcore:masterLanguage="${escapeXmlAttr(params.masterLanguage)}"${params.responsibleAttr}>
  <adtcore:packageRef adtcore:name="${escapeXmlAttr(params.package)}"/>
  <enqu:content><enqu:allowRFC>${definition.allowRFC === true}</enqu:allowRFC>${table('primaryTable', definition.primaryTable)}<enqu:secondaryTables>${secondary}</enqu:secondaryTables><enqu:lockParameters>${parameters}</enqu:lockParameters></enqu:content>
</enqu:lockobject>`;
}

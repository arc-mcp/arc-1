/** Interpret the backend schema before SAP can silently discard SMBC settings. Only check
 * the keywords below. Never compile a target's schema or execute its patterns. */
import { AdtApiError, AdtError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';

const SCHEMA_ACCEPT =
  'application/vnd.sap.adt.serverdriven.schema.v1+json; framework=objectTypes.v1, application/vnd.sap.adt.objecttypeschema.v1+json';
const MAX_ERRORS = 20;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeMatches(type: unknown, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    default:
      return true;
  }
}

/** Returns one message per violation (at most 20), each naming the JSON path. */
export function checkAgainstObjectSchema(schema: unknown, value: unknown): string[] {
  const errors: string[] = [];
  const walk = (node: unknown, data: unknown, path: string): void => {
    if (errors.length >= MAX_ERRORS || !isPlainObject(node)) return;
    const at = path || '/';
    if (node.type !== undefined && !typeMatches(node.type, data)) {
      errors.push(`${at}: expected ${String(node.type)}`);
      return;
    }
    if (typeof node.const === 'string' && data !== node.const) {
      errors.push(`${at}: expected ${JSON.stringify(node.const)}`);
      return;
    }
    if (Array.isArray(node.enum) && !node.enum.some((allowed) => allowed === data)) {
      errors.push(`${at}: ${JSON.stringify(data)} is not allowed. Allowed values: ${node.enum.join(', ')}`);
      if (errors.length === MAX_ERRORS) return;
    }
    // SAP 758 and 816 enforce SMBC field lengths in UTF-16 code units.
    if (typeof node.maxLength === 'number' && typeof data === 'string' && data.length > node.maxLength) {
      errors.push(`${at}: longer than ${node.maxLength} UTF-16 code units`);
    }
    if (isPlainObject(data)) {
      const properties = isPlainObject(node.properties) ? node.properties : {};
      for (const [key, child] of Object.entries(data)) {
        if (errors.length >= MAX_ERRORS) break;
        if (Object.hasOwn(properties, key)) walk(properties[key], child, `${path}/${key}`);
        else if (node.additionalProperties === false) errors.push(`${at}: unknown property "${key}"`);
      }
    }
    if (Array.isArray(data) && isPlainObject(node.items)) {
      for (const [index, item] of data.entries()) {
        if (errors.length >= MAX_ERRORS) break;
        walk(node.items, item, `${path}/${index}`);
      }
    }
  };
  walk(schema, value, '');
  return errors;
}

/** SAP's schema for one object, or undefined when the system does not serve it. */
export async function getObjectSchema(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
): Promise<unknown | undefined> {
  checkOperation(safety, OperationType.Read, 'GetObjectSchema');
  const path = `${objectUrl}/schema`;
  const hint = `Nothing was written. Check GET ${path} in SAP ADT before retrying the write.`;
  let body: string;
  try {
    const response = await http.get(path, { Accept: SCHEMA_ACCEPT }, { suppressNotFoundLog: true });
    body = response.body;
  } catch (error) {
    if (error instanceof AdtApiError && (error.isNotFound || error.statusCode === 406)) return undefined;
    if (error instanceof AdtError) error.extraHint = [error.extraHint, hint].filter(Boolean).join('\n');
    throw error;
  }

  let schema: unknown;
  try {
    schema = JSON.parse(body);
  } catch {
    throw new AdtError(`SAP returned invalid JSON for the object schema. ${hint}`);
  }
  if (!isPlainObject(schema) || schema.type !== 'object' || !isPlainObject(schema.properties)) {
    throw new AdtError(`SAP did not return the expected object schema. ${hint}`);
  }
  return schema;
}

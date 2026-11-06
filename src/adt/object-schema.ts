/**
 * Checks a server-driven object's JSON source against the JSON Schema SAP serves for it
 * (`<object>/schema`, framework=objectTypes.v1).
 *
 * SAP drops values it does not accept instead of rejecting them: an SMBC saved with
 * `listReport.variantManagement: "control"` (allowed: page, none) was stored and activated without
 * the field and without any message (816). Checking before the PUT turns that silent loss into an
 * error the caller can fix.
 *
 * The schema comes from the backend, so it is interpreted, never compiled: no Ajv (which generates
 * code from schemas and treats them as trusted) and no `pattern` (ReDoS). Only the keywords SAP's
 * schemas use are checked — type, enum, properties, additionalProperties: false, items, maxLength;
 * everything else is ignored, so an unfamiliar schema can only make the check more lenient.
 */
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';

const SCHEMA_ACCEPT = 'application/vnd.sap.adt.serverdriven.schema.v1+json; framework=objectTypes.v1';
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
    if (Array.isArray(node.enum) && !node.enum.some((allowed) => allowed === data)) {
      errors.push(`${at}: ${JSON.stringify(data)} is not allowed. Allowed values: ${node.enum.join(', ')}`);
    }
    if (typeof node.maxLength === 'number' && typeof data === 'string' && data.length > node.maxLength) {
      errors.push(`${at}: longer than ${node.maxLength} characters`);
    }
    if (isPlainObject(data)) {
      const properties = isPlainObject(node.properties) ? node.properties : {};
      for (const [key, child] of Object.entries(data)) {
        if (Object.hasOwn(properties, key)) walk(properties[key], child, `${path}/${key}`);
        else if (node.additionalProperties === false) errors.push(`${at}: unknown property "${key}"`);
      }
    }
    if (Array.isArray(data) && isPlainObject(node.items)) {
      data.forEach((item, index) => {
        walk(node.items, item, `${path}/${index}`);
      });
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
  try {
    const resp = await http.get(`${objectUrl}/schema`, { Accept: SCHEMA_ACCEPT }, { suppressNotFoundLog: true });
    return JSON.parse(resp.body) as unknown;
  } catch {
    return undefined;
  }
}

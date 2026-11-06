import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';
import type { ErrorObject } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Single-executable builds embed the schemas as assets named `aff/<file>` (scripts/build-sea.mjs). */
function readSchemaText(fileName: string): string {
  if (isSea()) return getAsset(`aff/${fileName}`, 'utf8');
  return readFileSync(join(__dirname, 'schemas', fileName), 'utf-8');
}

/** Map ARC-1 type codes to AFF type codes */
const TYPE_MAP: Record<string, string> = {
  CLAS: 'clas',
  DDLS: 'ddls',
  BDEF: 'bdef',
  SRVD: 'srvd',
  SRVB: 'srvb',
  INTF: 'intf',
  PROG: 'prog',
};

type ValidateFunction = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };

let ajv = new Ajv2020({ strict: false, allErrors: true });
const validatorCache = new Map<string, ValidateFunction>();

/**
 * Returns the raw AFF JSON schema for a given ARC-1 type code, or null if not bundled.
 */
function getAffSchema(type: string): object | null {
  const affType = TYPE_MAP[type.toUpperCase()];
  if (!affType) return null;
  try {
    const content = readSchemaText(`${affType}-v1.json`);
    return JSON.parse(content) as object;
  } catch {
    return null;
  }
}

/**
 * Validates only the header portion of AFF metadata for a given type.
 * This is useful at create time when we only have description/language, not the full object metadata.
 * Returns `{ valid: true }` if validation passes, no schema exists, or no header sub-schema is defined.
 */
export function validateAffHeader(
  type: string,
  header: Record<string, unknown>,
): { valid: boolean; errors?: string[] } {
  const affType = TYPE_MAP[type.toUpperCase()];
  if (!affType) return { valid: true };

  const cacheKey = `${affType}:header`;
  let validate = validatorCache.get(cacheKey);
  if (!validate) {
    const schema = getAffSchema(type) as Record<string, unknown> | null;
    if (!schema) return { valid: true };
    const headerSchema = (schema.properties as Record<string, unknown> | undefined)?.header as object | undefined;
    if (!headerSchema) return { valid: true };
    validate = ajv.compile(headerSchema);
    validatorCache.set(cacheKey, validate);
  }

  const valid = validate(header);
  if (valid) return { valid: true };

  const errors = ((validate as unknown as { errors?: ErrorObject[] | null }).errors ?? []).map((err: ErrorObject) => {
    // Prefix with /header to match full-schema paths
    const path = `/header${err.instancePath || ''}`;
    return formatError({ ...err, instancePath: path });
  });

  return { valid: false, errors };
}

function formatError(err: ErrorObject): string {
  const path = err.instancePath || '/';
  const msg = err.message ?? 'validation error';
  if (err.keyword === 'enum' && err.params && 'allowedValues' in err.params) {
    return `${path}: ${msg}. Allowed values: ${(err.params.allowedValues as string[]).join(', ')}`;
  }
  if (err.keyword === 'additionalProperties' && err.params && 'additionalProperty' in err.params) {
    return `${path}: unknown property "${err.params.additionalProperty}"`;
  }
  return `${path}: ${msg}`;
}

/**
 * Resets the internal validator cache. Useful for testing.
 */
export function resetValidatorCache(): void {
  validatorCache.clear();
  ajv = new Ajv2020({ strict: false, allErrors: true });
}

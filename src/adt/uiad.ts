/** UIAD full-source validation. All metadata is request-local to the current SAP identity. */
import { Ajv2020 } from 'ajv/dist/2020.js';
import { logger } from '../server/logger.js';
import { syntaxCheck } from './devtools.js';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { UiadLanguageVersion } from './server-driven.js';
import type { SyntaxCheckResult } from './types.js';

const PREFIX = '/sap/bc/adt/fiori/uiad';
const SCHEMA_ACCEPT = 'application/vnd.sap.adt.serverdriven.schema.v1+json; framework=objectTypes.v1';
const CONFIG_ACCEPT = 'application/vnd.sap.adt.serverdriven.configuration.v1+json; framework=objectTypes.v1';
export type UiadValidationStatus = 'passed' | 'failed' | 'unavailable' | 'notRun';
export interface UiadValidation {
  schema: UiadValidationStatus;
  semantic: UiadValidationStatus;
  configuration: 'editable' | 'readonly' | 'unavailable' | 'notRun';
  issues: string[];
  check?: SyntaxCheckResult;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiresRegexEvaluation(schema: unknown): boolean {
  // Conservative detection also covers constraints under $defs/propertyNames. Do not execute
  // backend regexes on the shared event loop or silently ignore them and call the schema passed.
  const pending = [schema];
  while (pending.length) {
    const value = pending.pop();
    if (value && typeof value === 'object') {
      if (!Array.isArray(value) && ('pattern' in value || 'patternProperties' in value || 'format' in value))
        return true;
      pending.push(...Object.values(value));
    }
  }
  return false;
}

/** Bounds protect parsing/compilation, not the HTTP transport's allocation. No remote refs loaded. */
function boundedJson(source: string, maxBytes: number): unknown {
  if (Buffer.byteLength(source) > maxBytes) throw new Error('JSON exceeds the UIAD validation size limit.');
  const value: unknown = JSON.parse(source);
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++nodes > 10000 || node.depth > 40) throw new Error('JSON exceeds the UIAD validation complexity limit.');
    if (node.value && typeof node.value === 'object') {
      for (const child of Object.values(node.value)) pending.push({ value: child, depth: node.depth + 1 });
    }
  }
  return value;
}

export function parseUiadSource(source: string): {
  value: Record<string, unknown>;
  languageVersion?: UiadLanguageVersion;
} {
  const value = boundedJson(source, 1024 * 1024);
  if (!record(value)) throw new Error('UIAD source must be an AFF JSON object.');
  const languageVersion = record(value.header) ? value.header.abapLanguageVersion : undefined;
  if (
    languageVersion !== undefined &&
    (typeof languageVersion !== 'string' || !['standard', 'keyUser', 'cloudDevelopment'].includes(languageVersion))
  ) {
    throw new Error('Unsupported UIAD header.abapLanguageVersion.');
  }
  return { value, languageVersion: languageVersion as UiadLanguageVersion | undefined };
}

function unsupported(error: unknown): boolean {
  return error instanceof AdtApiError && [404, 405, 406, 415, 501].includes(error.statusCode);
}

async function optionalJson(http: AdtHttpClient, uri: string, accept: string): Promise<unknown> {
  let body: string;
  try {
    body = (await http.get(uri, { Accept: accept })).body;
  } catch (error) {
    if (unsupported(error)) return undefined;
    throw error; // Authentication, authorization, and transient failures are not feature absence.
  }
  try {
    return boundedJson(body, 256 * 1024);
  } catch {
    return undefined;
  }
}

export async function validateUiadSource(
  http: AdtHttpClient,
  safety: SafetyConfig,
  uri: string,
  source: string,
  value: Record<string, unknown>,
  create: boolean,
): Promise<UiadValidation> {
  checkOperation(safety, OperationType.Read, 'ValidateUIAD');
  const result: UiadValidation = { schema: 'notRun', semantic: 'notRun', configuration: 'notRun', issues: [] };
  if (!create) {
    const configuration = await optionalJson(http, `${uri}/configuration`, CONFIG_ACCEPT);
    result.configuration =
      !record(configuration) ||
      (configuration['sap.adt.readonly'] !== undefined && typeof configuration['sap.adt.readonly'] !== 'boolean')
        ? 'unavailable'
        : configuration['sap.adt.readonly'] === true
          ? 'readonly'
          : 'editable';
    if (result.configuration === 'readonly') return result;
  }
  // These fixed paths/MIMEs were verified against the target. Never follow source $schema URLs,
  // arbitrary metadata links, or the creation-wizard schema at $new/schema.
  const schema = await optionalJson(http, create ? `${PREFIX}/$schema` : `${uri}/schema`, SCHEMA_ACCEPT);
  result.schema = 'unavailable';
  if (record(schema) && schema.type === 'object' && record(schema.properties) && 'formatVersion' in schema.properties) {
    // SAP 816 accepts AFF v1 while $schema describes v2. Applying that schema to v1 would reject
    // an existing workflow. Other versions remain subject to SAP's candidate and save checks.
    const versionSchema = schema.properties.formatVersion;
    const differentVersion =
      typeof value.formatVersion === 'string' &&
      record(versionSchema) &&
      ((typeof versionSchema.const === 'string' && versionSchema.const !== value.formatVersion) ||
        (Array.isArray(versionSchema.enum) && !versionSchema.enum.includes(value.formatVersion)));
    if (differentVersion) {
      result.issues.push(
        'The target schema describes a different AFF format version; SAP candidate and save checks determine validity.',
      );
    } else if (requiresRegexEvaluation(schema)) {
      logger.debug('UIAD schema validation unavailable', {
        reason: 'pattern_or_format',
        operation: create ? 'create' : 'update',
      });
      result.issues.push(
        'The target schema requires pattern/format evaluation; schema validation is unavailable. SAP candidate and save checks determine validity.',
      );
    } else {
      try {
        const validator = new Ajv2020({ strict: false, allErrors: false, logger: false }).compile(schema);
        result.schema = validator(value) ? 'passed' : 'failed';
        if (result.schema === 'failed') {
          const error = validator.errors?.[0];
          const property = error?.params.missingProperty ?? error?.params.additionalProperty;
          result.issues.push(
            `${error?.instancePath || '/'}: ${error?.message ?? 'Invalid source'}${property ? ` (${String(property)})` : ''}`.slice(
              0,
              1000,
            ),
          );
          return result;
        }
      } catch {
        // Unsupported dialect/unresolved refs: no compileAsync/loadSchema, no external I/O.
      }
    }
  }
  try {
    result.check = await syntaxCheck(http, safety, uri, { content: source, artifactContentType: 'application/json' });
  } catch (error) {
    if (!unsupported(error)) throw error;
    result.check = {
      checked: false,
      hasErrors: false,
      messages: [],
      statusText: 'SAP does not support this JSON candidate check.',
    };
  }
  result.semantic = result.check.hasErrors ? 'failed' : result.check.checked ? 'passed' : 'unavailable';
  return result;
}

export function uiadValidationSummary(validation: UiadValidation, minimalErrors: boolean): Record<string, unknown> {
  const { check, issues, ...status } = validation;
  const prioritized = check
    ? [...check.messages].sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'))
    : [];
  return {
    ...status,
    ...(minimalErrors ? {} : { issues }),
    ...(check
      ? {
          messageCount: check.messages.length,
          ...(minimalErrors
            ? {}
            : {
                ...(check.statusText ? { statusText: check.statusText.slice(0, 1000) } : {}),
                messages: prioritized.slice(0, 20).map(({ severity, text, line, column, code, t100 }) => ({
                  severity,
                  text: text.slice(0, 1000),
                  line,
                  column,
                  ...(code ? { code: code.slice(0, 100) } : {}),
                  ...(t100 ? { t100: { id: t100.id.slice(0, 100), number: t100.number.slice(0, 10) } } : {}),
                })),
              }),
        }
      : {}),
  };
}

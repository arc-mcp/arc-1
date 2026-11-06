/**
 * ADT RAP service generators: one database table to a full RAP stack, as in the Eclipse wizard.
 * Validation is the only collision check: the preview reports CREATE even for existing objects, and
 * neither validation nor preview checks the package, the transport or the referenced table. Generation honors
 * corrNr, and SAP adds objects the preview does not list, such as G4BA and SUSH, to the request.
 * Contract: docs/research/2026-11-06-rap-service-generators.md
 */
import { AdtError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { parseXml } from './xml-parser.js';

export const SERVICE_GENERATOR_IDS = ['uiservice', 'webapiservice'] as const;
export type ServiceGeneratorId = (typeof SERVICE_GENERATOR_IDS)[number];

const GENERATOR_MEDIA = 'application/vnd.sap.adt.repository.generator';
const CONTENT_TYPE = `${GENERATOR_MEDIA}.content.v1+json`;
const VALIDATION_ACCEPT = 'application/vnd.sap.as+xml;charset=utf-8;dataname=com.sap.adt.StatusMessage';
const VALIDATION_CHECKS = 'package,referencedobject,authorization';

export interface ServiceGeneratorInput {
  defaultContent: unknown;
  schema: unknown;
}

export interface GeneratedObjectRef {
  type: string;
  name: string;
}

export interface ServiceGenerationValidation {
  ok: boolean;
  messages: string[];
}

type XmlNode = Record<string, unknown>;

function nodes(value: unknown): XmlNode[] {
  if (value === undefined || value === null || typeof value !== 'object') return [];
  return (Array.isArray(value) ? value : [value]) as XmlNode[];
}

function referenceQuery(tableUrl: string): string {
  return `referencedObject=${encodeURIComponent(tableUrl.toLowerCase())}`;
}

function generatorPath(id: ServiceGeneratorId, tableUrl: string, resource = '', transport?: string): string {
  const correction = transport ? `&corrNr=${encodeURIComponent(transport)}` : '';
  return `/sap/bc/adt/businessservices/generators/${id}${resource}?${referenceQuery(tableUrl)}${correction}`;
}

function parseJsonResponse(body: string, what: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new AdtError(`SAP returned an unreadable generator ${what}.`);
  }
}

async function assertGeneratorOffered(http: AdtHttpClient, id: ServiceGeneratorId, tableUrl: string): Promise<void> {
  const feed = await http.get(`/sap/bc/adt/repository/generators?${referenceQuery(tableUrl)}`, {
    Accept: 'application/atom+xml;type=feed',
  });
  const entries = nodes(parseXml(feed.body).feed).flatMap((root) => nodes(root.entry));
  if (!entries.some((entry) => String(entry.id ?? '') === id)) {
    throw new AdtError(`SAP does not offer generator "${id}" for this table.`);
  }
}

/** Throws when the package does not exist: neither the generator validation nor the transport check notices. */
export async function assertGeneratorPackageExists(
  http: AdtHttpClient,
  safety: SafetyConfig,
  packageName: string,
): Promise<void> {
  checkOperation(safety, OperationType.Read, 'ReadGeneratorPackage');
  await http.get(`/sap/bc/adt/packages/${encodeURIComponent(packageName)}`);
}

/** SAP's JSON schema and default content for one generator and table. */
export async function readServiceGeneratorInput(
  http: AdtHttpClient,
  safety: SafetyConfig,
  id: ServiceGeneratorId,
  tableUrl: string,
): Promise<ServiceGeneratorInput> {
  checkOperation(safety, OperationType.Read, 'ReadServiceGeneratorInput');
  await assertGeneratorOffered(http, id, tableUrl);
  const content = await http.get(generatorPath(id, tableUrl, '/content'), { Accept: CONTENT_TYPE });
  const schema = await http.get(generatorPath(id, tableUrl, '/schema'), {
    Accept: `${GENERATOR_MEDIA}.schema.v1+json`,
  });
  return {
    defaultContent: parseJsonResponse(content.body, 'content'),
    schema: parseJsonResponse(schema.body, 'schema'),
  };
}

/** Parses SAP's status message. Only an explicit OK passes, so an unknown shape cannot allow a generation. */
export function parseGeneratorValidation(xml: string): ServiceGenerationValidation {
  const entries = nodes(parseXml(xml).abap).flatMap((root) =>
    nodes(root.values).flatMap((values) => nodes(values.DATA)),
  );
  const messages = entries.map((entry) => String(entry.SHORT_TEXT ?? '').trim()).filter(Boolean);
  const ok = entries.length > 0 && entries.every((entry) => String(entry.SEVERITY ?? '') === 'OK');
  if (!ok && messages.length === 0) messages.push('SAP returned no usable validation status.');
  return { ok, messages };
}

/** Parses the object references of a preview. */
export function parseGeneratorPreview(xml: string): GeneratedObjectRef[] {
  return nodes(parseXml(xml).objectReferences)
    .flatMap((root) => nodes(root.objectReference))
    .map((reference) => ({ type: String(reference['@_type'] ?? ''), name: String(reference['@_name'] ?? '') }))
    .filter((reference) => reference.type !== '' && reference.name !== '');
}

/** Runs SAP's validation, which persists nothing. */
export async function validateServiceGeneration(
  http: AdtHttpClient,
  safety: SafetyConfig,
  id: ServiceGeneratorId,
  tableUrl: string,
  content: string,
  transport?: string,
): Promise<ServiceGenerationValidation> {
  checkOperation(safety, OperationType.Read, 'ValidateServiceGeneration');
  await assertGeneratorOffered(http, id, tableUrl);
  const path = `${generatorPath(id, tableUrl, '/validation', transport)}&checks=${encodeURIComponent(VALIDATION_CHECKS)}`;
  const response = await http.post(path, content, CONTENT_TYPE, { Accept: VALIDATION_ACCEPT });
  return parseGeneratorValidation(response.body);
}

/** Lists the objects a validated content would create. Persists nothing. */
export async function previewServiceGeneration(
  http: AdtHttpClient,
  safety: SafetyConfig,
  id: ServiceGeneratorId,
  tableUrl: string,
  content: string,
  transport?: string,
): Promise<GeneratedObjectRef[]> {
  checkOperation(safety, OperationType.Read, 'PreviewServiceGeneration');
  const response = await http.post(generatorPath(id, tableUrl, '/preview', transport), content, CONTENT_TYPE, {
    Accept: `${GENERATOR_MEDIA}.preview.v1+xml`,
  });
  const objects = parseGeneratorPreview(response.body);
  if (objects.length === 0) throw new AdtError('SAP returned no objects in the generator preview.');
  return objects;
}

/**
 * Generates the objects. Never replayed: a lost response must not create a second stack. The response
 * names only part of what was created, so callers verify the previewed objects themselves.
 */
export async function generateService(
  http: AdtHttpClient,
  safety: SafetyConfig,
  id: ServiceGeneratorId,
  tableUrl: string,
  content: string,
  transport?: string,
): Promise<void> {
  checkOperation(safety, OperationType.Create, 'GenerateService');
  await http.post(
    generatorPath(id, tableUrl, '', transport),
    content,
    CONTENT_TYPE,
    { Accept: `${GENERATOR_MEDIA}.v1+json` },
    { noReplay: true, retryTransientErrors: false },
  );
}

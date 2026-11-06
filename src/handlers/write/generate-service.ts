/**
 * SAPWrite action generate_service: full RAP service from one database table through SAP's generators.
 * Without source it returns SAP's schema and defaults; dryRun validates and previews; otherwise it generates.
 */

import type { AdtClient } from '../../adt/client.js';
import { normalizeAdtLanguage } from '../../adt/ddic-xml.js';
import { AdtApiError } from '../../adt/errors.js';
import { checkPackage } from '../../adt/safety.js';
import {
  type GeneratedObjectRef,
  generateService,
  previewServiceGeneration,
  readServiceGeneratorInput,
  SERVICE_GENERATOR_IDS,
  type ServiceGenerationValidation,
  type ServiceGeneratorId,
  validateServiceGeneration,
} from '../../adt/service-generator.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';
import type { SapWriteContext } from './context.js';

// Only $TMP is verified: how SAP receives the transport of a generation has not been observed yet.
const GENERATION_PACKAGE = '$TMP';

type Json = Record<string, unknown>;
type ObjectState = 'found' | 'missing' | 'other_package' | 'unknown';

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isServiceGenerator(value: string): value is ServiceGeneratorId {
  return (SERVICE_GENERATOR_IDS as readonly string[]).includes(value);
}

/** Package, language and table come from the call, so the content cannot aim a generation elsewhere. */
function buildContent(source: string, table: string, language: string): { content: string } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { error: 'generate_service source must be the JSON content returned without source.' };
  }
  if (!isRecord(parsed)) return { error: 'generate_service source must be a JSON object.' };
  const metadata = isRecord(parsed.metadata) ? parsed.metadata : {};
  const general = isRecord(parsed.general) ? parsed.general : {};
  const contentPackage = metadata.package;
  if (contentPackage !== undefined && String(contentPackage).toUpperCase() !== GENERATION_PACKAGE) {
    return { error: `source metadata.package "${String(contentPackage)}" is not ${GENERATION_PACKAGE}.` };
  }
  const reference = general.referenceObjectName;
  if (reference !== undefined && String(reference).toUpperCase() !== table) {
    return { error: `source general.referenceObjectName "${String(reference)}" is not the table ${table}.` };
  }
  // SAP's parser is order-sensitive at every level and answers 400 otherwise, so keep SAP's own order.
  const { referenceObjectName: _reference, ...generalFields } = general;
  const {
    metadata: _metadata,
    general: _general,
    businessObject,
    serviceProjection,
    businessService,
    ...rest
  } = parsed;
  return {
    content: JSON.stringify({
      metadata: { package: GENERATION_PACKAGE, masterLanguage: language },
      general: { referenceObjectName: table, ...generalFields },
      businessObject,
      serviceProjection,
      businessService,
      ...rest,
    }),
  };
}

async function objectState(client: AdtClient, object: GeneratedObjectRef): Promise<ObjectState> {
  try {
    const hits = await client.searchObject(object.name, 10);
    const hit = hits.find((candidate) => candidate.objectName === object.name && candidate.objectType === object.type);
    if (!hit) return 'missing';
    return hit.packageName === GENERATION_PACKAGE ? 'found' : 'other_package';
  } catch {
    return 'unknown';
  }
}

async function inactiveNames(client: AdtClient, objects: GeneratedObjectRef[]): Promise<string[] | undefined> {
  try {
    const names = new Set(objects.map((object) => object.name));
    return (await client.getInactiveObjects()).filter((object) => names.has(object.name)).map((object) => object.name);
  } catch {
    return undefined;
  }
}

export async function writeActionGenerateService(ctx: SapWriteContext): Promise<ToolResult> {
  const { client, args, config, type, name, source, objectUrl, transport, invalidateWrittenObject } = ctx;
  const generator = String(args.generator ?? '');
  if (!isServiceGenerator(generator)) {
    return errorResult(`generate_service requires generator=${SERVICE_GENERATOR_IDS.join('|')}.`);
  }
  if ((type !== 'TABL' && type !== 'TABL/DT') || !objectUrl.includes('/ddic/tables/')) {
    return errorResult('generate_service requires type=TABL and a database table as name, not a structure.');
  }
  if (source.trim() === '') {
    return textResult(toolJson(await readServiceGeneratorInput(client.http, client.safety, generator, objectUrl)));
  }

  const requestedPackage = String(args.package ?? GENERATION_PACKAGE)
    .trim()
    .toUpperCase();
  if (requestedPackage !== GENERATION_PACKAGE || transport) {
    return errorResult(
      `generate_service supports package ${GENERATION_PACKAGE} only, without transport: ` +
        'the transport contract of this SAP API has not been verified.',
    );
  }
  await checkPackage(client.safety, GENERATION_PACKAGE, client.getPackageHierarchyResolver());

  const built = buildContent(source, name, normalizeAdtLanguage(config.language));
  if ('error' in built) return errorResult(built.error);

  let validation: ServiceGenerationValidation;
  try {
    validation = await validateServiceGeneration(client.http, client.safety, generator, objectUrl, built.content);
  } catch (err) {
    if (err instanceof AdtApiError && err.statusCode === 400) {
      return errorResult(
        `SAP could not parse the generator content; nothing was generated. Keep the sections and fields in the order of defaultContent and the schema: ${err.message}`,
      );
    }
    throw err;
  }
  if (!validation.ok) {
    return errorResult(
      `SAP rejected the generator content; nothing was generated. SAP reports one problem at a time: ${validation.messages.join(' ')}`,
    );
  }
  const objects = await previewServiceGeneration(client.http, client.safety, generator, objectUrl, built.content);
  const base = { generator, table: name, package: GENERATION_PACKAGE };
  if (args.dryRun === true) {
    return textResult(toolJson({ ...base, dryRun: true, validation: 'OK', objects }));
  }

  let failure: string | undefined;
  try {
    await generateService(client.http, client.safety, generator, objectUrl, built.content);
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }

  // A failed or lost response does not prove that nothing was created, so the state is always read back.
  const verified: Array<GeneratedObjectRef & { state: ObjectState }> = [];
  for (const object of objects) {
    verified.push({ ...object, state: await objectState(client, object) });
    invalidateWrittenObject(object.type.split('/')[0], object.name);
  }
  const inactive = await inactiveNames(client, objects);
  const result = { ...base, objects: verified, inactive: inactive ?? 'unknown' };

  if (failure !== undefined) {
    return errorResult(`SAP generation failed: ${failure}\nObjects read back afterwards: ${toolJson(result)}`);
  }
  if (verified.some((object) => object.state !== 'found')) {
    return errorResult(`SAP accepted the generation, but not every object was confirmed: ${toolJson(result)}`);
  }
  return textResult(
    toolJson({
      ...result,
      note: 'Publish the binding with SAPActivate action=publish_srvb; check it with SAPRead type=SRVB include=service_info.',
    }),
  );
}

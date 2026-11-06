/**
 * SAPWrite action generate_service: full RAP service from one database table through SAP's generators.
 * Without source it returns SAP's schema and defaults; dryRun validates and previews; otherwise it generates.
 * Contract: docs/research/2026-11-06-rap-service-generators.md
 */

import type { AdtClient } from '../../adt/client.js';
import { normalizeAdtLanguage } from '../../adt/ddic-xml.js';
import { AdtApiError, isNotFoundError } from '../../adt/errors.js';
import { checkPackage } from '../../adt/safety.js';
import {
  assertGeneratorPackageExists,
  type GeneratedObjectRef,
  generateService,
  previewServiceGeneration,
  readServiceGeneratorInput,
  SERVICE_GENERATOR_IDS,
  type ServiceGenerationValidation,
  type ServiceGeneratorId,
  validateServiceGeneration,
} from '../../adt/service-generator.js';
import { getTransport, getTransportInfo } from '../../adt/transport.js';
import type { TransportRequest } from '../../adt/types.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';
import type { SapWriteContext } from './context.js';

const LOCAL_PACKAGE = '$TMP';
// Asks about a new object in the package. Asking about the table would report the request that holds the table.
const TRANSPORT_CHECK_OBJECT = '/sap/bc/adt/businessservices/bindings/zarc1_generate_service_check';

type Json = Record<string, unknown>;
type ObjectState = 'found' | 'missing' | 'other_package' | 'other_transport' | 'unknown';

interface GenerationTarget {
  packageName: string;
  transport?: string;
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isServiceGenerator(value: string): value is ServiceGeneratorId {
  return (SERVICE_GENERATOR_IDS as readonly string[]).includes(value);
}

/** Package, language and table come from the call, so the content cannot aim a generation elsewhere. */
function buildContent(
  source: string,
  table: string,
  packageName: string,
  language: string,
): { content: string } | { error: string } {
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
  if (contentPackage !== undefined && String(contentPackage).toUpperCase() !== packageName) {
    return { error: `source metadata.package "${String(contentPackage)}" is not ${packageName}.` };
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
      metadata: { package: packageName, masterLanguage: language },
      general: { referenceObjectName: table, ...generalFields },
      businessObject,
      serviceProjection,
      businessService,
      ...rest,
    }),
  };
}

/**
 * SAP's generator checks neither the package nor the request. A generation without a valid corrNr was
 * deliberately never exercised, so an explicit open request is mandatory outside $TMP.
 */
async function resolveTarget(
  client: AdtClient,
  packageArg: unknown,
  transportArg: string | undefined,
): Promise<{ target: GenerationTarget } | { error: string }> {
  const packageName = String(packageArg ?? LOCAL_PACKAGE)
    .trim()
    .toUpperCase();
  const transport = transportArg?.trim().toUpperCase() || undefined;
  if (packageName === LOCAL_PACKAGE) {
    if (transport) return { error: `generate_service takes no transport for package ${LOCAL_PACKAGE}.` };
    await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());
    return { target: { packageName } };
  }
  if (packageName.startsWith('$')) {
    return { error: `generate_service supports ${LOCAL_PACKAGE} as its only local package, not ${packageName}.` };
  }
  if (!transport) {
    return {
      error: `generate_service requires transport for package ${packageName}. Use SAPTransport(action="list") or SAPTransport(action="create").`,
    };
  }
  await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());
  try {
    await assertGeneratorPackageExists(client.http, client.safety, packageName);
  } catch (err) {
    if (isNotFoundError(err)) return { error: `Package ${packageName} does not exist.` };
    throw err;
  }
  const info = await getTransportInfo(client.http, client.safety, TRANSPORT_CHECK_OBJECT, packageName, 'I');
  if (info.isLocal || !info.recording) {
    return { error: `Package ${packageName} does not record changes, so generate_service cannot use a transport.` };
  }
  let request: TransportRequest | null;
  try {
    request = await getTransport(client.http, client.safety, transport);
  } catch (err) {
    if (isNotFoundError(err)) return { error: `Transport ${transport} does not exist.` };
    throw err;
  }
  if (!request) {
    return { error: `Transport ${transport} is not a transport request. Pass the request number, not a task.` };
  }
  if (request.status !== 'D' && request.status !== 'L') {
    return { error: `Transport ${transport} is not modifiable (status ${request.status}).` };
  }
  return { target: { packageName, transport } };
}

function requestKeys(request: TransportRequest): Set<string> {
  const objects = [...request.tasks.flatMap((task) => task.objects), ...(request.requestObjects ?? [])];
  return new Set(objects.map((object) => `${object.type} ${object.name}`));
}

async function readRequestKeys(client: AdtClient, transport: string): Promise<Set<string> | undefined> {
  try {
    const request = await getTransport(client.http, client.safety, transport);
    return request ? requestKeys(request) : undefined;
  } catch {
    return undefined;
  }
}

async function objectState(
  client: AdtClient,
  object: GeneratedObjectRef,
  target: GenerationTarget,
  inRequest: Set<string> | undefined,
): Promise<ObjectState> {
  try {
    const hits = await client.searchObject(object.name, 10);
    const hit = hits.find((candidate) => candidate.objectName === object.name && candidate.objectType === object.type);
    if (!hit) return 'missing';
    if (hit.packageName !== target.packageName) return 'other_package';
  } catch {
    return 'unknown';
  }
  if (!target.transport) return 'found';
  if (!inRequest) return 'unknown';
  return inRequest.has(`${object.type.split('/')[0]} ${object.name}`) ? 'found' : 'other_transport';
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

  const resolved = await resolveTarget(client, args.package, transport);
  if ('error' in resolved) return errorResult(resolved.error);
  const { target } = resolved;

  const built = buildContent(source, name, target.packageName, normalizeAdtLanguage(config.language));
  if ('error' in built) return errorResult(built.error);

  let validation: ServiceGenerationValidation;
  try {
    validation = await validateServiceGeneration(
      client.http,
      client.safety,
      generator,
      objectUrl,
      built.content,
      target.transport,
    );
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
  const objects = await previewServiceGeneration(
    client.http,
    client.safety,
    generator,
    objectUrl,
    built.content,
    target.transport,
  );
  const base = {
    generator,
    table: name,
    package: target.packageName,
    ...(target.transport ? { transport: target.transport } : {}),
  };
  if (args.dryRun === true) {
    return textResult(toolJson({ ...base, dryRun: true, validation: 'OK', objects }));
  }

  const requestBefore = target.transport ? await readRequestKeys(client, target.transport) : undefined;
  let failure: string | undefined;
  try {
    await generateService(client.http, client.safety, generator, objectUrl, built.content, target.transport);
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }

  // A failed or lost response does not prove that nothing was created, so the state is always read back.
  const requestAfter = target.transport ? await readRequestKeys(client, target.transport) : undefined;
  const verified: Array<GeneratedObjectRef & { state: ObjectState }> = [];
  for (const object of objects) {
    verified.push({ ...object, state: await objectState(client, object, target, requestAfter) });
    invalidateWrittenObject(object.type.split('/')[0], object.name);
  }
  const previewed = new Set(objects.map((object) => `${object.type.split('/')[0]} ${object.name}`));
  // SAP adds objects the preview does not list; they travel with the request, so the caller must see them.
  const additionalRequestObjects =
    requestBefore && requestAfter
      ? [...requestAfter].filter((key) => !requestBefore.has(key) && !previewed.has(key))
      : undefined;
  const inactive = await inactiveNames(client, objects);
  const result = {
    ...base,
    objects: verified,
    inactive: inactive ?? 'unknown',
    ...(target.transport ? { additionalRequestObjects: additionalRequestObjects ?? 'unknown' } : {}),
  };

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

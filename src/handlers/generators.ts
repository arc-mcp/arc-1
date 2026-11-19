/**
 * ADT object generators (issue #1121): `SAPRead type=GENERATORS` lists what the system offers,
 * `SAPWrite action=generate` runs a supported generator. The SAP side lives in
 * src/adt/object-generators.ts.
 *
 * generate always runs SAP's own checks first — proposal → caller overrides → validation →
 * preview — then ARC-1's package and transport checks, and `dryRun=true` stops there. SAP checks
 * neither the package nor the request (#1202; without corrNr it picked an open request of the
 * user on 816), so outside `$TMP` an explicit, modifiable request is mandatory. The run is never
 * replayed; every previewed object is read back and reported as found / missing / other_package /
 * other_transport / unknown, plus what SAP added to the request beyond the preview.
 */
import type { AdtClient } from '../adt/client.js';
import { normalizeAdtLanguage } from '../adt/ddic-xml.js';
import { AdtApiError, isNotFoundError } from '../adt/errors.js';
import {
  assertGeneratorPackageExists,
  buildGeneratorInput,
  GENERATOR_REGISTRY,
  type GeneratorInfo,
  type GeneratorPlannedObject,
  generatorValidationPassed,
  getGeneratorDefaults,
  listGenerators,
  previewGenerator,
  runGenerator,
  summarizeGeneratorSchema,
  validateGeneratorInput,
} from '../adt/object-generators.js';
import { checkPackage } from '../adt/safety.js';
import { getTransport, getTransportInfo } from '../adt/transport.js';
import type { TransportRequest } from '../adt/types.js';
import { canonicalTablType, objectUrlForType } from './object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';
import type { SapWriteContext } from './write/context.js';

const LOCAL_PACKAGE = '$TMP';

type ObjectState = 'found' | 'missing' | 'other_package' | 'other_transport' | 'unknown';

const UNAVAILABLE =
  'ADT object generators are not available on this SAP system (/sap/bc/adt/repository/generators is missing). ' +
  'They ship with ABAP Platform 2025 / SAP_BASIS 816 and current BTP ABAP Environment releases.';

const SUPPORTED_IDS = Object.keys(GENERATOR_REGISTRY).join(', ');

async function listOrUnavailable(
  client: AdtClient,
  referencedObjectUri?: string,
): Promise<GeneratorInfo[] | ToolResult> {
  try {
    return await listGenerators(client.http, client.safety, referencedObjectUri);
  } catch (err) {
    if (isNotFoundError(err)) return errorResult(UNAVAILABLE);
    throw err;
  }
}

/** SAPRead type=GENERATORS — optionally only those applicable to objectType+name. */
export async function readGenerators(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const name = String(args.name ?? '').trim();
  const objectType = String(args.objectType ?? '')
    .trim()
    .toUpperCase();
  if (name && !objectType) {
    return errorResult('SAPRead type=GENERATORS with "name" also needs "objectType" (e.g. objectType="TABL").');
  }
  let referencedObjectUri: string | undefined;
  try {
    referencedObjectUri = name ? objectUrlForType(canonicalTablType(objectType), name.toLowerCase()) : undefined;
  } catch {
    return errorResult(
      `SAPRead type=GENERATORS cannot address objectType "${objectType}"; use e.g. TABL, DDLS or BDEF.`,
    );
  }
  const listed = await listOrUnavailable(client, referencedObjectUri);
  if (!Array.isArray(listed)) return listed;
  return textResult(
    toolJson({
      count: listed.length,
      ...(referencedObjectUri ? { referencedObject: referencedObjectUri } : {}),
      generators: listed.map(({ links: _links, ...info }) => info),
      hint: `Supported by ARC-1: ${SUPPORTED_IDS}. Start with SAPWrite action="generate" generator="<id>" type/name of the referenced object, package and dryRun=true.`,
    }),
  );
}

/**
 * Package and request checks SAP leaves to the caller. `$TMP` takes no request, other local
 * packages are refused; any other package needs an existing, recording package and an explicit
 * request that exists, is a request (not a task) and is still modifiable.
 */
async function checkTarget(
  client: AdtClient,
  packageName: string,
  transport: string | undefined,
  mainObjectUri: string,
): Promise<string | undefined> {
  if (packageName === LOCAL_PACKAGE) {
    return transport ? `Package ${LOCAL_PACKAGE} takes no transport; omit "transport".` : undefined;
  }
  try {
    await assertGeneratorPackageExists(client.http, client.safety, packageName);
  } catch (err) {
    if (isNotFoundError(err)) return `Package ${packageName} does not exist.`;
    throw err;
  }
  // Asks about a new object of the run; asked about the referenced object, SAP reports the request
  // that already holds it.
  const info = await getTransportInfo(client.http, client.safety, mainObjectUri, packageName, 'I');
  if (info.isLocal || !info.recording) {
    return `Package ${packageName} does not record changes; use ${LOCAL_PACKAGE} or a transportable package.`;
  }
  let request: TransportRequest | null;
  try {
    request = await getTransport(client.http, client.safety, transport as string);
  } catch (err) {
    if (isNotFoundError(err)) return `Transport ${transport} does not exist.`;
    throw err;
  }
  if (!request) return `Transport ${transport} is not a transport request. Pass the request number, not a task.`;
  if (request.status !== 'D' && request.status !== 'L') {
    return `Transport ${transport} is not modifiable (status ${request.status}).`;
  }
  return undefined;
}

function r3trKey(type: string, name: string): string {
  return `${type.split('/')[0]} ${name.toUpperCase()}`;
}

async function readRequestKeys(client: AdtClient, transport: string): Promise<Set<string> | undefined> {
  try {
    const request = await getTransport(client.http, client.safety, transport);
    if (!request) return undefined;
    const objects = [...request.tasks.flatMap((task) => task.objects), ...(request.requestObjects ?? [])];
    return new Set(objects.map((object) => r3trKey(object.type, object.name)));
  } catch {
    return undefined;
  }
}

/** Names under which an object appears in the repository: TOBJ carries a trailing `T` in TADIR (816). */
function repositoryNames(object: GeneratorPlannedObject): string[] {
  const name = object.name.toUpperCase();
  return object.type.startsWith('TOBJ') ? [name, `${name}T`] : [name];
}

async function objectState(
  client: AdtClient,
  object: GeneratorPlannedObject,
  packageName: string,
  transport: string | undefined,
  inRequest: Set<string> | undefined,
): Promise<ObjectState> {
  const names = repositoryNames(object);
  let hitName: string | undefined;
  try {
    for (const name of names) {
      const hits = await client.searchObject(name, 10);
      const hit = hits.find((c) => c.objectName.toUpperCase() === name && c.objectType === object.type);
      if (!hit) continue;
      if (hit.packageName.toUpperCase() !== packageName) return 'other_package';
      hitName = name;
      break;
    }
  } catch {
    return 'unknown';
  }
  if (!hitName) return 'missing';
  if (!transport) return 'found';
  if (!inRequest) return 'unknown';
  return inRequest.has(r3trKey(object.type, hitName)) ? 'found' : 'other_transport';
}

/** SAPWrite action=generate. `type`+`name` are the referenced object the generator starts from. */
export async function writeActionGenerate(ctx: SapWriteContext): Promise<ToolResult> {
  const { client, args, config, type, name, source, invalidateWrittenObject } = ctx;
  // ADT addresses the referenced object in lower case (captured from ADT 3.60).
  const objectUrl = ctx.objectUrl.toLowerCase();
  const generatorId = String(args.generator ?? '').trim();
  const entry = GENERATOR_REGISTRY[generatorId];
  if (!entry) {
    return errorResult(
      `${generatorId ? `Generator "${generatorId}" is not supported by ARC-1` : '"generator" is required for action="generate"'}. ` +
        `Supported: ${SUPPORTED_IDS}. SAPRead type="GENERATORS" lists what this system offers.`,
    );
  }
  const referencedType = canonicalTablType(type);
  if (!entry.referencedTypes.includes(referencedType)) {
    return errorResult(
      `Generator "${generatorId}" starts from ${entry.referencedTypes.join('/')}, not ${type}. Pass the referenced object as type/name.`,
    );
  }
  const packageName = String(args.package ?? '')
    .trim()
    .toUpperCase();
  if (!packageName)
    return errorResult('"package" is required for action="generate" (the package receiving all generated objects).');
  if (packageName.startsWith('$') && packageName !== LOCAL_PACKAGE) {
    return errorResult(`action="generate" supports ${LOCAL_PACKAGE} as its only local package, not ${packageName}.`);
  }
  const transport = ctx.transport?.trim().toUpperCase() || undefined;
  if (packageName !== LOCAL_PACKAGE && !transport) {
    return errorResult(
      `"transport" is required for package ${packageName}: SAP's generators do not check the request and would otherwise pick one themselves. Pass an open, modifiable request (SAPTransport action="list").`,
    );
  }
  let overrides: Record<string, unknown> | undefined;
  if (source.trim()) {
    try {
      overrides = JSON.parse(source) as Record<string, unknown>;
    } catch {
      return errorResult(
        'For action="generate", source must be JSON object text, e.g. {"options":{"addCopyAction":true}}.',
      );
    }
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return errorResult('For action="generate", source must be a JSON object, not an array or a plain value.');
    }
  }

  await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());

  const listed = await listOrUnavailable(client, objectUrl);
  if (!Array.isArray(listed)) return listed;
  const generator = listed.find((g) => g.id === generatorId);
  if (!generator) {
    return errorResult(
      `Generator "${generatorId}" is not offered for ${type} ${name} on this system. ` +
        `Offered: ${listed.map((g) => g.id).join(', ') || 'none'}.`,
    );
  }

  const dryRun = args.dryRun === true || String(args.dryRun ?? '') === 'true';
  const defaults = await getGeneratorDefaults(client.http, client.safety, generator, objectUrl, packageName);
  const input = buildGeneratorInput(
    generatorId,
    defaults.content,
    overrides,
    packageName,
    normalizeAdtLanguage(config.language),
    name,
  );
  let messages: Awaited<ReturnType<typeof validateGeneratorInput>>;
  try {
    messages = await validateGeneratorInput(client.http, client.safety, generator, objectUrl, input);
  } catch (err) {
    if (err instanceof AdtApiError && err.statusCode === 400) {
      return errorResult(
        `SAP could not parse the generator input; nothing was generated. Keep the sections and fields in the order of SAP's proposal (dryRun shows it as "input"): ${err.message}`,
      );
    }
    throw err;
  }
  const valid = generatorValidationPassed(messages);
  if (!valid && messages.length === 0) {
    messages.push({ severity: 'UNKNOWN', text: 'SAP returned no usable validation status.' });
  }
  const plannedObjects: GeneratorPlannedObject[] = valid
    ? await previewGenerator(client.http, client.safety, generator, objectUrl, input)
    : [];
  const report = {
    generator: generatorId,
    referencedObject: objectUrl,
    package: packageName,
    ...(transport ? { transport } : {}),
    valid,
    messages,
  };

  if (!valid) {
    return errorResult(
      toolJson({
        ...report,
        dryRun,
        input,
        fields: summarizeGeneratorSchema(defaults.schema),
        next: 'Fix the reported problems (source overrides or the referenced object) and retry. SAP reports one problem per call.',
      }),
    );
  }

  // The 758 preview carries no operation and reports CREATE even for existing objects; validation is
  // SAP's only collision check. An explicit non-CREATE still means the run would touch existing objects.
  const notCreated = plannedObjects.filter((o) => o.operation !== '' && o.operation.toUpperCase() !== 'CREATE');
  if (notCreated.length > 0) {
    return errorResult(
      `Generator "${generatorId}" would not only create objects (${notCreated.map((o) => `${o.operation} ${o.type} ${o.name}`).join(', ')}). ARC-1 runs generators only when every planned object is new.`,
    );
  }

  const targetError = await checkTarget(client, packageName, transport, plannedObjects[0]?.uri || objectUrl);
  if (targetError) return errorResult(targetError);

  if (dryRun) {
    return textResult(
      toolJson({
        ...report,
        dryRun,
        plannedObjects,
        input,
        fields: summarizeGeneratorSchema(defaults.schema),
        next: 'Adjust names/options with source (JSON in the structure of "input", without metadata; objects merge by key, arrays by position), then run again without dryRun.',
      }),
    );
  }

  const requestBefore = transport ? await readRequestKeys(client, transport) : undefined;
  let created: Awaited<ReturnType<typeof runGenerator>> = [];
  let failure: string | undefined;
  try {
    created = await runGenerator(client.http, client.safety, generator, objectUrl, input, transport);
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  } finally {
    invalidateWrittenObject();
  }

  // A failed or lost response does not prove that nothing was created, so the state is always read back.
  const requestAfter = transport ? await readRequestKeys(client, transport) : undefined;
  const generatedObjects: Array<GeneratorPlannedObject & { state: ObjectState }> = [];
  for (const object of plannedObjects) {
    generatedObjects.push({
      ...object,
      state: await objectState(client, object, packageName, transport, requestAfter),
    });
  }
  const previewed = new Set(plannedObjects.flatMap((o) => repositoryNames(o).map((n) => r3trKey(o.type, n))));
  // SAP adds objects the preview does not list (G4BA, SUSH, STOB, DEVC); they travel with the request.
  const additionalRequestObjects =
    requestBefore && requestAfter
      ? [...requestAfter].filter((key) => !requestBefore.has(key) && !previewed.has(key))
      : 'unknown';

  let inactiveObjects: Array<{ type: string; name: string }> | 'unknown';
  try {
    const plannedUris = new Set(plannedObjects.map((o) => o.uri.toLowerCase()));
    inactiveObjects = (await client.getInactiveObjects())
      .filter((o) => plannedUris.has(o.uri.toLowerCase()))
      .map(({ type: objType, name: objName }) => ({ type: objType, name: objName }));
  } catch {
    // best-effort: the objects exist either way, only their activation state stays unreported
    inactiveObjects = 'unknown';
  }

  const hasBinding = plannedObjects.some((o) => o.type.startsWith('SRVB'));
  const result = {
    ...report,
    created,
    generatedObjects,
    ...(transport ? { additionalRequestObjects } : {}),
    inactiveObjects,
  };
  if (failure !== undefined) {
    return errorResult(
      `SAP generation failed: ${failure}\nARC-1 deleted nothing. Objects read back afterwards: ${toolJson(result)}`,
    );
  }
  if (generatedObjects.some((o) => o.state !== 'found')) {
    return errorResult(`SAP accepted the generation, but not every object was confirmed: ${toolJson(result)}`);
  }
  const steps = [
    ...(inactiveObjects === 'unknown' || inactiveObjects.length > 0
      ? ['Activate the inactive objects with SAPActivate.']
      : []),
    ...(hasBinding
      ? [
          'Publish the service binding with SAPActivate action="publish_srvb"; check it with SAPRead type="SRVB" include="service_info".',
        ]
      : []),
  ];
  return textResult(toolJson({ ...result, ...(steps.length > 0 ? { next: steps.join(' ') } : {}) }));
}

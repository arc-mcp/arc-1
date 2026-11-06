/**
 * ADT object generators (issue #1121): `SAPRead type=GENERATORS` lists what the system offers,
 * `SAPWrite action=generate` runs a supported generator. The SAP side lives in
 * src/adt/object-generators.ts.
 *
 * generate always runs SAP's own checks first — proposal → caller overrides → validation →
 * preview — and `dryRun=true` stops there. The real run aborts on validation errors, needs the
 * target package to pass `allowedPackages`, and reports which generated objects are still inactive.
 */
import type { AdtClient } from '../adt/client.js';
import { normalizeAdtLanguage } from '../adt/ddic-xml.js';
import { isNotFoundError } from '../adt/errors.js';
import {
  buildGeneratorInput,
  GENERATOR_REGISTRY,
  type GeneratorInfo,
  type GeneratorPlannedObject,
  getGeneratorDefaults,
  hasGeneratorErrors,
  listGenerators,
  previewGenerator,
  runGenerator,
  summarizeGeneratorSchema,
  validateGeneratorInput,
} from '../adt/object-generators.js';
import { checkPackage } from '../adt/safety.js';
import { canonicalTablType, objectUrlForType } from './object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';
import type { SapWriteContext } from './write/context.js';
import { resolveCreateTransport } from './write/create-transport.js';

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

/** SAPWrite action=generate. `type`+`name` are the referenced object the generator starts from. */
export async function writeActionGenerate(ctx: SapWriteContext): Promise<ToolResult> {
  const { client, args, config, type, name, source, transport, invalidateWrittenObject } = ctx;
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
  const packageName = String(args.package ?? '').trim();
  if (!packageName)
    return errorResult('"package" is required for action="generate" (the package receiving all generated objects).');
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
  );
  const messages = await validateGeneratorInput(client.http, client.safety, generator, objectUrl, input);
  const valid = !hasGeneratorErrors(messages);
  const plannedObjects: GeneratorPlannedObject[] = valid
    ? await previewGenerator(client.http, client.safety, generator, objectUrl, input)
    : [];
  const report = { generator: generatorId, referencedObject: objectUrl, package: packageName, valid, messages };

  if (dryRun || !valid) {
    const result = {
      ...report,
      dryRun,
      plannedObjects,
      input,
      fields: summarizeGeneratorSchema(defaults.schema),
      next: valid
        ? 'Adjust names/options with source (JSON in the structure of "input", without metadata; objects merge by key, arrays by position), then run again without dryRun.'
        : 'Fix the reported problems (source overrides or the referenced object) and retry.',
    };
    return valid ? textResult(toolJson(result)) : errorResult(toolJson(result));
  }

  // Only new objects pass the package gate by construction; anything else would touch existing objects.
  const notCreated = plannedObjects.filter((o) => o.operation.toUpperCase() !== 'CREATE');
  if (notCreated.length > 0) {
    return errorResult(
      `Generator "${generatorId}" would not only create objects (${notCreated.map((o) => `${o.operation} ${o.type} ${o.name}`).join(', ')}). ARC-1 runs generators only when every planned object is new.`,
    );
  }

  let effectiveTransport = transport;
  if (!effectiveTransport) {
    const mainObjectUri = plannedObjects[0]?.uri ?? objectUrl;
    const resolved = await resolveCreateTransport(client, mainObjectUri, packageName, config.minimalErrors);
    if (resolved.error) return errorResult(resolved.error);
    effectiveTransport = resolved.transport;
  }

  let created: Awaited<ReturnType<typeof runGenerator>>;
  try {
    created = await runGenerator(client.http, client.safety, generator, objectUrl, input, effectiveTransport);
  } finally {
    invalidateWrittenObject();
  }

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

  return textResult(
    toolJson({
      ...report,
      ...(effectiveTransport ? { transport: effectiveTransport } : {}),
      created,
      generatedObjects: plannedObjects,
      inactiveObjects,
      next:
        inactiveObjects === 'unknown' || inactiveObjects.length > 0
          ? 'Activate the inactive objects with SAPActivate, then publish the service binding (SAPActivate action="publish_srvb") if the generator created one.'
          : 'Publish the service binding (SAPActivate action="publish_srvb") if the generator created one.',
    }),
  );
}

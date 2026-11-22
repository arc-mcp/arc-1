/**
 * SAPWrite action="generate": run SAP's RAP service generator on a table. Order: ARC-1's own
 * refusals (writes, package, transport, arguments) before any SAP request → generator from the feed
 * → SAP's proposal + caller overrides → validation (only OK passes) → preview → every planned
 * object must be new → dryRun stops here → one run → read every planned object back.
 * SAP checks neither the package nor the request (#1202), so ARC-1 does. SAP side: src/adt/service-generator.ts.
 */
import type { AdtClient } from '../../adt/client.js';
import { normalizeAdtLanguage } from '../../adt/ddic-xml.js';
import { isNotFoundError } from '../../adt/errors.js';
import { checkOperation, checkPackage, checkTransport, OperationType } from '../../adt/safety.js';
import {
  buildInput,
  findServiceGenerator,
  type PlannedObject,
  previewObjects,
  proposeInput,
  runGenerator,
  type ServiceGeneratorName,
  tableUri,
  validateInput,
  validationPassed,
} from '../../adt/service-generator.js';
import { getTransport } from '../../adt/transport.js';
import type { CachingLayer } from '../../cache/caching-layer.js';
import type { ServerConfig } from '../../server/types.js';
import { type CacheSecurityContext, invalidateInactiveList } from '../cache-security.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';

const LOCAL = '$TMP';

type State = 'found' | 'missing' | 'wrong_package' | 'wrong_transport' | 'unknown';

/** Package and object name as the repository search reports them, or undefined when the object does not exist. */
async function lookup(client: AdtClient, object: PlannedObject): Promise<{ packageName: string } | undefined> {
  const mainType = object.type.split('/')[0];
  const hits = await client.searchObject(object.name, 20);
  return hits.find((h) => h.objectName.toUpperCase() === object.name && h.objectType.split('/')[0] === mainType);
}

/** Objects on the request and its tasks, as "TYPE NAME". */
async function requestKeys(client: AdtClient, transport: string): Promise<Set<string>> {
  const request = await getTransport(client.http, client.safety, transport);
  const objects = [...(request?.tasks.flatMap((t) => t.objects) ?? []), ...(request?.requestObjects ?? [])];
  return new Set(objects.map((o) => `${o.type} ${o.name.toUpperCase()}`));
}

/** False when SAP answers 404 for the object. */
async function exists(client: AdtClient, path: string): Promise<boolean> {
  checkOperation(client.safety, OperationType.Read, 'ReadGeneratorTarget');
  try {
    await client.http.get(path);
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

/** SAP checks neither package nor request: `$` packages take none, others an open request (not a task). */
async function checkTarget(client: AdtClient, packageName: string, transport: string | undefined) {
  if (packageName === LOCAL) return undefined;
  if (!(await exists(client, `/sap/bc/adt/packages/${encodeURIComponent(packageName)}`))) {
    return `Package ${packageName} does not exist.`;
  }
  if (!transport) return undefined;
  let request: Awaited<ReturnType<typeof getTransport>>;
  try {
    request = await getTransport(client.http, client.safety, transport);
  } catch (err) {
    if (isNotFoundError(err)) return `Transport ${transport} does not exist.`;
    throw err;
  }
  if (!request) return `${transport} is not a transport request (pass the request, not a task).`;
  if (request.status !== 'D' && request.status !== 'L') {
    return `Transport ${transport} is not modifiable (status ${request.status}).`;
  }
  return undefined;
}

/** A rename example in this release's key names: the path to the service binding name. */
function renameExample(input: Record<string, unknown>): string {
  const find = (node: unknown, path: string): Record<string, unknown> | undefined => {
    if (!node || typeof node !== 'object') return undefined;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && /servicebinding\.(name|servicebindingname)$/i.test(`${path}.${key}`)) {
        return { [key]: `${value}_NEW` };
      }
      const inner = find(value, `${path}.${key}`);
      if (inner) return { [key]: inner };
    }
    return undefined;
  };
  return JSON.stringify(find(input, '') ?? {});
}

export async function writeActionGenerate(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  cachingLayer: CachingLayer | undefined,
  cacheSecurity: CacheSecurityContext,
): Promise<ToolResult> {
  // 1. ARC-1's refusals, before any SAP request (dry runs too: they POST to SAP).
  checkOperation(client.safety, OperationType.Create, 'GenerateObjects');
  const upper = (value: unknown) =>
    String(value ?? '')
      .trim()
      .toUpperCase();
  const generator = String(args.generator ?? '') as ServiceGeneratorName;
  const table = upper(args.name);
  const packageName = upper(args.package) || LOCAL; // like create: no package means $TMP
  const transport = upper(args.transport) || undefined;
  const dryRun = args.dryRun === true;
  if (!generator) return errorResult('"generator" is required: "ui-service" or "webapi-service".');
  if (args.type !== 'TABL') return errorResult('action="generate" starts from a database table: pass type="TABL".');
  if (packageName.startsWith('$') && transport) return errorResult(`Package ${packageName} takes no transport.`);
  if (!packageName.startsWith('$') && !transport) {
    return errorResult(
      `"transport" is required for package ${packageName}: SAP's generator does not check the request. Pass an open request (SAPTransport action="list").`,
    );
  }
  let overrides: unknown;
  try {
    overrides = JSON.parse(String(args.source ?? '').trim() || '{}');
  } catch {
    // reported below
  }
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return errorResult('source must be a JSON object with only the keys of the dry run\'s "input" to change.');
  }
  await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());
  if (transport) checkTransport(client.safety, transport, 'GenerateObjects', false);

  // 2. SAP-side target checks and the generator for this table.
  const targetError = await checkTarget(client, packageName, transport);
  if (targetError) return errorResult(targetError);
  let gen: Awaited<ReturnType<typeof findServiceGenerator>>;
  try {
    gen = await findServiceGenerator(client.http, client.safety, generator, table);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    return errorResult(
      'This SAP system has no ADT object generators (they exist on newer releases such as SAP_BASIS 7.58); create the RAP objects with SAPWrite create/batch_create instead.',
    );
  }
  if ('offered' in gen) {
    return errorResult(
      `SAP offers no "${generator}" generator for table ${table} (offered: ${gen.offered.join(', ') || 'none'}). Check that the table exists and is active.`,
    );
  }
  // Checked after the feed: 7.50 has neither generators nor /ddic/tables. 7.58 previews a stack for a missing table.
  if (!(await exists(client, tableUri(table))))
    return errorResult(`Table ${table} does not exist (pass a database table).`);

  // 3.–4. Proposal + overrides, SAP's validation, preview.
  const proposal = await proposeInput(client.http, client.safety, gen, table, packageName);
  const input = buildInput(
    proposal,
    overrides as Record<string, unknown>,
    packageName,
    normalizeAdtLanguage(config.language),
  );
  const messages = await validateInput(client.http, client.safety, gen, table, input, packageName);
  const report = { generator, table, package: packageName, ...(transport ? { transport } : {}), dryRun };
  if (!validationPassed(messages)) {
    return errorResult(
      toolJson({
        ...report,
        valid: false,
        messages: messages.length ? messages : [{ severity: 'UNKNOWN', text: 'SAP returned no validation status.' }],
        input,
        next: 'Fix the reported problem (SAP reports one per call), e.g. rename an object through source, and retry with dryRun=true.',
      }),
    );
  }
  const planned = await previewObjects(client.http, client.safety, gen, table, input);
  const objects = planned.map(({ type, name }) => ({ type, name }));

  // 5. Every planned object must be new: neither the preview nor (on 8.16) validation reliably says so.
  const notCreate = planned.filter((o) => o.operation && o.operation !== 'CREATE');
  const existing: PlannedObject[] = [];
  for (const object of planned) if (await lookup(client, object)) existing.push(object);
  if (notCreate.length || existing.length) {
    return errorResult(
      toolJson({
        ...report,
        valid: false,
        existing: [...notCreate, ...existing].map(({ type, name }) => ({ type, name })),
        input,
        next: 'These objects already exist or would be changed. Rename them through source, or delete them first.',
      }),
    );
  }
  if (dryRun) {
    return textResult(
      toolJson({
        ...report,
        valid: true,
        objects,
        input,
        next: `Show these objects to the user, then run again without dryRun to create them. To rename, pass source with only the keys to change (no "input" wrapper), e.g. ${renameExample(input)}.`,
      }),
    );
  }

  // 6. One run, never replayed; a failed or lost response does not prove nothing was created.
  let failure: string | undefined;
  try {
    await runGenerator(client.http, client.safety, gen, table, input, transport);
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  } finally {
    invalidateInactiveList(cachingLayer, client, cacheSecurity);
  }
  // best-effort read-back: a failing lookup reports "unknown" instead of hiding the run's outcome.
  const onRequest = transport ? await requestKeys(client, transport).catch(() => undefined) : undefined;
  const results: Array<{ type: string; name: string; state: State }> = [];
  for (const object of planned) {
    const hit = await lookup(client, object).catch(() => null);
    let state: State = 'found';
    if (hit === null) state = 'unknown';
    else if (!hit) state = 'missing';
    else if (hit.packageName.toUpperCase() !== packageName) state = 'wrong_package';
    else if (transport && !onRequest) state = 'unknown';
    else if (onRequest && !onRequest.has(`${object.type.split('/')[0]} ${object.name}`)) state = 'wrong_transport';
    results.push({ type: object.type, name: object.name, state });
  }
  const result = { ...report, objects: results };
  if (failure !== undefined) {
    return errorResult(`SAP generation failed: ${failure}\nARC-1 deleted nothing. Read back: ${toolJson(result)}`);
  }
  if (results.some((o) => o.state !== 'found')) {
    return errorResult(`SAP accepted the run, but not every object was confirmed: ${toolJson(result)}`);
  }
  const binding = planned.find((o) => o.type.startsWith('SRVB'));
  return textResult(
    toolJson({
      ...result,
      next: binding
        ? `Publish with SAPActivate action="publish_srvb" name="${binding.name}", then SAPRead type="SRVB" name="${binding.name}" include="service_info".`
        : 'Done.',
    }),
  );
}

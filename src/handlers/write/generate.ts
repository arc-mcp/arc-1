/**
 * SAPWrite action="generate": run SAP's RAP service generator on a table. Order: ARC-1's own
 * refusals (writes, package allowlist, arguments) before any SAP request → package and request
 * checks → generator from the feed → SAP's proposal + caller overrides → validation (only OK passes) → preview → every planned
 * object must be new → dryRun stops here → one run → read every planned object back.
 * SAP checks neither the package nor the request (#1202), so ARC-1 does. SAP side: src/adt/service-generator.ts.
 */
import type { AdtClient } from '../../adt/client.js';
import { normalizeAdtLanguage } from '../../adt/ddic-xml.js';
import { AdtApiError, isNotFoundError } from '../../adt/errors.js';
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
import { getTransport, getTransportInfo } from '../../adt/transport.js';
import type { CachingLayer } from '../../cache/caching-layer.js';
import type { ServerConfig } from '../../server/types.js';
import { type CacheSecurityContext, invalidateInactiveList } from '../cache-security.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';

const LOCAL = '$TMP';

type State = 'found' | 'missing' | 'wrong_package' | 'wrong_transport' | 'unknown';

/** Objects on the request and its tasks, as "TYPE NAME". */
async function requestKeys(client: AdtClient, transport: string): Promise<Set<string>> {
  const request = await getTransport(client.http, client.safety, transport);
  const objects = [...(request?.tasks.flatMap((t) => t.objects) ?? []), ...(request?.requestObjects ?? [])];
  return new Set(objects.map((o) => `${o.type} ${o.name.toUpperCase()}`));
}

/** SAP's metadata document for an ADT object, or undefined when SAP answers 404. */
async function readOrMissing(client: AdtClient, path: string): Promise<string | undefined> {
  checkOperation(client.safety, OperationType.Read, 'ReadGeneratorTarget');
  try {
    return (await client.http.get(path)).body;
  } catch (err) {
    if (isNotFoundError(err)) return undefined;
    throw err;
  }
}
const exists = async (client: AdtClient, path: string) => (await readOrMissing(client, path)) !== undefined;
// Every generated type (7.58, 8.16, BTP; NONT/RONT included) carries adtcore:packageRef in its metadata.
const packageOf = (metadata: string) => /packageRef\b[^>]*\bname="([^"]*)"/.exec(metadata)?.[1]?.toUpperCase() ?? '';

/**
 * SAP checks neither package nor request. Local packages ($-packages, BTP ZLOCAL) take no request;
 * recording packages need an open request (not a task). SAP's transport check decides which.
 */
async function checkTarget(client: AdtClient, table: string, packageName: string, transport: string | undefined) {
  if (packageName === LOCAL) return undefined;
  if (!(await exists(client, `/sap/bc/adt/packages/${encodeURIComponent(packageName)}`))) {
    return `Package ${packageName} does not exist.`;
  }
  // Asks about a new object: asked about the table, SAP reports the request that holds the table (#1202).
  const newObject = `/sap/bc/adt/ddic/ddl/sources/zr_${encodeURIComponent(table.toLowerCase())}`;
  const info = await getTransportInfo(client.http, client.safety, newObject, packageName, 'I');
  // Only a complete answer (RESULT=S on 7.58, 8.16, BTP) may let a run go without a request.
  if (info.result !== 'S') {
    const said = info.messages.map((m) => m.text).filter(Boolean);
    return `SAP's transport check for package ${packageName} was inconclusive${said.length ? `: ${said.join(' ')}` : ''}.`;
  }
  if (info.isLocal || !info.recording)
    return transport ? `Package ${packageName} is local and takes no transport.` : undefined;
  if (!transport) {
    return `"transport" is required for package ${packageName}: SAP's generator does not check the request. Pass an open request (SAPTransport action="list").`;
  }
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
  if (args.type !== 'TABL') {
    return errorResult(
      'action="generate" needs type="TABL" and the name of an active database table (not a structure, view or CDS entity).',
    );
  }
  if (packageName.startsWith('$') && transport) return errorResult(`Package ${packageName} takes no transport.`);
  let overrides: unknown;
  try {
    overrides = JSON.parse(String(args.source ?? '').trim() || '{}');
  } catch {
    // reported below
  }
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return errorResult('source must be a JSON object with only the keys of the dry run\'s "input" to change.');
  }
  if (Object.hasOwn(overrides, 'metadata'))
    return errorResult('metadata is set by ARC-1 from "package"; remove it from source.');
  if (transport) checkTransport(client.safety, transport, 'GenerateObjects', false);
  await checkPackage(client.safety, packageName, client.getPackageHierarchyResolver());

  // 2. SAP-side target checks and the generator for this table.
  const targetError = await checkTarget(client, table, packageName, transport);
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
  const tableMetadata = await readOrMissing(client, tableUri(table));
  if (tableMetadata === undefined) {
    return errorResult(
      `${table} is not a database table: pass the name of an active database table (not a structure, view or CDS entity).`,
    );
  }
  // Never activated: version "new" (7.58, 8.16). 7.58 then plans a stack anyway; 8.16 validation dumps (HTTP 500).
  if (/\badtcore:version="new"/.test(tableMetadata)) {
    return errorResult(
      `Table ${table} was never activated. Activate it first: SAPActivate type="TABL" name="${table}".`,
    );
  }

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

  // 5. Every planned object must be new (exact GET of SAP's own URI): neither the preview nor (on 8.16) validation reliably says so.
  // Both captured preview formats name the operation; anything but CREATE (or none) is refused.
  const notCreate = planned.filter((o) => o.operation !== 'CREATE');
  if (notCreate.length) {
    return errorResult(
      toolJson({
        ...report,
        valid: false,
        notCreate: notCreate.map(({ type, name, operation }) => ({ type, name, operation: operation || 'none' })),
        input,
        next: "SAP's preview does not plan to create these objects, and ARC-1 only creates new ones. Rename them through source.",
      }),
    );
  }
  const existing: PlannedObject[] = [];
  for (const object of planned) if (await exists(client, object.uri)) existing.push(object);
  if (existing.length) {
    return errorResult(
      toolJson({
        ...report,
        valid: false,
        existing: existing.map(({ type, name }) => ({ type, name })),
        input,
        next: 'These objects already exist. Rename them through source, or delete them first.',
      }),
    );
  }
  if (dryRun) {
    return textResult(
      toolJson({
        ...report,
        valid: true,
        ...(messages.some((m) => m.text) ? { messages } : {}),
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
    const hidden = err instanceof AdtApiError ? `SAP answered HTTP ${err.statusCode}` : 'the request failed';
    failure = config.minimalErrors ? hidden : err instanceof Error ? err.message : String(err);
  } finally {
    invalidateInactiveList(cachingLayer, client, cacheSecurity);
  }
  // best-effort read-back: a failing lookup reports "unknown" instead of hiding the run's outcome.
  const onRequest = transport ? await requestKeys(client, transport).catch(() => undefined) : undefined;
  const results: Array<{ type: string; name: string; state: State }> = [];
  for (const object of planned) {
    const metadata = await readOrMissing(client, object.uri).catch(() => null);
    let state: State = 'found';
    if (metadata === null || metadata === '') state = 'unknown';
    else if (metadata === undefined) state = 'missing';
    else if (packageOf(metadata) !== packageName) state = 'wrong_package';
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

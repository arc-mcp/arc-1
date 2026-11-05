/** Fixed native RAP/publication orchestration over current production adapters. Never executes ABAP. */
import type { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { type MutationCleanupState, pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { pinnedDdicSelection, readDdicEvidence } from '../../../src/adt/pinned-ddic-owner.js';
import { createPinnedBinding } from '../../../src/adt/pinned-service-binding.js';
import {
  applyRapHandlerScaffold,
  extractRapHandlerRequirements,
  findMissingRapHandlerImplementationStubs,
  findMissingRapHandlerRequirements,
} from '../../../src/adt/rap-handlers.js';
import { executePrivatePinnedGeneratedBindingDelete } from '../../../src/handlers/pinned-generated-binding-delete.js';
import { executePrivatePinnedNativeGovernedPublication } from '../../../src/handlers/pinned-publication-native-governed.js';
import { handlePrivatePinnedBatchActivation } from '../../../src/handlers/write/pinned-batches.js';
import { createPinnedDdicContext } from '../../../src/handlers/write/pinned-ddic-context.js';
import { createPinnedDeclarativeContext } from '../../../src/handlers/write/pinned-declarative-context.js';
import { handlePrivatePinnedRap } from '../../../src/handlers/write/pinned-rap.js';
import { createPinnedTextSourceContext } from '../../../src/handlers/write/pinned-source-input.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import { requestContext } from '../../../src/server/context.js';
import { collectionsResponseCap } from './native-ddic-collections-transport.js';
import { ddicAbsence, ddicHash } from './native-ddic-evidence.js';
import { ddicBoundHttp } from './native-ddic-transport.js';
import { type DdicWorkflowInput, ddicConfig } from './native-ddic-workflow.js';
import { observeNativeHttp } from './native-observed-http.js';
import { packageAdapterEvidence, packageOwnerAbsent } from './native-package-evidence.js';
import { assertRapDocumentParentTransition } from './native-rap-document-parent.js';
import { armDocumentPut, runRapDocumentStage } from './native-rap-documents.js';
import { RAP_DOCUMENT_STAGES, rapDocumentFixtures } from './native-rap-documents-fixtures.js';
import { type RapReceipt, rapSnapshot } from './native-rap-evidence.js';
import { RAP_STAGES, type RapFixture, rapFixtures, rapSettings } from './native-rap-fixtures.js';
import { rapCapabilities, rapConfig, rapInternalIdentity } from './native-rap-policy.js';
import { readRetainedRapGraph } from './native-rap-retained-evidence.js';
import {
  RAP_RETAINED_COMPLETED,
  RAP_RETAINED_INDICES,
  RAP_RETAINED_STAGES,
  RAP_RETAINED_SUFFIX,
  rapRetainedFixtures,
} from './native-rap-retained-fixed.js';
import {
  RAP_RETAINED_V2_COMPLETED,
  RAP_RETAINED_V2_OBSERVED_WRITES,
  RAP_RETAINED_V2_STAGES,
} from './native-rap-retained-v2-fixed.js';
import {
  RAP_RETAINED_V3_COMPLETED,
  RAP_RETAINED_V3_OBSERVED_WRITES,
  RAP_RETAINED_V3_STAGES,
} from './native-rap-retained-v3-fixed.js';
import { readActiveRetainedRapGraph } from './native-rap-retained-v4-evidence.js';
import {
  RAP_RETAINED_V4_COMPLETED,
  RAP_RETAINED_V4_OBSERVED_ACTIVATIONS,
  RAP_RETAINED_V4_OBSERVED_WRITES,
  RAP_RETAINED_V4_STAGES,
} from './native-rap-retained-v4-fixed.js';
import { checkRapRequest, rapStageOwners, rapUnlock } from './native-rap-transport.js';

interface AdapterValue {
  ok?: boolean;
  state?: string;
  sourceHash?: string;
  report?: string;
  objects?: { activation: { status?: string } }[];
  parentState?: string;
  recording?: string;
  generatedCleanup?: string;
  submitted?: number;
  items?: { state?: string }[];
}
const decoded = (r: { content: { text: string }[] }) =>
  JSON.parse(r.content.map((p) => p.text).join('\n')) as AdapterValue;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const runNativeRap = (input: DdicWorkflowInput<RapFixture>) => runRap(input, false);
export const runNativeRapDocuments = (input: DdicWorkflowInput<RapFixture>) => runRap(input, true);
export const runNativeRapDocumentsRetained = (input: DdicWorkflowInput<RapFixture>) => runRap(input, true, true);
export const runNativeRapDocumentsRetainedV2 = (input: DdicWorkflowInput<RapFixture>) =>
  runRap(input, true, 'edited-document');
export const runNativeRapDocumentsRetainedV3 = (input: DdicWorkflowInput<RapFixture>) =>
  runRap(input, true, 'updated-document');
export const runNativeRapDocumentsRetainedV4 = (input: DdicWorkflowInput<RapFixture>) =>
  runRap(input, true, 'active-binding');
async function runRap(
  input: DdicWorkflowInput<RapFixture>,
  documents: boolean,
  retained: boolean | 'edited-document' | 'updated-document' | 'active-binding' = false,
) {
  const activeBinding = retained === 'active-binding';
  const updatedDocument = retained === 'updated-document' || activeBinding;
  const editedDocument = retained === 'edited-document' || updatedDocument;
  const previousCompleted = activeBinding
    ? RAP_RETAINED_V4_COMPLETED
    : updatedDocument
      ? RAP_RETAINED_V3_COMPLETED
      : editedDocument
        ? RAP_RETAINED_V2_COMPLETED
        : RAP_RETAINED_COMPLETED;
  const retainedStages = activeBinding
    ? RAP_RETAINED_V4_STAGES
    : updatedDocument
      ? RAP_RETAINED_V3_STAGES
      : editedDocument
        ? RAP_RETAINED_V2_STAGES
        : RAP_RETAINED_STAGES;
  const observedRetainedWrites = activeBinding
    ? RAP_RETAINED_V4_OBSERVED_WRITES
    : updatedDocument
      ? RAP_RETAINED_V3_OBSERVED_WRITES
      : RAP_RETAINED_V2_OBSERVED_WRITES;
  const { base, fixtures: f, record, verify, shouldStop } = input;
  if (
    (retained && !equal(f, rapRetainedFixtures(RAP_RETAINED_SUFFIX))) ||
    f.length !== (documents ? 7 : 6) ||
    !equal(f, (documents ? rapDocumentFixtures : rapFixtures)(f[0].name.slice(-12))) ||
    !base.safety.allowWrites ||
    !equal(base.safety.multiTargetWrite, ddicConfig().multiTargetWrite) ||
    !equal(base.safety.allowedPackages, ['$TMP'])
  )
    throw new Error('Exact fresh native RAP graph and base policy required.');
  const deadline = Math.min(input.freshUntil, Date.now() + 240_000),
    signature = JSON.stringify(base.safety),
    receipts = new Map<string, RapReceipt>(),
    generated = new Map<string, string>(),
    createdAcks = new Set<string>(),
    sentMutations = new Set<string>(),
    touched = new Set<string>(),
    uncertain = new Set<string>();
  const completed: string[] = [],
    created: string[] = [],
    confirmedDeleted: string[] = [],
    sessionClosures: (boolean | undefined)[] = [];
  let stage: string | undefined,
    failure = false,
    stoppedAt: string | undefined,
    mutationAttempted = false,
    mutationDispatched = false,
    cleanupUnconfirmed = false;
  let implicitAbsent = false,
    implicitReceipt: string | undefined;
  let generationApplied = false,
    publicationState: boolean | undefined = activeBinding ? false : undefined,
    generatedCleanup: string | undefined,
    recordingState = 'not-established';
  const publicationOperations: unknown[] = [];
  let documentPut: string | undefined, documentActive: RapReceipt | undefined;
  let documentParentLink = false;
  const retainedOwners = retained
    ? [...(activeBinding ? f.map((v) => v.owner) : RAP_RETAINED_INDICES.map((i) => f[i].owner)), rapSettings(f).owner]
    : [];
  retainedOwners.forEach((owner) => {
    touched.add(owner);
  });
  const assert = () => {
    if (shouldStop() || JSON.stringify(base.safety) !== signature)
      throw new Error('RAP stopped or base policy changed.');
    verify();
    if (Date.now() >= deadline) throw new Error('RAP deadline expired.');
  };
  const options = () => ({ deadline, noReplay: true, retryTransientErrors: false });
  const sendKey = (method: string, path: string) => {
    const u = new URL(path, 'https://a4h.marianzeis.de');
    u.searchParams.delete('lockHandle');
    return `${stage}:${method}:${u.pathname.toLowerCase()}${u.search}`;
  };
  const oneShot = (method: string, path: string) =>
    ['POST', 'PUT', 'DELETE'].includes(method) &&
    !path.includes('_action=') &&
    !path.startsWith('/sap/bc/adt/cts/transportchecks');
  const clone = (http: AdtHttpClient) =>
    Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  const absent = async (http: AdtHttpClient, item: { name: string; owner: string }) => {
    try {
      await packageOwnerAbsent(http, item, record, options());
    } catch (e) {
      uncertain.add(item.owner);
      throw e;
    }
  };
  const snapshot = (c: AdtClient, item: RapFixture, active: boolean) =>
    rapSnapshot(
      c,
      item,
      active,
      record,
      options(),
      item.type === 'CLAS' && generationApplied ? generated : undefined,
      item.type === 'SRVB' ? publicationState : undefined,
    );
  async function matches(c: AdtClient, item: RapFixture) {
    const old = receipts.get(item.owner);
    if (!old) throw new Error('Missing fixed owned RAP receipt.');
    const current = await snapshot(c, item, old.active);
    const documentCreated =
      documents && item === f[3] && stage === 'create-document' && createdAcks.has(f[6].owner) && !documentParentLink;
    const documentDeleted =
      documents && item === f[3] && documentParentLink && confirmedDeleted.includes(f[6].owner) && !equal(current, old);
    if (documentCreated || documentDeleted) {
      if (documentDeleted) await absent(c.http, f[6]);
      assertRapDocumentParentTransition(f[3], f[6], old, current, documentCreated);
      assert();
      receipts.set(item.owner, current);
      documentParentLink = documentCreated;
      record({
        ownedDocumentParentTransition: item.owner,
        document: f[6].owner,
        relationPresent: documentParentLink,
        beforeFingerprint: old.fingerprint,
        afterFingerprint: current.fingerprint,
        unchangedSourceHashes: current.sourceHashes,
      });
      return current;
    }
    if (!equal(current, old)) throw new Error('Owned RAP source/metadata receipt changed.');
    assert();
    return current;
  }
  const auditSessions = (http: AdtHttpClient): AdtHttpClient =>
    new Proxy(http, {
      get(target, key) {
        if (key === 'withStatefulSession')
          return (
            fn: (s: AdtHttpClient) => Promise<unknown>,
            cleanup: Parameters<AdtHttpClient['withStatefulSession']>[1],
          ) =>
            target.withStatefulSession((s) => fn(auditSessions(s)), {
              timeoutMs: cleanup?.timeoutMs ?? 30_000,
              noReplay: true,
              responseBudget: cleanup?.responseBudget ?? new DataResponseBudget(65536, 'rap-own-close', true),
              onClose: (value) => {
                sessionClosures.push(value);
                record({ ownSessionClosed: value ?? 'unknown', phase: stage });
                cleanup?.onClose(value);
              },
            });
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const observe = (value: unknown) => {
    const v = value as { stage?: string; method?: string; path?: string; body?: string; status?: number };
    const owners = rapStageOwners(f, stage);
    if (
      documents &&
      stage === 'create-document' &&
      documentPut === undefined &&
      createdAcks.has(f[6].owner) &&
      v.stage === 'response' &&
      v.method === 'GET' &&
      v.status === 200 &&
      v.path === f[6].owner &&
      v.body
    )
      documentPut = armDocumentPut(f[6], stage, v.body, true);
    if (v.stage === 'dispatch' && v.method && v.path && oneShot(v.method, v.path))
      sentMutations.add(sendKey(v.method, v.path));
    if (
      v.stage === 'response' &&
      v.method === 'POST' &&
      [200, 201].includes(v.status ?? 0) &&
      stage?.startsWith('create-')
    ) {
      const made = owners.find(
        (o) => v.path?.split('?')[0].toLowerCase() === o.owner.slice(0, o.owner.lastIndexOf('/')).toLowerCase(),
      );
      if (made) {
        createdAcks.add(made.owner);
        record({ creationAcknowledged: made.owner, phase: stage, status: v.status });
      }
    }
    if (
      ['request', 'dispatch'].includes(v.stage ?? '') &&
      !['GET', 'HEAD'].includes(v.method ?? '') &&
      !v.path?.startsWith('/sap/bc/adt/cts/transportchecks') &&
      !v.path?.includes('_action=UNLOCK')
    ) {
      mutationAttempted = true;
      if (v.stage === 'dispatch') mutationDispatched = true;
      const selected = owners.filter(
        (o) =>
          v.path?.toLowerCase().startsWith(o.owner.toLowerCase()) ||
          v.path?.split('?')[0].toLowerCase() === o.owner.slice(0, o.owner.lastIndexOf('/')).toLowerCase(),
      );
      for (const o of selected.length ? selected : owners) {
        touched.add(o.owner);
        if (o === f[0]) touched.add(rapSettings(f).owner);
      }
    }
    const { body, ...safe } = v;
    record({ phase: stage ?? 'preflight', ...(v.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : v) });
  };
  const observed = observeNativeHttp(
    ddicBoundHttp(auditSessions(base.http), {
      deadline,
      attemptLimit: documents ? 768 : 640,
      assert,
      unlock: (m, p) => rapUnlock(f, m, p),
    }),
    (m, p, b) => {
      checkRapRequest(f, stage, m, p, b, generated, documentPut);
      if (oneShot(m, p) && sentMutations.has(sendKey(m, p)))
        throw new Error('Fixed mutation already dispatched; no replay.');
      if (!rapUnlock(f, m, p)) assert();
    },
    observe,
    async (session, path) => {
      const item = rapStageOwners(f, stage).find((v) => v.owner.toLowerCase() === path.toLowerCase());
      if (!item || !stage?.startsWith('delete-')) throw new Error('No selected RAP delete owner.');
      await matches(clone(session), item);
      if (item === f[0]) await settings(clone(session), true);
      for (const child of f.filter((v) => v.dependencies.includes(item.owner))) await absent(session, child);
      assert();
    },
  );
  const dependencies = (http: AdtHttpClient): AdtHttpClient =>
    new Proxy(http, {
      get(target, key) {
        if (key === 'withStatefulSession')
          return (
            fn: (s: AdtHttpClient) => Promise<unknown>,
            close: Parameters<AdtHttpClient['withStatefulSession']>[1],
          ) => target.withStatefulSession((s) => fn(dependencies(s)), close);
        const value = Reflect.get(target, key, target);
        if (key === 'post' || key === 'put')
          return async (...args: unknown[]) => {
            const path = String(args[0]);
            if (!path.includes('_action=') && !path.startsWith('/sap/bc/adt/cts/transportchecks')) {
              const owners = rapStageOwners(f, stage);
              const parents = new Set(
                owners.flatMap((o) => o.dependencies).filter((o) => !owners.some((v) => v.owner === o)),
              );
              if (stage?.endsWith('generation')) parents.add(f[3].owner);
              for (const owner of parents) await matches(clone(target), f.find((v) => v.owner === owner)!);
              assert();
            }
            return Reflect.apply(value, target, args);
          };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const client = clone(collectionsResponseCap(dependencies(observed), documents));
  const config = rapConfig(),
    normal = client.withSafety({ ...client.safety, ...config });
  const request = {
    requestId: `native-rap-${f[0].name.slice(-12)}`,
    user: 'MARIAN',
    target: 'A4H/001',
    identity: 'per-user' as const,
  };
  const settings = async (c: AdtClient, compare = false) => {
    const v = await readDdicEvidence(c, pinnedDdicSelection('TABL/DTT', f[0].name), undefined, options());
    record({ implicitSettings: rapSettings(f).owner, body: v.xml, sha256: ddicHash(v.xml), nativeVersion: v.version });
    if (v.version !== 'active' || v.packageName !== '$TMP') throw new Error('Owned native table settings unconfirmed.');
    const hash = ddicHash(JSON.stringify(v.root.canonicalValue({})));
    if (compare && hash !== implicitReceipt) throw new Error('Owned native table settings changed.');
    implicitReceipt = hash;
  };
  const sourceAction = async (item: RapFixture, action: 'create' | 'delete') => {
    const cleanup: MutationCleanupState = { unlockFailed: false },
      context = pinnedMutationContext(normal.safety, options(), cleanup);
    const args = {
      action,
      type: item.type,
      name: item.name,
      ...(action === 'create' ? { package: '$TMP', description: item.description, ...item.create } : {}),
    };
    const ctx =
      item.type === 'TABL/DT'
        ? await createPinnedDdicContext(normal, args, config, context)
        : item.type === 'CLAS'
          ? createPinnedTextSourceContext(normal, args, config, context)
          : createPinnedDeclarativeContext(normal, args, config, context);
    const result = await executePinnedSourceWrite(ctx);
    const value = decoded(result);
    record({ adapter: stage, result: packageAdapterEvidence(result), cleanup });
    if (action === 'delete' && value.state === 'deleted') {
      await absent(client.http, item);
      confirmedDeleted.push(item.owner);
      if (item === f[0]) {
        await absent(client.http, rapSettings(f));
        implicitAbsent = true;
      }
    }
    if (
      result.isError ||
      value.state !== (action === 'create' ? 'saved-inactive' : 'deleted') ||
      cleanup.unlockFailed ||
      cleanup.unknownLocks?.length ||
      cleanup.sessionClosed !== true
    )
      throw new Error('RAP source lifecycle incomplete.');
    if (action === 'create') {
      if (!createdAcks.has(item.owner)) throw new Error('Native creation acknowledgement missing.');
      const current = await snapshot(client, item, false);
      if (current.sourceHashes.main !== value.sourceHash) throw new Error('Created source hash mismatch.');
      receipts.set(item.owner, current);
      created.push(item.owner);
    }
  };
  const activate = async (items: RapFixture[]) => {
    for (const item of items) await matches(client, item);
    const result = await handlePrivatePinnedBatchActivation(
      normal,
      config,
      { action: 'activate', objects: items.map((v) => ({ type: v.type, name: v.name })) },
      ['read', 'write'],
    );
    const value = decoded(result);
    record({ adapter: stage, result: packageAdapterEvidence(result) });
    if (
      result.isError ||
      value.ok !== true ||
      value.objects?.length !== items.length ||
      value.objects.some((v) => v.activation.status !== 'confirmed')
    )
      throw new Error('RAP native activation incomplete.');
    for (const item of items) {
      const current = await snapshot(client, item, true);
      if (!equal(current.sourceHashes, receipts.get(item.owner)!.sourceHashes))
        throw new Error('Activation changed stored source.');
      receipts.set(item.owner, current);
      if (item === f[0]) await settings(client);
    }
  };
  try {
    assert();
    await rapCapabilities(client, documents);
    if (retained) {
      const proof = await (activeBinding ? readActiveRetainedRapGraph : readRetainedRapGraph)(
        client,
        f,
        record,
        options(),
        assert,
        (owner) => uncertain.add(owner),
        updatedDocument ? 'updated-document' : editedDocument,
      );
      proof.receipts.forEach((value, key) => {
        receipts.set(key, value);
      });
      proof.generated.forEach((value, key) => {
        generated.set(key, value);
      });
      implicitReceipt = proof.settingsHash;
      documentActive = proof.activeDocument;
      generationApplied = true;
      documentParentLink = true;
      record({
        retainedFromOriginal: retainedOwners,
        previousCompleted,
        ...(editedDocument ? { observedRetainedWrites } : {}),
        ...(activeBinding ? { observedRetainedActivations: RAP_RETAINED_V4_OBSERVED_ACTIVATIONS } : {}),
        previousClaim: 'consumed-failed',
        noOriginalCreateOrGenerationReplay: true,
      });
    } else
      await ddicAbsence(
        client,
        [...f, rapSettings(f)],
        record,
        options(),
        (rows) =>
          rows.forEach((v) => {
            uncertain.add(v.owner);
          }),
        () => f[0].name.slice(-12),
      );
    for (stage of retained ? retainedStages : documents ? RAP_DOCUMENT_STAGES : RAP_STAGES) {
      documentPut = undefined;
      assert();
      const closes = sessionClosures.length;
      record({
        stageStarted: stage,
        owners: rapStageOwners(f, stage).map((v) => v.owner),
        deadline: new Date(deadline).toISOString(),
      });
      await requestContext.run(request, async () => {
        if (documents && stage?.includes('document')) {
          const documentStage = stage,
            doc = f[6];
          const before = documentStage === 'create-document' ? undefined : await matches(client, doc);
          if (documentStage.startsWith('update-'))
            documentPut = armDocumentPut(doc, documentStage, before!.sources!.document);
          const result = await runRapDocumentStage({
            client: normal,
            observedClient: client,
            config,
            fixture: doc,
            stage: documentStage,
            before,
            active: documentActive,
            options: options(),
            record,
            assert,
            absent: async () => {
              await absent(client.http, doc);
              confirmedDeleted.push(doc.owner);
            },
            snapshot: (active) => snapshot(client, doc, active),
          });
          if (result) {
            receipts.set(doc.owner, result);
            if (result.active) documentActive = result;
          }
          if (documentStage === 'create-document') {
            if (!createdAcks.has(doc.owner)) throw new Error('Native documentation creation acknowledgement missing.');
            created.push(doc.owner);
          }
        } else if (stage === 'preview-generation' || stage === 'apply-generation') {
          const before = await matches(client, f[2]);
          await matches(client, f[3]);
          if (stage === 'preview-generation') {
            const sources = before.sources!,
              combined = Object.values(sources).join('\n\n'),
              requirements = extractRapHandlerRequirements(f[3].create.source!);
            const plan = applyRapHandlerScaffold(
              {
                main: sources.main,
                definitions: sources.definitions || undefined,
                implementations: sources.implementations || undefined,
              },
              findMissingRapHandlerRequirements(requirements, combined),
              findMissingRapHandlerImplementationStubs(requirements, combined),
            );
            if (
              !requirements.some((v) => v.methodName === 'approve') ||
              !plan.changedSections.length ||
              plan.changed.main ||
              plan.insertedSignatureCount < 1 ||
              plan.insertedImplementationStubCount < 1
            )
              throw new Error('Substantive fixed RAP generation unavailable.');
            for (const part of plan.changedSections) {
              const source = plan.sections[part];
              if (!source || Buffer.byteLength(source) > 65536 || !['definitions', 'implementations'].includes(part))
                throw new Error('Unqualified generated include.');
              generated.set(part, source);
            }
            record({
              generatedPlan: [...generated].map(([part, source]) => ({ part, source, sha256: ddicHash(source) })),
            });
          }
          const result = await handlePrivatePinnedRap(
            normal,
            config,
            {
              action: 'generate_behavior_implementation',
              type: 'CLAS',
              name: f[2].name,
              bdefName: f[3].name,
              targetAlias: 'Item',
              activate: false,
              dryRun: stage === 'preview-generation',
            },
            ['read', 'write'],
          );
          const value = decoded(result);
          record({ adapter: stage, result: packageAdapterEvidence(result) });
          const report = typeof value.report === 'string' ? JSON.parse(value.report) : undefined;
          if (
            result.isError ||
            value.ok !== true ||
            value.state !== (stage === 'preview-generation' ? 'unchanged' : 'saved-inactive') ||
            !report?.scaffoldChanged ||
            report.inserted?.signatures < 1 ||
            report.inserted?.stubs < 1 ||
            report.discovery?.classCategory !== 'behaviorPool'
          )
            throw new Error('RAP generation not confirmed.');
          if (stage === 'preview-generation') await matches(client, f[2]);
          else {
            generationApplied = true;
            const after = await snapshot(client, f[2], false);
            if (
              !equal(
                Object.keys(after.sourceHashes).filter((k) => !generated.has(k)),
                Object.keys(before.sourceHashes).filter((k) => !generated.has(k)),
              ) ||
              Object.keys(before.sourceHashes).some(
                (k) => !generated.has(k) && before.sourceHashes[k] !== after.sourceHashes[k],
              )
            )
              throw new Error('Generation changed an unselected include.');
            receipts.set(f[2].owner, after);
          }
          await matches(client, f[3]);
        } else if (stage === 'batch-activate-pool-bdef') await activate([f[2], f[3]]);
        else if (stage === 'create-binding') {
          const context = pinnedMutationContext(normal.safety, options(), { unlockFailed: false });
          const result = await createPinnedBinding(normal, context, {
            name: f[5].name,
            package: '$TMP',
            description: f[5].description,
            ...f[5].create,
          });
          record({ adapter: stage, result });
          if (!result.ok || result.state !== 'created-inactive') throw new Error('Binding creation incomplete.');
          created.push(f[5].owner);
          receipts.set(f[5].owner, await snapshot(client, f[5], false));
        } else if (stage === 'publish' || stage === 'unpublish' || stage === 'delete-generated-binding') {
          const before = await matches(client, f[5]),
            deleting = stage.startsWith('delete-'),
            scopedConfig = rapConfig(deleting, !deleting),
            scoped = client.withSafety({ ...client.safety, ...scopedConfig });
          const cleanup: MutationCleanupState = { unlockFailed: false },
            context = pinnedMutationContext(
              scoped.safety,
              {
                ...options(),
                responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'fixed-rap-binding', true),
                deadline: Math.min(deadline, Date.now() + 180000),
              },
              cleanup,
            );
          const result = deleting
            ? await executePrivatePinnedGeneratedBindingDelete(
                scoped,
                { name: f[5].name, expectedMetadataHash: before.metadataHash },
                scopedConfig,
                context,
                rapInternalIdentity(),
              )
            : await executePrivatePinnedNativeGovernedPublication(
                scoped,
                {
                  action: `${stage}_srvb`,
                  bindings: [
                    {
                      name: f[5].name,
                      expectedMetadataHash: before.metadataHash,
                      version: '0001',
                      serviceType: 'odatav4',
                    },
                  ],
                },
                scopedConfig,
                context,
                ['read', 'write'],
              );
          const value = decoded(result);
          record({ adapter: stage, result: packageAdapterEvidence(result), cleanup });
          if (value.recording === 'native-governed-unverified') recordingState = value.recording;
          if (deleting) generatedCleanup = value.generatedCleanup;
          publicationOperations.push({
            action: stage,
            dispatchObserved: [...sentMutations].some((k) => k.startsWith(`${stage}:${deleting ? 'DELETE' : 'POST'}:`)),
            ok: value.ok,
            state: value.state,
            parentState: value.parentState,
            submitted: value.submitted,
            recording: value.recording,
            generatedCleanup: value.generatedCleanup,
            items: value.items,
          });
          if (deleting && value.parentState === 'deleted') {
            await absent(client.http, f[5]);
            confirmedDeleted.push(f[5].owner);
          }
          if (result.isError || value.ok !== true || value.recording !== 'native-governed-unverified')
            throw new Error('Native-governed binding operation incomplete.');
          if (deleting) {
            if (
              value.state !== 'accepted-unverified' ||
              value.parentState !== 'deleted' ||
              value.generatedCleanup !== 'accepted-unverified' ||
              cleanup.sessionClosed !== true
            )
              throw new Error('Generated cleanup outcome unqualified.');
            generatedCleanup = value.generatedCleanup;
          } else {
            if (value.submitted !== 1 || value.items?.[0]?.state !== 'native-state-observed')
              throw new Error('Publication status not observed.');
            publicationState = stage === 'publish';
            receipts.set(f[5].owner, await snapshot(client, f[5], true));
          }
        } else {
          const item = rapStageOwners(f, stage)[0];
          if (stage!.startsWith('activate-')) await activate([item]);
          else {
            if (stage!.startsWith('delete-')) await matches(client, item);
            await sourceAction(item, stage!.startsWith('create-') ? 'create' : 'delete');
          }
        }
      });
      if (sessionClosures.slice(closes).some((v) => v !== true)) {
        cleanupUnconfirmed = true;
        throw new Error('Owning session closure unconfirmed.');
      }
      assert();
      completed.push(stage);
      record({ stageCompleted: stage });
    }
    await ddicAbsence(
      client,
      [...f, rapSettings(f)],
      record,
      options(),
      (rows) =>
        rows.forEach((v) => {
          uncertain.add(v.owner);
        }),
      () => f[0].name.slice(-12),
    );
    assert();
  } catch (error) {
    failure = true;
    stoppedAt = stage ?? 'preflight';
    cleanupUnconfirmed ||= sessionClosures.some((v) => v !== true);
    record({
      failure,
      stoppedAt,
      reason: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown RAP failure',
      cleanupUnconfirmed,
    });
  }
  const remaining = [
    ...new Set(
      [...touched]
        .filter((o) => !confirmedDeleted.includes(o) && !(o === rapSettings(f).owner && implicitAbsent))
        .concat([...uncertain]),
    ),
  ];
  return {
    failure,
    stopped: shouldStop(),
    stoppedAt,
    mutationAttempted,
    mutationDispatched,
    completed,
    created,
    ...(retained
      ? {
          retainedFromOriginal: retainedOwners,
          previousCompleted,
          ...(editedDocument ? { observedRetainedWrites } : {}),
          ...(activeBinding ? { observedRetainedActivations: RAP_RETAINED_V4_OBSERVED_ACTIVATIONS } : {}),
          previousClaim: 'consumed-failed',
        }
      : {}),
    confirmedDeleted,
    remaining,
    inspectionRequired: failure ? [...new Set([...remaining, ...(remaining.length ? [] : f.map((v) => v.owner))])] : [],
    cleanupUnconfirmed,
    finalAbsenceConfirmed: !failure && confirmedDeleted.length === f.length,
    generatedCleanup,
    implicitResources: [{ ...rapSettings(f), parent: f[0].owner, absenceConfirmed: implicitAbsent }],
    recording: recordingState,
    publicationOperations,
    authentication: 'Basic-native-contract-only',
    publicationObservation:
      'Sequential native status and binding metadata; no frontend, all-alias, generated-state absence or CTS receipt guarantee.',
  };
}

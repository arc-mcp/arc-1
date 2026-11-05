/** Recorded operations reuse the production CTS, move and API-release helpers. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { type PinnedMutationContext, pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { setPinnedApiReleaseState } from '../../../src/adt/pinned-api-release.js';
import { parseCtsTree } from '../../../src/adt/pinned-cts-evidence.js';
import { readPinnedPackage } from '../../../src/adt/pinned-package.js';
import { movePinnedObjectPackage } from '../../../src/adt/pinned-package-move.js';
import { preparePinnedTransport } from '../../../src/adt/pinned-transport-scope.js';
import { createTransport } from '../../../src/adt/transport.js';
import { CTS_CONTENT_TYPE_ORGANIZER, CTS_NAMESPACE_TM } from '../../../src/adt/transport-contract.js';
import { PACKAGE_API_MOVED_PAIR, PACKAGE_API_MOVED_READS } from './native-package-api-moved-fixed.js';
import { inspectMovedPackageRequest } from './native-package-api-moved-members.js';
import {
  apiDocumentPath,
  type PackageLifecycleStage,
  packageApiDescription,
  RECORDED_PACKAGE,
  RECORDED_PACKAGE_URI,
} from './native-package-api-profile.js';
import { type PackageJournal, packageHash } from './native-package-evidence.js';
import type { PackageGraph } from './native-package-fixtures.js';

const CORE = 'http://www.sap.com/adt/core',
  ARS = 'http://www.sap.com/adt/ars';
export async function recordedPackageReceipt(client: AdtClient, options: AdtRequestOptions, record: PackageJournal) {
  const response = await client.http.get(
    RECORDED_PACKAGE_URI,
    { Accept: 'application/*', 'Cache-Control': 'no-cache' },
    options,
  );
  record({
    recordedPackageRead: RECORDED_PACKAGE_URI,
    status: response.statusCode,
    body: response.body,
    sha256: packageHash(response.body),
  });
  const root = nativeXmlRoot(response.body, 'package', 'http://www.sap.com/adt/packages', true);
  const reader = Object.assign(Object.create(Object.getPrototypeOf(client)), client, {
    http: { get: async () => response },
    getPackageHierarchyResolver: () => client.getPackageHierarchyResolver(options),
  }) as AdtClient;
  const value = await readPinnedPackage(reader, { name: RECORDED_PACKAGE, objectUrl: RECORDED_PACKAGE_URI });
  if (
    response.statusCode !== 200 ||
    root.attribute('version', CORE) !== 'active' ||
    root.attribute('createdBy', CORE) !== 'MARIAN' ||
    value.recordChanges !== 'true' ||
    value.softwareComponent !== 'HOME' ||
    value.transportLayer !== '' ||
    value.packageType !== 'development'
  )
    throw new Error('Recorded package prerequisite differs from the observed native contract.');
  return packageHash(response.body);
}
export function packageApiActions(
  base: AdtClient,
  graph: PackageGraph,
  options: () => AdtRequestOptions,
  record: PackageJournal,
  assert: () => void,
  seed?: {
    request: string;
    task: string;
    targetReceipt: string;
    initialRequestHash: string;
    moved?: true;
    originalTask?: string;
  },
) {
  let request = seed?.request,
    task = seed?.task,
    targetReceipt = seed?.targetReceipt;
  let createAttempted = false,
    apiResource: string | undefined,
    apiBody: string | undefined,
    moved = seed?.moved === true;
  let classRecorded = false,
    apiRecorded = false,
    apiWritten = false;
  const operations: unknown[] = [];
  let lastTree: ReturnType<typeof parseCtsTree> | undefined;
  let membershipVerified = false;
  const readTarget = async (client: AdtClient) => {
    const current = await recordedPackageReceipt(client, options(), record);
    if (targetReceipt && current !== targetReceipt) throw new Error('Recorded package metadata drift.');
    targetReceipt = current;
    assert();
  };
  const ids = () => {
    if (!request || !task) throw new Error('Fresh native request and task are not established.');
    return { request, task };
  };
  const scoped = () => {
    const { request: id } = ids();
    const safety = base.safety;
    return base.withSafety({
      ...safety,
      allowTransportWrites: false,
      allowedTransports: [id],
      multiTargetWrite: { ...safety.multiTargetWrite!, allowedTransports: [id], serverAllowedTransports: [id] },
    });
  };
  const readTree = async (client: AdtClient, empty = false) => {
    membershipVerified = false;
    if (!request) throw new Error('No native generated request ID.');
    const response = await client.http.get(
      `/sap/bc/adt/cts/transportrequests/${request}`,
      { Accept: CTS_CONTENT_TYPE_ORGANIZER, 'Cache-Control': 'no-cache' },
      options(),
    );
    record({
      ownedRequestRead: request,
      status: response.statusCode,
      body: response.body,
      sha256: packageHash(response.body),
    });
    if (response.statusCode !== 200 || (empty && seed && packageHash(response.body) !== seed.initialRequestHash))
      throw new Error('Request readback unconfirmed.');
    const tree =
      moved && seed?.moved
        ? inspectMovedPackageRequest(response.body, graph, apiResource, empty)
        : parseCtsTree(response.body, request);
    const root = nativeXmlRoot(response.body, 'root', CTS_NAMESPACE_TM, true);
    const parent = root.child('request', CTS_NAMESPACE_TM);
    if (
      tree.parent?.owner !== 'MARIAN' ||
      tree.parent.status !== 'D' ||
      tree.parent.type !== 'K' ||
      tree.parent.target !== '' ||
      parent?.attribute('target', CTS_NAMESPACE_TM) !== '' ||
      tree.parent.description !== packageApiDescription(graph) ||
      parent?.attribute('source_client', CTS_NAMESPACE_TM) !== '001' ||
      (seed?.moved ? tree.tasks.length !== 2 : tree.tasks.length !== 1)
    )
      throw new Error('Fresh request identity/state/target/membership unconfirmed.');
    const child = seed?.moved ? tree.tasks.find((n) => n.id === PACKAGE_API_MOVED_PAIR.task)! : tree.tasks[0];
    if (
      !/^A4HK[0-9]{6}$/.test(child.id) ||
      child.id === request ||
      ['A4HK906605', 'A4HK906606', 'A4HK906607', 'A4HK906608'].includes(child.id) ||
      child.owner !== 'MARIAN' ||
      child.status !== 'D' ||
      child.target !== '' ||
      (!seed?.moved && parent?.child('task', CTS_NAMESPACE_TM)?.attribute('target', CTS_NAMESPACE_TM) !== '') ||
      !child.type ||
      (task && child.id !== task)
    )
      throw new Error('Fresh MARIAN task unconfirmed.');
    const all = [tree.parent, ...tree.tasks].flatMap((node) => node.objects);
    if (
      (empty && !seed?.moved && all.length) ||
      all.some(
        (row) =>
          row.pgmid !== 'R3TR' ||
          !(
            (row.type === 'CLAS' && row.name === graph.clas.name) ||
            (row.type === 'APIS' &&
              !!apiResource &&
              `/sap/bc/adt/apireleases/apis/${encodeURIComponent(row.name)}` === apiResource)
          ),
      )
    )
      throw new Error('Unexpected request object membership.');
    if (moved && !classRecorded && !all.some((row) => row.type === 'CLAS' && row.name === graph.clas.name))
      throw new Error('Moved class recording not observed in the owned request.');
    classRecorded ||= moved && all.some((row) => row.type === 'CLAS' && row.name === graph.clas.name);
    apiRecorded ||= !!apiResource && all.some((row) => row.type === 'APIS');
    if (apiWritten && !apiRecorded) throw new Error('APIS recording not observed in the owned request.');
    task = child.id;
    lastTree = tree;
    membershipVerified = true;
    record({
      requestSnapshot: tree,
      interpretation: empty && !seed?.moved ? 'new-empty-pair' : 'observed-owned-records-not-released-or-removed',
    });
    assert();
    return tree;
  };
  const apiRead = async (client: AdtClient) => {
    const response = await client.http.get(
      apiDocumentPath(graph),
      { Accept: 'application/vnd.sap.adt.apirelease.v10+xml', 'Cache-Control': 'no-cache' },
      options(),
    );
    record({
      ownedApiRead: apiDocumentPath(graph),
      status: response.statusCode,
      body: response.body,
      sha256: packageHash(response.body),
    });
    if (response.statusCode !== 200) throw new Error('API document unavailable.');
    const root = nativeXmlRoot(response.body, 'apiRelease', ARS, true);
    const owner = root.child('releasableObject', ARS);
    if (
      owner?.attribute('name', CORE) !== graph.clas.name ||
      owner.attribute('type', CORE) !== 'CLAS/OC' ||
      owner.attribute('uri', CORE)?.toLowerCase() !== graph.clas.owner
    )
      throw new Error('API owner differs.');
    const states: Record<string, string> = {};
    for (let n = 0; n <= 4; n++) {
      const block = root.child(`c${n}Release`, ARS);
      if (!block) continue;
      const state = block.child('status', ARS)?.attribute('state', ARS);
      if (!['RELEASED', 'NOT_RELEASED'].includes(state ?? '')) throw new Error('Unknown native API state.');
      states[`C${n}`] = state!;
    }
    const block = root.child('c1Release', ARS),
      resource = block?.child('transportObject', ARS);
    const name = resource?.attribute('name', CORE),
      uri = resource?.attribute('uri', CORE);
    if (
      !states.C1 ||
      !name?.startsWith(`${graph.clas.name} `) ||
      name.trimEnd().slice(graph.clas.name.length).trim() !== 'CLAS' ||
      resource?.attribute('type', CORE) !== 'APIS' ||
      resource.attribute('packageName', CORE) !== RECORDED_PACKAGE ||
      uri !== `/sap/bc/adt/apireleases/apis/${encodeURIComponent(name)}` ||
      (apiResource && apiResource !== uri)
    )
      throw new Error('Native APIS resource binding differs.');
    apiResource = uri;
    apiBody = response.body;
    assert();
    return {
      states,
      body: response.body,
      anyReleased: root.child('apiCatalogData', ARS)?.attribute('isAnyContractReleased', ARS),
    };
  };
  return {
    ids,
    scoped,
    readTarget,
    readTree,
    get moved() {
      return moved;
    },
    scope: () => ({
      request,
      task,
      ...(seed?.moved ? { originalTask: seed.originalTask } : {}),
      apiResource,
      apiBody,
      moved,
    }),
    evidence: () => ({
      createAttempted,
      ...(seed ? { adoptedExistingPair: true } : {}),
      ...(seed?.moved
        ? { adoptedMovedClass: true, originalTask: seed.originalTask, members: [request, seed.originalTask, task] }
        : {}),
      request,
      task,
      lastObserved: lastTree,
      disposition: 'retained-request-and-task-with-native-records',
      membershipVerified,
      inspectionRequired: membershipVerified
        ? []
        : request
          ? [request, ...(seed?.originalTask ? [seed.originalTask] : []), ...(task ? [task] : [])]
          : [],
      classRecorded,
      apiRecorded,
      operations,
    }),
    async adopt() {
      if (!seed) throw new Error('No compiled retained request pair.');
      if (seed.moved && JSON.stringify(seed) !== JSON.stringify(PACKAGE_API_MOVED_PAIR))
        throw new Error('Exact moved seed required.');
      await readTarget(base);
      await readTree(base, true);
      if (seed.moved) {
        const initial = await apiRead(base);
        if (
          packageHash(initial.body) !==
            PACKAGE_API_MOVED_READS.find((r) => r.path === apiDocumentPath(graph))?.sha256 ||
          initial.anyReleased !== 'false' ||
          Object.values(initial.states).some((state) => state !== 'NOT_RELEASED')
        )
          throw new Error('Untouched API prerequisite differs.');
      } else if (lastTree?.tasks[0]?.type !== 'Unclassified') throw new Error('Retained task type drift.');
    },
    async run(stage: PackageLifecycleStage, client: AdtClient, context: PinnedMutationContext) {
      if (seed?.moved && ['create-request', 'move-class'].includes(stage))
        throw new Error('Observed move/creation cannot replay.');
      if (stage === 'create-request') {
        if (seed) throw new Error('Consumed request creation cannot replay.');
        await readTarget(client);
        const safety = { ...client.safety, allowTransportWrites: true };
        const policy = options();
        if (policy.deadline === undefined) throw new Error('Missing native deadline.');
        const creation = pinnedMutationContext(
          safety,
          { ...policy, deadline: policy.deadline },
          { unlockFailed: false },
        );
        const prepared = await preparePinnedTransport(client.http, safety, creation, 'create');
        assert();
        createAttempted = true;
        request = await createTransport(prepared.http, prepared.safety, packageApiDescription(graph), RECORDED_PACKAGE);
        // A bare/legacy URI is parsed by the real existing helper; no invented task or second CREATE.
        record({ generatedRequest: request });
        if (
          !/^A4HK[0-9]{6}$/.test(request) ||
          ['A4HK906605', 'A4HK906606', 'A4HK906607', 'A4HK906608'].includes(request)
        )
          throw new Error('Fresh generated request ID unconfirmed.');
        await readTree(client, true);
        return;
      }
      await readTarget(client);
      await readTree(client);
      const transport = ids().request;
      if (stage === 'move-class') {
        const result = await movePinnedObjectPackage(client, context, {
          objectName: graph.clas.name,
          objectType: 'CLAS/OC',
          oldPackage: graph.child.name,
          newPackage: RECORDED_PACKAGE,
          transport,
        });
        record({ adapter: 'move-class', result });
        operations.push({ stage, result });
        if (
          !result.ok ||
          result.state !== 'moved' ||
          !result.recording ||
          typeof result.recording !== 'object' ||
          result.recording.local ||
          result.recording.request !== transport
        )
          throw new Error('Recorded move unconfirmed.');
        moved = true;
      } else {
        const before = await apiRead(client);
        if (Object.entries(before.states).some(([contract, state]) => contract !== 'C1' && state === 'RELEASED'))
          throw new Error('Unexpected other released contract.');
        const target = stage === 'release-api' ? 'RELEASED' : 'NOT_RELEASED';
        if (before.states.C1 !== (stage === 'release-api' ? 'NOT_RELEASED' : 'RELEASED'))
          throw new Error('Unexpected API transition prerequisite.');
        const result = await setPinnedApiReleaseState(client, context, {
          type: 'CLAS',
          name: graph.clas.name,
          contract: 'C1',
          apiState: target,
          expectedCurrentState: stage === 'stale-api' ? 'NOT_RELEASED' : before.states.C1,
          ...(stage === 'release-api' ? { apiVisibility: ['cloudDevelopment'] } : {}),
          transport,
        });
        record({ adapter: stage, result });
        operations.push({ stage, result });
        if (stage === 'stale-api') {
          if (result.ok || result.state !== 'unchanged' || result.phase !== 'contract-selection')
            throw new Error('Stale API refusal unconfirmed.');
          if ((await apiRead(client)).body !== before.body) throw new Error('API state changed during stale refusal.');
        } else {
          if (
            !result.ok ||
            result.state !== 'state-changed' ||
            result.apiState !== target ||
            !result.recording ||
            typeof result.recording !== 'object' ||
            result.recording.local ||
            result.recording.request !== transport ||
            (stage === 'release-api' && (!result.visibility?.cloudDevelopment || result.visibility.keyUserApps))
          )
            throw new Error('Recorded API state change unconfirmed.');
          apiWritten = true;
          const after = await apiRead(client);
          if (
            after.states.C1 !== target ||
            (stage === 'revoke-api' &&
              (after.anyReleased !== 'false' || Object.values(after.states).some((s) => s === 'RELEASED')))
          )
            throw new Error('Remaining API release requires inspection.');
        }
      }
      await readTree(client);
      assert();
    },
    async beforeDelete(client: AdtClient) {
      const { states, anyReleased } = await apiRead(client);
      if (anyReleased !== 'false' || Object.values(states).some((s) => s === 'RELEASED'))
        throw new Error('API contract remains released.');
      await readTree(client);
    },
    async terminal(client: AdtClient) {
      await readTarget(client);
      await readTree(client);
    },
  };
}
export type PackageApiActions = ReturnType<typeof packageApiActions>;

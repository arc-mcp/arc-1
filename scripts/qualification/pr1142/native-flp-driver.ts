/** Fixed ordinary CUST experiment; source-supported native completion is never GET absence. */
import { createHash } from 'node:crypto';
import type { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { flpPageTilesPath } from '../../../src/adt/flp.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { mutationHttp, withMutationSession } from '../../../src/adt/mutation-http.js';
import {
  assertManagedCatalog,
  assertManagedGroup,
  flpEntityPath,
  isUnresolvedFlpLookup,
  readEntity,
} from '../../../src/adt/pinned-flp-entity.js';
import { readPinnedFlpTilePage } from "../../../src/adt/pinned-flp-entity.js";
import { createNativeGovernedFlpRecording } from "../../../src/adt/pinned-flp.js";
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { executePrivatePinnedNativeGovernedFlp } from '../../../src/handlers/pinned-flp-native-recording.js';
import { assertPrivatePinnedRuntime } from '../../../src/handlers/pinned-operation.js';
import { isActionDenied } from '../../../src/server/deny-actions.js';
import { flpNativeEvidence } from './native-flp-evidence.js';
import {
  FLP_SERVICE,
  FlpQualificationFailure,
  type FlpStage,
  flpCreateInput,
  flpFailure,
  flpFixtures,
  flpKey,
  flpOwner,
  flpPage,
  flpPayload,
  nativeFlpConfig,
} from './native-flp-fixed.js';
import { observeNativeHttp } from './native-observed-http.js';

export interface NativeFlpInput {
  base: AdtClient;
  stage: FlpStage;
  record: (row: unknown) => void;
  verifySource: () => void;
  shouldStop: () => boolean;
  deadline: number;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const flagFalse = (value: unknown) => value === '' || value === false || value === 'false';
function canonical(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new FlpQualificationFailure('owner');
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item, depth + 1)]),
    );
  return value;
}
export function checkFlpQualificationRequest(stage: FlpStage, method: string, path: string, body?: string) {
  const reads = [
    `${FLP_SERVICE}/$metadata`,
    `${flpOwner(stage)}?$format=json`,
    `${flpPage(stage)}?$format=json`,
    flpPageTilesPath(flpKey(stage)),
    ...(stage === 'catalog' ? [`${flpPage(stage)}/Bags?$format=json&$top=1`] : []),
  ];
  if (method === 'GET' && reads.includes(path) && body === undefined) return;
  if (
    method === 'POST' &&
    path === `${FLP_SERVICE}/${stage === 'page' ? 'Pages' : 'Catalogs'}` &&
    body === flpPayload(stage)
  )
    return;
  if (method === 'DELETE' && path === flpOwner(stage) && body === undefined) return;
  throw new FlpQualificationFailure('scope');
}
class FlpAttempts extends RequestAttemptBudget {
  constructor(private readonly validate: () => void) {
    super(48);
  }
  override consume() {
    this.validate();
    super.consume();
  }
}
export interface NativeFlpOutcome {
  owner: string;
  declaredNativeParts: string[];
  failure: boolean;
  mutationAttempted: boolean;
  createAcknowledged: boolean;
  ownedReadbackVerified: boolean;
  deleteAcknowledged: boolean;
  nativeDeleteCompleted: boolean;
  readAbsenceConfirmed: false;
  postDeleteLookup: 'not-run' | 'unknown' | 'readable' | 'error';
  sessionCleanup: 'not-run' | 'closed' | 'not-issued' | 'failed';
  recording: 'native-governed-unverified';
  reason?: ReturnType<typeof flpFailure>;
  remaining: string[];
  independentLockVerification: 'required';
}
export async function runNativeFlpStage(input: NativeFlpInput): Promise<NativeFlpOutcome> {
  const { base, stage, record } = input;
  const owner = flpOwner(stage),
    fixture = flpFixtures[stage];
  let mutationAttempted = false,
    createAcknowledged = false,
    ownedReadbackVerified = false,
    deleteAcknowledged = false,
    nativeDeleteCompleted = false,
    postDeleteLookup: 'not-run' | 'unknown' | 'readable' | 'error' = 'not-run',
    sessionCleanup: 'not-run' | 'closed' | 'not-issued' | 'failed' = 'not-run';
  let reason: ReturnType<typeof flpFailure> | undefined;
  const config = { ...nativeFlpConfig(), multiTargetWrite: base.safety.multiTargetWrite };
  const deadline = Math.min(input.deadline, Date.now() + 120_000);
  let operation: 'create' | 'delete' = 'create';
  let assertProfile = () => {};
  const validate = () => {
    try {
      input.verifySource();
    } catch {
      throw new FlpQualificationFailure('binding');
    }
    if (input.shouldStop()) throw new FlpQualificationFailure('stopped');
    throwIfRequestCancelled({ deadline });
    assertProfile();
  };
  const attempts = new FlpAttempts(validate);
  try {
    if (!Number.isFinite(input.deadline)) throw new FlpQualificationFailure('baseline');
    const context = pinnedMutationContext(
      base.safety,
      {
        deadline,
        responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'flp-qualification', true),
        attemptBudget: attempts,
      },
      { unlockFailed: false },
    );
    const profile = createNativeGovernedFlpRecording(base.safety, context, config, () => {
      if (base.sapClient !== '001') throw new FlpQualificationFailure('scope');
      const selected =
        operation === 'delete' && stage === 'catalog'
          ? { action: 'flp_delete_catalog', catalogId: fixture.id }
          : flpCreateInput(stage);
      if (isActionDenied('SAPManage', selected.action, [...base.safety.denyActions, ...config.denyActions]))
        throw new FlpQualificationFailure('scope');
      assertPrivatePinnedRuntime(base, config, 'SAPManage', selected, context);
    });
    assertProfile = profile.assert;
    validate();
    await withMutationSession(
      base.http,
      base.safety,
      context,
      async (session) => {
        let receipt: string | undefined,
          postCount = 0,
          deleteCount = 0;
        const observe = (row: unknown) => {
          const item = row as { stage?: string; method?: string; status?: number; body?: string };
          if (item.stage === 'request' && ['POST', 'DELETE'].includes(item.method ?? '')) mutationAttempted = true;
          record(row);
          if (item.stage === 'response' && item.method === 'POST') {
            if (item.status !== 201) throw new FlpQualificationFailure('create-response');
            createAcknowledged = true;
          }
          if (item.stage === 'response' && item.method === 'DELETE') {
            if (item.status !== 204 || item.body !== '') throw new FlpQualificationFailure('delete-response');
            deleteAcknowledged = true;
          }
        };
        const observed = observeNativeHttp(
          session,
          (method, path, body) => {
            validate();
            checkFlpQualificationRequest(stage, method, path, body);
            if (method === 'DELETE' && !receipt) throw new FlpQualificationFailure('owner');
          },
          observe,
          async (current) => {
            validate();
            if ((await inspect(mutationHttp(current, base.safety, context))) !== receipt)
              throw new FlpQualificationFailure('drift');
            validate();
          },
        );
        // One high-level invocation per modifying verb; shared HTTP noReplay also covers challenges.
        const oneShot = new Proxy(observed, {
          get(target, key) {
            if (key === 'post' || key === 'delete')
              return async (...args: unknown[]) => {
                if ((key === 'post' ? ++postCount : ++deleteCount) > 1) throw new FlpQualificationFailure('scope');
                const response = await Reflect.apply(Reflect.get(target, key), target, args);
                if (
                  Object.entries(response.headers as Record<string, string>).some(
                    ([name, value]) => ['sap-message', 'sap-messages'].includes(name.toLowerCase()) && value,
                  )
                )
                  throw new FlpQualificationFailure(key === 'post' ? 'create-response' : 'delete-response');
                if (key === 'post') {
                  const media = Object.entries(response.headers as Record<string, string>)
                    .find(([name]) => name.toLowerCase() === 'content-type')?.[1]
                    .split(';')[0]
                    .trim()
                    .toLowerCase();
                  const payload = JSON.parse(response.body);
                  if (media !== 'application/json' || !payload || Object.keys(payload).some((name) => name !== 'd'))
                    throw new FlpQualificationFailure('create-response');
                }
                return response;
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const http = mutationHttp(oneShot, base.safety, context);
        const inspect = async (current: AdtHttpClient) => {
          const page = await readEntity<Record<string, unknown>>(current, 'Pages', flpKey(stage));
          if (stage === 'page') assertManagedGroup(page, fixture.id);
          else if (
            page.id !== flpKey(stage) ||
            page.isCatalogPage !== 'X' ||
            page.scope !== 'CUSTOMIZING' ||
            !flagFalse(page.isReadOnly)
          )
            throw new FlpQualificationFailure('owner');
          if (page.title !== fixture.title || page.layout !== '') throw new FlpQualificationFailure('owner');
          const catalog =
            stage === 'catalog'
              ? await readEntity<Record<string, unknown>>(current, 'Catalogs', flpKey(stage))
              : undefined;
          if (catalog) {
            assertManagedCatalog(catalog, fixture.id);
            if (catalog.title !== fixture.title || !/^0+$/.test(String(catalog.chipCount)))
              throw new FlpQualificationFailure('owner');
          }
          const tiles = await readPinnedFlpTilePage(current, base.safety, flpKey(stage));
          if (tiles.truncated || tiles.items.length) throw new FlpQualificationFailure('nonempty');
          // Direct Page creation owns only Page; the catalog helper additionally creates PageConfig.
          if (stage === 'catalog') {
            const bags = await current.get(`${flpPage(stage)}/Bags?$format=json&$top=1`, {
              Accept: 'application/json',
            });
            const payload = JSON.parse(bags.body),
              list = payload?.d;
            if (
              !list ||
              Object.keys(payload).some((key) => key !== 'd') ||
              Object.keys(list).some((key) => !['results', '__count'].includes(key)) ||
              !Array.isArray(list.results) ||
              list.results.length ||
              (list.__count !== undefined && list.__count !== '0')
            )
              throw new FlpQualificationFailure('nonempty');
          }
          return digest(JSON.stringify(canonical({ page, catalog })));
        };
        const metadata = await http.get(`${FLP_SERVICE}/$metadata`, { Accept: 'application/xml' });
        if (metadata.statusCode !== 200 || digest(metadata.body) !== flpNativeEvidence.metadataHash)
          throw new FlpQualificationFailure('metadata');
        if (stage === 'catalog') {
          let existing = false;
          try {
            await readEntity(http, 'Pages', flpKey(stage));
            existing = true;
          } catch (error) {
            if (!isUnresolvedFlpLookup(error, flpEntityPath('Pages', flpKey(stage)))) throw error;
          }
          if (existing) throw new FlpQualificationFailure('owner');
        }
        const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http: oneShot }) as AdtClient;
        const result = await executePrivatePinnedNativeGovernedFlp(client, flpCreateInput(stage), config, context, [
          'read',
          'write',
        ]);
        const outcome = JSON.parse(result.content[0].text);
        if (
          result.isError ||
          !createAcknowledged ||
          outcome.ok !== true ||
          outcome.state !== 'created' ||
          outcome.recording !== 'native-governed-unverified'
        )
          throw new FlpQualificationFailure('create-unconfirmed');
        validate();
        receipt = await inspect(http);
        ownedReadbackVerified = true;
        record({ ownedReceipt: owner, sha256: receipt, nativeCreateAcknowledged: true, priorLookup: 'unknown' });
        validate();
        // Fixed owned cleanup only. Native CUST DELETE owns its enqueue/commit/teardown; no guessed lock API.
        operation = 'delete';
        validate();
        if (stage === 'catalog') {
          const deletion = await executePrivatePinnedNativeGovernedFlp(
            client,
            { action: 'flp_delete_catalog', catalogId: fixture.id },
            config,
            context,
            ['read', 'write'],
          );
          const state = JSON.parse(deletion.content[0].text);
          if (!deleteAcknowledged || state.state !== 'delete-unconfirmed' || state.phase !== 'readback')
            throw new FlpQualificationFailure('delete-response');
        } else await http.delete(owner, { Accept: 'application/json' });
        validate();
        try {
          await readEntity(http, stage === 'page' ? 'Pages' : 'Catalogs', flpKey(stage));
          postDeleteLookup = 'readable';
        } catch (error) {
          if (!isUnresolvedFlpLookup(error, flpEntityPath(stage === 'page' ? 'Pages' : 'Catalogs', flpKey(stage)))) {
            postDeleteLookup = 'error';
            throw error;
          }
          postDeleteLookup = 'unknown';
        }
        if (postDeleteLookup !== 'unknown') throw new FlpQualificationFailure('lookup');
        if (stage === 'catalog') {
          try {
            await readEntity(http, 'Pages', flpKey(stage));
            postDeleteLookup = 'readable';
            throw new FlpQualificationFailure('lookup');
          } catch (error) {
            if (!isUnresolvedFlpLookup(error, flpEntityPath('Pages', flpKey(stage)))) throw error;
          }
        }
        validate();
        nativeDeleteCompleted = deleteAcknowledged;
      },
      {
        timeoutMs: 30_000,
        noReplay: true,
        onClose: (closed) => {
          sessionCleanup = closed === true ? 'closed' : closed === false ? 'failed' : 'not-issued';
        },
      },
    );
    validate();
    if ((sessionCleanup as string) === 'failed') throw new FlpQualificationFailure('session-cleanup');
  } catch (error) {
    reason = flpFailure(error);
  }
  const failure = !!reason || !nativeDeleteCompleted || (sessionCleanup as string) === 'failed';
  return {
    owner,
    declaredNativeParts: stage === 'catalog' ? ['Page', 'PageConfig'] : ['Page'],
    failure,
    mutationAttempted,
    createAcknowledged,
    ownedReadbackVerified,
    deleteAcknowledged,
    nativeDeleteCompleted,
    readAbsenceConfirmed: false as const,
    postDeleteLookup,
    sessionCleanup,
    recording: 'native-governed-unverified' as const,
    ...(reason ? { reason } : {}),
    remaining: failure && mutationAttempted ? [owner] : [],
    independentLockVerification: 'required' as const,
  };
}

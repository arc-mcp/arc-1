/** Fixed existing-owner continuation. No create, general repair, publication or foreign mutation. */
import type { AdtClient } from '../../../src/adt/client.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { preparePrivatePinnedBatchActivation } from '../../../src/handlers/write/pinned-activation.js';
import { createPinnedDeclarativeContext } from '../../../src/handlers/write/pinned-declarative-context.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import { recoveryConfig } from './native-declarative-recovery-driver.js';
import {
  type DeclarativeRecoveryInput,
  runFixedDeclarativeRecovery,
} from './native-declarative-recovery-shared.js';
import { declarativeFailureRow } from './native-declarative-workflow.js';
import { observeNativeHttp } from './native-observed-http.js';
import {
  inspectRetained,
  retainedAbsent,
  retainedFinalAbsence,
  retainedOutcome,
  retainedPeersAbsent,
  type RetainedReceipt,
  retainedSnapshot,
  sameRetainedReceipt,
} from './native-v5-retained-evidence.js';
import {
  originalService,
  retainedOwners,
  retainedService,
  retainedStages,
  retainedView,
  type RetainedStage,
} from './native-v5-retained-fixed.js';
import { checkRetainedRequest, retainedTransport } from './native-v5-retained-transport.js';
export type RetainedRunInput = DeclarativeRecoveryInput & { deadline: number };
const clone = (base: AdtClient, http: AdtClient['http']) =>
  Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
export async function runRetainedContinuation(input: RetainedRunInput) {
  let stage: RetainedStage = 'inspect',
    mutationAttempted = false,
    mutationSubmitted = false;
  const completed: string[] = [],
    confirmedDeleted: string[] = [],
    cleanupResults: { owner: string; cleanupConfirmed: boolean }[] = [];
  const record = (row: unknown) => {
    const r = row as {
      stage?: string;
      method?: string;
      path?: string;
      retainedDispatch?: boolean;
      mutation?: boolean;
    };
    if (
      r.stage === 'request' &&
      !['GET', 'HEAD'].includes(r.method ?? '') &&
      r.path !== '/sap/bc/adt/cts/transportchecks'
    )
      mutationAttempted = true;
    if (r.retainedDispatch && r.mutation) mutationSubmitted = true;
    input.record(row);
  };
  const deadline = Math.min(input.deadline, Date.now() + 4 * 60_000);
  const ready = () => {
    input.verifySource();
    if (input.shouldStop() || Date.now() >= deadline) throw new Error('Retained run stopped or expired.');
  };
  const transport = retainedTransport(input.base.http, {
    stage: () => stage,
    verify: ready,
    shouldStop: input.shouldStop,
    deadline,
    record,
  });
  const base = clone(input.base, transport.http),
    policy = () => ({ deadline });
  const receipts = new Map<string, RetainedReceipt>();
  let source = originalService.source,
    active = false,
    failed = false,
    finalAbsenceConfirmed = false;
  let reason: ReturnType<typeof declarativeFailureRow> | undefined;
  async function verifyCurrent(peers = false) {
    ready();
    for (const fixture of [retainedService, retainedView]) {
      if (confirmedDeleted.includes(fixture.owner)) {
        await retainedAbsent(base.http, fixture.owner, record, policy());
        continue;
      }
      const prior = receipts.get(fixture.owner);
      if (!prior) throw new Error('Retained receipt missing.');
      const isService = fixture === retainedService;
      const current = await retainedSnapshot(
        base.http,
        fixture,
        isService ? source : retainedView.updatedSource,
        isService ? active : true,
        record,
        policy(),
      );
      sameRetainedReceipt(prior, current);
    }
    if (peers) await retainedPeersAbsent(base.http, record, policy());
    ready();
  }
  const observed = observeNativeHttp(
    base.http,
    (method, path, body) => checkRetainedRequest(stage, method, path, body),
    record,
    async () => {
      throw new Error('DELETE uses the reviewed recovery loop.');
    },
  );
  const client = clone(base, observed);
  try {
    ready();
    const initial = await inspectRetained(base.http, record, policy());
    receipts.set(retainedView.owner, initial.view);
    receipts.set(retainedService.owner, initial.service);
    ready();
    for (const next of retainedStages) {
      stage = next;
      ready();
      record({
        continuationStage: stage,
        owner: stage === 'delete-view' ? retainedView.owner : retainedService.owner,
      });
      if (stage === 'correct' || stage === 'revise-label') {
        await verifyCurrent();
        const expected = stage === 'correct' ? retainedService.source : retainedService.updatedSource;
        const context = pinnedMutationContext(client.safety, policy(), { unlockFailed: false });
        const result = await executePinnedSourceWrite(
          createPinnedDeclarativeContext(
            client,
            {
              action: 'update',
              type: 'SRVD',
              name: retainedService.name,
              source: expected,
              expectedSourceHash: receipts.get(retainedService.owner)!.sourceHash,
            },
            recoveryConfig,
            context,
          ),
        );
        const outcome = retainedOutcome(result);
        const cleanupConfirmed =
          !context.cleanup.unlockFailed &&
          !context.cleanup.unknownLocks?.length &&
          context.cleanup.sessionClosed === true;
        record({ operation: 'update', stage, result: outcome, cleanupConfirmed });
        ready();
        if (outcome.isError || outcome.state !== 'saved-inactive' || !cleanupConfirmed)
          throw new Error('Retained save or own cleanup unconfirmed.');
        const receipt = await retainedSnapshot(base.http, retainedService, expected, false, record, policy());
        if (receipt.sourceHash !== outcome.sourceHash) throw new Error('Retained save hash disagrees.');
        source = expected;
        active = false;
        receipts.set(retainedService.owner, receipt);
      } else if (stage === 'activate-corrected' || stage === 'activate-revised') {
        await verifyCurrent();
        const context = pinnedMutationContext(client.safety, policy(), { unlockFailed: false });
        const prepared = await preparePrivatePinnedBatchActivation(
          client,
          { type: 'SRVD', name: retainedService.name },
          false,
          context,
        );
        const result = 'execute' in prepared ? await prepared.execute() : prepared;
        const outcome = retainedOutcome(result);
        record({ operation: 'activate', stage, result: outcome });
        ready();
        if (
          outcome.isError ||
          outcome.success !== true ||
          outcome.activeSourceVerified !== true ||
          outcome.nativeStateVerified !== true
        )
          throw new Error('Retained activation unconfirmed.');
        const receipt = await retainedSnapshot(base.http, retainedService, source, true, record, policy());
        if (receipt.sourceHash !== receipts.get(retainedService.owner)!.sourceHash)
          throw new Error('Activation changed the intended source.');
        active = true;
        receipts.set(retainedService.owner, receipt);
      } else {
        const fixture = stage === 'delete-service' ? retainedService : retainedView;
        const result = await runFixedDeclarativeRecovery(
          { ...input, base, record, verifySource: ready, deadline },
          {
            fixture,
            config: recoveryConfig,
            requestPolicy: policy(),
            checkRequest: (method, path, body) => checkRetainedRequest(stage, method, path, body),
            verifyReceipt: async () => verifyCurrent(true),
            verifyOwnAbsence: (client, journal, options) =>
              retainedAbsent(client.http, fixture.owner, journal, options),
            verifyOtherAbsence: async () => {
              // Native deletion has been confirmed inside the shared loop, before this callback.
              for (const other of retainedOwners.filter((owner) => owner !== fixture.owner)) {
                if (other === retainedView.owner && fixture === retainedService) {
                  const current = await retainedSnapshot(
                    base.http,
                    retainedView,
                    retainedView.updatedSource,
                    true,
                    record,
                    policy(),
                  );
                  sameRetainedReceipt(receipts.get(other)!, current);
                } else await retainedAbsent(base.http, other, record, policy());
              }
              await retainedPeersAbsent(base.http, record, policy());
            },
          },
        );
        record({ operation: 'delete', stage, owner: fixture.owner, result });
        cleanupResults.push({ owner: fixture.owner, cleanupConfirmed: result.cleanupConfirmed });
        if (result.confirmedDeleted) confirmedDeleted.push(fixture.owner);
        if (result.failure || !result.confirmedDeleted || !result.cleanupConfirmed)
          throw new Error('Retained deletion/cleanup unconfirmed.');
      }
      ready();
      completed.push(stage);
    }
    stage = 'final';
    await retainedFinalAbsence(base.http, record, policy());
    ready();
    finalAbsenceConfirmed = true;
  } catch (error) {
    failed = true;
    reason = declarativeFailureRow(error);
    record({ continuationUnconfirmed: true, stage, ...reason });
  } finally {
    transport.finish();
  }
  const cleanupConfirmed = cleanupResults.length === 2 && cleanupResults.every((row) => row.cleanupConfirmed);
  const failure =
    failed || input.shouldStop() || !finalAbsenceConfirmed || !cleanupConfirmed || completed.length !== 6;
  return {
    failure,
    mutationAttempted,
    mutationSubmitted,
    completed,
    confirmedDeleted,
    cleanupConfirmed,
    finalAbsenceConfirmed,
    remaining: retainedOwners.filter((owner) => !confirmedDeleted.includes(owner)),
    inspectionRequired: failure ? [...retainedOwners] : [],
    stopped: input.shouldStop(),
    ...reason,
  };
}

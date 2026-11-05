/** One native preaudited batch, using the same per-owner evidence as ordinary pinned activation. */
import type { AdtClient } from '../../adt/client.js';
import { type ActivationReference, activateBatch } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { mutationClient } from '../../adt/mutation-client.js';
import type { PinnedMutationContext } from '../../adt/mutation-context.js';
import { PINNED_BATCH_OWNER_LIMIT, PINNED_BATCH_REFERENCE_LIMIT } from '../../adt/pinned-batch-bounds.js';
import type { ToolResult } from '../shared.js';
import { type PreparedPinnedActivation, preparePrivatePinnedBatchActivation } from './pinned-activation.js';

export interface BatchPhase {
  status: 'not-attempted' | 'unconfirmed' | 'confirmed' | 'failed';
  result?: ToolResult;
  submissionPossible?: true;
  attemptedScope?: string[];
}
export async function activatePinnedBatchOwners(
  client: AdtClient,
  objects: readonly Readonly<Record<string, unknown>>[],
  context: PinnedMutationContext,
  phases: BatchPhase[],
  minimalErrors: boolean,
): Promise<boolean> {
  const prepared: PreparedPinnedActivation[] = [];
  for (let i = 0; i < objects.length; i++) {
    throwIfRequestCancelled(context.requestPolicy);
    const args = objects[i];
    const plan = await preparePrivatePinnedBatchActivation(
      client,
      {
        type: args.type,
        name: args.name,
        ...(args.group === undefined ? {} : { group: args.group }),
        action: 'activate',
      },
      minimalErrors,
      context,
    );
    if (!('execute' in plan)) {
      phases[i].status = 'failed';
      phases[i].result = plan;
      return false;
    }
    prepared.push(plan);
  }
  if (
    prepared.length > PINNED_BATCH_OWNER_LIMIT ||
    new Set(prepared.map((entry) => entry.owner.toLowerCase())).size !== prepared.length
  )
    throw new AdtSafetyError('Resolved batch activation owners are excessive or ambiguous.');
  let validatedScopes: string[][] = [];
  const validateReferences = async (refs: readonly ActivationReference[]) => {
    if (refs.length === 0 || refs.length > PINNED_BATCH_REFERENCE_LIMIT)
      throw new AdtSafetyError('Batch activation exceeds its raw reference bound.');
    const assigned = prepared.map(() => [] as ActivationReference[]);
    for (const ref of refs) {
      const owners = prepared.flatMap((entry, i) => {
        try {
          entry.assertReferences([ref]);
          return [i];
        } catch {
          return [];
        }
      });
      if (owners.length !== 1)
        throw new AdtSafetyError('Batch activation reference has no unique explicitly selected owner.');
      assigned[owners[0]].push(ref);
    }
    // Validate every shape before native reads; never infer an omitted owner's result.
    for (let i = 0; i < prepared.length; i++) prepared[i].assertReferences(assigned[i]);
    for (let i = 0; i < prepared.length; i++) {
      throwIfRequestCancelled(context.requestPolicy);
      await prepared[i].validateReferences(assigned[i]);
    }
    validatedScopes = assigned.map((scope) => scope.map((ref) => ref.uri));
  };
  try {
    const scoped = mutationClient(client, context);
    const native = await activateBatch(
      scoped.http,
      scoped.safety,
      prepared.map((entry) => ({ url: entry.owner, name: entry.name })),
      {
        validateReferences,
        beforeSubmit: () => {
          throwIfRequestCancelled(context.requestPolicy);
          for (let i = 0; i < prepared.length; i++) {
            prepared[i].beforeSubmit();
            phases[i].status = 'unconfirmed';
            phases[i].submissionPossible = true;
            phases[i].attemptedScope = [...new Set([...(phases[i].attemptedScope ?? []), ...validatedScopes[i]])];
          }
        },
      },
    );
    for (const entry of prepared) entry.recordNativeResult(native);
    for (let i = 0; i < prepared.length; i++) {
      if (native.success) throwIfRequestCancelled(context.requestPolicy);
      const result = await prepared[i].finish(native);
      phases[i].result = result;
      phases[i].status = result.isError ? 'failed' : 'confirmed';
      // No activation replay or additional verification after uncertainty. Preserve native reports
      // for the unverified remainder, without calling them successful from omitted detail rows.
      if (result.isError) {
        for (let j = i + 1; j < prepared.length; j++)
          phases[j].result = prepared[j].failure(
            new AdtSafetyError('Batch native outcome or an earlier owner verification is incomplete.'),
          );
        return false;
      }
    }
    return true;
  } catch (error) {
    for (let i = 0; i < prepared.length; i++) {
      if (phases[i].status === 'confirmed') continue;
      phases[i].result = prepared[i].failure(error);
      if (phases[i].status === 'not-attempted') phases[i].status = 'failed';
    }
    return false;
  }
}

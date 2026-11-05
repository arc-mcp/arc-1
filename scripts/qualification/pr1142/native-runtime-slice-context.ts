/** One bounded observed client per fixed stage. All validation is repeated at actual dispatch. */
import type { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { mutationHttp } from '../../../src/adt/mutation-http.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { observeNativeHttp } from './native-observed-http.js';
import { RuntimeFailure, type RuntimeStage, runtimeConfig } from './native-runtime-slice-fixed.js';
export interface RuntimeInput {
  base: AdtClient;
  stage: RuntimeStage;
  deadline: number;
  record: (value: unknown) => void;
  verifySource: () => void;
  shouldStop: () => boolean;
}
export function runtimeStageClient(
  input: RuntimeInput,
  check: (method: string, path: string, body?: string) => void,
  beforeDelete: Parameters<typeof observeNativeHttp>[3] = async () => {},
) {
  const deadline = Math.min(input.deadline, Date.now() + 240_000);
  if (!Number.isFinite(deadline) || input.base.sapClient !== '001') throw new RuntimeFailure('target');
  const config = { ...runtimeConfig(), multiTargetWrite: input.base.safety.multiTargetWrite };
  let mutationDispatched = false;
  const verify = () => {
    try {
      input.verifySource();
    } catch {
      throw new RuntimeFailure('binding');
    }
    if (input.shouldStop()) throw new RuntimeFailure('stopped');
    throwIfRequestCancelled({ deadline });
  };
  const context = pinnedMutationContext(
    input.base.safety,
    {
      deadline,
      responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'runtime-qualification', true),
      attemptBudget: new RequestAttemptBudget(128),
    },
    { unlockFailed: false },
  );
  const observed = observeNativeHttp(
    input.base.http,
    (method, path, body) => {
      check(method, path, body);
      // Only exact own-owner UNLOCK (validated above) can survive a failed forward proof.
      if (method === 'POST' && new URL(path, 'https://a4h.marianzeis.de').searchParams.get('_action') === 'UNLOCK')
        return;
      verify();
    },
    (row) => {
      const event = row as { stage?: string; method?: string };
      if (event.stage === 'dispatch' && ['PUT', 'POST', 'DELETE'].includes(event.method ?? ''))
        mutationDispatched = true;
      input.record(row);
    },
    beforeDelete,
  );
  const http = mutationHttp(observed, input.base.safety, context);
  // An unregistered forwarding view lets each real private handler own its context, while
  // every nested request still passes through the registered outer budget and final proof.
  const client = Object.assign(Object.create(Object.getPrototypeOf(input.base)), input.base, {
    http: new Proxy(http, {}),
  }) as AdtClient;
  const owningClient = Object.assign(Object.create(Object.getPrototypeOf(input.base)), input.base, {
    http: observed,
  }) as AdtClient;
  return { client, owningClient, http, context, config, verify, mutationDispatched: () => mutationDispatched };
}
export function runtimePayload(result: { isError?: boolean; content: { text: string }[] }) {
  let value: Record<string, any>;
  try {
    value = JSON.parse(result.content[0].text);
  } catch {
    throw new RuntimeFailure('adapter-result');
  }
  if (result.isError || value.ok === false) throw new RuntimeFailure('adapter-unconfirmed');
  return value;
}

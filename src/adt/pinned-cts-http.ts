/** One CTS call: cumulative limits and native submission evidence over the shared request mapper. */
import { DataResponseBudget } from './data-result-context.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import type { PinnedMutationContext } from './mutation-context.js';
import { mutationHttp, requestHttp } from './mutation-http.js';
import { RequestAttemptBudget } from './request-attempt-budget.js';
import type { SafetyConfig } from './safety.js';

export interface CtsSubmission {
  method: string;
  path: string;
  acknowledged: boolean;
}

export function pinnedCtsHttp(
  http: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  submissions: CtsSubmission[],
  evidence: { read?: (path: string, body: string) => void; beforeMutation?: () => void } = {},
): AdtHttpClient {
  const responseBudget = new DataResponseBudget(8 * 1024 * 1024, 'pinned-cts', true);
  const attemptBudget = new RequestAttemptBudget(1024);
  const options = (input?: AdtRequestOptions) => ({ ...input, responseBudget, attemptBudget });
  async function mutate<T>(
    method: string,
    path: string,
    input: AdtRequestOptions | undefined,
    send: () => Promise<T>,
  ): Promise<T> {
    throwIfRequestCancelled(context.requestPolicy);
    throwIfRequestCancelled(input);
    evidence.beforeMutation?.();
    const step = { method, path, acknowledged: false };
    submissions.push(step); // Invocation can have reached SAP even when the response is lost.
    const result = await send();
    step.acknowledged = true;
    return result;
  }
  const overrides: Partial<AdtHttpClient> = {
    get: async (path, headers, input) => {
      const response = await http.get(path, headers, options(input));
      evidence.read?.(path, response.body);
      return response;
    },
    post: (path, body, type, headers, input) =>
      mutate('POST', path, input, () => http.post(path, body, type, headers, options(input))),
    put: (path, body, type, headers, input) =>
      mutate('PUT', path, input, () => http.put(path, body, type, headers, options(input))),
    delete: (path, headers, input) => mutate('DELETE', path, input, () => http.delete(path, headers, options(input))),
  };
  const bounded = requestHttp(http, options, undefined, overrides);
  return mutationHttp(bounded, safety, context);
}

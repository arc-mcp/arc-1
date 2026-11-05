/** Bounded quickfix HTTP profile; pure input/evidence parsing stays transport-free. */
import { DataResponseBudget } from './data-result-context.js';
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { throwIfRequestCancelled } from './http-deadline.js';
import { assertMutationContext, type PinnedMutationContext } from './mutation-context.js';
import { mutationHttp, requestHttp } from './mutation-http.js';
import {
  assertPinnedQuickfixOwner,
  assertPinnedQuickfixProposal,
  parsePinnedQuickfixInput,
  type QuickfixOwner,
  readPinnedQuickfixDeltas,
  readPinnedQuickfixProposals,
} from './pinned-quickfix-input.js';
import { RequestAttemptBudget } from './request-attempt-budget.js';
import type { SafetyConfig } from './safety.js';
import type { FixProposal } from './types.js';

export type QuickfixApplicationProfile =
  | { mode: 'single-target' }
  | {
      mode: 'pinned-pp';
      context: PinnedMutationContext;
      owner: QuickfixOwner;
    };

export function preparePinnedQuickfix(
  http: AdtHttpClient,
  safety: SafetyConfig,
  profile: Extract<QuickfixApplicationProfile, { mode: 'pinned-pp' }>,
  proposal: FixProposal,
  sourceUri: string,
  source: string,
  line: number,
  column: number,
) {
  assertMutationContext(safety, profile.context);
  if (profile.context.mode !== 'pinned-pp' || profile.context.requestPolicy.deadline > Date.now() + 60_000)
    throw new AdtSafetyError('Private quickfix requires its registered, bounded pinned context.');
  const input = parsePinnedQuickfixInput({
    action: 'apply_quickfix',
    ...profile.owner,
    sourceUri,
    source,
    line,
    column,
    proposalUri: proposal.uri,
    proposalUserContent: proposal.userContent,
    proposalAffectedObjects: proposal.affectedObjects,
  });
  const responseBudget = new DataResponseBudget(2 * 1024 * 1024, 'pinned-quickfix', true),
    attemptBudget = new RequestAttemptBudget(16);
  const options = (value?: AdtRequestOptions) => {
    throwIfRequestCancelled(profile.context.requestPolicy);
    return { ...value, responseBudget, attemptBudget };
  };
  const bounded = requestHttp(http, options, ['get', 'post', 'fetchCsrfToken']);

  return {
    http: mutationHttp(bounded, safety, profile.context),
    proposal: input.proposal,
    assertOwner: (body: string) => assertPinnedQuickfixOwner(body, input),
    parseProposals: readPinnedQuickfixProposals,
    assertProposal: (proposals: FixProposal[]) => assertPinnedQuickfixProposal(input, proposals),
    parseDeltas: (body: string) => readPinnedQuickfixDeltas(body, input),
  };
}

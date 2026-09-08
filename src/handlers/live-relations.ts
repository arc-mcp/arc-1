import type { AdtClient } from '../adt/client.js';
import { DataResponseBudget } from '../adt/data-result-context.js';
import { requestBudgetSignal, throwIfRequestCancelled } from '../adt/http-deadline.js';
import { NativeRelationProvider } from '../adt/repository-relations.js';
import { RequestAttemptBudget } from '../adt/request-attempt-budget.js';
import { Semaphore } from '../adt/semaphore.js';
import { RELATION_LIMITS, walkRelations } from '../context/relation-walk.js';
import { getCurrentContext } from '../server/context.js';
import type { ServerConfig } from '../server/types.js';
import { getCachedDiscovery, setCachedDiscovery } from './feature-cache.js';
import { LiveRelationsInput } from './relation-input.js';
import { errorResult, textResult, toolJson } from './shared.js';

// Independent of the SAP HTTP semaphore: holding the same semaphore twice can deadlock.
const analyses = new Semaphore(RELATION_LIMITS.concurrent);

export async function handleLiveRelations(client: AdtClient, config: ServerConfig, args: Record<string, unknown>) {
  if (!config.liveRelations || config.multiTargetEndpoints || config.targetId || config.toolMode !== 'standard') {
    return errorResult(
      'Experimental live relations are disabled or unavailable in this mode. Enable ARC1_LIVE_RELATIONS only for single-target standard tools.',
    );
  }
  const input = LiveRelationsInput.parse(args);
  const started = Date.now();
  const options = {
    signal: getCurrentContext()?.signal,
    deadline: started + RELATION_LIMITS.deadlineMs,
    responseBudget: new DataResponseBudget(RELATION_LIMITS.bytes, 'repository-relations'),
    attemptBudget: new RequestAttemptBudget(RELATION_LIMITS.requests),
  };
  return analyses.run(async () => {
    const provider = new NativeRelationProvider(client, options);
    const known = getCachedDiscovery(config.destinationName);
    const discovered = await provider.discover(known.size ? known : undefined);
    // Capability hints only; roots and networks still use this caller's live SAP client.
    // Do not overwrite a startup/parallel refresh that completed while discovery was in flight.
    if (!known.size && !getCachedDiscovery(config.destinationName).size) {
      setCachedDiscovery(new Map(discovered), config.destinationName);
    }
    const root = await provider.validateRoot(input.type, input.name);
    const result = await walkRelations(root, provider, {
      ...input,
      expandPackages: input.expandPackages?.map((pkg) => pkg.toUpperCase()),
    });
    if (!result.truncated) throwIfRequestCancelled(options);
    const json = toolJson({
      ...result,
      observedAt: new Date(started).toISOString(),
      experimental: true,
      limits: { ...RELATION_LIMITS, nodes: input.maxResults, depth: input.depth },
      metrics: {
        httpAttempts: options.attemptBudget.used,
        successfulMetadataBytes: options.responseBudget.consumedBytes,
        elapsedMs: Date.now() - started,
      },
    });
    // Defense in depth around the final client/audit payload, after bounded metadata selection.
    if (Buffer.byteLength(json) > 512 * 1024)
      throw new Error('Live relationship output limit exceeded. Narrow maxResults.');
    return textResult(json);
  }, requestBudgetSignal(options));
}

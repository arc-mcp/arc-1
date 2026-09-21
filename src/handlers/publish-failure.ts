/** Inspect the observed BTP V4 UI missing-inbound failure without repeating publication. */
import type { AdtClient } from '../adt/client.js';
import type { PublishResult } from '../adt/devtools.js';
import { AdtApiError } from '../adt/errors.js';
import { throwIfRequestCancelled } from '../adt/http-deadline.js';
import { readPublishState } from '../adt/publish-state.js';
import { checkOperation, OperationType } from '../adt/safety.js';
import { getCurrentContext } from '../server/context.js';
import { getCachedFeatures } from './feature-cache.js';
import { errorResult, type ToolResult, textResult } from './shared.js';
import { SERVICEBINDING_V2_ACCEPT } from './write-helpers.js';

/** Undefined leaves unrelated publish errors unchanged. This helper only reads. */
export async function inspectServiceBindingPublishFailure(
  client: AdtClient,
  name: string,
  version: string,
  serviceType: 'odatav2' | 'odatav4',
  result: PublishResult,
): Promise<ToolResult | undefined> {
  if (
    getCachedFeatures()?.systemType !== 'btp' ||
    serviceType !== 'odatav4' ||
    version !== '0001' ||
    result.severity !== 'ERROR' ||
    result.shortText !== `Local Publish of ${name} failed` ||
    result.longText !== `Inbound service ${name}_${version}_G4BA does not exist`
  )
    return undefined;

  const original = `Initial publish failed: ${result.shortText} — ${result.longText}`;
  const options = { signal: getCurrentContext()?.signal };
  try {
    checkOperation(client.safety, OperationType.Read, 'GetSRVB');
    const response = await client.http.get(
      `/sap/bc/adt/businessservices/bindings/${encodeURIComponent(name)}?version=active`,
      { Accept: SERVICEBINDING_V2_ACCEPT, 'Cache-Control': 'no-cache' },
      options,
    );
    throwIfRequestCancelled(options);
    const state = response.statusCode === 200 ? readPublishState(response.body, name, version) : 'unknown';
    if (state === 'published') {
      return textResult(`Service binding ${name} is already published (confirmed by active metadata).\n${original}`);
    }
    return errorResult(
      `${original}\nActive publication state: ${state}. No automatic publish retry. ` +
        (state === 'unpublished'
          ? 'Inspect the binding and its inbound-service dependencies before deciding whether to publish again.'
          : 'Use SAPRead to verify publication state before another publish.'),
    );
  } catch (error) {
    const reason = options.signal?.aborted
      ? 'cancelled'
      : error instanceof AdtApiError
        ? `SAP HTTP ${error.statusCode}`
        : 'request failed';
    return errorResult(
      `${original}\nActive publication state is unknown (${reason}). No automatic publish retry; use SAPRead to verify.`,
    );
  }
}

/** One bounded recovery attempt for the observed BTP V4 UI missing-inbound error. */
import type { AdtClient } from '../adt/client.js';
import { type PublishResult, publishServiceBinding } from '../adt/devtools.js';
import { AdtApiError, AdtSafetyError } from '../adt/errors.js';
import {
  type AdtRequestOptions,
  awaitWithinRequestBudget,
  sleepWithinRequestBudget,
  throwIfRequestCancelled,
} from '../adt/http-deadline.js';
import { readPublishState } from '../adt/publish-state.js';
import { RequestAttemptBudget } from '../adt/request-attempt-budget.js';
import { checkOperation, OperationType } from '../adt/safety.js';
import { getCurrentContext } from '../server/context.js';
import { getCachedFeatures } from './feature-cache.js';
import { errorResult, type ToolResult, textResult } from './shared.js';
import { enforceAllowedPackageForObjectUrl, SERVICEBINDING_V2_ACCEPT } from './write-helpers.js';

const RECOVERY_WAIT_MS = 10_000;
const RECOVERY_DEADLINE_MS = 150_000;
const message = (r: PublishResult) => `${r.shortText}${r.longText ? ` — ${r.longText}` : ''}`;

/** Undefined leaves the original publish error path unchanged. Never recursively retries. */
export async function recoverServiceBindingPublish(
  client: AdtClient,
  name: string,
  version: string,
  serviceType: 'odatav2' | 'odatav4',
  first: PublishResult,
): Promise<ToolResult | undefined> {
  const systemType = getCachedFeatures()?.systemType ?? (client.usesBearerAuth ? 'btp' : undefined);
  if (
    systemType !== 'btp' ||
    serviceType !== 'odatav4' ||
    version !== '0001' ||
    first.severity !== 'ERROR' ||
    first.shortText !== `Local Publish of ${name} failed` ||
    first.longText !== `Inbound service ${name}_0001_G4BA does not exist`
  )
    return undefined;

  const original = `Initial publish failed: ${message(first)}`;
  const options: AdtRequestOptions = {
    signal: getCurrentContext()?.signal,
    deadline: Date.now() + RECOVERY_DEADLINE_MS,
    attemptBudget: new RequestAttemptBudget(20),
  };
  const objectUrl = `/sap/bc/adt/businessservices/bindings/${encodeURIComponent(name)}?version=active`;
  const readState = async () => {
    throwIfRequestCancelled(options);
    checkOperation(client.safety, OperationType.Read, 'GetSRVB');
    const r = await client.http.get(
      objectUrl,
      { Accept: SERVICEBINDING_V2_ACCEPT, 'Cache-Control': 'no-cache' },
      options,
    );
    throwIfRequestCancelled(options);
    return r.statusCode === 200 ? readPublishState(r.body, name, version) : 'unknown';
  };
  const observed = (state: string): ToolResult | undefined => {
    if (state === 'published')
      return textResult(
        `Service binding ${name} is already published (confirmed by active metadata); no retry sent.\n${original}`,
      );
    if (state === 'unknown')
      return errorResult(
        `${original}\nRecovery stopped: active publication state is unknown; no retry sent. Use SAPRead to verify.`,
      );
    return undefined;
  };
  let stage = 'state check';
  let retried = false;
  let second: PublishResult | undefined;
  try {
    let done = observed(await readState());
    if (done) return done;
    stage = 'wait';
    await sleepWithinRequestBudget(RECOVERY_WAIT_MS, options);
    stage = 'state check';
    done = observed(await readState());
    if (done) return done;
    stage = 'package check';
    // Re-resolve the real package. A slow subtree lookup cannot admit a late mutation.
    await awaitWithinRequestBudget(
      enforceAllowedPackageForObjectUrl(
        client,
        objectUrl,
        `Publish retry of service binding '${name}'`,
        SERVICEBINDING_V2_ACCEPT,
        options,
      ),
      options,
    );
    throwIfRequestCancelled(options);
    stage = 'retry';
    checkOperation(client.safety, OperationType.Activate, 'PublishServiceBinding');
    retried = true;
    second = await publishServiceBinding(client.http, client.safety, name, version, serviceType, options);
    if (second.severity === 'ERROR') {
      const persistent = second.shortText === first.shortText && second.longText === first.longText;
      return errorResult(
        `${original}\nRetry failed: ${message(second)}\nNo further automatic retry.${persistent ? ' The inbound service may still be missing; inspect the binding and its dependencies.' : ''}`,
      );
    }
    stage = 'verification';
    const state = await readState();
    if (state !== 'published')
      return errorResult(
        `${original}\nRetry response: ${message(second) || second.severity}\nPublication not confirmed (active state: ${state}). No further automatic retry; use SAPRead to verify.`,
      );
    return textResult(
      `Successfully published service binding ${name} after one retry (confirmed by active metadata).\n${original}\nRetry response: ${message(second) || second.severity}`,
    );
  } catch (error) {
    const reason = options.signal?.aborted
      ? 'cancelled'
      : Date.now() >= options.deadline!
        ? 'recovery deadline reached'
        : error instanceof AdtSafetyError
          ? error.message
          : error instanceof AdtApiError
            ? `SAP HTTP ${error.statusCode}`
            : 'request failed';
    return errorResult(
      `${original}\nRecovery stopped during ${stage}: ${reason}.${second ? `\nRetry response: ${message(second) || second.severity}` : ''}\n${retried ? 'Retry completion is unconfirmed; use SAPRead to verify before another publish.' : 'No retry sent.'}`,
    );
  }
}

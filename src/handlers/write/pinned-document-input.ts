/** Private qualification boundary; no public tool route imports this candidate. */
import type { AdtClient } from '../../adt/client.js';
import { DataResponseBudget } from '../../adt/data-result-context.js';
import { parseBadiImplementationDefinition } from '../../adt/enhancement-impl.js';
import { AdtSafetyError } from '../../adt/errors.js';
import {
  assertMutationContext,
  type PinnedMutationContext,
  pinnedMutationContext,
} from '../../adt/mutation-context.js';
import { documentParent, pinnedDocumentSelection } from '../../adt/pinned-document-owner.js';
import { normalizePinnedRequest } from '../../adt/pinned-managed-resources.js';
import { pinnedPackageSelection } from '../../adt/pinned-package.js';
import { RequestAttemptBudget } from '../../adt/request-attempt-budget.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { isActionDenied } from '../../server/deny-actions.js';
import { pinnedWriteEnabled } from '../../server/multi-target-write-surface.js';
import type { ServerConfig } from '../../server/types.js';

export function documentInput(
  client: AdtClient,
  config: ServerConfig,
  input: Record<string, unknown>,
  context: PinnedMutationContext,
) {
  assertMutationContext(client.safety, context);
  if (
    !pinnedWriteEnabled(config) ||
    !config.targetId ||
    config.multiTargetWrite?.target !== config.targetId ||
    client.safety.multiTargetWrite?.target !== config.targetId ||
    !config.multiTargetEndpoints ||
    isActionDenied('SAPWrite', String(input.action), config.denyActions)
  )
    throw new AdtSafetyError(
      'The private document operation requires the matching writable pinned PP target and policy.',
    );
  const selected = pinnedDocumentSelection(input.type, input.name);
  const action = input.action;
  if (action !== 'create' && action !== 'update' && action !== 'delete')
    throw new AdtSafetyError('Select exact document create, update or delete.');
  checkOperation(
    client.safety,
    action === 'create' ? OperationType.Create : action === 'delete' ? OperationType.Delete : OperationType.Update,
    'PinnedDocument',
  );
  const fields = new Set(['type', 'name', 'action', 'transport']);
  if (action !== 'delete') {
    fields.add('source');
    if (selected.type === 'SKTD') fields.add('shortTexts');
    else fields.add('description');
    if (action === 'create') {
      fields.add('package');
      if (selected.type === 'SKTD')
        for (const key of ['refObjectType', 'refObjectName', 'refObjectDescription']) fields.add(key);
    } else {
      fields.add('expectedMetadataHash');
      if (selected.type === 'SKTD') fields.add('dryRun');
    }
  }
  if (Object.entries(input).some(([key, value]) => value !== undefined && !fields.has(key)))
    throw new AdtSafetyError('Unsupported raw input on the private document profile.');
  if (
    input.source !== undefined &&
    (typeof input.source !== 'string' || !input.source.trim() || Buffer.byteLength(input.source) > 4 * 1024 * 1024)
  )
    throw new AdtSafetyError('Document source must be non-empty text of at most 4 MiB.');
  for (const key of ['description', 'refObjectDescription'])
    if (input[key] !== undefined && (typeof input[key] !== 'string' || (input[key] as string).length > 256))
      throw new AdtSafetyError('Document descriptions must be bounded text.');
  if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean')
    throw new AdtSafetyError('dryRun must be boolean.');
  if (
    input.shortTexts !== undefined &&
    (!Array.isArray(input.shortTexts) ||
      input.shortTexts.length > 1000 ||
      input.shortTexts.some(
        (row) =>
          !row ||
          typeof row !== 'object' ||
          Array.isArray(row) ||
          Object.keys(row).some((key) => !['node', 'text'].includes(key)) ||
          typeof row.node !== 'string' ||
          typeof row.text !== 'string' ||
          row.node.length > 2048 ||
          row.text.length > 4096,
      ))
  )
    throw new AdtSafetyError('shortTexts must be a bounded array of exact node/text pairs.');
  if (
    action === 'update' &&
    (typeof input.expectedMetadataHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.expectedMetadataHash))
  )
    throw new AdtSafetyError('Read the complete native document and supply its expectedMetadataHash.');
  if (
    action === 'update' &&
    input.source === undefined &&
    input.shortTexts === undefined &&
    input.description === undefined
  )
    throw new AdtSafetyError('Select at least one document field to update.');
  const definition =
    selected.type === 'ENHO' && typeof input.source === 'string'
      ? parseBadiImplementationDefinition(input.source)
      : undefined;
  if ((definition?.badiImplementations?.length ?? 0) > 1000)
    throw new AdtSafetyError('BAdI implementation list exceeds its bound.');
  if (action === 'create' && selected.type === 'ENHO' && !definition?.enhancementSpot)
    throw new AdtSafetyError('ENHO creation requires a source definition with enhancementSpot.');
  const pkg = action === 'create' ? pinnedPackageSelection(input.package).name : undefined;
  let parent: ReturnType<typeof documentParent> | undefined;
  if (action === 'create' && selected.type === 'SKTD') {
    if (input.refObjectName !== undefined && input.refObjectName !== selected.name)
      throw new AdtSafetyError('A KTD must have the exact name of its parent.');
    parent = documentParent(input.refObjectType, selected.name);
  }
  const transport = normalizePinnedRequest(input.transport);
  const outerResponse = context.requestPolicy.responseBudget;
  const outerAttempts = context.requestPolicy.attemptBudget;
  if (
    (outerResponse && (!outerResponse.countAllResponses || outerResponse.limitBytes > 8 * 1024 * 1024)) ||
    (outerAttempts && outerAttempts.limit > 64)
  )
    throw new AdtSafetyError('The private document requires bounded all-response and attempt allowances.');
  // Child policy retains the exact registered target and cleanup owner while adding shared accounting.
  const bounded = pinnedMutationContext(
    client.safety,
    {
      deadline: Math.min(context.requestPolicy.deadline, Date.now() + 300_000),
      signal: context.requestPolicy.signal,
      responseBudget:
        context.requestPolicy.responseBudget ??
        new DataResponseBudget(8 * 1024 * 1024, 'native-document-operation', true),
      attemptBudget: context.requestPolicy.attemptBudget ?? new RequestAttemptBudget(64),
    },
    context.cleanup,
  );
  return { selected, action, pkg, parent, transport, definition, context: bounded };
}

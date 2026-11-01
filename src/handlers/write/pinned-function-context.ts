/** Selection of function resources before entering the shared source handlers. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from '../../adt/mutation-context.js';
import { assertPinnedFunctionIdentifier, pinnedFunctionSelection } from '../../adt/pinned-function-owner.js';
import type { ServerConfig } from '../../server/types.js';
import { createPinnedSourceContext } from './pinned-source-context.js';

export async function createPinnedFunctionContext(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
) {
  assertMutationContext(client.safety, context);
  if (args.include !== undefined) throw new AdtSafetyError('Function resources do not use a CLAS include selector.');
  const unit = args.action === 'edit_unit' || args.action === 'add_unit';
  if (args.action !== 'update' && !unit)
    throw new AdtSafetyError('This function source adapter currently supports update and structural-include surgery.');
  if (unit && (args.type !== 'INCL' || typeof args.unit !== 'string' || !args.unit.trim()))
    throw new AdtSafetyError(
      'Function-group procedural surgery requires a structural include and FORM/MODULE selector.',
    );
  if (typeof args.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSourceHash))
    throw new AdtSafetyError('Read the exact source with SAPRead(format="editable") and supply expectedSourceHash.');
  if (
    (typeof args.source !== 'string' || !args.source.trim()) &&
    !(args.type === 'FUNC' && args.parameters !== undefined && args.action === 'update')
  )
    throw new AdtSafetyError('A non-empty source is required, except for a structured FUNC signature update.');
  let group = args.group;
  if (args.type === 'FUNC' && group === undefined && args.action !== 'create') {
    // Validate the name before the read-only search. The returned group is subsequently proved
    // through both native parent metadata and the selected child's exact container reference.
    assertPinnedFunctionIdentifier(args.name);
    group = await mutationClient(client, context).resolveFunctionGroup(args.name as string);
    if (!group) throw new AdtSafetyError('Cannot resolve the function group; provide group explicitly.');
  }
  pinnedFunctionSelection(args.type, args.name, group);
  return createPinnedSourceContext(client, { ...args, ...(group === undefined ? {} : { group }) }, config, context, {
    wholeIncludeReplacement: false,
  });
}

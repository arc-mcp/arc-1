/** Selection of function resources before entering the shared source handlers. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { assertMutationContext, type PinnedMutationContext } from '../../adt/mutation-context.js';
import { assertPinnedFunctionIdentifier, pinnedFunctionSelection } from '../../adt/pinned-function-owner.js';
import type { ServerConfig } from '../../server/types.js';
import { functionGroupIncludePrefix } from '../function-group-names.js';
import { createPinnedSourceContext } from './pinned-source-context.js';

export async function createPinnedFunctionContext(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
) {
  assertMutationContext(client.safety, context);
  if (args.include !== undefined) throw new AdtSafetyError('Function resources do not use a CLAS include selector.');
  const creating = args.action === 'create',
    deleting = args.action === 'delete';
  const unit = args.action === 'edit_unit' || args.action === 'add_unit';
  if (
    args.type === 'FUGR' &&
    ((!creating && !deleting) || (creating && typeof args.source === 'string' && args.source.length > 0))
  )
    throw new AdtSafetyError(
      'Function-group main source is maintained by SAP and has no qualified replacement profile. Create group metadata, then edit its structural includes or function modules.',
    );
  if (args.action !== 'update' && !unit && !creating && !deleting)
    throw new AdtSafetyError(
      'Select the native function creation, update, deletion or structural-include surgery adapter.',
    );
  if (unit && (args.type !== 'INCL' || typeof args.unit !== 'string' || !args.unit.trim()))
    throw new AdtSafetyError(
      'Function-group procedural surgery requires a structural include and FORM/MODULE selector.',
    );
  if (
    !creating &&
    !deleting &&
    (typeof args.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSourceHash))
  )
    throw new AdtSafetyError('Read the exact source with SAPRead(format="editable") and supply expectedSourceHash.');
  if (
    !creating &&
    !deleting &&
    (typeof args.source !== 'string' || !args.source.trim()) &&
    !(args.type === 'FUNC' && args.parameters !== undefined && args.action === 'update')
  )
    throw new AdtSafetyError('A non-empty source is required, except for a structured FUNC signature update.');
  if (creating && args.expectedSourceHash !== undefined)
    throw new AdtSafetyError('A new function resource cannot use an existing-source hash.');
  if (creating && args.source !== undefined && typeof args.source !== 'string')
    throw new AdtSafetyError('Function creation source must be text when provided.');
  if (creating && args.type === 'FUGR') {
    if (typeof args.package !== 'string' || !args.package.trim())
      throw new AdtSafetyError('Function-group creation requires an explicit package.');
    args = { ...args, package: args.package.trim().toUpperCase() };
  }
  let group = args.group;
  if (args.type === 'FUNC' && group === undefined && args.action !== 'create') {
    // Validate the name before the read-only search. The returned group is subsequently proved
    // through both native parent metadata and the selected child's exact container reference.
    assertPinnedFunctionIdentifier(args.name);
    group = await mutationClient(client, context).resolveFunctionGroup(args.name as string);
    if (!group) throw new AdtSafetyError('Cannot resolve the function group; provide group explicitly.');
  }
  const selected = pinnedFunctionSelection(args.type, args.name, group);
  if (
    selected.type === 'INCL' &&
    (creating || deleting) &&
    !selected.name.startsWith(functionGroupIncludePrefix(selected.group))
  )
    throw new AdtSafetyError(`Structural include names must start with ${functionGroupIncludePrefix(selected.group)}.`);
  return createPinnedSourceContext(client, { ...args, ...(group === undefined ? {} : { group }) }, config, context, {
    wholeIncludeReplacement: false,
  });
}

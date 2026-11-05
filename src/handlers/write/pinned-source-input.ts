/** Input contract for an admitted whole-owner update or procedural source edit. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import type { PinnedMutationContext } from '../../adt/mutation-context.js';
import { assertPinnedSourceOwner } from '../../adt/pinned-write-policy.js';
import type { ServerConfig } from '../../server/types.js';
import { createPinnedSourceContext } from './pinned-source-context.js';

export function createPinnedTextSourceContext(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
) {
  assertPinnedSourceOwner(args.type, args.name);
  if (args.action === 'delete') {
    return createPinnedSourceContext(client, args, config, context, { wholeIncludeReplacement: false });
  }
  const creating = args.action === 'create';
  if (creating) {
    if (typeof args.package !== 'string' || !args.package.trim())
      throw new AdtSafetyError('Creation requires an explicit package.');
    args = { ...args, package: args.package.trim().toUpperCase() };
  }
  const unitEdit = args.action === 'edit_unit' || args.action === 'add_unit';
  if (
    (args.action !== 'update' && !unitEdit && !creating) ||
    args.include !== undefined ||
    args.group !== undefined ||
    (unitEdit && args.type !== 'PROG' && args.type !== 'INCL')
  )
    throw new AdtSafetyError('Select the admitted standalone source update or procedural edit adapter.');
  if (unitEdit && (typeof args.unit !== 'string' || !args.unit.trim()))
    throw new AdtSafetyError('A FORM or MODULE selector is required.');
  if (typeof args.source !== 'string' || !args.source.trim())
    throw new AdtSafetyError('A non-empty source is required.');
  if (!creating && (typeof args.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSourceHash)))
    throw new AdtSafetyError('Read SAPRead(format="editable") and supply its expectedSourceHash before editing.');
  return createPinnedSourceContext(client, args, config, context, { wholeIncludeReplacement: false });
}

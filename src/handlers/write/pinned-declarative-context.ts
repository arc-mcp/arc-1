/** Private qualification entry for native CDS/RAP source CRUD; public routes stay closed. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { assertMutationContext, type PinnedMutationContext } from '../../adt/mutation-context.js';
import { pinnedDeclarativeSelection } from '../../adt/pinned-repository-owner.js';
import type { ServerConfig } from '../../server/types.js';
import { createPinnedSourceContext } from './pinned-source-context.js';

export function createPinnedDeclarativeContext(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
) {
  assertMutationContext(client.safety, context);
  pinnedDeclarativeSelection(args.type, args.name);
  const creating = args.action === 'create',
    deleting = args.action === 'delete';
  const fields = new Set(['action', 'type', 'name', 'transport']);
  if (!deleting) fields.add('source');
  if (creating) {
    fields.add('package');
    fields.add('description');
  } else if (!deleting) fields.add('expectedSourceHash');
  if (
    (!creating && !deleting && args.action !== 'update') ||
    Object.keys(args).some((key) => args[key] !== undefined && !fields.has(key))
  )
    throw new AdtSafetyError('The private declarative profile admits exact-owner create, update and delete only.');
  if (creating) {
    if (typeof args.package !== 'string' || !args.package.trim())
      throw new AdtSafetyError('Creation requires an explicit package.');
    if (args.source !== undefined && typeof args.source !== 'string')
      throw new AdtSafetyError('Creation source must be text when provided.');
    if (typeof args.source === 'string' && args.source.length > 0 && !args.source.trim())
      throw new AdtSafetyError('Creation source must not contain only whitespace.');
    if (args.description !== undefined && typeof args.description !== 'string')
      throw new AdtSafetyError('Creation description must be text when provided.');
    args = { ...args, package: args.package.trim().toUpperCase() };
  } else if (!deleting) {
    if (typeof args.source !== 'string' || !args.source.trim())
      throw new AdtSafetyError('A non-empty source is required.');
    if (typeof args.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSourceHash))
      throw new AdtSafetyError('Read the exact editable source and supply its expectedSourceHash.');
  }
  if (args.transport !== undefined && (typeof args.transport !== 'string' || !args.transport.trim()))
    throw new AdtSafetyError('An explicitly provided CTS request must not be empty.');
  return createPinnedSourceContext(client, args, config, context, { wholeIncludeReplacement: false });
}

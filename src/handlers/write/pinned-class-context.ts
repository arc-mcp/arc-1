/** Class-specific admission before entering the shared pinned source context. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { assertMutationContext, type PinnedMutationContext } from '../../adt/mutation-context.js';
import { assertPinnedOwner } from '../../adt/pinned-write-policy.js';
import type { ServerConfig } from '../../server/types.js';
import { detectLocalHandlerInclude, normalizeClassWriteInclude } from '../object-types.js';
import { isClassSurgeryAction } from './class-surgery-dispatch.js';
import type { SapWriteContext } from './context.js';
import { createPinnedSourceContext } from './pinned-source-context.js';

export function createPinnedClassContext(
  original: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
): SapWriteContext {
  assertMutationContext(original.safety, context);
  assertPinnedOwner(args.type, args.name);
  if (
    (!isClassSurgeryAction(args.action) && !(args.action === 'update' && args.include !== undefined)) ||
    args.type !== 'CLAS'
  )
    throw new AdtSafetyError('Only the admitted class surgery adapter is available.');
  const needsMethod = !['edit_class_definition', 'update'].includes(String(args.action));
  if (needsMethod && (typeof args.method !== 'string' || !args.method.trim()))
    throw new AdtSafetyError('A method name or add_method declaration is required.');
  const method = typeof args.method === 'string' ? args.method.trim() : undefined;
  const include = normalizeClassWriteInclude(args.include);
  if (args.include !== undefined && !include)
    throw new AdtSafetyError('Select a supported class include or omit include for main source.');
  if (args.include !== undefined && !['edit_method', 'update', 'edit_class_definition'].includes(String(args.action)))
    throw new AdtSafetyError('This metadata surgery adapter selects main source only.');
  const wholeIncludeReplacement = !!include && ['update', 'edit_class_definition'].includes(String(args.action));
  const selectedInclude = include ?? (args.action === 'edit_method' ? detectLocalHandlerInclude(method!) : undefined);
  const needsSource = ['update', 'edit_method', 'edit_class_definition', 'edit_method_signature'].includes(
    String(args.action),
  );
  if (
    needsSource &&
    (typeof args.source !== 'string' ||
      (!args.source.trim() &&
        (!wholeIncludeReplacement || args.source !== '' || typeof args.expectedSourceHash !== 'string')))
  )
    throw new AdtSafetyError(
      wholeIncludeReplacement
        ? 'Include source is required; source="" with an existing include hash clears it.'
        : 'A non-empty source is required.',
    );
  if (
    (!wholeIncludeReplacement || args.expectedSourceHash !== undefined) &&
    (typeof args.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(args.expectedSourceHash))
  )
    throw new AdtSafetyError('Read SAPRead(format="editable") and supply its expectedSourceHash before editing.');
  return createPinnedSourceContext(original, args, config, context, {
    selectedInclude,
    wholeIncludeReplacement,
    method,
  });
}

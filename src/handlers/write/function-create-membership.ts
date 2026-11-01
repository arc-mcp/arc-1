/** Observe native structural-include linking; never insert or repair parent source ourselves. */
import { AdtSafetyError } from '../../adt/errors.js';
import type { AdtHttpClient } from '../../adt/http.js';
import { findIncludeStatements } from '../../adt/include-expansion.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { pinnedFunctionSelection, readPinnedFunctionOwner } from '../../adt/pinned-function-owner.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { sourceHash } from '../../adt/source-precondition.js';
import type { SapWriteContext } from './context.js';
import { pinnedSourceState } from './pinned-source-context.js';

export async function verifyCreatedFunctionIncludeMembership(ctx: SapWriteContext, http: AdtHttpClient): Promise<void> {
  if (ctx.mutationContext.mode !== 'pinned-pp' || ctx.type !== 'INCL' || ctx.args.group === undefined) return;
  const state = pinnedSourceState(ctx);
  if (ctx.args.action !== 'create' || !state.createdOwner || !state.pkg || !state.readVerified)
    throw new AdtSafetyError('Include-membership verification requires its created, natively verified child.');
  state.phase = 'include-membership-verification';
  const selected = pinnedFunctionSelection(ctx.type, ctx.name, ctx.args.group);
  const parent = await readPinnedFunctionOwner(mutationClient(ctx.client, state.context, http), selected.groupUrl);
  if (parent?.packageName !== state.pkg)
    throw new AdtSafetyError('The native group package changed after include creation.');
  checkOperation(ctx.client.safety, OperationType.Read, 'GetSource');
  const response = await http.get(`${selected.groupUrl}/source/main`, {
    'Cache-Control': 'no-cache',
    Accept: 'text/plain',
  });
  if (Buffer.byteLength(response.body, 'utf8') > 1024 * 1024)
    throw new AdtSafetyError(
      'The group source exceeds the bounded include-membership check. The include exists; inspect the group in ADT.',
    );
  const matches = findIncludeStatements(response.body).filter(
    (statement) => statement.name.toUpperCase() === selected.name,
  );
  if (matches.length !== 1)
    throw new AdtSafetyError(
      'The include was created, but one native INCLUDE reference in its group source could not be verified. No child source was saved; inspect and link the group source explicitly in ADT before continuing.',
    );
  state.functionGroup = { name: selected.group, sourceHash: sourceHash(response.body), includeReferenced: true };
}

import { HarnessError } from './safe-io.mjs';

export const loginScopeProfiles = Object.freeze({
  read: 'read',
  'read-write': 'read write',
  'read-write-transports': 'read write transports',
});
/** Named operator profiles only; legacy readOnly/default behavior remains unchanged. */
export function loginScope(command) {
  if (command.scopes !== undefined || command.scope !== undefined)
    throw new HarnessError('NAMED_SCOPE_PROFILE_REQUIRED');
  if (command.scopeProfile === undefined) return command.readOnly === true ? 'read' : 'read write';
  if (!Object.hasOwn(loginScopeProfiles, command.scopeProfile) || command.readOnly !== undefined)
    throw new HarnessError('INVALID_SCOPE_PROFILE');
  return loginScopeProfiles[command.scopeProfile];
}

import { isSearchHelpName } from '../adt/search-help-name.js';

/** Shared by Zod and the handler; source-only options must never reach generic source routing. */
export function searchHelpInputIssue(
  args: Record<string, unknown>,
  context = false,
): { key: string; message: string } | undefined {
  if (!isSearchHelpName(args.name))
    return { key: 'name', message: 'SHLP requires a Dictionary name of at most 30 characters.' };
  const allowed = new Set(
    context ? ['type', 'name', 'action'] : ['type', 'name', 'version', 'format', 'force_refresh'],
  );
  if (context && args.action !== undefined && args.action !== 'deps') {
    return {
      key: 'action',
      message: 'SHLP context supports the default action or deps: partial interface metadata only.',
    };
  }
  if (!context && args.version !== undefined && args.version !== 'active') {
    return { key: 'version', message: 'SHLP metadata supports active only; inactive and auto cannot be honored.' };
  }
  if (!context && args.format !== undefined && args.format !== 'text') {
    return { key: 'format', message: 'SHLP metadata uses default JSON text output; omit format or use text.' };
  }
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== false && !allowed.has(key)) {
      return { key, message: `SHLP metadata does not support ${key}.` };
    }
  }
  return undefined;
}

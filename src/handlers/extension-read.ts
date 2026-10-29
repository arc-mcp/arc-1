/** One handler boundary for optional family adapters; legacy base content is never rewritten. */
import type { AdtClient } from '../adt/client.js';
import { ddicExtensionAdapter } from '../adt/ddic-extension-adapter.js';
import {
  ExtensionDiscoverySession,
  type ExtensionMode,
  type ExtensionRequest,
  renderExtensionDiscovery,
} from '../adt/extension-discovery.js';
import { getCurrentContext } from '../server/context.js';
import type { ToolResult } from './shared.js';

export const EXTENSION_READ_TYPES = new Set(['TABL', 'PROG', 'INCL', 'FUNC', 'FUGR', 'CLAS', 'INTF', 'BDEF']);

export function extensionReadMode(args: Record<string, unknown>): ExtensionMode {
  if (args.extensions === 'none' || args.extensions === 'summary' || args.extensions === 'sources')
    return args.extensions;
  // Stage 1 enables automatic summaries only for the qualified DDIC adapter.
  if (
    String(args.type).toUpperCase() !== 'TABL' ||
    args.method ||
    args.grep ||
    args.lineStart !== undefined ||
    args.lineEnd !== undefined ||
    args.include ||
    args.action ||
    args.format === 'editable'
  )
    return 'none';
  return 'summary';
}

export async function appendReadExtensions(
  client: AdtClient,
  args: Record<string, unknown>,
  base: ToolResult,
  version: 'active' | 'inactive',
  baseSource: string,
): Promise<ToolResult> {
  const mode = extensionReadMode(args);
  if (mode === 'none' || base.isError) return base;
  const type = String(args.type).toUpperCase(),
    name = String(args.name);
  const partial = args.method || args.grep || args.lineStart !== undefined || args.include;
  const request: ExtensionRequest = {
    root: { type, name, version },
    scope: `${type} ${name}${partial ? ` owning object/source (base filtered${args.include ? `; section=${args.include}` : ''})` : ' full root source'}`,
    ...(args.enhancementContext ? { context: args.enhancementContext as ExtensionRequest['context'] } : {}),
  };
  const session = new ExtensionDiscoverySession(mode, request, client.safety, { signal: getCurrentContext()?.signal });
  if (type === 'TABL') await ddicExtensionAdapter(client, baseSource)(session, request);
  else
    session.result.providers.push({
      id: 'family_adapter',
      family: type,
      status: 'unsupported',
      coverage: 'selected_source',
      reason: version === 'inactive' ? 'unsupported_version' : 'Family adapter not implemented in this stage.',
    });
  return { ...base, content: [...base.content, ...renderExtensionDiscovery(session.finish())] };
}

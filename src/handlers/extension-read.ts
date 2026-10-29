/** One handler boundary for optional family adapters; legacy base content is never rewritten. */

import { discoverClassExtensions } from '../adt/class-extensions.js';
import type { AdtClient } from '../adt/client.js';
import { ddicExtensionAdapter } from '../adt/ddic-extension-adapter.js';
import {
  ExtensionDiscoverySession,
  type ExtensionMode,
  type ExtensionRequest,
  renderExtensionDiscovery,
} from '../adt/extension-discovery.js';
import { getCurrentContext } from '../server/context.js';
import { getCachedFeatures } from './feature-cache.js';
import { detectLocalHandlerInclude } from './object-types.js';
import type { ToolResult } from './shared.js';

export const EXTENSION_READ_TYPES = new Set(['TABL', 'PROG', 'INCL', 'FUNC', 'FUGR', 'CLAS', 'INTF', 'BDEF']);

export function extensionReadMode(args: Record<string, unknown>): ExtensionMode {
  if (args.extensions === 'none' || args.extensions === 'summary' || args.extensions === 'sources')
    return args.extensions;
  if (
    !['TABL', 'CLAS', 'INTF'].includes(String(args.type).toUpperCase()) ||
    args.method ||
    args.grep ||
    args.lineStart !== undefined ||
    args.lineEnd !== undefined ||
    args.include ||
    args.action ||
    args.format === 'editable' ||
    args.format === 'structured'
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
    root: { type, name, version: args.format === 'structured' ? 'provider_current' : version },
    scope: `${type} ${name}${partial ? ` owning object/source (base filtered${args.include ? `; section=${args.include}` : ''})` : ' full root source'}`,
    ...(args.enhancementContext ? { context: args.enhancementContext as ExtensionRequest['context'] } : {}),
  };
  const session = new ExtensionDiscoverySession(mode, request, client.safety, { signal: getCurrentContext()?.signal });
  if (type === 'TABL') await ddicExtensionAdapter(client, baseSource)(session, request);
  else if (type === 'CLAS' || type === 'INTF') {
    const section = (args.include ??
      (args.method ? detectLocalHandlerInclude(String(args.method)) : undefined) ??
      'main') as 'main' | 'definitions' | 'implementations' | 'macros' | 'testclasses';
    await discoverClassExtensions(
      client,
      session,
      request,
      { unit: { type: 'CLAS', name, section }, source: baseSource },
      getCachedFeatures()?.abapRelease,
    );
  } else
    session.result.providers.push({
      id: 'family_adapter',
      family: type,
      status: 'unsupported',
      coverage: 'selected_source',
      reason: version === 'inactive' ? 'unsupported_version' : 'Family adapter not implemented in this stage.',
    });
  return { ...base, content: [...base.content, ...renderExtensionDiscovery(session.finish())] };
}

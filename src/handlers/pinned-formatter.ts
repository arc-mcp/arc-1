/** Pinned routing for formatter preferences and their deliberately scoped read companions. */
import type { AdtClient } from '../adt/client.js';
import { type PrettyPrinterSettings, prettyPrint } from '../adt/devtools.js';
import { mutationHttp } from '../adt/mutation-http.js';
import { getPinnedFormatterSettings, patchPinnedFormatterSettings } from '../adt/pinned-formatter.js';
import type { ServerConfig } from '../server/types.js';
import { pinnedOperationContext, pinnedOperationResult } from './pinned-operation.js';
import { type ToolResult, textResult, toolJson } from './shared.js';

export async function handlePinnedFormatter(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  const mutation = args.action === 'set_formatter_settings';
  const context = pinnedOperationContext(client, config, {
    tool: 'SAPLint',
    args,
    kind: mutation ? 'mutation' : 'companion',
    timeoutMs: 30000,
  });
  const http = mutationHttp(client.http, client.safety, context);
  if (args.action === 'format') return textResult(await prettyPrint(http, client.safety, args.source as string));
  if (args.action === 'get_formatter_settings')
    return textResult(toolJson(await getPinnedFormatterSettings(http, client.safety)));
  const result = await patchPinnedFormatterSettings(http, client.safety, context, {
    indentation: args.indentation as boolean | undefined,
    style: args.style as PrettyPrinterSettings['style'] | undefined,
  });
  return pinnedOperationResult(result, config, { action: args.action as string });
}

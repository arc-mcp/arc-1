/** Pinned routing for formatter preferences and their deliberately scoped read companions. */
import type { AdtClient } from '../adt/client.js';
import { type PrettyPrinterSettings, prettyPrint } from '../adt/devtools.js';
import { AdtSafetyError } from '../adt/errors.js';
import { pinnedMutationContext } from '../adt/mutation-context.js';
import { mutationHttp } from '../adt/mutation-http.js';
import { getPinnedFormatterSettings, patchPinnedFormatterSettings } from '../adt/pinned-formatter.js';
import { getCurrentContext } from '../server/context.js';
import { pinnedCompanionAllowed, pinnedMutationAllowed } from '../server/multi-target-write-surface.js';
import type { ServerConfig } from '../server/types.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

export async function handlePinnedFormatter(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  const mutation = args.action === 'set_formatter_settings';
  const allowed = mutation
    ? pinnedMutationAllowed('SAPLint', args, config)
    : pinnedCompanionAllowed('SAPLint', args, config);
  if (
    !allowed ||
    !config.targetId ||
    !client.safety.allowWrites ||
    client.safety.multiTargetWrite?.target !== config.targetId ||
    config.multiTargetWrite?.target !== config.targetId ||
    !client.safety.multiTargetWrite?.enabled
  ) {
    throw new AdtSafetyError('Formatter operation is unavailable for this pinned target and caller policy.');
  }
  const request = getCurrentContext();
  const context = pinnedMutationContext(
    client.safety,
    {
      deadline: Date.now() + 30000,
      signal: request?.signal,
    },
    { unlockFailed: false },
  );
  const http = mutationHttp(client.http, client.safety, context);
  if (args.action === 'format') return textResult(await prettyPrint(http, client.safety, args.source as string));
  if (args.action === 'get_formatter_settings')
    return textResult(toolJson(await getPinnedFormatterSettings(http, client.safety)));
  const result = await patchPinnedFormatterSettings(http, client.safety, context, {
    indentation: args.indentation as boolean | undefined,
    style: args.style as PrettyPrinterSettings['style'] | undefined,
  });
  const payload = toolJson({
    ...result,
    ...(result.ok
      ? {}
      : {
          error:
            result.state === 'unchanged' || result.state === 'update-rejected'
              ? 'PINNED_WRITE_REFUSED'
              : 'PINNED_WRITE_INCOMPLETE',
        }),
    target: config.targetId,
    requestId: request?.requestId,
    action: args.action,
  });
  return result.ok ? textResult(payload) : errorResult(payload);
}

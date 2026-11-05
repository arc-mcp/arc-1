/**
 * Pinned routing for classic FLP content. Two independent locks keep public mutations closed: the
 * capability row, and the unproven customizing-recording evidence that admission alone cannot remove.
 */
import type { AdtClient } from '../adt/client.js';
import { flpCatalogKey } from '../adt/flp.js';
import type { PinnedMutationContext } from '../adt/mutation-context.js';
import { mutationHttp } from '../adt/mutation-http.js';
import { PINNED_FLP_RECORDING_NOT_ESTABLISHED, parsePinnedFlpList } from '../adt/pinned-flp.js';
import { listPinnedFlpCatalogs, listPinnedFlpGroups, readPinnedFlpTilePage } from '../adt/pinned-flp-entity.js';
import type { ServerConfig } from '../server/types.js';
import { catalogLines, groupLines, tileLines } from './flp-format.js';
import { pinnedOperationContext, pinnedOperationResult } from './pinned-operation.js';
import { type ToolResult, textResult } from './shared.js';

export function isPinnedFlpRoute(client: AdtClient, config: ServerConfig, action: string): boolean {
  return action.startsWith('flp_') && !!(config.targetId || config.multiTargetWrite || client.safety.multiTargetWrite);
}

async function listPinnedFlp(
  client: AdtClient,
  args: Record<string, unknown>,
  context: PinnedMutationContext,
): Promise<ToolResult> {
  parsePinnedFlpList(args);
  const http = mutationHttp(client.http, client.safety, context);
  const result = (body: string, truncated: boolean) =>
    textResult(
      truncated
        ? `${body}\nIncomplete listing: the 500-entry cap or a native continuation/count indicates more entries may exist.`
        : body,
    );
  if (args.action === 'flp_list_catalogs') {
    const page = await listPinnedFlpCatalogs(http, client.safety);
    return result(catalogLines(page.items), page.truncated);
  }
  if (args.action === 'flp_list_groups') {
    const page = await listPinnedFlpGroups(http, client.safety);
    return result(groupLines(page.items), page.truncated);
  }
  const catalogId = args.catalogId as string;
  const page = await readPinnedFlpTilePage(http, client.safety, flpCatalogKey(catalogId));
  return result(tileLines(page.items, catalogId), page.truncated);
}

export async function handlePinnedFlp(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  const action = String(args.action);
  if (action.startsWith('flp_list_')) {
    const context = pinnedOperationContext(client, config, {
      tool: 'SAPManage',
      args,
      kind: 'companion',
      timeoutMs: 60_000,
    });
    return listPinnedFlp(client, args, context);
  }
  pinnedOperationContext(client, config, { tool: 'SAPManage', args, timeoutMs: 300_000 });
  return pinnedOperationResult(
    {
      ok: false,
      state: 'unchanged',
      phase: 'validation',
      retryable: false,
      resource: 'classic-flp-client-content',
      recording: 'not-established',
      message: PINNED_FLP_RECORDING_NOT_ESTABLISHED,
    },
    config,
    { action },
  );
}

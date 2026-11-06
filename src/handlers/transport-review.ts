import { type AdtClient, clampSearchResults } from '../adt/client.js';
import { throwIfRequestCancelled } from '../adt/http-deadline.js';
import { getTransport } from '../adt/transport.js';
import { diffTransportObject, rollupTransportObjects, type TransportObjectDiff } from '../adt/transport-diff.js';
import { ReviewBudget } from '../adt/transport-review-budget.js';
import { getCurrentContext } from '../server/context.js';
import type { ServerConfig } from '../server/types.js';
import { errorResult, textResult, toolJson } from './shared.js';

export const REVIEW_OUTPUT_BYTES = 64 * 1024;

export async function handleTransportReview(client: AdtClient, args: Record<string, unknown>, config: ServerConfig) {
  const id = String(args.id ?? '')
    .trim()
    .toUpperCase();
  if (!id) return errorResult('Transport ID is required for "diff" action.');
  const budget = new ReviewBudget();
  const transport = await budget.read((request) => getTransport(client.http, client.safety, id, request));
  if (!transport)
    return errorResult(`Transport ${id.slice(0, 40)} not found. If this is a task, use its parent request.`);
  // TRSTATUS: R/N are released; D/L are modifiable. O/P are transitional.
  const mode = ['R', 'N'].includes(transport.status)
    ? 'released'
    : ['D', 'L'].includes(transport.status)
      ? 'active'
      : undefined;
  if (!mode)
    return errorResult(
      `Transport ${id.slice(0, 40)} has status ${String(transport.status || 'unknown').slice(0, 16)}; a stable comparison state cannot be selected. Retry after release finishes or inspect the request in SAP.`,
    );

  const key = (o: { pgmid: string; type: string; name: string }) => `${o.pgmid}:${o.type}:${o.name}`.toUpperCase();
  const taskKeys = new Set(transport.tasks.flatMap((t) => t.objects.map(key)));
  const requestOnly = (transport.requestObjects ?? []).filter((o) => !taskKeys.has(key(o)));
  const inventory = rollupTransportObjects([
    ...transport.tasks,
    ...(requestOnly.length ? [{ id: transport.id, objects: requestOnly }] : []),
  ]);
  inventory.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  if (offset > 0 && offset >= inventory.length)
    return errorResult(`Review offset is outside this transport inventory (${inventory.length} objects).`);
  const limit = Math.min(clampSearchResults(args.limit as number | undefined, 20), 40);
  const ids = new Set([transport.id, ...transport.tasks.map((t) => t.id)]);
  const objects: TransportObjectDiff[] = [];
  let stoppedBy: string | undefined;
  const fits = (object: TransportObjectDiff) =>
    Buffer.byteLength(toolJson([...objects, object])) <= REVIEW_OUTPUT_BYTES - 8192;
  for (const object of inventory.slice(offset, offset + limit)) {
    if (budget.exhausted) break;
    const diff = await diffTransportObject(client, object, ids, {
      mode,
      budget,
      summary: args.summary === true,
      minimalErrors: config.minimalErrors || Boolean(config.targetId),
    });
    // Cancellation ends the call, rather than becoming a successful review with missing parts.
    throwIfRequestCancelled({ signal: getCurrentContext()?.signal });
    // Retry an unfinished later object on a fresh page. Always report the first object,
    // even if it alone exceeds the allowance, so nextOffset cannot loop at the same object.
    if (budget.exhausted && objects.length) break;
    if (!fits(diff)) {
      stoppedBy = 'output limit';
      if (objects.length) break;
      for (const part of [...diff.parts].reverse()) {
        if (fits(diff)) break;
        if (part.diff) {
          part.diff = '';
          part.hunksOmitted = true;
        }
      }
      if (!fits(diff))
        return errorResult(
          'Review metadata for the first object exceeds the output budget. Inspect this object in SAP.',
        );
    }
    objects.push(diff);
  }
  const nextOffset = offset + objects.length;
  const baselines: Record<string, number> = {};
  for (const object of objects)
    for (const part of object.parts) baselines[part.baselineStatus] = (baselines[part.baselineStatus] ?? 0) + 1;
  const payload = {
    transport: {
      id: transport.id,
      description: transport.description,
      owner: transport.owner,
      status: transport.status,
    },
    comparison:
      mode === 'released'
        ? 'released transport snapshot against preceding snapshot'
        : 'active source against preceding transport snapshot',
    totalObjects: inventory.length,
    offset,
    shown: objects.length,
    ...(nextOffset < inventory.length ? { nextOffset } : {}),
    ...(budget.exhausted || stoppedBy ? { stoppedBy: budget.stopReason ?? stoppedBy ?? 'collection limit' } : {}),
    pageSummary: {
      baselines,
      inventoryOnly: objects.filter((o) => o.inventoryReason).length,
      objectsWithUncomparedScope: objects.filter((o) => o.notCompared?.length).length,
    },
    note: 'Source comparison only; not a release verdict. Each page rereads inventory and sources, not an atomic snapshot.',
    objects,
  };
  const output = toolJson(payload);
  if (Buffer.byteLength(output) > REVIEW_OUTPUT_BYTES)
    return errorResult('Review metadata exceeds output budget. Narrow the page with limit=1.');
  return textResult(output);
}

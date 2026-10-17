import { createHash } from 'node:crypto';
import { type AdtClient, clampSearchResults } from '../adt/client.js';
import { getTransport } from '../adt/transport.js';
import {
  diffTransportObject,
  type ReviewMode,
  reviewCoverage,
  rollupTransportObjects,
  type TransportObjectDiff,
} from '../adt/transport-diff.js';
import { ReviewBudget } from '../adt/transport-review-budget.js';
import { getCurrentContext } from '../server/context.js';
import type { ServerConfig } from '../server/types.js';
import { errorResult, textResult, toolJson } from './shared.js';

export const REVIEW_OUTPUT_BYTES = 512 * 1024;

/** Keep normal tool replies compact; the report collector explicitly requests full provenance. */
function compactObjects(objects: TransportObjectDiff[]): TransportObjectDiff[] {
  return objects.map(({ scopeNote: _scope, ...object }) => ({
    ...object,
    parts: object.parts.map(
      ({
        revisions: _revisions,
        sourceHashes: _hashes,
        retrievedAt: _time,
        comparisonMode: _mode,
        activationStatus: _activation,
        ...part
      }) => part,
    ),
  }));
}

export async function handleTransportReview(client: AdtClient, args: Record<string, unknown>, config: ServerConfig) {
  const id = String(args.id ?? '')
    .trim()
    .toUpperCase();
  if (!id) return errorResult('Transport ID is required for "diff" action.');
  const mode = (args.reviewMode ?? 'legacy') as ReviewMode;
  const budget = new ReviewBudget();
  const transport = await budget.read((request) => getTransport(client.http, client.safety, id, request));
  if (!transport) return errorResult(`Transport ${id} not found.`);
  const taskKeys = new Set(
    transport.tasks.flatMap((t) => t.objects.map((o) => `${o.pgmid}:${o.type}:${o.name}`.toUpperCase())),
  );
  const requestOnly = (transport.requestObjects ?? []).filter(
    (o) => !taskKeys.has(`${o.pgmid}:${o.type}:${o.name}`.toUpperCase()),
  );
  const inventory = rollupTransportObjects([
    ...transport.tasks,
    ...(requestOnly.length ? [{ id: transport.id, objects: requestOnly }] : []),
  ]);
  const key = (o: { pgmid: string; type: string; name: string }) => `${o.pgmid}:${o.type}:${o.name}`;
  inventory.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const target = config.targetId ?? `${config.url ? new URL(config.url).origin : 'local'}/${client.sapClient}`;
  const normalized = inventory.map((o) => ({
    key: key(o),
    components: o.components.map((c) => JSON.stringify(c)).sort(),
  }));
  // Empty tasks still affect attribution, and releasing a task changes the review context.
  const tasks = transport.tasks
    .map((task) => ({ id: task.id, status: task.status, owner: task.owner }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const inventoryFingerprint = createHash('sha256')
    .update(JSON.stringify({ normalized, tasks, status: transport.status, type: transport.type }))
    .digest('hex');
  const binding = JSON.stringify([
    getCurrentContext()?.user ?? client.username,
    config.destinationName,
    config.url,
    target,
    client.sapClient,
    id,
    mode,
    inventoryFingerprint,
  ]);
  // A plain hash: the token gates no access, so it must survive restarts and other instances.
  const continuation = createHash('sha256').update(binding).digest('hex');
  if (args.continuation !== undefined && args.continuation !== continuation) {
    return errorResult(
      'Review continuation is stale or belongs to a different caller, target, request or mode. Restart at offset 0.',
    );
  }
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  if (offset > 0 && offset >= inventory.length)
    return errorResult(`Review offset is outside this transport inventory (${inventory.length} objects).`);
  const limit = Math.min(clampSearchResults(args.limit as number | undefined, 20), 40);
  const ids = new Set([transport.id, ...transport.tasks.map((t) => t.id)]);
  const objects: TransportObjectDiff[] = [];
  let outputTruncated = false;
  for (const object of inventory.slice(offset, offset + limit)) {
    if (budget.exhausted) break;
    const diff = await diffTransportObject(client, object, ids, {
      mode,
      budget,
      summary: args.summary === true,
      minimalErrors: config.minimalErrors,
    });
    // The page budget ran out inside this object: retry it on the next page instead of
    // recording ARC-1's own limit as missing SAP evidence. The first object always lands.
    if (budget.exhausted && objects.length) break;
    if (Buffer.byteLength(JSON.stringify([...objects, diff])) > REVIEW_OUTPUT_BYTES - 8192) {
      outputTruncated = true;
      // Keep exact hashes/statistics; declare omitted hunks. A follow-up can ask for one object.
      for (const part of diff.parts) {
        if (part.diff) {
          part.diff = '';
          part.hunksOmitted = true;
        }
      }
    }
    if (Buffer.byteLength(JSON.stringify([...objects, diff])) > REVIEW_OUTPUT_BYTES - 8192) {
      if (!objects.length)
        return errorResult(
          `Review metadata for ${object.type} ${object.name} exceeds the output budget. Review this scope in SAP; automated coverage is incomplete.`,
        );
      break;
    }
    objects.push(diff);
  }
  const coverage = reviewCoverage(objects);
  const nextOffset = offset + objects.length;
  const more = nextOffset < inventory.length;
  const partial =
    (offset > 0 && args.continuation === undefined) ||
    more ||
    outputTruncated ||
    objects.some((o) => o.parts.some((p) => p.diffTruncated || p.hunksOmitted)) ||
    coverage.uncertain + coverage.unavailable + coverage.unsupported > 0;
  const payload = {
    schemaVersion: 1,
    resultFormat: args.resultFormat === 'structured' ? 'structured' : 'legacy',
    transport: {
      id: transport.id,
      description: transport.description,
      owner: transport.owner,
      status: transport.status,
      type: transport.type,
      taskIds: transport.tasks.map((t) => t.id),
    },
    target,
    client: client.sapClient,
    retrievedAt: new Date().toISOString(),
    reviewMode: mode,
    comparison: 'transport-correction-to-immediate-previous',
    inventoryFingerprint,
    continuation,
    continuationVerified: args.continuation !== undefined,
    sourceStability: 'Hashes identify the sources read at different times; collection is not an atomic SAP snapshot.',
    status: partial ? 'partial' : 'complete',
    coverage,
    totalObjects: inventory.length,
    offset,
    shown: objects.length,
    ...(more
      ? { nextOffset, hint: `Next page: offset=${nextOffset}, with the same continuation and reviewMode.` }
      : {}),
    ...(inventory.length === 0
      ? { note: 'This transport records no reviewable objects; this is not a release verdict.' }
      : {}),
    metrics: budget.metrics(),
    scopeNotes: [...new Set(objects.flatMap((object) => (object.scopeNote ? [object.scopeNote] : [])))],
    objects: args.resultFormat === 'structured' ? objects : compactObjects(objects),
  };
  const output = toolJson(payload);
  if (Buffer.byteLength(output) > REVIEW_OUTPUT_BYTES)
    return errorResult('Review metadata exceeds output budget. Narrow the page with limit=1.');
  return textResult(output);
}

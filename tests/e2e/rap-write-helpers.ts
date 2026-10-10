import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { deleteProgramFixture } from '../helpers/program-cleanup.js';
import { callTool } from './helpers.js';

/**
 * Generate a collision-safe unique name with a given prefix (max 30 chars).
 * Re-exports the shared letters-only generator: RAP/BDEF identifiers must avoid
 * digit sequences like "00" that confuse the BDEF parser in certain positions,
 * and the letters-only form also carries the per-run id (run-scoped to keep
 * concurrent runs against one SAP system from colliding).
 */
export { uniqueLettersName as uniqueName } from './helpers.js';

/** Program fixture cleanup is checked; other RAP types retain their existing best-effort cleanup. */
export async function bestEffortDelete(client: Client, type: string, name: string): Promise<void> {
  if (type === 'PROG') {
    const result = await deleteProgramFixture((tool, args) => callTool(client, tool, args), name);
    const text = result.content.map((c) => c.text).join('\n');
    // Only an owner-lock 404 establishes absence; a text-pool 404 does not.
    const ownerMissing = /status 404 at \/sap\/bc\/adt\/programs\/programs\//i.test(text);
    if (result.isError && !ownerMissing) throw new Error(`Cleanup of ${name}: ${text}`);
    return;
  }
  try {
    await callTool(client, 'SAPWrite', { action: 'delete', type, name });
  } catch {
    // best-effort-cleanup
  }
}

/** Best-effort package delete helper. Swallows all errors. */
export async function bestEffortDeletePackage(client: Client, name: string): Promise<void> {
  try {
    await callTool(client, 'SAPManage', { action: 'delete_package', name });
  } catch {
    // best-effort-cleanup
  }
}

export async function loadRapAvailability(client: Client): Promise<true | undefined> {
  const featuresResult = await callTool(client, 'SAPManage', { action: 'features' });
  if (featuresResult.isError) return undefined;

  try {
    const features = JSON.parse(featuresResult.content?.[0]?.text ?? '{}');
    return features.rap?.available === true ? true : undefined;
  } catch {
    return undefined;
  }
}

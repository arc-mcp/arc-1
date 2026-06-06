import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { callTool } from './helpers.js';

/** Generate a collision-safe unique name with a given prefix (max 30 chars).
 *  Uses letters-only encoding to avoid ABAP/CDS identifier issues —
 *  digit sequences like "00" confuse the BDEF parser in certain positions. */
export function uniqueName(prefix: string): string {
  // Encode timestamp + random as letters only (A-Z, base 26)
  const toLetters = (n: number): string => {
    let s = '';
    let v = n;
    while (v > 0) {
      s = String.fromCharCode(65 + (v % 26)) + s;
      v = Math.floor(v / 26);
    }
    return s || 'A';
  };
  const suffix = `${toLetters(Date.now())}${toLetters(Math.floor(Math.random() * 1e6))}`;
  return `${prefix}${suffix}`.slice(0, 30);
}

/** Best-effort delete helper. Swallows all errors. */
export async function bestEffortDelete(client: Client, type: string, name: string): Promise<void> {
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
